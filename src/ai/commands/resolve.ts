import { formatMoney } from '@/utils/money';
import { fromISODate, formatDayLabel, toISODate } from '@/utils/date';

import {
  coerceAmount,
  isSelfName,
  MAX_COMMAND_AMOUNT_MAJOR,
  missingFields as missingRequired,
  type AiFinancialCommand,
  type AiFrequency,
  type AiMissingField,
} from './schema';
import type { QuickEntryLocalData } from './context';
import type { Account, Category, Goal } from '@/db/schema';

/**
 * Local resolution: maps the model's NAME-based command onto real Wallnut rows
 * and decides what still needs asking.
 *
 * Pure on purpose — it receives the local data, never queries it — so the
 * "never guess" rules are unit-testable. Unknown names are reported, not
 * invented; Wallnut defaults apply only where the user configured them.
 */

export interface ResolvedPerson {
  personId: string | null;
  name: string;
}

export interface ResolvedQuickEntry {
  command: AiFinancialCommand;
  account: Account | null;
  toAccount: Account | null;
  category: Category | null;
  /** The single counterparty for lending/borrowing/settlement. */
  counterparty: ResolvedPerson | null;
  /** Shared-expense participants excluding the user. */
  participants: ResolvedPerson[];
  /** True when the sentence puts the user in the split (or nothing says otherwise). */
  selfIncluded: boolean;
  goal: Goal | null;
  /** Names the model returned that do not exist locally. */
  unknown: {
    account: string | null;
    toAccount: string | null;
    category: string | null;
    goal: string | null;
  };
}

/** Case-insensitive exact match, then a unique substring match. */
export function matchByName<T>(name: string, items: T[], getName: (item: T) => string): T | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const exact = items.filter((item) => getName(item).trim().toLowerCase() === needle);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const partial = items.filter((item) => {
    const candidate = getName(item).trim().toLowerCase();
    return candidate.includes(needle) || needle.includes(candidate);
  });
  return partial.length === 1 ? partial[0]! : null;
}

function toMinor(command: AiFinancialCommand): number | null {
  if (command.amount === null) return null;
  if (!Number.isFinite(command.amount) || command.amount <= 0) return null;
  if (command.amount > MAX_COMMAND_AMOUNT_MAJOR) return null;
  return Math.round(command.amount * 100);
}

export function commandAmountMinor(command: AiFinancialCommand): number | null {
  return toMinor(command);
}

/* ------------------------------- Resolution -------------------------------- */

export function resolveQuickEntry(command: AiFinancialCommand, data: QuickEntryLocalData): ResolvedQuickEntry {
  const intent = command.intent;
  const isShared = intent === 'CREATE_SHARED_EXPENSE';
  const isDebt = intent === 'CREATE_LENDING' || intent === 'CREATE_LOAN' || intent === 'CREATE_SETTLEMENT';
  const isGoal = intent === 'CREATE_GOAL_CONTRIBUTION';

  // Account: the sentence first; the configured default only for ordinary
  // transactions and schedules — never for debt, settlement or shared bills,
  // where moving cash is a decision the user must make explicitly.
  const canUseDefaultAccount = !isDebt && !isShared && !isGoal;
  const defaultAccount = canUseDefaultAccount
    ? (data.accounts.find((account) => account.id === data.defaultAccountId) ?? null)
    : null;
  const account = command.account
    ? matchByName(command.account, data.accounts, (entry) => entry.name)
    : defaultAccount;
  const toAccount = command.toAccount ? matchByName(command.toAccount, data.accounts, (entry) => entry.name) : null;

  // Category: only when it matches the transaction's taxonomy, else the
  // configured default; unknown names are reported and dropped.
  const wantsIncome = command.transactionType === 'INCOME' || command.intent === 'CREATE_INCOME';
  const taxonomy: 'expense' | 'income' = wantsIncome ? 'income' : 'expense';
  const matchedCategory = command.category
    ? matchByName(command.category, data.categories, (entry) => entry.name)
    : null;
  const categoryIsUsable = matchedCategory && matchedCategory.type === taxonomy && !matchedCategory.isArchived;
  const defaultCategory = data.categories.find(
    (entry) => entry.id === data.defaultCategoryId && entry.type === taxonomy && !entry.isArchived,
  );
  const category = categoryIsUsable ? matchedCategory : (!command.category ? (defaultCategory ?? null) : null);

  const counterparty = command.person
    ? {
        personId: matchByName(command.person, data.people, (entry) => entry.name)?.id ?? null,
        name: command.person.trim(),
      }
    : null;

  const rawParticipants = (command.participants ?? []).filter((name) => !isSelfName(name));
  const participants: ResolvedPerson[] = rawParticipants.map((name) => ({
    personId: matchByName(name, data.people, (entry) => entry.name)?.id ?? null,
    name: name.trim(),
  }));
  const selfIncluded = isShared && ((command.participants ?? []).some(isSelfName) || participants.length === 0);

  const goal = command.goal ? matchByName(command.goal, data.goals, (entry) => entry.name) : null;

  return {
    command,
    account,
    toAccount,
    category,
    counterparty,
    participants,
    selfIncluded,
    goal,
    unknown: {
      account: command.account && !account ? command.account : null,
      toAccount: command.toAccount && !toAccount ? command.toAccount : null,
      category: command.category && !categoryIsUsable ? command.category : null,
      goal: command.goal && !goal ? command.goal : null,
    },
  };
}

/**
 * Everything still required before the command can be executed. Combines the
 * schema requirements with what local resolution could not find, so a name the
 * model invented becomes a question — never a silent guess.
 */
export function unresolvedFields(
  command: AiFinancialCommand,
  resolved: ResolvedQuickEntry,
  data: QuickEntryLocalData,
): AiMissingField[] {
  const missing = new Set(missingRequired(command, { hasDefaultAccount: Boolean(data.defaultAccountId) }));
  if (command.account && !resolved.account) missing.add('account');
  if (command.toAccount && !resolved.toAccount) missing.add('toAccount');
  if (command.goal && !resolved.goal) missing.add('goal');
  if (command.intent === 'CREATE_SETTLEMENT' && command.person && !resolved.counterparty?.personId) {
    missing.add('person');
  }
  if (command.amount !== null && toMinor(command) === null) missing.add('amount');
  return Array.from(missing);
}

/* -------------------------------- Questions -------------------------------- */

export interface QuickEntryQuestionOption {
  id: string;
  label: string;
  subtitle: string | null;
}

export interface QuickEntryQuestion {
  field: AiMissingField | 'category';
  prompt: string;
  help: string | null;
  options: QuickEntryQuestionOption[];
  allowFreeText: boolean;
  multi: boolean;
  /** True when the user may consciously skip the field ("Track only"). */
  skippable: boolean;
  skipLabel: string | null;
}

function accountOptions(data: QuickEntryLocalData): QuickEntryQuestionOption[] {
  return data.accounts.map((account) => ({
    id: account.id,
    label: account.name,
    subtitle: formatMoney(account.currentBalance, {
      currency: data.currency,
      grouping: data.numberGrouping,
      decimals: 'auto',
    }),
  }));
}

/**
 * One question at a time for whatever is missing. Options come from local
 * data (accounts, categories, people, goals) exactly like the spec's
 * [ Kotak ] [ Cash ] [ HDFC Card ] chips.
 */
export function buildQuestions(
  command: AiFinancialCommand,
  resolved: ResolvedQuickEntry,
  data: QuickEntryLocalData,
  missing: AiMissingField[],
): QuickEntryQuestion[] {
  const questions: QuickEntryQuestion[] = [];
  const isDebt = command.intent === 'CREATE_LENDING' || command.intent === 'CREATE_LOAN';
  const isSetup = command.intent === 'CREATE_SETTLEMENT';
  const canTrackOnly = isDebt || isSetup || command.intent === 'CREATE_GOAL_CONTRIBUTION';

  for (const field of missing) {
    switch (field) {
      case 'amount':
        questions.push({
          field,
          prompt: 'How much was it?',
          help: null,
          options: [],
          allowFreeText: true,
          multi: false,
          skippable: false,
          skipLabel: null,
        });
        break;
      case 'transactionType':
        questions.push({
          field,
          prompt: 'Money in or out?',
          help: null,
          options: [
            { id: 'EXPENSE', label: 'Expense', subtitle: 'Money out' },
            { id: 'INCOME', label: 'Income', subtitle: 'Money in' },
          ],
          allowFreeText: false,
          multi: false,
          skippable: false,
          skipLabel: null,
        });
        break;
      case 'merchant':
        questions.push({
          field,
          prompt: 'What is this called?',
          help: 'e.g. Netflix',
          options: [],
          allowFreeText: true,
          multi: false,
          skippable: false,
          skipLabel: null,
        });
        break;
      case 'account':
        questions.push({
          field,
          prompt: resolved.unknown.account
            ? `Which account is “${resolved.unknown.account}”?`
            : 'Which account?',
          help: resolved.unknown.account ? 'It did not match exactly one of your accounts.' : null,
          options: accountOptions(data),
          allowFreeText: false,
          multi: false,
          skippable: canTrackOnly,
          skipLabel: 'Track only — no cash movement',
        });
        break;
      case 'toAccount':
        questions.push({
          field,
          prompt: resolved.unknown.toAccount
            ? `Where should “${resolved.unknown.toAccount}” go?`
            : 'Where should it go?',
          help: null,
          options: accountOptions(data).filter((option) => option.id !== resolved.account?.id),
          allowFreeText: false,
          multi: false,
          skippable: false,
          skipLabel: null,
        });
        break;
      case 'person':
        questions.push({
          field,
          prompt: isSetup ? 'Who paid you back?' : 'Who is this with?',
          help: null,
          options: data.people.map((person) => ({ id: person.id, label: person.name, subtitle: null })),
          allowFreeText: true,
          multi: false,
          skippable: false,
          skipLabel: null,
        });
        break;
      case 'participants':
        questions.push({
          field,
          prompt: 'Who is the bill split between?',
          help: 'Add every person including yourself, e.g. "Me, Rahul, Amit"',
          options: data.people.map((person) => ({ id: person.id, label: person.name, subtitle: null })),
          allowFreeText: true,
          multi: true,
          skippable: false,
          skipLabel: null,
        });
        break;
      case 'goal':
        questions.push({
          field,
          prompt: resolved.unknown.goal ? `Which goal is “${resolved.unknown.goal}”?` : 'Which goal?',
          help: null,
          options: data.goals
            .filter((goal) => !goal.isArchived)
            .map((goal) => ({ id: goal.id, label: goal.name, subtitle: null })),
          allowFreeText: false,
          multi: false,
          skippable: false,
          skipLabel: null,
        });
        break;
      case 'frequency':
        questions.push({
          field,
          prompt: 'How often?',
          help: null,
          options: [
            { id: 'DAILY', label: 'Daily', subtitle: null },
            { id: 'WEEKLY', label: 'Weekly', subtitle: null },
            { id: 'MONTHLY', label: 'Monthly', subtitle: null },
            { id: 'YEARLY', label: 'Yearly', subtitle: null },
          ],
          allowFreeText: false,
          multi: false,
          skippable: false,
          skipLabel: null,
        });
        break;
    }
  }
  return questions;
}

export interface QuestionAnswer {
  /** Option chosen from the question's list. */
  optionId?: string;
  optionLabel?: string;
  /** Free text (amount, merchant, person, comma-separated participants). */
  text?: string;
  /** Multi-select labels, plus an optional free-text addition. */
  labels?: string[];
}

const FREQUENCIES: AiFrequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

/** Applies the user's answer locally — no second AI call, no guessing. */
export function answerCommand(
  command: AiFinancialCommand,
  question: QuickEntryQuestion,
  answer: QuestionAnswer,
): AiFinancialCommand {
  const next: AiFinancialCommand = { ...command };
  const label = (answer.optionLabel ?? '').trim();
  const text = (answer.text ?? '').trim();
  switch (question.field) {
    case 'amount': {
      const parsed = coerceAmount(text || label);
      if (parsed !== null && parsed > 0 && parsed <= MAX_COMMAND_AMOUNT_MAJOR) next.amount = parsed;
      break;
    }
    case 'transactionType':
      if (answer.optionId === 'EXPENSE' || answer.optionId === 'INCOME') {
        next.transactionType = answer.optionId;
        next.intent = answer.optionId === 'INCOME' ? 'CREATE_INCOME' : 'CREATE_TRANSACTION';
      }
      break;
    case 'merchant':
      if (text) next.merchant = text;
      break;
    case 'account':
      if (label || text) next.account = label || text;
      break;
    case 'toAccount':
      if (label || text) next.toAccount = label || text;
      break;
    case 'person':
      if (label || text) next.person = label || text;
      break;
    case 'participants': {
      const labels = (answer.labels ?? []).map((entry) => entry.trim()).filter(Boolean);
      if (text) labels.push(...text.split(',').map((entry) => entry.trim()).filter(Boolean));
      if (labels.length > 0) next.participants = labels;
      break;
    }
    case 'goal':
      if (label || text) next.goal = label || text;
      break;
    case 'frequency': {
      const value = FREQUENCIES.find((frequency) => frequency === answer.optionId);
      if (value) next.frequency = value;
      break;
    }
    case 'category':
      if (label || text) next.category = label || text;
      break;
  }
  return next;
}

/* ------------------------------ Presentation ------------------------------- */

export interface CommandRow {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'muted';
  /** Which field the confirmation card may edit inline. */
  field?: 'account' | 'toAccount' | 'category' | 'date';
}

function money(data: QuickEntryLocalData, minor: number): string {
  return formatMoney(minor, { currency: data.currency, grouping: data.numberGrouping, decimals: 'auto' });
}

/**
 * The rows the confirmation card renders. Deliberately shows only what was
 * actually resolved — never an invented value.
 */
export function commandRows(resolved: ResolvedQuickEntry, data: QuickEntryLocalData): CommandRow[] {
  const { command } = resolved;
  const rows: CommandRow[] = [];
  const amount = toMinor(command);
  if (amount !== null) {
    rows.push({
      label: 'Amount',
      value: money(data, amount),
      tone: command.intent === 'CREATE_INCOME' ? 'positive' : command.intent === 'CREATE_TRANSFER' ? undefined : 'negative',
    });
  }
  if (command.merchant) rows.push({ label: 'Merchant', value: command.merchant });
  if (resolved.category) rows.push({ label: 'Category', value: resolved.category.name, field: 'category' });
  if (command.intent === 'CREATE_TRANSFER') {
    if (resolved.account) rows.push({ label: 'From', value: resolved.account.name, field: 'account' });
    if (resolved.toAccount) rows.push({ label: 'To', value: resolved.toAccount.name, field: 'toAccount' });
  } else if (resolved.account) {
    rows.push({ label: 'Account', value: resolved.account.name, field: 'account' });
  } else if (command.intent === 'CREATE_LENDING' || command.intent === 'CREATE_LOAN' || command.intent === 'CREATE_SETTLEMENT') {
    rows.push({ label: 'Account', value: 'Track only — no cash movement', tone: 'muted', field: 'account' });
  }
  if (resolved.counterparty) {
    rows.push({
      label: command.intent === 'CREATE_SETTLEMENT' ? 'With' : command.intent === 'CREATE_LOAN' ? 'From' : 'To',
      value: resolved.counterparty.name,
    });
  }
  if (command.intent === 'CREATE_SHARED_EXPENSE') {
    const names = [resolved.selfIncluded ? 'You' : null, ...resolved.participants.map((entry) => entry.name)]
      .filter(Boolean)
      .join(', ');
    rows.push({ label: 'Split between', value: names || '—' });
    rows.push({ label: 'Paid by', value: 'You' });
  }
  if (resolved.goal) rows.push({ label: 'Goal', value: resolved.goal.name });
  if (command.frequency) rows.push({ label: 'Repeats', value: command.frequency.toLowerCase() });
  const date = command.date ?? toISODate(new Date());
  const parsed = fromISODate(date);
  rows.push({ label: 'Date', value: parsed ? formatDayLabel(parsed) : date, field: 'date' });
  return rows;
}
