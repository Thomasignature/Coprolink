-- Aligne le snapshot drizzle sur db/schema.ts. La colonne est déjà créée par
-- 20260916175500_add_inbox_validated_actions : l'instruction est donc idempotente.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "folder" text DEFAULT 'Documents reçus' NOT NULL;
