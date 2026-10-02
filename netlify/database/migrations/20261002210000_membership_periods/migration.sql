-- La migration précédente a introduit ended_at. On le conserve en le renommant :
-- il devient l'instant technique de révocation, distinct de la date métier.
ALTER TABLE "building_members" RENAME COLUMN "ended_at" TO "revoked_at";
--> statement-breakpoint
ALTER TABLE "building_members" ADD COLUMN "ended_on" date;
--> statement-breakpoint
UPDATE "building_members"
SET "ended_on" = ("revoked_at" AT TIME ZONE 'Europe/Brussels')::date
WHERE "revoked_at" IS NOT NULL AND "ended_on" IS NULL;
--> statement-breakpoint
DROP INDEX "building_members_building_user_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "building_members_active_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "building_members_active_user_idx"
ON "building_members" ("building_id", "user_id")
WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "building_members_active_idx" ON "building_members" ("building_id", "revoked_at");
