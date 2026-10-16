import { asc, eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { merchantAliases, type MerchantAlias } from '@/db/schema';
import { notifyDbChanged } from '@/stores/db.store';
import { createId } from '@/utils/id';

/**
 * Merchant normalization. Raw bank/merchant strings ("AMZN Mktp IN",
 * "AMAZON.IN", "Amazon Pay India") are mapped to canonical names ("Amazon")
 * through the merchant_aliases table. Matching happens in SQL during
 * aggregation (longest pattern wins), so analytics stay fast and consistent.
 */

export const DEFAULT_MERCHANT_ALIASES: { pattern: string; displayName: string }[] = [
  { pattern: 'amzn', displayName: 'Amazon' },
  { pattern: 'amazon', displayName: 'Amazon' },
  { pattern: 'flipkart', displayName: 'Flipkart' },
  { pattern: 'myntra', displayName: 'Myntra' },
  { pattern: 'ajio', displayName: 'AJIO' },
  { pattern: 'meesho', displayName: 'Meesho' },
  { pattern: 'swiggy', displayName: 'Swiggy' },
  { pattern: 'zomato', displayName: 'Zomato' },
  { pattern: 'zepto', displayName: 'Zepto' },
  { pattern: 'blinkit', displayName: 'Blinkit' },
  { pattern: 'bigbasket', displayName: 'BigBasket' },
  { pattern: 'dmart', displayName: 'DMart' },
  { pattern: 'more retail', displayName: 'More' },
  { pattern: 'uber', displayName: 'Uber' },
  { pattern: 'ola ', displayName: 'Ola' },
  { pattern: 'rapido', displayName: 'Rapido' },
  { pattern: 'irctc', displayName: 'IRCTC' },
  { pattern: 'indigo', displayName: 'IndiGo' },
  { pattern: 'makemytrip', displayName: 'MakeMyTrip' },
  { pattern: 'netflix', displayName: 'Netflix' },
  { pattern: 'spotify', displayName: 'Spotify' },
  { pattern: 'hotstar', displayName: 'JioHotstar' },
  { pattern: 'prime video', displayName: 'Prime Video' },
  { pattern: 'youtube', displayName: 'YouTube' },
  { pattern: 'google one', displayName: 'Google One' },
  { pattern: 'apple', displayName: 'Apple' },
  { pattern: 'airtel', displayName: 'Airtel' },
  { pattern: 'jio', displayName: 'Jio' },
  { pattern: 'vi recharge', displayName: 'Vi' },
  { pattern: 'act fibernet', displayName: 'ACT Fibernet' },
  { pattern: 'bescom', displayName: 'BESCOM' },
  { pattern: 'tata power', displayName: 'Tata Power' },
  { pattern: 'adani electricity', displayName: 'Adani Electricity' },
  { pattern: 'starbucks', displayName: 'Starbucks' },
  { pattern: 'third wave', displayName: 'Third Wave Coffee' },
  { pattern: 'blue tokai', displayName: 'Blue Tokai' },
  { pattern: 'cult.fit', displayName: 'cult.fit' },
  { pattern: 'cultfit', displayName: 'cult.fit' },
  { pattern: 'decathlon', displayName: 'Decathlon' },
  { pattern: 'pvr', displayName: 'PVR INOX' },
  { pattern: 'inox', displayName: 'PVR INOX' },
  { pattern: 'bookmyshow', displayName: 'BookMyShow' },
  { pattern: 'apollo pharmacy', displayName: 'Apollo Pharmacy' },
  { pattern: 'apollo', displayName: 'Apollo' },
  { pattern: 'pharmeasy', displayName: 'PharmEasy' },
  { pattern: '1mg', displayName: 'Tata 1mg' },
  { pattern: 'groww', displayName: 'Groww' },
  { pattern: 'zerodha', displayName: 'Zerodha' },
  { pattern: 'indian oil', displayName: 'Indian Oil' },
  { pattern: 'hp petrol', displayName: 'HP Petrol' },
  { pattern: 'bharat petroleum', displayName: 'Bharat Petroleum' },
  { pattern: 'aws', displayName: 'AWS' },
  { pattern: 'github', displayName: 'GitHub' },
  { pattern: 'openai', displayName: 'OpenAI' },
  { pattern: 'anthropic', displayName: 'Anthropic' },
];

export async function seedDefaultMerchantAliases(): Promise<void> {
  const db = getDb();
  const existing = await db.select({ id: merchantAliases.id }).from(merchantAliases).limit(1);
  if (existing.length > 0) return;
  const now = Date.now();
  await db.insert(merchantAliases).values(
    DEFAULT_MERCHANT_ALIASES.map((alias) => ({
      id: createId('mal'),
      pattern: alias.pattern,
      displayName: alias.displayName,
      createdAt: now,
    })),
  );
  notifyDbChanged();
}

export async function listMerchantAliases(): Promise<MerchantAlias[]> {
  const db = getDb();
  return db.select().from(merchantAliases).orderBy(asc(merchantAliases.displayName));
}

export async function upsertMerchantAlias(pattern: string, displayName: string): Promise<void> {
  const db = getDb();
  const clean = pattern.trim().toLowerCase();
  if (!clean || !displayName.trim()) throw new Error('Pattern and name are required.');
  const existing = await db.select().from(merchantAliases).where(eq(merchantAliases.pattern, clean)).limit(1);
  if (existing[0]) {
    await db.update(merchantAliases).set({ displayName: displayName.trim() }).where(eq(merchantAliases.id, existing[0].id));
  } else {
    await db.insert(merchantAliases).values({
      id: createId('mal'),
      pattern: clean,
      displayName: displayName.trim(),
      createdAt: Date.now(),
    });
  }
  notifyDbChanged();
}

export async function deleteMerchantAlias(id: string): Promise<void> {
  const db = getDb();
  await db.delete(merchantAliases).where(eq(merchantAliases.id, id));
  notifyDbChanged();
}

/** JS-side canonicalization for single values (used when displaying a merchant). */
export { canonicalMerchant, merchantKey } from '@/utils/merchant';
