import type { Config, Context } from "@netlify/functions";
import { admin } from "@netlify/identity";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../../db/index.js";
import { buildingMembers, ROLES, users, type Role } from "../../db/schema.js";
import { authorize, HttpError, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { readString, writeAudit } from "../lib/data.mts";

/**
 * Gestion des appartenances à un immeuble — c'est ici que les rôles réels sont
 * attribués. Réservé à `members:manage` (gestionnaire).
 *
 * `platform_admin` n'est volontairement PAS attribuable ici : ce rôle vit dans
 * `app_metadata.roles` de Netlify Identity et se règle depuis l'interface
 * Netlify, afin qu'un gestionnaire ne puisse pas s'octroyer un accès plateforme.
 */
const ASSIGNABLE_ROLES: readonly Role[] = ROLES.filter((r) => r !== "platform_admin");

const assertAssignableRole = (value: unknown): Role => {
  if (typeof value !== "string" || !ASSIGNABLE_ROLES.includes(value as Role)) {
    throw new HttpError(422, `Rôle attendu parmi : ${ASSIGNABLE_ROLES.join(", ")}`);
  }
  return value as Role;
};

/** Retrouve un compte Identity par e-mail. L'utilisateur doit déjà être invité. */
const findIdentityUserByEmail = async (email: string) => {
  const needle = email.toLowerCase();
  for (let page = 1; page <= 10; page += 1) {
    const batch = await admin.listUsers({ page, perPage: 100 });
    if (!batch || batch.length === 0) return null;
    const match = batch.find((u) => (u.email ?? "").toLowerCase() === needle);
    if (match) return match;
    if (batch.length < 100) return null;
  }
  return null;
};

const countManagers = async (buildingId: number, excludeMemberId?: number) => {
  const rows = await db
    .select({ id: buildingMembers.id })
    .from(buildingMembers)
    .where(
      excludeMemberId
        ? and(
            eq(buildingMembers.buildingId, buildingId),
            eq(buildingMembers.role, "manager"),
            ne(buildingMembers.id, excludeMemberId),
          )
        : and(eq(buildingMembers.buildingId, buildingId), eq(buildingMembers.role, "manager")),
    );
  return rows.length;
};

export default async (req: Request, context: Context) => {
  try {
    const ctx = await authorize(req, {
      buildingSlug: readBuildingSlug(req),
      require: "members:manage",
    });

    if (req.method === "GET") {
      const rows = await db
        .select({
          id: buildingMembers.id,
          email: users.email,
          fullName: users.fullName,
          role: buildingMembers.role,
          unitLabel: buildingMembers.unitLabel,
          shareLabel: buildingMembers.shareLabel,
        })
        .from(buildingMembers)
        .innerJoin(users, eq(buildingMembers.userId, users.id))
        .where(eq(buildingMembers.buildingId, ctx.buildingId));

      return Response.json({ members: rows, assignableRoles: ASSIGNABLE_ROLES }, {
        headers: { "cache-control": "no-store" },
      });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const email = readString(body.email, "e-mail", { max: 200 }).toLowerCase();
      const role = assertAssignableRole(body.role ?? "resident");
      const unitLabel = readString(body.unitLabel, "lot", { max: 80, required: false });
      const shareLabel = readString(body.shareLabel, "quotité", { max: 40, required: false });

      const identityUser = await findIdentityUserByEmail(email);
      if (!identityUser) {
        throw new HttpError(
          404,
          "Aucun compte Netlify Identity pour cet e-mail. Invitez d'abord la personne depuis l'onglet Identity de Netlify.",
        );
      }

      await db
        .insert(users)
        .values({
          id: identityUser.id,
          email: identityUser.email ?? email,
          fullName: identityUser.name ?? (identityUser.userMetadata?.full_name as string | undefined) ?? "",
        })
        .onConflictDoUpdate({ target: users.id, set: { email: identityUser.email ?? email } });

      const [member] = await db
        .insert(buildingMembers)
        .values({ buildingId: ctx.buildingId, userId: identityUser.id, role, unitLabel, shareLabel })
        .onConflictDoUpdate({
          target: [buildingMembers.buildingId, buildingMembers.userId],
          set: { role, unitLabel, shareLabel },
        })
        .returning();

      await writeAudit(ctx, {
        action: "member.granted",
        entityType: "building_member",
        entityId: member.id,
        summary: `Accès « ${role} » accordé à ${email}.`,
      });

      return Response.json({ id: member.id, email, role: member.role, unitLabel: member.unitLabel }, { status: 201 });
    }

    const memberId = Number(context.params.id);
    if (!Number.isInteger(memberId)) {
      return Response.json({ error: "Identifiant de membre invalide" }, { status: 400 });
    }

    const scope = and(eq(buildingMembers.id, memberId), eq(buildingMembers.buildingId, ctx.buildingId));
    const [target] = await db.select().from(buildingMembers).where(scope).limit(1);
    if (!target) return Response.json({ error: "Membre introuvable" }, { status: 404 });

    if (req.method === "PATCH") {
      const body = await req.json().catch(() => ({}));
      const role = assertAssignableRole(body.role ?? target.role);

      // Garde-fou : ne jamais laisser un immeuble sans gestionnaire.
      if (target.role === "manager" && role !== "manager" && (await countManagers(ctx.buildingId, memberId)) === 0) {
        throw new HttpError(409, "Impossible de retirer le dernier gestionnaire de l'immeuble");
      }

      const [updated] = await db
        .update(buildingMembers)
        .set({
          role,
          unitLabel: readString(body.unitLabel, "lot", { max: 80, required: false }) || target.unitLabel,
          shareLabel: readString(body.shareLabel, "quotité", { max: 40, required: false }) || target.shareLabel,
        })
        .where(scope)
        .returning();

      await writeAudit(ctx, {
        action: "member.updated",
        entityType: "building_member",
        entityId: updated.id,
        summary: `Rôle du membre #${updated.id} défini à « ${updated.role} ».`,
      });

      return Response.json({ id: updated.id, role: updated.role, unitLabel: updated.unitLabel });
    }

    if (req.method === "DELETE") {
      if (target.role === "manager" && (await countManagers(ctx.buildingId, memberId)) === 0) {
        throw new HttpError(409, "Impossible de retirer le dernier gestionnaire de l'immeuble");
      }

      await db.delete(buildingMembers).where(scope);
      await writeAudit(ctx, {
        action: "member.revoked",
        entityType: "building_member",
        entityId: memberId,
        summary: `Accès du membre #${memberId} retiré.`,
      });

      return Response.json({ id: memberId, removed: true });
    }

    return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = {
  path: ["/api/members", "/api/members/:id"],
  method: ["GET", "POST", "PATCH", "DELETE"],
};
