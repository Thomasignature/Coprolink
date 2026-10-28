import type { Config } from "@netlify/functions";
import { desc, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { auditLog, buildings, documents, events, tickets } from "../../db/schema.js";
import { HttpError, jsonError, listMemberships, requireUser } from "../lib/auth.mts";

const isOpen = (status: string) => status !== "resolved";

const toTime = (value: unknown) => {
  if (value instanceof Date) return value.getTime();
  const text = String(value ?? "");
  const parsed = Date.parse(text.length === 10 ? `${text}T12:00:00` : text);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
};

const statusForBuilding = (openCount: number, attentionCount: number, healthScore: number) => {
  if (attentionCount > 0 || (healthScore > 0 && healthScore < 60)) return "action";
  if (openCount >= 3 || (healthScore > 0 && healthScore < 80)) return "watch";
  return "ok";
};

export default async (req: Request) => {
  try {
    const principal = await requireUser(req);
    const memberships = await listMemberships(principal.userId);
    const managerMemberships = memberships.filter((membership) => membership.role === "manager");

    if (!principal.isPlatformAdmin && managerMemberships.length === 0) {
      throw new HttpError(403, "Aucune copropriété administrée");
    }

    const managedIds = managerMemberships.map((membership) => membership.buildingId);
    const buildingRows = principal.isPlatformAdmin
      ? await db.select().from(buildings).orderBy(buildings.name)
      : await db.select().from(buildings).where(inArray(buildings.id, managedIds)).orderBy(buildings.name);

    if (buildingRows.length === 0) {
      return Response.json(
        {
          summary: { buildings: 0, attention: 0, upcoming: 0, openTickets: 0 },
          buildings: [], tickets: [], documents: [], events: [], priority: [], upcoming: [], activity: [],
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const ids = buildingRows.map((building) => building.id);
    const [ticketRows, eventRows, documentRows, activityRows] = await Promise.all([
      db.select().from(tickets).where(inArray(tickets.buildingId, ids)).orderBy(desc(tickets.updatedAt)),
      db.select().from(events).where(inArray(events.buildingId, ids)).orderBy(events.eventDate),
      db.select().from(documents).where(inArray(documents.buildingId, ids)).orderBy(desc(documents.updatedOn)),
      db.select().from(auditLog).where(inArray(auditLog.buildingId, ids)).orderBy(desc(auditLog.createdAt)).limit(30),
    ]);

    const buildingMap = new Map(buildingRows.map((building) => [building.id, building]));
    const now = Date.now();
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;

    const portfolio = buildingRows.map((building) => {
      const buildingTickets = ticketRows.filter((ticket) => ticket.buildingId === building.id);
      const openTickets = buildingTickets.filter((ticket) => isOpen(ticket.status));
      const attentionTickets = openTickets.filter((ticket) => ticket.status === "new" || ticket.status === "waiting");
      const nextEvent = eventRows
        .filter((event) => event.buildingId === building.id && toTime(event.eventDate) >= now - 24 * 60 * 60 * 1000)
        .sort((a, b) => toTime(a.eventDate) - toTime(b.eventDate))[0] ?? null;

      return {
        id: building.id,
        slug: building.slug,
        name: building.name,
        address: building.address,
        lots: building.lots,
        managerName: building.managerName,
        healthScore: building.healthScore,
        status: statusForBuilding(openTickets.length, attentionTickets.length, building.healthScore),
        openTickets: openTickets.length,
        attentionTickets: attentionTickets.length,
        documents: documentRows.filter((document) => document.buildingId === building.id).length,
        nextEvent: nextEvent
          ? { id: nextEvent.id, title: nextEvent.title, eventDate: nextEvent.eventDate, eventTime: nextEvent.eventTime }
          : null,
      };
    });

    const allTickets = ticketRows.map((ticket) => ({
      id: ticket.id,
      reference: ticket.reference,
      buildingId: ticket.buildingId,
      buildingSlug: buildingMap.get(ticket.buildingId)?.slug ?? "",
      buildingName: buildingMap.get(ticket.buildingId)?.name ?? "",
      title: ticket.title,
      location: ticket.location,
      status: ticket.status,
      nextStep: ticket.nextStep,
      updatedAt: ticket.updatedAt.toISOString(),
    }));

    const priorityTickets = allTickets
      .filter((ticket) => isOpen(ticket.status))
      .sort((a, b) => {
        const rank = (status: string) => status === "new" ? 0 : status === "waiting" ? 1 : status === "scheduled" ? 2 : 3;
        return rank(a.status) - rank(b.status) || toTime(b.updatedAt) - toTime(a.updatedAt);
      })
      .slice(0, 6)
      .map((ticket) => ({ ...ticket, type: "ticket" }));

    const futureEvents = eventRows
      .filter((event) => toTime(event.eventDate) >= now - 24 * 60 * 60 * 1000)
      .map((event) => ({
        id: event.id,
        buildingId: event.buildingId,
        buildingSlug: buildingMap.get(event.buildingId)?.slug ?? "",
        buildingName: buildingMap.get(event.buildingId)?.name ?? "",
        title: event.title,
        detail: event.detail,
        eventDate: event.eventDate,
        eventTime: event.eventTime,
        isPublic: event.isPublic,
      }));

    const upcoming = futureEvents.filter((event) => toTime(event.eventDate) <= now + 60 * 24 * 60 * 60 * 1000).slice(0, 8);

    const allDocuments = documentRows.map((document) => ({
      id: document.id,
      buildingId: document.buildingId,
      buildingSlug: buildingMap.get(document.buildingId)?.slug ?? "",
      buildingName: buildingMap.get(document.buildingId)?.name ?? "",
      name: document.name,
      fileType: document.fileType,
      access: document.access,
      hasFile: Boolean(document.storageKey),
      updatedOn: document.updatedOn,
    }));

    const activity = activityRows.map((item) => ({
      id: item.id,
      buildingId: item.buildingId,
      buildingSlug: item.buildingId ? (buildingMap.get(item.buildingId)?.slug ?? "") : "",
      buildingName: item.buildingId ? (buildingMap.get(item.buildingId)?.name ?? "") : "",
      summary: item.summary,
      action: item.action,
      actorLabel: item.actorLabel,
      createdAt: item.createdAt.toISOString(),
    }));

    const attention = portfolio.reduce((sum, building) => sum + building.attentionTickets, 0);
    const openTickets = portfolio.reduce((sum, building) => sum + building.openTickets, 0);
    const upcomingSoon = eventRows.filter((event) => {
      const time = toTime(event.eventDate);
      return time >= now - 24 * 60 * 60 * 1000 && time <= now + fourteenDays;
    }).length;

    return Response.json(
      {
        summary: { buildings: portfolio.length, attention, upcoming: upcomingSoon, openTickets },
        buildings: portfolio,
        tickets: allTickets,
        documents: allDocuments,
        events: futureEvents,
        priority: priorityTickets,
        upcoming,
        activity,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = {
  path: "/api/manager-dashboard",
  method: "GET",
};
