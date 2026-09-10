const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function migratedDb() {
  const db = new DatabaseSync(':memory:');
  for (const name of ['0001_init.sql', '0002_event_organizer_name.sql', '0003_event_calendar_year.sql', '0004_backfill_calendar_year.sql']) {
    db.exec(fs.readFileSync(path.resolve('src-tauri/migrations', name), 'utf8'));
  }
  return db;
}

function insertEvent(db, id = 'event-1') {
  db.prepare(`INSERT INTO events(
    id,revision,created_at,created_by,updated_at,updated_by,title,kind,discipline,series,source,status,
    is_primary,venue,venue_scope,notes,sticker_color,registration_mode,priority_one_alerts,
    daylight_buffer_minutes,organizer_name,calendar_year
  ) VALUES(?,1,?,?,?,?,?,'match','pistol','regular','manual','draft',1,'','unspecified','','#808080','free',0,15,'Организатор',2026)`)
    .run(id, '2026-09-03T08:00:00+03:00', 'owner', '2026-09-03T08:00:00+03:00', 'owner', 'Тестовый матч');
}

test('entity and audit commit together in one SQLite transaction', () => {
  const db = migratedDb();
  db.exec('BEGIN IMMEDIATE');
  insertEvent(db);
  db.prepare(`INSERT INTO audit_log(audit_id,timestamp,actor,entity_type,entity_id,action,base_revision,resulting_revision,payload_summary)
              VALUES(?,?,?,?,?,?,?,?,?)`)
    .run('audit-1', '2026-09-03T08:00:00+03:00', 'owner', 'event', 'event-1', 'create', null, 1, 'created');
  db.exec('COMMIT');
  assert.equal(db.prepare('SELECT count(*) AS c FROM events').get().c, 1);
  assert.equal(db.prepare('SELECT count(*) AS c FROM audit_log').get().c, 1);
  db.close();
});

test('audit failure rolls back entity mutation when transaction is atomic', () => {
  const db = migratedDb();
  insertEvent(db);
  db.prepare(`INSERT INTO audit_log(audit_id,timestamp,actor,entity_type,entity_id,action,base_revision,resulting_revision,payload_summary)
              VALUES(?,?,?,?,?,?,?,?,?)`)
    .run('duplicate-audit', '2026-09-03T08:00:00+03:00', 'owner', 'event', 'event-1', 'create', null, 1, 'created');

  db.exec('BEGIN IMMEDIATE');
  try {
    const update = db.prepare('UPDATE events SET revision=2, title=? WHERE id=? AND revision=?').run('Не должно сохраниться', 'event-1', 1);
    assert.equal(update.changes, 1);
    db.prepare(`INSERT INTO audit_log(audit_id,timestamp,actor,entity_type,entity_id,action,base_revision,resulting_revision,payload_summary)
                VALUES(?,?,?,?,?,?,?,?,?)`)
      .run('duplicate-audit', '2026-09-03T08:01:00+03:00', 'owner', 'event', 'event-1', 'update', 1, 2, 'fields:title');
    db.exec('COMMIT');
    assert.fail('duplicate audit id should have failed');
  } catch {
    db.exec('ROLLBACK');
  }

  const event = db.prepare('SELECT revision,title FROM events WHERE id=?').get('event-1');
  assert.equal(event.revision, 1);
  assert.equal(event.title, 'Тестовый матч');
  db.close();
});

test('optimistic revision predicate prevents stale write', () => {
  const db = migratedDb();
  insertEvent(db);
  const first = db.prepare('UPDATE events SET revision=2, title=? WHERE id=? AND revision=?').run('Новая версия', 'event-1', 1);
  const stale = db.prepare('UPDATE events SET revision=2, title=? WHERE id=? AND revision=?').run('Старая форма', 'event-1', 1);
  assert.equal(first.changes, 1);
  assert.equal(stale.changes, 0);
  assert.equal(db.prepare('SELECT title FROM events WHERE id=?').get('event-1').title, 'Новая версия');
  db.close();
});
