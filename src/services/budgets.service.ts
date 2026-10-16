import { asc, eq } from 'drizzle-orm';

import { getDb, getSqlite } from '@/db/client';
import { budgets, categories, type Budget } from '@/db/schema';
import { notifyDbChanged } from '@/stores/db.store';
import { differenceInCalendarDays, fromISODate, toISODate } from '@/utils/date';
import { createId } from '@/utils/id';
import { calculatePercentage } from '@/utils/money';

export interface BudgetInput {
  categoryId: string | null;
  name?: string | null;
  amount: number; // minor units
  period: 'weekly' | 'monthly' | 'yearly' | 'custom';
  startDate: string;
  endDate?: string | null;
  rolloverEnabled?: boolean;
}

export interface BudgetProgress {
  budget: Budget;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  spent: number;
  remaining: number;
  percent: number;
  projected: number;
  safeToSpendPerDay: number;
  daysRemaining: number;
  daysElapsed: number;
  daysTotal: number;
  periodStart: string;
  periodEnd: string;
  status: 'on_track' | 'warning' | 'over' | 'complete';
}

export function budgetStatus(percent: number): BudgetProgress['status'] {
  if (percent >= 100) return 'over';
  if (percent >= 85) return 'warning';
  if (percent >= 100) return 'complete';
  return 'on_track';
}

export async function listBudgets(includeArchived = false): Promise<Budget[]> {
  const db = getDb();
  return db
    .select()
    .from(budgets)
    .where(includeArchived ? undefined : eq(budgets.isArchived, false))
    .orderBy(asc(budgets.createdAt));
}

export async function getBudget(id: string): Promise<Budget | null> {
  const db = getDb();
  const rows = await db.select().from(budgets).where(eq(budgets.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createBudget(input: BudgetInput): Promise<Budget> {
  const db = getDb();
  if (!Number.isFinite(input.amount) || Math.round(input.amount) <= 0) {
    throw new Error('Enter a budget amount greater than zero.');
  }
  const now = Date.now();
  const row: Budget = {
    id: createId('bdg'),
    categoryId: input.categoryId,
    name: input.name ?? null,
    amount: Math.round(input.amount),
    period: input.period,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    rolloverEnabled: input.rolloverEnabled ?? false,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(budgets).values(row);
  notifyDbChanged();
  return row;
}

export async function updateBudget(id: string, patch: Partial<BudgetInput> & { isArchived?: boolean }): Promise<void> {
  const db = getDb();
  const current = await getBudget(id);
  if (!current) throw new Error('Budget not found.');
  await db
    .update(budgets)
    .set({
      categoryId: patch.categoryId === undefined ? current.categoryId : patch.categoryId,
      name: patch.name === undefined ? current.name : patch.name,
      amount: patch.amount === undefined ? current.amount : Math.round(patch.amount),
      period: patch.period ?? current.period,
      startDate: patch.startDate ?? current.startDate,
      endDate: patch.endDate === undefined ? current.endDate : patch.endDate,
      rolloverEnabled: patch.rolloverEnabled ?? current.rolloverEnabled,
      isArchived: patch.isArchived ?? current.isArchived,
      updatedAt: Date.now(),
    })
    .where(eq(budgets.id, id));
  notifyDbChanged();
}

export async function deleteBudget(id: string): Promise<void> {
  const db = getDb();
  await db.delete(budgets).where(eq(budgets.id, id));
  notifyDbChanged();
}

/** The active window for a budget, anchored on `anchor` (default: today). */
export function budgetWindow(budget: Budget, anchor = new Date()): { start: Date; end: Date } {
  const start = fromISODate(budget.startDate) ?? new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  if (budget.period === 'custom') {
    const end = (budget.endDate ? fromISODate(budget.endDate) : null) ?? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return { start, end };
  }
  if (budget.period === 'weekly') {
    const weeksSince = Math.max(0, Math.floor(differenceInCalendarDays(anchor, start) / 7));
    const windowStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() + weeksSince * 7);
    const end = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() + 6);
    return { start: windowStart, end };
  }
  if (budget.period === 'yearly') {
    const yearsSince = Math.max(0, anchor.getFullYear() - start.getFullYear());
    const windowStart = new Date(start.getFullYear() + yearsSince, start.getMonth(), start.getDate());
    const end = new Date(windowStart.getFullYear() + 1, windowStart.getMonth(), windowStart.getDate() - 1);
    return { start: windowStart, end };
  }
  // monthly — anchored on the budget's start day-of-month
  const day = start.getDate();
  const anchorDay = Math.min(day, new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate());
  let windowStart: Date;
  if (anchor.getDate() >= anchorDay) {
    windowStart = new Date(anchor.getFullYear(), anchor.getMonth(), day);
  } else {
    windowStart = new Date(anchor.getFullYear(), anchor.getMonth() - 1, day);
  }
  const end = new Date(windowStart.getFullYear(), windowStart.getMonth() + 1, day - 1);
  return { start: windowStart, end };
}

export async function getBudgetProgress(budget: Budget, anchor = new Date()): Promise<BudgetProgress> {
  const sqlite = getSqlite();
  const { start, end } = budgetWindow(budget, anchor);
  const startISO = toISODate(start);
  const endISO = toISODate(end);

  const params: (string | number)[] = [startISO, endISO];
  let categoryClause = '';
  if (budget.categoryId) {
    categoryClause = `AND (el.category_id = ? OR el.category_id IN (SELECT id FROM categories WHERE parent_id = ?))`;
    params.push(budget.categoryId, budget.categoryId);
  }

  // Net of refunds within the same category scope.
  const row = await sqlite.getFirstAsync<{ spent: number; refunds: number }>(
    `SELECT
       coalesce(sum(CASE WHEN el.type = 'expense' THEN abs(el.amount) ELSE 0 END), 0) AS spent,
       coalesce(sum(CASE WHEN el.type = 'refund' THEN el.amount ELSE 0 END), 0) AS refunds
     FROM effective_ledger el
     WHERE el.date >= ? AND el.date <= ? ${categoryClause}`,
    params,
  );

  const spent = Math.max(0, Number(row?.spent ?? 0) - Number(row?.refunds ?? 0));
  const daysTotal = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const elapsedRaw = differenceInCalendarDays(anchor, start) + 1;
  const daysElapsed = Math.min(daysTotal, Math.max(0, elapsedRaw));
  const daysRemaining = Math.max(1, daysTotal - daysElapsed + (elapsedRaw > daysTotal ? 0 : 1));
  const remaining = budget.amount - spent;
  const percent = calculatePercentage(spent, budget.amount);
  const projected = daysElapsed > 0 ? (spent / daysElapsed) * daysTotal : spent;

  let categoryName: string | null = null;
  let categoryIcon: string | null = null;
  let categoryColor: string | null = null;
  if (budget.categoryId) {
    const db = getDb();
    const rows = await db
      .select({ name: categories.name, icon: categories.icon, color: categories.color })
      .from(categories)
      .where(eq(categories.id, budget.categoryId))
      .limit(1);
    categoryName = rows[0]?.name ?? null;
    categoryIcon = rows[0]?.icon ?? null;
    categoryColor = rows[0]?.color ?? null;
  }

  return {
    budget,
    categoryName: budget.name ?? categoryName ?? 'Overall budget',
    categoryIcon,
    categoryColor,
    spent,
    remaining,
    percent,
    projected,
    safeToSpendPerDay: remaining > 0 ? Math.round(remaining / Math.max(1, daysRemaining)) : 0,
    daysRemaining: Math.max(0, daysTotal - daysElapsed),
    daysElapsed,
    daysTotal,
    periodStart: startISO,
    periodEnd: endISO,
    status: statusFor(percent, spent, budget.amount),
  };
}

function statusFor(percent: number, spent: number, amount: number): BudgetProgress['status'] {
  if (spent === 0 && amount > 0) return 'on_track';
  if (percent > 100) return 'over';
  if (percent >= 85) return 'warning';
  return 'on_track';
}

export async function getBudgetProgressList(anchor = new Date()): Promise<BudgetProgress[]> {
  const list = await listBudgets();
  const result: BudgetProgress[] = [];
  for (const budget of list) {
    result.push(await getBudgetProgress(budget, anchor));
  }
  return result.sort((a, b) => b.percent - a.percent);
}

export async function duplicateBudget(id: string): Promise<void> {
  const budget = await getBudget(id);
  if (!budget) return;
  await createBudget({
    categoryId: budget.categoryId,
    name: budget.name,
    amount: budget.amount,
    period: budget.period,
    startDate: budget.startDate,
    endDate: budget.endDate,
    rolloverEnabled: budget.rolloverEnabled,
  });
}
