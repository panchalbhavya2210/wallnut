/** Small string/number formatting helpers used across the UI. */

export function truncate(value: string, max = 28): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return '?';
  return parts.map((p) => p[0]!.toUpperCase()).join('');
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(' ')
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return singular;
  if (plural) return plural;
  return `${singular}s`;
}

/** 1234 → "1,234" */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** "3 transactions" */
export function formatTransactionCount(count: number): string {
  return `${formatCount(count)} ${pluralize(count, 'transaction')}`;
}

/** Formats a signed delta as e.g. "+₹1,200" or "−₹420" (true minus sign). */
export function describeDelta(text: string): string {
  return text.replace(/^-/, '−');
}
