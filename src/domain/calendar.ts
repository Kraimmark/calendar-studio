import { addDays, daysInMonth, formatDateOnly, parseDateOnly, weekdayMondayIndex, type DateOnly } from './dateOnly';

export const MIN_CALENDAR_YEAR = 2026;
export const MAX_CALENDAR_YEAR = 2100;

export interface MonthCell {
  date: DateOnly;
  day: number;
  inCurrentMonth: boolean;
  weekday: number;
  weekIndex: number;
}

export interface MonthModel {
  year: number;
  month: number;
  weeks: number;
  cells: MonthCell[];
}

export function assertCalendarYear(year: number): void {
  if (!Number.isInteger(year) || year < MIN_CALENDAR_YEAR || year > MAX_CALENDAR_YEAR) {
    throw new RangeError(`Calendar year must be ${MIN_CALENDAR_YEAR}..${MAX_CALENDAR_YEAR}`);
  }
}

export function buildMonth(year: number, month: number): MonthModel {
  assertCalendarYear(year);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError('Month must be 1..12');

  const first = formatDateOnly({ year, month, day: 1 });
  const leading = weekdayMondayIndex(first);
  const totalDays = daysInMonth(year, month);
  const weeks = Math.ceil((leading + totalDays) / 7);
  const gridStart = addDays(first, -leading);
  const cells = Array.from({ length: weeks * 7 }, (_, index): MonthCell => {
    const date = addDays(gridStart, index);
    const parts = parseDateOnly(date)!;
    return {
      date,
      day: parts.day,
      inCurrentMonth: parts.year === year && parts.month === month,
      weekday: index % 7,
      weekIndex: Math.floor(index / 7),
    };
  });

  return { year, month, weeks, cells };
}
