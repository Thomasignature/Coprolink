import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  auditLog, ticketUpdates, tickets, TICKET_STATUSES, type TicketStatus,
} from "../../db/schema.js";
import { HttpError, type AuthContext } from "./auth.mts";

/** Libellé de suite par défaut, contrôlé côté serveur (jamais fourni par le client). */
export const STATUS_NEXT_STEP: Record<TicketStatus, string> = {
  new: "En attente de prise en charge",
  in_progress: "Traitement en cours",
  waiting: "En attente d'un tiers",
  scheduled: "Intervention planifiée",
  resolved: "Dossier clôturé",
};

const STATUS_TIMELINE_LABEL: Record<TicketStatus, string> = {
  new: "Signalé",
  in_progress: "Pris en charge",
  waiting: "En attente d'un tiers",
  scheduled: "Rendez-vous confirmé",
  resolved: "Résolu",
};

export const assertTicketStatus = (value: unknown): TicketStatus => {
  if (typeof value !== "string" || !TICKET_STATUSES.includes(value as TicketStatus)) {
    throw new HttpError(422, "Statut de ticket invalide");
  }
  return value as TicketStatus;
};

export const readString = (value: unknown, field: string, { max = 500, required = true } = {}) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    if (required) throw new HttpError(422, `Champ « ${field} » manquant`);
    return "";
  }
  return value.trim().slice(0, max);
};

/** Journal d'audit. Append-only : c'est la mémoire de l'immeuble. */
export const writeAudit = async (
  ctx: AuthContext,
  entry: { action: string; entityType: string; entityId: string | number; summary: string },
) => {
  await db.insert(auditLog).values({
    buildingId: ctx.buildingId,
    actorUserId: ctx.principal.kind === "user" ? ctx.principal.userId : null,
    actorLabel: ctx.actorLabel,
    actorRole: ctx.role ?? "terminal",
    action: entry.action,
    entityType: entry.entityType,
    entityId: String(entry.entityId),
    summary: entry.summary,
  });
};

/**
 * Crée un ticket et sa première ligne d'historique. La référence est dérivée de
 * l'identifiant attribué par Postgres, ce qui la rend unique sans condition de
 * course (contrairement à un compteur calculé côté client).
 */
export const createTicket = async (
  ctx: AuthContext,
  input: { title: string; category: string; location: string; description: string; isPublic: boolean },
) => {
  const placeholder = `pending-${crypto.randomUUID()}`;
  const [inserted] = await db
    .insert(tickets)
    .values({
      reference: placeholder,
      buildingId: ctx.buildingId,
      title: input.title,
      category: input.category,
      location: input.location,
      description: input.description,
      status: "new",
      isPublic: input.isPublic,
      reporterLabel: ctx.actorLabel,
      reporterUserId: ctx.principal.kind === "user" ? ctx.principal.userId : null,
      reporterTerminalId: ctx.principal.kind === "terminal" ? ctx.principal.terminalId : null,
      nextStep: STATUS_NEXT_STEP.new,
    })
    .returning();

  const [ticket] = await db
    .update(tickets)
    .set({ reference: `T-${1000 + inserted.id}` })
    .where(eq(tickets.id, inserted.id))
    .returning();

  await db.insert(ticketUpdates).values({
    ticketId: ticket.id,
    label: STATUS_TIMELINE_LABEL.new,
    toStatus: "new",
    authorUserId: ctx.principal.kind === "user" ? ctx.principal.userId : null,
    authorLabel: ctx.actorLabel,
  });

  await writeAudit(ctx, {
    action: "ticket.created",
    entityType: "ticket",
    entityId: ticket.reference,
    summary: `Nouveau signalement ${ticket.reference} : ${ticket.title}.`,
  });

  return ticket;
};

/**
 * Change le statut d'un ticket ET écrit la ligne d'historique correspondante.
 * L'historique n'est jamais réécrit : chaque transition ajoute une ligne.
 */
export const changeTicketStatus = async (
  ctx: AuthContext,
  reference: string,
  nextStatus: TicketStatus,
  note: string,
) => {
  const [existing] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.reference, reference), eq(tickets.buildingId, ctx.buildingId)))
    .limit(1);

  if (!existing) throw new HttpError(404, "Ticket introuvable");

  const [updated] = await db
    .update(tickets)
    .set({ status: nextStatus, nextStep: STATUS_NEXT_STEP[nextStatus], updatedAt: new Date() })
    .where(eq(tickets.id, existing.id))
    .returning();

  if (existing.status !== nextStatus) {
    await db.insert(ticketUpdates).values({
      ticketId: existing.id,
      label: STATUS_TIMELINE_LABEL[nextStatus],
      note,
      fromStatus: existing.status,
      toStatus: nextStatus,
      authorUserId: ctx.principal.kind === "user" ? ctx.principal.userId : null,
      authorLabel: ctx.actorLabel,
    });

    await writeAudit(ctx, {
      action: "ticket.status_changed",
      entityType: "ticket",
      entityId: reference,
      summary: `Le ticket ${reference} est passé de « ${existing.status} » à « ${nextStatus} ».`,
    });
  }

  return updated;
};

export const loadTicketTimeline = async (ticketIds: number[]) => {
  if (ticketIds.length === 0) return new Map<number, { label: string; date: string; note: string }[]>();

  const rows = await db
    .select()
    .from(ticketUpdates)
    .where(inArray(ticketUpdates.ticketId, ticketIds))
    .orderBy(asc(ticketUpdates.createdAt));

  const grouped = new Map<number, { label: string; date: string; note: string }[]>();
  for (const row of rows) {
    const list = grouped.get(row.ticketId) ?? [];
    list.push({
      label: row.label,
      date: row.createdAt.toISOString(),
      note: row.note,
    });
    grouped.set(row.ticketId, list);
  }
  return grouped;
};

type TicketRow = typeof tickets.$inferSelect;
type Timeline = { label: string; date: string; note: string }[];

/** Vue complète d'un ticket. Réservée aux porteurs authentifiés autorisés. */
export const serializeTicket = (row: TicketRow, timeline: Timeline = []) => ({
  reference: row.reference,
  title: row.title,
  category: row.category,
  location: row.location,
  description: row.description,
  status: row.status,
  isPublic: row.isPublic,
  reporterLabel: row.reporterLabel,
  nextStep: row.nextStep,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  timeline,
});

/**
 * Vue publique d'un ticket, pour l'écran des communs.
 *
 * Exclut délibérément `description` et `reporterLabel` : ce sont des champs de
 * texte libre saisis par des occupants, qui peuvent contenir des données
 * nominatives. L'écran du hall n'affiche que des champs maîtrisés.
 */
export const serializePublicTicket = (row: TicketRow, timeline: Timeline = []) => ({
  reference: row.reference,
  title: row.title,
  category: row.category,
  location: row.location,
  status: row.status,
  nextStep: row.nextStep,
  createdAt: row.createdAt.toISOString(),
  timeline: timeline.map((step) => ({ label: step.label, date: step.date })),
});

export const listBuildingTickets = async (buildingId: number, options: { onlyPublic?: boolean } = {}) => {
  const conditions = options.onlyPublic
    ? and(eq(tickets.buildingId, buildingId), eq(tickets.isPublic, true))
    : eq(tickets.buildingId, buildingId);

  return db.select().from(tickets).where(conditions).orderBy(desc(tickets.createdAt));
};
