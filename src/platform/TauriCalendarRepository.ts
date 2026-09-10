import { invoke } from '@tauri-apps/api/core';
import type { AuditEntry, AuditQuery, CalendarAudit } from '../domain/audit';
import { RevisionConflictError } from '../domain/revision';
import type { CalendarEvent, CalendarSettings } from '../domain/types';
import type { PortableCalendarState, PortableCalendarStore } from '../domain/portability';
import type { CalendarRepository, SaveCalendarSettingsRequest, SaveEventRequest } from '../storage/CalendarRepository';
import { EntityAlreadyExistsError, EntityNotFoundError } from '../storage/errors';

interface CommandErrorPayload {
  code?: string;
  message?: string;
  entityId?: string;
  expectedRevision?: number;
  actualRevision?: number;
}

function normalizeCommandError(error: unknown): Error {
  const value = error as CommandErrorPayload;
  if (value?.code === 'revision_conflict' && value.entityId && value.expectedRevision != null && value.actualRevision != null) {
    return new RevisionConflictError(value.entityId, value.expectedRevision, value.actualRevision);
  }
  if (value?.code === 'entity_not_found' && value.entityId) return new EntityNotFoundError(value.entityId);
  if (value?.code === 'entity_already_exists' && value.entityId) return new EntityAlreadyExistsError(value.entityId);
  return new Error(value?.message ?? (error instanceof Error ? error.message : String(error)));
}

async function call<T>(command: string, payload: object): Promise<T> {
  try {
    return await invoke<T>(command, { payload });
  } catch (error) {
    throw normalizeCommandError(error);
  }
}

export class TauriCalendarRepository implements CalendarRepository, CalendarAudit, PortableCalendarStore {
  listEvents(year: number, includeArchived = false): Promise<CalendarEvent[]> {
    return call('calendar_list_events', { year, includeArchived });
  }

  getEvent(id: string): Promise<CalendarEvent | null> {
    return call('calendar_get_event', { id });
  }

  saveEvent(request: SaveEventRequest, expectedRevision: number | null): Promise<CalendarEvent> {
    return call('calendar_save_event', { request, expectedRevision });
  }

  archiveEvent(id: string, expectedRevision: number, actor: string, timestamp: string): Promise<CalendarEvent> {
    return call('calendar_archive_event', { id, expectedRevision, actor, timestamp });
  }

  restoreEvent(id: string, expectedRevision: number, actor: string, timestamp: string): Promise<CalendarEvent> {
    return call('calendar_restore_event', { id, expectedRevision, actor, timestamp });
  }

  getCalendarSettings(year: number): Promise<CalendarSettings> {
    return call('calendar_get_settings', { year });
  }

  saveCalendarSettings(request: SaveCalendarSettingsRequest, expectedRevision: number): Promise<CalendarSettings> {
    return call('calendar_save_settings', { ...request, expectedRevision });
  }

  append(entry: AuditEntry): Promise<void> {
    return call('calendar_append_audit', entry);
  }

  list(query: AuditQuery = {}): Promise<AuditEntry[]> {
    return call('calendar_list_audit', query);
  }

  exportPortableState(): Promise<PortableCalendarState> {
    return call('calendar_export_state', {});
  }

  replacePortableState(state: PortableCalendarState): Promise<{ backupReference: string | null }> {
    return call('calendar_replace_state', { state });
  }
}
