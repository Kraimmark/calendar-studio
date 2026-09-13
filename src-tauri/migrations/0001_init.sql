PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS calendar_settings (
  year INTEGER PRIMARY KEY CHECK(year BETWEEN 2026 AND 2100),
  mode TEXT NOT NULL CHECK(mode IN ('planning', 'approved')),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  approved_at TEXT,
  approved_by TEXT,
  reopened_at TEXT,
  reopened_by TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  archived_at TEXT,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  kind TEXT NOT NULL CHECK(kind IN ('match','utm','build')),
  discipline TEXT NOT NULL CHECK(discipline IN ('pistol','carbine','shotgun','airgun','multigun','other')),
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
  CHECK(start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS event_shifts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('day','night')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  actor TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  base_revision INTEGER,
  resulting_revision INTEGER,
  payload_summary TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_dates ON events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_events_archived ON events(archived_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id, timestamp);
