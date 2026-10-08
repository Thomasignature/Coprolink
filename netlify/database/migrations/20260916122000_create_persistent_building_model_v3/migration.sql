CREATE TABLE "building_units" (
  "id" serial PRIMARY KEY,
  "building_id" integer NOT NULL,
  "label" text NOT NULL,
  "floor" text DEFAULT '' NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "share_label" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "building_units_building_label_idx" ON "building_units" ("building_id","label");
--> statement-breakpoint
CREATE INDEX "building_units_building_floor_idx" ON "building_units" ("building_id","floor");
--> statement-breakpoint
ALTER TABLE "building_units" ADD CONSTRAINT "building_units_building_id_buildings_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE TABLE "building_people" (
  "id" serial PRIMARY KEY,
  "building_id" integer NOT NULL,
  "user_id" text,
  "full_name" text DEFAULT '' NOT NULL,
  "email" text DEFAULT '' NOT NULL,
  "phone" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "building_people_building_user_idx" ON "building_people" ("building_id","user_id") WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "building_people_building_name_idx" ON "building_people" ("building_id","full_name");
--> statement-breakpoint
ALTER TABLE "building_people" ADD CONSTRAINT "building_people_building_id_buildings_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "building_people" ADD CONSTRAINT "building_people_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint

CREATE TABLE "unit_person_relations" (
  "id" serial PRIMARY KEY,
  "unit_id" integer NOT NULL,
  "person_id" integer NOT NULL,
  "relation_type" text NOT NULL,
  "share_label" text DEFAULT '' NOT NULL,
  "start_date" date,
  "end_date" date,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "unit_person_relations_unit_idx" ON "unit_person_relations" ("unit_id");
--> statement-breakpoint
CREATE INDEX "unit_person_relations_person_idx" ON "unit_person_relations" ("person_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "unit_person_relations_active_unique_idx" ON "unit_person_relations" ("unit_id","person_id","relation_type") WHERE "end_date" IS NULL;
--> statement-breakpoint
ALTER TABLE "unit_person_relations" ADD CONSTRAINT "unit_person_relations_unit_id_building_units_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "building_units"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "unit_person_relations" ADD CONSTRAINT "unit_person_relations_person_id_building_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "building_people"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE TABLE "building_referents" (
  "id" serial PRIMARY KEY,
  "building_id" integer NOT NULL,
  "person_id" integer NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "ended_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "building_referents_active_person_idx" ON "building_referents" ("building_id","person_id") WHERE "ended_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "building_referents_building_idx" ON "building_referents" ("building_id");
--> statement-breakpoint
ALTER TABLE "building_referents" ADD CONSTRAINT "building_referents_building_id_buildings_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "building_referents" ADD CONSTRAINT "building_referents_person_id_building_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "building_people"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE TABLE "building_professionals" (
  "id" serial PRIMARY KEY,
  "building_id" integer NOT NULL,
  "professional_type" text NOT NULL,
  "organization_name" text DEFAULT '' NOT NULL,
  "contact_name" text DEFAULT '' NOT NULL,
  "email" text DEFAULT '' NOT NULL,
  "phone" text DEFAULT '' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "started_at" date,
  "ended_at" date,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "building_professionals_building_type_idx" ON "building_professionals" ("building_id","professional_type");
--> statement-breakpoint
ALTER TABLE "building_professionals" ADD CONSTRAINT "building_professionals_building_id_buildings_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE TABLE "person_visibility_preferences" (
  "person_id" integer PRIMARY KEY,
  "directory_visible" boolean DEFAULT true NOT NULL,
  "hall_visible" boolean DEFAULT false NOT NULL,
  "show_email" boolean DEFAULT false NOT NULL,
  "show_phone" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person_visibility_preferences" ADD CONSTRAINT "person_visibility_preferences_person_id_building_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "building_people"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- Transition sûre : crée des lots à partir des libellés explicites déjà présents.
INSERT INTO "building_units" ("building_id", "label", "share_label")
SELECT DISTINCT bm."building_id", bm."unit_label", bm."share_label"
FROM "building_members" bm
WHERE trim(bm."unit_label") <> ''
ON CONFLICT ("building_id", "label") DO NOTHING;
--> statement-breakpoint

-- Crée une fiche personne par membre existant, sans changer les accès actuels.
INSERT INTO "building_people" ("building_id", "user_id", "full_name", "email")
SELECT bm."building_id", bm."user_id", u."full_name", u."email"
FROM "building_members" bm
JOIN "users" u ON u."id" = bm."user_id"
ON CONFLICT ("building_id", "user_id") WHERE "user_id" IS NOT NULL DO NOTHING;
--> statement-breakpoint

-- Les anciens membres non professionnels sont migrés comme copropriétaires du lot existant.
INSERT INTO "unit_person_relations" ("unit_id", "person_id", "relation_type", "share_label")
SELECT bu."id", bp."id", 'owner', bm."share_label"
FROM "building_members" bm
JOIN "building_units" bu ON bu."building_id" = bm."building_id" AND bu."label" = bm."unit_label"
JOIN "building_people" bp ON bp."building_id" = bm."building_id" AND bp."user_id" = bm."user_id"
WHERE bm."role" IN ('resident','council_member') AND trim(bm."unit_label") <> ''
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Le syndic historique devient un professionnel lié à l'immeuble, sans prendre possession de l'espace CoproLink.
INSERT INTO "building_professionals" ("building_id", "professional_type", "organization_name")
SELECT b."id", 'syndic', b."manager_name"
FROM "buildings" b
WHERE trim(b."manager_name") <> '';
