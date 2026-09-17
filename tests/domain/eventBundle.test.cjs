const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEventBundles, bundleBadges, linkedDescendants, planningEvents, rootEventId } = require('../../.tmp/domain-test/src/domain/eventBundle.js');
const { calculateWarnings } = require('../../.tmp/domain-test/src/domain/warnings.js');

function event(id, title, parentEventId = null, competitionStatus = null) {
  return {
    id, title, parentEventId, competitionStatus, calendarYear: 2027, revision: 1, createdAt: '2026-09-17T00:00:00Z', createdBy: 'test', updatedAt: '2026-09-17T00:00:00Z', updatedBy: 'test', archivedAt: null,
    organizerName: '', kind: 'match', discipline: 'pistol', series: 'regular', source: 'manual', status: 'draft', competitionRegion: null, competitionPhase: null, competitionStageNumber: null,
    startDate: '2027-04-10', endDate: '2027-04-11', isPrimary: parentEventId === null, venue: '', venueScope: 'unspecified', notes: '', stickerColor: '#808080',
    registration: { mode: 'free', opensAt: null, closesAt: null, priorityOneAlerts: false }, ekpLevel: null, ekpStageNumber: null, coverPath: null, daylightBufferMinutes: 0, shifts: [], plannedExerciseCount: null, plannedSquadCount: null,
  };
}

test('parent and its credits form one planning bundle with compact badges', () => {
  const parent = event('parent', 'Чемпионат СПб');
  const regional = event('regional', 'Региональные', 'parent', 'Региональные соревнования');
  const physical = event('physical', 'Физкультурное', 'parent', 'Физкультурное мероприятие');
  const sibling = event('other', 'Другой матч');
  const events = [parent, regional, physical, sibling];
  assert.deepEqual(planningEvents(events).map((item) => item.id), ['other', 'parent']);
  assert.equal(buildEventBundles(events).find((bundle) => bundle.root.id === 'parent').members.length, 3);
  assert.deepEqual(bundleBadges(parent, events), ['РС', 'ФМ']);
  assert.equal(rootEventId(physical, events), 'parent');
});

test('an orphaned child stays visible rather than disappearing from planning', () => {
  const orphan = event('orphan', 'Импорт без родителя', 'missing');
  assert.deepEqual(planningEvents([orphan]).map((item) => item.id), ['orphan']);
});

test('credits inside one parent do not create a false overload or spacing risk', () => {
  const parent = event('parent', 'Чемпионат СПб');
  const regional = event('regional', 'Региональные', 'parent', 'Региональные соревнования');
  const physical = event('physical', 'Физкультурное', 'parent', 'Физкультурное мероприятие');
  assert.deepEqual(calculateWarnings([parent, regional, physical], 2027), []);
});

test('linked descendants retain the full package after parent archival', () => {
  const parent = event('parent', 'Родитель');
  const child = event('child', 'Зачёт', 'parent');
  const nested = event('nested', 'Внутренний зачёт', 'child');
  assert.deepEqual(linkedDescendants('parent', [parent, child, nested]).map((item) => item.id), ['child', 'nested']);
});
