import { sanitizeSpreadsheetCell, toCsv } from '@/utils/csv';
import { currencyInfo } from '@/utils/money';

/**
 * Pure export serialisers. Keeping these free of SQLite means the exact bytes
 * handed to the user can be unit-tested without a database or a device.
 */

export interface ExportRow {
  id: string;
  date: string;
  type: string;
  amount: number;
  accountName: string;
  transferAccountName: string | null;
  categoryName: string | null;
  merchant: string | null;
  description: string | null;
  notes: string | null;
  reference: string | null;
  isRecurring: number;
  tags: string | null;
  currency: string;
}

export interface ExportSplit {
  category: string | null;
  amountMinor: number;
}

export interface ExportTransaction extends ExportRow {
  tagsList: string[];
  splits: ExportSplit[];
}

export interface ExportFilterSummary {
  from: string | null;
  to: string | null;
  includeTransfers: boolean;
}

export interface ExportDataset {
  app: 'wallnut';
  kind: 'transactions';
  version: 1;
  exportedAt: string;
  filters: ExportFilterSummary;
  count: number;
  note: string;
  transactions: ExportTransaction[];
}

/** Explicit decimal amount — never grouped, so a spreadsheet parses it as a number. */
export function exportAmount(amountMinor: number, currency: string): string {
  const decimals = currencyInfo(currency).decimals;
  return (amountMinor / 10 ** decimals).toFixed(decimals);
}

/**
 * CSV column contract (stable order):
 * Date, Type, Amount, Currency, Account, Transfer Account, Category, Merchant,
 * Description, Notes, Reference, Recurring, Tags.
 *
 * Amount is signed from the account's perspective and uses the currency's own
 * decimal exponent. Every user-entered field is formula-escaped. The file is
 * UTF-8 with a BOM so Excel renders the currency and non-ASCII text correctly.
 */
export function transactionRowsToCsv(rows: ExportRow[]): string {
  const headers = [
    'Date',
    'Type',
    'Amount',
    'Currency',
    'Account',
    'Transfer Account',
    'Category',
    'Merchant',
    'Description',
    'Notes',
    'Reference',
    'Recurring',
    'Tags',
  ];
  const data = rows.map((row) => [
    row.date,
    row.type,
    exportAmount(row.amount, row.currency),
    row.currency,
    sanitizeSpreadsheetCell(row.accountName),
    sanitizeSpreadsheetCell(row.transferAccountName),
    sanitizeSpreadsheetCell(row.categoryName),
    sanitizeSpreadsheetCell(row.merchant),
    sanitizeSpreadsheetCell(row.description),
    sanitizeSpreadsheetCell(row.notes),
    sanitizeSpreadsheetCell(row.reference),
    row.isRecurring ? 'yes' : 'no',
    sanitizeSpreadsheetCell(row.tags),
  ]);
  return `\uFEFF${toCsv(headers, data)}`;
}

/**
 * Report-oriented JSON export (not a restore backup). Amounts are integer minor
 * units, with `currency` explaining the exponent. Splits are included so
 * category totals can be reproduced from the file.
 */
export function buildTransactionExportDataset(
  rows: ExportRow[],
  splits: Map<string, ExportSplit[]>,
  filters: ExportFilterSummary,
  exportedAt = new Date().toISOString(),
): ExportDataset {
  return {
    app: 'wallnut',
    kind: 'transactions',
    version: 1,
    exportedAt,
    filters,
    count: rows.length,
    note: 'Amounts are signed integer minor units from the account perspective. Transfers are not spending.',
    transactions: rows.map((row) => ({
      ...row,
      tagsList: row.tags ? row.tags.split('|').filter(Boolean) : [],
      splits: splits.get(row.id) ?? [],
    })),
  };
}
