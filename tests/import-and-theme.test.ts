import { describe, expect, it } from 'vitest';

import { transactionFingerprint, fingerprint } from '@/utils/hash';
import { parseCsv, toCsv, detectDelimiter } from '@/utils/csv';
import { applyImportRules, enrichDrafts, normalizeDate, normalizeType, toTransactionRows, validateDrafts, buildFingerprints } from '@/services/import/pipeline';
import { buildTrendBuckets, getPeriodRange, previousRange, pickTrendGranularity, toISODate } from '@/utils/date';
import { buildCategoryTree } from '@/utils/categories';
import { generateMaterialPalette, hexToHsl } from '@/theme/material';
import { buildThemeColors } from '@/theme/palette';
import type { Category, MerchantAlias, Rule } from '@/db/schema';

/** Duplicate detection, import normalisation, date ranges and theming. */

describe('transaction fingerprints (§44)', () => {
  const base = {
    date: '2026-10-04',
    amount: -129900,
    merchant: 'Amazon',
    accountId: 'acc_kotak',
    reference: 'UPI123',
    description: 'Order',
  };

  it('is deterministic', () => {
    expect(transactionFingerprint(base)).toBe(transactionFingerprint(base));
  });

  it('ignores case, punctuation and extra spaces', () => {
    expect(transactionFingerprint(base)).toBe(
      transactionFingerprint({ ...base, merchant: '  aMaZoN!!  ' }),
    );
  });

  it('changes when money changes', () => {
    expect(transactionFingerprint(base)).not.toBe(transactionFingerprint({ ...base, amount: -129901 }));
    expect(transactionFingerprint(base)).not.toBe(transactionFingerprint({ ...base, date: '2026-10-05' }));
    expect(transactionFingerprint(base)).not.toBe(transactionFingerprint({ ...base, accountId: 'acc_cash' }));
  });

  it('produces distinct hashes for nearby inputs', () => {
    const hashes = new Set(['a', 'b', 'c', 'd', 'e'].map((value) => fingerprint(value)));
    expect(hashes.size).toBe(5);
  });

  it('marks file-internal duplicates and matches against the database', () => {
    const item = {
      sourceRow: 1,
      date: '2026-10-04',
      amount: -129900,
      type: 'expense' as const,
      merchant: 'Amazon',
      description: null,
      accountName: null,
      categoryName: null,
      reference: null,
      notes: null,
      errors: [],
    };
    const sameTwice = [
      { item, accountId: 'acc_kotak' },
      { item: { ...item, sourceRow: 2 }, accountId: 'acc_kotak' },
    ];
    const results = buildFingerprints(sameTwice, new Set());
    expect(results.get(2)?.duplicateOf).toBe('row 1');

    const expected = transactionFingerprint({
      date: item.date,
      amount: item.amount,
      merchant: item.merchant,
      accountId: 'acc_kotak',
      reference: item.reference,
      description: item.description,
    });
    const existing = buildFingerprints([{ item, accountId: 'acc_kotak' }], new Set([expected]));
    expect(existing.get(1)?.duplicateOf).toBe('existing');
  });
});

describe('CSV import (§43)', () => {
  it('parses quoted fields, embedded commas and CRLF', () => {
    const csv = 'Date,Description,Amount\r\n2026-10-04,"Swiggy, Bangalore",-420.00\r\n2026-10-05,Salary,35000\r\n';
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(['Date', 'Description', 'Amount']);
    expect(parsed.rows[0]?.[1]).toBe('Swiggy, Bangalore');
    expect(parsed.rows).toHaveLength(2);
  });

  it('round-trips through the writer with escaping', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'with "quotes"']]);
    const parsed = parseCsv(csv);
    expect(parsed.rows[0]).toEqual(['x,y', 'with "quotes"']);
  });

  it('detects the delimiter', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('normalises dates from common bank formats', () => {
    expect(normalizeDate('2026-10-04')).toBe('2026-10-04');
    expect(normalizeDate('04/10/2026')).toBe('2026-10-04');
    expect(normalizeDate('4 Oct 2026')).toBe('2026-10-04');
    expect(normalizeDate('garbage')).toBeNull();
    expect(normalizeDate('')).toBeNull();
  });

  it('infers transaction type from sign and wording', () => {
    expect(normalizeType(undefined, -42000, {})).toBe('expense');
    expect(normalizeType('credit', 3500000, {})).toBe('income');
    expect(normalizeType(undefined, 3500000, { positiveIsIncome: false })).toBe('expense');
    expect(normalizeType('Refund', 50000, {})).toBe('refund');
  });

  it('rejects rows without a usable date or amount', () => {
    const drafts = validateDrafts([
      {
        sourceRow: 1,
        date: null,
        amount: null,
        type: 'expense',
        merchant: null,
        description: null,
        accountName: null,
        categoryName: null,
        reference: null,
        notes: null,
      },
    ]);
    expect(drafts[0]?.errors.length).toBeGreaterThan(0);
  });

  it('builds signed rows from drafts, honouring the type', () => {
    const rows = toTransactionRows(
      [
        {
          draft: {
            sourceRow: 1,
            date: '2026-10-04',
            amount: 42000,
            type: 'expense',
            merchant: 'Swiggy',
            description: null,
            accountName: null,
            categoryName: 'Delivery',
            reference: null,
            notes: null,
          },
          fingerprint: 'abc',
        },
        {
          draft: {
            sourceRow: 2,
            date: '2026-10-05',
            amount: 50000,
            type: 'refund',
            merchant: 'Amazon',
            description: null,
            accountName: null,
            categoryName: null,
            reference: null,
            notes: null,
          },
          fingerprint: 'def',
        },
      ],
      { accountId: 'acc_1', categoryIdByName: new Map([['delivery', 'cat_delivery']]), defaultCategoryId: 'cat_other' },
    );

    expect(rows[0]?.amount).toBe(-42000);
    expect(rows[0]?.categoryId).toBe('cat_delivery');
    expect(rows[1]?.amount).toBe(50000);
    expect(rows[1]?.categoryId).toBe('cat_other'); // fell back to the default
  });
});

describe('import rule enrichment (§18, §21-23)', () => {
  const draft = (over: Partial<Parameters<typeof applyImportRules>[0]> = {}) => ({
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
    conditions: JSON.stringify([{ field: 'merchant', operator: 'contains', value: 'swiggy' }]),
    actions: JSON.stringify([{ type: 'set_category', value: 'cat_food' }]),
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  });

  const alias = (pattern: string, displayName: string): MerchantAlias => ({
    id: `mal_${pattern}`,
    pattern,
    displayName,
    createdAt: 0,
  });

  it('applies user rules before anything else', () => {
    const result = applyImportRules(draft(), {
      accountId: 'acc_bank',
      rules: [rule()],
      aliases: [],
      autoReview: true,
    });
    expect(result.draft.categoryId).toBe('cat_food');
    expect(result.matchedRuleIds).toEqual(['rul_1']);
    expect(result.isReviewed).toBe(false); // imports still land in review
  });

  it('canonicalises merchant aliases without touching unmatched rows', () => {
    const aliases = [alias('amzn', 'Amazon'), alias('amazon', 'Amazon')];
    const matched = applyImportRules(draft({ merchant: 'AMZN Mktp IN' }), {
      accountId: 'acc_bank',
      rules: [],
      aliases,
      autoReview: true,
    });
    expect(matched.draft.merchant).toBe('Amazon');

    const untouched = applyImportRules(draft({ merchant: 'SRI LAKSHMI STORES' }), {
      accountId: 'acc_bank',
      rules: [],
      aliases,
      autoReview: true,
    });
    expect(untouched.draft.merchant).toBe('SRI LAKSHMI STORES');
  });

  it('routes a row to another account when a rule says so', () => {
    const routed = applyImportRules(draft(), {
      accountId: 'acc_bank',
      rules: [
        rule({
          actions: JSON.stringify([
            { type: 'set_account', value: 'acc_card' },
            { type: 'mark_review', value: '' },
          ]),
        }),
      ],
      aliases: [],
      autoReview: false,
    });
    expect(routed.draft.accountId).toBe('acc_card');
    expect(routed.isReviewed).toBe(false); // mark_review wins over autoReview
  });

  it('never lets a rule create a transfer during import', () => {
    const forced = applyImportRules(draft(), {
      accountId: 'acc_bank',
      rules: [rule({ actions: JSON.stringify([{ type: 'set_type', value: 'transfer' }]) })],
      aliases: [],
      autoReview: true,
    });
    expect(forced.draft.type).toBe('expense');
  });

  it('marks rows reviewed when auto-review is disabled', () => {
    const result = applyImportRules(draft(), {
      accountId: 'acc_bank',
      rules: [],
      aliases: [],
      autoReview: false,
    });
    expect(result.isReviewed).toBe(true);
  });

  it('enriches whole batches idempotently', () => {
    const context = {
      accountId: 'acc_bank',
      rules: [rule()],
      aliases: [alias('swiggy', 'Swiggy')],
      autoReview: true,
    };
    const once = enrichDrafts([draft(), draft({ sourceRow: 2, merchant: 'UBER TRIP' })], context);
    const twice = enrichDrafts(once, context);
    expect(twice).toEqual(once);
    expect(once[0]?.merchant).toBe('Swiggy');
    expect(once[1]?.merchant).toBe('UBER TRIP');
  });
});

describe('date ranges (§28, §40)', () => {
  it('builds consecutive periods for comparison', () => {
    const range = getPeriodRange('30d', { anchor: new Date(2026, 9, 30) });
    const previous = previousRange(range);
    const gap = range.start.getTime() - previous.end.getTime();
    expect(Math.round(gap / 86_400_000)).toBe(1); // no overlap, no hole
    expect(toISODate(previous.end)).toBe('2026-09-30');
  });

  it('respects a custom month start day', () => {
    const range = getPeriodRange('thisMonth', { monthStartDay: 5, anchor: new Date(2026, 9, 3) });
    expect(toISODate(range.start)).toBe('2026-09-05');
    expect(toISODate(range.end)).toBe('2026-10-04');
  });

  it('picks a sensible trend granularity', () => {
    expect(pickTrendGranularity(getPeriodRange('30d', { anchor: new Date(2026, 9, 30) }))).toBe('day');
    expect(pickTrendGranularity(getPeriodRange('3m', { anchor: new Date(2026, 9, 30) }))).toBe('week');
    expect(pickTrendGranularity(getPeriodRange('1y', { anchor: new Date(2026, 9, 30) }))).toBe('month');
  });

  it('creates empty buckets so charts never skip a period', () => {
    const buckets = buildTrendBuckets(getPeriodRange('3m', { anchor: new Date(2026, 9, 30) }), 'month');
    expect(buckets.length).toBeGreaterThanOrEqual(3);
    expect(buckets[0]?.key).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('category hierarchy (§18)', () => {
  const categories = [
    { id: 'food', name: 'Food & Dining', parentId: null },
    { id: 'restaurants', name: 'Restaurants', parentId: 'food' },
    { id: 'delivery', name: 'Delivery', parentId: 'food' },
    { id: 'transport', name: 'Transport', parentId: null },
  ] as unknown as Category[];

  it('nests children under their parents', () => {
    const tree = buildCategoryTree(categories);
    expect(tree).toHaveLength(2);
    expect(tree[0]?.name).toBe('Food & Dining');
    expect(tree[0]?.children.map((child) => child.name)).toEqual(['Restaurants', 'Delivery']);
  });
});

describe('material palette generator', () => {
  it('produces a full role set for both modes', () => {
    const light = generateMaterialPalette('#5B5FEF', 'light');
    const dark = generateMaterialPalette('#5B5FEF', 'dark');
    for (const palette of [light, dark]) {
      expect(palette.primary).toMatch(/^#[0-9A-F]{6}$/);
      expect(palette.surface).toMatch(/^#[0-9A-F]{6}$/);
      expect(Object.keys(palette)).toHaveLength(24);
    }
  });

  it('is deterministic', () => {
    expect(generateMaterialPalette('#FF9F0A', 'dark')).toEqual(generateMaterialPalette('#FF9F0A', 'dark'));
  });

  it('keeps dark surfaces dark and light surfaces light', () => {
    const dark = generateMaterialPalette('#42D392', 'dark');
    const light = generateMaterialPalette('#42D392', 'light');
    expect(hexToHsl(dark.surface).l).toBeLessThan(25);
    expect(hexToHsl(light.surface).l).toBeGreaterThan(90);
  });

  it('maps tonal roles onto Wallnut tokens without touching money colours', () => {
    const colors = buildThemeColors({ mode: 'dark', accent: 'indigo', palette: 'material', deviceSeed: '#7C4DFF' });
    const wallnut = buildThemeColors({ mode: 'dark', accent: 'indigo', palette: 'wallnut' });
    expect(colors.accent.base).not.toBe(wallnut.accent.base);
    expect(colors.positive).toBe(wallnut.positive);
    expect(colors.negative).toBe(wallnut.negative);
    expect(colors.warning).toBe(wallnut.warning);
  });
});
