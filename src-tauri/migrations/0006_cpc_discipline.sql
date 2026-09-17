-- SQLite cannot alter a CHECK constraint in place.  Rebuild the events table
-- while foreign keys are temporarily disabled by the migration runner.
CREATE TABLE events_cpc_migration (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  archived_at TEXT,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  kind TEXT NOT NULL CHECK(kind IN ('match','utm','build')),
  discipline TEXT NOT NULL CHECK(discipline IN ('pistol','carbine','cpc','shotgun','airgun','multigun','other')),
  series TEXT NOT NULL CHECK(series IN ('regular','trf','allRussian','departmental','spbCup','other')),
  source TEXT NOT NULL CHECK(source IN ('manual','ekp')),
  status TEXT NOT NULL CHECK(status IN ('draft','tentative','confirmed')),
  competition_status TEXT,
  competition_region TEXT,
  competition_phase TEXT,
  competition_stage_number INTEGER,
  start_date TEXT,
  end_date TEXT,
  is_primary INTEGER NOT NULL DEFAULT 1 CHECK(is_primary IN (0,1)),
  parent_event_id TEXT REFERENCES events(id) ON DELETE RESTRICT,
  venue TEXT NOT NULL DEFAULT '',
  venue_scope TEXT NOT NULL CHECK(venue_scope IN ('nevsky','spb','otherRegion','unspecified')),
  notes TEXT NOT NULL DEFAULT '',
  sticker_color TEXT NOT NULL DEFAULT '#808080',
  registration_mode TEXT NOT NULL CHECK(registration_mode IN ('free','scheduled')),
  registration_opens_at TEXT,
  registration_closes_at TEXT,
  priority_one_alerts INTEGER NOT NULL DEFAULT 0 CHECK(priority_one_alerts IN (0,1)),
  ekp_level TEXT,
  ekp_stage_number INTEGER,
  cover_path TEXT,
  daylight_buffer_minutes INTEGER NOT NULL DEFAULT 15 CHECK(daylight_buffer_minutes BETWEEN 0 AND 120),
  planned_exercise_count INTEGER CHECK(planned_exercise_count BETWEEN 1 AND 40),
  planned_squad_count INTEGER CHECK(planned_squad_count BETWEEN 1 AND 80),
  organizer_name TEXT NOT NULL DEFAULT '',
  calendar_year INTEGER NOT NULL DEFAULT 2026 CHECK(calendar_year BETWEEN 2026 AND 2100),
  CHECK(start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);

INSERT INTO events_cpc_migration
SELECT * FROM events;

DROP TABLE events;
ALTER TABLE events_cpc_migration RENAME TO events;

CREATE INDEX IF NOT EXISTS idx_events_dates ON events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_events_archived ON events(archived_at);
CREATE INDEX IF NOT EXISTS idx_events_calendar_year ON events(calendar_year, archived_at);
