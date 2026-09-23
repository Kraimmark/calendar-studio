const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeCalendarWarnings } = require('../../.tmp/domain-test/src/domain/warningSummary.js');

test('warning summary groups in stable rule order and deduplicates affected entities', () => {
  const warnings = [
    { code: 'trf_spacing', message: 'trf', eventIds: ['b', 'a'], dates: ['2027-03-10', '2027-02-01'] },
    { code: 'match_spacing', message: 'spacing 1', eventIds: ['a', 'c'], dates: ['2027-02-01', '2027-02-14'] },
    { code: 'match_spacing', message: 'spacing 2', eventIds: ['c', 'd'], dates: ['2027-02-14', '2027-02-20'] },
  ];
  const summary = summarizeCalendarWarnings(warnings);

  assert.equal(summary.warningCount, 3);
  assert.equal(summary.affectedEventCount, 4);
  assert.equal(summary.affectedDateCount, 4);
  assert.deepEqual(summary.groups.map((group) => group.code), ['match_spacing', 'trf_spacing']);
  assert.deepEqual(summary.groups[0].eventIds, ['a', 'c', 'd']);
  assert.deepEqual(summary.groups[0].dates, ['2027-02-01', '2027-02-14', '2027-02-20']);
});

test('warning summary does not mutate canonical warning results', () => {
  const warnings = [
    { code: 'monthly_match_overload', message: 'overload', eventIds: ['z', 'a', 'z'], dates: ['2027-05-03', '2027-05-01'] },
  ];
  const before = JSON.stringify(warnings);
  const summary = summarizeCalendarWarnings(warnings);

  assert.equal(JSON.stringify(warnings), before);
  assert.deepEqual(summary.groups[0].eventIds, ['a', 'z']);
  assert.deepEqual(summary.groups[0].dates, ['2027-05-01', '2027-05-03']);
});
