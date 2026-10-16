import { getSqlite } from '@/db/client';
import { listAccounts } from '@/services/accounts.service';
import { listCategories } from '@/services/categories.service';
import { listMerchantAliases } from '@/services/merchant.service';
import { loadEnabledRules } from '@/services/rules.service';
import { useSettingsStore } from '@/stores/settings.store';
import { insertImportedTransactions, getExistingFingerprints } from '@/services/transactions.service';
import { parseCsv } from '@/utils/csv';
import { notifyDbChanged } from '@/stores/db.store';
import { toISODate } from '@/utils/date';
import {
  applyImportRules,
  buildFingerprints,
  enrichDrafts,
  normalizeRecords,
  toTransactionRows,
  validateDrafts,
  type DraftTransaction,
  type ImportMapping,
  type ImportPreview,
  type ImportRuleContext,
  type ImportSource,
  type PreviewItem,
  type RawRecord,
} from './pipeline';

/**
 * TransactionImportService — the single entry point every data source uses:
 *   Raw Input → Normalizer → Validator → Duplicate Detector → Transaction Service → DB
 * CSV today; SMS will plug into `previewRecords` with a bank-specific normalizer.
 */

/** Heuristic column mapping for a freshly parsed file. */
export function autoDetectMapping(headers: string[]): ImportMapping {
  const find = (...candidates: string[]): string | undefined =>
    headers.find((header) => candidates.some((candidate) => header.toLowerCase().includes(candidate)));

  const amountColumn = find('amount', 'value', 'sum', 'total');
  const debitColumn = headers.find((h) => /^debit|withdraw(al)?|paid out|outflow/i.test(h.trim()));
  const creditColumn = headers.find((h) => /^credit|deposit|paid in|inflow/i.test(h.trim()));

  return {
    date: find('date', 'posted', 'time', 'txn date', 'value date'),
    amount: amountColumn,
    debit: amountColumn ? undefined : debitColumn,
    credit: amountColumn ? undefined : creditColumn,
    type: find('type', 'direction', 'dr/cr', 'transaction type'),
    merchant: find('merchant', 'payee', 'name', 'vendor', 'narration', 'particulars'),
    description: find('description', 'details', 'remark', 'note', 'memo'),
    category: find('category', 'tag'),
    account: find('account'),
    reference: find('reference', 'ref', 'cheque', 'txn id', 'transaction id', 'utr'),
    notes: find('notes', 'comment'),
    positiveIsIncome: true,
  };
}

export interface ImportContext {
  mapping: ImportMapping;
  accountId: string;
  defaultCategoryId?: string | null;
}

/** Loads the local rule context once per import (rules + aliases + review pref). */
async function loadRuleContext(accountId: string): Promise<ImportRuleContext> {
  const [rules, aliases] = await Promise.all([loadEnabledRules(), listMerchantAliases()]);
  const autoReview = useSettingsStore.getState().transactions.autoReviewImports;
  return { accountId, rules, aliases, autoReview };
}

/** Stages 1–3 with no database writes: safe to preview. */
export async function previewRecords(records: RawRecord[], context: ImportContext): Promise<ImportPreview> {
  const drafts = normalizeRecords(records, context.mapping);
  const validated = validateDrafts(drafts);
  const ruleContext = await loadRuleContext(context.accountId);
  // Fingerprints use the raw statement values so they stay stable across
  // imports; enrichment (alias names, rules) only shapes the written ledger.
  const accountFor = (item: { accountId?: string | null }) => item.accountId ?? context.accountId;
  const existing = await getExistingFingerprints(
    validated
      .filter((item) => item.errors.length === 0 && item.amount !== null)
      .map((item) => buildFingerprints([{ item, accountId: accountFor(item) }], new Set()).get(item.sourceRow)!.fingerprint),
  );
  const fingerprints = buildFingerprints(
    validated.map((item) => ({ item, accountId: accountFor(item) })),
    existing,
  );
  const enriched = enrichDrafts(validated, ruleContext);

  const items: PreviewItem[] = enriched.map((item) => {
    const dedupe = fingerprints.get(item.sourceRow)!;
    const status: PreviewItem['status'] =
      item.errors.length > 0 ? 'invalid' : dedupe.duplicateOf ? 'duplicate' : 'new';
    return {
      row: item.sourceRow,
      draft: item,
      errors: item.errors,
      status,
      fingerprint: dedupe.fingerprint || null,
      duplicateOf: dedupe.duplicateOf,
    };
  });

  return {
    items,
    counts: {
      total: items.length,
      new: items.filter((i) => i.status === 'new').length,
      duplicate: items.filter((i) => i.status === 'duplicate').length,
      invalid: items.filter((i) => i.status === 'invalid').length,
    },
  };
}

export async function previewCsv(text: string, context: ImportContext): Promise<{ preview: ImportPreview; headers: string[] }> {
  const parsed = parseCsv(text);
  if (parsed.headers.length === 0) {
    return { preview: { items: [], counts: { total: 0, new: 0, duplicate: 0, invalid: 0 } }, headers: [] };
  }
  const records: RawRecord[] = parsed.rows.map((row) => {
    const record: RawRecord = {};
    parsed.headers.forEach((header, index) => {
      record[header] = row[index];
    });
    return record;
  });
  const preview = await previewRecords(records, context);
  return { preview, headers: parsed.headers };
}

/**
 * Stage 4 — commits the preview. Rows are re-validated against duplicates at
 * commit time so a stale preview can never silently create duplicates.
 */
export async function commitImport(
  preview: ImportPreview,
  context: ImportContext,
  options: { includeDuplicates?: boolean } = {},
): Promise<{ inserted: number; skippedDuplicates: number; skippedInvalid: number }> {
  const includeDuplicates = options.includeDuplicates ?? false;
  const candidates = preview.items.filter((item) => item.status === 'new' || (includeDuplicates && item.status === 'duplicate'));
  const invalidCount = preview.items.filter((item) => item.status === 'invalid').length;

  if (candidates.length === 0) {
    return { inserted: 0, skippedDuplicates: preview.counts.duplicate, skippedInvalid: invalidCount };
  }

  const categoriesList = await listCategories();
  const categoryIdByName = new Map(categoriesList.map((category) => [category.name.toLowerCase(), category.id]));

  // Re-check duplicates against the live database at commit time.
  const fingerprints = candidates.map((item) => item.fingerprint).filter((value): value is string => Boolean(value));
  const existingNow = await getExistingFingerprints(fingerprints);

  const fresh = candidates.filter((item) => !item.fingerprint || !existingNow.has(item.fingerprint));
  // Rules run again at commit so a rule edited between preview and import still
  // applies — and every row's review state is decided by the current setting.
  const ruleContext = await loadRuleContext(context.accountId);
  const rows = toTransactionRows(
    fresh.map((item) => {
      const result = applyImportRules(item.draft, ruleContext);
      return { draft: result.draft, fingerprint: item.fingerprint!, isReviewed: result.isReviewed };
    }),
    {
      accountId: context.accountId,
      categoryIdByName,
      defaultCategoryId: context.defaultCategoryId ?? null,
    },
  );

  await insertImportedTransactions(rows);
  notifyDbChanged();

  return {
    inserted: rows.length,
    skippedDuplicates: preview.counts.duplicate + (candidates.length - fresh.length),
    skippedInvalid: invalidCount,
  };
}

/** Convenience: CSV in, transactions out. Used by the import wizard's final step. */
export async function importCsv(text: string, context: ImportContext, options: { includeDuplicates?: boolean } = {}) {
  const { preview } = await previewCsv(text, context);
  return commitImport(preview, context, options);
}

export interface ImportSourceInfo {
  accounts: Awaited<ReturnType<typeof listAccounts>>;
  sources: ImportSource[];
}

export async function getImportSources(): Promise<ImportSourceInfo> {
  const { IMPORT_SOURCES } = await import('./pipeline');
  const accounts = await listAccounts();
  return { accounts, sources: IMPORT_SOURCES };
}

/** Removes every unreviewed imported row (Settings → Data → Clean up). */
export async function deleteUnreviewedImports(): Promise<number> {
  const sqlite = getSqlite();
  const result = await sqlite.runAsync('DELETE FROM transactions WHERE is_reviewed = 0');
  notifyDbChanged();
  return result.changes ?? 0;
}

export function defaultExportRangeLabel(): string {
  return `through ${toISODate(new Date())}`;
}
