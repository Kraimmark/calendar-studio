import type { AuditEntry, AuditQuery, CalendarAudit } from '../domain/audit';
import { assertCalendarYear } from '../domain/calendar';
import { assertExpectedRevision, nextRevision } from '../domain/revision';
import type { CalendarEvent, CalendarSettings } from '../domain/types';
import type { PortableCalendarState, PortableCalendarStore } from '../domain/portability';
import type { CalendarRepository, SaveCalendarSettingsRequest, SaveEventRequest } from './CalendarRepository';

import { EntityAlreadyExistsError, EntityNotFoundError } from './errors';

type AuditIdFactory = () => string;

function defaultAuditIdFactory(): string {
  return globalThis.crypto.randomUUID();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryCalendarRepository implements CalendarRepository, CalendarAudit, PortableCalendarStore {
  private readonly events = new Map<string, CalendarEvent>();
  private readonly settings = new Map<number, CalendarSettings>();
  private readonly auditEntries: AuditEntry[] = [];

  constructor(private readonly auditIdFactory: AuditIdFactory = defaultAuditIdFactory) {}

  async listEvents(year: number, includeArchived = false): Promise<CalendarEvent[]> {
    assertCalendarYear(year);
    return [...this.events.values()]
      .filter((event) => event.calendarYear === year && (includeArchived || event.archivedAt === null))
      .sort((a, b) => (a.startDate ?? '9999-12-31').localeCompare(b.startDate ?? '9999-12-31') || a.title.localeCompare(b.title, 'ru'))
      .map(clone);
  }

  async getEvent(id: string): Promise<CalendarEvent | null> {
    const event = this.events.get(id);
    return event ? clone(event) : null;
  }

  async saveEvent(request: SaveEventRequest, expectedRevision: number | null): Promise<CalendarEvent> {
    if (request.kind === 'create') {
      assertCalendarYear(request.calendarYear);
      if (expectedRevision !== null) throw new Error('Create requires expectedRevision=null');
      if (this.events.has(request.id)) throw new EntityAlreadyExistsError(request.id);
      const event: CalendarEvent = {
        ...clone(request.data),
        id: request.id,
        calendarYear: request.calendarYear,
        revision: 1,
        createdAt: request.timestamp,
        createdBy: request.actor,
        updatedAt: request.timestamp,
        updatedBy: request.actor,
        archivedAt: null,
      };
      this.events.set(event.id, clone(event));
      this.recordAudit('event', event.id, request.actor, request.timestamp, 'create', null, 1, 'created');
      return clone(event);
    }

    const current = this.events.get(request.id);
    if (!current) throw new EntityNotFoundError(request.id);
    if (expectedRevision === null) throw new Error('Update requires expectedRevision');
    assertExpectedRevision(request.id, current.revision, expectedRevision);

    const revision = nextRevision(current.revision);
    const updated: CalendarEvent = {
      ...current,
      ...clone(request.changes),
      id: current.id,
      calendarYear: current.calendarYear,
      revision,
      createdAt: current.createdAt,
      createdBy: current.createdBy,
      updatedAt: request.timestamp,
      updatedBy: request.actor,
      archivedAt: current.archivedAt,
    };
    this.events.set(updated.id, clone(updated));
    const changedFields = Object.keys(request.changes).sort().join(',') || 'no-fields';
    this.recordAudit('event', updated.id, request.actor, request.timestamp, 'update', current.revision, revision, `fields:${changedFields}`);
    return clone(updated);
  }

  async archiveEvent(id: string, expectedRevision: number, actor: string, timestamp: string): Promise<CalendarEvent> {
    const current = this.events.get(id);
    if (!current) throw new EntityNotFoundError(id);
    assertExpectedRevision(id, current.revision, expectedRevision);
    const revision = nextRevision(current.revision);
    const updated = { ...current, revision, updatedAt: timestamp, updatedBy: actor, archivedAt: timestamp };
    this.events.set(id, clone(updated));
    this.recordAudit('event', id, actor, timestamp, 'archive', current.revision, revision, 'soft-archived');
    return clone(updated);
  }

  async restoreEvent(id: string, expectedRevision: number, actor: string, timestamp: string): Promise<CalendarEvent> {
    const current = this.events.get(id);
    if (!current) throw new EntityNotFoundError(id);
    assertExpectedRevision(id, current.revision, expectedRevision);
    const revision = nextRevision(current.revision);
    const updated = { ...current, revision, updatedAt: timestamp, updatedBy: actor, archivedAt: null };
    this.events.set(id, clone(updated));
    this.recordAudit('event', id, actor, timestamp, 'restore', current.revision, revision, 'restored');
    return clone(updated);
  }

  async getCalendarSettings(year: number): Promise<CalendarSettings> {
    assertCalendarYear(year);
    const existing = this.settings.get(year);
    return clone(existing ?? {
      year,
      mode: 'planning',
      revision: 1,
      approvedAt: null,
      approvedBy: null,
      reopenedAt: null,
      reopenedBy: null,
      acceptedWarningKeys: [],
    });
  }

  async saveCalendarSettings(request: SaveCalendarSettingsRequest, expectedRevision: number): Promise<CalendarSettings> {
    assertCalendarYear(request.year);
    const current = await this.getCalendarSettings(request.year);
    assertExpectedRevision(String(request.year), current.revision, expectedRevision);
    const revision = nextRevision(current.revision);
    const approving = request.mode === 'approved' && current.mode !== 'approved';
    const reopening = request.mode === 'planning' && current.mode !== 'planning';
    const updated: CalendarSettings = {
      ...current,
      mode: request.mode,
      revision,
      approvedAt: approving ? request.timestamp : current.approvedAt,
      approvedBy: approving ? request.actor : current.approvedBy,
      reopenedAt: reopening ? request.timestamp : current.reopenedAt,
      reopenedBy: reopening ? request.actor : current.reopenedBy,
      acceptedWarningKeys: [...new Set(request.acceptedWarningKeys)].sort(),
    };
    this.settings.set(request.year, clone(updated));
    this.recordAudit('calendar_settings', String(request.year), request.actor, request.timestamp, approving ? 'approve' : reopening ? 'reopen' : 'update', current.revision, revision, `mode:${request.mode}`);
    return clone(updated);
  }

  async deleteEvent(id: string, expectedRevision: number, _actor: string, _timestamp: string): Promise<string[]> {
    const current = this.events.get(id);
    if (!current) throw new EntityNotFoundError(id);
    assertExpectedRevision(id, current.revision, expectedRevision);
    const deleted = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const event of this.events.values()) {
        if (event.parentEventId && deleted.has(event.parentEventId) && !deleted.has(event.id)) {
          deleted.add(event.id);
          changed = true;
        }
      }
    }
    for (const eventId of deleted) this.events.delete(eventId);
    for (let index = this.auditEntries.length - 1; index >= 0; index -= 1) {
      const entry = this.auditEntries[index];
      if (entry?.entityType === 'event' && deleted.has(entry.entityId)) this.auditEntries.splice(index, 1);
    }
    return [...deleted];
  }

  async append(entry: AuditEntry): Promise<void> {
    if (this.auditEntries.some((candidate) => candidate.auditId === entry.auditId)) throw new EntityAlreadyExistsError(entry.auditId);
    this.auditEntries.push(clone(entry));
  }

  async list(query: AuditQuery = {}): Promise<AuditEntry[]> {
    return this.auditEntries
      .filter((entry) => !query.entityId || entry.entityId === query.entityId)
      .filter((entry) => !query.from || entry.timestamp >= query.from)
      .filter((entry) => !query.to || entry.timestamp <= query.to)
      .map(clone);
  }

  async exportPortableState(): Promise<PortableCalendarState> {
    return {
      calendarYears: [...this.settings.values()].map(clone),
      events: [...this.events.values()].map(clone),
      organizers: [],
      audit: this.auditEntries.map(clone),
    };
  }

  async replacePortableState(state: PortableCalendarState): Promise<{ backupReference: string | null }> {
    const previous = await this.exportPortableState();
    try {
      this.events.clear();
      this.settings.clear();
      this.auditEntries.length = 0;
      for (const event of state.events) this.events.set(event.id, clone(event));
      for (const settings of state.calendarYears) this.settings.set(settings.year, clone(settings));
      this.auditEntries.push(...state.audit.map(clone));
    } catch (error) {
      this.events.clear();
      this.settings.clear();
      this.auditEntries.length = 0;
      for (const event of previous.events) this.events.set(event.id, clone(event));
      for (const settings of previous.calendarYears) this.settings.set(settings.year, clone(settings));
      this.auditEntries.push(...previous.audit.map(clone));
      throw error;
    }
    return { backupReference: 'memory://pre-import' };
  }

  private recordAudit(
    entityType: AuditEntry['entityType'],
    entityId: string,
    actor: string,
    timestamp: string,
    action: AuditEntry['action'],
    baseRevision: number | null,
    resultingRevision: number,
    payloadSummary: string,
  ): void {
    this.auditEntries.push({
      auditId: this.auditIdFactory(),
      timestamp,
      actor,
      entityType,
      entityId,
      action,
      baseRevision,
      resultingRevision,
      payloadSummary,
    });
  }
}
