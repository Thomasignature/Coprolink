import assert from "node:assert/strict";
import test from "node:test";
import { Webhook } from "svix";
import { verifyResendWebhook } from "../netlify/lib/resend-webhook.mts";

const secret = "whsec_" + Buffer.from("a secure test key with enough entropy").toString("base64");

test("accepts an authentic signature over the raw body", () => {
  const raw = JSON.stringify({ type: "email.received", data: { email_id: "mail_1" } });
  const messageId = "msg_test_1";
  const timestamp = new Date();
  const signature = new Webhook(secret).sign(messageId, timestamp, raw);
  const headers = new Headers({
    "svix-id": messageId,
    "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "svix-signature": signature,
  });

  assert.deepEqual(verifyResendWebhook(raw, headers, secret), JSON.parse(raw));
});

test("rejects a body modified after signing", () => {
  const signed = JSON.stringify({ type: "email.received", data: { email_id: "mail_1" } });
  const messageId = "msg_test_2";
  const timestamp = new Date();
  const headers = new Headers({
    "svix-id": messageId,
    "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "svix-signature": new Webhook(secret).sign(messageId, timestamp, signed),
  });

  assert.throws(
    () => verifyResendWebhook(signed.replace("mail_1", "mail_2"), headers, secret),
    (error) => error?.status === 401,
  );
});

test("fails closed when the secret or signature headers are absent", () => {
  assert.throws(() => verifyResendWebhook("{}", new Headers(), ""), (error) => error?.status === 503);
  assert.throws(() => verifyResendWebhook("{}", new Headers(), secret), (error) => error?.status === 401);
});
