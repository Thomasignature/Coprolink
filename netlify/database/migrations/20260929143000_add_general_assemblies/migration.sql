CREATE TABLE "general_assemblies" (
  "id" serial PRIMARY KEY,
  "building_id" integer NOT NULL,
  "title" text DEFAULT 'Assemblée générale' NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "assembly_date" date NOT NULL,
  "assembly_time" text DEFAULT '' NOT NULL,
  "location" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'scheduled' NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "general_assemblies_building_date_idx" ON "general_assemblies" ("building_id","assembly_date");
--> statement-breakpoint
ALTER TABLE "general_assemblies" ADD CONSTRAINT "general_assemblies_building_id_buildings_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "general_assemblies" ADD CONSTRAINT "general_assemblies_created_by_user_id_users_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint

CREATE TABLE "assembly_agenda_items" (
  "id" serial PRIMARY KEY,
  "assembly_id" integer NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "title" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "assembly_agenda_items_assembly_idx" ON "assembly_agenda_items" ("assembly_id","position");
--> statement-breakpoint
ALTER TABLE "assembly_agenda_items" ADD CONSTRAINT "assembly_agenda_items_assembly_id_general_assemblies_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "general_assemblies"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE TABLE "assembly_responses" (
  "id" serial PRIMARY KEY,
  "assembly_id" integer NOT NULL,
  "person_id" integer NOT NULL,
  "user_id" text,
  "response_type" text DEFAULT 'present' NOT NULL,
  "proxy_name" text DEFAULT '' NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "assembly_responses_assembly_person_idx" ON "assembly_responses" ("assembly_id","person_id");
--> statement-breakpoint
CREATE INDEX "assembly_responses_assembly_idx" ON "assembly_responses" ("assembly_id");
--> statement-breakpoint
ALTER TABLE "assembly_responses" ADD CONSTRAINT "assembly_responses_assembly_id_general_assemblies_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "general_assemblies"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "assembly_responses" ADD CONSTRAINT "assembly_responses_person_id_building_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "building_people"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "assembly_responses" ADD CONSTRAINT "assembly_responses_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;