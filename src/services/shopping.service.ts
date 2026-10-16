import { asc, eq, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { shoppingListItems, shoppingLists, type ShoppingList, type ShoppingListItem } from '@/db/schema';
import { createTransaction } from '@/services/transactions.service';
import { notifyDbChanged } from '@/stores/db.store';
import { toISODate } from '@/utils/date';
import { createId } from '@/utils/id';

/**
 * Shopping lists — a plan with item names and prices. Nothing here touches the
 * ledger until the user taps "Create transaction", which writes ONE expense
 * whose splits itemise the list (grouping by item), then links the list to it.
 */

export interface ShoppingListItemInput {
  name: string;
  /** Minor units per unit. */
  price: number;
  quantity?: number;
  note?: string | null;
}

export interface ShoppingListDetail {
  list: ShoppingList;
  items: ShoppingListItem[];
}

export async function listShoppingLists(includeCompleted = false): Promise<ShoppingList[]> {
  const db = getDb();
  return db
    .select()
    .from(shoppingLists)
    .where(includeCompleted ? undefined : eq(shoppingLists.status, 'active'))
    .orderBy(asc(shoppingLists.status), asc(shoppingLists.createdAt));
}

export async function getShoppingList(id: string): Promise<ShoppingListDetail | null> {
  const db = getDb();
  const rows = await db.select().from(shoppingLists).where(eq(shoppingLists.id, id)).limit(1);
  const list = rows[0];
  if (!list) return null;
  const items = await db
    .select()
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, id))
    .orderBy(asc(shoppingListItems.sortOrder), asc(shoppingListItems.createdAt));
  return { list, items };
}

export async function createShoppingList(name: string): Promise<ShoppingList> {
  const db = getDb();
  const clean = name.trim();
  if (!clean) throw new Error('Give the list a name.');
  const now = Date.now();
  const row: ShoppingList = {
    id: createId('shp'),
    name: clean,
    status: 'active',
    transactionId: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(shoppingLists).values(row);
  notifyDbChanged();
  return row;
}

export async function renameShoppingList(id: string, name: string): Promise<void> {
  const db = getDb();
  const clean = name.trim();
  if (!clean) throw new Error('Give the list a name.');
  await db.update(shoppingLists).set({ name: clean, updatedAt: Date.now() }).where(eq(shoppingLists.id, id));
  notifyDbChanged();
}

export async function deleteShoppingList(id: string): Promise<void> {
  const db = getDb();
  await db.delete(shoppingListItems).where(eq(shoppingListItems.listId, id));
  await db.delete(shoppingLists).where(eq(shoppingLists.id, id));
  notifyDbChanged();
}

/** Reopens a completed list (its transaction stays in the ledger). */
export async function reopenShoppingList(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(shoppingLists)
    .set({ status: 'active', completedAt: null, transactionId: null, updatedAt: Date.now() })
    .where(eq(shoppingLists.id, id));
  notifyDbChanged();
}

/* ---------------------------------- Items ---------------------------------- */

export async function addShoppingListItem(listId: string, input: ShoppingListItemInput): Promise<ShoppingListItem> {
  const db = getDb();
  const name = input.name.trim();
  if (!name) throw new Error('Enter the item name.');
  const price = Math.max(0, Math.round(input.price));
  const quantity = Math.max(1, Math.round(input.quantity ?? 1));
  const [max] = await db
    .select({ value: sql<number>`coalesce(max(${shoppingListItems.sortOrder}), 0)` })
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, listId));
  const row: ShoppingListItem = {
    id: createId('shi'),
    listId,
    name,
    price,
    quantity,
    isChecked: false,
    note: input.note ?? null,
    sortOrder: Number(max?.value ?? 0) + 1,
    createdAt: Date.now(),
  };
  await db.insert(shoppingListItems).values(row);
  await db.update(shoppingLists).set({ updatedAt: Date.now() }).where(eq(shoppingLists.id, listId));
  notifyDbChanged();
  return row;
}

export async function updateShoppingListItem(
  id: string,
  patch: { name?: string; price?: number; quantity?: number; isChecked?: boolean; note?: string | null },
): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(shoppingListItems).where(eq(shoppingListItems.id, id)).limit(1);
  const current = rows[0];
  if (!current) return;
  await db
    .update(shoppingListItems)
    .set({
      name: patch.name?.trim() || current.name,
      price: patch.price === undefined ? current.price : Math.max(0, Math.round(patch.price)),
      quantity: patch.quantity === undefined ? current.quantity : Math.max(1, Math.round(patch.quantity)),
      isChecked: patch.isChecked ?? current.isChecked,
      note: patch.note === undefined ? current.note : patch.note,
    })
    .where(eq(shoppingListItems.id, id));
  await db.update(shoppingLists).set({ updatedAt: Date.now() }).where(eq(shoppingLists.id, current.listId));
  notifyDbChanged();
}

export async function removeShoppingListItem(id: string): Promise<void> {
  const db = getDb();
  await db.delete(shoppingListItems).where(eq(shoppingListItems.id, id));
  notifyDbChanged();
}

export function shoppingListTotal(items: { price: number; quantity: number }[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

/* ------------------------------ Convert to ledger --------------------------- */

export interface ConvertShoppingListInput {
  accountId: string;
  categoryId: string;
  date?: string;
  /** Optional merchant label for the single expense ("BigBasket"). */
  merchant?: string | null;
}

/**
 * Writes the whole list as ONE expense with one split per item — the parent
 * amount stays the exact sum, so analytics count it once, and the splits keep
 * the item detail for drill-down.
 */
export async function convertShoppingListToTransaction(
  listId: string,
  input: ConvertShoppingListInput,
): Promise<{ transactionId: string; total: number }> {
  const db = getDb();
  const detail = await getShoppingList(listId);
  if (!detail) throw new Error('Shopping list not found.');
  if (detail.list.status === 'completed' && detail.list.transactionId) {
    throw new Error('This list already has a transaction. Reopen it first if you want to record another.');
  }
  if (!input.accountId) throw new Error('Choose the account this purchase was paid from.');
  if (!input.categoryId) throw new Error('Choose a category for this purchase.');

  const items = detail.items;
  const total = shoppingListTotal(items);
  if (items.length === 0) throw new Error('Add at least one item before creating the transaction.');
  if (total <= 0) throw new Error('Every item needs a price before creating the transaction.');

  const date = input.date ?? toISODate(new Date());
  const transaction = await createTransaction({
    accountId: input.accountId,
    categoryId: input.categoryId,
    amount: total,
    type: 'expense',
    merchant: input.merchant?.trim() || detail.list.name,
    description: `${detail.list.name} · ${items.length} item${items.length === 1 ? '' : 's'}`,
    date,
    isReviewed: true,
    applyRules: false,
    splits: items.map((item) => ({
      categoryId: input.categoryId,
      amount: item.price * item.quantity,
      note: item.quantity > 1 ? `${item.name} × ${item.quantity}` : item.name,
    })),
  });

  await db
    .update(shoppingLists)
    .set({ status: 'completed', transactionId: transaction.id, completedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(shoppingLists.id, listId));
  notifyDbChanged();
  return { transactionId: transaction.id, total };
}
