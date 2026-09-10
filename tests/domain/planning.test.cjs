const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDateRange, dateInRange, moveEventToDatePatch, moveEventToQueuePatch } = require('../../.tmp/domain-test/src/domain/planning.js');

function event(startDate, endDate, calendarYear = 2027) {
  return { calendarYear, startDate, endDate };
}

test('selection range normalizes drag direction', () => {
  assert.deepEqual(normalizeDateRange('2027-05-14', '2027-05-10'), { start: '2027-05-10', end: '2027-05-14' });
  const range = normalizeDateRange('2027-05-10', '2027-05-14');
  assert.equal(dateInRange('2027-05-12', range), true);
  assert.equal(dateInRange('2027-05-15', range), false);
});

test('undated event dropped on a day becomes one-day event', () => {
  assert.deepEqual(moveEventToDatePatch(event(null, null), '2027-06-03'), { startDate: '2027-06-03', endDate: '2027-06-03' });
});

test('dated event preserves duration when moved', () => {
  assert.deepEqual(moveEventToDatePatch(event('2027-03-10', '2027-03-12'), '2027-08-20'), { startDate: '2027-08-20', endDate: '2027-08-22' });
});

test('move refuses silent clipping at year boundary', () => {
  assert.throws(() => moveEventToDatePatch(event('2027-03-10', '2027-03-12'), '2027-12-31'), /за пределы календарного года/);
  assert.throws(() => moveEventToDatePatch(event(null, null), '2028-01-01'), /2027 году/);
});

test('queue move intentionally clears both dates', () => {
  assert.deepEqual(moveEventToQueuePatch(), { startDate: null, endDate: null });
});
