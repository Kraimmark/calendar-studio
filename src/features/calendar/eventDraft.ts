import type { DateOnly } from '../../domain/dateOnly';
import type { CalendarEvent, CalendarEventData } from '../../domain/types';

export function createEventData(startDate: DateOnly | null = null, endDate: DateOnly | null = null): CalendarEventData {
  return {
    title: '',
    organizerName: '',
    kind: 'match',
    discipline: 'pistol',
    series: 'regular',
    source: 'manual',
    status: 'draft',
    competitionStatus: null,
    competitionRegion: 'Санкт-Петербург',
    competitionPhase: null,
    competitionStageNumber: null,
    startDate,
    endDate,
    isPrimary: true,
    parentEventId: null,
    venue: '',
    venueScope: 'unspecified',
    notes: '',
    stickerColor: '#808080',
    registration: { mode: 'free', opensAt: null, closesAt: null, priorityOneAlerts: false },
    ekpLevel: null,
    ekpStageNumber: null,
    coverPath: null,
    daylightBufferMinutes: 15,
    shifts: [],
    plannedExerciseCount: null,
    plannedSquadCount: null,
  };
}

export function eventDataOf(event: CalendarEvent): CalendarEventData {
  const {
    id: _id,
    calendarYear: _calendarYear,
    revision: _revision,
    createdAt: _createdAt,
    createdBy: _createdBy,
    updatedAt: _updatedAt,
    updatedBy: _updatedBy,
    archivedAt: _archivedAt,
    ...data
  } = event;
  return structuredClone(data);
}

export function diffEventData(original: CalendarEventData, next: CalendarEventData): Partial<CalendarEventData> {
  const result: Partial<CalendarEventData> = {};
  for (const key of Object.keys(next) as (keyof CalendarEventData)[]) {
    if (JSON.stringify(original[key]) !== JSON.stringify(next[key])) {
      (result as Record<keyof CalendarEventData, CalendarEventData[keyof CalendarEventData]>)[key] = structuredClone(next[key]);
    }
  }
  return result;
}
