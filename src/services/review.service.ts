import { getSqlite } from '@/db/client';
import { dismissInboxItem } from '@/services/dismissals.service';
import { markReviewed, bulkUpdateCategory } from '@/services/transactions.service';
import { toISODate } from '@/utils/date';

/**
 * Review queue — surfaces transactions that need a human decision:
 *   • uncategorised expenses
 *   • unreviewed imports
 *   • likely duplicates (same fingerprint)
 *   • unusually large expenses
 *   • transfers missing their destination account
 */

export type ReviewReason =
  | 'uncategorised'
  | 'unreviewed'
  | 'duplicate'
  | 'large'
  | 'missing_merchant'
  | 'transfer_incomplete';

export interface ReviewItem {
  id: string;
  date: string;
  merchant: string | null;
  description: string | null;
  amount: number;
  type: string;
  accountName: string | null;
  categoryName: string | null;
  reasons: ReviewReason[];
  duplicateOf: string | null;
}

export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  uncategorised: 'Needs a category',
  unreviewed: 'Imported — not reviewed',
  duplicate: 'Possible duplicate',
  large: 'Unusual amount',
  missing_merchant: 'Missing merchant',
  transfer_incomplete: 'Transfer destination missing',
};

export async function getReviewQueue(limit = 100): Promise<ReviewItem[]> {
  const sqlite = getSqlite();

  // Threshold for "unusual": 6× the average expense, with a ₹10,000 floor, and
  // only for one-off expenses — salary, rent and recurring charges are expected,
  // so flagging them would make the queue useless.
  const avgRow = await sqlite.getFirstAsync<{ avg: number; count: number }>(
    `SELECT coalesce(avg(abs(amount)), 0) AS avg, count(*) AS count FROM transactions WHERE type = 'expense'`,
  );
  const average = Number(avgRow?.avg ?? 0);
  const largeThreshold = Math.max(average * 6, 1_000_000);

  const duplicateRows = await sqlite.getAllAsync<{ fingerprint: string; count: number }>(
    `SELECT fingerprint, count(*) AS count FROM transactions
     WHERE fingerprint IS NOT NULL GROUP BY fingerprint HAVING count(*) > 1`,
  );
  const duplicateFingerprints = new Set(duplicateRows.map((row) => row.fingerprint));

  const rows = await sqlite.getAllAsync<{
    id: string;
    date: string;
    merchant: string | null;
    description: string | null;
    amount: number;
    type: string;
    is_reviewed: number;
    is_recurring: number;
    category_id: string | null;
    category_name: string | null;
    account_name: string | null;
    is_transfer: number;
    transfer_account_id: string | null;
    fingerprint: string | null;
  }>(
    `SELECT t.id, t.date, t.merchant, t.description, t.amount, t.type, t.is_reviewed, t.is_recurring,
            t.category_id, c.name AS category_name, a.name AS account_name,
            t.is_transfer, t.transfer_account_id, t.fingerprint
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN accounts a ON a.id = t.account_id
     WHERE (
        t.is_reviewed = 0
        OR (t.category_id IS NULL AND t.type = 'expense')
        OR (t.is_transfer = 1 AND t.transfer_account_id IS NULL)
        OR (t.type = 'expense' AND t.is_recurring = 0 AND abs(t.amount) > ?)
        OR t.fingerprint IN (SELECT fingerprint FROM transactions WHERE fingerprint IS NOT NULL GROUP BY fingerprint HAVING count(*) > 1)
     )
     AND t.id NOT IN (
       SELECT ref_key FROM inbox_dismissals
       WHERE kind = 'transaction' AND (snoozed_until IS NULL OR snoozed_until > ?)
     )
     ORDER BY t.date DESC, t.created_at DESC
     LIMIT ?`,
    [largeThreshold, Date.now(), limit],
  );

  const duplicateIds = new Map<string, string>();
  for (const row of rows) {
    if (!row.fingerprint || !duplicateFingerprints.has(row.fingerprint)) continue;
    const twin = await sqlite.getFirstAsync<{ id: string }>(
      `SELECT id FROM transactions WHERE fingerprint = ? AND id <> ? LIMIT 1`,
      [row.fingerprint, row.id],
    );
    if (twin) duplicateIds.set(row.id, twin.id);
  }

  const items: ReviewItem[] = [];
  for (const row of rows) {
    const reasons: ReviewReason[] = [];
    if (row.category_id === null && row.type === 'expense') reasons.push('uncategorised');
    if (!row.is_reviewed) reasons.push('unreviewed');
    if (duplicateIds.has(row.id)) reasons.push('duplicate');
    if (row.type === 'expense' && !row.is_recurring && Math.abs(Number(row.amount)) > largeThreshold) reasons.push('large');
    if (row.is_transfer === 1 && !row.transfer_account_id) reasons.push('transfer_incomplete');
    if (reasons.length === 0) continue;
    items.push({
      id: row.id,
      date: row.date,
      merchant: row.merchant,
      description: row.description,
      amount: Number(row.amount),
      type: row.type,
      accountName: row.account_name,
      categoryName: row.category_name,
      reasons,
      duplicateOf: duplicateIds.get(row.id) ?? null,
    });
  }

  // Highest-signal first: duplicates and missing categories, then size.
  const weight = (item: ReviewItem) =>
    (item.reasons.includes('duplicate') ? 8 : 0) +
    (item.reasons.includes('uncategorised') ? 4 : 0) +
    (item.reasons.includes('transfer_incomplete') ? 3 : 0) +
    (item.reasons.includes('large') ? 2 : 0) +
    (item.reasons.includes('unreviewed') ? 1 : 0);
  return items.sort((a, b) => weight(b) - weight(a) || b.date.localeCompare(a.date));
}

export async function reviewQueueCount(): Promise<number> {
  const items = await getReviewQueue(500);
  return items.length;
}

/**
 * Approve: mark reviewed (and optionally set a category in one step), then
 * acknowledge the item so rules that persist by design (large amounts, size
 * heuristics) stop resurfacing. The ledger row itself is never changed.
 */
export async function approveReviewItem(id: string, categoryId?: string | null): Promise<void> {
  if (categoryId !== undefined) {
    await bulkUpdateCategory([id], categoryId);
  }
  await markReviewed([id], true);
  await dismissInboxItem('transaction', id);
}

export async function approveMany(ids: string[]): Promise<void> {
  await markReviewed(ids, true);
  for (const id of ids) {
    await dismissInboxItem('transaction', id);
  }
}

export async function dismissAllUnreviewed(): Promise<void> {
  const sqlite = getSqlite();
  await sqlite.runAsync('UPDATE transactions SET is_reviewed = 1 WHERE is_reviewed = 0');
}

/** Possible duplicate pairs for a focused review screen. */
export interface DuplicatePair {
  fingerprint: string;
  transactions: ReviewItem[];
}

export async function findDuplicateGroups(): Promise<DuplicatePair[]> {
  const sqlite = getSqlite();
  const groups = await sqlite.getAllAsync<{ fingerprint: string }>(
    `SELECT fingerprint FROM transactions WHERE fingerprint IS NOT NULL
     GROUP BY fingerprint HAVING count(*) > 1 LIMIT 50`,
  );
  const result: DuplicatePair[] = [];
  for (const group of groups) {
    const rows = await sqlite.getAllAsync<{
      id: string;
      date: string;
      merchant: string | null;
      description: string | null;
      amount: number;
      type: string;
      account_name: string | null;
      category_name: string | null;
    }>(
      `SELECT t.id, t.date, t.merchant, t.description, t.amount, t.type,
              a.name AS account_name, c.name AS category_name
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.fingerprint = ? ORDER BY t.created_at ASC`,
      [group.fingerprint],
    );
    result.push({
      fingerprint: group.fingerprint,
      transactions: rows.map((row) => ({
        id: row.id,
        date: row.date,
        merchant: row.merchant,
        description: row.description,
        amount: Number(row.amount),
        type: row.type,
        accountName: row.account_name,
        categoryName: row.category_name,
        reasons: ['duplicate'],
        duplicateOf: null,
      })),
    });
  }
  return result;
}

export function reviewSummaryLine(count: number): string {
  if (count === 0) return 'Everything is reviewed';
  return `${count} transaction${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention`;
}

export function reviewItemTitle(item: ReviewItem): string {
  return item.merchant || item.description || 'Transaction';
}

/** Label shown in the review list — transfers have no category by design. */
export function reviewItemSubtitle(item: ReviewItem): string {
  if (item.type === 'transfer') return 'Transfer';
  return item.categoryName ?? 'Uncategorised';
}

export function reviewItemDate(item: ReviewItem): string {
  return toISODate(new Date(item.date));
}
