import {
  getCategoryBreakdown,
  getNetWorthSummary,
  getPeriodSummary,
  getSpendingVelocity,
} from '@/services/analytics.service';
import { isSpendable } from '@/services/accounts.service';
import { getBudgetProgressList } from '@/services/budgets.service';
import { getDebtOverview } from '@/services/debts.service';
import { getSubscriptionSummary, getUpcoming } from '@/services/recurring.service';
import { getPeriodRange, previousRange, type DateRange } from '@/utils/date';

/**
 * Compact financial context for AI requests.
 *
 * The model never sees raw tables, account identifiers or transaction rows —
 * only aggregates the financial engine has already calculated. Amounts are
 * converted to major units (rupees, not paise) so the model reasons about the
 * same numbers the user sees, and so it can never "do the maths" on raw cents.
 */

export interface AiFinanceContext {
  period: string;
  currency: string;
  income: number;
  expenses: number;
  savings: number;
  savingsRate: number;
  previous: { income: number; expenses: number; savings: number };
  topCategories: { name: string; amount: number; share: number; changePercent: number | null }[];
  budgetHealth: { total: number; onTrack: number; overBudget: number; nearLimit: number };
  pace: { perDay: number; previousPerDay: number; projectedTotal: number; daysElapsed: number; daysInPeriod: number };
  upcoming: { count: number; overdue: number; total: number };
  subscriptions: { monthlyTotal: number; annualTotal: number; count: number };
  debt: { theyOweYou: number; youOwe: number };
  netWorth: number;
  liquidCash: number;
}

export function toMajor(minor: number): number {
  return Math.round(minor) / 100;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export async function buildFinanceContext(options: {
  monthStartDay: number;
  range?: DateRange;
  periodLabel?: string;
  currency?: string;
}): Promise<AiFinanceContext> {
  const range = options.range ?? getPeriodRange('thisMonth', { monthStartDay: options.monthStartDay });
  const previous = previousRange(range);

  const [summary, previousSummary, categories, budgets, pace, upcoming, subscriptions, debt, netWorthSummary] =
    await Promise.all([
      getPeriodSummary({ range }),
      getPeriodSummary({ range: previous }),
      getCategoryBreakdown({ range }),
      getBudgetProgressList(),
      getSpendingVelocity({ range }),
      getUpcoming(20),
      getSubscriptionSummary(),
      getDebtOverview(),
      getNetWorthSummary(),
    ]);

  const overdueCount = upcoming.filter((entry) => entry.overdue).length;
  const liquidCash = netWorthSummary.accounts
    .filter((account) => account.includeInTotalBalance && isSpendable(account.type))
    .reduce((sum, account) => sum + account.currentBalance, 0);

  return {
    period: options.periodLabel ?? range.label,
    currency: options.currency ?? 'INR',
    income: toMajor(summary.totals.income),
    expenses: toMajor(summary.totals.netExpense),
    savings: toMajor(summary.totals.savings),
    savingsRate: round(summary.totals.savingsRate, 1),
    previous: {
      income: toMajor(previousSummary.totals.income),
      expenses: toMajor(previousSummary.totals.netExpense),
      savings: toMajor(previousSummary.totals.savings),
    },
    topCategories: categories.rows.slice(0, 6).map((row) => ({
      name: row.name,
      amount: toMajor(row.total),
      share: round(row.share, 1),
      changePercent: row.change === null ? null : round(row.change, 1),
    })),
    budgetHealth: {
      total: budgets.length,
      onTrack: budgets.filter((budget) => budget.percent < 85).length,
      nearLimit: budgets.filter((budget) => budget.percent >= 85 && budget.percent < 100).length,
      overBudget: budgets.filter((budget) => budget.percent >= 100).length,
    },
    pace: {
      perDay: toMajor(pace.currentPerDay),
      previousPerDay: toMajor(pace.previousPerDay),
      projectedTotal: toMajor(pace.projectedTotal),
      daysElapsed: pace.daysElapsed,
      daysInPeriod: pace.daysInPeriod,
    },
    upcoming: {
      count: upcoming.length,
      overdue: overdueCount,
      total: toMajor(upcoming.filter((entry) => entry.recurring.type !== 'income').reduce((sum, entry) => sum + entry.recurring.amount, 0)),
    },
    subscriptions: {
      monthlyTotal: toMajor(subscriptions.monthlyTotal),
      annualTotal: toMajor(subscriptions.annualTotal),
      count: subscriptions.activeCount,
    },
    debt: { theyOweYou: toMajor(debt.theyOweYou), youOwe: toMajor(debt.youOwe) },
    netWorth: toMajor(netWorthSummary.netWorth),
    liquidCash: toMajor(liquidCash),
  };
}
