import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

/**
 * Wallnut schema.
 *
 * Money is ALWAYS stored as integer minor units (paise). See src/utils/money.ts.
 * `transactions.amount` is signed from the perspective of `account_id`:
 *   expense    → negative
 *   income     → positive
 *   refund     → positive (not income; netted against expenses in analytics)
 *   transfer   → negative on the source account; the mirror leg is implied by
 *                `transfer_account_id` and never stored as a second row.
 *   adjustment → signed (balance corrections, excluded from income/expense analytics)
 */

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  baseCurrency: text('base_currency').notNull().default('INR'),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
});

export const accountGroups = sqliteTable('account_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('wallet-outline'),
  color: text('color').notNull().default('#8B8CFF'),
  sortOrder: integer('sort_order', { mode: 'number' }).notNull().default(0),
  isCollapsed: integer('is_collapsed', { mode: 'boolean' }).notNull().default(false),
  isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
});

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type', {
      enum: [
        'cash',
        'bank',
        'wallet',
        'credit_card',
        'savings',
        'investment',
        'loan',
        'mortgage',
        'insurance',
        'other',
      ],
    }).notNull(),
    currency: text('currency').notNull().default('INR'),
    initialBalance: integer('initial_balance', { mode: 'number' }).notNull().default(0),
    currentBalance: integer('current_balance', { mode: 'number' }).notNull().default(0),
    icon: text('icon'),
    color: text('color'),
    institution: text('institution'),
    notes: text('notes'),
    groupId: text('group_id'),
    sortOrder: integer('sort_order', { mode: 'number' }).notNull().default(0),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    /* Visibility controls — an investment account can count toward net worth
       without polluting day-to-day cash balances. */
    includeInNetWorth: integer('include_in_net_worth', { mode: 'boolean' }).notNull().default(true),
    includeInTotalBalance: integer('include_in_total_balance', { mode: 'boolean' }).notNull().default(true),
    includeInCashFlow: integer('include_in_cash_flow', { mode: 'boolean' }).notNull().default(true),
    visibleOnDashboard: integer('visible_on_dashboard', { mode: 'boolean' }).notNull().default(true),
    hiddenFromTransactionCreation: integer('hidden_from_transaction_creation', { mode: 'boolean' })
      .notNull()
      .default(false),
    /* Credit cards */
    creditLimit: integer('credit_limit', { mode: 'number' }),
    statementDay: integer('statement_day', { mode: 'number' }),
    paymentDueDay: integer('payment_due_day', { mode: 'number' }),
    minimumPayment: integer('minimum_payment', { mode: 'number' }),
    interestRate: integer('interest_rate', { mode: 'number' }), // basis points, e.g. 4200 = 42.00%
    /* Investments */
    investmentType: text('investment_type', {
      enum: ['stocks', 'mutual_funds', 'etf', 'crypto', 'fd', 'gold', 'other'],
    }),
    costBasis: integer('cost_basis', { mode: 'number' }),
    lastValuationDate: text('last_valuation_date'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('accounts_type_idx').on(table.type),
    index('accounts_archived_idx').on(table.isArchived),
    index('accounts_group_idx').on(table.groupId),
  ],
);

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    icon: text('icon').notNull().default('pricetag-outline'),
    color: text('color').notNull().default('#8B8CFF'),
    parentId: text('parent_id'),
    type: text('type', { enum: ['expense', 'income'] }).notNull().default('expense'),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order', { mode: 'number' }).notNull().default(0),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('categories_parent_idx').on(table.parentId),
    index('categories_type_idx').on(table.type),
    uniqueIndex('categories_name_parent_idx').on(table.name, table.parentId),
  ],
);

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    categoryId: text('category_id'),
    /** Signed integer minor units. */
    amount: integer('amount', { mode: 'number' }).notNull(),
    type: text('type', {
      enum: [
        'expense',
        'income',
        'transfer',
        'refund',
        'adjustment',
        /** Money lent out (negative) or borrowed (positive): moves cash, creates a receivable/liability. */
        'lending',
        'borrowing',
        /** Debt repayments: signed, never income or expense. */
        'debt_payment',
      ],
    }).notNull(),
    merchant: text('merchant'),
    description: text('description'),
    /** YYYY-MM-DD in local time. */
    date: text('date').notNull(),
    notes: text('notes'),
    reference: text('reference'),
    isTransfer: integer('is_transfer', { mode: 'boolean' }).notNull().default(false),
    transferAccountId: text('transfer_account_id'),
    isRecurring: integer('is_recurring', { mode: 'boolean' }).notNull().default(false),
    recurringId: text('recurring_id'),
    installmentId: text('installment_id'),
    fingerprint: text('fingerprint'),
    isReviewed: integer('is_reviewed', { mode: 'boolean' }).notNull().default(false),
    /** Where the row came from: manual | csv | json | ofx | pdf | sms | notification | widget | ai. */
    captureSource: text('capture_source', {
      enum: ['manual', 'csv', 'json', 'ofx', 'pdf', 'sms', 'notification', 'widget', 'ai'],
    })
      .notNull()
      .default('manual'),
    /** Import batch that produced this row (null for manual entry). */
    importBatchId: text('import_batch_id'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('transactions_date_idx').on(table.date),
    index('transactions_account_idx').on(table.accountId),
    index('transactions_category_idx').on(table.categoryId),
    index('transactions_type_idx').on(table.type),
    index('transactions_merchant_idx').on(table.merchant),
    index('transactions_fingerprint_idx').on(table.fingerprint),
    index('transactions_transfer_account_idx').on(table.transferAccountId),
    index('transactions_import_batch_idx').on(table.importBatchId),
  ],
);

/* --------------------------- Statement import staging ----------------------- */

/**
 * Statement imports never write to the ledger directly. A file first becomes a
 * batch of staged drafts; the user reviews them and confirms what belongs in
 * the ledger. Drafts are the only place raw statement text lives, and deleting
 * a batch (abandon) removes it completely.
 */
export const importBatches = sqliteTable(
  'import_batches',
  {
    id: text('id').primaryKey(),
    source: text('source', { enum: ['csv', 'json', 'ofx', 'pdf', 'sms', 'xlsx'] }).notNull(),
    fileName: text('file_name'),
    /** Destination account; individual drafts may override. */
    accountId: text('account_id').notNull(),
    defaultCategoryId: text('default_category_id'),
    status: text('status', { enum: ['staged', 'committed', 'abandoned'] }).notNull().default('staged'),
    totalRows: integer('total_rows', { mode: 'number' }).notNull().default(0),
    confirmedRows: integer('confirmed_rows', { mode: 'number' }).notNull().default(0),
    skippedRows: integer('skipped_rows', { mode: 'number' }).notNull().default(0),
    duplicateRows: integer('duplicate_rows', { mode: 'number' }).notNull().default(0),
    invalidRows: integer('invalid_rows', { mode: 'number' }).notNull().default(0),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
    committedAt: integer('committed_at', { mode: 'number' }),
  },
  (table) => [index('import_batches_status_idx').on(table.status)],
);

export const importDrafts = sqliteTable(
  'import_drafts',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id').notNull(),
    sourceRow: integer('source_row', { mode: 'number' }).notNull(),
    date: text('date'),
    /** Signed integer minor units exactly as the statement showed them. */
    amount: integer('amount', { mode: 'number' }),
    type: text('type', {
      enum: ['expense', 'income', 'transfer', 'refund', 'adjustment'],
    })
      .notNull()
      .default('expense'),
    merchant: text('merchant'),
    description: text('description'),
    /** The statement's raw text, kept for the review card. */
    rawDescription: text('raw_description'),
    /** Destination account (batch default unless a rule rerouted the row). */
    accountId: text('account_id'),
    /** The category that will be written; chosen or applied by rules. */
    categoryId: text('category_id'),
    categorySource: text('category_source', { enum: ['rule', 'statement', 'manual', 'suggestion'] }),
    /** Suggest-mode rule output: shown and preselected, never applied silently. */
    suggestedCategoryId: text('suggested_category_id'),
    suggestedRuleName: text('suggested_rule_name'),
    reference: text('reference'),
    notes: text('notes'),
    fingerprint: text('fingerprint'),
    /** Fingerprint match: 'existing' or "row N" within the same file. */
    duplicateOf: text('duplicate_of'),
    /** Validation errors (JSON array of strings); invalid rows stay reviewable. */
    errors: text('errors').notNull().default('[]'),
    status: text('status', { enum: ['pending', 'confirmed', 'skipped'] })
      .notNull()
      .default('pending'),
    transactionId: text('transaction_id'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('import_drafts_batch_idx').on(table.batchId),
    index('import_drafts_status_idx').on(table.status),
  ],
);

export const transactionSplits = sqliteTable(
  'transaction_splits',
  {
    id: text('id').primaryKey(),
    transactionId: text('transaction_id').notNull(),
    categoryId: text('category_id').notNull(),
    amount: integer('amount', { mode: 'number' }).notNull(),
    note: text('note'),
  },
  (table) => [index('transaction_splits_transaction_idx').on(table.transactionId)],
);

export const budgets = sqliteTable(
  'budgets',
  {
    id: text('id').primaryKey(),
    /** null = an overall budget across all categories. */
    categoryId: text('category_id'),
    name: text('name'),
    amount: integer('amount', { mode: 'number' }).notNull(),
    period: text('period', { enum: ['weekly', 'monthly', 'yearly', 'custom'] }).notNull().default('monthly'),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    rolloverEnabled: integer('rollover_enabled', { mode: 'boolean' }).notNull().default(false),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('budgets_category_idx').on(table.categoryId)],
);

export const recurringTransactions = sqliteTable(
  'recurring_transactions',
  {
    id: text('id').primaryKey(),
    merchant: text('merchant').notNull(),
    description: text('description'),
    amount: integer('amount', { mode: 'number' }).notNull(),
    type: text('type', { enum: ['expense', 'income', 'transfer'] }).notNull().default('expense'),
    categoryId: text('category_id'),
    accountId: text('account_id').notNull(),
    transferAccountId: text('transfer_account_id'),
    frequency: text('frequency', { enum: ['daily', 'weekly', 'monthly', 'yearly', 'custom'] })
      .notNull()
      .default('monthly'),
    /** Interval in `frequency` units for custom schedules (every N days/weeks/months). */
    interval: integer('interval', { mode: 'number' }).notNull().default(1),
    /**
     * Day-of-month the schedule is anchored to (31st stays the 31st; shorter
     * months skip the occurrence instead of drifting, like Wallet).
     */
    anchorDay: integer('anchor_day', { mode: 'number' }),
    nextDate: text('next_date').notNull(),
    endDate: text('end_date'),
    lastPostedDate: text('last_posted_date'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    autoPost: integer('auto_post', { mode: 'boolean' }).notNull().default(true),
    isPaused: integer('is_paused', { mode: 'boolean' }).notNull().default(false),
    /** Subscriptions get annualized cost reporting. */
    isSubscription: integer('is_subscription', { mode: 'boolean' }).notNull().default(false),
    reminderDaysBefore: integer('reminder_days_before', { mode: 'number' }).notNull().default(3),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('recurring_next_date_idx').on(table.nextDate)],
);

export const dashboardWidgets = sqliteTable('dashboard_widgets', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  position: integer('position', { mode: 'number' }).notNull().default(0),
  width: text('width', { enum: ['full', 'half'] }).notNull().default('full'),
  height: text('height', { enum: ['compact', 'medium', 'tall'] }).notNull().default('medium'),
  /** JSON string; widget-specific options (period, accountIds, categoryIds, …). */
  configuration: text('configuration').notNull().default('{}'),
  isVisible: integer('is_visible', { mode: 'boolean' }).notNull().default(true),
});

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    color: text('color').notNull().default('#8B8CFF'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [uniqueIndex('tags_name_idx').on(table.name)],
);

export const transactionTags = sqliteTable(
  'transaction_tags',
  {
    transactionId: text('transaction_id').notNull(),
    tagId: text('tag_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.transactionId, table.tagId] }),
    index('transaction_tags_tag_idx').on(table.tagId),
  ],
);

export const aiCache = sqliteTable(
  'ai_cache',
  {
    id: text('id').primaryKey(),
    /** Deterministic hash of feature + sanitized request payload. */
    requestHash: text('request_hash').notNull(),
    feature: text('feature').notNull(),
    response: text('response').notNull(),
    model: text('model'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
  },
  (table) => [uniqueIndex('ai_cache_hash_idx').on(table.requestHash)],
);

/**
 * Serialized widget snapshots. Derived data only — the ledger is the source of
 * truth — so this table is deliberately excluded from backups and simply
 * recomputed whenever the app or the widget task needs it.
 */
export const widgetSnapshots = sqliteTable('widget_snapshots', {
  /** Fixed key ('latest'); kept generic so more snapshots can be added later. */
  key: text('key').primaryKey(),
  json: text('json').notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
});

export const merchantAliases = sqliteTable(
  'merchant_aliases',
  {
    id: text('id').primaryKey(),
    /** Normalized merchant string to match against. */
    pattern: text('pattern').notNull(),
    /** Canonical display name (e.g. "Amazon"). */
    displayName: text('display_name').notNull(),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [uniqueIndex('merchant_aliases_pattern_idx').on(table.pattern)],
);

/* --------------------------- Second pass: planning -------------------------- */

/**
 * Deterministic transaction rules. `conditions` and `actions` are JSON arrays:
 *   conditions: [{ field, operator, value }]
 *   actions:    [{ type, value }]
 * Evaluated on create/update/import (never on historical rows unless the user
 * runs "Apply rules" explicitly).
 */
export const rules = sqliteTable(
  'rules',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
    /** 'all' = AND, 'any' = OR. */
    matchType: text('match_type', { enum: ['all', 'any'] }).notNull().default('all'),
    /**
     * 'apply' writes the action silently (classic rules). 'suggest' only
     * preselected-and-explains in imports (merchant memory): learned rules start
     * as suggestions and the user opts in to auto-apply per rule.
     */
    mode: text('mode', { enum: ['apply', 'suggest'] }).notNull().default('apply'),
    conditions: text('conditions').notNull().default('[]'),
    actions: text('actions').notNull().default('[]'),
    sortOrder: integer('sort_order', { mode: 'number' }).notNull().default(0),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('rules_enabled_idx').on(table.isEnabled)],
);

export const goals = sqliteTable(
  'goals',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    targetAmount: integer('target_amount', { mode: 'number' }).notNull(),
    /** Optional starting amount before contributions are tracked. */
    initialAmount: integer('initial_amount', { mode: 'number' }).notNull().default(0),
    targetDate: text('target_date'),
    /** Where the saved money physically lives (optional). */
    linkedAccountId: text('linked_account_id'),
    categoryId: text('category_id'),
    icon: text('icon').notNull().default('flag-outline'),
    color: text('color').notNull().default('#8B8CFF'),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('goals_archived_idx').on(table.isArchived)],
);

export const goalContributions = sqliteTable(
  'goal_contributions',
  {
    id: text('id').primaryKey(),
    goalId: text('goal_id').notNull(),
    amount: integer('amount', { mode: 'number' }).notNull(),
    date: text('date').notNull(),
    accountId: text('account_id'),
    transactionId: text('transaction_id'),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('goal_contributions_goal_idx').on(table.goalId)],
);

export const people = sqliteTable('people', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  note: text('note'),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
});

/**
 * Personal debts. `direction` is from the user's perspective:
 *   lent     → they owe me (receivable)
 *   borrowed → I owe them (liability)
 * `remaining` is a stored running total maintained by the debt service.
 */
export const debts = sqliteTable(
  'debts',
  {
    id: text('id').primaryKey(),
    personId: text('person_id').notNull(),
    direction: text('direction', { enum: ['lent', 'borrowed'] }).notNull(),
    principal: integer('principal', { mode: 'number' }).notNull(),
    remaining: integer('remaining', { mode: 'number' }).notNull(),
    date: text('date').notNull(),
    dueDate: text('due_date'),
    accountId: text('account_id'),
    transactionId: text('transaction_id'),
    description: text('description'),
    status: text('status', { enum: ['open', 'settled'] }).notNull().default('open'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('debts_person_idx').on(table.personId),
    index('debts_status_idx').on(table.status),
  ],
);

export const debtPayments = sqliteTable(
  'debt_payments',
  {
    id: text('id').primaryKey(),
    debtId: text('debt_id').notNull(),
    amount: integer('amount', { mode: 'number' }).notNull(),
    date: text('date').notNull(),
    accountId: text('account_id'),
    transactionId: text('transaction_id'),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('debt_payments_debt_idx').on(table.debtId)],
);

/** Quick-add templates ("Lunch ₹250 Food Cash"). */
export const transactionTemplates = sqliteTable('transaction_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  amount: integer('amount', { mode: 'number' }).notNull(),
  type: text('type', {
    enum: ['expense', 'income', 'transfer'],
  }).notNull().default('expense'),
  categoryId: text('category_id'),
  accountId: text('account_id'),
  transferAccountId: text('transfer_account_id'),
  merchant: text('merchant'),
  description: text('description'),
  icon: text('icon').notNull().default('flash-outline'),
  sortOrder: integer('sort_order', { mode: 'number' }).notNull().default(0),
  usageCount: integer('usage_count', { mode: 'number' }).notNull().default(0),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
});

/** Local receipt/attachment references (files live in the app documents dir). */
export const transactionAttachments = sqliteTable(
  'transaction_attachments',
  {
    id: text('id').primaryKey(),
    transactionId: text('transaction_id').notNull(),
    uri: text('uri').notNull(),
    kind: text('kind', { enum: ['image', 'pdf', 'other'] }).notNull().default('image'),
    name: text('name'),
    size: integer('size', { mode: 'number' }),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('transaction_attachments_txn_idx').on(table.transactionId)],
);

/** Installment plans (a purchase converted to N linked monthly charges). */
export const installments = sqliteTable(
  'installments',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    merchant: text('merchant'),
    purchaseAmount: integer('purchase_amount', { mode: 'number' }).notNull(),
    installmentAmount: integer('installment_amount', { mode: 'number' }).notNull(),
    totalCount: integer('total_count', { mode: 'number' }).notNull(),
    postedCount: integer('posted_count', { mode: 'number' }).notNull().default(0),
    startDate: text('start_date').notNull(),
    accountId: text('account_id').notNull(),
    categoryId: text('category_id'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('installments_active_idx').on(table.isActive)],
);

/** Saved report configurations (filters + view) for one-tap reopening. */
export const savedReports = sqliteTable('saved_reports', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  config: text('config').notNull().default('{}'),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
});

/* ------------------------------ Shopping lists ------------------------------ */

/**
 * Shopping lists are plans, not ledger entries. When the user taps "Create
 * transaction", the whole list becomes ONE expense whose splits itemise it —
 * so the ledger sees a single purchase, not one row per item.
 */
export const shoppingLists = sqliteTable(
  'shopping_lists',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    status: text('status', { enum: ['active', 'completed'] }).notNull().default('active'),
    /** The transaction created from this list (null while it is still a plan). */
    transactionId: text('transaction_id'),
    completedAt: integer('completed_at', { mode: 'number' }),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('shopping_lists_status_idx').on(table.status)],
);

export const shoppingListItems = sqliteTable(
  'shopping_list_items',
  {
    id: text('id').primaryKey(),
    listId: text('list_id').notNull(),
    name: text('name').notNull(),
    /** Minor units, per unit. */
    price: integer('price', { mode: 'number' }).notNull().default(0),
    quantity: integer('quantity', { mode: 'number' }).notNull().default(1),
    isChecked: integer('is_checked', { mode: 'boolean' }).notNull().default(false),
    note: text('note'),
    sortOrder: integer('sort_order', { mode: 'number' }).notNull().default(0),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('shopping_list_items_list_idx').on(table.listId)],
);

/* ------------------------------ Shared expenses ------------------------------ */

/**
 * Shared expenses (Splitwise-style) built on top of the existing ledger.
 *
 * Source of truth: `shared_expenses` + `shared_expense_payers` +
 * `shared_expense_participants` + `shared_settlements`. Balances are always
 * computed from these records — never stored — so editing/deleting an expense
 * can never leave a stale debt.
 *
 * A trip can have any number of payers per expense (money is fronted by
 * different people at different times); members' balances net everything out
 * and settlement suggestions show only the transfers still needed.
 *
 * Cash mirroring (services/shared.service.ts) only ever concerns the user:
 *   You pay ₹20,000 of a ₹30,000 villa, your share ₹7,500
 *     → `expense` ₹7,500  (personal spending — analytics show ₹7,500)
 *     → `lending` ₹12,500 (cash leaves the account, creates a receivable)
 *   Someone else pays your share
 *     → no cash row at all; only a payable tracked here.
 * Settlements are `debt_payment` rows — never income, never expenses.
 */
export const sharedGroups = sqliteTable(
  'shared_groups',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    icon: text('icon').notNull().default('people-outline'),
    color: text('color').notNull().default('#8B8CFF'),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('shared_groups_archived_idx').on(table.isArchived)],
);

/** Explicit group membership (people can belong to a group before any expense). */
export const sharedGroupMembers = sqliteTable(
  'shared_group_members',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull(),
    personId: text('person_id').notNull(),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('shared_group_members_group_idx').on(table.groupId),
    uniqueIndex('shared_group_members_unique_idx').on(table.groupId, table.personId),
  ],
);

export const sharedExpenses = sqliteTable(
  'shared_expenses',
  {
    id: text('id').primaryKey(),
    /** Optional group (trip, flat, office lunch…). */
    groupId: text('group_id'),
    title: text('title').notNull(),
    /** Positive minor units — the actual bill, not the user's share. */
    amount: integer('amount', { mode: 'number' }).notNull(),
    date: text('date').notNull(),
    currency: text('currency').notNull().default('INR'),
    /** Category used for the user's own share (others' shares are not expenses). */
    categoryId: text('category_id'),
    /** The account that paid, when the user is the payer. */
    accountId: text('account_id'),
    /** null = the user paid. */
    payerPersonId: text('payer_person_id'),
    notes: text('notes'),
    splitType: text('split_type', { enum: ['equal', 'exact', 'percentage', 'shares'] })
      .notNull()
      .default('equal'),
    /** Mirror ledger rows: the user's own share + the receivable for others. */
    transactionId: text('transaction_id'),
    lendingTransactionId: text('lending_transaction_id'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('shared_expenses_group_idx').on(table.groupId),
    index('shared_expenses_date_idx').on(table.date),
    index('shared_expenses_payer_idx').on(table.payerPersonId),
  ],
);

export const sharedExpenseParticipants = sqliteTable(
  'shared_expense_participants',
  {
    id: text('id').primaryKey(),
    expenseId: text('expense_id').notNull(),
    /** null = the user ("You"). */
    personId: text('person_id'),
    /** Display snapshot so the row survives a renamed/removed person. */
    name: text('name').notNull(),
    /** Computed share, minor units, >= 0; shares sum to the expense amount. */
    share: integer('share', { mode: 'number' }).notNull(),
    /** Raw input for the editor: exact=minor units, percentage=basis points, shares=count. */
    inputValue: integer('input_value', { mode: 'number' }),
  },
  (table) => [
    index('shared_expense_participants_expense_idx').on(table.expenseId),
    index('shared_expense_participants_person_idx').on(table.personId),
  ],
);

/**
 * Line items for a shared expense — a trip booking like "Train travel ₹2,400 +
 * Hotel stay ₹6,000" is one record with several items, so the whole batch is
 * split (and paid) once. The expense `amount` is always the sum of its items;
 * balances and the ledger only ever look at the total, so itemisation can never
 * change the accounting.
 */
export const sharedExpenseItems = sqliteTable(
  'shared_expense_items',
  {
    id: text('id').primaryKey(),
    expenseId: text('expense_id').notNull(),
    name: text('name').notNull(),
    /** Positive minor units. */
    amount: integer('amount', { mode: 'number' }).notNull(),
    sortOrder: integer('sort_order', { mode: 'number' }).notNull().default(0),
  },
  (table) => [index('shared_expense_items_expense_idx').on(table.expenseId)],
);

/**
 * Who actually fronted the money — one row per payer. Split payments (two
 * people paying one bill) are first-class: payers sum to the bill amount, and
 * balances are derived from payers minus participants. `person_id: null` = the
 * user. The source of truth; `shared_expenses.payer_person_id` is kept only as
 * a denormalised "primary payer" for legacy display.
 */
export const sharedExpensePayers = sqliteTable(
  'shared_expense_payers',
  {
    id: text('id').primaryKey(),
    expenseId: text('expense_id').notNull(),
    /** null = the user ("You"). */
    personId: text('person_id'),
    /** Positive minor units this payer fronted. */
    amount: integer('amount', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('shared_expense_payers_expense_idx').on(table.expenseId),
    index('shared_expense_payers_person_idx').on(table.personId),
  ],
);

/**
 * Settlements between any two members. `null` on either side = the user.
 * A settlement only touches the user's cash when one side is the user, and the
 * linked transaction is always `debt_payment` — never income, never expense.
 *
 * `person_id` / `direction` are the old user-centric shape, kept nullable and
 * deprecated purely so migration 0007 can backfill from/to without data loss.
 * Nothing writes or reads them any more.
 */
export const sharedSettlements = sqliteTable(
  'shared_settlements',
  {
    id: text('id').primaryKey(),
    /** Optional attribution to a group. */
    groupId: text('group_id'),
    /** Who sent the money. null = the user. */
    fromPersonId: text('from_person_id'),
    /** Who received it. null = the user. */
    toPersonId: text('to_person_id'),
    amount: integer('amount', { mode: 'number' }).notNull(),
    date: text('date').notNull(),
    accountId: text('account_id'),
    transactionId: text('transaction_id'),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    /** @deprecated legacy user-centric counterpart. */
    personId: text('person_id'),
    /** @deprecated legacy user-centric direction. */
    direction: text('direction', { enum: ['received', 'paid'] }),
  },
  (table) => [
    index('shared_settlements_from_idx').on(table.fromPersonId),
    index('shared_settlements_to_idx').on(table.toPersonId),
    index('shared_settlements_date_idx').on(table.date),
  ],
);

/* --------------------------------- Inbox ----------------------------------- */

/**
 * Financial Inbox dismissals and snoozes.
 *
 * Inbox items are derived (computed from the ledger, schedules and balances),
 * so "Ignore" and "Remind later" are stored here keyed by kind + a stable ref
 * key. When the underlying fact changes (a new due date, a new candidate) the
 * ref key changes and the item may reappear. `snoozed_until = null` means
 * ignored until the fact changes; a timestamp means it comes back after then.
 */
export const inboxDismissals = sqliteTable(
  'inbox_dismissals',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    refKey: text('ref_key').notNull(),
    snoozedUntil: integer('snoozed_until', { mode: 'number' }),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [uniqueIndex('inbox_dismissals_unique_idx').on(table.kind, table.refKey)],
);

/* --------------------------------- Relations -------------------------------- */

export const accountsRelations = relations(accounts, ({ many }) => ({
  transactions: many(transactions),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'category_parent',
  }),
  children: many(categories, { relationName: 'category_parent' }),
  transactions: many(transactions),
}));

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  account: one(accounts, { fields: [transactions.accountId], references: [accounts.id] }),
  transferAccount: one(accounts, {
    fields: [transactions.transferAccountId],
    references: [accounts.id],
    relationName: 'transfer_account',
  }),
  category: one(categories, { fields: [transactions.categoryId], references: [categories.id] }),
  splits: many(transactionSplits),
  tags: many(transactionTags),
}));

export const transactionSplitsRelations = relations(transactionSplits, ({ one }) => ({
  transaction: one(transactions, {
    fields: [transactionSplits.transactionId],
    references: [transactions.id],
  }),
  category: one(categories, {
    fields: [transactionSplits.categoryId],
    references: [categories.id],
  }),
}));

export const transactionTagsRelations = relations(transactionTags, ({ one }) => ({
  transaction: one(transactions, {
    fields: [transactionTags.transactionId],
    references: [transactions.id],
  }),
  tag: one(tags, { fields: [transactionTags.tagId], references: [tags.id] }),
}));

/* ----------------------------------- Types ---------------------------------- */

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type AccountGroup = typeof accountGroups.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type ImportBatch = typeof importBatches.$inferSelect;
export type ImportDraft = typeof importDrafts.$inferSelect;
export type TransactionSplit = typeof transactionSplits.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type RecurringTransaction = typeof recurringTransactions.$inferSelect;
export type DashboardWidget = typeof dashboardWidgets.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type MerchantAlias = typeof merchantAliases.$inferSelect;
export type Rule = typeof rules.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type GoalContribution = typeof goalContributions.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Debt = typeof debts.$inferSelect;
export type DebtPayment = typeof debtPayments.$inferSelect;
export type TransactionTemplate = typeof transactionTemplates.$inferSelect;
export type TransactionAttachment = typeof transactionAttachments.$inferSelect;
export type Installment = typeof installments.$inferSelect;
export type SavedReport = typeof savedReports.$inferSelect;
export type ShoppingList = typeof shoppingLists.$inferSelect;
export type ShoppingListItem = typeof shoppingListItems.$inferSelect;
export type SharedGroup = typeof sharedGroups.$inferSelect;
export type SharedGroupMember = typeof sharedGroupMembers.$inferSelect;
export type SharedExpense = typeof sharedExpenses.$inferSelect;
export type SharedExpenseItem = typeof sharedExpenseItems.$inferSelect;
export type SharedExpenseParticipant = typeof sharedExpenseParticipants.$inferSelect;
export type SharedExpensePayer = typeof sharedExpensePayers.$inferSelect;
export type SharedSettlement = typeof sharedSettlements.$inferSelect;
export type InboxDismissal = typeof inboxDismissals.$inferSelect;

export type AccountType = Account['type'];
export type TransactionType = Transaction['type'];
export type RecurringFrequency = RecurringTransaction['frequency'];
export type InvestmentType = NonNullable<Account['investmentType']>;
