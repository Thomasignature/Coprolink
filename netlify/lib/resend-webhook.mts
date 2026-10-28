import { Webhook, WebhookVerificationError } from "svix";

export class WebhookAuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "WebhookAuthError";
    this.status = status;
  }
}

/** Verify a Resend/Svix webhook against the unmodified HTTP request body. */
export const verifyResendWebhook = (rawBody: string, headers: Headers, secret: string) => {
  if (!secret) throw new WebhookAuthError(503, "Secret du webhook Resend non configuré");

  const signatureHeaders = {
    "svix-id": headers.get("svix-id") || "",
    "svix-timestamp": headers.get("svix-timestamp") || "",
    "svix-signature": headers.get("svix-signature") || "",
  };
  if (Object.values(signatureHeaders).some((value) => !value)) {
    throw new WebhookAuthError(401, "Signature du webhook Resend manquante");
  }

  try {
    return new Webhook(secret).verify(rawBody, signatureHeaders) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      throw new WebhookAuthError(401, "Signature du webhook Resend invalide");
    }
    throw error;
  }
};
