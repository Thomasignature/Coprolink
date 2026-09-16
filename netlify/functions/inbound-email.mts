import type { Config } from "@netlify/functions";
import { and, desc, eq } from "drizzle-orm";
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

const readInboundList = async (req: Request) => {
  const ctx = await authorizeCoproLinkAdmin(req, readBuildingSlug(req));
  const rows = await db.select().from(inboundEmails)
    .where(eq(inboundEmails.buildingId, ctx.buildingId))
    .orderBy(desc(inboundEmails.receivedAt))
    .limit(100);

  return Response.json({
    emails: rows.map((row) => ({
      ...row,
      attachments: (() => { try { return JSON.parse(row.attachmentsJson || "[]"); } catch { return []; } })(),
    })),
  }, { headers: { "cache-control": "no-store" } });
};

const receiveResendWebhook = async (req: Request) => {
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

  const [created] = await db.insert(inboundEmails).values({
    buildingId: building.id,
    provider: "resend",
    providerEmailId,
    messageId: String(data.message_id || ""),
    fromAddress: sender.address,
    fromName: sender.name,
    toAddress,
    subject: String(data.subject || ""),
    attachmentsJson: safeJson(attachments, "[]"),
    rawEventJson: raw.slice(0, 100000),
    processingStatus: "received",
    receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
  }).returning({ id: inboundEmails.id });

  return Response.json({ ok: true, id: created.id, building: building.slug });
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
