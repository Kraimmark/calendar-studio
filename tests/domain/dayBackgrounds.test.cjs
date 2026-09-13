const test = require('node:test');
const assert = require('node:assert/strict');
const { dayBackgroundCategory, orderedDayBackgroundCategories } = require('../../.tmp/domain-test/src/domain/dayBackgrounds.js');

test('day backgrounds group calendar series and operational records predictably', () => {
  assert.equal(dayBackgroundCategory({ kind: 'match', series: 'allRussian' }), 'allRussian');
  assert.equal(dayBackgroundCategory({ kind: 'match', series: 'regular' }), 'regional');
  assert.equal(dayBackgroundCategory({ kind: 'utm', series: 'allRussian' }), 'utm');
  assert.equal(dayBackgroundCategory({ kind: 'build', series: 'regular' }), 'build');
});

test('day backgrounds have one stable visual priority when events overlap', () => {
  assert.deepEqual(
    orderedDayBackgroundCategories(['trf', 'allRussian', 'trf', 'regional']),
    ['allRussian', 'regional', 'trf'],
  );
});
