import { listSelectableAccounts } from '@/services/accounts.service';
import { listCategories } from '@/services/categories.service';
import { listPeople } from '@/services/debts.service';
import { listGoals } from '@/services/goals.service';
import { getRecentMerchants } from '@/services/transactions.service';
import { useSettingsStore } from '@/stores/settings.store';
import { toISODate } from '@/utils/date';

import type { Account, Category, Goal, Person } from '@/db/schema';

/**
 * Local data the command parser needs to interpret one sentence, plus the
 * compact payload that actually reaches the model.
 *
 * The model receives NAMES ONLY — never balances, ids, account numbers, card
 * numbers or anything from the ledger. Resolution of names back to Wallnut
 * rows happens locally, after the response is validated.
 */

export interface QuickEntryLocalData {
  accounts: Account[];
  categories: Category[];
  people: Person[];
  goals: Goal[];
  defaultAccountId: string | null;
  defaultCategoryId: string | null;
  currency: string;
  numberGrouping: 'indian' | 'western';
  /** Day-of-month that starts the user's finance month (Settings → Finance). */
  monthStartDay: number;
}

export async function loadQuickEntryLocalData(): Promise<QuickEntryLocalData> {
  const [accounts, categories, people, goals] = await Promise.all([
    listSelectableAccounts(),
    listCategories(),
    listPeople(),
    listGoals(),
  ]);
  const settings = useSettingsStore.getState();
  return {
    accounts,
    categories,
    people,
    goals,
    defaultAccountId: settings.finance.defaultAccountId,
    defaultCategoryId: settings.finance.defaultCategoryId,
    currency: settings.general.currency,
    numberGrouping: settings.general.numberGrouping,
    monthStartDay: settings.general.monthStartDay,
  };
}

/** The compact context object sent to the model (names only). */
export interface QuickEntryPromptContext {
  today: string;
  weekday: string;
  timezoneOffsetMinutes: number;
  currency: string;
  defaultAccount: string | null;
  accounts: { name: string; type: string }[];
  categories: { name: string; type: 'expense' | 'income' }[];
  recentMerchants: string[];
  people: string[];
  goals: string[];
}

const MAX_ACCOUNTS = 40;
const MAX_CATEGORIES = 80;
const MAX_MERCHANTS = 20;
const MAX_PEOPLE = 40;
const MAX_GOALS = 30;

/**
 * Builds the prompt payload. When "Send financial context to AI" is off only
 * the language scaffolding (date, currency, category names) is included — the
 * sentence itself still carries whatever the user chose to type.
 */
export function buildQuickEntryPromptContext(
  data: QuickEntryLocalData,
  options: { shareContext: boolean; now?: Date; recentMerchants?: string[] },
): QuickEntryPromptContext {
  const now = options.now ?? new Date();
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()] ?? '';
  const base: QuickEntryPromptContext = {
    today: toISODate(now),
    weekday,
    timezoneOffsetMinutes: -now.getTimezoneOffset(),
    currency: data.currency,
    defaultAccount: null,
    accounts: [],
    categories: data.categories
      .filter((category) => !category.isArchived)
      .slice(0, MAX_CATEGORIES)
      .map((category) => ({ name: category.name, type: category.type })),
    recentMerchants: [],
    people: [],
    goals: [],
  };
  if (!options.shareContext) return base;

  const defaultAccount = data.accounts.find((account) => account.id === data.defaultAccountId);
  return {
    ...base,
    defaultAccount: defaultAccount?.name ?? null,
    accounts: data.accounts
      .slice(0, MAX_ACCOUNTS)
      .map((account) => ({ name: account.name, type: account.type })),
    recentMerchants: (options.recentMerchants ?? []).slice(0, MAX_MERCHANTS),
    people: data.people.slice(0, MAX_PEOPLE).map((person) => person.name),
    goals: data.goals
      .filter((goal) => !goal.isArchived)
      .slice(0, MAX_GOALS)
      .map((goal) => goal.name),
  };
}

export async function getRecentMerchantNames(limit = MAX_MERCHANTS): Promise<string[]> {
  try {
    const merchants = await getRecentMerchants(limit);
    return merchants.map((entry) => entry.merchant);
  } catch {
    return [];
  }
}
