import type { AuditEntry } from './audit';
import { MAX_CALENDAR_YEAR, MIN_CALENDAR_YEAR } from './calendar';
import type { CalendarEvent, CalendarEventData, CalendarSettings } from './types';
import { validateEvent } from './validation';

export const PORTABLE_FORMAT = 'calendar-studio-export' as const;
export const PORTABLE_FORMAT_VERSION = 1 as const;

export interface PortableCalendarState {
  calendarYears: CalendarSettings[];
  events: CalendarEvent[];
  organizers: never[];
  audit: AuditEntry[];
}

export interface CalendarStudioExportPackage extends PortableCalendarState {
  format: typeof PORTABLE_FORMAT;
  formatVersion: typeof PORTABLE_FORMAT_VERSION;
  exportedAt: string;
  checksum: string;
}

export interface PortabilityValidationResult {
  valid: boolean;
  errors: string[];
}

export interface PortableCalendarStore {
  exportPortableState(): Promise<PortableCalendarState>;
  replacePortableState(state: PortableCalendarState): Promise<{ backupReference: string | null }>;
}

export interface CalendarPortability {
  exportPackage(exportedAt?: string): Promise<CalendarStudioExportPackage>;
  validateImport(value: unknown): Promise<PortabilityValidationResult>;
  importPackage(value: unknown): Promise<{ backupReference: string | null }>;
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
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 WebCrypto is unavailable in this runtime.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `sha256:${bytesToHex(digest)}`;
}

function withoutChecksum(pkg: Omit<CalendarStudioExportPackage, 'checksum'>): JsonValue {
  return pkg as unknown as JsonValue;
}

export async function calculatePackageChecksum(pkg: Omit<CalendarStudioExportPackage, 'checksum'>): Promise<string> {
  return sha256(canonicalize(withoutChecksum(pkg)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): boolean { return value === null || typeof value === 'string'; }
function isNullableInteger(value: unknown): boolean { return value === null || Number.isInteger(value); }
function isCalendarYear(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= MIN_CALENDAR_YEAR && Number(value) <= MAX_CALENDAR_YEAR; }

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function parseTimestamp(value: string): number | null {
  if (!ISO_TIMESTAMP_PATTERN.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateTimestampField(value: string, label: string, errors: string[]): number | null {
  const parsed = parseTimestamp(value);
  if (parsed === null) errors.push(`${label} должен содержать корректный ISO-8601 timestamp.`);
  return parsed;
}

function validateNullableTimestampField(value: string | null, label: string, errors: string[]): number | null {
  if (value === null) return null;
  return validateTimestampField(value, label, errors);
}

function validatePairedNullableStrings(left: string | null, right: string | null, label: string, errors: string[]): void {
  if ((left === null) !== (right === null)) errors.push(`${label} должны быть либо оба заполнены, либо оба null.`);
}

function isEventDataShape(value: unknown): value is CalendarEventData {
  if (!isRecord(value) || !isRecord(value.registration) || !Array.isArray(value.shifts)) return false;
  const stringFields = ['title','organizerName','kind','discipline','series','source','status','venue','venueScope','notes','stickerColor'] as const;
  if (stringFields.some((field) => typeof value[field] !== 'string')) return false;
  if (!['match','utm','build'].includes(String(value.kind)) || !['pistol','carbine','shotgun','airgun','multigun','other'].includes(String(value.discipline)) ||
      !['regular','trf','allRussian','departmental','spbCup','other'].includes(String(value.series)) || !['manual','ekp'].includes(String(value.source)) ||
      !['draft','tentative','confirmed'].includes(String(value.status)) || !['nevsky','spb','otherRegion','unspecified'].includes(String(value.venueScope))) return false;
  const nullableStrings = ['competitionStatus','competitionRegion','competitionPhase','startDate','endDate','parentEventId','ekpLevel','coverPath'] as const;
  if (nullableStrings.some((field) => !isNullableString(value[field]))) return false;
  if (!isNullableInteger(value.competitionStageNumber) || !isNullableInteger(value.ekpStageNumber) || !isNullableInteger(value.plannedExerciseCount) || !isNullableInteger(value.plannedSquadCount)) return false;
  if (typeof value.isPrimary !== 'boolean' || !Number.isInteger(value.daylightBufferMinutes)) return false;
  const registration = value.registration;
  if (!['free','scheduled'].includes(String(registration.mode)) || !isNullableString(registration.opensAt) || !isNullableString(registration.closesAt) || typeof registration.priorityOneAlerts !== 'boolean') return false;
  return value.shifts.every((shift) => isRecord(shift) && typeof shift.id === 'string' && typeof shift.name === 'string' && (shift.kind === 'day' || shift.kind === 'night') && typeof shift.startsAt === 'string' && typeof shift.endsAt === 'string');
}

function validateEventShape(value: unknown, errors: string[], index: number): value is CalendarEvent {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !isCalendarYear(value.calendarYear) || !Number.isInteger(value.revision) || Number(value.revision) < 1 ||
      typeof value.createdAt !== 'string' || typeof value.createdBy !== 'string' || typeof value.updatedAt !== 'string' || typeof value.updatedBy !== 'string' || !isNullableString(value.archivedAt) || !isEventDataShape(value)) {
    errors.push(`events[${index}] имеет некорректную структуру.`);
    return false;
  }
  const event = value as unknown as CalendarEvent;
  const issues = validateEvent(event, { year: event.calendarYear, eventId: event.id });
  for (const issue of issues.filter((candidate) => candidate.severity === 'error')) errors.push(`events[${index}]: ${issue.message}`);
  return true;
}

function validateSettingsShape(value: unknown, errors: string[], index: number): value is CalendarSettings {
  if (!isRecord(value) || !isCalendarYear(value.year) || (value.mode !== 'planning' && value.mode !== 'approved') || !Number.isInteger(value.revision) || Number(value.revision) < 1 ||
      !isNullableString(value.approvedAt) || !isNullableString(value.approvedBy) || !isNullableString(value.reopenedAt) || !isNullableString(value.reopenedBy)) {
    errors.push(`calendarYears[${index}] имеет некорректную структуру.`);
    return false;
  }
  return true;
}

function validateAuditShape(value: unknown, errors: string[], index: number): value is AuditEntry {
  if (!isRecord(value) || typeof value.auditId !== 'string' || !value.auditId || typeof value.timestamp !== 'string' || typeof value.actor !== 'string' ||
      (value.entityType !== 'event' && value.entityType !== 'calendar_settings') || typeof value.entityId !== 'string' ||
      !['create','update','archive','restore','approve','reopen'].includes(String(value.action)) ||
      !(value.baseRevision === null || Number.isInteger(value.baseRevision)) || !Number.isInteger(value.resultingRevision) || Number(value.resultingRevision) < 1 || typeof value.payloadSummary !== 'string') {
    errors.push(`audit[${index}] имеет некорректную структуру.`);
    return false;
  }
  return true;
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  }
  return [...duplicates];
}

function validateAuditRevisionTransition(entry: AuditEntry, errors: string[], index: number): void {
  if (entry.action === 'create') {
    if (entry.baseRevision !== null || entry.resultingRevision !== 1) {
      errors.push(`audit[${index}] create должен переходить из baseRevision=null в resultingRevision=1.`);
    }
    return;
  }

  if (entry.baseRevision === null || entry.baseRevision < 1 || entry.resultingRevision !== entry.baseRevision + 1) {
    errors.push(`audit[${index}] содержит некорректный переход ревизии ${String(entry.baseRevision)} -> ${entry.resultingRevision}; ожидается ровно +1.`);
  }
}


function calendarSettingsModeFromAudit(entry: AuditEntry, errors: string[], index: number): CalendarSettings['mode'] | null {
  const mode = entry.payloadSummary === 'mode:planning' ? 'planning' : entry.payloadSummary === 'mode:approved' ? 'approved' : null;
  if (mode === null) {
    errors.push(`audit[${index}] для настроек календаря должен содержать payloadSummary mode:planning или mode:approved.`);
    return null;
  }
  if (entry.action === 'approve' && mode !== 'approved') errors.push(`audit[${index}] approve должен завершаться режимом approved.`);
  if (entry.action === 'reopen' && mode !== 'planning') errors.push(`audit[${index}] reopen должен завершаться режимом planning.`);
  return mode;
}

function validateCalendarSettingsAuditConsistency(
  settings: CalendarSettings,
  entries: readonly { entry: AuditEntry; index: number; timestampMs: number | null }[],
  errors: string[],
): void {
  const ordered = [...entries].sort((a, b) => a.entry.resultingRevision - b.entry.resultingRevision);
  const modeByRevision = new Map<number, CalendarSettings['mode']>();

  for (const item of ordered) {
    const mode = calendarSettingsModeFromAudit(item.entry, errors, item.index);
    if (mode !== null) modeByRevision.set(item.entry.resultingRevision, mode);

    if (item.entry.action === 'approve') {
      if (settings.approvedAt === null || settings.approvedBy === null) {
        errors.push(`audit[${item.index}] содержит approve, но настройки ${settings.year} не сохраняют approval metadata.`);
      } else {
        const approvedAtMs = parseTimestamp(settings.approvedAt);
        if (item.timestampMs !== null && approvedAtMs !== null && item.timestampMs > approvedAtMs) {
          errors.push(`audit[${item.index}] approve новее canonical approvedAt для календаря ${settings.year}.`);
        }
        if (item.timestampMs !== null && approvedAtMs !== null && item.timestampMs === approvedAtMs && item.entry.actor !== settings.approvedBy) {
          errors.push(`audit[${item.index}] approve actor не совпадает с canonical approvedBy для календаря ${settings.year}.`);
        }
      }
    }

    if (item.entry.action === 'reopen') {
      if (settings.reopenedAt === null || settings.reopenedBy === null) {
        errors.push(`audit[${item.index}] содержит reopen, но настройки ${settings.year} не сохраняют reopen metadata.`);
      } else {
        const reopenedAtMs = parseTimestamp(settings.reopenedAt);
        if (item.timestampMs !== null && reopenedAtMs !== null && item.timestampMs > reopenedAtMs) {
          errors.push(`audit[${item.index}] reopen новее canonical reopenedAt для календаря ${settings.year}.`);
        }
        if (item.timestampMs !== null && reopenedAtMs !== null && item.timestampMs === reopenedAtMs && item.entry.actor !== settings.reopenedBy) {
          errors.push(`audit[${item.index}] reopen actor не совпадает с canonical reopenedBy для календаря ${settings.year}.`);
        }
      }
    }
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (current.entry.resultingRevision !== previous.entry.resultingRevision + 1) continue;
    const previousMode = modeByRevision.get(previous.entry.resultingRevision);
    const currentMode = modeByRevision.get(current.entry.resultingRevision);
    if (!previousMode || !currentMode) continue;

    const valid = current.entry.action === 'approve'
      ? previousMode === 'planning' && currentMode === 'approved'
      : current.entry.action === 'reopen'
        ? previousMode === 'approved' && currentMode === 'planning'
        : current.entry.action === 'update'
          ? previousMode === currentMode
          : true;
    if (!valid) {
      errors.push(`Аудит calendar_settings:${settings.year} содержит невозможный переход ${previousMode} -> ${currentMode} действием ${current.entry.action} на ревизии ${current.entry.resultingRevision}.`);
    }
  }

  const currentEntry = ordered.find((item) => item.entry.resultingRevision === settings.revision);
  if (currentEntry) {
    const currentMode = modeByRevision.get(settings.revision);
    if (currentMode && currentMode !== settings.mode) {
      errors.push(`Аудит текущей ревизии настроек ${settings.year} заканчивается режимом ${currentMode}, но canonical mode=${settings.mode}.`);
    }
    if (currentEntry.entry.action === 'approve' && (currentEntry.entry.timestamp !== settings.approvedAt || currentEntry.entry.actor !== settings.approvedBy)) {
      errors.push(`Текущий approve audit настроек ${settings.year} должен совпадать с canonical approvedAt/approvedBy.`);
    }
    if (currentEntry.entry.action === 'reopen' && (currentEntry.entry.timestamp !== settings.reopenedAt || currentEntry.entry.actor !== settings.reopenedBy)) {
      errors.push(`Текущий reopen audit настроек ${settings.year} должен совпадать с canonical reopenedAt/reopenedBy.`);
    }
  }
}

export async function validatePortablePackage(value: unknown): Promise<PortabilityValidationResult> {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ['Файл импорта должен содержать JSON-объект.'] };
  if (value.format !== PORTABLE_FORMAT) errors.push(`Неизвестный формат: ожидался ${PORTABLE_FORMAT}.`);
  if (value.formatVersion !== PORTABLE_FORMAT_VERSION) errors.push(`Неподдерживаемая версия формата: ${String(value.formatVersion)}.`);
  if (typeof value.exportedAt !== 'string' || !value.exportedAt) errors.push('Отсутствует exportedAt.');
  if (typeof value.checksum !== 'string' || !value.checksum.startsWith('sha256:')) errors.push('Отсутствует корректная SHA-256 checksum.');
  if (!Array.isArray(value.calendarYears)) errors.push('calendarYears должен быть массивом.');
  if (!Array.isArray(value.events)) errors.push('events должен быть массивом.');
  if (!Array.isArray(value.organizers)) errors.push('organizers должен быть массивом.');
  if (!Array.isArray(value.audit)) errors.push('audit должен быть массивом.');
  if (errors.length) return { valid: false, errors };

  const calendarYears = value.calendarYears as unknown[];
  const events = value.events as unknown[];
  const organizers = value.organizers as unknown[];
  const audit = value.audit as unknown[];
  if (organizers.length !== 0) errors.push('Формат v1 пока не поддерживает импорт справочника организаторов; ожидается пустой массив organizers.');

  const exportedAtMs = typeof value.exportedAt === 'string' ? validateTimestampField(value.exportedAt, 'exportedAt', errors) : null;

  const validSettings = calendarYears.map((item, index) => validateSettingsShape(item, errors, index));
  const validEvents = events.map((item, index) => validateEventShape(item, errors, index));
  const validAudit = audit.map((item, index) => validateAuditShape(item, errors, index));
  if (validSettings.every(Boolean)) {
    const duplicates = duplicateValues((calendarYears as CalendarSettings[]).map((item) => String(item.year)));
    if (duplicates.length) errors.push(`Повторяющиеся годы календаря: ${duplicates.join(', ')}.`);
  }
  if (validEvents.every(Boolean)) {
    const typedEvents = events as CalendarEvent[];
    const duplicates = duplicateValues(typedEvents.map((item) => item.id));
    if (duplicates.length) errors.push(`Повторяющиеся ID мероприятий: ${duplicates.join(', ')}.`);
    const ids = new Set(typedEvents.map((item) => item.id));
    for (const event of typedEvents) if (event.parentEventId && !ids.has(event.parentEventId)) errors.push(`Мероприятие ${event.id} ссылается на отсутствующего родителя ${event.parentEventId}.`);
    for (const event of typedEvents) {
      const issues = validateEvent(event, { year: event.calendarYear, eventId: event.id, events: typedEvents });
      if (issues.some((issue) => issue.code === 'parent_cycle' || issue.code === 'parent_self_cycle')) errors.push(`Мероприятие ${event.id}: циклическая родительская связь.`);
    }
    for (const [index, event] of typedEvents.entries()) {
      const createdAtMs = validateTimestampField(event.createdAt, `events[${index}].createdAt`, errors);
      const updatedAtMs = validateTimestampField(event.updatedAt, `events[${index}].updatedAt`, errors);
      const archivedAtMs = validateNullableTimestampField(event.archivedAt, `events[${index}].archivedAt`, errors);
      if (createdAtMs !== null && updatedAtMs !== null && createdAtMs > updatedAtMs) errors.push(`events[${index}] создан позже своего последнего изменения.`);
      if (archivedAtMs !== null && updatedAtMs !== null && archivedAtMs > updatedAtMs) errors.push(`events[${index}].archivedAt не может быть позже updatedAt.`);
      if (exportedAtMs !== null && updatedAtMs !== null && updatedAtMs > exportedAtMs) errors.push(`events[${index}].updatedAt не может быть позже exportedAt.`);
      if (exportedAtMs !== null && archivedAtMs !== null && archivedAtMs > exportedAtMs) errors.push(`events[${index}].archivedAt не может быть позже exportedAt.`);
    }
  }
  if (validSettings.every(Boolean)) {
    for (const [index, settings] of (calendarYears as CalendarSettings[]).entries()) {
      validatePairedNullableStrings(settings.approvedAt, settings.approvedBy, `calendarYears[${index}] approvedAt/approvedBy`, errors);
      validatePairedNullableStrings(settings.reopenedAt, settings.reopenedBy, `calendarYears[${index}] reopenedAt/reopenedBy`, errors);
      const approvedAtMs = validateNullableTimestampField(settings.approvedAt, `calendarYears[${index}].approvedAt`, errors);
      const reopenedAtMs = validateNullableTimestampField(settings.reopenedAt, `calendarYears[${index}].reopenedAt`, errors);
      if (settings.mode === 'approved' && settings.approvedAt === null) errors.push(`calendarYears[${index}] в режиме approved должен содержать approvedAt/approvedBy.`);
      if (settings.reopenedAt !== null && settings.approvedAt === null) errors.push(`calendarYears[${index}] не может содержать reopen без предыдущего approve.`);
      if (settings.mode === 'planning' && settings.approvedAt !== null && settings.reopenedAt === null) errors.push(`calendarYears[${index}] не может быть в planning после approve без reopen metadata.`);
      if (approvedAtMs !== null && reopenedAtMs !== null && settings.mode === 'approved' && approvedAtMs < reopenedAtMs) errors.push(`calendarYears[${index}] в режиме approved должен иметь последнее approve не раньше reopen.`);
      if (approvedAtMs !== null && reopenedAtMs !== null && settings.mode === 'planning' && reopenedAtMs < approvedAtMs) errors.push(`calendarYears[${index}] в режиме planning должен иметь последнее reopen не раньше approve.`);
      if (exportedAtMs !== null && approvedAtMs !== null && approvedAtMs > exportedAtMs) errors.push(`calendarYears[${index}].approvedAt не может быть позже exportedAt.`);
      if (exportedAtMs !== null && reopenedAtMs !== null && reopenedAtMs > exportedAtMs) errors.push(`calendarYears[${index}].reopenedAt не может быть позже exportedAt.`);
    }
  }
  if (validAudit.every(Boolean)) {
    const typedAudit = audit as AuditEntry[];
    const duplicates = duplicateValues(typedAudit.map((item) => item.auditId));
    if (duplicates.length) errors.push(`Повторяющиеся auditId: ${duplicates.join(', ')}.`);
    for (const [index, entry] of typedAudit.entries()) validateAuditRevisionTransition(entry, errors, index);

    const duplicateEntityRevisions = duplicateValues(typedAudit.map((entry) => `${entry.entityType}:${entry.entityId}:${entry.resultingRevision}`));
    if (duplicateEntityRevisions.length) errors.push(`Повторяющиеся результирующие ревизии в аудите: ${duplicateEntityRevisions.join(', ')}.`);

    const timestampedAudit = typedAudit.map((entry, index) => ({ entry, index, timestampMs: validateTimestampField(entry.timestamp, `audit[${index}].timestamp`, errors) }));
    for (const item of timestampedAudit) {
      if (exportedAtMs !== null && item.timestampMs !== null && item.timestampMs > exportedAtMs) errors.push(`audit[${item.index}].timestamp не может быть позже exportedAt.`);
    }
    const auditByEntity = new Map<string, typeof timestampedAudit>();
    for (const item of timestampedAudit) {
      const key = `${item.entry.entityType}:${item.entry.entityId}`;
      const bucket = auditByEntity.get(key) ?? [];
      bucket.push(item);
      auditByEntity.set(key, bucket);
    }
    for (const [key, entries] of auditByEntity) {
      const ordered = [...entries].sort((a, b) => a.entry.resultingRevision - b.entry.resultingRevision);
      for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1]!;
        const current = ordered[index]!;
        if (previous.timestampMs !== null && current.timestampMs !== null && previous.timestampMs > current.timestampMs) {
          errors.push(`Аудит ${key} нарушает временной порядок ревизий ${previous.entry.resultingRevision} -> ${current.entry.resultingRevision}.`);
        }
      }
    }

    if (validEvents.every(Boolean) && validSettings.every(Boolean)) {
      const eventById = new Map((events as CalendarEvent[]).map((event) => [event.id, event]));
      const settingsByYear = new Map((calendarYears as CalendarSettings[]).map((settings) => [String(settings.year), settings]));
      for (const [index, entry] of typedAudit.entries()) {
        if (entry.entityType === 'event') {
          const event = eventById.get(entry.entityId);
          if (!event) {
            errors.push(`audit[${index}] ссылается на отсутствующее мероприятие ${entry.entityId}.`);
            continue;
          }
          if (!['create', 'update', 'archive', 'restore'].includes(entry.action)) {
            errors.push(`audit[${index}] содержит действие ${entry.action}, несовместимое с мероприятием.`);
          }
          if (entry.resultingRevision > event.revision) {
            errors.push(`audit[${index}] содержит ревизию ${entry.resultingRevision} новее текущей ревизии мероприятия ${event.revision}.`);
          }
          if (entry.resultingRevision === event.revision && parseTimestamp(entry.timestamp) !== null && parseTimestamp(event.updatedAt) !== null && parseTimestamp(entry.timestamp) !== parseTimestamp(event.updatedAt)) {
            errors.push(`audit[${index}] для текущей ревизии мероприятия ${event.id} должен совпадать по timestamp с updatedAt.`);
          }
        } else {
          const settings = settingsByYear.get(entry.entityId);
          if (!settings) {
            errors.push(`audit[${index}] ссылается на отсутствующие настройки календаря ${entry.entityId}.`);
            continue;
          }
          if (!['update', 'approve', 'reopen'].includes(entry.action)) {
            errors.push(`audit[${index}] содержит действие ${entry.action}, несовместимое с настройками календаря.`);
          }
          if (entry.resultingRevision > settings.revision) {
            errors.push(`audit[${index}] содержит ревизию ${entry.resultingRevision} новее текущей ревизии настроек ${settings.revision}.`);
          }
        }
      }

      for (const settings of calendarYears as CalendarSettings[]) {
        const settingsAudit = timestampedAudit.filter((item) => item.entry.entityType === 'calendar_settings' && item.entry.entityId === String(settings.year));
        validateCalendarSettingsAuditConsistency(settings, settingsAudit, errors);
      }
    }
  }

  if (!errors.length) {
    const pkg = value as unknown as CalendarStudioExportPackage;
    const { checksum, ...unsigned } = pkg;
    const expected = await calculatePackageChecksum(unsigned);
    if (checksum !== expected) errors.push('Checksum не совпадает: файл изменён или повреждён.');
  }
  return { valid: errors.length === 0, errors };
}

export class CalendarPortabilityService implements CalendarPortability {
  constructor(private readonly store: PortableCalendarStore) {}

  async exportPackage(exportedAt = new Date().toISOString()): Promise<CalendarStudioExportPackage> {
    const state = await this.store.exportPortableState();
    const unsigned: Omit<CalendarStudioExportPackage, 'checksum'> = {
      format: PORTABLE_FORMAT,
      formatVersion: PORTABLE_FORMAT_VERSION,
      exportedAt,
      calendarYears: structuredClone(state.calendarYears).sort((a, b) => a.year - b.year),
      events: structuredClone(state.events).sort((a, b) => a.id.localeCompare(b.id)),
      organizers: [],
      audit: structuredClone(state.audit).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.auditId.localeCompare(b.auditId)),
    };
    return { ...unsigned, checksum: await calculatePackageChecksum(unsigned) };
  }

  validateImport(value: unknown): Promise<PortabilityValidationResult> {
    return validatePortablePackage(value);
  }

  async importPackage(value: unknown): Promise<{ backupReference: string | null }> {
    const validation = await validatePortablePackage(value);
    if (!validation.valid) throw new Error(`Импорт отклонён: ${validation.errors.join(' ')}`);
    const pkg = value as CalendarStudioExportPackage;
    return this.store.replacePortableState({
      calendarYears: structuredClone(pkg.calendarYears),
      events: structuredClone(pkg.events),
      organizers: [],
      audit: structuredClone(pkg.audit),
    });
  }
}
