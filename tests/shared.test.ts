import { describe, expect, it } from 'vitest';

import { summarizeMovements } from '@/utils/ledger';
import { netWorthParts } from '@/utils/net-worth';
import {
  balanceTotals,
  computeMemberBalances,
  computePersonBalances,
  computeSplit,
  expenseUserNets,
  planSharedLedger,
  suggestSettlements,
  summarizeSharedItems,
  type ExpenseLedgerRecord,
  type SettlementRecord,
} from '@/utils/split';

/**
 * Shared-expense rules from the second product brief, including the multi-payer
 * trip scenario: four friends, two of them fronting different amounts, every
 * expense recorded with who actually paid. Balances must net out exactly.
 */

const record = (
  payers: { personId: string | null; amount: number }[],
  participants: { personId: string | null; share: number }[],
): ExpenseLedgerRecord => ({ payers, participants });

/** The four friends each consume a quarter of a ₹30,000 villa. */
const VILLA = 30_000_00;
const VILLA_SHARE = 7_500_00;
const villaParticipants = [
  { personId: null, share: VILLA_SHARE },
  { personId: 'rahul', share: VILLA_SHARE },
  { personId: 'amit', share: VILLA_SHARE },
  { personId: 'neha', share: VILLA_SHARE },
];
const villa = record(
  [
    { personId: null, amount: 20_000_00 },
    { personId: 'rahul', amount: 10_000_00 },
  ],
  villaParticipants,
);

describe('split allocations', () => {
  it('splits equally and keeps the paise (₹1,000 across 3 people)', () => {
    const shares = computeSplit(1_000_00, 'equal', [{ key: 'self' }, { key: 'rahul' }, { key: 'amit' }]);
    expect(shares.map((share) => share.amount)).toEqual([33_334, 33_333, 33_333]);
    expect(shares.reduce((sum, share) => sum + share.amount, 0)).toBe(1_000_00);
  });

  it('handles the dinner example: ₹4,000 across 4 people', () => {
    const shares = computeSplit(4_000_00, 'equal', [{ key: 'self' }, { key: 'a' }, { key: 'b' }, { key: 'c' }]);
    expect(shares.map((share) => share.amount)).toEqual([1_000_00, 1_000_00, 1_000_00, 1_000_00]);
  });

  it('accepts exact amounts that add up, and rejects the rest', () => {
    const shares = computeSplit(3_000_00, 'exact', [
      { key: 'self', value: 800_00 },
      { key: 'rahul', value: 1_200_00 },
      { key: 'amit', value: 1_000_00 },
    ]);
    expect(shares.map((share) => share.amount)).toEqual([800_00, 1_200_00, 1_000_00]);

    expect(() =>
      computeSplit(3_000_00, 'exact', [
        { key: 'self', value: 800_00 },
        { key: 'rahul', value: 1_000_00 },
      ]),
    ).toThrow(/less than the total/i);
  });

  it('accepts percentages that add to 100% and rejects the rest', () => {
    const shares = computeSplit(3_000_00, 'percentage', [
      { key: 'self', value: 5_000 },
      { key: 'rahul', value: 3_000 },
      { key: 'amit', value: 2_000 },
    ]);
    expect(shares.map((share) => share.amount)).toEqual([1_500_00, 900_00, 600_00]);
    expect(() =>
      computeSplit(3_000_00, 'percentage', [
        { key: 'self', value: 5_000 },
        { key: 'rahul', value: 4_000 },
      ]),
    ).toThrow(/100%/);
  });

  it('weights shares and rounds without losing a paisa', () => {
    const shares = computeSplit(3_000_00, 'shares', [
      { key: 'self', value: 2 },
      { key: 'rahul', value: 1 },
      { key: 'amit', value: 1 },
    ]);
    expect(shares.map((share) => share.amount)).toEqual([1_500_00, 750_00, 750_00]);

    const odd = computeSplit(100_00, 'shares', [
      { key: 'self', value: 1 },
      { key: 'rahul', value: 1 },
      { key: 'amit', value: 1 },
    ]);
    expect(odd.reduce((sum, share) => sum + share.amount, 0)).toBe(100_00);
  });

  it('requires at least two people and one entry per person', () => {
    expect(() => computeSplit(100_00, 'equal', [{ key: 'self' }])).toThrow(/two people/);
    expect(() => computeSplit(100_00, 'equal', [{ key: 'self' }, { key: 'self' }])).toThrow(/only once/);
  });
});

describe('ledger plan — shared expenses never inflate personal spending', () => {
  it('turns a self-paid bill into own-share expense + receivable', () => {
    const plan = planSharedLedger({ selfPaid: 4_000_00, selfShare: 1_000_00 });
    expect(plan.expenseAmount).toBe(1_000_00);
    expect(plan.receivableAmount).toBe(3_000_00);
    expect(plan.payableAmount).toBe(0);

    const summary = summarizeMovements([
      { type: 'expense', amount: -plan.expenseAmount },
      { type: 'lending', amount: -plan.receivableAmount },
    ]);
    expect(summary.netExpense).toBe(1_000_00);
    expect(summary.income).toBe(0);
    expect(summary.debtOutflow).toBe(3_000_00);

    const worth = netWorthParts({
      accounts: [{ id: 'bank', type: 'bank', currentBalance: 10_000_00 - 4_000_00, includeInNetWorth: true }],
      receivables: plan.receivableAmount,
    });
    expect(worth.netWorth).toBe(10_000_00 - 1_000_00);
  });

  it('handles a split payment: cash out is what you actually paid', () => {
    // Villa: bill ₹30,000, you paid ₹20,000, your share ₹7,500.
    const plan = planSharedLedger({ selfPaid: 20_000_00, selfShare: 7_500_00 });
    expect(plan.expenseAmount).toBe(7_500_00);
    expect(plan.receivableAmount).toBe(12_500_00);
    expect(plan.payableAmount).toBe(0);
    expect(plan.expenseAmount + plan.receivableAmount).toBe(20_000_00);

    const summary = summarizeMovements([
      { type: 'expense', amount: -plan.expenseAmount },
      { type: 'lending', amount: -plan.receivableAmount },
    ]);
    expect(summary.netExpense).toBe(7_500_00);
    expect(summary.savings).toBe(-7_500_00);
  });

  it('creates no cash movement when someone else paid — only a payable', () => {
    const plan = planSharedLedger({ selfPaid: 0, selfShare: 1_000_00 });
    expect(plan.expenseAmount).toBe(0);
    expect(plan.receivableAmount).toBe(0);
    expect(plan.payableAmount).toBe(1_000_00);

    const worth = netWorthParts({
      accounts: [{ id: 'bank', type: 'bank', currentBalance: 10_000_00, includeInNetWorth: true }],
      payables: plan.payableAmount,
    });
    expect(worth.netWorth).toBe(10_000_00 - 1_000_00);
  });

  it('books only the cash actually paid when your share is partly fronted', () => {
    const plan = planSharedLedger({ selfPaid: 500_00, selfShare: 1_500_00 });
    expect(plan.expenseAmount).toBe(500_00);
    expect(plan.receivableAmount).toBe(0);
    expect(plan.payableAmount).toBe(1_000_00);
  });
});

describe('user balances with multiple payers', () => {
  it('tracks what each person owes when you pay', () => {
    const dinner = record([{ personId: null, amount: 4_000_00 }], [
      { personId: null, share: 1_000_00 },
      { personId: 'rahul', share: 1_000_00 },
      { personId: 'amit', share: 1_000_00 },
      { personId: 'neha', share: 1_000_00 },
    ]);
    const balances = computePersonBalances([dinner]);
    expect(balances.get('rahul')?.net).toBe(1_000_00);
    expect(balances.get('amit')?.net).toBe(1_000_00);
    expect(balances.get('neha')?.net).toBe(1_000_00);
    expect(balanceTotals(balances.values()).theyOweYou).toBe(3_000_00);
  });

  it('tracks what you owe when someone else pays', () => {
    const balance = computePersonBalances([
      record([{ personId: 'rahul', amount: 3_000_00 }], [
        { personId: null, share: 1_000_00 },
        { personId: 'rahul', share: 1_000_00 },
      ]),
    ]);
    expect(balance.get('rahul')?.youOwe).toBe(1_000_00);
    expect(balance.get('rahul')?.net).toBe(-1_000_00);
  });

  it('nets a split payment proportionally (villa: you ₹20k, Rahul ₹10k)', () => {
    const balances = computePersonBalances([villa]);
    // Rahul paid more than his share but owes you part of what you fronted.
    expect(balances.get('rahul')?.net).toBe(2_500_00);
    expect(balances.get('amit')?.net).toBe(5_000_00);
    expect(balances.get('neha')?.net).toBe(5_000_00);
    expect(balanceTotals(balances.values()).theyOweYou).toBe(12_500_00);
  });

  it('nets a person across expenses in both directions', () => {
    const balances = computePersonBalances([
      // You pay a ₹2,000 bill; Rahul's half is ₹1,000.
      record([{ personId: null, amount: 2_000_00 }], [
        { personId: null, share: 1_000_00 },
        { personId: 'rahul', share: 1_000_00 },
      ]),
      // Rahul pays a ₹1,600 bill; your half is ₹800.
      record([{ personId: 'rahul', amount: 1_600_00 }], [
        { personId: null, share: 800_00 },
        { personId: 'rahul', share: 800_00 },
      ]),
    ]);
    expect(balances.get('rahul')?.net).toBe(200_00);
  });

  it('ignores third-party shares — only the user ↔ payer matter for Money Owed', () => {
    const balances = computePersonBalances([
      record([{ personId: 'rahul', amount: 3_000_00 }], [
        { personId: null, share: 1_000_00 },
        { personId: 'rahul', share: 1_000_00 },
        { personId: 'amit', share: 1_000_00 },
      ]),
    ]);
    expect(balances.has('amit')).toBe(false);
    expect(balances.get('rahul')?.youOwe).toBe(1_000_00);
  });

  it('always sums to the exact cash delta, even with awkward rounding', () => {
    const messy = record(
      [
        { personId: null, amount: 333_33 },
        { personId: 'rahul', amount: 333_33 },
        { personId: 'amit', amount: 333_34 },
      ],
      [
        { personId: null, share: 333_34 },
        { personId: 'rahul', share: 333_33 },
        { personId: 'amit', share: 333_33 },
      ],
    );
    const nets = expenseUserNets(messy);
    const total = Array.from(nets.values()).reduce((sum, net) => sum + net, 0);
    expect(total).toBe(333_33 - 333_34);
    // And the user can never be owed more than they actually fronted.
    expect(total).toBe(-1);
  });
});

describe('settlements', () => {
  const dinner = record([{ personId: null, amount: 4_000_00 }], [
    { personId: null, share: 1_000_00 },
    { personId: 'rahul', share: 1_000_00 },
    { personId: 'amit', share: 1_000_00 },
    { personId: 'neha', share: 1_000_00 },
  ]);

  it('reduces the receivable when they pay you back', () => {
    const balances = computePersonBalances([dinner], [
      { fromPersonId: 'rahul', toPersonId: null, amount: 400_00 },
    ]);
    expect(balances.get('rahul')?.net).toBe(600_00);
  });

  it('reduces the payable when you pay someone back', () => {
    const balances = computePersonBalances(
      [record([{ personId: 'rahul', amount: 1_000_00 }], [
        { personId: null, share: 1_000_00 },
        { personId: 'rahul', share: 0 },
      ])],
      [{ fromPersonId: null, toPersonId: 'rahul', amount: 600_00 }],
    );
    expect(balances.get('rahul')?.net).toBe(-400_00);
  });

  it('does not touch the user when two other members settle', () => {
    const settlements: SettlementRecord[] = [{ fromPersonId: 'amit', toPersonId: 'rahul', amount: 500_00 }];
    const balances = computePersonBalances([dinner], settlements);
    expect(balances.get('rahul')?.net).toBe(1_000_00);
    expect(balances.get('amit')?.net).toBe(1_000_00);
  });
});

describe('dynamic line items', () => {
  it('sums a trip batch exactly and derives a readable title', () => {
    const summary = summarizeSharedItems([
      { name: 'Train travel', amount: 2_400_00 },
      { name: 'Hotel stay', amount: 6_000_00 },
    ]);
    expect(summary.total).toBe(8_400_00);
    expect(summary.title).toBe('Train travel +1 more');
  });

  it('uses the single item name as the title', () => {
    const summary = summarizeSharedItems([{ name: 'Villa', amount: 30_000_00 }]);
    expect(summary.total).toBe(30_000_00);
    expect(summary.title).toBe('Villa');
  });

  it('falls back when items are unnamed and never goes negative', () => {
    expect(summarizeSharedItems([{ name: '  ', amount: 500_00 }, { name: '', amount: 500_00 }]).title).toBe('Shared expense');
    expect(summarizeSharedItems([{ name: 'Refund', amount: -200_00 }, { name: 'Food', amount: 700_00 }]).total).toBe(700_00);
  });

  it('keeps only the first item name plus a count, so long batches stay short', () => {
    const summary = summarizeSharedItems([
      { name: 'Train travel', amount: 2_400_00 },
      { name: 'Hotel stay', amount: 6_000_00 },
      { name: 'Cabs', amount: 800_00 },
      { name: 'Food', amount: 4_500_00 },
    ]);
    expect(summary.title).toBe('Train travel +3 more');
    expect(summary.total).toBe(13_700_00);
  });
});

describe('trip balances and suggested settlements', () => {
  it('computes exact member balances for the villa', () => {
    const balances = computeMemberBalances([villa]);
    expect(balances.get('self')).toBe(12_500_00);
    expect(balances.get('rahul')).toBe(2_500_00);
    expect(balances.get('amit')).toBe(-7_500_00);
    expect(balances.get('neha')).toBe(-7_500_00);
    expect(Array.from(balances.values()).reduce((sum, value) => sum + value, 0)).toBe(0);
  });

  it('suggests the fewest transfers and clears every balance to zero', () => {
    const balances = computeMemberBalances([villa]);
    const suggestions = suggestSettlements(balances.entries());
    expect(suggestions.length).toBeLessThanOrEqual(3);
    expect(suggestions.length).toBeGreaterThanOrEqual(2);

    // Applying the suggestions must settle the trip completely.
    const settled = new Map(balances);
    for (const suggestion of suggestions) {
      settled.set(suggestion.fromKey, (settled.get(suggestion.fromKey) ?? 0) + suggestion.amount);
      settled.set(suggestion.toKey, (settled.get(suggestion.toKey) ?? 0) - suggestion.amount);
    }
    for (const value of settled.values()) expect(value).toBe(0);

    // Every transfer moves real money in the right direction.
    for (const suggestion of suggestions) {
      expect(suggestion.amount).toBeGreaterThan(0);
      expect((balances.get(suggestion.fromKey) ?? 0)).toBeLessThan(0);
      expect((balances.get(suggestion.toKey) ?? 0)).toBeGreaterThan(0);
    }
  });

  it('lets a settlement between two other members update their balances', () => {
    const settled = computeMemberBalances([villa], [
      { fromPersonId: 'amit', toPersonId: 'rahul', amount: 2_500_00 },
    ]);
    expect(settled.get('amit')).toBe(-5_000_00);
    expect(settled.get('rahul')).toBe(0);
    expect(settled.get('self')).toBe(12_500_00);
    expect(settled.get('neha')).toBe(-7_500_00);
  });

  it('splits a self-paid dinner into three simple transfers', () => {
    const dinner = record([{ personId: null, amount: 4_000_00 }], [
      { personId: null, share: 1_000_00 },
      { personId: 'rahul', share: 1_000_00 },
      { personId: 'amit', share: 1_000_00 },
      { personId: 'neha', share: 1_000_00 },
    ]);
    const suggestions = suggestSettlements(computeMemberBalances([dinner]).entries());
    expect(suggestions).toHaveLength(3);
    expect(suggestions.every((suggestion) => suggestion.toKey === 'self' && suggestion.amount === 1_000_00)).toBe(true);
  });
});
