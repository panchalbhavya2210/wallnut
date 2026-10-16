import { describe, expect, it } from 'vitest';

import type { Rule } from '@/db/schema';
import {
  applyImportRules,
  captureSourceFor,
  stagedDraftToDraftTransaction,
  toTransactionRows,
  type DraftTransaction,
} from '@/services/import/pipeline';
import { partitionRulesByMode } from '@/utils/rules';

/**
 * Statement import P1 — staging semantics that must never regress:
 *   • apply-mode rules write silently (classic behaviour)
 *   • suggest-mode rules (merchant memory) only propose — never apply
 *   • rows remember where they came from (capture source + batch id)
 */

const draft = (over: Partial<DraftTransaction> = {}): DraftTransaction => ({
  sourceRow: 1,
  date: '2026-10-04',
  amount: -124900,
  type: 'expense' as const,
  merchant: 'SWIGGY BANGALORE',
  description: null,
  accountName: null,
  categoryName: null,
  reference: null,
  notes: null,
  ...over,
});

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'rul_1',
  name: 'Swiggy → Food',
  isEnabled: true,
  matchType: 'all',
  mode: 'apply',
  conditions: JSON.stringify([{ field: 'merchant', operator: 'contains', value: 'swiggy' }]),
  actions: JSON.stringify([{ type: 'set_category', value: 'cat_food' }]),
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('statement import staging (Pass 21)', () => {
  it('partitions rules by mode', () => {
    const apply = rule({ id: 'a', mode: 'apply' });
    const suggest = rule({ id: 's', mode: 'suggest' });
    const { apply: applyRules, suggest: suggestRules } = partitionRulesByMode([apply, suggest]);
    expect(applyRules.map((entry) => entry.id)).toEqual(['a']);
    expect(suggestRules.map((entry) => entry.id)).toEqual(['s']);
  });

  it('apply-mode rules write the category exactly as before', () => {
    const result = applyImportRules(draft(), {
      accountId: 'acc_bank',
      rules: [rule()],
      aliases: [],
      autoReview: true,
    });
    expect(result.draft.categoryId).toBe('cat_food');
    expect(result.draft.suggestedCategoryId ?? null).toBeNull();
    expect(result.matchedRuleIds).toEqual(['rul_1']);
  });

  it('suggest-mode rules only propose a category and explain their source', () => {
    const result = applyImportRules(draft(), {
      accountId: 'acc_bank',
      rules: [rule({ mode: 'suggest' })],
      aliases: [],
      autoReview: true,
    });
    // Nothing applied…
    expect(result.draft.categoryId ?? null).toBeNull();
    // …only suggested, with the rule that suggested it.
    expect(result.draft.suggestedCategoryId).toBe('cat_food');
    expect(result.draft.suggestedRuleName).toBe('Swiggy → Food');
    // A suggestion still needs the user's eyes.
    expect(result.isReviewed).toBe(false);
  });

  it('an applied rule beats a suggestion and keeps the row reviewed', () => {
    const result = applyImportRules(draft(), {
      accountId: 'acc_bank',
      rules: [rule(), rule({ id: 'rul_suggest', name: 'Memory: Swiggy', mode: 'suggest' })],
      aliases: [],
      // No auto-review: the applied category is trusted, unlike a suggestion.
      autoReview: false,
    });
    expect(result.draft.categoryId).toBe('cat_food');
    expect(result.isReviewed).toBe(true);
  });

  it('rows carry the capture source and the import batch id', () => {
    const rows = toTransactionRows(
      [{ draft: draft({ categoryId: 'cat_chosen' }), fingerprint: 'fp_1', isReviewed: true }],
      {
        accountId: 'acc_bank',
        categoryIdByName: new Map(),
        captureSource: 'csv',
        importBatchId: 'imp_1',
      },
    );
    expect(rows[0]?.categoryId).toBe('cat_chosen');
    expect(rows[0]?.captureSource).toBe('csv');
    expect(rows[0]?.importBatchId).toBe('imp_1');
    expect(rows[0]?.isReviewed).toBe(true);
  });

  it('never writes a suggested-only category into the ledger', () => {
    const rows = toTransactionRows(
      [{ draft: draft({ suggestedCategoryId: 'cat_suggested' }), fingerprint: 'fp_2' }],
      { accountId: 'acc_bank', categoryIdByName: new Map() },
    );
    expect(rows[0]?.categoryId ?? null).toBeNull();
    expect(rows[0]?.captureSource).toBe('manual');
  });

  it('staged drafts prefer an explicit category over a suggestion', () => {
    const base = {
      sourceRow: 3,
      date: '2026-10-04',
      amount: -50000,
      type: 'expense' as const,
      merchant: 'Amazon',
      description: null,
      reference: null,
      notes: null,
      accountId: null,
    };
    const withChoice = stagedDraftToDraftTransaction({ ...base, categoryId: 'cat_chosen', suggestedCategoryId: 'cat_suggested' });
    expect(withChoice.categoryId).toBe('cat_chosen');
    const suggestionOnly = stagedDraftToDraftTransaction({ ...base, categoryId: null, suggestedCategoryId: 'cat_suggested' });
    expect(suggestionOnly.categoryId).toBe('cat_suggested');
  });

  it('maps every import source to a capture source value', () => {
    expect(captureSourceFor('csv')).toBe('csv');
    expect(captureSourceFor('json')).toBe('json');
    expect(captureSourceFor('pdf')).toBe('pdf');
    expect(captureSourceFor('ofx')).toBe('ofx');
    expect(captureSourceFor('sms')).toBe('sms');
    expect(captureSourceFor(undefined)).toBe('manual');
  });
});
