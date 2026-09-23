import { MAX_CALENDAR_YEAR, MIN_CALENDAR_YEAR } from './calendar';
import { compareDateOnly, parseDateOnly } from './dateOnly';
import type { CalendarEvent, CalendarEventData } from './types';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  field: string | null;
  message: string;
}

export interface EventValidationContext {
  year: number;
  eventId?: string;
  events?: readonly Pick<CalendarEvent, 'id' | 'parentEventId'>[];
}

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function pushDateIssue(issues: ValidationIssue[], value: string | null, field: string, year: number): void {
  if (value === null) return;
  const parsed = parseDateOnly(value);
  if (!parsed) {
    issues.push({ code: 'invalid_date', severity: 'error', field, message: 'Укажите корректную дату.' });
  } else if (parsed.year !== year) {
    issues.push({ code: 'date_outside_year', severity: 'error', field, message: `Дата должна принадлежать ${year} году.` });
  }
}

function hasParentCycle(eventId: string, parentEventId: string, events: readonly Pick<CalendarEvent, 'id' | 'parentEventId'>[]): boolean {
  const byId = new Map(events.map((event) => [event.id, event]));
  const seen = new Set<string>([eventId]);
  let current: string | null = parentEventId;
  while (current) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = byId.get(current)?.parentEventId ?? null;
  }
  return false;
}

export function validateEvent(data: CalendarEventData, context: EventValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Number.isInteger(context.year) || context.year < MIN_CALENDAR_YEAR || context.year > MAX_CALENDAR_YEAR) {
    issues.push({ code: 'invalid_calendar_year', severity: 'error', field: null, message: `Год календаря должен быть ${MIN_CALENDAR_YEAR}–${MAX_CALENDAR_YEAR}.` });
    return issues;
  }

  if (!data.title.trim()) issues.push({ code: 'title_required', severity: 'error', field: 'title', message: 'Название мероприятия обязательно.' });
  if (!HEX_COLOR_RE.test(data.stickerColor)) issues.push({ code: 'invalid_sticker_color', severity: 'error', field: 'stickerColor', message: 'Цвет должен быть указан как #RRGGBB.' });

  if ((data.startDate === null) !== (data.endDate === null)) {
    issues.push({ code: 'event_dates_incomplete', severity: 'error', field: 'startDate', message: 'Для мероприятия укажите обе даты или оставьте обе пустыми.' });
  }
  pushDateIssue(issues, data.startDate, 'startDate', context.year);
  pushDateIssue(issues, data.endDate, 'endDate', context.year);
  if (data.startDate && data.endDate && parseDateOnly(data.startDate) && parseDateOnly(data.endDate) && compareDateOnly(data.endDate, data.startDate) < 0) {
    issues.push({ code: 'end_before_start', severity: 'error', field: 'endDate', message: 'Окончание не может быть раньше начала.' });
  }

  if (data.registration.mode === 'scheduled') {
    if (!data.registration.opensAt || !data.registration.closesAt) {
      issues.push({ code: 'registration_dates_required', severity: 'error', field: 'registration', message: 'Для регистрации по датам нужны дата открытия и дата закрытия.' });
    }
    if (data.registration.opensAt && !parseDateOnly(data.registration.opensAt)) {
      issues.push({ code: 'invalid_registration_open_date', severity: 'error', field: 'registration.opensAt', message: 'Укажите корректную дату открытия регистрации.' });
    }
    if (data.registration.closesAt && !parseDateOnly(data.registration.closesAt)) {
      issues.push({ code: 'invalid_registration_close_date', severity: 'error', field: 'registration.closesAt', message: 'Укажите корректную дату закрытия регистрации.' });
    }
    if (data.registration.opensAt && data.registration.closesAt && parseDateOnly(data.registration.opensAt) && parseDateOnly(data.registration.closesAt) && compareDateOnly(data.registration.closesAt, data.registration.opensAt) < 0) {
      issues.push({ code: 'registration_close_before_open', severity: 'error', field: 'registration.closesAt', message: 'Регистрация не может закрыться раньше открытия.' });
    }
  }

  if (data.source === 'ekp') {
    if (!data.ekpLevel?.trim()) issues.push({ code: 'ekp_level_required', severity: 'error', field: 'ekpLevel', message: 'Для записи ЕКП укажите уровень.' });
    if (!Number.isInteger(data.ekpStageNumber) || (data.ekpStageNumber ?? 0) < 1) issues.push({ code: 'ekp_stage_required', severity: 'error', field: 'ekpStageNumber', message: 'Для записи ЕКП укажите номер этапа.' });
  }

  if (!Number.isInteger(data.daylightBufferMinutes) || data.daylightBufferMinutes < 0 || data.daylightBufferMinutes > 120) {
    issues.push({ code: 'invalid_daylight_buffer', severity: 'error', field: 'daylightBufferMinutes', message: 'Резерв светового окна должен быть от 0 до 120 минут.' });
  }
  if (data.plannedExerciseCount !== null && (!Number.isInteger(data.plannedExerciseCount) || data.plannedExerciseCount < 1 || data.plannedExerciseCount > 40)) {
    issues.push({ code: 'invalid_exercise_count', severity: 'error', field: 'plannedExerciseCount', message: 'Оценка количества упражнений должна быть от 1 до 40.' });
  }
  if (data.plannedSquadCount !== null && (!Number.isInteger(data.plannedSquadCount) || data.plannedSquadCount < 1 || data.plannedSquadCount > 80)) {
    issues.push({ code: 'invalid_squad_count', severity: 'error', field: 'plannedSquadCount', message: 'Оценка количества скводов должна быть от 1 до 80.' });
  }

  const shiftIds = new Set<string>();
  for (const shift of data.shifts) {
    if (!shift.id.trim() || shiftIds.has(shift.id)) issues.push({ code: 'invalid_shift_id', severity: 'error', field: 'shifts', message: 'Каждая смена должна иметь уникальный стабильный ID.' });
    shiftIds.add(shift.id);
    if (!shift.name.trim()) issues.push({ code: 'shift_name_required', severity: 'error', field: 'shifts', message: 'Название смены обязательно.' });
    if (!TIME_RE.test(shift.startsAt) || !TIME_RE.test(shift.endsAt)) issues.push({ code: 'invalid_shift_time', severity: 'error', field: 'shifts', message: 'Время смены указывается в формате HH:MM.' });
  }

  if (data.parentEventId && context.eventId) {
    if (data.parentEventId === context.eventId) issues.push({ code: 'parent_self_cycle', severity: 'error', field: 'parentEventId', message: 'Мероприятие не может быть родителем само себе.' });
    else if (context.events && hasParentCycle(context.eventId, data.parentEventId, context.events)) issues.push({ code: 'parent_cycle', severity: 'error', field: 'parentEventId', message: 'Нельзя создать циклическую связь мероприятий.' });
  }

  return issues;
}

export function hasBlockingIssues(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
