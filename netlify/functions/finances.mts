import type { Config } from "@netlify/functions";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { buildingMembers, buildings, users } from "../../db/schema.js";
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
  if (value === "" || value === null || !Number.isFinite(amount) || Math.abs(amount) > 1_000_000_000) {
    throw new HttpError(422, `Montant « ${field} » invalide`);
  }
  if (!allowNegative && amount < 0) throw new HttpError(422, `Le montant « ${field} » ne peut pas être négatif`);
  return amount.toFixed(2);
};

const loadFinances = async (buildingId: number) => {
  const [building] = await db.select().from(buildings).where(eq(buildings.id, buildingId)).limit(1);
  if (!building) throw new HttpError(404, "Immeuble introuvable");
  const members = await db
    .select({
      id: buildingMembers.id,
      email: users.email,
      fullName: users.fullName,
      role: buildingMembers.role,
      unitLabel: buildingMembers.unitLabel,
      quarterlyCall: buildingMembers.quarterlyCall,
      balance: buildingMembers.balance,
    })
    .from(buildingMembers)
    .innerJoin(users, eq(buildingMembers.userId, users.id))
    .where(eq(buildingMembers.buildingId, buildingId))
    .orderBy(asc(buildingMembers.unitLabel), asc(users.email));

  return {
    building: {
      reserveFund: Number(building.reserveFund),
      yearlyBudget: Number(building.yearlyBudget),
      yearlySpent: Number(building.yearlySpent),
    },
    members: members.map((m) => ({ ...m, quarterlyCall: Number(m.quarterlyCall), balance: Number(m.balance) })),
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
      const memberId = Number(body.memberId);
      const scope = and(eq(buildingMembers.id, memberId), eq(buildingMembers.buildingId, ctx.buildingId));
      const [target] = Number.isInteger(memberId) ? await db.select({ id: buildingMembers.id }).from(buildingMembers).where(scope).limit(1) : [];
      if (!target) throw new HttpError(404, "Membre introuvable");
      await db.update(buildingMembers).set({
        quarterlyCall: readAmount(body.quarterlyCall, "appel trimestriel"),
        // Un solde négatif représente un crédit en faveur du copropriétaire.
        balance: readAmount(body.balance, "solde", { allowNegative: true }),
      }).where(scope);
      await writeAudit(ctx, {
        action: "finance.member_updated",
        entityType: "building_member",
        entityId: memberId,
        summary: `Situation financière du membre #${memberId} mise à jour.`,
      });
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
