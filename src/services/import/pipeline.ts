import type { MerchantAlias, Rule, Transaction, TransactionType } from '@/db/schema';
import { canonicalMerchant } from '@/utils/merchant';
import { evaluateRules } from '@/utils/rules';
import { toISODate } from '@/utils/date';
import { transactionFingerprint } from '@/utils/hash';
import { createId } from '@/utils/id';
import { parseMoney } from '@/utils/money';

/**
 * The import pipeline shared by every data source:
 *
 *   Raw Input → Normalizer → Validator → Duplicate Detector → Transaction Service → DB
 *
 * CSV today, SMS/XLSX/PDF/bank APIs later — all go through these same stages.
 * Nothing inserts a transaction without passing validation and dedupe.
 */

export type ImportSourceId = 'manual' | 'csv' | 'json' | 'sms' | 'xlsx' | 'pdf' | 'api';

export interface ImportSource {
  id: ImportSourceId;
  label: string;
  available: boolean;
}

export const IMPORT_SOURCES: ImportSource[] = [
  { id: 'manual', label: 'Manual entry', available: true },
  { id: 'csv', label: 'CSV file', available: true },
  { id: 'json', label: 'JSON backup', available: true },
  { id: 'sms', label: 'Bank SMS', available: false },
  { id: 'xlsx', label: 'Excel file', available: false },
  { id: 'pdf', label: 'PDF statement', available: false },
  { id: 'api', label: 'Bank connection', available: false },
];

/** A record as it arrives from a source, before interpretation. */
export interface RawRecord {
  [key: string]: string | undefined;
}

/** A partially interpreted record. */
export interface DraftTransaction {
  sourceRow: number;
  date: string | null;
  amount: number | null; // signed minor units
  type: TransactionType;
  merchant: string | null;
  description: string | null;
  accountName: string | null;
  categoryName: string | null;
  reference: string | null;
  notes: string | null;
  /** Resolved by the local rules engine (wins over categoryName). */
  categoryId?: string | null;
  /** Resolved by the local rules engine (wins over the wizard's account). */
  accountId?: string | null;
}

export interface ValidatedTransaction extends DraftTransaction {
  errors: string[];
}

export interface PreviewItem {
  row: number;
  draft: DraftTransaction;
  errors: string[];
  status: 'new' | 'duplicate' | 'invalid';
  fingerprint: string | null;
  /** Existing transaction id when this row matched an import already in the DB. */
  duplicateOf?: string;
}

export interface ImportPreview {
  items: PreviewItem[];
  counts: { total: number; new: number; duplicate: number; invalid: number };
}

export interface ImportMapping {
  date?: string;
  amount?: string;
  /** Separate debit/credit columns (bank statement style). */
  debit?: string;
  credit?: string;
  type?: string;
  merchant?: string;
  description?: string;
  category?: string;
  account?: string;
  reference?: string;
  notes?: string;
  /** Treat positive amounts in the amount column as income. */
  positiveIsIncome?: boolean;
  /** Values in the type column that mean income. */
  incomeValues?: string;
}

export interface ImportOptions {
  accountId: string;
  /** Import rows that look like duplicates anyway. */
  includeDuplicates: boolean;
  defaultCategoryId?: string | null;
}

/* ------------------------------- Normalizing -------------------------------- */

/**
 * Normalizes date strings from common formats: 2026-10-04, 04/10/2026,
 * 04-10-2026, 4 Oct 2026, 2026/10/04.
 */
export function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text);
  if (slash) {
    let [, a, b, c] = slash;
    let day = Number(a);
    let month = Number(b);
    let year = Number(c);
    if (month > 12 && day <= 12) {
      // Clearly a MM/DD value.
      [day, month] = [month, day];
    }
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
  }

  const named = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-](\d{2,4})$/.exec(text);
  if (named) {
    const [, d, monthName, y] = named;
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthIndex = months.findIndex((m) => monthName!.toLowerCase().startsWith(m));
    if (monthIndex >= 0) {
      let year = Number(y);
      if (year < 100) year += 2000;
      return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return toISODate(parsed);
  return null;
}

export function normalizeType(value: string | undefined, amount: number | null, options: ImportMapping): TransactionType {
  const text = (value ?? '').trim().toLowerCase();
  const incomeValues = (options.incomeValues ?? 'income,credit,cr,deposit,received')
    .split(',')
    .map((v) => v.trim().toLowerCase());
  if (text) {
    if (incomeValues.includes(text) || text.includes('income') || text === 'credit') return 'income';
    if (text.includes('transfer')) return 'transfer';
    if (text.includes('refund')) return 'refund';
    if (text.includes('expense') || text.includes('debit')) return 'expense';
  }
  if (amount !== null) {
    if (amount > 0) return options.positiveIsIncome === false ? 'expense' : 'income';
    if (amount < 0) return 'expense';
  }
  return 'expense';
}

/** Stage 1 — turn raw source rows into typed drafts. */
export function normalizeRecords(records: RawRecord[], mapping: ImportMapping): DraftTransaction[] {
  return records.map((record, index) => {
    const rawDate = mapping.date ? record[mapping.date] : undefined;
    const date = normalizeDate(rawDate);

    let amount: number | null = null;
    if (mapping.amount && record[mapping.amount] !== undefined && record[mapping.amount] !== '') {
      const parsed = parseMoney(record[mapping.amount]!);
      if (parsed !== null) amount = parsed;
    } else if (mapping.debit || mapping.credit) {
      const debit = mapping.debit ? parseMoney(record[mapping.debit] ?? '') : null;
      const credit = mapping.credit ? parseMoney(record[mapping.credit] ?? '') : null;
      if (debit !== null && debit !== 0) amount = -Math.abs(debit);
      else if (credit !== null && credit !== 0) amount = Math.abs(credit);
    }

    const typeColumn = mapping.type ? record[mapping.type] : undefined;
    const type = normalizeType(typeColumn, amount, mapping);

    return {
      sourceRow: index + 1,
      date,
      amount,
      type,
      merchant: mapping.merchant ? record[mapping.merchant]?.trim() || null : null,
      description: mapping.description ? record[mapping.description]?.trim() || null : null,
      accountName: mapping.account ? record[mapping.account]?.trim() || null : null,
      categoryName: mapping.category ? record[mapping.category]?.trim() || null : null,
      reference: mapping.reference ? record[mapping.reference]?.trim() || null : null,
      notes: mapping.notes ? record[mapping.notes]?.trim() || null : null,
    };
  });
}

/** Stage 2 — validation with human-readable reasons. */
export function validateDrafts(drafts: DraftTransaction[]): ValidatedTransaction[] {
  return drafts.map((draft) => {
    const errors: string[] = [];
    if (!draft.date) errors.push('Missing or unreadable date');
    if (draft.amount === null || draft.amount === 0) errors.push('Missing or zero amount');
    if (draft.type === 'transfer') errors.push('Transfers cannot be imported directly');
    return { ...draft, errors };
  });
}

/* ---------------------------- Rule enrichment ------------------------------ */

export interface ImportRuleContext {
  /** Account the wizard selected; rules may reroute individual rows. */
  accountId: string;
  rules: Rule[];
  aliases: MerchantAlias[];
  /** From Settings → Transactions: flag imports for the review queue. */
  autoReview: boolean;
}

export interface ImportRuleResult<T extends DraftTransaction = DraftTransaction> {
  draft: T;
  /** False when the row should land in the review queue. */
  isReviewed: boolean;
  matchedRuleIds: string[];
}

const IMPORTABLE_TYPES: TransactionType[] = ['expense', 'income', 'refund', 'adjustment'];

/**
 * Local-first categorization for imports, exactly like manual entry:
 *   1. canonicalise the merchant through merchant_aliases ("AMZN Mktp" → "Amazon")
 *   2. run the user's enabled rules (exact rules always beat raw statement text)
 * AI never runs here — uncertain rows go to the review queue instead.
 */
export function applyImportRules<T extends DraftTransaction>(draft: T, context: ImportRuleContext): ImportRuleResult<T> {
  const merchant = draft.merchant ? canonicalMerchant(draft.merchant, context.aliases) : draft.merchant;
  const target = {
    merchant,
    description: draft.description,
    amount: draft.amount,
    type: draft.type,
    accountId: context.accountId,
    categoryId: null,
    date: draft.date,
  };
  const outcome = evaluateRules(context.rules, target);
  const ruleType = IMPORTABLE_TYPES.includes(outcome.type as TransactionType)
    ? (outcome.type as TransactionType)
    : undefined;
  return {
    draft: {
      ...draft,
      merchant,
      categoryId: outcome.categoryId ?? draft.categoryId ?? null,
      accountId: outcome.accountId ?? draft.accountId ?? null,
      type: ruleType ?? draft.type,
    },
    isReviewed: outcome.markReview ? false : !context.autoReview,
    matchedRuleIds: outcome.matchedRuleIds,
  };
}

/** Applies `applyImportRules` to a batch, keeping the validated row shape. */
export function enrichDrafts<T extends DraftTransaction>(drafts: T[], context: ImportRuleContext): T[] {
  if (context.rules.length === 0 && context.aliases.length === 0) return drafts;
  return drafts.map((draft) => applyImportRules(draft, context).draft);
}

export interface DedupeInput {
  item: ValidatedTransaction;
  accountId: string;
}

export interface DedupeResult {
  fingerprint: string;
  duplicateOf?: string;
}

/** Stage 3 — deterministic fingerprints checked against both the file and DB. */
export function buildFingerprints(items: DedupeInput[], existing: Set<string>): Map<number, DedupeResult> {
  const results = new Map<number, DedupeResult>();
  const seenInFile = new Map<string, number>();
  for (const { item, accountId } of items) {
    if (item.errors.length > 0 || !item.date || item.amount === null) {
      results.set(item.sourceRow, { fingerprint: '' });
      continue;
    }
    const fingerprint = transactionFingerprint({
      date: item.date,
      amount: item.amount,
      merchant: item.merchant,
      accountId,
      reference: item.reference,
      description: item.description,
    });
    const firstSeen = seenInFile.get(fingerprint);
    if (existing.has(fingerprint)) {
      results.set(item.sourceRow, { fingerprint, duplicateOf: 'existing' });
    } else if (firstSeen !== undefined) {
      results.set(item.sourceRow, { fingerprint, duplicateOf: `row ${firstSeen}` });
    } else {
      seenInFile.set(fingerprint, item.sourceRow);
      results.set(item.sourceRow, { fingerprint });
    }
  }
  return results;
}

/** Stage 4 — turn validated drafts into insertable rows. */
export function toTransactionRows(
  items: { draft: DraftTransaction; fingerprint: string; isReviewed?: boolean }[],
  options: { accountId: string; categoryIdByName: Map<string, string>; defaultCategoryId?: string | null },
): Transaction[] {
  const now = Date.now();
  return items.map(({ draft, fingerprint, isReviewed }, index) => {
    const amount = draft.amount ?? 0;
    const signed =
      draft.type === 'income' || draft.type === 'refund'
        ? Math.abs(amount)
        : draft.type === 'adjustment'
          ? amount
          : -Math.abs(amount);
    const categoryId =
      draft.categoryId ??
      (draft.categoryName ? options.categoryIdByName.get(draft.categoryName.toLowerCase()) : null) ??
      options.defaultCategoryId ??
      null;
    return {
      id: createId('txn'),
      accountId: draft.accountId ?? options.accountId,
      categoryId,
      amount: signed,
      type: draft.type,
      merchant: draft.merchant,
      description: draft.description,
      date: draft.date ?? toISODate(new Date()),
      notes: draft.notes,
      reference: draft.reference,
      isTransfer: false,
      transferAccountId: null,
      isRecurring: false,
      recurringId: null,
      installmentId: null,
      fingerprint,
      isReviewed: isReviewed ?? false,
      createdAt: now + index,
      updatedAt: now + index,
    };
  });
}
