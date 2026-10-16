import { describe, expect, it } from 'vitest';

import { debtBalanceAt, netWorthParts } from '@/utils/net-worth';

/**
 * Net worth must tell the truth about money owed.
 *
 * The ledger moves cash when you lend or borrow; the debt tables hold the
 * offsetting receivable/payable. If both halves are not counted together, a
 * loan looks like a loss of wealth and borrowing looks like income.
 */
describe('net worth includes money owed', () => {
  it('lending converts cash into a receivable without changing net worth', () => {
    const before = netWorthParts({
      accounts: [{ id: 'bank', type: 'bank', currentBalance: 50_000_00, includeInNetWorth: true }],
    });
    expect(before.netWorth).toBe(50_000_00);

    // ₹20,000 left the bank and became money Rahul owes.
    const after = netWorthParts({
      accounts: [{ id: 'bank', type: 'bank', currentBalance: 30_000_00, includeInNetWorth: true }],
      receivables: 20_000_00,
    });
    expect(after.netWorth).toBe(50_000_00);
    expect(after.assets).toBe(50_000_00);
    expect(after.liabilities).toBe(0);
  });

  it('borrowing adds cash and an equal liability without changing net worth', () => {
    const after = netWorthParts({
      accounts: [{ id: 'cash', type: 'cash', currentBalance: 15_000_00, includeInNetWorth: true }],
      payables: 10_000_00,
    });
    expect(after.netWorth).toBe(5_000_00);
    expect(after.liabilities).toBe(-10_000_00);
    expect(after.assets).toBe(15_000_00);
    expect(after.payables).toBe(10_000_00);
  });

  it('collecting a loan removes the receivable and adds the cash back', () => {
    const after = netWorthParts({
      accounts: [{ id: 'bank', type: 'bank', currentBalance: 30_000_00, includeInNetWorth: true }],
      receivables: 0,
    });
    expect(after.netWorth).toBe(30_000_00);
  });

  it('a card purchase reduces net worth once and paying the card changes nothing', () => {
    const purchase = netWorthParts({
      accounts: [
        { id: 'bank', type: 'bank', currentBalance: 10_000_00, includeInNetWorth: true },
        { id: 'card', type: 'credit_card', currentBalance: -2_000_00, includeInNetWorth: true },
      ],
    });
    expect(purchase.netWorth).toBe(8_000_00);

    const paid = netWorthParts({
      accounts: [
        { id: 'bank', type: 'bank', currentBalance: 8_000_00, includeInNetWorth: true },
        { id: 'card', type: 'credit_card', currentBalance: 0, includeInNetWorth: true },
      ],
    });
    expect(paid.netWorth).toBe(8_000_00);
  });

  it('respects the includeInNetWorth flag', () => {
    const parts = netWorthParts({
      accounts: [
        { id: 'bank', type: 'bank', currentBalance: 10_000_00, includeInNetWorth: true },
        { id: 'hidden', type: 'investment', currentBalance: 99_000_00, includeInNetWorth: false },
      ],
    });
    expect(parts.netWorth).toBe(10_000_00);
  });

  it('combines cards, loans and money owed', () => {
    const parts = netWorthParts({
      accounts: [
        { id: 'bank', type: 'bank', currentBalance: 40_000_00, includeInNetWorth: true },
        { id: 'card', type: 'credit_card', currentBalance: -5_000_00, includeInNetWorth: true },
        { id: 'loan', type: 'loan', currentBalance: -8_000_00, includeInNetWorth: true },
      ],
      receivables: 2_500_00,
      payables: 1_000_00,
    });
    expect(parts.assets).toBe(42_500_00);
    expect(parts.liabilities).toBe(-14_000_00);
    expect(parts.netWorth).toBe(28_500_00);
  });
});

describe('debt balance history', () => {
  const movements = [
    { date: '2026-01-05', receivable: 5_000_00, payable: 0 },
    { date: '2026-02-01', receivable: 0, payable: 2_000_00 },
    { date: '2026-03-10', receivable: -3_000_00, payable: 0 },
  ];

  it('integrates creation and repayment movements over time', () => {
    expect(debtBalanceAt(movements, '2026-01-04')).toEqual({ receivables: 0, payables: 0 });
    expect(debtBalanceAt(movements, '2026-01-31')).toEqual({ receivables: 5_000_00, payables: 0 });
    expect(debtBalanceAt(movements, '2026-02-28')).toEqual({ receivables: 5_000_00, payables: 2_000_00 });
    expect(debtBalanceAt(movements, '2026-12-31')).toEqual({ receivables: 2_000_00, payables: 2_000_00 });
  });

  it('never returns negative balances for over-repayment artefacts', () => {
    expect(debtBalanceAt([{ date: '2026-01-01', receivable: -500_00, payable: 0 }], '2026-12-31')).toEqual({
      receivables: 0,
      payables: 0,
    });
  });
});
