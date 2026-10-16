import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/theme';
import { IconName, Row } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, Chip, IconButton, SegmentedControl } from '@/components/ui/controls';
import { BottomSheet, DatePickerSheet, Field, FormSheet, PickerSheet } from '@/components/ui/sheets';
import { AmountDisplay, AmountKeypad } from '@/components/AmountKeypad';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { toast } from '@/stores/ui.store';
import { ACCOUNT_TYPE_LABELS, listAccounts, listSelectableAccounts } from '@/services/accounts.service';
import { buildCategoryTree, listCategories } from '@/services/categories.service';
import { listTags } from '@/services/tags.service';
import {
  createTransaction,
  deleteTransaction,
  getRecentMerchants,
  getTransactionDetail,
  updateTransaction,
  type TransactionSplitInput,
} from '@/services/transactions.service';
import { addAttachment } from '@/services/attachments.service';
import { aiFeatureStatus, aiStatusMessage } from '@/ai/client';
import { suggestCategory, type CategorySuggestion } from '@/ai/features';
import { fromISODate, toISODate } from '@/utils/date';
import type { TransactionType } from '@/db/schema';

/**
 * Quick-add / edit transaction. Amount first, everything else one tap away in
 * sheets. Never more than one screen, never a giant form.
 */

type ComposerType = 'expense' | 'income' | 'transfer';

export default function TransactionComposer() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const money = useMoney();
  const params = useLocalSearchParams<{ id?: string; type?: string; templateId?: string; amount?: string; accountId?: string; categoryId?: string; merchant?: string; to?: string; date?: string; notes?: string }>();
  const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const editingId = params.id;

  const settings = useSettingsStore((state) => state);
  const updateFinance = useSettingsStore((state) => state.update);

  const [type, setType] = useState<ComposerType>((param(params.type) as ComposerType) ?? settings.finance.defaultTransactionType);
  // Quick templates (and deep links) prefill amount/account/category/merchant.
  const [amountText, setAmountText] = useState(() => param(params.amount) ?? '');
  const [accountId, setAccountId] = useState<string | null>(() => param(params.accountId) ?? settings.finance.defaultAccountId);
  const [transferAccountId, setTransferAccountId] = useState<string | null>(() => param(params.to) ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(() => param(params.categoryId) ?? settings.finance.defaultCategoryId);
  const [merchant, setMerchant] = useState(() => param(params.merchant) ?? '');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => fromISODate(param(params.date) ?? '') ?? new Date());
  const [notes, setNotes] = useState(() => param(params.notes) ?? '');
  const [reference, setReference] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [splits, setSplits] = useState<TransactionSplitInput[]>([]);
  const [isReviewed, setIsReviewed] = useState(true);
  const [pendingFiles, setPendingFiles] = useState<{ uri: string; name: string; mimeType?: string | null; size?: number | null }[]>([]);
  const [sheet, setSheet] = useState<'none' | 'category' | 'account' | 'to' | 'merchant' | 'date' | 'tags' | 'advanced' | 'split'>('none');
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<CategorySuggestion | null>(null);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [loaded, setLoaded] = useState(!editingId);

  const categoriesQuery = useQuery(() => listCategories(), []);
  const accountsQuery = useQuery(() => listSelectableAccounts(), []);
  const allAccountsQuery = useQuery(() => listAccounts(), []);
  const tagsQuery = useQuery(() => listTags(), []);
  const recentMerchants = useQuery(() => getRecentMerchants(14), []);

  /* ------------------------------ Load for edit ----------------------------- */
  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    void (async () => {
      const detail = await getTransactionDetail(editingId);
      if (cancelled || !detail) return;
      setType(detail.type === 'income' ? 'income' : detail.type === 'transfer' ? 'transfer' : 'expense');
      setAmountText((Math.abs(detail.amount) / 100).toFixed(2).replace(/\.00$/, ''));
      setAccountId(detail.accountId);
      setTransferAccountId(detail.transferAccountId);
      setCategoryId(detail.categoryId);
      setMerchant(detail.merchant ?? '');
      setDescription(detail.description ?? '');
      setDate(fromISODate(detail.date) ?? new Date());
      setNotes(detail.notes ?? '');
      setReference(detail.reference ?? '');
      setTagIds(detail.tagIds);
      setIsReviewed(detail.isReviewed);
      if (detail.splits.length > 0) {
        setSplits(detail.splits.map((split) => ({ categoryId: split.categoryId, amount: split.amount, note: split.note })));
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [editingId]);

  /* ------------------------------ Derived state ----------------------------- */
  const selectedAccount = useMemo(
    () => allAccountsQuery.data?.find((account) => account.id === accountId) ?? null,
    [allAccountsQuery.data, accountId],
  );
  const selectedCategory = useMemo(
    () => categoriesQuery.data?.find((category) => category.id === categoryId) ?? null,
    [categoriesQuery.data, categoryId],
  );
  const transferAccount = useMemo(
    () => allAccountsQuery.data?.find((account) => account.id === transferAccountId) ?? null,
    [allAccountsQuery.data, transferAccountId],
  );

  const amountMinor = useMemo(() => {
    const parsed = Number(amountText || '0');
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }, [amountText]);

  useEffect(() => {
    if (!accountId && accountsQuery.data && accountsQuery.data.length > 0) {
      setAccountId(accountsQuery.data[0]!.id);
    }
  }, [accountsQuery.data, accountId]);

  const categoryItems = useMemo(() => {
    const list = categoriesQuery.data ?? [];
    const typeFilter = type === 'income' ? 'income' : 'expense';
    const filtered = list.filter((category) => !category.parentId && category.type === typeFilter);
    const byParent = new Map<string, typeof list>();
    for (const category of list) {
      if (!category.parentId) continue;
      const bucket = byParent.get(category.parentId) ?? [];
      bucket.push(category);
      byParent.set(category.parentId, bucket);
    }
    return filtered.flatMap((parent) => [
      {
        id: parent.id,
        label: parent.name,
        icon: parent.icon as IconName,
        color: parent.color,
        section: type === 'income' ? 'Income' : 'Categories',
      },
      ...(byParent.get(parent.id) ?? []).map((child) => ({
        id: child.id,
        label: child.name,
        icon: child.icon as IconName,
        color: child.color,
        section: parent.name,
      })),
    ]);
  }, [categoriesQuery.data, type]);

  const splitRemaining = amountMinor - splits.reduce((sum, split) => sum + Math.round(split.amount), 0);

  // The suggestion belongs to the merchant/amount it was made for.
  useEffect(() => {
    setAiSuggestion(null);
  }, [merchant, categoryId, type]);

  const suggestCategoryWithAi = async () => {
    const status = aiFeatureStatus('categorization');
    if (status) {
      toast.show(aiStatusMessage(status));
      router.push('/settings/ai' as never);
      return;
    }
    setAiSuggesting(true);
    try {
      const categories = categoryItems.map((item) => ({
        id: item.id,
        name: item.label,
        parentName: item.section !== 'Categories' && item.section !== 'Income' ? item.section : null,
      }));
      const result = await suggestCategory({
        merchant,
        amountMinor,
        type: type === 'income' ? 'income' : 'expense',
        categories,
      });
      if (result.ok) setAiSuggestion(result.data);
      else toast.error(aiStatusMessage(result.error));
    } catch {
      toast.error('Could not ask DeepSeek for a category');
    } finally {
      setAiSuggesting(false);
    }
  };

  /* --------------------------------- Actions -------------------------------- */

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (amountMinor === 0) throw new Error('Enter an amount above zero.');
      if (!accountId) throw new Error('Choose an account.');
      if (type === 'transfer' && !transferAccountId) throw new Error('Choose the destination account.');
      if (type === 'expense' && splits.length > 0 && splitRemaining !== 0) {
        throw new Error('Splits must add up to the total amount.');
      }

      const payload = {
        accountId,
        categoryId: type === 'transfer' ? null : categoryId,
        amount: amountMinor,
        type: (type === 'expense' ? 'expense' : type === 'income' ? 'income' : 'transfer') as TransactionType,
        merchant: merchant || null,
        description: description || null,
        date: toISODate(date),
        notes: notes || null,
        reference: reference || null,
        transferAccountId: type === 'transfer' ? transferAccountId : null,
        isReviewed,
        splits: type === 'expense' || type === 'income' ? splits : [],
        tagIds,
        applyRules: !editingId,
      };

      let savedId = editingId ?? null;
      if (editingId) {
        await updateTransaction(editingId, payload);
      } else {
        const created = await createTransaction(payload);
        savedId = created.id;
      }

      if (savedId && pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          await addAttachment(savedId, file);
        }
      }

      if (!editingId) {
        updateFinance('finance', {
          defaultAccountId: accountId,
          defaultCategoryId: categoryId,
        });
      }
      const kind = type === 'transfer' ? 'Transfer' : type === 'income' ? 'Income' : 'Expense';
      toast.success(`${money.format(amountMinor)}${merchant ? ` · ${merchant}` : ''}`, {
        title: editingId ? `${kind} updated` : `${kind} saved`,
      });
      router.back();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the transaction');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editingId) return;
    const ok = await confirm({ title: 'Delete this transaction?', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    await deleteTransaction(editingId);
    toast.show('Transaction deleted');
    router.back();
  };

  const pickReceipt = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;
      setPendingFiles((current) => [
        ...current,
        ...result.assets.map((asset) => ({
          uri: asset.uri,
          name: asset.name ?? 'receipt',
          mimeType: asset.mimeType,
          size: asset.size,
        })),
      ]);
      if (editingId) {
        for (const asset of result.assets) {
          await addAttachment(editingId, {
            uri: asset.uri,
            name: asset.name ?? 'receipt',
            mimeType: asset.mimeType,
            size: asset.size,
          });
        }
        setPendingFiles((current) => current.slice(0, 0));
        toast.success('Receipt attached');
      }
    } catch {
      toast.error('Could not attach that file');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm }}>
        <IconButton icon="close" onPress={() => router.back()} accessibilityLabel="Close" />
        <AppText variant="titleSmall">{editingId ? 'Edit transaction' : 'New transaction'}</AppText>
        {editingId ? (
          <IconButton icon="trash-outline" onPress={remove} color={theme.colors.negative} accessibilityLabel="Delete" />
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {/* Amount */}
        <View style={{ alignItems: 'center', paddingVertical: theme.spacing.lg }}>
          <AmountDisplay
            value={amountText}
            currencySymbol={money.currency === 'INR' ? '₹' : money.currency}
            tone={type === 'expense' ? 'negative' : type === 'income' ? 'positive' : 'primary'}
          />
        </View>

        {/* Type */}
        <SegmentedControl
          options={[
            { value: 'expense', label: 'Expense' },
            { value: 'income', label: 'Income' },
            { value: 'transfer', label: 'Transfer' },
            { value: 'shared', label: 'Shared' },
          ]}
          value={type}
          onChange={(value) => {
            if (value === 'shared') {
              // The shared composer reuses this amount and stays a familiar flow.
              const prefill = amountText.trim() ? `?amount=${encodeURIComponent(amountText.trim())}` : '';
              router.push(`/shared/expense/new${prefill}` as never);
              return;
            }
            setType(value);
          }}
        />

        {/* Fields */}
        <View
          style={{
            marginTop: theme.spacing.lg,
            borderRadius: theme.radius.lg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            overflow: 'hidden',
          }}>
          {type !== 'transfer' ? (
            <FieldRow
              icon={(selectedCategory?.icon as IconName) ?? 'pricetag-outline'}
              iconColor={selectedCategory?.color}
              label="Category"
              value={selectedCategory?.name ?? 'Uncategorised'}
              onPress={() => setSheet('category')}
            />
          ) : null}
          <FieldRow
            icon="wallet-outline"
            iconColor={selectedAccount?.color ?? undefined}
            label={type === 'transfer' ? 'From' : 'Account'}
            value={selectedAccount?.name ?? 'Choose account'}
            onPress={() => setSheet('account')}
          />
          {type === 'transfer' ? (
            <FieldRow
              icon="arrow-forward-circle-outline"
              label="To"
              value={transferAccount?.name ?? 'Choose destination'}
              onPress={() => setSheet('to')}
            />
          ) : null}
          <FieldRow
            icon="storefront-outline"
            label="Merchant"
            value={merchant || 'Add merchant'}
            muted={!merchant}
            onPress={() => setSheet('merchant')}
          />
          <FieldRow
            icon="calendar-outline"
            label="Date"
            value={formatDateLabel(date)}
            onPress={() => setSheet('date')}
            last
          />
        </View>

        {/* AI category suggestion — optional, nothing is applied without a tap */}
        {settings.ai.enabled &&
        settings.ai.categorization &&
        settings.ai.apiKey.trim().length > 0 &&
        settings.ai.privacy !== 'none' &&
        type !== 'transfer' &&
        !categoryId &&
        merchant.trim().length >= 2 ? (
          aiSuggestion ? (
            <View
              style={{
                marginTop: theme.spacing.md,
                padding: theme.spacing.lg,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.accent.soft,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                gap: theme.spacing.sm,
              }}>
              <Row gap="sm">
                <Ionicons name="sparkles-outline" size={15} color={theme.colors.accent.base} />
                <AppText variant="captionMedium" tone="accent">
                  AI SUGGESTION
                </AppText>
                <AppText variant="caption" tone="muted">
                  {Math.round(aiSuggestion.confidence * 100)}% confident
                </AppText>
              </Row>
              <AppText variant="bodyMedium">
                {aiSuggestion.path ? `${aiSuggestion.path} › ` : ''}
                {aiSuggestion.categoryName}
              </AppText>
              <Row gap="sm">
                <Button
                  label="Accept"
                  size="sm"
                  onPress={() => {
                    setCategoryId(aiSuggestion.categoryId);
                    setAiSuggestion(null);
                    toast.success(`Category set to ${aiSuggestion.categoryName}`);
                  }}
                />
                <Button label="Dismiss" size="sm" variant="secondary" onPress={() => setAiSuggestion(null)} />
              </Row>
            </View>
          ) : (
            <Pressable
              onPress={() => void suggestCategoryWithAi()}
              disabled={aiSuggesting}
              style={({ pressed }) => ({
                marginTop: theme.spacing.md,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                alignSelf: 'flex-start',
                opacity: pressed || aiSuggesting ? 0.65 : 1,
              })}>
              <Ionicons name={aiSuggesting ? 'hourglass-outline' : 'sparkles-outline'} size={15} color={theme.colors.accent.base} />
              <AppText variant="captionMedium" tone="accent">
                {aiSuggesting ? 'Asking DeepSeek…' : 'Suggest category with AI'}
              </AppText>
            </Pressable>
          )
        ) : null}

        {/* Quick actions */}
        <Row gap="sm" style={{ marginTop: theme.spacing.lg }} wrap>
          <Chip label="Notes" icon="document-text-outline" selected={Boolean(notes)} onPress={() => setSheet('advanced')} />
          <Chip label="Tags" icon="pricetags-outline" selected={tagIds.length > 0} onPress={() => setSheet('tags')} />
          {type !== 'transfer' ? (
            <Chip label="Split" icon="git-branch-outline" selected={splits.length > 0} onPress={() => setSheet('split')} />
          ) : null}
          <Chip label="Receipt" icon="attach-outline" selected={pendingFiles.length > 0} onPress={pickReceipt} />
          <Chip
            label={isReviewed ? 'Reviewed' : 'Needs review'}
            icon={isReviewed ? 'checkmark-circle-outline' : 'alert-circle-outline'}
            selected={!isReviewed}
            onPress={() => setIsReviewed((value) => !value)}
          />
        </Row>

        {/* Tag chips should show the current selection right where tags are chosen. */}
        {tagIds.length > 0 && type !== 'transfer' ? (
          <Row gap="sm" wrap style={{ marginTop: theme.spacing.md }}>
            {tagIds.map((tagId) => {
              const tag = tagsQuery.data?.find((entry) => entry.id === tagId);
              if (!tag) return null;
              return (
                <Chip
                  key={tagId}
                  label={tag.name}
                  size="sm"
                  selected
                  color={tag.color}
                  onPress={() => setTagIds((current) => current.filter((id) => id !== tagId))}
                />
              );
            })}
          </Row>
        ) : null}

        {splits.length > 0 ? (
          <View style={{ marginTop: theme.spacing.lg, padding: theme.spacing.lg, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border }}>
            <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.sm }}>
              SPLITS
            </AppText>
            {splits.map((split, index) => {
              const category = categoriesQuery.data?.find((entry) => entry.id === split.categoryId);
              return (
                <Row key={index} justify="space-between" style={{ paddingVertical: 6 }}>
                  <Row gap="sm">
                    <Ionicons name={(category?.icon as IconName) ?? 'pricetag-outline'} size={15} color={category?.color ?? theme.colors.muted} />
                    <AppText variant="bodySmall">{category?.name ?? 'Category'}</AppText>
                  </Row>
                  <MoneyText amount={split.amount} variant="numericCaption" tone="neutral" showSign={false} />
                </Row>
              );
            })}
            <Row justify="space-between" style={{ marginTop: theme.spacing.sm, paddingTop: theme.spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
              <AppText variant="caption" tone={splitRemaining === 0 ? 'positive' : 'negative'}>
                {splitRemaining === 0 ? 'Splits balance' : `Unallocated ${money.format(splitRemaining, { absolute: true })}`}
              </AppText>
              <AppText variant="captionMedium" tone="accent" onPress={() => setSheet('split')}>
                Edit splits
              </AppText>
            </Row>
          </View>
        ) : null}

        {pendingFiles.length > 0 ? (
          <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
            {pendingFiles.map((file, index) => (
              <Row key={`${file.uri}-${index}`} gap="sm">
                <Ionicons name="attach-outline" size={15} color={theme.colors.muted} />
                <AppText variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
                  {file.name}
                </AppText>
                <Pressable onPress={() => setPendingFiles((current) => current.filter((_, i) => i !== index))} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={theme.colors.muted} />
                </Pressable>
              </Row>
            ))}
          </View>
        ) : null}

        {notes || reference ? (
          <View style={{ marginTop: theme.spacing.md, gap: 4 }}>
            {notes ? (
              <AppText variant="caption" tone="secondary" numberOfLines={2}>
                Note: {notes}
              </AppText>
            ) : null}
            {reference ? (
              <AppText variant="caption" tone="muted">
                Ref: {reference}
              </AppText>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {/* Keypad + save */}
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: Math.max(insets.bottom, theme.spacing.md), gap: theme.spacing.md }}>
        <AmountKeypad value={amountText} onChange={setAmountText} onSubmit={save} />
        <Button
          label={editingId ? 'Save changes' : `Add ${type === 'transfer' ? 'transfer' : type}`}
          size="lg"
          fullWidth
          loading={saving}
          disabled={!loaded || amountMinor === 0}
          onPress={save}
        />
      </View>

      {/* Sheets */}
      <PickerSheet
        visible={sheet === 'category'}
        onClose={() => setSheet('none')}
        title="Category"
        items={categoryItems}
        selectedId={categoryId}
        onSelect={(item) => {
          setCategoryId(item.id);
          setSheet('none');
        }}
        createLabel="New category"
        onCreate={() => {
          setSheet('none');
          router.push('/categories');
        }}
      />
      <PickerSheet
        visible={sheet === 'account'}
        onClose={() => setSheet('none')}
        title={type === 'transfer' ? 'From account' : 'Account'}
        items={(accountsQuery.data ?? []).map((account) => ({
          id: account.id,
          label: account.name,
          subtitle: `${ACCOUNT_TYPE_LABELS[account.type]} · ${money.format(account.currentBalance)}`,
          icon: 'wallet-outline' as IconName,
          color: account.color ?? undefined,
        }))}
        selectedId={accountId}
        onSelect={(item) => {
          setAccountId(item.id);
          setSheet('none');
        }}
        createLabel="Manage accounts"
        onCreate={() => {
          setSheet('none');
          router.push('/accounts');
        }}
      />
      <PickerSheet
        visible={sheet === 'to'}
        onClose={() => setSheet('none')}
        title="Destination account"
        items={(accountsQuery.data ?? [])
          .filter((account) => account.id !== accountId)
          .map((account) => ({
            id: account.id,
            label: account.name,
            subtitle: `${ACCOUNT_TYPE_LABELS[account.type]} · ${money.format(account.currentBalance)}`,
            icon: 'wallet-outline' as IconName,
            color: account.color ?? undefined,
          }))}
        selectedId={transferAccountId}
        onSelect={(item) => {
          setTransferAccountId(item.id);
          setSheet('none');
        }}
      />
      <MerchantSheet
        visible={sheet === 'merchant'}
        onClose={() => setSheet('none')}
        value={merchant}
        recent={(recentMerchants.data ?? []).map((entry) => entry.merchant)}
        onSave={(value) => {
          setMerchant(value);
          setSheet('none');
        }}
      />
      <DatePickerSheet
        visible={sheet === 'date'}
        onClose={() => setSheet('none')}
        value={date}
        onSelect={setDate}
      />
      <PickerSheet
        visible={sheet === 'tags'}
        onClose={() => setSheet('none')}
        title="Tags"
        items={(tagsQuery.data ?? []).map((tag) => ({
          id: tag.id,
          label: tag.name,
          icon: 'pricetag-outline' as IconName,
          color: tag.color,
        }))}
        selectedIds={tagIds}
        emptyTitle="No tags yet"
        emptyMessage="Create tags like Trip, Work or Tax to group transactions across categories."
        createLabel="New tag"
        onCreate={() => {
          setNewTagName('');
          setSheet('none');
          setNewTagOpen(true);
        }}
        onSelect={(item) => {
          setTagIds((current) =>
            current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id],
          );
        }}
      />

      <FormSheet
        visible={newTagOpen}
        onClose={() => setNewTagOpen(false)}
        title="New tag"
        submitLabel="Create tag"
        submitDisabled={!newTagName.trim()}
        onSubmit={async () => {
          try {
            const { createTag } = await import('@/services/tags.service');
            const tag = await createTag(newTagName.trim());
            setTagIds((current) => (current.includes(tag.id) ? current : [...current, tag.id]));
            setNewTagOpen(false);
            toast.success(`Tag "${tag.name}" created`);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not create the tag');
          }
        }}>
        <Field
          label="Tag name"
          value={newTagName}
          onChangeText={setNewTagName}
          placeholder="e.g. Goa trip, Work, Tax"
          autoFocus
        />
        <AppText variant="caption" tone="muted">
          Tags sit beside categories: one category per transaction, as many tags as you like.
        </AppText>
      </FormSheet>
      <AdvancedSheet
        visible={sheet === 'advanced'}
        onClose={() => setSheet('none')}
        notes={notes}
        reference={reference}
        description={description}
        onNotes={setNotes}
        onReference={setReference}
        onDescription={setDescription}
      />
      <SplitSheet
        visible={sheet === 'split'}
        onClose={() => setSheet('none')}
        total={amountMinor}
        splits={splits}
        onSplits={setSplits}
        categories={categoryItems}
      />
    </View>
  );
}

/* --------------------------------- Pieces ---------------------------------- */

function FieldRow({
  icon,
  iconColor,
  label,
  value,
  onPress,
  muted,
  last,
}: {
  icon: IconName;
  iconColor?: string;
  label: string;
  value: string;
  onPress: () => void;
  muted?: boolean;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        minHeight: 52,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.pressed : 'transparent',
      })}>
      <Ionicons name={icon} size={17} color={iconColor ?? theme.colors.textSecondary} />
      <AppText variant="caption" tone="muted" style={{ width: 76 }}>
        {label}
      </AppText>
      <AppText variant="bodyMedium" tone={muted ? 'muted' : 'primary'} numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>
        {value}
      </AppText>
      <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} />
    </Pressable>
  );
}

function formatDateLabel(date: Date): string {
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (isToday) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function MerchantSheet({
  visible,
  onClose,
  value,
  recent,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  value: string;
  recent: string[];
  onSave: (value: string) => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState(value);
  useEffect(() => {
    if (visible) setText(value);
  }, [visible, value]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Merchant"
      footer={<Button label="Use merchant" fullWidth onPress={() => onSave(text.trim())} />}>
      <View style={{ gap: theme.spacing.lg }}>
        <Field value={text} onChangeText={setText} placeholder="e.g. Amazon, Swiggy, Landlord" autoFocus />
        {recent.length > 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="captionMedium" tone="secondary">
              Recent
            </AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {recent.map((entry) => (
                <Chip key={entry} label={entry} onPress={() => onSave(entry)} />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
}

function AdvancedSheet({
  visible,
  onClose,
  notes,
  reference,
  description,
  onNotes,
  onReference,
  onDescription,
}: {
  visible: boolean;
  onClose: () => void;
  notes: string;
  reference: string;
  description: string;
  onNotes: (value: string) => void;
  onReference: (value: string) => void;
  onDescription: (value: string) => void;
}) {
  const theme = useTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Details" footer={<Button label="Done" fullWidth onPress={onClose} />}>
      <View style={{ gap: theme.spacing.lg }}>
        <Field label="Short description" value={description} onChangeText={onDescription} placeholder="What was this for?" />
        <Field label="Notes" value={notes} onChangeText={onNotes} placeholder="Anything you'll want to remember" multiline />
        <Field label="Reference" value={reference} onChangeText={onReference} placeholder="UPI / cheque / invoice number" />
      </View>
    </BottomSheet>
  );
}

function SplitSheet({
  visible,
  onClose,
  total,
  splits,
  onSplits,
  categories,
}: {
  visible: boolean;
  onClose: () => void;
  total: number;
  splits: TransactionSplitInput[];
  onSplits: (splits: TransactionSplitInput[]) => void;
  categories: { id: string; label: string; icon: IconName; color: string; section?: string }[];
}) {
  const theme = useTheme();
  const money = useMoney();
  const [picking, setPicking] = useState(false);
  const [draftAmount, setDraftAmount] = useState('');
  const [draftCategory, setDraftCategory] = useState<string | null>(null);
  const remaining = total - splits.reduce((sum, split) => sum + Math.round(split.amount), 0);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Split transaction"
      footer={
        <Button
          label={remaining === 0 ? 'Done' : `Unallocated ${money.format(Math.abs(remaining))}`}
          variant={remaining === 0 ? 'primary' : 'secondary'}
          fullWidth
          disabled={remaining !== 0}
          onPress={onClose}
        />
      }>
      <View style={{ gap: theme.spacing.lg }}>
        <AppText variant="caption" tone="muted">
          Split {money.format(total)} across categories. Analytics use the split amounts.
        </AppText>

        {splits.map((split, index) => {
          const category = categories.find((entry) => entry.id === split.categoryId);
          return (
            <Row key={index} justify="space-between" gap="sm">
              <Row gap="sm" style={{ flex: 1 }}>
                <Ionicons name={(category?.icon as IconName) ?? 'pricetag-outline'} size={15} color={category?.color} />
                <AppText variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>
                  {category?.label ?? 'Category'}
                </AppText>
              </Row>
              <MoneyText amount={split.amount} variant="numericCaption" tone="neutral" showSign={false} />
              <Pressable onPress={() => onSplits(splits.filter((_, i) => i !== index))} hitSlop={8}>
                <Ionicons name="close-circle" size={17} color={theme.colors.muted} />
              </Pressable>
            </Row>
          );
        })}

        <View style={{ gap: theme.spacing.sm, paddingTop: theme.spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
          <AppText variant="captionMedium" tone="secondary">
            Add a split
          </AppText>
          <Row gap="sm">
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.sm,
                backgroundColor: theme.colors.inputBackground,
                borderRadius: theme.radius.md,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                paddingHorizontal: theme.spacing.md,
                height: 42,
              }}>
              <Ionicons name="pricetag-outline" size={15} color={theme.colors.muted} />
              <Pressable style={{ flex: 1 }} onPress={() => setPicking(true)}>
                <AppText variant="bodySmall" tone={draftCategory ? 'primary' : 'muted'}>
                  {categories.find((entry) => entry.id === draftCategory)?.label ?? 'Choose category'}
                </AppText>
              </Pressable>
            </View>
            <View
              style={{
                width: 130,
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.colors.inputBackground,
                borderRadius: theme.radius.md,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                paddingHorizontal: theme.spacing.md,
                height: 42,
              }}>
              <AppText variant="caption" tone="muted">
                {money.currency === 'INR' ? '₹' : money.currency}
              </AppText>
              <Field value={draftAmount} onChangeText={setDraftAmount} keyboardType="decimal-pad" placeholder="0" money />
            </View>
          </Row>
          <Button
            label="Add split"
            variant="secondary"
            disabled={!draftCategory || !draftAmount}
            onPress={() => {
              if (!draftCategory) return;
              const minor = Math.round(Number(draftAmount.replace(/[^0-9.]/g, '') || '0') * 100);
              if (minor <= 0) return;
              onSplits([...splits, { categoryId: draftCategory, amount: minor }]);
              setDraftCategory(null);
              setDraftAmount('');
            }}
          />
          <AppText variant="caption" tone={remaining === 0 ? 'positive' : remaining < 0 ? 'negative' : 'muted'}>
            {remaining === 0
              ? 'Splits balance the total.'
              : remaining > 0
                ? `${money.format(remaining)} left to allocate.`
                : `${money.format(Math.abs(remaining))} over the total.`}
          </AppText>
        </View>
      </View>

      <PickerSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="Split category"
        items={categories}
        selectedId={draftCategory}
        onSelect={(item) => {
          setDraftCategory(item.id);
          setPicking(false);
        }}
      />
    </BottomSheet>
  );
}
