import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { documentStoreName } from "../lib/document-policy.mts";
import { enqueueNotification } from "../lib/notifications.mts";
import { isIsoDate } from "../lib/lifecycle-policy.mts";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { announcements, buildings, documents, events, ticketUpdates, tickets } from "../../db/schema.js";
import { inboundEmails } from "../../db/schema-v3.js";
import { authorizeCoproLinkAdmin, authorizeSyndicOperator, HttpError, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { writeAudit } from "../lib/data.mts";
import { verifyResendWebhook, WebhookAuthError } from "../lib/resend-webhook.mts";

const normalizeAddress = (value: unknown) => String(value ?? "").trim().toLowerCase();
const recipientAddresses = (...values: unknown[]) => values
  .flatMap((value) => Array.isArray(value) ? value : value ? [value] : [])
  .map((value) => { const raw = String(value); return normalizeAddress(raw.match(/<([^>]+)>/)?.[1] ?? raw); })
  .filter((address) => address.includes("@"));
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

const createCalendarAction = async (ctx: any, mail: any, body: any, tx: Pick<typeof db, "select" | "insert" | "update" | "execute">) => {
  if (mail.calendarEventId) {
    return Response.json({ ok: true, duplicate: true, eventId: mail.calendarEventId, status: "created" });
  }

  const eventDate = String(body.eventDate || "").trim();
  const eventTime = String(body.eventTime || "").trim();
  const title = String(body.title || mail.subject || "Événement CoproLink").trim().slice(0, 120);
  const detail = String(body.detail || "Créé après validation depuis l’Inbox CoproLink.").trim().slice(0, 300);
  if (!isIsoDate(eventDate)) return Response.json({ error: "Date attendue au format AAAA-MM-JJ" }, { status: 422 });
  if (eventTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(eventTime)) return Response.json({ error: "Heure attendue au format HH:MM" }, { status: 422 });

  const [created] = await tx.insert(events).values({ buildingId: ctx.buildingId, title, detail, eventDate, eventTime, isPublic: body.isPublic === true }).returning();
  await tx.update(inboundEmails).set({ calendarActionStatus: "created", calendarEventId: created.id, calendarActionedAt: new Date() }).where(eq(inboundEmails.id, mail.id));
  await writeAudit(ctx, {
    action: "inbound_email.calendar_event_created",
    entityType: "event",
    entityId: created.id,
    summary: `Événement « ${title} » créé depuis l’e-mail « ${mail.subject || "Sans objet"} » pour le ${eventDate}.`,
  }, tx);
  return Response.json({ ok: true, status: "created", event: created }, { status: 201 });
};

const createDocumentAction = async (ctx: any, mail: any, body: any, tx: Pick<typeof db, "select" | "insert" | "update" | "execute">) => {
  const existingIds = parseJsonArray(mail.documentIdsJson).map(Number).filter(Number.isInteger);
  const existing = existingIds.length ? await tx.select().from(documents)
    .where(and(eq(documents.buildingId, ctx.buildingId), inArray(documents.id, existingIds))) : [];
  if (existing.length && existing.every(doc => doc.storageKey)) return Response.json({ ok: true, duplicate: true, documentIds: existingIds });
  const attachments = body._preparedAttachments as { name: string; extension: string; storageKey: string }[];
  const folder = String(body.folder || "Documents reçus").trim().slice(0, 80);
  const createdIds: number[] = [];
  for (const file of attachments) {
    const previous = existing.find(doc => doc.name === file.name);
    if (previous) {
      await tx.update(documents).set({ storageKey: file.storageKey, folder, fileType: file.extension.toUpperCase() }).where(eq(documents.id, previous.id));
      createdIds.push(previous.id);
    } else {
      const [created] = await tx.insert(documents).values({ buildingId: ctx.buildingId, name: file.name,
        fileType: file.extension.toUpperCase(), folder, access: "private", storageKey: file.storageKey }).returning({ id: documents.id });
      createdIds.push(created.id);
    }
  }
  await tx.update(inboundEmails).set({ documentActionStatus: "created", documentIdsJson: JSON.stringify(createdIds), documentActionedAt: new Date() }).where(eq(inboundEmails.id, mail.id));
  await writeAudit(ctx, { action: "inbound_email.documents_classified", entityType: "document", entityId: createdIds.join(","),
    summary: `${createdIds.length} pièce(s) jointe(s) archivées depuis « ${mail.subject || "Sans objet"} ».` }, tx);
  return Response.json({ ok: true, status: "created", documentIds: createdIds, folder, skipped: body._skippedAttachments ?? [] }, { status: 201 });
};

const updateTicketAction = async (ctx: any, mail: any, body: any, tx: Pick<typeof db, "select" | "insert" | "update" | "execute">) => {
  if (mail.ticketActionStatus === "created" && mail.ticketReference) {
    return Response.json({ ok: true, duplicate: true, reference: mail.ticketReference, status: "created" });
  }
  const reference = String(body.reference || "").trim().toUpperCase();
  if (!/^T-\d{4,}$/.test(reference)) return Response.json({ error: "Référence de ticket invalide" }, { status: 422 });
  const [ticket] = await tx.select().from(tickets)
    .where(and(eq(tickets.reference, reference), eq(tickets.buildingId, ctx.buildingId))).limit(1);
  if (!ticket) return Response.json({ error: `Ticket ${reference} introuvable` }, { status: 404 });

  // Never copy the raw e-mail body into a history visible to the reporter.
  const note = String(body.note || mail.subject || "Mise à jour reçue par e-mail").trim().slice(0, 1000);
  await tx.insert(ticketUpdates).values({
    ticketId: ticket.id,
    label: "Mise à jour reçue par e-mail",
    note,
    authorUserId: ctx.principal.kind === "user" ? ctx.principal.userId : null,
    authorLabel: ctx.actorLabel,
  });
  await tx.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, ticket.id));
  await tx.update(inboundEmails).set({ ticketActionStatus: "created", ticketReference: reference, ticketActionedAt: new Date() }).where(eq(inboundEmails.id, mail.id));
  await writeAudit(ctx, {
    action: "inbound_email.ticket_updated",
    entityType: "ticket",
    entityId: reference,
    summary: `Le ticket ${reference} a reçu une mise à jour depuis l’e-mail « ${mail.subject || "Sans objet"} ».`,
  }, tx);
  return Response.json({ ok: true, status: "created", reference });
};

const publishAnnouncementAction = async (ctx: any, mail: any, body: any, tx: Pick<typeof db, "select" | "insert" | "update" | "execute">) => {
  if (mail.announcementId) return Response.json({ ok: true, duplicate: true, announcementId: mail.announcementId, status: "created" });

  const title = String(body.title || mail.subject || "Information CoproLink").trim().slice(0, 120);
  const text = String(body.body || mail.textBody || mail.subject || "Information reçue par e-mail").trim().slice(0, 1000);
  if (!text) return Response.json({ error: "Contenu de communication vide" }, { status: 422 });
  const priority = body.priority === "important" ? "important" : "normal";
  const [created] = await tx.insert(announcements).values({
    buildingId: ctx.buildingId,
    title,
    body: text,
    priority,
    isPublic: body.isPublic === true,
    authorUserId: ctx.principal.kind === "user" ? ctx.principal.userId : null,
  }).returning();
  await enqueueNotification(tx as Pick<typeof db, "execute">, { buildingId: ctx.buildingId, kind: "announcement", entityId: created.id, sourceKey: `announcement-${created.id}` });
  await tx.update(inboundEmails).set({ announcementActionStatus: "created", announcementId: created.id, announcementActionedAt: new Date() }).where(eq(inboundEmails.id, mail.id));
  await writeAudit(ctx, {
    action: "inbound_email.announcement_published",
    entityType: "announcement",
    entityId: created.id,
    summary: `Communication « ${title} » créée depuis l’e-mail « ${mail.subject || "Sans objet"} ».`,
  }, tx);
  return Response.json({ ok: true, status: "created", announcement: created }, { status: 201 });
};

/** Provider URLs are fetched from the authenticated API, never accepted from the request or webhook. */
const prepareAttachments = async (ctx: any, mail: any, body: any) => {
  const apiKey = Netlify.env.get("RESEND_API_KEY");
  if (!apiKey) throw new HttpError(503, "La réception des pièces jointes n’est pas configurée");
  const signal = AbortSignal.timeout(40_000);
  const result = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(mail.providerEmailId)}/attachments`, {
    headers: { Authorization: `Bearer ${apiKey}` }, signal,
  });
  if (!result.ok) throw new HttpError(502, "Impossible de lire les pièces jointes chez le fournisseur");
  const payload: any = await result.json();
  if (payload.has_more) throw new HttpError(422, "Cet e-mail contient trop de pièces jointes. Déposez-les depuis Documents.");
  const requested = Array.isArray(body.files) ? body.files.map(String) : [];
  const files = (payload.data || []).filter((file: any) => !requested.length || requested.includes(file.filename));
  if (!files.length || files.length > 20) throw new HttpError(422, "Sélection de pièces jointes invalide");
  const store = getStore({ name: documentStoreName(Netlify.env.get("CONTEXT") || "dev", Netlify.env.get("BRANCH") || ""), consistency: "strong" });
  // Check every file before downloading: an unsupported logo must not block the
  // archive of the other attachments, and is reported instead of failing forever.
  const skipped: { name: string; reason: string }[] = [];
  const accepted = files.filter((file: any) => {
    const name = String(file.filename || "").slice(0, 160) || "Pièce jointe sans nom";
    const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
    if (!/^(pdf|png|jpg|jpeg|webp|txt|csv|doc|docx|xls|xlsx|odt|ods)$/.test(extension)) { skipped.push({ name, reason: "format non accepté" }); return false; }
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > 4 * 1024 * 1024) { skipped.push({ name, reason: "taille supérieure à 4 Mo ou inconnue" }); return false; }
    return true;
  });
  if (!accepted.length) throw new HttpError(415, `Aucune pièce jointe archivable : ${skipped.map(item => `${item.name} (${item.reason})`).join(", ")}`);
  const prepared: { name: string; extension: string; storageKey: string }[] = [];
  let totalBytes = 0;
  try {
  for (const file of accepted) {
    const name = String(file.filename || "").slice(0, 160);
    const extension = name.split(".").pop()!.toLowerCase();
    const url = new URL(file.download_url);
    if (url.protocol !== "https:" || url.hostname !== "inbound-cdn.resend.com") throw new HttpError(502, "Adresse de téléchargement du fournisseur invalide");
    const response = await fetch(url, { redirect: "error", signal });
    if (!response.ok || !response.body) throw new HttpError(502, "Téléchargement de pièce jointe impossible");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength; totalBytes += part.value.byteLength;
      if (size > 4 * 1024 * 1024 || totalBytes > 12 * 1024 * 1024) { await reader.cancel(); throw new HttpError(413, "Pièces jointes trop volumineuses (4 Mo par fichier, 12 Mo par opération)"); }
      chunks.push(part.value);
    }
    if (!size) throw new HttpError(422, "Pièce jointe vide");
    const storageKey = `buildings/${ctx.buildingId}/inbound-${mail.id}-${String(file.id).replace(/[^a-z0-9-]/gi, "")}.${extension}`;
    await store.set(storageKey, Uint8Array.from(Buffer.concat(chunks)).buffer);
    prepared.push({ name, extension, storageKey });
  }
  } catch (error) {
    // No orphan files when a later attachment fails; the e-mail stays re-processable.
    await Promise.all(prepared.map(item => store.delete(item.storageKey).catch(() => {})));
    throw error;
  }
  return { prepared, skipped };
};

const executeInboundAction = async (req: Request) => {
  const ctx = await authorizeSyndicOperator(req, readBuildingSlug(req));
  const body: any = await req.json().catch(() => ({}));
  const emailId = Number(body.emailId);
  if (!Number.isInteger(emailId) || emailId <= 0) throw new HttpError(422, "E-mail entrant invalide");
  const action = String(body.action || "");
  const initial = await loadMailForAction(ctx, emailId);
  if (!initial) throw new HttpError(404, "E-mail introuvable");
  // Never trust a client-supplied internal field.
  const attachments = action === "classify_documents" ? await prepareAttachments(ctx, initial, body) : { prepared: [], skipped: [] };
  body._preparedAttachments = attachments.prepared;
  body._skippedAttachments = attachments.skipped;
  return db.transaction(async tx => {
    const [mail] = await tx.select().from(inboundEmails).where(and(eq(inboundEmails.id, emailId), eq(inboundEmails.buildingId, ctx.buildingId))).for("update");
    if (!mail) throw new HttpError(404, "E-mail introuvable");
    if (action === "create_calendar_event") return createCalendarAction(ctx, mail, body, tx);
    if (action === "classify_documents") return createDocumentAction(ctx, mail, body, tx);
    if (action === "update_ticket") return updateTicketAction(ctx, mail, body, tx);
    if (action === "publish_announcement") return publishAnnouncementAction(ctx, mail, body, tx);
    throw new HttpError(422, "Action Inbox inconnue");
  });
};

const receiveResendWebhook = async (req: Request) => {
  const raw = await req.text();
  const secret = Netlify.env.get("RESEND_WEBHOOK_SECRET") || "";
  let event: any;
  try {
    event = verifyResendWebhook(raw, req.headers, secret);
  } catch (error) {
    if (error instanceof WebhookAuthError) throw new HttpError(error.status, error.message);
    throw error;
  }
  if (event?.type !== "email.received") return Response.json({ ok: true, ignored: true });

  const data = event?.data || {};
  const providerEmailId = String(data.email_id || "").trim();
  if (!providerEmailId) return Response.json({ error: "email_id manquant" }, { status: 422 });
  // Route on every To/Cc recipient, restricted to the inbound domain when configured,
  // so that a syndic address listed first neither loses the e-mail nor misroutes it.
  const inboundDomain = (Netlify.env.get("COPROLINK_INBOUND_DOMAIN") || "").trim().toLowerCase().replace(/^@/, "");
  const candidates = recipientAddresses(data.to, data.cc).filter((address) => !inboundDomain || address.endsWith(`@${inboundDomain}`));
  const slugs = [...new Set(candidates.map(localPart).filter(Boolean))];
  if (!slugs.length) return Response.json({ error: "Destinataire CoproLink invalide" }, { status: 422 });

  const matched = await db.select({ id: buildings.id, slug: buildings.slug }).from(buildings).where(inArray(buildings.slug, slugs));
  if (!matched.length) return Response.json({ error: "Aucune copropriété ne correspond aux destinataires" }, { status: 404 });
  if (matched.length > 1) return Response.json({ error: "Plusieurs copropriétés correspondent aux destinataires ; e-mail non classé" }, { status: 409 });
  const [building] = matched;
  const toAddress = candidates.find((address) => localPart(address) === building.slug) ?? candidates[0];

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
  }).onConflictDoNothing().returning({ id: inboundEmails.id });

  return Response.json({ ok: true, id: created?.id, duplicate: !created, building: building.slug, processingStatus });
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
