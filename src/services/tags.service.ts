import { asc, eq, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { tags, transactionTags, type Tag } from '@/db/schema';
import { notifyDbChanged } from '@/stores/db.store';
import { createId } from '@/utils/id';

export async function listTags(): Promise<Tag[]> {
  const db = getDb();
  return db.select().from(tags).orderBy(asc(tags.name));
}

export async function createTag(name: string, color = '#8B8CFF'): Promise<Tag> {
  const db = getDb();
  const clean = name.trim();
  if (!clean) throw new Error('Tag name is required.');
  const existing = await db.select().from(tags).where(eq(tags.name, clean)).limit(1);
  if (existing[0]) return existing[0];

  const row: Tag = { id: createId('tag'), name: clean, color, createdAt: Date.now() };
  await db.insert(tags).values(row);
  notifyDbChanged();
  return row;
}

export async function deleteTag(id: string): Promise<void> {
  const db = getDb();
  await db.delete(transactionTags).where(eq(transactionTags.tagId, id));
  await db.delete(tags).where(eq(tags.id, id));
  notifyDbChanged();
}

export async function setTransactionTags(transactionId: string, tagIds: string[]): Promise<void> {
  const db = getDb();
  await db.delete(transactionTags).where(eq(transactionTags.transactionId, transactionId));
  if (tagIds.length > 0) {
    await db
      .insert(transactionTags)
      .values(tagIds.map((tagId) => ({ transactionId, tagId })))
      .onConflictDoNothing();
  }
  notifyDbChanged();
}

export async function addTagToTransactions(transactionIds: string[], tagId: string): Promise<void> {
  if (transactionIds.length === 0) return;
  const db = getDb();
  await db
    .insert(transactionTags)
    .values(transactionIds.map((transactionId) => ({ transactionId, tagId })))
    .onConflictDoNothing();
  notifyDbChanged();
}

export async function tagUsageCounts(): Promise<Record<string, number>> {
  const db = getDb();
  const rows = await db
    .select({ tagId: transactionTags.tagId, count: sql<number>`count(*)` })
    .from(transactionTags)
    .groupBy(transactionTags.tagId);
  const map: Record<string, number> = {};
  for (const row of rows) map[row.tagId] = Number(row.count);
  return map;
}
