import * as Crypto from 'expo-crypto';

/**
 * App-lock PIN handling. The PIN itself is never stored — only a salted
 * SHA-256 digest, in local SQLite, next to the rest of the settings.
 */

export const PIN_LENGTH = 4;

export async function hashPin(pin: string, salt?: string | null): Promise<{ hash: string; salt: string }> {
  const actualSalt = salt ?? Crypto.randomUUID();
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `wallnut:v1:${actualSalt}:${pin}`,
  );
  return { hash, salt: actualSalt };
}

export async function verifyPin(pin: string, hash: string | null, salt: string | null): Promise<boolean> {
  if (!hash || !salt) return false;
  const { hash: computed } = await hashPin(pin, salt);
  if (computed.length !== hash.length) return false;
  // Constant-time comparison — the digests are not secrets, but the habit is cheap.
  let diff = 0;
  for (let index = 0; index < computed.length; index++) {
    diff |= computed.charCodeAt(index) ^ hash.charCodeAt(index);
  }
  return diff === 0;
}

/**
 * Whether the lock can actually be opened. On the web there are no trustworthy
 * biometrics, so a PIN is required; on native either factor works. Locking
 * without any way in would brick the app, so callers check this first.
 */
export function canUnlock(value: { pinHash: string | null; biometrics: boolean }, platform: 'web' | 'native'): boolean {
  if (value.pinHash) return true;
  return platform === 'native' && value.biometrics;
}
