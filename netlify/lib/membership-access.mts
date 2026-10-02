import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { buildingMembers, buildings, type Role } from "../../db/schema.js";

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
): Promise<{ member: typeof buildingMembers.$inferSelect | null; blocked: boolean }> => db.transaction(async (tx) => {
  await tx.execute(sql`select ${buildings.id} from ${buildings} where ${buildings.id} = ${buildingId} for update`);
  const [existing] = await tx.select().from(buildingMembers).where(and(
    eq(buildingMembers.buildingId, buildingId), eq(buildingMembers.userId, userId),
  )).limit(1);

  if (existing?.endedAt === null && existing.role === "manager" && input.role !== "manager") {
    const others = await tx.select({ id: buildingMembers.id }).from(buildingMembers).where(and(
      eq(buildingMembers.buildingId, buildingId), eq(buildingMembers.role, "manager"),
      isNull(buildingMembers.endedAt), ne(buildingMembers.id, existing.id),
    ));
    if (others.length === 0) return { member: null, blocked: true };
  }

  if (existing) {
    const [member] = await tx.update(buildingMembers).set({ ...input, endedAt: null, endedReason: "" })
      .where(eq(buildingMembers.id, existing.id)).returning();
    return { member, blocked: false };
  }
  const [member] = await tx.insert(buildingMembers).values({ buildingId, userId, ...input }).returning();
  return { member, blocked: false };
});

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
