const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUndatedLibrary } = require('../../.tmp/domain-test/src/domain/undatedLibrary.js');

function event(id, overrides = {}) {
  return {
    id, calendarYear: 2027, revision: 1,
    createdAt: '2026-09-03T00:00:00Z', createdBy: 'owner', updatedAt: '2026-09-03T00:00:00Z', updatedBy: 'owner', archivedAt: null,
    title: id, organizerName: '', kind: 'match', discipline: 'pistol', series: 'regular', source: 'manual', status: 'draft',
    competitionStatus: null, competitionRegion: null, competitionPhase: null, competitionStageNumber: null,
    startDate: null, endDate: null, isPrimary: true, parentEventId: null, venue: '', venueScope: 'unspecified', notes: '', stickerColor: '#808080',
    registration: { mode: 'free', opensAt: null, closesAt: null, priorityOneAlerts: false }, ekpLevel: null, ekpStageNumber: null, coverPath: null,
    daylightBufferMinutes: 15, shifts: [], plannedExerciseCount: null, plannedSquadCount: null,
    ...overrides,
  };
}

test('undated library excludes dated and archived events without mutating input', () => {
  const events = [event('queue'), event('dated', { startDate: '2027-01-01', endDate: '2027-01-01' }), event('archived', { archivedAt: '2026-09-04T00:00:00Z' })];
  const original = events.map((item) => item.id).join(',');
  assert.deepEqual(buildUndatedLibrary(events, '', 'updated-desc').map((item) => item.id), ['queue']);
  assert.equal(events.map((item) => item.id).join(','), original);
});

test('search covers user-facing planning metadata case-insensitively', () => {
  const events = [
    event('a', { title: 'Кубок осени', organizerName: 'Невский', venue: 'Галерея 3' }),
    event('b', { title: 'Весна', notes: 'Ночной формат', discipline: 'shotgun' }),
  ];
  assert.deepEqual(buildUndatedLibrary(events, 'НЕВСКИЙ', 'title-asc').map((item) => item.id), ['a']);
  assert.deepEqual(buildUndatedLibrary(events, 'ночной', 'title-asc').map((item) => item.id), ['b']);
});

test('sort order is explicit and deterministic', () => {
  const events = [
    event('b', { title: 'Бета', discipline: 'shotgun', updatedAt: '2026-09-02T00:00:00Z' }),
    event('a', { title: 'Альфа', discipline: 'pistol', updatedAt: '2026-09-04T00:00:00Z' }),
  ];
  assert.deepEqual(buildUndatedLibrary(events, '', 'updated-desc').map((item) => item.id), ['a', 'b']);
  assert.deepEqual(buildUndatedLibrary(events, '', 'title-asc').map((item) => item.id), ['a', 'b']);
  assert.deepEqual(buildUndatedLibrary(events, '', 'discipline-asc').map((item) => item.id), ['a', 'b']);
});
