import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, IconButton } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { AmountField, Field, FormSheet, PickerSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import { createTemplate, deleteTemplate, listTemplates, markTemplateUsed, updateTemplate } from '@/services/templates.service';
import { buildCategoryTree, listCategories } from '@/services/categories.service';
import { ACCOUNT_TYPE_LABELS, listAccounts } from '@/services/accounts.service';
import type { TransactionTemplate } from '@/db/schema';

/** Quick templates — prefill the composer with one tap, never auto-save. */
export default function TemplatesScreen() {
  const theme = useTheme();
  const money = useMoney();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TransactionTemplate | null>(null);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(0);
  const [type, setType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [merchant, setMerchant] = useState('');
  const [picker, setPicker] = useState<'none' | 'category' | 'account'>('none');

  const query = useQuery(async () => {
    const [templates, categories, accounts] = await Promise.all([listTemplates(), listCategories(), listAccounts()]);
    return { templates, categories, accounts };
  }, []);

  const openEditor = (template: TransactionTemplate | null) => {
    setEditing(template);
    setName(template?.name ?? '');
    setAmount(template?.amount ?? 0);
    setType(template?.type ?? 'expense');
    setCategoryId(template?.categoryId ?? null);
    setAccountId(template?.accountId ?? null);
    setMerchant(template?.merchant ?? '');
    setEditorOpen(true);
  };

  const save = async () => {
    try {
      if (!name.trim()) throw new Error('Give the template a name.');
      if (amount <= 0) throw new Error('Enter an amount.');
      const payload = { name, amount, type, categoryId, accountId, merchant: merchant || null };
      if (editing) {
        await updateTemplate(editing.id, payload);
        toast.success('Template updated');
      } else {
        await createTemplate(payload);
        toast.success('Template created');
      }
      setEditorOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save');
    }
  };

  const templates = query.data?.templates ?? [];

  const use = async (template: TransactionTemplate) => {
    await markTemplateUsed(template.id);
    const params = new URLSearchParams({
      type: template.type,
      amount: (template.amount / 100).toString(),
      ...(template.categoryId ? { categoryId: template.categoryId } : {}),
      ...(template.accountId ? { accountId: template.accountId } : {}),
      ...(template.merchant ? { merchant: template.merchant } : {}),
    });
    router.push(`/transaction/new?${params.toString()}` as never);
  };

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Quick templates"
        subtitle="One tap to prefill - you still confirm before saving"
        hint={{ id: 'templates', message: 'Templates prefill the composer for transactions you repeat. Tap Use for a filled-in form — amount, account, category and merchant all carry over.' }}
        right={<IconButton icon="add" onPress={() => openEditor(null)} accessibilityLabel="Add template" />}
      />

      {query.loading && !query.data ? (
        <LoadingBlock label="Loading templates…" />
      ) : templates.length === 0 ? (
        <EmptyState
          icon="flash-outline"
          title="No templates yet"
          message='"Lunch ₹250 · Food · Cash" — save the transactions you repeat and enter them in two taps.'
          actionLabel="Create a template"
          onAction={() => openEditor(null)}
        />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          {templates.map((template) => {
            const category = query.data?.categories.find((entry) => entry.id === template.categoryId);
            const account = query.data?.accounts.find((entry) => entry.id === template.accountId);
            return (
              <Card key={template.id}>
                <Row justify="space-between" style={{ marginBottom: theme.spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="bodyMedium">{template.name}</AppText>
                    <AppText variant="caption" tone="muted">
                      {category?.name ?? 'Uncategorised'}
                      {account ? ` · ${account.name}` : ''}
                      {template.usageCount > 0 ? ` · used ${template.usageCount}×` : ''}
                    </AppText>
                  </View>
                  <MoneyText amount={-template.amount} variant="numericBody" tone="neutral" />
                </Row>
                <Row gap="sm">
                  <Button label="Use" size="sm" onPress={() => use(template)} />
                  <Button label="Edit" size="sm" variant="secondary" onPress={() => openEditor(template)} />
                  <Button
                    label="Delete"
                    size="sm"
                    variant="ghost"
                    onPress={async () => {
                      const ok = await confirm({ title: `Delete "${template.name}"?`, tone: 'danger', confirmLabel: 'Delete' });
                      if (!ok) return;
                      await deleteTemplate(template.id);
                      toast.show('Template deleted');
                    }}
                  />
                </Row>
              </Card>
            );
          })}

          <InfoBanner message="Templates only prefill the composer. Nothing is saved until you tap Add — so you can tweak the amount every time." />
        </View>
      )}

      <FormSheet
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? 'Edit template' : 'New template'}
        submitLabel={editing ? 'Save template' : 'Create template'}
        onSubmit={save}>
        <Field label="Template name" value={name} onChangeText={setName} placeholder="e.g. Lunch" />
        <AmountField label="Amount" valueMinor={amount} onChangeMinor={setAmount} currencySymbol={money.currency === 'INR' ? '₹' : money.currency} />
        <Row gap="sm">
          <Button label="Expense" size="sm" variant={type === 'expense' ? 'primary' : 'secondary'} onPress={() => setType('expense')} />
          <Button label="Income" size="sm" variant={type === 'income' ? 'primary' : 'secondary'} onPress={() => setType('income')} />
        </Row>
        <Field label="Merchant (optional)" value={merchant} onChangeText={setMerchant} placeholder="e.g. Chai Point" />
        <Button
          label={query.data?.categories.find((entry) => entry.id === categoryId)?.name ?? 'Choose category'}
          variant="secondary"
          onPress={() => setPicker('category')}
        />
        <Button
          label={query.data?.accounts.find((entry) => entry.id === accountId)?.name ?? 'Choose account'}
          variant="secondary"
          onPress={() => setPicker('account')}
        />
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
          setCategoryId(item.id);
          setPicker('none');
        }}
      />
      <PickerSheet
        visible={picker === 'account'}
        onClose={() => setPicker('none')}
        title="Account"
        items={(query.data?.accounts ?? []).map((account) => ({
          id: account.id,
          label: account.name,
          subtitle: ACCOUNT_TYPE_LABELS[account.type],
          icon: 'wallet-outline' as IconName,
        }))}
        onSelect={(item) => {
          setAccountId(item.id);
          setPicker('none');
        }}
      />
    </ScrollScreen>
  );
}
