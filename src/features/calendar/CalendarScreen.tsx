import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { buildMonth, MAX_CALENDAR_YEAR, MIN_CALENDAR_YEAR } from '../../domain/calendar';
import { buildAnnualOverview } from '../../domain/annualOverview';
import { buildArchivedLibrary, type ArchivedSort } from '../../domain/archivedLibrary';
import { buildUndatedLibrary, type UndatedSort } from '../../domain/undatedLibrary';
import { parseDateOnly, type DateOnly } from '../../domain/dateOnly';
import { DEFAULT_CALENDAR_LAYERS, isEventVisibleByDiscipline, isEventVisibleByLayers, type CalendarLayerKey, type CalendarLayerState, type DisciplineFilter } from '../../domain/calendarLayers';
import { buildMonthEventSegments, monthLaneCount } from '../../domain/monthLayout';
import { dateInRange, moveEventToDatePatch, moveEventToQueuePatch, normalizeDateRange, type DateRange } from '../../domain/planning';
import type { CalendarPortability } from '../../domain/portability';
import type { CalendarYearProjects } from '../../domain/yearProject';
import type { CalendarEvent, CalendarEventData, CalendarSettings, Discipline, EventSeries } from '../../domain/types';
import { hasBlockingIssues, validateEvent, type ValidationIssue } from '../../domain/validation';
import { calendarWarningKey, calculateWarnings } from '../../domain/warnings';
import { summarizeCalendarWarnings } from '../../domain/warningSummary';
import { RevisionConflictError } from '../../domain/revision';
import type { CalendarRepository } from '../../storage/CalendarRepository';
import type { WorkspaceManager, WorkspaceStatus } from '../../platform/WorkspaceManager';
import { EventEditor, type RelatedEventAvailability, type RelatedEventSelection } from './EventEditor';
import { createEventData, diffEventData, eventDataOf, normalizeStudioEventData } from './eventDraft';
import { calendarModeConfirmationMessage, permanentDeleteConfirmationMessage } from './confirmationState';
import { exportSpreadsheet, importSpreadsheet } from './eventSpreadsheet';

interface CalendarScreenProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  repository: CalendarRepository;
  portability: CalendarPortability;
  yearProjects: CalendarYearProjects;
  workspace: WorkspaceManager;
}

type EditorState = { event: CalendarEvent | null; initialData: CalendarEventData; readOnly: boolean } | null;
type EditorConflictState = { expectedRevision: number; actualRevision: number } | null;
type CountScope = 'all' | 'primary';
type CalendarView = 'month' | 'year';
type WorkspaceTab = 'calendar' | 'archive';
interface RangeMenuState { x: number; y: number; range: DateRange }

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const disciplineLabels: Record<CalendarEvent['discipline'], string> = { pistol: 'Пистолет', carbine: 'Карабин', shotgun: 'Ружьё', airgun: 'Пневматика', multigun: 'Мультиган', other: 'Другое' };
const statusLabels: Record<CalendarEvent['status'], string> = { draft: 'Черновик', tentative: 'Предварительно', confirmed: 'Подтверждено' };
const layerLabels: Record<CalendarLayerKey, string> = { ownPlan: 'Наш план', ekpSpb: 'ЕКП · СПб', ekpOther: 'ЕКП · другие регионы', trf: 'ТРФ', allRussian: 'Всероссийские', departmental: 'Ведомственные', airgun: 'Пневматика', utm: 'УТМ / тренировки', build: 'Застройка' };
const disciplineFilterLabels: Record<DisciplineFilter, string> = { all: 'Все дисциплины', pistol: 'Пистолет', carbine: 'Карабин', shotgun: 'Ружьё', airgun: 'Пневматика', multigun: 'Мультиган', other: 'Другое' };
const disciplineFilterOrder: DisciplineFilter[] = ['all', 'pistol', 'carbine', 'shotgun', 'airgun', 'multigun', 'other'];
const DRAG_EVENT_MIME = 'application/x-calendar-studio-event';
const basketDisciplines: Array<[Discipline, string]> = [['pistol', 'Пистолет'], ['carbine', 'Карабин'], ['shotgun', 'Ружьё'], ['airgun', 'Пневматика'], ['multigun', 'Мультиган']];

function basketDraft(title: string, discipline: Discipline, series: EventSeries): CalendarEventData {
  return normalizeStudioEventData({
    ...createEventData(), title, discipline, series, venue: 'ССК «Невский»', venueScope: 'nevsky', organizerName: 'ССК «Невский»',
    competitionRegion: 'Санкт-Петербург', stickerColor: series === 'trf' ? '#b63b36' : '#808080',
  });
}

function buildDefaultBasket(): CalendarEventData[] {
  const cityEvents = basketDisciplines.flatMap(([discipline, label]) => [
    basketDraft(`Кубок Санкт-Петербурга (${label})`, discipline, 'spbCup'),
    basketDraft(`Чемпионат Санкт-Петербурга (${label})`, discipline, 'regular'),
  ]);
  const trf = (title: string, count: number, discipline: Discipline) => Array.from({ length: count }, (_, index) => basketDraft(`${title} · №${index + 1}`, discipline, 'trf'));
  return [...cityEvents, ...trf('Охота на нежить', 3, 'multigun'), ...trf('Двудулочка', 2, 'shotgun'), ...trf('Идиси Сикубэ', 2, 'pistol'), ...trf('Пращуры против ящеров', 2, 'carbine')];
}

function relatedEventData(parentId: string, parent: CalendarEventData, type: 'regional' | 'physical'): CalendarEventData {
  const label = type === 'regional' ? 'Региональные соревнования' : 'Физкультурное мероприятие';
  return normalizeStudioEventData({
    ...parent,
    title: `${label} (${disciplineLabels[parent.discipline].toLowerCase()})`,
    competitionStatus: label,
    parentEventId: parentId,
    isPrimary: false,
    source: 'manual',
    status: 'draft',
    notes: parent.notes ? `${parent.notes}\nСоздано вместе с родительским мероприятием.` : 'Создано вместе с родительским мероприятием.',
    stickerColor: type === 'regional' ? '#767676' : '#8a7864',
  });
}

function calendarToday(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Moscow', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = Math.min(MAX_CALENDAR_YEAR, Math.max(MIN_CALENDAR_YEAR, read('year')));
  return { year, month: read('month'), day: read('day') };
}

function eventClasses(event: CalendarEvent): string {
  const classes = ['event-strip'];
  if (event.series === 'trf') classes.push('event-trf');
  if (event.source === 'ekp' && event.venueScope === 'nevsky') classes.push('event-ekp-nevsky');
  else if (event.source === 'ekp' && event.venueScope === 'otherRegion') classes.push('event-ekp-other');
  if (event.kind === 'build') classes.push('event-build');
  return classes.join(' ');
}

function shortEventLabel(event: CalendarEvent): string {
  const phase = event.competitionPhase?.trim();
  if (phase) return phase.length > 30 ? `${phase.slice(0, 29)}…` : phase;
  return event.title.length > 42 ? `${event.title.slice(0, 41)}…` : event.title;
}

function dateBelongsToYear(date: DateOnly, year: number): boolean {
  return parseDateOnly(date)?.year === year;
}

function dragEventId(event: ReactDragEvent<HTMLElement>): string | null {
  return event.dataTransfer.getData(DRAG_EVENT_MIME) || event.dataTransfer.getData('text/plain') || null;
}

function dateAtPointer(clientX: number, clientY: number): DateOnly | null {
  for (const cell of document.querySelectorAll<HTMLElement>('.day-cell[data-date]')) {
    const bounds = cell.getBoundingClientRect();
    if (clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom) return cell.dataset.date as DateOnly;
  }
  return null;
}

export function CalendarScreen({ theme, onToggleTheme, repository, portability, yearProjects, workspace }: CalendarScreenProps) {
  const initial = useMemo(calendarToday, []);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [archivedEvents, setArchivedEvents] = useState<CalendarEvent[]>([]);
  const [settings, setSettings] = useState<CalendarSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [editorConflict, setEditorConflict] = useState<EditorConflictState>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [countScope, setCountScope] = useState<CountScope>('all');
  const [calendarView, setCalendarView] = useState<CalendarView>('month');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('calendar');
  const [queueQuery, setQueueQuery] = useState('');
  const [queueSort, setQueueSort] = useState<UndatedSort>('updated-desc');
  const [archiveQuery, setArchiveQuery] = useState('');
  const [archiveSort, setArchiveSort] = useState<ArchivedSort>('archived-desc');
  const [layers, setLayers] = useState<CalendarLayerState>(() => ({ ...DEFAULT_CALENDAR_LAYERS }));
  const [disciplineFilter, setDisciplineFilter] = useState<DisciplineFilter>('all');
  const [selectionAnchor, setSelectionAnchor] = useState<DateOnly | null>(null);
  const [selectionFocus, setSelectionFocus] = useState<DateOnly | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [rangeMenu, setRangeMenu] = useState<RangeMenuState | null>(null);
  const [porting, setPorting] = useState(false);
  const [portabilityStatus, setPortabilityStatus] = useState<string | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus | null>(null);
  const [workspaceChanging, setWorkspaceChanging] = useState(false);
  const [draggedEventId, setDraggedEventId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [allYearEvents, nextSettings] = await Promise.all([repository.listEvents(year, true), repository.getCalendarSettings(year)]);
      setEvents(allYearEvents.filter((event) => event.archivedAt === null));
      setArchivedEvents(allYearEvents.filter((event) => event.archivedAt !== null));
      setSettings(nextSettings);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [repository, year]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    let active = true;
    workspace.getStatus()
      .then((status) => { if (active) setWorkspaceStatus(status); })
      .catch((error) => { if (active) setInteractionError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [workspace]);
  useEffect(() => {
    setSelectionAnchor(null);
    setSelectionFocus(null);
    setRangeMenu(null);
  }, [year, month]);
  useEffect(() => {
    if (!selecting) return;
    const stopSelecting = () => setSelecting(false);
    window.addEventListener('mouseup', stopSelecting);
    return () => window.removeEventListener('mouseup', stopSelecting);
  }, [selecting]);

  const model = useMemo(() => buildMonth(year, month), [year, month]);
  const selection = useMemo(() => selectionAnchor && selectionFocus ? normalizeDateRange(selectionAnchor, selectionFocus) : null, [selectionAnchor, selectionFocus]);
  const scopedEvents = useMemo(() => countScope === 'primary' ? events.filter((event) => event.isPrimary) : events, [countScope, events]);
  const visibleEvents = useMemo(() => scopedEvents.filter((event) => isEventVisibleByLayers(event, layers) && isEventVisibleByDiscipline(event, disciplineFilter)), [disciplineFilter, layers, scopedEvents]);
  const segments = useMemo(() => buildMonthEventSegments(model, visibleEvents), [model, visibleEvents]);
  const byId = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const undatedTotal = useMemo(() => visibleEvents.filter((event) => event.startDate === null && event.endDate === null).length, [visibleEvents]);
  const undated = useMemo(() => buildUndatedLibrary(visibleEvents, queueQuery, queueSort), [queueQuery, queueSort, visibleEvents]);
  const scopedUndatedCount = useMemo(() => scopedEvents.filter((event) => event.startDate === null && event.endDate === null).length, [scopedEvents]);
  const scopedDatedCount = scopedEvents.length - scopedUndatedCount;
  const primaryCount = useMemo(() => events.filter((event) => event.isPrimary).length, [events]);
  const archived = useMemo(() => buildArchivedLibrary(archivedEvents, archiveQuery, archiveSort), [archiveQuery, archiveSort, archivedEvents]);
  const warnings = useMemo(() => calculateWarnings(events, year), [events, year]);
  const acceptedWarningKeys = useMemo(() => new Set(settings?.acceptedWarningKeys ?? []), [settings?.acceptedWarningKeys]);
  const activeWarnings = useMemo(() => warnings.filter((warning) => !acceptedWarningKeys.has(calendarWarningKey(warning))), [acceptedWarningKeys, warnings]);
  const acceptedWarnings = useMemo(() => warnings.filter((warning) => acceptedWarningKeys.has(calendarWarningKey(warning))), [acceptedWarningKeys, warnings]);
  const warningSummary = useMemo(() => summarizeCalendarWarnings(activeWarnings), [activeWarnings]);
  const annualOverview = useMemo(() => buildAnnualOverview(year, visibleEvents, activeWarnings), [activeWarnings, visibleEvents, year]);
  const editable = settings?.mode === 'planning';
  const busy = loading || saving || porting || workspaceChanging;

  const exportPortable = async () => {
    if (busy) return;
    setPorting(true);
    setInteractionError(null);
    try {
      const pkg = await portability.exportPackage();
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `calendar-studio-export-v1-${pkg.exportedAt.slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setPortabilityStatus(`Экспорт подготовлен: ${pkg.events.length} мероприятий, ${pkg.audit.length} записей аудита.`);
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPorting(false);
    }
  };

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const exportYearProject = async () => {
    if (busy) return;
    setPorting(true);
    setInteractionError(null);
    try {
      const project = await yearProjects.exportProject(year);
      download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `calendar-studio-year-${year}.json`);
      setPortabilityStatus(`Проект ${year} года сохранён: ${project.events.length} мероприятий и ${project.audit.length} записей истории.`);
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPorting(false);
    }
  };

  const importYearProject = async (change: ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0];
    change.target.value = '';
    if (!file || busy) return;
    setPorting(true);
    setInteractionError(null);
    setPortabilityStatus(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const validation = await yearProjects.validateImport(parsed);
      if (!validation.valid) throw new Error(validation.errors.join(' '));
      const project = parsed as { year: number; events: unknown[] };
      if (!window.confirm(`Открыть проект ${project.year} года? Будут заменены только данные ${project.year} года (${project.events.length} мероприятий). Другие годы не затрагиваются, перед заменой создаётся резервная копия базы.`)) return;
      const result = await yearProjects.importProject(parsed);
      setEditor(null);
      setEditorConflict(null);
      setIssues([]);
      setMonth(1);
      setYear(project.year);
      if (project.year === year) await reload();
      setPortabilityStatus(result.backupReference ? `Проект ${project.year} года открыт. Резервная копия: ${result.backupReference}` : `Проект ${project.year} года открыт.`);
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPorting(false);
    }
  };

  const exportPublicPlan = async () => {
    if (busy) return;
    setPorting(true);
    setInteractionError(null);
    try {
      const { buildPublicPlanDocument } = await import('./publicPlanDocument');
      const document = await buildPublicPlanDocument(year, events);
      download(document, `project-calendar-plan-${year}.docx`);
      const count = events.filter((event) => event.archivedAt === null && event.kind === 'match' && event.startDate && event.endDate).length;
      setPortabilityStatus(`Word-план подготовлен: ${count} мероприятий без УТМ, застройки и архива.`);
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPorting(false);
    }
  };

  const exportEventSpreadsheet = () => {
    const csv = exportSpreadsheet(events);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `calendar-studio-template-${year}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setPortabilityStatus(events.length ? `Excel-совместимый шаблон выгружен: ${events.length} мероприятий.` : 'Пустой Excel-совместимый шаблон выгружен. Заполните строки и импортируйте файл обратно.');
  };

  const importEventSpreadsheet = async (change: ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0];
    change.target.value = '';
    if (!file || busy || !editable) return;
    setSaving(true);
    setInteractionError(null);
    try {
      const rows = importSpreadsheet(await file.text());
      if (rows.length === 0) throw new Error('В шаблоне нет заполненных строк для импорта.');
      const validation = rows.flatMap((row, index) => validateEvent(row.data, { year })
        .filter((issue) => issue.severity === 'error')
        .map((issue) => `Строка ${index + 2}: ${issue.message}`));
      if (validation.length > 0) throw new Error(validation.join(' '));
      const existingByTitle = new Map(events.map((event) => [event.title.trim().toLocaleLowerCase('ru-RU'), event.id]));
      const importedByTitle = new Map<string, string>();
      const timestamp = new Date().toISOString();
      for (const row of rows) {
        const id = crypto.randomUUID();
        importedByTitle.set(row.data.title.trim().toLocaleLowerCase('ru-RU'), id);
        await repository.saveEvent({ kind: 'create', id, calendarYear: year, actor: 'local-owner', timestamp, data: { ...row.data, parentEventId: null } }, null);
      }
      for (const row of rows) {
        if (!row.parentTitle) continue;
        const childId = importedByTitle.get(row.data.title.trim().toLocaleLowerCase('ru-RU'));
        const parentId = importedByTitle.get(row.parentTitle.trim().toLocaleLowerCase('ru-RU')) ?? existingByTitle.get(row.parentTitle.trim().toLocaleLowerCase('ru-RU'));
        if (!childId || !parentId) throw new Error(`Не найден родитель «${row.parentTitle}» для «${row.data.title}». Строки уже импортированы без связи.`);
        const child = await repository.getEvent(childId);
        if (child) await repository.saveEvent({ kind: 'update', id: childId, actor: 'local-owner', timestamp, changes: { parentEventId: parentId } }, child.revision);
      }
      await reload();
      setPortabilityStatus(`Импорт из Excel-совместимого шаблона завершён: ${rows.length} мероприятий добавлено в календарь.`);
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const importPortable = async (change: ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0];
    change.target.value = '';
    if (!file || busy || !editable) return;
    setPorting(true);
    setInteractionError(null);
    setPortabilityStatus(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const validation = await portability.validateImport(parsed);
      if (!validation.valid) throw new Error(`Импорт отклонён: ${validation.errors.join(' ')}`);
      if (!window.confirm('Импорт полностью заменит текущую локальную базу данными из пакета. Перед заменой будет создана резервная копия. Продолжить?')) return;
      const result = await portability.importPackage(parsed);
      setEditor(null);
      setEditorConflict(null);
      setIssues([]);
      await reload();
      setPortabilityStatus(result.backupReference ? `Импорт завершён. Резервная копия: ${result.backupReference}` : 'Импорт завершён; хранилище сообщило об успешной замене состояния.');
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPorting(false);
    }
  };

  const chooseWorkspace = async () => {
    if (busy) return;
    setWorkspaceChanging(true);
    setInteractionError(null);
    setPortabilityStatus(null);
    try {
      const status = await workspace.chooseAndSwitch();
      if (!status) return;
      setWorkspaceStatus(status);
      setEditor(null);
      setEditorConflict(null);
      setIssues([]);
      await reload();
      setPortabilityStatus(`Рабочая база: ${status.directoryPath}`);
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkspaceChanging(false);
    }
  };

  const moveMonth = (delta: number) => {
    let nextYear = year;
    let nextMonth = month + delta;
    if (nextMonth < 1) { nextMonth = 12; nextYear -= 1; }
    if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
    if (nextYear < MIN_CALENDAR_YEAR || nextYear > MAX_CALENDAR_YEAR) return;
    setYear(nextYear);
    setMonth(nextMonth);
  };

  const openEvent = (event: CalendarEvent) => {
    setIssues([]);
    setInteractionError(null);
    setEditorConflict(null);
    setEditor({ event, initialData: eventDataOf(event), readOnly: !editable });
  };

  const openNew = (range: DateRange | null = null) => {
    if (!editable) return;
    setIssues([]);
    setInteractionError(null);
    setEditorConflict(null);
    setEditor({ event: null, initialData: createEventData(range?.start ?? null, range?.end ?? null), readOnly: false });
    setRangeMenu(null);
  };

  const saveEditor = async (data: CalendarEventData, related: RelatedEventSelection) => {
    if (!editor || editor.readOnly) return;
    const studioData = normalizeStudioEventData(data);
    const nextIssues = validateEvent(studioData, { year, eventId: editor.event?.id, events });
    setIssues(nextIssues);
    if (hasBlockingIssues(nextIssues)) return;

    const existingChildren = editor.event ? events.filter((candidate) => candidate.parentEventId === editor.event?.id) : [];
    const addRegional = related.regional && !existingChildren.some((candidate) => candidate.competitionStatus === 'Региональные соревнования');
    const addPhysical = related.physical && !existingChildren.some((candidate) => candidate.competitionStatus === 'Физкультурное мероприятие');
    setSaving(true);
    try {
      const timestamp = new Date().toISOString();
      let parentId: string;
      if (editor.event) {
        const changes = diffEventData(editor.initialData, studioData);
        if (Object.keys(changes).length === 0 && !addRegional && !addPhysical) {
          setEditor(null);
          setIssues([]);
          return;
        }
        if (Object.keys(changes).length > 0) await repository.saveEvent({ kind: 'update', id: editor.event.id, actor: 'local-owner', timestamp, changes }, editor.event.revision);
        parentId = editor.event.id;
      } else {
        parentId = crypto.randomUUID();
        await repository.saveEvent({ kind: 'create', id: parentId, calendarYear: year, actor: 'local-owner', timestamp, data: studioData }, null);
      }
      if (addRegional) await repository.saveEvent({ kind: 'create', id: crypto.randomUUID(), calendarYear: year, actor: 'local-owner', timestamp, data: relatedEventData(parentId, studioData, 'regional') }, null);
      if (addPhysical) await repository.saveEvent({ kind: 'create', id: crypto.randomUUID(), calendarYear: year, actor: 'local-owner', timestamp, data: relatedEventData(parentId, studioData, 'physical') }, null);
      setEditor(null);
      setIssues([]);
      await reload();
    } catch (error) {
      if (error instanceof RevisionConflictError && editor?.event) {
        setEditorConflict({ expectedRevision: error.expectedRevision, actualRevision: error.actualRevision });
        setIssues([]);
      } else {
        setIssues([{ code: 'save_failed', severity: 'error', field: null, message: error instanceof Error ? error.message : String(error) }]);
      }
    } finally {
      setSaving(false);
    }
  };

  const createDefaultBasket = async () => {
    if (!editable || busy) return;
    const drafts = buildDefaultBasket();
    setSaving(true);
    setInteractionError(null);
    try {
      const timestamp = new Date().toISOString();
      for (const data of drafts) await repository.saveEvent({ kind: 'create', id: crypto.randomUUID(), calendarYear: year, actor: 'local-owner', timestamp, data }, null);
      await reload();
      setPortabilityStatus(`В корзину добавлен стандартный набор: ${drafts.length} мероприятий.`);
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const archiveEditor = async () => {
    if (!editor?.event || editor.readOnly) return;
    setSaving(true);
    try {
      await repository.archiveEvent(editor.event.id, editor.event.revision, 'local-owner', new Date().toISOString());
      setEditor(null);
      setIssues([]);
      await reload();
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        setEditorConflict({ expectedRevision: error.expectedRevision, actualRevision: error.actualRevision });
        setIssues([]);
      } else {
        setIssues([{ code: 'archive_failed', severity: 'error', field: null, message: error instanceof Error ? error.message : String(error) }]);
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteEventPermanently = async (event: CalendarEvent) => {
    if (!editable || busy) return;
    setSaving(true);
    setInteractionError(null);
    try {
      const deletedIds = await repository.deleteEvent(event.id, event.revision, 'local-owner', new Date().toISOString());
      setEditor(null);
      setEditorConflict(null);
      setIssues([]);
      await reload();
      setPortabilityStatus(deletedIds.length > 1 ? `Удалено навсегда: ${deletedIds.length} связанных записей.` : 'Мероприятие удалено навсегда.');
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        await reload();
        setInteractionError('Мероприятие уже изменилось. Календарь обновлён — повторите удаление на актуальной редакции.');
      } else {
        setInteractionError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteEditorEvent = async () => {
    if (!editor?.event || editor.readOnly) return;
    await deleteEventPermanently(editor.event);
  };

  const deleteArchivedEvent = async (event: CalendarEvent) => {
    if (!editable || busy) return;
    const relatedCount = [...events, ...archivedEvents].filter((candidate) => candidate.parentEventId === event.id).length;
    if (!window.confirm(permanentDeleteConfirmationMessage(event.title, false, relatedCount))) return;
    await deleteEventPermanently(event);
  };

  const refreshConflictEditor = async () => {
    if (!editor?.event) return;
    setSaving(true);
    setInteractionError(null);
    try {
      const latest = await repository.getEvent(editor.event.id);
      if (!latest || latest.archivedAt !== null) {
        setEditor(null);
        setEditorConflict(null);
        await reload();
        setInteractionError('Мероприятие больше недоступно для редактирования. Состояние календаря обновлено.');
        return;
      }
      setEditor({ event: latest, initialData: eventDataOf(latest), readOnly: !editable });
      setEditorConflict(null);
      setIssues([]);
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const restoreArchivedEvent = async (event: CalendarEvent) => {
    if (!editable || busy) return;
    setSaving(true);
    setInteractionError(null);
    try {
      await repository.restoreEvent(event.id, event.revision, 'local-owner', new Date().toISOString());
      await reload();
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        await reload();
        setInteractionError('Мероприятие уже изменилось. Календарь обновлён — повторите действие на актуальной редакции.');
      } else {
        setInteractionError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setSaving(false);
    }
  };

  const saveAcceptedWarningKeys = async (keys: string[]) => {
    if (!settings || busy) return;
    setSaving(true);
    setInteractionError(null);
    try {
      const next = await repository.saveCalendarSettings({
        year,
        mode: settings.mode,
        actor: 'local-owner',
        timestamp: new Date().toISOString(),
        acceptedWarningKeys: [...new Set(keys)].sort(),
      }, settings.revision);
      setSettings(next);
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        await reload();
        setInteractionError('Настройки календаря уже изменились. Состояние обновлено — повторите действие.');
      } else {
        setInteractionError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setSaving(false);
    }
  };

  const acceptWarning = async (warning: ReturnType<typeof calculateWarnings>[number]) => {
    await saveAcceptedWarningKeys([...(settings?.acceptedWarningKeys ?? []), calendarWarningKey(warning)]);
  };

  const restoreWarning = async (warning: ReturnType<typeof calculateWarnings>[number]) => {
    const key = calendarWarningKey(warning);
    await saveAcceptedWarningKeys((settings?.acceptedWarningKeys ?? []).filter((candidate) => candidate !== key));
  };

  const updateEventDates = async (event: CalendarEvent, changes: Pick<CalendarEventData, 'startDate' | 'endDate'>) => {
    if (!editable || busy) return;
    setSaving(true);
    setInteractionError(null);
    try {
      await repository.saveEvent({ kind: 'update', id: event.id, actor: 'local-owner', timestamp: new Date().toISOString(), changes }, event.revision);
      await reload();
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        await reload();
        setInteractionError('Мероприятие уже изменилось. Календарь обновлён — повторите перенос на актуальной редакции.');
      } else {
        setInteractionError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setSaving(false);
    }
  };

  const dropOnDate = (drop: ReactDragEvent<HTMLElement>, date: DateOnly) => {
    drop.preventDefault();
    if (!editable || busy || !dateBelongsToYear(date, year)) { endDrag(); return; }
    const id = dragEventId(drop) || draggedEventId;
    const event = id ? byId.get(id) : null;
    if (!event) { endDrag(); return; }
    try {
      void updateEventDates(event, moveEventToDatePatch(event, date));
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
    } finally { setDraggedEventId(null); setDragTarget(null); }
  };

  const dropOnQueue = (drop: ReactDragEvent<HTMLElement>) => {
    drop.preventDefault();
    if (!editable || busy) { endDrag(); return; }
    const id = dragEventId(drop) || draggedEventId;
    const event = id ? byId.get(id) : null;
    if (!event || (event.startDate === null && event.endDate === null)) { endDrag(); return; }
    void updateEventDates(event, moveEventToQueuePatch());
    endDrag();
  };

  const beginDrag = (drag: ReactDragEvent<HTMLElement>, event: CalendarEvent) => {
    if (!editable || busy) {
      drag.preventDefault();
      return;
    }
    drag.dataTransfer.effectAllowed = 'move';
    drag.dataTransfer.setData(DRAG_EVENT_MIME, event.id);
    drag.dataTransfer.setData('text/plain', event.id);
    setDraggedEventId(event.id);
  };

  const endDrag = () => { setDraggedEventId(null); setDragTarget(null); };

  const handleCalendarOverlayDrag = (drag: ReactDragEvent<HTMLElement>) => {
    if (!editable) return;
    const date = dateAtPointer(drag.clientX, drag.clientY);
    if (!date || !dateBelongsToYear(date, year)) return;
    drag.preventDefault();
    drag.dataTransfer.dropEffect = 'move';
    setDragTarget(`day:${date}`);
  };

  const dropOnCalendarOverlay = (drop: ReactDragEvent<HTMLElement>) => {
    const date = dateAtPointer(drop.clientX, drop.clientY);
    if (!date) { endDrag(); return; }
    dropOnDate(drop, date);
  };

  const beginSelection = (mouse: ReactMouseEvent<HTMLElement>, date: DateOnly) => {
    if (!editable || mouse.button !== 0 || !dateBelongsToYear(date, year)) return;
    setRangeMenu(null);
    setSelectionAnchor(date);
    setSelectionFocus(date);
    setSelecting(true);
  };

  const extendSelection = (date: DateOnly) => {
    if (!editable || !selecting || !selectionAnchor || !dateBelongsToYear(date, year)) return;
    setSelectionFocus(date);
  };

  const openRangeContext = (mouse: ReactMouseEvent<HTMLElement>, date: DateOnly) => {
    if (!editable || !dateBelongsToYear(date, year)) return;
    mouse.preventDefault();
    const activeRange = selection && dateInRange(date, selection) ? selection : normalizeDateRange(date, date);
    setSelectionAnchor(activeRange.start);
    setSelectionFocus(activeRange.end);
    const x = Math.max(8, Math.min(mouse.clientX, window.innerWidth - 250));
    const y = Math.max(8, Math.min(mouse.clientY, window.innerHeight - 100));
    setRangeMenu({ x, y, range: activeRange });
  };

  const keyOnDay = (key: ReactKeyboardEvent<HTMLElement>, date: DateOnly) => {
    if (!editable || !dateBelongsToYear(date, year)) return;
    if (key.key === 'Enter' || key.key === ' ') {
      key.preventDefault();
      openNew(normalizeDateRange(date, date));
    }
  };

  const navigateToDate = (date: DateOnly) => {
    const parts = parseDateOnly(date);
    if (!parts || parts.year !== year) return;
    setMonth(parts.month);
    setCalendarView('month');
    setSelectionAnchor(date);
    setSelectionFocus(date);
  };

  const changeCalendarMode = async () => {
    if (!settings || busy) return;
    if (!window.confirm(calendarModeConfirmationMessage(settings.mode, year))) return;
    setSaving(true);
    setInteractionError(null);
    try {
      const nextMode = settings.mode === 'planning' ? 'approved' : 'planning';
      await repository.saveCalendarSettings({ year, mode: nextMode, actor: 'local-owner', timestamp: new Date().toISOString(), acceptedWarningKeys: settings.acceptedWarningKeys }, settings.revision);
      setEditor(null);
      await reload();
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        await reload();
        setInteractionError('Режим календаря уже изменился в другой редакции. Состояние обновлено — повторите действие.');
      } else {
        setInteractionError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="app-shell" onClick={() => rangeMenu && setRangeMenu(null)}>
      <header className="topbar">
        <div>
          <p className="eyebrow">CALENDAR STUDIO</p>
          <h1>Календарь мероприятий</h1>
          <p className="subtitle">Отдельный локальный планировщик соревнований</p>
        </div>
        <div className="topbar-actions">
          <div className="segmented workspace-tabs" aria-label="Раздел Calendar Studio">
            <button type="button" className={activeTab === 'calendar' ? 'is-active' : ''} onClick={() => setActiveTab('calendar')}>Календарь</button>
            <button type="button" className={activeTab === 'archive' ? 'is-active' : ''} onClick={() => setActiveTab('archive')}>Архив{archivedEvents.length ? ` (${archivedEvents.length})` : ''}</button>
          </div>
          <button className="button button-secondary" type="button" onClick={() => void chooseWorkspace()} disabled={busy}>Папка данных</button>
          <button className="button button-secondary" type="button" onClick={() => void exportYearProject()} disabled={busy}>Сохранить проект года</button>
          <label className={`button button-secondary file-button ${busy ? 'is-disabled' : ''}`}>
            Открыть проект года
            <input className="file-input-hidden" type="file" accept="application/json,.json" onChange={(change: ChangeEvent<HTMLInputElement>) => void importYearProject(change)} disabled={busy} />
          </label>
          <button className="button button-secondary" type="button" onClick={() => void exportPublicPlan()} disabled={busy}>План Word</button>
          <button className="button button-secondary" type="button" onClick={() => void exportPortable()} disabled={busy}>Экспорт JSON</button>
          <label className={`button button-secondary file-button ${busy || !editable ? 'is-disabled' : ''}`} title={!editable ? 'Верните календарь в режим планирования перед импортом.' : undefined}>
            Импорт JSON
            <input className="file-input-hidden" type="file" accept="application/json,.json" onChange={(change: ChangeEvent<HTMLInputElement>) => void importPortable(change)} disabled={busy || !editable} />
          </label>
          <button className="button button-secondary" type="button" onClick={onToggleTheme}>Тема: {theme === 'dark' ? 'ночная' : 'дневная'}</button>
          <button className="button button-secondary" type="button" onClick={() => void changeCalendarMode()} disabled={!settings || busy}>
            {settings?.mode === 'approved' ? 'Вернуть в планирование' : 'Согласовать календарь'}
          </button>
          <button className="button button-primary" type="button" onClick={() => openNew()} disabled={!editable || busy}>Новое мероприятие</button>
        </div>
      </header>

      {loadError && <div className="error-banner" role="alert"><strong>Локальная база недоступна.</strong> {loadError}</div>}
      {interactionError && <div className="error-banner" role="alert"><strong>Действие не выполнено.</strong> {interactionError}</div>}
      {workspaceStatus?.warning && <div className="warning-banner" role="alert"><strong>Рабочая папка недоступна.</strong> {workspaceStatus.warning}</div>}
      {workspaceStatus?.isBootstrap && !workspaceStatus.warning && (
        <div className="warning-banner" role="status"><strong>Используется резервная локальная база.</strong> Выберите постоянную папку Calendar Studio — текущие данные будут перенесены туда без потери ID и истории.</div>
      )}
      {workspaceStatus && !workspaceStatus.isBootstrap && (
        <div className="workspace-banner" role="status" title={workspaceStatus.databasePath}><strong>Данные:</strong> {workspaceStatus.directoryPath}</div>
      )}
      {portabilityStatus && <div className="success-banner" role="status">{portabilityStatus}</div>}
      {settings?.mode === 'approved' && <div className="approved-banner">Календарь согласован. Редактирование, переносы и создание зафиксированы; карточки доступны только для просмотра до явного возврата в планирование.</div>}

      {activeTab === 'calendar' && <>
      <section className="status-strip status-strip-six" aria-label="Состояние календаря">
        <div><span>Режим</span><strong>{settings?.mode === 'approved' ? 'Согласованный' : 'Планирование'}</strong></div>
        <div><span>{countScope === 'primary' ? 'Основных' : 'Всего'}</span><strong>{scopedEvents.length}</strong></div>
        <div><span>В календаре</span><strong>{scopedDatedCount}</strong></div>
        <div><span>Без дат</span><strong>{scopedUndatedCount}</strong></div>
        <div><span>Основных всего</span><strong>{primaryCount}</strong></div>
        <div><span>Предупреждения</span><strong>{activeWarnings.length}</strong></div>
      </section>

      <section className="control-strip panel" aria-label="Фильтры календаря">
        <div className="control-group">
          <span className="control-label">Счётчики</span>
          <div className="segmented" aria-label="Состав счётчиков">
            <button type="button" className={countScope === 'all' ? 'is-active' : ''} onClick={() => setCountScope('all')}>Все записи</button>
            <button type="button" className={countScope === 'primary' ? 'is-active' : ''} onClick={() => setCountScope('primary')}>Основные</button>
          </div>
        </div>
        <div className="control-group layer-controls" aria-label="Слои">
          <span className="control-label">Слои</span>
          {(Object.keys(layers) as CalendarLayerKey[]).map((layer) => (
            <label className="layer-toggle" key={layer}>
              <input type="checkbox" checked={layers[layer]} onChange={(change: ChangeEvent<HTMLInputElement>) => setLayers((current) => ({ ...current, [layer]: change.target.checked }))} />
              {layerLabels[layer]}
            </label>
          ))}
        </div>
        <div className="control-group discipline-controls" aria-label="Фильтр по дисциплине">
          <span className="control-label">Дисциплина</span>
          <select className="compact-select" value={disciplineFilter} onChange={(change: ChangeEvent<HTMLSelectElement>) => setDisciplineFilter(change.target.value as DisciplineFilter)}>
            {disciplineFilterOrder.map((discipline) => <option key={discipline} value={discipline}>{disciplineFilterLabels[discipline]}</option>)}
          </select>
        </div>
        <button className="button button-secondary compact-control-button" type="button" onClick={() => { setLayers({ ...DEFAULT_CALENDAR_LAYERS }); setDisciplineFilter('all'); }}>Показать всё</button>
        <span className="shown-count">Показано: {visibleEvents.length}</span>
      </section>

      {warningSummary.warningCount > 0 && (
        <section className="risk-panel panel" aria-label="Нарушения и риски календаря">
          <div className="risk-panel-heading">
            <div><p className="eyebrow">КОНТРОЛЬ ПЛАНА</p><h2>Нарушения и риски</h2></div>
            <div className="risk-metrics" aria-label="Сводка нарушений">
              <span><strong>{warningSummary.warningCount}</strong> рисков</span>
              <span><strong>{warningSummary.affectedEventCount}</strong> мероприятий</span>
              <span><strong>{warningSummary.affectedDateCount}</strong> дат</span>
            </div>
          </div>
          <div className="risk-groups">
            {warningSummary.groups.map((group) => (
              <article className="risk-group" key={group.code}>
                <div className="risk-group-heading">
                  <div><strong>{group.label}</strong><span>{group.description}</span></div>
                  <span className="badge">{group.warnings.length}</span>
                </div>
                <div className="risk-group-links" aria-label={`Быстрые переходы: ${group.label}`}>
                  {group.dates.map((date) => <button type="button" key={date} onClick={() => navigateToDate(date)}>{date}</button>)}
                  {group.eventIds.map((id) => {
                    const event = byId.get(id);
                    return event ? <button type="button" key={id} onClick={() => openEvent(event)}>{event.title}</button> : null;
                  })}
                </div>
                <div className="risk-items">
                  {group.warnings.map((warning, index) => (
                    <div className="risk-item" key={`${warning.code}-${warning.eventIds.join('-')}-${index}`}>
                      <p>{warning.message}</p>
                      {editable && <button className="button button-secondary risk-accept-button" type="button" onClick={() => void acceptWarning(warning)} disabled={busy}>Принять риск</button>}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {acceptedWarnings.length > 0 && (
        <details className="accepted-risks panel">
          <summary>Принятые риски: {acceptedWarnings.length}</summary>
          <p className="muted">Они не учитываются в счётчиках и снова появятся автоматически, если изменятся даты или состав затронутых мероприятий.</p>
          <div className="accepted-risk-list">
            {acceptedWarnings.map((warning, index) => (
              <div className="accepted-risk" key={`${calendarWarningKey(warning)}-${index}`}>
                <span>{warning.message}</span>
                {editable && <button className="button button-secondary risk-accept-button" type="button" onClick={() => void restoreWarning(warning)} disabled={busy}>Вернуть в контроль</button>}
              </div>
            ))}
          </div>
        </details>
      )}

      {selection && editable && (
        <div className="selection-toolbar" role="status">
          <span>Выбрано: <strong>{selection.start === selection.end ? selection.start : `${selection.start} — ${selection.end}`}</strong></span>
          <button className="button button-primary" type="button" onClick={() => openNew(selection)}>Создать на выбранные даты</button>
          <button className="button button-secondary" type="button" onClick={() => { setSelectionAnchor(null); setSelectionFocus(null); }}>Снять выделение</button>
        </div>
      )}

      <section className="workspace-grid">
        <article className="panel calendar-panel" aria-busy={loading}>
          <div className="panel-heading calendar-heading">
            <div>
              <p className="eyebrow">{calendarView === 'month' ? `${monthNames[month - 1]?.toUpperCase()} ${year}` : `${year} ГОД`}</p>
              <h2>{calendarView === 'month' ? 'Месяц' : 'Годовой обзор'}</h2>
            </div>
            <div className="calendar-heading-actions">
              <div className="segmented" aria-label="Представление календаря">
                <button type="button" className={calendarView === 'month' ? 'is-active' : ''} onClick={() => setCalendarView('month')}>Месяц</button>
                <button type="button" className={calendarView === 'year' ? 'is-active' : ''} onClick={() => setCalendarView('year')}>12 месяцев</button>
              </div>
              {calendarView === 'month' ? (
                <div className="segmented" aria-label="Навигация по месяцу">
                  <button type="button" onClick={() => moveMonth(-1)} disabled={year === MIN_CALENDAR_YEAR && month === 1}>Пред.</button>
                  <button type="button" onClick={() => { const today = calendarToday(); setYear(today.year); setMonth(today.month); }}>Сегодня</button>
                  <button type="button" onClick={() => moveMonth(1)} disabled={year === MAX_CALENDAR_YEAR && month === 12}>След.</button>
                </div>
              ) : (
                <div className="segmented" aria-label="Навигация по году">
                  <button type="button" onClick={() => year > MIN_CALENDAR_YEAR && setYear(year - 1)} disabled={year === MIN_CALENDAR_YEAR}>Пред. год</button>
                  <button type="button" onClick={() => { const today = calendarToday(); setYear(today.year); setMonth(today.month); }}>Текущий</button>
                  <button type="button" onClick={() => year < MAX_CALENDAR_YEAR && setYear(year + 1)} disabled={year === MAX_CALENDAR_YEAR}>След. год</button>
                </div>
              )}
            </div>
          </div>

          {calendarView === 'month' ? (<>
            <div className="calendar-grid calendar-weekdays">{weekdays.map((day) => <div key={day}>{day}</div>)}</div>
            <div className="calendar-month" aria-label={`${monthNames[month - 1]} ${year}`} onMouseUp={() => setSelecting(false)}>
              {Array.from({ length: model.weeks }, (_, weekIndex) => {
                const cells = model.cells.slice(weekIndex * 7, weekIndex * 7 + 7);
                const weekSegments = segments.filter((segment) => segment.weekIndex === weekIndex);
                const lanes = monthLaneCount(segments, weekIndex);
                const style = { '--event-lanes': lanes } as CSSProperties;
                return (
                  <div className="calendar-week" style={style} key={`${year}-${month}-week-${weekIndex}`}>
                    <div className="calendar-grid week-days">
                      {cells.map((cell) => {
                        const selectable = dateBelongsToYear(cell.date, year);
                        const selected = dateInRange(cell.date, selection);
                        return (
                          <div
                            className={`day-cell ${cell.inCurrentMonth ? '' : 'day-outside'} ${selected ? 'day-selected' : ''} ${selectable && editable ? 'day-interactive' : ''} ${dragTarget === `day:${cell.date}` ? 'is-drop-target' : ''}`}
                            key={cell.date}
                            data-date={cell.date}
                            role="gridcell"
                            tabIndex={selectable && editable ? 0 : -1}
                            aria-selected={selected}
                            onMouseDown={(mouse: ReactMouseEvent<HTMLDivElement>) => beginSelection(mouse, cell.date)}
                            onMouseEnter={() => extendSelection(cell.date)}
                            onContextMenu={(mouse: ReactMouseEvent<HTMLDivElement>) => openRangeContext(mouse, cell.date)}
                            onKeyDown={(key: ReactKeyboardEvent<HTMLDivElement>) => keyOnDay(key, cell.date)}
                            onDoubleClick={() => selectable && editable && openNew(normalizeDateRange(cell.date, cell.date))}
                            onDragEnter={(drag: ReactDragEvent<HTMLDivElement>) => { if (editable && selectable) { drag.preventDefault(); setDragTarget(`day:${cell.date}`); } }}
                            onDragOver={(drag: ReactDragEvent<HTMLDivElement>) => { if (editable && selectable) { drag.preventDefault(); drag.dataTransfer.dropEffect = 'move'; setDragTarget(`day:${cell.date}`); } }}
                            onDrop={(drop: ReactDragEvent<HTMLDivElement>) => dropOnDate(drop, cell.date)}
                            title={editable && selectable ? 'Выделите диапазон мышью, нажмите ПКМ для быстрого создания или перетащите мероприятие на дату.' : undefined}
                          >
                            <span className="day-number">{cell.day}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="week-events" aria-label={`События недели ${weekIndex + 1}`} onDragEnter={handleCalendarOverlayDrag} onDragOver={handleCalendarOverlayDrag} onDrop={dropOnCalendarOverlay}>
                      {weekSegments.map((segment) => {
                        const event = byId.get(segment.eventId);
                        if (!event) return null;
                        const segmentStyle = { gridColumn: `${segment.startColumn + 1} / span ${segment.span}`, '--event-lane': segment.lane, '--event-accent': event.stickerColor } as CSSProperties;
                        return (
                          <button type="button" key={`${event.id}-${weekIndex}`} className={`${eventClasses(event)} ${segment.startsHere ? 'segment-start' : ''} ${segment.endsHere ? 'segment-end' : ''} ${segment.startsHere ? '' : 'segment-continuation'}`} style={segmentStyle}
                            onClick={(click: ReactMouseEvent<HTMLButtonElement>) => { click.stopPropagation(); openEvent(event); }}
                            title={`${event.title} · ${disciplineLabels[event.discipline]}${editable ? ' · можно перетащить' : ''}`} draggable={editable && !busy}
                            onDragStart={(drag: ReactDragEvent<HTMLButtonElement>) => beginDrag(drag, event)} onDragEnd={endDrag}>
                            {segment.startsHere ? <><span className="event-status">{statusLabels[event.status]}</span><strong>{event.title}</strong><span className="event-meta">{disciplineLabels[event.discipline]}</span></> : <><span className="event-continuation">↳ продолжение</span><strong>{shortEventLabel(event)}</strong><span className="event-meta">до {event.endDate}</span></>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>) : (
            <div className="annual-overview" aria-label={`Годовой обзор ${year}`}>
              {annualOverview.map((summary) => (
                <section className="annual-month" key={`${year}-${summary.month}`}>
                  <button className="annual-month-heading" type="button" onClick={() => { setMonth(summary.month); setCalendarView('month'); }}>
                    <strong>{monthNames[summary.month - 1]}</strong>
                    <span>{summary.eventCount} стартов · {summary.primaryCount} основных · {summary.warningCount} рисков</span>
                  </button>
                  <div className="annual-weekdays">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
                  <div className="annual-days">
                    {summary.days.map((day) => (
                      <button type="button" key={day.date} className={`annual-day ${day.inCurrentMonth ? '' : 'annual-day-outside'} ${day.warningCount ? 'annual-day-warning' : ''}`}
                        tabIndex={day.inCurrentMonth ? 0 : -1} disabled={!day.inCurrentMonth}
                        onClick={() => navigateToDate(day.date)}
                        onDoubleClick={() => editable && openNew(normalizeDateRange(day.date, day.date))}
                        onDragEnter={(drag: ReactDragEvent<HTMLButtonElement>) => { if (editable && day.inCurrentMonth) { drag.preventDefault(); setDragTarget(`day:${day.date}`); } }}
                        onDragOver={(drag: ReactDragEvent<HTMLButtonElement>) => { if (editable && day.inCurrentMonth) { drag.preventDefault(); drag.dataTransfer.dropEffect = 'move'; setDragTarget(`day:${day.date}`); } }}
                        onDrop={(drop: ReactDragEvent<HTMLButtonElement>) => dropOnDate(drop, day.date)}
                        title={`${day.date}${day.events.length ? ` · мероприятий: ${day.events.map((event) => event.title).join(', ')}` : ''}${day.warningCount ? ` · рисков: ${day.warningCount}` : ''}`}>
                        <span>{day.day}</span>
                        {day.events.length > 0 && <span className="annual-event-list" aria-hidden="true">
                          {day.events.slice(0, 1).map((event) => <span className={`annual-event-chip ${event.startsHere ? 'annual-event-start' : 'annual-event-continues'}`} key={event.id} style={{ '--annual-event-accent': event.color } as CSSProperties}>{event.label}</span>)}
                          {day.events.length > 1 && <span className="annual-event-overflow">+{day.events.length - 1}</span>}
                        </span>}
                        {day.warningCount > 0 && <small>!{day.warningCount}</small>}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          {loading && <div className="loading-overlay">Загрузка календаря…</div>}
        </article>

        <aside className="side-stack">
          <section
            className={`panel queue-panel ${editable ? 'queue-drop-target' : ''} ${dragTarget === 'queue' ? 'is-drop-target' : ''}`}
            onDragEnter={(drag: ReactDragEvent<HTMLElement>) => { if (editable) { drag.preventDefault(); setDragTarget('queue'); } }}
            onDragOver={(drag: ReactDragEvent<HTMLElement>) => { if (editable) { drag.preventDefault(); drag.dataTransfer.dropEffect = 'move'; setDragTarget('queue'); } }}
            onDrop={dropOnQueue}
          >
            <div className="panel-heading compact queue-heading">
              <div><p className="eyebrow">ПЛАНИРОВАНИЕ</p><h2>Корзина матчей</h2></div>
              <span className="badge">{undated.length}</span>
            </div>
            {editable && <div className="queue-actions">
              <button className="button button-primary" type="button" onClick={() => openNew()} disabled={busy}>Создать в корзину</button>
              <button className="button button-secondary" type="button" onClick={() => void createDefaultBasket()} disabled={busy}>Заполнить стандартный набор</button>
              <button className="button button-secondary" type="button" onClick={exportEventSpreadsheet} disabled={busy}>Экспорт Excel</button>
              <label className={`button button-secondary file-button ${busy ? 'is-disabled' : ''}`}>
                Импорт Excel
                <input className="file-input-hidden" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={(change: ChangeEvent<HTMLInputElement>) => void importEventSpreadsheet(change)} disabled={busy} />
              </label>
            </div>}
            {editable && <p className="queue-hint">Тяните карточку на день, чтобы поставить матч в календарь. Чтобы снять дату — верните карточку сюда. {draggedEventId ? (dragTarget === 'queue' ? 'Отпустите: даты будут сняты.' : 'Отпустите карточку на нужный день.') : 'Если перетаскивание не сработало, отпустите и начните движение с самой карточки.'}</p>}
            <div className="queue-tools">
              <input type="search" value={queueQuery} onChange={(change: ChangeEvent<HTMLInputElement>) => setQueueQuery(change.target.value)} placeholder="Найти мероприятие…" aria-label="Поиск мероприятий без даты" />
              <select value={queueSort} onChange={(change: ChangeEvent<HTMLSelectElement>) => setQueueSort(change.target.value as UndatedSort)} aria-label="Сортировка мероприятий без даты">
                <option value="updated-desc">Сначала свежие</option>
                <option value="title-asc">По названию</option>
                <option value="discipline-asc">По дисциплине</option>
                <option value="status-asc">По статусу</option>
              </select>
            </div>
            {queueQuery.trim() && <p className="queue-result-count">Найдено: {undated.length} из {undatedTotal}</p>}
            {undated.length === 0 ? <div className="empty-state">{undatedTotal === 0 ? 'Корзина пуста. Создайте мероприятие без даты — оно появится здесь для перетаскивания.' : 'По текущему поиску ничего не найдено.'}</div> : (
              <div className="queue-list">
                {undated.map((event) => (
                  <button
                    type="button"
                    className="queue-card"
                    key={event.id}
                    onClick={() => openEvent(event)}
                    draggable={editable && !busy}
                    onDragStart={(drag: ReactDragEvent<HTMLButtonElement>) => beginDrag(drag, event)}
                    onDragEnd={endDrag}
                  >
                    <span className="queue-card-status">{statusLabels[event.status]} · {disciplineLabels[event.discipline]}</span>
                    <strong>{event.title}</strong>
                    <span>{event.organizerName || 'Организатор не указан'}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </section>
      </>}

      {activeTab === 'archive' && (
        <section className="panel archive-workspace" aria-label="Архив мероприятий">
          <div className="panel-heading">
            <div><p className="eyebrow">АРХИВ</p><h2>Архивированные мероприятия</h2><p className="muted">Записи остаются в базе и журнале аудита; их можно восстановить в планирование.</p></div>
            <span className="badge">{archived.length}</span>
          </div>
          {archivedEvents.length > 0 && (
            <div className="queue-tools archive-tools">
              <input type="search" value={archiveQuery} onChange={(change: ChangeEvent<HTMLInputElement>) => setArchiveQuery(change.target.value)} placeholder="Найти в архиве…" aria-label="Поиск архивированных мероприятий" />
              <select value={archiveSort} onChange={(change: ChangeEvent<HTMLSelectElement>) => setArchiveSort(change.target.value as ArchivedSort)} aria-label="Сортировка архива">
                <option value="archived-desc">Недавно архивированные</option>
                <option value="title-asc">По названию</option>
                <option value="date-asc">По дате мероприятия</option>
                <option value="discipline-asc">По дисциплине</option>
              </select>
            </div>
          )}
          {archiveQuery.trim() && archivedEvents.length > 0 && <p className="queue-result-count">Найдено: {archived.length} из {archivedEvents.length}</p>}
          {archived.length === 0 ? (
            <div className="empty-state">{archivedEvents.length === 0 ? 'Архив пуст.' : 'По текущему поиску в архиве ничего не найдено.'}</div>
          ) : (
            <div className="archive-list">
              {archived.map((event) => (
                <article className="archive-card" key={event.id}>
                  <div>
                    <strong>{event.title}</strong>
                    <span>{event.startDate ? (event.startDate === event.endDate ? event.startDate : `${event.startDate} — ${event.endDate}`) : 'Без даты'} · редакция {event.revision}</span>
                  </div>
                  <div className="archive-actions">
                    <button className="button button-secondary" type="button" onClick={() => void restoreArchivedEvent(event)} disabled={!editable || busy} title={!editable ? 'Верните календарь в режим планирования для восстановления.' : undefined}>Восстановить</button>
                    <button className="button button-danger button-danger-quiet" type="button" onClick={() => void deleteArchivedEvent(event)} disabled={!editable || busy} title={!editable ? 'Верните календарь в режим планирования для удаления.' : undefined}>Удалить</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {rangeMenu && (
        <div className="range-context-menu" style={{ left: rangeMenu.x, top: rangeMenu.y }} role="menu" onClick={(click: ReactMouseEvent<HTMLDivElement>) => click.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => openNew(rangeMenu.range)}>Создать мероприятие</button>
          <span>{rangeMenu.range.start === rangeMenu.range.end ? rangeMenu.range.start : `${rangeMenu.range.start} — ${rangeMenu.range.end}`}</span>
        </div>
      )}

      {editor && <EventEditor year={year} event={editor.event} initialData={editor.initialData} issues={issues} saving={saving} readOnly={editor.readOnly} parentCandidates={events} relatedEventCount={editor.event ? [...events, ...archivedEvents].filter((candidate) => candidate.parentEventId === editor.event?.id).length : 0} relatedAvailability={((): RelatedEventAvailability => {
        const children = editor.event ? events.filter((candidate) => candidate.parentEventId === editor.event?.id) : [];
        return { regional: children.some((candidate) => candidate.competitionStatus === 'Региональные соревнования'), physical: children.some((candidate) => candidate.competitionStatus === 'Физкультурное мероприятие') };
      })()} requireEkpConfirmation={editor.event?.source === 'ekp'} revisionConflict={editorConflict} onRefreshConflict={() => void refreshConflictEditor()} onCancel={() => { setEditor(null); setEditorConflict(null); setIssues([]); }} onSave={saveEditor} onArchive={editor.event && !editor.readOnly ? archiveEditor : undefined} onDelete={editor.event && !editor.readOnly ? deleteEditorEvent : undefined} />}
    </main>
  );
}
