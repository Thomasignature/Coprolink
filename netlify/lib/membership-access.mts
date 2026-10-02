import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { buildingMembers, buildings, pendingMembers, type Role } from "../../db/schema.js";

import { buildingPeople } from "../../db/schema-v3.js";

export type AccessTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type AccessGuard = { pendingId?: number; person?: { id: number; email: string }; preserveRole?: boolean };

/** Recheck authorization evidence after obtaining the building lock. */
export const accessGuardMatches = async (tx: AccessTransaction, buildingId: number, guard: AccessGuard) => {
  if (guard.pendingId !== undefined) {
    const [pending] = await tx.select().from(pendingMembers).where(and(
      eq(pendingMembers.id, guard.pendingId), eq(pendingMembers.buildingId, buildingId),
    )).limit(1);
    if (!pending) return false;
  }
  if (guard.person) {
    const [person] = await tx.select().from(buildingPeople).where(and(
      eq(buildingPeople.id, guard.person.id), eq(buildingPeople.buildingId, buildingId),
    )).limit(1);
    if (!person || person.email.trim().toLowerCase() !== guard.person.email) return false;
  }
  return true;
};

export type MembershipInput = { role: Role; unitLabel: string; shareLabel: string };

/**
 * Point d'écriture unique des accès d'immeuble.
 *
 * Le verrou sur l'immeuble sérialise toutes les transitions de rôle : deux
 * requêtes concurrentes ne peuvent donc pas rétrograder les deux derniers
 * gestionnaires. La relation métier personne/lot reste, elle, historisée dans
 * `unit_person_relations` ; cette table ne porte que l'accès applicatif courant.
 */
export const grantOrUpdateMembership = async (
  buildingId: number,
  userId: string,
  input: MembershipInput,
  guard: AccessGuard = {},
): Promise<{ member: typeof buildingMembers.$inferSelect | null; blocked: boolean }> => db.transaction(tx => grantMembershipInTransaction(tx, buildingId, userId, input, guard));

export const grantMembershipInTransaction = async (
  tx: AccessTransaction, buildingId: number, userId: string, input: MembershipInput, guard: AccessGuard = {},
): Promise<{ member: typeof buildingMembers.$inferSelect | null; blocked: boolean }> => {
  await tx.execute(sql`select ${buildings.id} from ${buildings} where ${buildings.id} = ${buildingId} for update`);
  if (!await accessGuardMatches(tx, buildingId, guard)) return { member: null, blocked: false };
  if (guard.pendingId !== undefined) {
    const [pending] = await tx.select().from(pendingMembers).where(and(
      eq(pendingMembers.id, guard.pendingId), eq(pendingMembers.buildingId, buildingId),
    )).limit(1);
    input = { role: pending.role as Role, unitLabel: pending.unitLabel, shareLabel: pending.shareLabel };
  }
  const [existing] = await tx.select().from(buildingMembers).where(and(
    eq(buildingMembers.buildingId, buildingId), eq(buildingMembers.userId, userId),
  )).limit(1);

  if (guard.preserveRole && existing?.endedAt === null) input = { ...input, role: existing.role as Role };

  if (existing?.endedAt === null && existing.role === "manager" && input.role !== "manager") {
    const others = await tx.select({ id: buildingMembers.id }).from(buildingMembers).where(and(
      eq(buildingMembers.buildingId, buildingId), eq(buildingMembers.role, "manager"),
      isNull(buildingMembers.endedAt), ne(buildingMembers.id, existing.id),
    ));
    if (others.length === 0) return { member: null, blocked: true };
  }

  if (guard.pendingId !== undefined) await tx.delete(pendingMembers).where(eq(pendingMembers.id, guard.pendingId));
  if (guard.person) await tx.update(buildingPeople).set({ userId, updatedAt: new Date() })
    .where(and(eq(buildingPeople.id, guard.person.id), eq(buildingPeople.buildingId, buildingId)));

  if (existing) {
    const [member] = await tx.update(buildingMembers).set({ ...input, endedAt: null, endedReason: "" })
      .where(eq(buildingMembers.id, existing.id)).returning();
    return { member, blocked: false };
  }
  const [member] = await tx.insert(buildingMembers).values({ buildingId, userId, ...input }).returning();
  return { member, blocked: false };
};

export const revokeMembership = async (
  buildingId: number,
  memberId: number,
  reason: string,
  revokedAt = new Date(),
): Promise<{ member: typeof buildingMembers.$inferSelect | null; blocked: boolean; alreadyEnded: boolean }> => db.transaction(async (tx) => {
  await tx.execute(sql`select ${buildings.id} from ${buildings} where ${buildings.id} = ${buildingId} for update`);
  const [existing] = await tx.select().from(buildingMembers).where(and(
    eq(buildingMembers.id, memberId), eq(buildingMembers.buildingId, buildingId),
  )).limit(1);
  if (!existing) return { member: null, blocked: false, alreadyEnded: false };
  if (existing.endedAt) return { member: existing, blocked: false, alreadyEnded: true };
  if (existing.role === "manager") {
    const others = await tx.select({ id: buildingMembers.id }).from(buildingMembers).where(and(
      eq(buildingMembers.buildingId, buildingId), eq(buildingMembers.role, "manager"),
      isNull(buildingMembers.endedAt), ne(buildingMembers.id, memberId),
    ));
    if (others.length === 0) return { member: existing, blocked: true, alreadyEnded: false };
  }
  const [member] = await tx.update(buildingMembers).set({ endedAt: revokedAt, endedReason: reason })
    .where(and(eq(buildingMembers.id, memberId), isNull(buildingMembers.endedAt))).returning();
  return { member, blocked: false, alreadyEnded: false };
});
