import { describe, expect, it } from 'vitest';

import {
  addMoney,
  calculatePercentage,
  formatMoney,
  formatPercent,
  parseMoney,
  percentageChange,
  subtractMoney,
  sumMoney,
  toMajor,
  toMinor,
} from '@/utils/money';

/**
 * Money is stored as integer minor units everywhere. These tests pin the
 * formatting, parsing and rounding behaviour that every screen relies on.
 */
describe('money storage', () => {
  it('converts between major and minor units without float drift', () => {
    expect(toMinor(450.5)).toBe(45050);
    expect(toMinor(0.1 + 0.2)).toBe(30); // 0.30000000000000004 → 30 paise
    expect(toMinor(1299)).toBe(129900);
    expect(toMajor(45050)).toBe(450.5);
    expect(toMinor(12.345)).toBe(1235); // rounds to the nearest paise
  });

  it('adds and subtracts integers only', () => {
    expect(addMoney(45050, 129900, -30000)).toBe(144950);
    expect(subtractMoney(144950, 45050)).toBe(99900);
    expect(sumMoney([1, 2, 3, 4])).toBe(10);
    expect(Number.isInteger(addMoney(0.1, 0.2))).toBe(true);
  });
});

describe('formatMoney', () => {
  it('uses Indian grouping by default for INR', () => {
    expect(formatMoney(123456789)).toBe('₹12,34,567.89');
    expect(formatMoney(123456789, { decimals: 0 })).toBe('₹12,34,568');
  });

  it('supports western grouping', () => {
    expect(formatMoney(123456789, { grouping: 'western' })).toBe('₹1,234,567.89');
  });

  it('hides trailing zeros when decimals are "auto"', () => {
    expect(formatMoney(45000, { decimals: 'auto' })).toBe('₹450');
    expect(formatMoney(45050, { decimals: 'auto' })).toBe('₹450.50');
  });

  it('formats signs the way the UI needs them', () => {
    expect(formatMoney(-129900)).toBe('-₹1,299.00'); // explicit decimals by default
    expect(formatMoney(129900, { sign: 'always' })).toBe('+₹1,299.00');
    expect(formatMoney(-129900, { sign: 'never' })).toBe('₹1,299.00');
    expect(formatMoney(-129900, { absolute: true })).toBe('₹1,299.00');
  });

  it('compacts large amounts for charts', () => {
    expect(formatMoney(12000000, { compact: true })).toBe('₹1.2L'); // ₹1,20,000
    expect(formatMoney(10000000, { compact: true })).toBe('₹1L'); // ₹1,00,000
    expect(formatMoney(1500000000, { compact: true })).toBe('₹1.5Cr'); // ₹1,50,00,000
    // Rupees always use Indian compact terms (L/Cr), even if the user chose
    // western digit grouping — "M/B" reads as a foreign convention for INR.
    expect(formatMoney(250000000, { grouping: 'western', compact: true })).toBe('₹25L');
    expect(formatMoney(250000000, { currency: 'USD', compact: true })).toBe('$2.5M');
  });

  it('respects currency symbols and zero-decimal currencies', () => {
    expect(formatMoney(45050, { currency: 'USD' })).toBe('$450.50');
    expect(formatMoney(45050, { currency: 'JPY' })).toBe('¥45,050'); // JPY has no minor unit
    expect(formatMoney(45050, { showSymbol: false })).toBe('450.50');
  });
});

describe('parseMoney', () => {
  it('parses user input into minor units', () => {
    expect(parseMoney('450.50')).toBe(45050);
    expect(parseMoney('₹1,23,456.78')).toBe(12345678);
    expect(parseMoney('  1299 ')).toBe(129900);
    expect(parseMoney('-12.5')).toBe(-1250);
    expect(parseMoney('(1,000.00)')).toBe(-100000);
    expect(parseMoney('0.1')).toBe(10);
    expect(parseMoney('12.345')).toBe(1235);
  });

  it('rejects input it cannot trust', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('1.2.3')).toBeNull();
    expect(parseMoney('₹')).toBeNull();
  });

  it('round-trips through formatting', () => {
    const value = 12345678;
    expect(parseMoney(formatMoney(value, { showSymbol: false, decimals: 2 }), 2)).toBe(value);
  });
});

describe('percentages', () => {
  it('never divides by zero', () => {
    expect(calculatePercentage(500, 0)).toBe(0);
    expect(percentageChange(500, 0)).toBeNull();
  });

  it('computes shares and changes', () => {
    expect(calculatePercentage(6420, 22930)).toBeCloseTo(28, 1);
    expect(percentageChange(6420, 5440)).toBeCloseTo(18.01, 1);
    expect(percentageChange(5440, 6420)).toBeCloseTo(-15.26, 1);
  });

  it('handles sign correctly when the baseline is negative', () => {
    // Spending that shrinks from -1000 to -500 is an improvement of 50%.
    expect(percentageChange(-500, -1000)).toBeCloseTo(50, 5);
  });

  it('formats percentages for display', () => {
    expect(formatPercent(47.36, 1)).toBe('47.4%');
    expect(formatPercent(47.36, 0)).toBe('47%');
    expect(formatPercent(Number.NaN)).toBe('—');
  });
});
