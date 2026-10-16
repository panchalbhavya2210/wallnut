import { asc, eq, lte, and } from 'drizzle-orm';

import { getDb, getSqlite } from '@/db/client';
import { recurringTransactions, type RecurringTransaction } from '@/db/schema';
import { createTransaction, hasRecurringOccurrence } from '@/services/transactions.service';
import { notifyDbChanged } from '@/stores/db.store';
import { addDays, fromISODate, toISODate, differenceInCalendarDays } from '@/utils/date';
import { advanceRecurrence, monthlyEquivalent as monthlyEquivalentOf } from '@/utils/ledger';
import { createId } from '@/utils/id';

export interface RecurringInput {
  merchant: string;
  description?: string | null;
  amount: number; // signed or magnitude — type decides the sign
  type: 'expense' | 'income' | 'transfer';
  categoryId?: string | null;
  accountId: string;
  transferAccountId?: string | null;
  frequency: RecurringTransaction['frequency'];
  interval?: number;
  nextDate: string;
  endDate?: string | null;
  autoPost?: boolean;
  isSubscription?: boolean;
  reminderDaysBefore?: number;
  /** Day-of-month anchor for monthly/yearly schedules (defaults to nextDate's day). */
  anchorDay?: number | null;
}

export async function listRecurring(includePaused = true): Promise<RecurringTransaction[]> {
  const db = getDb();
  return db
    .select()
    .from(recurringTransactions)
    .where(includePaused ? undefined : eq(recurringTransactions.isPaused, false))
    .orderBy(asc(recurringTransactions.nextDate));
}

export async function getRecurring(id: string): Promise<RecurringTransaction | null> {
  const db = getDb();
  const rows = await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createRecurring(input: RecurringInput): Promise<RecurringTransaction> {
  const db = getDb();
  if (!input.merchant.trim()) throw new Error('Give this recurring payment a name.');
  if (!Number.isFinite(input.amount) || Math.round(input.amount) === 0) throw new Error('Enter an amount.');
  if (input.type === 'transfer' && (!input.transferAccountId || input.transferAccountId === input.accountId)) {
    throw new Error('Choose a different destination account.');
  }

  const now = Date.now();
  const row: RecurringTransaction = {
    id: createId('rec'),
    merchant: input.merchant.trim(),
    description: input.description ?? null,
    amount: Math.round(Math.abs(input.amount)),
    type: input.type,
    categoryId: input.type === 'transfer' ? null : (input.categoryId ?? null),
    accountId: input.accountId,
    transferAccountId: input.type === 'transfer' ? (input.transferAccountId ?? null) : null,
    frequency: input.frequency,
    interval: Math.max(1, Math.round(input.interval ?? 1)),
    anchorDay: input.anchorDay ?? fromISODate(input.nextDate)?.getDate() ?? null,
    nextDate: input.nextDate,
    endDate: input.endDate ?? null,
    lastPostedDate: null,
    isActive: true,
    autoPost: input.autoPost ?? true,
    isPaused: false,
    isSubscription: input.isSubscription ?? false,
    reminderDaysBefore: input.reminderDaysBefore ?? 3,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(recurringTransactions).values(row);
  notifyDbChanged();
  return row;
}

export async function updateRecurring(id: string, patch: Partial<RecurringInput> & { isPaused?: boolean }): Promise<void> {
  const db = getDb();
  const current = await getRecurring(id);
  if (!current) throw new Error('Recurring payment not found.');
  const nextDate = patch.nextDate ?? current.nextDate;
  await db
    .update(recurringTransactions)
    .set({
      merchant: patch.merchant?.trim() ?? current.merchant,
      description: patch.description === undefined ? current.description : patch.description,
      amount: patch.amount === undefined ? current.amount : Math.round(Math.abs(patch.amount)),
      type: patch.type ?? current.type,
      categoryId: patch.categoryId === undefined ? current.categoryId : patch.categoryId,
      accountId: patch.accountId ?? current.accountId,
      transferAccountId:
        patch.transferAccountId === undefined ? current.transferAccountId : patch.transferAccountId,
      frequency: patch.frequency ?? current.frequency,
      interval: patch.interval === undefined ? current.interval : Math.max(1, Math.round(patch.interval)),
      // Moving the next date re-anchors the schedule to the new day unless the
      // caller supplied an explicit anchor.
      anchorDay:
        patch.anchorDay !== undefined
          ? patch.anchorDay
          : patch.nextDate !== undefined
            ? (fromISODate(nextDate)?.getDate() ?? current.anchorDay)
            : current.anchorDay,
      nextDate,
      endDate: patch.endDate === undefined ? current.endDate : patch.endDate,
      autoPost: patch.autoPost ?? current.autoPost,
      isPaused: patch.isPaused ?? current.isPaused,
      isSubscription: patch.isSubscription ?? current.isSubscription,
      reminderDaysBefore: patch.reminderDaysBefore ?? current.reminderDaysBefore,
      updatedAt: Date.now(),
    })
    .where(eq(recurringTransactions.id, id));
  notifyDbChanged();
}

export async function deleteRecurring(id: string): Promise<void> {
  const db = getDb();
  await db.delete(recurringTransactions).where(eq(recurringTransactions.id, id));
  notifyDbChanged();
}

/**
 * Advances a schedule by one occurrence. Monthly/yearly schedules are anchored
 * to their day of month and skip months without that day (Wallet behaviour).
 * `null` means no valid occurrence was found in the horizon, i.e. the schedule
 * has effectively run out.
 */
export function advanceDate(
  date: Date,
  frequency: RecurringTransaction['frequency'],
  interval: number,
  anchorDay?: number | null,
): Date | null {
  return advanceRecurrence(date, frequency, interval, anchorDay);
}

export function frequencyLabel(frequency: RecurringTransaction['frequency'], interval: number): string {
  const every = interval > 1 ? `every ${interval} ` : '';
  switch (frequency) {
    case 'daily':
      return interval > 1 ? `Every ${interval} days` : 'Daily';
    case 'weekly':
      return interval > 1 ? `Every ${interval} weeks` : 'Weekly';
    case 'yearly':
      return interval > 1 ? `Every ${interval} years` : 'Yearly';
    case 'custom':
      return `Every ${interval} days`;
    case 'monthly':
    default:
      return interval > 1 ? `Every ${interval} months` : 'Monthly';
  }
}

export interface UpcomingItem {
  recurring: RecurringTransaction;
  nextDate: Date;
  /** True when the occurrence is due or overdue and waiting for the user. */
  overdue: boolean;
}

/**
 * The next unposted occurrence of every schedule. Manual schedules keep their
 * due date until confirmed, so overdue items stay visible (like Wallet's
 * unconfirmed planned payments) instead of silently jumping to the next cycle.
 */
export async function getUpcoming(limit = 8): Promise<UpcomingItem[]> {
  const list = await listRecurring(false);
  const today = toISODate(new Date());
  const items: UpcomingItem[] = list.map((recurring) => {
    const nextDate = fromISODate(recurring.nextDate) ?? new Date();
    return { recurring, nextDate, overdue: recurring.nextDate <= today };
  });
  return items.sort((a, b) => a.nextDate.getTime() - b.nextDate.getTime()).slice(0, limit);
}

export interface PostResult {
  posted: number;
  skipped: number;
  /** Sum of the amounts posted (absolute, minor units) — used for notifications. */
  postedAmount: number;
}

/**
 * Posts every due occurrence for auto-post schedules up to `today` (inclusive)
 * and advances their next dates. Deduplicates by (recurringId, date) so a
 * double launch never double-posts.
 */
export async function postDueRecurring(today = new Date()): Promise<PostResult> {
  const db = getDb();
  const todayISO = toISODate(today);
  const due = await db
    .select()
    .from(recurringTransactions)
    .where(
      and(
        eq(recurringTransactions.isActive, true),
        eq(recurringTransactions.isPaused, false),
        eq(recurringTransactions.autoPost, true),
        lte(recurringTransactions.nextDate, todayISO),
      ),
    );

  let posted = 0;
  let skipped = 0;
  let postedAmount = 0;
  for (const recurring of due) {
    let cursor = fromISODate(recurring.nextDate);
    let guard = 0;
    const end = recurring.endDate ? fromISODate(recurring.endDate) : null;
    let exhausted = false;

    while (cursor && toISODate(cursor) <= todayISO && guard++ < 60) {
      const dateISO = toISODate(cursor);
      if (end && cursor > end) {
        exhausted = true;
        break;
      }

      const already = await hasRecurringOccurrence(recurring.id, dateISO);
      if (!already) {
        const signedAmount =
          recurring.type === 'expense' || recurring.type === 'transfer' ? -recurring.amount : recurring.amount;
        await createTransaction({
          accountId: recurring.accountId,
          categoryId: recurring.categoryId,
          amount: signedAmount,
          type: recurring.type,
          merchant: recurring.merchant,
          description: recurring.description,
          date: dateISO,
          transferAccountId: recurring.transferAccountId,
          isRecurring: true,
          recurringId: recurring.id,
          isReviewed: true,
        });
        posted++;
        postedAmount += recurring.amount;
      } else {
        skipped++;
      }
      const next = advanceDate(cursor, recurring.frequency, recurring.interval, recurring.anchorDay);
      cursor = next;
      if (!next) {
        exhausted = true;
        break;
      }
    }

    if (cursor && !exhausted && (!end || cursor <= end)) {
      await db
        .update(recurringTransactions)
        .set({ nextDate: toISODate(cursor), lastPostedDate: todayISO, updatedAt: Date.now() })
        .where(eq(recurringTransactions.id, recurring.id));
    } else {
      await db
        .update(recurringTransactions)
        .set({ isActive: false, lastPostedDate: todayISO, updatedAt: Date.now() })
        .where(eq(recurringTransactions.id, recurring.id));
    }
  }

  if (posted > 0) notifyDbChanged();
  return { posted, skipped, postedAmount };
}

/** Posts one occurrence immediately (user taps "Log now"). */
export async function postNow(id: string): Promise<void> {
  const recurring = await getRecurring(id);
  if (!recurring) throw new Error('Recurring payment not found.');
  const dateISO = recurring.nextDate;
  const already = await hasRecurringOccurrence(recurring.id, dateISO);
  if (!already) {
    const signedAmount = recurring.type === 'expense' || recurring.type === 'transfer' ? -recurring.amount : recurring.amount;
    await createTransaction({
      accountId: recurring.accountId,
      categoryId: recurring.categoryId,
      amount: signedAmount,
      type: recurring.type,
      merchant: recurring.merchant,
      description: recurring.description,
      date: dateISO,
      transferAccountId: recurring.transferAccountId,
      isRecurring: true,
      recurringId: recurring.id,
      isReviewed: true,
    });
  }
  await skipNext(id);
}

/** Advances the schedule without posting (user taps "Skip"). */
export async function skipNext(id: string): Promise<void> {
  const db = getDb();
  const recurring = await getRecurring(id);
  if (!recurring) return;
  const next = fromISODate(recurring.nextDate) ?? new Date();
  const advanced = advanceDate(next, recurring.frequency, recurring.interval, recurring.anchorDay);
  const end = recurring.endDate ? fromISODate(recurring.endDate) : null;
  if (!advanced || (end && advanced > end)) {
    await db
      .update(recurringTransactions)
      .set({ isActive: false, updatedAt: Date.now() })
      .where(eq(recurringTransactions.id, id));
  } else {
    await db
      .update(recurringTransactions)
      .set({ nextDate: toISODate(advanced), updatedAt: Date.now() })
      .where(eq(recurringTransactions.id, id));
  }
  notifyDbChanged();
}

export async function countRecurring(): Promise<number> {
  const sqlite = getSqlite();
  const row = await sqlite.getFirstAsync<{ count: number }>(
    'SELECT count(*) AS count FROM recurring_transactions WHERE is_active = 1 AND is_paused = 0',
  );
  return Number(row?.count ?? 0);
}

/** Converts any cadence to its monthly equivalent (used by forecasts & health). */
export function monthlyEquivalent(amount: number, frequency: RecurringTransaction['frequency'], interval = 1): number {
  return monthlyEquivalentOf(amount, frequency, interval);
}

export interface SubscriptionItem {
  recurring: RecurringTransaction;
  monthlyAmount: number;
  annualAmount: number;
}

export interface SubscriptionSummary {
  monthlyTotal: number;
  annualTotal: number;
  activeCount: number;
  items: SubscriptionItem[];
}

/** Subscriptions with annualized cost — one of the most useful recurring insights. */
export async function getSubscriptionSummary(): Promise<SubscriptionSummary> {
  const list = await listRecurring(false);
  const items: SubscriptionItem[] = list
    .filter((item) => item.isSubscription && item.type === 'expense')
    .map((recurring) => {
      const monthlyAmount = monthlyEquivalent(recurring.amount, recurring.frequency, recurring.interval);
      return { recurring, monthlyAmount, annualAmount: monthlyAmount * 12 };
    })
    .sort((a, b) => b.monthlyAmount - a.monthlyAmount);

  return {
    monthlyTotal: items.reduce((sum, item) => sum + item.monthlyAmount, 0),
    annualTotal: items.reduce((sum, item) => sum + item.annualAmount, 0),
    activeCount: items.length,
    items,
  };
}

export interface RecurringCandidate {
  merchant: string;
  amount: number;
  count: number;
  lastDate: string;
  categoryId: string | null;
  accountId: string;
}

/**
 * Turns a detected candidate into a monthly schedule. Shared by the Recurring
 * screen and the Financial Inbox so both behave identically: the schedule
 * starts as manual (nothing posts until the user confirms) and skips forward
 * to the next future occurrence.
 */
export async function createRecurringFromCandidate(candidate: RecurringCandidate): Promise<RecurringTransaction> {
  const last = fromISODate(candidate.lastDate) ?? new Date();
  let next = advanceDate(last, 'monthly', 1, last.getDate()) ?? addDays(last, 30);
  let guard = 0;
  while (toISODate(next) < toISODate(new Date()) && guard++ < 24) {
    next = advanceDate(next, 'monthly', 1, last.getDate()) ?? addDays(next, 30);
  }
  return createRecurring({
    merchant: candidate.merchant,
    amount: candidate.amount,
    type: 'expense',
    frequency: 'monthly',
    nextDate: toISODate(next),
    anchorDay: last.getDate(),
    accountId: candidate.accountId,
    categoryId: candidate.categoryId,
    // Suggestions start as manual: nothing posts until the user confirms.
    autoPost: false,
  });
}

/**
 * Recurring detection: looks for expense merchants paid 3+ times with roughly
 * monthly gaps and stable amounts over the recent history, excluding anything
 * already scheduled. The UI offers these as suggestions — nothing is created
 * without the user accepting.
 */
export async function detectRecurringCandidates(): Promise<RecurringCandidate[]> {
  const sqlite = getSqlite();
  const rows = await sqlite.getAllAsync<{
    merchant: string;
    amount: number;
    date: string;
    category_id: string | null;
    account_id: string;
  }>(
    `SELECT merchant, amount, date, category_id, account_id
     FROM transactions
     WHERE is_transfer = 0 AND type = 'expense' AND merchant IS NOT NULL AND trim(merchant) <> ''
     ORDER BY date DESC LIMIT 800`,
  );

  const existing = new Set((await listRecurring()).map((item) => item.merchant.trim().toLowerCase()));
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.merchant.trim().toLowerCase();
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const candidates: RecurringCandidate[] = [];
  for (const [key, entries] of groups) {
    if (existing.has(key) || entries.length < 3) continue;
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    const amounts = sorted.map((entry) => Math.abs(Number(entry.amount)));
    const median = amounts[Math.floor(amounts.length / 2)] ?? 0;
    if (median <= 0 || amounts.some((amount) => Math.abs(amount - median) / median > 0.25)) continue;

    let monthly = true;
    for (let index = 1; index < sorted.length; index++) {
      const previous = fromISODate(sorted[index - 1]!.date);
      const current = fromISODate(sorted[index]!.date);
      if (!previous || !current) {
        monthly = false;
        break;
      }
      const gap = differenceInCalendarDays(current, previous);
      if (gap < 24 || gap > 38) {
        monthly = false;
        break;
      }
    }
    if (!monthly) continue;

    const last = sorted[sorted.length - 1]!;
    const lastDate = fromISODate(last.date);
    if (!lastDate || differenceInCalendarDays(new Date(), lastDate) > 45) continue;

    candidates.push({
      merchant: last.merchant.trim(),
      amount: median,
      count: sorted.length,
      lastDate: last.date,
      categoryId: last.category_id,
      accountId: last.account_id,
    });
  }

  return candidates.sort((a, b) => b.count - a.count).slice(0, 6);
}

export interface RecurringCalendarEntry {
  date: string;
  recurring: RecurringTransaction;
  amount: number; // signed
}

/** Expected recurring items within a date range — powers the recurring calendar. */
export async function getRecurringCalendar(from: Date, to: Date): Promise<RecurringCalendarEntry[]> {
  const list = await listRecurring(false);
  const entries: RecurringCalendarEntry[] = [];
  const fromISO = toISODate(from);
  const toISO = toISODate(to);

  for (const item of list) {
    let cursor = fromISODate(item.nextDate);
    if (!cursor) continue;
    const end = item.endDate ? fromISODate(item.endDate) : null;
    let guard = 0;
    // Walk the schedule into the requested window.
    while (cursor && guard++ < 120) {
      if (end && cursor > end) break;
      const iso = toISODate(cursor);
      if (iso > toISO) break;
      if (iso >= fromISO) {
        entries.push({
          date: iso,
          recurring: item,
          amount: item.type === 'income' ? item.amount : -item.amount,
        });
      }
      cursor = advanceDate(cursor, item.frequency, item.interval, item.anchorDay);
    }
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date));
}
