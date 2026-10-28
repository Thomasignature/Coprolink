CREATE TABLE notification_outbox (
 id serial PRIMARY KEY, building_id integer NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind text NOT NULL,
 entity_id integer NOT NULL, source_key text NOT NULL, status text NOT NULL DEFAULT 'pending',
 attempts integer NOT NULL DEFAULT 0, last_error text NOT NULL DEFAULT '', provider_id text,
 created_at timestamp NOT NULL DEFAULT now(), attempted_at timestamp, sent_at timestamp,
 UNIQUE(source_key, user_id)
);
CREATE INDEX notification_outbox_status_idx ON notification_outbox(status,created_at);
