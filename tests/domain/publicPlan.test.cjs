const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPublicPlan, publicPlanDate } = require('../../.tmp/domain-test/src/domain/publicPlan.js');

function event(id, overrides = {}) {
  return {
    id, calendarYear: 2027, revision: 1, createdAt: '2026-09-12T10:00:00Z', createdBy: 'owner', updatedAt: '2026-09-12T10:00:00Z', updatedBy: 'owner', archivedAt: null,
    title: id, organizerName: '', kind: 'match', discipline: 'pistol', series: 'regular', source: 'manual', status: 'confirmed', competitionStatus: null, competitionRegion: null, competitionPhase: null, competitionStageNumber: null,
    startDate: '2027-03-02', endDate: '2027-03-04', isPrimary: true, parentEventId: null, venue: 'ССК «Невский»', venueScope: 'nevsky', notes: '', stickerColor: '#808080',
    registration: { mode: 'free', opensAt: null, closesAt: null, priorityOneAlerts: false }, ekpLevel: null, ekpStageNumber: null, coverPath: null, daylightBufferMinutes: 0, shifts: [], plannedExerciseCount: null, plannedSquadCount: null,
    ...overrides,
  };
}

test('public plan uses the official compact date format and short Nevsky venue', () => {
  assert.equal(publicPlanDate(event('cup')), '02.03-04.03');
  assert.equal(publicPlanDate(event('one', { startDate: '2027-03-02', endDate: '2027-03-02' })), '02.03');
  const plan = buildPublicPlan(2027, [event('cup'), event('utm', { kind: 'utm' }), event('archive', { archivedAt: '2026-09-12T11:00:00Z' }), event('queue', { startDate: null, endDate: null })]);
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].rows.map((row) => [row.title, row.venue]), [['cup', 'Невский']]);
});
