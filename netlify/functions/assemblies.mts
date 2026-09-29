import type { Config } from "@netlify/functions";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  assemblyAgendaItems, assemblyResponses, buildingPeople, generalAssemblies,
} from "../../db/schema-v3.js";
import { authorize, authorizeSyndicOperator, HttpError, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { readString, writeAudit } from "../lib/data.mts";

const RESPONSE_TYPES = ["present", "absent", "proxy"] as const;
type ResponseType = (typeof RESPONSE_TYPES)[number];

const readPositiveId = (value: unknown, label: string) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(422, `${label} invalide`);
  return id;
};

const readResponseType = (value: unknown): ResponseType => {
  if (typeof value !== "string" || !RESPONSE_TYPES.includes(value as ResponseType)) {
    throw new HttpError(422, "Réponse à l’assemblée invalide");
  }
  return value as ResponseType;
};

const getAssembly = async (buildingId: number, assemblyId: number) => {
  const [assembly] = await db.select().from(generalAssemblies)
    .where(and(eq(generalAssemblies.id, assemblyId), eq(generalAssemblies.buildingId, buildingId))).limit(1);
  if (!assembly) throw new HttpError(404, "Assemblée introuvable");
  return assembly;
};

const loadAssemblies = async (buildingId: number, userId: string | null) => {
  const rows = await db.select().from(generalAssemblies)
    .where(eq(generalAssemblies.buildingId, buildingId))
    .orderBy(desc(generalAssemblies.assemblyDate), desc(generalAssemblies.id));

  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [agendaRows, responseRows] = await Promise.all([
    db.select().from(assemblyAgendaItems).where(inArray(assemblyAgendaItems.assemblyId, ids)).orderBy(asc(assemblyAgendaItems.position), asc(assemblyAgendaItems.id)),
    db.select().from(assemblyResponses).where(inArray(assemblyResponses.assemblyId, ids)),
  ]);

  return rows.map((assembly) => {
    const responses = responseRows.filter((row) => row.assemblyId === assembly.id);
    const mine = userId ? responses.find((row) => row.userId === userId) ?? null : null;
    return {
      id: assembly.id,
      title: assembly.title,
      description: assembly.description,
      assemblyDate: assembly.assemblyDate,
      assemblyTime: assembly.assemblyTime,
      location: assembly.location,
      status: assembly.status,
      agenda: agendaRows.filter((row) => row.assemblyId === assembly.id).map((row) => ({
        id: row.id,
        position: row.position,
        title: row.title,
        description: row.description,
      })),
      summary: {
        responses: responses.length,
        present: responses.filter((row) => row.responseType === "present").length,
        proxy: responses.filter((row) => row.responseType === "proxy").length,
        absent: responses.filter((row) => row.responseType === "absent").length,
      },
      myResponse: mine ? { responseType: mine.responseType, proxyName: mine.proxyName, note: mine.note } : null,
    };
  });
};

export default async (req: Request) => {
  try {
    const buildingSlug = readBuildingSlug(req);
    const ctx = await authorize(req, { buildingSlug, require: "building:read" });
    if (ctx.principal.kind !== "user") throw new HttpError(403, "Compte utilisateur requis");

    if (req.method === "GET") {
      return Response.json({ assemblies: await loadAssemblies(ctx.buildingId, ctx.principal.userId) }, { headers: { "cache-control": "no-store" } });
    }

    if (req.method !== "POST") return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "create_assembly") {
      const syndic = await authorizeSyndicOperator(req, buildingSlug);
      const assemblyDate = readString(body.assemblyDate, "date", { max: 10 });
      const [created] = await db.insert(generalAssemblies).values({
        buildingId: syndic.buildingId,
        title: readString(body.title || "Assemblée générale", "titre", { max: 180 }),
        description: readString(body.description, "description", { max: 3000, required: false }),
        assemblyDate,
        assemblyTime: readString(body.assemblyTime, "heure", { max: 20, required: false }),
        location: readString(body.location, "lieu", { max: 240, required: false }),
        createdByUserId: syndic.principal.kind === "user" ? syndic.principal.userId : null,
      }).returning();
      await writeAudit(syndic, { action: "assembly.created", entityType: "general_assembly", entityId: created.id, summary: `${created.title} créée pour le ${created.assemblyDate}.` });
      return Response.json(created, { status: 201 });
    }

    if (action === "add_agenda_item") {
      const syndic = await authorizeSyndicOperator(req, buildingSlug);
      const assemblyId = readPositiveId(body.assemblyId, "assemblée");
      await getAssembly(syndic.buildingId, assemblyId);
      const [created] = await db.insert(assemblyAgendaItems).values({
        assemblyId,
        position: Number.isInteger(Number(body.position)) ? Number(body.position) : 0,
        title: readString(body.title, "point", { max: 240 }),
        description: readString(body.description, "description", { max: 3000, required: false }),
      }).returning();
      await writeAudit(syndic, { action: "assembly.agenda.added", entityType: "assembly_agenda_item", entityId: created.id, summary: `Point d’ordre du jour ajouté : ${created.title}.` });
      return Response.json(created, { status: 201 });
    }

    if (action === "respond") {
      const assemblyId = readPositiveId(body.assemblyId, "assemblée");
      await getAssembly(ctx.buildingId, assemblyId);
      const [person] = await db.select().from(buildingPeople)
        .where(and(eq(buildingPeople.buildingId, ctx.buildingId), eq(buildingPeople.userId, ctx.principal.userId))).limit(1);
      if (!person) throw new HttpError(422, "Votre compte n’est pas encore lié à une personne de l’immeuble");
      const responseType = readResponseType(body.responseType);
      const proxyName = responseType === "proxy" ? readString(body.proxyName, "mandataire", { max: 160 }) : "";
      const note = readString(body.note, "note", { max: 1000, required: false });
      const [saved] = await db.insert(assemblyResponses).values({
        assemblyId,
        personId: person.id,
        userId: ctx.principal.userId,
        responseType,
        proxyName,
        note,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [assemblyResponses.assemblyId, assemblyResponses.personId],
        set: { userId: ctx.principal.userId, responseType, proxyName, note, updatedAt: new Date() },
      }).returning();
      await writeAudit(ctx, { action: "assembly.response.updated", entityType: "assembly_response", entityId: saved.id, summary: `${person.fullName} a répondu à l’assemblée (${responseType}).` });
      return Response.json(saved, { status: 201 });
    }

    throw new HttpError(422, "Action d’assemblée inconnue");
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = {
  path: "/api/assemblies",
};