const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryCalendarRepository } = require('../../.tmp/domain-test/src/storage/InMemoryCalendarRepository.js');
const { CalendarYearProjectService, validateYearProject } = require('../../.tmp/domain-test/src/domain/yearProject.js');

function data(title, parentEventId = null) {
  return {
    title, organizerName: 'ФПС СПб', kind: 'match', discipline: 'pistol', series: 'regular', source: 'manual', status: 'confirmed',
    competitionStatus: null, competitionRegion: 'Санкт-Петербург', competitionPhase: null, competitionStageNumber: null,
    startDate: '2027-04-10', endDate: '2027-04-11', isPrimary: parentEventId === null, parentEventId, venue: 'ССК «Невский»', venueScope: 'nevsky', notes: '', stickerColor: '#808080',
    registration: { mode: 'free', opensAt: null, closesAt: null, priorityOneAlerts: false }, ekpLevel: null, ekpStageNumber: null, coverPath: null,
    daylightBufferMinutes: 0, shifts: [], plannedExerciseCount: null, plannedSquadCount: null,
  };
}

test('year project contains exactly one year and retains its related audit', async () => {
  const repository = new InMemoryCalendarRepository(() => crypto.randomUUID());
  await repository.saveEvent({ kind: 'create', id: 'main-27', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-12T10:00:00Z', data: data('Главное') }, null);
  await repository.saveEvent({ kind: 'create', id: 'child-27', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-12T10:01:00Z', data: data('Региональное', 'main-27') }, null);
  await repository.saveEvent({ kind: 'create', id: 'other-28', calendarYear: 2028, actor: 'owner', timestamp: '2026-09-12T10:02:00Z', data: { ...data('Другое'), startDate: '2028-04-10', endDate: '2028-04-11' } }, null);
  const service = new CalendarYearProjectService(repository);
  const project = await service.exportProject(2027, '2026-09-12T10:03:00Z');
  assert.equal(project.events.length, 2);
  assert.equal(project.audit.length, 2);
  assert.equal((await validateYearProject(project)).valid, true);
});

test('year project import replaces only its year and keeps other calendar years intact', async () => {
  const source = new InMemoryCalendarRepository(() => crypto.randomUUID());
  await source.saveEvent({ kind: 'create', id: 'main-27', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-12T10:00:00Z', data: data('Главное') }, null);
  await source.saveEvent({ kind: 'create', id: 'child-27', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-12T10:01:00Z', data: data('Региональное', 'main-27') }, null);
  const project = await new CalendarYearProjectService(source).exportProject(2027, '2026-09-12T10:02:00Z');

  const target = new InMemoryCalendarRepository(() => crypto.randomUUID());
  await target.saveEvent({ kind: 'create', id: 'old-27', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-12T10:00:00Z', data: data('Старое') }, null);
  await target.saveEvent({ kind: 'create', id: 'keep-28', calendarYear: 2028, actor: 'owner', timestamp: '2026-09-12T10:00:00Z', data: { ...data('Сохранить'), startDate: '2028-05-10', endDate: '2028-05-11' } }, null);
  const result = await new CalendarYearProjectService(target).importProject(project);
  assert.equal(result.backupReference, 'memory://before-year-import');
  assert.deepEqual((await target.listEvents(2027, true)).map((event) => event.id).sort(), ['child-27', 'main-27']);
  assert.equal((await target.getEvent('child-27')).parentEventId, 'main-27');
  assert.equal((await target.getEvent('keep-28')).title, 'Сохранить');
});

test('year project rejects a modified event even when the JSON shape remains plausible', async () => {
  const repository = new InMemoryCalendarRepository(() => crypto.randomUUID());
  await repository.saveEvent({ kind: 'create', id: 'main-27', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-12T10:00:00Z', data: data('Главное') }, null);
  const project = await new CalendarYearProjectService(repository).exportProject(2027, '2026-09-12T10:01:00Z');
  project.events[0].title = 'Подмена';
  const result = await validateYearProject(project);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('Контрольная сумма')));
});
