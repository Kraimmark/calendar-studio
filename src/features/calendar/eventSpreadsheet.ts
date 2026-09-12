import type { CalendarEvent, CalendarEventData, Discipline, EventSeries, EventStatus, VenueScope } from '../../domain/types';
import type { DateOnly } from '../../domain/dateOnly';
import { createEventData, normalizeStudioEventData } from './eventDraft';

export interface SpreadsheetEventRow {
  data: CalendarEventData;
  parentTitle: string | null;
}

const columns = ['Название', 'Дисциплина', 'Серия', 'Статус', 'Дата начала', 'Дата окончания', 'Основное', 'Родительское мероприятие', 'Организатор', 'Спортивный статус', 'Регион', 'Фаза / этап', 'Номер этапа', 'Площадка', 'География', 'Примечание', 'Цвет'];

const disciplines: Record<string, Discipline> = { 'пистолет': 'pistol', 'карабин': 'carbine', 'ружьё': 'shotgun', 'ружье': 'shotgun', 'пневматика': 'airgun', 'мультиган': 'multigun', 'другое': 'other', pistol: 'pistol', carbine: 'carbine', shotgun: 'shotgun', airgun: 'airgun', multigun: 'multigun', other: 'other' };
const series: Record<string, EventSeries> = { 'обычная': 'regular', 'трф': 'trf', 'всероссийская': 'allRussian', 'ведомственная': 'departmental', 'кубок спб': 'spbCup', 'другая': 'other', regular: 'regular', trf: 'trf', allrussian: 'allRussian', departmental: 'departmental', spbcup: 'spbCup', other: 'other' };
const statuses: Record<string, EventStatus> = { 'черновик': 'draft', 'предварительно': 'tentative', 'подтверждено': 'confirmed', draft: 'draft', tentative: 'tentative', confirmed: 'confirmed' };
const scopes: Record<string, VenueScope> = { 'сск «невский»': 'nevsky', 'санкт-петербург': 'spb', 'другой регион': 'otherRegion', 'не указано': 'unspecified', nevsky: 'nevsky', spb: 'spb', otherregion: 'otherRegion', unspecified: 'unspecified' };

const labels = {
  discipline: { pistol: 'Пистолет', carbine: 'Карабин', shotgun: 'Ружьё', airgun: 'Пневматика', multigun: 'Мультиган', other: 'Другое' } satisfies Record<Discipline, string>,
  series: { regular: 'Обычная', trf: 'ТРФ', allRussian: 'Всероссийская', departmental: 'Ведомственная', spbCup: 'Кубок СПб', other: 'Другая' } satisfies Record<EventSeries, string>,
  status: { draft: 'Черновик', tentative: 'Предварительно', confirmed: 'Подтверждено' } satisfies Record<EventStatus, string>,
  scope: { nevsky: 'ССК «Невский»', spb: 'Санкт-Петербург', otherRegion: 'Другой регион', unspecified: 'Не указано' } satisfies Record<VenueScope, string>,
};

function normal(value: string | undefined): string { return (value ?? '').trim().toLowerCase(); }
function escape(value: string | null | number | boolean): string {
  const text = String(value ?? '');
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseDelimited(text: string): string[][] {
  const delimiter = text.includes('\t') && !text.includes(';') ? '\t' : ';';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field.trim()); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; field = '';
    } else field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function exportSpreadsheet(events: readonly (CalendarEvent | CalendarEventData)[]): string {
  const parentTitles = new Map<string, string>();
  for (const event of events) if ('id' in event) parentTitles.set(event.id, event.title);
  const rows = events.map((event) => [
    event.title, labels.discipline[event.discipline], labels.series[event.series], labels.status[event.status], event.startDate ?? '', event.endDate ?? '', event.isPrimary ? 'Да' : 'Нет',
    event.parentEventId ? parentTitles.get(event.parentEventId) ?? '' : '', event.organizerName, event.competitionStatus ?? '', event.competitionRegion ?? '', event.competitionPhase ?? '', event.competitionStageNumber ?? '', event.venue, labels.scope[event.venueScope], event.notes, event.stickerColor,
  ].map(escape).join(';'));
  return `\ufeff${columns.map(escape).join(';')}\r\n${rows.join('\r\n')}\r\n`;
}

export function importSpreadsheet(text: string): SpreadsheetEventRow[] {
  const rows = parseDelimited(text.replace(/^\ufeff/, ''));
  if (rows.length < 2) return [];
  const header = rows[0]!.map((value) => normal(value));
  const index = (name: string) => header.indexOf(normal(name));
  const get = (row: string[], name: string) => { const position = index(name); return position < 0 ? '' : row[position] ?? ''; };
  if (index('Название') < 0) throw new Error('В шаблоне нет обязательной колонки «Название». Выгрузите новый шаблон и заполните его.');
  return rows.slice(1).flatMap((row, rowIndex) => {
    const title = get(row, 'Название').trim();
    if (!title) return [];
    const draft = createEventData();
    const color = get(row, 'Цвет').trim();
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Строка ${rowIndex + 2}: цвет должен быть в формате #RRGGBB.`);
    const stageText = get(row, 'Номер этапа').trim();
    const stage = stageText ? Number(stageText) : null;
    if (stageText && (!Number.isInteger(stage) || (stage ?? 0) < 1)) throw new Error(`Строка ${rowIndex + 2}: номер этапа должен быть положительным целым числом.`);
    const date = (name: string): DateOnly | null => { const value = get(row, name).trim(); return value ? value as DateOnly : null; };
    return [{
      parentTitle: get(row, 'Родительское мероприятие').trim() || null,
      data: normalizeStudioEventData({
        ...draft, title, discipline: disciplines[normal(get(row, 'Дисциплина'))] ?? draft.discipline, series: series[normal(get(row, 'Серия'))] ?? draft.series,
        status: statuses[normal(get(row, 'Статус'))] ?? draft.status, startDate: date('Дата начала'), endDate: date('Дата окончания'),
        isPrimary: !['нет', 'false', '0'].includes(normal(get(row, 'Основное'))), organizerName: get(row, 'Организатор'), competitionStatus: get(row, 'Спортивный статус').trim() || null,
        competitionRegion: get(row, 'Регион').trim() || null, competitionPhase: get(row, 'Фаза / этап').trim() || null, competitionStageNumber: stage,
        venue: get(row, 'Площадка'), venueScope: scopes[normal(get(row, 'География'))] ?? draft.venueScope, notes: get(row, 'Примечание'), stickerColor: color || draft.stickerColor,
      }),
    }];
  });
}
