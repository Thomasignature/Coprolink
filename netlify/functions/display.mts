import type { Config } from "@netlify/functions";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { announcements, buildings, documents, events } from "../../db/schema.js";
import { authorize, jsonError } from "../lib/auth.mts";
import { listBuildingTickets, loadTicketTimeline, serializePublicTicket } from "../lib/data.mts";

/**
 * Charge utile de l'écran installé dans les communs.
 *
 * Accessible UNIQUEMENT avec un jeton de terminal : la capacité `display:read`
 * n'est accordée à aucun rôle utilisateur, donc une session copropriétaire ou
 * syndic reçoit un 403 sur cet endpoint. La tablette n'emprunte jamais les
 * droits d'un compte resté connecté sur l'appareil.
 *
 * Rien de nominatif ne sort d'ici : pas de nom, pas de lot, pas de solde, pas
 * de document privé, pas de description libre saisie par un occupant.
 */
export default async (req: Request) => {
  try {
    const ctx = await authorize(req, { require: "display:read" });

    const [building] = await db.select().from(buildings).where(eq(buildings.id, ctx.buildingId)).limit(1);
    if (!building) return Response.json({ error: "Immeuble introuvable" }, { status: 404 });

    const publicTickets = (await listBuildingTickets(ctx.buildingId, { onlyPublic: true }))
      .filter((t) => t.status !== "resolved");
    const timelines = await loadTicketTimeline(publicTickets.map((t) => t.id));

    const publicAnnouncements = await db
      .select()
      .from(announcements)
      .where(and(eq(announcements.buildingId, ctx.buildingId), eq(announcements.isPublic, true)))
      .orderBy(desc(announcements.publishedOn), desc(announcements.id))
      .limit(5);

    const publicEvents = await db
      .select()
      .from(events)
      .where(and(eq(events.buildingId, ctx.buildingId), eq(events.isPublic, true)))
      .orderBy(asc(events.eventDate))
      .limit(12);

    const publicDocuments = await db
      .select()
      .from(documents)
      .where(and(eq(documents.buildingId, ctx.buildingId), eq(documents.access, "public")))
      .orderBy(desc(documents.updatedOn));

    return Response.json(
      {
        terminal: { label: ctx.principal.kind === "terminal" ? ctx.principal.label : "", canReport: ctx.can("tickets:create") },
        building: { name: building.name, address: building.address, emergencyPhone: building.emergencyPhone },
        tickets: publicTickets.map((t) => serializePublicTicket(t, timelines.get(t.id) ?? [])),
        announcements: publicAnnouncements.map((a) => ({
          id: a.id,
          title: a.title,
          body: a.body,
          priority: a.priority,
          publishedOn: a.publishedOn,
        })),
        events: publicEvents.map((e) => ({
          id: e.id,
          title: e.title,
          detail: e.detail,
          eventDate: e.eventDate,
          eventTime: e.eventTime,
        })),
        documents: publicDocuments.map((d) => ({
          id: d.id,
          name: d.name,
          fileType: d.fileType,
          updatedOn: d.updatedOn,
          available: d.storageKey !== null,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = {
  path: "/api/display",
  method: "GET",
};
