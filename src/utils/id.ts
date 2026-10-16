/** Local id generation. Ids are text with a prefix: `txn_l3k2j...`. */
export function createId(prefix = 'id'): string {
  const random = randomHex(10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(length);
  const cryptoObj = (
    globalThis as unknown as { crypto?: { getRandomValues?: (array: Uint8Array) => void } }
  ).crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => (b % 16).toString(16)).join('');
}
