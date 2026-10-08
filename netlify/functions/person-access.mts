import type { Config } from "@netlify/functions";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { buildingMembers, pendingMembers, users } from "../../db/schema.js";
import { buildingPeople, unitPersonRelations, buildingUnits } from "../../db/schema-v3.js";
import { authorizeCoproLinkAdmin, authorizeSyndicOperator, HttpError, jsonError, linkBuildingPersonAccount, readBuildingSlug } from "../lib/auth.mts";
import {
  IdentityAdminUnavailableError,
  IdentityEmailTakenError,
  IdentityRateLimitError,
  findAccountByEmail,
  inviteAccount,
  lookupAccountByEmail,
  sendAccountActivationLink,
  type IdentityAccount,
} from "../lib/identity.mts";
import { writeAudit } from "../lib/data.mts";
import { deliverPersonInvitation } from "../lib/person-invitation.mts";

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
    .where(and(eq(unitPersonRelations.personId, personId), eq(buildingUnits.buildingId, buildingId)))
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

    const unit = await unitForPerson(ctx.buildingId, person.id);
    const membership = { role: "resident" as const, unitLabel: unit.label || "", shareLabel: unit.shareLabel || "" };

    const mirrored = await findMirroredAccount(email);
    const lookup = mirrored ? { account: null, unavailable: null } : await lookupAccountByEmail(email);
    const knownAccount: IdentityAccount | null = mirrored
      ? { id: mirrored.id, email: mirrored.email, fullName: mirrored.fullName, activated: mirrored.lastSeenAt !== null }
      : lookup.account;
    const { account, invited } = await deliverPersonInvitation(email, person.fullName, knownAccount, {
      invite: inviteAccount, find: findAccountByEmail, resend: sendAccountActivationLink,
      isDuplicate: error => error instanceof IdentityEmailTakenError,
    });

    await mirrorAccount(account, email, person.fullName);
    await db.insert(buildingMembers).values({ buildingId: ctx.buildingId, userId: account.id, ...membership })
      .onConflictDoUpdate({
        target: [buildingMembers.buildingId, buildingMembers.userId],
        set: { ...membership, endedAt: null, endedReason: "" },
      });
    await linkBuildingPersonAccount(ctx.buildingId, email, account.id);
    await db.delete(pendingMembers).where(and(eq(pendingMembers.buildingId, ctx.buildingId), eq(pendingMembers.email, email)));

    await writeAudit(ctx, {
      action: invited ? "access.invited" : "access.resent",
      entityType: "building_person",
      entityId: person.id,
      summary: invited ? `Invitation CoproLink demandée pour ${email}.` : `Lien d’accès CoproLink demandé pour ${email}.`,
    });

    return Response.json({
      state: account.activated ? "active" : "pending",
      invited,
      emailSent: true,
      message: invited
        ? `Invitation CoproLink envoyée à ${email}.`
        : account.activated
          ? `Lien de connexion envoyé à ${email}.`
          : `Nouveau lien d’activation envoyé à ${email}.`,
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
