import type { Config } from "@netlify/functions";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { buildingMembers, pendingMembers, users } from "../../db/schema.js";
import { buildingPeople, unitPersonRelations, buildingUnits } from "../../db/schema-v3.js";
import { authorizeCoproLinkAdmin, authorizeSyndicOperator, HttpError, jsonError, linkBuildingPersonAccount, readBuildingSlug } from "../lib/auth.mts";
import {
  IdentityAdminUnavailableError,
  IdentityEmailTakenError,
  inviteAccount,
  lookupAccountByEmail,
  type IdentityAccount,
} from "../lib/identity.mts";
import { writeAudit } from "../lib/data.mts";

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
      const members = await db.select({ userId: buildingMembers.userId }).from(buildingMembers).where(eq(buildingMembers.buildingId, ctx.buildingId));
      const memberIds = new Set(members.map((row) => row.userId));
      const pending = await db.select({ email: pendingMembers.email }).from(pendingMembers).where(eq(pendingMembers.buildingId, ctx.buildingId));
      const pendingEmails = new Set(pending.map((row) => row.email.toLowerCase()));

      return Response.json({
        access: people.map((person) => ({
          personId: person.id,
          state: person.userId && memberIds.has(person.userId)
            ? "active"
            : person.email && pendingEmails.has(person.email.toLowerCase())
              ? "pending"
              : "none",
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
    if (!email) throw new HttpError(422, "Ajoutez d’abord une adresse e-mail à cette personne");

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
      const [pending] = await db.insert(pendingMembers).values({
        buildingId: ctx.buildingId,
        email,
        fullName: person.fullName,
        role: membership.role,
        unitLabel: membership.unitLabel,
        shareLabel: membership.shareLabel,
        invitationSent: false,
        invitedByUserId: ctx.principal.userId,
      }).onConflictDoUpdate({
        target: [pendingMembers.buildingId, pendingMembers.email],
        set: { fullName: person.fullName, role: membership.role, unitLabel: membership.unitLabel, shareLabel: membership.shareLabel },
      }).returning();

      await writeAudit(ctx, {
        action: "access.prepared",
        entityType: "building_person",
        entityId: person.id,
        summary: `Accès CoproLink préparé pour ${email}.`,
      });
      return Response.json({ state: "pending", pendingId: pending.id, message: `Accès préparé pour ${email}. Il s’activera lors de sa première connexion.` }, { status: 202 });
    }

    await mirrorAccount(account, email, person.fullName);
    await db.insert(buildingMembers).values({ buildingId: ctx.buildingId, userId: account.id, ...membership })
      .onConflictDoUpdate({ target: [buildingMembers.buildingId, buildingMembers.userId], set: membership });
    await linkBuildingPersonAccount(ctx.buildingId, email, account.id);

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
