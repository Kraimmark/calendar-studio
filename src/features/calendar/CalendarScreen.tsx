import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { buildMonth, MAX_CALENDAR_YEAR, MIN_CALENDAR_YEAR } from '../../domain/calendar';
import { buildAnnualOverview } from '../../domain/annualOverview';
import {
  DAY_BACKGROUND_LABELS,
  DAY_BACKGROUND_ORDER,
  DEFAULT_DAY_BACKGROUND_COLORS,
  dayBackgroundCategory,
  orderedDayBackgroundCategories,
  type CalendarDayBackgroundKey,
} from '../../domain/dayBackgrounds';
import { buildArchivedLibrary, type ArchivedSort } from '../../domain/archivedLibrary';
import { buildUndatedLibrary, type UndatedSort } from '../../domain/undatedLibrary';
import { parseDateOnly, type DateOnly } from '../../domain/dateOnly';
import { bundleBadges, bundleChildren, linkedDescendants, planningEvents } from '../../domain/eventBundle';
import { DEFAULT_CALENDAR_LAYERS, isEventVisibleByDiscipline, isEventVisibleByLayers, type CalendarLayerKey, type CalendarLayerState, type DisciplineFilter } from '../../domain/calendarLayers';
import { buildMonthEventSegments, monthLaneCount } from '../../domain/monthLayout';
import { dateInRange, moveEventToDatePatch, moveEventToQueuePatch, normalizeDateRange, resizeEventEndToDatePatch, type DateRange } from '../../domain/planning';
import { preparationZonesByDate } from '../../domain/preparationZones';
import type { CalendarPortability } from '../../domain/portability';
import type { CalendarYearProjectTemplate, CalendarYearProjects } from '../../domain/yearProject';
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
type QueueSeriesFilter = 'all' | EventSeries;
interface RangeMenuState { x: number; y: number; range: DateRange }
interface MatchTemplate { id: string; title: string; data: CalendarEventData }
type PointerDragMode = 'move' | 'resize-end';
interface PointerDragState { eventId: string; mode: PointerDragMode; pointerId: number; startX: number; startY: number }

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const disciplineLabels: Record<CalendarEvent['discipline'], string> = { pistol: 'Пистолет', carbine: 'Карабин', cpc: 'КПК', shotgun: 'Ружьё', airgun: 'Пневматика', multigun: 'Мультиган', other: 'Другое' };
const statusLabels: Record<CalendarEvent['status'], string> = { draft: 'Черновик', tentative: 'Предварительно', confirmed: 'Подтверждено' };
const layerLabels: Record<CalendarLayerKey, string> = { ownPlan: 'Наш план', ekpSpb: 'ЕКП · СПб', ekpOther: 'ЕКП · другие регионы', trf: 'ТРФ', allRussian: 'Всероссийские', departmental: 'Ведомственные', airgun: 'Пневматика', utm: 'УТМ / тренировки', build: 'Застройка' };
const disciplineFilterLabels: Record<DisciplineFilter, string> = { all: 'Все дисциплины', pistol: 'Пистолет', carbine: 'Карабин', cpc: 'КПК · карабин пистолетного калибра', shotgun: 'Ружьё', airgun: 'Пневматика', multigun: 'Мультиган', other: 'Другое' };
const disciplineFilterOrder: DisciplineFilter[] = ['all', 'pistol', 'carbine', 'cpc', 'shotgun', 'airgun', 'multigun', 'other'];
const DAY_BACKGROUND_PALETTE_STORAGE_KEY = 'calendar-studio-day-background-palette';
const MATCH_TEMPLATE_STORAGE_KEY = 'calendar-studio-match-templates-v1';
const basketDisciplines: Array<[Discipline, string]> = [['pistol', 'Пистолет'], ['carbine', 'Карабин'], ['cpc', 'КПК'], ['shotgun', 'Ружьё'], ['airgun', 'Пневматика'], ['multigun', 'Мультиган']];
const seriesLabels: Record<EventSeries, string> = { regular: 'Региональная', trf: 'ТРФ', allRussian: 'Всероссийская', departmental: 'Ведомственная', spbCup: 'Кубок СПб', other: 'Другая' };

function readDayBackgroundPalette(): Record<CalendarDayBackgroundKey, string> {
  const fallback = { ...DEFAULT_DAY_BACKGROUND_COLORS };
  try {
    const raw = window.localStorage.getItem(DAY_BACKGROUND_PALETTE_STORAGE_KEY);
    if (!raw) return fallback;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return fallback;
    for (const category of DAY_BACKGROUND_ORDER) {
      const candidate = (saved as Record<string, unknown>)[category];
      if (typeof candidate === 'string' && /^#[0-9a-f]{6}$/iu.test(candidate)) fallback[category] = candidate;
    }
  } catch {
    // Visual preferences must never prevent a calendar from opening.
  }
  return fallback;
}

function dayBackgroundStyle(
  categories: readonly CalendarDayBackgroundKey[],
  palette: Record<CalendarDayBackgroundKey, string>,
): CSSProperties | undefined {
  const ordered = orderedDayBackgroundCategories(categories);
  if (ordered.length === 0) return undefined;
  const primary = ordered[0]!;
  const secondary = ordered[1] ?? primary;
  return {
    '--day-occupancy-color': palette[primary],
    '--day-occupancy-secondary': palette[secondary],
    '--day-occupancy-mixed': ordered.length > 1 ? '1' : '0',
  } as CSSProperties;
}

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
  return cityEvents;
}

const builtInMatchTemplates: MatchTemplate[] = [
  { id: 'built-in-eternal-living', title: 'Вечно живые', data: basketDraft('Вечно живые', 'multigun', 'trf') },
  { id: 'built-in-double-barrel', title: 'Двудулочка', data: basketDraft('Двудулочка', 'shotgun', 'trf') },
  { id: 'built-in-idisi-sikube', title: 'Идиси Сикубэ', data: basketDraft('Идиси Сикубэ', 'pistol', 'trf') },
  { id: 'built-in-ancestors-lizards', title: 'Пращуры против ящеров', data: basketDraft('Пращуры против ящеров', 'carbine', 'trf') },
];

function templateData(data: CalendarEventData): CalendarEventData {
  return normalizeStudioEventData({ ...createEventData(), ...structuredClone(data), kind: 'match', startDate: null, endDate: null, parentEventId: null });
}

function readMatchTemplates(): MatchTemplate[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(MATCH_TEMPLATE_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((candidate): MatchTemplate[] => {
      if (!candidate || typeof candidate !== 'object') return [];
      const item = candidate as Record<string, unknown>;
      if (typeof item.id !== 'string' || typeof item.title !== 'string' || !item.title.trim() || !item.data || typeof item.data !== 'object') return [];
      return [{ id: item.id, title: item.title.trim(), data: templateData(item.data as CalendarEventData) }];
    });
  } catch {
    return [];
  }
}

function mergeMatchTemplates(current: readonly MatchTemplate[], incoming: readonly CalendarYearProjectTemplate[]): MatchTemplate[] {
  const merged = new Map(current.map((template) => [template.title.trim().toLocaleLowerCase('ru-RU'), template]));
  for (const template of incoming) {
    const data = templateData(template.data);
    merged.set(template.title.trim().toLocaleLowerCase('ru-RU'), { id: crypto.randomUUID(), title: template.title.trim(), data });
  }
  return [...merged.values()].sort((left, right) => left.title.localeCompare(right.title, 'ru'));
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

function dateAtPointer(clientX: number, clientY: number): DateOnly | null {
  for (const cell of document.querySelectorAll<HTMLElement>('.day-cell[data-date], .annual-day[data-date]')) {
    const bounds = cell.getBoundingClientRect();
    if (clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom) return cell.dataset.date as DateOnly;
  }
  return null;
}

function pointerDropTarget(clientX: number, clientY: number, year: number): `day:${DateOnly}` | 'queue' | null {
  const element = document.elementFromPoint(clientX, clientY);
  if (element?.closest('.queue-panel')) return 'queue';
  const date = dateAtPointer(clientX, clientY);
  return date && dateBelongsToYear(date, year) ? `day:${date}` : null;
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
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [yearDraft, setYearDraft] = useState(String(initial.year));
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('calendar');
  const [queueQuery, setQueueQuery] = useState('');
  const [queueSort, setQueueSort] = useState<UndatedSort>('updated-desc');
  const [queueDisciplineFilter, setQueueDisciplineFilter] = useState<DisciplineFilter>('all');
  const [queueSeriesFilter, setQueueSeriesFilter] = useState<QueueSeriesFilter>('all');
  const [userMatchTemplates, setUserMatchTemplates] = useState<MatchTemplate[]>(readMatchTemplates);
  const [templateEditor, setTemplateEditor] = useState<CalendarEventData | null>(null);
  const [archiveQuery, setArchiveQuery] = useState('');
  const [archiveSort, setArchiveSort] = useState<ArchivedSort>('archived-desc');
  const [layers, setLayers] = useState<CalendarLayerState>(() => ({ ...DEFAULT_CALENDAR_LAYERS }));
  const [disciplineFilter, setDisciplineFilter] = useState<DisciplineFilter>('all');
  const [dayBackgroundPalette, setDayBackgroundPalette] = useState<Record<CalendarDayBackgroundKey, string>>(readDayBackgroundPalette);
  const [selectionAnchor, setSelectionAnchor] = useState<DateOnly | null>(null);
  const [selectionFocus, setSelectionFocus] = useState<DateOnly | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [rangeMenu, setRangeMenu] = useState<RangeMenuState | null>(null);
  const [porting, setPorting] = useState(false);
  const [portabilityStatus, setPortabilityStatus] = useState<string | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatus | null>(null);
  const [workspaceChanging, setWorkspaceChanging] = useState(false);
  const [pointerDrag, setPointerDrag] = useState<PointerDragState | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const dragMovedRef = useRef(false);
  const suppressOpenRef = useRef<string | null>(null);

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
    try {
      window.localStorage.setItem(DAY_BACKGROUND_PALETTE_STORAGE_KEY, JSON.stringify(dayBackgroundPalette));
    } catch {
      // The palette is a convenience; keep the plan usable if storage is unavailable.
    }
  }, [dayBackgroundPalette]);
  useEffect(() => {
    try {
      window.localStorage.setItem(MATCH_TEMPLATE_STORAGE_KEY, JSON.stringify(userMatchTemplates));
    } catch {
      // Templates remain usable for this session even if the browser storage is unavailable.
    }
  }, [userMatchTemplates]);
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
  useEffect(() => { setYearDraft(String(year)); }, [year]);
  useEffect(() => {
    if (!selecting) return;
    const stopSelecting = () => setSelecting(false);
    window.addEventListener('mouseup', stopSelecting);
    return () => window.removeEventListener('mouseup', stopSelecting);
  }, [selecting]);

  const model = useMemo(() => buildMonth(year, month), [year, month]);
  const selection = useMemo(() => selectionAnchor && selectionFocus ? normalizeDateRange(selectionAnchor, selectionFocus) : null, [selectionAnchor, selectionFocus]);
  const planningRoots = useMemo(() => planningEvents(events), [events]);
  const scopedEvents = useMemo(() => countScope === 'primary' ? planningRoots.filter((event) => event.isPrimary) : planningRoots, [countScope, planningRoots]);
  const visibleEvents = useMemo(() => scopedEvents.filter((event) => isEventVisibleByLayers(event, layers) && isEventVisibleByDiscipline(event, disciplineFilter)), [disciplineFilter, layers, scopedEvents]);
  const segments = useMemo(() => buildMonthEventSegments(model, visibleEvents), [model, visibleEvents]);
  const monthDayBackgrounds = useMemo(() => new Map(
    model.cells.map((cell) => [
      cell.date,
      orderedDayBackgroundCategories(
        visibleEvents
          .filter((event) => event.startDate && event.endDate && event.startDate <= cell.date && event.endDate >= cell.date)
          .map(dayBackgroundCategory),
      ),
    ]),
  ), [model.cells, visibleEvents]);
  const preparationZones = useMemo(() => preparationZonesByDate(year, visibleEvents), [visibleEvents, year]);
  const byId = useMemo(() => new Map(planningRoots.map((event) => [event.id, event])), [planningRoots]);
  const queueEvents = useMemo(() => planningRoots.filter((event) =>
    event.startDate === null
    && event.endDate === null
    && (queueDisciplineFilter === 'all' || event.discipline === queueDisciplineFilter)
    && (queueSeriesFilter === 'all' || event.series === queueSeriesFilter),
  ), [planningRoots, queueDisciplineFilter, queueSeriesFilter]);
  const undatedTotal = useMemo(() => planningRoots.filter((event) => event.startDate === null && event.endDate === null).length, [planningRoots]);
  const undated = useMemo(() => buildUndatedLibrary(queueEvents, queueQuery, queueSort), [queueEvents, queueQuery, queueSort]);
  const scopedUndatedCount = useMemo(() => scopedEvents.filter((event) => event.startDate === null && event.endDate === null).length, [scopedEvents]);
  const scopedDatedCount = scopedEvents.length - scopedUndatedCount;
  const primaryCount = useMemo(() => planningRoots.filter((event) => event.isPrimary).length, [planningRoots]);
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
      const project = await yearProjects.exportProject(year, undefined, userMatchTemplates.map((template) => ({ title: template.title, data: templateData(template.data) })));
      download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `calendar-studio-year-${year}.json`);
      setPortabilityStatus(`Проект ${year} года сохранён: ${project.events.length} мероприятий, ${project.templates.length} шаблонов и ${project.audit.length} записей истории.`);
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
      if (result.templates.length > 0) setUserMatchTemplates((current) => mergeMatchTemplates(current, result.templates));
      setEditor(null);
      setEditorConflict(null);
      setIssues([]);
      setMonth(1);
      setYear(project.year);
      if (project.year === year) await reload();
      const templateStatus = result.templates.length > 0 ? ` Добавлено шаблонов: ${result.templates.length}.` : '';
      setPortabilityStatus((result.backupReference ? `Проект ${project.year} года открыт. Резервная копия: ${result.backupReference}` : `Проект ${project.year} года открыт.`) + templateStatus);
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

  const chooseYear = (candidate: number) => {
    if (!Number.isInteger(candidate) || candidate < MIN_CALENDAR_YEAR || candidate > MAX_CALENDAR_YEAR) {
      setInteractionError(`Введите год от ${MIN_CALENDAR_YEAR} до ${MAX_CALENDAR_YEAR}.`);
      return;
    }
    setYear(candidate);
    setYearPickerOpen(false);
  };

  const nearbyYears = Array.from({ length: 5 }, (_, index) => year + index - 2)
    .filter((candidate) => candidate >= MIN_CALENDAR_YEAR && candidate <= MAX_CALENDAR_YEAR);

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

  const openRelatedNew = (parent: CalendarEvent) => {
    if (!editable) return;
    const parentData = eventDataOf(parent);
    setIssues([]);
    setInteractionError(null);
    setEditorConflict(null);
    setEditor({
      event: null,
      initialData: normalizeStudioEventData({
        ...parentData,
        title: `Связанное мероприятие · ${parent.title}`,
        competitionStatus: 'Связанное мероприятие',
        parentEventId: parent.id,
        isPrimary: false,
        source: 'manual',
        status: 'draft',
        notes: '',
        stickerColor: '#737b84',
      }),
      readOnly: false,
    });
  };

  const saveEditor = async (data: CalendarEventData, related: RelatedEventSelection) => {
    if (!editor || editor.readOnly) return;
    const selectedParent = data.parentEventId ? events.find((candidate) => candidate.id === data.parentEventId && candidate.archivedAt === null) ?? null : null;
    const studioData = normalizeStudioEventData(selectedParent ? {
      ...data,
      startDate: selectedParent.startDate,
      endDate: selectedParent.endDate,
      discipline: selectedParent.discipline,
      isPrimary: false,
    } : data);
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
      if (editor.event && !studioData.parentEventId) {
        const inheritedChanges = { startDate: studioData.startDate, endDate: studioData.endDate, discipline: studioData.discipline };
        for (const child of bundleChildren(editor.event.id, events)) {
          if (child.startDate === inheritedChanges.startDate && child.endDate === inheritedChanges.endDate && child.discipline === inheritedChanges.discipline) continue;
          await repository.saveEvent({ kind: 'update', id: child.id, actor: 'local-owner', timestamp, changes: inheritedChanges }, child.revision);
        }
      }
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

  const addTemplateToQueue = async (template: MatchTemplate) => {
    if (!editable || busy) return;
    setSaving(true);
    setInteractionError(null);
    try {
      await repository.saveEvent({
        kind: 'create',
        id: crypto.randomUUID(),
        calendarYear: year,
        actor: 'local-owner',
        timestamp: new Date().toISOString(),
        data: templateData(template.data),
      }, null);
      await reload();
      setPortabilityStatus(`В корзину добавлен шаблон «${template.title}».`);
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const saveMatchTemplate = (data: CalendarEventData) => {
    const draft = templateData(data);
    const nextIssues = validateEvent(draft, { year });
    setIssues(nextIssues);
    if (hasBlockingIssues(nextIssues)) return;
    const template: MatchTemplate = { id: crypto.randomUUID(), title: draft.title.trim(), data: draft };
    setUserMatchTemplates((current) => [...current, template].sort((left, right) => left.title.localeCompare(right.title, 'ru')));
    setTemplateEditor(null);
    setIssues([]);
    setPortabilityStatus(`Шаблон «${template.title}» сохранён. Теперь он добавляется в корзину одной кнопкой.`);
  };

  const copyEventToQueue = async () => {
    if (!editor?.event || editor.readOnly || busy) return;
    const source = eventDataOf(editor.event);
    const copy = templateData({ ...source, title: `Копия · ${source.title}` });
    setSaving(true);
    setInteractionError(null);
    try {
      await repository.saveEvent({ kind: 'create', id: crypto.randomUUID(), calendarYear: year, actor: 'local-owner', timestamp: new Date().toISOString(), data: copy }, null);
      setEditor(null);
      setIssues([]);
      await reload();
      setPortabilityStatus(`Копия «${source.title}» добавлена в корзину без дат.`);
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const archiveEditor = async () => {
    if (!editor?.event || editor.readOnly) return;
    setSaving(true);
    try {
      const timestamp = new Date().toISOString();
      for (const child of linkedDescendants(editor.event.id, events)) {
        await repository.archiveEvent(child.id, child.revision, 'local-owner', timestamp);
      }
      await repository.archiveEvent(editor.event.id, editor.event.revision, 'local-owner', timestamp);
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

  const deleteRelatedEvent = async (relatedEvent: CalendarEvent) => {
    if (!editable || busy) return;
    const parent = editor?.event?.id === relatedEvent.parentEventId ? editor.event : null;
    setSaving(true);
    setInteractionError(null);
    try {
      await repository.deleteEvent(relatedEvent.id, relatedEvent.revision, 'local-owner', new Date().toISOString());
      const latestParent = parent ? await repository.getEvent(parent.id) : null;
      await reload();
      if (latestParent && latestParent.archivedAt === null) {
        setEditor({ event: latestParent, initialData: eventDataOf(latestParent), readOnly: !editable });
      } else if (parent) {
        setEditor(null);
      }
      setEditorConflict(null);
      setIssues([]);
      setPortabilityStatus(`Связанная запись «${relatedEvent.title}» удалена.`);
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        await reload();
        setIssues([{ code: 'delete_related_conflict', severity: 'error', field: null, message: 'Связанная запись уже изменилась. Данные обновлены — повторите удаление.' }]);
      } else {
        setIssues([{ code: 'delete_related_failed', severity: 'error', field: null, message: error instanceof Error ? error.message : String(error) }]);
      }
    } finally {
      setSaving(false);
    }
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
      const timestamp = new Date().toISOString();
      await repository.restoreEvent(event.id, event.revision, 'local-owner', timestamp);
      for (const child of linkedDescendants(event.id, archivedEvents)) {
        await repository.restoreEvent(child.id, child.revision, 'local-owner', timestamp);
      }
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

  const updateEventDates = useCallback(async (event: CalendarEvent, changes: Pick<CalendarEventData, 'startDate' | 'endDate'>) => {
    if (!editable || busy) return;
    setSaving(true);
    setInteractionError(null);
    try {
      const timestamp = new Date().toISOString();
      await repository.saveEvent({ kind: 'update', id: event.id, actor: 'local-owner', timestamp, changes }, event.revision);
      for (const child of bundleChildren(event.id, events)) {
        if (child.startDate === changes.startDate && child.endDate === changes.endDate) continue;
        await repository.saveEvent({ kind: 'update', id: child.id, actor: 'local-owner', timestamp, changes }, child.revision);
      }
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
  }, [busy, editable, events, reload, repository]);

  const beginPointerDrag = (pointer: ReactPointerEvent<HTMLElement>, event: CalendarEvent, mode: PointerDragMode = 'move') => {
    if (!editable || busy || pointer.button !== 0) return;
    pointer.preventDefault();
    pointer.stopPropagation();
    dragMovedRef.current = false;
    setSelectionAnchor(null);
    setSelectionFocus(null);
    setRangeMenu(null);
    setPointerDrag({ eventId: event.id, mode, pointerId: pointer.pointerId, startX: pointer.clientX, startY: pointer.clientY });
    setDragTarget(pointerDropTarget(pointer.clientX, pointer.clientY, year));
  };

  useEffect(() => {
    if (!pointerDrag) return;
    const onMove = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerDrag.pointerId) return;
      if (Math.hypot(pointer.clientX - pointerDrag.startX, pointer.clientY - pointerDrag.startY) > 4) dragMovedRef.current = true;
      setDragTarget(pointerDropTarget(pointer.clientX, pointer.clientY, year));
    };
    const onFinish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerDrag.pointerId) return;
      const target = pointerDropTarget(pointer.clientX, pointer.clientY, year);
      const event = byId.get(pointerDrag.eventId);
      const moved = dragMovedRef.current;
      setPointerDrag(null);
      setDragTarget(null);
      if (!moved || !event || !editable || busy || target === null) return;
      suppressOpenRef.current = event.id;
      window.setTimeout(() => { suppressOpenRef.current = null; }, 0);
      try {
        if (target === 'queue') {
          if (pointerDrag.mode === 'move' && (event.startDate !== null || event.endDate !== null)) void updateEventDates(event, moveEventToQueuePatch());
          return;
        }
        const date = target.slice(4) as DateOnly;
        const changes = pointerDrag.mode === 'resize-end'
          ? resizeEventEndToDatePatch(event, date)
          : moveEventToDatePatch(event, date);
        void updateEventDates(event, changes);
      } catch (error) {
        setInteractionError(error instanceof Error ? error.message : String(error));
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onFinish);
    window.addEventListener('pointercancel', onFinish);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onFinish);
      window.removeEventListener('pointercancel', onFinish);
    };
  }, [busy, byId, editable, pointerDrag, updateEventDates, year]);

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
        <details className="day-background-settings">
          <summary>Фон занятых дней</summary>
          <div className="day-background-settings-popover">
            <p>Цвет отмечает занятую дату и выбирается по типу мероприятия. При пересечении приоритет остаётся у более крупного уровня.</p>
            <div className="day-background-color-list">
              {DAY_BACKGROUND_ORDER.map((category) => (
                <label className="day-background-color-row" key={category}>
                  <input
                    type="color"
                    value={dayBackgroundPalette[category]}
                    onChange={(change: ChangeEvent<HTMLInputElement>) => setDayBackgroundPalette((current) => ({ ...current, [category]: change.target.value }))}
                  />
                  <span>{DAY_BACKGROUND_LABELS[category]}</span>
                  <code>{dayBackgroundPalette[category].toUpperCase()}</code>
                </label>
              ))}
            </div>
            <button className="button button-secondary compact-control-button" type="button" onClick={() => setDayBackgroundPalette({ ...DEFAULT_DAY_BACKGROUND_COLORS })}>Вернуть палитру</button>
          </div>
        </details>
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
                  <button type="button" onClick={() => { const today = calendarToday(); setYear(today.year); setMonth(today.month); setYearPickerOpen(false); }}>Сегодня</button>
                  <button type="button" onClick={() => moveMonth(1)} disabled={year === MAX_CALENDAR_YEAR && month === 12}>След.</button>
                </div>
              ) : (
                <div className="segmented" aria-label="Навигация по году">
                  <button type="button" onClick={() => { const today = calendarToday(); setYear(today.year); setMonth(today.month); setYearPickerOpen(false); }}>Сегодня</button>
                </div>
              )}
              <div className="year-picker">
                <button className="year-step" type="button" onClick={() => chooseYear(year - 1)} disabled={year === MIN_CALENDAR_YEAR} aria-label="Предыдущий год">‹</button>
                <button className="year-picker-trigger" type="button" aria-expanded={yearPickerOpen} onClick={() => setYearPickerOpen((open) => !open)}>{year}<span>⌄</span></button>
                <button className="year-step" type="button" onClick={() => chooseYear(year + 1)} disabled={year === MAX_CALENDAR_YEAR} aria-label="Следующий год">›</button>
                {yearPickerOpen && <div className="year-picker-popover" role="dialog" aria-label="Выбор года">
                  <div className="year-picker-heading"><strong>Перейти к году</strong><button type="button" onClick={() => setYearPickerOpen(false)} aria-label="Закрыть выбор года">×</button></div>
                  <div className="year-picker-options">
                    {nearbyYears.map((candidate) => <button type="button" key={candidate} className={candidate === year ? 'is-current' : ''} onClick={() => chooseYear(candidate)}>{candidate}</button>)}
                  </div>
                  <form className="year-picker-form" onSubmit={(submit) => { submit.preventDefault(); chooseYear(Number(yearDraft)); }}>
                    <input type="number" min={MIN_CALENDAR_YEAR} max={MAX_CALENDAR_YEAR} value={yearDraft} onChange={(change: ChangeEvent<HTMLInputElement>) => setYearDraft(change.target.value)} aria-label="Год" />
                    <button type="submit">Открыть</button>
                  </form>
                </div>}
              </div>
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
                        const backgroundCategories = monthDayBackgrounds.get(cell.date) ?? [];
                        const preparation = preparationZones.get(cell.date);
                        return (
                          <div
                            className={`day-cell ${cell.inCurrentMonth ? '' : 'day-outside'} ${backgroundCategories.length > 0 ? 'day-occupied' : ''} ${backgroundCategories.length > 1 ? 'day-occupied-mixed' : ''} ${preparation ? 'preparation-zone' : ''} ${selected ? 'day-selected' : ''} ${selectable && editable ? 'day-interactive' : ''} ${dragTarget === `day:${cell.date}` ? 'is-drop-target' : ''}`}
                            key={cell.date}
                            style={dayBackgroundStyle(backgroundCategories, dayBackgroundPalette)}
                            data-date={cell.date}
                            role="gridcell"
                            tabIndex={selectable && editable ? 0 : -1}
                            aria-selected={selected}
                            onMouseDown={(mouse: ReactMouseEvent<HTMLDivElement>) => beginSelection(mouse, cell.date)}
                            onMouseEnter={() => extendSelection(cell.date)}
                            onContextMenu={(mouse: ReactMouseEvent<HTMLDivElement>) => openRangeContext(mouse, cell.date)}
                            onKeyDown={(key: ReactKeyboardEvent<HTMLDivElement>) => keyOnDay(key, cell.date)}
                            onDoubleClick={() => selectable && editable && openNew(normalizeDateRange(cell.date, cell.date))}
                            title={`${backgroundCategories.length > 0 ? `Занято: ${backgroundCategories.map((category) => DAY_BACKGROUND_LABELS[category]).join(', ')}. ` : ''}${preparation ? `Подготовительная зона перед: ${preparation.events.map((event) => event.title).join(', ')}. ` : ''}${editable && selectable ? 'Выделите диапазон мышью, нажмите ПКМ для быстрого создания или перетащите мероприятие на дату.' : ''}` || undefined}
                          >
                            <span className="day-number">{cell.day}</span>
                            {preparation && <span className="preparation-marker" aria-label={`Подготовительная зона: ${preparation.events.map((event) => event.title).join(', ')}`}>14д</span>}
                          </div>
                        );
                      })}
                    </div>
                    <div className="week-events" aria-label={`События недели ${weekIndex + 1}`}>
                      {weekSegments.map((segment) => {
                        const event = byId.get(segment.eventId);
                        if (!event) return null;
                        const badges = bundleBadges(event, events);
                        const segmentStyle = { gridColumn: `${segment.startColumn + 1} / span ${segment.span}`, '--event-lane': segment.lane, '--event-accent': event.stickerColor } as CSSProperties;
                        return (
                          <button type="button" key={`${event.id}-${weekIndex}`} className={`${eventClasses(event)} ${segment.startsHere ? 'segment-start' : ''} ${segment.endsHere ? 'segment-end' : ''} ${segment.startsHere ? '' : 'segment-continuation'} ${pointerDrag?.eventId === event.id ? 'is-pointer-dragging' : ''}`} style={segmentStyle}
                            onClick={(click: ReactMouseEvent<HTMLButtonElement>) => { click.stopPropagation(); if (suppressOpenRef.current === event.id) return; openEvent(event); }}
                            onPointerDown={(pointer: ReactPointerEvent<HTMLButtonElement>) => beginPointerDrag(pointer, event)}
                            title={`${event.title} · ${disciplineLabels[event.discipline]}${editable ? ' · тяните, чтобы перенести' : ''}`}>
                            {segment.startsHere ? <><span className="event-status">{statusLabels[event.status]}</span><strong>{event.title}</strong>{badges.length > 0 && <span className="event-bundle-badges" title="Внутри есть связанные зачёты">{badges.map((badge) => <i key={badge}>{badge}</i>)}</span>}<span className="event-meta">{disciplineLabels[event.discipline]}</span></> : <><span className="event-continuation">↳ продолжение</span><strong>{shortEventLabel(event)}</strong><span className="event-meta">до {event.endDate}</span></>}
                            {editable && segment.endsHere && <span className="event-resize-handle" role="presentation" title="Потяните, чтобы изменить дату окончания" onPointerDown={(pointer: ReactPointerEvent<HTMLSpanElement>) => beginPointerDrag(pointer, event, 'resize-end')} />}
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
                    {summary.days.map((day) => {
                      const backgroundCategories = orderedDayBackgroundCategories(day.events.map((event) => event.backgroundCategory));
                      const preparation = preparationZones.get(day.date);
                      return (
                      <button type="button" key={day.date} className={`annual-day ${day.inCurrentMonth ? '' : 'annual-day-outside'} ${backgroundCategories.length > 0 ? 'annual-day-occupied' : ''} ${backgroundCategories.length > 1 ? 'annual-day-occupied-mixed' : ''} ${preparation ? 'preparation-zone' : ''} ${day.warningCount ? 'annual-day-warning' : ''} ${dragTarget === `day:${day.date}` ? 'is-drop-target' : ''}`}
                        style={dayBackgroundStyle(backgroundCategories, dayBackgroundPalette)}
                        data-date={day.date}
                        tabIndex={day.inCurrentMonth ? 0 : -1} disabled={!day.inCurrentMonth}
                        onClick={() => navigateToDate(day.date)}
                        onDoubleClick={() => editable && openNew(normalizeDateRange(day.date, day.date))}
                        title={`${day.date}${day.events.length ? ` · мероприятий: ${day.events.map((event) => event.title).join(', ')}` : ''}${day.warningCount ? ` · рисков: ${day.warningCount}` : ''}`}>
                        <span>{day.day}</span>
                        {preparation && <em className="annual-preparation-marker" title={`Подготовка: ${preparation.events.map((event) => event.title).join(', ')}`}>▧</em>}
                        {day.events.length > 0 && <span className="annual-event-list">
                          {day.events.slice(0, 2).map((event) => {
                            const record = byId.get(event.id);
                            if (!record) return null;
                            return <span className={`annual-event-chip ${event.startsHere ? 'annual-event-start' : 'annual-event-continues'} ${pointerDrag?.eventId === event.id ? 'is-pointer-dragging' : ''}`} key={event.id} style={{ '--annual-event-accent': event.color } as CSSProperties}
                              title={`${event.title}${editable ? ' · тяните, чтобы перенести' : ''}`}
                              onClick={(click: ReactMouseEvent<HTMLSpanElement>) => { click.stopPropagation(); if (suppressOpenRef.current === event.id) return; openEvent(record); }}
                              onPointerDown={(pointer: ReactPointerEvent<HTMLSpanElement>) => beginPointerDrag(pointer, record)}>
                              {event.label}{event.badges.length > 0 ? ` · ${event.badges.join(' ')}` : ''}
                              {editable && event.endsHere && <span className="annual-resize-handle" role="presentation" title="Потяните, чтобы изменить дату окончания" onPointerDown={(pointer: ReactPointerEvent<HTMLSpanElement>) => beginPointerDrag(pointer, record, 'resize-end')} />}
                            </span>;
                          })}
                          {day.events.length > 2 && <span className="annual-event-overflow">+{day.events.length - 2}</span>}
                        </span>}
                        {day.warningCount > 0 && <small>!{day.warningCount}</small>}
                      </button>
                      );
                    })}
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
          >
            <div className="panel-heading compact queue-heading">
              <div><p className="eyebrow">ПЛАНИРОВАНИЕ</p><h2>Корзина матчей</h2></div>
              <span className="badge">{undated.length}</span>
            </div>
            {editable && <div className="queue-actions">
              <button className="button button-primary" type="button" onClick={() => openNew()} disabled={busy}>Создать в корзину</button>
              <button className="button button-secondary" type="button" onClick={() => void createDefaultBasket()} disabled={busy}>Заполнить стандартный набор</button>
              <details className="quick-match-menu">
                <summary>Создать матч по умолчанию</summary>
                <div className="quick-match-menu-popover">
                  <button className="button button-primary" type="button" onClick={() => { setIssues([]); setTemplateEditor(createEventData()); }}>Добавить шаблон</button>
                  <section>
                    <strong>Быстрые шаблоны ТРФ</strong>
                    <div className="quick-match-template-list">
                      {builtInMatchTemplates.map((template) => <button type="button" key={template.id} onClick={() => void addTemplateToQueue(template)} disabled={busy}>{template.title}</button>)}
                    </div>
                  </section>
                  {userMatchTemplates.length > 0 && <section>
                    <strong>Мои шаблоны</strong>
                    <div className="quick-match-template-list">
                      {userMatchTemplates.map((template) => <div className="quick-match-template-row" key={template.id}>
                        <button type="button" onClick={() => void addTemplateToQueue(template)} disabled={busy}>{template.title}</button>
                        <button className="template-delete-button" type="button" onClick={() => setUserMatchTemplates((current) => current.filter((candidate) => candidate.id !== template.id))} aria-label={`Удалить шаблон ${template.title}`} title="Удалить шаблон">×</button>
                      </div>)}
                    </div>
                  </section>}
                </div>
              </details>
              <button className="button button-secondary" type="button" onClick={exportEventSpreadsheet} disabled={busy}>Экспорт Excel</button>
              <label className={`button button-secondary file-button ${busy ? 'is-disabled' : ''}`}>
                Импорт Excel
                <input className="file-input-hidden" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={(change: ChangeEvent<HTMLInputElement>) => void importEventSpreadsheet(change)} disabled={busy} />
              </label>
            </div>}
            {editable && <p className="queue-hint">Тяните карточку на день, чтобы поставить матч в календарь. Чтобы снять дату — верните карточку сюда. {pointerDrag ? (dragTarget === 'queue' ? 'Отпустите: даты будут сняты.' : dragTarget?.startsWith('day:') ? 'Отпустите: даты будут назначены.' : 'Наведите на нужный день или корзину.') : 'Правый край стикера растягивает матч по дням.'}</p>}
            <div className="queue-tools">
              <input type="search" value={queueQuery} onChange={(change: ChangeEvent<HTMLInputElement>) => setQueueQuery(change.target.value)} placeholder="Найти мероприятие…" aria-label="Поиск мероприятий без даты" />
              <select value={queueDisciplineFilter} onChange={(change: ChangeEvent<HTMLSelectElement>) => setQueueDisciplineFilter(change.target.value as DisciplineFilter)} aria-label="Фильтр корзины по дисциплине">
                {disciplineFilterOrder.map((discipline) => <option key={discipline} value={discipline}>{discipline === 'all' ? 'Все дисциплины' : disciplineFilterLabels[discipline]}</option>)}
              </select>
              <select value={queueSeriesFilter} onChange={(change: ChangeEvent<HTMLSelectElement>) => setQueueSeriesFilter(change.target.value as QueueSeriesFilter)} aria-label="Фильтр корзины по серии">
                <option value="all">Все серии</option>
                {(Object.keys(seriesLabels) as EventSeries[]).map((series) => <option key={series} value={series}>{seriesLabels[series]}</option>)}
              </select>
              <select value={queueSort} onChange={(change: ChangeEvent<HTMLSelectElement>) => setQueueSort(change.target.value as UndatedSort)} aria-label="Сортировка мероприятий без даты">
                <option value="updated-desc">Сначала свежие</option>
                <option value="title-asc">По названию</option>
                <option value="discipline-asc">По дисциплине</option>
                <option value="status-asc">По статусу</option>
              </select>
            </div>
            {(queueQuery.trim() || queueDisciplineFilter !== 'all' || queueSeriesFilter !== 'all') && <p className="queue-result-count">Найдено: {undated.length} из {undatedTotal}</p>}
            {undated.length === 0 ? <div className="empty-state">{undatedTotal === 0 ? 'Корзина пуста. Создайте мероприятие без даты — оно появится здесь для перетаскивания.' : 'По текущему поиску ничего не найдено.'}</div> : (
              <div className="queue-list">
                {undated.map((event) => (
                  <button
                    type="button"
                    className={`queue-card ${pointerDrag?.eventId === event.id ? 'is-pointer-dragging' : ''}`}
                    key={event.id}
                    onClick={() => { if (suppressOpenRef.current === event.id) return; openEvent(event); }}
                    onPointerDown={(pointer: ReactPointerEvent<HTMLButtonElement>) => beginPointerDrag(pointer, event)}
                  >
                    <span className="queue-card-status">{statusLabels[event.status]} · {disciplineLabels[event.discipline]} · {seriesLabels[event.series]}</span>
                    <strong>{event.title}{bundleBadges(event, events).length > 0 ? <span className="queue-bundle-badges">{bundleBadges(event, events).map((badge) => <i key={badge}>{badge}</i>)}</span> : null}</strong>
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

      {editor && <EventEditor year={year} event={editor.event} initialData={editor.initialData} issues={issues} saving={saving} readOnly={editor.readOnly} parentCandidates={planningRoots} relatedEventCount={editor.event ? [...events, ...archivedEvents].filter((candidate) => candidate.parentEventId === editor.event?.id).length : 0} relatedEvents={editor.event ? events.filter((candidate) => candidate.parentEventId === editor.event?.id) : []} relatedAvailability={((): RelatedEventAvailability => {
        const children = editor.event ? events.filter((candidate) => candidate.parentEventId === editor.event?.id) : [];
        return { regional: children.some((candidate) => candidate.competitionStatus === 'Региональные соревнования'), physical: children.some((candidate) => candidate.competitionStatus === 'Физкультурное мероприятие') };
      })()} requireEkpConfirmation={editor.event?.source === 'ekp'} revisionConflict={editorConflict} onRefreshConflict={() => void refreshConflictEditor()} onCancel={() => { setEditor(null); setEditorConflict(null); setIssues([]); }} onSave={saveEditor} onArchive={editor.event && !editor.readOnly ? archiveEditor : undefined} onDelete={editor.event && !editor.readOnly ? deleteEditorEvent : undefined} onCopyToQueue={editor.event && !editor.readOnly ? () => void copyEventToQueue() : undefined} onOpenRelated={openEvent} onAddRelated={editor.event && !editor.readOnly ? () => openRelatedNew(editor.event!) : undefined} onDeleteRelated={editor.event && !editor.readOnly ? (relatedEvent) => void deleteRelatedEvent(relatedEvent) : undefined} />}
      {templateEditor && <EventEditor year={year} event={null} initialData={templateEditor} issues={issues} saving={saving} readOnly={false} templateMode onCancel={() => { setTemplateEditor(null); setIssues([]); }} onSave={(data) => saveMatchTemplate(data)} />}
    </main>
  );
}
