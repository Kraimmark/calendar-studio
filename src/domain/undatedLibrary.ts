import type { CalendarEvent } from './types';

export type UndatedSort = 'updated-desc' | 'title-asc' | 'discipline-asc' | 'status-asc';

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
    event.competitionStatus ?? '',
    event.competitionRegion ?? '',
    event.competitionPhase ?? '',
  ].join(' '));
}

export function buildUndatedLibrary(events: readonly CalendarEvent[], query: string, sort: UndatedSort): CalendarEvent[] {
  const needle = normalize(query);
  const filtered = events.filter((event) =>
    event.archivedAt === null && event.startDate === null && event.endDate === null && (!needle || searchableText(event).includes(needle)),
  );

  return [...filtered].sort((left, right) => {
    if (sort === 'title-asc') return left.title.localeCompare(right.title, 'ru') || left.id.localeCompare(right.id);
    if (sort === 'discipline-asc') return left.discipline.localeCompare(right.discipline) || left.title.localeCompare(right.title, 'ru') || left.id.localeCompare(right.id);
    if (sort === 'status-asc') return left.status.localeCompare(right.status) || left.title.localeCompare(right.title, 'ru') || left.id.localeCompare(right.id);
    return right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title, 'ru') || left.id.localeCompare(right.id);
  });
}
