import { asc, eq, lte, and } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { installments, type Installment } from '@/db/schema';
import { notifyDbChanged } from '@/stores/db.store';
import { addMonths, fromISODate, toISODate } from '@/utils/date';
import { createId } from '@/utils/id';

/**
 * Installment plans: one purchase converted into N linked monthly charges.
 *
 * The first installment is posted immediately; the rest post automatically on
 * their due dates (same launch-time posting as recurring transactions). Every
 * generated row carries `installmentId`, so the plan and its charges stay
 * linked — never six unrelated transactions.
 */

export interface InstallmentInput {
  name: string;
  merchant?: string | null;
  purchaseAmount: number;
  totalCount: number;
  startDate?: string;
  accountId: string;
  categoryId?: string | null;
  /** Post the first installment right away (default true). */
  postFirst?: boolean;
}

export async function listInstallments(includeInactive = false): Promise<Installment[]> {
  const db = getDb();
  return db
    .select()
    .from(installments)
    .where(includeInactive ? undefined : eq(installments.isActive, true))
    .orderBy(asc(installments.startDate));
}

export async function createInstallment(input: InstallmentInput): Promise<Installment> {
  const db = getDb();
  if (!input.name.trim()) throw new Error('Give the plan a name.');
  const totalCount = Math.round(input.totalCount);
  if (!Number.isFinite(totalCount) || totalCount < 2 || totalCount > 60) {
    throw new Error('Choose between 2 and 60 installments.');
  }
  const purchaseAmount = Math.round(Math.abs(input.purchaseAmount));
  if (!Number.isFinite(purchaseAmount) || purchaseAmount <= 0) throw new Error('Enter the purchase amount.');

  const startDate = input.startDate ?? toISODate(new Date());
  const now = Date.now();
  const row: Installment = {
    id: createId('ins'),
    name: input.name.trim(),
    merchant: input.merchant?.trim() || null,
    purchaseAmount,
    installmentAmount: Math.round(purchaseAmount / totalCount),
    totalCount,
    postedCount: 0,
    startDate,
    accountId: input.accountId,
    categoryId: input.categoryId ?? null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(installments).values(row);

  if (input.postFirst !== false) {
    await postInstallment(row, 0);
  }
  notifyDbChanged();
  return row;
}

async function postInstallment(plan: Installment, index: number): Promise<void> {
  const { createTransaction } = await import('@/services/transactions.service');
  const base = fromISODate(plan.startDate) ?? new Date();
  const date = toISODate(addMonths(base, index));
  await createTransaction({
    accountId: plan.accountId,
    categoryId: plan.categoryId,
    amount: -plan.installmentAmount,
    type: 'expense',
    merchant: plan.merchant ?? plan.name,
    description: `${plan.name} — installment ${index + 1}/${plan.totalCount}`,
    date,
    installmentId: plan.id,
    isReviewed: true,
    applyRules: false,
  });
}

/** Posts every installment whose date has arrived. Called during bootstrap. */
export async function postDueInstallments(today = new Date()): Promise<{ posted: number; postedAmount: number }> {
  const db = getDb();
  const todayISO = toISODate(today);
  const active = await db
    .select()
    .from(installments)
    .where(and(eq(installments.isActive, true), lte(installments.startDate, todayISO)))
    .orderBy(asc(installments.startDate));

  let posted = 0;
  let postedAmount = 0;
  for (const plan of active) {
    const base = fromISODate(plan.startDate) ?? today;
    let index = plan.postedCount;
    let guard = 0;
    while (index < plan.totalCount && guard++ < 60) {
      const date = toISODate(addMonths(base, index));
      if (date > todayISO) break;
      await postInstallment(plan, index);
      index++;
      posted++;
      postedAmount += plan.installmentAmount;
    }
    if (index !== plan.postedCount) {
      await db
        .update(installments)
        .set({
          postedCount: index,
          isActive: index < plan.totalCount,
          updatedAt: Date.now(),
        })
        .where(eq(installments.id, plan.id));
    }
  }
  if (posted > 0) notifyDbChanged();
  return { posted, postedAmount };
}

export interface InstallmentProgress {
  plan: Installment;
  paidAmount: number;
  remainingAmount: number;
  percent: number;
  nextDate: string | null;
  nextAmount: number;
}

export async function getInstallmentProgress(plan: Installment): Promise<InstallmentProgress> {
  const base = fromISODate(plan.startDate) ?? new Date();
  const paidAmount = plan.installmentAmount * plan.postedCount;
  const nextIndex = plan.postedCount;
  return {
    plan,
    paidAmount,
    remainingAmount: Math.max(0, plan.purchaseAmount - paidAmount),
    percent: plan.purchaseAmount > 0 ? (paidAmount / plan.purchaseAmount) * 100 : 0,
    nextDate: nextIndex < plan.totalCount ? toISODate(addMonths(base, nextIndex)) : null,
    nextAmount: plan.installmentAmount,
  };
}

export async function listInstallmentProgress(): Promise<InstallmentProgress[]> {
  const plans = await listInstallments();
  const result: InstallmentProgress[] = [];
  for (const plan of plans) result.push(await getInstallmentProgress(plan));
  return result;
}

export async function cancelInstallment(id: string): Promise<void> {
  const db = getDb();
  await db.update(installments).set({ isActive: false, updatedAt: Date.now() }).where(eq(installments.id, id));
  notifyDbChanged();
}

export async function deleteInstallment(id: string): Promise<void> {
  const db = getDb();
  await db.delete(installments).where(eq(installments.id, id));
  notifyDbChanged();
}

/** Monthly burden of all active plans — used by forecast and health screens. */
export async function monthlyInstallmentBurden(): Promise<number> {
  const plans = await listInstallments();
  return plans.reduce(
    (sum, plan) => (plan.postedCount < plan.totalCount ? sum + plan.installmentAmount : sum),
    0,
  );
}
