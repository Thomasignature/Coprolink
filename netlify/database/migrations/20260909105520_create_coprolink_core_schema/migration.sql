CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY,
	"building_id" integer NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"author_user_id" text,
	"published_on" date DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY,
	"building_id" integer,
	"actor_user_id" text,
	"actor_label" text DEFAULT '' NOT NULL,
	"actor_role" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text DEFAULT '' NOT NULL,
	"entity_id" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "building_members" (
	"id" serial PRIMARY KEY,
	"building_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'resident' NOT NULL,
	"unit_label" text DEFAULT '' NOT NULL,
	"share_label" text DEFAULT '' NOT NULL,
	"quarterly_call" numeric(10,2) DEFAULT '0' NOT NULL,
	"balance" numeric(10,2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buildings" (
	"id" serial PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"lots" integer DEFAULT 0 NOT NULL,
	"manager_name" text DEFAULT '' NOT NULL,
	"emergency_phone" text DEFAULT '' NOT NULL,
	"reserve_fund" numeric(12,2) DEFAULT '0' NOT NULL,
	"yearly_budget" numeric(12,2) DEFAULT '0' NOT NULL,
	"yearly_spent" numeric(12,2) DEFAULT '0' NOT NULL,
	"health_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY,
	"building_id" integer NOT NULL,
	"name" text NOT NULL,
	"file_type" text DEFAULT 'PDF' NOT NULL,
	"access" text DEFAULT 'private' NOT NULL,
	"storage_key" text,
	"updated_on" date DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY,
	"building_id" integer NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"event_date" date NOT NULL,
	"event_time" text DEFAULT '' NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terminals" (
	"id" serial PRIMARY KEY,
	"building_id" integer NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"token_hint" text DEFAULT '' NOT NULL,
	"can_report" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp,
	"revoked_at" timestamp,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_updates" (
	"id" serial PRIMARY KEY,
	"ticket_id" integer NOT NULL,
	"label" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"from_status" text,
	"to_status" text,
	"author_user_id" text,
	"author_label" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY,
	"reference" text NOT NULL UNIQUE,
	"building_id" integer NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'Autre' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"reporter_label" text DEFAULT '' NOT NULL,
	"reporter_user_id" text,
	"reporter_terminal_id" integer,
	"next_step" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY,
	"email" text NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "announcements_building_idx" ON "announcements" ("building_id");--> statement-breakpoint
CREATE INDEX "audit_log_building_idx" ON "audit_log" ("building_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "building_members_building_user_idx" ON "building_members" ("building_id","user_id");--> statement-breakpoint
CREATE INDEX "building_members_user_idx" ON "building_members" ("user_id");--> statement-breakpoint
CREATE INDEX "documents_building_access_idx" ON "documents" ("building_id","access");--> statement-breakpoint
CREATE INDEX "events_building_date_idx" ON "events" ("building_id","event_date");--> statement-breakpoint
CREATE INDEX "terminals_building_idx" ON "terminals" ("building_id");--> statement-breakpoint
CREATE INDEX "ticket_updates_ticket_idx" ON "ticket_updates" ("ticket_id");--> statement-breakpoint
CREATE INDEX "tickets_building_status_idx" ON "tickets" ("building_id","status");--> statement-breakpoint
CREATE INDEX "tickets_reporter_idx" ON "tickets" ("reporter_user_id");--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_building_id_buildings_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_user_id_users_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_building_id_buildings_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "building_members" ADD CONSTRAINT "building_members_building_id_buildings_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "building_members" ADD CONSTRAINT "building_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_building_id_buildings_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_building_id_buildings_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_building_id_buildings_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_created_by_user_id_users_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ticket_updates" ADD CONSTRAINT "ticket_updates_ticket_id_tickets_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ticket_updates" ADD CONSTRAINT "ticket_updates_author_user_id_users_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_building_id_buildings_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reporter_user_id_users_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE SET NULL;