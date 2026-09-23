const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function migrate(db) {
  for (const file of ['0001_init.sql','0002_event_organizer_name.sql','0003_event_calendar_year.sql','0004_backfill_calendar_year.sql']) {
    db.exec(fs.readFileSync(path.join(__dirname, '../../src-tauri/migrations', file), 'utf8'));
  }
}

function insertEvent(db, id, title, parentId = null) {
  db.prepare(`INSERT INTO events(
    id,revision,created_at,created_by,updated_at,updated_by,title,kind,discipline,series,source,status,parent_event_id,
    venue_scope,registration_mode,organizer_name,calendar_year
  ) VALUES(?,1,'2026-09-03T09:00:00Z','owner','2026-09-03T09:00:00Z','owner',?,'match','pistol','regular','manual','draft',?,'unspecified','free','Org',2027)`)
    .run(id, title, parentId);
}

test('SQLite VACUUM backup preserves pre-import state while live DB is replaced', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-portable-'));
  const dbPath = path.join(dir, 'calendar.db');
  const backupPath = path.join(dir, 'backup.db');
  const db = new DatabaseSync(dbPath);
  migrate(db);
  insertEvent(db, 'old', 'Old state');
  db.prepare("INSERT INTO audit_log(audit_id,timestamp,actor,entity_type,entity_id,action,resulting_revision,payload_summary) VALUES('audit-old','2026-09-03T09:00:00Z','owner','event','old','create',1,'created')").run();
  db.prepare('VACUUM INTO ?').run(backupPath);

  db.exec('BEGIN IMMEDIATE');
  db.exec('DELETE FROM event_shifts; UPDATE events SET parent_event_id=NULL; DELETE FROM events; DELETE FROM calendar_settings; DELETE FROM audit_log;');
  insertEvent(db, 'new', 'Imported state');
  db.prepare("INSERT INTO audit_log(audit_id,timestamp,actor,entity_type,entity_id,action,resulting_revision,payload_summary) VALUES('audit-new','2026-09-03T09:01:00Z','owner','event','new','create',1,'created')").run();
  db.exec('COMMIT');
  assert.deepEqual(db.prepare('SELECT id,title FROM events').all().map((row) => ({ ...row })), [{ id: 'new', title: 'Imported state' }]);
  db.close();

  const backup = new DatabaseSync(backupPath);
  assert.deepEqual(backup.prepare('SELECT id,title FROM events').all().map((row) => ({ ...row })), [{ id: 'old', title: 'Old state' }]);
  assert.equal(backup.prepare('SELECT count(*) AS n FROM audit_log').get().n, 1);
  backup.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('failed replacement transaction rolls back to complete previous SQLite state', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  insertEvent(db, 'old', 'Old state');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM event_shifts; UPDATE events SET parent_event_id=NULL; DELETE FROM events; DELETE FROM audit_log;');
    // Constraint failure simulates an invalid package slipping past a caller.
    db.prepare(`INSERT INTO events(id,revision,created_at,created_by,updated_at,updated_by,title,kind,discipline,series,source,status,venue_scope,registration_mode,organizer_name,calendar_year)
      VALUES('broken',1,'x','x','x','x','Broken','invalid-kind','pistol','regular','manual','draft','unspecified','free','Org',2027)`).run();
    assert.fail('constraint should reject invalid event');
  } catch {
    db.exec('ROLLBACK');
  }
  assert.deepEqual(db.prepare('SELECT id,title FROM events').all().map((row) => ({ ...row })), [{ id: 'old', title: 'Old state' }]);
  db.close();
});
