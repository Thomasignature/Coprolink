import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { buildingPeople, buildingUnits, relationFinances, unitPersonRelations } from "../../db/schema-v3.js";

export const loadResidentLots = async (buildingId: number, userId: string, canReadFinance: boolean) => {
  const rows = await db.select({
    id: buildingUnits.id, label: buildingUnits.label, floor: buildingUnits.floor,
    unitShare: buildingUnits.shareLabel, relationShare: unitPersonRelations.shareLabel,
    relationId: unitPersonRelations.id, relationType: unitPersonRelations.relationType,
    quarterlyCall: relationFinances.quarterlyCall, balance: relationFinances.balance,
  }).from(unitPersonRelations)
    .innerJoin(buildingPeople, eq(buildingPeople.id, unitPersonRelations.personId))
    .innerJoin(buildingUnits, eq(buildingUnits.id, unitPersonRelations.unitId))
    .leftJoin(relationFinances, eq(relationFinances.relationId, unitPersonRelations.id))
    .where(and(eq(buildingPeople.buildingId, buildingId), eq(buildingUnits.buildingId, buildingId),
      eq(buildingPeople.userId, userId), isNull(unitPersonRelations.endDate)))
    .orderBy(asc(buildingUnits.label), asc(unitPersonRelations.id));
  return serializeResidentLots(rows, canReadFinance);
};

import { serializeResidentLots } from "./resident-policy.mts";
