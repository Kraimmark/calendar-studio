import type { ShiftDaylightWarning } from '../../domain/daylight';
import type { CalendarMode } from '../../domain/types';

/**
 * Stable identity for the exact daylight-risk statement the user confirmed.
 * Unrelated Event edits must not invalidate confirmation, while any change to
 * affected shift/date/message must require an explicit confirmation again.
 */
export function daylightConfirmationKey(warnings: readonly ShiftDaylightWarning[]): string {
  return warnings
    .map((warning) => [warning.shiftId, warning.date, warning.message].join('\u001f'))
    .join('\u001e');
}

/**
 * Closing an editable dirty form discards user input and therefore requires
 * an explicit confirmation. Read-only dialogs never own unsaved edits.
 */
export function requiresDiscardConfirmation(dirty: boolean, readOnly: boolean): boolean {
  return dirty && !readOnly;
}


/**
 * Archiving is reversible, but it removes the Event from active planning and
 * can also discard an unsaved editor draft. The UI therefore always asks for
 * an explicit confirmation and makes draft loss visible in the prompt.
 */
export function archiveConfirmationMessage(dirty: boolean): string {
  return dirty
    ? 'Архивировать мероприятие? Оно исчезнет из активного календаря, а несохранённые изменения в форме будут потеряны. Восстановить мероприятие можно из архива.'
    : 'Архивировать мероприятие? Оно исчезнет из активного календаря. Восстановить мероприятие можно из архива.';
}


/**
 * Switching calendar mode changes whether the whole year can be edited.
 * The transition is revisioned and audited, but still consequential enough
 * that a one-click accidental toggle should not be accepted silently.
 */
export function calendarModeConfirmationMessage(currentMode: CalendarMode, year: number): string {
  return currentMode === 'planning'
    ? `Согласовать календарь ${year}? Создание, редактирование и переносы будут заблокированы до явного возврата в планирование.`
    : `Вернуть календарь ${year} в режим планирования? Редактирование и переносы снова станут доступны.`;
}
