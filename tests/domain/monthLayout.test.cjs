const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMonth } = require('../../.tmp/domain-test/src/domain/calendar.js');
const { buildMonthEventSegments, monthLaneCount } = require('../../.tmp/domain-test/src/domain/monthLayout.js');

function event(id, startDate, endDate, overrides = {}) {
  return {
    id, calendarYear: 2026, revision: 1, createdAt: 'x', createdBy: 'owner', updatedAt: 'x', updatedBy: 'owner', archivedAt: null,
    title: id, organizerName: '', kind: 'match', discipline: 'pistol', series: 'regular', source: 'manual', status: 'draft',
    competitionStatus: null, competitionRegion: null, competitionPhase: null, competitionStageNumber: null,
    startDate, endDate, isPrimary: true, parentEventId: null, venue: '', venueScope: 'unspecified', notes: '', stickerColor: '#808080',
    registration: { mode: 'free', opensAt: null, closesAt: null, priorityOneAlerts: false }, ekpLevel: null, ekpStageNumber: null, coverPath: null,
    daylightBufferMinutes: 15, shifts: [], plannedExerciseCount: null, plannedSquadCount: null, ...overrides,
  };
}

test('multi-day event splits at week boundary and keeps continuous spans', () => {
  const model = buildMonth(2026, 9);
  const segments = buildMonthEventSegments(model, [event('A', '2026-09-05', '2026-09-09')]);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map(({ weekIndex, startColumn, span, startsHere, endsHere }) => ({ weekIndex, startColumn, span, startsHere, endsHere })), [
    { weekIndex: 0, startColumn: 5, span: 2, startsHere: true, endsHere: false },
    { weekIndex: 1, startColumn: 0, span: 3, startsHere: false, endsHere: true },
  ]);
});

test('overlapping segments are assigned different lanes while non-overlap reuses a lane', () => {
  const model = buildMonth(2026, 9);
  const segments = buildMonthEventSegments(model, [
    event('A', '2026-09-01', '2026-09-03'),
    event('B', '2026-09-02', '2026-09-04'),
    event('C', '2026-09-05', '2026-09-06'),
  ]).filter((segment) => segment.weekIndex === 0);
  const byId = Object.fromEntries(segments.map((segment) => [segment.eventId, segment]));
  assert.notEqual(byId.A.lane, byId.B.lane);
  assert.equal(byId.C.lane, byId.A.lane);
  assert.equal(monthLaneCount(segments, 0), 2);
});

test('undated and archived events do not produce calendar segments', () => {
  const model = buildMonth(2026, 9);
  const segments = buildMonthEventSegments(model, [
    event('undated', null, null),
    event('archived', '2026-09-01', '2026-09-01', { archivedAt: 'x' }),
  ]);
  assert.deepEqual(segments, []);
});
