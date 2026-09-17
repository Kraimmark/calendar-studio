import { addDays, compareDateOnly, differenceInDays, parseDateOnly, type DateOnly } from './dateOnly';
import type { CalendarEvent } from './types';

export interface DateRange {
  start: DateOnly;
  end: DateOnly;
}

export function normalizeDateRange(first: DateOnly, second: DateOnly): DateRange {
  return compareDateOnly(first, second) <= 0 ? { start: first, end: second } : { start: second, end: first };
}

export function dateInRange(date: DateOnly, range: DateRange | null): boolean {
  if (!range) return false;
  return compareDateOnly(date, range.start) >= 0 && compareDateOnly(date, range.end) <= 0;
}

/**
 * Returns the intentional date patch for dropping an event onto a calendar day.
 * Existing duration is preserved; an undated event becomes a one-day event.
 * Crossing the owning calendar year is rejected rather than silently clipping data.
 */
export function moveEventToDatePatch(event: Pick<CalendarEvent, 'calendarYear' | 'startDate' | 'endDate'>, target: DateOnly): Pick<CalendarEvent, 'startDate' | 'endDate'> {
  const targetParts = parseDateOnly(target);
  if (!targetParts || targetParts.year !== event.calendarYear) {
    throw new RangeError(`Дата переноса должна принадлежать ${event.calendarYear} году.`);
  }

  let durationDays = 0;
  if (event.startDate !== null && event.endDate !== null) {
    durationDays = differenceInDays(event.endDate, event.startDate);
    if (durationDays < 0) throw new RangeError('У мероприятия некорректный диапазон дат.');
  }

  const endDate = addDays(target, durationDays);
  if (parseDateOnly(endDate)?.year !== event.calendarYear) {
    throw new RangeError('Перенос с сохранением длительности выводит мероприятие за пределы календарного года.');
  }
  return { startDate: target, endDate };
}

export function moveEventToQueuePatch(): Pick<CalendarEvent, 'startDate' | 'endDate'> {
  return { startDate: null, endDate: null };
}

/**
 * Adjusts the right edge of an event.  A resize cannot invert the range or
 * silently escape the owning calendar year; an undated card becomes one day.
 */
export function resizeEventEndToDatePatch(event: Pick<CalendarEvent, 'calendarYear' | 'startDate' | 'endDate'>, target: DateOnly): Pick<CalendarEvent, 'startDate' | 'endDate'> {
  const targetParts = parseDateOnly(target);
  if (!targetParts || targetParts.year !== event.calendarYear) {
    throw new RangeError(`Дата изменения должна принадлежать ${event.calendarYear} году.`);
  }
  if (event.startDate === null || event.endDate === null) return { startDate: target, endDate: target };
  return { startDate: event.startDate, endDate: compareDateOnly(target, event.startDate) < 0 ? event.startDate : target };
}
