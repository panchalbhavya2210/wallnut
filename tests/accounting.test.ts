import { describe, expect, it } from 'vitest';

import {
  advanceRecurrence,
  budgetHealth,
  budgetMaths,
  budgetWindowFor,
  investmentPerformance,
  monthlyEquivalent,
  normalizeTransactionAmount,
  reserveMonths,
  summarizeMovements,
} from '@/utils/ledger';
import { percentageChange } from '@/utils/money';

/**
 * The accounting rules from the product brief. If any of these fail, Wallnut is
 * telling the user something untrue about their money.
 *
 * Scenario §68: Kotak 50,000 · Cash 5,000 · Credit card 0
 *   salary +35,000 · Amazon −2,000 (card) · Swiggy −500 (bank)
 *   Kotak → Cash 2,000 · Card settlement 2,000 · Amazon refund +500
 * Expected: income 35,000 · expense 2,000 · refund 500 · net expense 1,500
 *           transfers 4,000 · net worth unchanged by the transfers.
 */
describe('sign convention', () => {
  it('forces the correct direction for every transaction type', () => {
    expect(normalizeTransactionAmount('expense', 500)).toBe(-500);
    expect(normalizeTransactionAmount('expense', -500)).toBe(-500);
    expect(normalizeTransactionAmount('income', 35_000_00)).toBe(35_000_00);
    expect(normalizeTransactionAmount('refund', 500_00)).toBe(500_00);
    expect(normalizeTransactionAmount('transfer', 2_000_00)).toBe(-2_000_00);
    expect(normalizeTransactionAmount('lending', 5_000_00)).toBe(-5_000_00);
    expect(normalizeTransactionAmount('borrowing', 5_000_00)).toBe(5_000_00);
    // Debt payments keep their sign: collecting is positive, repaying negative.
    expect(normalizeTransactionAmount('debt_payment', -2_000_00)).toBe(-2_000_00);
    expect(normalizeTransactionAmount('debt_payment', 2_000_00)).toBe(2_000_00);
    expect(normalizeTransactionAmount('adjustment', -150_00)).toBe(-150_00);
  });
});

describe('transfers are never spending (§16)', () => {
  const rows = [
    { type: 'expense', amount: -2_000_00 },
    { type: 'transfer', amount: -2_000_00 },
    { type: 'transfer', amount: -2_000_00 },
  ];

  it('reports zero spending for a period containing only transfers', () => {
    const summary = summarizeMovements([{ type: 'transfer', amount: -500_00 }]);
    expect(summary.netExpense).toBe(0);
    expect(summary.savings).toBe(0);
    expect(summary.transfers).toBe(500_00);
  });

  it('counts the expense but excludes the transfer volume from spending', () => {
    const summary = summarizeMovements(rows);
    expect(summary.netExpense).toBe(2_000_00);
    expect(summary.transfers).toBe(4_000_00);
  });

  it('keeps savings equal to income minus net expense', () => {
    const summary = summarizeMovements([{ type: 'income', amount: 35_000_00 }, ...rows]);
    expect(summary.savings).toBe(33_000_00);
    expect(summary.savingsRate).toBeCloseTo(94.29, 1);
  });
});

describe('credit-card settlement (§8)', () => {
  it('does not create a second expense when the card is paid off', () => {
    const rows = [
      { type: 'expense', amount: -2_000_00 }, // Amazon on the card
      { type: 'transfer', amount: -2_000_00 }, // bank → card settlement
    ];
    const summary = summarizeMovements(rows);
    expect(summary.netExpense).toBe(2_000_00); // once, not twice
    expect(summary.transfers).toBe(2_000_00);
  });
});

describe('refunds net against spending (§16)', () => {
  it('turns a ₹1,000 purchase and ₹300 refund into ₹700 of spending', () => {
    const summary = summarizeMovements([
      { type: 'expense', amount: -1_000_00 },
      { type: 'refund', amount: 300_00 },
    ]);
    expect(summary.refunds).toBe(300_00);
    expect(summary.netExpense).toBe(700_00);
    // A refund must never be treated as income.
    expect(summary.income).toBe(0);
    expect(summary.savings).toBe(-700_00);
  });

  it('can push net spending to zero without inventing income', () => {
    const summary = summarizeMovements([
      { type: 'expense', amount: -500_00 },
      { type: 'refund', amount: 500_00 },
    ]);
    expect(summary.netExpense).toBe(0);
    expect(summary.income).toBe(0);
  });
});

describe('full scenario (§68)', () => {
  const rows = [
    { type: 'income', amount: 35_000_00 }, // salary
    { type: 'expense', amount: -2_000_00 }, // Amazon on credit card
    { type: 'expense', amount: -500_00 }, // Swiggy from bank
    { type: 'transfer', amount: -2_000_00 }, // Kotak → Cash
    { type: 'transfer', amount: -2_000_00 }, // Credit card settlement
    { type: 'refund', amount: 500_00 }, // Amazon refund
  ];
  const summary = summarizeMovements(rows);

  it('matches every expected figure', () => {
    expect(summary.income).toBe(35_000_00);
    expect(summary.expenses).toBe(-2_500_00); // gross
    expect(summary.refunds).toBe(500_00);
    expect(summary.netExpense).toBe(2_000_00);
    expect(summary.savings).toBe(33_000_00);
    expect(summary.transfers).toBe(4_000_00);
  });

  it('excludes the transfers from net worth movement', () => {
    // Only the salary, the two expenses and the refund move net worth:
    // +35,000 − 2,000 − 500 + 500 = 33,000.
    const withoutTransfers = summarizeMovements(rows.filter((row) => row.type !== 'transfer'));
    expect(withoutTransfers.netWorthDelta).toBe(33_000_00);
    expect(summary.netWorthDelta).toBe(33_000_00);
  });
});

describe('debt, lending and adjustments (§30)', () => {
  it('never counts lending, borrowing or repayments as income or spending', () => {
    const summary = summarizeMovements([
      { type: 'lending', amount: -5_000_00 }, // lent to Rahul
      { type: 'debt_payment', amount: 2_000_00 }, // Rahul repaid
      { type: 'borrowing', amount: 3_000_00 }, // borrowed from Mom
      { type: 'debt_payment', amount: -1_000_00 }, // repaid Mom
      { type: 'adjustment', amount: -150_00 }, // bank fee correction
    ]);
    expect(summary.income).toBe(0);
    expect(summary.netExpense).toBe(0);
    expect(summary.debtOutflow).toBe(6_000_00);
    expect(summary.debtInflow).toBe(5_000_00);
    expect(summary.adjustments).toBe(-150_00);
    expect(summary.netWorthDelta).toBe(-150_00); // only the correction moves wealth
  });
});

describe('savings rate', () => {
  it('is zero when there is no income', () => {
    expect(summarizeMovements([{ type: 'expense', amount: -500_00 }]).savingsRate).toBe(0);
  });

  it('goes negative when spending exceeds income', () => {
    const summary = summarizeMovements([
      { type: 'income', amount: 10_000_00 },
      { type: 'expense', amount: -12_500_00 },
    ]);
    expect(summary.savings).toBe(-2_500_00);
    expect(summary.savingsRate).toBeCloseTo(-25, 5);
  });
});

describe('budget maths (§35-36)', () => {
  it('computes safe-to-spend from what remains and the days left', () => {
    const maths = budgetMaths({ amount: 8_000_00, spent: 5_420_00, daysElapsed: 19, daysTotal: 31, daysRemaining: 12 });
    expect(maths.percent).toBeCloseTo(67.75, 2);
    expect(maths.remaining).toBe(2_580_00);
    expect(maths.safeToSpendPerDay).toBe(215_00);
    expect(maths.projected).toBeCloseTo(884_315.79, 0); // 5,42,000 ÷ 19 days × 31 days
    expect(budgetHealth(maths.percent)).toBe('on_track');
  });

  it('flags warning and over budget states', () => {
    expect(budgetHealth(85)).toBe('warning');
    expect(budgetHealth(99.9)).toBe('warning');
    expect(budgetHealth(100)).toBe('over');
    expect(budgetHealth(24)).toBe('on_track');
  });

  it('never divides by zero on an empty budget', () => {
    const maths = budgetMaths({ amount: 0, spent: 500_00, daysElapsed: 5, daysTotal: 30, daysRemaining: 25 });
    expect(maths.percent).toBe(0);
    expect(maths.safeToSpendPerDay).toBe(0);
  });

  it('anchors monthly windows on the start day, not the calendar', () => {
    const window = budgetWindowFor({ startDate: '2026-01-05', period: 'monthly' }, new Date(2026, 9, 3)); // 3 Oct 2026
    expect(window.start.getMonth()).toBe(8); // September — the cycle began on the 5th
    expect(window.start.getDate()).toBe(5);
    expect(window.end.getDate()).toBe(4);
  });

  it('walks weekly windows forward and contains the anchor', () => {
    const anchor = new Date(2026, 9, 14);
    const window = budgetWindowFor({ startDate: '2026-09-28', period: 'weekly' }, anchor);
    const days = Math.round((window.end.getTime() - window.start.getTime()) / 86_400_000);
    expect(days).toBe(6);
    expect(window.start.getTime()).toBeLessThanOrEqual(anchor.getTime());
    expect(window.end.getTime()).toBeGreaterThanOrEqual(anchor.getTime());
  });
});

describe('recurring schedules (§37)', () => {
  it('advances each frequency correctly', () => {
    // Monthly schedules are anchored: the 31st skips February (Wallet
    // behaviour) instead of clamping to the 28th and drifting forever.
    expect(advanceRecurrence(new Date(2026, 0, 31), 'monthly', 1)?.getMonth()).toBe(2); // March 31
    expect(advanceRecurrence(new Date(2026, 0, 31), 'monthly', 1)?.getDate()).toBe(31);
    expect(advanceRecurrence(new Date(2026, 0, 15), 'monthly', 1)?.getMonth()).toBe(1); // Feb 15
    expect(advanceRecurrence(new Date(2026, 0, 31), 'monthly', 1, 20)?.getDate()).toBe(20);
    expect(advanceRecurrence(new Date(2026, 0, 10), 'weekly', 1)?.getDate()).toBe(17);
    expect(advanceRecurrence(new Date(2026, 0, 10), 'custom', 10)?.getDate()).toBe(20);
    expect(advanceRecurrence(new Date(2026, 0, 10), 'yearly', 1)?.getFullYear()).toBe(2027);
  });

  it('annualises subscriptions for the insights engine (§63)', () => {
    expect(monthlyEquivalent(649_00, 'monthly')).toBe(649_00);
    expect(monthlyEquivalent(649_00, 'yearly')).toBeCloseTo(54_08, 0);
    expect(monthlyEquivalent(119_00, 'monthly') * 12).toBe(1_428_00); // ₹1,428/yr
    expect(monthlyEquivalent(2_000_00, 'weekly')).toBeCloseTo(8_666_67, 0);
    // Custom schedules are "every N days".
    expect(monthlyEquivalent(300_00, 'custom', 10)).toBe(900_00);
  });
});

describe('investments and reserves', () => {
  it('reports gain and percentage from cost basis', () => {
    const performance = investmentPerformance(1_24_500_00, 1_00_000_00);
    expect(performance.gain).toBe(24_500_00);
    expect(performance.gainPercent).toBeCloseTo(24.5, 2);
  });

  it('handles a loss and a missing cost basis', () => {
    expect(investmentPerformance(80_000_00, 1_00_000_00).gain).toBe(-20_000_00);
    expect(investmentPerformance(80_000_00, 0).gainPercent).toBeNull();
  });

  it('computes emergency reserve months', () => {
    expect(reserveMonths(2_50_000_00, 90_000_00)).toBeCloseTo(2.78, 2);
    expect(reserveMonths(2_50_000_00, 0)).toBe(0);
  });
});

describe('monthly comparison (§34, §40)', () => {
  it('treats rising spending as an increase and falling as a decrease', () => {
    expect(percentageChange(6_420_00, 5_420_00)).toBeCloseTo(18.45, 1);
    expect(percentageChange(5_420_00, 6_420_00)).toBeCloseTo(-15.58, 1);
    expect(percentageChange(0, 0)).toBeNull();
  });
});
