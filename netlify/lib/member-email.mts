import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { buildingMembers, buildings, pendingMembers, users } from "../../db/schema.js";
import { buildingPeople } from "../../db/schema-v3.js";
import { HttpError } from "./auth.mts";
import { findAccountByEmail, inviteAccount, sendAccountActivationLink, IdentityEmailTakenError } from "./identity.mts";
import { deliverPersonInvitation } from "./person-invitation.mts";

export const validMemberEmail = (value: unknown) => {
  if (typeof value !== "string" || value.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new HttpError(422, "Adresse e-mail invalide");
  }
  return value.trim().toLowerCase();
};

// A syndic can transfer access to this building, never rewrite somebody's
// global Identity credentials or their access to other buildings.
export const changeMemberEmail = async (buildingId: number, memberId: number, email: string) => {
  const validate = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    await tx.select({ id: buildings.id }).from(buildings).where(eq(buildings.id, buildingId)).for("update");
    const [member] = await tx.select().from(buildingMembers).where(and(eq(buildingMembers.id, memberId), eq(buildingMembers.buildingId, buildingId)));
    if (!member || member.endedAt) throw new HttpError(409, "Cet accès est terminé ou introuvable");
    const [user] = await tx.select().from(users).where(eq(users.id, member.userId));
    if (!user) throw new HttpError(404, "Compte introuvable");
    if (user.email.toLowerCase() === email) return { member, user, unchanged: true };
    if (member.role === "manager") {
      const managers = await tx.select({ id: buildingMembers.id }).from(buildingMembers).where(and(eq(buildingMembers.buildingId, buildingId), eq(buildingMembers.role, "manager"), isNull(buildingMembers.endedAt)));
      if (managers.length <= 1) throw new HttpError(409, "Désignez un autre gestionnaire avant de changer l’adresse du dernier gestionnaire");
    }
    const existing = await tx.select({ id: buildingMembers.id }).from(buildingMembers).innerJoin(users, eq(users.id, buildingMembers.userId))
      .where(and(eq(buildingMembers.buildingId, buildingId), sql`lower(${users.email}) = ${email}`, isNull(buildingMembers.endedAt)));
    const pending = await tx.select({ id: pendingMembers.id }).from(pendingMembers).where(and(eq(pendingMembers.buildingId, buildingId), sql`lower(${pendingMembers.email}) = ${email}`));
    const people = await tx.select({ id: buildingPeople.id, userId: buildingPeople.userId }).from(buildingPeople)
      .where(and(eq(buildingPeople.buildingId, buildingId), sql`lower(${buildingPeople.email}) = ${email}`));
    if (existing.length || pending.length || people.some(person => person.userId !== member.userId)) {
      throw new HttpError(409, "Cette adresse est déjà utilisée dans cet immeuble. Aucun accès n’a été transféré.");
    }
    return { member, user, unchanged: false };
  };
  const before = await db.transaction(validate);
  if (before.unchanged) return { id: memberId, email, message: "Adresse inchangée. Aucun e-mail demandé." };
  const known = await findAccountByEmail(email);
  const { account } = await deliverPersonInvitation(email, before.user.fullName, known, {
    invite: inviteAccount, find: findAccountByEmail, resend: sendAccountActivationLink,
    isDuplicate: error => error instanceof IdentityEmailTakenError,
  });
  if (account.id === before.member.userId) throw new HttpError(409, "Le compte Identity a changé. Actualisez la liste avant de réessayer.");
  const member = await db.transaction(async tx => {
    const current = await validate(tx);
    if (current.unchanged || current.member.userId !== before.member.userId) throw new HttpError(409, "L’accès a changé pendant la demande. Actualisez la liste.");
    // Never demote or overwrite another member, including after an email race.
    const [destination] = await tx.select().from(buildingMembers).where(and(eq(buildingMembers.buildingId, buildingId), eq(buildingMembers.userId, account.id)));
    if (destination && !destination.endedAt) throw new HttpError(409, "Le destinataire dispose déjà d’un accès à cet immeuble");
    await tx.insert(users).values({ id: account.id, email: account.email, fullName: account.fullName || current.user.fullName })
      .onConflictDoUpdate({ target: users.id, set: { email: account.email } });
    const values = { role: current.member.role, unitLabel: current.member.unitLabel, shareLabel: current.member.shareLabel,
      quarterlyCall: current.member.quarterlyCall, balance: current.member.balance, endedAt: null, endedReason: "" };
    const [next] = await tx.insert(buildingMembers).values({ buildingId, userId: account.id, ...values })
      .onConflictDoUpdate({ target: [buildingMembers.buildingId, buildingMembers.userId], set: values }).returning();
    await tx.update(buildingMembers).set({ endedAt: new Date(), endedReason: "email_changed" }).where(eq(buildingMembers.id, memberId));
    await tx.update(buildingPeople).set({ email, userId: account.id, updatedAt: new Date() })
      .where(and(eq(buildingPeople.buildingId, buildingId), eq(buildingPeople.userId, current.member.userId)));
    await tx.delete(pendingMembers).where(and(eq(pendingMembers.buildingId, buildingId), sql`lower(${pendingMembers.email}) = ${current.user.email.toLowerCase()}`));
    return next;
  });
  return { id: member.id, email, deliveryConfirmed: false, message: `Adresse mise à jour pour cet immeuble. L’ancien accès est retiré et un lien a été demandé pour ${email}. La réception n’est pas confirmée.` };
};
