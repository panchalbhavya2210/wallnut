/**
 * Deterministic request hashing for the AI cache. Kept dependency-free so it
 * is unit-testable and safe to import anywhere.
 */

/** Deterministic JSON with sorted keys so hashing is order-independent. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

/** FNV-1a based deterministic hash — small, fast and dependency-free. */
export function hashRequest(feature: string, payload: unknown): string {
  const text = `${feature}:${stableStringify(payload)}`;
  let hash1 = 0x811c9dc5;
  let hash2 = 0x811c9dc5 ^ 0x5bd1e995;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    hash1 ^= code;
    hash1 = Math.imul(hash1, 0x01000193);
    hash2 ^= code + 7;
    hash2 = Math.imul(hash2, 0x01000193);
  }
  return `${(hash1 >>> 0).toString(36)}${(hash2 >>> 0).toString(36)}`;
}
