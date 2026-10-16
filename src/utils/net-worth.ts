import type { AccountType } from '@/db/schema';

/**
 * Net worth = assets − liabilities, where:
 *   • assets      = non-liability accounts (respecting `includeInNetWorth`)
 *                   + money owed to you (receivables)
 *   • liabilities = credit-card / loan balances (stored negative)
 *                   + money you owe (payables)
 *
 * Why receivables/payables are included: lending money moves cash out of an
 * account and creates a receivable; borrowing does the opposite. The debt tables
 * are the other half of those ledger entries, so including them keeps net worth
 * unchanged by lending/borrowing and only moved by real income, spending and
 * adjustments.
 *
 * Pure and unit-tested — services pass database rows in.
 */

export interface NetWorthAccountRow {
  id: string;
  type: AccountType | string;
  currentBalance: number;
  includeInNetWorth: boolean;
}

const LIABILITY_TYPES: ReadonlySet<string> = new Set(['credit_card', 'loan', 'mortgage']);

export function isLiabilityType(type: string): boolean {
  return LIABILITY_TYPES.has(type);
}

export interface NetWorthParts {
  /** Positive: account assets + receivables. */
  assets: number;
  /** Negative (stored convention): account liabilities (cards/loans) − payables. */
  liabilities: number;
  /** assets + liabilities. */
  netWorth: number;
  accountsAssets: number;
  accountsLiabilities: number;
  /** Money owed to you, open debts only. */
  receivables: number;
  /** Money you owe, open debts only (positive magnitude). */
  payables: number;
}

export function netWorthParts(input: {
  accounts: NetWorthAccountRow[];
  receivables?: number;
  payables?: number;
}): NetWorthParts {
  let accountsAssets = 0;
  let accountsLiabilities = 0;
  for (const account of input.accounts) {
    if (!account.includeInNetWorth) continue;
    if (isLiabilityType(account.type)) accountsLiabilities += account.currentBalance;
    else accountsAssets += account.currentBalance;
  }
  const receivables = Math.max(0, input.receivables ?? 0);
  const payables = Math.max(0, input.payables ?? 0);
  const assets = accountsAssets + receivables;
  const liabilities = accountsLiabilities - payables;
  return {
    assets,
    liabilities,
    netWorth: assets + liabilities,
    accountsAssets,
    accountsLiabilities,
    receivables,
    payables,
  };
}

/** Receivable/payable balance at a point in time from dated movements. */
export function debtBalanceAt(
  movements: { date: string; receivable: number; payable: number }[],
  endDate: string,
): { receivables: number; payables: number } {
  let receivables = 0;
  let payables = 0;
  for (const movement of movements) {
    if (movement.date > endDate) break;
    receivables += movement.receivable;
    payables += movement.payable;
  }
  return { receivables: Math.max(0, receivables), payables: Math.max(0, payables) };
}
