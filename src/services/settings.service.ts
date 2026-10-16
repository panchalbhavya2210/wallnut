import { getDb } from '@/db/client';
import { settings } from '@/db/schema';
import type { AccentName } from '@/theme/colors';
import type { PeriodPreset } from '@/utils/date';
import type { CurrencyCode } from '@/utils/money';

/**
 * Persistent application settings. One row per settings group, JSON encoded.
 * The zustand store hydrates from here at startup and writes back on change.
 */

export interface GeneralSettings {
  onboarded: boolean;
  userName: string;
  currency: CurrencyCode;
  numberGrouping: 'indian' | 'western';
  /** Day of month that starts a "month" for analytics and budgets (1–28). */
  monthStartDay: number;
  /** Show ".00" style decimals in lists. When false, trailing zeros are hidden. */
  showDecimals: boolean;
}

export interface AppearanceSettings {
  theme: 'system' | 'light' | 'dark';
  accent: AccentName;
  /** Typeface id from theme/fonts (inter, poppins, manrope, …). */
  fontFamily: string;
  /** Wallnut's own palette or a Material-style tonal palette. */
  palette: 'wallnut' | 'material';
  /** Use the device wallpaper palette as the Material seed (Android only). */
  deviceColors: boolean;
  /** Pure-black canvas for OLED screens (dark mode only). */
  amoled: boolean;
  /**
   * `theme` → charts use the palette derived from the accent (recommended);
   * `category` → charts use each category's own colour.
   */
  chartColors: 'theme' | 'category';
  reduceMotion: boolean;
  fontScale: 'default' | 'large' | 'xlarge';
  /** Beta palette migration marker — see loadAllSettings. */
  themeVersion?: number;
}

export interface DashboardSettings {
  defaultPeriod: PeriodPreset;
  density: 'comfortable' | 'compact';
  defaultAccountId: string | null;
  showInsights: boolean;
  /** One-time marker: the Safe-to-Spend card has been placed after the hero. */
  safeToSpendPlaced: boolean;
  /** One-time marker: the Category Trends (month-on-month) card has been placed. */
  categoryTrendsPlaced: boolean;
}

export interface FinanceSettings {
  defaultAccountId: string | null;
  defaultCategoryId: string | null;
  defaultTransactionType: 'expense' | 'income' | 'transfer';
  /** Transfers never count as spending; refunds net against expenses. */
  excludeTransfersFromSpending: boolean;
  autoPostRecurring: boolean;
}

export interface TransactionSettings {
  rememberMerchant: boolean;
  confirmDeletion: boolean;
  groupByDate: boolean;
  showIcons: boolean;
  smartDate: boolean;
  /** Period the Records (transactions) screen opens with. */
  recordsPeriod: PeriodPreset;
  /** Statement grouping: auto picks day/week/month from the period. */
  recordsGrouping: 'auto' | 'day' | 'week' | 'month';
  /** Flag imported rows so they land in the review queue. */
  autoReviewImports: boolean;
  /** Flag unusually large expenses for review. */
  flagLargeExpenses: boolean;
}

export interface BudgetSettings {
  defaultPeriod: 'weekly' | 'monthly' | 'yearly';
}

export interface SecuritySettings {
  appLock: boolean;
  biometrics: boolean;
  /** Salted SHA-256 of the unlock PIN; the PIN itself is never stored. */
  pinHash: string | null;
  pinSalt: string | null;
  /** Minutes in the background before locking; 0 = lock immediately. */
  lockAfterMinutes: number;
  /** Privacy mode: mask every amount in the UI (eye toggle on Home). */
  hideAmounts: boolean;
}

export interface NotificationSettings {
  budgetAlerts: boolean;
  debtReminders: boolean;
  recurringReminders: boolean;
  goalReminders: boolean;
  cardReminders: boolean;
  installmentReminders: boolean;
  /** Nudges when someone has owed you money for a while (opt-in — never spam). */
  sharedReminders: boolean;
}

/** First-visit explainers the user has dismissed (keyed per screen/feature). */
export interface HintsSettings {
  dismissed: string[];
}

/** AI & Intelligence (DeepSeek). The key is BYO and stays on-device. */
export interface AiSettings {
  enabled: boolean;
  provider: 'deepseek';
  /** User-provided DeepSeek API key. Stored locally in SQLite only. */
  apiKey: string;
  model: string;
  baseUrl: string;
  /** none → never send financial data; anonymized → aggregates + masked names; detailed → names allowed. */
  privacy: 'none' | 'anonymized' | 'detailed';
  categorization: boolean;
  insights: boolean;
  assistant: boolean;
  affordability: boolean;
  monthlyReview: boolean;
  /** Natural-language transaction entry ("Spent 450 at Zomato"). */
  quickEntry: boolean;
  /** ALWAYS = full review · SMART = one-tap card · AUTO = trusted quick save. */
  confirmationMode: 'always' | 'smart' | 'auto';
  /** Show example/suggestion chips in the Quick Entry sheet. */
  suggestions: boolean;
  /** Send account/category/merchant names with a parse request. */
  shareContext: boolean;
  /** Money-usage bookkeeping for the settings screen. */
  usageCount: number;
  usageMonth: string;
  estimatedCostUsd: number;
}

/** Android home-screen widgets. Values are read by the widget task handler too. */
export interface WidgetSettings {
  enabled: boolean;
  /** Widget offered by "Add to home screen". */
  defaultWidget: 'snapshot' | 'balance' | 'upcoming' | 'quickAdd';
  /** When off, widgets render "Open Wallnut" instead of amounts. */
  showAmounts: boolean;
}

export interface SettingsGroups {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  dashboard: DashboardSettings;
  finance: FinanceSettings;
  transactions: TransactionSettings;
  budgets: BudgetSettings;
  security: SecuritySettings;
  notifications: NotificationSettings;
  hints: HintsSettings;
  ai: AiSettings;
  widgets: WidgetSettings;
}

export const DEFAULT_SETTINGS: SettingsGroups = {
  general: {
    onboarded: false,
    userName: '',
    currency: 'INR',
    numberGrouping: 'indian',
    monthStartDay: 1,
    showDecimals: false,
  },
  appearance: {
    theme: 'light',
    accent: 'botanical',
    fontFamily: 'inter',
    palette: 'wallnut',
    deviceColors: false,
    amoled: false,
    chartColors: 'theme',
    reduceMotion: false,
    fontScale: 'default',
    themeVersion: 3,
  },
  dashboard: {
    defaultPeriod: 'thisMonth',
    density: 'comfortable',
    defaultAccountId: null,
    showInsights: true,
    safeToSpendPlaced: false,
    categoryTrendsPlaced: false,
  },
  finance: {
    defaultAccountId: null,
    defaultCategoryId: null,
    defaultTransactionType: 'expense',
    excludeTransfersFromSpending: true,
    autoPostRecurring: true,
  },
  transactions: {
    rememberMerchant: true,
    confirmDeletion: true,
    groupByDate: true,
    showIcons: true,
    smartDate: true,
    recordsPeriod: '30d',
    recordsGrouping: 'auto',
    autoReviewImports: true,
    flagLargeExpenses: true,
  },
  budgets: {
    defaultPeriod: 'monthly',
  },
  security: {
    appLock: false,
    biometrics: false,
    pinHash: null,
    pinSalt: null,
    lockAfterMinutes: 0,
    hideAmounts: false,
  },
  notifications: {
    budgetAlerts: true,
    debtReminders: true,
    recurringReminders: true,
    goalReminders: true,
    cardReminders: true,
    installmentReminders: true,
    sharedReminders: false,
  },
  hints: {
    dismissed: [],
  },
  ai: {
    enabled: false,
    provider: 'deepseek',
    apiKey: '',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com',
    privacy: 'anonymized',
    categorization: true,
    insights: true,
    assistant: true,
    affordability: true,
    monthlyReview: true,
    quickEntry: true,
    confirmationMode: 'always',
    suggestions: true,
    shareContext: true,
    usageCount: 0,
    usageMonth: '',
    estimatedCostUsd: 0,
  },
  widgets: {
    enabled: true,
    defaultWidget: 'snapshot',
    showAmounts: true,
  },
};

export type SettingsGroupKey = keyof SettingsGroups;

export async function loadAllSettings(): Promise<Partial<SettingsGroups>> {
  const db = getDb();
  const rows = await db.select().from(settings);
  const result: Partial<SettingsGroups> = {};
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.value) as Record<string, unknown>;
      const key = row.key as SettingsGroupKey;
      if (!(key in DEFAULT_SETTINGS)) continue;

      if (key === 'appearance') {
        const appearance = { ...DEFAULT_SETTINGS.appearance, ...(parsed as Partial<AppearanceSettings>) };
        // Beta brand refresh: indigo was the old default and reads as generic
        // fintech blue. Installs that never left the default move to magenta;
        // an explicit choice afterwards is preserved (themeVersion is set).
        if ((appearance.themeVersion ?? 0) < 2 && appearance.accent === 'indigo') {
          appearance.accent = 'magenta';
        }
        // Pass 19 — the finance-app revamp: green identity on a light canvas.
        // Installs still on the previous default (magenta on dark) follow;
        // anything the user picked themselves is left alone.
        if ((appearance.themeVersion ?? 0) < 3) {
          if (appearance.accent === 'magenta') appearance.accent = DEFAULT_SETTINGS.appearance.accent;
          if (appearance.theme === 'dark') appearance.theme = DEFAULT_SETTINGS.appearance.theme;
        }
        appearance.themeVersion = 3;
        result.appearance = appearance;
        continue;
      }

      result[key] = { ...DEFAULT_SETTINGS[key], ...parsed } as never;
    } catch {
      // Ignore malformed rows; defaults win.
    }
  }
  return result;
}

export async function saveSettingGroup<K extends SettingsGroupKey>(
  key: K,
  value: SettingsGroups[K],
): Promise<void> {
  const db = getDb();
  const payload = JSON.stringify(value);
  const now = Date.now();
  await db
    .insert(settings)
    .values({ key, value: payload, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: payload, updatedAt: now } });
}

export async function resetSettings(): Promise<void> {
  const db = getDb();
  await db.delete(settings);
}
