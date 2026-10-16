import { asc, eq, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { accounts, goalContributions, goals, transactions, type Goal, type GoalContribution } from '@/db/schema';
import { notifyDbChanged } from '@/stores/db.store';
import { daysInRange, fromISODate, getPeriodRange, toISODate, differenceInCalendarDays } from '@/utils/date';
import { createId } from '@/utils/id';
import { calculatePercentage } from '@/utils/money';

/**
 * Savings goals — deliberately separate from budgets.
 *
 * A budget controls spending; a goal tracks money being accumulated. Allocating
 * money to a goal is NOT an expense. When a goal is linked to an account, a
 * contribution records a real transfer into that account (money actually
 * moves); otherwise it is a virtual envelope whose balance is tracked here.
 */

export interface GoalInput {
  name: string;
  targetAmount: number;
  initialAmount?: number;
  targetDate?: string | null;
  linkedAccountId?: string | null;
  categoryId?: string | null;
  icon?: string;
  color?: string;
}

export interface GoalProgress {
  goal: Goal;
  saved: number;
  remaining: number;
  percent: number;
  /** Required monthly contribution to hit the target date. */
  requiredMonthly: number | null;
  daysLeft: number | null;
  contributionsCount: number;
  lastContributionDate: string | null;
  isOverfunded: boolean;
  isComplete: boolean;
}

export async function listGoals(includeArchived = false): Promise<Goal[]> {
  const db = getDb();
  return db
    .select()
    .from(goals)
    .where(includeArchived ? undefined : eq(goals.isArchived, false))
    .orderBy(asc(goals.createdAt));
}

export async function getGoal(id: string): Promise<Goal | null> {
  const db = getDb();
  const rows = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createGoal(input: GoalInput): Promise<Goal> {
  const db = getDb();
  const name = input.name.trim();
  if (!name) throw new Error('Give the goal a name.');
  if (!Number.isFinite(input.targetAmount) || Math.round(input.targetAmount) <= 0) {
    throw new Error('Enter a target amount greater than zero.');
  }
  const now = Date.now();
  const row: Goal = {
    id: createId('gol'),
    name,
    targetAmount: Math.round(input.targetAmount),
    initialAmount: Math.round(input.initialAmount ?? 0),
    targetDate: input.targetDate ?? null,
    linkedAccountId: input.linkedAccountId ?? null,
    categoryId: input.categoryId ?? null,
    icon: input.icon ?? 'flag-outline',
    color: input.color ?? '#8B8CFF',
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(goals).values(row);
  notifyDbChanged();
  return row;
}

export async function updateGoal(id: string, patch: Partial<GoalInput> & { isArchived?: boolean }): Promise<void> {
  const db = getDb();
  const current = await getGoal(id);
  if (!current) throw new Error('Goal not found.');
  await db
    .update(goals)
    .set({
      name: patch.name?.trim() ?? current.name,
      targetAmount: patch.targetAmount === undefined ? current.targetAmount : Math.round(patch.targetAmount),
      initialAmount: patch.initialAmount === undefined ? current.initialAmount : Math.round(patch.initialAmount),
      targetDate: patch.targetDate === undefined ? current.targetDate : patch.targetDate,
      linkedAccountId: patch.linkedAccountId === undefined ? current.linkedAccountId : patch.linkedAccountId,
      categoryId: patch.categoryId === undefined ? current.categoryId : patch.categoryId,
      icon: patch.icon ?? current.icon,
      color: patch.color ?? current.color,
      isArchived: patch.isArchived ?? current.isArchived,
      updatedAt: Date.now(),
    })
    .where(eq(goals.id, id));
  notifyDbChanged();
}

export async function deleteGoal(id: string): Promise<void> {
  const db = getDb();
  await db.delete(goalContributions).where(eq(goalContributions.goalId, id));
  await db.delete(goals).where(eq(goals.id, id));
  notifyDbChanged();
}

export interface ContributionInput {
  goalId: string;
  amount: number;
  date?: string;
  /** Where the money comes from. When the goal has a linked account, this
   * creates a real transfer; otherwise no ledger movement happens. */
  accountId?: string | null;
  note?: string | null;
}

/**
 * Records a contribution. If the goal is linked to an account and a source
 * account is provided, a real transfer is created so the ledger stays honest.
 */
export async function addContribution(input: ContributionInput): Promise<GoalContribution> {
  const db = getDb();
  const goal = await getGoal(input.goalId);
  if (!goal) throw new Error('Goal not found.');
  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount === 0) throw new Error('Enter a contribution amount.');
  if (amount < 0) throw new Error('Contribution must be positive. Use a withdrawal to remove funds.');

  const date = input.date ?? toISODate(new Date());
  const now = Date.now();
  let transactionId: string | null = null;

  if (goal.linkedAccountId && input.accountId && input.accountId !== goal.linkedAccountId) {
    const { createTransaction } = await import('@/services/transactions.service');
    const created = await createTransaction({
      accountId: input.accountId,
      amount: -Math.abs(amount),
      type: 'transfer',
      transferAccountId: goal.linkedAccountId,
      date,
      merchant: `Goal: ${goal.name}`,
      description: input.note ?? 'Goal contribution',
      isReviewed: true,
    });
    transactionId = created.id;
  }

  const row: GoalContribution = {
    id: createId('gct'),
    goalId: input.goalId,
    amount,
    date,
    accountId: input.accountId ?? null,
    transactionId,
    note: input.note ?? null,
    createdAt: now,
  };
  await db.insert(goalContributions).values(row);
  notifyDbChanged();
  return row;
}

/** Withdrawals reduce the tracked amount (negative contribution). */
export async function withdrawFromGoal(goalId: string, amount: number, note?: string): Promise<void> {
  const db = getDb();
  const row: GoalContribution = {
    id: createId('gct'),
    goalId,
    amount: -Math.abs(Math.round(amount)),
    date: toISODate(new Date()),
    accountId: null,
    transactionId: null,
    note: note ?? 'Withdrawal',
    createdAt: Date.now(),
  };
  await db.insert(goalContributions).values(row);
  notifyDbChanged();
}

export async function listContributions(goalId: string): Promise<GoalContribution[]> {
  const db = getDb();
  return db
    .select()
    .from(goalContributions)
    .where(eq(goalContributions.goalId, goalId))
    .orderBy(asc(goalContributions.date), asc(goalContributions.createdAt));
}

export async function getGoalProgress(goalId: string): Promise<GoalProgress | null> {
  const db = getDb();
  const goal = await getGoal(goalId);
  if (!goal) return null;

  const [agg] = await db
    .select({
      total: sql<number>`coalesce(sum(${goalContributions.amount}), 0)`,
      count: sql<number>`count(*)`,
      last: sql<string | null>`max(${goalContributions.date})`,
    })
    .from(goalContributions)
    .where(eq(goalContributions.goalId, goalId));

  const saved = Math.round(goal.initialAmount + Number(agg?.total ?? 0));
  const remaining = Math.max(0, goal.targetAmount - saved);
  const percent = calculatePercentage(saved, goal.targetAmount);

  let requiredMonthly: number | null = null;
  let daysLeft: number | null = null;
  if (goal.targetDate) {
    const target = fromISODate(goal.targetDate);
    if (target) {
      daysLeft = Math.max(0, differenceInCalendarDays(target, new Date()));
      const monthsLeft = Math.max(1, daysLeft / 30);
      requiredMonthly = remaining > 0 ? Math.round(remaining / monthsLeft) : 0;
    }
  }

  return {
    goal,
    saved,
    remaining,
    percent,
    requiredMonthly,
    daysLeft,
    contributionsCount: Number(agg?.count ?? 0),
    lastContributionDate: agg?.last ?? null,
    isOverfunded: saved > goal.targetAmount,
    isComplete: remaining === 0 && goal.targetAmount > 0,
  };
}

export async function getGoalsProgress(): Promise<GoalProgress[]> {
  const list = await listGoals();
  const result: GoalProgress[] = [];
  for (const goal of list) {
    const progress = await getGoalProgress(goal.id);
    if (progress) result.push(progress);
  }
  return result.sort((a, b) => b.percent - a.percent);
}

/** Contributions inside a period — used by cash-flow reporting. */
export async function contributionsInRange(from: string, to: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${goalContributions.amount}), 0)` })
    .from(goalContributions)
    .where(sql`${goalContributions.date} >= ${from} AND ${goalContributions.date} <= ${to}`);
  return Number(row?.total ?? 0);
}

/** Goal progress that should appear as a reminder (deadline passed or near). */
export async function goalsNeedingAttention(): Promise<GoalProgress[]> {
  const list = await getGoalsProgress();
  return list.filter((progress) => !progress.isComplete && progress.daysLeft !== null && progress.daysLeft <= 45);
}

export async function goalLinkedAccountName(goal: Goal): Promise<string | null> {
  if (!goal.linkedAccountId) return null;
  const db = getDb();
  const rows = await db
    .select({ name: accounts.name })
    .from(accounts)
    .where(eq(accounts.id, goal.linkedAccountId))
    .limit(1);
  return rows[0]?.name ?? null;
}
