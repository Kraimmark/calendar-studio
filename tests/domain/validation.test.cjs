const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEvent, hasBlockingIssues } = require('../../.tmp/domain-test/src/domain/validation.js');

function validEvent(overrides = {}) {
  return {
    title: 'Чемпионат Санкт-Петербурга', organizerName: 'Организатор', kind: 'match', discipline: 'pistol', series: 'regular', source: 'manual', status: 'draft',
    competitionStatus: null, competitionRegion: 'Санкт-Петербург', competitionPhase: null, competitionStageNumber: null,
    startDate: '2026-09-12', endDate: '2026-09-13', isPrimary: true, parentEventId: null, venue: 'ССК Невский', venueScope: 'nevsky', notes: '', stickerColor: '#808080',
    registration: { mode: 'free', opensAt: null, closesAt: null, priorityOneAlerts: false },
    ekpLevel: null, ekpStageNumber: null, coverPath: null, daylightBufferMinutes: 15, shifts: [], plannedExerciseCount: 12, plannedSquadCount: 10,
    ...overrides,
  };
}

test('valid event has no blocking issues', () => {
  assert.equal(hasBlockingIssues(validateEvent(validEvent(), { year: 2026 })), false);
});

test('event dates must be both present or both absent', () => {
  const issues = validateEvent(validEvent({ startDate: '2026-09-12', endDate: null }), { year: 2026 });
  assert.ok(issues.some((issue) => issue.code === 'event_dates_incomplete'));
});

test('end before start is blocked', () => {
  assert.ok(validateEvent(validEvent({ endDate: '2026-09-11' }), { year: 2026 }).some((issue) => issue.code === 'end_before_start'));
});

test('dates outside selected year are blocked', () => {
  const issues = validateEvent(validEvent({ startDate: '2027-01-01', endDate: '2027-01-02' }), { year: 2026 });
  assert.ok(issues.filter((issue) => issue.code === 'date_outside_year').length >= 2);
});

test('scheduled registration requires both dates', () => {
  const issues = validateEvent(validEvent({ registration: { mode: 'scheduled', opensAt: null, closesAt: null, priorityOneAlerts: false } }), { year: 2026 });
  assert.ok(issues.some((issue) => issue.code === 'registration_dates_required'));
});


test('registration may open in the previous calendar year', () => {
  const issues = validateEvent(validEvent({ registration: { mode: 'scheduled', opensAt: '2025-12-15', closesAt: '2026-01-10', priorityOneAlerts: false } }), { year: 2026 });
  assert.equal(issues.some((issue) => issue.code === 'date_outside_year'), false);
  assert.equal(hasBlockingIssues(issues), false);
});

test('EKP requires level and positive stage number', () => {
  const issues = validateEvent(validEvent({ source: 'ekp', ekpLevel: null, ekpStageNumber: null }), { year: 2026 });
  assert.ok(issues.some((issue) => issue.code === 'ekp_level_required'));
  assert.ok(issues.some((issue) => issue.code === 'ekp_stage_required'));
});

test('overnight shift is allowed because only HH:MM format is validated', () => {
  const issues = validateEvent(validEvent({ shifts: [{ id: 'night-1', name: 'Ночная', kind: 'night', startsAt: '22:00', endsAt: '03:00' }] }), { year: 2026 });
  assert.equal(issues.some((issue) => issue.code === 'invalid_shift_time'), false);
});

test('parent cycle is blocked', () => {
  const issues = validateEvent(validEvent({ parentEventId: 'B' }), {
    year: 2026,
    eventId: 'A',
    events: [{ id: 'B', parentEventId: 'C' }, { id: 'C', parentEventId: 'A' }],
  });
  assert.ok(issues.some((issue) => issue.code === 'parent_cycle'));
});
