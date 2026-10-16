import type { Rule } from '@/db/schema';

/**
 * The pure rule engine — no database, no React Native. `services/rules.service`
 * re-exports everything here, so callers can keep importing from either path.
 *
 * Rules are deterministic and local by design: they run on new transactions,
 * edits and imports before any AI is ever considered.
 */

export type RuleField = 'merchant' | 'description' | 'amount' | 'type' | 'accountId' | 'categoryId' | 'date';
export type RuleOperator = 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'gt' | 'lt' | 'between';

export interface RuleCondition {
  field: RuleField;
  operator: RuleOperator;
  value: string;
  /** Second value for `between`. */
  value2?: string;
}

export type RuleActionType =
  | 'set_category'
  | 'set_account'
  | 'set_merchant'
  | 'add_tag'
  | 'mark_recurring'
  | 'mark_review'
  | 'set_type';

export interface RuleAction {
  type: RuleActionType;
  value: string;
}

export interface RuleTarget {
  merchant?: string | null;
  description?: string | null;
  amount?: number | null;
  type?: string | null;
  accountId?: string | null;
  categoryId?: string | null;
  date?: string | null;
}

export interface RuleOutcome {
  matchedRuleIds: string[];
  categoryId?: string | null;
  accountId?: string | null;
  merchant?: string | null;
  type?: string | null;
  addTagNames: string[];
  markRecurring: boolean;
  markReview: boolean;
}

export function parseConditions(rule: Rule): RuleCondition[] {
  try {
    const parsed = JSON.parse(rule.conditions) as RuleCondition[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseActions(rule: Rule): RuleAction[] {
  try {
    const parsed = JSON.parse(rule.actions) as RuleAction[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function numeric(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function conditionMatches(condition: RuleCondition, target: RuleTarget): boolean {
  const raw = ((): string | null => {
    switch (condition.field) {
      case 'merchant':
        return target.merchant ?? null;
      case 'description':
        return target.description ?? null;
      case 'amount':
        return target.amount == null ? null : String(Math.abs(target.amount));
      case 'type':
        return target.type ?? null;
      case 'accountId':
        return target.accountId ?? null;
      case 'categoryId':
        return target.categoryId ?? null;
      case 'date':
        return target.date ?? null;
      default:
        return null;
    }
  })();

  const value = condition.value?.trim() ?? '';
  if (raw === null) return false;

  switch (condition.operator) {
    case 'contains':
      return raw.toLowerCase().includes(value.toLowerCase());
    case 'equals':
      return raw.toLowerCase() === value.toLowerCase();
    case 'startsWith':
      return raw.toLowerCase().startsWith(value.toLowerCase());
    case 'endsWith':
      return raw.toLowerCase().endsWith(value.toLowerCase());
    case 'gt': {
      const left = numeric(raw);
      const right = numeric(value);
      return left !== null && right !== null && left > right;
    }
    case 'lt': {
      const left = numeric(raw);
      const right = numeric(value);
      return left !== null && right !== null && left < right;
    }
    case 'between': {
      const left = numeric(raw);
      const low = numeric(value);
      const high = numeric(condition.value2);
      return left !== null && low !== null && high !== null && left >= low && left <= high;
    }
    default:
      return false;
  }
}

export function ruleMatches(rule: Rule, target: RuleTarget): boolean {
  const conditions = parseConditions(rule);
  if (conditions.length === 0) return false;
  if (rule.matchType === 'any') return conditions.some((condition) => conditionMatches(condition, target));
  return conditions.every((condition) => conditionMatches(condition, target));
}

/** Evaluates enabled rules in order and merges their actions. */
export function evaluateRules(enabledRules: Rule[], target: RuleTarget): RuleOutcome {  const outcome: RuleOutcome = {
    matchedRuleIds: [],
    addTagNames: [],
    markRecurring: false,
    markReview: false,
  };
  for (const rule of enabledRules) {
    if (!ruleMatches(rule, target)) continue;
    outcome.matchedRuleIds.push(rule.id);
    for (const action of parseActions(rule)) {
      switch (action.type) {
        case 'set_category':
          outcome.categoryId = action.value;
          break;
        case 'set_account':
          outcome.accountId = action.value;
          break;
        case 'set_merchant':
          outcome.merchant = action.value;
          break;
        case 'set_type':
          outcome.type = action.value;
          break;
        case 'add_tag':
          if (action.value && !outcome.addTagNames.includes(action.value)) outcome.addTagNames.push(action.value);
          break;
        case 'mark_recurring':
          outcome.markRecurring = true;
          break;
        case 'mark_review':
          outcome.markReview = true;
          break;
      }
    }
  }
  return outcome;
}

/**
 * Splits rules by how they behave when they match:
 *   apply   — write the action silently (classic rules, manual entry + imports)
 *   suggest — only propose (merchant memory): imports preselect and explain it,
 *             and the user opts into "apply silently" per rule.
 */
export function partitionRulesByMode(rules: Rule[]): { apply: Rule[]; suggest: Rule[] } {
  const apply: Rule[] = [];
  const suggest: Rule[] = [];
  for (const rule of rules) (rule.mode === 'suggest' ? suggest : apply).push(rule);
  return { apply, suggest };
}

/** Human-readable one-liner used by the rules list ("Merchant contains "Swiggy" → Food & Dining"). */
export function describeRule(rule: Rule): { when: string; then: string } {  const conditions = parseConditions(rule);
  const actions = parseActions(rule);
  const conditionText = conditions
    .map((condition) => {
      const fieldLabel: Record<RuleField, string> = {
        merchant: 'Merchant',
        description: 'Description',
        amount: 'Amount',
        type: 'Type',
        accountId: 'Account',
        categoryId: 'Category',
        date: 'Date',
      };
      const operatorLabel: Record<RuleOperator, string> = {
        contains: 'contains',
        equals: 'is',
        startsWith: 'starts with',
        endsWith: 'ends with',
        gt: '>',
        lt: '<',
        between: 'between',
      };
      if (condition.operator === 'between') {
        return `${fieldLabel[condition.field]} between ${condition.value} and ${condition.value2 ?? ''}`;
      }
      return `${fieldLabel[condition.field]} ${operatorLabel[condition.operator]} "${condition.value}"`;
    })
    .join(rule.matchType === 'any' ? ' OR ' : ' AND ');

  const actionText = actions
    .map((action) => {
      switch (action.type) {
        case 'set_category':
          return 'set category';
        case 'set_account':
          return 'set account';
        case 'set_merchant':
          return `rename "${action.value}"`;
        case 'set_type':
          return `set type to ${action.value}`;
        case 'add_tag':
          return `add tag "${action.value}"`;
        case 'mark_recurring':
          return 'mark recurring';
        case 'mark_review':
          return 'needs review';
      }
    })
    .join(', ');

  return { when: conditionText, then: actionText };
}

export const RULE_FIELD_LABELS: Record<RuleField, string> = {
  merchant: 'Merchant',
  description: 'Description',
  amount: 'Amount',
  type: 'Type',
  accountId: 'Account',
  categoryId: 'Category',
  date: 'Date',
};

export const RULE_ACTION_LABELS: Record<RuleActionType, string> = {
  set_category: 'Set category',
  set_account: 'Set account',
  set_merchant: 'Rename merchant',
  add_tag: 'Add tag',
  mark_recurring: 'Mark as recurring',
  mark_review: 'Mark for review',
  set_type: 'Set type',
};
