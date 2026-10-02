ALTER TABLE "building_members" ADD COLUMN "ended_at" timestamp;
--> statement-breakpoint
ALTER TABLE "building_members" ADD COLUMN "end_reason" text;
--> statement-breakpoint
CREATE INDEX "building_members_active_idx" ON "building_members" ("building_id", "ended_at");
