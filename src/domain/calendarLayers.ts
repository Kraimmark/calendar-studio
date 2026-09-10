import type { CalendarEvent, Discipline } from './types';

export type CalendarLayerKey =
  | 'ownPlan'
  | 'ekpSpb'
  | 'ekpOther'
  | 'trf'
  | 'allRussian'
  | 'departmental'
  | 'airgun'
  | 'utm'
  | 'build';

export type CalendarLayerState = Record<CalendarLayerKey, boolean>;
export type DisciplineFilter = 'all' | Discipline;

export const DEFAULT_CALENDAR_LAYERS: CalendarLayerState = {
  ownPlan: true,
  ekpSpb: true,
  ekpOther: true,
  trf: true,
  allRussian: true,
  departmental: true,
  airgun: true,
  utm: true,
  build: true,
};

export function eventMatchesLayer(event: CalendarEvent, layer: CalendarLayerKey): boolean {
  switch (layer) {
    case 'ownPlan': return event.source === 'manual';
    case 'ekpSpb': return event.source === 'ekp' && event.venueScope !== 'otherRegion';
    case 'ekpOther': return event.source === 'ekp' && event.venueScope === 'otherRegion';
    case 'trf': return event.series === 'trf';
    case 'allRussian': return event.series === 'allRussian';
    case 'departmental': return event.series === 'departmental';
    case 'airgun': return event.discipline === 'airgun';
    case 'utm': return event.kind === 'utm';
    case 'build': return event.kind === 'build';
  }
}

/**
 * Semantic layers are independent visibility gates, not mutually-exclusive buckets.
 * Every event is first gated by its source layer and then by each additional semantic
 * layer it belongs to. This lets a TRF airgun event disappear when either TRF or
 * airgun is disabled without changing the persisted Event taxonomy.
 */
export function isEventVisibleByLayers(event: CalendarEvent, layers: CalendarLayerState): boolean {
  const sourceLayer: CalendarLayerKey = event.source === 'manual'
    ? 'ownPlan'
    : event.venueScope === 'otherRegion' ? 'ekpOther' : 'ekpSpb';
  if (!layers[sourceLayer]) return false;

  const optionalLayers: CalendarLayerKey[] = ['trf', 'allRussian', 'departmental', 'airgun', 'utm', 'build'];
  return optionalLayers.every((layer) => !eventMatchesLayer(event, layer) || layers[layer]);
}

export function isEventVisibleByDiscipline(event: CalendarEvent, discipline: DisciplineFilter): boolean {
  return discipline === 'all' || event.discipline === discipline;
}
