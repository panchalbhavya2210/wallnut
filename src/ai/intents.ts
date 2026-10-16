/**
 * Deterministic intent detection for the assistant.
 *
 * The financial engine answers the structured question; the AI only explains
 * the result. Keeping detection local means the common questions work even
 * when DeepSeek is unavailable (the app can still show the raw answer), and it
 * prevents the model from choosing which numbers to look at.
 */

export type FinanceIntent =
  | { kind: 'affordability'; amountMinor: number | null; item: string }
  | { kind: 'category_spend'; query: string }
  | { kind: 'month_spend'; month: 'this' | 'last' }
  | { kind: 'biggest_expense' }
  | { kind: 'savings_rate' }
  | { kind: 'income' }
  | { kind: 'owe_people' }
  | { kind: 'lent' }
  | { kind: 'category_increase' }
  | { kind: 'unknown' };

/** Parses "₹20,000", "20000", "1.5k", "2 lakh" → minor units. */
export function parseAmountMinor(input: string): number | null {
  const text = input.replace(/[₹,\s]/g, '').toLowerCase();
  const match = /(?:rs\.?|inr)?(\d+(?:\.\d+)?)(k|lakh|lac|cr)?/.exec(text);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const unit = match[2];
  const multiplier = unit === 'k' ? 1_000 : unit === 'lakh' || unit === 'lac' ? 100_000 : unit === 'cr' ? 10_000_000 : 1;
  return Math.round(base * multiplier * 100);
}

const CATEGORY_STOP_WORDS = /^(?:this|last|the|a|an|on|in|for|my|spending|spent|money|month|week|year|today|yesterday)\b\s*/i;

export function detectIntent(question: string): FinanceIntent {
  const text = question.trim().toLowerCase();

  // "Can I afford a ₹20,000 monitor?" — the amount must be a real money token:
  // either currency-prefixed, or a standalone number (never the "5" in "ps5").
  const afford = /can i (?:afford|buy|get)\s+(?:a |an |the )?(.+)/i.exec(text);
  if (afford) {
    const rest = afford[1]!;
    let amountMatch = /(?:₹|rs\.?\s*|inr\s*)([\d,]+(?:\.\d+)?\s*(?:k|lakh|lac|cr)?)/i.exec(rest);
    if (!amountMatch) {
      amountMatch = /(?:^|\s)([\d,]+(?:\.\d+)?\s*(?:k|lakh|lac|cr)?)(?=\s|$)/i.exec(rest);
    }
    const amountMinor = amountMatch ? parseAmountMinor(amountMatch[1]!) : null;
    const item = rest
      .replace(amountMatch?.[0] ?? '', '')
      .replace(/[?.!,]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      kind: 'affordability',
      amountMinor: amountMinor && amountMinor > 0 ? amountMinor : null,
      item: item || 'this purchase',
    };
  }

  if (/\b(savings? rate|how much did i save|how much have i saved|am i saving)\b/.test(text)) {
    return { kind: 'savings_rate' };
  }
  if (/\b(biggest|largest|largest single|most expensive)\b/.test(text) && /\b(expense|spend|purchase|transaction)\b/.test(text)) {
    return { kind: 'biggest_expense' };
  }
  if (/\b(owe|owed|owe people|debt)\b/.test(text) && !/\blent|loaned\b/.test(text)) {
    return { kind: 'owe_people' };
  }
  if (/\b(lent|loaned|they owe)\b/.test(text)) {
    return { kind: 'lent' };
  }
  if (/\b(which|what)\s+categor(y|ies)\b/.test(text) && /\b(increas|worse|up|more|rose|grew)/.test(text)) {
    return { kind: 'category_increase' };
  }
  if (/\b(income|earned|salary)\b/.test(text)) {
    return { kind: 'income' };
  }

  const spendOn = /\b(?:did i )?spen[dt] on\s+(.+)/i.exec(text);
  if (spendOn) {
    const query = spendOn[1]!
      .replace(/[?.!].*$/, '')
      .replace(/\b(?:this|last|the current)\s+(?:month|week|year)\b.*$/i, '')
      .replace(CATEGORY_STOP_WORDS, '')
      .trim();
    if (query) return { kind: 'category_spend', query };
  }

  if (/\b(where did my money go|what did i spend|how much did i spend|spending this month|expenses this month)\b/.test(text)) {
    return { kind: 'month_spend', month: /\blast month\b/.test(text) ? 'last' : 'this' };
  }

  return { kind: 'unknown' };
}
