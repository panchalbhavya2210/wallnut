import { describe, expect, it } from 'vitest';

import { computeAffordability } from '@/ai/affordability';
import { hashRequest, stableStringify } from '@/ai/hash';
import { detectIntent, parseAmountMinor } from '@/ai/intents';
import { maskName, sanitizeForAi, sanitizeText } from '@/ai/privacy';

describe('AI privacy filter (§4)', () => {
  it('strips identifiers from free text', () => {
    const text = sanitizeText('Paid to card 4111111111111111 on 12/10 — call 9876543210 or me@example.com');
    expect(text).not.toContain('4111111111111111');
    expect(text).not.toContain('9876543210');
    expect(text).not.toContain('me@example.com');
  });

  it('masks merchant names in anonymized contexts but keeps them when allowed', () => {
    expect(maskName('Swiggy')).toBe('S•••••');
    expect(sanitizeForAi({ merchant: 'Swiggy' }, 'anonymized')).toEqual({ merchant: 'S•••••' });
    expect(sanitizeForAi({ merchant: 'Swiggy' }, 'anonymized', { allowMerchant: true })).toEqual({ merchant: 'Swiggy' });
  });

  it('drops forbidden keys and returns null for privacy=none', () => {
    expect(sanitizeForAi({ accountNumber: '123456789012', apiKey: 'sk-x', amount: 42 }, 'detailed')).toEqual({ amount: 42 });
    expect(sanitizeForAi({ amount: 42 }, 'none')).toBeNull();
  });
});

describe('AI cache hashing (§20)', () => {
  it('is stable across key order', () => {
    expect(stableStringify({ a: 1, b: [2, 3] })).toBe(stableStringify({ b: [2, 3], a: 1 }));
    expect(hashRequest('insight', { a: 1, b: 2 })).toBe(hashRequest('insight', { b: 2, a: 1 }));
  });

  it('changes when the payload or feature changes', () => {
    expect(hashRequest('insight', { a: 1 })).not.toBe(hashRequest('insight', { a: 2 }));
    expect(hashRequest('insight', { a: 1 })).not.toBe(hashRequest('assistant', { a: 1 }));
  });
});

describe('assistant intent detection (§8)', () => {
  it('parses amounts in common formats', () => {
    expect(parseAmountMinor('₹20,000')).toBe(2_000_000);
    expect(parseAmountMinor('1.5k')).toBe(150_000);
    expect(parseAmountMinor('2 lakh')).toBe(20_000_000);
  });

  it('detects the MVP question set', () => {
    expect(detectIntent('Where did my money go this month?').kind).toBe('month_spend');
    expect(detectIntent('How much did I spend on food this month?')).toEqual({ kind: 'category_spend', query: 'food' });
    expect(detectIntent("What's my savings rate?")).toEqual({ kind: 'savings_rate' });
    expect(detectIntent('How much do I owe?')).toEqual({ kind: 'owe_people' });
    expect(detectIntent('How much have I lent?')).toEqual({ kind: 'lent' });
    expect(detectIntent('What was my biggest expense this month?').kind).toBe('biggest_expense');
    expect(detectIntent('Which category increased the most?').kind).toBe('category_increase');
  });

  it('detects affordability with the amount and item', () => {
    const intent = detectIntent('Can I afford a ₹20,000 monitor?');
    expect(intent).toEqual({ kind: 'affordability', amountMinor: 2_000_000, item: 'monitor' });
  });

  it('never mistakes digits inside words for the price', () => {
    expect(detectIntent('Can I afford a PS5 Pro?')).toEqual({ kind: 'affordability', amountMinor: null, item: 'ps5 pro' });
    expect(detectIntent('Can I afford 20000 headphones?')).toEqual({
      kind: 'affordability',
      amountMinor: 2_000_000,
      item: 'headphones',
    });
  });

  it('falls back to unknown for unrelated questions', () => {
    expect(detectIntent('Tell me a joke').kind).toBe('unknown');
  });
});

describe('affordability maths (§9)', () => {
  it('keeps the engine in charge of the numbers', () => {
    const result = computeAffordability({
      purchase: 2_000_000,
      liquidCash: 30_000_000,
      remainingProjectedSpend: 10_000_000,
      upcomingObligations: 4_000_000,
      creditCardDue: 0,
      savingsCommitments: 1_000_000,
      averageMonthlyExpense: 12_000_000,
    });
    expect(result.bufferBefore).toBe(15_000_000);
    expect(result.bufferAfter).toBe(13_000_000);
    expect(result.bufferReducedPercent).toBeCloseTo(13.3, 1);
    expect(result.verdict).toBe('comfortable');
  });

  it('flags purchases that do not fit', () => {
    const result = computeAffordability({
      purchase: 5_000_000,
      liquidCash: 6_000_000,
      remainingProjectedSpend: 3_000_000,
      upcomingObligations: 1_000_000,
      creditCardDue: 0,
      savingsCommitments: 0,
      averageMonthlyExpense: 4_000_000,
    });
    expect(result.verdict).toBe('not_now');
    expect(result.shortfall).toBe(3_000_000);
  });
});
