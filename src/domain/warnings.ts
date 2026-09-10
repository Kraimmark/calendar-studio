import { addDays, differenceInDays, parseDateOnly, type DateOnly } from './dateOnly';
import type { CalendarEvent } from './types';

export type CalendarWarningCode = 'monthly_match_overload' | 'match_spacing' | 'trf_spacing' | 'all_russian_buffer' | 'all_russian_build_overlap';

export interface CalendarWarning {
  code: CalendarWarningCode;
  message: string;
  eventIds: string[];
  dates: DateOnly[];
}

interface DatedMatch extends CalendarEvent {
  startDate: DateOnly;
  endDate: DateOnly;
}

interface DatedEvent extends CalendarEvent {
  startDate: DateOnly;
  endDate: DateOnly;
}

function activeDatedEvents(events: readonly CalendarEvent[], year: number): DatedEvent[] {
  return events
    .filter((event): event is DatedEvent => event.calendarYear === year && event.archivedAt === null && event.startDate !== null && event.endDate !== null)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || a.id.localeCompare(b.id));
}

function rangesOverlap(leftStart: DateOnly, leftEnd: DateOnly, rightStart: DateOnly, rightEnd: DateOnly): boolean {
  return leftStart.localeCompare(rightEnd) <= 0 && rightStart.localeCompare(leftEnd) <= 0;
}

function datedMatches(events: readonly CalendarEvent[], year: number): DatedMatch[] {
  return events
    .filter((event): event is DatedMatch => event.calendarYear === year && event.archivedAt === null && event.kind === 'match' && event.startDate !== null && event.endDate !== null)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || a.id.localeCompare(b.id));
}

function fullFreeDaysBetween(left: DatedMatch, right: DatedMatch): number {
  return differenceInDays(right.startDate, left.endDate) - 1;
}

function monthKey(date: DateOnly): string {
  const parsed = parseDateOnly(date);
  if (!parsed) throw new RangeError(`Invalid date-only value: ${date}`);
  return `${parsed.year}-${String(parsed.month).padStart(2, '0')}`;
}

export function calculateWarnings(events: readonly CalendarEvent[], year: number): CalendarWarning[] {
  const matches = datedMatches(events, year);
  const warnings: CalendarWarning[] = [];

  const byMonth = new Map<string, DatedMatch[]>();
  for (const event of matches) {
    const key = monthKey(event.startDate);
    const bucket = byMonth.get(key) ?? [];
    bucket.push(event);
    byMonth.set(key, bucket);
  }
  for (const [key, bucket] of [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (bucket.length <= 2) continue;
    warnings.push({
      code: 'monthly_match_overload',
      message: `В ${key} запланировано ${bucket.length} матча: больше двух мероприятий в одном месяце.`,
      eventIds: bucket.map((event) => event.id),
      dates: bucket.map((event) => event.startDate),
    });
  }

  // Airgun and firearm-like disciplines are independent spacing streams: an
  // airgun match between two firearm matches must not hide a firearm conflict.
  const spacingGroups = [
    matches.filter((event) => event.discipline === 'airgun'),
    matches.filter((event) => event.discipline !== 'airgun'),
  ];
  for (const group of spacingGroups) {
    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1]!;
      const current = group[index]!;
      const freeDays = fullFreeDaysBetween(previous, current);
      if (freeDays >= 14) continue;
      warnings.push({
        code: 'match_spacing',
        message: `Между «${previous.title}» и «${current.title}» только ${Math.max(0, freeDays)} полных свободных дней; требуется две недели.`,
        eventIds: [previous.id, current.id],
        dates: [previous.endDate, current.startDate],
      });
    }
  }

  const trf = matches.filter((event) => event.series === 'trf');
  for (let index = 1; index < trf.length; index += 1) {
    const previous = trf[index - 1]!;
    const current = trf[index]!;
    const freeDays = fullFreeDaysBetween(previous, current);
    if (freeDays >= 30) continue;
    warnings.push({
      code: 'trf_spacing',
      message: `Между матчами ТРФ «${previous.title}» и «${current.title}» только ${Math.max(0, freeDays)} полных свободных дней; требуется 30.`,
      eventIds: [previous.id, current.id],
      dates: [previous.endDate, current.startDate],
    });
  }

  for (const target of matches.filter((event) => event.series === 'allRussian')) {
    const previous = matches
      .filter((event) => event.id !== target.id && event.discipline === target.discipline && event.startDate.localeCompare(target.startDate) <= 0)
      .sort((a, b) => b.endDate.localeCompare(a.endDate) || b.startDate.localeCompare(a.startDate))[0];
    if (previous) {
      const freeDays = fullFreeDaysBetween(previous, target);
      if (freeDays < 14) {
        warnings.push({
          code: 'all_russian_buffer',
          message: `Перед всероссийским мероприятием «${target.title}» нет двух свободных недель в дисциплине «${target.discipline}»: после «${previous.title}» остаётся ${Math.max(0, freeDays)} полных дней.`,
          eventIds: [previous.id, target.id],
          dates: [previous.endDate, target.startDate],
        });
      }
    }
  }

  // A build entry inside the two-week preparation zone is allowed by itself.
  // The warning appears only when that planned build range collides with some
  // other active calendar record, matching the MASTER_SPEC wording.
  const datedEvents = activeDatedEvents(events, year);
  for (const target of matches.filter((event) => event.series === 'allRussian')) {
    const preparationStart = addDays(target.startDate, -14);
    const preparationEnd = addDays(target.startDate, -1);
    const builds = datedEvents.filter((event) =>
      event.kind === 'build' && rangesOverlap(event.startDate, event.endDate, preparationStart, preparationEnd),
    );
    for (const build of builds) {
      const conflicts = datedEvents.filter((event) =>
        event.id !== build.id &&
        event.id !== target.id &&
        rangesOverlap(build.startDate, build.endDate, event.startDate, event.endDate),
      );
      for (const conflict of conflicts) {
        warnings.push({
          code: 'all_russian_build_overlap',
          message: `Застройка «${build.title}» перед всероссийским мероприятием «${target.title}» пересекается с записью «${conflict.title}».`,
          eventIds: [build.id, conflict.id, target.id],
          dates: [build.startDate, build.endDate, target.startDate],
        });
      }
    }
  }

  return warnings;
}
