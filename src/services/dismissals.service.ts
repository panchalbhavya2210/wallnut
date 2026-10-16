import { sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { inboxDismissals, type InboxDismissal } from '@/db/schema';
import { notifyDbChanged } from '@/stores/db.store';
import { createId } from '@/utils/id';

/**
 * Dismissals and snoozes for the Financial Inbox (and the review queue).
 *
 * Items are derived from the ledger; acknowledgement is the only stored state.
 * A dismissal is keyed by `kind` + a stable `refKey`, so when the underlying
 * fact changes the item can reappear on its own:
 *   kind 'transaction'        refKey = transaction id (approve/ignore)
 *   kind 'recurring_candidate'refKey = merchant (lowercase)
 *   kind 'upcoming'           refKey = recurring id + due date
 *   kind 'goal_complete'      refKey = goal id + target amount
 *   kind 'shared_balance'     refKey = person id + oldest outstanding date
 *
 * This module deliberately has no service dependencies so both the inbox and
 * the review queue can use it without an import cycle.
 */

export async function listInboxDismissals(): Promise<InboxDismissal[]> {
  const db = getDb();
  return db.select().from(inboxDismissals);
}

export async function countInboxDismissals(): Promise<number> {
  const db = getDb();
  const [row] = await db.select({ value: sql<number>`count(*)` }).from(inboxDismissals);
  return Number(row?.value ?? 0);
}

/** `snoozeDays` undefined = ignored until the underlying fact changes. */
export async function dismissInboxItem(
  kind: string,
  refKey: string,
  options: { snoozeDays?: number } = {},
): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const snoozedUntil = options.snoozeDays ? now + options.snoozeDays * 86_400_000 : null;
  await db
    .insert(inboxDismissals)
    .values({ id: createId('inx'), kind, refKey, snoozedUntil, createdAt: now })
    .onConflictDoUpdate({
      target: [inboxDismissals.kind, inboxDismissals.refKey],
      set: { snoozedUntil, createdAt: now },
    });
  notifyDbChanged();
}

/** "Remind later" — the item comes back after the snooze window. */
export async function snoozeInboxItem(kind: string, refKey: string, days = 7): Promise<void> {
  await dismissInboxItem(kind, refKey, { snoozeDays: days });
}

/** Brings every ignored/snoozed item back (the "Restore" action). */
export async function restoreInboxDismissals(): Promise<void> {
  const db = getDb();
  await db.delete(inboxDismissals);
  notifyDbChanged();
}
