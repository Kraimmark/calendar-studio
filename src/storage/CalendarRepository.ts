import type { CalendarEvent, CalendarEventData, CalendarSettings } from '../domain/types';

export interface CreateEventRequest {
  kind: 'create';
  id: string;
  calendarYear: number;
  actor: string;
  timestamp: string;
  data: CalendarEventData;
}

export interface UpdateEventRequest {
  kind: 'update';
  id: string;
  actor: string;
  timestamp: string;
  changes: Partial<CalendarEventData>;
}

export type SaveEventRequest = CreateEventRequest | UpdateEventRequest;

export interface SaveCalendarSettingsRequest {
  year: number;
  actor: string;
  timestamp: string;
  mode: CalendarSettings['mode'];
}

export interface CalendarRepository {
  listEvents(year: number, includeArchived?: boolean): Promise<CalendarEvent[]>;
  getEvent(id: string): Promise<CalendarEvent | null>;
  saveEvent(request: SaveEventRequest, expectedRevision: number | null): Promise<CalendarEvent>;
  archiveEvent(id: string, expectedRevision: number, actor: string, timestamp: string): Promise<CalendarEvent>;
  restoreEvent(id: string, expectedRevision: number, actor: string, timestamp: string): Promise<CalendarEvent>;
  getCalendarSettings(year: number): Promise<CalendarSettings>;
  saveCalendarSettings(request: SaveCalendarSettingsRequest, expectedRevision: number): Promise<CalendarSettings>;
}
