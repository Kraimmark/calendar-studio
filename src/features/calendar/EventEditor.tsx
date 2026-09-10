import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { calculateShiftDaylightWarnings } from '../../domain/daylight';
import type { CalendarEvent, CalendarEventData, Discipline, EventKind, EventSeries, EventSource, EventStatus, ShiftKind, VenueScope } from '../../domain/types';
import type { ValidationIssue } from '../../domain/validation';
import { archiveConfirmationMessage, daylightConfirmationKey, requiresDiscardConfirmation } from './confirmationState';

interface EventEditorProps {
  year: number;
  event: CalendarEvent | null;
  initialData: CalendarEventData;
  issues: ValidationIssue[];
  saving: boolean;
  onCancel: () => void;
  onSave: (data: CalendarEventData) => void;
  onArchive?: () => void;
  readOnly?: boolean;
  parentCandidates?: CalendarEvent[];
  requireEkpConfirmation?: boolean;
  revisionConflict?: { expectedRevision: number; actualRevision: number } | null;
  onRefreshConflict?: () => void;
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

export function EventEditor({ year, event, initialData, issues, saving, onCancel, onSave, onArchive, readOnly = false, parentCandidates = [], requireEkpConfirmation = false, revisionConflict = null, onRefreshConflict }: EventEditorProps) {
  const [draft, setDraft] = useState<CalendarEventData>(() => structuredClone(initialData));
  const [ekpConfirmed, setEkpConfirmed] = useState(false);
  const [daylightConfirmed, setDaylightConfirmed] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const savingRef = useRef(saving);
  const cancelRef = useRef(onCancel);

  useEffect(() => { setDraft(structuredClone(initialData)); setEkpConfirmed(false); setDaylightConfirmed(false); }, [initialData]);
  useEffect(() => { savingRef.current = saving; }, [saving]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initialData), [draft, initialData]);
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
  const daylightWarnings = useMemo(() => calculateShiftDaylightWarnings(draft), [draft]);
  const daylightWarningKey = useMemo(() => daylightConfirmationKey(daylightWarnings), [daylightWarnings]);
  useEffect(() => { setDaylightConfirmed(false); }, [daylightWarningKey]);
  const needsDaylightConfirmation = !readOnly && dirty && daylightWarnings.length > 0;
  const patch = <K extends keyof CalendarEventData>(key: K, value: CalendarEventData[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const updateShift = (id: string, changes: Partial<CalendarEventData['shifts'][number]>) => setDraft((current) => ({ ...current, shifts: current.shifts.map((shift) => shift.id === id ? { ...shift, ...changes } : shift) }));
  const addShift = () => setDraft((current) => ({ ...current, shifts: [...current.shifts, { id: crypto.randomUUID(), name: `Смена ${current.shifts.length + 1}`, kind: 'day', startsAt: '10:00', endsAt: '18:00' }] }));
  const removeShift = (id: string) => setDraft((current) => ({ ...current, shifts: current.shifts.filter((shift) => shift.id !== id) }));

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(mouse: ReactMouseEvent<HTMLDivElement>) => { if (mouse.target === mouse.currentTarget) requestClose(); }}>
      <section ref={dialogRef} className="event-editor" role="dialog" aria-modal="true" aria-labelledby="event-editor-title" tabIndex={-1}>
        <header className="editor-header">
          <div>
            <p className="eyebrow">{readOnly ? `ПРОСМОТР · РЕДАКЦИЯ ${event?.revision ?? 0}` : event ? `РЕДАКЦИЯ ${event.revision}` : 'НОВОЕ МЕРОПРИЯТИЕ'}</p>
            <h2 id="event-editor-title">{event ? event.title : `Календарь ${year}`}</h2>
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
              <label className="field">Начало
                <input type="date" min={`${year}-01-01`} max={`${year}-12-31`} value={draft.startDate ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('startDate', (e.target.value || null) as CalendarEventData['startDate'])} />
              </label>
              <label className="field">Окончание
                <input type="date" min={`${year}-01-01`} max={`${year}-12-31`} value={draft.endDate ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('endDate', (e.target.value || null) as CalendarEventData['endDate'])} />
              </label>
              <label className="field">Оценка упражнений
                <input type="number" min="1" max="40" value={draft.plannedExerciseCount ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('plannedExerciseCount', nullableNumber(e.target.value))} />
              </label>
              <label className="field">Оценка скводов
                <input type="number" min="1" max="80" value={draft.plannedSquadCount ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('plannedSquadCount', nullableNumber(e.target.value))} />
              </label>
              <label className="field field-wide">Родительское мероприятие
                <select value={draft.parentEventId ?? ''} onChange={(e: ChangeEvent<HTMLSelectElement>) => patch('parentEventId', e.target.value || null)}>
                  <option value="">Без родительского мероприятия</option>
                  {parentCandidates.filter((candidate) => candidate.id !== event?.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
                </select>
              </label>
            </div>
            <label className="check-field"><input type="checkbox" checked={draft.isPrimary} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('isPrimary', e.target.checked)} /> Основное мероприятие</label>
          </fieldset>

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
            <legend>Регистрация</legend>
            <div className="form-grid two-columns">
              <label className="field">Режим
                <select value={draft.registration.mode} onChange={(e: ChangeEvent<HTMLSelectElement>) => patch('registration', { ...draft.registration, mode: e.target.value as CalendarEventData['registration']['mode'] })}>
                  <option value="free">Свободная / без расписания</option>
                  <option value="scheduled">По датам</option>
                </select>
              </label>
              {draft.registration.mode === 'scheduled' && <>
                <label className="field">Открытие
                  <input type="date" value={draft.registration.opensAt ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('registration', { ...draft.registration, opensAt: (e.target.value || null) as CalendarEventData['registration']['opensAt'] })} />
                </label>
                <label className="field">Закрытие
                  <input type="date" value={draft.registration.closesAt ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('registration', { ...draft.registration, closesAt: (e.target.value || null) as CalendarEventData['registration']['closesAt'] })} />
                </label>
              </>}
            </div>
            <label className="check-field"><input type="checkbox" checked={draft.registration.priorityOneAlerts} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('registration', { ...draft.registration, priorityOneAlerts: e.target.checked })} /> Уведомления первой степени</label>
          </fieldset>

          <fieldset className="form-section" disabled={readOnly}>
            <legend>Смены и световое окно</legend>
            <div className="form-grid two-columns">
              <label className="field">Резерв светового окна, минут
                <input type="number" min="0" max="120" value={draft.daylightBufferMinutes} onChange={(e: ChangeEvent<HTMLInputElement>) => patch('daylightBufferMinutes', Number(e.target.value))} />
              </label>
            </div>
            <div className="shift-list">
              {draft.shifts.map((shift) => (
                <div className="shift-row" key={shift.id}>
                  <label className="field">Название
                    <input value={shift.name} onChange={(e: ChangeEvent<HTMLInputElement>) => updateShift(shift.id, { name: e.target.value })} />
                  </label>
                  <label className="field">Тип
                    <select value={shift.kind} onChange={(e: ChangeEvent<HTMLSelectElement>) => updateShift(shift.id, { kind: e.target.value as ShiftKind })}>
                      <option value="day">Дневная</option>
                      <option value="night">Ночная</option>
                    </select>
                  </label>
                  <label className="field">Начало
                    <input type="time" value={shift.startsAt} onChange={(e: ChangeEvent<HTMLInputElement>) => updateShift(shift.id, { startsAt: e.target.value })} />
                  </label>
                  <label className="field">Окончание
                    <input type="time" value={shift.endsAt} onChange={(e: ChangeEvent<HTMLInputElement>) => updateShift(shift.id, { endsAt: e.target.value })} />
                  </label>
                  <button className="button button-danger shift-remove" type="button" onClick={() => removeShift(shift.id)}>Удалить</button>
                </div>
              ))}
            </div>
            <button className="button button-secondary" type="button" onClick={addShift}>Добавить смену</button>
          </fieldset>

          <fieldset className="form-section" disabled={readOnly}>
            <legend>Рабочий комментарий</legend>
            <label className="field"><textarea rows={5} value={draft.notes} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patch('notes', e.target.value)} /></label>
          </fieldset>
        </div>

        {needsDaylightConfirmation && (
          <label className="danger-confirmation danger-confirmation-red">
            <input type="checkbox" checked={daylightConfirmed} onChange={(change: ChangeEvent<HTMLInputElement>) => setDaylightConfirmed(change.target.checked)} />
            <span><strong>Подтверждаю выход смены за безопасное световое окно.</strong> {daylightWarnings.slice(0, 3).map((warning) => warning.message).join(' ')}</span>
          </label>
        )}

        {needsEkpConfirmation && (
          <label className="danger-confirmation">
            <input type="checkbox" checked={ekpConfirmed} onChange={(change: ChangeEvent<HTMLInputElement>) => setEkpConfirmed(change.target.checked)} />
            <span><strong>Подтверждаю ручное изменение записи ЕКП.</strong> Запись получена из официального источника, и это изменение будет осознанно сохранено как локальная редакция.</span>
          </label>
        )}

        <footer className="editor-footer">
          <div>{!readOnly && event && onArchive ? <button className="button button-danger" type="button" onClick={requestArchive} disabled={saving}>Архивировать</button> : null}</div>
          <div className="editor-actions">
            <button className="button button-secondary" type="button" onClick={requestClose} disabled={saving}>{readOnly ? 'Закрыть' : 'Отмена'}</button>
            {!readOnly && <button className="button button-primary" type="button" onClick={() => onSave(draft)} disabled={saving || (needsEkpConfirmation && !ekpConfirmed) || (needsDaylightConfirmation && !daylightConfirmed)}>{saving ? 'Сохранение…' : 'Сохранить'}</button>}
          </div>
        </footer>
      </section>
    </div>
  );
}
