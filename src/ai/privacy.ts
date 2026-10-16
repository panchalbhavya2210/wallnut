/**
 * Privacy filter — the only path financial data takes before it reaches a
 * provider. Two layers:
 *
 *  1. `sanitizeText` strips anything that looks like an identifier (long digit
 *     runs, emails, phone numbers, URLs).
 *  2. `sanitizeForAi` walks the context object and drops forbidden keys
 *     (credentials, account/card identifiers, tokens) so a future context
 *     builder mistake can never leak them.
 *
 * Everything here is pure so it can be unit-tested without a database.
 */

export type PrivacyMode = 'none' | 'anonymized' | 'detailed';

const FORBIDDEN_KEY = /(password|passcode|pin|cvv|token|secret|apikey|api_key|iban|swift|routing|account_?number|card_?number|email|phone|mobile|address|auth)/i;

const DIGIT_RUN = /\b\d{6,}\b/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g;
const PHONE = /(?:\+?\d[\d\s-]{7,}\d)/g;
const URL = /https?:\/\/\S+/gi;

/** Strips identifiers from a free-text value. */
export function sanitizeText(value: string): string {
  return value
    .replace(URL, '[link]')
    .replace(EMAIL, '[email]')
    .replace(PHONE, '[number]')
    .replace(DIGIT_RUN, '[number]')
    .trim();
}

/** Masks a merchant/payee name for anonymized contexts: "Swiggy" → "S•••••". */
export function maskName(value: string): string {
  const clean = value.trim();
  if (clean.length <= 2) return '•'.repeat(Math.max(1, clean.length));
  return `${clean[0]}${'•'.repeat(Math.min(8, clean.length - 1))}`;
}

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Applies the user's privacy mode to a structured AI payload.
 *
 *  - `none` → returns null; callers must not send financial data at all.
 *  - `anonymized` → identifiers dropped, strings sanitized, merchant names
 *    masked unless `merchantField` requests otherwise (categorisation needs the
 *    real name to be useful, and the user opted in by enabling it).
 *  - `detailed` → identifiers dropped, only obviously sensitive strings cleaned.
 */
export function sanitizeForAi(
  input: Json,
  mode: PrivacyMode,
  options: { allowMerchant?: boolean } = {},
): Json | null {
  if (mode === 'none') return null;
  return walk(input, mode, Boolean(options.allowMerchant));
}

function walk(value: Json, mode: PrivacyMode, allowMerchant: boolean, key = ''): Json {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (key === 'merchant' && mode === 'anonymized' && !allowMerchant) return maskName(value);
    return sanitizeText(value);
  }
  if (Array.isArray(value)) return value.map((entry) => walk(entry, mode, allowMerchant, key));
  const result: { [key: string]: Json } = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(entryKey)) continue;
    result[entryKey] = walk(entryValue, mode, allowMerchant, entryKey);
  }
  return result;
}
