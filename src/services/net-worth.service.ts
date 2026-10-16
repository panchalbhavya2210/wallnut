import { getSqlite } from '@/db/client';
import { getSharedMovements, getSharedReceivablesPayables } from '@/services/shared.service';
import { debtBalanceAt, netWorthParts, type NetWorthAccountRow } from '@/utils/net-worth';

/**
 * The single source of truth for net worth.
 *
 * Every screen (Home hero, drawer, Accounts, Analytics, Health, AI) reads the
 * same aggregation:
 *
 *   net worth = Σ assets (respecting includeInNetWorth)
 *             + money owed to you (open receivables)
 *             − money you owe (open payables)
 *             − Σ liabilities (cards/loans, stored negative)
 *
 * Lending/borrowing already move account balances through the ledger, so the
 * debt tables are the offsetting half of those entries — without them a loan
 * would look like a loss of wealth.
 */

export interface NetWorthBreakdown {
  /** Positive: account assets + receivables. */
  assets: number;
  /** Negative: account liabilities − payables. */
  liabilities: number;
  netWorth: number;
  accountsAssets: number;
  accountsLiabilities: number;
  receivables: number;
  payables: number;
  /** Just the account side: accountsAssets + accountsLiabilities. */
  accountsNetWorth: number;
}

export interface NetWorthScopeOptions {
  /** Restrict to these accounts (and debts linked to them). */
  accountIds?: string[];
}

async function debtTotals(options: NetWorthScopeOptions): Promise<{ receivables: number; payables: number }> {
  const sqlite = getSqlite();
  const clauses = [`status = 'open'`];
  const params: string[] = [];
  if (options.accountIds && options.accountIds.length > 0) {
    clauses.push(`account_id IN (${options.accountIds.map(() => '?').join(',')})`);
    params.push(...options.accountIds);
  }
  const rows = await sqlite.getAllAsync<{ direction: string; total: number }>(
    `SELECT direction, coalesce(sum(remaining), 0) AS total FROM debts WHERE ${clauses.join(' AND ')} GROUP BY direction`,
    params,
  );
  let receivables = 0;
  let payables = 0;
  for (const row of rows) {
    if (row.direction === 'lent') receivables += Number(row.total);
    else payables += Number(row.total);
  }
  // Shared expenses contribute their computed net balances — no debts rows are
  // written for them, so these can never double-count manual debts.
  const shared = await getSharedReceivablesPayables(options.accountIds);
  return { receivables: receivables + shared.receivables, payables: payables + shared.payables };
}

/** Every account that can participate in net worth (archived accounts still hold real money). */
async function netWorthAccounts(accountIds?: string[]): Promise<NetWorthAccountRow[]> {
  const sqlite = getSqlite();
  const clauses: string[] = [];
  const params: string[] = [];
  if (accountIds && accountIds.length > 0) {
    clauses.push(`id IN (${accountIds.map(() => '?').join(',')})`);
    params.push(...accountIds);
  }
  const rows = await sqlite.getAllAsync<{
    id: string;
    type: string;
    current_balance: number;
    include_in_net_worth: number;
  }>(
    `SELECT id, type, current_balance, include_in_net_worth FROM accounts
     ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    currentBalance: Number(row.current_balance),
    includeInNetWorth: Boolean(row.include_in_net_worth),
  }));
}

export async function getNetWorthBreakdown(options: NetWorthScopeOptions = {}): Promise<NetWorthBreakdown> {
  const [accounts, debts] = await Promise.all([netWorthAccounts(options.accountIds), debtTotals(options)]);
  const parts = netWorthParts({
    accounts,
    receivables: debts.receivables,
    payables: debts.payables,
  });
  return {
    assets: parts.assets,
    liabilities: parts.liabilities,
    netWorth: parts.netWorth,
    accountsAssets: parts.accountsAssets,
    accountsLiabilities: parts.accountsLiabilities,
    receivables: parts.receivables,
    payables: parts.payables,
    accountsNetWorth: parts.accountsAssets + parts.accountsLiabilities,
  };
}

/* --------------------------------- History --------------------------------- */

interface DatedDebtDelta {
  date: string;
  receivable: number;
  payable: number;
}

/**
 * Every debt movement ever recorded, net per day, in date order:
 *   debt created   → receivable/payable increases by the principal
 *   payment made   → the matching side decreases
 * Uses principal + payments (not the stored `remaining`) so history stays
 * correct for debts that were created or settled at any time.
 */
async function getDebtMovements(endDate: string): Promise<DatedDebtDelta[]> {
  const sqlite = getSqlite();
  const created = await sqlite.getAllAsync<{ date: string; direction: string; total: number }>(
    `SELECT date, direction, sum(principal) AS total
     FROM debts WHERE date <= ?
     GROUP BY date, direction`,
    [endDate],
  );
  const paid = await sqlite.getAllAsync<{ date: string; direction: string; total: number }>(
    `SELECT p.date AS date, d.direction AS direction, sum(p.amount) AS total
     FROM debt_payments p JOIN debts d ON d.id = p.debt_id
     WHERE p.date <= ?
     GROUP BY p.date, d.direction`,
    [endDate],
  );

  const byDate = new Map<string, { receivable: number; payable: number }>();
  const ensure = (date: string) => {
    const entry = byDate.get(date) ?? { receivable: 0, payable: 0 };
    byDate.set(date, entry);
    return entry;
  };
  for (const row of created) {
    const entry = ensure(row.date);
    if (row.direction === 'lent') entry.receivable += Number(row.total);
    else entry.payable += Number(row.total);
  }
  for (const row of paid) {
    const entry = ensure(row.date);
    if (row.direction === 'lent') entry.receivable -= Number(row.total);
    else entry.payable -= Number(row.total);
  }

  // Shared expenses: a self-paid expense creates a receivable (others' shares);
  // an expense someone else paid creates a payable (the user's share); and
  // settlements reduce the matching side. No debts rows are involved.
  for (const movement of await getSharedMovements(endDate)) {
    const entry = ensure(movement.date);
    entry.receivable += movement.receivable;
    entry.payable += movement.payable;
  }

  return Array.from(byDate.entries())
    .map(([date, entry]) => ({ date, receivable: entry.receivable, payable: entry.payable }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Daily net-worth movements (accounts + debts), used to integrate trends.
 * Transfers are internal and excluded; lending/borrowing are offsets on the
 * debt side so they do not move net worth.
 */
export async function getDailyNetWorthMovements(endDate: string): Promise<{ date: string; total: number }[]> {
  const sqlite = getSqlite();
  const accountRows = await sqlite.getAllAsync<{ date: string; total: number }>(
    `SELECT t.date AS date, sum(t.amount) AS total
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     WHERE t.is_transfer = 0 AND a.include_in_net_worth = 1 AND t.date <= ?
     GROUP BY t.date`,
    [endDate],
  );

  const byDate = new Map<string, number>();
  for (const row of accountRows) byDate.set(row.date, (byDate.get(row.date) ?? 0) + Number(row.total));
  for (const movement of await getDebtMovements(endDate)) {
    const delta = movement.receivable - movement.payable;
    if (delta === 0 && !byDate.has(movement.date)) continue;
    byDate.set(movement.date, (byDate.get(movement.date) ?? 0) + delta);
  }

  return Array.from(byDate.entries())
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Opening net-worth balance for history: initial balances of counted accounts. */
export async function netWorthOpeningBalance(): Promise<number> {
  const sqlite = getSqlite();
  const row = await sqlite.getFirstAsync<{ total: number }>(
    `SELECT coalesce(sum(initial_balance), 0) AS total FROM accounts WHERE include_in_net_worth = 1`,
  );
  return Number(row?.total ?? 0);
}

/** Debt balance snapshot at a date — used by reports that need the offset. */
export async function getDebtBalanceAt(endDate: string): Promise<{ receivables: number; payables: number }> {
  const movements = await getDebtMovements(endDate);
  return debtBalanceAt(movements, endDate);
}
