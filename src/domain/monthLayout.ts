import { addDays, compareDateOnly, differenceInDays, type DateOnly } from './dateOnly';
import type { MonthModel } from './calendar';
import type { CalendarEvent } from './types';

export interface MonthEventSegment {
  eventId: string;
  weekIndex: number;
  startColumn: number;
  span: number;
  lane: number;
  startsHere: boolean;
  endsHere: boolean;
}

type PendingSegment = Omit<MonthEventSegment, 'lane'>;

function clampDate(value: DateOnly, min: DateOnly, max: DateOnly): DateOnly {
  if (compareDateOnly(value, min) < 0) return min;
  if (compareDateOnly(value, max) > 0) return max;
  return value;
}

function overlaps(aStart: number, aSpan: number, bStart: number, bSpan: number): boolean {
  const aEnd = aStart + aSpan - 1;
  const bEnd = bStart + bSpan - 1;
  return aStart <= bEnd && bStart <= aEnd;
}

export function buildMonthEventSegments(model: MonthModel, events: readonly CalendarEvent[]): MonthEventSegment[] {
  const gridStart = model.cells[0]?.date;
  const gridEnd = model.cells.at(-1)?.date;
  if (!gridStart || !gridEnd) return [];

  const pending: PendingSegment[] = [];

  for (const event of events) {
    if (event.archivedAt !== null || event.startDate === null || event.endDate === null) continue;
    if (compareDateOnly(event.endDate, gridStart) < 0 || compareDateOnly(event.startDate, gridEnd) > 0) continue;

    const visibleStart = clampDate(event.startDate, gridStart, gridEnd);
    const visibleEnd = clampDate(event.endDate, gridStart, gridEnd);
    const firstWeek = Math.floor(differenceInDays(visibleStart, gridStart) / 7);
    const lastWeek = Math.floor(differenceInDays(visibleEnd, gridStart) / 7);

    for (let weekIndex = firstWeek; weekIndex <= lastWeek; weekIndex += 1) {
      const weekStart = addDays(gridStart, weekIndex * 7);
      const weekEnd = addDays(weekStart, 6);
      const segmentStart = clampDate(visibleStart, weekStart, weekEnd);
      const segmentEnd = clampDate(visibleEnd, weekStart, weekEnd);
      const startColumn = differenceInDays(segmentStart, weekStart);
      const span = differenceInDays(segmentEnd, segmentStart) + 1;
      pending.push({
        eventId: event.id,
        weekIndex,
        startColumn,
        span,
        startsHere: compareDateOnly(segmentStart, event.startDate) === 0,
        endsHere: compareDateOnly(segmentEnd, event.endDate) === 0,
      });
    }
  }

  const result: MonthEventSegment[] = [];
  for (let weekIndex = 0; weekIndex < model.weeks; weekIndex += 1) {
    const weekSegments = pending
      .filter((segment) => segment.weekIndex === weekIndex)
      .sort((a, b) => a.startColumn - b.startColumn || b.span - a.span || a.eventId.localeCompare(b.eventId));
    const lanes: PendingSegment[][] = [];

    for (const segment of weekSegments) {
      let lane = lanes.findIndex((items) => items.every((item) => !overlaps(item.startColumn, item.span, segment.startColumn, segment.span)));
      if (lane === -1) {
        lane = lanes.length;
        lanes.push([]);
      }
      lanes[lane]!.push(segment);
      result.push({ ...segment, lane });
    }
  }

  return result;
}

export function monthLaneCount(segments: readonly MonthEventSegment[], weekIndex: number): number {
  const lanes = segments.filter((segment) => segment.weekIndex === weekIndex).map((segment) => segment.lane);
  return lanes.length === 0 ? 0 : Math.max(...lanes) + 1;
}
