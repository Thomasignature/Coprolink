import type { Config } from "@netlify/functions";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  buildingPeople, buildingUnits, personVisibilityPreferences, unitPersonRelations,
} from "../../db/schema-v3.js";
import { authorizeSyndicOperator, HttpError, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { writeAudit } from "../lib/data.mts";

const PRESETS: Record<string, string[]> = {
  owner: ["owner"],
  occupant: ["occupant"],
  tenant: ["tenant"],
  owner_occupant: ["owner", "occupant"],
};

const clean = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);

export default async (req: Request) => {
  try {
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
    const ctx = await authorizeSyndicOperator(req, readBuildingSlug(req));
    const body: any = await req.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];
    if (!rows.length) throw new HttpError(422, "Aucune ligne à importer");

    const result = { unitsCreated: 0, peopleCreated: 0, relationsCreated: 0, skipped: 0, errors: [] as any[] };

    for (let index = 0; index < rows.length; index += 1) {
      const raw = rows[index] || {};
      const unitLabel = clean(raw.unitLabel, 80);
      const fullName = clean(raw.fullName, 120);
      const floor = clean(raw.floor, 40);
      const email = clean(raw.email, 200).toLowerCase();
      const shareLabel = clean(raw.shareLabel, 40);
      const preset = clean(raw.relationPreset || "occupant", 40);

      if (!unitLabel || !fullName || !PRESETS[preset]) {
        result.skipped += 1;
        result.errors.push({ row: index + 1, message: "Lot, nom ou rôle invalide" });
        continue;
      }

      try {
        let [unit] = await db.select().from(buildingUnits)
          .where(and(eq(buildingUnits.buildingId, ctx.buildingId), eq(buildingUnits.label, unitLabel))).limit(1);
        if (!unit) {
          [unit] = await db.insert(buildingUnits).values({
            buildingId: ctx.buildingId,
            label: unitLabel,
            floor,
            shareLabel,
          }).returning();
          result.unitsCreated += 1;
        } else if ((floor && floor !== unit.floor) || (shareLabel && shareLabel !== unit.shareLabel)) {
          [unit] = await db.update(buildingUnits).set({
            ...(floor ? { floor } : {}),
            ...(shareLabel ? { shareLabel } : {}),
            updatedAt: new Date(),
          }).where(eq(buildingUnits.id, unit.id)).returning();
        }

        let person = null as any;
        if (email) {
          [person] = await db.select().from(buildingPeople)
            .where(and(eq(buildingPeople.buildingId, ctx.buildingId), sql`lower(${buildingPeople.email}) = ${email}`)).limit(1);
        }
        if (!person) {
          [person] = await db.insert(buildingPeople).values({
            buildingId: ctx.buildingId,
            fullName,
            email,
          }).returning();
          await db.insert(personVisibilityPreferences).values({ personId: person.id, directoryVisible: true, hallVisible: false }).onConflictDoNothing();
          result.peopleCreated += 1;
        }

        for (const relationType of PRESETS[preset]) {
          const [existing] = await db.select({ id: unitPersonRelations.id }).from(unitPersonRelations)
            .where(and(
              eq(unitPersonRelations.unitId, unit.id),
              eq(unitPersonRelations.personId, person.id),
              eq(unitPersonRelations.relationType, relationType),
              sql`${unitPersonRelations.endDate} IS NULL`,
            )).limit(1);
          if (!existing) {
            await db.insert(unitPersonRelations).values({ unitId: unit.id, personId: person.id, relationType, shareLabel });
            result.relationsCreated += 1;
          }
        }
      } catch (error: any) {
        result.skipped += 1;
        result.errors.push({ row: index + 1, message: error?.message || "Erreur d’import" });
      }
    }

    await writeAudit(ctx, {
      action: "onboarding.bulk_import",
      entityType: "building",
      entityId: ctx.buildingId,
      summary: `Import onboarding : ${result.peopleCreated} personne(s), ${result.unitsCreated} lot(s), ${result.relationsCreated} lien(s).`,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = { path: "/api/onboarding-import", method: "POST" };