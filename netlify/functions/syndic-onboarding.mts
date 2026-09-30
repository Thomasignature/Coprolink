import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { auditLog, syndicOnboardingInvites } from "../../db/schema.js";
import { HttpError, jsonError, requireUser } from "../lib/auth.mts";
import { inviteAccount, IdentityEmailTakenError } from "../lib/identity.mts";
import { readString } from "../lib/data.mts";

export default async (req: Request) => {
  try {
    const principal = await requireUser(req);
    if (!principal.isPlatformAdmin) throw new HttpError(403, "Administration plateforme requise");
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
    const body = await req.json().catch(() => ({}));
    const email = readString(body.email, "e-mail", { max: 200 }).toLowerCase();
    const organizationName = readString(body.organizationName, "cabinet", { max: 160 });
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const [invitation] = await db.insert(syndicOnboardingInvites).values({ email, organizationName, invitedByUserId: principal.userId, expiresAt })
      .onConflictDoUpdate({ target: syndicOnboardingInvites.email, set: { organizationName, invitedByUserId: principal.userId, expiresAt, acceptedAt: null } }).returning();
    try { await inviteAccount(email, organizationName); } catch (error) { if (!(error instanceof IdentityEmailTakenError)) throw error; }
    await db.insert(auditLog).values({
      actorUserId: principal.userId,
      actorLabel: principal.fullName || principal.email,
      actorRole: "platform_admin",
      action: "syndic.onboarding_invited",
      entityType: "syndic_onboarding_invite",
      entityId: String(invitation.id),
      summary: `Invitation d’onboarding syndic créée pour ${email}.`,
    });
    return Response.json({ id: invitation.id, email, expiresAt }, { status: 201 });
  } catch (error) { return jsonError(error); }
};

export const config: Config = { path: "/api/syndic-onboarding", method: "POST" };
