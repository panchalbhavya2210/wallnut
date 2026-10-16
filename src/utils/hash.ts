/**
 * A tiny deterministic 64-bit fingerprint (two independent 32-bit FNV-1a
 * lanes). Used for duplicate detection — not for security, so no crypto
 * dependency (couples cleanly with unit tests and runs everywhere).
 */

function fnv1a(text: string, seed: number, prime: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, prime) >>> 0;
  }
  return hash >>> 0;
}

export function fingerprint(input: string): string {
  const a = fnv1a(input, 0x811c9dc5, 0x01000193);
  const b = fnv1a(input, 0x9747b28c, 0x85ebca6b);
  const c = fnv1a(`${input}#salt`, 0xc2b2ae35, 0x27d4eb2f);
  return (
    a.toString(16).padStart(8, '0') +
    b.toString(16).padStart(8, '0') +
    c.toString(16).padStart(8, '0')
  );
}

export interface FingerprintParts {
  date: string; // YYYY-MM-DD
  amount: number; // signed minor units
  merchant?: string | null;
  accountId?: string | null;
  reference?: string | null;
  description?: string | null;
}

/**
 * Normalizes transaction identity fields before hashing so trivial formatting
 * differences (case, spacing, punctuation) do not defeat duplicate detection.
 */
export function transactionFingerprint(parts: FingerprintParts): string {
  const norm = (value?: string | null) =>
    (value ?? '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const canonical = [
    norm(parts.date),
    String(Math.round(parts.amount)),
    norm(parts.merchant),
    norm(parts.accountId),
    norm(parts.reference),
    norm(parts.description),
  ].join('|');

  return fingerprint(canonical);
}
