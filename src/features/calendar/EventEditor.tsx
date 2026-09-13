import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type { CalendarEvent, CalendarEventData, Discipline, EventKind, EventSeries, EventSource, EventStatus, VenueScope } from '../../domain/types';
import type { ValidationIssue } from '../../domain/validation';
import { archiveConfirmationMessage, permanentDeleteConfirmationMessage, requiresDiscardConfirmation } from './confirmationState';
import { normalizeStudioEventData } from './eventDraft';

export interface RelatedEventSelection {
  regional: boolean;
  physical: boolean;
}

export interface RelatedEventAvailability {
  regional: boolean;
  physical: boolean;
}

interface EventEditorProps {
  year: number;
  event: CalendarEvent | null;
  initialData: CalendarEventData;
  issues: ValidationIssue[];
  saving: boolean;
  onCancel: () => void;
  onSave: (data: CalendarEventData, related: RelatedEventSelection) => void;
  onArchive?: () => void;
  onDelete?: () => void;
  relatedEventCount?: number;
  readOnly?: boolean;
  parentCandidates?: CalendarEvent[];
  requireEkpConfirmation?: boolean;
  revisionConflict?: { expectedRevision: number; actualRevision: number } | null;
  onRefreshConflict?: () => void;
  relatedAvailability?: RelatedEventAvailability;
  templateMode?: boolean;
  onCopyToQueue?: () => void;
}

const kinds: Array<[EventKind, string]> = [['match', 'Матч'], ['utm', 'УТМ / тренировка'], ['build', 'Застройка']];
const disciplines: Array<[Discipline, string]> = [['pistol', 'Пистолет'], ['carbine', 'Карабин'], ['shotgun', 'Ружьё'], ['airgun', 'Пневматика'], ['multigun', 'Мультиган'], ['other', 'Другое']];
const series: Array<[EventSeries, string]> = [['regular', 'Обычная'], ['trf', 'ТРФ'], ['allRussian', 'Всероссийская'], ['departmental', 'Ведомственная'], ['spbCup', 'Кубок СПб'], ['other', 'Другая']];
const statuses: Array<[EventStatus, string]> = [['draft', 'Черновик'], ['tentative', 'Предварительно'], ['confirmed', 'Подтверждено']];
const sources: Array<[EventSource, string]> = [['manual', 'Ручной ввод'], ['ekp', 'ЕКП']];
const scopes: Array<[VenueScope, string]> = [['nevsky', 'ССК «Невский»'], ['spb', 'Санкт-Петербург'], ['otherRegion', 'Другой регион'], ['unspecified', 'Не указано']];

function nullableNumber(value: string): number | null {
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function EventEditor({ year, event, initialData, issues, saving, onCancel, onSave, onArchive, onDelete, relatedEventCount = 0, readOnly = false, parentCandidates = [], requireEkpConfirmation = false, revisionConflict = null, onRefreshConflict, relatedAvailability = { regional: false, physical: false }, templateMode = false, onCopyToQueue }: EventEditorProps) {
  const normalizedInitialData = useMemo(() => normalizeStudioEventData(initialData), [initialData]);
  const [draft, setDraft] = useState<CalendarEventData>(() => structuredClone(normalizedInitialData));
  const [ekpConfirmed, setEkpConfirmed] = useState(false);
  const [related, setRelated] = useState<RelatedEventSelection>({ regional: false, physical: false });
  const dialogRef = useRef<HTMLElement | null>(null);
  const savingRef = useRef(saving);
  const cancelRef = useRef(onCancel);

  useEffect(() => { setDraft(structuredClone(normalizedInitialData)); setEkpConfirmed(false); setRelated({ regional: false, physical: false }); }, [normalizedInitialData]);
  useEffect(() => { savingRef.current = saving; }, [saving]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(normalizedInitialData), [draft, normalizedInitialData]);
  const requestClose = useCallback(() => {
    if (savingRef.current) return;
    if (requiresDiscardConfirmation(dirty, readOnly) && !window.confirm('Закрыть редактор? Несохранённые изменения будут потеряны.')) return;
    onCancel();
  }, [dirty, onCancel, readOnly]);
  const requestArchive = useCallback(() => {
    if (savingRef.current || !onArchive) return;
    if (!window.confirm(archiveConfirmationMessage(dirty))) return;
    onArchive();
  }, [dirty, onArchive]);
  const requestDelete = useCallback(() => {
    if (savingRef.current || !onDelete || !event) return;
    if (!window.confirm(permanentDeleteConfirmationMessage(event.title, dirty, relatedEventCount))) return;
    onDelete();
  }, [dirty, event, onDelete, relatedEventCount]);
  useEffect(() => { cancelRef.current = requestClose; }, [requestClose]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => !element.hasAttribute('hidden') && element.offsetParent !== null);
    const initial = dialog.querySelector<HTMLElement>('[autofocus]') ?? focusable()[0] ?? dialog;
    initial.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!savingRef.current) {
          event.preventDefault();
          cancelRef.current();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', onKey);
    return () => {
      dialog.removeEventListener('keydown', onKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const groupedIssues = useMemo(() => issues.filter((issue) => issue.severity === 'error'), [issues]);
  useEffect(() => { setEkpConfirmed(false); }, [draft]);
  const needsEkpConfirmation = !readOnly && requireEkpConfirmation && dirty;
  const patch = <K extends keyof CalendarEventData>(key: K, value: CalendarEventData[K]) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(mouse: ReactMouseEvent<HTMLDivElement>) => { if (mouse.target === mouse.currentTarget) requestClose(); }}>
      <section ref={dialogRef} className="event-editor" role="dialog" aria-modal="true" aria-labelledby="event-editor-title" tabIndex={-1}>
        <header className="editor-header">
          <div>
            <p className="eyebrow">{templateMode ? 'НОВЫЙ ШАБЛОН' : readOnly ? `ПРОСМОТР · РЕДАКЦИЯ ${event?.revision ?? 0}` : event ? `РЕДАКЦИЯ ${event.revision}` : 'НОВОЕ МЕРОПРИЯТИЕ'}</p>
            <h2 id="event-editor-title">{templateMode ? 'Шаблон для корзины' : event ? event.title : `Календарь ${year}`}</h2>
          </div>
          <button className="button button-secondary" type="button" onClick={requestClose} disabled={saving}>Закрыть</button>
        </header>

        {groupedIssues.length > 0 && (
          <div className="validation-summary" role="alert">
            <strong>Проверьте форму</strong>
            <ul>{groupedIssues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>
          </div>
        )}

        {revisionConflict && (
          <div className="revision-conflict" role="alert">
            <div>
              <strong>Запись уже изменилась после открытия формы.</strong>
              <span>Открыта редакция {revisionConflict.expectedRevision}, актуальная — {revisionConflict.actualRevision}. Ваши несохранённые изменения пока остаются в форме.</span>
            </div>
            {onRefreshConflict && <button className="button button-secondary" type="button" disabled={saving} onClick={() => { if (!dirty || window.confirm('Обновить форму актуальной редакцией? Несохранённые изменения будут отброшены.')) onRefreshConflict(); }}>Обновить форму</button>}
          </div>
        )}

        <div className="editor-scroll">
          <fieldset className="form-section" disabled={readOnly}>
            <legend>Основное</legend>
            <div className="form-grid two-columns">
              <label className="field field-wide">Название
                <input autoFocus value={draft.title} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('title', e.target.value)} />
              </label>
              <label className="field field-wide">Организатор
                <input value={draft.organizerName} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('organizerName', e.target.value)} placeholder="Текстовый организатор для первого релиза" />
              </label>
              <label className="field">Спортивный статус
                <input value={draft.competitionStatus ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('competitionStatus', e.target.value || null)} />
              </label>
              <label className="field">Регион
                <input value={draft.competitionRegion ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('competitionRegion', e.target.value || null)} />
              </label>
              <label className="field">Фаза / этап
                <input value={draft.competitionPhase ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('competitionPhase', e.target.value || null)} />
              </label>
              <label className="field">Номер этапа
                <input type="number" min="1" value={draft.competitionStageNumber ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('competitionStageNumber', nullableNumber(e.target.value))} />
              </label>
              <label className="field">Тип
                <select value={draft.kind} onChange={(e: ChangeEvent<HTMLSelectElement>) => patch('kind', e.target.value as EventKind)}>{kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              </label>
              <label className="field">Дисциплина
                <select value={draft.discipline} onChange={(e: ChangeEvent<HTMLSelectElement>) => patch('discipline', e.target.value as Discipline)}>{disciplines.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              </label>
              <label className="field">Серия
                <select value={draft.series} onChange={(e: ChangeEvent<HTMLSelectElement>) => patch('series', e.target.value as EventSeries)}>{series.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              </label>
              <label className="field">Состояние
                <select value={draft.status} onChange={(e: ChangeEvent<HTMLSelectElement>) => patch('status', e.target.value as EventStatus)}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              </label>
              {!templateMode && <>
                <label className="field">Начало
                  <input type="date" min={`${year}-01-01`} max={`${year}-12-31`} value={draft.startDate ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('startDate', (e.target.value || null) as CalendarEventData['startDate'])} />
                </label>
                <label className="field">Окончание
                  <input type="date" min={`${year}-01-01`} max={`${year}-12-31`} value={draft.endDate ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('endDate', (e.target.value || null) as CalendarEventData['endDate'])} />
                </label>
              </>}
              <label className="field">Оценка упражнений
                <input type="number" min="1" max="40" value={draft.plannedExerciseCount ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('plannedExerciseCount', nullableNumber(e.target.value))} />
              </label>
              <label className="field">Оценка скводов
                <input type="number" min="1" max="80" value={draft.plannedSquadCount ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('plannedSquadCount', nullableNumber(e.target.value))} />
              </label>
              {!templateMode && <label className="field field-wide">Родительское мероприятие
                <select value={draft.parentEventId ?? ''} onChange={(e: ChangeEvent<HTMLSelectElement>) => patch('parentEventId', e.target.value || null)}>
                  <option value="">Без родительского мероприятия</option>
                  {parentCandidates.filter((candidate) => candidate.id !== event?.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
                </select>
              </label>}
            </div>
            <label className="check-field"><input type="checkbox" checked={draft.isPrimary} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('isPrimary', e.target.checked)} /> Основное мероприятие</label>
          </fieldset>

          {!templateMode && !draft.parentEventId && (
            <fieldset className="form-section related-events" disabled={readOnly}>
              <legend>{event ? 'Досоздать дочерние мероприятия' : 'Создать дочерние мероприятия'}</legend>
              <p className="form-copy">Связанные записи получат ту же дисциплину и те же даты, что и это мероприятие.</p>
              <label className="check-field">
                <input type="checkbox" checked={related.regional} disabled={relatedAvailability.regional} onChange={(change: ChangeEvent<HTMLInputElement>) => setRelated((current) => ({ ...current, regional: change.target.checked }))} />
                Региональные соревнования{relatedAvailability.regional ? ' — уже есть' : ''}
              </label>
              <label className="check-field">
                <input type="checkbox" checked={related.physical} disabled={relatedAvailability.physical} onChange={(change: ChangeEvent<HTMLInputElement>) => setRelated((current) => ({ ...current, physical: change.target.checked }))} />
                Физкультурное мероприятие{relatedAvailability.physical ? ' — уже есть' : ''}
              </label>
            </fieldset>
          )}

          <fieldset className="form-section" disabled={readOnly}>
            <legend>Источник и площадка</legend>
            <div className="form-grid two-columns">
              <label className="field">Источник
                <select value={draft.source} onChange={(e: ChangeEvent<HTMLSelectElement>) => patch('source', e.target.value as EventSource)}>{sources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              </label>
              <label className="field">География
                <select value={draft.venueScope} onChange={(e: ChangeEvent<HTMLSelectElement>) => patch('venueScope', e.target.value as VenueScope)}>{scopes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              </label>
              <label className="field field-wide">Площадка
                <input value={draft.venue} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('venue', e.target.value)} />
              </label>
              {draft.source === 'ekp' && <>
                <label className="field">Уровень ЕКП
                  <input value={draft.ekpLevel ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('ekpLevel', e.target.value || null)} />
                </label>
                <label className="field">Номер / этап ЕКП
                  <input type="number" min="1" value={draft.ekpStageNumber ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('ekpStageNumber', nullableNumber(e.target.value))} />
                </label>
              </>}
              <label className="field">Акцент карточки
                <input type="color" value={draft.stickerColor} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('stickerColor', e.target.value)} />
              </label>
            </div>
          </fieldset>

          <fieldset className="form-section" disabled={readOnly}>
            <legend>Рабочий комментарий</legend>
            <label className="field"><textarea rows={5} value={draft.notes} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patch('notes', e.target.value)} /></label>
          </fieldset>
          {needsEkpConfirmation && (
            <label className="danger-confirmation">
              <input type="checkbox" checked={ekpConfirmed} onChange={(change: ChangeEvent<HTMLInputElement>) => setEkpConfirmed(change.target.checked)} />
              <span><strong>Подтверждаю ручное изменение записи ЕКП.</strong> Запись получена из официального источника, и это изменение будет осознанно сохранено как локальная редакция.</span>
            </label>
          )}
        </div>

        <footer className="editor-footer">
          <div className="editor-danger-actions">
            {!readOnly && event && onArchive ? <button className="button button-danger" type="button" onClick={requestArchive} disabled={saving}>Архивировать</button> : null}
            {!readOnly && event && onDelete ? <button className="button button-danger button-danger-quiet" type="button" onClick={requestDelete} disabled={saving}>Удалить навсегда</button> : null}
            {!readOnly && event && onCopyToQueue ? <button className="button button-secondary" type="button" onClick={onCopyToQueue} disabled={saving}>Копировать в корзину</button> : null}
          </div>
          <div className="editor-actions">
            <button className="button button-secondary" type="button" onClick={requestClose} disabled={saving}>{readOnly ? 'Закрыть' : 'Отмена'}</button>
            {!readOnly && <button className="button button-primary" type="button" onClick={() => onSave(normalizeStudioEventData(draft), related)} disabled={saving || (needsEkpConfirmation && !ekpConfirmed)}>{saving ? 'Сохранение…' : templateMode ? 'Сохранить шаблон' : related.regional || related.physical ? 'Сохранить и создать' : 'Сохранить'}</button>}
          </div>
        </footer>
      </section>
    </div>
  );
}
