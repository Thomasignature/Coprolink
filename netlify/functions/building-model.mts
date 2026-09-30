import type { Config } from "@netlify/functions";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { buildingMembers } from "../../db/schema.js";
import {
  assemblyResponses, buildingPeople, buildingProfessionals, buildingReferents, buildingUnits,
  personVisibilityPreferences, PROFESSIONAL_TYPES, RELATION_TYPES, unitPersonRelations,
  type ProfessionalType, type RelationType,
} from "../../db/schema-v3.js";
import { authorizeCoproLinkAdmin, authorizeSyndicOperator, HttpError, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { readString, writeAudit } from "../lib/data.mts";
import { canPermanentlyDeletePerson, isIsoDate, readEndReason, shouldRevokeBuildingAccess } from "../lib/lifecycle-policy.mts";

const readId = (value: unknown, field = "id") => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(422, `${field} invalide`);
  return id;
};

const optionalString = (value: unknown, field: string, max = 200) =>
  readString(value, field, { max, required: false });

const assertRelationType = (value: unknown): RelationType => {
  if (typeof value !== "string" || !RELATION_TYPES.includes(value as RelationType)) throw new HttpError(422, "Lien au lot invalide");
  return value as RelationType;
};

const assertProfessionalType = (value: unknown): ProfessionalType => {
  if (typeof value !== "string" || !PROFESSIONAL_TYPES.includes(value as ProfessionalType)) throw new HttpError(422, "Type de professionnel invalide");
  return value as ProfessionalType;
};

const readModel = async (buildingId: number) => {
  const units = await db.select().from(buildingUnits)
    .where(eq(buildingUnits.buildingId, buildingId))
    .orderBy(asc(buildingUnits.displayOrder), asc(buildingUnits.label));

  const people = await db.select().from(buildingPeople)
    .where(eq(buildingPeople.buildingId, buildingId))
    .orderBy(asc(buildingPeople.fullName));

  const relations = await db.select({
    id: unitPersonRelations.id,
    unitId: unitPersonRelations.unitId,
    personId: unitPersonRelations.personId,
    relationType: unitPersonRelations.relationType,
    shareLabel: unitPersonRelations.shareLabel,
    startDate: unitPersonRelations.startDate,
    endDate: unitPersonRelations.endDate,
    endReason: unitPersonRelations.endReason,
  }).from(unitPersonRelations)
    .innerJoin(buildingUnits, eq(unitPersonRelations.unitId, buildingUnits.id))
    .where(eq(buildingUnits.buildingId, buildingId));

  const referents = await db.select().from(buildingReferents)
    .where(eq(buildingReferents.buildingId, buildingId));

  const professionals = await db.select().from(buildingProfessionals)
    .where(eq(buildingProfessionals.buildingId, buildingId))
    .orderBy(asc(buildingProfessionals.professionalType), asc(buildingProfessionals.organizationName));

  const visibility = people.length ? await db.select().from(personVisibilityPreferences) : [];
  const allowedPersonIds = new Set(people.map((person) => person.id));

  return {
    version: 3,
    units,
    people,
    relations,
    referents,
    professionals,
    visibility: visibility.filter((item) => allowedPersonIds.has(item.personId)),
  };
};

const assertUnitInBuilding = async (buildingId: number, unitId: number) => {
  const [unit] = await db.select().from(buildingUnits)
    .where(and(eq(buildingUnits.id, unitId), eq(buildingUnits.buildingId, buildingId))).limit(1);
  if (!unit) throw new HttpError(404, "Lot introuvable");
  return unit;
};

const assertPersonInBuilding = async (buildingId: number, personId: number) => {
  const [person] = await db.select().from(buildingPeople)
    .where(and(eq(buildingPeople.id, personId), eq(buildingPeople.buildingId, buildingId))).limit(1);
  if (!person) throw new HttpError(404, "Personne introuvable");
  return person;
};

export default async (req: Request) => {
  try {
    const buildingSlug = readBuildingSlug(req);
    const ctx = req.method === "GET"
      ? await authorizeCoproLinkAdmin(req, buildingSlug)
      : await authorizeSyndicOperator(req, buildingSlug);
    const url = new URL(req.url);

    if (req.method === "GET") return Response.json(await readModel(ctx.buildingId), { headers: { "cache-control": "no-store" } });

    const body = await req.json().catch(() => ({}));
    const entity = String(body.entity ?? url.searchParams.get("entity") ?? "");

    if (req.method === "POST") {
      if (entity === "unit") {
        const label = readString(body.label, "lot", { max: 80 });
        const [created] = await db.insert(buildingUnits).values({
          buildingId: ctx.buildingId,
          label,
          floor: optionalString(body.floor, "étage", 40),
          displayOrder: Number.isInteger(Number(body.displayOrder)) ? Number(body.displayOrder) : 0,
          shareLabel: optionalString(body.shareLabel, "quotité", 40),
        }).returning();
        await writeAudit(ctx, { action: "unit.created", entityType: "building_unit", entityId: created.id, summary: `Lot ${created.label} créé.` });
        return Response.json(created, { status: 201 });
      }

      if (entity === "person") {
        const [created] = await db.insert(buildingPeople).values({
          buildingId: ctx.buildingId,
          fullName: readString(body.fullName, "nom", { max: 120 }),
          email: optionalString(body.email, "e-mail", 200).toLowerCase(),
          phone: optionalString(body.phone, "téléphone", 40),
          userId: typeof body.userId === "string" && body.userId.trim() ? body.userId.trim() : null,
        }).returning();
        await db.insert(personVisibilityPreferences).values({
          personId: created.id,
          directoryVisible: body.directoryVisible !== false,
          hallVisible: body.hallVisible === true,
          showEmail: body.showEmail === true,
          showPhone: body.showPhone === true,
        }).onConflictDoNothing();
        await writeAudit(ctx, { action: "person.created", entityType: "building_person", entityId: created.id, summary: `${created.fullName} ajouté à l’immeuble.` });
        return Response.json(created, { status: 201 });
      }

      if (entity === "relation") {
        const unitId = readId(body.unitId, "lot");
        const personId = readId(body.personId, "personne");
        await assertUnitInBuilding(ctx.buildingId, unitId);
        await assertPersonInBuilding(ctx.buildingId, personId);
        const relationType = assertRelationType(body.relationType);
        const [created] = await db.insert(unitPersonRelations).values({
          unitId,
          personId,
          relationType,
          shareLabel: optionalString(body.shareLabel, "quotité", 40),
          startDate: typeof body.startDate === "string" && body.startDate ? body.startDate : null,
        }).returning();
        await writeAudit(ctx, { action: "relation.created", entityType: "unit_person_relation", entityId: created.id, summary: `Lien ${relationType} ajouté au lot.` });
        return Response.json(created, { status: 201 });
      }

      if (entity === "referent") {
        const personId = readId(body.personId, "personne");
        await assertPersonInBuilding(ctx.buildingId, personId);
        const [created] = await db.insert(buildingReferents).values({ buildingId: ctx.buildingId, personId, isPrimary: body.isPrimary === true }).returning();
        await writeAudit(ctx, { action: "referent.created", entityType: "building_referent", entityId: created.id, summary: "Référent CoproLink désigné." });
        return Response.json(created, { status: 201 });
      }

      if (entity === "professional") {
        const professionalType = assertProfessionalType(body.professionalType);
        const [created] = await db.insert(buildingProfessionals).values({
          buildingId: ctx.buildingId,
          professionalType,
          organizationName: optionalString(body.organizationName, "organisation", 160),
          contactName: optionalString(body.contactName, "contact", 120),
          email: optionalString(body.email, "e-mail", 200).toLowerCase(),
          phone: optionalString(body.phone, "téléphone", 40),
          startedAt: typeof body.startedAt === "string" && body.startedAt ? body.startedAt : null,
        }).returning();
        await writeAudit(ctx, { action: "professional.created", entityType: "building_professional", entityId: created.id, summary: `Professionnel ${created.organizationName || created.contactName || professionalType} ajouté.` });
        return Response.json(created, { status: 201 });
      }

      throw new HttpError(422, "Type d’élément V3 inconnu");
    }

    const id = readId(body.id ?? url.searchParams.get("id"));

    if (req.method === "PATCH") {
      if (entity === "unit") {
        await assertUnitInBuilding(ctx.buildingId, id);
        const [updated] = await db.update(buildingUnits).set({
          ...(body.label !== undefined ? { label: readString(body.label, "lot", { max: 80 }) } : {}),
          ...(body.floor !== undefined ? { floor: optionalString(body.floor, "étage", 40) } : {}),
          ...(body.shareLabel !== undefined ? { shareLabel: optionalString(body.shareLabel, "quotité", 40) } : {}),
          ...(body.displayOrder !== undefined && Number.isInteger(Number(body.displayOrder)) ? { displayOrder: Number(body.displayOrder) } : {}),
          updatedAt: new Date(),
        }).where(and(eq(buildingUnits.id, id), eq(buildingUnits.buildingId, ctx.buildingId))).returning();
        return Response.json(updated);
      }

      if (entity === "person") {
        await assertPersonInBuilding(ctx.buildingId, id);
        const [updated] = await db.update(buildingPeople).set({
          ...(body.fullName !== undefined ? { fullName: readString(body.fullName, "nom", { max: 120 }) } : {}),
          ...(body.email !== undefined ? { email: optionalString(body.email, "e-mail", 200).toLowerCase() } : {}),
          ...(body.phone !== undefined ? { phone: optionalString(body.phone, "téléphone", 40) } : {}),
          updatedAt: new Date(),
        }).where(and(eq(buildingPeople.id, id), eq(buildingPeople.buildingId, ctx.buildingId))).returning();
        if (["directoryVisible", "hallVisible", "showEmail", "showPhone"].some((key) => body[key] !== undefined)) {
          await db.insert(personVisibilityPreferences).values({
            personId: id,
            directoryVisible: body.directoryVisible !== false,
            hallVisible: body.hallVisible === true,
            showEmail: body.showEmail === true,
            showPhone: body.showPhone === true,
            updatedAt: new Date(),
          }).onConflictDoUpdate({ target: personVisibilityPreferences.personId, set: {
            ...(body.directoryVisible !== undefined ? { directoryVisible: body.directoryVisible === true } : {}),
            ...(body.hallVisible !== undefined ? { hallVisible: body.hallVisible === true } : {}),
            ...(body.showEmail !== undefined ? { showEmail: body.showEmail === true } : {}),
            ...(body.showPhone !== undefined ? { showPhone: body.showPhone === true } : {}),
            updatedAt: new Date(),
          }});
        }
        return Response.json(updated);
      }

      if (entity === "relation") {
        const [relation] = await db.select().from(unitPersonRelations).where(eq(unitPersonRelations.id, id)).limit(1);
        if (!relation) throw new HttpError(404, "Lien introuvable");
        await assertUnitInBuilding(ctx.buildingId, relation.unitId);
        const ending = body.endDate !== undefined && body.endDate !== null && body.endDate !== "";
        if (ending && !isIsoDate(body.endDate)) throw new HttpError(422, "Date de fin invalide");
        let endReason = "";
        if (ending) {
          try { endReason = readEndReason(body.endReason); } catch { throw new HttpError(422, "Motif de fin invalide"); }
        }
        const [updated] = await db.transaction(async (tx) => {
          const [result] = await tx.update(unitPersonRelations).set({
          ...(body.relationType !== undefined ? { relationType: assertRelationType(body.relationType) } : {}),
          ...(body.shareLabel !== undefined ? { shareLabel: optionalString(body.shareLabel, "quotité", 40) } : {}),
          ...(body.endDate !== undefined ? { endDate: ending ? body.endDate : null, endReason: ending ? endReason : "" } : {}),
          }).where(eq(unitPersonRelations.id, id)).returning();

          if (ending) {
            const [{ value: activeRelations }] = await tx.select({ value: count() }).from(unitPersonRelations)
              .innerJoin(buildingUnits, eq(unitPersonRelations.unitId, buildingUnits.id))
              .where(and(
                eq(unitPersonRelations.personId, relation.personId),
                eq(buildingUnits.buildingId, ctx.buildingId),
                isNull(unitPersonRelations.endDate),
              ));
            const person = await assertPersonInBuilding(ctx.buildingId, relation.personId);
            if (person.userId && shouldRevokeBuildingAccess(activeRelations)) {
              await tx.update(buildingMembers).set({ endedAt: new Date(), endedReason: endReason })
                .where(and(
                  eq(buildingMembers.buildingId, ctx.buildingId),
                  eq(buildingMembers.userId, person.userId),
                  eq(buildingMembers.role, "resident"),
                  isNull(buildingMembers.endedAt),
                ));
            }
          }
          return [result];
        });
        if (ending) await writeAudit(ctx, { action: "person_relation.ended", entityType: "unit_person_relation", entityId: id, summary: `Relation terminée le ${body.endDate}.` });
        return Response.json(updated);
      }

      if (entity === "referent") {
        const [existing] = await db.select().from(buildingReferents)
          .where(and(eq(buildingReferents.id, id), eq(buildingReferents.buildingId, ctx.buildingId))).limit(1);
        if (!existing) throw new HttpError(404, "Référent introuvable");
        const [updated] = await db.update(buildingReferents).set({
          ...(body.isPrimary !== undefined ? { isPrimary: body.isPrimary === true } : {}),
          ...(body.ended === true ? { endedAt: new Date() } : {}),
        }).where(eq(buildingReferents.id, id)).returning();
        return Response.json(updated);
      }

      if (entity === "professional") {
        const [existing] = await db.select().from(buildingProfessionals)
          .where(and(eq(buildingProfessionals.id, id), eq(buildingProfessionals.buildingId, ctx.buildingId))).limit(1);
        if (!existing) throw new HttpError(404, "Professionnel introuvable");
        const endingSyndic = existing.professionalType === "syndic" && body.endedAt !== undefined && body.endedAt !== null && body.endedAt !== "";
        if (endingSyndic && !isIsoDate(body.endedAt)) throw new HttpError(422, "Date de fin de mandat invalide");
        const [updated] = await db.transaction(async (tx) => {
          const [result] = await tx.update(buildingProfessionals).set({
          ...(body.professionalType !== undefined ? { professionalType: assertProfessionalType(body.professionalType) } : {}),
          ...(body.organizationName !== undefined ? { organizationName: optionalString(body.organizationName, "organisation", 160) } : {}),
          ...(body.contactName !== undefined ? { contactName: optionalString(body.contactName, "contact", 120) } : {}),
          ...(body.email !== undefined ? { email: optionalString(body.email, "e-mail", 200).toLowerCase() } : {}),
          ...(body.phone !== undefined ? { phone: optionalString(body.phone, "téléphone", 40) } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive === true } : {}),
          ...(body.endedAt !== undefined ? { endedAt: typeof body.endedAt === "string" && body.endedAt ? body.endedAt : null } : {}),
          ...(endingSyndic ? { endReason: optionalString(body.endReason, "motif", 200), isActive: false } : {}),
          }).where(eq(buildingProfessionals.id, id)).returning();
          if (endingSyndic && existing.userId) {
            await tx.update(buildingMembers).set({ endedAt: new Date(`${body.endedAt}T12:00:00Z`), endedReason: optionalString(body.endReason, "motif", 200) })
              .where(and(eq(buildingMembers.buildingId, ctx.buildingId), eq(buildingMembers.userId, existing.userId), eq(buildingMembers.role, "manager"), isNull(buildingMembers.endedAt)));
          }
          return [result];
        });
        if (endingSyndic) await writeAudit(ctx, { action: "syndic.mandate_ended", entityType: "building_professional", entityId: id, summary: `Mandat syndic terminé le ${body.endedAt}.` });
        return Response.json(updated);
      }

      throw new HttpError(422, "Type d’élément V3 inconnu");
    }

    if (req.method === "DELETE") {
      if (entity === "unit") {
        await assertUnitInBuilding(ctx.buildingId, id);
        const [{ value: relations }] = await db.select({ value: count() }).from(unitPersonRelations).where(eq(unitPersonRelations.unitId, id));
        if (relations > 0) throw new HttpError(409, "Ce lot possède un historique et ne peut pas être supprimé.");
        await db.delete(buildingUnits).where(and(eq(buildingUnits.id, id), eq(buildingUnits.buildingId, ctx.buildingId)));
      } else if (entity === "person") {
        const person = await assertPersonInBuilding(ctx.buildingId, id);
        const [[{ value: relations }], [{ value: referents }], [{ value: responses }], [{ value: activeAccess }]] = await Promise.all([
          db.select({ value: count() }).from(unitPersonRelations).where(eq(unitPersonRelations.personId, id)),
          db.select({ value: count() }).from(buildingReferents).where(eq(buildingReferents.personId, id)),
          db.select({ value: count() }).from(assemblyResponses).where(eq(assemblyResponses.personId, id)),
          person.userId
            ? db.select({ value: count() }).from(buildingMembers).where(and(eq(buildingMembers.buildingId, ctx.buildingId), eq(buildingMembers.userId, person.userId), isNull(buildingMembers.endedAt)))
            : Promise.resolve([{ value: 0 }]),
        ]);
        if (!canPermanentlyDeletePerson({ relations, referents, assemblyResponses: responses, activeAccess })) {
          throw new HttpError(409, "Cette personne possède un historique. Mettez plutôt fin à sa relation.");
        }
        await db.delete(buildingPeople).where(and(eq(buildingPeople.id, id), eq(buildingPeople.buildingId, ctx.buildingId)));
      } else if (entity === "relation") {
        const [relation] = await db.select().from(unitPersonRelations).where(eq(unitPersonRelations.id, id)).limit(1);
        if (!relation) throw new HttpError(404, "Lien introuvable");
        await assertUnitInBuilding(ctx.buildingId, relation.unitId);
        throw new HttpError(409, "Une relation historique ne peut pas être supprimée. Indiquez une date et un motif de fin.");
      } else if (entity === "referent") {
        await db.update(buildingReferents).set({ endedAt: new Date() })
          .where(and(eq(buildingReferents.id, id), eq(buildingReferents.buildingId, ctx.buildingId)));
      } else if (entity === "professional") {
        await db.update(buildingProfessionals).set({ isActive: false, endedAt: new Date().toISOString().slice(0, 10) })
          .where(and(eq(buildingProfessionals.id, id), eq(buildingProfessionals.buildingId, ctx.buildingId)));
      } else {
        throw new HttpError(422, "Type d’élément V3 inconnu");
      }
      await writeAudit(ctx, { action: `${entity}.removed`, entityType: entity, entityId: id, summary: `Élément ${entity} retiré du modèle V3.` });
      return new Response(null, { status: 204 });
    }

    return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = { path: "/api/building-model" };
