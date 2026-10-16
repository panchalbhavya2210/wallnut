import { eq } from 'drizzle-orm';

import { getDb, initDatabase } from '@/db/client';
import { widgetSnapshots } from '@/db/schema';
import { getNetWorthBreakdown } from '@/services/net-worth.service';
import { getUpcoming } from '@/services/recurring.service';
import { getSafeToSpend } from '@/services/safe-to-spend.service';
import { getLedgerTotals } from '@/services/transactions.service';
import { DEFAULT_SETTINGS, loadAllSettings } from '@/services/settings.service';
import { toISODate } from '@/utils/date';
import { formatMoney } from '@/utils/money';

/**
 * WidgetDataService — the only path widget data takes.
 *
 *   SQLite / Wallnut ledger → buildWidgetSnapshot() → widget_snapshots row →
 *   Android widget task handler → render
 *
 * It reuses the canonical services (net worth, safe-to-spend, ledger totals,
 * recurring) so the widget can never disagree with the app. Nothing is
 * recalculated here that the financial engine already knows how to compute.
 */

export interface WidgetUpcomingItem {
  title: string;
  /** Minor units, absolute. */
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  date: string;
}

export interface WidgetSnapshot {
  generatedAt: number;
  /** Human ISO timestamp shown in the widget picker/preview contexts. */
  updatedAt: string;
  currency: string;
  grouping: 'indian' | 'western';
  /** Settings → Widgets → Widgets enabled. */
  enabled: boolean;
  /** Settings → Widgets → Show amounts. */
  showAmounts: boolean;
  /** Active accent name, so widgets follow the app's palette. */
  accent: string;
  safeToSpend: number;
  safePerDay: number;
  netWorth: number;
  available: number;
  todaySpent: number;
  upcoming: WidgetUpcomingItem[];
  formatted: {
    safeToSpend: string;
    safePerDay: string;
    netWorth: string;
    available: string;
    todaySpent: string;
    upcoming: { title: string; amount: string; date: string }[];
  };
}

const SNAPSHOT_KEY = 'latest';
/** Widget-triggered rebuilds at most once every 5 minutes; app pushes are immediate. */
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

async function ensureDatabase(): Promise<void> {
  try {
    getDb();
  } catch {
    await initDatabase();
  }
}

function formatMinor(minor: number, currency: string, grouping: 'indian' | 'western'): string {
  return formatMoney(minor, { currency, grouping, decimals: 'auto' });
}

export async function buildWidgetSnapshot(): Promise<WidgetSnapshot> {
  await ensureDatabase();

  const persisted = await loadAllSettings();
  const widgets = { ...DEFAULT_SETTINGS.widgets, ...(persisted.widgets ?? {}) };
  const general = { ...DEFAULT_SETTINGS.general, ...(persisted.general ?? {}) };
  const appearance = { ...DEFAULT_SETTINGS.appearance, ...(persisted.appearance ?? {}) };

  const today = toISODate(new Date());
  const [netWorth, safe, todayTotals, upcoming] = await Promise.all([
    getNetWorthBreakdown(),
    getSafeToSpend(general.monthStartDay),
    getLedgerTotals({ from: today, to: today }),
    getUpcoming(4),
  ]);

  const formatted = {
    safeToSpend: formatMinor(safe.safe, general.currency, general.numberGrouping),
    safePerDay: formatMinor(safe.perDay, general.currency, general.numberGrouping),
    netWorth: formatMinor(netWorth.netWorth, general.currency, general.numberGrouping),
    available: formatMinor(safe.available, general.currency, general.numberGrouping),
    todaySpent: formatMinor(todayTotals.netExpense, general.currency, general.numberGrouping),
    upcoming: upcoming.map((entry) => ({
      title: entry.recurring.merchant,
      amount: formatMinor(entry.recurring.amount, general.currency, general.numberGrouping),
      date: toISODate(entry.nextDate),
    })),
  };

  return {
    generatedAt: Date.now(),
    updatedAt: new Date().toISOString(),
    currency: general.currency,
    grouping: general.numberGrouping,
    enabled: widgets.enabled,
    showAmounts: widgets.showAmounts,
    accent: appearance.accent,
    safeToSpend: safe.safe,
    safePerDay: safe.perDay,
    netWorth: netWorth.netWorth,
    available: safe.available,
    todaySpent: todayTotals.netExpense,
    upcoming: upcoming.map((entry) => ({
      title: entry.recurring.merchant,
      amount: entry.recurring.amount,
      type: entry.recurring.type,
      date: toISODate(entry.nextDate),
    })),
    formatted,
  };
}

export async function saveWidgetSnapshot(snapshot: WidgetSnapshot): Promise<void> {
  await ensureDatabase();
  const db = getDb();
  const payload = JSON.stringify(snapshot);
  const now = Date.now();
  await db
    .insert(widgetSnapshots)
    .values({ key: SNAPSHOT_KEY, json: payload, updatedAt: now })
    .onConflictDoUpdate({ target: widgetSnapshots.key, set: { json: payload, updatedAt: now } });
}

export async function loadCachedWidgetSnapshot(): Promise<WidgetSnapshot | null> {
  await ensureDatabase();
  const db = getDb();
  const rows = await db.select().from(widgetSnapshots).where(eq(widgetSnapshots.key, SNAPSHOT_KEY)).limit(1);
  const row = rows[0];
  if (!row) return null;
  try {
    return JSON.parse(row.json) as WidgetSnapshot;
  } catch {
    return null;
  }
}

/**
 * Rebuilds the snapshot from the ledger and stores it. Called after every
 * ledger change (via the app's revision bus) and on widget task updates.
 */
export async function refreshWidgetSnapshot(): Promise<WidgetSnapshot> {
  const snapshot = await buildWidgetSnapshot();
  await saveWidgetSnapshot(snapshot).catch(() => undefined);
  return snapshot;
}

/**
 * Fresh-by-default read for the widget task handler. Falls back to the cached
 * snapshot when the ledger cannot be read (e.g. mid-migration) so the widget
 * never crashes or blanks.
 */
export async function getWidgetSnapshot(options: { force?: boolean; maxAgeMs?: number } = {}): Promise<WidgetSnapshot> {
  const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  try {
    if (!options.force) {
      const cached = await loadCachedWidgetSnapshot();
      if (cached && Date.now() - cached.generatedAt < maxAge) return cached;
    }
    return await refreshWidgetSnapshot();
  } catch (error) {
    const cached = await loadCachedWidgetSnapshot().catch(() => null);
    if (cached) return cached;
    throw error;
  }
}
