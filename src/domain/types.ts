import type { DateOnly } from './dateOnly';

export type EventKind = 'match' | 'utm' | 'build';
export type Discipline = 'pistol' | 'carbine' | 'shotgun' | 'airgun' | 'multigun' | 'other';
export type EventSeries = 'regular' | 'trf' | 'allRussian' | 'departmental' | 'spbCup' | 'other';
export type EventSource = 'manual' | 'ekp';
export type EventStatus = 'draft' | 'tentative' | 'confirmed';
export type VenueScope = 'nevsky' | 'spb' | 'otherRegion' | 'unspecified';
export type CalendarMode = 'planning' | 'approved';
export type RegistrationMode = 'free' | 'scheduled';
export type ShiftKind = 'day' | 'night';

export interface EventShift {
  id: string;
  name: string;
  kind: ShiftKind;
  startsAt: string;
  endsAt: string;
}

export interface EventRegistration {
  mode: RegistrationMode;
  opensAt: DateOnly | null;
  closesAt: DateOnly | null;
  priorityOneAlerts: boolean;
}

export interface CalendarEventData {
  title: string;
  organizerName: string;
  kind: EventKind;
  discipline: Discipline;
  series: EventSeries;
  source: EventSource;
  status: EventStatus;
  competitionStatus: string | null;
  competitionRegion: string | null;
  competitionPhase: string | null;
  competitionStageNumber: number | null;
  startDate: DateOnly | null;
  endDate: DateOnly | null;
  isPrimary: boolean;
  parentEventId: string | null;
  venue: string;
  venueScope: VenueScope;
  notes: string;
  stickerColor: string;
  registration: EventRegistration;
  ekpLevel: string | null;
  ekpStageNumber: number | null;
  coverPath: string | null;
  daylightBufferMinutes: number;
  shifts: EventShift[];
  plannedExerciseCount: number | null;
  plannedSquadCount: number | null;
}

export interface CalendarEvent extends CalendarEventData {
  id: string;
  calendarYear: number;
  revision: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archivedAt: string | null;
}

export interface CalendarSettings {
  year: number;
  mode: CalendarMode;
  revision: number;
  approvedAt: string | null;
  approvedBy: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
}
