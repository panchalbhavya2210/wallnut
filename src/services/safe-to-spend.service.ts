import { listAccounts } from '@/services/accounts.service';
import { getBudgetProgressList } from '@/services/budgets.service';
import { getGoalsProgress } from '@/services/goals.service';
import { getUpcoming } from '@/services/recurring.service';
import { differenceInCalendarDays, getPeriodRange, toISODate } from '@/utils/date';

/**
 * Safe to spend — the flagship number.
 *
 * available cash − upcoming bills (until the next income lands) − planned goal
 * savings − what the remaining budgets intend to spend, divided by the days
 * until that next income. Every input comes from the financial engine, so the
 * breakdown the UI shows always adds up to the headline figure.
 */

export interface SafeToSpendBreakdown {
  available: number;
  upcomingBills: number;
  plannedSavings: number;
  budgetCommitments: number;
  safe: number;
  perDay: number;
  days: number;
  nextIncomeDate: string | null;
  nextIncomeLabel: string | null;
}

export async function getSafeToSpend(monthStartDay = 1): Promise<SafeToSpendBreakdown> {
  const [accounts, budgets, upcoming, goals] = await Promise.all([
    listAccounts(),
    getBudgetProgressList(),
    getUpcoming(60),
    getGoalsProgress(),
  ]);

  const today = new Date();
  const todayISO = toISODate(today);

  const available = accounts
    .filter((account) => account.includeInTotalBalance && (account.type === 'bank' || account.type === 'cash' || account.type === 'savings' || account.type === 'wallet'))
    .reduce((sum, account) => sum + account.currentBalance, 0);

  const incomeItems = upcoming
    .filter((entry) => entry.recurring.type === 'income')
    .sort((a, b) => a.nextDate.getTime() - b.nextDate.getTime());
  const nextIncome = incomeItems[0] ?? null;
  const fallbackEnd = getPeriodRange('thisMonth', { monthStartDay }).end;
  const horizonISO = nextIncome && toISODate(nextIncome.nextDate) >= todayISO ? toISODate(nextIncome.nextDate) : toISODate(fallbackEnd);
  const horizon = nextIncome && horizonISO === toISODate(nextIncome.nextDate) ? nextIncome.nextDate : fallbackEnd;

  const upcomingBills = upcoming
    .filter((entry) => entry.recurring.type !== 'income' && toISODate(entry.nextDate) <= horizonISO)
    .reduce((sum, entry) => sum + entry.recurring.amount, 0);

  const plannedSavings = goals.reduce((sum, goal) => sum + (goal.requiredMonthly ?? 0), 0);
  const budgetCommitments = budgets.reduce((sum, budget) => sum + Math.max(0, budget.remaining), 0);

  const safe = Math.max(0, available - upcomingBills - plannedSavings - budgetCommitments);
  const days = Math.max(1, differenceInCalendarDays(horizon, today) + 1);
  const perDay = Math.round(safe / days);

  return {
    available,
    upcomingBills,
    plannedSavings,
    budgetCommitments,
    safe,
    perDay,
    days,
    nextIncomeDate: nextIncome ? toISODate(nextIncome.nextDate) : null,
    nextIncomeLabel: nextIncome ? nextIncome.recurring.merchant : null,
  };
}
