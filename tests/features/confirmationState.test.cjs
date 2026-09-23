const test = require('node:test');
const assert = require('node:assert/strict');
const { archiveConfirmationMessage, calendarModeConfirmationMessage, daylightConfirmationKey, requiresDiscardConfirmation } = require('../../.tmp/domain-test/src/features/calendar/confirmationState.js');

function warning(overrides = {}) {
  return {
    shiftId: 'shift-1',
    shiftName: 'Дневная',
    date: '2026-09-10',
    message: 'Смена выходит за безопасное окно.',
    ...overrides,
  };
}

test('daylight confirmation key is stable for the same risk statement', () => {
  const original = [warning()];
  const rebuilt = [warning({ shiftName: 'Имя в payload не является частью подтверждаемого текста' })];
  assert.equal(daylightConfirmationKey(original), daylightConfirmationKey(rebuilt));
});

test('daylight confirmation key changes when affected shift, date or warning text changes', () => {
  const base = daylightConfirmationKey([warning()]);
  assert.notEqual(base, daylightConfirmationKey([warning({ shiftId: 'shift-2' })]));
  assert.notEqual(base, daylightConfirmationKey([warning({ date: '2026-09-11' })]));
  assert.notEqual(base, daylightConfirmationKey([warning({ message: 'Изменённое световое предупреждение.' })]));
});

test('empty warning set has a stable empty key', () => {
  assert.equal(daylightConfirmationKey([]), '');
});


test('dirty editable draft requires discard confirmation', () => {
  assert.equal(requiresDiscardConfirmation(true, false), true);
  assert.equal(requiresDiscardConfirmation(false, false), false);
  assert.equal(requiresDiscardConfirmation(true, true), false);
});


test('archive confirmation always warns and mentions draft loss only when needed', () => {
  const clean = archiveConfirmationMessage(false);
  const dirty = archiveConfirmationMessage(true);
  assert.match(clean, /Архивировать мероприятие/);
  assert.match(clean, /Восстановить мероприятие можно из архива/);
  assert.doesNotMatch(clean, /несохранённые изменения/);
  assert.match(dirty, /несохранённые изменения/);
  assert.match(dirty, /Восстановить мероприятие можно из архива/);
});


test('calendar mode confirmation explains both consequential transitions', () => {
  const approve = calendarModeConfirmationMessage('planning', 2026);
  const reopen = calendarModeConfirmationMessage('approved', 2026);
  assert.match(approve, /Согласовать календарь 2026/);
  assert.match(approve, /заблокированы/);
  assert.match(reopen, /Вернуть календарь 2026 в режим планирования/);
  assert.match(reopen, /снова станут доступны/);
});
