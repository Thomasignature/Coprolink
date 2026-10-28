import type { Config } from "@netlify/functions";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  buildingPeople, buildingUnits, personVisibilityPreferences, unitPersonRelations,
} from "../../db/schema-v3.js";
import { buildings } from "../../db/schema.js";
import { authorizeSyndicOperator, HttpError, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { assertSameImportPerson, matchImportPerson } from "../lib/import-matching.mts";
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
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length > 500) throw new HttpError(422, "Import limité à 500 lignes");
    if (!rows.length) throw new HttpError(422, "Aucune ligne à importer");

    const result = { unitsCreated: 0, peopleCreated: 0, relationsCreated: 0, skipped: 0, errors: [] as any[] };

    for (let index = 0; index < rows.length; index += 1) {
      const raw = rows[index] || {};
      const unitLabel = clean(raw.unitLabel, 80);
      const fullName = clean(raw.fullName, 120);
      const floor = clean(raw.floor, 40);
      const email = clean(raw.email, 200).toLowerCase();
      const shareLabel = clean(raw.shareLabel, 40);
      const preset = clean(raw.relationPreset, 40);
      const sourceRow = Number.isInteger(raw.sourceRow) && raw.sourceRow > 0 ? raw.sourceRow : index + 1;

      if (!unitLabel || !fullName || !Object.hasOwn(PRESETS, preset) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        result.skipped += 1;
        result.errors.push({ row: sourceRow, message: email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "Adresse e-mail invalide" : "Lot, nom ou rôle invalide" });
        continue;
      }

      try {
        const counts = { unitsCreated: 0, peopleCreated: 0, relationsCreated: 0 };
        await db.transaction(async tx => {
          await tx.select({ id: buildings.id }).from(buildings).where(eq(buildings.id, ctx.buildingId)).for("update");
        let [unit] = await tx.select().from(buildingUnits)
          .where(and(eq(buildingUnits.buildingId, ctx.buildingId), eq(buildingUnits.label, unitLabel))).limit(1);
        if (!unit) {
          [unit] = await tx.insert(buildingUnits).values({
            buildingId: ctx.buildingId,
            label: unitLabel,
            floor,
            shareLabel,
          }).returning();
          counts.unitsCreated += 1;
        } else if ((floor && floor !== unit.floor) || (shareLabel && shareLabel !== unit.shareLabel)) {
          [unit] = await tx.update(buildingUnits).set({
            ...(floor ? { floor } : {}),
            ...(shareLabel ? { shareLabel } : {}),
            updatedAt: new Date(),
          }).where(eq(buildingUnits.id, unit.id)).returning();
        }

        let person = null as any;
        if (email) {
          [person] = await tx.select().from(buildingPeople)
            .where(and(eq(buildingPeople.buildingId, ctx.buildingId), sql`lower(${buildingPeople.email}) = ${email}`)).limit(1);
          if (person) assertSameImportPerson(person, fullName);
        }
        if (!person) {
          const candidates = await tx.select({
            id: buildingPeople.id, fullName: buildingPeople.fullName, email: buildingPeople.email,
          }).from(buildingPeople).innerJoin(unitPersonRelations, eq(unitPersonRelations.personId, buildingPeople.id))
            .where(and(eq(buildingPeople.buildingId, ctx.buildingId), eq(unitPersonRelations.unitId, unit.id),
              sql`${unitPersonRelations.endDate} IS NULL`));
          // With an e-mail, only a homonym still without address can receive it.
          person = matchImportPerson(candidates, fullName, { withoutEmailOnly: Boolean(email) });
          if (person && email) {
            [person] = await tx.update(buildingPeople).set({ email, updatedAt: new Date() }).where(eq(buildingPeople.id, person.id)).returning();
          }
        }
        if (!person) {
          [person] = await tx.insert(buildingPeople).values({
            buildingId: ctx.buildingId,
            fullName,
            email,
          }).returning();
          await tx.insert(personVisibilityPreferences).values({ personId: person.id, directoryVisible: true, hallVisible: false }).onConflictDoNothing();
          counts.peopleCreated += 1;
        }

        for (const relationType of PRESETS[preset]) {
          const [existing] = await tx.select({ id: unitPersonRelations.id }).from(unitPersonRelations)
            .where(and(
              eq(unitPersonRelations.unitId, unit.id),
              eq(unitPersonRelations.personId, person.id),
              eq(unitPersonRelations.relationType, relationType),
              sql`${unitPersonRelations.endDate} IS NULL`,
            )).limit(1);
          if (!existing) {
            await tx.insert(unitPersonRelations).values({ unitId: unit.id, personId: person.id, relationType, shareLabel });
            counts.relationsCreated += 1;
          }
        }
        });
        result.unitsCreated += counts.unitsCreated;
        result.peopleCreated += counts.peopleCreated;
        result.relationsCreated += counts.relationsCreated;
      } catch (error: any) {
        result.skipped += 1;
        // Only our own validation messages are shown; database errors stay in the logs.
        const ownMessage = error instanceof HttpError || (error instanceof Error && error.constructor === Error && !("code" in error));
        if (!ownMessage) console.error("Ligne d’import en erreur:", error);
        result.errors.push({ row: sourceRow, message: ownMessage ? error.message : "Erreur d’enregistrement de cette ligne. Réessayez ou corrigez-la manuellement." });
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