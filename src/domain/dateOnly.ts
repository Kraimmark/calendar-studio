export type DateOnly = `${number}-${number}-${number}`;

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Invalid year/month: ${year}/${month}`);
  }
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseDateOnly(value: string): DateParts | null {
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function assertDateOnly(value: string): asserts value is DateOnly {
  if (!parseDateOnly(value)) throw new RangeError(`Invalid date-only value: ${value}`);
}

export function formatDateOnly(parts: DateParts): DateOnly {
  const { year, month, day } = parts;
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Invalid date parts: ${year}-${month}-${day}`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as DateOnly;
}

function daysBeforeYear(year: number): number {
  const y = year - 1;
  return 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400);
}

function dayOfYear(parts: DateParts): number {
  let total = parts.day;
  for (let month = 1; month < parts.month; month += 1) total += daysInMonth(parts.year, month);
  return total;
}

export function dateOnlyOrdinal(value: string): number {
  const parts = parseDateOnly(value);
  if (!parts) throw new RangeError(`Invalid date-only value: ${value}`);
  return daysBeforeYear(parts.year) + dayOfYear(parts);
}

export function compareDateOnly(a: string, b: string): number {
  return Math.sign(dateOnlyOrdinal(a) - dateOnlyOrdinal(b));
}

export function differenceInDays(a: string, b: string): number {
  return dateOnlyOrdinal(a) - dateOnlyOrdinal(b);
}

export function addDays(value: string, delta: number): DateOnly {
  if (!Number.isInteger(delta)) throw new RangeError('Date delta must be an integer');
  const parts = parseDateOnly(value);
  if (!parts) throw new RangeError(`Invalid date-only value: ${value}`);

  let { year, month, day } = parts;
  let remaining = delta;
  while (remaining > 0) {
    const max = daysInMonth(year, month);
    if (day < max) day += 1;
    else {
      day = 1;
      if (month === 12) { month = 1; year += 1; }
      else month += 1;
    }
    remaining -= 1;
  }
  while (remaining < 0) {
    if (day > 1) day -= 1;
    else {
      if (month === 1) { month = 12; year -= 1; }
      else month -= 1;
      day = daysInMonth(year, month);
    }
    remaining += 1;
  }
  return formatDateOnly({ year, month, day });
}

/** Monday=0 ... Sunday=6. Pure Gregorian arithmetic, no local Date timezone. */
export function weekdayMondayIndex(value: string): number {
  const parts = parseDateOnly(value);
  if (!parts) throw new RangeError(`Invalid date-only value: ${value}`);
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  let y = parts.year;
  if (parts.month < 3) y -= 1;
  const sundayIndex = (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + offsets[parts.month - 1]! + parts.day) % 7;
  return (sundayIndex + 6) % 7;
}
