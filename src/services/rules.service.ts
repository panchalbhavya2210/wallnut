import { asc, eq, inArray } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { rules, type Rule } from '@/db/schema';
import { notifyDbChanged } from '@/stores/db.store';
import { createId } from '@/utils/id';

/**
 * Rule CRUD. The pure evaluation engine lives in `utils/rules` (no database,
 * unit-testable) and is re-exported here so existing callers keep working.
 *
 * Rules are deterministic and local-first: they run on new and edited
 * transactions as well as imports; they can also be applied retroactively
 * (explicit user action only — never silently rewriting history).
 */

export {
  describeRule,
  evaluateRules,
  parseActions,
  parseConditions,
  ruleMatches,
  RULE_ACTION_LABELS,
  RULE_FIELD_LABELS,
} from '@/utils/rules';
export type {
  RuleAction,
  RuleActionType,
  RuleCondition,
  RuleField,
  RuleOperator,
  RuleOutcome,
  RuleTarget,
} from '@/utils/rules';

export interface RuleInput {
  name: string;
  matchType?: 'all' | 'any';
  conditions: import('@/utils/rules').RuleCondition[];
  actions: import('@/utils/rules').RuleAction[];
  isEnabled?: boolean;
  /** 'apply' writes silently; 'suggest' only proposes (merchant memory). */
  mode?: 'apply' | 'suggest';
}

/* ------------------------------- CRUD ------------------------------------- */

export async function listRules(): Promise<Rule[]> {
  const db = getDb();
  return db.select().from(rules).orderBy(asc(rules.sortOrder), asc(rules.createdAt));
}

export async function createRule(input: RuleInput): Promise<Rule> {
  const db = getDb();
  if (!input.name.trim()) throw new Error('Give the rule a name.');
  if (input.conditions.length === 0) throw new Error('Add at least one condition.');
  if (input.actions.length === 0) throw new Error('Add at least one action.');

  const existing = await db.select({ id: rules.id }).from(rules);
  const now = Date.now();
  const row: Rule = {
    id: createId('rul'),
    name: input.name.trim(),
    isEnabled: input.isEnabled ?? true,
    matchType: input.matchType ?? 'all',
    mode: input.mode ?? 'apply',
    conditions: JSON.stringify(input.conditions),
    actions: JSON.stringify(input.actions),
    sortOrder: existing.length,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(rules).values(row);
  notifyDbChanged();
  return row;
}

export async function updateRule(id: string, patch: Partial<RuleInput> & { sortOrder?: number }): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(rules).where(eq(rules.id, id)).limit(1);
  const current = rows[0];
  if (!current) throw new Error('Rule not found.');
  await db
    .update(rules)
    .set({
      name: patch.name?.trim() ?? current.name,
      isEnabled: patch.isEnabled ?? current.isEnabled,
      matchType: patch.matchType ?? current.matchType,
      mode: patch.mode ?? current.mode,
      conditions: patch.conditions ? JSON.stringify(patch.conditions) : current.conditions,
      actions: patch.actions ? JSON.stringify(patch.actions) : current.actions,
      sortOrder: patch.sortOrder ?? current.sortOrder,
      updatedAt: Date.now(),
    })
    .where(eq(rules.id, id));
  notifyDbChanged();
}

export async function deleteRule(id: string): Promise<void> {
  const db = getDb();
  await db.delete(rules).where(eq(rules.id, id));
  notifyDbChanged();
}

/**
 * Enabled rules, filtered by behaviour. 'apply' is the default: anything that
 * writes silently (manual entry, edits, imports) must never run a *suggest*
 * rule — suggestions only surface in the import review screen.
 */
export async function loadEnabledRules(mode: 'apply' | 'suggest' | 'all' = 'apply'): Promise<Rule[]> {
  const all = await listRules();
  const enabled = all.filter((rule) => rule.isEnabled);
  if (mode === 'all') return enabled;
  return enabled.filter((rule) => (rule.mode === 'suggest' ? 'suggest' : 'apply') === mode);
}

/** Bulk delete helper used by the rules screen. */
export async function deleteRules(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  await db.delete(rules).where(inArray(rules.id, ids));
  notifyDbChanged();
}
