import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getUser } from "@netlify/identity";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { auditLog, buildingMembers, buildings, pendingMembers, terminals, users, type Role } from "../../db/schema.js";

/**
 * Autorisation côté serveur.
 *
 * Règles non négociables appliquées par ce module :
 *  1. Le rôle n'est JAMAIS lu depuis la requête. Il est résolu depuis
 *     `building_members` (par immeuble) ou depuis `app_metadata.roles`
 *     d'Identity (pour `platform_admin` uniquement).
 *  2. Un jeton de terminal ne donne accès qu'aux données publiques d'un seul
 *     immeuble et ne peut modifier aucun enregistrement existant.
 *  3. Toute requête est cantonnée à l'immeuble sur lequel l'appelant a une
 *     appartenance vérifiée.
 */

export const TERMINAL_HEADER = "x-terminal-token";

/** Capacités accordées à un rôle d'immeuble. Aucune n'est cumulable implicitement. */
const ROLE_CAPABILITIES: Record<Role, readonly string[]> = {
  resident: ["building:read", "tickets:read:own", "tickets:create", "documents:read:private", "finance:read:own"],
  council_member: [
    "building:read", "tickets:read:own", "tickets:read:all", "tickets:create",
    "documents:read:private", "finance:read:own", "audit:read",
  ],
  manager: [
    "building:read", "tickets:read:own", "tickets:read:all", "tickets:create", "tickets:update",
    "documents:read:private", "documents:manage", "announcements:manage", "events:manage",
    "audit:read", "terminals:manage", "members:manage",
  ],
  // `platform_admin` ne dépend pas d'un immeuble : il est résolu via Identity.
  platform_admin: [
    "building:read", "tickets:read:own", "tickets:read:all", "tickets:create", "tickets:update",
    "documents:read:private", "documents:manage", "announcements:manage", "events:manage",
    "audit:read", "terminals:manage", "members:manage", "platform:admin",
  ],
};

/** Un jeton de terminal ne reçoit jamais autre chose que ceci. */
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

/** Contexte d'autorisation résolu pour une requête et un immeuble donnés. */
export type AuthContext = {
  principal: Principal;
  buildingId: number;
  /** Rôle effectif dans cet immeuble. `null` pour un terminal. */
  role: Role | null;
  capabilities: readonly string[];
  /** Libellé d'auteur pour le journal d'audit. Non nominatif pour un terminal. */
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
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
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
 * Transforme en appartenances réelles les invitations préparées par le syndic
 * pour cette adresse e-mail.
 *
 * Le syndic décide de l'accès avant que le compte n'existe (voir
 * `pending_members`). La conversion a lieu ici, à la première requête
 * authentifiée : Identity a alors vérifié l'adresse, donc seule la personne qui
 * contrôle la boîte peut réclamer l'accès. Le rôle n'est jamais lu depuis la
 * requête — il vient de la ligne écrite par le gestionnaire.
 */
const claimPendingMemberships = async (userId: string, email: string) => {
  const needle = email.trim().toLowerCase();
  if (!needle) return;

  const pending = await db.select().from(pendingMembers).where(eq(pendingMembers.email, needle));
  if (pending.length === 0) return;

  for (const row of pending) {
    await db
      .insert(buildingMembers)
      .values({
        buildingId: row.buildingId,
        userId,
        role: row.role,
        unitLabel: row.unitLabel,
        shareLabel: row.shareLabel,
      })
      // Une appartenance déjà accordée par ailleurs a la priorité : l'invitation
      // en attente est alors simplement consommée.
      .onConflictDoNothing({ target: [buildingMembers.buildingId, buildingMembers.userId] });

    await db.insert(auditLog).values({
      buildingId: row.buildingId,
      actorUserId: userId,
      actorLabel: needle,
      actorRole: row.role,
      action: "member.claimed",
      entityType: "building_member",
      entityId: "",
      summary: `${needle} a activé l'accès « ${row.role} » préparé par le gestionnaire.`,
    });
  }

  await db.delete(pendingMembers).where(inArray(pendingMembers.id, pending.map((row) => row.id)));
};

/**
 * Résout le porteur de la requête. Un jeton de terminal valide est prioritaire
 * sur une éventuelle session utilisateur : une tablette de hall ne doit jamais
 * hériter des droits d'un compte resté connecté sur l'appareil.
 */
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
  const fullName =
    identityUser.name ??
    (identityUser.userMetadata?.full_name as string | undefined) ??
    email.split("@")[0] ??
    "";

  // Miroir local du compte Identity : cible de clé étrangère et profil métier.
  await db
    .insert(users)
    .values({ id: identityUser.id, email, fullName, lastSeenAt: new Date() })
    .onConflictDoUpdate({
      target: users.id,
      set: { email, fullName, lastSeenAt: new Date() },
    });

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
  const [row] = await db
    .select()
    .from(terminals)
    .where(and(eq(terminals.tokenHash, candidateHash), isNull(terminals.revokedAt)))
    .limit(1);

  if (!row) return null;

  // Comparaison à temps constant par principe, même si la recherche est indexée.
  const expected = Buffer.from(row.tokenHash, "utf8");
  const provided = Buffer.from(candidateHash, "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

  await db.update(terminals).set({ lastSeenAt: new Date() }).where(eq(terminals.id, row.id));

  return {
    kind: "terminal",
    terminalId: row.id,
    buildingId: row.buildingId,
    label: row.label,
    canReport: row.canReport,
  };
};

/** Toutes les appartenances de l'utilisateur, avec l'immeuble joint. */
export const listMemberships = async (userId: string): Promise<Membership[]> => {
  const rows = await db
    .select({
      buildingId: buildings.id,
      buildingSlug: buildings.slug,
      buildingName: buildings.name,
      role: buildingMembers.role,
      unitLabel: buildingMembers.unitLabel,
      shareLabel: buildingMembers.shareLabel,
    })
    .from(buildingMembers)
    .innerJoin(buildings, eq(buildingMembers.buildingId, buildings.id))
    .where(eq(buildingMembers.userId, userId));

  return rows.map((r) => ({ ...r, role: r.role as Role }));
};

const buildCapabilities = (role: Role | null, isPlatformAdmin: boolean): readonly string[] => {
  const fromRole = role ? ROLE_CAPABILITIES[role] ?? [] : [];
  if (!isPlatformAdmin) return fromRole;
  return Array.from(new Set([...fromRole, ...ROLE_CAPABILITIES.platform_admin]));
};

/**
 * Point d'entrée unique de l'autorisation.
 *
 * `buildingSelector` est le slug demandé par le client. Il n'est utilisé que
 * pour SÉLECTIONNER parmi les appartenances vérifiées — jamais pour accorder
 * un accès. Un terminal ignore ce paramètre et reste sur son immeuble.
 */
export const authorize = async (
  req: Request,
  options: { buildingSlug?: string | null; require?: string } = {},
): Promise<AuthContext> => {
  const principal = await resolvePrincipal(req);
  if (!principal) throw new HttpError(401, "Authentification requise");

  let context: AuthContext;

  if (principal.kind === "terminal") {
    const capabilities = principal.canReport
      ? [...TERMINAL_CAPABILITIES, TERMINAL_REPORT_CAPABILITY]
      : [...TERMINAL_CAPABILITIES];

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
    const membership = options.buildingSlug
      ? memberships.find((m) => m.buildingSlug === options.buildingSlug)
      : memberships[0];

    if (!membership) {
      // Un platform_admin sans appartenance peut cibler un immeuble explicitement.
      if (principal.isPlatformAdmin && options.buildingSlug) {
        const [building] = await db
          .select()
          .from(buildings)
          .where(eq(buildings.slug, options.buildingSlug))
          .limit(1);
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
        if (options.require && !context.can(options.require)) {
          throw new HttpError(403, "Droits insuffisants");
        }
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

  if (options.require && !context.can(options.require)) {
    throw new HttpError(403, "Droits insuffisants");
  }

  return context;
};

/** Variante pour les endpoints qui n'ont pas d'immeuble en paramètre. */
export const requireUser = async (req: Request): Promise<UserPrincipal> => {
  const principal = await resolvePrincipal(req);
  if (!principal) throw new HttpError(401, "Authentification requise");
  if (principal.kind !== "user") throw new HttpError(403, "Un jeton de terminal ne peut pas accéder à cette ressource");
  return principal;
};

export const readBuildingSlug = (req: Request) =>
  new URL(req.url).searchParams.get("building");
