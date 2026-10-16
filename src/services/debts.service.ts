import { and, asc, eq, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import {
  debts,
  debtPayments,
  people,
  sharedGroupMembers,
  type Debt,
  type DebtPayment,
  type Person,
} from '@/db/schema';
import { getSharedBalances } from '@/services/shared.service';
import { notifyDbChanged } from '@/stores/db.store';
import { toISODate } from '@/utils/date';
import { createId } from '@/utils/id';

/**
 * Personal debts: money lent (receivables) and money borrowed (liabilities).
 *
 * Accounting rules (unit-tested):
 *  - Lending money moves cash out and creates a receivable. NOT an expense.
 *  - Borrowing moves cash in and creates a liability. NOT income.
 *  - Repayments move cash and reduce the receivable/liability. NOT income or expense.
 *
 * Every cash movement is written to `transactions` with type `lending`,
 * `borrowing` or `debt_payment` so balances stay ledger-derived, while the debt
 * tables track who owes what.
 */

export interface PersonInput {
  name: string;
  note?: string | null;
}

export interface DebtInput {
  personId?: string;
  personName?: string;
  direction: 'lent' | 'borrowed';
  amount: number;
  date?: string;
  dueDate?: string | null;
  accountId?: string | null;
  description?: string | null;
}

export interface DebtWithPerson extends Debt {
  personName: string;
}

export interface PersonSummary {
  person: Person;
  lentRemaining: number;
  borrowedRemaining: number;
  net: number; // positive = they owe you
  openCount: number;
  /** Net position from shared expenses with this person (positive = they owe you). */
  sharedNet: number;
}

/* --------------------------------- People ---------------------------------- */

export async function listPeople(): Promise<Person[]> {
  const db = getDb();
  return db.select().from(people).orderBy(asc(people.name));
}

export async function createPerson(input: PersonInput): Promise<Person> {
  const db = getDb();
  const name = input.name.trim();
  if (!name) throw new Error('Enter a name.');
  const existing = await db.select().from(people).where(eq(people.name, name)).limit(1);
  if (existing[0]) return existing[0];
  const row: Person = { id: createId('per'), name, note: input.note ?? null, createdAt: Date.now() };
  await db.insert(people).values(row);
  notifyDbChanged();
  return row;
}

export async function renamePerson(id: string, name: string): Promise<void> {
  const db = getDb();
  if (!name.trim()) throw new Error('Enter a name.');
  await db.update(people).set({ name: name.trim() }).where(eq(people.id, id));
  notifyDbChanged();
}

/** Removes a person only when no debts or shared records reference them. */
export async function deletePerson(id: string): Promise<void> {
  const db = getDb();
  const [count] = await db.select({ value: sql<number>`count(*)` }).from(debts).where(eq(debts.personId, id));
  if (Number(count?.value ?? 0) > 0) {
    throw new Error('This person has debts on record. Settle or delete them first.');
  }
  const { personHasSharedRecords } = await import('@/services/shared.service');
  if (await personHasSharedRecords(id)) {
    throw new Error('This person is part of shared expenses. Remove or archive those first.');
  }
  await db.delete(sharedGroupMembers).where(eq(sharedGroupMembers.personId, id));
  await db.delete(people).where(eq(people.id, id));
  notifyDbChanged();
}

/* ---------------------------------- Debts ---------------------------------- */

export async function listDebts(options: { includeSettled?: boolean } = {}): Promise<DebtWithPerson[]> {
  const db = getDb();
  const rows = await db
    .select({
      debt: debts,
      personName: people.name,
    })
    .from(debts)
    .leftJoin(people, eq(people.id, debts.personId))
    .where(options.includeSettled ? undefined : eq(debts.status, 'open'))
    .orderBy(asc(debts.status), asc(debts.date));

  return rows.map((row) => ({ ...row.debt, personName: row.personName ?? 'Unknown' }));
}

export async function getDebt(id: string): Promise<DebtWithPerson | null> {
  const db = getDb();
  const rows = await db
    .select({ debt: debts, personName: people.name })
    .from(debts)
    .leftJoin(people, eq(people.id, debts.personId))
    .where(eq(debts.id, id))
    .limit(1);
  const row = rows[0];
  return row ? { ...row.debt, personName: row.personName ?? 'Unknown' } : null;
}

/**
 * Creates a debt AND the matching cash movement:
 *   lent     → money leaves the account (transactions.type = 'lending', negative)
 *   borrowed → money arrives in the account (type = 'borrowing', positive)
 */
export async function createDebt(input: DebtInput): Promise<Debt> {
  const db = getDb();
  const amount = Math.round(Math.abs(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.');

  let personId = input.personId;
  if (!personId) {
    if (!input.personName?.trim()) throw new Error('Choose or enter a person.');
    const person = await createPerson({ name: input.personName });
    personId = person.id;
  }

  const date = input.date ?? toISODate(new Date());
  const now = Date.now();
  let transactionId: string | null = null;

  if (input.accountId) {
    const { createTransaction } = await import('@/services/transactions.service');
    const created = await createTransaction({
      accountId: input.accountId,
      amount: input.direction === 'lent' ? -amount : amount,
      type: input.direction === 'lent' ? 'lending' : 'borrowing',
      date,
      merchant: null,
      description: input.description ?? (input.direction === 'lent' ? 'Money lent' : 'Money borrowed'),
      isReviewed: true,
      applyRules: false,
    });
    transactionId = created.id;
  }

  const row: Debt = {
    id: createId('dbt'),
    personId,
    direction: input.direction,
    principal: amount,
    remaining: amount,
    date,
    dueDate: input.dueDate ?? null,
    accountId: input.accountId ?? null,
    transactionId,
    description: input.description ?? null,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(debts).values(row);
  notifyDbChanged();
  return row;
}

export async function updateDebt(id: string, patch: Partial<DebtInput> & { status?: 'open' | 'settled' }): Promise<void> {
  const db = getDb();
  const current = await getDebt(id);
  if (!current) throw new Error('Debt not found.');
  await db
    .update(debts)
    .set({
      personId: patch.personId ?? current.personId,
      direction: patch.direction ?? current.direction,
      dueDate: patch.dueDate === undefined ? current.dueDate : patch.dueDate,
      accountId: patch.accountId === undefined ? current.accountId : patch.accountId,
      description: patch.description === undefined ? current.description : patch.description,
      status: patch.status ?? current.status,
      updatedAt: Date.now(),
    })
    .where(eq(debts.id, id));
  notifyDbChanged();
}

export async function deleteDebt(id: string): Promise<void> {
  const db = getDb();
  await db.delete(debtPayments).where(eq(debtPayments.debtId, id));
  await db.delete(debts).where(eq(debts.id, id));
  notifyDbChanged();
}

/* -------------------------------- Repayments -------------------------------- */

export interface PaymentInput {
  debtId: string;
  amount: number;
  date?: string;
  accountId?: string | null;
  note?: string | null;
}

/**
 * Records a repayment. `debt_payment` transactions are signed cash movements:
 *   collecting a loan you gave  → positive (money in)
 *   repaying money you borrowed → negative (money out)
 * Neither is income or expense.
 */
export async function recordPayment(input: PaymentInput): Promise<DebtPayment> {
  const db = getDb();
  const debt = await getDebt(input.debtId);
  if (!debt) throw new Error('Debt not found.');
  const amount = Math.round(Math.abs(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a repayment amount.');
  if (amount > debt.remaining) throw new Error(`That's more than the remaining ${debt.remaining / 100} owed.`);

  const date = input.date ?? toISODate(new Date());
  const now = Date.now();
  let transactionId: string | null = null;

  if (input.accountId) {
    const { createTransaction } = await import('@/services/transactions.service');
    const collecting = debt.direction === 'lent';
    const created = await createTransaction({
      accountId: input.accountId,
      amount: collecting ? amount : -amount,
      type: 'debt_payment',
      date,
      merchant: null,
      description:
        input.note ??
        (collecting ? `Repayment received from ${debt.personName}` : `Repayment to ${debt.personName}`),
      isReviewed: true,
      applyRules: false,
    });
    transactionId = created.id;
  }

  const payment: DebtPayment = {
    id: createId('dpm'),
    debtId: input.debtId,
    amount,
    date,
    accountId: input.accountId ?? null,
    transactionId,
    note: input.note ?? null,
    createdAt: now,
  };
  await db.insert(debtPayments).values(payment);

  const remaining = Math.max(0, debt.remaining - amount);
  await db
    .update(debts)
    .set({ remaining, status: remaining === 0 ? 'settled' : 'open', updatedAt: now })
    .where(eq(debts.id, input.debtId));

  notifyDbChanged();
  return payment;
}

export async function listPayments(debtId: string): Promise<DebtPayment[]> {
  const db = getDb();
  return db
    .select()
    .from(debtPayments)
    .where(eq(debtPayments.debtId, debtId))
    .orderBy(asc(debtPayments.date), asc(debtPayments.createdAt));
}

/* --------------------------------- Reporting -------------------------------- */

export interface DebtOverview {
  theyOweYou: number;
  youOwe: number;
  net: number;
  openCount: number;
  /** People with a non-zero shared-expense balance (included in the totals above). */
  sharedCount: number;
  overdueCount: number;
  dueThisMonth: number;
  people: PersonSummary[];
  recent: DebtWithPerson[];
}

export async function getDebtOverview(): Promise<DebtOverview> {
  const open = await listDebts();
  const allPeople = await listPeople();
  const today = toISODate(new Date());

  const byPerson = new Map<string, PersonSummary>();
  for (const person of allPeople) {
    byPerson.set(person.id, { person, lentRemaining: 0, borrowedRemaining: 0, net: 0, openCount: 0, sharedNet: 0 });
  }

  let theyOweYou = 0;
  let youOwe = 0;
  let overdueCount = 0;
  let dueThisMonth = 0;
  const monthStart = today.slice(0, 8) + '01';

  for (const debt of open) {
    const entry =
      byPerson.get(debt.personId) ??
      ({ person: { id: debt.personId, name: debt.personName, note: null, createdAt: 0 }, lentRemaining: 0, borrowedRemaining: 0, net: 0, openCount: 0, sharedNet: 0 } as PersonSummary);
    if (debt.direction === 'lent') {
      theyOweYou += debt.remaining;
      entry.lentRemaining += debt.remaining;
    } else {
      youOwe += debt.remaining;
      entry.borrowedRemaining += debt.remaining;
    }
    entry.net = entry.lentRemaining - entry.borrowedRemaining;
    entry.openCount += 1;
    byPerson.set(debt.personId, entry);

    if (debt.dueDate) {
      if (debt.dueDate < today) overdueCount++;
      else if (debt.dueDate.startsWith(monthStart.slice(0, 7))) dueThisMonth += debt.remaining;
    }
  }

  // Shared expenses merge into the same view — Money Owed is the single place
  // the user checks who owes whom. Shared records never create debt rows, so
  // this merge cannot double-count.
  const shared = await getSharedBalances();
  let sharedCount = 0;
  for (const balance of shared.people) {
    const entry =
      byPerson.get(balance.personId) ??
      ({
        person: { id: balance.personId, name: balance.name, note: null, createdAt: 0 },
        lentRemaining: 0,
        borrowedRemaining: 0,
        net: 0,
        openCount: 0,
        sharedNet: 0,
      } as PersonSummary);
    if (balance.net > 0) {
      theyOweYou += balance.net;
      entry.lentRemaining += balance.net;
    } else if (balance.net < 0) {
      youOwe += -balance.net;
      entry.borrowedRemaining += -balance.net;
    }
    entry.sharedNet = balance.net;
    entry.net = entry.lentRemaining - entry.borrowedRemaining;
    byPerson.set(balance.personId, entry);
    sharedCount += 1;
  }

  const peopleSummaries = Array.from(byPerson.values())
    .filter((summary) => summary.openCount > 0 || summary.sharedNet !== 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  return {
    theyOweYou,
    youOwe,
    net: theyOweYou - youOwe,
    openCount: open.length,
    sharedCount,
    overdueCount,
    dueThisMonth,
    people: peopleSummaries,
    recent: open.slice(0, 6),
  };
}

export async function debtsDueSoon(days = 14): Promise<DebtWithPerson[]> {
  const open = await listDebts();
  const limit = new Date();
  limit.setDate(limit.getDate() + days);
  const limitISO = toISODate(limit);
  const today = toISODate(new Date());
  return open
    .filter((debt) => debt.dueDate && debt.dueDate >= today && debt.dueDate <= limitISO)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
}

export async function findOpenDebtForPerson(personId: string): Promise<DebtWithPerson | null> {
  const open = await listDebts();
  return open.find((debt) => debt.personId === personId) ?? null;
}

export async function settleDebt(id: string): Promise<void> {
  const debt = await getDebt(id);
  if (!debt) return;
  if (debt.remaining > 0) {
    await recordPayment({ debtId: id, amount: debt.remaining, note: 'Settled' });
  } else {
    const db = getDb();
    await db.update(debts).set({ status: 'settled', updatedAt: Date.now() }).where(eq(debts.id, id));
    notifyDbChanged();
  }
}

export async function debtPaymentTotals(): Promise<{ collected: number; paid: number }> {
  const db = getDb();
  const rows = await db
    .select({
      collected: sql<number>`coalesce(sum(CASE WHEN ${debts.direction} = 'lent' THEN ${debtPayments.amount} ELSE 0 END), 0)`,
      paid: sql<number>`coalesce(sum(CASE WHEN ${debts.direction} = 'borrowed' THEN ${debtPayments.amount} ELSE 0 END), 0)`,
    })
    .from(debtPayments)
    .leftJoin(debts, eq(debts.id, debtPayments.debtId));
  return { collected: Number(rows[0]?.collected ?? 0), paid: Number(rows[0]?.paid ?? 0) };
}

export async function personDebts(personId: string): Promise<DebtWithPerson[]> {
  const db = getDb();
  const rows = await db
    .select({ debt: debts, personName: people.name })
    .from(debts)
    .leftJoin(people, eq(people.id, debts.personId))
    .where(and(eq(debts.personId, personId)))
    .orderBy(asc(debts.date));
  return rows.map((row) => ({ ...row.debt, personName: row.personName ?? 'Unknown' }));
}
