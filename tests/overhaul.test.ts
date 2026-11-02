import { describe, expect, it } from 'vitest';

import { evaluateCalculator, formatCalculatorAmount } from '@/utils/calculator';
import { buildTransactionExportDataset, transactionRowsToCsv, type ExportRow } from '@/utils/export-format';
import { sanitizeSpreadsheetCell } from '@/utils/csv';

const baseRow: ExportRow = {
  id: 'txn_1',
  date: '2026-10-31',
  type: 'expense',
  amount: -12345,
  accountName: 'HDFC Bank',
  transferAccountName: null,
  categoryName: 'Food & Dining',
  merchant: 'Swiggy',
  description: 'Dinner, with friends',
  notes: 'Paid by card',
  reference: null,
  isRecurring: 0,
  tags: 'friends|dinner',
  currency: 'INR',
};

describe('amount calculator', () => {
  it('respects precedence and parentheses', () => {
    expect(evaluateCalculator('2 + 3 × 4')).toEqual({ ok: true, value: 14 });
    expect(evaluateCalculator('(2 + 3) × 4')).toEqual({ ok: true, value: 20 });
    expect(evaluateCalculator('450 + 120 / 2')).toEqual({ ok: true, value: 510 });
  });

  it('handles unary minus and nested negative factors', () => {
    expect(evaluateCalculator('-5 + 2')).toEqual({ ok: true, value: -3 });
    expect(evaluateCalculator('5 × -2')).toEqual({ ok: true, value: -10 });
    expect(evaluateCalculator('-(5 + 2)')).toEqual({ ok: true, value: -7 });
  });

  it('rounds to paise and rejects unsafe input', () => {
    expect(evaluateCalculator('10 / 4')).toEqual({ ok: true, value: 2.5 });
    expect(evaluateCalculator('1 / 3').value).toBe(0.33);
    expect(evaluateCalculator('10 / 0').ok).toBe(false);
    expect(evaluateCalculator('2 +').ok).toBe(false);
    expect(evaluateCalculator('alert(1)').ok).toBe(false);
    expect(evaluateCalculator('(2 + 3').ok).toBe(false);
    expect(formatCalculatorAmount(1250.5)).toBe('1250.5');
    expect(formatCalculatorAmount(0.335)).toBe('0.34');
  });
});

describe('export serialisation', () => {
  it('writes a UTF-8 BOM, stable headers and signed decimal amounts', () => {
    const csv = transactionRowsToCsv([baseRow]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.replace(/^\uFEFF/, '').split('\n');
    expect(lines[0]).toBe('Date,Type,Amount,Currency,Account,Transfer Account,Category,Merchant,Description,Notes,Reference,Recurring,Tags');
    expect(lines[1]).toContain('2026-10-31,expense,-123.45,INR,HDFC Bank');
    expect(lines[1]).toContain('"Dinner, with friends"');
    expect(lines[1]).toContain('friends|dinner');
  });

  it('escapes spreadsheet formulas without breaking numeric amounts', () => {
    const csv = transactionRowsToCsv([
      { ...baseRow, merchant: '=HYPERLINK("http://evil")', description: '+SUM(A1:A2)', notes: '@cmd' },
    ]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+SUM(A1:A2)");
    expect(csv).toContain("'@cmd");
    // The amount column stays a parseable signed number.
    expect(csv).toContain(',-123.45,');
    expect(sanitizeSpreadsheetCell('normal text')).toBe('normal text');
    expect(sanitizeSpreadsheetCell('-12.50')).toBe("'-12.50");
  });

  it('builds a parseable, versioned JSON report with splits and tags', () => {
    const dataset = buildTransactionExportDataset(
      [baseRow],
      new Map([[baseRow.id, [{ category: 'Food & Dining', amountMinor: -12345 }]]]),
      { from: '2026-10-01', to: '2026-10-31', includeTransfers: true },
      '2026-11-01T00:00:00.000Z',
    );
    const parsed = JSON.parse(JSON.stringify(dataset));
    expect(parsed.app).toBe('wallnut');
    expect(parsed.kind).toBe('transactions');
    expect(parsed.version).toBe(1);
    expect(parsed.count).toBe(1);
    expect(parsed.transactions[0].amount).toBe(-12345);
    expect(parsed.transactions[0].tagsList).toEqual(['friends', 'dinner']);
    expect(parsed.transactions[0].splits[0]).toEqual({ category: 'Food & Dining', amountMinor: -12345 });
  });

  it('does not truncate large exports when serialising rows', () => {
    const rows = Array.from({ length: 1500 }, (_, index) => ({ ...baseRow, id: `txn_${index}` }));
    const csv = transactionRowsToCsv(rows);
    const lines = csv.replace(/^\uFEFF/, '').split('\n');
    expect(lines).toHaveLength(1501);
  });
});
