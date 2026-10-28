import type { Config } from "@netlify/functions";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { buildingMembers, pendingMembers, users, buildings } from "../../db/schema.js";
import { buildingPeople, unitPersonRelations, buildingUnits } from "../../db/schema-v3.js";
import { authorizeCoproLinkAdmin, authorizeSyndicOperator, HttpError, jsonError, linkBuildingPersonAccount, readBuildingSlug } from "../lib/auth.mts";
import {
  IdentityAdminUnavailableError,
  IdentityEmailTakenError,
  IdentityRateLimitError,
  findAccountByEmail,
  inviteAccount,
  sendAccountActivationLink,
  type IdentityAccount,
} from "../lib/identity.mts";
import { writeAudit } from "../lib/data.mts";
import { deliverPersonInvitation } from "../lib/person-invitation.mts";

const mirrorAccount = async (account: IdentityAccount, email: string, fullName: string, executor: Pick<typeof db, "insert"> = db) => {
  await executor.insert(users).values({ id: account.id, email: account.email || email, fullName: account.fullName || fullName })
    .onConflictDoUpdate({ target: users.id, set: { email: account.email || email, fullName: account.fullName || fullName } });
};

const activeUnitsForPerson = async (tx: Pick<typeof db, "select">, buildingId: number, personId: number) => {
  const rows = await tx.select({ label: buildingUnits.label, shareLabel: unitPersonRelations.shareLabel })
    .from(unitPersonRelations).innerJoin(buildingUnits, eq(unitPersonRelations.unitId, buildingUnits.id))
    .where(and(eq(unitPersonRelations.personId, personId), eq(buildingUnits.buildingId, buildingId), isNull(unitPersonRelations.endDate)))
    .orderBy(buildingUnits.label, unitPersonRelations.id);
  if (!rows.length) throw new HttpError(409, "Aucune relation active. Ajoutez une nouvelle période avant de donner accès à cette personne.");
  return rows;
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
        .innerJoin(users, eq(buildingMembers.userId, users.id))
        .where(and(eq(buildingMembers.buildingId, ctx.buildingId), isNull(buildingMembers.endedAt)));
      const memberStates = new Map(members.map((row) => [row.userId, row.lastSeenAt ? "active" : "pending"]));
      const pending = await db.select({ email: pendingMembers.email, invitationSent: pendingMembers.invitationSent }).from(pendingMembers).where(eq(pendingMembers.buildingId, ctx.buildingId));
      const pendingStates = new Map(pending.map((row) => [row.email.toLowerCase(), row.invitationSent ? "pending" : "prepared"]));

      return Response.json({
        access: people.map((person) => ({
          personId: person.id,
          state: (person.userId && memberStates.get(person.userId))
            || pendingStates.get(person.email.toLowerCase()) || "none",
        })),
      }, { headers: { "cache-control": "no-store" } });
    }

    if (req.method !== "POST") return Response.json({ error: "Méthode non autorisée" }, { status: 405 });

    const body = await req.json().catch(() => ({}));
    const personId = Number(body.personId);
    if (!Number.isInteger(personId) || personId <= 0) throw new HttpError(422, "Personne invalide");

    const [person] = await db.select().from(buildingPeople)
      .where(and(eq(buildingPeople.id, personId), eq(buildingPeople.buildingId, ctx.buildingId))).limit(1);
    if (!person) throw new HttpError(404, "Personne introuvable");

    const email = person.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, "Ajoutez une adresse e-mail valide à cette personne");

    // Reject historical people before calling Identity. Recheck under lock below.
    await activeUnitsForPerson(db, ctx.buildingId, person.id);

    // An Identity account maps to one person per building: a shared address
    // (e.g. a couple) would attach the second person to the first one's account.
    const [sharing] = await db.select({ fullName: buildingPeople.fullName }).from(buildingPeople)
      .where(and(eq(buildingPeople.buildingId, ctx.buildingId), sql`lower(${buildingPeople.email}) = ${email}`, sql`${buildingPeople.id} <> ${person.id}`)).limit(1);
    if (sharing) throw new HttpError(409, `Cette adresse est aussi celle de ${sharing.fullName}. Chaque personne invitée doit avoir sa propre adresse e-mail. Aucun e-mail n’a été demandé.`);

    // Always ask Identity: a local mirror can outlive a deleted account and its
    // last visit says nothing about whether the Identity account is confirmed.
    const knownAccount: IdentityAccount | null = await findAccountByEmail(email);
    const { account, invited } = await deliverPersonInvitation(email, person.fullName, knownAccount, {
      invite: inviteAccount, find: findAccountByEmail, resend: sendAccountActivationLink,
      isDuplicate: error => error instanceof IdentityEmailTakenError,
    });

    await db.transaction(async tx => {
      await tx.select({ id: buildings.id }).from(buildings).where(eq(buildings.id, ctx.buildingId)).for("update");
      const units = await activeUnitsForPerson(tx, ctx.buildingId, person.id);
      const membership = { role: "resident" as const, unitLabel: units[0].label, shareLabel: units[0].shareLabel };
      await mirrorAccount(account, email, person.fullName, tx);
      const [existing] = await tx.select().from(buildingMembers).where(and(eq(buildingMembers.buildingId, ctx.buildingId), eq(buildingMembers.userId, account.id)));
      // Sending a resident link must never demote a manager/council member.
      await tx.insert(buildingMembers).values({ buildingId: ctx.buildingId, userId: account.id, ...membership })
        .onConflictDoUpdate({ target: [buildingMembers.buildingId, buildingMembers.userId],
          set: { ...membership, role: existing && !existing.endedAt ? existing.role : "resident", endedAt: null, endedReason: "" } });
      await tx.update(buildingPeople).set({ userId: account.id, updatedAt: new Date() }).where(eq(buildingPeople.id, person.id));
      await tx.delete(pendingMembers).where(and(eq(pendingMembers.buildingId, ctx.buildingId), eq(pendingMembers.email, email)));
    });

    await writeAudit(ctx, {
      action: invited ? "access.invited" : "access.resent",
      entityType: "building_person",
      entityId: person.id,
      summary: invited ? `Invitation CoproLink demandée pour ${email}.` : `Lien d’accès CoproLink demandé pour ${email}.`,
    });

    // Identity only accepted the request: delivery and reception stay unconfirmed.
    return Response.json({
      state: account.activated ? "active" : "pending",
      invited,
      emailRequested: true,
      deliveryConfirmed: false,
      message: invited
        ? `Invitation demandée à Netlify Identity pour ${email}. La réception n’est pas confirmée : demandez à la personne de vérifier aussi ses courriers indésirables.`
        : account.activated
          ? `Compte déjà actif : accès rattaché. Un lien de réinitialisation du mot de passe a été demandé pour ${email} ; la personne peut aussi se connecter avec son mot de passe habituel.`
          : `Compte pas encore activé : nouveau lien d’activation demandé pour ${email}. La réception n’est pas confirmée.`,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof IdentityAdminUnavailableError) {
      return jsonError(new HttpError(503, "Le service d’invitation est indisponible. Aucun envoi confirmé. Réessayez plus tard ou vérifiez la configuration Netlify Identity."));
    }
    if (error instanceof IdentityRateLimitError) {
      return jsonError(new HttpError(429, "Trop de demandes d’e-mail. Patientez quelques minutes avant de renvoyer le lien."));
    }
    return jsonError(error);
  }
};

export const config: Config = {
  path: "/api/person-access",
};
