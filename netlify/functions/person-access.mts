import type { Config } from "@netlify/functions";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { buildingMembers, buildings, pendingMembers, users } from "../../db/schema.js";
import { buildingPeople, unitPersonRelations, buildingUnits } from "../../db/schema-v3.js";
import { authorizeCoproLinkAdmin, authorizeSyndicOperator, HttpError, jsonError, readBuildingSlug } from "../lib/auth.mts";
import {
  IdentityAdminUnavailableError,
  IdentityEmailTakenError,
  inviteAccount,
  lookupAccountByEmail,
  sendAccountActivationLink,
  type IdentityAccount,
} from "../lib/identity.mts";
import { writeAudit } from "../lib/data.mts";
import { accessGuardMatches, grantOrUpdateMembership } from "../lib/membership-access.mts";

import { correctPersonEmailInTransaction, normalizePersonEmail } from "../lib/person-email.mts";

const findMirroredAccount = async (email: string) => {
  const [row] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  return row ?? null;
};

const mirrorAccount = async (account: IdentityAccount, email: string, fullName: string) => {
  await db.insert(users).values({ id: account.id, email: account.email || email, fullName: account.fullName || fullName })
    .onConflictDoUpdate({ target: users.id, set: { email: account.email || email, fullName: account.fullName || fullName } });
};

const unitForPerson = async (buildingId: number, personId: number) => {
  const [row] = await db.select({ label: buildingUnits.label, shareLabel: unitPersonRelations.shareLabel })
    .from(unitPersonRelations)
    .innerJoin(buildingUnits, eq(unitPersonRelations.unitId, buildingUnits.id))
    .where(and(eq(unitPersonRelations.personId, personId), eq(buildingUnits.buildingId, buildingId), isNull(unitPersonRelations.endDate)))
    .limit(1);
  return row ?? { label: "", shareLabel: "" };
};

export default async (req: Request) => {
  try {
    const buildingSlug = readBuildingSlug(req);
    const ctx = req.method === "GET"
      ? await authorizeCoproLinkAdmin(req, buildingSlug)
      : await authorizeSyndicOperator(req, buildingSlug);
    if (ctx.principal.kind !== "user") throw new HttpError(403, "Compte utilisateur requis");

    if (req.method === "GET") {
      const people = await db.select().from(buildingPeople).where(eq(buildingPeople.buildingId, ctx.buildingId));
      const members = await db.select({ userId: buildingMembers.userId, lastSeenAt: users.lastSeenAt }).from(buildingMembers)
        .innerJoin(users, eq(users.id, buildingMembers.userId))
        .where(and(eq(buildingMembers.buildingId, ctx.buildingId), isNull(buildingMembers.endedAt)));
      const memberStates = new Map(members.map(row => [row.userId, row.lastSeenAt ? "active" : "pending"]));
      const pending = await db.select({ email: pendingMembers.email }).from(pendingMembers).where(eq(pendingMembers.buildingId, ctx.buildingId));
      const pendingEmails = new Set(pending.map((row) => row.email.toLowerCase()));

      return Response.json({
        access: people.map((person) => ({
          personId: person.id,
          state: person.userId && memberStates.has(person.userId)
            ? memberStates.get(person.userId)
            : person.email && pendingEmails.has(person.email.toLowerCase())
              ? "pending"
              : "none",
        })),
      }, { headers: { "cache-control": "no-store" } });
    }

    if (req.method !== "POST" && req.method !== "PATCH") return Response.json({ error: "Méthode non autorisée" }, { status: 405 });

    const actorUserId = ctx.principal.userId;
    const body = await req.json().catch(() => ({}));
    const personId = Number(body.personId);
    if (!Number.isInteger(personId) || personId <= 0) throw new HttpError(422, "Personne invalide");

    if (req.method === "PATCH") {
      const email = normalizePersonEmail(body.email);
      const result = await db.transaction(tx => correctPersonEmailInTransaction(tx, ctx, personId, email, body.previousEmail));
      return Response.json(result);
    }

    const [person] = await db.select().from(buildingPeople)
      .where(and(eq(buildingPeople.id, personId), eq(buildingPeople.buildingId, ctx.buildingId))).limit(1);
    if (!person) throw new HttpError(404, "Personne introuvable");

    const email = normalizePersonEmail(person.email);

    const unit = await unitForPerson(ctx.buildingId, person.id);
    const membership = { role: "resident" as const, unitLabel: unit.label || "", shareLabel: unit.shareLabel || "" };

    const mirrored = await findMirroredAccount(email);
    const lookup = mirrored ? { account: null, unavailable: null } : await lookupAccountByEmail(email);
    let account: IdentityAccount | null = mirrored
      ? { id: mirrored.id, email: mirrored.email, fullName: mirrored.fullName, activated: mirrored.lastSeenAt !== null }
      : lookup.account;
    let invited = false;

    if (!account) {
      try {
        account = await inviteAccount(email, person.fullName);
        invited = true;
      } catch (error) {
        if (!(error instanceof IdentityEmailTakenError) && !(error instanceof IdentityAdminUnavailableError)) throw error;
      }
    }

    if (!account) {
      const pending = await db.transaction(async tx => {
        await tx.execute(sql`select ${buildings.id} from ${buildings} where ${buildings.id} = ${ctx.buildingId} for update`);
        if (!await accessGuardMatches(tx, ctx.buildingId, { person: { id: person.id, email } })) {
          throw new HttpError(409, "L’adresse a changé. Actualisez la page avant de réinviter.");
        }
        const [prepared] = await tx.insert(pendingMembers).values({
          buildingId: ctx.buildingId,
          email,
          fullName: person.fullName,
          role: membership.role,
          unitLabel: membership.unitLabel,
          shareLabel: membership.shareLabel,
          invitationSent: false,
          invitedByUserId: actorUserId,
        }).onConflictDoUpdate({
          target: [pendingMembers.buildingId, pendingMembers.email],
          set: { fullName: person.fullName, role: membership.role, unitLabel: membership.unitLabel, shareLabel: membership.shareLabel },
        }).returning();
        return prepared;
      });

      await writeAudit(ctx, {
        action: "access.prepared",
        entityType: "building_person",
        entityId: person.id,
        summary: `Accès CoproLink préparé pour ${email}.`,
      });
      return Response.json({ state: "pending", pendingId: pending.id, invited: false, message: `Accès préparé pour ${email}, mais aucun e-mail n’a pu être confirmé. Réessayez avec « Renvoyer l’invitation ».` }, { status: 202 });
    }

    await mirrorAccount(account, email, person.fullName);
    const access = await grantOrUpdateMembership(ctx.buildingId, account.id, membership, { person: { id: person.id, email }, preserveRole: true });
    if (access.blocked) throw new HttpError(409, "Impossible de remplacer le dernier gestionnaire par un accès copropriétaire");
    if (!access.member) throw new HttpError(409, "L’adresse a changé. L’ancien accès n’a pas été réactivé. Actualisez la page avant de réinviter.");

    if (!invited && !account.activated) {
      try {
        await sendAccountActivationLink(email);
        invited = true;
      } catch {
        throw new HttpError(502, "Accès préparé, mais le lien d’activation n’a pas pu être envoyé. Réessayez avec « Renvoyer l’invitation ».");
      }
    }

    await writeAudit(ctx, {
      action: invited ? "access.invited" : "access.granted",
      entityType: "building_person",
      entityId: person.id,
      summary: invited ? `Invitation CoproLink envoyée à ${email}.` : `Accès CoproLink accordé à ${email}.`,
    });

    return Response.json({
      state: account.activated ? "active" : "pending",
      invited,
      message: invited
        ? `Invitation CoproLink envoyée à ${email}.`
        : account.activated
          ? `${email} a maintenant accès à CoproLink.`
          : `Accès préparé pour ${email}. Le compte doit encore être activé.`,
    }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = {
  path: "/api/person-access",
};
