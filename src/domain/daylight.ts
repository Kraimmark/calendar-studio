import { addDays, differenceInDays, parseDateOnly, type DateOnly } from './dateOnly';
import type { CalendarEventData, EventShift } from './types';

export interface DaylightLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  utcOffsetMinutes: number;
}

export const SAINT_PETERSBURG: DaylightLocation = {
  id: 'saint-petersburg',
  name: 'Санкт-Петербург',
  latitude: 59.9343,
  longitude: 30.3351,
  utcOffsetMinutes: 180,
};

export interface SafeTimeWindow {
  startsAt: string;
  endsAt: string;
  startsDayOffset: number;
  endsDayOffset: number;
  spansMidnight: boolean;
}

export interface DaylightInfo {
  date: DateOnly;
  civilDawn: string | null;
  sunrise: string | null;
  sunset: string | null;
  civilDusk: string | null;
  civilDawnDayOffset: number | null;
  sunriseDayOffset: number | null;
  sunsetDayOffset: number | null;
  civilDuskDayOffset: number | null;
  daylightMinutes: number | null;
  nightMinutes: number | null;
  safeDayWindow: SafeTimeWindow | null;
  safeNightWindow: SafeTimeWindow | null;
}

export interface ShiftDaylightWarning {
  shiftId: string;
  shiftName: string;
  date: DateOnly;
  message: string;
}

const SUNRISE_ZENITH = 90.833;
const CIVIL_ZENITH = 96;

function radians(value: number): number { return value * Math.PI / 180; }
function degrees(value: number): number { return value * 180 / Math.PI; }
function normalizeDegrees(value: number): number { return ((value % 360) + 360) % 360; }
function normalizeHours(value: number): number { return ((value % 24) + 24) % 24; }

function dayOfYear(date: DateOnly): number {
  const parts = parseDateOnly(date);
  if (!parts) throw new RangeError(`Invalid date-only value: ${date}`);
  return differenceInDays(date, `${parts.year}-01-01`) + 1;
}

/** Ed Williams/USNO sunrise algorithm. Returns local clock minutes 0..1439. */
function solarClockMinutes(date: DateOnly, location: DaylightLocation, zenith: number, sunrise: boolean): number | null {
  const n = dayOfYear(date);
  const lngHour = location.longitude / 15;
  const t = n + ((sunrise ? 6 : 18) - lngHour) / 24;
  const meanAnomaly = 0.9856 * t - 3.289;
  let trueLongitude = meanAnomaly + 1.916 * Math.sin(radians(meanAnomaly)) + 0.020 * Math.sin(radians(2 * meanAnomaly)) + 282.634;
  trueLongitude = normalizeDegrees(trueLongitude);

  let rightAscension = degrees(Math.atan(0.91764 * Math.tan(radians(trueLongitude))));
  rightAscension = normalizeDegrees(rightAscension);
  const longitudeQuadrant = Math.floor(trueLongitude / 90) * 90;
  const raQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension = (rightAscension + longitudeQuadrant - raQuadrant) / 15;

  const sinDeclination = 0.39782 * Math.sin(radians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHour = (Math.cos(radians(zenith)) - sinDeclination * Math.sin(radians(location.latitude))) /
    (cosDeclination * Math.cos(radians(location.latitude)));
  if (cosHour > 1 || cosHour < -1) return null;

  let localHourAngle = sunrise ? 360 - degrees(Math.acos(cosHour)) : degrees(Math.acos(cosHour));
  localHourAngle /= 15;
  const localMeanTime = localHourAngle + rightAscension - 0.06571 * t - 6.622;
  const utcHours = normalizeHours(localMeanTime - lngHour);
  const localMinutes = Math.round(utcHours * 60 + location.utcOffsetMinutes);
  return ((localMinutes % 1440) + 1440) % 1440;
}

/**
 * Anchors a solar event to the requested civil date instead of losing the day
 * when a late sunset/dusk occurs after 00:00. Dawn belongs before local noon;
 * dusk belongs after local noon, possibly on date+1 at high latitude.
 */
function anchoredSolarMinutes(date: DateOnly, location: DaylightLocation, zenith: number, sunrise: boolean): number | null {
  const clock = solarClockMinutes(date, location, zenith, sunrise);
  if (clock === null) return null;
  if (sunrise && clock >= 12 * 60) return clock - 1440;
  if (!sunrise && clock < 12 * 60) return clock + 1440;
  return clock;
}

export function parseClockMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatClockMinutes(value: number): string {
  const normalized = ((Math.round(value) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function dayOffset(value: number): number {
  return Math.floor(value / 1440);
}

function buildSafeWindow(start: number | null, end: number | null, buffer: number): SafeTimeWindow | null {
  if (start === null || end === null) return null;
  const safeStart = start + buffer;
  const safeEnd = end - buffer;
  if (safeEnd <= safeStart) return null;
  const startsDayOffset = dayOffset(safeStart);
  const endsDayOffset = dayOffset(safeEnd);
  return {
    startsAt: formatClockMinutes(safeStart),
    endsAt: formatClockMinutes(safeEnd),
    startsDayOffset,
    endsDayOffset,
    spansMidnight: startsDayOffset !== endsDayOffset,
  };
}

function displaySolar(value: number | null): { time: string | null; offset: number | null } {
  return value === null ? { time: null, offset: null } : { time: formatClockMinutes(value), offset: dayOffset(value) };
}

export function calculateDaylight(date: DateOnly, location: DaylightLocation = SAINT_PETERSBURG, bufferMinutes = 15): DaylightInfo {
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 120) throw new RangeError('Daylight buffer must be 0..120 minutes');
  const civilDawnMinutes = anchoredSolarMinutes(date, location, CIVIL_ZENITH, true);
  const sunriseMinutes = anchoredSolarMinutes(date, location, SUNRISE_ZENITH, true);
  const sunsetMinutes = anchoredSolarMinutes(date, location, SUNRISE_ZENITH, false);
  const civilDuskMinutes = anchoredSolarMinutes(date, location, CIVIL_ZENITH, false);
  const nextCivilDawnForNextDate = anchoredSolarMinutes(addDays(date, 1), location, CIVIL_ZENITH, true);
  const nextCivilDawnMinutes = nextCivilDawnForNextDate === null ? null : nextCivilDawnForNextDate + 1440;

  const daylightMinutes = sunriseMinutes !== null && sunsetMinutes !== null ? sunsetMinutes - sunriseMinutes : null;
  const nightMinutes = daylightMinutes === null ? null : 1440 - daylightMinutes;
  const civilDawn = displaySolar(civilDawnMinutes);
  const sunrise = displaySolar(sunriseMinutes);
  const sunset = displaySolar(sunsetMinutes);
  const civilDusk = displaySolar(civilDuskMinutes);

  return {
    date,
    civilDawn: civilDawn.time,
    sunrise: sunrise.time,
    sunset: sunset.time,
    civilDusk: civilDusk.time,
    civilDawnDayOffset: civilDawn.offset,
    sunriseDayOffset: sunrise.offset,
    sunsetDayOffset: sunset.offset,
    civilDuskDayOffset: civilDusk.offset,
    daylightMinutes,
    nightMinutes,
    safeDayWindow: buildSafeWindow(sunriseMinutes, sunsetMinutes, bufferMinutes),
    safeNightWindow: buildSafeWindow(civilDuskMinutes, nextCivilDawnMinutes, bufferMinutes),
  };
}

function shiftRange(shift: EventShift): { start: number; end: number } | null {
  const start = parseClockMinutes(shift.startsAt);
  const rawEnd = parseClockMinutes(shift.endsAt);
  if (start === null || rawEnd === null) return null;
  return { start, end: rawEnd <= start ? rawEnd + 1440 : rawEnd };
}

function windowRange(window: SafeTimeWindow, relativeDayShift = 0): { start: number; end: number } {
  const start = parseClockMinutes(window.startsAt)! + (window.startsDayOffset + relativeDayShift) * 1440;
  const end = parseClockMinutes(window.endsAt)! + (window.endsDayOffset + relativeDayShift) * 1440;
  return { start, end };
}

function rangeFits(inner: { start: number; end: number }, outer: { start: number; end: number }): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

function shiftFitsDay(shift: EventShift, date: DateOnly, buffer: number, location: DaylightLocation): boolean {
  const range = shiftRange(shift);
  const window = calculateDaylight(date, location, buffer).safeDayWindow;
  if (!range || !window || range.end > 1440) return false;
  return rangeFits(range, windowRange(window));
}

function shiftFitsNight(shift: EventShift, date: DateOnly, buffer: number, location: DaylightLocation): boolean {
  const range = shiftRange(shift);
  if (!range) return false;

  // Evening/night beginning on the event date.
  const currentWindow = calculateDaylight(date, location, buffer).safeNightWindow;
  if (currentWindow && rangeFits(range, windowRange(currentWindow))) return true;

  // Early-morning shift belongs to the night that started on date-1.
  if (range.start < 12 * 60 && range.end <= 12 * 60) {
    const previousWindow = calculateDaylight(addDays(date, -1), location, buffer).safeNightWindow;
    if (previousWindow && rangeFits(range, windowRange(previousWindow, -1))) return true;
  }
  return false;
}

export function calculateShiftDaylightWarnings(
  data: Pick<CalendarEventData, 'startDate' | 'endDate' | 'daylightBufferMinutes' | 'shifts'>,
  location: DaylightLocation = SAINT_PETERSBURG,
): ShiftDaylightWarning[] {
  if (!data.startDate || !data.endDate || data.shifts.length === 0) return [];
  const days = differenceInDays(data.endDate, data.startDate);
  if (days < 0 || days > 370) return [];

  const warnings: ShiftDaylightWarning[] = [];
  for (let offset = 0; offset <= days; offset += 1) {
    const date = addDays(data.startDate, offset);
    for (const shift of data.shifts) {
      const fits = shift.kind === 'day'
        ? shiftFitsDay(shift, date, data.daylightBufferMinutes, location)
        : shiftFitsNight(shift, date, data.daylightBufferMinutes, location);
      if (!fits) {
        warnings.push({
          shiftId: shift.id,
          shiftName: shift.name,
          date,
          message: `Смена «${shift.name}» (${shift.startsAt}–${shift.endsAt}) выходит за безопасное ${shift.kind === 'day' ? 'дневное' : 'ночное'} световое окно ${date}.`,
        });
      }
    }
  }
  return warnings;
}
