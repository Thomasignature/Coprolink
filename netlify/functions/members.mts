import type { Config, Context } from "@netlify/functions";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { buildingMembers, pendingMembers, ROLES, users, type Role } from "../../db/schema.js";
import { authorize, HttpError, jsonError, readBuildingSlug } from "../lib/auth.mts";
import {
  IdentityAdminUnavailableError,
  IdentityEmailTakenError,
  inviteAccount,
  listActivationStates,
  lookupAccountByEmail,
  type IdentityAccount,
} from "../lib/identity.mts";
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
 * Si la création de compte est momentanément impossible (Identity pas encore
 * actif sur le déploiement, jeton opérateur absent, endpoint injoignable),
 * la demande n'est pas perdue pour autant : l'appartenance est enregistrée
 * comme invitation en attente (`pending_members`) et devient réelle à la
 * première connexion de cette adresse. Le syndic garde donc une seule
 * manipulation à faire, quel que soit l'état d'Identity.
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

/** Compte déjà connu de l'application : il s'est connecté au moins une fois. */
const findMirroredAccount = async (email: string) => {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  return row ?? null;
};

const mirrorAccount = async (account: IdentityAccount, fallbackEmail: string, fallbackName: string) =>
  db
    .insert(users)
    .values({
      id: account.id,
      email: account.email || fallbackEmail,
      fullName: account.fullName || fallbackName,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: account.email || fallbackEmail },
    });

/** Accorde (ou met à jour) l'appartenance et consomme l'invitation en attente. */
const grantMembership = async (
  buildingId: number,
  email: string,
  account: IdentityAccount,
  input: { role: Role; unitLabel: string; shareLabel: string },
) => {
  const [member] = await db
    .insert(buildingMembers)
    .values({ buildingId, userId: account.id, ...input })
    .onConflictDoUpdate({
      target: [buildingMembers.buildingId, buildingMembers.userId],
      set: input,
    })
    .returning();

  await db
    .delete(pendingMembers)
    .where(and(eq(pendingMembers.buildingId, buildingId), eq(pendingMembers.email, email)));

  return member;
};

/**
 * Message destiné au syndic quand Identity ne peut pas créer le compte.
 * La raison technique est journalisée, pas affichée : ce qui compte pour lui,
 * c'est que la demande est enregistrée et ce qu'il reste à faire.
 */
const pendingNotice = (email: string) =>
  `${email} est enregistré comme copropriétaire en attente. L'accès s'activera automatiquement ` +
  `dès sa première connexion avec cette adresse (bouton « Créer un compte » sur l'écran de connexion). ` +
  `Vous pouvez aussi relancer l'envoi de l'invitation depuis la liste d'attente.`;

export default async (req: Request, context: Context) => {
  try {
    const ctx = await authorize(req, {
      buildingSlug: readBuildingSlug(req),
      require: "members:manage",
    });

    /* ---------------------------------------------------------------- *
     * Invitations en attente : /api/members/pending/:pendingId
     * ---------------------------------------------------------------- */
    if (context.params.pendingId !== undefined) {
      const pendingId = Number(context.params.pendingId);
      if (!Number.isInteger(pendingId)) {
        return Response.json({ error: "Identifiant d'invitation invalide" }, { status: 400 });
      }

      const scope = and(eq(pendingMembers.id, pendingId), eq(pendingMembers.buildingId, ctx.buildingId));
      const [pending] = await db.select().from(pendingMembers).where(scope).limit(1);
      if (!pending) return Response.json({ error: "Invitation introuvable" }, { status: 404 });

      if (req.method === "DELETE") {
        await db.delete(pendingMembers).where(scope);
        await writeAudit(ctx, {
          action: "member.pending_cancelled",
          entityType: "pending_member",
          entityId: pending.id,
          summary: `Invitation en attente de ${pending.email} annulée.`,
        });
        return Response.json({ id: pending.id, removed: true });
      }

      if (req.method === "PATCH") {
        // Relance : nouvelle tentative de création du compte Identity. Dès
        // qu'elle aboutit, l'attente devient une appartenance réelle.
        try {
          const account = await inviteAccount(pending.email, pending.fullName);
          await mirrorAccount(account, pending.email, pending.fullName);
          const member = await grantMembership(ctx.buildingId, pending.email, account, {
            role: assertAssignableRole(pending.role),
            unitLabel: pending.unitLabel,
            shareLabel: pending.shareLabel,
          });

          await writeAudit(ctx, {
            action: "member.invited",
            entityType: "building_member",
            entityId: member.id,
            summary: `${pending.email} invité avec le rôle « ${member.role} ».`,
          });

          return Response.json({
            id: member.id,
            email: pending.email,
            role: member.role,
            invited: true,
            pending: false,
            message: `Invitation envoyée à ${pending.email}.`,
          });
        } catch (error) {
          if (error instanceof IdentityEmailTakenError) {
            // Le compte existe déjà : l'attente reste valable, elle sera
            // consommée à la prochaine connexion de cette adresse.
            const { account } = await lookupAccountByEmail(pending.email);
            if (!account) {
              return Response.json({
                id: pending.id,
                email: pending.email,
                pending: true,
                message:
                  `Un compte existe déjà pour ${pending.email} : son accès s'activera ` +
                  `à sa prochaine connexion, aucune action supplémentaire n'est nécessaire.`,
              });
            }

            await mirrorAccount(account, pending.email, pending.fullName);
            const member = await grantMembership(ctx.buildingId, pending.email, account, {
              role: assertAssignableRole(pending.role),
              unitLabel: pending.unitLabel,
              shareLabel: pending.shareLabel,
            });
            await writeAudit(ctx, {
              action: "member.granted",
              entityType: "building_member",
              entityId: member.id,
              summary: `Accès « ${member.role} » accordé à ${pending.email}.`,
            });
            return Response.json({
              id: member.id,
              email: pending.email,
              role: member.role,
              invited: false,
              pending: false,
              message: `Accès accordé à ${pending.email}.`,
            });
          }

          if (error instanceof IdentityAdminUnavailableError) {
            console.error("Relance d'invitation impossible:", error.message);
            throw new HttpError(
              503,
              `L'envoi d'e-mails d'invitation n'est pas disponible pour le moment. ${pendingNotice(pending.email)}`,
            );
          }
          throw error;
        }
      }

      return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
    }

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

      const waiting = await db
        .select()
        .from(pendingMembers)
        .where(eq(pendingMembers.buildingId, ctx.buildingId));

      // L'état d'activation vient d'Identity. S'il est indisponible, la liste
      // reste affichable : `activated` passe à `null` et l'interface n'affiche
      // simplement aucun badge, plutôt que de faire échouer la page entière.
      // Le même appel renseigne l'interface sur la disponibilité de l'envoi
      // automatique d'invitations, afin qu'elle explique la bonne marche à suivre.
      const activation = await listActivationStates().catch((error) => {
        console.error("État d'activation Identity indisponible:", error);
        return null;
      });

      return Response.json(
        {
          members: rows.map(({ userId, ...member }) => ({
            ...member,
            activated: activation ? (activation.get(userId) ?? false) : null,
          })),
          pendingMembers: waiting.map((row) => ({
            id: row.id,
            email: row.email,
            fullName: row.fullName,
            role: row.role,
            unitLabel: row.unitLabel,
            invitationSent: row.invitationSent,
            createdAt: row.createdAt.toISOString(),
          })),
          assignableRoles: ASSIGNABLE_ROLES,
          /** `false` = les comptes ne peuvent pas être créés depuis l'application. */
          identityAdminAvailable: activation !== null,
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
      const membership = { role, unitLabel, shareLabel };

      // 1. Compte déjà présent dans le miroir local : aucun appel à Identity
      //    n'est nécessaire, et l'ajout fonctionne même si son API est en panne.
      const mirrored = await findMirroredAccount(email);

      // 2. Sinon, compte Identity existant ? La recherche est tolérante : son
      //    indisponibilité ne doit pas faire échouer la demande du syndic.
      const lookup = mirrored ? { account: null, unavailable: null } : await lookupAccountByEmail(email);

      let account: IdentityAccount | null = mirrored
        ? {
            id: mirrored.id,
            email: mirrored.email,
            fullName: mirrored.fullName,
            // `last_seen_at` n'est écrit qu'après une requête authentifiée :
            // c'est la preuve locale que le compte est bien activé.
            activated: mirrored.lastSeenAt !== null,
          }
        : lookup.account;
      let identityFailure = lookup.unavailable;
      let invited = false;

      // 3. Aucun compte connu : on le crée et l'invitation part par e-mail.
      //    Un compte existant n'est jamais réinvité — cela enverrait un e-mail
      //    d'activation à quelqu'un qui a déjà un mot de passe en usage.
      if (!account) {
        try {
          account = await inviteAccount(email, fullName);
          invited = true;
        } catch (error) {
          if (error instanceof IdentityEmailTakenError) {
            identityFailure = identityFailure ?? "compte existant mais non relisible";
          } else if (error instanceof IdentityAdminUnavailableError) {
            identityFailure = error.detail;
          } else {
            throw error;
          }
        }
      }

      // 4. Repli : la décision du syndic est enregistrée et s'appliquera à la
      //    première connexion de cette adresse.
      if (!account) {
        console.error(`Création de compte Identity impossible pour ${email}: ${identityFailure}`);

        const [pending] = await db
          .insert(pendingMembers)
          .values({
            buildingId: ctx.buildingId,
            email,
            fullName,
            invitationSent: false,
            invitedByUserId: ctx.principal.kind === "user" ? ctx.principal.userId : null,
            ...membership,
          })
          .onConflictDoUpdate({
            target: [pendingMembers.buildingId, pendingMembers.email],
            set: { ...membership, fullName },
          })
          .returning();

        await writeAudit(ctx, {
          action: "member.pending",
          entityType: "pending_member",
          entityId: pending.id,
          summary: `${email} placé en attente avec le rôle « ${role} » (compte Identity à créer).`,
        });

        return Response.json(
          {
            pendingId: pending.id,
            email,
            role: pending.role,
            unitLabel: pending.unitLabel,
            pending: true,
            invited: false,
            message: pendingNotice(email),
          },
          { status: 202 },
        );
      }

      await mirrorAccount(account, email, fullName);
      const member = await grantMembership(ctx.buildingId, email, account, membership);

      await writeAudit(ctx, {
        action: invited ? "member.invited" : "member.granted",
        entityType: "building_member",
        entityId: member.id,
        summary: invited
          ? `${email} invité avec le rôle « ${role} ».`
          : `Accès « ${role} » accordé à ${email}.`,
      });

      return Response.json(
        {
          id: member.id,
          email,
          role: member.role,
          unitLabel: member.unitLabel,
          /** `true` quand un compte vient d'être créé et l'e-mail envoyé. */
          invited,
          pending: false,
          activated: account.activated,
          message: invited
            ? `Invitation envoyée à ${email}. La personne choisira son mot de passe depuis le lien reçu.`
            : `Accès accordé à ${email}.`,
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

        const { account: identity } = await lookupAccountByEmail(account.email);
        if (identity?.activated) {
          throw new HttpError(
            409,
            "Ce compte est déjà activé. La personne doit utiliser « Mot de passe oublié » sur l'écran de connexion.",
          );
        }

        try {
          await inviteAccount(account.email, account.fullName);
        } catch (error) {
          if (error instanceof IdentityEmailTakenError) {
            throw new HttpError(
              409,
              "Ce compte est déjà activé. La personne doit utiliser « Mot de passe oublié » sur l'écran de connexion.",
            );
          }
          if (error instanceof IdentityAdminUnavailableError) {
            console.error("Renvoi d'invitation impossible:", error.message);
            throw new HttpError(
              503,
              "L'envoi d'e-mails d'invitation n'est pas disponible pour le moment. " +
                "La personne peut se connecter avec « Mot de passe oublié » pour recevoir un lien.",
            );
          }
          throw error;
        }

        await writeAudit(ctx, {
          action: "member.reinvited",
          entityType: "building_member",
          entityId: target.id,
          summary: `Invitation renvoyée à ${account.email}.`,
        });

        return Response.json({
          id: target.id,
          email: account.email,
          invited: true,
          message: `Invitation renvoyée à ${account.email}.`,
        });
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
  path: ["/api/members", "/api/members/pending/:pendingId", "/api/members/:id"],
  method: ["GET", "POST", "PATCH", "DELETE"],
};
