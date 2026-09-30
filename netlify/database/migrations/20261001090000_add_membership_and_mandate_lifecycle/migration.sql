-- Additive lifecycle fields. Existing memberships and mandates remain active.
ALTER TABLE "building_members" ADD COLUMN IF NOT EXISTS "ended_at" timestamp;
ALTER TABLE "building_members" ADD COLUMN IF NOT EXISTS "ended_reason" text DEFAULT '' NOT NULL;
CREATE INDEX IF NOT EXISTS "building_members_active_idx" ON "building_members" ("building_id", "ended_at");

ALTER TABLE "unit_person_relations" ADD COLUMN IF NOT EXISTS "end_reason" text DEFAULT '' NOT NULL;

ALTER TABLE "building_professionals" ADD COLUMN IF NOT EXISTS "user_id" text REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "building_professionals" ADD COLUMN IF NOT EXISTS "end_reason" text DEFAULT '' NOT NULL;
CREATE INDEX IF NOT EXISTS "building_professionals_active_syndic_idx"
  ON "building_professionals" ("building_id", "professional_type", "ended_at")
  WHERE "professional_type" = 'syndic';

ALTER TABLE "general_assemblies" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;

CREATE TABLE IF NOT EXISTS "syndic_onboarding_invites" (
  "id" serial PRIMARY KEY,
  "email" text NOT NULL UNIQUE,
  "organization_name" text DEFAULT '' NOT NULL,
  "invited_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "expires_at" timestamp NOT NULL,
  "accepted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "syndic_onboarding_invites_expiry_idx" ON "syndic_onboarding_invites" ("expires_at");

-- Rollback (manual, only after confirming no lifecycle data is needed): drop the
-- index, then the five columns above. Production application is intentionally
-- outside this migration and must follow a reviewed release procedure.
