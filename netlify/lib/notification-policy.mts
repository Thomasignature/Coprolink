export const notificationSendingEnabled = (env: { get: (key: string) => string | undefined }) =>
  env.get("CONTEXT") === "production" && env.get("COPROLINK_NOTIFICATIONS_ENABLED") === "true" &&
  Boolean(env.get("RESEND_API_KEY") && env.get("COPROLINK_EMAIL_FROM"));

export const notificationIsCurrent = (row: { createdAt: Date; attempts: number }, now = new Date()) =>
  row.attempts < 5 && now.getTime() - row.createdAt.getTime() < 23 * 60 * 60 * 1000;
