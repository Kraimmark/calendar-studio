const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

test('SQLite migrations apply in order and organizer column exists', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.resolve('src-tauri/migrations/0001_init.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.resolve('src-tauri/migrations/0002_event_organizer_name.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.resolve('src-tauri/migrations/0003_event_calendar_year.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.resolve('src-tauri/migrations/0004_backfill_calendar_year.sql'), 'utf8'));
  const columns = db.prepare('PRAGMA table_info(events)').all().map((row) => row.name);
  assert.ok(columns.includes('organizer_name'));
  assert.ok(columns.includes('calendar_year'));
  assert.ok(columns.includes('revision'));
  assert.ok(columns.includes('archived_at'));
  assert.ok(columns.includes('parent_event_id'));
  db.close();
});

test('calendar-year backfill repairs dated rows from the early default-year migration', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.resolve('src-tauri/migrations/0001_init.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.resolve('src-tauri/migrations/0002_event_organizer_name.sql'), 'utf8'));
  db.prepare(`INSERT INTO events(
    id,revision,created_at,created_by,updated_at,updated_by,title,kind,discipline,series,source,status,start_date,end_date,
    is_primary,venue,venue_scope,notes,sticker_color,registration_mode,priority_one_alerts,daylight_buffer_minutes,organizer_name
  ) VALUES('legacy-2027',1,'x','owner','x','owner','Legacy','match','pistol','regular','manual','draft','2027-05-01','2027-05-02',1,'','unspecified','','#808080','free',0,15,'')`).run();
  db.exec(fs.readFileSync(path.resolve('src-tauri/migrations/0003_event_calendar_year.sql'), 'utf8'));
  assert.equal(db.prepare('SELECT calendar_year FROM events WHERE id=?').get('legacy-2027').calendar_year, 2026);
  db.exec(fs.readFileSync(path.resolve('src-tauri/migrations/0004_backfill_calendar_year.sql'), 'utf8'));
  assert.equal(db.prepare('SELECT calendar_year FROM events WHERE id=?').get('legacy-2027').calendar_year, 2027);
  db.close();
});
