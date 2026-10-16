import { and, asc, eq, or, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import {
  accountGroups,
  accounts,
  debts,
  goals,
  installments,
  recurringTransactions,
  transactionTemplates,
  transactions,
  type Account,
  type AccountGroup,
  type AccountType,
  type InvestmentType,
} from '@/db/schema';
import { notifyDbChanged } from '@/stores/db.store';
import { getNetWorthBreakdown } from '@/services/net-worth.service';
import { addDays, addMonths, toISODate } from '@/utils/date';
import { createId } from '@/utils/id';

export interface AccountInput {
  name: string;
  type: AccountType;
  currency?: string;
  initialBalance: number; // minor units
  icon?: string | null;
  color?: string | null;
  institution?: string | null;
  notes?: string | null;
  groupId?: string | null;
  includeInNetWorth?: boolean;
  includeInTotalBalance?: boolean;
  includeInCashFlow?: boolean;
  visibleOnDashboard?: boolean;
  hiddenFromTransactionCreation?: boolean;
  creditLimit?: number | null;
  statementDay?: number | null;
  paymentDueDay?: number | null;
  minimumPayment?: number | null;
  interestRate?: number | null;
  investmentType?: InvestmentType | null;
  costBasis?: number | null;
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: 'Cash',
  bank: 'Bank account',
  wallet: 'Wallet',
  credit_card: 'Credit card',
  savings: 'Savings',
  investment: 'Investment',
  loan: 'Loan',
  mortgage: 'Mortgage',
  insurance: 'Insurance',
  other: 'Other',
};

/** Types that carry a negative balance the user owes. */
const LIABILITY_TYPES: AccountType[] = ['credit_card', 'loan', 'mortgage'];

export function isLiability(type: AccountType): boolean {
  return LIABILITY_TYPES.includes(type);
}

export function isInvestment(type: AccountType): boolean {
  return type === 'investment';
}

/**
 * Money available for day-to-day spending: not a liability, not an investment
 * and not tied up in insurance. `other` is included because existing installs
 * may use it for money-like accounts.
 */
export function isSpendable(type: AccountType): boolean {
  return !isLiability(type) && !isInvestment(type) && type !== 'insurance';
}

/** Types where "outstanding balance" means money owed (credit report). */
export function isCreditLike(type: AccountType): boolean {
  return type === 'credit_card' || type === 'loan' || type === 'mortgage';
}

/* ------------------------------ Account groups ------------------------------ */

export interface AccountGroupInput {
  name: string;
  icon?: string;
  color?: string;
}

export async function listAccountGroups(includeHidden = true): Promise<AccountGroup[]> {
  const db = getDb();
  return db
    .select()
    .from(accountGroups)
    .where(includeHidden ? undefined : eq(accountGroups.isHidden, false))
    .orderBy(asc(accountGroups.sortOrder), asc(accountGroups.createdAt));
}

export async function createAccountGroup(input: AccountGroupInput): Promise<AccountGroup> {
  const db = getDb();
  const name = input.name.trim();
  if (!name) throw new Error('Group name is required.');
  const [max] = await db.select({ value: sql<number>`coalesce(max(${accountGroups.sortOrder}), 0)` }).from(accountGroups);
  const now = Date.now();
  const row: AccountGroup = {
    id: createId('agr'),
    name,
    icon: input.icon ?? 'wallet-outline',
    color: input.color ?? '#8B8CFF',
    sortOrder: Number(max?.value ?? 0) + 1,
    isCollapsed: false,
    isHidden: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(accountGroups).values(row);
  notifyDbChanged();
  return row;
}

export async function updateAccountGroup(
  id: string,
  patch: Partial<AccountGroupInput> & { isCollapsed?: boolean; isHidden?: boolean; sortOrder?: number },
): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(accountGroups).where(eq(accountGroups.id, id)).limit(1);
  const current = rows[0];
  if (!current) throw new Error('Group not found.');
  await db
    .update(accountGroups)
    .set({
      name: patch.name?.trim() ?? current.name,
      icon: patch.icon ?? current.icon,
      color: patch.color ?? current.color,
      isCollapsed: patch.isCollapsed ?? current.isCollapsed,
      isHidden: patch.isHidden ?? current.isHidden,
      sortOrder: patch.sortOrder ?? current.sortOrder,
      updatedAt: Date.now(),
    })
    .where(eq(accountGroups.id, id));
  notifyDbChanged();
}

/** Deleting a group keeps its accounts (they become ungrouped). */
export async function deleteAccountGroup(id: string): Promise<void> {
  const db = getDb();
  await db.update(accounts).set({ groupId: null, updatedAt: Date.now() }).where(eq(accounts.groupId, id));
  await db.delete(accountGroups).where(eq(accountGroups.id, id));
  notifyDbChanged();
}

export async function moveAccountToGroup(accountId: string, groupId: string | null): Promise<void> {
  const db = getDb();
  await db.update(accounts).set({ groupId, updatedAt: Date.now() }).where(eq(accounts.id, accountId));
  notifyDbChanged();
}

/* --------------------------------- Accounts --------------------------------- */

export async function listAccounts(options: { includeArchived?: boolean } = {}): Promise<Account[]> {
  const db = getDb();
  return db
    .select()
    .from(accounts)
    .where(options.includeArchived ? undefined : eq(accounts.isArchived, false))
    .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt));
}

/** Accounts selectable when creating a transaction. */
export async function listSelectableAccounts(): Promise<Account[]> {
  const all = await listAccounts();
  return all.filter((account) => !account.hiddenFromTransactionCreation || account.currentBalance !== 0);
}

export async function getAccount(id: string): Promise<Account | null> {
  const db = getDb();
  const rows = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createAccount(input: AccountInput): Promise<Account> {
  const db = getDb();
  const name = input.name.trim();
  if (!name) throw new Error('Account name is required.');
  if (input.type === 'credit_card' && input.creditLimit != null && input.creditLimit < 0) {
    throw new Error('Credit limit cannot be negative.');
  }

  const now = Date.now();
  const existing = await db.select({ count: sql<number>`count(*)` }).from(accounts);
  const account: Account = {
    id: createId('acc'),
    name,
    type: input.type,
    currency: input.currency ?? 'INR',
    initialBalance: Math.round(input.initialBalance),
    currentBalance: Math.round(input.initialBalance),
    icon: input.icon ?? null,
    color: input.color ?? null,
    institution: input.institution ?? null,
    notes: input.notes ?? null,
    groupId: input.groupId ?? null,
    sortOrder: Number(existing[0]?.count ?? 0),
    isArchived: false,
    includeInNetWorth: input.includeInNetWorth ?? true,
    includeInTotalBalance: input.includeInTotalBalance ?? true,
    includeInCashFlow: input.includeInCashFlow ?? true,
    visibleOnDashboard: input.visibleOnDashboard ?? true,
    hiddenFromTransactionCreation: input.hiddenFromTransactionCreation ?? false,
    creditLimit: input.creditLimit ?? null,
    statementDay: input.statementDay ?? null,
    paymentDueDay: input.paymentDueDay ?? null,
    minimumPayment: input.minimumPayment ?? null,
    interestRate: input.interestRate ?? null,
    investmentType: input.investmentType ?? null,
    costBasis: input.costBasis ?? null,
    lastValuationDate: input.investmentType ? toISODate(new Date(now)) : null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(accounts).values(account);
  notifyDbChanged();
  return account;
}

export async function updateAccount(
  id: string,
  patch: Partial<Omit<AccountInput, 'initialBalance'>> & { isArchived?: boolean; costBasis?: number | null },
): Promise<void> {
  const db = getDb();
  const current = await getAccount(id);
  if (!current) throw new Error('Account not found.');

  const pick = <T,>(next: T | undefined, fallback: T): T => (next === undefined ? fallback : next);

  await db
    .update(accounts)
    .set({
      name: patch.name?.trim() ?? current.name,
      type: patch.type ?? current.type,
      currency: patch.currency ?? current.currency,
      icon: pick(patch.icon, current.icon),
      color: pick(patch.color, current.color),
      institution: pick(patch.institution, current.institution),
      notes: pick(patch.notes, current.notes),
      groupId: pick(patch.groupId, current.groupId),
      includeInNetWorth: patch.includeInNetWorth ?? current.includeInNetWorth,
      includeInTotalBalance: patch.includeInTotalBalance ?? current.includeInTotalBalance,
      includeInCashFlow: patch.includeInCashFlow ?? current.includeInCashFlow,
      visibleOnDashboard: patch.visibleOnDashboard ?? current.visibleOnDashboard,
      hiddenFromTransactionCreation: patch.hiddenFromTransactionCreation ?? current.hiddenFromTransactionCreation,
      creditLimit: pick(patch.creditLimit, current.creditLimit),
      statementDay: pick(patch.statementDay, current.statementDay),
      paymentDueDay: pick(patch.paymentDueDay, current.paymentDueDay),
      minimumPayment: pick(patch.minimumPayment, current.minimumPayment),
      interestRate: pick(patch.interestRate, current.interestRate),
      investmentType: pick(patch.investmentType, current.investmentType),
      costBasis: pick(patch.costBasis, current.costBasis),
      isArchived: patch.isArchived ?? current.isArchived,
      updatedAt: Date.now(),
    })
    .where(eq(accounts.id, id));
  notifyDbChanged();
}

export async function deleteAccount(id: string): Promise<void> {
  const db = getDb();
  // Both legs of a transfer reference the account: the source via account_id
  // and the destination via transfer_account_id. Deleting an account that
  // receives transfers would silently orphan the mirrored leg, so both count.
  const [owned] = await db
    .select({ value: sql<number>`count(*)` })
    .from(transactions)
    .where(eq(transactions.accountId, id));
  const [incoming] = await db
    .select({ value: sql<number>`count(*)` })
    .from(transactions)
    .where(and(eq(transactions.isTransfer, true), eq(transactions.transferAccountId, id)));
  const [linkedDebts] = await db.select({ value: sql<number>`count(*)` }).from(debts).where(eq(debts.accountId, id));
  const [linkedInstallments] = await db
    .select({ value: sql<number>`count(*)` })
    .from(installments)
    .where(eq(installments.accountId, id));
  const [linkedRecurring] = await db
    .select({ value: sql<number>`count(*)` })
    .from(recurringTransactions)
    .where(or(eq(recurringTransactions.accountId, id), eq(recurringTransactions.transferAccountId, id)));
  const [linkedGoals] = await db.select({ value: sql<number>`count(*)` }).from(goals).where(eq(goals.linkedAccountId, id));

  const blockers: string[] = [];
  if (Number(owned?.value ?? 0) > 0 || Number(incoming?.value ?? 0) > 0) blockers.push('transactions');
  if (Number(linkedDebts?.value ?? 0) > 0) blockers.push('money owed');
  if (Number(linkedInstallments?.value ?? 0) > 0) blockers.push('installment plans');
  if (Number(linkedRecurring?.value ?? 0) > 0) blockers.push('recurring payments');
  if (Number(linkedGoals?.value ?? 0) > 0) blockers.push('goals');
  if (blockers.length > 0) {
    throw new Error(`This account is used by ${blockers.join(', ')}. Archive it instead, or move those records to another account first.`);
  }

  // Templates are conveniences, not records — clear their optional references.
  await db
    .update(transactionTemplates)
    .set({ accountId: null, transferAccountId: null, updatedAt: Date.now() })
    .where(or(eq(transactionTemplates.accountId, id), eq(transactionTemplates.transferAccountId, id)));
  await db.delete(accounts).where(eq(accounts.id, id));
  notifyDbChanged();
}

/* ----------------------------- Balance handling ----------------------------- */

/**
 * Recomputes the balance from the ledger: initial + own transactions +
 * incoming transfer legs. Used after imports, restores and to heal drift.
 */
export async function recalculateAccountBalance(accountId: string): Promise<number> {
  const db = getDb();
  const account = await getAccount(accountId);
  if (!account) return 0;

  const [mine] = await db
    .select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(eq(transactions.accountId, accountId));

  const [incoming] = await db
    .select({ total: sql<number>`coalesce(sum(-${transactions.amount}), 0)` })
    .from(transactions)
    .where(and(eq(transactions.isTransfer, true), eq(transactions.transferAccountId, accountId)));

  const balance = Math.round(account.initialBalance + (mine?.total ?? 0) + (incoming?.total ?? 0));
  if (balance !== account.currentBalance) {
    await db.update(accounts).set({ currentBalance: balance, updatedAt: Date.now() }).where(eq(accounts.id, accountId));
  }
  return balance;
}

export async function recalculateAllBalances(): Promise<void> {
  const all = await listAccounts({ includeArchived: true });
  for (const account of all) {
    await recalculateAccountBalance(account.id);
  }
  notifyDbChanged();
}

/* ------------------------------- Aggregation -------------------------------- */

export interface AccountGroupSummary {
  group: AccountGroup | null;
  accounts: Account[];
  assetsTotal: number;
  liabilitiesTotal: number;
  total: number;
}

export interface AccountGroupsSummary {
  groups: AccountGroupSummary[];
  ungrouped: AccountGroupSummary | null;
  assetsTotal: number;
  liabilitiesTotal: number;
  netWorth: number;
  /** Money owed to you (open receivables), already inside assetsTotal. */
  receivables: number;
  /** Money you owe (open payables), already inside liabilitiesTotal. */
  payables: number;
  /** Balances used day-to-day (cash, bank, savings, cards) — excludes investments. */
  liquidTotal: number;
}

/**
 * Net worth uses `includeInNetWorth`; day-to-day totals use
 * `includeInTotalBalance`; investment accounts are reported separately so they
 * can count toward wealth without inflating spendable cash.
 */
export async function getAccountGroupsSummary(): Promise<AccountGroupsSummary> {
  const [all, groups] = await Promise.all([listAccounts(), listAccountGroups(false)]);
  const byGroup = new Map<string | null, Account[]>();
  for (const account of all) {
    const key = account.groupId ?? null;
    const bucket = byGroup.get(key) ?? [];
    bucket.push(account);
    byGroup.set(key, bucket);
  }

  const summarize = (group: AccountGroup | null, list: Account[]): AccountGroupSummary => {
    let assetsTotal = 0;
    let liabilitiesTotal = 0;
    for (const account of list) {
      if (isLiability(account.type)) liabilitiesTotal += account.currentBalance;
      else assetsTotal += account.currentBalance;
    }
    return { group, accounts: list, assetsTotal, liabilitiesTotal, total: assetsTotal + liabilitiesTotal };
  };

  const summaries = groups.map((group) => summarize(group, byGroup.get(group.id) ?? []));
  const ungroupedList = byGroup.get(null) ?? [];
  const ungrouped = ungroupedList.length > 0 ? summarize(null, ungroupedList) : null;

  let liquidTotal = 0;
  for (const account of all) {
    if (account.includeInTotalBalance && !isInvestment(account.type) && !isLiability(account.type)) {
      liquidTotal += account.currentBalance;
    }
  }

  // Net worth comes from the canonical engine so this screen and the dashboard
  // can never disagree: includeInNetWorth is respected and money owed is
  // included as an asset/liability (the other half of the lending ledger).
  const breakdown = await getNetWorthBreakdown();

  return {
    groups: summaries,
    ungrouped,
    assetsTotal: breakdown.assets,
    liabilitiesTotal: breakdown.liabilities,
    netWorth: breakdown.netWorth,
    receivables: breakdown.receivables,
    payables: breakdown.payables,
    liquidTotal,
  };
}

export async function totalBalance(): Promise<number> {
  const summary = await getAccountGroupsSummary();
  return summary.liquidTotal;
}

/* ------------------------------- Credit cards ------------------------------- */

export interface CreditCardInfo {
  account: Account;
  outstanding: number;
  available: number | null;
  utilizationPercent: number | null;
  statementDate: Date | null;
  dueDate: Date | null;
  expectedPayment: number;
  minimumPayment: number | null;
  cycleStart: Date | null;
  cycleEnd: Date | null;
  currentCycleSpend: number;
  previousCycleSpend: number;
}

function nextDayOfMonth(day: number, from = new Date()): Date {
  const candidate = new Date(from.getFullYear(), from.getMonth(), Math.min(day, 28));
  if (candidate >= from) return candidate;
  return new Date(from.getFullYear(), from.getMonth() + 1, Math.min(day, 28));
}

export async function getCreditCardInfo(accountId: string): Promise<CreditCardInfo | null> {
  const db = getDb();
  const account = await getAccount(accountId);
  if (!account) return null;

  const outstanding = account.currentBalance < 0 ? -account.currentBalance : 0;
  const limit = account.creditLimit ?? null;
  const available = limit != null ? limit - outstanding : null;
  const utilizationPercent = limit && limit > 0 ? (outstanding / limit) * 100 : null;

  const now = new Date();
  const statementDate = account.statementDay ? nextDayOfMonth(account.statementDay, now) : null;
  const dueDate = account.paymentDueDay ? nextDayOfMonth(account.paymentDueDay, now) : null;

  // Current billing cycle spending (statement day → today), previous cycle for context.
  let cycleStart: Date | null = null;
  let cycleEnd: Date | null = null;
  let currentCycleSpend = 0;
  let previousCycleSpend = 0;
  if (account.statementDay) {
    const day = Math.min(account.statementDay, 28);
    const start = new Date(now.getFullYear(), now.getMonth(), day);
    cycleStart = start <= now ? start : new Date(now.getFullYear(), now.getMonth() - 1, day);
    cycleEnd = addDays(addMonths(cycleStart, 1), -1);
    const prevStart = addMonths(cycleStart, -1);
    const prevEnd = addDays(cycleStart, -1);

    const spendFor = async (from: Date, to: Date) => {
      const row = await db
        .select({ total: sql<number>`coalesce(sum(abs(${transactions.amount})), 0)` })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, accountId),
            eq(transactions.type, 'expense'),
            sql`${transactions.date} >= ${toISODate(from)}`,
            sql`${transactions.date} <= ${toISODate(to)}`,
          ),
        );
      return Number(row[0]?.total ?? 0);
    };
    currentCycleSpend = await spendFor(cycleStart, now);
    previousCycleSpend = await spendFor(prevStart, prevEnd);
  }

  return {
    account,
    outstanding,
    available,
    utilizationPercent,
    statementDate,
    dueDate,
    expectedPayment: outstanding,
    minimumPayment: account.minimumPayment,
    cycleStart,
    cycleEnd,
    currentCycleSpend,
    previousCycleSpend,
  };
}

/* ------------------------------- Investments -------------------------------- */

export interface InvestmentSummary {
  accountId: string;
  name: string;
  investmentType: InvestmentType | null;
  value: number;
  invested: number;
  gain: number;
  gainPercent: number | null;
  lastValuationDate: string | null;
}

export function investmentSummary(account: Account): InvestmentSummary {
  const value = account.currentBalance;
  const invested = account.costBasis ?? account.initialBalance;
  const gain = value - invested;
  return {
    accountId: account.id,
    name: account.name,
    investmentType: account.investmentType ?? null,
    value,
    invested,
    gain,
    gainPercent: invested > 0 ? (gain / invested) * 100 : null,
    lastValuationDate: account.lastValuationDate ?? null,
  };
}

/**
 * Manual valuation update: writes the delta as an `adjustment` transaction so
 * history stays auditable and balances stay derived from the ledger.
 */
export async function updateInvestmentValue(accountId: string, newValue: number, note = 'Manual valuation'): Promise<void> {
  const db = getDb();
  const account = await getAccount(accountId);
  if (!account) throw new Error('Account not found.');
  const delta = Math.round(newValue) - account.currentBalance;
  const now = Date.now();
  if (delta !== 0) {
    await db.transaction(async (tx) => {
      const id = createId('txn');
      await tx.insert(transactions).values({
        id,
        accountId,
        categoryId: null,
        amount: delta,
        type: 'adjustment',
        merchant: null,
        description: note,
        date: toISODate(new Date(now)),
        notes: null,
        reference: null,
        isTransfer: false,
        transferAccountId: null,
        isRecurring: false,
        recurringId: null,
        installmentId: null,
        fingerprint: null,
        isReviewed: true,
        createdAt: now,
        updatedAt: now,
      });
      await tx
        .update(accounts)
        .set({ currentBalance: Math.round(newValue), lastValuationDate: toISODate(new Date(now)), updatedAt: now })
        .where(eq(accounts.id, accountId));
    });
  } else {
    await db.update(accounts).set({ lastValuationDate: toISODate(new Date(now)), updatedAt: now }).where(eq(accounts.id, accountId));
  }
  notifyDbChanged();
}

export async function listInvestmentAccounts(): Promise<Account[]> {
  const all = await listAccounts();
  return all.filter((account) => isInvestment(account.type));
}

export function investmentTypeLabel(type: InvestmentType | null): string {
  const labels: Record<InvestmentType, string> = {
    stocks: 'Stocks',
    mutual_funds: 'Mutual funds',
    etf: 'ETF',
    crypto: 'Crypto',
    fd: 'Fixed deposit',
    gold: 'Gold',
    other: 'Other',
  };
  return type ? labels[type] : 'Investment';
}

/* ---------------------------- Adjustment / reconcile ------------------------- */

export interface AdjustmentInput {
  accountId: string;
  /** The balance the account should actually have (minor units). */
  actualBalance: number;
  reason?: string;
  date?: string;
}

/**
 * Balance adjustment. Never mutates `current_balance` directly — creates an
 * `adjustment` transaction (excluded from income/expense analytics) so the
 * correction is visible, auditable, and reversible.
 */
export async function adjustBalance(input: AdjustmentInput): Promise<{ delta: number; transactionId: string | null }> {
  const db = getDb();
  const account = await getAccount(input.accountId);
  if (!account) throw new Error('Account not found.');

  const delta = Math.round(input.actualBalance) - account.currentBalance;
  if (delta === 0) return { delta: 0, transactionId: null };

  const now = Date.now();
  const id = createId('txn');
  await db.transaction(async (tx) => {
    await tx.insert(transactions).values({
      id,
      accountId: input.accountId,
      categoryId: null,
      amount: delta,
      type: 'adjustment',
      merchant: null,
      description: input.reason?.trim() || 'Balance adjustment',
      date: input.date ?? toISODate(new Date(now)),
      notes: null,
      reference: null,
      isTransfer: false,
      transferAccountId: null,
      isRecurring: false,
      recurringId: null,
      installmentId: null,
      fingerprint: null,
      isReviewed: true,
      createdAt: now,
      updatedAt: now,
    });
    await tx
      .update(accounts)
      .set({ currentBalance: Math.round(input.actualBalance), updatedAt: now })
      .where(eq(accounts.id, input.accountId));
  });
  notifyDbChanged();
  return { delta, transactionId: id };
}

export interface ReconcileCandidate {
  id: string;
  date: string;
  merchant: string | null;
  description: string | null;
  amount: number;
  type: string;
  categoryName: string | null;
}

export interface ReconcileInfo {
  account: Account;
  appBalance: number;
  actualBalance: number | null;
  difference: number | null;
  recentTransactions: ReconcileCandidate[];
  largeGaps: ReconcileCandidate[];
}

/** Data for the reconcile screen: recent activity plus unusually large items. */
export async function getReconcileInfo(accountId: string, actualBalance: number | null): Promise<ReconcileInfo | null> {
  const db = getDb();
  const account = await getAccount(accountId);
  if (!account) return null;

  const recent = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      merchant: transactions.merchant,
      description: transactions.description,
      amount: transactions.amount,
      type: transactions.type,
    })
    .from(transactions)
    .where(eq(transactions.accountId, accountId))
    .orderBy(asc(transactions.date))
    .limit(400);

  const candidates: ReconcileCandidate[] = recent.map((row) => ({
    id: row.id,
    date: row.date,
    merchant: row.merchant,
    description: row.description,
    amount: row.amount,
    type: row.type,
    categoryName: null,
  }));

  const sorted = [...candidates].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  const byAmount = [...candidates].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 5);

  return {
    account,
    appBalance: account.currentBalance,
    actualBalance,
    difference: actualBalance == null ? null : Math.round(actualBalance) - account.currentBalance,
    recentTransactions: sorted,
    largeGaps: byAmount,
  };
}

export async function accountTransactionCounts(accountId: string): Promise<{ count: number; min: string | null; max: string | null }> {
  const db = getDb();
  const [row] = await db
    .select({
      count: sql<number>`count(*)`,
      min: sql<string | null>`min(${transactions.date})`,
      max: sql<string | null>`max(${transactions.date})`,
    })
    .from(transactions)
    .where(eq(transactions.accountId, accountId));
  return { count: Number(row?.count ?? 0), min: row?.min ?? null, max: row?.max ?? null };
}

export async function renameAccount(accountId: string, name: string): Promise<void> {
  await updateAccount(accountId, { name });
}

/**
 * Merges an unused account into another: every reference is repointed (both
 * transaction legs, debts, installments, recurring schedules, goals, templates)
 * and balances are recomputed from the ledger afterwards.
 */
export async function mergeUnusedAccount(accountId: string, intoAccountId: string): Promise<void> {
  const db = getDb();
  if (accountId === intoAccountId) throw new Error('Choose a different account.');
  const target = await getAccount(intoAccountId);
  if (!target) throw new Error('Target account not found.');

  // A transfer from the target into the account being merged would become a
  // self-transfer once repointed — refuse rather than corrupt the ledger.
  const [selfTransfers] = await db
    .select({ value: sql<number>`count(*)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, intoAccountId),
        eq(transactions.isTransfer, true),
        eq(transactions.transferAccountId, accountId),
      ),
    );
  if (Number(selfTransfers?.value ?? 0) > 0) {
    throw new Error('Some transfers go from the target account into this one — delete or edit those transfers first.');
  }

  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.update(transactions).set({ accountId: intoAccountId, updatedAt: now }).where(eq(transactions.accountId, accountId));
    await tx
      .update(transactions)
      .set({ transferAccountId: intoAccountId, updatedAt: now })
      .where(eq(transactions.transferAccountId, accountId));
    await tx.update(debts).set({ accountId: intoAccountId, updatedAt: now }).where(eq(debts.accountId, accountId));
    await tx.update(installments).set({ accountId: intoAccountId, updatedAt: now }).where(eq(installments.accountId, accountId));
    await tx
      .update(recurringTransactions)
      .set({ accountId: intoAccountId, updatedAt: now })
      .where(eq(recurringTransactions.accountId, accountId));
    await tx
      .update(recurringTransactions)
      .set({ transferAccountId: intoAccountId, updatedAt: now })
      .where(eq(recurringTransactions.transferAccountId, accountId));
    await tx.update(goals).set({ linkedAccountId: intoAccountId, updatedAt: now }).where(eq(goals.linkedAccountId, accountId));
    await tx
      .update(transactionTemplates)
      .set({ accountId: intoAccountId, updatedAt: now })
      .where(eq(transactionTemplates.accountId, accountId));
    await tx
      .update(transactionTemplates)
      .set({ transferAccountId: intoAccountId, updatedAt: now })
      .where(eq(transactionTemplates.transferAccountId, accountId));
    await tx.update(accounts).set({ isArchived: true, updatedAt: now }).where(eq(accounts.id, accountId));
  });
  await recalculateAllBalances();
  notifyDbChanged();
}
