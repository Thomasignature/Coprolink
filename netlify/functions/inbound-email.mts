import type { Config } from "@netlify/functions";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { announcements, buildings, documents, events, ticketUpdates, tickets } from "../../db/schema.js";
import { inboundEmails } from "../../db/schema-v3.js";
import { authorizeCoproLinkAdmin, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { writeAudit } from "../lib/data.mts";

const normalizeAddress = (value: unknown) => String(value ?? "").trim().toLowerCase();
const firstAddress = (value: unknown) => Array.isArray(value) ? normalizeAddress(value[0]) : normalizeAddress(value);
const localPart = (address: string) => address.split("@")[0]?.replace(/[^a-z0-9-]/g, "") || "";

const parseSender = (value: unknown) => {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].replace(/^"|"$/g, "").trim(), address: normalizeAddress(match[2]) };
  return { name: "", address: normalizeAddress(raw) };
};

const safeJson = (value: unknown, fallback: string) => {
  try { return JSON.stringify(value ?? JSON.parse(fallback)); } catch { return fallback; }
};

const parseJsonArray = (value: string | null | undefined) => {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const ensureInboundEmailTable = async () => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS inbound_emails (
      id serial PRIMARY KEY,
      building_id integer NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
      provider text NOT NULL DEFAULT 'resend',
      provider_email_id text NOT NULL,
      message_id text NOT NULL DEFAULT '',
      from_address text NOT NULL DEFAULT '',
      from_name text NOT NULL DEFAULT '',
      to_address text NOT NULL DEFAULT '',
      subject text NOT NULL DEFAULT '',
      text_body text NOT NULL DEFAULT '',
      html_body text NOT NULL DEFAULT '',
      attachments_json text NOT NULL DEFAULT '[]',
      raw_event_json text NOT NULL DEFAULT '{}',
      processing_status text NOT NULL DEFAULT 'received',
      calendar_action_status text NOT NULL DEFAULT 'pending',
      calendar_event_id integer REFERENCES events(id) ON DELETE SET NULL,
      calendar_actioned_at timestamp,
      document_action_status text NOT NULL DEFAULT 'pending',
      document_ids_json text NOT NULL DEFAULT '[]',
      document_actioned_at timestamp,
      ticket_action_status text NOT NULL DEFAULT 'pending',
      ticket_reference text NOT NULL DEFAULT '',
      ticket_actioned_at timestamp,
      announcement_action_status text NOT NULL DEFAULT 'pending',
      announcement_id integer,
      announcement_actioned_at timestamp,
      received_at timestamp NOT NULL DEFAULT now(),
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS calendar_action_status text NOT NULL DEFAULT 'pending'`);
  await db.execute(sql`ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS calendar_event_id integer REFERENCES events(id) ON DELETE SET NULL`);
  await db.execute(sql`ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS calendar_actioned_at timestamp`);
  await db.execute(sql`ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS document_action_status text NOT NULL DEFAULT 'pending'`);
  await db.execute(sql`ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS document_ids_json text NOT NULL DEFAULT '[]'`);
  await db.execute(sql`ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS document_actioned_at timestamp`);
  await db.execute(sql`ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS ticket_action_status text NOT NULL DEFAULT 'pending'`);
  await db.execute(sql`ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS ticket_reference text NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS ticket_actioned_at timestamp`);
  await db.execute(sql`ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS announcement_action_status text NOT NULL DEFAULT 'pending'`);
  await db.execute(sql`ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS announcement_id integer`);
  await db.execute(sql`ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS announcement_actioned_at timestamp`);
  await db.execute(sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder text NOT NULL DEFAULT 'Documents reçus'`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS inbound_emails_provider_email_idx ON inbound_emails(provider, provider_email_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS inbound_emails_building_received_idx ON inbound_emails(building_id, received_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS inbound_emails_calendar_event_idx ON inbound_emails(calendar_event_id)`);
};

const fetchResendContent = async (emailId: string) => {
  const apiKey = Netlify.env.get("RESEND_API_KEY") || "";
  if (!apiKey) throw new Error("RESEND_API_KEY manquante");

  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const payload: any = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = String(payload?.message || payload?.error || `HTTP ${response.status}`);
    throw new Error(`Impossible de récupérer le contenu Resend: ${detail}`);
  }
  return payload || {};
};

const hydrateMissingContent = async (rows: any[]) => {
  const pending = rows.filter((row) => !row.textBody && !row.htmlBody && row.providerEmailId).slice(0, 20);
  for (const row of pending) {
    try {
      const content = await fetchResendContent(row.providerEmailId);
      await db.update(inboundEmails).set({
        textBody: String(content.text || "").slice(0, 250000),
        htmlBody: String(content.html || "").slice(0, 500000),
        processingStatus: "content_ready",
      }).where(eq(inboundEmails.id, row.id));
    } catch {
      await db.update(inboundEmails).set({ processingStatus: "content_pending" }).where(eq(inboundEmails.id, row.id));
    }
  }
};

const readInboundList = async (req: Request) => {
  await ensureInboundEmailTable();
  const ctx = await authorizeCoproLinkAdmin(req, readBuildingSlug(req));
  let rows = await db.select().from(inboundEmails)
    .where(eq(inboundEmails.buildingId, ctx.buildingId))
    .orderBy(desc(inboundEmails.receivedAt))
    .limit(100);

  await hydrateMissingContent(rows);
  if (rows.some((row) => !row.textBody && !row.htmlBody)) {
    rows = await db.select().from(inboundEmails)
      .where(eq(inboundEmails.buildingId, ctx.buildingId))
      .orderBy(desc(inboundEmails.receivedAt))
      .limit(100);
  }

  return Response.json({
    emails: rows.map((row) => ({
      ...row,
      attachments: parseJsonArray(row.attachmentsJson),
      documentIds: parseJsonArray(row.documentIdsJson),
    })),
  }, { headers: { "cache-control": "no-store" } });
};

const loadMailForAction = async (ctx: any, emailId: number) => {
  const [mail] = await db.select().from(inboundEmails)
    .where(and(eq(inboundEmails.id, emailId), eq(inboundEmails.buildingId, ctx.buildingId)))
    .limit(1);
  return mail || null;
};

const createCalendarAction = async (ctx: any, mail: any, body: any) => {
  if (mail.calendarEventId) {
    return Response.json({ ok: true, duplicate: true, eventId: mail.calendarEventId, status: "created" });
  }

  const eventDate = String(body.eventDate || "").trim();
  const eventTime = String(body.eventTime || "").trim();
  const title = String(body.title || mail.subject || "Événement CoproLink").trim().slice(0, 120);
  const detail = String(body.detail || "Créé après validation depuis l’Inbox CoproLink.").trim().slice(0, 300);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return Response.json({ error: "Date attendue au format AAAA-MM-JJ" }, { status: 422 });
  if (eventTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(eventTime)) return Response.json({ error: "Heure attendue au format HH:MM" }, { status: 422 });

  const [created] = await db.insert(events).values({ buildingId: ctx.buildingId, title, detail, eventDate, eventTime, isPublic: true }).returning();
  await db.update(inboundEmails).set({ calendarActionStatus: "created", calendarEventId: created.id, calendarActionedAt: new Date() }).where(eq(inboundEmails.id, mail.id));
  await writeAudit(ctx, {
    action: "inbound_email.calendar_event_created",
    entityType: "event",
    entityId: created.id,
    summary: `Événement « ${title} » créé depuis l’e-mail « ${mail.subject || "Sans objet"} » pour le ${eventDate}.`,
  });
  return Response.json({ ok: true, status: "created", event: created }, { status: 201 });
};

const createDocumentAction = async (ctx: any, mail: any, body: any) => {
  const existingIds = parseJsonArray(mail.documentIdsJson).map(Number).filter(Number.isInteger);
  if (existingIds.length > 0) return Response.json({ ok: true, duplicate: true, documentIds: existingIds, status: "created" });

  const attachments = parseJsonArray(mail.attachmentsJson);
  const requested = Array.isArray(body.files) ? body.files.map((value: unknown) => String(value || "").trim()).filter(Boolean) : [];
  const names = (requested.length ? requested : attachments.map((item: any) => item?.filename || item?.name || "Pièce jointe"))
    .filter(Boolean).slice(0, 20);
  if (!names.length) return Response.json({ error: "Aucune pièce jointe à classer" }, { status: 422 });

  const folder = String(body.folder || "Documents reçus").trim().slice(0, 120) || "Documents reçus";
  const createdIds: number[] = [];
  for (const name of names) {
    const extension = name.includes(".") ? name.split(".").pop()!.toUpperCase().slice(0, 12) : "FICHIER";
    const [created] = await db.insert(documents).values({
      buildingId: ctx.buildingId,
      name: name.slice(0, 220),
      fileType: extension || "FICHIER",
      folder,
      access: "private",
      storageKey: null,
    }).returning({ id: documents.id });
    createdIds.push(created.id);
  }

  await db.update(inboundEmails).set({
    documentActionStatus: "created",
    documentIdsJson: JSON.stringify(createdIds),
    documentActionedAt: new Date(),
  }).where(eq(inboundEmails.id, mail.id));
  await writeAudit(ctx, {
    action: "inbound_email.documents_classified",
    entityType: "document",
    entityId: createdIds.join(","),
    summary: `${createdIds.length} pièce(s) jointe(s) de l’e-mail « ${mail.subject || "Sans objet"} » classée(s) dans « ${folder} » (métadonnées uniquement à ce stade).`,
  });
  return Response.json({ ok: true, status: "created", documentIds: createdIds, folder }, { status: 201 });
};

const updateTicketAction = async (ctx: any, mail: any, body: any) => {
  if (mail.ticketActionStatus === "created" && mail.ticketReference) {
    return Response.json({ ok: true, duplicate: true, reference: mail.ticketReference, status: "created" });
  }
  const reference = String(body.reference || "").trim().toUpperCase();
  if (!/^T-\d{4,}$/.test(reference)) return Response.json({ error: "Référence de ticket invalide" }, { status: 422 });
  const [ticket] = await db.select().from(tickets)
    .where(and(eq(tickets.reference, reference), eq(tickets.buildingId, ctx.buildingId))).limit(1);
  if (!ticket) return Response.json({ error: `Ticket ${reference} introuvable` }, { status: 404 });

  const note = String(body.note || mail.textBody || mail.subject || "Mise à jour reçue par e-mail").trim().slice(0, 1000);
  await db.insert(ticketUpdates).values({
    ticketId: ticket.id,
    label: "Mise à jour reçue par e-mail",
    note,
    authorUserId: ctx.principal.kind === "user" ? ctx.principal.userId : null,
    authorLabel: ctx.actorLabel,
  });
  await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, ticket.id));
  await db.update(inboundEmails).set({ ticketActionStatus: "created", ticketReference: reference, ticketActionedAt: new Date() }).where(eq(inboundEmails.id, mail.id));
  await writeAudit(ctx, {
    action: "inbound_email.ticket_updated",
    entityType: "ticket",
    entityId: reference,
    summary: `Le ticket ${reference} a reçu une mise à jour depuis l’e-mail « ${mail.subject || "Sans objet"} ».`,
  });
  return Response.json({ ok: true, status: "created", reference });
};

const publishAnnouncementAction = async (ctx: any, mail: any, body: any) => {
  if (mail.announcementId) return Response.json({ ok: true, duplicate: true, announcementId: mail.announcementId, status: "created" });

  const title = String(body.title || mail.subject || "Information CoproLink").trim().slice(0, 120);
  const text = String(body.body || mail.textBody || mail.subject || "Information reçue par e-mail").trim().slice(0, 1000);
  if (!text) return Response.json({ error: "Contenu de communication vide" }, { status: 422 });
  const priority = body.priority === "important" ? "important" : "normal";
  const [created] = await db.insert(announcements).values({
    buildingId: ctx.buildingId,
    title,
    body: text,
    priority,
    isPublic: body.isPublic === true,
    authorUserId: ctx.principal.kind === "user" ? ctx.principal.userId : null,
  }).returning();
  await db.update(inboundEmails).set({ announcementActionStatus: "created", announcementId: created.id, announcementActionedAt: new Date() }).where(eq(inboundEmails.id, mail.id));
  await writeAudit(ctx, {
    action: "inbound_email.announcement_published",
    entityType: "announcement",
    entityId: created.id,
    summary: `Communication « ${title} » créée depuis l’e-mail « ${mail.subject || "Sans objet"} ».`,
  });
  return Response.json({ ok: true, status: "created", announcement: created }, { status: 201 });
};

const executeInboundAction = async (req: Request) => {
  await ensureInboundEmailTable();
  const ctx = await authorizeCoproLinkAdmin(req, readBuildingSlug(req));
  const body: any = await req.json().catch(() => ({}));
  const emailId = Number(body.emailId);
  const action = String(body.action || "");
  if (!Number.isInteger(emailId) || emailId <= 0) return Response.json({ error: "E-mail entrant invalide" }, { status: 422 });

  const mail = await loadMailForAction(ctx, emailId);
  if (!mail) return Response.json({ error: "E-mail introuvable" }, { status: 404 });

  if (action === "create_calendar_event") return createCalendarAction(ctx, mail, body);
  if (action === "classify_documents") return createDocumentAction(ctx, mail, body);
  if (action === "update_ticket") return updateTicketAction(ctx, mail, body);
  if (action === "publish_announcement") return publishAnnouncementAction(ctx, mail, body);
  return Response.json({ error: "Action Inbox inconnue" }, { status: 422 });
};

const receiveResendWebhook = async (req: Request) => {
  await ensureInboundEmailTable();
  const url = new URL(req.url);
  const expectedToken = Netlify.env.get("COPROLINK_INBOUND_TEST_TOKEN") || "";
  const suppliedToken = url.searchParams.get("token") || "";
  if (!expectedToken || suppliedToken !== expectedToken) return Response.json({ error: "Webhook non autorisé" }, { status: 401 });

  const raw = await req.text();
  let event: any;
  try { event = JSON.parse(raw); } catch { return Response.json({ error: "Payload JSON invalide" }, { status: 400 }); }
  if (event?.type !== "email.received") return Response.json({ ok: true, ignored: true });

  const data = event?.data || {};
  const providerEmailId = String(data.email_id || "").trim();
  if (!providerEmailId) return Response.json({ error: "email_id manquant" }, { status: 422 });
  const toAddress = firstAddress(data.to);
  const slug = localPart(toAddress);
  if (!slug) return Response.json({ error: "Destinataire CoproLink invalide" }, { status: 422 });

  const [building] = await db.select({ id: buildings.id, slug: buildings.slug }).from(buildings).where(eq(buildings.slug, slug)).limit(1);
  if (!building) return Response.json({ error: `Aucune copropriété ne correspond à ${slug}` }, { status: 404 });

  const [existing] = await db.select({ id: inboundEmails.id }).from(inboundEmails)
    .where(and(eq(inboundEmails.provider, "resend"), eq(inboundEmails.providerEmailId, providerEmailId))).limit(1);
  if (existing) return Response.json({ ok: true, duplicate: true, id: existing.id });

  const sender = parseSender(data.from);
  const attachments = Array.isArray(data.attachments) ? data.attachments : [];
  const receivedAt = data.created_at ? new Date(data.created_at) : new Date();
  let textBody = "";
  let htmlBody = "";
  let processingStatus = "content_pending";
  try {
    const content = await fetchResendContent(providerEmailId);
    textBody = String(content.text || "").slice(0, 250000);
    htmlBody = String(content.html || "").slice(0, 500000);
    processingStatus = "content_ready";
  } catch { /* Le GET de l'Inbox retentera ensuite. */ }

  const [created] = await db.insert(inboundEmails).values({
    buildingId: building.id,
    provider: "resend",
    providerEmailId,
    messageId: String(data.message_id || ""),
    fromAddress: sender.address,
    fromName: sender.name,
    toAddress,
    subject: String(data.subject || ""),
    textBody,
    htmlBody,
    attachmentsJson: safeJson(attachments, "[]"),
    rawEventJson: raw.slice(0, 100000),
    processingStatus,
    receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
  }).returning({ id: inboundEmails.id });

  return Response.json({ ok: true, id: created.id, building: building.slug, processingStatus });
};

export default async (req: Request) => {
  try {
    if (req.method === "GET") return await readInboundList(req);
    if (req.method === "POST") return await receiveResendWebhook(req);
    if (req.method === "PATCH") return await executeInboundAction(req);
    return new Response(null, { status: 405, headers: { Allow: "GET, POST, PATCH" } });
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = { path: "/api/inbound-email" };
