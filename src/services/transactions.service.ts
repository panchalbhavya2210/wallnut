import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { getDb, getSqlite } from '@/db/client';
import {
  accounts,
  categories,
  transactionSplits,
  transactionTags,
  transactions,
  type Transaction,
  type TransactionType,
} from '@/db/schema';
import { notifyDbChanged } from '@/stores/db.store';
import { createTag, listTags } from '@/services/tags.service';
import { evaluateRules, loadEnabledRules } from '@/services/rules.service';
import { transactionFingerprint } from '@/utils/hash';
import { createId } from '@/utils/id';

/* ---------------------------------- Types ---------------------------------- */

export interface TransactionSplitInput {
  categoryId: string;
  amount: number; // signed minor units, same sign as parent
  note?: string | null;
}

export interface TransactionInput {
  accountId: string;
  categoryId?: string | null;
  /** Signed or unsigned — the type decides the sign convention. */
  amount: number;
  type: TransactionType;
  merchant?: string | null;
  description?: string | null;
  date: string; // YYYY-MM-DD
  notes?: string | null;
  reference?: string | null;
  transferAccountId?: string | null;
  isRecurring?: boolean;
  recurringId?: string | null;
  installmentId?: string | null;
  isReviewed?: boolean;
  splits?: TransactionSplitInput[];
  tagIds?: string[];
  /** Set false to bypass the rules engine (e.g. when editing). */
  applyRules?: boolean;
}

export interface TransactionListItem extends Transaction {
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  accountName: string;
  accountType: string;
  transferAccountName: string | null;
  tagNames: string | null;
  splitCount: number;
}

export interface TransactionFilters {
  search?: string;
  types?: TransactionType[];
  accountIds?: string[];
  categoryIds?: string[]; // parents include children automatically
  tagIds?: string[];
  merchant?: string;
  /** Exact canonical merchant name (alias-normalised). */
  merchantCanonical?: string;
  minAmount?: number;
  maxAmount?: number;
  from?: string; // YYYY-MM-DD inclusive
  to?: string; // YYYY-MM-DD inclusive
  includeTransfers?: boolean;
  includeRefunds?: boolean;
  includeAdjustments?: boolean;
  /** lending / borrowing / debt_payment rows. */
  includeDebtActivity?: boolean;
  includeUnreviewedOnly?: boolean;
  onlyRecurring?: boolean;
  onlySubscriptions?: boolean;
  isReviewed?: boolean;
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
  limit?: number;
  offset?: number;
}

export interface TransactionDetail extends TransactionListItem {
  splits: { id: string; categoryId: string; categoryName: string; amount: number; note: string | null }[];
  tagIds: string[];
}

/* ------------------------------- Validation -------------------------------- */

import { normalizeTransactionAmount, summarizeMovements } from '@/utils/ledger';

/** Sign convention lives in utils/ledger (shared with the unit tests). */
function normalizeAmount(type: TransactionType, amount: number): number {
  return normalizeTransactionAmount(type, amount);
}

/** Exposed for unit tests: the sign convention is the heart of the ledger. */
export { normalizeTransactionAmount };

export function validateTransactionInput(input: TransactionInput): string | null {
  if (!input.accountId) return 'Choose an account.';
  if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return 'Choose a valid date.';
  if (!Number.isFinite(input.amount) || Math.round(input.amount) === 0) return 'Enter an amount.';
  if (input.type === 'transfer') {
    if (!input.transferAccountId) return 'Choose the destination account.';
    if (input.transferAccountId === input.accountId) return 'Transfer accounts must be different.';
  }
  if (input.splits && input.splits.length > 0) {
    const total = input.splits.reduce((sum, split) => sum + Math.round(split.amount), 0);
    if (total !== Math.round(input.amount)) return 'Splits must add up to the transaction amount.';
    if (input.splits.some((split) => !split.categoryId)) return 'Every split needs a category.';
  }
  return null;
}

/* --------------------------- Balance bookkeeping --------------------------- */

/**
 * Every ledger write updates account balances in the same SQL transaction, so
 * balances can never drift from the transactions that produced them.
 */
async function applyBalanceDelta(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  accountId: string,
  delta: number,
): Promise<void> {
  if (!delta) return;
  await tx
    .update(accounts)
    .set({ currentBalance: sql`${accounts.currentBalance} + ${delta}`, updatedAt: Date.now() })
    .where(eq(accounts.id, accountId));
}

async function balanceEffect(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  row: Pick<Transaction, 'accountId' | 'transferAccountId' | 'amount' | 'isTransfer'>,
  direction: 1 | -1,
): Promise<void> {
  await applyBalanceDelta(tx, row.accountId, direction * row.amount);
  if (row.isTransfer && row.transferAccountId) {
    await applyBalanceDelta(tx, row.transferAccountId, direction * -row.amount);
  }
}

/* --------------------------------- Writes ---------------------------------- */

export async function createTransaction(input: TransactionInput): Promise<Transaction> {
  let effectiveInput = input;
  if (input.applyRules !== false) {
    effectiveInput = await applyRulesToInput(input);
  }
  const error = validateTransactionInput(effectiveInput);
  if (error) throw new Error(error);
  const db = getDb();

  const amount = normalizeAmount(effectiveInput.type, effectiveInput.amount);
  const now = Date.now();
  const isTransfer = effectiveInput.type === 'transfer';
  const row: Transaction = {
    id: createId('txn'),
    accountId: effectiveInput.accountId,
    categoryId: isTransfer ? null : (effectiveInput.categoryId ?? null),
    amount,
    type: effectiveInput.type,
    merchant: effectiveInput.merchant?.trim() || null,
    description: effectiveInput.description?.trim() || null,
    date: effectiveInput.date,
    notes: effectiveInput.notes?.trim() || null,
    reference: effectiveInput.reference?.trim() || null,
    isTransfer,
    transferAccountId: isTransfer ? (effectiveInput.transferAccountId ?? null) : null,
    isRecurring: effectiveInput.isRecurring ?? false,
    recurringId: effectiveInput.recurringId ?? null,
    installmentId: effectiveInput.installmentId ?? null,
    fingerprint: transactionFingerprint({
      date: effectiveInput.date,
      amount,
      merchant: effectiveInput.merchant,
      accountId: effectiveInput.accountId,
      reference: effectiveInput.reference,
      description: effectiveInput.description,
    }),
    isReviewed: effectiveInput.isReviewed ?? false,
    createdAt: now,
    updatedAt: now,
  };

  await db.transaction(async (tx) => {
    await tx.insert(transactions).values(row);
    await balanceEffect(tx, row, 1);
    if (effectiveInput.splits && effectiveInput.splits.length > 0) {
      await tx.insert(transactionSplits).values(
        effectiveInput.splits.map((split) => ({
          id: createId('spl'),
          transactionId: row.id,
          categoryId: split.categoryId,
          amount: normalizeAmount(effectiveInput.type === 'income' || effectiveInput.type === 'refund' ? 'income' : 'expense', split.amount),
          note: split.note ?? null,
        })),
      );
    }
    await applyRuleTags(tx, row.id, effectiveInput);
  });

  notifyDbChanged();
  return row;
}

/**
 * Applies the rule engine to an input: category/account/merchant/type overrides,
 * tag additions, recurring + review flags. Called for new transactions, imports
 * and (when the user asks) retroactively.
 */
async function applyRulesToInput(input: TransactionInput): Promise<TransactionInput> {
  const enabled = await loadEnabledRules();
  if (enabled.length === 0) return input;
  const outcome = evaluateRules(enabled, {
    merchant: input.merchant,
    description: input.description,
    amount: input.amount,
    type: input.type,
    accountId: input.accountId,
    categoryId: input.categoryId,
    date: input.date,
  });
  if (outcome.matchedRuleIds.length === 0) return input;

  const tagIds = [...(input.tagIds ?? [])];
  if (outcome.addTagNames.length > 0) {
    const existingTags = await listTags();
    for (const name of outcome.addTagNames) {
      const found = existingTags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
      const tag = found ?? (await createTag(name));
      if (!tagIds.includes(tag.id)) tagIds.push(tag.id);
    }
  }

  return {
    ...input,
    categoryId: outcome.categoryId ?? input.categoryId,
    accountId: outcome.accountId ?? input.accountId,
    merchant: outcome.merchant ?? input.merchant,
    type: (outcome.type as TransactionInput['type']) ?? input.type,
    isRecurring: outcome.markRecurring || input.isRecurring,
    isReviewed: outcome.markReview ? false : input.isReviewed,
    tagIds,
  };
}

/** Tags discovered by rules are persisted together with the row. */
async function applyRuleTags(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  transactionId: string,
  input: TransactionInput,
): Promise<void> {
  if (!input.tagIds || input.tagIds.length === 0) return;
  await tx
    .insert(transactionTags)
    .values(input.tagIds.map((tagId) => ({ transactionId, tagId })))
    .onConflictDoNothing();
}

export async function updateTransaction(id: string, input: TransactionInput): Promise<void> {
  const error = validateTransactionInput(input);
  if (error) throw new Error(error);
  const db = getDb();

  const existingRows = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  const existing = existingRows[0];
  if (!existing) throw new Error('Transaction not found.');

  const amount = normalizeAmount(input.type, input.amount);
  const isTransfer = input.type === 'transfer';
  const next: Transaction = {
    ...existing,
    accountId: input.accountId,
    categoryId: isTransfer ? null : (input.categoryId ?? null),
    amount,
    type: input.type,
    merchant: input.merchant?.trim() || null,
    description: input.description?.trim() || null,
    date: input.date,
    notes: input.notes?.trim() || null,
    reference: input.reference?.trim() || null,
    isTransfer,
    transferAccountId: isTransfer ? (input.transferAccountId ?? null) : null,
    recurringId: input.recurringId === undefined ? existing.recurringId : input.recurringId,
    installmentId: input.installmentId === undefined ? existing.installmentId : input.installmentId,
    isRecurring: input.isRecurring ?? existing.isRecurring,
    isReviewed: input.isReviewed ?? existing.isReviewed,
    fingerprint: transactionFingerprint({
      date: input.date,
      amount,
      merchant: input.merchant,
      accountId: input.accountId,
      reference: input.reference,
      description: input.description,
    }),
    updatedAt: Date.now(),
  };

  await db.transaction(async (tx) => {
    await balanceEffect(tx, existing, -1);
    await balanceEffect(tx, next, 1);
    await tx.update(transactions).set(next).where(eq(transactions.id, id));

    await tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, id));
    if (input.splits && input.splits.length > 0) {
      await tx.insert(transactionSplits).values(
        input.splits.map((split) => ({
          id: createId('spl'),
          transactionId: id,
          categoryId: split.categoryId,
          amount: normalizeAmount(input.type === 'income' || input.type === 'refund' ? 'income' : 'expense', split.amount),
          note: split.note ?? null,
        })),
      );
    }
    if (input.tagIds) {
      await tx.delete(transactionTags).where(eq(transactionTags.transactionId, id));
      if (input.tagIds.length > 0) {
        await tx
          .insert(transactionTags)
          .values(input.tagIds.map((tagId) => ({ transactionId: id, tagId })))
          .onConflictDoNothing();
      }
    }
  });

  notifyDbChanged();
}

export async function deleteTransaction(id: string): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  const existing = rows[0];
  if (!existing) return;
  await db.transaction(async (tx) => {
    await balanceEffect(tx, existing, -1);
    await tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, id));
    await tx.delete(transactionTags).where(eq(transactionTags.transactionId, id));
    await tx.delete(transactions).where(eq(transactions.id, id));
  });
  notifyDbChanged();
}

export async function markReviewed(ids: string[], reviewed = true): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  await db.update(transactions).set({ isReviewed: reviewed, updatedAt: Date.now() }).where(inArray(transactions.id, ids));
  notifyDbChanged();
}

export async function bulkUpdateCategory(ids: string[], categoryId: string | null): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  await db
    .update(transactions)
    .set({ categoryId, updatedAt: Date.now() })
    .where(inArray(transactions.id, ids));
  notifyDbChanged();
}

export async function bulkUpdateAccount(ids: string[], accountId: string): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  const affected = await db
    .select({
      accountId: transactions.accountId,
      amount: transactions.amount,
      isTransfer: transactions.isTransfer,
      transferAccountId: transactions.transferAccountId,
    })
    .from(transactions)
    .where(inArray(transactions.id, ids));

  // Moving a transfer's source leg onto its own destination would create a
  // self-transfer; refuse instead of writing an inconsistent ledger.
  const selfTransfer = affected.some((row) => row.isTransfer && row.transferAccountId === accountId && row.accountId !== accountId);
  if (selfTransfer) {
    throw new Error('Some selected transfers already point to that account — edit those transfers first.');
  }

  await db.transaction(async (tx) => {
    for (const row of affected) {
      await applyBalanceDelta(tx, row.accountId, -row.amount);
      await applyBalanceDelta(tx, accountId, row.amount);
    }
    await tx
      .update(transactions)
      .set({ accountId, updatedAt: Date.now() })
      .where(inArray(transactions.id, ids));
  });
  notifyDbChanged();
}

export async function bulkDeleteTransactions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  const rows = await db.select().from(transactions).where(inArray(transactions.id, ids));
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await balanceEffect(tx, row, -1);
    }
    await tx.delete(transactionSplits).where(inArray(transactionSplits.transactionId, ids));
    await tx.delete(transactionTags).where(inArray(transactionTags.transactionId, ids));
    await tx.delete(transactions).where(inArray(transactions.id, ids));
  });
  notifyDbChanged();
}

/**
 * Bulk insert used by the import pipeline. Assumes rows are already validated
 * and fingerprinted; still updates balances atomically.
 */
export async function insertImportedTransactions(rows: Transaction[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx.insert(transactions).values(row);
      await balanceEffect(tx, row, 1);
    }
  });
  notifyDbChanged();
}

/* --------------------------------- Reads ----------------------------------- */

function buildWhere(filters: TransactionFilters): { clause: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.from) {
    clauses.push('t.date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push('t.date <= ?');
    params.push(filters.to);
  }
  if (filters.types && filters.types.length > 0) {
    clauses.push(`t.type IN (${filters.types.map(() => '?').join(',')})`);
    params.push(...filters.types);
    if (!filters.types.includes('transfer')) {
      clauses.push('t.is_transfer = 0');
    }
  } else {
    if (!filters.includeTransfers) clauses.push('t.is_transfer = 0');
    if (!filters.includeRefunds) clauses.push("t.type <> 'refund'");
    if (!filters.includeAdjustments) clauses.push("t.type <> 'adjustment'");
    if (!filters.includeDebtActivity) clauses.push("t.type NOT IN ('lending', 'borrowing', 'debt_payment')");
  }
  if (filters.accountIds && filters.accountIds.length > 0) {
    clauses.push(
      `(t.account_id IN (${filters.accountIds.map(() => '?').join(',')}) OR t.transfer_account_id IN (${filters.accountIds
        .map(() => '?')
        .join(',')}))`,
    );
    params.push(...filters.accountIds, ...filters.accountIds);
  }
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    clauses.push(
      `(t.category_id IN (${filters.categoryIds.map(() => '?').join(',')}) OR t.category_id IN (SELECT id FROM categories WHERE parent_id IN (${filters.categoryIds
        .map(() => '?')
        .join(',')})))`,
    );
    params.push(...filters.categoryIds, ...filters.categoryIds);
  }
  if (filters.tagIds && filters.tagIds.length > 0) {
    clauses.push(
      `EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id IN (${filters.tagIds
        .map(() => '?')
        .join(',')}))`,
    );
    params.push(...filters.tagIds);
  }
  if (filters.merchant) {
    clauses.push('lower(t.merchant) LIKE ?');
    params.push(`%${filters.merchant.toLowerCase()}%`);
  }
  if (filters.merchantCanonical) {
    // Matches the canonical (alias-normalised) merchant name, so drilling into
    // "Amazon" finds "AMZN Mktp IN" rows too.
    clauses.push(`COALESCE(
      (SELECT ma.display_name FROM merchant_aliases ma
        WHERE instr(lower(t.merchant), ma.pattern) > 0
        ORDER BY length(ma.pattern) DESC LIMIT 1),
      t.merchant) = ?`);
    params.push(filters.merchantCanonical);
  }
  if (filters.minAmount !== undefined) {
    clauses.push('abs(t.amount) >= ?');
    params.push(Math.abs(filters.minAmount));
  }
  if (filters.maxAmount !== undefined) {
    clauses.push('abs(t.amount) <= ?');
    params.push(Math.abs(filters.maxAmount));
  }
  if (filters.onlyRecurring) clauses.push('t.is_recurring = 1');
  if (filters.isReviewed !== undefined) clauses.push(`t.is_reviewed = ${filters.isReviewed ? 1 : 0}`);

  if (filters.search) {
    const term = `%${filters.search.toLowerCase().trim()}%`;
    clauses.push(`(
      lower(coalesce(t.merchant, '')) LIKE ? OR
      lower(coalesce(t.description, '')) LIKE ? OR
      lower(coalesce(t.notes, '')) LIKE ? OR
      lower(coalesce(t.reference, '')) LIKE ? OR
      lower(coalesce(c.name, '')) LIKE ? OR
      lower(a.name) LIKE ? OR
      lower(coalesce(ta.name, '')) LIKE ? OR
      EXISTS (SELECT 1 FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id
              WHERE tt.transaction_id = t.id AND lower(tg.name) LIKE ?)
    )`);
    params.push(term, term, term, term, term, term, term, term);
  }

  return { clause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

const LIST_SELECT = `
  SELECT t.*,
    c.name  AS categoryName, c.icon AS categoryIcon, c.color AS categoryColor,
    a.name  AS accountName, a.type AS accountType,
    ta.name AS transferAccountName,
    (SELECT group_concat(tg.name, ', ') FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.transaction_id = t.id) AS tagNames,
    (SELECT count(*) FROM transaction_splits s WHERE s.transaction_id = t.id) AS splitCount
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts ta ON ta.id = t.transfer_account_id
`;

function mapListRow(row: Record<string, unknown>): TransactionListItem {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    categoryId: (row.category_id as string | null) ?? null,
    amount: Number(row.amount),
    type: row.type as TransactionType,
    merchant: (row.merchant as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    date: row.date as string,
    notes: (row.notes as string | null) ?? null,
    reference: (row.reference as string | null) ?? null,
    isTransfer: Boolean(row.is_transfer),
    transferAccountId: (row.transfer_account_id as string | null) ?? null,
    isRecurring: Boolean(row.is_recurring),
    recurringId: (row.recurring_id as string | null) ?? null,
    installmentId: (row.installment_id as string | null) ?? null,
    fingerprint: (row.fingerprint as string | null) ?? null,
    isReviewed: Boolean(row.is_reviewed),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    categoryName: (row.categoryName as string | null) ?? null,
    categoryIcon: (row.categoryIcon as string | null) ?? null,
    categoryColor: (row.categoryColor as string | null) ?? null,
    accountName: row.accountName as string,
    accountType: row.accountType as string,
    transferAccountName: (row.transferAccountName as string | null) ?? null,
    tagNames: (row.tagNames as string | null) ?? null,
    splitCount: Number(row.splitCount ?? 0),
  };
}

export async function listTransactions(filters: TransactionFilters = {}): Promise<TransactionListItem[]> {
  const sqlite = getSqlite();
  const { clause, params } = buildWhere(filters);
  const sort =
    filters.sort === 'date_asc'
      ? 't.date ASC, t.created_at ASC'
      : filters.sort === 'amount_desc'
        ? 'abs(t.amount) DESC'
        : filters.sort === 'amount_asc'
          ? 'abs(t.amount) ASC'
          : 't.date DESC, t.created_at DESC';
  const limit = filters.limit ?? 300;
  const offset = filters.offset ?? 0;

  const rows = await sqlite.getAllAsync<Record<string, unknown>>(
    `${LIST_SELECT} ${clause} ORDER BY ${sort} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map(mapListRow);
}

export async function countTransactions(filters: TransactionFilters = {}): Promise<number> {
  const sqlite = getSqlite();
  const { clause, params } = buildWhere(filters);
  const row = await sqlite.getFirstAsync<{ count: number }>(
    `SELECT count(*) AS count FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN accounts a ON a.id = t.account_id
     LEFT JOIN accounts ta ON ta.id = t.transfer_account_id
     ${clause}`,
    params,
  );
  return Number(row?.count ?? 0);
}

export async function getTransactionDetail(id: string): Promise<TransactionDetail | null> {
  const sqlite = getSqlite();
  const row = await sqlite.getFirstAsync<Record<string, unknown>>(`${LIST_SELECT} WHERE t.id = ?`, [id]);
  if (!row) return null;
  const base = mapListRow(row);

  const splitRows = await sqlite.getAllAsync<{ id: string; category_id: string; amount: number; note: string | null; name: string }>(
    `SELECT s.id, s.category_id, s.amount, s.note, c.name
     FROM transaction_splits s LEFT JOIN categories c ON c.id = s.category_id
     WHERE s.transaction_id = ?`,
    [id],
  );
  const tagRows = await sqlite.getAllAsync<{ tag_id: string }>(
    'SELECT tag_id FROM transaction_tags WHERE transaction_id = ?',
    [id],
  );

  return {
    ...base,
    splits: splitRows.map((s) => ({
      id: s.id,
      categoryId: s.category_id,
      categoryName: s.name ?? 'Uncategorised',
      amount: Number(s.amount),
      note: s.note,
    })),
    tagIds: tagRows.map((t) => t.tag_id),
  };
}

export interface RecentMerchant {
  merchant: string;
  count: number;
  lastUsed: string;
  total: number;
}

export async function getRecentMerchants(limit = 12): Promise<RecentMerchant[]> {
  const sqlite = getSqlite();
  const rows = await sqlite.getAllAsync<{ merchant: string; count: number; lastUsed: string; total: number }>(
    `SELECT merchant, count(*) AS count, max(date) AS lastUsed, sum(abs(amount)) AS total
     FROM transactions
     WHERE merchant IS NOT NULL AND trim(merchant) <> ''
     GROUP BY lower(merchant)
     ORDER BY lastUsed DESC, count DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({ merchant: r.merchant, count: Number(r.count), lastUsed: r.lastUsed, total: Number(r.total) }));
}

export async function getExistingFingerprints(fingerprints: string[]): Promise<Set<string>> {
  if (fingerprints.length === 0) return new Set();
  const sqlite = getSqlite();
  const found = new Set<string>();
  const chunkSize = 400;
  for (let i = 0; i < fingerprints.length; i += chunkSize) {
    const chunk = fingerprints.slice(i, i + chunkSize);
    const rows = await sqlite.getAllAsync<{ fingerprint: string }>(
      `SELECT DISTINCT fingerprint FROM transactions WHERE fingerprint IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    );
    for (const row of rows) found.add(row.fingerprint);
  }
  return found;
}

export interface LedgerTotals {
  income: number;
  expenses: number; // negative
  refunds: number; // positive
  netExpense: number; // positive = money spent after refunds
  transfers: number; // absolute value of transfer volume
  adjustments: number;
  /** Money moved into debt (lending out / repaying borrowed) — never expenses. */
  debtOutflow: number;
  /** Money returned from debt (borrowings received / repayments collected). */
  debtInflow: number;
  savings: number;
  savingsRate: number;
  transactionCount: number;
}

/**
 * Period totals with correct accounting:
 *  - transfers never count as spending
 *  - refunds reduce expenses
 *  - adjustments are excluded from income/expense math
 */
export async function getLedgerTotals(filters: TransactionFilters): Promise<LedgerTotals> {
  const sqlite = getSqlite();
  const { clause, params } = buildWhere({
    ...filters,
    includeTransfers: false,
    includeRefunds: true,
    includeAdjustments: true,
    includeDebtActivity: true,
    types: undefined,
  });

  const row = await sqlite.getFirstAsync<{
    income: number;
    expenses: number;
    refunds: number;
    transfers: number;
    adjustments: number;
    debtOutflow: number;
    debtInflow: number;
    count: number;
  }>(
    `SELECT
      coalesce(sum(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
      coalesce(sum(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expenses,
      coalesce(sum(CASE WHEN t.type = 'refund' THEN t.amount ELSE 0 END), 0) AS refunds,
      coalesce(sum(CASE WHEN t.type = 'transfer' THEN abs(t.amount) ELSE 0 END), 0) AS transfers,
      coalesce(sum(CASE WHEN t.type = 'adjustment' THEN t.amount ELSE 0 END), 0) AS adjustments,
      coalesce(sum(CASE WHEN t.type IN ('lending','borrowing','debt_payment') AND t.amount < 0 THEN abs(t.amount) ELSE 0 END), 0) AS debtOutflow,
      coalesce(sum(CASE WHEN t.type IN ('lending','borrowing','debt_payment') AND t.amount > 0 THEN t.amount ELSE 0 END), 0) AS debtInflow,
      count(*) AS count
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN accounts a ON a.id = t.account_id
     LEFT JOIN accounts ta ON ta.id = t.transfer_account_id
     ${clause}`,
    params,
  );

  const income = Number(row?.income ?? 0);
  const expenses = Number(row?.expenses ?? 0); // negative
  const refunds = Number(row?.refunds ?? 0);
  const netExpense = Math.abs(expenses) - refunds;
  const savings = income - netExpense;
  return {
    income,
    expenses,
    refunds,
    netExpense,
    transfers: Number(row?.transfers ?? 0),
    adjustments: Number(row?.adjustments ?? 0),
    debtOutflow: Number(row?.debtOutflow ?? 0),
    debtInflow: Number(row?.debtInflow ?? 0),
    savings,
    savingsRate: income > 0 ? (savings / income) * 100 : 0,
    transactionCount: Number(row?.count ?? 0),
  };
}

export async function getAvailableMonths(): Promise<string[]> {
  const sqlite = getSqlite();
  const rows = await sqlite.getAllAsync<{ month: string }>(
    `SELECT DISTINCT substr(date, 1, 7) AS month FROM transactions ORDER BY month DESC`,
  );
  return rows.map((r) => r.month);
}

export async function getTransaction(id: string): Promise<Transaction | null> {
  const db = getDb();
  const rows = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getLatestTransactionDate(): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ date: transactions.date })
    .from(transactions)
    .orderBy(desc(transactions.date))
    .limit(1);
  return rows[0]?.date ?? null;
}

/** Used by recurring posting to avoid double-posting the same occurrence. */
export async function hasRecurringOccurrence(recurringId: string, date: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.recurringId, recurringId),
        eq(transactions.date, date),
        eq(transactions.isRecurring, true),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function listCategoriesForFilter(): Promise<{ id: string; name: string; parentId: string | null; color: string }[]> {
  const db = getDb();
  return db
    .select({ id: categories.id, name: categories.name, parentId: categories.parentId, color: categories.color })
    .from(categories)
    .orderBy(categories.sortOrder);
}

export async function transactionDateRange(): Promise<{ min: string | null; max: string | null }> {
  const sqlite = getSqlite();
  const row = await sqlite.getFirstAsync<{ min: string | null; max: string | null }>(
    'SELECT min(date) AS min, max(date) AS max FROM transactions',
  );
  return { min: row?.min ?? null, max: row?.max ?? null };
}

export async function countTransactionsBetween(from: string, to: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(and(gte(transactions.date, from), lte(transactions.date, to)));
  return Number(rows[0]?.count ?? 0);
}
