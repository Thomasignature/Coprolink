ALTER TABLE inbound_emails
  ADD COLUMN IF NOT EXISTS document_action_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS document_ids_json text NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS document_actioned_at timestamp,
  ADD COLUMN IF NOT EXISTS ticket_action_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ticket_reference text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ticket_actioned_at timestamp,
  ADD COLUMN IF NOT EXISTS announcement_action_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS announcement_id integer,
  ADD COLUMN IF NOT EXISTS announcement_actioned_at timestamp;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS folder text NOT NULL DEFAULT 'Documents reçus';
