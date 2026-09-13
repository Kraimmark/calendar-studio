const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_CALENDAR_LAYERS,
  eventMatchesLayer,
  isEventVisibleByDiscipline,
  isEventVisibleByLayers,
} = require('../../.tmp/domain-test/src/domain/calendarLayers.js');

function event(overrides = {}) {
  return {
    id: 'event-1', calendarYear: 2027, revision: 1,
    createdAt: '2026-09-03T00:00:00Z', createdBy: 'local-owner',
    updatedAt: '2026-09-03T00:00:00Z', updatedBy: 'local-owner', archivedAt: null,
    title: 'Test', organizerName: '', kind: 'match', discipline: 'pistol', series: 'regular',
    source: 'manual', status: 'draft', competitionStatus: null, competitionRegion: null,
    competitionPhase: null, competitionStageNumber: null, startDate: null, endDate: null,
    isPrimary: true, parentEventId: null, venue: '', venueScope: 'unspecified', notes: '',
    stickerColor: '#777777', registration: { mode: 'free', opensAt: null, closesAt: null, priorityOneAlerts: false },
    ekpLevel: null, ekpStageNumber: null, coverPath: null, daylightBufferMinutes: 15, shifts: [],
    plannedExerciseCount: null, plannedSquadCount: null,
    ...overrides,
  };
}

function layers(changes = {}) {
  return { ...DEFAULT_CALENDAR_LAYERS, ...changes };
}

test('source layers split own plan, SPb EKP and other-region EKP', () => {
  assert.equal(eventMatchesLayer(event(), 'ownPlan'), true);
  assert.equal(eventMatchesLayer(event({ source: 'ekp', venueScope: 'nevsky' }), 'ekpSpb'), true);
  assert.equal(eventMatchesLayer(event({ source: 'ekp', venueScope: 'spb' }), 'ekpSpb'), true);
  assert.equal(eventMatchesLayer(event({ source: 'ekp', venueScope: 'otherRegion' }), 'ekpOther'), true);
});

test('semantic layers act as independent visibility gates', () => {
  const trfAirgun = event({ series: 'trf', discipline: 'airgun' });
  assert.equal(isEventVisibleByLayers(trfAirgun, layers()), true);
  assert.equal(isEventVisibleByLayers(trfAirgun, layers({ trf: false })), false);
  assert.equal(isEventVisibleByLayers(trfAirgun, layers({ airgun: false })), false);
  assert.equal(isEventVisibleByLayers(trfAirgun, layers({ ownPlan: false })), false);
});

test('kind-specific layers hide UTM and build without hiding regular matches', () => {
  assert.equal(isEventVisibleByLayers(event({ kind: 'utm' }), layers({ utm: false })), false);
  assert.equal(isEventVisibleByLayers(event({ kind: 'build' }), layers({ build: false })), false);
  assert.equal(isEventVisibleByLayers(event({ kind: 'match' }), layers({ utm: false, build: false })), true);
});

test('discipline filter is orthogonal to semantic layers', () => {
  const shotgun = event({ discipline: 'shotgun' });
  assert.equal(isEventVisibleByDiscipline(shotgun, 'all'), true);
  assert.equal(isEventVisibleByDiscipline(shotgun, 'shotgun'), true);
  assert.equal(isEventVisibleByDiscipline(shotgun, 'pistol'), false);
});
