import { and, eq, gt } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { aiCache } from '@/db/schema';
import { createId } from '@/utils/id';

export { hashRequest, stableStringify } from './hash';

/**
 * AI response cache. Identical requests (same feature + sanitized payload)
 * never hit the network twice while the entry is fresh, which is the main cost
 * control for a local-first app.
 */

export async function getCached(hash: string): Promise<string | null> {
  try {
    const db = getDb();
    const rows = await db
      .select({ response: aiCache.response })
      .from(aiCache)
      .where(and(eq(aiCache.requestHash, hash), gt(aiCache.expiresAt, Date.now())))
      .limit(1);
    return rows[0]?.response ?? null;
  } catch {
    return null;
  }
}

export async function putCached(entry: {
  hash: string;
  feature: string;
  response: string;
  model: string;
  ttlMs: number;
}): Promise<void> {
  const db = getDb();
  const now = Date.now();
  await db
    .insert(aiCache)
    .values({
      id: createId('ai'),
      requestHash: entry.hash,
      feature: entry.feature,
      response: entry.response,
      model: entry.model,
      createdAt: now,
      expiresAt: now + entry.ttlMs,
    })
    .onConflictDoUpdate({
      target: aiCache.requestHash,
      set: {
        response: entry.response,
        model: entry.model,
        createdAt: now,
        expiresAt: now + entry.ttlMs,
      },
    });
}

export async function clearAiCache(): Promise<void> {
  const db = getDb();
  await db.delete(aiCache);
}
