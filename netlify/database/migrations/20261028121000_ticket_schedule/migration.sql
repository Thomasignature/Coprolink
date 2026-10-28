ALTER TABLE tickets ADD COLUMN scheduled_on date;
ALTER TABLE tickets ADD COLUMN scheduled_time text NOT NULL DEFAULT '';
