import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { auditLog, buildingMembers, buildings, pendingMembers, users } from "../../db/schema.js";
import { buildingPeople } from "../../db/schema-v3.js";
import { HttpError, type AuthContext } from "./auth.mts";
import type { AccessTransaction } from "./membership-access.mts";

export const normalizePersonEmail = (value: unknown) => {
  if (typeof value !== "string") throw new HttpError(422, "Adresse e-mail invalide");
  const email = value.trim().toLowerCase();
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(422, "Adresse e-mail invalide");
  }
  return email;
};

/** A correction changes access only in this building, never business relations or Identity credentials. */
export const correctPersonEmailInTransaction = async (
  tx: AccessTransaction, ctx: AuthContext, personId: number, email: string, previousEmail: unknown,
) => {
  await tx.execute(sql`select ${buildings.id} from ${buildings} where ${buildings.id} = ${ctx.buildingId} for update`);
  const [person] = await tx.select().from(buildingPeople).where(and(
    eq(buildingPeople.id, personId), eq(buildingPeople.buildingId, ctx.buildingId),
  )).limit(1);
  if (!person) throw new HttpError(404, "Personne introuvable");
  const oldEmail = person.email.trim().toLowerCase();
  if (typeof previousEmail !== "string" || previousEmail.trim().toLowerCase() !== oldEmail) {
    throw new HttpError(409, "L’adresse a été modifiée entre-temps. Actualisez la page avant de réessayer.");
  }
  if (email === oldEmail) return { person, reinvite: false, message: "Adresse inchangée." };

  // Refuse ambiguous shared identities instead of revoking another person's access.
  const duplicates = await tx.select({ id: buildingPeople.id }).from(buildingPeople).where(and(
    eq(buildingPeople.buildingId, ctx.buildingId), ne(buildingPeople.id, personId),
    sql`lower(trim(${buildingPeople.email})) in (${email}, ${oldEmail || email})`,
  ));
  if (duplicates.length) throw new HttpError(409, "Cette adresse est partagée avec une autre fiche de l’immeuble. Vérifiez les doublons avant de corriger l’accès.");

  const targetAccounts = await tx.select({ id: users.id }).from(users)
    .where(sql`lower(trim(${users.email})) = ${email}`);
  for (const account of targetAccounts) {
    const [linkedPerson] = await tx.select({ id: buildingPeople.id }).from(buildingPeople).where(and(
      eq(buildingPeople.buildingId, ctx.buildingId), eq(buildingPeople.userId, account.id), ne(buildingPeople.id, personId),
    )).limit(1);
    if (linkedPerson) throw new HttpError(409, "Le compte de cette nouvelle adresse est déjà lié à une autre personne de l’immeuble.");
  }

  const accounts = oldEmail ? await tx.select({ id: users.id }).from(users)
    .where(sql`lower(trim(${users.email})) = ${oldEmail}`) : [];
  const accountIds = new Set(accounts.map(account => account.id));
  if (person.userId) accountIds.add(person.userId);
  let hadAccess = false;
  for (const userId of accountIds) {
    const [member] = await tx.select().from(buildingMembers).where(and(
      eq(buildingMembers.buildingId, ctx.buildingId), eq(buildingMembers.userId, userId), isNull(buildingMembers.endedAt),
    )).limit(1);
    if (!member) continue;
    if (member.role === "manager" || member.role === "platform_admin" ||
        (ctx.principal.kind === "user" && userId === ctx.principal.userId)) {
      throw new HttpError(409, "Cet accès administratif doit être corrigé depuis la gestion des comptes, sans retirer votre propre accès.");
    }
    const [otherPerson] = await tx.select({ id: buildingPeople.id }).from(buildingPeople).where(and(
      eq(buildingPeople.buildingId, ctx.buildingId), eq(buildingPeople.userId, userId), ne(buildingPeople.id, personId),
    )).limit(1);
    if (otherPerson) throw new HttpError(409, "Ce compte est lié à une autre fiche de l’immeuble. Vérifiez les doublons avant de corriger l’accès.");
    await tx.update(buildingMembers).set({ endedAt: new Date(), endedReason: "email_correction" })
      .where(eq(buildingMembers.id, member.id));
    hadAccess = true;
  }
  const cancelled = oldEmail ? await tx.delete(pendingMembers).where(and(
    eq(pendingMembers.buildingId, ctx.buildingId), sql`lower(trim(${pendingMembers.email})) = ${oldEmail}`,
  )).returning() : [];
  const [updated] = await tx.update(buildingPeople).set({ email, userId: null, updatedAt: new Date() })
    .where(and(eq(buildingPeople.id, personId), eq(buildingPeople.buildingId, ctx.buildingId))).returning();
  await tx.insert(auditLog).values({
    buildingId: ctx.buildingId, actorUserId: ctx.principal.kind === "user" ? ctx.principal.userId : null,
    actorLabel: ctx.actorLabel, actorRole: ctx.role ?? "", action: "access.email_corrected",
    entityType: "building_person", entityId: String(personId),
    summary: `Adresse corrigée : ${oldEmail || "non renseignée"} → ${email}. Ancien accès retiré de cet immeuble.`,
  });
  return { person: updated, reinvite: hadAccess || cancelled.length > 0,
    message: "Adresse enregistrée. Les relations avec les lots sont conservées." };
};
