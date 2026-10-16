import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { categories, transactions, type Category } from '@/db/schema';
import { notifyDbChanged } from '@/stores/db.store';
import { buildCategoryTree as buildTree, rootCategoryId as resolveRootCategory } from '@/utils/categories';
import { createId } from '@/utils/id';

export interface CategoryInput {
  name: string;
  icon?: string;
  color?: string;
  parentId?: string | null;
  type?: 'expense' | 'income';
}

/** Default category tree created for every new user. Icons are Ionicons names. */
export interface DefaultCategorySeed {
  key: string;
  name: string;
  icon: string;
  color: string;
  type: 'expense' | 'income';
  children?: Omit<DefaultCategorySeed, 'children' | 'type'>[];
}

export const DEFAULT_CATEGORY_TREE: DefaultCategorySeed[] = [
  {
    key: 'food',
    name: 'Food & Dining',
    icon: 'restaurant-outline',
    color: '#FF9F0A',
    type: 'expense',
    children: [
      { key: 'restaurants', name: 'Restaurants', icon: 'restaurant-outline', color: '#FF9F0A' },
      { key: 'delivery', name: 'Delivery', icon: 'bicycle-outline', color: '#FFB340' },
      { key: 'cafes', name: 'Cafes', icon: 'cafe-outline', color: '#FFA94D' },
      { key: 'groceries', name: 'Groceries', icon: 'cart-outline', color: '#FFC078' },
    ],
  },
  {
    key: 'transport',
    name: 'Transport',
    icon: 'car-outline',
    color: '#5E9BFF',
    type: 'expense',
    children: [
      { key: 'fuel', name: 'Fuel', icon: 'flame-outline', color: '#5E9BFF' },
      { key: 'taxi', name: 'Taxi', icon: 'car-sport-outline', color: '#74A8FF' },
    ],
  },
  {
    key: 'shopping',
    name: 'Shopping',
    icon: 'bag-handle-outline',
    color: '#FF8FA8',
    type: 'expense',
    children: [
      { key: 'electronics', name: 'Electronics', icon: 'phone-portrait-outline', color: '#FF8FA8' },
      { key: 'clothing', name: 'Clothing', icon: 'shirt-outline', color: '#FFA6BC' },
      { key: 'shopping_general', name: 'General', icon: 'bag-outline', color: '#FFBCCD' },
    ],
  },
  {
    key: 'bills',
    name: 'Bills & Utilities',
    icon: 'receipt-outline',
    color: '#F5B84B',
    type: 'expense',
    children: [
      { key: 'electricity', name: 'Electricity', icon: 'flash-outline', color: '#F5B84B' },
      { key: 'internet', name: 'Internet', icon: 'wifi-outline', color: '#F7C46C' },
      { key: 'mobile', name: 'Mobile', icon: 'cellular-outline', color: '#F9D08D' },
    ],
  },
  { key: 'subscriptions', name: 'Subscriptions', icon: 'repeat-outline', color: '#B79CFF', type: 'expense' },
  { key: 'rent', name: 'Rent', icon: 'home-outline', color: '#B79CFF', type: 'expense' },
  {
    key: 'entertainment',
    name: 'Entertainment',
    icon: 'film-outline',
    color: '#6EE7A8',
    type: 'expense',
    children: [
      { key: 'movies', name: 'Movies', icon: 'film-outline', color: '#6EE7A8' },
      { key: 'gaming', name: 'Gaming', icon: 'game-controller-outline', color: '#8DEDBB' },
    ],
  },
  {
    key: 'health',
    name: 'Health',
    icon: 'medkit-outline',
    color: '#42D392',
    type: 'expense',
    children: [{ key: 'medical', name: 'Medical', icon: 'medkit-outline', color: '#42D392' }],
  },
  { key: 'fitness', name: 'Fitness', icon: 'barbell-outline', color: '#42D392', type: 'expense' },
  { key: 'travel', name: 'Travel', icon: 'airplane-outline', color: '#6FB4FF', type: 'expense' },
  { key: 'education', name: 'Education', icon: 'school-outline', color: '#5EDBA6', type: 'expense' },
  {
    key: 'personal',
    name: 'Personal',
    icon: 'person-outline',
    color: '#C4A9FF',
    type: 'expense',
    children: [{ key: 'family', name: 'Family', icon: 'people-outline', color: '#C4A9FF' }],
  },
  { key: 'other', name: 'Other', icon: 'ellipsis-horizontal-outline', color: '#929AA8', type: 'expense' },
  { key: 'salary', name: 'Salary', icon: 'cash-outline', color: '#42D392', type: 'income' },
  { key: 'freelance', name: 'Freelance', icon: 'laptop-outline', color: '#5EDBA6', type: 'income' },
  { key: 'investment_income', name: 'Investment Income', icon: 'trending-up-outline', color: '#42D392', type: 'income' },
  { key: 'cashback', name: 'Cashback', icon: 'gift-outline', color: '#6EE7A8', type: 'income' },
  { key: 'other_income', name: 'Other Income', icon: 'add-circle-outline', color: '#8DEDBB', type: 'income' },
];

export async function seedDefaultCategories(): Promise<void> {
  const db = getDb();
  const existing = await db.select({ count: sql<number>`count(*)` }).from(categories);
  if (Number(existing[0]?.count ?? 0) > 0) return;

  const now = Date.now();
  let order = 0;
  for (const parent of DEFAULT_CATEGORY_TREE) {
    const parentId = createId('cat');
    await db.insert(categories).values({
      id: parentId,
      name: parent.name,
      icon: parent.icon,
      color: parent.color,
      parentId: null,
      type: parent.type,
      isSystem: true,
      isArchived: false,
      sortOrder: order++,
      createdAt: now,
      updatedAt: now,
    });
    for (const child of parent.children ?? []) {
      await db.insert(categories).values({
        id: createId('cat'),
        name: child.name,
        icon: child.icon,
        color: child.color,
        parentId,
        type: parent.type,
        isSystem: true,
        isArchived: false,
        sortOrder: order++,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  notifyDbChanged();
}

export async function listCategories(options: { includeArchived?: boolean } = {}): Promise<Category[]> {
  const db = getDb();
  return db
    .select()
    .from(categories)
    .where(options.includeArchived ? undefined : eq(categories.isArchived, false))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

export async function getCategory(id: string): Promise<Category | null> {
  const db = getDb();
  const rows = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createCategory(input: CategoryInput): Promise<Category> {
  const db = getDb();
  const name = input.name.trim();
  if (!name) throw new Error('Category name is required.');
  const parentId = input.parentId ?? null;

  const duplicate = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.name, name),
        parentId ? eq(categories.parentId, parentId) : isNull(categories.parentId),
      ),
    )
    .limit(1);
  if (duplicate.length > 0) throw new Error(`"${name}" already exists here.`);

  let color = input.color;
  if (!color && parentId) {
    const parent = await getCategory(parentId);
    color = parent?.color;
  }

  const [maxOrder] = await db.select({ value: sql<number>`coalesce(max(${categories.sortOrder}), 0)` }).from(categories);
  const now = Date.now();
  const row: Category = {
    id: createId('cat'),
    name,
    icon: input.icon ?? 'pricetag-outline',
    color: color ?? '#8B8CFF',
    parentId,
    type: input.type ?? 'expense',
    isSystem: false,
    isArchived: false,
    sortOrder: Number(maxOrder?.value ?? 0) + 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(categories).values(row);
  notifyDbChanged();
  return row;
}

export async function updateCategory(
  id: string,
  patch: Partial<CategoryInput> & { isArchived?: boolean },
): Promise<void> {
  const db = getDb();
  const current = await getCategory(id);
  if (!current) throw new Error('Category not found.');
  await db
    .update(categories)
    .set({
      name: patch.name?.trim() ?? current.name,
      icon: patch.icon ?? current.icon,
      color: patch.color ?? current.color,
      parentId: patch.parentId === undefined ? current.parentId : patch.parentId,
      isArchived: patch.isArchived ?? current.isArchived,
      updatedAt: Date.now(),
    })
    .where(eq(categories.id, id));
  notifyDbChanged();
}

export async function deleteCategory(id: string): Promise<{ reassigned: number }> {
  const db = getDb();
  const category = await getCategory(id);
  if (!category) throw new Error('Category not found.');

  const children = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id));
  const ids = [id, ...children.map((c) => c.id)];

  // Reassign transactions to the parent (or Other) instead of orphaning them.
  let fallbackId = category.parentId;
  if (!fallbackId) {
    const other = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, category.type === 'income' ? 'Other Income' : 'Other'))
      .limit(1);
    fallbackId = other[0]?.id ?? null;
  }

  const result = await db
    .update(transactions)
    .set({ categoryId: fallbackId, updatedAt: Date.now() })
    .where(eq(transactions.categoryId, id));

  if (fallbackId) {
    await db
      .update(categories)
      .set({ parentId: fallbackId, updatedAt: Date.now() })
      .where(eq(categories.parentId, id));
    await db.update(categories).set({ isArchived: true, updatedAt: Date.now() }).where(eq(categories.id, id));
  } else {
    for (const childId of children.map((c) => c.id)) {
      await db.update(categories).set({ isArchived: true, updatedAt: Date.now() }).where(eq(categories.id, childId));
    }
    await db.update(categories).set({ isArchived: true, updatedAt: Date.now() }).where(eq(categories.id, id));
  }

  notifyDbChanged();
  return { reassigned: result.changes ?? 0 };
}

export interface CategoryTreeWithChildren extends Category {
  children: Category[];
}

/** Tree + rollup helpers live in utils/categories (pure and unit-tested). */
export function buildCategoryTree(list: Category[]): CategoryTreeWithChildren[] {
  return buildTree(list);
}

export function rootCategoryId(category: Category, byId: Map<string, Category>): string {
  return resolveRootCategory(category, byId);
}
