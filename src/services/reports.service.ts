import { asc, eq, sql } from 'drizzle-orm';

import { getDb, getSqlite } from '@/db/client';
import { savedReports, type SavedReport } from '@/db/schema';
import { listAccounts, getAccountGroupsSummary, isCreditLike, isInvestment, isLiability, isSpendable } from '@/services/accounts.service';
import { getBudgetProgressList } from '@/services/budgets.service';
import { getDebtOverview, debtsDueSoon } from '@/services/debts.service';
import { contributionsInRange, getGoalsProgress } from '@/services/goals.service';
import { listInstallmentProgress, postDueInstallments } from '@/services/installments.service';
import { listRecurring, getUpcoming, monthlyEquivalent } from '@/services/recurring.service';
import { getSharedBalances, listSharedExpenses } from '@/services/shared.service';
import { getCategoryBreakdown, getPeriodSummary, getTopMerchants } from '@/services/analytics.service';
import { notifyDbChanged } from '@/stores/db.store';
import {
  addDays,
  daysInRange,
  eachDayInRange,
  endOfCycle,
  formatDayMonth,
  getPeriodRange,
  startOfCycle,
  toISODate,
  type DateRange,
} from '@/utils/date';
import { createId } from '@/utils/id';
import { percentageChange } from '@/utils/money';

/**
 * Reports: cash-flow statement, deterministic forecast, monthly review,
 * financial health and saved report configurations.
 */

/* ------------------------------- Cash flow --------------------------------- */

export interface CashFlowReport {
  range: DateRange;
  income: number;
  expenses: number; // net of refunds, positive number
  grossExpenses: number;
  refunds: number;
  investments: number;
  cardAndLoanPayments: number;
  savingsTransfers: number;
  insurance: number;
  lentOut: number;
  borrowedIn: number;
  debtCollected: number;
  debtRepaid: number;
  goalContributions: number;
  /** Money left in spendable accounts after real outflows (per cash-flow statement convention). */
  netCashChange: number;
  transferVolume: number;
}

export async function getCashFlowReport(range: DateRange): Promise<CashFlowReport> {
  const sqlite = getSqlite();
  const from = toISODate(range.start);
  const to = toISODate(range.end);

  const totals = await sqlite.getFirstAsync<{
    income: number;
    grossExpenses: number;
    refunds: number;
    lentOut: number;
    borrowedIn: number;
    debtCollected: number;
    debtRepaid: number;
  }>(
    `SELECT
       coalesce(sum(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
       coalesce(sum(CASE WHEN type = 'expense' THEN abs(amount) ELSE 0 END), 0) AS grossExpenses,
       coalesce(sum(CASE WHEN type = 'refund' THEN amount ELSE 0 END), 0) AS refunds,
       coalesce(sum(CASE WHEN type = 'lending' THEN abs(amount) ELSE 0 END), 0) AS lentOut,
       coalesce(sum(CASE WHEN type = 'borrowing' THEN amount ELSE 0 END), 0) AS borrowedIn,
       coalesce(sum(CASE WHEN type = 'debt_payment' AND amount > 0 THEN amount ELSE 0 END), 0) AS debtCollected,
       coalesce(sum(CASE WHEN type = 'debt_payment' AND amount < 0 THEN abs(amount) ELSE 0 END), 0) AS debtRepaid
     FROM transactions WHERE date >= ? AND date <= ?`,
    [from, to],
  );

  const transfers = await sqlite.getAllAsync<{ destType: string; total: number }>(
    `SELECT a.type AS destType, coalesce(sum(abs(t.amount)), 0) AS total
     FROM transactions t JOIN accounts a ON a.id = t.transfer_account_id
     WHERE t.is_transfer = 1 AND t.date >= ? AND t.date <= ?
     GROUP BY a.type`,
    [from, to],
  );

  let investments = 0;
  let cardAndLoanPayments = 0;
  let savingsTransfers = 0;
  let insuranceTransfers = 0;
  let transferVolume = 0;
  for (const row of transfers) {
    transferVolume += Number(row.total);
    if (row.destType === 'investment') investments += Number(row.total);
    else if (row.destType === 'credit_card' || row.destType === 'loan' || row.destType === 'mortgage') cardAndLoanPayments += Number(row.total);
    else if (row.destType === 'savings') savingsTransfers += Number(row.total);
    else if (row.destType === 'insurance') insuranceTransfers += Number(row.total);
  }

  const goalContributions = await contributionsInRange(from, to);
  const expenses = Math.max(0, Number(totals?.grossExpenses ?? 0) - Number(totals?.refunds ?? 0));

  const netCashChange =
    Number(totals?.income ?? 0) +
    Number(totals?.refunds ?? 0) -
    Number(totals?.grossExpenses ?? 0) -
    investments -
    cardAndLoanPayments -
    insuranceTransfers -
    Number(totals?.lentOut ?? 0) +
    Number(totals?.borrowedIn ?? 0) +
    Number(totals?.debtCollected ?? 0) -
    Number(totals?.debtRepaid ?? 0);

  return {
    range,
    income: Number(totals?.income ?? 0),
    expenses,
    grossExpenses: Number(totals?.grossExpenses ?? 0),
    refunds: Number(totals?.refunds ?? 0),
    investments,
    cardAndLoanPayments,
    savingsTransfers,
    insurance: insuranceTransfers,
    lentOut: Number(totals?.lentOut ?? 0),
    borrowedIn: Number(totals?.borrowedIn ?? 0),
    debtCollected: Number(totals?.debtCollected ?? 0),
    debtRepaid: Number(totals?.debtRepaid ?? 0),
    goalContributions,
    netCashChange,
    transferVolume,
  };
}

/* -------------------------------- Forecast --------------------------------- */

export interface ForecastLine {
  label: string;
  amount: number; // signed
  detail?: string;
}

export interface Forecast {
  asOf: string;
  startingBalance: number;
  lines: ForecastLine[];
  projectedEndBalance: number;
  daysRemaining: number;
  /** Which transactions the projection is based on — always shown to the user. */
  basis: string[];
}

/**
 * Deterministic month-end projection. Uses real balances plus scheduled
 * outflows (recurring, confirm-first planned payments, installments, debts due,
 * credit-card due dates). Never presented as actual money.
 */
export async function getForecast(monthStartDay = 1): Promise<Forecast> {
  const now = new Date();
  const todayISO = toISODate(now);
  const monthEnd = endOfCycle(now, monthStartDay);
  const monthEndISO = toISODate(monthEnd);
  const daysRemaining = Math.max(0, daysInRange({ start: now, end: monthEnd, label: 'Remaining' }) - 1);

  const accounts = await listAccounts();
  const startingBalance = accounts
    .filter((account) => account.includeInTotalBalance && isSpendable(account.type))
    .reduce((sum, account) => sum + account.currentBalance, 0);

  const lines: ForecastLine[] = [];
  const basis: string[] = [];

  // Recurring (auto-post) and planned (confirm-first) items due before month end.
  const recurring = await listRecurring(false);
  let expectedIncome = 0;
  let expectedRecurring = 0;
  let plannedPayments = 0;
  for (const item of recurring) {
    if (item.nextDate > monthEndISO) continue;
    if (item.type === 'income') expectedIncome += item.amount;
    else if (item.type === 'expense') {
      if (item.autoPost) expectedRecurring += item.amount;
      else plannedPayments += item.amount;
    } else if (item.type === 'transfer' && item.autoPost) {
      // Transfers to investment accounts reduce spendable cash.
      const destination = accounts.find((account) => account.id === item.transferAccountId);
      if (destination && isInvestment(destination.type)) expectedRecurring += item.amount;
    }
  }
  if (expectedIncome > 0) {
    lines.push({ label: 'Expected income', amount: expectedIncome, detail: 'Recurring credits due this month' });
    basis.push('recurring income');
  }
  if (expectedRecurring > 0) {
    lines.push({ label: 'Recurring expenses', amount: -expectedRecurring, detail: 'Subscriptions, rent, SIPs' });
    basis.push('recurring expenses');
  }
  if (plannedPayments > 0) {
    lines.push({ label: 'Planned payments', amount: -plannedPayments, detail: 'Awaiting your confirmation' });
    basis.push('planned payments');
  }

  // Installments due before month end.
  const plans = await listInstallmentProgress();
  let installmentDue = 0;
  for (const plan of plans) {
    if (plan.nextDate && plan.nextDate <= monthEndISO) installmentDue += plan.nextAmount;
  }
  if (installmentDue > 0) {
    lines.push({ label: 'Installments', amount: -installmentDue, detail: 'Linked installment plans' });
    basis.push('installments');
  }

  // Debts due this month.
  const soon = await debtsDueSoon(31);
  const debtDue = soon
    .filter((debt) => debt.dueDate && debt.dueDate <= monthEndISO && debt.direction === 'borrowed')
    .reduce((sum, debt) => sum + debt.remaining, 0);
  if (debtDue > 0) {
    lines.push({ label: 'Debt repayments due', amount: -debtDue, detail: 'Money you owe, due this month' });
    basis.push('debts due');
  }

  // Credit-card / loan / mortgage outstanding with a due date before month end
  // (informational: payments move cash and settle liability — cash leaves the pool).
  let cardDue = 0;
  for (const account of accounts) {
    if (!isCreditLike(account.type) || account.currentBalance >= 0) continue;
    if (!account.paymentDueDay) continue;
    const dueThisMonth = new Date(now.getFullYear(), now.getMonth(), Math.min(account.paymentDueDay, 28));
    if (toISODate(dueThisMonth) >= todayISO && toISODate(dueThisMonth) <= monthEndISO) {
      cardDue += -account.currentBalance;
    }
  }
  if (cardDue > 0) {
    lines.push({ label: 'Credit card payments', amount: -cardDue, detail: 'Due before month end' });
    basis.push('card due dates');
  }

  // Expected variable spending: the current pace projected to month end, minus
  // what has already been spent and minus the scheduled bills already counted
  // above (so recurring payments are not double-counted). Deterministic, and
  // always presented as an estimate.
  const { getSpendingVelocity } = await import('@/services/analytics.service');
  const pace = await getSpendingVelocity({
    range: { start: startOfCycle(now, monthStartDay), end: monthEnd, label: 'Forecast' },
  });
  const expectedSpending = Math.max(0, pace.projectedTotal - pace.currentTotal - expectedRecurring - plannedPayments);
  if (expectedSpending > 0) {
    lines.push({ label: 'Expected spending', amount: -expectedSpending, detail: 'At your current pace — an estimate' });
    basis.push('spending pace');
  }

  const projectedEndBalance = startingBalance + lines.reduce((sum, line) => sum + line.amount, 0);
  return {
    asOf: todayISO,
    startingBalance,
    lines,
    projectedEndBalance,
    daysRemaining,
    basis,
  };
}

/* ------------------------------ Monthly review ------------------------------ */

export interface MonthlyReview {
  range: DateRange;
  previousRange: DateRange;
  income: number;
  expenses: number;
  refunds: number;
  saved: number;
  savingsRate: number;
  previousSavingsRate: number;
  transactionCount: number;
  biggestCategory: { name: string; total: number; color: string } | null;
  biggestMerchant: { name: string; total: number } | null;
  largestExpense: { merchant: string | null; description: string | null; amount: number; date: string } | null;
  spendingChangePercent: number | null;
  savingsChangePercent: number | null;
  netWorthChange: number;
  topCategories: { name: string; total: number; color: string; change: number | null }[];
}

export async function getMonthlyReview(monthStartDay = 1): Promise<MonthlyReview> {
  const now = new Date();
  const range = getPeriodRange('thisMonth', { monthStartDay, anchor: now });
  const previous = getPeriodRange('lastMonth', { monthStartDay, anchor: now });

  const [summary, previousSummary, categories, merchants, netWorth] = await Promise.all([
    getPeriodSummary({ range }),
    getPeriodSummary({ range: previous }),
    getCategoryBreakdown({ range }),
    getTopMerchants({ range }, 1),
    import('@/services/analytics.service').then((module) => module.getNetWorthChanges(monthStartDay)),
  ]);

  const sqlite = getSqlite();
  const largest = await sqlite.getFirstAsync<{ merchant: string | null; description: string | null; amount: number; date: string }>(
    `SELECT merchant, description, abs(amount) AS amount, date
     FROM transactions WHERE type = 'expense' AND date >= ? AND date <= ?
     ORDER BY abs(amount) DESC LIMIT 1`,
    [toISODate(range.start), toISODate(range.end)],
  );

  return {
    range,
    previousRange: previous,
    income: summary.totals.income,
    expenses: summary.totals.netExpense,
    refunds: summary.totals.refunds,
    saved: summary.totals.savings,
    savingsRate: summary.totals.savingsRate,
    previousSavingsRate: previousSummary.totals.savingsRate,
    transactionCount: summary.totals.transactionCount,
    biggestCategory: categories.rows[0]
      ? { name: categories.rows[0].name, total: categories.rows[0].total, color: categories.rows[0].color }
      : null,
    biggestMerchant: merchants[0] ? { name: merchants[0].name, total: merchants[0].total } : null,
    largestExpense: largest
      ? { merchant: largest.merchant, description: largest.description, amount: Number(largest.amount), date: largest.date }
      : null,
    spendingChangePercent: percentageChange(summary.totals.netExpense, previousSummary.totals.netExpense),
    savingsChangePercent: percentageChange(summary.totals.savings, previousSummary.totals.savings),
    netWorthChange: netWorth.changeThisMonth,
    topCategories: categories.rows.slice(0, 5).map((row) => ({
      name: row.name,
      total: row.total,
      color: row.color,
      change: row.change,
    })),
  };
}

/* ---------------------------- Financial health ------------------------------ */

export interface FinancialHealth {
  savingsRate: number;
  emergencyReserveMonths: number;
  monthlyRecurringCommitments: number;
  subscriptionAnnualCost: number;
  totalDebt: number;
  receivables: number;
  budgetAdherencePercent: number | null;
  budgetsOverCount: number;
  netWorth: number;
  netWorthGrowthPercent: number | null;
  investmentValue: number;
  investmentGain: number;
  goalProgressPercent: number | null;
}

/**
 * Descriptive financial health metrics only — no advice, no scoring models.
 */
export async function getFinancialHealth(monthStartDay = 1): Promise<FinancialHealth> {
  const now = new Date();
  const summary = await getAccountGroupsSummary();
  const range = getPeriodRange('6m', { monthStartDay, anchor: now });
  const sixMonth = await getPeriodSummary({ range });
  const months = 6;
  const avgMonthlyExpenses = sixMonth.totals.netExpense / months;

  const recurring = await listRecurring(false);
  let monthlyCommitments = 0;
  let subscriptionAnnual = 0;
  for (const item of recurring) {
    if (item.type !== 'expense') continue;
    const monthly = monthlyEquivalent(item.amount, item.frequency, item.interval);
    monthlyCommitments += monthly;
    if (item.isSubscription) subscriptionAnnual += monthly * 12;
  }

  const budgets = await getBudgetProgressList();
  const over = budgets.filter((budget) => budget.percent > 100);
  const adherence =
    budgets.length > 0
      ? budgets.reduce((sum, budget) => sum + Math.min(100, budget.percent), 0) / budgets.length
      : null;

  const debtOverview = await getDebtOverview();
  const goals = await getGoalsProgress();
  const goalProgress = goals.length > 0 ? goals.reduce((sum, goal) => sum + Math.min(100, goal.percent), 0) / goals.length : null;

  const accounts = await listAccounts();
  const investments = accounts.filter((account) => isInvestment(account.type));
  const investmentValue = investments.reduce((sum, account) => sum + account.currentBalance, 0);
  const investmentGain = investments.reduce(
    (sum, account) => sum + (account.currentBalance - (account.costBasis ?? account.initialBalance)),
    0,
  );

  const netWorthTrend = await import('@/services/analytics.service').then((module) =>
    module.getNetWorthChanges(monthStartDay),
  );

  return {
    savingsRate: sixMonth.totals.savingsRate,
    emergencyReserveMonths: avgMonthlyExpenses > 0 ? summary.liquidTotal / avgMonthlyExpenses : 0,
    monthlyRecurringCommitments: monthlyCommitments,
    subscriptionAnnualCost: subscriptionAnnual,
    totalDebt: debtOverview.youOwe,
    receivables: debtOverview.theyOweYou,
    budgetAdherencePercent: adherence,
    budgetsOverCount: over.length,
    netWorth: summary.netWorth,
    netWorthGrowthPercent: percentageChange(netWorthTrend.current, netWorthTrend.yearAgoValue),
    investmentValue,
    investmentGain,
    goalProgressPercent: goalProgress,
  };
}

/* ------------------------------ Saved reports ------------------------------- */

export interface SavedReportConfig {
  period?: string;
  accountIds?: string[];
  categoryIds?: string[];
  tagIds?: string[];
  types?: string[];
  search?: string;
  minAmount?: number;
  maxAmount?: number;
  includeTransfers?: boolean;
}

export async function listSavedReports(): Promise<SavedReport[]> {
  const db = getDb();
  return db.select().from(savedReports).orderBy(asc(savedReports.createdAt));
}

export async function saveReport(name: string, config: SavedReportConfig): Promise<SavedReport> {
  const db = getDb();
  if (!name.trim()) throw new Error('Give the report a name.');
  const now = Date.now();
  const row: SavedReport = {
    id: createId('rpt'),
    name: name.trim(),
    config: JSON.stringify(config),
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(savedReports).values(row);
  notifyDbChanged();
  return row;
}

export async function deleteSavedReport(id: string): Promise<void> {
  const db = getDb();
  await db.delete(savedReports).where(eq(savedReports.id, id));
  notifyDbChanged();
}

export function parseReportConfig(report: SavedReport): SavedReportConfig {
  try {
    return JSON.parse(report.config) as SavedReportConfig;
  } catch {
    return {};
  }
}

/* ------------------------------ Reminders ---------------------------------- */

export interface Reminder {
  id: string;
  kind: 'recurring' | 'debt' | 'budget' | 'goal' | 'card' | 'installment';
  title: string;
  detail: string;
  date: string | null;
  amount: number | null;
  href?: string;
  severity: 'info' | 'warning' | 'negative';
}

/** In-app reminders — surfaced on Home; categories can be turned off in Settings. */
export async function getReminders(
  enabled: {
    recurring: boolean;
    debt: boolean;
    budget: boolean;
    goal: boolean;
    card: boolean;
    installment: boolean;
    shared: boolean;
  },
): Promise<Reminder[]> {
  const reminders: Reminder[] = [];
  const today = toISODate(new Date());
  const soonISO = toISODate(addDays(new Date(), 14));
  const monthEndISO = toISODate(endOfCycle(new Date(), 1));

  if (enabled.recurring) {
    const upcoming = await getUpcoming(30);
    for (const item of upcoming.slice(0, 8)) {
      const date = toISODate(item.nextDate);
      if (date > soonISO) continue;
      const reminderDays = item.recurring.reminderDaysBefore;
      // -1 means the user turned reminders off for this schedule.
      if (reminderDays < 0) continue;
      const windowEnd = toISODate(addDays(new Date(), reminderDays));
      if (date > windowEnd) continue;
      const overdue = date < today;
      reminders.push({
        id: `rec-${item.recurring.id}-${date}`,
        kind: 'recurring',
        title: item.recurring.merchant,
        detail: overdue
          ? 'Recurring payment overdue'
          : item.recurring.isSubscription
            ? 'Subscription due'
            : 'Recurring payment due',
        date,
        amount: item.recurring.type === 'income' ? item.recurring.amount : -item.recurring.amount,
        href: '/recurring',
        severity: overdue ? 'warning' : 'info',
      });
    }
  }

  if (enabled.installment) {
    const plans = await listInstallmentProgress();
    for (const plan of plans) {
      if (!plan.nextDate || plan.nextDate > soonISO) continue;
      reminders.push({
        id: `ins-${plan.plan.id}-${plan.nextDate}`,
        kind: 'installment',
        title: `${plan.plan.name} installment`,
        detail: `${plan.plan.postedCount + 1} of ${plan.plan.totalCount}`,
        date: plan.nextDate,
        amount: -plan.nextAmount,
        href: '/installments',
        severity: 'info',
      });
    }
  }

  if (enabled.debt) {
    const due = await debtsDueSoon(14);
    for (const debt of due) {
      reminders.push({
        id: `debt-${debt.id}`,
        kind: 'debt',
        title: debt.direction === 'borrowed' ? `Repay ${debt.personName}` : `${debt.personName} repayment due`,
        detail: debt.description ?? 'Debt due',
        date: debt.dueDate,
        amount: debt.direction === 'borrowed' ? -debt.remaining : debt.remaining,
        href: `/person/${debt.personId}`,
        severity: debt.dueDate && debt.dueDate < today ? 'negative' : 'warning',
      });
    }
  }

  if (enabled.shared) {
    // Opt-in and deliberately quiet: one nudge per person only when money has
    // been owed for more than two weeks. No due dates are invented.
    const [balances, sharedExpenses] = await Promise.all([getSharedBalances(), listSharedExpenses()]);
    const staleISO = toISODate(addDays(new Date(), -14));
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
      reminders.push({
        id: `shared-${balance.personId}`,
        kind: 'debt',
        title: `${balance.name} owes you`,
        detail: `Outstanding since ${formatDayMonth(new Date(oldest))} — settle up when you're ready`,
        date: null,
        amount: balance.net,
        href: `/person/${balance.personId}`,
        severity: 'info',
      });
    }
  }

  if (enabled.budget) {
    const budgets = await getBudgetProgressList();
    for (const budget of budgets) {
      if (budget.percent < 85) continue;
      reminders.push({
        id: `bdg-${budget.budget.id}`,
        kind: 'budget',
        title: `${budget.categoryName} budget`,
        detail: budget.percent > 100 ? 'Over budget' : `${Math.round(budget.percent)}% used`,
        date: null,
        amount: budget.remaining,
        href: `/budget/${budget.budget.id}`,
        severity: budget.percent > 100 ? 'negative' : 'warning',
      });
    }
  }

  if (enabled.goal) {
    const goals = await getGoalsProgress();
    for (const goal of goals) {
      if (goal.isComplete || goal.daysLeft === null || goal.daysLeft > 21) continue;
      reminders.push({
        id: `gol-${goal.goal.id}`,
        kind: 'goal',
        title: goal.goal.name,
        detail: `${goal.daysLeft} days to target · ${Math.round(goal.percent)}% funded`,
        date: goal.goal.targetDate,
        amount: goal.remaining,
        href: `/goal/${goal.goal.id}`,
        severity: 'warning',
      });
    }
  }

  if (enabled.card) {
    const accounts = await listAccounts();
    for (const account of accounts) {
      if (!isCreditLike(account.type) || account.currentBalance >= 0 || !account.paymentDueDay) continue;
      const dueDate = new Date(new Date().getFullYear(), new Date().getMonth(), Math.min(account.paymentDueDay, 28));
      const dueISO = toISODate(dueDate);
      if (dueISO < today || dueISO > monthEndISO) continue;
      reminders.push({
        id: `card-${account.id}`,
        kind: 'card',
        title: `${account.name} payment due`,
        detail: account.type === 'credit_card' ? `Outstanding ${Math.round(-account.currentBalance)}` : 'Instalment due',
        date: dueISO,
        amount: account.currentBalance,
        href: `/account/${account.id}`,
        severity: 'warning',
      });
    }
  }

  return reminders.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}
