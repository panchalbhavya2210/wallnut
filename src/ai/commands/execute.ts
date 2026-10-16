import { addContribution } from '@/services/goals.service';
import { createDebt, createPerson, listDebts, recordPayment } from '@/services/debts.service';
import { createRecurring } from '@/services/recurring.service';
import { createSharedExpense } from '@/services/shared.service';
import { createTransaction, deleteTransaction } from '@/services/transactions.service';
import { toISODate } from '@/utils/date';
import { formatMoney } from '@/utils/money';

import { commandAmountMinor, unresolvedFields, type ResolvedQuickEntry } from './resolve';
import { commandSummary } from './schema';
import type { QuickEntryLocalData } from './context';
import type { TransactionType } from '@/db/schema';

/**
 * Execution of a fully-resolved, user-confirmed command.
 *
 * This step ONLY calls the existing financial services — the same functions the
 * manual composer uses. No SQL lives here, so transfers stay transfers, lending
 * stays a receivable, and balances/analytics/tests behave exactly as before.
 */

export interface ExecutionResult {
  kind: 'transaction' | 'debt' | 'settlement' | 'shared' | 'recurring' | 'goal';
  id: string;
  summary: string;
  /** Undo for plain transactions (uses the existing delete path). */
  undo?: () => Promise<void>;
}

/** Guards against a double-tap / repeated-send creating the same row twice. */
let lastSignature = '';
let lastSignatureAt = 0;
const DUPLICATE_WINDOW_MS = 15_000;

function signature(resolved: ResolvedQuickEntry, amountMinor: number): string {
  const { command } = resolved;
  return [
    command.intent,
    command.transactionType ?? '',
    amountMinor,
    command.date ?? toISODate(new Date()),
    command.merchant ?? '',
    resolved.account?.id ?? '',
    resolved.toAccount?.id ?? '',
    resolved.counterparty?.name ?? '',
    (command.participants ?? []).join(','),
    resolved.goal?.id ?? '',
  ].join('|');
}

function money(data: QuickEntryLocalData, minor: number): string {
  return formatMoney(minor, { currency: data.currency, grouping: data.numberGrouping, decimals: 'auto' });
}

export async function executeQuickEntry(
  resolved: ResolvedQuickEntry,
  data: QuickEntryLocalData,
): Promise<ExecutionResult> {
  const { command } = resolved;
  const amountMinor = commandAmountMinor(command);
  const stillMissing = unresolvedFields(command, resolved, data);
  if (stillMissing.length > 0) {
    throw new Error(`Still missing: ${stillMissing.join(', ')}.`);
  }

  const amount = amountMinor ?? 0;
  const date = command.date ?? toISODate(new Date());
  const sig = signature(resolved, amount);
  const now = Date.now();
  if (sig === lastSignature && now - lastSignatureAt < DUPLICATE_WINDOW_MS) {
    throw new Error('That command was just saved — ignored as a duplicate.');
  }

  const result = await run(resolved, data, amount, date);
  lastSignature = sig;
  lastSignatureAt = now;
  return result;
}

async function run(
  resolved: ResolvedQuickEntry,
  data: QuickEntryLocalData,
  amountMinor: number,
  date: string,
): Promise<ExecutionResult> {
  const { command } = resolved;
  switch (command.intent) {
    case 'CREATE_TRANSACTION':
    case 'CREATE_INCOME': {
      if (!resolved.account) throw new Error('Choose an account first.');
      const type: TransactionType =
        command.transactionType === 'INCOME' || command.intent === 'CREATE_INCOME'
          ? 'income'
          : command.transactionType === 'REFUND'
            ? 'refund'
            : 'expense';
      const created = await createTransaction({
        accountId: resolved.account.id,
        categoryId: resolved.category?.id ?? null,
        amount: amountMinor,
        type,
        merchant: command.merchant,
        date,
        notes: command.notes,
        isReviewed: true,
      });
      return {
        kind: 'transaction',
        id: created.id,
        summary: `${money(data, amountMinor)} · ${command.merchant ?? resolved.account.name}`,
        undo: () => deleteTransaction(created.id),
      };
    }

    case 'CREATE_TRANSFER': {
      if (!resolved.account || !resolved.toAccount) throw new Error('Choose both accounts first.');
      if (resolved.account.id === resolved.toAccount.id) {
        throw new Error('Transfer accounts must be different.');
      }
      const created = await createTransaction({
        accountId: resolved.account.id,
        amount: amountMinor,
        type: 'transfer',
        transferAccountId: resolved.toAccount.id,
        date,
        notes: command.notes,
        isReviewed: true,
      });
      return {
        kind: 'transaction',
        id: created.id,
        summary: `${money(data, amountMinor)} · ${resolved.account.name} → ${resolved.toAccount.name}`,
        undo: () => deleteTransaction(created.id),
      };
    }

    case 'CREATE_LENDING':
    case 'CREATE_LOAN': {
      if (!resolved.counterparty) throw new Error('Who is this with?');
      const direction = command.intent === 'CREATE_LENDING' ? 'lent' : 'borrowed';
      const debt = await createDebt({
        personId: resolved.counterparty.personId ?? undefined,
        personName: resolved.counterparty.personId ? undefined : resolved.counterparty.name,
        direction,
        amount: amountMinor,
        date,
        accountId: resolved.account?.id ?? null,
        description: command.notes,
      });
      const verb = direction === 'lent' ? 'Lent to' : 'Borrowed from';
      return {
        kind: 'debt',
        id: debt.id,
        summary: `${money(data, amountMinor)} · ${verb} ${resolved.counterparty.name}`,
      };
    }

    case 'CREATE_SETTLEMENT': {
      if (!resolved.counterparty) throw new Error('Who is this with?');
      const open = await listDebts();
      const matches = open
        .filter((debt) => {
          if (resolved.counterparty?.personId) return debt.personId === resolved.counterparty.personId;
          return debt.personName.trim().toLowerCase() === resolved.counterparty?.name.trim().toLowerCase();
        })
        .sort((a, b) => a.date.localeCompare(b.date));
      const debt = matches[0];
      if (!debt) {
        throw new Error(`No open debt with ${resolved.counterparty.name}.`);
      }
      await recordPayment({
        debtId: debt.id,
        amount: amountMinor,
        date,
        accountId: resolved.account?.id ?? null,
        note: command.notes,
      });
      const verb = debt.direction === 'lent' ? 'Collected from' : 'Repaid to';
      return {
        kind: 'settlement',
        id: debt.id,
        summary: `${money(data, amountMinor)} · ${verb} ${resolved.counterparty.name}`,
      };
    }

    case 'CREATE_SHARED_EXPENSE': {
      if (!resolved.account) throw new Error('Choose the account you paid from.');
      const participantIds: { personId: string | null }[] = [];
      if (resolved.selfIncluded) participantIds.push({ personId: null });
      for (const participant of resolved.participants) {
        const personId = participant.personId ?? (await createPerson({ name: participant.name })).id;
        participantIds.push({ personId });
      }
      if (participantIds.length < 2) {
        throw new Error('A shared bill needs at least one other person.');
      }
      const shared = await createSharedExpense({
        title: command.merchant ?? commandSummary(command),
        amount: amountMinor,
        date,
        categoryId: resolved.category?.id ?? null,
        accountId: resolved.account.id,
        notes: command.notes,
        splitType: 'equal',
        payers: [{ personId: null }],
        participants: participantIds,
      });
      const names = [resolved.selfIncluded ? 'You' : null, ...resolved.participants.map((entry) => entry.name)]
        .filter(Boolean)
        .join(', ');
      return {
        kind: 'shared',
        id: shared.id,
        summary: `${money(data, amountMinor)} · split between ${names}`,
      };
    }

    case 'CREATE_RECURRING': {
      if (!resolved.account) throw new Error('Choose an account first.');
      if (!command.merchant) throw new Error('Give this recurring payment a name.');
      if (!command.frequency) throw new Error('How often does it repeat?');
      const type = command.transactionType === 'TRANSFER' ? 'transfer' : command.transactionType === 'INCOME' ? 'income' : 'expense';
      const recurring = await createRecurring({
        merchant: command.merchant,
        description: command.notes,
        amount: amountMinor,
        type,
        categoryId: resolved.category?.id ?? null,
        accountId: resolved.account.id,
        transferAccountId: type === 'transfer' ? (resolved.toAccount?.id ?? null) : null,
        frequency: command.frequency.toLowerCase() as 'daily' | 'weekly' | 'monthly' | 'yearly',
        nextDate: date,
      });
      return {
        kind: 'recurring',
        id: recurring.id,
        summary: `${money(data, amountMinor)} · ${command.merchant} ${command.frequency.toLowerCase()}`,
      };
    }

    case 'CREATE_GOAL_CONTRIBUTION': {
      if (!resolved.goal) throw new Error('Choose a goal first.');
      await addContribution({
        goalId: resolved.goal.id,
        amount: amountMinor,
        accountId: resolved.account?.id ?? null,
        date,
        note: command.notes,
      });
      return {
        kind: 'goal',
        id: resolved.goal.id,
        summary: `${money(data, amountMinor)} · ${resolved.goal.name}`,
      };
    }

    default:
      throw new Error('Could not understand that. Try: Spent ₹450 at Zomato');
  }
}
