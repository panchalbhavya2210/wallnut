import { describe, expect, it } from 'vitest';

import {
  countInboxItems,
  inboxSubtitle,
  isInboxDismissed,
  reviewPriority,
  sortInboxItems,
  type InboxItem,
} from '@/utils/inbox';

const item = (overrides: Partial<InboxItem>): InboxItem => ({
  id: 'x',
  kind: 'transaction',
  priority: 'info',
  title: 'Transaction',
  detail: 'detail',
  amount: null,
  date: '2026-10-01',
  icon: 'receipt-outline',
  href: null,
  refKey: 'ref',
  actions: [],
  ...overrides,
});

/**
 * The Financial Inbox must not look like a wall of alerts: priorities are
 * derived deterministically and most things are quiet.
 */

describe('review reasons → inbox priority', () => {
  it('treats duplicates and broken transfers as urgent', () => {
    expect(reviewPriority(['duplicate'])).toBe('urgent');
    expect(reviewPriority(['transfer_incomplete'])).toBe('urgent');
    expect(reviewPriority(['duplicate', 'uncategorised'])).toBe('urgent');
  });

  it('treats missing categories and unreviewed imports as action required', () => {
    expect(reviewPriority(['uncategorised'])).toBe('action');
    expect(reviewPriority(['unreviewed'])).toBe('action');
    expect(reviewPriority(['unreviewed', 'large'])).toBe('action');
  });

  it('keeps size and merchant warnings as suggestions, never alarms', () => {
    expect(reviewPriority(['large'])).toBe('suggestion');
    expect(reviewPriority(['missing_merchant'])).toBe('suggestion');
    expect(reviewPriority([])).toBe('suggestion');
  });
});

describe('inbox ordering', () => {
  it('orders urgent → action → suggestion → information', () => {
    const sorted = sortInboxItems([
      item({ id: 'info', priority: 'info', date: '2026-10-05' }),
      item({ id: 'suggestion', priority: 'suggestion', date: '2026-10-04' }),
      item({ id: 'action', priority: 'action', date: '2026-10-03' }),
      item({ id: 'urgent', priority: 'urgent', date: '2026-10-01' }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(['urgent', 'action', 'suggestion', 'info']);
  });

  it('shows newer items first within the same priority', () => {
    const sorted = sortInboxItems([
      item({ id: 'older', priority: 'action', date: '2026-10-01' }),
      item({ id: 'newer', priority: 'action', date: '2026-10-07' }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(['newer', 'older']);
  });
});

describe('dismissals and snoozes', () => {
  const now = 1_000_000;

  it('ignores an item permanently when snoozedUntil is null', () => {
    expect(isInboxDismissed([{ kind: 'upcoming', refKey: 'a', snoozedUntil: null }], 'upcoming', 'a', now)).toBe(true);
  });

  it('brings an item back once the snooze expires', () => {
    expect(isInboxDismissed([{ kind: 'upcoming', refKey: 'a', snoozedUntil: now + 1 }], 'upcoming', 'a', now)).toBe(true);
    expect(isInboxDismissed([{ kind: 'upcoming', refKey: 'a', snoozedUntil: now - 1 }], 'upcoming', 'a', now)).toBe(false);
  });

  it('never suppresses a different kind or ref key', () => {
    expect(isInboxDismissed([{ kind: 'upcoming', refKey: 'a', snoozedUntil: null }], 'upcoming', 'b', now)).toBe(false);
    expect(isInboxDismissed([{ kind: 'upcoming', refKey: 'a', snoozedUntil: null }], 'shared_balance', 'a', now)).toBe(false);
  });
});

describe('counts and subtitle', () => {
  const items = [
    item({ id: 'a', priority: 'urgent' }),
    item({ id: 'b', priority: 'action' }),
    item({ id: 'c', priority: 'action' }),
    item({ id: 'd', priority: 'info' }),
  ];

  it('counts each priority', () => {
    expect(countInboxItems(items)).toEqual({ total: 4, urgent: 1, action: 2, suggestion: 0, info: 1 });
  });

  it('surfaces urgency in the subtitle without shouting', () => {
    expect(inboxSubtitle(countInboxItems(items))).toBe('4 items need attention · 1 urgent');
    expect(inboxSubtitle(countInboxItems([]))).toBe('Everything is clear');
    expect(inboxSubtitle(countInboxItems([item({ id: 'only' })]))).toBe('1 item needs attention');
  });
});
