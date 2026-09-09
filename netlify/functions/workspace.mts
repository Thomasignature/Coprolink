import type { Config } from "@netlify/functions";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  announcements, auditLog, buildingMembers, buildings, documents, events,
} from "../../db/schema.js";
import { authorize, jsonError, readBuildingSlug } from "../lib/auth.mts";
import {
  listBuildingTickets, loadTicketTimeline, serializePublicTicket, serializeTicket,
} from "../lib/data.mts";

/**
 * Charge en une requête tout ce dont l'espace copropriétaire ou l'espace syndic
 * a besoin, filtré selon les capacités réellement accordées au porteur.
 *
 * Le filtrage est fait ICI, côté serveur : le client ne reçoit jamais une donnée
 * qu'il devrait masquer lui-même.
 */
export default async (req: Request) => {
  try {
    const ctx = await authorize(req, {
      buildingSlug: readBuildingSlug(req),
      require: "building:read",
    });

    const [building] = await db.select().from(buildings).where(eq(buildings.id, ctx.buildingId)).limit(1);
    if (!building) return Response.json({ error: "Immeuble introuvable" }, { status: 404 });

    const canSeeAllTickets = ctx.can("tickets:read:all");
    const canSeePrivateDocs = ctx.can("documents:read:private");
    const canSeeAudit = ctx.can("audit:read");

    const allTickets = await listBuildingTickets(ctx.buildingId);
    const timelines = await loadTicketTimeline(allTickets.map((t) => t.id));

    const myUserId = ctx.principal.kind === "user" ? ctx.principal.userId : null;
    const myTickets = allTickets
      .filter((t) => t.reporterUserId === myUserId)
      .map((t) => serializeTicket(t, timelines.get(t.id) ?? []));

    // Un copropriétaire voit les interventions publiques de l'immeuble, mais en
    // vue publique : ni description libre, ni identité du signalant voisin.
    const buildingTickets = canSeeAllTickets
      ? allTickets.map((t) => serializeTicket(t, timelines.get(t.id) ?? []))
      : allTickets.filter((t) => t.isPublic).map((t) => serializePublicTicket(t, timelines.get(t.id) ?? []));

    const announcementRows = await db
      .select()
      .from(announcements)
      .where(eq(announcements.buildingId, ctx.buildingId))
      .orderBy(desc(announcements.publishedOn), desc(announcements.id));

    const eventRows = await db
      .select()
      .from(events)
      .where(eq(events.buildingId, ctx.buildingId))
      .orderBy(events.eventDate);

    const documentRows = await db
      .select()
      .from(documents)
      .where(
        canSeePrivateDocs
          ? eq(documents.buildingId, ctx.buildingId)
          : and(eq(documents.buildingId, ctx.buildingId), eq(documents.access, "public")),
      )
      .orderBy(desc(documents.updatedOn));

    const activity = canSeeAudit
      ? await db
          .select()
          .from(auditLog)
          .where(eq(auditLog.buildingId, ctx.buildingId))
          .orderBy(desc(auditLog.createdAt))
          .limit(25)
      : [];

    const [membership] = myUserId
      ? await db
          .select()
          .from(buildingMembers)
          .where(and(eq(buildingMembers.buildingId, ctx.buildingId), eq(buildingMembers.userId, myUserId)))
          .limit(1)
      : [];

    return Response.json(
      {
        role: ctx.role,
        capabilities: ctx.capabilities,
        building: {
          slug: building.slug,
          name: building.name,
          address: building.address,
          lots: building.lots,
          managerName: building.managerName,
          emergencyPhone: building.emergencyPhone,
          reserveFund: Number(building.reserveFund),
          yearlyBudget: Number(building.yearlyBudget),
          yearlySpent: Number(building.yearlySpent),
          healthScore: building.healthScore,
        },
        // Situation financière personnelle : jamais celle d'un autre lot.
        member: membership
          ? {
              unitLabel: membership.unitLabel,
              shareLabel: membership.shareLabel,
              quarterlyCall: Number(membership.quarterlyCall),
              balance: Number(membership.balance),
            }
          : null,
        myTickets,
        buildingTickets,
        announcements: announcementRows.map((a) => ({
          id: a.id,
          title: a.title,
          body: a.body,
          priority: a.priority,
          isPublic: a.isPublic,
          publishedOn: a.publishedOn,
        })),
        events: eventRows.map((e) => ({
          id: e.id,
          title: e.title,
          detail: e.detail,
          eventDate: e.eventDate,
          eventTime: e.eventTime,
          isPublic: e.isPublic,
        })),
        documents: documentRows.map((d) => ({
          id: d.id,
          name: d.name,
          fileType: d.fileType,
          access: d.access,
          updatedOn: d.updatedOn,
          // Le contenu binaire n'est pas encore stocké (Netlify Blobs à venir).
          available: d.storageKey !== null,
        })),
        activity: activity.map((a) => ({
          id: a.id,
          summary: a.summary,
          action: a.action,
          actorLabel: a.actorLabel,
          createdAt: a.createdAt.toISOString(),
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = {
  path: "/api/workspace",
  method: "GET",
};
