import { asc, eq, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { transactionTemplates, type TransactionTemplate } from '@/db/schema';
import { notifyDbChanged } from '@/stores/db.store';
import { createId } from '@/utils/id';

/**
 * Quick-add templates ("Lunch ₹250 · Food · Cash"). Using a template only
 * *prefills* the transaction form — it never saves without confirmation.
 */

export interface TemplateInput {
  name: string;
  amount: number;
  type: 'expense' | 'income' | 'transfer';
  categoryId?: string | null;
  accountId?: string | null;
  transferAccountId?: string | null;
  merchant?: string | null;
  description?: string | null;
  icon?: string;
}

export async function listTemplates(): Promise<TransactionTemplate[]> {
  const db = getDb();
  return db.select().from(transactionTemplates).orderBy(asc(transactionTemplates.sortOrder), asc(transactionTemplates.createdAt));
}

export async function createTemplate(input: TemplateInput): Promise<TransactionTemplate> {
  const db = getDb();
  if (!input.name.trim()) throw new Error('Give the template a name.');
  if (!Number.isFinite(input.amount) || Math.round(Math.abs(input.amount)) === 0) {
    throw new Error('Enter an amount.');
  }
  const [max] = await db
    .select({ value: sql<number>`coalesce(max(${transactionTemplates.sortOrder}), 0)` })
    .from(transactionTemplates);
  const now = Date.now();
  const row: TransactionTemplate = {
    id: createId('tpl'),
    name: input.name.trim(),
    amount: Math.round(Math.abs(input.amount)),
    type: input.type,
    categoryId: input.categoryId ?? null,
    accountId: input.accountId ?? null,
    transferAccountId: input.transferAccountId ?? null,
    merchant: input.merchant?.trim() || null,
    description: input.description?.trim() || null,
    icon: input.icon ?? 'flash-outline',
    sortOrder: Number(max?.value ?? 0) + 1,
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(transactionTemplates).values(row);
  notifyDbChanged();
  return row;
}

export async function updateTemplate(id: string, patch: Partial<TemplateInput> & { sortOrder?: number }): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(transactionTemplates).where(eq(transactionTemplates.id, id)).limit(1);
  const current = rows[0];
  if (!current) throw new Error('Template not found.');
  await db
    .update(transactionTemplates)
    .set({
      name: patch.name?.trim() ?? current.name,
      amount: patch.amount === undefined ? current.amount : Math.round(Math.abs(patch.amount)),
      type: patch.type ?? current.type,
      categoryId: patch.categoryId === undefined ? current.categoryId : patch.categoryId,
      accountId: patch.accountId === undefined ? current.accountId : patch.accountId,
      transferAccountId: patch.transferAccountId === undefined ? current.transferAccountId : patch.transferAccountId,
      merchant: patch.description === undefined ? current.merchant : (patch.merchant ?? null),
      description: patch.description === undefined ? current.description : patch.description,
      icon: patch.icon ?? current.icon,
      sortOrder: patch.sortOrder ?? current.sortOrder,
      updatedAt: Date.now(),
    })
    .where(eq(transactionTemplates.id, id));
  notifyDbChanged();
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = getDb();
  await db.delete(transactionTemplates).where(eq(transactionTemplates.id, id));
  notifyDbChanged();
}

export async function markTemplateUsed(id: string): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(transactionTemplates).where(eq(transactionTemplates.id, id)).limit(1);
  const current = rows[0];
  if (!current) return;
  await db
    .update(transactionTemplates)
    .set({ usageCount: current.usageCount + 1, updatedAt: Date.now() })
    .where(eq(transactionTemplates.id, id));
  notifyDbChanged();
}

export async function reorderTemplates(orderedIds: string[]): Promise<void> {
  const db = getDb();
  let order = 0;
  for (const id of orderedIds) {
    await db.update(transactionTemplates).set({ sortOrder: order++ }).where(eq(transactionTemplates.id, id));
  }
  notifyDbChanged();
}
