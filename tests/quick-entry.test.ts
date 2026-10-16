import { describe, expect, it } from 'vitest';

import {
  answerCommand,
  buildQuestions,
  commandAmountMinor,
  commandRows,
  resolveQuickEntry,
  unresolvedFields,
} from '@/ai/commands/resolve';
import {
  coerceAmount,
  confirmationDecision,
  isSelfName,
  missingFields,
  parseAiCommand,
  type AiFinancialCommand,
} from '@/ai/commands/schema';
import type { QuickEntryLocalData } from '@/ai/commands/context';
import type { Account, Category, Goal, Person } from '@/db/schema';

/**
 * Quick Entry is a financial command interface: the model output must survive
 * strict validation, unknown names must become questions (never guesses), and
 * high-risk commands must never auto-save.
 */

function makeAccount(overrides: Partial<Account>): Account {
  return {
    id: 'acc',
    name: 'Account',
    type: 'bank',
    currency: 'INR',
    initialBalance: 0,
    currentBalance: 0,
    icon: null,
    color: null,
    institution: null,
    notes: null,
    groupId: null,
    sortOrder: 0,
    isArchived: false,
    includeInNetWorth: true,
    includeInTotalBalance: true,
    includeInCashFlow: true,
    visibleOnDashboard: true,
    hiddenFromTransactionCreation: false,
    creditLimit: null,
    statementDay: null,
    paymentDueDay: null,
    minimumPayment: null,
    interestRate: null,
    investmentType: null,
    costBasis: null,
    lastValuationDate: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Account;
}

function makeCategory(overrides: Partial<Category>): Category {
  return {
    id: 'cat',
    name: 'Category',
    icon: 'pricetag-outline',
    color: '#888888',
    parentId: null,
    type: 'expense',
    isSystem: false,
    isArchived: false,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Category;
}

function makeGoal(overrides: Partial<Goal>): Goal {
  return {
    id: 'goal',
    name: 'Goal',
    targetAmount: 100000,
    currentAmount: 0,
    targetDate: null,
    linkedAccountId: null,
    icon: 'flag-outline',
    color: '#FF3D8B',
    isArchived: false,
    notes: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Goal;
}

function makePerson(overrides: Partial<Person>): Person {
  return { id: 'person', name: 'Person', note: null, createdAt: 0, ...overrides } as Person;
}

function makeData(overrides: Partial<QuickEntryLocalData> = {}): QuickEntryLocalData {
  return {
    accounts: [
      makeAccount({ id: 'kotak', name: 'Kotak', type: 'bank', currentBalance: 4_825_000 }),
      makeAccount({ id: 'cash', name: 'Cash', type: 'cash', currentBalance: 120_000 }),
      makeAccount({ id: 'hdfc', name: 'HDFC Credit Card', type: 'credit_card', currentBalance: -500_000 }),
      makeAccount({ id: 'icici', name: 'Amazon ICICI Card', type: 'credit_card', currentBalance: -100_000 }),
    ],
    categories: [
      makeCategory({ id: 'food', name: 'Food & Dining', type: 'expense' }),
      makeCategory({ id: 'transport', name: 'Transport', type: 'expense' }),
      makeCategory({ id: 'salary', name: 'Salary', type: 'income' }),
    ],
    people: [makePerson({ id: 'rahul', name: 'Rahul' }), makePerson({ id: 'amit', name: 'Amit' })],
    goals: [makeGoal({ id: 'goa', name: 'Goa Trip' })],
    defaultAccountId: null,
    defaultCategoryId: null,
    currency: 'INR',
    numberGrouping: 'indian',
    monthStartDay: 1,
    ...overrides,
  };
}

function parse(json: unknown, today = '2026-10-07'): AiFinancialCommand {
  const result = parseAiCommand(JSON.stringify(json), { today, currency: 'INR' });
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result.command;
}

/* ------------------------------- Validation -------------------------------- */

describe('AI command schema', () => {
  it('accepts a well-formed expense and normalizes it', () => {
    const command = parse({
      intent: 'CREATE_TRANSACTION',
      transactionType: 'EXPENSE',
      amount: 450,
      currency: 'INR',
      merchant: 'Zomato',
      category: 'Food & Dining',
      account: 'Kotak',
      date: '2026-10-07',
      notes: null,
      confidence: 0.97,
    });
    expect(command.intent).toBe('CREATE_TRANSACTION');
    expect(command.amount).toBe(450);
    expect(commandAmountMinor(command)).toBe(45_000);
    expect(command.category).toBe('Food & Dining');
    expect(command.account).toBe('Kotak');
    expect(command.date).toBe('2026-10-07');
    expect(command.confidence).toBeCloseTo(0.97);
  });

  it('rejects malformed JSON, non-objects and unknown intents', () => {
    expect(parseAiCommand('not json at all').ok).toBe(false);
    expect(parseAiCommand('{"intent":"DELETE_EVERYTHING"}')).toEqual({ ok: false, reason: 'unsupported_intent' });
  });

  it('coerces amounts but never accepts zero, negatives or ₹10 crore+', () => {
    expect(coerceAmount('₹1,200.50')).toBe(1200.5);
    expect(parse({ intent: 'CREATE_TRANSACTION', transactionType: 'EXPENSE', amount: '450' }).amount).toBe(450);
    expect(parse({ intent: 'CREATE_TRANSACTION', transactionType: 'EXPENSE', amount: 0 }).amount).toBeNull();
    expect(parse({ intent: 'CREATE_TRANSACTION', transactionType: 'EXPENSE', amount: -50 }).amount).toBeNull();
    expect(parse({ intent: 'CREATE_TRANSACTION', transactionType: 'EXPENSE', amount: 999_999_999 }).amount).toBeNull();
  });

  it('validates dates against the local calendar and today', () => {
    expect(parse({ intent: 'CREATE_INCOME', amount: 1, date: '2026-02-31' }).date).toBeNull();
    expect(parse({ intent: 'CREATE_INCOME', amount: 1, date: '2026-10-06' }).date).toBe('2026-10-06');
    expect(parse({ intent: 'CREATE_INCOME', amount: 1, date: '2014-01-01' }).date).toBeNull();
  });

  it('derives the obvious transaction type from income/transfer intents', () => {
    expect(parse({ intent: 'CREATE_INCOME', amount: 42000 }).transactionType).toBe('INCOME');
    expect(parse({ intent: 'CREATE_TRANSFER', amount: 10000 }).transactionType).toBe('TRANSFER');
    expect(parse({ intent: 'CREATE_TRANSACTION', amount: 500 }).transactionType).toBe('EXPENSE');
  });

  it('treats a missing account as missing when no default exists — and never invents one', () => {
    const command = parse({ intent: 'CREATE_TRANSACTION', transactionType: 'EXPENSE', amount: 500 });
    expect(missingFields(command, { hasDefaultAccount: false })).toEqual(['account']);
    expect(missingFields(command, { hasDefaultAccount: true })).toEqual([]);
  });

  it('requires destination and person where the intent demands them', () => {
    expect(
      missingFields(parse({ intent: 'CREATE_TRANSFER', amount: 10000, account: 'Kotak' }), { hasDefaultAccount: false }),
    ).toContain('toAccount');
    expect(
      missingFields(parse({ intent: 'CREATE_LENDING', amount: 2000 }), { hasDefaultAccount: false }),
    ).toEqual(['person', 'account']);
    expect(
      missingFields(parse({ intent: 'CREATE_RECURRING', amount: 649, frequency: 'MONTHLY' }), { hasDefaultAccount: false }),
    ).toContain('merchant');
    expect(
      missingFields(parse({ intent: 'CREATE_GOAL_CONTRIBUTION', amount: 5000 }), { hasDefaultAccount: false }),
    ).toContain('goal');
    expect(
      missingFields(parse({ intent: 'CREATE_SHARED_EXPENSE', amount: 3000 }), { hasDefaultAccount: true }),
    ).toContain('account'); // the default account never satisfies a shared bill
  });
});

/* ------------------------------- Resolution -------------------------------- */

describe('local resolution (AI never guesses)', () => {
  it('matches account names exactly, then only when unambiguous', () => {
    const data = makeData();
    const exact = resolveQuickEntry(
      parse({ intent: 'CREATE_TRANSACTION', transactionType: 'EXPENSE', amount: 450, account: 'Kotak' }),
      data,
    );
    expect(exact.account?.id).toBe('kotak');

    const fuzzy = resolveQuickEntry(
      parse({ intent: 'CREATE_TRANSACTION', transactionType: 'EXPENSE', amount: 450, account: 'amazon icici' }),
      data,
    );
    expect(fuzzy.account?.id).toBe('icici');

    const unknown = resolveQuickEntry(
      parse({ intent: 'CREATE_TRANSACTION', transactionType: 'EXPENSE', amount: 450, account: 'SBI' }),
      data,
    );
    expect(unknown.account).toBeNull();
    expect(unknown.unknown.account).toBe('SBI');
    expect(unresolvedFields(unknown.command, unknown, data)).toContain('account');
  });

  it('applies the configured default account to transactions, never to debts', () => {
    const data = makeData({ defaultAccountId: 'kotak' });
    const expense = parse({ intent: 'CREATE_TRANSACTION', transactionType: 'EXPENSE', amount: 500 });
    const resolved = resolveQuickEntry(expense, data);
    expect(resolved.account?.id).toBe('kotak');
    expect(unresolvedFields(expense, resolved, data)).toEqual([]);

    const debt = parse({ intent: 'CREATE_LENDING', amount: 2000, person: 'Rahul' });
    const resolvedDebt = resolveQuickEntry(debt, data);
    expect(resolvedDebt.account).toBeNull();
    expect(commandRows(resolvedDebt, data).find((row) => row.label === 'Account')?.value).toContain('Track only');
  });

  it('drops categories from the wrong taxonomy instead of guessing', () => {
    const data = makeData();
    const wrong = resolveQuickEntry(
      parse({ intent: 'CREATE_TRANSACTION', transactionType: 'EXPENSE', amount: 450, category: 'Salary' }),
      data,
    );
    expect(wrong.category).toBeNull();
    expect(wrong.unknown.category).toBe('Salary');

    const right = resolveQuickEntry(
      parse({ intent: 'CREATE_TRANSACTION', transactionType: 'EXPENSE', amount: 450, category: 'food & dining' }),
      data,
    );
    expect(right.category?.id).toBe('food');
  });

  it('resolves people/groups and flags a settlement with an unknown person', () => {
    const data = makeData();
    const lending = resolveQuickEntry(
      parse({ intent: 'CREATE_LENDING', amount: 2000, person: 'Rahul' }),
      data,
    );
    expect(lending.counterparty?.personId).toBe('rahul');

    const settlement = resolveQuickEntry(
      parse({ intent: 'CREATE_SETTLEMENT', amount: 1000, person: 'Vivek' }),
      data,
    );
    expect(settlement.counterparty?.personId).toBeNull();
    expect(unresolvedFields(settlement.command, settlement, data)).toContain('person');
  });

  it('understands "split dinner between me, Rahul and Amit"', () => {
    const command = parse({
      intent: 'CREATE_SHARED_EXPENSE',
      amount: 2400,
      merchant: 'Dinner',
      account: 'Kotak',
      participants: ['me', 'Rahul', 'Amit'],
    });
    const resolved = resolveQuickEntry(command, makeData());
    expect(isSelfName('me')).toBe(true);
    expect(resolved.selfIncluded).toBe(true);
    expect(resolved.participants.map((entry) => entry.personId)).toEqual(['rahul', 'amit']);
    expect(unresolvedFields(command, resolved, makeData())).toEqual([]);
    const rows = commandRows(resolved, makeData());
    expect(rows.find((row) => row.label === 'Split between')?.value).toBe('You, Rahul, Amit');
    expect(rows.find((row) => row.label === 'Paid by')?.value).toBe('You');
  });

  it('requires at least one other person for a shared expense', () => {
    const command = parse({ intent: 'CREATE_SHARED_EXPENSE', amount: 300, participants: ['me'] });
    expect(missingFields(command, { hasDefaultAccount: true })).toContain('participants');
  });

  it('asks which account when two accounts share the same name (never guesses)', () => {
    const data = makeData({
      accounts: [
        makeAccount({ id: 'k1', name: 'Kotak Bank', type: 'bank', currentBalance: 4_995_000 }),
        makeAccount({ id: 'k2', name: 'Kotak Bank', type: 'savings', currentBalance: 0 }),
      ],
    });
    const command = parse({
      intent: 'CREATE_TRANSACTION',
      transactionType: 'EXPENSE',
      amount: 1200,
      account: 'Kotak Bank',
    });
    const resolved = resolveQuickEntry(command, data);
    expect(resolved.account).toBeNull();
    expect(resolved.unknown.account).toBe('Kotak Bank');
    expect(unresolvedFields(command, resolved, data)).toContain('account');

    const question = buildQuestions(command, resolved, data, ['account'])[0]!;
    expect(question.prompt).toBe('Which account is “Kotak Bank”?');
    expect(question.options).toHaveLength(2);
    // Balances distinguish the two identical names in the chips.
    expect(question.options.map((option) => option.subtitle)).toEqual(['₹49,950', '₹0']);
  });

  it('asks for the account on lending, with an explicit Track-only skip', () => {
    const data = makeData();
    const command = parse({ intent: 'CREATE_LENDING', amount: 2000, person: 'Rahul' });
    const resolved = resolveQuickEntry(command, data);
    const missing = unresolvedFields(command, resolved, data);
    expect(missing).toContain('account');

    const accountQuestion = buildQuestions(command, resolved, data, missing).find(
      (question) => question.field === 'account',
    )!;
    expect(accountQuestion.skippable).toBe(true);
    expect(accountQuestion.skipLabel).toBe('Track only — no cash movement');
    expect(accountQuestion.options.map((option) => option.label)).toContain('Kotak');

    // Choosing an account resolves it; the row becomes editable inline.
    const answered = answerCommand(command, accountQuestion, { optionId: 'kotak', optionLabel: 'Kotak' });
    const reResolved = resolveQuickEntry(answered, data);
    expect(reResolved.account?.id).toBe('kotak');
    expect(commandRows(reResolved, data).find((row) => row.label === 'Account')?.field).toBe('account');
  });

  it('keeps the kind of "Transfer money" ambiguous (asks for everything)', () => {
    const command = parse({ intent: 'CREATE_TRANSFER', amount: null, missing: ['amount', 'account', 'toAccount'] });
    const resolved = resolveQuickEntry(command, makeData());
    const missing = unresolvedFields(command, resolved, makeData());
    expect(missing).toEqual(expect.arrayContaining(['amount', 'account', 'toAccount']));
    const questions = buildQuestions(command, resolved, makeData(), missing);
    expect(questions.map((question) => question.field)).toEqual(expect.arrayContaining(['amount', 'account', 'toAccount']));
  });
});

/* -------------------------------- Questions -------------------------------- */

describe('clarification questions', () => {
  it('offers the local accounts as options for "Spent 500"', () => {
    const command = parse({ intent: 'CREATE_TRANSACTION', transactionType: 'EXPENSE', amount: 500 });
    const data = makeData();
    const resolved = resolveQuickEntry(command, data);
    const questions = buildQuestions(command, resolved, data, unresolvedFields(command, resolved, data));
    const account = questions.find((question) => question.field === 'account');
    expect(account?.prompt).toBe('Which account?');
    expect(account?.options.map((option) => option.label)).toEqual(['Kotak', 'Cash', 'HDFC Credit Card', 'Amazon ICICI Card']);
  });

  it('applies a chip answer locally without another AI call', () => {
    const command = parse({ intent: 'CREATE_TRANSACTION', transactionType: 'EXPENSE', amount: 500 });
    const data = makeData();
    const resolved = resolveQuickEntry(command, data);
    const question = buildQuestions(command, resolved, data, unresolvedFields(command, resolved, data))[0]!;
    const answered = answerCommand(command, question, { optionId: 'kotak', optionLabel: 'Kotak' });
    expect(answered.account).toBe('Kotak');
    const reResolved = resolveQuickEntry(answered, data);
    expect(reResolved.account?.id).toBe('kotak');
    expect(unresolvedFields(answered, reResolved, data)).toEqual([]);
  });

  it('accepts free-text amounts, names and comma-separated participants', () => {
    const money = answerCommand(
      parse({ intent: 'CREATE_TRANSACTION', transactionType: 'EXPENSE' }),
      { field: 'amount', prompt: '', help: null, options: [], allowFreeText: true, multi: false, skippable: false, skipLabel: null },
      { text: '450' },
    );
    expect(money.amount).toBe(450);

    const participants = answerCommand(
      parse({ intent: 'CREATE_SHARED_EXPENSE', amount: 3000 }),
      { field: 'participants', prompt: '', help: null, options: [], allowFreeText: true, multi: true, skippable: false, skipLabel: null },
      { labels: ['Rahul'], text: 'Amit' },
    );
    expect(participants.participants).toEqual(['Rahul', 'Amit']);
  });
});

/* ------------------------------- Confirmation ------------------------------ */

describe('confirmation policy (trusted quick entry stays safe)', () => {
  const expense = (overrides: Partial<AiFinancialCommand> = {}): AiFinancialCommand =>
    parse({
      intent: 'CREATE_TRANSACTION',
      transactionType: 'EXPENSE',
      amount: 450,
      account: 'Kotak',
      confidence: 0.95,
      ...overrides,
    });

  it('ALWAYS confirms everything', () => {
    expect(confirmationDecision({ mode: 'always', command: expense(), amountMinor: 45_000 })).toBe('full_confirm');
  });

  it('SMART uses a compact card for simple expenses only', () => {
    expect(confirmationDecision({ mode: 'smart', command: expense(), amountMinor: 45_000 })).toBe('compact_confirm');
    const transfer = parse({ intent: 'CREATE_TRANSFER', amount: 10000, account: 'Kotak', toAccount: 'Cash' });
    expect(confirmationDecision({ mode: 'smart', command: transfer, amountMinor: 1_000_000 })).toBe('full_confirm');
  });

  it('AUTO saves only low-risk, high-confidence commands', () => {
    expect(confirmationDecision({ mode: 'auto', command: expense(), amountMinor: 45_000 })).toBe('auto_save');
    expect(confirmationDecision({ mode: 'auto', command: expense({ confidence: 0.4 }), amountMinor: 45_000 })).toBe('compact_confirm');
  });

  it('never auto-saves high-risk actions or large amounts', () => {
    const transfer = parse({ intent: 'CREATE_TRANSFER', amount: 10000, account: 'Kotak', toAccount: 'Cash' });
    expect(confirmationDecision({ mode: 'auto', command: transfer, amountMinor: 1_000_000 })).toBe('full_confirm');

    const lending = parse({ intent: 'CREATE_LENDING', amount: 2000, person: 'Rahul' });
    expect(confirmationDecision({ mode: 'auto', command: lending, amountMinor: 200_000 })).toBe('full_confirm');

    const settlement = parse({ intent: 'CREATE_SETTLEMENT', amount: 1000, person: 'Rahul' });
    expect(confirmationDecision({ mode: 'auto', command: settlement, amountMinor: 100_000 })).toBe('full_confirm');

    const shared = parse({ intent: 'CREATE_SHARED_EXPENSE', amount: 2400, participants: ['me', 'Rahul', 'Amit'] });
    expect(confirmationDecision({ mode: 'auto', command: shared, amountMinor: 240_000 })).toBe('full_confirm');

    const bigExpense = expense({ amount: 12000 });
    expect(confirmationDecision({ mode: 'auto', command: bigExpense, amountMinor: 1_200_000 })).toBe('full_confirm');
  });
});
