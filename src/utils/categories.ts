import type { Category } from '@/db/schema';

/**
 * Pure category helpers (no database), so screens and tests share one
 * implementation of the parent/child rules.
 */

export interface CategoryTree extends Category {
  children: Category[];
}

export function buildCategoryTree(list: Category[]): CategoryTree[] {
  const parents = list.filter((category) => !category.parentId);
  const byParent = new Map<string, Category[]>();
  for (const category of list) {
    if (!category.parentId) continue;
    const bucket = byParent.get(category.parentId) ?? [];
    bucket.push(category);
    byParent.set(category.parentId, bucket);
  }
  return parents.map((parent) => ({ ...parent, children: byParent.get(parent.id) ?? [] }));
}

/** Resolves a category (parent or child) to the id analytics should roll up to. */
export function rootCategoryId(category: Category, byId: Map<string, Category>): string {
  let current = category;
  let guard = 0;
  while (current.parentId && guard++ < 10) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}
