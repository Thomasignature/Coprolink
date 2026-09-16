CREATE TABLE IF NOT EXISTS "inbound_emails" (
  "id" serial PRIMARY KEY NOT NULL,
  "building_id" integer NOT NULL,
  "provider" text DEFAULT 'resend' NOT NULL,
  "provider_email_id" text NOT NULL,
  "message_id" text DEFAULT '' NOT NULL,
  "from_address" text DEFAULT '' NOT NULL,
  "from_name" text DEFAULT '' NOT NULL,
  "to_address" text DEFAULT '' NOT NULL,
  "subject" text DEFAULT '' NOT NULL,
  "text_body" text DEFAULT '' NOT NULL,
  "html_body" text DEFAULT '' NOT NULL,
  "attachments_json" text DEFAULT '[]' NOT NULL,
  "raw_event_json" text DEFAULT '{}' NOT NULL,
  "processing_status" text DEFAULT 'received' NOT NULL,
  "received_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "inbound_emails_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "inbound_emails_provider_email_idx" ON "inbound_emails" USING btree ("provider", "provider_email_id");
CREATE INDEX IF NOT EXISTS "inbound_emails_building_received_idx" ON "inbound_emails" USING btree ("building_id", "received_at");
