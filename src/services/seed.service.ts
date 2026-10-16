import { getDb, getSqlite } from '@/db/client';
import { USER_DATA_DELETE_ORDER } from '@/db/tables';
import { accounts, dashboardWidgets, tags, transactionTags, users } from '@/db/schema';
import { asc, eq, gt, sql } from 'drizzle-orm';
import { listAccounts, recalculateAllBalances } from '@/services/accounts.service';
import { listCategories, seedDefaultCategories } from '@/services/categories.service';
import { createBudget } from '@/services/budgets.service';
import { createRecurring } from '@/services/recurring.service';
import { seedDefaultMerchantAliases } from '@/services/merchant.service';
import { insertImportedTransactions } from '@/services/transactions.service';
import { notifyDbChanged } from '@/stores/db.store';
import { useSettingsStore } from '@/stores/settings.store';
import type { Transaction } from '@/db/schema';
import { addDays, addMonths, startOfMonth, toISODate } from '@/utils/date';
import { createId } from '@/utils/id';
import { transactionFingerprint } from '@/utils/hash';

/**
 * Deterministic demo data — 6 months of realistic Indian personal finance:
 * salary, rent, subscriptions, groceries, dining, transport, shopping, bills,
 * refunds, credit-card spends with bill payments (transfers), ATM withdrawals,
 * and monthly investments. Seeded PRNG so every run produces the same ledger.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20261006;

interface DraftTx {
  date: string;
  account: string; // account key
  category: string | null; // category name
  amount: number; // signed minor units
  type: Transaction['type'];
  merchant?: string;
  description?: string;
  transferAccount?: string;
  notes?: string;
  reference?: string;
  tags?: string[];
  at?: number; // created-at offset for stable ordering
  /** Leaves the row unreviewed so the Financial Inbox has something to show. */
  unreviewed?: boolean;
}

interface AccountDef {
  key: string;
  name: string;
  type: 'cash' | 'bank' | 'credit_card' | 'savings' | 'investment' | 'loan';
  initial: number;
  institution?: string;
  color?: string;
}

const ACCOUNT_DEFS: AccountDef[] = [
  { key: 'kotak', name: 'Kotak Bank', type: 'bank', initial: 28_500_00, institution: 'Kotak Mahindra', color: '#5E9BFF' },
  { key: 'hdfc', name: 'HDFC Savings', type: 'savings', initial: 1_10_000_00, institution: 'HDFC Bank', color: '#42D392' },
  { key: 'cash', name: 'Cash', type: 'cash', initial: 3_200_00, color: '#F5B84B' },
  { key: 'icici', name: 'ICICI Amazon Pay Card', type: 'credit_card', initial: 0, institution: 'ICICI Bank', color: '#FF647C' },
  { key: 'groww', name: 'Groww Investments', type: 'investment', initial: 52_000_00, institution: 'Groww', color: '#B79CFF' },
];

export async function isDatabaseEmpty(): Promise<boolean> {
  const sqlite = getSqlite();
  const row = await sqlite.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM transactions');
  return Number(row?.count ?? 0) === 0;
}

export async function seedDemoData(): Promise<void> {
  const db = getDb();
  await seedDefaultCategories();
  await seedDefaultMerchantAliases();

  const now = new Date();
  const rnd = mulberry32(SEED);
  const rand = (min: number, max: number) => min + rnd() * (max - min);
  const pick = <T,>(items: T[]): T => items[Math.floor(rnd() * items.length)]!;
  const round = (value: number, step = 1000) => Math.round(value / step) * step; // step in paise (1000 = ₹10)

  /* ---------------------------- Reference data ------------------------------ */
  const categories = await listCategories();
  const catId = (name: string): string | null => categories.find((c) => c.name === name)?.id ?? null;

  const tagDefs = [
    { name: 'Trip', color: '#6FB4FF' },
    { name: 'Work', color: '#B79CFF' },
    { name: 'Family', color: '#FF9F0A' },
    { name: 'Personal', color: '#42D392' },
    { name: 'Important', color: '#FF647C' },
    { name: 'Tax', color: '#F5B84B' },
  ];
  const tagIds: Record<string, string> = {};
  for (const tag of tagDefs) tagIds[tag.name] = createId('tag');

  /* ------------------------------- Accounts -------------------------------- */
  const accountIds: Record<string, string> = {};
  const accountRows = ACCOUNT_DEFS.map((def, index) => {
    const id = createId('acc');
    accountIds[def.key] = id;
    return {
      id,
      name: def.name,
      type: def.type,
      currency: 'INR',
      initialBalance: def.initial,
      currentBalance: def.initial,
      institution: def.institution ?? null,
      color: def.color ?? null,
      sortOrder: index,
      isArchived: false,
      createdAt: now.getTime() - 1000,
      updatedAt: now.getTime(),
    };
  });

  // One transaction for all reference data keeps first-run seeding fast on web.
  await db.transaction(async (tx) => {
    await tx.insert(accounts).values(accountRows);
    await tx.insert(users).values({
      id: createId('usr'),
      name: 'You',
      baseCurrency: 'INR',
      createdAt: now.getTime(),
      updatedAt: now.getTime(),
    });
    await tx.insert(tags).values(
      tagDefs.map((tag) => ({ id: tagIds[tag.name]!, name: tag.name, color: tag.color, createdAt: now.getTime() })),
    );
  });

  /* ---------------------------- Transaction plan ---------------------------- */
  const draft: DraftTx[] = [];
  const months = 6;
  let clock = 0;
  const at = () => now.getTime() - 6 * 30 * 86400000 + clock++;

  const monthStart = (monthsAgo: number) => startOfMonth(addMonths(now, -monthsAgo));
  const dayIn = (monthsAgo: number, day: number) => {
    const base = monthStart(monthsAgo);
    const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    // The current month is clamped to today — the ledger never shows future rows.
    const safeDay = monthsAgo === 0 ? Math.min(day, now.getDate()) : day;
    return new Date(base.getFullYear(), base.getMonth(), Math.min(safeDay, last));
  };

  for (let m = months - 1; m >= 0; m--) {
    /* Salary — 1st, with an occasional bonus month */
    const salary = 60_000_00 + total(round(rand(-400_00, 900_00), 100_00));
    draft.push({
      date: toISODate(dayIn(m, 1)),
      account: 'kotak',
      category: 'Salary',
      amount: salary,
      type: 'income',
      merchant: 'Kotak Salary Credit',
      description: 'Monthly salary',
      tags: ['Work'],
      at: at(),
    });
    if (m === 3 || m === 5) {
      draft.push({
        date: toISODate(dayIn(m, 18)),
        account: 'kotak',
        category: 'Freelance',
        amount: round(rand(4_000_00, 12_000_00), 100_00),
        type: 'income',
        merchant: 'Upwork',
        description: 'Freelance project payout',
        tags: ['Work'],
        at: at(),
      });
    }

    /* Rent — 3rd (recurring) */
    draft.push({
      date: toISODate(dayIn(m, 3)),
      account: 'kotak',
      category: 'Rent',
      amount: -12_000_00,
      type: 'expense',
      merchant: 'Landlord',
      description: 'Monthly rent',
      tags: ['Important'],
      at: at(),
    });

    /* Subscriptions (recurring) */
    draft.push({ date: toISODate(dayIn(m, 10)), account: 'kotak', category: 'Subscriptions', amount: -649_00, type: 'expense', merchant: 'Netflix', at: at() });
    draft.push({ date: toISODate(dayIn(m, 15)), account: 'kotak', category: 'Subscriptions', amount: -119_00, type: 'expense', merchant: 'Spotify', at: at() });
    draft.push({ date: toISODate(dayIn(m, 5)), account: 'icici', category: 'Fitness', amount: -1_299_00, type: 'expense', merchant: 'cult.fit', description: 'Gym membership', at: at() });

    /* Bills */
    draft.push({ date: toISODate(dayIn(m, 12)), account: 'kotak', category: 'Mobile', amount: -799_00, type: 'expense', merchant: 'Airtel Postpaid', at: at() });
    draft.push({ date: toISODate(dayIn(m, 20)), account: 'kotak', category: 'Internet', amount: -999_00, type: 'expense', merchant: 'ACT Fibernet', at: at() });
    draft.push({
      date: toISODate(dayIn(m, 8)),
      account: 'kotak',
      category: 'Electricity',
      amount: -total(round(rand(1_150_00, 2_450_00), 10_00)),
      type: 'expense',
      merchant: 'BESCOM Electricity',
      at: at(),
    });

    /* Groceries — 4-6 orders/month */
    const groceryRuns = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < groceryRuns; i++) {
      const merchant = pick(['Zepto', 'Blinkit', 'BigBasket', 'DMart Ready', 'More Retail']);
      draft.push({
        date: toISODate(dayIn(m, Math.floor(rand(2, 29)))),
        account: pick(['icici', 'kotak']),
        category: 'Groceries',
        amount: -total(round(rand(380_00, 2_850_00), 10_00)),
        type: 'expense',
        merchant,
        at: at(),
      });
    }

    /* Dining — 4-8 orders/month */
    const diningRuns = 4 + Math.floor(rnd() * 5);
    for (let i = 0; i < diningRuns; i++) {
      const merchant = pick(['Swiggy', 'Zomato', 'Third Wave Coffee', 'Starbucks', 'Blue Tokai']);
      draft.push({
        date: toISODate(dayIn(m, Math.floor(rand(1, 29)))),
        account: pick(['icici', 'kotak']),
        category: merchant.includes('Coffee') || merchant === 'Starbucks' ? 'Cafes' : 'Delivery',
        amount: -total(round(rand(160_00, 1_480_00), 10_00)),
        type: 'expense',
        merchant,
        at: at(),
      });
    }

    /* Transport */
    const rideCount = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < rideCount; i++) {
      draft.push({
        date: toISODate(dayIn(m, Math.floor(rand(1, 29)))),
        account: 'kotak',
        category: 'Taxi',
        amount: -total(round(rand(110_00, 480_00), 10_00)),
        type: 'expense',
        merchant: pick(['Uber India', 'Rapido', 'Ola Cabs']),
        at: at(),
      });
    }
    for (let i = 0; i < 2; i++) {
      draft.push({
        date: toISODate(dayIn(m, Math.floor(rand(1, 29)))),
        account: 'icici',
        category: 'Fuel',
        amount: -total(round(rand(900_00, 2_400_00), 10_00)),
        type: 'expense',
        merchant: pick(['HP Petrol Pump', 'Indian Oil', 'Bharat Petroleum']),
        at: at(),
      });
    }

    /* Shopping */
    const shopCount = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < shopCount; i++) {
      const merchant = pick(['AMZN Mktp IN', 'Amazon Pay India', 'Flipkart Internet', 'Myntra', 'AJIO']);
      const big = rnd() > 0.82;
      const canonical = merchant.toLowerCase().includes('amzn') || merchant.toLowerCase().includes('amazon') ? 'Amazon' : merchant.toLowerCase().includes('flipkart') ? 'Flipkart' : merchant.toLowerCase().includes('myntra') ? 'Myntra' : 'AJIO';
      draft.push({
        date: toISODate(dayIn(m, Math.floor(rand(1, 29)))),
        account: 'icici',
        category: merchant === 'Myntra' || merchant === 'AJIO' ? 'Clothing' : big ? 'Electronics' : 'General',
        amount: -total(round(big ? rand(4_500_00, 14_000_00) : rand(420_00, 3_400_00), 10_00)),
        type: 'expense',
        merchant,
        description: canonical,
        at: at(),
      });
    }

    /* Entertainment */
    if (rnd() > 0.35) {
      draft.push({
        date: toISODate(dayIn(m, Math.floor(rand(4, 27)))),
        account: pick(['kotak', 'icici']),
        category: 'Movies',
        amount: -total(round(rand(300_00, 1_100_00), 10_00)),
        type: 'expense',
        merchant: pick(['PVR INOX', 'BookMyShow']),
        at: at(),
      });
    }

    /* Health */
    if (rnd() > 0.55) {
      draft.push({
        date: toISODate(dayIn(m, Math.floor(rand(3, 26)))),
        account: 'kotak',
        category: 'Medical',
        amount: -total(round(rand(350_00, 2_600_00), 10_00)),
        type: 'expense',
        merchant: pick(['Apollo Pharmacy', 'Tata 1mg', 'PharmEasy']),
        at: at(),
      });
    }

    /* Travel — a couple of trips across the period */
    if (m === 2 || m === 4) {
      draft.push({
        date: toISODate(dayIn(m, Math.floor(rand(6, 20)))),
        account: 'icici',
        category: 'Travel',
        amount: -total(round(rand(3_800_00, 9_500_00), 10_00)),
        type: 'expense',
        merchant: 'MakeMyTrip',
        description: 'Trip booking',
        tags: ['Trip', 'Family'],
        at: at(),
      });
      draft.push({
        date: toISODate(dayIn(m, Math.floor(rand(6, 24)))),
        account: 'icici',
        category: 'Travel',
        amount: -total(round(rand(2_400_00, 6_200_00), 10_00)),
        type: 'expense',
        merchant: 'IndiGo',
        tags: ['Trip'],
        at: at(),
      });
    }

    /* Refunds — Amazon/Flipkart returns */
    if (rnd() > 0.55) {
      draft.push({
        date: toISODate(dayIn(m, Math.floor(rand(6, 27)))),
        account: 'icici',
        category: 'General',
        amount: total(round(rand(320_00, 2_100_00), 10_00)),
        type: 'refund',
        merchant: pick(['AMZN Mktp IN', 'Flipkart Internet']),
        description: 'Order return refund',
        at: at(),
      });
    }

    /* Transfers: a monthly ATM withdrawal Kotak → Cash */
    for (let i = 0; i < 1; i++) {
      draft.push({
        date: toISODate(dayIn(m, Math.floor(rand(2, 28)))),
        account: 'kotak',
        category: null,
        amount: -round(rand(1_500_00, 3_500_00), 500_00),
        type: 'transfer',
        merchant: 'ATM Withdrawal',
        transferAccount: 'cash',
        at: at(),
      });
    }

    /* Monthly SIP Kotak → Groww */
    draft.push({
      date: toISODate(dayIn(m, 7)),
      account: 'kotak',
      category: null,
      amount: -10_000_00,
      type: 'transfer',
      merchant: 'Groww SIP',
      description: 'Monthly investment',
      transferAccount: 'groww',
      tags: ['Important'],
      at: at(),
    });

    /* Credit card bill payment (transfer, NOT an expense) */
    const cardSpendEstimate = total(round(rand(12_000_00, 24_000_00), 100_00));
    draft.push({
      date: toISODate(dayIn(m, 26)),
      account: 'kotak',
      category: null,
      amount: -cardSpendEstimate,
      type: 'transfer',
      merchant: 'ICICI Card Payment',
      description: 'Credit card bill',
      transferAccount: 'icici',
      at: at(),
    });

    /* Cash spends */
    const cashSpends = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < cashSpends; i++) {
      draft.push({
        date: toISODate(dayIn(m, Math.floor(rand(1, 29)))),
        account: 'cash',
        category: pick(['Restaurants', 'Other', 'Groceries']),
        amount: -round(rand(60_00, 900_00), 10_00),
        type: 'expense',
        merchant: pick(['Corner Store', 'Metro Cash', 'Local Vendor', 'Chai Point']),
        at: at(),
      });
    }

    /* Occasional adjustment */
    if (m === 3) {
      draft.push({
        date: toISODate(dayIn(m, 14)),
        account: 'hdfc',
        category: null,
        amount: -35_00,
        type: 'adjustment',
        merchant: 'Bank Charges',
        description: 'SMS alert charges',
        at: at(),
      });
    }
  }

  /* --------------------------- Financial Inbox demo -------------------------- */
  // Deterministic items so the inbox is explorable on a fresh install: one
  // uncategorised/unreviewed order (action required) and one large purchase
  // (suggestion). They vanish as soon as the user approves/categorises them.
  draft.push({
    date: toISODate(addDays(now, -2)),
    account: 'icici',
    category: null,
    amount: -1_249_00,
    type: 'expense',
    merchant: 'Amazon',
    description: 'Order awaiting a category',
    unreviewed: true,
    at: at(),
  });
  draft.push({
    date: toISODate(addDays(now, -1)),
    account: 'icici',
    category: 'Electronics',
    amount: -18_499_00,
    type: 'expense',
    merchant: 'Croma',
    description: 'Large one-off purchase',
    at: at(),
  });

  /* ------------------------------ Persist rows ------------------------------ */
  const rows: Transaction[] = draft.map((d) => {
    const accountId = accountIds[d.account]!;
    const transferAccountId = d.transferAccount ? accountIds[d.transferAccount]! : null;
    const createdAt = d.at ?? now.getTime();
    return {
      id: createId('txn'),
      accountId,
      categoryId: d.category ? catId(d.category) : null,
      amount: d.amount,
      type: d.type,
      merchant: d.merchant ?? null,
      description: d.description ?? null,
      date: d.date,
      notes: d.notes ?? null,
      reference: d.reference ?? null,
      isTransfer: d.type === 'transfer',
      transferAccountId,
      isRecurring: d.type === 'expense' && ['Netflix', 'Spotify', 'Airtel Postpaid', 'ACT Fibernet', 'cult.fit', 'Landlord'].includes(d.merchant ?? ''),
      recurringId: null,
      installmentId: null,
      fingerprint: transactionFingerprint({
        date: d.date,
        amount: d.amount,
        merchant: d.merchant,
        accountId,
        reference: d.reference,
        description: d.description,
      }),
      isReviewed: !d.unreviewed,
      captureSource: 'manual',
      importBatchId: null,
      createdAt,
      updatedAt: createdAt,
    };
  });

  await insertImportedTransactions(rows);

  /* --------------------------------- Tags ---------------------------------- */
  const tagLinks: { transactionId: string; tagId: string }[] = [];
  rows.forEach((row, index) => {
    const draftRow = draft[index]!;
    for (const tagName of draftRow.tags ?? []) {
      const tagId = tagIds[tagName];
      if (tagId) tagLinks.push({ transactionId: row.id, tagId });
    }
  });
  if (tagLinks.length > 0) {
    // Chunked inside one transaction — SQLite has a parameter limit.
    await db.transaction(async (tx) => {
      for (let index = 0; index < tagLinks.length; index += 200) {
        await tx.insert(transactionTags).values(tagLinks.slice(index, index + 200));
      }
    });
  }

  /* ------------------------------- Balances -------------------------------- */
  await recalculateAllBalances();

  /* ------------------------------- Budgets --------------------------------- */
  const budgetStart = toISODate(startOfMonth(now));
  const budgetPlan: [string, number][] = [
    ['Food & Dining', 18_000_00],
    ['Shopping', 12_000_00],
    ['Transport', 7_000_00],
    ['Bills & Utilities', 5_000_00],
    ['Entertainment', 4_000_00],
    ['Health', 3_000_00],
  ];
  for (const [name, amount] of budgetPlan) {
    const categoryId = catId(name);
    if (!categoryId) continue;
    await createBudget({ categoryId, amount, period: 'monthly', startDate: budgetStart, rolloverEnabled: false });
  }

  /* ------------------------- Recurring schedules ----------------------------- */
  // Next actual occurrence of each monthly day — a bill on the 10th shows as
  // due this month if today is earlier, so Upcoming/Inbox stay meaningful.
  const nextOccurrence = (day: number) => {
    const today = new Date();
    if (today.getDate() < day) return toISODate(new Date(today.getFullYear(), today.getMonth(), day));
    return toISODate(new Date(today.getFullYear(), today.getMonth() + 1, day));
  };
  const recurringPlan: {
    merchant: string;
    amount: number;
    type: 'expense' | 'income' | 'transfer';
    category: string | null;
    account: string;
    transferAccount?: string;
    frequency: 'monthly';
    day: number;
    autoPost: boolean;
  }[] = [
    { merchant: 'Kotak Salary Credit', amount: 60_000_00, type: 'income', category: 'Salary', account: 'kotak', frequency: 'monthly', day: 1, autoPost: true },
    { merchant: 'Landlord', amount: 12_000_00, type: 'expense', category: 'Rent', account: 'kotak', frequency: 'monthly', day: 3, autoPost: true },
    { merchant: 'Netflix', amount: 649_00, type: 'expense', category: 'Subscriptions', account: 'kotak', frequency: 'monthly', day: 10, autoPost: true },
    { merchant: 'Spotify', amount: 119_00, type: 'expense', category: 'Subscriptions', account: 'kotak', frequency: 'monthly', day: 15, autoPost: true },
    { merchant: 'Airtel Postpaid', amount: 799_00, type: 'expense', category: 'Mobile', account: 'kotak', frequency: 'monthly', day: 12, autoPost: true },
    { merchant: 'ACT Fibernet', amount: 999_00, type: 'expense', category: 'Internet', account: 'kotak', frequency: 'monthly', day: 20, autoPost: true },
    { merchant: 'cult.fit', amount: 1_299_00, type: 'expense', category: 'Fitness', account: 'icici', frequency: 'monthly', day: 5, autoPost: true },
    { merchant: 'Groww SIP', amount: 10_000_00, type: 'transfer', category: null, account: 'kotak', transferAccount: 'groww', frequency: 'monthly', day: 7, autoPost: true },
  ];
  for (const plan of recurringPlan) {
    await createRecurring({
      merchant: plan.merchant,
      amount: plan.amount,
      type: plan.type,
      categoryId: plan.category ? catId(plan.category) : null,
      accountId: accountIds[plan.account]!,
      transferAccountId: plan.transferAccount ? accountIds[plan.transferAccount]! : null,
      frequency: plan.frequency,
      nextDate: nextOccurrence(plan.day),
      autoPost: plan.autoPost,
    });
  }

  /* --------------------------- Dashboard widgets ---------------------------- */
  await seedDefaultDashboardWidgets();

  notifyDbChanged();
}

function total(paise: number): number {
  return Math.round(paise);
}

/**
 * Default dashboard — the three levels every finance app converges on:
 * status (balance + quick actions), spending overview (cash flow + categories)
 * and recent activity. Everything else is one tap away in the editor.
 */
export const DEFAULT_WIDGETS: { type: string; width: 'full' | 'half'; height: 'compact' | 'medium' | 'tall' }[] = [
  { type: 'net_worth', width: 'full', height: 'tall' },
  { type: 'quick_actions', width: 'full', height: 'compact' },
  { type: 'income_expense', width: 'full', height: 'medium' },
  { type: 'category_breakdown', width: 'full', height: 'medium' },
  { type: 'recent_transactions', width: 'full', height: 'medium' },
];

/** The pre-“finance polish” default layout, used for a one-time tidy-up. */
const LEGACY_DEFAULT_WIDGET_TYPES = [
  'net_worth',
  'income_expense',
  'spending_trend',
  'category_breakdown',
  'category_monthly',
  'budget_progress',
  'recent_transactions',
];

/** The very first default layout, also upgraded by the same tidy-up. */
const LEGACY_V1_DEFAULT_WIDGET_TYPES = [
  'net_worth',
  'income_expense',
  'spending_total',
  'savings_rate',
  'spending_trend',
  'category_breakdown',
  'budget_progress',
  'recent_transactions',
];

/**
 * One-time layout tidy-up: databases seeded before the breathing-room pass get
 * the roomier default set, but only if the dashboard still matches the old
 * default exactly — a user's own arrangement is never touched.
 */
/**
 * One-time placement of the Safe-to-Spend flagship card: inserted (or moved)
 * immediately after the net-worth hero on dashboards that have one, then marked
 * as placed so later drag-to-reorder choices are never overridden.
 */
export async function ensureSafeToSpendWidget(): Promise<boolean> {
  const dashboardSettings = useSettingsStore.getState().dashboard;
  if (dashboardSettings.safeToSpendPlaced) return false;

  const db = getDb();
  const netWorth = await db.select().from(dashboardWidgets).where(eq(dashboardWidgets.type, 'net_worth')).limit(1);
  if (netWorth.length === 0) {
    // A heavily customised dashboard without the hero: leave it alone.
    useSettingsStore.getState().update('dashboard', { safeToSpendPlaced: true });
    return false;
  }

  // The hero and the quick actions both belong at the very top; the flagship
  // card follows them when the quick actions row is present.
  const quickActions = await db.select().from(dashboardWidgets).where(eq(dashboardWidgets.type, 'quick_actions')).limit(1);
  const anchorPosition = quickActions[0]?.position ?? netWorth[0]!.position ?? 0;
  const position = anchorPosition + 1;
  const existing = await db.select().from(dashboardWidgets).where(eq(dashboardWidgets.type, 'safe_to_spend')).limit(1);

  // Make room so the flagship card sits immediately after the anchor.
  await db
    .update(dashboardWidgets)
    .set({ position: sql`${dashboardWidgets.position} + 1` })
    .where(gt(dashboardWidgets.position, anchorPosition));

  if (existing.length > 0) {
    await db.update(dashboardWidgets).set({ position }).where(eq(dashboardWidgets.id, existing[0]!.id));
  } else {
    await db.insert(dashboardWidgets).values({
      id: createId('wid'),
      type: 'safe_to_spend',
      position,
      width: 'full',
      height: 'medium',
      configuration: '{}',
      isVisible: true,
    });
  }

  useSettingsStore.getState().update('dashboard', { safeToSpendPlaced: true });
  return true;
}

/**
 * One-time placement of the Category Trends (month-on-month) card: dropped in
 * right after the Spending Categories donut, or appended when that card is not
 * on the dashboard. Marked as placed so later arrangements stay untouched.
 */
export async function ensureCategoryMonthlyWidget(): Promise<boolean> {
  const dashboardSettings = useSettingsStore.getState().dashboard;
  if (dashboardSettings.categoryTrendsPlaced) return false;

  const db = getDb();
  const existing = await db.select().from(dashboardWidgets).where(eq(dashboardWidgets.type, 'category_monthly')).limit(1);

  if (existing.length > 0) {
    useSettingsStore.getState().update('dashboard', { categoryTrendsPlaced: true });
    return false;
  }

  const all = await db.select().from(dashboardWidgets).orderBy(asc(dashboardWidgets.position));
  if (all.length === 0) {
    // A brand-new database gets the default set (which already includes it).
    useSettingsStore.getState().update('dashboard', { categoryTrendsPlaced: true });
    return false;
  }

  const anchor = all.find((widget) => widget.type === 'category_breakdown') ?? all.find((widget) => widget.type === 'spending_trend');
  const position = anchor ? (anchor.position ?? 0) + 1 : all.reduce((max, widget) => Math.max(max, widget.position), -1) + 1;

  // Make room so the card sits immediately after its anchor.
  await db
    .update(dashboardWidgets)
    .set({ position: sql`${dashboardWidgets.position} + 1` })
    .where(gt(dashboardWidgets.position, position - 1));

  await db.insert(dashboardWidgets).values({
    id: createId('wid'),
    type: 'category_monthly',
    position,
    width: 'full',
    height: 'medium',
    configuration: '{}',
    isVisible: true,
  });

  useSettingsStore.getState().update('dashboard', { categoryTrendsPlaced: true });
  notifyDbChanged();
  return true;
}

/**
 * One-time placement of the Quick Actions row: inserted immediately after the
 * net-worth hero when a dashboard (customised before Pass 19) is missing it.
 * Marked as placed so a deliberate removal is never undone.
 */
export async function ensureQuickActionsWidget(): Promise<boolean> {
  const dashboardSettings = useSettingsStore.getState().dashboard;
  if (dashboardSettings.quickActionsPlaced) return false;

  const db = getDb();
  const existing = await db.select().from(dashboardWidgets).where(eq(dashboardWidgets.type, 'quick_actions')).limit(1);
  if (existing.length > 0) {
    // Already present. One curated fix-up: when the Safe-to-Spend card was
    // auto-placed between the hero and this row (the old Pass 11 order), the
    // reference layout wants the actions immediately under the hero — move the
    // row above it, once. A deliberately rearranged dashboard keeps its order.
    const all = await db.select().from(dashboardWidgets).orderBy(asc(dashboardWidgets.position));
    const netWorth = all.find((widget) => widget.type === 'net_worth');
    const safeToSpend = all.find((widget) => widget.type === 'safe_to_spend');
    const quickActions = existing[0]!;
    const between =
      netWorth && safeToSpend &&
      (netWorth.position ?? 0) < (safeToSpend.position ?? 0) &&
      (safeToSpend.position ?? 0) < (quickActions.position ?? 0);
    const adjacent = netWorth && (netWorth.position ?? -1) + 1 === (quickActions.position ?? -2);
    if (between && !adjacent && netWorth) {
      await db
        .update(dashboardWidgets)
        .set({ position: sql`${dashboardWidgets.position} + 1` })
        .where(gt(dashboardWidgets.position, netWorth.position ?? 0));
      await db.update(dashboardWidgets).set({ position: (netWorth.position ?? 0) + 1 }).where(eq(dashboardWidgets.id, quickActions.id));
    }
    useSettingsStore.getState().update('dashboard', { quickActionsPlaced: true });
    return false;
  }

  const all = await db.select().from(dashboardWidgets).orderBy(asc(dashboardWidgets.position));
  if (all.length === 0) {
    // A brand-new database gets the default set (which already includes it).
    useSettingsStore.getState().update('dashboard', { quickActionsPlaced: true });
    return false;
  }

  const anchor = all.find((widget) => widget.type === 'net_worth');
  const position = anchor ? (anchor.position ?? 0) + 1 : all.reduce((max, widget) => Math.max(max, widget.position), -1) + 1;

  await db
    .update(dashboardWidgets)
    .set({ position: sql`${dashboardWidgets.position} + 1` })
    .where(gt(dashboardWidgets.position, position - 1));

  await db.insert(dashboardWidgets).values({
    id: createId('wid'),
    type: 'quick_actions',
    position,
    width: 'full',
    height: 'compact',
    configuration: '{}',
    isVisible: true,
  });

  useSettingsStore.getState().update('dashboard', { quickActionsPlaced: true });
  notifyDbChanged();
  return true;
}

export async function migrateDashboardLayout(): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select()
    .from(dashboardWidgets)
    .orderBy(asc(dashboardWidgets.position));
  const types = rows.filter((row) => row.isVisible).map((row) => row.type);
  const matches = (expected: string[]) =>
    types.length === expected.length && types.every((type, index) => type === expected[index]);

  if (!matches(LEGACY_DEFAULT_WIDGET_TYPES) && !matches(LEGACY_V1_DEFAULT_WIDGET_TYPES)) return false;

  await db.delete(dashboardWidgets);
  let position = 0;
  for (const widget of DEFAULT_WIDGETS) {
    await db.insert(dashboardWidgets).values({
      id: createId('wdg'),
      type: widget.type,
      position: position++,
      width: widget.width,
      height: widget.height,
      configuration: '{}',
      isVisible: true,
    });
  }
  notifyDbChanged();
  return true;
}

export async function seedDefaultDashboardWidgets(): Promise<void> {
  const db = getDb();
  const existing = await db.select({ id: dashboardWidgets.id }).from(dashboardWidgets).limit(1);
  if (existing.length > 0) return;
  let position = 0;
  for (const widget of DEFAULT_WIDGETS) {
    await db.insert(dashboardWidgets).values({
      id: createId('wdg'),
      type: widget.type,
      position: position++,
      width: widget.width,
      height: widget.height,
      configuration: '{}',
      isVisible: true,
    });
  }
  notifyDbChanged();
}

/** Removes every row from every user table (Settings → Data → Delete all data). */
export async function clearAllData(): Promise<void> {
  const sqlite = getSqlite();
  const statements = USER_DATA_DELETE_ORDER.map((table) => `DELETE FROM ${table};`).join('\n');
  await sqlite.execAsync(statements);
  notifyDbChanged();
}
