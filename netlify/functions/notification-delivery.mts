import type { Config } from "@netlify/functions";
import { deliverNotifications } from "../lib/notifications.mts";

export default async () => { await deliverNotifications(); };
export const config: Config = { schedule: "*/5 * * * *" };
