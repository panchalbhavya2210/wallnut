import { format } from 'date-fns';

import { addDays, formatDayLabel, fromISODate, startOfMonth, startOfWeek, type PeriodPreset } from '@/utils/date';

/**
 * Records view maths (pure, unit-tested).
 *
 * The Transactions screen groups the ledger the way a bank statement does:
 * days for a week-long view, ISO weeks for a month-ish view, months for long
 * ranges. Group totals never include transfers unless the caller asks for them
 * (a transfer is money moved, not money spent).
 */

export type RecordsGrouping = 'auto' | 'day' | 'week' | 'month';
export type ResolvedGrouping = 'day' | 'week' | 'month';

export interface RecordRowLike {
  /** YYYY-MM-DD */
  date: string;
  /** Signed minor units. */
  amount: number;
  isTransfer?: boolean;
}

export interface RecordGroup<T extends RecordRowLike> {
  key: string;
  grouping: ResolvedGrouping;
  /** "WEEK 42" · "TODAY" · "OCTOBER 2026" */
  label: string;
  /** "6 Oct – 12 Oct" for weeks, empty otherwise. */
  subtitle: string;
  rows: T[];
  /** Signed sum of the group, transfers excluded unless asked for. */
  total: number;
  count: number;
}

export const RECORDS_GROUPING_LABELS: Record<RecordsGrouping, string> = {
  auto: 'Auto',
  day: 'Day',
  week: 'Week',
  month: 'Month',
};

/** Chooses the statement-style grouping a period reads best with. */
export function resolveRecordsGrouping(preset: PeriodPreset, preferred: RecordsGrouping = 'auto'): ResolvedGrouping {
  if (preferred !== 'auto') return preferred;
  switch (preset) {
    case '7d':
    case 'thisWeek':
      return 'day';
    case '30d':
    case '12w':
    case '3m':
    case 'thisMonth':
    case 'lastMonth':
    case 'custom':
      return 'week';
    case '6m':
    case '1y':
    case 'thisYear':
    case 'all':
    default:
      return 'month';
  }
}

/** The bucket id a date belongs to (matches the SQL-ish keys used in groups). */
export function bucketKeyForDate(date: string, grouping: ResolvedGrouping): string {
  const parsed = fromISODate(date) ?? new Date();
  if (grouping === 'day') return toDateKey(parsed);
  if (grouping === 'week') return weekKey(parsed);
  return monthKey(parsed);
}

function toDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function weekKey(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-'W'II");
}

function monthKey(date: Date): string {
  return format(startOfMonth(date), 'yyyy-MM');
}

function groupLabel(grouping: ResolvedGrouping, bucketStart: Date, now: Date): { label: string; subtitle: string } {
  if (grouping === 'day') {
    // "Today" · "Yesterday" · "10 Oct" — statement headers, not shouting labels.
    return { label: formatDayLabel(bucketStart, now), subtitle: '' };
  }
  if (grouping === 'week') {
    const weekEnd = addDays(bucketStart, 6);
    const startLabel = format(bucketStart, bucketStart.getMonth() === weekEnd.getMonth() ? 'd' : 'd MMM');
    return { label: `Week ${format(bucketStart, 'II')}`, subtitle: `${startLabel} – ${format(weekEnd, 'd MMM')}` };
  }
  return { label: format(bucketStart, 'MMMM yyyy'), subtitle: '' };
}

/**
 * Groups rows (newest first, as the ledger returns them) into statement-style
 * buckets, preserving that order. Days aggregate by calendar day, weeks by
 * ISO week (Monday start), months by calendar month.
 */
export function groupRecords<T extends RecordRowLike>(
  rows: T[],
  grouping: ResolvedGrouping,
  options: { now?: Date; transfersInTotal?: boolean } = {},
): RecordGroup<T>[] {
  const now = options.now ?? new Date();
  const includeTransfers = options.transfersInTotal ?? false;
  const groups: RecordGroup<T>[] = [];
  const index = new Map<string, RecordGroup<T>>();

  for (const row of rows) {
    const parsed = fromISODate(row.date) ?? now;
    const key = bucketKeyForDate(row.date, grouping);
    let group = index.get(key);
    if (!group) {
      const anchor =
        grouping === 'day' ? parsed : grouping === 'week' ? startOfWeek(parsed, { weekStartsOn: 1 }) : startOfMonth(parsed);
      const { label, subtitle } = groupLabel(grouping, anchor, now);
      group = { key, grouping, label, subtitle, rows: [], total: 0, count: 0 };
      index.set(key, group);
      groups.push(group);
    }
    group.rows.push(row);
    group.count += 1;
    if (!row.isTransfer || includeTransfers) group.total += row.amount;
  }

  return groups;
}

/** Sum of a slice of rows, with the same transfer rule as group totals. */
export function sumRecords<T extends RecordRowLike>(rows: T[], transfersInTotal = false): number {
  return rows.reduce((total, row) => (row.isTransfer && !transfersInTotal ? total : total + row.amount), 0);
}

/** Statement-style per-row date: "Today" · "Yesterday" · "14 Oct" · "14 Oct 2025". */
export function rowDateLabel(date: string, now = new Date()): string {
  const parsed = fromISODate(date);
  if (!parsed) return '';
  if (sameDay(parsed, now)) return 'Today';
  if (sameDay(parsed, addDays(now, -1))) return 'Yesterday';
  return parsed.getFullYear() === now.getFullYear()
    ? format(parsed, 'd MMM')
    : format(parsed, 'd MMM yyyy');
}

/** Clock time for a ledger row ("9:12 AM"). */
export function rowTimeLabel(date: string): string {
  const parsed = fromISODate(date);
  return parsed ? format(parsed, 'h:mm a') : '';
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
