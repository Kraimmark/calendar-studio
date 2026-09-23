import type { CalendarEvent, EventKind, EventSeries } from './types';

export type CalendarDayBackgroundKey =
  | 'allRussian'
  | 'regional'
  | 'spbCup'
  | 'trf'
  | 'departmental'
  | 'other'
  | 'utm'
  | 'build';

export const DAY_BACKGROUND_ORDER: CalendarDayBackgroundKey[] = [
  'allRussian',
  'regional',
  'spbCup',
  'trf',
  'departmental',
  'other',
  'utm',
  'build',
];

export const DAY_BACKGROUND_LABELS: Record<CalendarDayBackgroundKey, string> = {
  allRussian: 'Всероссийские',
  regional: 'Региональные',
  spbCup: 'Кубки СПб',
  trf: 'ТРФ',
  departmental: 'Ведомственные',
  other: 'Прочие',
  utm: 'УТМ / тренировки',
  build: 'Застройка',
};

export const DEFAULT_DAY_BACKGROUND_COLORS: Record<CalendarDayBackgroundKey, string> = {
  allRussian: '#8f63ff',
  regional: '#d1a35b',
  spbCup: '#d06c7f',
  trf: '#c94b4b',
  departmental: '#569f8f',
  other: '#8a929c',
  utm: '#648a8f',
  build: '#9a7b52',
};

const categoryBySeries: Record<EventSeries, CalendarDayBackgroundKey> = {
  allRussian: 'allRussian',
  regular: 'regional',
  spbCup: 'spbCup',
  trf: 'trf',
  departmental: 'departmental',
  other: 'other',
};

const categoryByKind: Partial<Record<EventKind, CalendarDayBackgroundKey>> = {
  utm: 'utm',
  build: 'build',
};

export function dayBackgroundCategory(event: Pick<CalendarEvent, 'kind' | 'series'>): CalendarDayBackgroundKey {
  return categoryByKind[event.kind] ?? categoryBySeries[event.series];
}

export function orderedDayBackgroundCategories(categories: readonly CalendarDayBackgroundKey[]): CalendarDayBackgroundKey[] {
  const unique = new Set(categories);
  return DAY_BACKGROUND_ORDER.filter((category) => unique.has(category));
}
