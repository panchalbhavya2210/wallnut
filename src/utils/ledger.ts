import { addDays, addMonths, addYears, differenceInCalendarDays, fromISODate, toISODate } from '@/utils/date';
import type { TransactionType } from '@/db/schema';

/**
 * Pure ledger rules — no database, no React Native. Services delegate here so
 * the accounting invariants are unit-testable and identical everywhere.
 *
 * Money is integer minor units (paise). `transactions.amount` is signed from the
 * perspective of the account the row belongs to.
 */

export function normalizeTransactionAmount(type: TransactionType, amount: number): number {
  const rounded = Math.round(amount);
  switch (type) {
    case 'expense':
    case 'transfer':
      // Money leaves the account.
      return -Math.abs(rounded);
    case 'income':
    case 'refund':
      // Money arrives. A refund is money back, but it is NOT income: it nets
      // against the expense it reverses.
      return Math.abs(rounded);
    case 'lending':
      return -Math.abs(rounded);
    case 'borrowing':
      return Math.abs(rounded);
    case 'debt_payment':
    case 'adjustment':
    default:
      // Signed as entered: collecting a loan you gave is positive, repaying what
      // you borrowed is negative.
      return rounded;
  }
}

export interface MovementRow {
  type: string;
  amount: number;
}

export interface MovementSummary {
  income: number;
  /** Negative, as stored. */
  expenses: number;
  refunds: number;
  /** Positive number: what actually left your pocket after refunds. */
  netExpense: number;
  savings: number;
  savingsRate: number;
  /** Absolute value of transfer volume (excluded from income and spending). */
  transfers: number;
  /** Cash moved by lending, borrowing and debt repayments. */
  debtOutflow: number;
  debtInflow: number;
  adjustments: number;
  /** Net worth movement from real income/expense activity. */
  netWorthDelta: number;
}

/**
 * The single source of truth for "what does this set of rows mean".
 *  • transfers are never spending and never income
 *  • refunds reduce spending instead of adding income
 *  • adjustments, lending, borrowing and debt repayments move cash but never
 *    appear as income or expense
 */
export function summarizeMovements(rows: MovementRow[]): MovementSummary {
  let income = 0;
  let grossExpenses = 0;
  let refunds = 0;
  let transfers = 0;
  let debtOutflow = 0;
  let debtInflow = 0;
  let adjustments = 0;

  for (const row of rows) {
    switch (row.type) {
      case 'income':
        income += row.amount;
        break;
      case 'expense':
        grossExpenses += Math.abs(row.amount);
        break;
      case 'refund':
        refunds += Math.abs(row.amount);
        break;
      case 'transfer':
        transfers += Math.abs(row.amount);
        break;
      case 'adjustment':
        adjustments += row.amount;
        break;
      case 'lending':
      case 'borrowing':
      case 'debt_payment':
        if (row.amount < 0) debtOutflow += Math.abs(row.amount);
        else debtInflow += row.amount;
        break;
      default:
        break;
    }
  }

  const netExpense = grossExpenses - refunds;
  const savings = income - netExpense;

  return {
    income,
    expenses: -grossExpenses,
    refunds,
    netExpense,
    savings,
    savingsRate: income > 0 ? (savings / income) * 100 : 0,
    transfers,
    debtOutflow,
    debtInflow,
    adjustments,
    netWorthDelta: income - netExpense + adjustments,
  };
}

/* --------------------------------- Budgets -------------------------------- */

export type BudgetPeriod = 'weekly' | 'monthly' | 'yearly' | 'custom';

export interface BudgetWindow {
  start: Date;
  end: Date;
}

/**
 * The active window for a budget anchored on `anchor` (defaults to today).
 * Mirrors YNAB-style "month starts on the 5th" behaviour.
 */
export function budgetWindowFor(
  budget: { startDate: string; endDate?: string | null; period: BudgetPeriod },
  anchor: Date = new Date(),
): BudgetWindow {
  const start = fromISODate(budget.startDate) ?? new Date(anchor.getFullYear(), anchor.getMonth(), 1);

  if (budget.period === 'custom') {
    const end = (budget.endDate ? fromISODate(budget.endDate) : null) ?? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return { start, end };
  }

  if (budget.period === 'weekly') {
    const weeksSince = Math.max(0, Math.floor(differenceInCalendarDays(anchor, start) / 7));
    const windowStart = addDays(start, weeksSince * 7);
    return { start: windowStart, end: addDays(windowStart, 6) };
  }

  if (budget.period === 'yearly') {
    const yearsSince = Math.max(0, anchor.getFullYear() - start.getFullYear());
    const windowStart = addYears(start, yearsSince);
    return { start: windowStart, end: addDays(addYears(windowStart, 1), -1) };
  }

  // Monthly, anchored on the budget's start day-of-month.
  const day = start.getDate();
  const lastDayThisMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  const anchorDay = Math.min(day, lastDayThisMonth);
  const windowStart =
    anchor.getDate() >= anchorDay
      ? new Date(anchor.getFullYear(), anchor.getMonth(), day)
      : new Date(anchor.getFullYear(), anchor.getMonth() - 1, day);
  return { start: windowStart, end: addDays(addMonths(windowStart, 1), -1) };
}

export type BudgetHealth = 'on_track' | 'warning' | 'over';

export function budgetHealth(percent: number): BudgetHealth {
  if (percent >= 100) return 'over';
  if (percent >= 85) return 'warning';
  return 'on_track';
}

export interface BudgetMaths {
  /** Percentage of the budget used. */
  percent: number;
  remaining: number;
  /** What remains divided by the days left — the daily allowance. */
  safeToSpendPerDay: number;
  /** End-of-period spend if the current pace holds. */
  projected: number;
}

export function budgetMaths(input: {
  amount: number;
  spent: number;
  daysElapsed: number;
  daysTotal: number;
  daysRemaining: number;
}): BudgetMaths {
  const percent = input.amount > 0 ? (input.spent / input.amount) * 100 : 0;
  const remaining = input.amount - input.spent;
  const projected = input.daysElapsed > 0 ? (input.spent / input.daysElapsed) * input.daysTotal : input.spent;
  return {
    percent,
    remaining,
    safeToSpendPerDay: remaining > 0 ? Math.round(remaining / Math.max(1, input.daysRemaining)) : 0,
    projected,
  };
}

/* ------------------------------- Recurring -------------------------------- */

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

/**
 * Advances one occurrence of a schedule.
 *
 * Monthly/yearly schedules are anchored to a day of the month: the 31st stays
 * the 31st. Months that do not contain the anchored day are **skipped** (Wallet
 * behaves the same way) instead of clamping and permanently drifting the
 * schedule to the 28th. `null` means no valid occurrence was found within a
 * reasonable horizon, which callers treat as the end of the schedule.
 */
export function advanceRecurrence(
  date: Date,
  frequency: RecurrenceFrequency,
  interval: number,
  anchorDay?: number | null,
): Date | null {
  const step = Math.max(1, Math.round(interval));
  switch (frequency) {
    case 'daily':
      return addDays(date, step);
    case 'weekly':
      return addDays(date, 7 * step);
    case 'custom':
      return addDays(date, step);
    case 'yearly': {
      const day = anchorDay ?? date.getDate();
      for (let attempt = 1; attempt <= 8; attempt++) {
        const candidate = addYears(new Date(date.getFullYear(), date.getMonth(), 1), attempt * step);
        const daysInMonth = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
        if (day <= daysInMonth) return new Date(candidate.getFullYear(), candidate.getMonth(), day);
      }
      return null;
    }
    case 'monthly':
    default: {
      const day = anchorDay ?? date.getDate();
      for (let attempt = 1; attempt <= 4; attempt++) {
        const candidate = addMonths(new Date(date.getFullYear(), date.getMonth(), 1), attempt * step);
        const daysInMonth = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
        if (day <= daysInMonth) return new Date(candidate.getFullYear(), candidate.getMonth(), day);
      }
      return null;
    }
  }
}

/** Converts any cadence to its monthly equivalent (forecasts, health metrics). */
export function monthlyEquivalent(amount: number, frequency: RecurrenceFrequency, interval = 1): number {
  const step = Math.max(1, Math.round(interval));
  switch (frequency) {
    case 'daily':
      return amount * 30 * step;
    case 'weekly':
      return (amount * 52 * step) / 12;
    case 'yearly':
      return (amount * step) / 12;
    case 'custom':
      // Custom schedules are "every N days".
      return (amount * 30) / step;
    case 'monthly':
    default:
      return amount * step;
  }
}

/* ------------------------------ Investments ------------------------------- */

export interface InvestmentPerformance {
  value: number;
  invested: number;
  gain: number;
  gainPercent: number | null;
}

export function investmentPerformance(value: number, invested: number): InvestmentPerformance {
  const gain = value - invested;
  return {
    value,
    invested,
    gain,
    gainPercent: invested > 0 ? (gain / invested) * 100 : null,
  };
}

/** Emergency reserve in months = spendable balance ÷ average monthly spending. */
export function reserveMonths(spendableBalance: number, averageMonthlySpend: number): number {
  return averageMonthlySpend > 0 ? spendableBalance / averageMonthlySpend : 0;
}

export { toISODate };
