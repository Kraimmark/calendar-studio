const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArchivedLibrary } = require('../../.tmp/domain-test/src/domain/archivedLibrary.js');

function event(id, overrides = {}) {
  return {
    id, calendarYear: 2027, revision: 2,
    createdAt: '2026-09-03T00:00:00Z', createdBy: 'owner', updatedAt: '2026-09-03T00:00:00Z', updatedBy: 'owner', archivedAt: '2026-09-04T00:00:00Z',
    title: id, organizerName: '', kind: 'match', discipline: 'pistol', series: 'regular', source: 'manual', status: 'draft',
    competitionStatus: null, competitionRegion: null, competitionPhase: null, competitionStageNumber: null,
    startDate: null, endDate: null, isPrimary: true, parentEventId: null, venue: '', venueScope: 'unspecified', notes: '', stickerColor: '#808080',
    registration: { mode: 'free', opensAt: null, closesAt: null, priorityOneAlerts: false }, ekpLevel: null, ekpStageNumber: null, coverPath: null,
    daylightBufferMinutes: 15, shifts: [], plannedExerciseCount: null, plannedSquadCount: null,
    ...overrides,
  };
}

test('archive library contains only soft-archived events and never mutates input', () => {
  const events = [event('archived'), event('active', { archivedAt: null })];
  const before = events.map((item) => item.id).join(',');
  assert.deepEqual(buildArchivedLibrary(events, '', 'archived-desc').map((item) => item.id), ['archived']);
  assert.equal(events.map((item) => item.id).join(','), before);
});

test('archive search covers planning metadata and historical date text', () => {
  const events = [
    event('a', { title: 'Кубок осени', organizerName: 'Невский', startDate: '2027-10-03', endDate: '2027-10-05' }),
    event('b', { title: 'Весна', notes: 'Ночной формат', discipline: 'shotgun' }),
  ];
  assert.deepEqual(buildArchivedLibrary(events, 'невский', 'title-asc').map((item) => item.id), ['a']);
  assert.deepEqual(buildArchivedLibrary(events, '2027-10-03', 'title-asc').map((item) => item.id), ['a']);
});

test('archive sorting is explicit and deterministic', () => {
  const events = [
    event('b', { title: 'Бета', archivedAt: '2026-09-03T20:00:00Z', startDate: null }),
    event('a', { title: 'Альфа', archivedAt: '2026-09-04T01:00:00Z', startDate: '2027-04-01', endDate: '2027-04-01' }),
  ];
  assert.deepEqual(buildArchivedLibrary(events, '', 'archived-desc').map((item) => item.id), ['a', 'b']);
  assert.deepEqual(buildArchivedLibrary(events, '', 'title-asc').map((item) => item.id), ['a', 'b']);
  assert.deepEqual(buildArchivedLibrary(events, '', 'date-asc').map((item) => item.id), ['a', 'b']);
});
