import type { Config } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { authorizeSyndicOperator, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { notificationSendingEnabled } from "../lib/notification-policy.mts";

export default async (req: Request) => {
  try {
    const ctx = await authorizeSyndicOperator(req, readBuildingSlug(req));
    const result = await db.execute(sql`SELECT id,kind,status,attempts,last_error AS error,created_at FROM notification_outbox WHERE building_id=${ctx.buildingId} ORDER BY id DESC LIMIT 30`);
    return Response.json({ enabled: notificationSendingEnabled(Netlify.env), notifications: result.rows }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return jsonError(error); }
};
export const config: Config = { path: "/api/notification-status", method: ["GET"] };
