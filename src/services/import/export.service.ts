import { getSqlite } from '@/db/client';
import { USER_DATA_DELETE_ORDER, USER_DATA_TABLES } from '@/db/tables';
import { listAccounts, recalculateAllBalances } from '@/services/accounts.service';
import { notifyDbChanged } from '@/stores/db.store';
import { toCsv } from '@/utils/csv';
import { toISODate } from '@/utils/date';
import { transactionFingerprint } from '@/utils/hash';
import { formatMoney } from '@/utils/money';

/**
 * Export & backup. Everything is generated locally; nothing leaves the device
 * unless the user explicitly shares the file they just created.
 */

export interface ExportOptions {
  from?: string;
  to?: string;
  accountIds?: string[];
  includeTransfers?: boolean;
  formatCurrency?: string;
}

interface ExportRow {
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

export async function buildTransactionExportRows(options: ExportOptions = {}): Promise<ExportRow[]> {
  const sqlite = getSqlite();
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (options.from) {
    clauses.push('t.date >= ?');
    params.push(options.from);
  }
  if (options.to) {
    clauses.push('t.date <= ?');
    params.push(options.to);
  }
  if (options.accountIds && options.accountIds.length > 0) {
    clauses.push(`(t.account_id IN (${options.accountIds.map(() => '?').join(',')}) OR t.transfer_account_id IN (${options.accountIds.map(() => '?').join(',')}))`);
    params.push(...options.accountIds, ...options.accountIds);
  }
  if (options.includeTransfers === false) clauses.push('t.is_transfer = 0');

  return sqlite.getAllAsync<ExportRow>(
    `SELECT t.id, t.date, t.type, t.amount,
            a.name AS accountName,
            ta.name AS transferAccountName,
            c.name AS categoryName,
            t.merchant, t.description, t.notes, t.reference,
            t.is_recurring AS isRecurring,
            (SELECT group_concat(tg.name, '|') FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.transaction_id = t.id) AS tags,
            a.currency AS currency
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
     LEFT JOIN accounts ta ON ta.id = t.transfer_account_id
     LEFT JOIN categories c ON c.id = t.category_id
     ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY t.date ASC, t.created_at ASC`,
    params,
  );
}

export async function exportTransactionsCsv(options: ExportOptions = {}): Promise<string> {
  const rows = await buildTransactionExportRows(options);
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
    (row.amount / 100).toFixed(2),
    row.currency,
    row.accountName,
    row.transferAccountName ?? '',
    row.categoryName ?? '',
    row.merchant ?? '',
    row.description ?? '',
    row.notes ?? '',
    row.reference ?? '',
    row.isRecurring ? 'yes' : 'no',
    row.tags ?? '',
  ]);
  return toCsv(headers, data);
}

export interface BackupFile {
  app: 'wallnut';
  version: 1 | 2;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

/**
 * Every table that carries user data, in dependency-safe insert order.
 * `ai_cache` is derived, machine-specific and deliberately excluded.
 *
 * v1 backups only contained a subset — restore handles both.
 */
const BACKUP_TABLES = USER_DATA_TABLES;

/** Reverse dependency order for wiping before a replace-restore. */
const BACKUP_DELETE_ORDER = USER_DATA_DELETE_ORDER;

export const BACKUP_VERSION = 2;

export async function createBackup(): Promise<BackupFile> {
  const sqlite = getSqlite();
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of BACKUP_TABLES) {
    tables[table] = await sqlite.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${table}`);
  }
  return {
    app: 'wallnut',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

export function validateBackup(json: unknown): { valid: boolean; error?: string } {
  if (!json || typeof json !== 'object') return { valid: false, error: 'Not a Wallnut backup file.' };
  const candidate = json as Partial<BackupFile>;
  if (candidate.app !== 'wallnut') return { valid: false, error: 'Not a Wallnut backup file.' };
  if (!candidate.tables || typeof candidate.tables !== 'object') return { valid: false, error: 'Backup is missing its data tables.' };
  if (!Array.isArray(candidate.tables.transactions)) return { valid: false, error: 'Backup contains no transactions.' };
  return { valid: true };
}

export interface BackupSummaryRow {
  table: string;
  label: string;
  rows: number;
}

const TABLE_LABELS: Record<string, string> = {
  users: 'Profile',
  accounts: 'Accounts',
  account_groups: 'Account groups',
  categories: 'Categories',
  transactions: 'Transactions',
  transaction_splits: 'Splits',
  tags: 'Tags',
  budgets: 'Budgets',
  recurring_transactions: 'Recurring payments',
  merchant_aliases: 'Merchant aliases',
  rules: 'Rules',
  goals: 'Goals',
  debts: 'Debts & loans',
  people: 'People',
  installments: 'Installments',
  transaction_templates: 'Templates',
  dashboard_widgets: 'Dashboard layout',
  settings: 'Settings',
  saved_reports: 'Saved reports',
  transaction_attachments: 'Receipts',
  goal_contributions: 'Goal contributions',
  debt_payments: 'Debt payments',
  transaction_tags: 'Transaction tags',
};

/** Human-readable contents so a restore can be confirmed table by table. */
export function describeBackup(backup: BackupFile): { rows: BackupSummaryRow[]; totalRows: number } {
  const rows: BackupSummaryRow[] = [];
  let totalRows = 0;
  for (const table of BACKUP_TABLES) {
    const count = backup.tables[table]?.length ?? 0;
    if (count === 0) continue;
    totalRows += count;
    rows.push({ table, label: TABLE_LABELS[table] ?? table, rows: count });
  }
  return { rows, totalRows };
}

export type RestoreMode = 'replace' | 'merge';

/**
 * Restores a backup. `replace` wipes the database first; `merge` inserts rows
 * that do not collide with existing ids. Both modes run inside a single
 * transaction, so a failed restore can never leave the database empty or half
 * written. Balances and fingerprints are always recomputed from the restored
 * ledger afterwards.
 */
export async function restoreBackup(backup: BackupFile, mode: RestoreMode): Promise<{ inserted: number }> {
  const sqlite = getSqlite();
  let inserted = 0;

  await sqlite.execAsync('BEGIN');
  try {
    if (mode === 'replace') {
      for (const table of BACKUP_DELETE_ORDER) {
        await sqlite.execAsync(`DELETE FROM ${table}`);
      }
    }

    for (const table of BACKUP_TABLES) {
      const rows = backup.tables[table];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const keys = Object.keys(row).filter((key) => row[key] !== undefined);
        if (keys.length === 0) continue;
        const placeholders = keys.map(() => '?').join(', ');
        const values = keys.map((key) => {
          const value = row[key];
          if (typeof value === 'boolean') return value ? 1 : 0;
          if (value === null) return null;
          if (typeof value === 'object') return JSON.stringify(value);
          return value as string | number;
        });
        const verb = mode === 'replace' ? 'INSERT' : 'INSERT OR IGNORE';
        const columns = keys.map((key) => `"${key.replace(/"/g, '""')}"`).join(', ');
        await sqlite.runAsync(
          `${verb} INTO ${table} (${columns}) VALUES (${placeholders})`,
          values as never,
        );
        inserted++;
      }
    }
    await sqlite.execAsync('COMMIT');
  } catch (error) {
    await sqlite.execAsync('ROLLBACK');
    throw error;
  }

  // Derived state is rebuilt from the restored ledger — never trusted from the
  // file, and always repaired for merge restores too.
  await recalculateAllBalances();
  await repairFingerprints();
  notifyDbChanged();
  return { inserted };
}

/** Simple CSV of income/expense totals per month — used by the Reports section. */
export async function exportMonthlySummaryCsv(monthStartDay = 1, currency = 'INR'): Promise<string> {
  const sqlite = getSqlite();
  const rows = await sqlite.getAllAsync<{ month: string; income: number; expenses: number; refunds: number }>(
    `SELECT substr(date, 1, 7) AS month,
            coalesce(sum(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
            coalesce(sum(CASE WHEN type = 'expense' THEN abs(amount) ELSE 0 END), 0) AS expenses,
            coalesce(sum(CASE WHEN type = 'refund' THEN abs(amount) ELSE 0 END), 0) AS refunds
     FROM transactions GROUP BY month ORDER BY month ASC`,
  );
  const headers = ['Month', 'Income', 'Expenses', 'Refunds', 'Net savings'];
  const data = rows.map((row) => {
    const net = Number(row.income) - (Number(row.expenses) - Number(row.refunds));
    return [
      row.month,
      formatMoney(Number(row.income), { currency, showSymbol: false }),
      formatMoney(Number(row.expenses), { currency, showSymbol: false }),
      formatMoney(Number(row.refunds), { currency, showSymbol: false }),
      formatMoney(net, { currency, showSymbol: false }),
    ];
  });
  return toCsv(headers, data);
}

/** Fills in fingerprints for restored rows that lack them. */
export async function repairFingerprints(): Promise<void> {
  const sqlite = getSqlite();
  const missing = await sqlite.getAllAsync<{
    id: string;
    date: string;
    amount: number;
    merchant: string | null;
    account_id: string;
    reference: string | null;
    description: string | null;
  }>(
    `SELECT id, date, amount, merchant, account_id, reference, description
     FROM transactions WHERE fingerprint IS NULL OR fingerprint = ''`,
  );
  for (const row of missing) {
    const fingerprint = transactionFingerprint({
      date: row.date,
      amount: Number(row.amount),
      merchant: row.merchant,
      accountId: row.account_id,
      reference: row.reference,
      description: row.description,
    });
    await sqlite.runAsync('UPDATE transactions SET fingerprint = ? WHERE id = ?', [fingerprint, row.id]);
  }
}

export async function exportFilename(prefix: string, extension: string): Promise<string> {
  return `${prefix}-${toISODate(new Date())}.${extension}`;
}
