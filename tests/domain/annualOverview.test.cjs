const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnnualOverview } = require('../../.tmp/domain-test/src/domain/annualOverview.js');

function event(id, startDate, overrides = {}) {
  return {
    id,
    calendarYear: 2027,
    revision: 1,
    createdAt: '2026-09-03T00:00:00Z', createdBy: 'owner', updatedAt: '2026-09-03T00:00:00Z', updatedBy: 'owner', archivedAt: null,
    title: id, organizerName: '', kind: 'match', discipline: 'pistol', series: 'regular', source: 'manual', status: 'draft',
    competitionStatus: null, competitionRegion: null, competitionPhase: null, competitionStageNumber: null,
    startDate, endDate: startDate, isPrimary: true, parentEventId: null, venue: '', venueScope: 'unspecified', notes: '', stickerColor: '#808080',
    registration: { mode: 'free', opensAt: null, closesAt: null, priorityOneAlerts: false }, ekpLevel: null, ekpStageNumber: null, coverPath: null,
    daylightBufferMinutes: 15, shifts: [], plannedExerciseCount: null, plannedSquadCount: null,
    ...overrides,
  };
}

test('annual overview always contains twelve ordered months', () => {
  const overview = buildAnnualOverview(2027, [], []);
  assert.equal(overview.length, 12);
  assert.deepEqual(overview.map((month) => month.month), [1,2,3,4,5,6,7,8,9,10,11,12]);
});

test('month and day counters are projections of the same events', () => {
  const overview = buildAnnualOverview(2027, [
    event('a', '2027-03-05'),
    event('b', '2027-03-05', { isPrimary: false }),
    event('c', '2027-04-01'),
    event('queue', null, { endDate: null }),
  ], []);
  const march = overview[2];
  assert.equal(march.eventCount, 2);
  assert.equal(march.primaryCount, 1);
  const fifth = march.days.find((day) => day.date === '2027-03-05');
  assert.equal(fifth.eventCount, 2);
  assert.equal(fifth.primaryCount, 1);
});

test('warning summary follows visible event ids and does not mutate warnings', () => {
  const warnings = [{ code: 'match_spacing', message: 'risk', eventIds: ['a', 'hidden'], dates: ['2027-03-05', '2027-03-12'] }];
  const original = JSON.stringify(warnings);
  const overview = buildAnnualOverview(2027, [event('a', '2027-03-05')], warnings);
  assert.equal(overview[2].warningCount, 1);
  assert.equal(overview[2].days.find((day) => day.date === '2027-03-05').warningCount, 1);
  assert.equal(JSON.stringify(warnings), original);
});

test('annual overview renders a compact entry on every day of a multi-day match', () => {
  const overview = buildAnnualOverview(2027, [
    event('cup', '2027-03-05', { title: 'Кубок Санкт-Петербурга · Пистолет', endDate: '2027-03-07', stickerColor: '#123456' }),
  ], []);
  const march = overview[2];
  const first = march.days.find((day) => day.date === '2027-03-05');
  const middle = march.days.find((day) => day.date === '2027-03-06');
  assert.equal(first.events[0].label, 'Кубок СПб · Пист…');
  assert.equal(first.events[0].startsHere, true);
  assert.equal(middle.events[0].startsHere, false);
  assert.equal(middle.events[0].color, '#123456');
});
