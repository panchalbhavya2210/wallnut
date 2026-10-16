import { listInboxDismissals } from '@/services/dismissals.service';
import {
  createRecurringFromCandidate,
  detectRecurringCandidates,
  getUpcoming,
  type RecurringCandidate,
} from '@/services/recurring.service';
import { getGoalsProgress } from '@/services/goals.service';
import { REVIEW_REASON_LABELS, getReviewQueue, reviewItemTitle } from '@/services/review.service';
import { getSharedBalances, listSharedExpenses } from '@/services/shared.service';
import { addDays, differenceInCalendarDays, formatDayMonth, toISODate } from '@/utils/date';
import {
  countInboxItems,
  isInboxDismissed,
  reviewPriority,
  sortInboxItems,
  type InboxCounts,
  type InboxItem,
} from '@/utils/inbox';

/**
 * Financial Inbox — ONE attention queue, derived from reality.
 *
 * Sources:
 *   • the review queue (duplicates, missing categories, unreviewed imports,
 *     unusual amounts, broken transfers)
 *   • detected recurring payments and subscriptions
 *   • upcoming scheduled payments
 *   • completed goals
 *   • money that has been owed to you for a while
 *
 * Nothing is stored except dismissals/snoozes, so clearing an item always
 * means fixing the underlying fact — the queue can never drift.
 */

const SOON_DAYS = 14;
const SHARED_STALE_DAYS = 14;

/** Creates the monthly schedule for a detected candidate (shared with Recurring). */
export async function addRecurringFromInbox(candidate: RecurringCandidate): Promise<void> {
  await createRecurringFromCandidate(candidate);
}

export async function getInbox(): Promise<InboxItem[]> {
  const [review, candidates, upcoming, goals, balances, sharedExpenses, dismissals] = await Promise.all([
    getReviewQueue(120),
    detectRecurringCandidates(),
    getUpcoming(60),
    getGoalsProgress(),
    getSharedBalances(),
    listSharedExpenses(),
    listInboxDismissals(),
  ]);

  const today = new Date();
  const items: InboxItem[] = [];

  /* ------------------------- Transactions (review queue) ------------------------ */
  for (const entry of review) {
    const priority = reviewPriority(entry.reasons);
    const reasonText = entry.reasons.map((reason) => REVIEW_REASON_LABELS[reason]).join(' · ');
    const actions: InboxItem['actions'] = ['approve', 'open_transaction'];
    if (entry.reasons.includes('uncategorised')) actions.unshift('set_category');
    if (entry.reasons.includes('duplicate')) actions.push('delete_transaction');
    items.push({
      id: `transaction:${entry.id}`,
      kind: 'transaction',
      priority,
      title: reviewItemTitle(entry),
      detail: `${formatDayMonth(new Date(entry.date))} · ${entry.accountName ?? 'Account'} · ${reasonText}`,
      amount: entry.amount,
      date: entry.date,
      icon: priority === 'urgent' ? 'alert-circle-outline' : 'receipt-outline',
      href: `/transaction/${entry.id}`,
      refKey: entry.id,
      actions,
      transactionId: entry.id,
    });
  }

  /* ---------------------------- Recurring candidates --------------------------- */
  for (const candidate of candidates) {
    items.push({
      id: `recurring_candidate:${candidate.merchant.toLowerCase()}`,
      kind: 'recurring_candidate',
      priority: 'suggestion',
      title: candidate.merchant,
      detail: `Looks like a monthly payment · seen ${candidate.count}× · last ${formatDayMonth(new Date(candidate.lastDate))}`,
      amount: -candidate.amount,
      date: candidate.lastDate,
      icon: 'repeat-outline',
      href: '/recurring',
      refKey: candidate.merchant.toLowerCase(),
      actions: ['create_recurring', 'dismiss'],
      candidate: { ...candidate },
    });
  }

  /* ------------------------------- Upcoming bills ------------------------------ */
  const overdueNote = 'Expected and not posted yet';
  for (const entry of upcoming) {
    const days = differenceInCalendarDays(entry.nextDate, today);
    if (days > SOON_DAYS) continue;
    const amount = entry.recurring.type === 'income' ? entry.recurring.amount : -entry.recurring.amount;
    items.push({
      id: `upcoming:${entry.recurring.id}:${toISODate(entry.nextDate)}`,
      kind: 'upcoming',
      priority: 'info',
      title: entry.recurring.merchant,
      detail: entry.overdue ? overdueNote : days <= 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`,
      amount,
      date: toISODate(entry.nextDate),
      icon: 'calendar-outline',
      href: '/recurring',
      refKey: `${entry.recurring.id}:${toISODate(entry.nextDate)}`,
      actions: ['open', 'snooze'],
    });
  }

  /* ------------------------------ Completed goals ------------------------------ */
  for (const progress of goals) {
    if (!progress.isComplete) continue;
    items.push({
      id: `goal_complete:${progress.goal.id}`,
      kind: 'goal_complete',
      priority: 'info',
      title: `${progress.goal.name} is fully funded`,
      detail: progress.goal.targetDate
        ? `Target reached · target date ${formatDayMonth(new Date(progress.goal.targetDate))}`
        : 'Target reached',
      amount: progress.goal.targetAmount,
      date: null,
      icon: 'flag-outline',
      href: `/goal/${progress.goal.id}`,
      refKey: `${progress.goal.id}:${progress.goal.targetAmount}`,
      actions: ['open', 'dismiss'],
    });
  }

  /* -------------------------- Money owed for a while --------------------------- */
  const staleISO = toISODate(addDays(today, -SHARED_STALE_DAYS));
  for (const balance of balances.people) {
    if (balance.net <= 0) continue;
    const oldest = sharedExpenses
      .filter(
        (entry) =>
          entry.selfPaid > 0 &&
          entry.participants.some((participant) => participant.personId === balance.personId),
      )
      .reduce<string | null>(
        (min, entry) => (min === null || entry.expense.date < min ? entry.expense.date : min),
        null,
      );
    if (!oldest || oldest > staleISO) continue;
    items.push({
      id: `shared_balance:${balance.personId}:${oldest}`,
      kind: 'shared_balance',
      priority: 'action',
      title: `${balance.name} owes you`,
      detail: `Outstanding since ${formatDayMonth(new Date(oldest))}`,
      amount: balance.net,
      date: oldest,
      icon: 'people-circle-outline',
      href: `/person/${balance.personId}`,
      refKey: `${balance.personId}:${oldest}`,
      actions: ['open', 'snooze', 'dismiss'],
    });
  }

  const active = items.filter((item) => !isInboxDismissed(dismissals, item.kind, item.refKey));
  return sortInboxItems(active);
}

/** Counts only — used for badges and subtitles without rendering the list. */
export async function getInboxCounts(): Promise<InboxCounts> {
  return countInboxItems(await getInbox());
}
