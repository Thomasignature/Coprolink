import type { Config, Context } from "@netlify/functions";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../../db/index.js";
import { buildingMembers, ROLES, users, type Role } from "../../db/schema.js";
import { authorize, HttpError, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { findAccountByEmail, inviteAccount, listActivationStates } from "../lib/identity.mts";
import { readString, writeAudit } from "../lib/data.mts";

/**
 * Gestion des appartenances à un immeuble — c'est ici que les rôles réels sont
 * attribués. Réservé à `members:manage` (gestionnaire).
 *
 * Le POST est volontairement une action unique pour le syndic : il crée le
 * compte Netlify Identity si l'adresse n'en a pas encore, déclenche l'e-mail
 * d'activation, et accorde le rôle sur l'immeuble. Rien à faire dans le tableau
 * de bord Netlify.
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
          userId: buildingMembers.userId,
          email: users.email,
          fullName: users.fullName,
          role: buildingMembers.role,
          unitLabel: buildingMembers.unitLabel,
          shareLabel: buildingMembers.shareLabel,
        })
        .from(buildingMembers)
        .innerJoin(users, eq(buildingMembers.userId, users.id))
        .where(eq(buildingMembers.buildingId, ctx.buildingId));

      // L'état d'activation vient d'Identity. S'il est indisponible, la liste
      // reste affichable : `activated` passe à `null` et l'interface n'affiche
      // simplement aucun badge, plutôt que de faire échouer la page entière.
      const activation = await listActivationStates().catch(() => null);

      return Response.json(
        {
          members: rows.map(({ userId, ...member }) => ({
            ...member,
            activated: activation ? (activation.get(userId) ?? false) : null,
          })),
          assignableRoles: ASSIGNABLE_ROLES,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const email = readString(body.email, "e-mail", { max: 200 }).toLowerCase();
      const fullName = readString(body.fullName, "nom", { max: 120, required: false });
      const role = assertAssignableRole(body.role ?? "resident");
      const unitLabel = readString(body.unitLabel, "lot", { max: 80, required: false });
      const shareLabel = readString(body.shareLabel, "quotité", { max: 40, required: false });

      // Un compte existant n'est jamais réinvité : cela enverrait un e-mail
      // d'activation à quelqu'un qui a déjà un mot de passe en cours d'usage.
      const existing = await findAccountByEmail(email);
      const account = existing ?? (await inviteAccount(email, fullName));

      await db
        .insert(users)
        .values({
          id: account.id,
          email: account.email || email,
          fullName: account.fullName || fullName,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: { email: account.email || email },
        });

      const [member] = await db
        .insert(buildingMembers)
        .values({ buildingId: ctx.buildingId, userId: account.id, role, unitLabel, shareLabel })
        .onConflictDoUpdate({
          target: [buildingMembers.buildingId, buildingMembers.userId],
          set: { role, unitLabel, shareLabel },
        })
        .returning();

      await writeAudit(ctx, {
        action: existing ? "member.granted" : "member.invited",
        entityType: "building_member",
        entityId: member.id,
        summary: existing
          ? `Accès « ${role} » accordé à ${email}.`
          : `${email} invité avec le rôle « ${role} ».`,
      });

      return Response.json(
        {
          id: member.id,
          email,
          role: member.role,
          unitLabel: member.unitLabel,
          /** `true` quand un compte vient d'être créé et l'e-mail envoyé. */
          invited: existing === null,
          activated: account.activated,
        },
        { status: 201 },
      );
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

      // Renvoi d'invitation : action distincte du changement de rôle, elle ne
      // touche pas l'appartenance. Sans elle, un e-mail perdu serait une
      // impasse pour le syndic.
      if (body.resendInvite === true) {
        const [account] = await db
          .select({ email: users.email, fullName: users.fullName })
          .from(users)
          .where(eq(users.id, target.userId))
          .limit(1);
        if (!account) throw new HttpError(404, "Compte introuvable");

        const identity = await findAccountByEmail(account.email);
        if (identity?.activated) {
          throw new HttpError(
            409,
            "Ce compte est déjà activé. La personne doit utiliser « Mot de passe oublié » sur l'écran de connexion.",
          );
        }

        await inviteAccount(account.email, account.fullName);
        await writeAudit(ctx, {
          action: "member.reinvited",
          entityType: "building_member",
          entityId: target.id,
          summary: `Invitation renvoyée à ${account.email}.`,
        });

        return Response.json({ id: target.id, email: account.email, invited: true });
      }

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
