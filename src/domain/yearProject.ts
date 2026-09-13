import { MAX_CALENDAR_YEAR, MIN_CALENDAR_YEAR } from './calendar';
import type { AuditEntry } from './audit';
import type { CalendarEvent, CalendarEventData, CalendarSettings } from './types';
import { validateEvent } from './validation';
import type { PortableCalendarStore } from './portability';

export const YEAR_PROJECT_FORMAT = 'calendar-studio-year-project' as const;
export const YEAR_PROJECT_FORMAT_VERSION = 2 as const;

export interface CalendarYearProjectTemplate {
  title: string;
  data: CalendarEventData;
}

export interface CalendarYearProject {
  format: typeof YEAR_PROJECT_FORMAT;
  formatVersion: typeof YEAR_PROJECT_FORMAT_VERSION;
  year: number;
  exportedAt: string;
  events: CalendarEvent[];
  settings: CalendarSettings;
  audit: AuditEntry[];
  templates: CalendarYearProjectTemplate[];
  checksum: string;
}

export interface YearProjectState {
  year: number;
  events: CalendarEvent[];
  settings: CalendarSettings;
  audit: AuditEntry[];
}

export interface YearProjectStore extends PortableCalendarStore {
  replaceYearProjectState(state: YearProjectState): Promise<{ backupReference: string | null }>;
}

export interface CalendarYearProjects {
  exportProject(year: number, exportedAt?: string, templates?: readonly CalendarYearProjectTemplate[]): Promise<CalendarYearProject>;
  validateImport(value: unknown): Promise<YearProjectValidationResult>;
  importProject(value: unknown): Promise<{ backupReference: string | null; templates: CalendarYearProjectTemplate[] }>;
}

export interface YearProjectValidationResult {
  valid: boolean;
  errors: string[];
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key]!)}`).join(',')}}`;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 WebCrypto недоступен в этой среде.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `sha256:${bytesToHex(digest)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCalendarYear(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= MIN_CALENDAR_YEAR && Number(value) <= MAX_CALENDAR_YEAR;
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isEvent(value: unknown): value is CalendarEvent {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !isCalendarYear(value.calendarYear) || !Number.isInteger(value.revision) || Number(value.revision) < 1 ||
      typeof value.createdAt !== 'string' || typeof value.createdBy !== 'string' || typeof value.updatedAt !== 'string' || typeof value.updatedBy !== 'string' || !isNullableString(value.archivedAt)) return false;
  return true;
}

function isSettings(value: unknown): value is CalendarSettings {
  return isRecord(value) && isCalendarYear(value.year) && (value.mode === 'planning' || value.mode === 'approved') && Number.isInteger(value.revision) && Number(value.revision) >= 1 &&
    isNullableString(value.approvedAt) && isNullableString(value.approvedBy) && isNullableString(value.reopenedAt) && isNullableString(value.reopenedBy) &&
    Array.isArray(value.acceptedWarningKeys) && value.acceptedWarningKeys.every((key) => typeof key === 'string');
}

function isAuditEntry(value: unknown): value is AuditEntry {
  return isRecord(value) && typeof value.auditId === 'string' && !!value.auditId && typeof value.timestamp === 'string' && typeof value.actor === 'string' &&
    (value.entityType === 'event' || value.entityType === 'calendar_settings') && typeof value.entityId === 'string' &&
    ['create', 'update', 'archive', 'restore', 'approve', 'reopen'].includes(String(value.action)) &&
    (value.baseRevision === null || Number.isInteger(value.baseRevision)) && Number.isInteger(value.resultingRevision) && Number(value.resultingRevision) >= 1 && typeof value.payloadSummary === 'string';
}

function isTemplate(value: unknown, year: number): value is CalendarYearProjectTemplate {
  if (!isRecord(value) || typeof value.title !== 'string' || !value.title.trim() || !isRecord(value.data)) return false;
  const data = value.data as unknown as CalendarEventData;
  if (data.title !== value.title || data.kind !== 'match' || data.startDate !== null || data.endDate !== null || data.parentEventId !== null) return false;
  return !validateEvent(data, { year }).some((issue) => issue.severity === 'error');
}

export async function calculateYearProjectChecksum(project: Omit<CalendarYearProject, 'checksum'>): Promise<string> {
  return sha256(canonicalize(project as unknown as JsonValue));
}

export async function createYearProject(year: number, events: readonly CalendarEvent[], settings: CalendarSettings, audit: readonly AuditEntry[], exportedAt = new Date().toISOString(), templates: readonly CalendarYearProjectTemplate[] = []): Promise<CalendarYearProject> {
  if (!isCalendarYear(year)) throw new RangeError(`Недопустимый год проекта: ${year}.`);
  if (settings.year !== year) throw new Error('Настройки принадлежат другому году календаря.');
  if (events.some((event) => event.calendarYear !== year)) throw new Error('В проект года попали мероприятия другого года.');
  if (templates.some((template) => !isTemplate(template, year))) throw new Error('В проект года попал некорректный шаблон матча.');
  const unsigned: Omit<CalendarYearProject, 'checksum'> = {
    format: YEAR_PROJECT_FORMAT,
    formatVersion: YEAR_PROJECT_FORMAT_VERSION,
    year,
    exportedAt,
    events: [...structuredClone(events)].sort((left, right) => (left.startDate ?? '9999-12-31').localeCompare(right.startDate ?? '9999-12-31') || left.title.localeCompare(right.title, 'ru') || left.id.localeCompare(right.id)),
    settings: { ...structuredClone(settings), acceptedWarningKeys: [...new Set(settings.acceptedWarningKeys)].sort() },
    audit: [...structuredClone(audit)].sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.auditId.localeCompare(right.auditId)),
    templates: [...structuredClone(templates)].sort((left, right) => left.title.localeCompare(right.title, 'ru')),
  };
  return { ...unsigned, checksum: await calculateYearProjectChecksum(unsigned) };
}

export async function validateYearProject(value: unknown): Promise<YearProjectValidationResult> {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ['Файл проекта должен содержать JSON-объект.'] };
  if (value.format !== YEAR_PROJECT_FORMAT) errors.push(`Неизвестный формат проекта: ожидался ${YEAR_PROJECT_FORMAT}.`);
  if (value.formatVersion !== 1 && value.formatVersion !== YEAR_PROJECT_FORMAT_VERSION) errors.push(`Неподдерживаемая версия проекта: ${String(value.formatVersion)}.`);
  if (!isCalendarYear(value.year)) errors.push('В проекте указан недопустимый год.');
  if (typeof value.exportedAt !== 'string' || !value.exportedAt) errors.push('В проекте отсутствует дата экспорта.');
  if (typeof value.checksum !== 'string' || !value.checksum.startsWith('sha256:')) errors.push('В проекте отсутствует контрольная сумма.');
  if (!Array.isArray(value.events)) errors.push('В проекте отсутствует массив мероприятий.');
  if (!isSettings(value.settings)) errors.push('В проекте некорректные настройки года.');
  if (!Array.isArray(value.audit)) errors.push('В проекте отсутствует журнал изменений.');
  if (value.formatVersion === YEAR_PROJECT_FORMAT_VERSION && !Array.isArray(value.templates)) errors.push('В проекте отсутствует массив шаблонов матчей.');
  if (errors.length) return { valid: false, errors };

  const year = value.year as number;
  const events = value.events as unknown[];
  const typedEvents: CalendarEvent[] = [];
  for (const [index, event] of events.entries()) {
    if (!isEvent(event)) { errors.push(`Мероприятие ${index + 1} имеет некорректную структуру.`); continue; }
    if (event.calendarYear !== year) errors.push(`Мероприятие «${event.title}» относится не к ${year} году.`);
    const issues = validateEvent(event, { year, eventId: event.id, events: events.filter(isEvent) });
    for (const issue of issues.filter((candidate) => candidate.severity === 'error')) errors.push(`Мероприятие «${event.title}»: ${issue.message}`);
    typedEvents.push(event);
  }
  const ids = new Set<string>();
  for (const event of typedEvents) {
    if (ids.has(event.id)) errors.push(`Повторяющийся ID мероприятия: ${event.id}.`);
    ids.add(event.id);
  }
  for (const event of typedEvents) if (event.parentEventId && !ids.has(event.parentEventId)) errors.push(`Мероприятие «${event.title}» ссылается на отсутствующего родителя.`);

  const settings = value.settings as CalendarSettings;
  if (settings.year !== year) errors.push('Настройки принадлежат другому году.');
  if (new Set(settings.acceptedWarningKeys).size !== settings.acceptedWarningKeys.length) errors.push('Список принятых предупреждений содержит повторы.');
  const templates = value.formatVersion === YEAR_PROJECT_FORMAT_VERSION ? value.templates as unknown[] : [];
  const templateTitles = new Set<string>();
  for (const [index, template] of templates.entries()) {
    if (!isTemplate(template, year)) { errors.push(`Шаблон матча ${index + 1} имеет некорректную структуру.`); continue; }
    const title = template.title.trim().toLocaleLowerCase('ru-RU');
    if (templateTitles.has(title)) errors.push(`Повторяющийся шаблон матча: ${template.title}.`);
    templateTitles.add(title);
  }
  const audit = value.audit as unknown[];
  const auditIds = new Set<string>();
  for (const [index, entry] of audit.entries()) {
    if (!isAuditEntry(entry)) { errors.push(`Запись журнала ${index + 1} имеет некорректную структуру.`); continue; }
    if (auditIds.has(entry.auditId)) errors.push(`Повторяющийся ID записи журнала: ${entry.auditId}.`);
    auditIds.add(entry.auditId);
    if (entry.entityType === 'event' && !ids.has(entry.entityId)) errors.push(`Запись журнала ${index + 1} ссылается на мероприятие вне проекта.`);
    if (entry.entityType === 'calendar_settings' && entry.entityId !== String(year)) errors.push(`Запись журнала ${index + 1} ссылается на настройки другого года.`);
  }

  if (!errors.length) {
    const project = value as unknown as CalendarYearProject;
    const { checksum, ...unsigned } = project;
    const expected = await calculateYearProjectChecksum(unsigned);
    if (checksum !== expected) errors.push('Контрольная сумма не совпадает: файл был изменён или повреждён.');
  }
  return { valid: errors.length === 0, errors };
}

/** Ensures parents are created before their children when a project is restored. */
export function orderYearProjectEvents(events: readonly CalendarEvent[]): CalendarEvent[] {
  const remaining = new Map(events.map((event) => [event.id, event]));
  const ordered: CalendarEvent[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((event) => !event.parentEventId || !remaining.has(event.parentEventId));
    if (ready.length === 0) return [...ordered, ...remaining.values()].sort((left, right) => left.id.localeCompare(right.id));
    ready.sort((left, right) => left.id.localeCompare(right.id));
    for (const event of ready) { ordered.push(event); remaining.delete(event.id); }
  }
  return ordered;
}

export class CalendarYearProjectService implements CalendarYearProjects {
  constructor(private readonly store: YearProjectStore) {}

  async exportProject(year: number, exportedAt = new Date().toISOString(), templates: readonly CalendarYearProjectTemplate[] = []): Promise<CalendarYearProject> {
    if (!isCalendarYear(year)) throw new RangeError(`Недопустимый год проекта: ${year}.`);
    const state = await this.store.exportPortableState();
    const events = state.events.filter((event) => event.calendarYear === year);
    const settings = state.calendarYears.find((item) => item.year === year) ?? {
      year,
      mode: 'planning' as const,
      revision: 1,
      approvedAt: null,
      approvedBy: null,
      reopenedAt: null,
      reopenedBy: null,
      acceptedWarningKeys: [],
    };
    const ids = new Set(events.map((event) => event.id));
    const audit = state.audit.filter((entry) => (entry.entityType === 'event' && ids.has(entry.entityId)) || (entry.entityType === 'calendar_settings' && entry.entityId === String(year)));
    return createYearProject(year, events, settings, audit, exportedAt, templates);
  }

  validateImport(value: unknown): Promise<YearProjectValidationResult> {
    return validateYearProject(value);
  }

  async importProject(value: unknown): Promise<{ backupReference: string | null; templates: CalendarYearProjectTemplate[] }> {
    const validation = await validateYearProject(value);
    if (!validation.valid) throw new Error(`Импорт проекта отклонён: ${validation.errors.join(' ')}`);
    const project = value as CalendarYearProject;
    const result = await this.store.replaceYearProjectState({
      year: project.year,
      events: structuredClone(project.events),
      settings: { ...structuredClone(project.settings), acceptedWarningKeys: [...new Set(project.settings.acceptedWarningKeys)].sort() },
      audit: structuredClone(project.audit),
    });
    return { ...result, templates: project.formatVersion === YEAR_PROJECT_FORMAT_VERSION ? structuredClone(project.templates) : [] };
  }
}
