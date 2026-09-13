import { parseDateOnly } from './dateOnly';
import type { CalendarEvent } from './types';

export const publicPlanMonthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export interface PublicPlanRow {
  date: string;
  title: string;
  venue: string;
  eventId: string;
  groupKey: string;
  isPrimary: boolean;
}

export interface PublicPlanMonth {
  month: number;
  label: string;
  rows: PublicPlanRow[];
}

function shortVenue(event: CalendarEvent): string {
  if (event.venueScope === 'nevsky') return 'Невский';
  return event.venue.trim() || (event.venueScope === 'spb' ? 'Санкт-Петербург' : '');
}

export function publicPlanDate(event: Pick<CalendarEvent, 'startDate' | 'endDate'>): string {
  if (!event.startDate || !event.endDate) return '';
  const start = parseDateOnly(event.startDate);
  const end = parseDateOnly(event.endDate);
  if (!start || !end) return '';
  const startText = `${String(start.day).padStart(2, '0')}.${String(start.month).padStart(2, '0')}`;
  const endText = `${String(end.day).padStart(2, '0')}.${String(end.month).padStart(2, '0')}`;
  return startText === endText ? startText : `${startText}-${endText}`;
}

/** Projection for a formal calendar plan: live dated sporting events, without UTM/build or the archive. */
export function buildPublicPlan(year: number, events: readonly CalendarEvent[]): PublicPlanMonth[] {
  const eligible = events.filter((event) => event.calendarYear === year && event.archivedAt === null && event.kind === 'match' && event.startDate && event.endDate);
  const byId = new Map(eligible.map((event) => [event.id, event]));
  const rootId = (event: CalendarEvent): string => {
    const visited = new Set<string>();
    let current = event;
    while (current.parentEventId && !visited.has(current.id)) {
      visited.add(current.id);
      const parent = byId.get(current.parentEventId);
      if (!parent) break;
      current = parent;
    }
    return current.id;
  };
  return publicPlanMonthNames.map((label, index) => {
    const month = index + 1;
    const rows = eligible
      .filter((event) => parseDateOnly(event.startDate!)?.month === month)
      .sort((left, right) => left.startDate!.localeCompare(right.startDate!) || left.endDate!.localeCompare(right.endDate!) || Number(right.isPrimary) - Number(left.isPrimary) || left.title.localeCompare(right.title, 'ru'))
      .map((event) => ({ date: publicPlanDate(event), title: event.title.trim(), venue: shortVenue(event), eventId: event.id, groupKey: rootId(event), isPrimary: event.isPrimary }));
    return { month, label, rows };
  }).filter((month) => month.rows.length > 0);
}
