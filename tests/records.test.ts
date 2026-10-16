import { describe, expect, it } from 'vitest';

import { monthCycleBuckets } from '@/utils/date';
import {
  bucketKeyForDate,
  groupRecords,
  resolveRecordsGrouping,
  rowDateLabel,
  sumRecords,
} from '@/utils/records';

/**
 * The statement view maths: how records group, what their subtotals mean, and
 * the labels the screen shows. Transfers are money moved, never spending.
 */
describe('resolveRecordsGrouping', () => {
  it('picks a readable grouping for each period', () => {
    expect(resolveRecordsGrouping('7d')).toBe('day');
    expect(resolveRecordsGrouping('thisWeek')).toBe('day');
    expect(resolveRecordsGrouping('30d')).toBe('week');
    expect(resolveRecordsGrouping('12w')).toBe('week');
    expect(resolveRecordsGrouping('thisMonth')).toBe('week');
    expect(resolveRecordsGrouping('lastMonth')).toBe('week');
    expect(resolveRecordsGrouping('6m')).toBe('month');
    expect(resolveRecordsGrouping('1y')).toBe('month');
    expect(resolveRecordsGrouping('all')).toBe('month');
  });

  it('lets the user override the automatic choice', () => {
    expect(resolveRecordsGrouping('30d', 'day')).toBe('day');
    expect(resolveRecordsGrouping('7d', 'month')).toBe('month');
    expect(resolveRecordsGrouping('1y', 'week')).toBe('week');
  });
});

describe('bucketKeyForDate', () => {
  it('keys days by calendar date', () => {
    expect(bucketKeyForDate('2026-10-14', 'day')).toBe('2026-10-14');
  });

  it('keys weeks by their Monday (ISO week)', () => {
    // 2026-10-14 is a Wednesday → week starts Monday 2026-10-12 (ISO week 42).
    expect(bucketKeyForDate('2026-10-14', 'week')).toBe('2026-W42');
    expect(bucketKeyForDate('2026-10-12', 'week')).toBe('2026-W42');
    expect(bucketKeyForDate('2026-10-11', 'week')).toBe('2026-W41');
  });

  it('keys months by year-month', () => {
    expect(bucketKeyForDate('2026-10-14', 'month')).toBe('2026-10');
  });
});

describe('groupRecords', () => {
  const now = new Date(2026, 9, 16); // 16 Oct 2026
  const rows = [
    { id: 'a', date: '2026-10-16', amount: -110000 },
    { id: 'b', date: '2026-10-14', amount: -18500 },
    { id: 'c', date: '2026-10-14', amount: 500000 },
    { id: 'd', date: '2026-10-08', amount: -81000 },
    { id: 'e', date: '2026-10-05', amount: -1000000, isTransfer: true },
  ];

  it('groups by ISO week with statement labels and subtotals', () => {
    const groups = groupRecords(rows, 'week', { now });
    expect(groups.map((group) => group.key)).toEqual(['2026-W42', '2026-W41']);
    expect(groups[0]!.label).toBe('Week 42');
    expect(groups[0]!.subtitle).toBe('12 – 18 Oct');
    // Income + expense in week 42, transfers stay out of the subtotal.
    expect(groups[0]!.total).toBe(-110000 - 18500 + 500000);
    expect(groups[0]!.count).toBe(3);
    expect(groups[1]!.total).toBe(-81000);
  });

  it('includes transfers when the caller asks for them', () => {
    const groups = groupRecords(rows, 'week', { now, transfersInTotal: true });
    expect(groups[0]!.total).toBe(-110000 - 18500 + 500000);
    expect(groups[1]!.total).toBe(-81000 - 1000000);
  });

  it('labels day groups with the smart date name', () => {
    const groups = groupRecords(rows, 'day', { now });
    expect(groups[0]!.label).toBe('Today');
    expect(groups[1]!.label).toBe('Wed, 14 Oct');
    expect(groups[2]!.label).toBe('Thu, 8 Oct');
  });

  it('labels month groups with the month and year', () => {
    const groups = groupRecords(rows, 'month', { now });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('October 2026');
    expect(groups[0]!.total).toBe(-110000 - 18500 + 500000 - 81000);
  });

  it('keeps row order inside a group and sums slices', () => {
    const groups = groupRecords(rows, 'week', { now });
    expect(groups[0]!.rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(sumRecords(groups[0]!.rows)).toBe(-110000 - 18500 + 500000);
    expect(sumRecords(groups[0]!.rows, true)).toBe(-110000 - 18500 + 500000);
  });
});

describe('rowDateLabel', () => {
  const now = new Date(2026, 9, 16);
  it('uses relative names for today and yesterday, short dates after that', () => {
    expect(rowDateLabel('2026-10-16', now)).toBe('Today');
    expect(rowDateLabel('2026-10-15', now)).toBe('Yesterday');
    expect(rowDateLabel('2026-10-14', now)).toBe('14 Oct');
    expect(rowDateLabel('2025-12-31', now)).toBe('31 Dec 2025');
  });
});

describe('monthCycleBuckets', () => {
  it('returns calendar months oldest → newest', () => {
    const buckets = monthCycleBuckets(new Date(2026, 9, 16), 3, 1);
    expect(buckets.map((bucket) => bucket.key)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(buckets[2]!.fullLabel).toBe('October 2026');
    expect(buckets[2]!.start.getDate()).toBe(1);
  });

  it('honours a custom month-start day', () => {
    // Cycles starting on the 5th: Oct's bucket runs 5 Oct → 4 Nov.
    const buckets = monthCycleBuckets(new Date(2026, 9, 16), 2, 5);
    expect(buckets[0]!.key).toBe('2026-09');
    expect(buckets[0]!.start.getDate()).toBe(5);
    expect(buckets[0]!.end.getMonth()).toBe(9); // 4 Oct
    expect(buckets[0]!.end.getDate()).toBe(4);
    expect(buckets[1]!.key).toBe('2026-10');
  });

  it('keeps the cycle in the previous month when the anchor is before the start day', () => {
    const buckets = monthCycleBuckets(new Date(2026, 9, 2), 2, 5);
    // Oct 2 belongs to the cycle starting 5 Sep.
    expect(buckets[1]!.key).toBe('2026-09');
    expect(buckets[1]!.start.getMonth()).toBe(8);
  });
});
