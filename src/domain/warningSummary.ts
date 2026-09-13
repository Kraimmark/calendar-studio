import type { DateOnly } from './dateOnly';
import type { CalendarWarning, CalendarWarningCode } from './warnings';

export interface CalendarWarningGroup {
  code: CalendarWarningCode;
  label: string;
  description: string;
  warnings: CalendarWarning[];
  eventIds: string[];
  dates: DateOnly[];
}

export interface CalendarWarningSummary {
  warningCount: number;
  affectedEventCount: number;
  affectedDateCount: number;
  groups: CalendarWarningGroup[];
}

const warningMeta: Record<CalendarWarningCode, { label: string; description: string; order: number }> = {
  monthly_match_overload: {
    label: 'Перегрузка месяца',
    description: 'Больше двух матчей стартуют в одном календарном месяце.',
    order: 10,
  },
  match_spacing: {
    label: 'Интервалы между матчами',
    description: 'Между соседними матчами одной группы недостаточно двух полных свободных недель.',
    order: 20,
  },
  trf_spacing: {
    label: 'Интервалы ТРФ',
    description: 'Между матчами серии ТРФ недостаточно 30 полных свободных дней.',
    order: 30,
  },
  all_russian_buffer: {
    label: 'Буфер перед всероссийскими',
    description: 'Перед всероссийским мероприятием нет требуемых двух свободных недель в той же дисциплине.',
    order: 40,
  },
  all_russian_build_overlap: {
    label: 'Застройка перед всероссийскими',
    description: 'Застройка в подготовительном окне пересекается с другой активной записью календаря.',
    order: 50,
  },
};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function summarizeCalendarWarnings(warnings: readonly CalendarWarning[]): CalendarWarningSummary {
  const buckets = new Map<CalendarWarningCode, CalendarWarning[]>();
  for (const warning of warnings) {
    const bucket = buckets.get(warning.code) ?? [];
    bucket.push(warning);
    buckets.set(warning.code, bucket);
  }

  const groups = [...buckets.entries()]
    .sort(([left], [right]) => warningMeta[left].order - warningMeta[right].order)
    .map(([code, groupedWarnings]): CalendarWarningGroup => ({
      code,
      label: warningMeta[code].label,
      description: warningMeta[code].description,
      warnings: [...groupedWarnings],
      eventIds: uniqueSorted(groupedWarnings.flatMap((warning) => warning.eventIds)),
      dates: uniqueSorted(groupedWarnings.flatMap((warning) => warning.dates)) as DateOnly[],
    }));

  return {
    warningCount: warnings.length,
    affectedEventCount: uniqueSorted(warnings.flatMap((warning) => warning.eventIds)).length,
    affectedDateCount: uniqueSorted(warnings.flatMap((warning) => warning.dates)).length,
    groups,
  };
}
