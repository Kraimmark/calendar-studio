const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateWarnings } = require('../../.tmp/domain-test/src/domain/warnings.js');

function event(id, startDate, overrides = {}) {
  return {
    id,
    calendarYear: 2027,
    revision: 1,
    createdAt: '2026-09-03T00:00:00Z', createdBy: 'owner', updatedAt: '2026-09-03T00:00:00Z', updatedBy: 'owner', archivedAt: null,
    title: id,
    organizerName: '', kind: 'match', discipline: 'pistol', series: 'regular', source: 'manual', status: 'draft',
    competitionStatus: null, competitionRegion: null, competitionPhase: null, competitionStageNumber: null,
    startDate, endDate: startDate, isPrimary: true, parentEventId: null,
    venue: '', venueScope: 'unspecified', notes: '', stickerColor: '#808080',
    registration: { mode: 'free', opensAt: null, closesAt: null, priorityOneAlerts: false },
    ekpLevel: null, ekpStageNumber: null, coverPath: null, daylightBufferMinutes: 15, shifts: [], plannedExerciseCount: null, plannedSquadCount: null,
    ...overrides,
  };
}

function codes(events) {
  return calculateWarnings(events, 2027).map((warning) => warning.code);
}

test('more than two matches starting in one month creates monthly overload warning', () => {
  const warnings = calculateWarnings([event('a', '2027-05-01'), event('b', '2027-05-17'), event('c', '2027-05-31')], 2027);
  const monthly = warnings.filter((warning) => warning.code === 'monthly_match_overload');
  assert.equal(monthly.length, 1);
  assert.deepEqual(monthly[0].eventIds, ['a', 'b', 'c']);
});

test('ordinary neighboring matches require fourteen full free days', () => {
  assert.equal(codes([event('a', '2027-03-01'), event('b', '2027-03-15')]).includes('match_spacing'), true); // 13 full days
  assert.equal(codes([event('a', '2027-03-01'), event('b', '2027-03-16')]).includes('match_spacing'), false); // 14 full days
});

test('mixed airgun and firearm pair is excluded from ordinary spacing rule', () => {
  const warnings = codes([
    event('air', '2027-04-01', { discipline: 'airgun' }),
    event('firearm', '2027-04-03', { discipline: 'pistol' }),
  ]);
  assert.equal(warnings.includes('match_spacing'), false);
});

test('two airgun matches still use ordinary spacing rule', () => {
  const warnings = codes([
    event('air-1', '2027-04-01', { discipline: 'airgun' }),
    event('air-2', '2027-04-03', { discipline: 'airgun' }),
  ]);
  assert.equal(warnings.includes('match_spacing'), true);
});

test('TRF matches require thirty full free days', () => {
  const warnings = codes([
    event('trf-1', '2027-01-01', { series: 'trf' }),
    event('trf-2', '2027-01-31', { series: 'trf' }), // 29 full days
  ]);
  assert.equal(warnings.includes('trf_spacing'), true);
});

test('all-Russian event requires two free weeks after previous same-discipline match', () => {
  const warnings = codes([
    event('previous', '2027-06-01', { discipline: 'shotgun' }),
    event('federal', '2027-06-15', { discipline: 'shotgun', series: 'allRussian' }),
  ]);
  assert.equal(warnings.includes('all_russian_buffer'), true);
});

test('unrelated discipline does not consume all-Russian same-discipline buffer', () => {
  const warnings = codes([
    event('previous', '2027-06-10', { discipline: 'pistol' }),
    event('federal', '2027-06-15', { discipline: 'shotgun', series: 'allRussian' }),
  ]);
  assert.equal(warnings.includes('all_russian_buffer'), false);
});

test('airgun match between firearm matches does not hide firearm spacing conflict', () => {
  const warnings = calculateWarnings([
    event('firearm-1', '2027-04-01', { discipline: 'pistol' }),
    event('air', '2027-04-05', { discipline: 'airgun' }),
    event('firearm-2', '2027-04-10', { discipline: 'shotgun' }),
  ], 2027);
  assert.equal(warnings.some((warning) => warning.code === 'match_spacing' && warning.eventIds.join(',') === 'firearm-1,firearm-2'), true);
});

test('build range in all-Russian preparation zone warns only when it overlaps another record', () => {
  const warnings = calculateWarnings([
    event('build', '2027-06-05', { kind: 'build', endDate: '2027-06-07' }),
    event('conflict', '2027-06-06', { kind: 'utm' }),
    event('federal', '2027-06-15', { series: 'allRussian' }),
  ], 2027);
  const buildWarning = warnings.find((warning) => warning.code === 'all_russian_build_overlap');
  assert.ok(buildWarning);
  assert.deepEqual(buildWarning.eventIds, ['build', 'conflict', 'federal']);
});

test('build in all-Russian preparation zone without overlap is not a warning', () => {
  const warnings = codes([
    event('build', '2027-06-05', { kind: 'build', endDate: '2027-06-07' }),
    event('federal', '2027-06-15', { series: 'allRussian' }),
  ]);
  assert.equal(warnings.includes('all_russian_build_overlap'), false);
});

test('overlapping build outside all-Russian preparation zone is not a preparation warning', () => {
  const warnings = codes([
    event('build', '2027-05-20', { kind: 'build', endDate: '2027-05-21' }),
    event('conflict', '2027-05-20', { kind: 'utm' }),
    event('federal', '2027-06-15', { series: 'allRussian' }),
  ]);
  assert.equal(warnings.includes('all_russian_build_overlap'), false);
});
