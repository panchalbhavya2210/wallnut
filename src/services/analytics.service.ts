import { getSqlite } from '@/db/client';
import type { Account } from '@/db/schema';
import { listAccounts } from '@/services/accounts.service';
import { getDailyNetWorthMovements, getNetWorthBreakdown, netWorthOpeningBalance } from '@/services/net-worth.service';
import {
  addDays,
  buildTrendBuckets,
  daysInRange,
  eachDayInRange,
  getPeriodRange,
  monthCycleBuckets,
  pickTrendGranularity,
  previousRange,
  toISODate,
  type DateRange,
  type PeriodPreset,
  type TrendBucket,
  type TrendGranularity,
} from '@/utils/date';
import { percentageChange } from '@/utils/money';
import { summarizeMovements as summarizeLedger } from '@/utils/ledger';

/**
 * The analytics engine. Everything aggregates in SQLite over the
 * `effective_ledger` view (which expands splits) so numbers stay correct and
 * fast at 10k+ transactions. Transfers are never expenses; refunds net against
 * spending; adjustments never touch income/expense math.
 *
 * `effective_ledger` columns: transaction_id, date, account_id, type,
 * category_id, amount.
 */

type SqlParam = string | number;

export interface RangeParams {
  range: DateRange;
  accountIds?: string[];
  categoryIds?: string[];
}

interface ExtraClause {
  sql: string;
  params?: SqlParam[];
}

/** Builds a WHERE clause and parameter list in exact SQL order. */
function ledgerWhere(params: RangeParams, extras: ExtraClause[] = []): { clause: string; values: SqlParam[] } {
  const clauses = ['el.date >= ?', 'el.date <= ?'];
  const values: SqlParam[] = [toISODate(params.range.start), toISODate(params.range.end)];
  if (params.accountIds && params.accountIds.length > 0) {
    clauses.push(`el.account_id IN (${params.accountIds.map(() => '?').join(',')})`);
    values.push(...params.accountIds);
  }
  if (params.categoryIds && params.categoryIds.length > 0) {
    clauses.push(
      `(el.category_id IN (${params.categoryIds.map(() => '?').join(',')}) OR el.category_id IN (SELECT id FROM categories WHERE parent_id IN (${params.categoryIds
        .map(() => '?')
        .join(',')})))`,
    );
    values.push(...params.categoryIds, ...params.categoryIds);
  }
  for (const extra of extras) {
    clauses.push(extra.sql);
    if (extra.params) values.push(...extra.params);
  }
  return { clause: `WHERE ${clauses.join(' AND ')}`, values };
}

/* --------------------------------- Net worth -------------------------------- */

export interface NetWorthSummary {
  netWorth: number;
  assetsTotal: number;
  liabilitiesTotal: number;
  /** Open receivables (money owed to you) folded into assetsTotal. */
  receivables: number;
  /** Open payables (money you owe) folded into liabilitiesTotal. */
  payables: number;
  accounts: Account[];
}

/**
 * Canonical net worth for every screen. Delegates to the net-worth service so
 * the Home hero, drawer, Accounts and Analytics can never disagree.
 */
export async function getNetWorthSummary(accountIds?: string[]): Promise<NetWorthSummary> {
  const [breakdown, accounts] = await Promise.all([
    getNetWorthBreakdown({ accountIds }),
    listAccounts(),
  ]);
  return {
    netWorth: breakdown.netWorth,
    assetsTotal: breakdown.assets,
    liabilitiesTotal: breakdown.liabilities,
    receivables: breakdown.receivables,
    payables: breakdown.payables,
    accounts,
  };
}

export interface AccountScopeSummary {
  account: Account | null;
  balance: number;
  changeThisMonth: number;
  trend: TrendValuePoint[];
}

/** Balance of one account immediately before `date` (exclusive). */
async function getAccountBalanceBefore(accountId: string, date: Date): Promise<number> {
  const sqlite = getSqlite();
  const limit = toISODate(addDays(date, -1));
  const row = await sqlite.getFirstAsync<{ total: number; initial: number }>(
    `SELECT
       (SELECT coalesce(sum(amount), 0) FROM transactions WHERE account_id = ? AND date <= ?) +
       (SELECT coalesce(sum(-amount), 0) FROM transactions WHERE transfer_account_id = ? AND is_transfer = 1 AND date <= ?)
       AS total,
       (SELECT initial_balance FROM accounts WHERE id = ?) AS initial`,
    [accountId, limit, accountId, limit, accountId],
  );
  return Number(row?.initial ?? 0) + Number(row?.total ?? 0);
}

/**
 * Everything the scoped Home hero needs for a single account: current balance,
 * this-month movement (transfers into the account included) and a 6-month
 * balance trend. Kept here so the widget has no accounting maths of its own.
 */
export async function getAccountScopeSummary(accountId: string, monthStartDay = 1): Promise<AccountScopeSummary> {
  const accountsList = await listAccounts();
  const account = accountsList.find((entry) => entry.id === accountId) ?? null;
  if (!account) return { account: null, balance: 0, changeThisMonth: 0, trend: [] };

  const monthRange = getPeriodRange('thisMonth', { monthStartDay, anchor: new Date() });
  const beforeMonth = await getAccountBalanceBefore(accountId, monthRange.start);
  const trend = await getAccountBalanceTrend(accountId, getPeriodRange('6m', { monthStartDay }), 'month');

  return {
    account,
    balance: account.currentBalance,
    changeThisMonth: account.currentBalance - beforeMonth,
    trend,
  };
}

/**
 * Net-worth movement per day (accounts + debts), used to integrate trends.
 * Delegates to the net-worth service, where transfers are excluded and
 * lending/borrowing are offset by the receivable/payable side.
 */
async function getDailyNetMovements(endDate: string): Promise<{ date: string; total: number }[]> {
  return getDailyNetWorthMovements(endDate);
}

export interface TrendValuePoint {
  key: string;
  label: string;
  fullLabel: string;
  value: number;
}

export async function getNetWorthTrend(range: DateRange, granularity: TrendGranularity): Promise<TrendValuePoint[]> {
  const startBalance = await netWorthOpeningBalance();
  const buckets = buildTrendBuckets(range, granularity);
  if (buckets.length === 0) return [];

  const deltas = await getDailyNetMovements(toISODate(buckets[buckets.length - 1]!.end));
  let cursor = 0;
  let running = startBalance;
  const result: TrendValuePoint[] = [];
  for (const bucket of buckets) {
    const end = toISODate(bucket.end);
    while (cursor < deltas.length && deltas[cursor]!.date <= end) {
      running += deltas[cursor]!.total;
      cursor++;
    }
    result.push({ key: bucket.key, label: bucket.label, fullLabel: bucket.fullLabel, value: running });
  }
  return result;
}

export interface NetWorthChanges {
  current: number;
  changeThisMonth: number;
  previousMonthChange: number;
  changeThisYear: number;
  previousMonthEnd: number;
  yearAgoValue: number;
}

export async function getNetWorthChanges(monthStartDay = 1): Promise<NetWorthChanges> {
  const startBalance = await netWorthOpeningBalance();

  const now = new Date();
  const monthRange = getPeriodRange('thisMonth', { monthStartDay, anchor: now });
  const prevRange = getPeriodRange('lastMonth', { monthStartDay, anchor: now });
  const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

  const deltas = await getDailyNetMovements(toISODate(now));
  const movementUpTo = (date: Date) => {
    const limit = toISODate(date);
    let total = 0;
    for (const row of deltas) {
      if (row.date <= limit) total += row.total;
    }
    return total;
  };
  /** Balance immediately BEFORE the given day (so a period includes its first day). */
  const movementBefore = (date: Date) => movementUpTo(addDays(date, -1));

  const current = startBalance + movementUpTo(now);
  const monthStartValue = startBalance + movementBefore(monthRange.start);
  const prevMonthEndValue = startBalance + movementUpTo(prevRange.end);
  const prevMonthStartValue = startBalance + movementBefore(prevRange.start);
  const yearAgoValue = startBalance + movementUpTo(yearAgo);

  return {
    current,
    changeThisMonth: current - monthStartValue,
    previousMonthChange: prevMonthEndValue - prevMonthStartValue,
    changeThisYear: current - yearAgoValue,
    previousMonthEnd: prevMonthEndValue,
    yearAgoValue,
  };
}

/* ------------------------------ Category breakdown -------------------------- */

export interface CategoryBreakdownRow {
  categoryId: string | null;
  name: string;
  icon: string;
  color: string;
  /** positive minor units, net of refunds for expenses */
  total: number;
  gross: number;
  refunds: number;
  count: number;
  share: number;
  previousTotal: number;
  change: number | null;
  children: CategoryBreakdownRow[];
}

interface CategoryAgg {
  id: string | null;
  name: string;
  icon: string;
  color: string;
  total: number;
  count: number;
}

async function categoryTotalsForRange(
  kind: 'expense' | 'income' | 'refund',
  params: RangeParams,
): Promise<Map<string, CategoryAgg>> {
  const sqlite = getSqlite();
  const { clause, values } = ledgerWhere(params, [{ sql: `el.type = ?`, params: [kind] }]);
  const rows = await sqlite.getAllAsync<{
    id: string | null;
    name: string | null;
    icon: string | null;
    color: string | null;
    total: number;
    count: number;
  }>(
    `SELECT
       COALESCE(p.id, c.id) AS id,
       COALESCE(p.name, c.name) AS name,
       COALESCE(p.icon, c.icon) AS icon,
       COALESCE(p.color, c.color) AS color,
       sum(abs(el.amount)) AS total,
       count(DISTINCT el.transaction_id) AS count
     FROM effective_ledger el
     LEFT JOIN categories c ON c.id = el.category_id
     LEFT JOIN categories p ON p.id = c.parent_id
     ${clause}
     GROUP BY COALESCE(p.id, c.id)`,
    values,
  );
  const map = new Map<string, CategoryAgg>();
  for (const row of rows) {
    const key = row.id ?? '__uncategorised__';
    map.set(key, {
      id: row.id,
      name: row.name ?? 'Uncategorised',
      icon: row.icon ?? 'help-circle-outline',
      color: row.color ?? '#929AA8',
      total: Number(row.total),
      count: Number(row.count),
    });
  }
  return map;
}

/**
 * Spending by category (parents rolled up), net of refunds, with
 * previous-period comparison, share of total, and child rows for drill-down.
 */
export async function getCategoryBreakdown(
  params: RangeParams,
  options: { kind?: 'expense' | 'income'; limit?: number } = {},
): Promise<{ rows: CategoryBreakdownRow[]; total: number }> {
  const kind = options.kind ?? 'expense';
  const prevRange = previousRange(params.range);

  const current = await categoryTotalsForRange(kind, params);
  const currentRefunds = kind === 'expense' ? await categoryTotalsForRange('refund', params) : new Map<string, CategoryAgg>();
  const previous = await categoryTotalsForRange(kind, { ...params, range: prevRange });
  const previousRefunds =
    kind === 'expense'
      ? await categoryTotalsForRange('refund', { ...params, range: prevRange })
      : new Map<string, CategoryAgg>();

  const rows: CategoryBreakdownRow[] = [];
  for (const [key, entry] of current) {
    const refundValue = currentRefunds.get(key)?.total ?? 0;
    const total = kind === 'expense' ? entry.total - refundValue : entry.total;
    const prevEntry = previous.get(key);
    const prevRefund = previousRefunds.get(key)?.total ?? 0;
    const previousTotal = prevEntry ? (kind === 'expense' ? prevEntry.total - prevRefund : prevEntry.total) : 0;
    rows.push({
      categoryId: entry.id,
      name: entry.name,
      icon: entry.icon,
      color: entry.color,
      total,
      gross: entry.total,
      refunds: refundValue,
      count: entry.count,
      share: 0,
      previousTotal,
      change: percentageChange(total, previousTotal),
      children: [],
    });
  }

  rows.sort((a, b) => b.total - a.total);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  for (const row of rows) {
    row.share = total > 0 ? (row.total / total) * 100 : 0;
  }

  // Child rows (one level of drill-down) for expense categories.
  if (kind === 'expense') {
    const sqlite = getSqlite();
    const childClause = ledgerWhere(params, [
      { sql: `el.type = ?`, params: ['expense'] },
      { sql: 'c.parent_id IS NOT NULL' },
    ]);
    const childRows = await sqlite.getAllAsync<{
      id: string;
      parent_id: string;
      name: string;
      icon: string;
      color: string;
      total: number;
      count: number;
    }>(
      `SELECT c.id AS id, c.parent_id AS parent_id, c.name AS name, c.icon AS icon, c.color AS color,
              sum(abs(el.amount)) AS total, count(DISTINCT el.transaction_id) AS count
       FROM effective_ledger el
       JOIN categories c ON c.id = el.category_id
       ${childClause.clause}
       GROUP BY c.id`,
      childClause.values,
    );

    const refundClause = ledgerWhere(params, [
      { sql: `el.type = ?`, params: ['refund'] },
      { sql: 'c.parent_id IS NOT NULL' },
    ]);
    const refundRows = await sqlite.getAllAsync<{ id: string; parent_id: string; total: number }>(
      `SELECT c.id AS id, c.parent_id AS parent_id, sum(abs(el.amount)) AS total
       FROM effective_ledger el
       JOIN categories c ON c.id = el.category_id
       ${refundClause.clause}
       GROUP BY c.id`,
      refundClause.values,
    );
    const refundByChild = new Map(refundRows.map((r) => [r.id, Number(r.total)]));

    const byParent = new Map<string, CategoryBreakdownRow[]>();
    for (const child of childRows) {
      const net = Number(child.total) - (refundByChild.get(child.id) ?? 0);
      const bucket = byParent.get(child.parent_id) ?? [];
      bucket.push({
        categoryId: child.id,
        name: child.name,
        icon: child.icon,
        color: child.color,
        total: net,
        gross: Number(child.total),
        refunds: refundByChild.get(child.id) ?? 0,
        count: Number(child.count),
        share: 0,
        previousTotal: 0,
        change: null,
        children: [],
      });
      byParent.set(child.parent_id, bucket);
    }
    for (const row of rows) {
      if (!row.categoryId) continue;
      const children = (byParent.get(row.categoryId) ?? []).sort((a, b) => b.total - a.total);
      for (const child of children) child.share = row.total > 0 ? (child.total / row.total) * 100 : 0;
      row.children = children;
    }
  }

  const limited = options.limit ? rows.slice(0, options.limit) : rows;
  return { rows: limited, total };
}

/* ---------------------------------- Trends --------------------------------- */

export interface TrendPoint {
  key: string;
  label: string;
  fullLabel: string;
  start: Date;
  end: Date;
  expense: number;
  income: number;
  refund: number;
  net: number; // expense - refund
}

export async function getTrend(
  params: RangeParams,
  granularity?: TrendGranularity,
  kinds: ('expense' | 'income' | 'refund')[] = ['expense', 'income', 'refund'],
): Promise<{ points: TrendPoint[]; granularity: TrendGranularity; average: number; max: number }> {
  const sqlite = getSqlite();
  const g = granularity ?? pickTrendGranularity(params.range);
  const buckets = buildTrendBuckets(params.range, g);
  const bucketExpr =
    g === 'day' ? `el.date` : g === 'week' ? `date(el.date, 'weekday 0', '-6 days')` : `strftime('%Y-%m-01', el.date)`;

  const { clause, values } = ledgerWhere(params, [
    { sql: `el.type IN (${kinds.map(() => '?').join(',')})`, params: [...kinds] },
  ]);

  const rows = await sqlite.getAllAsync<{ bucket: string; type: string; total: number }>(
    `SELECT CAST(${bucketExpr} AS TEXT) AS bucket, el.type AS type, sum(abs(el.amount)) AS total
     FROM effective_ledger el
     ${clause}
     GROUP BY bucket, el.type
     ORDER BY bucket ASC`,
    values,
  );

  const byBucket = new Map<string, { expense: number; income: number; refund: number }>();
  for (const row of rows) {
    const entry = byBucket.get(row.bucket) ?? { expense: 0, income: 0, refund: 0 };
    if (row.type === 'expense') entry.expense = Number(row.total);
    if (row.type === 'income') entry.income = Number(row.total);
    if (row.type === 'refund') entry.refund = Number(row.total);
    byBucket.set(row.bucket, entry);
  }

  const points: TrendPoint[] = buckets.map((bucket) => {
    const entry = byBucket.get(toISODate(bucket.start)) ?? { expense: 0, income: 0, refund: 0 };
    return {
      key: bucket.key,
      label: bucket.label,
      fullLabel: bucket.fullLabel,
      start: bucket.start,
      end: bucket.end,
      expense: entry.expense,
      income: entry.income,
      refund: entry.refund,
      net: entry.expense - entry.refund,
    };
  });

  const withSpend = points.filter((p) => p.net > 0);
  const average = withSpend.length > 0 ? withSpend.reduce((sum, p) => sum + p.net, 0) / withSpend.length : 0;
  const max = points.reduce((m, p) => Math.max(m, p.net), 0);
  return { points, granularity: g, average, max };
}

/* ------------------------------ Account breakdown --------------------------- */

export interface AccountBreakdownRow {
  accountId: string;
  name: string;
  type: string;
  /** The account's own colour, so charts can distinguish accounts visually. */
  color: string | null;
  icon: string | null;
  /** Spending net of refunds, positive minor units. */
  spent: number;
  income: number;
  count: number;
  share: number;
  /** Current ledger balance for context. */
  balance: number;
}

/**
 * Spending/income per account for the period. Powers the Analytics "Accounts"
 * section where every account keeps its own colour instead of one shared
 * series colour. Transfers are excluded by construction (only expense/refund/
 * income sums are taken), so a bank→card payment never shows as "spending".
 */
export async function getAccountBreakdown(params: RangeParams): Promise<{ rows: AccountBreakdownRow[]; total: number }> {
  const sqlite = getSqlite();
  const { clause, values } = ledgerWhere(params);
  const rows = await sqlite.getAllAsync<{
    id: string;
    name: string | null;
    type: string | null;
    color: string | null;
    icon: string | null;
    balance: number | null;
    expense: number;
    refunds: number;
    income: number;
    count: number;
  }>(
    `SELECT el.account_id AS id,
            a.name AS name, a.type AS type, a.color AS color, a.icon AS icon, a.current_balance AS balance,
            coalesce(sum(CASE WHEN el.type = 'expense' THEN abs(el.amount) ELSE 0 END), 0) AS expense,
            coalesce(sum(CASE WHEN el.type = 'refund' THEN el.amount ELSE 0 END), 0) AS refunds,
            coalesce(sum(CASE WHEN el.type = 'income' THEN el.amount ELSE 0 END), 0) AS income,
            count(DISTINCT el.transaction_id) AS count
     FROM effective_ledger el
     LEFT JOIN accounts a ON a.id = el.account_id
     ${clause}
     GROUP BY el.account_id
     ORDER BY expense DESC`,
    values,
  );

  const result: AccountBreakdownRow[] = rows.map((row) => ({
    accountId: row.id,
    name: row.name ?? 'Account',
    type: row.type ?? 'other',
    color: row.color ?? null,
    icon: row.icon ?? null,
    spent: Math.max(0, Number(row.expense) - Number(row.refunds)),
    income: Number(row.income),
    count: Number(row.count),
    share: 0,
    balance: Number(row.balance ?? 0),
  }));
  const total = result.reduce((sum, row) => sum + row.spent, 0);
  for (const row of result) row.share = total > 0 ? (row.spent / total) * 100 : 0;
  return { rows: result, total };
}

/* -------------------------------- Merchants -------------------------------- */

export interface MerchantRow {
  name: string;
  total: number;
  count: number;
  average: number;
  largest: number;
  lastUsed: string;
  share: number;
  previousTotal: number;
  change: number | null;
}

/**
 * Canonical merchant name, resolved by the merchant_aliases table — the
 * longest matching pattern wins (e.g. "AMZN Mktp IN" → "Amazon").
 */
const MERCHANT_EXPR = `
  COALESCE(
    (SELECT ma.display_name FROM merchant_aliases ma
      WHERE instr(lower(t.merchant), ma.pattern) > 0
      ORDER BY length(ma.pattern) DESC LIMIT 1),
    t.merchant
  )
`;

interface MerchantAgg {
  total: number;
  count: number;
  largest: number;
  lastUsed: string;
}

async function merchantAggregates(params: RangeParams): Promise<Map<string, MerchantAgg>> {
  const sqlite = getSqlite();
  const { clause, values } = ledgerWhere(params, [
    { sql: `el.type = ?`, params: ['expense'] },
    { sql: `t.merchant IS NOT NULL AND trim(t.merchant) <> ''` },
  ]);
  const rows = await sqlite.getAllAsync<{ name: string; total: number; count: number; largest: number; lastUsed: string }>(
    `SELECT ${MERCHANT_EXPR} AS name,
            sum(abs(el.amount)) AS total,
            count(DISTINCT el.transaction_id) AS count,
            max(abs(el.amount)) AS largest,
            max(el.date) AS lastUsed
     FROM effective_ledger el
     JOIN transactions t ON t.id = el.transaction_id
     ${clause}
     GROUP BY name`,
    values,
  );
  const map = new Map<string, MerchantAgg>();
  for (const row of rows) {
    map.set(row.name, {
      total: Number(row.total),
      count: Number(row.count),
      largest: Number(row.largest),
      lastUsed: row.lastUsed,
    });
  }
  return map;
}

export async function getTopMerchants(params: RangeParams, limit = 10): Promise<MerchantRow[]> {
  const prevRange = previousRange(params.range);
  const [current, previous] = await Promise.all([
    merchantAggregates(params),
    merchantAggregates({ ...params, range: prevRange }),
  ]);
  const total = Array.from(current.values()).reduce((sum, entry) => sum + entry.total, 0);
  const rows: MerchantRow[] = Array.from(current.entries()).map(([name, entry]) => {
    const prevTotal = previous.get(name)?.total ?? 0;
    return {
      name,
      total: entry.total,
      count: entry.count,
      average: entry.count > 0 ? Math.round(entry.total / entry.count) : 0,
      largest: entry.largest,
      lastUsed: entry.lastUsed,
      share: total > 0 ? (entry.total / total) * 100 : 0,
      previousTotal: prevTotal,
      change: percentageChange(entry.total, prevTotal),
    };
  });
  rows.sort((a, b) => b.total - a.total);
  return rows.slice(0, limit);
}

/* ---------------------------- Largest / recent items ------------------------ */

export interface SimpleTransactionRow {
  id: string;
  date: string;
  merchant: string | null;
  description: string | null;
  amount: number;
  type: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  accountId: string;
  accountName: string;
  isTransfer: boolean;
}

const SIMPLE_SELECT = `
  SELECT el.transaction_id AS id, el.date AS date, el.amount AS amount, el.type AS type,
         el.category_id AS categoryId, el.account_id AS accountId,
         c.name AS categoryName, c.icon AS categoryIcon, c.color AS categoryColor,
         t.merchant AS merchant, t.description AS description, t.is_transfer AS isTransfer,
         a.name AS accountName
  FROM effective_ledger el
  LEFT JOIN categories c ON c.id = el.category_id
  JOIN transactions t ON t.id = el.transaction_id
  JOIN accounts a ON a.id = el.account_id
`;

export async function getLargestExpenses(params: RangeParams, limit = 5): Promise<SimpleTransactionRow[]> {
  const sqlite = getSqlite();
  const { clause, values } = ledgerWhere(params, [{ sql: `el.type = ?`, params: ['expense'] }]);
  const rows = await sqlite.getAllAsync<SimpleTransactionRow>(
    `${SIMPLE_SELECT} ${clause} ORDER BY abs(el.amount) DESC LIMIT ?`,
    [...values, limit],
  );
  return rows.map((row) => ({
    ...row,
    amount: -Math.abs(Number(row.amount)),
    isTransfer: Boolean(row.isTransfer),
  }));
}

export async function getRecentLedgerTransactions(
  params: RangeParams,
  limit = 6,
  includeTransfers = true,
): Promise<SimpleTransactionRow[]> {
  const sqlite = getSqlite();
  const extras: ExtraClause[] = includeTransfers ? [] : [{ sql: `t.is_transfer = 0` }];
  const { clause, values } = ledgerWhere(params, extras);
  const rows = await sqlite.getAllAsync<SimpleTransactionRow>(
    `${SIMPLE_SELECT} ${clause} ORDER BY el.date DESC, t.created_at DESC LIMIT ?`,
    [...values, limit],
  );
  return rows.map((row) => ({ ...row, amount: Number(row.amount), isTransfer: Boolean(row.isTransfer) }));
}

/* ------------------------------ Daily spending ------------------------------ */

export interface DailySpendingStats {
  today: number;
  average7: number;
  average30: number;
  activeDays: number;
  highest: { date: string; amount: number } | null;
  lowest: { date: string; amount: number } | null;
  averagePerActiveDay: number;
  total: number;
}

export async function getDailySpendingStats(params: RangeParams): Promise<DailySpendingStats> {
  const sqlite = getSqlite();
  const { clause, values } = ledgerWhere(params, [{ sql: `el.type = ?`, params: ['expense'] }]);
  const rows = await sqlite.getAllAsync<{ date: string; total: number }>(
    `SELECT el.date AS date, sum(abs(el.amount)) AS total FROM effective_ledger el ${clause} GROUP BY el.date`,
    values,
  );
  const byDate = new Map(rows.map((r) => [r.date, Number(r.total)]));
  const today = toISODate(new Date());

  const trailingAverage = (days: number) => {
    let sum = 0;
    let counted = 0;
    const base = new Date();
    for (let i = 0; i < days; i++) {
      const key = toISODate(new Date(base.getFullYear(), base.getMonth(), base.getDate() - i));
      const value = byDate.get(key);
      if (value !== undefined) {
        sum += value;
        counted++;
      }
    }
    return counted > 0 ? sum / counted : 0;
  };

  let highest: { date: string; amount: number } | null = null;
  for (const [date, amount] of byDate) {
    if (!highest || amount > highest.amount) highest = { date, amount };
  }

  let lowestDay: { date: string; amount: number } | null = null;
  for (const day of eachDayInRange(params.range)) {
    const key = toISODate(day);
    if (key > today) continue;
    const amount = byDate.get(key) ?? 0;
    if (!lowestDay || amount < lowestDay.amount) lowestDay = { date: key, amount };
  }

  const total = rows.reduce((sum, r) => sum + Number(r.total), 0);
  const activeDays = rows.length;
  return {
    today: byDate.get(today) ?? 0,
    average7: trailingAverage(7),
    average30: trailingAverage(30),
    activeDays,
    highest,
    lowest: lowestDay,
    averagePerActiveDay: activeDays > 0 ? total / activeDays : 0,
    total,
  };
}

/* ------------------------------- Velocity ---------------------------------- */

export interface VelocityStats {
  currentPerDay: number;
  previousPerDay: number;
  change: number | null;
  currentTotal: number;
  previousTotal: number;
  daysElapsed: number;
  daysInPeriod: number;
  projectedTotal: number;
}

/** Spending pace: average per day this period vs the previous period. */
export async function getSpendingVelocity(params: RangeParams): Promise<VelocityStats> {
  const sqlite = getSqlite();
  const totalFor = async (range: DateRange) => {
    const { clause, values } = ledgerWhere({ ...params, range }, [{ sql: `el.type = ?`, params: ['expense'] }]);
    const row = await sqlite.getFirstAsync<{ total: number }>(
      `SELECT coalesce(sum(abs(el.amount)), 0) AS total FROM effective_ledger el ${clause}`,
      values,
    );
    return Number(row?.total ?? 0);
  };

  const currentTotal = await totalFor(params.range);
  const previousTotal = await totalFor(previousRange(params.range));
  const daysInPeriod = daysInRange(params.range);
  const today = new Date();
  const elapsed = Math.min(
    daysInPeriod,
    Math.max(1, Math.floor((today.getTime() - params.range.start.getTime()) / 86400000) + 1),
  );
  const currentPerDay = currentTotal / elapsed;
  const previousPerDay = previousTotal / daysInPeriod;
  return {
    currentPerDay,
    previousPerDay,
    change: percentageChange(currentPerDay, previousPerDay),
    currentTotal,
    previousTotal,
    daysElapsed: elapsed,
    daysInPeriod,
    projectedTotal: currentPerDay * daysInPeriod,
  };
}

/* --------------------------- Category detail stats -------------------------- */

export interface CategoryStats {
  total: number;
  count: number;
  average: number;
  largest: number;
  averagePerDay: number;
  firstDate: string | null;
  lastDate: string | null;
}

export async function getCategoryStats(params: RangeParams): Promise<CategoryStats> {
  const sqlite = getSqlite();
  const { clause, values } = ledgerWhere(params, [{ sql: `el.type = ?`, params: ['expense'] }]);
  const row = await sqlite.getFirstAsync<{
    total: number;
    count: number;
    largest: number;
    firstDate: string | null;
    lastDate: string | null;
  }>(
    `SELECT coalesce(sum(abs(el.amount)), 0) AS total,
            count(DISTINCT el.transaction_id) AS count,
            coalesce(max(abs(el.amount)), 0) AS largest,
            min(el.date) AS firstDate,
            max(el.date) AS lastDate
     FROM effective_ledger el ${clause}`,
    values,
  );
  const total = Number(row?.total ?? 0);
  const count = Number(row?.count ?? 0);
  const days = daysInRange(params.range);
  return {
    total,
    count,
    average: count > 0 ? Math.round(total / count) : 0,
    largest: Number(row?.largest ?? 0),
    averagePerDay: total / days,
    firstDate: row?.firstDate ?? null,
    lastDate: row?.lastDate ?? null,
  };
}

/* ---------------------------- Monthly comparison ---------------------------- */

export interface MonthlyComparisonRow {
  categoryId: string | null;
  name: string;
  color: string;
  icon: string;
  current: number;
  previous: number;
  change: number | null;
}

export async function getMonthlyComparison(params: RangeParams): Promise<MonthlyComparisonRow[]> {
  const prevRange = previousRange(params.range);
  const [current, previous] = await Promise.all([
    getCategoryBreakdown(params),
    getCategoryBreakdown({ ...params, range: prevRange }),
  ]);
  const previousMap = new Map(previous.rows.map((row) => [row.categoryId ?? '__uncategorised__', row.total]));
  return current.rows.map((row) => {
    const prevTotal = previousMap.get(row.categoryId ?? '__uncategorised__') ?? 0;
    return {
      categoryId: row.categoryId,
      name: row.name,
      color: row.color,
      icon: row.icon,
      current: row.total,
      previous: prevTotal,
      change: percentageChange(row.total, prevTotal),
    };
  });
}

/* --------------------------- Month-on-month trends -------------------------- */

export interface CategoryMonthlyRow {
  categoryId: string | null;
  name: string;
  icon: string;
  color: string;
  /** Aligned with the returned buckets, oldest → newest; positive, net of refunds. */
  totals: number[];
  /** Sum across the whole window. */
  total: number;
  /** Newest bucket (the current cycle). */
  current: number;
  /** The bucket before that (the previous cycle). */
  previous: number;
  change: number | null;
  /** Average per bucket across the window. */
  average: number;
  count: number;
}

export interface CategoryMonthlyTrends {
  /** Oldest → newest. */
  months: TrendBucket[];
  rows: CategoryMonthlyRow[];
  /** Grand total per bucket across all categories. */
  totals: number[];
}

export interface CategoryMonthlyOptions {
  months?: number;
  accountIds?: string[];
  categoryIds?: string[];
  monthStartDay?: number;
  anchor?: Date;
}

interface CategoryMonthAgg {
  id: string | null;
  name: string;
  icon: string;
  color: string;
  months: Map<string, number>;
  count: number;
}

/**
 * Category totals grouped by month. The group key shifts the transaction date
 * back by `monthStartDay - 1` days, so a custom cycle that runs Oct 5 → Nov 4
 * is still grouped and labelled as October. Honours the Home account scope.
 */
async function categoryMonthAggregates(
  params: RangeParams,
  monthExpr: string,
  kind: 'expense' | 'refund',
): Promise<Map<string, CategoryMonthAgg>> {
  const sqlite = getSqlite();
  const { clause, values } = ledgerWhere(params, [{ sql: `el.type = ?`, params: [kind] }]);
  const rows = await sqlite.getAllAsync<{
    id: string | null;
    name: string | null;
    icon: string | null;
    color: string | null;
    month: string;
    total: number;
    count: number;
  }>(
    `SELECT
       COALESCE(p.id, c.id) AS id,
       COALESCE(p.name, c.name) AS name,
       COALESCE(p.icon, c.icon) AS icon,
       COALESCE(p.color, c.color) AS color,
       ${monthExpr} AS month,
       sum(abs(el.amount)) AS total,
       count(DISTINCT el.transaction_id) AS count
     FROM effective_ledger el
     LEFT JOIN categories c ON c.id = el.category_id
     LEFT JOIN categories p ON p.id = c.parent_id
     ${clause}
     GROUP BY COALESCE(p.id, c.id), month`,
    values,
  );

  const map = new Map<string, CategoryMonthAgg>();
  for (const row of rows) {
    const key = row.id ?? '__uncategorised__';
    const entry = map.get(key) ?? {
      id: row.id,
      name: row.name ?? 'Uncategorised',
      icon: row.icon ?? 'help-circle-outline',
      color: row.color ?? '#929AA8',
      months: new Map<string, number>(),
      count: 0,
    };
    entry.months.set(String(row.month), (entry.months.get(String(row.month)) ?? 0) + Number(row.total));
    entry.count += Number(row.count);
    map.set(key, entry);
  }
  return map;
}

/**
 * Spending per category per month — the month-on-month view. Refunds net
 * against the month they landed in, and the newest bucket is the current cycle.
 */
export async function getCategoryMonthlyTrends(options: CategoryMonthlyOptions = {}): Promise<CategoryMonthlyTrends> {
  const months = Math.min(Math.max(options.months ?? 6, 2), 24);
  const anchor = options.anchor ?? new Date();
  const monthStartDay = options.monthStartDay ?? 1;
  const buckets = monthCycleBuckets(anchor, months, monthStartDay);

  const range: DateRange = {
    start: buckets[0]!.start,
    end: buckets[buckets.length - 1]!.end,
    label: 'Month on month',
  };
  const params: RangeParams = { range, accountIds: options.accountIds, categoryIds: options.categoryIds };

  // Shift dates back so every cycle lands in the calendar month it is labelled
  // with, then group on the resulting year-month string.
  const shift = Math.max(0, Math.min(27, monthStartDay - 1));
  const monthExpr = shift > 0 ? `substr(date(el.date, '-${shift} days'), 1, 7)` : `substr(el.date, 1, 7)`;

  const [expenses, refunds] = await Promise.all([
    categoryMonthAggregates(params, monthExpr, 'expense'),
    categoryMonthAggregates(params, monthExpr, 'refund'),
  ]);

  const rows: CategoryMonthlyRow[] = [];
  for (const [key, entry] of expenses) {
    const refundMonths = refunds.get(key)?.months;
    const totals = buckets.map(
      (bucket) => (entry.months.get(bucket.key) ?? 0) - (refundMonths?.get(bucket.key) ?? 0),
    );
    const total = totals.reduce((sum, value) => sum + value, 0);
    const current = totals[totals.length - 1] ?? 0;
    const previous = totals[totals.length - 2] ?? 0;
    rows.push({
      categoryId: entry.id,
      name: entry.name,
      icon: entry.icon,
      color: entry.color,
      totals,
      total,
      current,
      previous,
      change: percentageChange(current, previous),
      average: Math.round(total / months),
      count: entry.count,
    });
  }

  // Biggest current-cycle spend first, then the biggest window — the list reads
  // like "where the money went this month".
  rows.sort((a, b) => b.current - a.current || b.total - a.total);

  const totals = buckets.map((_, index) => rows.reduce((sum, row) => sum + (row.totals[index] ?? 0), 0));
  return { months: buckets, rows, totals };
}

/* ------------------------------ Account detail ------------------------------ */

export async function getAccountBalanceTrend(
  accountId: string,
  range: DateRange,
  granularity: TrendGranularity,
): Promise<TrendValuePoint[]> {
  const sqlite = getSqlite();
  const accountRows = await sqlite.getAllAsync<{ initial_balance: number }>(
    'SELECT initial_balance FROM accounts WHERE id = ?',
    [accountId],
  );
  const initial = Number(accountRows[0]?.initial_balance ?? 0);
  const buckets = buildTrendBuckets(range, granularity);
  if (buckets.length === 0) return [];

  const rows = await sqlite.getAllAsync<{ date: string; total: number }>(
    `SELECT date, sum(amount) AS total FROM (
       SELECT date, amount AS amount FROM transactions WHERE account_id = ?
       UNION ALL
       SELECT date, -amount AS amount FROM transactions WHERE transfer_account_id = ? AND is_transfer = 1
     ) WHERE date <= ? GROUP BY date ORDER BY date ASC`,
    [accountId, accountId, toISODate(buckets[buckets.length - 1]!.end)],
  );

  let cursor = 0;
  let running = initial;
  const result: TrendValuePoint[] = [];
  for (const bucket of buckets) {
    const end = toISODate(bucket.end);
    while (cursor < rows.length && rows[cursor]!.date <= end) {
      running += Number(rows[cursor]!.total);
      cursor++;
    }
    result.push({ key: bucket.key, label: bucket.label, fullLabel: bucket.fullLabel, value: running });
  }
  return result;
}

/* ------------------------- Dashboard aggregations -------------------------- */

export interface PeriodTotals {
  income: number;
  expenses: number;
  refunds: number;
  netExpense: number;
  savings: number;
  savingsRate: number;
  transfers: number;
  transactionCount: number;
}

/**
 * The ledger summarisation rules live in utils/ledger so they can be unit-tested
 * and stay identical to the SQL below (transfers excluded, refunds netting,
 * adjustments/debt activity never counted as income or expense).
 */
export function summarizeMovements(rows: { type: string; amount: number }[]) {
  return summarizeLedger(rows);
}

export interface PeriodSummary {
  range: DateRange;
  totals: PeriodTotals;
  previous: PeriodTotals;
}

async function totalsForRange(params: RangeParams, range: DateRange): Promise<PeriodTotals> {
  const sqlite = getSqlite();
  const { clause, values } = ledgerWhere({ ...params, range });
  const row = await sqlite.getFirstAsync<{
    income: number;
    expenses: number;
    refunds: number;
    transfers: number;
    count: number;
  }>(
    `SELECT
      coalesce(sum(CASE WHEN el.type = 'income' THEN el.amount ELSE 0 END), 0) AS income,
      coalesce(sum(CASE WHEN el.type = 'expense' THEN abs(el.amount) ELSE 0 END), 0) AS expenses,
      coalesce(sum(CASE WHEN el.type = 'refund' THEN el.amount ELSE 0 END), 0) AS refunds,
      coalesce(sum(CASE WHEN el.type = 'transfer' THEN abs(el.amount) ELSE 0 END), 0) AS transfers,
      count(DISTINCT el.transaction_id) AS count
     FROM effective_ledger el
     ${clause}`,
    values,
  );
  const income = Number(row?.income ?? 0);
  const expenses = Number(row?.expenses ?? 0);
  const refunds = Number(row?.refunds ?? 0);
  const netExpense = expenses - refunds;
  const savings = income - netExpense;
  return {
    income,
    expenses,
    refunds,
    netExpense,
    savings,
    savingsRate: income > 0 ? (savings / income) * 100 : 0,
    transfers: Number(row?.transfers ?? 0),
    transactionCount: Number(row?.count ?? 0),
  };
}

export async function getPeriodSummary(params: RangeParams): Promise<PeriodSummary> {
  const totals = await totalsForRange(params, params.range);
  const previous = await totalsForRange(params, previousRange(params.range));
  return { range: params.range, totals, previous };
}

/** Spending by weekday (0 = Sunday) for "you spend the most on Saturdays". */
export async function getWeekdaySpending(params: RangeParams): Promise<{ weekday: number; total: number }[]> {
  const sqlite = getSqlite();
  const { clause, values } = ledgerWhere(params, [{ sql: `el.type = ?`, params: ['expense'] }]);
  const rows = await sqlite.getAllAsync<{ weekday: string; total: number }>(
    `SELECT CAST(strftime('%w', el.date) AS TEXT) AS weekday, sum(abs(el.amount)) AS total
     FROM effective_ledger el ${clause} GROUP BY weekday`,
    values,
  );
  const totals = new Array(7).fill(0) as number[];
  for (const row of rows) totals[Number(row.weekday)] = Number(row.total);
  return totals.map((total, weekday) => ({ weekday, total }));
}

export type { PeriodPreset };
