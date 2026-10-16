import { desc, eq, inArray } from 'drizzle-orm';

import { getDb, getSqlite } from '@/db/client';
import {
  importBatches,
  importDrafts,
  type ImportBatch,
  type ImportDraft,
  type Transaction,
} from '@/db/schema';
import { listCategories } from '@/services/categories.service';
import { upsertMerchantAlias } from '@/services/merchant.service';
import { createRule } from '@/services/rules.service';
import { insertImportedTransactions } from '@/services/transactions.service';
import { notifyDbChanged } from '@/stores/db.store';
import { createId } from '@/utils/id';
import { transactionFingerprint } from '@/utils/hash';
import { captureSourceFor, stagedDraftToDraftTransaction, toTransactionRows, type DraftTransaction, type ImportPreview, type ImportSourceId } from './pipeline';

/**
 * Statement import staging — the review layer between a file and the ledger.
 *
 * A file never writes to `transactions`. It becomes an `import_batches` row
 * plus `import_drafts` rows; the user reviews the drafts and confirms what
 * belongs in the ledger. Drafts hold the raw statement text (the most
 * sensitive data in the app) and are deleted the moment every row is resolved
 * or the batch is abandoned — nothing survives silently.
 *
 * Duplicate detection warns, never assumes: a fingerprint match stays staged
 * as "possible duplicate" and is skipped by default, but the user can keep it.
 */

/* ------------------------------- Staging ---------------------------------- */

export interface StageImportOptions {
  source: ImportSourceId;
  fileName?: string | null;
  accountId: string;
  defaultCategoryId?: string | null;
}

export interface StageImportResult {
  batchId: string;
  staged: number;
  duplicates: number;
}

/** The `import_batches.source` enum is the statement formats we stage. */
function batchSourceFor(source: ImportSourceId): ImportBatch['source'] {
  switch (source) {
    case 'json':
      return 'json';
    case 'ofx':
      return 'ofx';
    case 'pdf':
      return 'pdf';
    case 'sms':
      return 'sms';
    case 'xlsx':
      return 'xlsx';
    default:
      return 'csv';
  }
}

/** The batch enum keeps only the row types a statement can contain. */
function draftTypeFor(type: DraftTransaction['type']): ImportDraftType {
  return type === 'income' || type === 'refund' || type === 'adjustment' ? type : 'expense';
}

/**
 * Persists a preview as a staged batch. Invalid rows are counted but never
 * staged; duplicates are staged with their fingerprint match noted.
 */
export async function stageImportPreview(preview: ImportPreview, options: StageImportOptions): Promise<StageImportResult> {
  const db = getDb();
  const categories = await listCategories();
  const categoryByName = new Map(categories.map((category) => [category.name.toLowerCase(), category.id]));

  const now = Date.now();
  const batchId = createId('imp');
  const stageable = preview.items.filter((item) => item.status !== 'invalid' && item.draft.date && item.draft.amount !== null);

  const draftRows: ImportDraft[] = stageable.map((item, index) => {
    const draft = item.draft;
    const ruleCategory = draft.categoryId ?? null;
    const statementCategory = draft.categoryName ? (categoryByName.get(draft.categoryName.toLowerCase()) ?? null) : null;
    const suggestedCategoryId = draft.suggestedCategoryId ?? null;
    return {
      id: createId('drf'),
      batchId,
      sourceRow: draft.sourceRow,
      date: draft.date,
      amount: draft.amount,
      type: draftTypeFor(draft.type),
      merchant: draft.merchant,
      description: draft.description,
      rawDescription: draft.description ?? draft.merchant,
      accountId: draft.accountId ?? null,
      categoryId: ruleCategory ?? statementCategory,
      categorySource: ruleCategory ? 'rule' : statementCategory ? 'statement' : suggestedCategoryId ? 'suggestion' : null,
      suggestedCategoryId,
      suggestedRuleName: draft.suggestedRuleName ?? null,
      reference: draft.reference,
      notes: draft.notes,
      fingerprint: item.fingerprint,
      duplicateOf: item.duplicateOf ?? null,
      errors: JSON.stringify(item.errors),
      status: 'pending',
      transactionId: null,
      createdAt: now + index,
      updatedAt: now + index,
    };
  });

  await db.insert(importBatches).values({
    id: batchId,
    source: batchSourceFor(options.source),
    fileName: options.fileName?.trim() || null,
    accountId: options.accountId,
    defaultCategoryId: options.defaultCategoryId ?? null,
    status: 'staged',
    totalRows: draftRows.length,
    confirmedRows: 0,
    skippedRows: 0,
    duplicateRows: preview.counts.duplicate,
    invalidRows: preview.counts.invalid,
    createdAt: now,
    updatedAt: now,
    committedAt: null,
  });

  if (draftRows.length > 0) {
    await db.insert(importDrafts).values(draftRows);
  }

  notifyDbChanged();
  return { batchId, staged: draftRows.length, duplicates: preview.counts.duplicate };
}

/* -------------------------------- Reads ----------------------------------- */

export interface ImportBatchSummary extends ImportBatch {
  /** Drafts still waiting for a decision. */
  pending: number;
}

export async function listStagedImportBatches(): Promise<ImportBatchSummary[]> {
  const db = getDb();
  const batches = await db.select().from(importBatches).where(eq(importBatches.status, 'staged')).orderBy(desc(importBatches.createdAt));
  if (batches.length === 0) return [];

  const sqlite = getSqlite();
  const counts = await sqlite.getAllAsync<{ batch_id: string; pending: number }>(
    "SELECT batch_id, COUNT(*) AS pending FROM import_drafts WHERE status = 'pending' GROUP BY batch_id",
  );
  const pendingByBatch = new Map(counts.map((row) => [row.batch_id, row.pending]));
  return batches
    .map((batch) => ({ ...batch, pending: pendingByBatch.get(batch.id) ?? 0 }))
    .filter((batch) => batch.pending > 0);
}

export interface ImportBatchBundle {
  batch: ImportBatch;
  drafts: ImportDraft[];
}

export async function getImportBatchBundle(batchId: string): Promise<ImportBatchBundle | null> {
  const db = getDb();
  const batches = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1);
  const batch = batches[0];
  if (!batch) return null;
  const drafts = await db.select().from(importDrafts).where(eq(importDrafts.batchId, batchId)).orderBy(importDrafts.sourceRow);
  return { batch, drafts };
}

/** Cheap count for badges and the Inbox — never renders the drafts. */
export async function countPendingImportDrafts(): Promise<{ batches: number; drafts: number }> {
  const sqlite = getSqlite();
  const result = await sqlite.getFirstAsync<{ batches: number; drafts: number }>(
    `SELECT
       (SELECT COUNT(*) FROM import_batches WHERE status = 'staged') AS batches,
       (SELECT COUNT(*) FROM import_drafts WHERE status = 'pending') AS drafts`,
  );
  return { batches: Number(result?.batches ?? 0), drafts: Number(result?.drafts ?? 0) };
}

/* -------------------------------- Writes ---------------------------------- */

export interface ImportDraftPatch {
  date?: string;
  categoryId?: string | null;
  merchant?: string | null;
  notes?: string | null;
  accountId?: string | null;
  type?: 'expense' | 'income' | 'refund' | 'adjustment';
}

/** Local edits to a staged draft. Nothing here touches the ledger. */
export async function updateImportDraft(draftId: string, patch: ImportDraftPatch): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(importDrafts).where(eq(importDrafts.id, draftId)).limit(1);
  const current = rows[0];
  if (!current) throw new Error('Draft not found.');
  if (current.status !== 'pending') return;

  await db
    .update(importDrafts)
    .set({
      date: patch.date ?? current.date,
      categoryId: patch.categoryId === undefined ? current.categoryId : patch.categoryId,
      categorySource:
        patch.categoryId === undefined ? current.categorySource : patch.categoryId ? 'manual' : null,
      merchant: patch.merchant === undefined ? current.merchant : patch.merchant,
      notes: patch.notes === undefined ? current.notes : patch.notes,
      accountId: patch.accountId === undefined ? current.accountId : patch.accountId,
      type: patch.type ?? current.type,
      updatedAt: Date.now(),
    })
    .where(eq(importDrafts.id, draftId));
}

export type ImportDraftType = ImportDraft['type'];

/** Pure: reconstructs the pipeline draft shape from a staged row. */
export const draftToDraftTransaction = stagedDraftToDraftTransaction;

/** Recomputes a batch's counters; deletes drafted copies once nothing is pending. */
async function refreshBatch(batchId: string): Promise<void> {
  const db = getDb();
  const drafts = await db.select().from(importDrafts).where(eq(importDrafts.batchId, batchId));
  const confirmed = drafts.filter((draft) => draft.status === 'confirmed').length;
  const skipped = drafts.filter((draft) => draft.status === 'skipped').length;
  const pending = drafts.filter((draft) => draft.status === 'pending').length;
  const now = Date.now();

  if (pending === 0) {
    // Retention default: resolved drafts (raw statement text) are deleted.
    await db.delete(importDrafts).where(eq(importDrafts.batchId, batchId));
    await db
      .update(importBatches)
      .set({ status: 'committed', confirmedRows: confirmed, skippedRows: skipped, updatedAt: now, committedAt: now })
      .where(eq(importBatches.id, batchId));
  } else {
    await db
      .update(importBatches)
      .set({ confirmedRows: confirmed, skippedRows: skipped, updatedAt: now })
      .where(eq(importBatches.id, batchId));
  }
}

/**
 * Confirms staged drafts: writes ONLY the selected rows through the existing
 * transaction service (balances included) and marks each draft confirmed.
 * Rows are written as reviewed — the review screen is the review.
 */
export async function confirmImportDrafts(draftIds: string[]): Promise<number> {
  if (draftIds.length === 0) return 0;
  const db = getDb();
  const rows = await db.select().from(importDrafts).where(inArray(importDrafts.id, draftIds));
  const pending = rows.filter((draft) => draft.status === 'pending' && draft.date && draft.amount !== null);
  if (pending.length === 0) return 0;

  const batchIds = Array.from(new Set(pending.map((draft) => draft.batchId)));
  const batches = await db.select().from(importBatches).where(inArray(importBatches.id, batchIds));
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));

  const transactionRows: Transaction[] = [];
  const links: { draftId: string; transactionId: string }[] = [];
  for (const draft of pending) {
    const batch = batchById.get(draft.batchId);
    if (!batch) continue;
    const fingerprint =
      draft.fingerprint ??
      transactionFingerprint({
        date: draft.date!,
        amount: draft.amount!,
        merchant: draft.merchant,
        accountId: draft.accountId ?? batch.accountId,
        reference: draft.reference,
        description: draft.description,
      });
    const [row] = toTransactionRows([{ draft: draftToDraftTransaction(draft), fingerprint, isReviewed: true }], {
      accountId: draft.accountId ?? batch.accountId,
      categoryIdByName: new Map(),
      defaultCategoryId: batch.defaultCategoryId,
      captureSource: captureSourceFor(batch.source as ImportSourceId),
      importBatchId: batch.id,
    });
    if (!row) continue;
    transactionRows.push(row);
    links.push({ draftId: draft.id, transactionId: row.id });
  }

  if (transactionRows.length === 0) return 0;

  await insertImportedTransactions(transactionRows);

  const now = Date.now();
  for (const link of links) {
    await db
      .update(importDrafts)
      .set({ status: 'confirmed', transactionId: link.transactionId, updatedAt: now })
      .where(eq(importDrafts.id, link.draftId));
  }
  for (const batchId of batchIds) await refreshBatch(batchId);

  notifyDbChanged();
  return transactionRows.length;
}

/** Skips drafts without writing anything to the ledger. */
export async function skipImportDrafts(draftIds: string[]): Promise<void> {
  if (draftIds.length === 0) return;
  const db = getDb();
  const rows = await db.select().from(importDrafts).where(inArray(importDrafts.id, draftIds));
  const batchIds = Array.from(new Set(rows.filter((draft) => draft.status === 'pending').map((draft) => draft.batchId)));
  if (batchIds.length === 0) return;

  await db
    .update(importDrafts)
    .set({ status: 'skipped', updatedAt: Date.now() })
    .where(inArray(importDrafts.id, draftIds));
  for (const batchId of batchIds) await refreshBatch(batchId);
  notifyDbChanged();
}

/** Abandons a staged batch: every draft copy is deleted immediately. */
export async function abandonImportBatch(batchId: string): Promise<void> {
  const db = getDb();
  await db.delete(importDrafts).where(eq(importDrafts.batchId, batchId));
  await db.delete(importBatches).where(eq(importBatches.id, batchId));
  notifyDbChanged();
}

/* ----------------------------- Merchant memory ----------------------------- */

export interface RememberMerchantInput {
  /** Canonical merchant name to match on (e.g. "Amazon"). */
  merchant: string;
  categoryId: string;
  /** Raw statement text, taught to the alias list when it differs. */
  rawMerchant?: string | null;
}

/**
 * "Always suggest this for <merchant>": writes a suggest-mode rule plus a
 * merchant alias. It never applies silently — future imports preselect and
 * explain it ("from your rule: Remember Amazon").
 */
export async function rememberMerchantForCategory(input: RememberMerchantInput): Promise<string> {
  const merchant = input.merchant.trim();
  if (!merchant) throw new Error('No merchant to remember.');
  const rule = await createRule({
    name: `Remember ${merchant}`,
    conditions: [{ field: 'merchant', operator: 'contains', value: merchant }],
    actions: [{ type: 'set_category', value: input.categoryId }],
    mode: 'suggest',
  });
  const raw = input.rawMerchant?.trim();
  if (raw && raw.toLowerCase() !== merchant.toLowerCase()) {
    await upsertMerchantAlias(raw, merchant);
  }
  return rule.id;
}
