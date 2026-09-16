ALTER TABLE inbound_emails
  ADD COLUMN IF NOT EXISTS calendar_action_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS calendar_event_id integer REFERENCES events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS calendar_actioned_at timestamp;

CREATE INDEX IF NOT EXISTS inbound_emails_calendar_event_idx
  ON inbound_emails(calendar_event_id);
