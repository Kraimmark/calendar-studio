ALTER TABLE events ADD COLUMN calendar_year INTEGER NOT NULL DEFAULT 2026 CHECK(calendar_year BETWEEN 2026 AND 2100);
CREATE INDEX IF NOT EXISTS idx_events_calendar_year ON events(calendar_year, archived_at);
