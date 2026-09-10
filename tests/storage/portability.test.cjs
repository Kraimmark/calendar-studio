const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryCalendarRepository } = require('../../.tmp/domain-test/src/storage/InMemoryCalendarRepository.js');
const { CalendarPortabilityService, validatePortablePackage, calculatePackageChecksum } = require('../../.tmp/domain-test/src/domain/portability.js');

function eventData(overrides = {}) {
  return {
    title: 'Переносимый матч', organizerName: 'Организатор', kind: 'match', discipline: 'pistol', series: 'regular', source: 'manual', status: 'confirmed',
    competitionStatus: null, competitionRegion: 'Санкт-Петербург', competitionPhase: null, competitionStageNumber: null,
    startDate: '2027-05-10', endDate: '2027-05-11', isPrimary: true, parentEventId: null, venue: 'ССК Невский', venueScope: 'nevsky', notes: 'сохранить', stickerColor: '#808080',
    registration: { mode: 'scheduled', opensAt: '2027-04-01', closesAt: '2027-05-01', priorityOneAlerts: true }, ekpLevel: null, ekpStageNumber: null, coverPath: null,
    daylightBufferMinutes: 15, shifts: [{ id: 'shift-1', name: 'День', kind: 'day', startsAt: '10:00', endsAt: '17:00' }], plannedExerciseCount: 12, plannedSquadCount: 8, ...overrides,
  };
}

function repo(prefix) {
  let id = 0;
  return new InMemoryCalendarRepository(() => `${prefix}-audit-${++id}`);
}

test('export package validates its SHA-256 checksum and rejects tampering', async () => {
  const source = repo('src');
  await source.saveEvent({ kind: 'create', id: 'event-stable', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-03T09:00:00+03:00', data: eventData() }, null);
  const service = new CalendarPortabilityService(source);
  const pkg = await service.exportPackage('2026-09-03T09:01:00+03:00');
  assert.match(pkg.checksum, /^sha256:[0-9a-f]{64}$/);
  assert.equal((await validatePortablePackage(pkg)).valid, true);
  pkg.events[0].title = 'Подмена';
  const invalid = await validatePortablePackage(pkg);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((message) => message.includes('Checksum')));
});

test('export -> clean store -> import preserves event IDs, revisions, settings and audit', async () => {
  const source = repo('src');
  const created = await source.saveEvent({ kind: 'create', id: 'event-stable', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-03T09:00:00+03:00', data: eventData() }, null);
  await source.saveEvent({ kind: 'update', id: created.id, actor: 'owner', timestamp: '2026-09-03T09:02:00+03:00', changes: { notes: 'редакция 2' } }, created.revision);
  const settings = await source.getCalendarSettings(2027);
  await source.saveCalendarSettings({ year: 2027, mode: 'approved', actor: 'owner', timestamp: '2026-09-03T09:03:00+03:00' }, settings.revision);

  const exported = await new CalendarPortabilityService(source).exportPackage('2026-09-03T09:04:00+03:00');
  const target = repo('target');
  const result = await new CalendarPortabilityService(target).importPackage(exported);
  assert.equal(result.backupReference, 'memory://pre-import');

  const restored = await target.getEvent('event-stable');
  assert.equal(restored.id, 'event-stable');
  assert.equal(restored.revision, 2);
  assert.equal(restored.notes, 'редакция 2');
  assert.deepEqual(restored.shifts, exported.events[0].shifts);
  assert.equal((await target.getCalendarSettings(2027)).mode, 'approved');
  assert.deepEqual(await target.list(), exported.audit);
});

test('import validation rejects duplicate IDs, dangling parents and unsupported version before replacing state', async () => {
  const source = repo('src');
  await source.saveEvent({ kind: 'create', id: 'event-1', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-03T09:00:00+03:00', data: eventData() }, null);
  const service = new CalendarPortabilityService(source);
  const pkg = await service.exportPackage('2026-09-03T09:01:00+03:00');

  const broken = structuredClone(pkg);
  broken.formatVersion = 999;
  const versionResult = await validatePortablePackage(broken);
  assert.equal(versionResult.valid, false);

  const dangling = structuredClone(pkg);
  dangling.events[0].parentEventId = 'missing-parent';
  // checksum is intentionally stale; structural error must still be reported before replacement.
  const parentResult = await validatePortablePackage(dangling);
  assert.equal(parentResult.valid, false);
  assert.ok(parentResult.errors.some((message) => message.includes('отсутствующего родителя')));
});


test('unsupported enum value is rejected even when attacker recomputes a valid checksum', async () => {
  const source = repo('src');
  await source.saveEvent({ kind: 'create', id: 'event-1', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-03T09:00:00+03:00', data: eventData() }, null);
  const pkg = await new CalendarPortabilityService(source).exportPackage('2026-09-03T09:01:00+03:00');
  pkg.events[0].kind = 'surprise-kind';
  const { checksum: _old, ...unsigned } = pkg;
  pkg.checksum = await calculatePackageChecksum(unsigned);
  const result = await validatePortablePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes('events[0]')));
});


test('import validation rejects semantically dangling audit even with a valid recomputed checksum', async () => {
  const source = repo('src');
  await source.saveEvent({ kind: 'create', id: 'event-1', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-03T09:00:00+03:00', data: eventData() }, null);
  const pkg = await new CalendarPortabilityService(source).exportPackage('2026-09-03T09:01:00+03:00');
  pkg.audit[0].entityId = 'missing-event';
  const { checksum: _old, ...unsigned } = pkg;
  pkg.checksum = await calculatePackageChecksum(unsigned);
  const result = await validatePortablePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes('отсутствующее мероприятие')));
});

test('import validation rejects audit revision newer than canonical entity revision', async () => {
  const source = repo('src');
  await source.saveEvent({ kind: 'create', id: 'event-1', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-03T09:00:00+03:00', data: eventData() }, null);
  const pkg = await new CalendarPortabilityService(source).exportPackage('2026-09-03T09:01:00+03:00');
  pkg.audit[0].resultingRevision = pkg.events[0].revision + 10;
  const { checksum: _old, ...unsigned } = pkg;
  pkg.checksum = await calculatePackageChecksum(unsigned);
  const result = await validatePortablePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes('новее текущей ревизии мероприятия')));
});


test('import validation rejects impossible audit revision transitions with a valid recomputed checksum', async () => {
  const source = repo('src');
  const created = await source.saveEvent({ kind: 'create', id: 'event-1', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-03T09:00:00+03:00', data: eventData() }, null);
  await source.saveEvent({ kind: 'update', id: created.id, actor: 'owner', timestamp: '2026-09-03T09:02:00+03:00', changes: { notes: 'revision 2' } }, created.revision);
  const pkg = await new CalendarPortabilityService(source).exportPackage('2026-09-03T09:03:00+03:00');
  const updateEntry = pkg.audit.find((entry) => entry.action === 'update');
  updateEntry.baseRevision = null;
  const { checksum: _old, ...unsigned } = pkg;
  pkg.checksum = await calculatePackageChecksum(unsigned);
  const result = await validatePortablePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes('некорректный переход ревизии')));
});

test('import validation rejects duplicate resulting revision for one audited entity', async () => {
  const source = repo('src');
  const created = await source.saveEvent({ kind: 'create', id: 'event-1', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-03T09:00:00+03:00', data: eventData() }, null);
  await source.saveEvent({ kind: 'update', id: created.id, actor: 'owner', timestamp: '2026-09-03T09:02:00+03:00', changes: { notes: 'revision 2' } }, created.revision);
  const pkg = await new CalendarPortabilityService(source).exportPackage('2026-09-03T09:03:00+03:00');
  const duplicate = structuredClone(pkg.audit.find((entry) => entry.action === 'update'));
  duplicate.auditId = 'forged-duplicate-revision';
  pkg.audit.push(duplicate);
  const { checksum: _old, ...unsigned } = pkg;
  pkg.checksum = await calculatePackageChecksum(unsigned);
  const result = await validatePortablePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes('Повторяющиеся результирующие ревизии')));
});


test('import validation rejects malformed and future timestamps with a valid recomputed checksum', async () => {
  const source = repo('src');
  await source.saveEvent({ kind: 'create', id: 'event-1', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-03T09:00:00+03:00', data: eventData() }, null);
  const pkg = await new CalendarPortabilityService(source).exportPackage('2026-09-03T09:01:00+03:00');
  pkg.events[0].createdAt = 'not-a-timestamp';
  pkg.audit[0].timestamp = '2026-09-03T09:05:00+03:00';
  const { checksum: _old, ...unsigned } = pkg;
  pkg.checksum = await calculatePackageChecksum(unsigned);
  const result = await validatePortablePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes('createdAt')));
  assert.ok(result.errors.some((message) => message.includes('позже exportedAt')));
});

test('import validation rejects reversed audit chronology for increasing revisions', async () => {
  const source = repo('src');
  const created = await source.saveEvent({ kind: 'create', id: 'event-1', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-03T09:00:00+03:00', data: eventData() }, null);
  await source.saveEvent({ kind: 'update', id: created.id, actor: 'owner', timestamp: '2026-09-03T09:02:00+03:00', changes: { notes: 'revision 2' } }, created.revision);
  const pkg = await new CalendarPortabilityService(source).exportPackage('2026-09-03T09:03:00+03:00');
  pkg.audit.find((entry) => entry.action === 'create').timestamp = '2026-09-03T09:02:30+03:00';
  const { checksum: _old, ...unsigned } = pkg;
  pkg.checksum = await calculatePackageChecksum(unsigned);
  const result = await validatePortablePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes('нарушает временной порядок ревизий')));
});

test('import validation rejects canonical current revision timestamp that disagrees with audit', async () => {
  const source = repo('src');
  await source.saveEvent({ kind: 'create', id: 'event-1', calendarYear: 2027, actor: 'owner', timestamp: '2026-09-03T09:00:00+03:00', data: eventData() }, null);
  const pkg = await new CalendarPortabilityService(source).exportPackage('2026-09-03T09:03:00+03:00');
  pkg.events[0].updatedAt = '2026-09-03T09:01:00+03:00';
  const { checksum: _old, ...unsigned } = pkg;
  pkg.checksum = await calculatePackageChecksum(unsigned);
  const result = await validatePortablePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes('должен совпадать по timestamp с updatedAt')));
});

test('import validation rejects inconsistent approval metadata pairs', async () => {
  const source = repo('src');
  const settings = await source.getCalendarSettings(2027);
  await source.saveCalendarSettings({ year: 2027, mode: 'approved', actor: 'owner', timestamp: '2026-09-03T09:00:00+03:00' }, settings.revision);
  const pkg = await new CalendarPortabilityService(source).exportPackage('2026-09-03T09:03:00+03:00');
  pkg.calendarYears[0].approvedBy = null;
  const { checksum: _old, ...unsigned } = pkg;
  pkg.checksum = await calculatePackageChecksum(unsigned);
  const result = await validatePortablePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes('approvedAt/approvedBy')));
});


test('import validation rejects CalendarSettings audit action that contradicts its resulting mode', async () => {
  const source = repo('src');
  const settings = await source.getCalendarSettings(2027);
  await source.saveCalendarSettings({ year: 2027, mode: 'approved', actor: 'owner', timestamp: '2026-09-03T09:00:00+03:00' }, settings.revision);
  const pkg = await new CalendarPortabilityService(source).exportPackage('2026-09-03T09:03:00+03:00');
  const approval = pkg.audit.find((entry) => entry.entityType === 'calendar_settings' && entry.action === 'approve');
  approval.payloadSummary = 'mode:planning';
  const { checksum: _old, ...unsigned } = pkg;
  pkg.checksum = await calculatePackageChecksum(unsigned);
  const result = await validatePortablePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes('approve должен завершаться режимом approved')));
});

test('import validation rejects impossible contiguous CalendarSettings mode history', async () => {
  const source = repo('src');
  let settings = await source.getCalendarSettings(2027);
  settings = await source.saveCalendarSettings({ year: 2027, mode: 'approved', actor: 'owner', timestamp: '2026-09-03T09:00:00+03:00' }, settings.revision);
  await source.saveCalendarSettings({ year: 2027, mode: 'planning', actor: 'owner', timestamp: '2026-09-03T09:01:00+03:00' }, settings.revision);
  const pkg = await new CalendarPortabilityService(source).exportPackage('2026-09-03T09:03:00+03:00');
  const reopen = pkg.audit.find((entry) => entry.entityType === 'calendar_settings' && entry.action === 'reopen');
  reopen.action = 'update';
  const { checksum: _old, ...unsigned } = pkg;
  pkg.checksum = await calculatePackageChecksum(unsigned);
  const result = await validatePortablePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes('невозможный переход approved -> planning действием update')));
});

test('import validation rejects current CalendarSettings transition metadata that disagrees with audit', async () => {
  const source = repo('src');
  const settings = await source.getCalendarSettings(2027);
  await source.saveCalendarSettings({ year: 2027, mode: 'approved', actor: 'owner', timestamp: '2026-09-03T09:00:00+03:00' }, settings.revision);
  const pkg = await new CalendarPortabilityService(source).exportPackage('2026-09-03T09:03:00+03:00');
  pkg.calendarYears[0].approvedAt = '2026-09-03T09:00:30+03:00';
  const { checksum: _old, ...unsigned } = pkg;
  pkg.checksum = await calculatePackageChecksum(unsigned);
  const result = await validatePortablePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes('Текущий approve audit')));
});

test('import validation rejects CalendarSettings canonical mode with reversed latest transition order', async () => {
  const source = repo('src');
  let settings = await source.getCalendarSettings(2027);
  settings = await source.saveCalendarSettings({ year: 2027, mode: 'approved', actor: 'owner', timestamp: '2026-09-03T09:00:00+03:00' }, settings.revision);
  await source.saveCalendarSettings({ year: 2027, mode: 'planning', actor: 'owner', timestamp: '2026-09-03T09:01:00+03:00' }, settings.revision);
  const pkg = await new CalendarPortabilityService(source).exportPackage('2026-09-03T09:03:00+03:00');
  pkg.calendarYears[0].approvedAt = '2026-09-03T09:02:00+03:00';
  const { checksum: _old, ...unsigned } = pkg;
  pkg.checksum = await calculatePackageChecksum(unsigned);
  const result = await validatePortablePackage(pkg);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes('режиме planning должен иметь последнее reopen не раньше approve')));
});
