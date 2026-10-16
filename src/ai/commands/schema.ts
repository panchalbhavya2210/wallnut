/**
 * Strict schema for AI-produced financial commands.
 *
 * The model NEVER writes to the database. It converts one natural-language
 * sentence into exactly one of these validated structures; the domain layer
 * then resolves names against local data, asks for anything missing, and only
 * calls the existing financial services once the user is in control.
 *
 * Everything in this file is pure so the schema can be unit-tested without a
 * database, a network or React Native.
 */

import { fromISODate, toISODate } from '@/utils/date';

/* --------------------------------- Intents --------------------------------- */

export const AI_COMMAND_INTENTS = [
  'CREATE_TRANSACTION',
  'CREATE_INCOME',
  'CREATE_TRANSFER',
  'CREATE_SHARED_EXPENSE',
  'CREATE_LOAN',
  'CREATE_LENDING',
  'CREATE_SETTLEMENT',
  'CREATE_RECURRING',
  'CREATE_GOAL_CONTRIBUTION',
  'UNKNOWN',
] as const;
export type AiCommandIntent = (typeof AI_COMMAND_INTENTS)[number];

export const AI_TRANSACTION_TYPES = ['EXPENSE', 'INCOME', 'REFUND', 'TRANSFER'] as const;
export type AiTransactionType = (typeof AI_TRANSACTION_TYPES)[number];

export const AI_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type AiFrequency = (typeof AI_FREQUENCIES)[number];

/** Fields that can be missing and therefore need a clarification question. */
export const AI_MISSING_FIELDS = [
  'amount',
  'transactionType',
  'merchant',
  'account',
  'toAccount',
  'person',
  'participants',
  'goal',
  'frequency',
] as const;
export type AiMissingField = (typeof AI_MISSING_FIELDS)[number];

export interface AiFinancialCommand {
  intent: AiCommandIntent;
  transactionType: AiTransactionType | null;
  /** Major units exactly as the model read them (rupees for INR). */
  amount: number | null;
  currency: string | null;
  merchant: string | null;
  /** Category NAME from the provided list — never invented. */
  category: string | null;
  /** Account NAME from the provided list — never invented. */
  account: string | null;
  /** Destination account name for transfers. */
  toAccount: string | null;
  /** Single counterparty name (lending, borrowing, settlement). */
  person: string | null;
  /** Shared-expense participants (names; "me"/"you" for the user). */
  participants: string[] | null;
  /** Goal name from the provided list. */
  goal: string | null;
  /** YYYY-MM-DD in the device's local timezone. */
  date: string | null;
  frequency: AiFrequency | null;
  notes: string | null;
  /** 0–1; low confidence is surfaced but never blocks a confirmation. */
  confidence: number;
  /** Fields the model itself flagged as missing (recomputed locally too). */
  reportedMissing: AiMissingField[];
}

export interface AiCommandParseOptions {
  /** Today in local time (YYYY-MM-DD) — the anchor for relative dates. */
  today?: string;
  /** Fallback currency when the model omits it. */
  currency?: string;
}

export type AiCommandParseResult =
  | { ok: true; command: AiFinancialCommand }
  | { ok: false; reason: 'malformed_json' | 'not_an_object' | 'unsupported_intent' };

/** ₹10 crore cap — anything above is treated as a model mistake, never saved. */
export const MAX_COMMAND_AMOUNT_MAJOR = 100_000_000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------- JSON intake ------------------------------- */

/** Extracts the first JSON object from a model response (defensive). */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* ------------------------------- Coercion ---------------------------------- */

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/** Accepts numbers and numeric strings ("450", "₹1,200.50", "1,200"). */
export function coerceAmount(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[₹,\s]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function coerceEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return (allowed as readonly string[]).includes(upper) ? (upper as T) : null;
}

function coerceDate(value: unknown, today: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!DATE_RE.test(trimmed)) return null;
  const parsed = fromISODate(trimmed);
  if (!parsed) return null;
  // Round-trip guard: 2026-02-31 must not silently become March 3rd.
  if (toISODate(parsed) !== trimmed) return null;
  const anchor = fromISODate(today) ?? new Date();
  const min = new Date(anchor.getFullYear() - 10, anchor.getMonth(), anchor.getDate());
  const max = new Date(anchor.getFullYear() + 5, anchor.getMonth(), anchor.getDate());
  if (parsed < min || parsed > max) return null;
  return trimmed;
}

function coerceConfidence(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.min(1, Math.max(0, parsed));
}

function coerceMissing(value: unknown): AiMissingField[] {
  if (!Array.isArray(value)) return [];
  const fields = new Set<AiMissingField>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const normalized = entry.trim().toLowerCase();
    if ((AI_MISSING_FIELDS as readonly string[]).includes(normalized)) {
      fields.add(normalized as AiMissingField);
    }
  }
  return Array.from(fields);
}

/* --------------------------------- Parsing --------------------------------- */

/**
 * Parses and validates raw provider output into an `AiFinancialCommand`.
 * Unknown keys are dropped, wrong types become null, and an out-of-list
 * intent is rejected outright — malformed output is never executed.
 */
export function parseAiCommand(text: string, options: AiCommandParseOptions = {}): AiCommandParseResult {
  const today = options.today ?? toISODate(new Date());
  const raw = extractJsonObject(text);
  if (raw === null) return { ok: false, reason: 'malformed_json' };
  if (!isRecord(raw)) return { ok: false, reason: 'not_an_object' };

  const rawIntent = typeof raw.intent === 'string' ? raw.intent.trim().toUpperCase() : '';
  if (!(AI_COMMAND_INTENTS as readonly string[]).includes(rawIntent)) {
    return { ok: false, reason: 'unsupported_intent' };
  }
  const intent = rawIntent as AiCommandIntent;

  let transactionType = coerceEnum(raw.transactionType, AI_TRANSACTION_TYPES);
  // The intent list deliberately separates income transfers; a plain
  // CREATE_TRANSACTION without a type is an expense by convention.
  if (!transactionType && intent === 'CREATE_TRANSACTION') transactionType = 'EXPENSE';
  if (!transactionType && intent === 'CREATE_INCOME') transactionType = 'INCOME';
  if (!transactionType && intent === 'CREATE_TRANSFER') transactionType = 'TRANSFER';
  if (!transactionType && intent === 'CREATE_RECURRING') transactionType = 'EXPENSE';

  const amount = coerceAmount(raw.amount);
  const currency = cleanString(raw.currency, 3)?.toUpperCase() ?? null;
  const participants = Array.isArray(raw.participants)
    ? raw.participants
        .map((entry) => cleanString(entry, 80))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, 12)
    : null;

  const command: AiFinancialCommand = {
    intent,
    transactionType,
    amount: amount !== null && amount > 0 && amount <= MAX_COMMAND_AMOUNT_MAJOR ? amount : null,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : (options.currency ?? null),
    merchant: cleanString(raw.merchant, 120),
    category: cleanString(raw.category, 120),
    account: cleanString(raw.account, 120),
    toAccount: cleanString(raw.toAccount, 120),
    person: cleanString(raw.person, 120),
    participants: participants && participants.length > 0 ? participants : null,
    goal: cleanString(raw.goal, 120),
    date: coerceDate(raw.date, today),
    frequency: coerceEnum(raw.frequency, AI_FREQUENCIES),
    notes: cleanString(raw.notes, 500),
    confidence: coerceConfidence(raw.confidence),
    reportedMissing: coerceMissing(raw.missing),
  };

  return { ok: true, command };
}

/* ---------------------------- Required / missing ---------------------------- */

export interface CommandResolutionFacts {
  /** True when the user configured a default account in Settings → Finance. */
  hasDefaultAccount: boolean;
  /** True when a default expense/income category is configured. */
  hasDefaultCategory: boolean;
}

/**
 * The fields this command must have before it may be executed. Dates default
 * to today and categories are optional by design (Wallnut may suggest one),
 * so neither appears here.
 */
export function requiredFields(
  command: AiFinancialCommand,
  options: { hasDefaultAccount: boolean },
): AiMissingField[] {
  if (command.intent === 'UNKNOWN') return [];
  if (command.intent === 'CREATE_TRANSFER') {
    return ['amount', 'account', 'toAccount'];
  }
  if (command.intent === 'CREATE_SHARED_EXPENSE') {
    return ['amount', 'account', 'participants'];
  }
  if (command.intent === 'CREATE_LENDING' || command.intent === 'CREATE_LOAN' || command.intent === 'CREATE_SETTLEMENT') {
    // The account is asked for (with an explicit "Track only" skip): money
    // usually moves, but Wallnut never guesses which balance did.
    return ['amount', 'person', 'account'];
  }
  if (command.intent === 'CREATE_RECURRING') {
    const fields: AiMissingField[] = ['amount', 'merchant', 'account', 'frequency'];
    if (command.transactionType === 'TRANSFER') fields.push('toAccount');
    return fields;
  }
  if (command.intent === 'CREATE_GOAL_CONTRIBUTION') {
    return ['amount', 'goal'];
  }
  // CREATE_TRANSACTION / CREATE_INCOME
  return options.hasDefaultAccount ? ['amount', 'transactionType'] : ['amount', 'transactionType', 'account'];
}

/** Which required fields are still absent, given the command as it stands. */
export function missingFields(command: AiFinancialCommand, options: { hasDefaultAccount: boolean }): AiMissingField[] {
  // The configured default account only satisfies transaction-like intents;
  // shared bills and debts must always ask (or be consciously skipped).
  const defaultApplies =
    command.intent === 'CREATE_TRANSACTION' ||
    command.intent === 'CREATE_INCOME' ||
    command.intent === 'CREATE_TRANSFER' ||
    command.intent === 'CREATE_RECURRING';
  const effective = { hasDefaultAccount: options.hasDefaultAccount && defaultApplies };
  const missing = new Set<AiMissingField>();
  for (const field of requiredFields(command, effective)) {
    switch (field) {
      case 'amount':
        if (command.amount === null) missing.add(field);
        break;
      case 'transactionType':
        if (command.transactionType === null) missing.add(field);
        break;
      case 'account':
        if (!command.account && !effective.hasDefaultAccount) missing.add(field);
        break;
      case 'toAccount':
        if (!command.toAccount) missing.add(field);
        break;
      case 'person':
        if (!command.person) missing.add(field);
        break;
      case 'merchant':
        if (!command.merchant) missing.add(field);
        break;
      case 'participants':
        if (!command.participants || command.participants.length === 0) missing.add(field);
        break;
      case 'goal':
        if (!command.goal) missing.add(field);
        break;
      case 'frequency':
        if (!command.frequency) missing.add(field);
        break;
    }
  }
  // "Split dinner between me and Rahul" must name at least one other person.
  if (command.intent === 'CREATE_SHARED_EXPENSE' && command.participants) {
    const others = command.participants.filter((name) => !isSelfName(name));
    if (others.length === 0 && !missing.has('participants')) missing.add('participants');
  }
  /** The model may flag fields it was unsure about; keep those too. */
  for (const field of command.reportedMissing) {
    if (!missing.has(field) && isMissingNow(command, field, effective)) missing.add(field);
  }
  return Array.from(missing);
}

function isMissingNow(
  command: AiFinancialCommand,
  field: AiMissingField,
  options: { hasDefaultAccount: boolean },
): boolean {
  switch (field) {
    case 'amount':
      return command.amount === null;
    case 'transactionType':
      return command.transactionType === null;
    case 'merchant':
      return !command.merchant;
    case 'account':
      return !command.account && !options.hasDefaultAccount;
    case 'toAccount':
      return !command.toAccount;
    case 'person':
      return !command.person;
    case 'participants':
      return !command.participants || command.participants.length === 0;
    case 'goal':
      return !command.goal;
    case 'frequency':
      return !command.frequency;
  }
}

export function isSelfName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === 'me' || normalized === 'you' || normalized === 'myself' || normalized === 'i';
}

/* ------------------------------ Confirmation ------------------------------- */

export type ConfirmationMode = 'always' | 'smart' | 'auto';
export type ConfirmationDecision = 'full_confirm' | 'compact_confirm' | 'auto_save';

/** Transfers, debts, splits and large amounts always get a confirmation. */
export const LARGE_TRANSACTION_MINOR = 1_000_000; // ₹10,000

export function commandRisk(command: AiFinancialCommand, amountMinor: number | null): 'high' | 'low' {
  if (command.intent !== 'CREATE_TRANSACTION' && command.intent !== 'CREATE_INCOME') return 'high';
  if (amountMinor !== null && Math.abs(amountMinor) >= LARGE_TRANSACTION_MINOR) return 'high';
  return 'low';
}

/**
 * ALWAYS  → full review card for everything.
 * SMART   → compact one-tap confirmation for simple, low-risk commands; full
 *           review for transfers/debts/splits/large amounts.
 * AUTO    → trusted quick entry: low-risk, high-confidence commands save
 *           immediately (with undo); everything else confirms.
 * Destructive/high-risk actions are NEVER auto-saved in any mode.
 */
export function confirmationDecision(input: {
  mode: ConfirmationMode;
  command: AiFinancialCommand;
  amountMinor: number | null;
}): ConfirmationDecision {
  const risk = commandRisk(input.command, input.amountMinor);
  if (input.mode === 'always') return 'full_confirm';
  if (risk === 'high') return 'full_confirm';
  if (input.mode === 'smart') return 'compact_confirm';
  // AUTO: only genuinely simple, confidently-parsed commands skip the card.
  return input.command.confidence >= 0.8 ? 'auto_save' : 'compact_confirm';
}

/** Short one-line description used by the compact confirmation card. */
export function commandSummary(command: AiFinancialCommand): string {
  switch (command.intent) {
    case 'CREATE_TRANSFER':
      return `Transfer ${command.account ?? '?'} → ${command.toAccount ?? '?'}`;
    case 'CREATE_LENDING':
      return `Lent to ${command.person ?? '?'}`;
    case 'CREATE_LOAN':
      return `Borrowed from ${command.person ?? '?'}`;
    case 'CREATE_SETTLEMENT':
      return `Settlement with ${command.person ?? '?'}`;
    case 'CREATE_SHARED_EXPENSE':
      return `Shared expense with ${(command.participants ?? []).filter((name) => !isSelfName(name)).join(', ') || '?'}`;
    case 'CREATE_RECURRING':
      return `${command.merchant ?? 'Recurring'} · ${command.frequency ? frequencyLabel(command.frequency) : '?'}`;
    case 'CREATE_GOAL_CONTRIBUTION':
      return `Goal contribution · ${command.goal ?? '?'}`;
    case 'CREATE_INCOME':
      return `Income${command.merchant ? ` · ${command.merchant}` : ''}`;
    case 'CREATE_TRANSACTION':
      return `Expense${command.merchant ? ` · ${command.merchant}` : ''}`;
    default:
      return 'Not understood';
  }
}

export function frequencyLabel(frequency: AiFrequency): string {
  switch (frequency) {
    case 'DAILY':
      return 'daily';
    case 'WEEKLY':
      return 'weekly';
    case 'YEARLY':
      return 'yearly';
    case 'MONTHLY':
    default:
      return 'monthly';
  }
}
