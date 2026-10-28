import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { notificationSendingEnabled } from "./notification-policy.mts";

/** Called in the same transaction as the business event. One row per recipient. */
export const enqueueNotification = async (tx: Pick<typeof db, "execute">, input: {
  buildingId: number; kind: "announcement" | "ticket"; entityId: number; sourceKey: string; userId?: string | null;
}) => {
  // Don't accumulate preview events that could be replayed after enabling production.
  if (!notificationSendingEnabled(Netlify.env)) return;
  await tx.execute(sql`INSERT INTO notification_outbox (building_id,user_id,kind,entity_id,source_key)
    SELECT m.building_id,m.user_id,${input.kind},${input.entityId},${input.sourceKey}
    FROM building_members m WHERE m.building_id=${input.buildingId} AND m.ended_at IS NULL
      AND (${input.kind}='announcement' OR m.user_id=${input.userId ?? ""})
    ON CONFLICT (source_key,user_id) DO NOTHING`);
};

/** One leased row at a time; provider idempotency key survives retries/crashes. */
export const deliverNotifications = async () => {
  if (!notificationSendingEnabled(Netlify.env)) return { enabled: false, processed: 0 };
  let processed = 0;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && processed < 10) {
    const result = await db.execute(sql`UPDATE notification_outbox SET status='sending',attempts=attempts+1,attempted_at=now()
      WHERE id=(SELECT id FROM notification_outbox
        WHERE (status IN ('pending','failed') OR (status='sending' AND attempted_at < now()-interval '5 minutes'))
          AND attempts < 5 AND created_at > now()-interval '23 hours'
          AND (attempted_at IS NULL OR attempted_at < now()-interval '5 minutes')
        ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
    const row = result.rows[0] as any;
    if (!row) break;
    processed++;
    try {
      // Resolve access and current recipient again. Revocation cancels queued mail.
      const allowed = await db.execute(sql`SELECT u.email FROM users u JOIN building_members m ON m.user_id=u.id
        WHERE u.id=${row.user_id} AND m.building_id=${row.building_id} AND m.ended_at IS NULL`);
      const email = allowed.rows[0]?.email as string | undefined;
      const source = row.kind === "ticket"
        ? await db.execute(sql`SELECT reference FROM tickets WHERE id=${row.entity_id} AND building_id=${row.building_id} AND reporter_user_id=${row.user_id}`)
        : await db.execute(sql`SELECT id FROM announcements WHERE id=${row.entity_id} AND building_id=${row.building_id}`);
      if (!email || !source.rows.length) {
        await db.execute(sql`UPDATE notification_outbox SET status='cancelled' WHERE id=${row.id}`);
        continue;
      }
      // Keep sensitive descriptions out of email; the authenticated app contains details.
      const text = row.kind === "ticket" ? `Votre signalement ${source.rows[0].reference} a été mis à jour. Connectez-vous à CoproLink pour consulter son suivi.`
        : "Une nouvelle communication est disponible pour votre copropriété. Connectez-vous à CoproLink pour la consulter.";
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(5_000),
        headers: { Authorization: `Bearer ${Netlify.env.get("RESEND_API_KEY")}`, "content-type": "application/json",
          "Idempotency-Key": `coprolink-${Netlify.env.get("SITE_ID")}-${row.id}` },
        body: JSON.stringify({ from: Netlify.env.get("COPROLINK_EMAIL_FROM"), to: [email], subject: "CoproLink — nouvelle information", text }),
      });
      if (!response.ok) throw new Error(`Fournisseur e-mail : HTTP ${response.status}`);
      const payload = await response.json() as { id?: string };
      if (!payload.id) throw new Error("Aucun identifiant d’envoi confirmé");
      await db.execute(sql`UPDATE notification_outbox SET status='sent',sent_at=now(),provider_id=${payload.id},last_error='' WHERE id=${row.id}`);
    } catch (error) {
      await db.execute(sql`UPDATE notification_outbox SET status='failed',last_error=${(error as Error).message.slice(0,200)} WHERE id=${row.id}`);
    }
  }
  await db.execute(sql`UPDATE notification_outbox SET status='expired' WHERE status IN ('pending','failed','sending') AND (created_at <= now()-interval '23 hours' OR (attempts>=5 AND attempted_at < now()-interval '5 minutes'))`);
  return { enabled: true, processed };
};
