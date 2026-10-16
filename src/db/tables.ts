/**
 * Every table that carries user data, in dependency-safe insert order.
 * `ai_cache` is derived and deliberately excluded. Backup, restore and
 * "delete all data" all use this one list so they can never drift apart.
 */
export const USER_DATA_TABLES = [
  'users',
  'account_groups',
  'accounts',
  'categories',
  'transactions',
  'transaction_splits',
  'tags',
  'transaction_tags',
  'budgets',
  'recurring_transactions',
  'dashboard_widgets',
  'settings',
  'merchant_aliases',
  'rules',
  'people',
  'debts',
  'debt_payments',
  'shared_groups',
  'shared_group_members',
  'shared_expenses',
  'shared_expense_participants',
  'shared_settlements',
  'inbox_dismissals',
  'goals',
  'goal_contributions',
  'transaction_templates',
  'transaction_attachments',
  'installments',
  'saved_reports',
  'shopping_lists',
  'shopping_list_items',
  'import_batches',
  'import_drafts',
] as const;

export type UserDataTable = (typeof USER_DATA_TABLES)[number];

/**
 * Tables that are cleared on wipe/restore but deliberately NOT exported:
 * staged statement drafts are transient, sensitive raw bank text and should
 * never travel inside a backup file. (Deleting them on restore is still
 * required — a restored ledger must not be paired with stale drafts.)
 */
export const VOLATILE_TABLES = ['import_batches', 'import_drafts'] as const;

/** Reverse dependency order for wiping. */
export const USER_DATA_DELETE_ORDER = [...USER_DATA_TABLES].reverse();
