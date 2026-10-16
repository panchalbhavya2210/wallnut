import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { Card, IconName, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { Button, Chip, IconButton, SettingSwitch } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { Field, FormSheet, PickerSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { toast } from '@/stores/ui.store';
import {
  createRule,
  deleteRule,
  describeRule,
  listRules,
  parseActions,
  parseConditions,
  updateRule,
  type RuleAction,
  type RuleActionType,
  type RuleCondition,
  type RuleField,
  type RuleOperator,
} from '@/services/rules.service';
import { buildCategoryTree, listCategories } from '@/services/categories.service';
import { listAccounts } from '@/services/accounts.service';
import { listTags } from '@/services/tags.service';
import type { Rule } from '@/db/schema';

const FIELDS: { value: RuleField; label: string }[] = [
  { value: 'merchant', label: 'Merchant' },
  { value: 'description', label: 'Description' },
  { value: 'amount', label: 'Amount' },
  { value: 'type', label: 'Type' },
];

const OPERATORS: { value: RuleOperator; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'is' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'gt', label: 'greater than' },
  { value: 'lt', label: 'less than' },
];

/** Transaction rules — deterministic, visible, and easy to switch off. */
export default function RulesScreen() {
  const theme = useTheme();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [name, setName] = useState('');
  const [matchType, setMatchType] = useState<'all' | 'any'>('all');
  const [conditions, setConditions] = useState<RuleCondition[]>([{ field: 'merchant', operator: 'contains', value: '' }]);
  const [actions, setActions] = useState<RuleAction[]>([{ type: 'set_category', value: '' }]);
  const [picker, setPicker] = useState<'none' | 'category' | 'account' | 'tag'>('none');
  const [pickerTarget, setPickerTarget] = useState(0);

  const query = useQuery(async () => {
    const [rules, categories, accounts, tags] = await Promise.all([listRules(), listCategories(), listAccounts(), listTags()]);
    return { rules, categories, accounts, tags };
  }, []);

  const openEditor = (rule: Rule | null) => {
    setEditing(rule);
    setName(rule?.name ?? '');
    setMatchType(rule?.matchType ?? 'all');
    setConditions(rule ? parseConditions(rule) : [{ field: 'merchant', operator: 'contains', value: '' }]);
    setActions(rule ? parseActions(rule) : [{ type: 'set_category', value: '' }]);
    setEditorOpen(true);
  };

  const save = async () => {
    try {
      if (!name.trim()) throw new Error('Give the rule a name.');
      if (conditions.some((condition) => !condition.value.trim())) throw new Error('Fill in every condition value.');
      if (editing) {
        await updateRule(editing.id, { name, matchType, conditions, actions });
        toast.success('Rule updated');
      } else {
        await createRule({ name, matchType, conditions, actions });
        toast.success('Rule created');
      }
      setEditorOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the rule');
    }
  };

  const rules = query.data?.rules ?? [];

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Transaction rules"
        subtitle="Categorise, rename and flag new transactions automatically"
        hint={{ id: 'rules', message: 'Rules run on new and imported transactions: match a merchant or amount, then set its category, rename it, or flag it for review.' }}
        right={<IconButton icon="add" onPress={() => openEditor(null)} accessibilityLabel="Add rule" />}
      />

      {query.loading && !query.data ? (
        <LoadingBlock label="Loading rules…" />
      ) : rules.length === 0 ? (
        <EmptyState
          icon="git-branch-outline"
          title="No rules yet"
          message='Example: if the merchant contains "Swiggy", set the category to Food & Dining. Rules only run on new and imported transactions.'
          actionLabel="Create a rule"
          onAction={() => openEditor(null)}
        />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          {rules.map((rule) => {
            const description = describeRule(rule);
            return (
              <Card key={rule.id}>
                <Row justify="space-between" style={{ marginBottom: theme.spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="bodyMedium">{rule.name}</AppText>
                    <AppText variant="caption" tone="muted">
                      {rule.matchType === 'any' ? 'Matches any condition' : 'Matches all conditions'}
                    </AppText>
                  </View>
                  <SettingSwitch
                    title=""
                    value={rule.isEnabled}
                    onValueChange={async (value) => {
                      await updateRule(rule.id, { isEnabled: value });
                      toast.show(value ? 'Rule enabled' : 'Rule paused');
                    }}
                  />
                </Row>
                <View style={{ gap: 4 }}>
                  <AppText variant="caption" tone="secondary">
                    When {description.when}
                  </AppText>
                  <AppText variant="caption" tone="accent">
                    → {description.then || 'no action'}
                  </AppText>
                </View>
                <Row gap="sm" style={{ marginTop: theme.spacing.md }}>
                  <Button label="Edit" size="sm" variant="secondary" onPress={() => openEditor(rule)} />
                  <Button
                    label="Delete"
                    size="sm"
                    variant="ghost"
                    onPress={async () => {
                      const ok = await confirm({ title: `Delete "${rule.name}"?`, tone: 'danger', confirmLabel: 'Delete' });
                      if (!ok) return;
                      await deleteRule(rule.id);
                      toast.show('Rule deleted');
                    }}
                  />
                </Row>
              </Card>
            );
          })}

          <InfoBanner message="Rules run when a transaction is created, edited or imported — never retroactively, so your existing categorisation is never silently rewritten." />
        </View>
      )}

      <FormSheet
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? 'Edit rule' : 'New rule'}
        submitLabel={editing ? 'Save rule' : 'Create rule'}
        onSubmit={save}>
        <Field label="Rule name" value={name} onChangeText={setName} placeholder="e.g. Swiggy → Food & Dining" />

        <Row gap="sm">
          <Chip label="Match all" selected={matchType === 'all'} onPress={() => setMatchType('all')} />
          <Chip label="Match any" selected={matchType === 'any'} onPress={() => setMatchType('any')} />
        </Row>

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="captionMedium" tone="secondary">
            Conditions
          </AppText>
          {conditions.map((condition, index) => (
            <View key={index} style={{ gap: theme.spacing.sm, padding: theme.spacing.md, borderRadius: theme.radius.md, backgroundColor: theme.colors.inputBackground }}>
              <Row gap="sm" wrap>
                {FIELDS.map((field) => (
                  <Chip
                    key={field.value}
                    size="sm"
                    label={field.label}
                    selected={condition.field === field.value}
                    onPress={() =>
                      setConditions((current) => current.map((entry, i) => (i === index ? { ...entry, field: field.value } : entry)))
                    }
                  />
                ))}
              </Row>
              <Row gap="sm" wrap>
                {OPERATORS.map((operator) => (
                  <Chip
                    key={operator.value}
                    size="sm"
                    label={operator.label}
                    selected={condition.operator === operator.value}
                    onPress={() =>
                      setConditions((current) => current.map((entry, i) => (i === index ? { ...entry, operator: operator.value } : entry)))
                    }
                  />
                ))}
              </Row>
              <Field
                label="Value"
                value={condition.value}
                onChangeText={(value) =>
                  setConditions((current) => current.map((entry, i) => (i === index ? { ...entry, value } : entry)))
                }
                placeholder={condition.field === 'amount' ? 'e.g. 10000' : 'e.g. swiggy'}
              />
              {conditions.length > 1 ? (
                <Button
                  label="Remove condition"
                  size="sm"
                  variant="ghost"
                  onPress={() => setConditions((current) => current.filter((_, i) => i !== index))}
                />
              ) : null}
            </View>
          ))}
          <Button
            label="Add condition"
            size="sm"
            variant="secondary"
            onPress={() => setConditions((current) => [...current, { field: 'merchant', operator: 'contains', value: '' }])}
          />
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="captionMedium" tone="secondary">
            Actions
          </AppText>
          {actions.map((action, index) => (
            <View key={index} style={{ gap: theme.spacing.sm, padding: theme.spacing.md, borderRadius: theme.radius.md, backgroundColor: theme.colors.inputBackground }}>
              <Row gap="sm" wrap>
                {(
                  [
                    ['set_category', 'Set category'],
                    ['set_account', 'Set account'],
                    ['set_merchant', 'Rename merchant'],
                    ['add_tag', 'Add tag'],
                    ['mark_review', 'Mark for review'],
                    ['mark_recurring', 'Mark recurring'],
                  ] as [RuleActionType, string][]
                ).map(([value, label]) => (
                  <Chip
                    key={value}
                    size="sm"
                    label={label}
                    selected={action.type === value}
                    onPress={() =>
                      setActions((current) => current.map((entry, i) => (i === index ? { type: value, value: '' } : entry)))
                    }
                  />
                ))}
              </Row>
              {action.type === 'set_category' ? (
                <Button
                  label={query.data?.categories.find((category) => category.id === action.value)?.name ?? 'Choose category'}
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    setPickerTarget(index);
                    setPicker('category');
                  }}
                />
              ) : action.type === 'set_account' ? (
                <Button
                  label={query.data?.accounts.find((account) => account.id === action.value)?.name ?? 'Choose account'}
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    setPickerTarget(index);
                    setPicker('account');
                  }}
                />
              ) : action.type === 'add_tag' ? (
                <Row gap="sm" wrap>
                  {(query.data?.tags ?? []).map((tag) => (
                    <Chip
                      key={tag.id}
                      size="sm"
                      label={tag.name}
                      selected={action.value === tag.name}
                      onPress={() =>
                        setActions((current) => current.map((entry, i) => (i === index ? { ...entry, value: tag.name } : entry)))
                      }
                    />
                  ))}
                </Row>
              ) : action.type === 'set_merchant' ? (
                <Field
                  label="New merchant name"
                  value={action.value}
                  onChangeText={(value) =>
                    setActions((current) => current.map((entry, i) => (i === index ? { ...entry, value } : entry)))
                  }
                  placeholder="e.g. Amazon"
                />
              ) : (
                <AppText variant="caption" tone="muted">
                  No value needed for this action.
                </AppText>
              )}
              {actions.length > 1 ? (
                <Button label="Remove action" size="sm" variant="ghost" onPress={() => setActions((current) => current.filter((_, i) => i !== index))} />
              ) : null}
            </View>
          ))}
          <Button
            label="Add action"
            size="sm"
            variant="secondary"
            onPress={() => setActions((current) => [...current, { type: 'set_category', value: '' }])}
          />
        </View>
      </FormSheet>

      <PickerSheet
        visible={picker === 'category'}
        onClose={() => setPicker('none')}
        title="Category"
        items={buildCategoryTree(query.data?.categories ?? []).flatMap((parent) => [
          { id: parent.id, label: parent.name, icon: parent.icon as IconName, color: parent.color },
          ...parent.children.map((child) => ({ id: child.id, label: child.name, icon: child.icon as IconName, color: child.color, section: parent.name })),
        ])}
        onSelect={(item) => {
          setActions((current) => current.map((entry, i) => (i === pickerTarget ? { ...entry, value: item.id } : entry)));
          setPicker('none');
        }}
      />
      <PickerSheet
        visible={picker === 'account'}
        onClose={() => setPicker('none')}
        title="Account"
        items={(query.data?.accounts ?? []).map((account) => ({ id: account.id, label: account.name, icon: 'wallet-outline' as IconName }))}
        onSelect={(item) => {
          setActions((current) => current.map((entry, i) => (i === pickerTarget ? { ...entry, value: item.id } : entry)));
          setPicker('none');
        }}
      />
    </ScrollScreen>
  );
}
