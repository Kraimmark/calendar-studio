import { buildMonth, type MonthModel } from './calendar';
import { dayBackgroundCategory, type CalendarDayBackgroundKey } from './dayBackgrounds';
import { parseDateOnly, type DateOnly } from './dateOnly';
import { bundleBadges, planningEvents } from './eventBundle';
import type { CalendarEvent } from './types';
import type { CalendarWarning } from './warnings';

export interface AnnualDaySummary {
  date: DateOnly;
  day: number;
  inCurrentMonth: boolean;
  eventCount: number;
  primaryCount: number;
  warningCount: number;
  events: AnnualDayEvent[];
}

export interface AnnualDayEvent {
  id: string;
  label: string;
  title: string;
  color: string;
  backgroundCategory: CalendarDayBackgroundKey;
  startsHere: boolean;
  endsHere: boolean;
  badges: string[];
}

export interface AnnualMonthSummary {
  month: number;
  model: MonthModel;
  eventCount: number;
  primaryCount: number;
  warningCount: number;
  days: AnnualDaySummary[];
}

function dateMonth(date: DateOnly): number | null {
  return parseDateOnly(date)?.month ?? null;
}

function compactEventLabel(event: CalendarEvent): string {
  const phase = event.competitionPhase?.trim();
  if (phase) return phase.length > 17 ? `${phase.slice(0, 16)}…` : phase;
  const replacements: Array<[RegExp, string]> = [
    [/Кубок Санкт-Петербурга/giu, 'Кубок СПб'],
    [/Чемпионат Санкт-Петербурга/giu, 'Чемп. СПб'],
    [/Международные соревнования/giu, 'Междунар.'],
    [/Всероссийские соревнования/giu, 'Всерос.'],
  ];
  const compact = replacements.reduce((title, [pattern, replacement]) => title.replace(pattern, replacement), event.title).trim();
  return compact.length > 17 ? `${compact.slice(0, 16)}…` : compact;
}

export function buildAnnualOverview(
  year: number,
  events: readonly CalendarEvent[],
  warnings: readonly CalendarWarning[],
): AnnualMonthSummary[] {
  const roots = planningEvents(events);
  const visibleIds = new Set(roots.map((event) => event.id));
  const activeWarnings = warnings.filter((warning) => warning.eventIds.some((id) => visibleIds.has(id)));

  const startsByDate = new Map<DateOnly, CalendarEvent[]>();
  for (const event of roots) {
    if (event.calendarYear !== year || event.archivedAt !== null || !event.startDate || !event.endDate) continue;
    const bucket = startsByDate.get(event.startDate) ?? [];
    bucket.push(event);
    startsByDate.set(event.startDate, bucket);
  }

  const warningsByDate = new Map<DateOnly, number>();
  for (const warning of activeWarnings) {
    for (const date of new Set(warning.dates)) {
      const parts = parseDateOnly(date);
      if (!parts || parts.year !== year) continue;
      warningsByDate.set(date, (warningsByDate.get(date) ?? 0) + 1);
    }
  }

  return Array.from({ length: 12 }, (_, index): AnnualMonthSummary => {
    const month = index + 1;
    const model = buildMonth(year, month);
    const monthEvents = roots.filter((event) => event.calendarYear === year && event.archivedAt === null && event.startDate && dateMonth(event.startDate) === month);
    const monthWarnings = activeWarnings.filter((warning) => warning.dates.some((date) => {
      const parts = parseDateOnly(date);
      return parts?.year === year && parts.month === month;
    }));

    return {
      month,
      model,
      eventCount: monthEvents.length,
      primaryCount: monthEvents.filter((event) => event.isPrimary).length,
      warningCount: monthWarnings.length,
      days: model.cells.map((cell) => {
        const starts = cell.inCurrentMonth ? (startsByDate.get(cell.date) ?? []) : [];
        const dayEvents = cell.inCurrentMonth
          ? roots
            .filter((event) => event.calendarYear === year && event.archivedAt === null && event.startDate && event.endDate && event.startDate <= cell.date && event.endDate >= cell.date)
            .sort((left, right) => left.startDate!.localeCompare(right.startDate!) || left.title.localeCompare(right.title, 'ru'))
            .map((event): AnnualDayEvent => ({
              id: event.id,
              label: compactEventLabel(event),
              title: event.title,
              color: event.stickerColor,
              backgroundCategory: dayBackgroundCategory(event),
              startsHere: event.startDate === cell.date,
              endsHere: event.endDate === cell.date,
              badges: bundleBadges(event, events),
            }))
          : [];
        return {
          date: cell.date,
          day: cell.day,
          inCurrentMonth: cell.inCurrentMonth,
          eventCount: starts.length,
          primaryCount: starts.filter((event) => event.isPrimary).length,
          warningCount: cell.inCurrentMonth ? (warningsByDate.get(cell.date) ?? 0) : 0,
          events: dayEvents,
        };
      }),
    };
  });
}
