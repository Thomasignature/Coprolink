import type { Config } from "@netlify/functions";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { buildingMembers, buildings, users } from "../../db/schema.js";
import { buildingPeople, buildingUnits, relationFinances, unitPersonRelations } from "../../db/schema-v3.js";
import { authorize, HttpError, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { writeAudit } from "../lib/data.mts";

/**
 * Données financières saisies par le syndic. Réservé à `finance:manage`
 * (gestionnaire et administrateur plateforme uniquement).
 *
 * - GET   : chiffres de l'immeuble + appel trimestriel et solde de chaque membre
 * - PATCH : `{ building: { reserveFund, yearlyBudget, yearlySpent } }`
 *           ou `{ memberId, quarterlyCall, balance }`
 *
 * Chaque copropriétaire ne relit ensuite que SA situation via /api/workspace.
 */

const readAmount = (value: unknown, field: string, { allowNegative = false } = {}) => {
  const amount = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  if (value === undefined || (typeof value === "string" && !value.trim()) || value === null || !Number.isFinite(amount) || Math.abs(amount) > 99_999_999.99) {
    throw new HttpError(422, `Montant « ${field} » invalide`);
  }
  if (!allowNegative && amount < 0) throw new HttpError(422, `Le montant « ${field} » ne peut pas être négatif`);
  return amount.toFixed(2);
};

const loadFinances = async (buildingId: number) => {
  const [building] = await db.select().from(buildings).where(eq(buildings.id, buildingId)).limit(1);
  if (!building) throw new HttpError(404, "Immeuble introuvable");
  const owners = await db.select({
    id: unitPersonRelations.id, personId: buildingPeople.id, fullName: buildingPeople.fullName,
    email: buildingPeople.email, unitLabel: buildingUnits.label,
    quarterlyCall: relationFinances.quarterlyCall, balance: relationFinances.balance,
  }).from(unitPersonRelations)
    .innerJoin(buildingUnits, eq(buildingUnits.id, unitPersonRelations.unitId))
    .innerJoin(buildingPeople, eq(buildingPeople.id, unitPersonRelations.personId))
    .leftJoin(relationFinances, eq(relationFinances.relationId, unitPersonRelations.id))
    .where(and(eq(buildingUnits.buildingId, buildingId), eq(buildingPeople.buildingId, buildingId),
      eq(unitPersonRelations.relationType, "owner"), isNull(unitPersonRelations.endDate)))
    .orderBy(asc(buildingUnits.label), asc(buildingPeople.fullName));
  const legacy = await db.select({ id: buildingMembers.id, userId: buildingMembers.userId, fullName: users.fullName,
    unitLabel: buildingMembers.unitLabel, quarterlyCall: buildingMembers.quarterlyCall, balance: buildingMembers.balance })
    .from(buildingMembers).innerJoin(users, eq(users.id, buildingMembers.userId))
    .where(and(eq(buildingMembers.buildingId, buildingId), isNull(buildingMembers.endedAt)));

  return {
    building: {
      reserveFund: Number(building.reserveFund),
      yearlyBudget: Number(building.yearlyBudget),
      yearlySpent: Number(building.yearlySpent),
    },
    members: owners.map(m => ({ ...m, role: "owner", quarterlyCall: m.quarterlyCall === null ? null : Number(m.quarterlyCall), balance: m.balance === null ? null : Number(m.balance) })),
    legacy: legacy.filter(m => Number(m.balance) !== 0 || Number(m.quarterlyCall) !== 0),
  };
};

export default async (req: Request) => {
  try {
    const ctx = await authorize(req, { buildingSlug: readBuildingSlug(req), require: "finance:manage" });

    if (req.method === "GET") {
      return Response.json(await loadFinances(ctx.buildingId), { headers: { "cache-control": "no-store" } });
    }

    if (req.method !== "PATCH") return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
    const body = await req.json().catch(() => ({}));

    if (body.building && typeof body.building === "object") {
      const input = body.building;
      await db.update(buildings).set({
        reserveFund: readAmount(input.reserveFund, "fonds de réserve"),
        yearlyBudget: readAmount(input.yearlyBudget, "budget annuel"),
        yearlySpent: readAmount(input.yearlySpent, "dépenses de l'exercice"),
      }).where(eq(buildings.id, ctx.buildingId));
      await writeAudit(ctx, {
        action: "finance.building_updated",
        entityType: "building",
        entityId: ctx.buildingId,
        summary: "Chiffres financiers de l'immeuble mis à jour.",
      });
    } else {
      const relationId = Number(body.relationId);
      if (!Number.isInteger(relationId) || relationId <= 0) throw new HttpError(422, "Choisissez une période de propriété active");
      await db.transaction(async tx => {
        await tx.select({ id: buildings.id }).from(buildings).where(eq(buildings.id, ctx.buildingId)).for("update");
        const [target] = await tx.select({ id: unitPersonRelations.id }).from(unitPersonRelations)
          .innerJoin(buildingUnits, eq(buildingUnits.id, unitPersonRelations.unitId))
          .where(and(eq(unitPersonRelations.id, relationId), eq(buildingUnits.buildingId, ctx.buildingId),
            eq(unitPersonRelations.relationType, "owner"), isNull(unitPersonRelations.endDate)));
        if (!target) throw new HttpError(404, "Période de propriété active introuvable");
        const amounts = { quarterlyCall: readAmount(body.quarterlyCall, "appel trimestriel"), balance: readAmount(body.balance, "solde", { allowNegative: true }), updatedAt: new Date() };
        await tx.insert(relationFinances).values({ relationId, ...amounts }).onConflictDoUpdate({ target: relationFinances.relationId, set: amounts });
      });
      await writeAudit(ctx, { action: "finance.relation_updated", entityType: "unit_person_relation", entityId: relationId,
        summary: `Situation financière de la période de propriété #${relationId} mise à jour.` });
    }

    return Response.json(await loadFinances(ctx.buildingId), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = {
  path: "/api/finances",
  method: ["GET", "PATCH"],
};

