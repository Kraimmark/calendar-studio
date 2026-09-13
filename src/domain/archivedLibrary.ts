import type { CalendarEvent } from './types';

export type ArchivedSort = 'archived-desc' | 'title-asc' | 'date-asc' | 'discipline-asc';

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU');
}

function searchableText(event: CalendarEvent): string {
  return normalize([
    event.title,
    event.organizerName,
    event.venue,
    event.notes,
    event.discipline,
    event.status,
    event.series,
    event.source,
    event.startDate ?? '',
    event.endDate ?? '',
    event.competitionStatus ?? '',
    event.competitionRegion ?? '',
    event.competitionPhase ?? '',
  ].join(' '));
}

export function buildArchivedLibrary(events: readonly CalendarEvent[], query: string, sort: ArchivedSort): CalendarEvent[] {
  const needle = normalize(query);
  const filtered = events.filter((event) => event.archivedAt !== null && (!needle || searchableText(event).includes(needle)));

  return [...filtered].sort((left, right) => {
    if (sort === 'title-asc') return left.title.localeCompare(right.title, 'ru') || left.id.localeCompare(right.id);
    if (sort === 'discipline-asc') return left.discipline.localeCompare(right.discipline) || left.title.localeCompare(right.title, 'ru') || left.id.localeCompare(right.id);
    if (sort === 'date-asc') {
      const leftDate = left.startDate ?? '9999-12-31';
      const rightDate = right.startDate ?? '9999-12-31';
      return leftDate.localeCompare(rightDate) || left.title.localeCompare(right.title, 'ru') || left.id.localeCompare(right.id);
    }
    return (right.archivedAt ?? '').localeCompare(left.archivedAt ?? '') || left.title.localeCompare(right.title, 'ru') || left.id.localeCompare(right.id);
  });
}
