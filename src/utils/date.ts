import {
  addDays,
  addMonths,
  addYears,
  differenceInCalendarDays,
  endOfMonth,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from 'date-fns';

export {
  addDays,
  addMonths,
  addYears,
  differenceInCalendarDays,
  endOfMonth,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
};

/** Formats a Date as YYYY-MM-DD in local time (no UTC drift). */
export function toISODate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/** Parses YYYY-MM-DD as a local date. Returns null for malformed input. */
export function fromISODate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Accepts ISO strings, timestamps, and Dates; returns a valid Date or null. */
export function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return fromISODate(value);
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function nowMs(): number {
  return Date.now();
}

/* ---------------------------------------------------------------------------
 * Periods. "Month start day" (Settings → Finance) shifts monthly boundaries,
 * e.g. startOfMonth = 5 means the October cycle runs Oct 5 → Nov 4.
 * ------------------------------------------------------------------------ */

export type PeriodPreset =
  | '7d'
  | '30d'
  | '12w'
  | '3m'
  | '6m'
  | '1y'
  | 'thisWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'all'
  | 'custom';

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

/** Start of the custom month cycle that contains `date`. */
export function startOfCycle(date: Date, monthStartDay: number): Date {
  const day = monthStartDay <= 1 ? 1 : monthStartDay;
  if (date.getDate() >= day) {
    return new Date(date.getFullYear(), date.getMonth(), day);
  }
  return new Date(date.getFullYear(), date.getMonth() - 1, day);
}

export function endOfCycle(date: Date, monthStartDay: number): Date {
  return subDays(addMonths(startOfCycle(date, monthStartDay), 1), 1);
}

export function startOfCycleMonthCount(date: Date, monthStartDay: number, monthsBack: number): Date {
  return addMonths(startOfCycle(date, monthStartDay), -monthsBack);
}

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '12w': 'Last 12 weeks',
  '3m': 'Last 3 months',
  '6m': 'Last 6 months',
  '1y': 'Last 12 months',
  thisWeek: 'This week',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  thisYear: 'This year',
  all: 'All time',
  custom: 'Custom range',
};

export function getPeriodRange(
  preset: PeriodPreset,
  options: { monthStartDay?: number; anchor?: Date; from?: Date; to?: Date } = {},
): DateRange {
  const monthStartDay = options.monthStartDay ?? 1;
  const anchor = options.anchor ?? new Date();
  switch (preset) {
    case '7d':
      return { start: startOfDay(subDays(anchor, 6)), end: anchor, label: PERIOD_LABELS['7d'] };
    case '30d':
      return { start: startOfDay(subDays(anchor, 29)), end: anchor, label: PERIOD_LABELS['30d'] };
    case '12w':
      return { start: startOfDay(subDays(anchor, 83)), end: anchor, label: PERIOD_LABELS['12w'] };
    case '3m':
      return {
        start: startOfDay(addMonths(anchor, -3) ),
        end: anchor,
        label: PERIOD_LABELS['3m'],
      };
    case '6m':
      return { start: startOfDay(addMonths(anchor, -6)), end: anchor, label: PERIOD_LABELS['6m'] };
    case '1y':
      return { start: startOfDay(addYears(anchor, -1)), end: anchor, label: PERIOD_LABELS['1y'] };
    case 'thisWeek': {
      const start = startOfWeek(anchor, { weekStartsOn: 1 });
      return { start, end: addDays(start, 6), label: PERIOD_LABELS.thisWeek };
    }
    case 'thisMonth': {
      const start = startOfCycle(anchor, monthStartDay);
      return { start, end: endOfCycle(anchor, monthStartDay), label: PERIOD_LABELS.thisMonth };
    }
    case 'lastMonth': {
      const thisStart = startOfCycle(anchor, monthStartDay);
      const start = addMonths(thisStart, -1);
      return { start, end: subDays(thisStart, 1), label: PERIOD_LABELS.lastMonth };
    }
    case 'thisYear': {
      const start = new Date(anchor.getFullYear(), 0, 1);
      return { start, end: new Date(anchor.getFullYear(), 11, 31), label: PERIOD_LABELS.thisYear };
    }
    case 'custom': {
      const start = options.from ?? startOfDay(subDays(anchor, 29));
      const end = options.to ?? anchor;
      return { start: startOfDay(start), end, label: 'Custom' };
    }
    case 'all':
    default: {
      const start = new Date(2000, 0, 1);
      return { start, end: anchor, label: PERIOD_LABELS.all };
    }
  }
}

/** The same-length window immediately before `range`, for comparisons. */
export function previousRange(range: DateRange): DateRange {
  const days = Math.max(1, differenceInCalendarDays(range.end, range.start) + 1);
  const end = subDays(range.start, 1);
  const start = subDays(end, days - 1);
  return {
    start: startOfDay(start),
    end,
    label: 'Previous period',
  };
}

export function isDateInRange(date: Date, range: DateRange): boolean {
  const d = startOfDay(date).getTime();
  return d >= startOfDay(range.start).getTime() && d <= startOfDay(range.end).setHours(23, 59, 59, 999);
}

export function daysInRange(range: DateRange): number {
  return Math.max(1, differenceInCalendarDays(range.end, range.start) + 1);
}

export function eachDayInRange(range: DateRange): Date[] {
  const days: Date[] = [];
  let cursor = startOfDay(range.start);
  const end = startOfDay(range.end);
  while (!isAfter(cursor, end) && days.length < 1500) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export type TrendGranularity = 'day' | 'week' | 'month';

export function pickTrendGranularity(range: DateRange): TrendGranularity {
  // Compare start-of-month boundaries so a Feb 28 checkpoint doesn't round up.
  const months = (range.end.getFullYear() - range.start.getFullYear()) * 12 + (range.end.getMonth() - range.start.getMonth());
  if (months >= 4) return 'month';
  const days = daysInRange(range);
  if (days > 45) return 'week';
  return 'day';
}

export interface TrendBucket {
  key: string; // stable bucket id, e.g. 2026-10-04 | 2026-W40 | 2026-10
  label: string; // short display label
  fullLabel: string; // tooltip label
  start: Date;
  end: Date;
}

export function buildTrendBuckets(range: DateRange, granularity: TrendGranularity): TrendBucket[] {
  const buckets: TrendBucket[] = [];
  if (granularity === 'day') {
    for (const day of eachDayInRange(range)) {
      buckets.push({
        key: format(day, 'yyyy-MM-dd'),
        label: format(day, 'd'),
        fullLabel: format(day, 'EEE, d MMM'),
        start: startOfDay(day),
        end: startOfDay(day),
      });
    }
    return buckets;
  }
  if (granularity === 'week') {
    let cursor = startOfWeek(range.start, { weekStartsOn: 1 });
    while (!isAfter(cursor, range.end) && buckets.length < 400) {
      const weekEnd = addDays(cursor, 6);
      buckets.push({
        key: format(cursor, "yyyy-'W'II"),
        label: format(cursor, 'd MMM'),
        fullLabel: `${format(cursor, 'd MMM')} – ${format(weekEnd, 'd MMM')}`,
        start: cursor,
        end: weekEnd,
      });
      cursor = addDays(cursor, 7);
    }
    return buckets;
  }
  let cursor = startOfMonth(range.start);
  while (!isAfter(cursor, range.end) && buckets.length < 240) {
    const monthEnd = endOfMonth(cursor);
    buckets.push({
      key: format(cursor, 'yyyy-MM'),
      label: format(cursor, 'MMM'),
      fullLabel: format(cursor, 'MMMM yyyy'),
      start: cursor,
      end: monthEnd,
    });
    cursor = addMonths(cursor, 1);
  }
  return buckets;
}

/* ------------------------------- Formatting ------------------------------ */

/**
 * Month buckets for month-on-month views, newest last. Each bucket respects the
 * user's month-start day, so a cycle that runs Oct 5 → Nov 4 is labelled "Oct".
 */
export function monthCycleBuckets(anchor: Date, count: number, monthStartDay = 1): TrendBucket[] {
  const buckets: TrendBucket[] = [];
  const currentStart = startOfCycle(anchor, monthStartDay);
  for (let index = count - 1; index >= 0; index--) {
    const start = addMonths(currentStart, -index);
    const end = subDays(addMonths(start, 1), 1);
    buckets.push({
      key: format(start, 'yyyy-MM'),
      label: format(start, 'MMM'),
      fullLabel: format(start, 'MMMM yyyy'),
      start,
      end,
    });
  }
  return buckets;
}

export function formatDayLabel(date: Date, now = new Date()): string {
  if (isSameDay(date, now)) return 'Today';
  if (isSameDay(date, subDays(now, 1))) return 'Yesterday';
  const sameYear = date.getFullYear() === now.getFullYear();
  return sameYear ? format(date, 'EEE, d MMM') : format(date, 'd MMM yyyy');
}

export function formatMonthYear(date: Date): string {
  return format(date, 'MMMM yyyy');
}

export function formatMonthShort(date: Date): string {
  return format(date, 'MMM');
}

export function formatDayMonth(date: Date): string {
  return format(date, 'd MMM');
}

export function formatWeekdayLong(date: Date): string {
  return format(date, 'EEEE');
}

export function monthKey(date: Date): string {
  return format(date, 'yyyy-MM');
}

export function parseMonthKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1);
}

export function relativeTimeLabel(ms: number, now = Date.now()): string {
  const diff = now - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return format(new Date(ms), 'd MMM yyyy');
}
