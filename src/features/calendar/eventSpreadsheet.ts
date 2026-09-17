import type { CalendarEvent, CalendarEventData, Discipline, EventSeries, EventStatus, VenueScope } from '../../domain/types';
import { formatDateOnly, parseDateOnly, type DateOnly } from '../../domain/dateOnly';
import { createEventData, normalizeStudioEventData } from './eventDraft';

export interface SpreadsheetEventRow {
  data: CalendarEventData;
  parentTitle: string | null;
}

const columns = ['Название', 'Дисциплина', 'Серия', 'Статус', 'Дата начала', 'Дата окончания', 'Основное', 'Родительское мероприятие', 'Организатор', 'Спортивный статус', 'Регион', 'Фаза / этап', 'Номер этапа', 'Площадка', 'География', 'Примечание', 'Цвет'];

const disciplines: Record<string, Discipline> = { 'пистолет': 'pistol', 'карабин': 'carbine', 'кпк': 'cpc', 'карабин пистолетного калибра': 'cpc', 'ружьё': 'shotgun', 'ружье': 'shotgun', 'пневматика': 'airgun', 'мультиган': 'multigun', 'другое': 'other', pistol: 'pistol', carbine: 'carbine', cpc: 'cpc', shotgun: 'shotgun', airgun: 'airgun', multigun: 'multigun', other: 'other' };
const series: Record<string, EventSeries> = { 'обычная': 'regular', 'трф': 'trf', 'всероссийская': 'allRussian', 'ведомственная': 'departmental', 'кубок спб': 'spbCup', 'другая': 'other', regular: 'regular', trf: 'trf', allrussian: 'allRussian', departmental: 'departmental', spbcup: 'spbCup', other: 'other' };
const statuses: Record<string, EventStatus> = { 'черновик': 'draft', 'предварительно': 'tentative', 'подтверждено': 'confirmed', draft: 'draft', tentative: 'tentative', confirmed: 'confirmed' };
const scopes: Record<string, VenueScope> = { 'сск «невский»': 'nevsky', 'санкт-петербург': 'spb', 'другой регион': 'otherRegion', 'не указано': 'unspecified', nevsky: 'nevsky', spb: 'spb', otherregion: 'otherRegion', unspecified: 'unspecified' };

const labels = {
  discipline: { pistol: 'Пистолет', carbine: 'Карабин', cpc: 'КПК', shotgun: 'Ружьё', airgun: 'Пневматика', multigun: 'Мультиган', other: 'Другое' } satisfies Record<Discipline, string>,
  series: { regular: 'Обычная', trf: 'ТРФ', allRussian: 'Всероссийская', departmental: 'Ведомственная', spbCup: 'Кубок СПб', other: 'Другая' } satisfies Record<EventSeries, string>,
  status: { draft: 'Черновик', tentative: 'Предварительно', confirmed: 'Подтверждено' } satisfies Record<EventStatus, string>,
  scope: { nevsky: 'ССК «Невский»', spb: 'Санкт-Петербург', otherRegion: 'Другой регион', unspecified: 'Не указано' } satisfies Record<VenueScope, string>,
};

function normal(value: string | undefined): string { return (value ?? '').trim().toLowerCase(); }
function dateFromParts(day: number, month: number, year: number, row: number, column: string): DateOnly {
  try {
    return formatDateOnly({ day, month, year });
  } catch {
    throw new Error(`Строка ${row}: в колонке «${column}» укажите корректную дату.`);
  }
}

function excelSerialDate(value: string): DateOnly | null {
  // Excel's 1900 date system is offset by its historical fictitious 29 February 1900.
  if (!/^\d{1,6}(?:[.,]0+)?$/.test(value)) return null;
  const serial = Math.trunc(Number(value.replace(',', '.')));
  if (!Number.isFinite(serial) || serial < 1 || serial > 75000) return null;
  const instant = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
  return formatDateOnly({ year: instant.getUTCFullYear(), month: instant.getUTCMonth() + 1, day: instant.getUTCDate() });
}

const russianMonths: Record<string, number> = {
  'января': 1, 'январь': 1, 'февраля': 2, 'февраль': 2, 'марта': 3, 'март': 3, 'апреля': 4, 'апрель': 4,
  'мая': 5, 'май': 5, 'июня': 6, 'июнь': 6, 'июля': 7, 'июль': 7, 'августа': 8, 'август': 8,
  'сентября': 9, 'сентябрь': 9, 'октября': 10, 'октябрь': 10, 'ноября': 11, 'ноябрь': 11, 'декабря': 12, 'декабрь': 12,
};
const englishMonths: Record<string, number> = {
  'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3, 'apr': 4, 'april': 4,
  'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7, 'aug': 8, 'august': 8, 'sep': 9, 'sept': 9, 'september': 9,
  'oct': 10, 'october': 10, 'nov': 11, 'november': 11, 'dec': 12, 'december': 12,
};

function fullYear(value: string): number {
  const year = Number(value);
  return value.length === 2 ? (year >= 70 ? 1900 + year : 2000 + year) : year;
}

/** Normalises text rendered by Excel, LibreOffice and manually edited CSV/TSV templates. */
export function parseSpreadsheetDate(value: string, row: number, column: string): DateOnly | null {
  const source = value.replace(/[\u00a0\u202f]/g, ' ').trim().replace(/^'+|'+$/g, '');
  if (!source) return null;
  if (parseDateOnly(source)) return source as DateOnly;
  const withoutTime = source.replace(/[T\s]+\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*[+-]\d{2}:?\d{2}|\s*Z)?$/i, '');
  const iso = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(withoutTime);
  if (iso) return dateFromParts(Number(iso[3]), Number(iso[2]), Number(iso[1]), row, column);
  const compactIso = /^(\d{4})(\d{2})(\d{2})$/.exec(withoutTime);
  if (compactIso) return dateFromParts(Number(compactIso[3]), Number(compactIso[2]), Number(compactIso[1]), row, column);
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(withoutTime);
  if (dmy) return dateFromParts(Number(dmy[1]!), Number(dmy[2]!), fullYear(dmy[3]!), row, column);
  const monthByName = /^(\d{1,2})\s+([\p{L}.]+)\s+(\d{2,4})$/iu.exec(withoutTime);
  if (monthByName) {
    const key = normal(monthByName[2]).replace(/\.$/, '');
    const month = russianMonths[key] ?? englishMonths[key];
    if (month) return dateFromParts(Number(monthByName[1]!), month, fullYear(monthByName[3]!), row, column);
  }
  const englishMonthFirst = /^([\p{L}.]+)\s+(\d{1,2}),?\s+(\d{2,4})$/iu.exec(withoutTime);
  if (englishMonthFirst) {
    const month = englishMonths[normal(englishMonthFirst[1]).replace(/\.$/, '')];
    if (month) return dateFromParts(Number(englishMonthFirst[2]!), month, fullYear(englishMonthFirst[3]!), row, column);
  }
  const serial = excelSerialDate(withoutTime);
  if (serial) return serial;
  throw new Error(`Строка ${row}: в колонке «${column}» укажите корректную дату. Поддерживаются даты Excel, ГГГГ-ММ-ДД, ДД.ММ.ГГГГ, ДД/ММ/ГГГГ и даты с названием месяца.`);
}
function escape(value: string | null | number | boolean): string {
  const text = String(value ?? '');
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };
  let quoted = false;
  for (let index = 0; index < firstLine.length; index += 1) {
    const char = firstLine[index]!;
    if (char === '"' && firstLine[index + 1] === '"') { index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char in counts) counts[char] = counts[char]! + 1;
  }
  return Object.entries(counts).sort((left, right) => right[1] - left[1])[0]?.[0] ?? ';';
}

function parseDelimited(text: string): string[][] {
  const delimiter = detectDelimiter(text);
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
    event.title, labels.discipline[event.discipline], labels.series[event.series], labels.status[event.status], event.startDate ? event.startDate.split('-').reverse().join('.') : '', event.endDate ? event.endDate.split('-').reverse().join('.') : '', event.isPrimary ? 'Да' : 'Нет',
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
    const date = (name: string): DateOnly | null => parseSpreadsheetDate(get(row, name), rowIndex + 2, name);
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
