ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'normal' NOT NULL;
