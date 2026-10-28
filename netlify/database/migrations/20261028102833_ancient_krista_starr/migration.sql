-- Aligns the Drizzle snapshot with db/schema.ts. Every object below is already
-- created by earlier hand-written migrations, so each statement is idempotent.
-- tickets.scheduled_on / scheduled_time are added by 20261028121000_ticket_schedule.
CREATE TABLE IF NOT EXISTS "syndic_onboarding_invites" (
	"id" serial PRIMARY KEY,
	"email" text NOT NULL,
	"organization_name" text DEFAULT '' NOT NULL,
	"invited_by_user_id" text,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "building_members" ADD COLUMN IF NOT EXISTS "ended_at" timestamp;--> statement-breakpoint
ALTER TABLE "building_members" ADD COLUMN IF NOT EXISTS "ended_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "folder" text DEFAULT 'Documents reçus' NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "building_members_active_idx" ON "building_members" ("building_id","ended_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "syndic_onboarding_invites_email_idx" ON "syndic_onboarding_invites" ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "syndic_onboarding_invites_expiry_idx" ON "syndic_onboarding_invites" ("expires_at");--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'syndic_onboarding_invites' AND c.contype = 'f'
  ) THEN
    ALTER TABLE "syndic_onboarding_invites" ADD CONSTRAINT "syndic_onboarding_invites_invited_by_user_id_users_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;
