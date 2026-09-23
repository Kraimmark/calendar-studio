const test = require('node:test');
const assert = require('node:assert/strict');
const { assertExpectedRevision, nextRevision, RevisionConflictError } = require('../../.tmp/domain-test/src/domain/revision.js');

test('revision increments monotonically', () => assert.equal(nextRevision(7), 8));

test('stale revision raises explicit conflict', () => {
  assert.throws(() => assertExpectedRevision('event-1', 3, 2), RevisionConflictError);
  assert.doesNotThrow(() => assertExpectedRevision('event-1', 3, 3));
});
