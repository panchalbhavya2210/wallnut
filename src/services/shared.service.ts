import { and, eq, inArray, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import {
  people,
  sharedExpenseItems,
  sharedExpenseParticipants,
  sharedExpensePayers,
  sharedExpenses,
  sharedGroupMembers,
  sharedGroups,
  sharedSettlements,
  type SharedExpense,
  type SharedExpenseItem,
  type SharedExpenseParticipant,
  type SharedExpensePayer,
  type SharedGroup,
  type SharedSettlement,
} from '@/db/schema';
import { createTransaction, deleteTransaction } from '@/services/transactions.service';
import { notifyDbChanged } from '@/stores/db.store';
import { toISODate } from '@/utils/date';
import { createId } from '@/utils/id';
import {
  balanceTotals,
  computeMemberBalances,
  computePersonBalances,
  computeSplit,
  expenseUserNets,
  memberKey,
  planSharedLedger,
  suggestSettlements,
  summarizeSharedItems,
  type BalanceTotals,
  type ExpenseLedgerRecord,
  type PersonBalance,
  type SettlementRecord,
  type SharedSplitType,
} from '@/utils/split';

/**
 * Shared expenses (Splitwise-style), integrated with Wallnut's ledger.
 *
 * A trip can be paid for by several people at different times — each expense
 * records every payer (one or many) and each participant's share. Balances are
 * always computed from those records, never stored:
 *
 *   member balance = Σ paid − Σ share (+/− settlements)
 *
 * The user's per-person positions use proportional attribution (Splitwise's
 * model), normalised to the exact cash delta so Money Owed and the ledger
 * mirror can never disagree. Group screens also expose the full member
 * balances and a greedy "who pays whom next" suggestion list.
 *
 * Accounting rules (never regress):
 *   • Only cash that actually left the user's accounts is an `expense`;
 *     the part of their payment beyond their own share is `lending` (receivable).
 *   • When someone else covers the user's share → no cash row, only a payable.
 *   • Settlements involving the user are `debt_payment` rows — never income,
 *     never expenses. Settlements between two other members are records only.
 */

/* --------------------------------- Groups ---------------------------------- */

export interface SharedGroupInput {
  name: string;
  icon?: string;
  color?: string;
}

export async function listSharedGroups(includeArchived = false): Promise<SharedGroup[]> {
  const db = getDb();
  return db
    .select()
    .from(sharedGroups)
    .where(includeArchived ? undefined : eq(sharedGroups.isArchived, false))
    .orderBy(sharedGroups.name);
}

export async function getSharedGroup(id: string): Promise<SharedGroup | null> {
  const db = getDb();
  const rows = await db.select().from(sharedGroups).where(eq(sharedGroups.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createSharedGroup(input: SharedGroupInput): Promise<SharedGroup> {
  const db = getDb();
  const name = input.name.trim();
  if (!name) throw new Error('Give the group a name.');
  const now = Date.now();
  const row: SharedGroup = {
    id: createId('sgr'),
    name,
    icon: input.icon ?? 'people-outline',
    color: input.color ?? '#8B8CFF',
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(sharedGroups).values(row);
  notifyDbChanged();
  return row;
}

export async function updateSharedGroup(
  id: string,
  patch: Partial<SharedGroupInput> & { isArchived?: boolean },
): Promise<void> {
  const db = getDb();
  const current = await getSharedGroup(id);
  if (!current) throw new Error('Group not found.');
  await db
    .update(sharedGroups)
    .set({
      name: patch.name?.trim() ?? current.name,
      icon: patch.icon ?? current.icon,
      color: patch.color ?? current.color,
      isArchived: patch.isArchived ?? current.isArchived,
      updatedAt: Date.now(),
    })
    .where(eq(sharedGroups.id, id));
  notifyDbChanged();
}

export async function deleteSharedGroup(id: string): Promise<void> {
  const db = getDb();
  const [count] = await db
    .select({ value: sql<number>`count(*)` })
    .from(sharedExpenses)
    .where(eq(sharedExpenses.groupId, id));
  if (Number(count?.value ?? 0) > 0) {
    throw new Error('This group has expenses on record. Archive it instead, or delete its expenses first.');
  }
  await db.delete(sharedGroupMembers).where(eq(sharedGroupMembers.groupId, id));
  await db.delete(sharedGroups).where(eq(sharedGroups.id, id));
  notifyDbChanged();
}

export interface GroupMember {
  personId: string;
  name: string;
}

export async function listGroupMembers(groupId: string): Promise<GroupMember[]> {
  const db = getDb();
  const rows = await db
    .select({ personId: sharedGroupMembers.personId, name: people.name })
    .from(sharedGroupMembers)
    .leftJoin(people, eq(people.id, sharedGroupMembers.personId))
    .where(eq(sharedGroupMembers.groupId, groupId))
    .orderBy(people.name);
  return rows.map((row) => ({ personId: row.personId, name: row.name ?? 'Unknown' }));
}

export async function addGroupMember(groupId: string, personId: string): Promise<void> {
  const db = getDb();
  await db
    .insert(sharedGroupMembers)
    .values({ id: createId('sgm'), groupId, personId, createdAt: Date.now() })
    .onConflictDoNothing();
  notifyDbChanged();
}

export async function removeGroupMember(groupId: string, personId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(sharedGroupMembers)
    .where(and(eq(sharedGroupMembers.groupId, groupId), eq(sharedGroupMembers.personId, personId)));
  notifyDbChanged();
}

/* -------------------------------- Expenses --------------------------------- */

export interface SharedParticipantInput {
  /** null = the user ("You"). */
  personId: string | null;
  /** exact = minor units; percentage = basis points; shares = count; equal ignores. */
  value?: number | null;
}

export interface SharedPayerInput {
  /** null = the user ("You"). */
  personId: string | null;
  /** Required when there is more than one payer; single payers cover the bill. */
  amount?: number | null;
}

export interface SharedItemInput {
  name: string;
  /** Positive minor units. */
  amount: number;
}

export interface SharedExpenseInput {
  /** Optional for itemised batches — derived from the items then. */
  title?: string;
  /** Ignored when `items` are present (the items are the source of truth). */
  amount?: number;
  date?: string;
  currency?: string;
  categoryId?: string | null;
  /** Required when the user is one of the payers. */
  accountId?: string | null;
  groupId?: string | null;
  notes?: string | null;
  splitType: SharedSplitType;
  /** Dynamic line items: "Train travel", "Hotel stay", … */
  items?: SharedItemInput[];
  /** One or more people who fronted the money. */
  payers: SharedPayerInput[];
  /** Who shared the expense and how much. The user may be absent. */
  participants: SharedParticipantInput[];
}

export interface SharedExpenseWithMeta {
  expense: SharedExpense;
  /** Line items, ordered as entered. */
  items: SharedExpenseItem[];
  participants: SharedExpenseParticipant[];
  payers: (SharedExpensePayer & { name: string })[];
  groupName: string | null;
  selfShare: number;
  selfPaid: number;
  /** Positive: the user is owed from this expense. */
  owedToYou: number;
  /** Positive: the user still owes their share. */
  youOwe: number;
}

/** One-line description of who fronted the money, for list rows. */
export function payerLabel(meta: SharedExpenseWithMeta): string {
  if (meta.payers.length === 0) return 'No payer recorded';
  if (meta.payers.length === 1) {
    const payer = meta.payers[0]!;
    return payer.personId === null ? 'you paid' : `${payer.name} paid`;
  }
  return `${meta.payers.length} people paid`;
}

interface LoadedExpense {
  expense: SharedExpense;
  items: SharedExpenseItem[];
  participants: SharedExpenseParticipant[];
  payers: SharedExpensePayer[];
}

async function personNameMap(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(ids)).filter(Boolean);
  if (unique.length === 0) return map;
  const db = getDb();
  const rows = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(inArray(people.id, unique));
  for (const row of rows) map.set(row.id, row.name);
  return map;
}

async function loadExpenses(options: { groupId?: string; personId?: string } = {}): Promise<LoadedExpense[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(sharedExpenses)
    .where(options.groupId ? eq(sharedExpenses.groupId, options.groupId) : undefined)
    .orderBy(sharedExpenses.date, sharedExpenses.createdAt);
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [participants, payers, items] = await Promise.all([
    db.select().from(sharedExpenseParticipants).where(inArray(sharedExpenseParticipants.expenseId, ids)),
    db.select().from(sharedExpensePayers).where(inArray(sharedExpensePayers.expenseId, ids)),
    db.select().from(sharedExpenseItems).where(inArray(sharedExpenseItems.expenseId, ids)),
  ]);
  const participantsByExpense = new Map<string, SharedExpenseParticipant[]>();
  for (const participant of participants) {
    const bucket = participantsByExpense.get(participant.expenseId) ?? [];
    bucket.push(participant);
    participantsByExpense.set(participant.expenseId, bucket);
  }
  const payersByExpense = new Map<string, SharedExpensePayer[]>();
  for (const payer of payers) {
    const bucket = payersByExpense.get(payer.expenseId) ?? [];
    bucket.push(payer);
    payersByExpense.set(payer.expenseId, bucket);
  }
  const itemsByExpense = new Map<string, SharedExpenseItem[]>();
  for (const item of items) {
    const bucket = itemsByExpense.get(item.expenseId) ?? [];
    bucket.push(item);
    itemsByExpense.set(item.expenseId, bucket);
  }

  const loaded = rows.map((expense) => ({
    expense,
    items:
      itemsByExpense.get(expense.id) ??
      // Legacy rows (created before migration 0008) have no item rows yet.
      [{ id: `legacy_${expense.id}`, expenseId: expense.id, name: expense.title, amount: expense.amount, sortOrder: 0 }],
    participants: participantsByExpense.get(expense.id) ?? [],
    // Legacy rows (created before migration 0007) have no payer rows; fall back
    // to the denormalised primary payer column.
    payers:
      payersByExpense.get(expense.id) ??
      (expense.payerPersonId !== undefined
        ? [{ id: `legacy_${expense.id}`, expenseId: expense.id, personId: expense.payerPersonId, amount: expense.amount }]
        : []),
  }));

  if (!options.personId) return loaded;
  return loaded.filter(
    (entry) =>
      entry.participants.some((participant) => participant.personId === options.personId) ||
      entry.payers.some((payer) => payer.personId === options.personId),
  );
}

function toLedgerRecord(loaded: LoadedExpense): ExpenseLedgerRecord {
  return {
    payers: loaded.payers.map((payer) => ({ personId: payer.personId, amount: payer.amount })),
    participants: loaded.participants.map((participant) => ({ personId: participant.personId, share: participant.share })),
  };
}

function toMeta(loaded: LoadedExpense[], names: Map<string, string>, groupNames: Map<string, string>): SharedExpenseWithMeta[] {
  return loaded.map(({ expense, items, participants, payers }) => {
    const selfShare = participants.find((participant) => participant.personId === null)?.share ?? 0;
    const selfPaid = payers
      .filter((payer) => payer.personId === null)
      .reduce((sum, payer) => sum + payer.amount, 0);
    const plan = planSharedLedger({ selfPaid, selfShare });
    return {
      expense,
      items: [...items].sort((a, b) => a.sortOrder - b.sortOrder),
      participants: [...participants].sort((a, b) => {
        if (a.personId === null) return -1;
        if (b.personId === null) return 1;
        return b.share - a.share;
      }),
      payers: [...payers]
        .sort((a, b) => b.amount - a.amount)
        .map((payer) => ({ ...payer, name: payer.personId ? (names.get(payer.personId) ?? 'Unknown') : 'You' })),
      groupName: expense.groupId ? (groupNames.get(expense.groupId) ?? null) : null,
      selfShare,
      selfPaid,
      owedToYou: plan.receivableAmount,
      youOwe: plan.payableAmount,
    };
  });
}

export async function listSharedExpenses(
  options: { groupId?: string; personId?: string; limit?: number } = {},
): Promise<SharedExpenseWithMeta[]> {
  const loaded = await loadExpenses(options);
  const db = getDb();
  const groups = await db.select({ id: sharedGroups.id, name: sharedGroups.name }).from(sharedGroups);
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const names = await personNameMap(
    loaded.flatMap((entry) => [
      ...entry.payers.map((payer) => payer.personId ?? ''),
      ...entry.participants.map((participant) => participant.personId ?? ''),
    ]).filter(Boolean),
  );
  const metas = toMeta(loaded, names, groupNames).sort((a, b) =>
    b.expense.date.localeCompare(a.expense.date) || b.expense.createdAt - a.expense.createdAt,
  );
  return options.limit ? metas.slice(0, options.limit) : metas;
}

export async function getSharedExpense(id: string): Promise<SharedExpenseWithMeta | null> {
  const db = getDb();
  const rows = await db.select().from(sharedExpenses).where(eq(sharedExpenses.id, id)).limit(1);
  const expense = rows[0];
  if (!expense) return null;
  const [participants, payers, items] = await Promise.all([
    db.select().from(sharedExpenseParticipants).where(eq(sharedExpenseParticipants.expenseId, id)),
    db.select().from(sharedExpensePayers).where(eq(sharedExpensePayers.expenseId, id)),
    db.select().from(sharedExpenseItems).where(eq(sharedExpenseItems.expenseId, id)),
  ]);
  const group = expense.groupId ? await getSharedGroup(expense.groupId) : null;
  const names = await personNameMap([
    ...payers.map((payer) => payer.personId ?? ''),
    ...participants.map((participant) => participant.personId ?? ''),
  ]);
  const legacyPayers =
    payers.length > 0
      ? payers
      : [{ id: `legacy_${expense.id}`, expenseId: expense.id, personId: expense.payerPersonId, amount: expense.amount }];
  const legacyItems =
    items.length > 0
      ? items
      : [{ id: `legacy_${expense.id}`, expenseId: expense.id, name: expense.title, amount: expense.amount, sortOrder: 0 }];
  return (
    toMeta(
      [{ expense, items: legacyItems, participants, payers: legacyPayers }],
      names,
      group ? new Map([[group.id, group.name]]) : new Map(),
    )[0] ?? null
  );
}

/** Validates + computes shares and payer amounts. Shared by create and update. */
async function prepareExpense(input: SharedExpenseInput): Promise<{
  title: string;
  amount: number;
  date: string;
  itemRows: Omit<SharedExpenseItem, 'id' | 'expenseId'>[];
  participantRows: Omit<SharedExpenseParticipant, 'id' | 'expenseId'>[];
  payerRows: Omit<SharedExpensePayer, 'id' | 'expenseId'>[];
  selfShare: number;
  selfPaid: number;
  plan: ReturnType<typeof planSharedLedger>;
  names: Map<string, string>;
  primaryPayerPersonId: string | null;
}> {
  // Line items are the source of truth when present.
  const rawItems = (input.items ?? []).map((item) => ({
    name: item.name.trim(),
    amount: Math.round(item.amount),
  }));
  const hasItems = rawItems.length > 0;

  let amount = 0;
  let title = input.title?.trim() ?? '';
  let itemRows: Omit<SharedExpenseItem, 'id' | 'expenseId'>[] = [];

  if (hasItems) {
    if (rawItems.some((item) => !item.name)) throw new Error('Give every item a name.');
    if (rawItems.some((item) => item.amount <= 0)) throw new Error('Every item needs an amount.');
    const summary = summarizeSharedItems(rawItems);
    amount = summary.total;
    title = title || summary.title;
    itemRows = rawItems.map((item, index) => ({ name: item.name, amount: item.amount, sortOrder: index }));
  } else {
    if (!title) throw new Error('Give this expense a name.');
    amount = Math.round(input.amount ?? 0);
    itemRows = [{ name: title, amount, sortOrder: 0 }];
  }
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.');
  // A single title still needs to exist for the ledger mirror and lists.
  if (!title) title = summarizeSharedItems(rawItems).title;

  const personIds = input.participants
    .map((participant) => participant.personId)
    .filter((id): id is string => Boolean(id));
  if (new Set(personIds).size !== personIds.length) throw new Error('Each person can appear only once in a split.');

  const payerIds = input.payers.map((payer) => payer.personId);
  if (payerIds.length === 0) throw new Error('Choose who paid.');
  if (new Set(payerIds.map((id) => id ?? 'self')).size !== payerIds.length) {
    throw new Error('Each payer can appear only once.');
  }

  const names = await personNameMap([...personIds, ...payerIds.filter((id): id is string => Boolean(id))]);

  const shares = computeSplit(
    amount,
    input.splitType,
    input.participants.map((participant) => ({
      key: participant.personId ?? 'self',
      value: participant.value ?? null,
    })),
  );

  const participantRows = input.participants.map((participant) => ({
    personId: participant.personId,
    name: participant.personId ? (names.get(participant.personId) ?? 'Unknown') : 'You',
    share: shares.find((share) => share.key === (participant.personId ?? 'self'))?.amount ?? 0,
    inputValue: participant.value === undefined || participant.value === null ? null : Math.round(participant.value),
  }));

  // Single payer covers the whole bill; multiple payers must be exact.
  let payerRows: Omit<SharedExpensePayer, 'id' | 'expenseId'>[];
  if (input.payers.length === 1) {
    payerRows = [{ personId: input.payers[0]!.personId, amount }];
  } else {
    const amounts = input.payers.map((payer) => Math.round(payer.amount ?? 0));
    if (amounts.some((entry) => entry <= 0)) throw new Error('Every payer needs an amount.');
    const sum = amounts.reduce((acc, entry) => acc + entry, 0);
    if (sum !== amount) throw new Error('What each person paid must add up to the total bill.');
    payerRows = input.payers.map((payer, index) => ({ personId: payer.personId, amount: amounts[index]! }));
  }

  const selfShare = participantRows.find((participant) => participant.personId === null)?.share ?? 0;
  const selfPaid = payerRows
    .filter((payer) => payer.personId === null)
    .reduce((sum, payer) => sum + payer.amount, 0);
  if (selfPaid > 0 && !input.accountId) throw new Error('Choose the account you paid from.');

  const plan = planSharedLedger({ selfPaid, selfShare });
  const primary = [...payerRows].sort((a, b) => b.amount - a.amount)[0] ?? null;

  return {
    title,
    amount,
    date: input.date ?? toISODate(new Date()),
    itemRows,
    participantRows,
    payerRows,
    selfShare,
    selfPaid,
    plan,
    names,
    primaryPayerPersonId: primary?.personId ?? null,
  };
}

/** Writes the cash-mirror rows for the user's part of a shared expense. */
async function createMirrorTransactions(
  input: SharedExpenseInput,
  prepared: Awaited<ReturnType<typeof prepareExpense>>,
): Promise<{ transactionId: string | null; lendingTransactionId: string | null }> {
  if (!prepared.plan.userPaid) return { transactionId: null, lendingTransactionId: null };
  const accountId = input.accountId;
  if (!accountId) throw new Error('Choose the account you paid from.');

  let transactionId: string | null = null;
  let lendingTransactionId: string | null = null;

  try {
    if (prepared.plan.expenseAmount > 0) {
      const created = await createTransaction({
        accountId,
        amount: -prepared.plan.expenseAmount,
        type: 'expense',
        categoryId: input.categoryId ?? null,
        merchant: prepared.title,
        description: `${prepared.title} — your share`,
        date: prepared.date,
        isReviewed: true,
        applyRules: false,
      });
      transactionId = created.id;
    }
    if (prepared.plan.receivableAmount > 0) {
      const created = await createTransaction({
        accountId,
        amount: -prepared.plan.receivableAmount,
        type: 'lending',
        categoryId: null,
        merchant: prepared.title,
        description: `${prepared.title} — owed by others`,
        date: prepared.date,
        isReviewed: true,
        applyRules: false,
      });
      lendingTransactionId = created.id;
    }
  } catch (error) {
    if (transactionId) await deleteTransaction(transactionId).catch(() => undefined);
    if (lendingTransactionId) await deleteTransaction(lendingTransactionId).catch(() => undefined);
    throw error;
  }
  return { transactionId, lendingTransactionId };
}

async function ensureGroupMembers(groupId: string | null | undefined, personIds: string[]): Promise<void> {
  if (!groupId) return;
  const db = getDb();
  for (const personId of personIds) {
    await db
      .insert(sharedGroupMembers)
      .values({ id: createId('sgm'), groupId, personId, createdAt: Date.now() })
      .onConflictDoNothing();
  }
}

function memberPersonIds(prepared: Awaited<ReturnType<typeof prepareExpense>>): string[] {
  return Array.from(
    new Set(
      [...prepared.participantRows.map((row) => row.personId), ...prepared.payerRows.map((row) => row.personId)].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  );
}

export async function createSharedExpense(input: SharedExpenseInput): Promise<SharedExpense> {
  const db = getDb();
  const prepared = await prepareExpense(input);
  const now = Date.now();
  const expenseId = createId('sexp');

  const row: SharedExpense = {
    id: expenseId,
    groupId: input.groupId ?? null,
    title: prepared.title,
    amount: prepared.amount,
    date: prepared.date,
    currency: input.currency ?? 'INR',
    categoryId: input.categoryId ?? null,
    accountId: prepared.selfPaid > 0 ? (input.accountId ?? null) : null,
    payerPersonId: prepared.primaryPayerPersonId,
    notes: input.notes?.trim() || null,
    splitType: input.splitType,
    transactionId: null,
    lendingTransactionId: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.insert(sharedExpenses).values(row);
    await db.insert(sharedExpenseItems).values(
      prepared.itemRows.map((item) => ({ ...item, id: createId('shi'), expenseId })),
    );
    await db.insert(sharedExpenseParticipants).values(
      prepared.participantRows.map((participant) => ({ ...participant, id: createId('spa'), expenseId })),
    );
    await db.insert(sharedExpensePayers).values(
      prepared.payerRows.map((payer) => ({ ...payer, id: createId('shp'), expenseId })),
    );
    const mirrors = await createMirrorTransactions(input, prepared);
    await db
      .update(sharedExpenses)
      .set({ transactionId: mirrors.transactionId, lendingTransactionId: mirrors.lendingTransactionId })
      .where(eq(sharedExpenses.id, expenseId));
    await ensureGroupMembers(input.groupId, memberPersonIds(prepared));
    notifyDbChanged();
    return { ...row, ...mirrors };
  } catch (error) {
    // Best effort rollback: the shared record must never outlive a failed ledger write.
    await db.delete(sharedExpenseItems).where(eq(sharedExpenseItems.expenseId, expenseId)).catch(() => undefined);
    await db.delete(sharedExpenseParticipants).where(eq(sharedExpenseParticipants.expenseId, expenseId)).catch(() => undefined);
    await db.delete(sharedExpensePayers).where(eq(sharedExpensePayers.expenseId, expenseId)).catch(() => undefined);
    await db.delete(sharedExpenses).where(eq(sharedExpenses.id, expenseId)).catch(() => undefined);
    throw error;
  }
}

export async function updateSharedExpense(id: string, input: SharedExpenseInput): Promise<void> {
  const db = getDb();
  const current = await getSharedExpense(id);
  if (!current) throw new Error('Shared expense not found.');
  const prepared = await prepareExpense(input);

  // Everything is validated before this point; only now do we replace rows.
  if (current.expense.transactionId) await deleteTransaction(current.expense.transactionId);
  if (current.expense.lendingTransactionId) await deleteTransaction(current.expense.lendingTransactionId);

  const mirrors = await createMirrorTransactions(input, prepared);

  await db
    .update(sharedExpenses)
    .set({
      groupId: input.groupId ?? null,
      title: prepared.title,
      amount: prepared.amount,
      date: prepared.date,
      currency: input.currency ?? current.expense.currency,
      categoryId: input.categoryId ?? null,
      accountId: prepared.selfPaid > 0 ? (input.accountId ?? null) : null,
      payerPersonId: prepared.primaryPayerPersonId,
      notes: input.notes?.trim() || null,
      splitType: input.splitType,
      transactionId: mirrors.transactionId,
      lendingTransactionId: mirrors.lendingTransactionId,
      updatedAt: Date.now(),
    })
    .where(eq(sharedExpenses.id, id));

  await db.delete(sharedExpenseItems).where(eq(sharedExpenseItems.expenseId, id));
  await db.delete(sharedExpenseParticipants).where(eq(sharedExpenseParticipants.expenseId, id));
  await db.delete(sharedExpensePayers).where(eq(sharedExpensePayers.expenseId, id));
  await db.insert(sharedExpenseItems).values(
    prepared.itemRows.map((item) => ({ ...item, id: createId('shi'), expenseId: id })),
  );
  await db.insert(sharedExpenseParticipants).values(
    prepared.participantRows.map((participant) => ({ ...participant, id: createId('spa'), expenseId: id })),
  );
  await db.insert(sharedExpensePayers).values(
    prepared.payerRows.map((payer) => ({ ...payer, id: createId('shp'), expenseId: id })),
  );
  await ensureGroupMembers(input.groupId, memberPersonIds(prepared));
  notifyDbChanged();
}

export async function deleteSharedExpense(id: string): Promise<void> {
  const db = getDb();
  const current = await getSharedExpense(id);
  if (!current) return;
  if (current.expense.transactionId) await deleteTransaction(current.expense.transactionId);
  if (current.expense.lendingTransactionId) await deleteTransaction(current.expense.lendingTransactionId);
  await db.delete(sharedExpenseItems).where(eq(sharedExpenseItems.expenseId, id));
  await db.delete(sharedExpenseParticipants).where(eq(sharedExpenseParticipants.expenseId, id));
  await db.delete(sharedExpensePayers).where(eq(sharedExpensePayers.expenseId, id));
  await db.delete(sharedExpenses).where(eq(sharedExpenses.id, id));
  notifyDbChanged();
}

/* -------------------------------- Balances --------------------------------- */

export interface BalanceWithName extends PersonBalance {
  name: string;
}

export interface SharedBalanceOverview extends BalanceTotals {
  people: BalanceWithName[];
}

async function settlementRecords(personId?: string): Promise<SettlementRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(sharedSettlements)
    .where(
      personId
        ? sql`(${sharedSettlements.fromPersonId} = ${personId} OR ${sharedSettlements.toPersonId} = ${personId})`
        : undefined,
    );
  return rows.map((row) => ({ fromPersonId: row.fromPersonId, toPersonId: row.toPersonId, amount: row.amount }));
}

async function allLedgerRecords(): Promise<ExpenseLedgerRecord[]> {
  const loaded = await loadExpenses();
  return loaded.map(toLedgerRecord);
}

/** Per-person balances across every shared expense and settlement. */
export async function getSharedBalances(): Promise<SharedBalanceOverview> {
  const [records, settlements] = await Promise.all([allLedgerRecords(), settlementRecords()]);
  const balances = computePersonBalances(records, settlements);
  const names = await personNameMap(Array.from(balances.keys()));
  const people = Array.from(balances.values())
    .map((balance) => ({ ...balance, name: names.get(balance.personId) ?? 'Unknown' }))
    .filter((balance) => balance.net !== 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  return { ...balanceTotals(Array.from(balances.values())), people };
}

export async function getPersonSharedBalance(personId: string): Promise<PersonBalance> {
  const [loaded, settlements] = await Promise.all([loadExpenses({ personId }), settlementRecords(personId)]);
  const balances = computePersonBalances(loaded.map(toLedgerRecord), settlements);
  return balances.get(personId) ?? { personId, theyOwe: 0, youOwe: 0, net: 0 };
}

/**
 * Net receivables/payables for net worth. Scoped to specific accounts by the
 * same rule as manual debts: expenses paid from those accounts and settlements
 * made from/to them.
 */
export async function getSharedReceivablesPayables(accountIds?: string[]): Promise<{ receivables: number; payables: number }> {
  const loaded = await loadExpenses();
  const scoped = accountIds && accountIds.length > 0
    ? loaded.filter(({ expense }) => expense.accountId && accountIds.includes(expense.accountId))
    : loaded;
  const db = getDb();
  const settlementRows = await db.select().from(sharedSettlements);
  const scopedSettlements = settlementRows
    .filter((row) => !accountIds || accountIds.length === 0 || (row.accountId && accountIds.includes(row.accountId)))
    .map((row) => ({ fromPersonId: row.fromPersonId, toPersonId: row.toPersonId, amount: row.amount }));
  const balances = computePersonBalances(scoped.map(toLedgerRecord), scopedSettlements);
  let receivables = 0;
  let payables = 0;
  for (const balance of balances.values()) {
    if (balance.net > 0) receivables += balance.net;
    else payables += -balance.net;
  }
  return { receivables, payables };
}

/** Dated receivable/payable movements, for net-worth history. */
export async function getSharedMovements(endDate: string): Promise<{ date: string; receivable: number; payable: number }[]> {
  const db = getDb();
  const expenses = await db.select().from(sharedExpenses).where(sql`${sharedExpenses.date} <= ${endDate}`);
  const byDate = new Map<string, { date: string; receivable: number; payable: number }>();
  const ensure = (date: string) => {
    const entry = byDate.get(date) ?? { date, receivable: 0, payable: 0 };
    byDate.set(date, entry);
    return entry;
  };

  if (expenses.length > 0) {
    const ids = expenses.map((expense) => expense.id);
    const [participants, payers] = await Promise.all([
      db.select().from(sharedExpenseParticipants).where(inArray(sharedExpenseParticipants.expenseId, ids)),
      db.select().from(sharedExpensePayers).where(inArray(sharedExpensePayers.expenseId, ids)),
    ]);
    const participantsByExpense = new Map<string, SharedExpenseParticipant[]>();
    for (const participant of participants) {
      const bucket = participantsByExpense.get(participant.expenseId) ?? [];
      bucket.push(participant);
      participantsByExpense.set(participant.expenseId, bucket);
    }
    const payersByExpense = new Map<string, SharedExpensePayer[]>();
    for (const payer of payers) {
      const bucket = payersByExpense.get(payer.expenseId) ?? [];
      bucket.push(payer);
      payersByExpense.set(payer.expenseId, bucket);
    }

    for (const expense of expenses) {
      const expenseParticipants = participantsByExpense.get(expense.id) ?? [];
      const expensePayers = payersByExpense.get(expense.id) ?? [
        { id: `legacy_${expense.id}`, expenseId: expense.id, personId: expense.payerPersonId, amount: expense.amount },
      ];
      const nets = expenseUserNets({
        payers: expensePayers.map((payer) => ({ personId: payer.personId, amount: payer.amount })),
        participants: expenseParticipants.map((participant) => ({ personId: participant.personId, share: participant.share })),
      });
      const entry = ensure(expense.date);
      for (const net of nets.values()) {
        if (net > 0) entry.receivable += net;
        else entry.payable += -net;
      }
    }
  }

  const settlementRows = await db
    .select()
    .from(sharedSettlements)
    .where(sql`${sharedSettlements.date} <= ${endDate}`);
  for (const settlement of settlementRows) {
    const entry = ensure(settlement.date);
    if (settlement.fromPersonId === null && settlement.toPersonId !== null) entry.payable -= settlement.amount;
    else if (settlement.toPersonId === null && settlement.fromPersonId !== null) entry.receivable -= settlement.amount;
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------- Settlements -------------------------------- */

export interface SettlementInput {
  /** null = the user. */
  fromPersonId: string | null;
  /** null = the user. */
  toPersonId: string | null;
  amount: number;
  date?: string;
  accountId?: string | null;
  groupId?: string | null;
  note?: string | null;
}

export async function listSettlements(options: { personId?: string; groupId?: string } = {}): Promise<SharedSettlement[]> {
  const db = getDb();
  const clauses: ReturnType<typeof eq>[] = [];
  if (options.groupId) clauses.push(eq(sharedSettlements.groupId, options.groupId));
  const rows = await db
    .select()
    .from(sharedSettlements)
    .where(clauses.length > 0 ? and(...clauses) : undefined)
    .orderBy(sharedSettlements.date, sharedSettlements.createdAt);
  if (!options.personId) return rows;
  return rows.filter(
    (row) => row.fromPersonId === options.personId || row.toPersonId === options.personId,
  );
}

export async function recordSettlement(input: SettlementInput): Promise<SharedSettlement> {
  const db = getDb();
  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a settlement amount.');
  if (input.fromPersonId === input.toPersonId) throw new Error('Choose two different people.');

  const userInvolved = input.fromPersonId === null || input.toPersonId === null;

  if (userInvolved) {
    const personId = input.fromPersonId ?? input.toPersonId;
    if (!personId) throw new Error('Choose who the settlement is with.');
    const balance = await getPersonSharedBalance(personId);
    if (input.toPersonId === null) {
      // They paid you.
      if (balance.net <= 0) throw new Error('They do not owe you anything right now.');
      if (amount > balance.net) throw new Error('That is more than the outstanding balance.');
    } else {
      // You paid them.
      if (balance.net >= 0) throw new Error('You do not owe them anything right now.');
      if (amount > -balance.net) throw new Error('That is more than the outstanding balance.');
    }
  } else {
    // Settlement between two other members: validate against their balances.
    const [records, settlements] = await Promise.all([allLedgerRecords(), settlementRecords()]);
    const balances = computeMemberBalances(records, settlements);
    const payerNet = balances.get(memberKey(input.fromPersonId)) ?? 0;
    const recipientNet = balances.get(memberKey(input.toPersonId)) ?? 0;
    if (payerNet >= 0) throw new Error('That person does not owe anything right now.');
    if (amount > -payerNet) throw new Error('That is more than what they owe overall.');
    if (recipientNet <= 0) throw new Error('That person is not owed anything right now.');
    if (amount > recipientNet) throw new Error('That is more than what they are owed overall.');
  }

  const names = await personNameMap(
    [input.fromPersonId ?? '', input.toPersonId ?? ''].filter(Boolean),
  );
  const fromName = input.fromPersonId ? (names.get(input.fromPersonId) ?? 'someone') : 'you';
  const toName = input.toPersonId ? (names.get(input.toPersonId) ?? 'someone') : 'you';
  const date = input.date ?? toISODate(new Date());
  const now = Date.now();

  let transactionId: string | null = null;
  if (userInvolved && input.accountId) {
    const created = await createTransaction({
      accountId: input.accountId,
      amount: input.toPersonId === null ? amount : -amount,
      type: 'debt_payment',
      date,
      merchant: null,
      description:
        input.note?.trim() ||
        (input.toPersonId === null ? `Settlement received from ${fromName}` : `Settlement paid to ${toName}`),
      isReviewed: true,
      applyRules: false,
    });
    transactionId = created.id;
  }

  const row: SharedSettlement = {
    id: createId('sst'),
    groupId: input.groupId ?? null,
    fromPersonId: input.fromPersonId,
    toPersonId: input.toPersonId,
    amount,
    date,
    accountId: userInvolved ? (input.accountId ?? null) : null,
    transactionId,
    note: input.note?.trim() || null,
    createdAt: now,
    personId: null,
    direction: null,
  };
  await db.insert(sharedSettlements).values(row);
  notifyDbChanged();
  return row;
}

export async function deleteSettlement(id: string): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(sharedSettlements).where(eq(sharedSettlements.id, id)).limit(1);
  const row = rows[0];
  if (!row) return;
  if (row.transactionId) await deleteTransaction(row.transactionId);
  await db.delete(sharedSettlements).where(eq(sharedSettlements.id, id));
  notifyDbChanged();
}

/* ------------------------------- Reporting ---------------------------------- */

export interface SharedGroupWithStats {
  group: SharedGroup;
  expenseCount: number;
  totalSpent: number;
  youPaid: number;
  yourShare: number;
  /** Net within this group only: positive = they owe you. */
  net: number;
}

export interface SharedOverview extends BalanceTotals {
  totalSpent: number;
  youPaid: number;
  yourShare: number;
  expenseCount: number;
  groups: SharedGroupWithStats[];
  people: BalanceWithName[];
  recent: SharedExpenseWithMeta[];
}

export async function getSharedOverview(): Promise<SharedOverview> {
  const db = getDb();
  const [loaded, groups, balances, settlementRows] = await Promise.all([
    loadExpenses(),
    listSharedGroups(),
    getSharedBalances(),
    db.select().from(sharedSettlements),
  ]);
  const names = await personNameMap(
    loaded.flatMap((entry) => [
      ...entry.payers.map((payer) => payer.personId ?? ''),
      ...entry.participants.map((participant) => participant.personId ?? ''),
    ]).filter(Boolean),
  );
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const metas = toMeta(loaded, names, groupNames);
  let totalSpent = 0;
  let youPaid = 0;
  let yourShare = 0;
  for (const meta of metas) {
    totalSpent += meta.expense.amount;
    youPaid += meta.selfPaid;
    yourShare += meta.selfShare;
  }

  const groupSummaries: SharedGroupWithStats[] = groups.map((group) => {
    const entries = metas.filter((meta) => meta.expense.groupId === group.id);
    const records: ExpenseLedgerRecord[] = entries.map((meta) => ({
      payers: meta.payers.map((payer) => ({ personId: payer.personId, amount: payer.amount })),
      participants: meta.participants.map((participant) => ({ personId: participant.personId, share: participant.share })),
    }));
    const groupSettlements: SettlementRecord[] = settlementRows
      .filter((settlement) => settlement.groupId === group.id)
      .map((settlement) => ({
        fromPersonId: settlement.fromPersonId,
        toPersonId: settlement.toPersonId,
        amount: settlement.amount,
      }));
    const net = balanceTotals(computePersonBalances(records, groupSettlements).values()).net;
    return {
      group,
      expenseCount: entries.length,
      totalSpent: entries.reduce((sum, meta) => sum + meta.expense.amount, 0),
      youPaid: entries.reduce((sum, meta) => sum + meta.selfPaid, 0),
      yourShare: entries.reduce((sum, meta) => sum + meta.selfShare, 0),
      net,
    };
  });

  return {
    ...balances,
    totalSpent,
    youPaid,
    yourShare,
    expenseCount: metas.length,
    groups: groupSummaries,
    people: balances.people,
    recent: [...metas].sort((a, b) => b.expense.date.localeCompare(a.expense.date)).slice(0, 8),
  };
}

export interface MemberBalanceWithName {
  key: string;
  personId: string | null;
  name: string;
  /** Positive = is owed money; negative = owes money. */
  net: number;
}

export interface SettlementSuggestionWithNames {
  fromKey: string;
  toKey: string;
  fromName: string;
  toName: string;
  amount: number;
}

export interface SharedGroupSummary {
  group: SharedGroup;
  members: GroupMember[];
  expenseCount: number;
  totalSpent: number;
  youPaid: number;
  yourShare: number;
  youAreOwed: number;
  youOwe: number;
  balances: MemberBalanceWithName[];
  suggestions: SettlementSuggestionWithNames[];
}

export async function getSharedGroupSummary(groupId: string): Promise<SharedGroupSummary | null> {
  const group = await getSharedGroup(groupId);
  if (!group) return null;
  const [loaded, members, groupSettlements] = await Promise.all([
    loadExpenses({ groupId }),
    listGroupMembers(groupId),
    listSettlements({ groupId }),
  ]);
  const records = loaded.map(toLedgerRecord);
  const settlements: SettlementRecord[] = groupSettlements.map((row) => ({
    fromPersonId: row.fromPersonId,
    toPersonId: row.toPersonId,
    amount: row.amount,
  }));

  let totalSpent = 0;
  let youPaid = 0;
  let yourShare = 0;
  for (const record of loaded) {
    totalSpent += record.expense.amount;
    youPaid += record.payers
      .filter((payer) => payer.personId === null)
      .reduce((sum, payer) => sum + payer.amount, 0);
    yourShare += record.participants.find((participant) => participant.personId === null)?.share ?? 0;
  }

  const memberBalances = computeMemberBalances(records, settlements);
  // Everyone who appears anywhere in the group: explicit members, payers,
  // participants and settlement parties.
  const memberIds = new Set<string>(members.map((member) => member.personId));
  for (const record of loaded) {
    for (const payer of record.payers) if (payer.personId) memberIds.add(payer.personId);
    for (const participant of record.participants) if (participant.personId) memberIds.add(participant.personId);
  }
  for (const settlement of groupSettlements) {
    if (settlement.fromPersonId) memberIds.add(settlement.fromPersonId);
    if (settlement.toPersonId) memberIds.add(settlement.toPersonId);
  }

  const names = await personNameMap(Array.from(memberIds));
  const displayName = (key: string) => (key === 'self' ? 'You' : (names.get(key) ?? members.find((member) => member.personId === key)?.name ?? 'Unknown'));

  const balances: MemberBalanceWithName[] = [memberKey(null), ...Array.from(memberIds)]
    .map((key) => ({
      key,
      personId: key === 'self' ? null : key,
      name: displayName(key),
      net: memberBalances.get(key) ?? 0,
    }))
    .filter((entry) => entry.net !== 0)
    .sort((a, b) => b.net - a.net);

  const suggestions = suggestSettlements(memberBalances.entries()).map((suggestion) => ({
    ...suggestion,
    fromName: displayName(suggestion.fromKey),
    toName: displayName(suggestion.toKey),
  }));

  const userTotals = balanceTotals(computePersonBalances(records, settlements).values());

  return {
    group,
    members,
    expenseCount: loaded.length,
    totalSpent,
    youPaid,
    yourShare,
    youAreOwed: userTotals.theyOweYou,
    youOwe: userTotals.youOwe,
    balances,
    suggestions,
  };
}

/** Shared-expense reporting for a period (never mixed into personal spending). */
export interface SharedSpendingSummary {
  /** The user's own share of the bills in the period. */
  yourShare: number;
  /** What the user paid beyond their own share — a receivable, not spending. */
  paidForOthers: number;
  /** The user's shares someone else fronted — a payable, not spending. */
  owedToOthers: number;
  /** Settlements received/made in the period. */
  received: number;
  paid: number;
  expenseCount: number;
}

export async function getSharedSpendingSummary(from: string, to: string): Promise<SharedSpendingSummary> {
  const db = getDb();
  const loaded = await loadExpenses();
  let yourShare = 0;
  let paidForOthers = 0;
  let owedToOthers = 0;
  let expenseCount = 0;
  for (const { expense, participants, payers } of loaded) {
    if (expense.date < from || expense.date > to) continue;
    expenseCount++;
    const selfShare = participants.find((participant) => participant.personId === null)?.share ?? 0;
    const selfPaid = payers
      .filter((payer) => payer.personId === null)
      .reduce((sum, payer) => sum + payer.amount, 0);
    yourShare += selfShare;
    paidForOthers += Math.max(0, selfPaid - selfShare);
    owedToOthers += Math.max(0, selfShare - selfPaid);
  }
  const settlementRows = await db.select().from(sharedSettlements);
  let received = 0;
  let paid = 0;
  for (const settlement of settlementRows) {
    if (settlement.date < from || settlement.date > to) continue;
    if (settlement.toPersonId === null && settlement.fromPersonId !== null) received += settlement.amount;
    else if (settlement.fromPersonId === null && settlement.toPersonId !== null) paid += settlement.amount;
  }
  return { yourShare, paidForOthers, owedToOthers, received, paid, expenseCount };
}

/** Person screen: everything shared with one person. */
export interface PersonSharedActivity {
  balance: PersonBalance;
  expenses: SharedExpenseWithMeta[];
  settlements: SharedSettlement[];
}

export async function getPersonSharedActivity(personId: string): Promise<PersonSharedActivity> {
  const [expenses, settlements, balance] = await Promise.all([
    listSharedExpenses({ personId }),
    listSettlements({ personId }),
    getPersonSharedBalance(personId),
  ]);
  return { balance, expenses, settlements };
}

/** Used by the person-delete guard — a person with shared history is not removable. */
export async function personHasSharedRecords(personId: string): Promise<boolean> {
  const db = getDb();
  const [participantCount] = await db
    .select({ value: sql<number>`count(*)` })
    .from(sharedExpenseParticipants)
    .where(eq(sharedExpenseParticipants.personId, personId));
  if (Number(participantCount?.value ?? 0) > 0) return true;
  const [payerCount] = await db
    .select({ value: sql<number>`count(*)` })
    .from(sharedExpensePayers)
    .where(eq(sharedExpensePayers.personId, personId));
  if (Number(payerCount?.value ?? 0) > 0) return true;
  const [settlementCount] = await db
    .select({ value: sql<number>`count(*)` })
    .from(sharedSettlements)
    .where(sql`${sharedSettlements.fromPersonId} = ${personId} OR ${sharedSettlements.toPersonId} = ${personId}`);
  return Number(settlementCount?.value ?? 0) > 0;
}
