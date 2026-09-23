const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryCalendarRepository } = require('../../.tmp/domain-test/src/storage/InMemoryCalendarRepository.js');
const { RevisionConflictError } = require('../../.tmp/domain-test/src/domain/revision.js');

function data(overrides = {}) {
  return {
    title: 'Тестовый матч', organizerName: 'Организатор', kind: 'match', discipline: 'pistol', series: 'regular', source: 'manual', status: 'draft',
    competitionStatus: null, competitionRegion: 'Санкт-Петербург', competitionPhase: null, competitionStageNumber: null,
    startDate: null, endDate: null, isPrimary: true, parentEventId: null, venue: '', venueScope: 'unspecified', notes: '', stickerColor: '#808080',
    registration: { mode: 'free', opensAt: null, closesAt: null, priorityOneAlerts: false }, ekpLevel: null, ekpStageNumber: null, coverPath: null,
    daylightBufferMinutes: 15, shifts: [], plannedExerciseCount: null, plannedSquadCount: null, ...overrides,
  };
}

function repo() {
  let id = 0;
  return new InMemoryCalendarRepository(() => `audit-${++id}`);
}

test('undated event remains associated with its calendar year', async () => {
  const storage = repo();
  await storage.saveEvent({ kind: 'create', id: 'event-1', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-03T08:00:00+03:00', data: data() }, null);
  assert.equal((await storage.listEvents(2026)).length, 0);
  assert.equal((await storage.listEvents(2027)).length, 1);
});

test('update increments revision and stale update cannot overwrite it', async () => {
  const storage = repo();
  const created = await storage.saveEvent({ kind: 'create', id: 'event-1', calendarYear: 2026, actor: 'owner', timestamp: '2026-09-03T08:00:00+03:00', data: data() }, null);
  const updated = await storage.saveEvent({ kind: 'update', id: 'event-1', actor: 'owner', timestamp: '2026-09-03T08:01:00+03:00', changes: { title: 'Новая версия' } }, created.revision);
  assert.equal(updated.revision, 2);
  await assert.rejects(
    storage.saveEvent({ kind: 'update', id: 'event-1', actor: 'owner', timestamp: '2026-09-03T08:02:00+03:00', changes: { title: 'Старая форма' } }, 1),
    RevisionConflictError,
  );
  assert.equal((await storage.getEvent('event-1')).title, 'Новая версия');
});

test('archive is soft, hidden by default and restorable', async () => {
  const storage = repo();
  const created = await storage.saveEvent({ kind: 'create', id: 'event-1', calendarYear: 2026, actor: 'owner', timestamp: '2026-09-03T08:00:00+03:00', data: data() }, null);
  const archived = await storage.archiveEvent('event-1', created.revision, 'owner', '2026-09-03T08:01:00+03:00');
  assert.equal((await storage.listEvents(2026)).length, 0);
  assert.equal((await storage.listEvents(2026, true)).length, 1);
  const restored = await storage.restoreEvent('event-1', archived.revision, 'owner', '2026-09-03T08:02:00+03:00');
  assert.equal(restored.archivedAt, null);
  assert.equal(restored.revision, 3);
});

test('permanent deletion removes a parent, its descendants and their audit history', async () => {
  const storage = repo();
  const parent = await storage.saveEvent({ kind: 'create', id: 'parent', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-03T08:00:00+03:00', data: data() }, null);
  await storage.saveEvent({ kind: 'create', id: 'child', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-03T08:01:00+03:00', data: data({ parentEventId: 'parent', isPrimary: false }) }, null);
  await storage.saveEvent({ kind: 'create', id: 'grandchild', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-03T08:02:00+03:00', data: data({ parentEventId: 'child', isPrimary: false }) }, null);
  assert.deepEqual(await storage.deleteEvent('parent', parent.revision, 'owner', '2026-09-03T08:03:00+03:00'), ['parent', 'child', 'grandchild']);
  assert.equal(await storage.getEvent('parent'), null);
  assert.equal(await storage.getEvent('child'), null);
  assert.equal((await storage.list({})).filter((entry) => ['parent', 'child', 'grandchild'].includes(entry.entityId)).length, 0);
});

test('audit is append-only for create, update, archive and restore', async () => {
  const storage = repo();
  const created = await storage.saveEvent({ kind: 'create', id: 'event-1', calendarYear: 2026, actor: 'owner', timestamp: '2026-09-03T08:00:00+03:00', data: data() }, null);
  const updated = await storage.saveEvent({ kind: 'update', id: 'event-1', actor: 'owner', timestamp: '2026-09-03T08:01:00+03:00', changes: { notes: 'x' } }, created.revision);
  const archived = await storage.archiveEvent('event-1', updated.revision, 'owner', '2026-09-03T08:02:00+03:00');
  await storage.restoreEvent('event-1', archived.revision, 'owner', '2026-09-03T08:03:00+03:00');
  const audit = await storage.list({ entityId: 'event-1' });
  assert.deepEqual(audit.map((entry) => entry.action), ['create', 'update', 'archive', 'restore']);
  assert.deepEqual(audit.map((entry) => entry.resultingRevision), [1, 2, 3, 4]);
});

test('calendar settings update keeps calendar_settings audit entity type even when mode does not change', async () => {
  const storage = repo();
  const initial = await storage.getCalendarSettings(2027);
  const updated = await storage.saveCalendarSettings({ year: 2027, mode: 'planning', actor: 'owner', timestamp: '2026-09-03T08:05:00+03:00', acceptedWarningKeys: ['risk-b', 'risk-a', 'risk-a'] }, initial.revision);
  assert.equal(updated.revision, 2);
  assert.deepEqual(updated.acceptedWarningKeys, ['risk-a', 'risk-b']);
  const audit = await storage.list({ entityId: '2027' });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'update');
  assert.equal(audit[0].entityType, 'calendar_settings');
});

test('calendar approval and reopen are revisioned and audited', async () => {
  const storage = repo();
  const initial = await storage.getCalendarSettings(2027);
  assert.equal(initial.mode, 'planning');
  assert.equal(initial.revision, 1);

  const approved = await storage.saveCalendarSettings({ year: 2027, mode: 'approved', actor: 'owner', timestamp: '2026-09-03T08:10:00+03:00' }, initial.revision);
  assert.equal(approved.mode, 'approved');
  assert.equal(approved.revision, 2);
  assert.equal(approved.approvedBy, 'owner');

  await assert.rejects(
    storage.saveCalendarSettings({ year: 2027, mode: 'planning', actor: 'owner', timestamp: '2026-09-03T08:11:00+03:00' }, initial.revision),
    RevisionConflictError,
  );

  const reopened = await storage.saveCalendarSettings({ year: 2027, mode: 'planning', actor: 'owner', timestamp: '2026-09-03T08:12:00+03:00' }, approved.revision);
  assert.equal(reopened.mode, 'planning');
  assert.equal(reopened.revision, 3);
  assert.equal(reopened.reopenedBy, 'owner');

  const audit = await storage.list({ entityId: '2027' });
  assert.deepEqual(audit.map((entry) => entry.action), ['approve', 'reopen']);
});
