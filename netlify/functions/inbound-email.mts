import type { Config } from "@netlify/functions";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { buildings } from "../../db/schema.js";
import { inboundEmails } from "../../db/schema-v3.js";
import { authorizeCoproLinkAdmin, jsonError, readBuildingSlug } from "../lib/auth.mts";

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
      received_at timestamp NOT NULL DEFAULT now(),
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS inbound_emails_provider_email_idx ON inbound_emails(provider, provider_email_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS inbound_emails_building_received_idx ON inbound_emails(building_id, received_at)`);
};

const fetchResendContent = async (emailId: string) => {
  const apiKey = Netlify.env.get("RESEND_API_KEY") || "";
  if (!apiKey) throw new Error("RESEND_API_KEY manquante");

  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
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
      attachments: (() => { try { return JSON.parse(row.attachmentsJson || "[]"); } catch { return []; } })(),
    })),
  }, { headers: { "cache-control": "no-store" } });
};

const receiveResendWebhook = async (req: Request) => {
  await ensureInboundEmailTable();
  const url = new URL(req.url);
  const expectedToken = Netlify.env.get("COPROLINK_INBOUND_TEST_TOKEN") || "";
  const suppliedToken = url.searchParams.get("token") || "";
  if (!expectedToken || suppliedToken !== expectedToken) {
    return Response.json({ error: "Webhook non autorisé" }, { status: 401 });
  }

  const raw = await req.text();
  let event: any;
  try { event = JSON.parse(raw); } catch {
    return Response.json({ error: "Payload JSON invalide" }, { status: 400 });
  }

  if (event?.type !== "email.received") return Response.json({ ok: true, ignored: true });

  const data = event?.data || {};
  const providerEmailId = String(data.email_id || "").trim();
  if (!providerEmailId) return Response.json({ error: "email_id manquant" }, { status: 422 });

  const toAddress = firstAddress(data.to);
  const slug = localPart(toAddress);
  if (!slug) return Response.json({ error: "Destinataire CoproLink invalide" }, { status: 422 });

  const [building] = await db.select({ id: buildings.id, slug: buildings.slug, name: buildings.name })
    .from(buildings).where(eq(buildings.slug, slug)).limit(1);
  if (!building) {
    return Response.json({ error: `Aucune copropriété ne correspond à ${slug}` }, { status: 404 });
  }

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
  } catch {
    // Le webhook reste accepté. Le GET de l'Inbox retentera ensuite la récupération.
  }

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
    return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = {
  path: "/api/inbound-email",
};
