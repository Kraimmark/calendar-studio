import type { CalendarEvent } from './types';

/**
 * A parent event and its credited/related events occupy one planning slot.
 * Children remain separate legal records, but never become a second match in
 * the calendar, queue or warning engine.
 */
export interface EventBundle {
  root: CalendarEvent;
  members: CalendarEvent[];
}

function liveById(events: readonly CalendarEvent[]): Map<string, CalendarEvent> {
  return new Map(events.filter((event) => event.archivedAt === null).map((event) => [event.id, event]));
}

export function rootEventId(event: CalendarEvent, events: readonly CalendarEvent[]): string {
  const byId = liveById(events);
  let current = event;
  const visited = new Set<string>();
  while (current.parentEventId) {
    if (visited.has(current.id)) return event.id;
    visited.add(current.id);
    const parent = byId.get(current.parentEventId);
    if (!parent) return current.id;
    current = parent;
  }
  return current.id;
}

export function buildEventBundles(events: readonly CalendarEvent[]): EventBundle[] {
  const byId = liveById(events);
  const roots = new Map<string, EventBundle>();
  for (const event of events) {
    if (event.archivedAt !== null) continue;
    const rootId = rootEventId(event, events);
    const root = byId.get(rootId) ?? event;
    const bundle = roots.get(root.id) ?? { root, members: [] };
    bundle.members.push(event);
    roots.set(root.id, bundle);
  }
  return [...roots.values()].sort((left, right) =>
    (left.root.startDate ?? '9999-12-31').localeCompare(right.root.startDate ?? '9999-12-31')
    || left.root.title.localeCompare(right.root.title, 'ru')
    || left.root.id.localeCompare(right.root.id),
  );
}

export function planningEvents(events: readonly CalendarEvent[]): CalendarEvent[] {
  return buildEventBundles(events).map((bundle) => bundle.root);
}

/** Compact labels shown on the root sticker instead of duplicate child stickers. */
export function bundleBadges(event: CalendarEvent, events: readonly CalendarEvent[]): string[] {
  const rootId = rootEventId(event, events);
  const ownRoot = events.find((candidate) => candidate.id === rootId) ?? event;
  const children = events.filter((candidate) => candidate.archivedAt === null && candidate.id !== ownRoot.id && rootEventId(candidate, events) === ownRoot.id);
  const labels = children.map((child) => {
    if (child.competitionStatus === 'Региональные соревнования') return 'РС';
    if (child.competitionStatus === 'Физкультурное мероприятие') return 'ФМ';
    const status = child.competitionStatus?.trim();
    return status ? (status.length <= 3 ? status.toUpperCase() : `${status.slice(0, 2).toUpperCase()}.`) : 'ЗЧ';
  });
  return [...new Set(labels)];
}

export function bundleChildren(rootId: string, events: readonly CalendarEvent[]): CalendarEvent[] {
  return events.filter((event) => event.archivedAt === null && event.id !== rootId && rootEventId(event, events) === rootId);
}

/** Direct links keep working even while the parent is archived. */
export function linkedDescendants(rootId: string, events: readonly CalendarEvent[]): CalendarEvent[] {
  const descendants: CalendarEvent[] = [];
  const parentIds = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const event of events) {
      if (!event.parentEventId || !parentIds.has(event.parentEventId) || parentIds.has(event.id)) continue;
      parentIds.add(event.id);
      descendants.push(event);
      changed = true;
    }
  }
  return descendants;
}
