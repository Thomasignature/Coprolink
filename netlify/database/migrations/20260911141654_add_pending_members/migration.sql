CREATE TABLE "pending_members" (
	"id" serial PRIMARY KEY,
	"building_id" integer NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'resident' NOT NULL,
	"unit_label" text DEFAULT '' NOT NULL,
	"share_label" text DEFAULT '' NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"invitation_sent" boolean DEFAULT false NOT NULL,
	"invited_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pending_members_building_email_idx" ON "pending_members" ("building_id","email");--> statement-breakpoint
CREATE INDEX "pending_members_email_idx" ON "pending_members" ("email");--> statement-breakpoint
ALTER TABLE "pending_members" ADD CONSTRAINT "pending_members_building_id_buildings_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pending_members" ADD CONSTRAINT "pending_members_invited_by_user_id_users_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;