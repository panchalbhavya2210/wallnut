import type { MerchantAlias } from '@/db/schema';

/**
 * Pure merchant normalisation. Raw bank strings ("AMZN Mktp IN", "AMAZON.IN")
 * map to canonical names ("Amazon") through the alias list. Kept free of the
 * database so the import pipeline and tests can use it directly.
 */

/** Longest matching pattern wins (e.g. "apollo pharmacy" beats "apollo"). */
export function canonicalMerchant(raw: string, aliases: MerchantAlias[]): string {
  const lower = raw.toLowerCase();
  let best: MerchantAlias | null = null;
  for (const alias of aliases) {
    if (lower.includes(alias.pattern) && (!best || alias.pattern.length > best.pattern.length)) {
      best = alias;
    }
  }
  return best?.displayName ?? raw;
}

/** Normalized key used to group raw merchant strings. */
export function merchantKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ].*$/, '')
    .trim();
}
