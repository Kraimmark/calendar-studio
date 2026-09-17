const test = require('node:test');
const assert = require('node:assert/strict');
const { preparationZonesByDate } = require('../../.tmp/domain-test/src/domain/preparationZones.js');

function event(id, startDate, overrides = {}) {
  return {
    id, calendarYear: 2027, revision: 1, createdAt: '2027-01-01T00:00:00Z', createdBy: 'test', updatedAt: '2027-01-01T00:00:00Z', updatedBy: 'test', archivedAt: null,
    title: id, organizerName: '', kind: 'match', discipline: 'pistol', series: 'allRussian', source: 'ekp', status: 'confirmed', competitionStatus: null, competitionRegion: null, competitionPhase: null, competitionStageNumber: null,
    startDate, endDate: startDate, isPrimary: true, parentEventId: null, venue: '', venueScope: 'otherRegion', notes: '', stickerColor: '#808080', registration: { mode: 'free', opensAt: null, closesAt: null, priorityOneAlerts: false }, ekpLevel: null, ekpStageNumber: null, coverPath: null, daylightBufferMinutes: 0, shifts: [], plannedExerciseCount: null, plannedSquadCount: null,
    ...overrides,
  };
}

test('all-Russian preparation zone occupies exactly fourteen prior days', () => {
  const zones = preparationZonesByDate(2027, [event('cup', '2027-08-16')]);
  assert.equal(zones.size, 14);
  assert.deepEqual([...zones.keys()].sort(), ['2027-08-02','2027-08-03','2027-08-04','2027-08-05','2027-08-06','2027-08-07','2027-08-08','2027-08-09','2027-08-10','2027-08-11','2027-08-12','2027-08-13','2027-08-14','2027-08-15']);
  assert.equal(zones.has('2027-08-16'), false);
});

test('zone is clipped at the calendar-year boundary and ignores ordinary events', () => {
  const zones = preparationZonesByDate(2027, [event('january', '2027-01-08'), event('ordinary', '2027-06-12', { series: 'regular' })]);
  assert.deepEqual([...zones.keys()].sort(), ['2027-01-01','2027-01-02','2027-01-03','2027-01-04','2027-01-05','2027-01-06','2027-01-07']);
});
