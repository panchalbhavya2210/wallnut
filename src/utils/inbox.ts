/**
 * Financial Inbox — pure prioritisation and dismissal rules.
 *
 * The inbox is a *derived* view: items are computed from the ledger, schedules
 * and balances every time it is opened. Nothing is stored except dismissals
 * and snoozes, so the queue can never drift from reality.
 *
 * Priorities (from the product spec):
 *   URGENT           → this is probably wrong and may affect your numbers
 *   ACTION REQUIRED  → needs a decision to be useful
 *   SUGGESTION       → Wallnut noticed something; take it or leave it
 *   INFORMATION      → good to know, nothing expected from you
 *
 * Not everything is an alert — most items are quiet.
 */

export type InboxPriority = 'urgent' | 'action' | 'suggestion' | 'info';

export const INBOX_PRIORITY_ORDER: readonly InboxPriority[] = ['urgent', 'action', 'suggestion', 'info'];

export const INBOX_PRIORITY_LABELS: Record<InboxPriority, string> = {
  urgent: 'Urgent',
  action: 'Action required',
  suggestion: 'Suggestion',
  info: 'Information',
};

export type InboxKind = 'transaction' | 'recurring_candidate' | 'upcoming' | 'goal_complete' | 'shared_balance' | 'import_review';

export type InboxActionKind =
  | 'open_transaction'
  | 'approve'
  | 'set_category'
  | 'delete_transaction'
  | 'create_recurring'
  | 'open'
  | 'dismiss'
  | 'snooze';

export interface InboxItem {
  /** Stable id for React keys (`kind:refKey`). */
  id: string;
  kind: InboxKind;
  priority: InboxPriority;
  title: string;
  detail: string;
  /** Signed minor units, or null when there is no meaningful amount. */
  amount: number | null;
  date: string | null;
  icon: string;
  href: string | null;
  /** Dismissal identity; changes when the underlying fact changes. */
  refKey: string;
  actions: InboxActionKind[];
  /** Transaction items only. */
  transactionId?: string;
  /** Recurring-candidate items only. */
  candidate?: { merchant: string; amount: number; count: number; lastDate: string; categoryId: string | null; accountId: string };
}

/** The highest priority implied by a review record's reasons. */
export function reviewPriority(reasons: string[]): InboxPriority {
  if (reasons.includes('duplicate') || reasons.includes('transfer_incomplete')) return 'urgent';
  if (reasons.includes('uncategorised') || reasons.includes('unreviewed')) return 'action';
  return 'suggestion';
}

export interface InboxDismissalRecord {
  kind: string;
  refKey: string;
  snoozedUntil: number | null;
}

/** True while a dismissal is active: ignored forever, or snoozed into the future. */
export function isInboxDismissed(
  dismissals: InboxDismissalRecord[],
  kind: string,
  refKey: string,
  now = Date.now(),
): boolean {
  return dismissals.some(
    (dismissal) =>
      dismissal.kind === kind &&
      dismissal.refKey === refKey &&
      (dismissal.snoozedUntil === null || dismissal.snoozedUntil > now),
  );
}

const RANK = new Map<InboxPriority, number>(INBOX_PRIORITY_ORDER.map((priority, index) => [priority, index]));

/** Urgent first, then action, suggestion, info; newest first inside a group. */
export function sortInboxItems(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    const byPriority = (RANK.get(a.priority) ?? 99) - (RANK.get(b.priority) ?? 99);
    if (byPriority !== 0) return byPriority;
    return (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title);
  });
}

export interface InboxCounts {
  total: number;
  urgent: number;
  action: number;
  suggestion: number;
  info: number;
}

export function countInboxItems(items: InboxItem[]): InboxCounts {
  return {
    total: items.length,
    urgent: items.filter((item) => item.priority === 'urgent').length,
    action: items.filter((item) => item.priority === 'action').length,
    suggestion: items.filter((item) => item.priority === 'suggestion').length,
    info: items.filter((item) => item.priority === 'info').length,
  };
}

export function inboxSubtitle(counts: InboxCounts): string {
  if (counts.total === 0) return 'Everything is clear';
  const phrase = counts.total === 1 ? '1 item needs attention' : `${counts.total} items need attention`;
  return counts.urgent > 0 ? `${phrase} · ${counts.urgent} urgent` : phrase;
}
