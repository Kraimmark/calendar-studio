import { addDays, parseDateOnly, type DateOnly } from './dateOnly';
import { planningEvents } from './eventBundle';
import type { CalendarEvent } from './types';

export interface PreparationZone {
  date: DateOnly;
  events: CalendarEvent[];
}

/**
 * The two clear weeks immediately before an all-Russian event are reserved
 * preparation time. The event dates themselves are deliberately excluded.
 */
export function preparationZonesByDate(year: number, events: readonly CalendarEvent[]): Map<DateOnly, PreparationZone> {
  const zones = new Map<DateOnly, PreparationZone>();
  for (const event of planningEvents(events)) {
    if (event.archivedAt !== null || event.calendarYear !== year || event.series !== 'allRussian' || !event.startDate) continue;
    for (let offset = 14; offset >= 1; offset -= 1) {
      const date = addDays(event.startDate, -offset);
      if (parseDateOnly(date)?.year !== year) continue;
      const existing = zones.get(date);
      if (existing) existing.events.push(event);
      else zones.set(date, { date, events: [event] });
    }
  }
  return zones;
}
