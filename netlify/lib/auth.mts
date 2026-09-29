import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getUser } from "@netlify/identity";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { auditLog, buildingMembers, buildings, pendingMembers, terminals, users, type Role } from "../../db/schema.js";
import { buildingPeople, buildingReferents } from "../../db/schema-v3.js";

export const TERMINAL_HEADER = "x-terminal-token";

const ROLE_CAPABILITIES: Record<Role, readonly string[]> = {
  resident: ["building:read", "tickets:read:own", "tickets:create", "documents:read:private", "finance:read:own"],
  council_member: [
    "building:read", "tickets:read:own", "tickets:read:all", "tickets:create",
    "documents:read:private", "finance:read:own", "audit:read",
  ],
  manager: [
    "building:read", "tickets:read:own", "tickets:read:all", "tickets:create", "tickets:update",
    "documents:read:private", "documents:manage", "announcements:manage", "events:manage",
    "audit:read", "terminals:manage", "members:manage", "finance:manage",
  ],
  platform_admin: [
    "building:read", "tickets:read:own", "tickets:read:all", "tickets:create", "tickets:update",
    "documents:read:private", "documents:manage", "announcements:manage", "events:manage",
    "audit:read", "terminals:manage", "members:manage", "finance:manage", "platform:admin",
  ],
};

const TERMINAL_CAPABILITIES = ["display:read"] as const;
const TERMINAL_REPORT_CAPABILITY = "tickets:create";

export type UserPrincipal = {
  kind: "user";
  userId: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
};

export type TerminalPrincipal = {
  kind: "terminal";
  terminalId: number;
  buildingId: number;
  label: string;
  canReport: boolean;
};

export type Principal = UserPrincipal | TerminalPrincipal;

export type Membership = {
  buildingId: number;
  buildingSlug: string;
  buildingName: string;
  role: Role;
  unitLabel: string;
  shareLabel: string;
};

export type AuthContext = {
  principal: Principal;
  buildingId: number;
  role: Role | null;
  capabilities: readonly string[];
  actorLabel: string;
  can: (capability: string) => boolean;
};

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const jsonError = (error: unknown) => {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Erreur non gérée:", error);
  return Response.json({ error: "Erreur interne" }, { status: 500 });
};

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const generateTerminalToken = () => {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token), tokenHint: token.slice(-6) };
};

const readTerminalToken = (req: Request) => {
  const header = req.headers.get(TERMINAL_HEADER);
  return header && header.trim().length > 0 ? header.trim() : null;
};

/**
 * Relie une personne V3 existante au compte authentifié correspondant.
 *
 * Un compte ne peut être relié qu'à une seule fiche par immeuble (index unique
 * `building_people_building_user_idx`) : si une fiche l'est déjà, rien n'est
 * modifié ; sinon seule la plus ancienne fiche non reliée portant l'adresse
 * est rattachée. Ne lève jamais d'erreur bloquante pour la connexion.
 */
export const linkBuildingPersonAccount = async (buildingId: number, email: string, userId: string) => {
  const needle = email.trim().toLowerCase();
  if (!needle) return;
  const [alreadyLinked] = await db.select({ id: buildingPeople.id }).from(buildingPeople)
    .where(and(eq(buildingPeople.buildingId, buildingId), eq(buildingPeople.userId, userId))).limit(1);
  if (alreadyLinked) return;

  const [candidate] = await db.select({ id: buildingPeople.id }).from(buildingPeople)
    .where(and(
      eq(buildingPeople.buildingId, buildingId),
      isNull(buildingPeople.userId),
      sql`lower(${buildingPeople.email}) = ${needle}`,
    ))
    .orderBy(asc(buildingPeople.id))
    .limit(1);
  if (!candidate) return;

  try {
    await db.update(buildingPeople)
      .set({ userId, updatedAt: new Date() })
      .where(and(eq(buildingPeople.id, candidate.id), isNull(buildingPeople.userId)));
  } catch (error) {
    console.error("Liaison fiche personne ↔ compte impossible:", error);
  }
};

const claimPendingMemberships = async (userId: string, email: string) => {
  const needle = email.trim().toLowerCase();
  if (!needle) return;

  const pending = await db.select().from(pendingMembers).where(eq(pendingMembers.email, needle));
  if (pending.length === 0) return;

  for (const row of pending) {
    await db.insert(buildingMembers).values({
      buildingId: row.buildingId,
      userId,
      role: row.role,
      unitLabel: row.unitLabel,
      shareLabel: row.shareLabel,
    }).onConflictDoNothing({ target: [buildingMembers.buildingId, buildingMembers.userId] });

    await linkBuildingPersonAccount(row.buildingId, needle, userId);

    await db.insert(auditLog).values({
      buildingId: row.buildingId,
      actorUserId: userId,
      actorLabel: needle,
      actorRole: row.role,
      action: "member.claimed",
      entityType: "building_member",
      entityId: "",
      summary: `${needle} a activé son accès CoproLink.`,
    });
  }

  await db.delete(pendingMembers).where(inArray(pendingMembers.id, pending.map((row) => row.id)));
};

export const resolvePrincipal = async (req: Request): Promise<Principal | null> => {
  const token = readTerminalToken(req);
  if (token) {
    const terminal = await resolveTerminal(token);
    if (!terminal) throw new HttpError(401, "Jeton de terminal invalide ou révoqué");
    return terminal;
  }

  const identityUser = await getUser();
  if (!identityUser) return null;

  const email = identityUser.email ?? "";
  const fullName = identityUser.name ?? (identityUser.userMetadata?.full_name as string | undefined) ?? email.split("@")[0] ?? "";

  await db.insert(users).values({ id: identityUser.id, email, fullName, lastSeenAt: new Date() })
    .onConflictDoUpdate({ target: users.id, set: { email, fullName, lastSeenAt: new Date() } });

  await claimPendingMemberships(identityUser.id, email);

  return {
    kind: "user",
    userId: identityUser.id,
    email,
    fullName,
    isPlatformAdmin: (identityUser.roles ?? []).includes("platform_admin"),
  };
};

const resolveTerminal = async (token: string): Promise<TerminalPrincipal | null> => {
  const candidateHash = hashToken(token);
  const [row] = await db.select().from(terminals)
    .where(and(eq(terminals.tokenHash, candidateHash), isNull(terminals.revokedAt))).limit(1);
  if (!row) return null;

  const expected = Buffer.from(row.tokenHash, "utf8");
  const provided = Buffer.from(candidateHash, "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

  await db.update(terminals).set({ lastSeenAt: new Date() }).where(eq(terminals.id, row.id));
  return { kind: "terminal", terminalId: row.id, buildingId: row.buildingId, label: row.label, canReport: row.canReport };
};

export const listMemberships = async (userId: string): Promise<Membership[]> => {
  const rows = await db.select({
    buildingId: buildings.id,
    buildingSlug: buildings.slug,
    buildingName: buildings.name,
    role: buildingMembers.role,
    unitLabel: buildingMembers.unitLabel,
    shareLabel: buildingMembers.shareLabel,
  }).from(buildingMembers)
    .innerJoin(buildings, eq(buildingMembers.buildingId, buildings.id))
    .where(eq(buildingMembers.userId, userId))
    // Ordre stable : sans `?building=`, `authorize` retombe toujours sur le même immeuble.
    .orderBy(asc(buildings.name), asc(buildings.id));
  return rows.map((r) => ({ ...r, role: r.role as Role }));
};

const buildCapabilities = (role: Role | null, isPlatformAdmin: boolean): readonly string[] => {
  const fromRole = role ? ROLE_CAPABILITIES[role] ?? [] : [];
  if (!isPlatformAdmin) return fromRole;
  return Array.from(new Set([...fromRole, ...ROLE_CAPABILITIES.platform_admin]));
};

export const authorize = async (
  req: Request,
  options: { buildingSlug?: string | null; require?: string } = {},
): Promise<AuthContext> => {
  const principal = await resolvePrincipal(req);
  if (!principal) throw new HttpError(401, "Authentification requise");

  let context: AuthContext;

  if (principal.kind === "terminal") {
    const capabilities = principal.canReport ? [...TERMINAL_CAPABILITIES, TERMINAL_REPORT_CAPABILITY] : [...TERMINAL_CAPABILITIES];
    context = {
      principal,
      buildingId: principal.buildingId,
      role: null,
      capabilities,
      actorLabel: principal.label,
      can: (capability) => capabilities.includes(capability),
    };
  } else {
    const memberships = await listMemberships(principal.userId);
    const membership = options.buildingSlug ? memberships.find((m) => m.buildingSlug === options.buildingSlug) : memberships[0];

    if (!membership) {
      if (principal.isPlatformAdmin && options.buildingSlug) {
        const [building] = await db.select().from(buildings).where(eq(buildings.slug, options.buildingSlug)).limit(1);
        if (!building) throw new HttpError(404, "Immeuble introuvable");
        const capabilities = buildCapabilities("platform_admin", true);
        context = {
          principal,
          buildingId: building.id,
          role: "platform_admin",
          capabilities,
          actorLabel: principal.fullName || principal.email,
          can: (capability) => capabilities.includes(capability),
        };
        if (options.require && !context.can(options.require)) throw new HttpError(403, "Droits insuffisants");
        return context;
      }
      throw new HttpError(403, "Aucun accès à cet immeuble");
    }

    const capabilities = buildCapabilities(membership.role, principal.isPlatformAdmin);
    context = {
      principal,
      buildingId: membership.buildingId,
      role: membership.role,
      capabilities,
      actorLabel: principal.fullName || principal.email,
      can: (capability) => capabilities.includes(capability),
    };
  }

  if (options.require && !context.can(options.require)) throw new HttpError(403, "Droits insuffisants");
  return context;
};

/** Vérifie si un compte connecté est Référent CoproLink actif pour l'immeuble. */
export const isActiveCoproLinkReferent = async (buildingId: number, userId: string) => {
  const [row] = await db.select({ id: buildingReferents.id })
    .from(buildingReferents)
    .innerJoin(buildingPeople, eq(buildingReferents.personId, buildingPeople.id))
    .where(and(
      eq(buildingReferents.buildingId, buildingId),
      eq(buildingPeople.buildingId, buildingId),
      eq(buildingPeople.userId, userId),
      isNull(buildingReferents.endedAt),
    )).limit(1);
  return Boolean(row);
};

/**
 * Lecture de gouvernance : syndic (ou administrateur plateforme) OU Référent
 * CoproLink actif de l'immeuble. Le référent obtient uniquement la capacité
 * `governance:read` ; il ne reçoit jamais `members:manage` ni aucune capacité
 * d'écriture administrative. Les écritures passent par `authorizeSyndicOperator`.
 */
export const authorizeCoproLinkAdmin = async (req: Request, buildingSlug?: string | null): Promise<AuthContext> => {
  const ctx = await authorize(req, { buildingSlug, require: "building:read" });
  if (ctx.principal.kind !== "user") throw new HttpError(403, "Gouvernance CoproLink réservée au syndic et aux référents");

  const withGovernance = (base: AuthContext): AuthContext => {
    const capabilities = Array.from(new Set([...base.capabilities, "governance:read"]));
    return { ...base, capabilities, can: (capability) => capabilities.includes(capability) };
  };

  if (ctx.principal.isPlatformAdmin || ctx.role === "manager") return withGovernance(ctx);

  const isReferent = await isActiveCoproLinkReferent(ctx.buildingId, ctx.principal.userId);
  if (!isReferent) throw new HttpError(403, "Gouvernance CoproLink réservée au syndic et aux référents");
  return withGovernance(ctx);
};

/**
 * Le syndic est l'opérateur administratif de l'immeuble : il alimente les lots,
 * les personnes et les accès. Les Référents CoproLink conservent une vue de
 * gouvernance mais ne remplacent pas le syndic pour ces écritures.
 */
export const authorizeSyndicOperator = async (req: Request, buildingSlug?: string | null): Promise<AuthContext> => {
  const ctx = await authorize(req, { buildingSlug, require: "building:read" });
  if (ctx.principal.kind !== "user") throw new HttpError(403, "Compte syndic requis");
  if (ctx.principal.isPlatformAdmin || ctx.role === "manager") return ctx;
  throw new HttpError(403, "Cette action est réservée au syndic ou à un administrateur plateforme");
};

export const requireUser = async (req: Request): Promise<UserPrincipal> => {
  const principal = await resolvePrincipal(req);
  if (!principal) throw new HttpError(401, "Authentification requise");
  if (principal.kind !== "user") throw new HttpError(403, "Un jeton de terminal ne peut pas accéder à cette ressource");
  return principal;
};

export const readBuildingSlug = (req: Request) => new URL(req.url).searchParams.get("building");
