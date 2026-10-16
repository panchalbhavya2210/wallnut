import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/theme';
import { IconName, KeyValueRow, Row } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, Chip, IconButton } from '@/components/ui/controls';
import { ErrorBlock, LoadingBlock } from '@/components/ui/feedback';
import { PickerSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import { addAttachment, deleteAttachment, listAttachments } from '@/services/attachments.service';
import { ACCOUNT_TYPE_LABELS, getAccount } from '@/services/accounts.service';
import { getCategory } from '@/services/categories.service';
import { listTags, setTransactionTags } from '@/services/tags.service';
import {
  deleteTransaction,
  getTransactionDetail,
  markReviewed,
  updateTransaction,
} from '@/services/transactions.service';
import { formatDayLabel, fromISODate } from '@/utils/date';

/**
 * Transaction detail — everything about one ledger entry: splits, tags,
 * receipts, review state, and one-tap edit / duplicate / delete.
 */
export default function TransactionDetailScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const money = useMoney();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tagPickerOpen, setTagPickerOpen] = useState(false);

  const query = useQuery(async () => {
    if (!id) return null;
    const detail = await getTransactionDetail(id);
    if (!detail) return null;
    const [account, category, tags, attachments] = await Promise.all([
      getAccount(detail.accountId),
      detail.categoryId ? getCategory(detail.categoryId) : Promise.resolve(null),
      listTags(),
      listAttachments(id),
    ]);
    return { detail, account, category, tags, attachments };
  }, [id]);

  if (query.loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top + 12 }}>
        <LoadingBlock label="Loading transaction…" />
      </View>
    );
  }

  if (query.error || !query.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top + 12 }}>
        <ErrorBlock message={query.error?.message ?? 'This transaction no longer exists.'} onRetry={query.refresh} />
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  const { detail, account, category, tags, attachments } = query.data;
  const isTransfer = detail.isTransfer;
  const sign = detail.type === 'income' || detail.type === 'refund' ? 1 : -1;

  const attachReceipt = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true, multiple: true });
      if (result.canceled) return;
      for (const asset of result.assets) {
        await addAttachment(detail.id, {
          uri: asset.uri,
          name: asset.name ?? 'receipt',
          mimeType: asset.mimeType,
          size: asset.size,
        });
      }
      toast.success('Receipt attached');
    } catch {
      toast.error('Could not attach that file');
    }
  };

  const removeTransaction = async () => {
    const ok = await confirm({
      title: 'Delete this transaction?',
      message: attachments.length > 0 ? 'Its receipts will be removed too.' : undefined,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    const { deleteAttachmentsForTransaction } = await import('@/services/attachments.service');
    await deleteAttachmentsForTransaction(detail.id);
    await deleteTransaction(detail.id);
    toast.show('Transaction deleted');
    router.back();
  };

  const duplicate = async () => {
    const ok = await confirm({ title: 'Duplicate this transaction?', confirmLabel: 'Duplicate' });
    if (!ok) return;
    const { createTransaction } = await import('@/services/transactions.service');
    await createTransaction({
      accountId: detail.accountId,
      categoryId: detail.categoryId,
      amount: detail.amount,
      type: detail.type,
      merchant: detail.merchant,
      description: detail.description,
      date: detail.date,
      notes: detail.notes,
      reference: detail.reference,
      transferAccountId: detail.transferAccountId,
      isReviewed: detail.isReviewed,
      splits: detail.splits.map((split) => ({ categoryId: split.categoryId, amount: split.amount, note: split.note })),
      tagIds: detail.tagIds,
      applyRules: false,
    });
    toast.success('Duplicated');
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm }}>
        <IconButton icon="chevron-back" onPress={() => router.back()} accessibilityLabel="Back" />
        <Row gap="xs">
          <IconButton
            icon={detail.isReviewed ? 'checkmark-done-outline' : 'alert-circle-outline'}
            color={detail.isReviewed ? undefined : theme.colors.warning}
            onPress={async () => {
              await markReviewed([detail.id], !detail.isReviewed);
              toast.show(detail.isReviewed ? 'Marked as needing review' : 'Marked reviewed');
            }}
            accessibilityLabel="Toggle reviewed"
          />
          <IconButton icon="copy-outline" onPress={duplicate} accessibilityLabel="Duplicate" />
          <IconButton icon="create-outline" onPress={() => router.push(`/transaction/new?id=${detail.id}` as never)} accessibilityLabel="Edit" />
          <IconButton icon="trash-outline" color={theme.colors.negative} onPress={removeTransaction} accessibilityLabel="Delete" />
        </Row>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.colossal }} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={{ alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.xl }}>
          <View
            style={{
              width: 54,
              height: 54,
              borderRadius: theme.radius.lg,
              backgroundColor: `${category?.color ?? theme.colors.accent.base}22`,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Ionicons
              name={((isTransfer ? 'swap-horizontal-outline' : category?.icon) as IconName) ?? 'pricetag-outline'}
              size={24}
              color={isTransfer ? theme.colors.accent.base : (category?.color ?? theme.colors.accent.base)}
            />
          </View>
          <AppText variant="numericLarge">
            {money.format(sign * Math.abs(detail.amount), { sign: detail.type === 'income' || detail.type === 'refund' ? 'always' : 'auto' })}
          </AppText>
          <AppText variant="titleSmall" style={{ textAlign: 'center' }}>
            {detail.merchant || detail.description || category?.name || 'Transaction'}
          </AppText>
          <Row gap="sm" wrap style={{ justifyContent: 'center' }}>
            <Chip label={fromISODate(detail.date) ? formatDayLabel(fromISODate(detail.date)!) : detail.date} size="sm" />
            <Chip label={detail.type.charAt(0).toUpperCase() + detail.type.slice(1)} size="sm" />
            {detail.isRecurring ? <Chip label="Recurring" size="sm" icon="repeat-outline" /> : null}
            {detail.installmentId ? <Chip label="Installment" size="sm" icon="layers-outline" /> : null}
            {!detail.isReviewed ? <Chip label="Needs review" size="sm" selected color={theme.colors.warning} onPress={async () => {
              await markReviewed([detail.id], true);
              toast.show('Marked reviewed');
            }} /> : null}
          </Row>
        </View>

        {/* Details */}
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, padding: theme.spacing.lg, gap: 2 }}>
          {isTransfer ? (
            <KeyValueRow
              label="Transfer"
              value={`${account?.name ?? '—'} → ${detail.transferAccountName ?? '—'}`}
            />
          ) : (
            <>
              <KeyValueRow label="Category" value={category?.name ?? 'Uncategorised'} />
              <KeyValueRow label="Account" value={account ? `${account.name} · ${ACCOUNT_TYPE_LABELS[account.type]}` : '—'} />
            </>
          )}
          {detail.merchant ? <KeyValueRow label="Merchant" value={detail.merchant} /> : null}
          {detail.description ? <KeyValueRow label="Description" value={detail.description} /> : null}
          {detail.reference ? <KeyValueRow label="Reference" value={detail.reference} /> : null}
          {detail.notes ? <KeyValueRow label="Notes" value={detail.notes} /> : null}
          <KeyValueRow label="Recorded" value={new Date(detail.createdAt).toLocaleString()} />
        </View>

        {/* Splits */}
        {detail.splits.length > 0 ? (
          <View style={{ marginTop: theme.spacing.lg, backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, padding: theme.spacing.lg }}>
            <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.sm }}>
              SPLIT ACROSS {detail.splits.length} CATEGORIES
            </AppText>
            {detail.splits.map((split) => (
              <Row key={split.id} justify="space-between" style={{ paddingVertical: 6 }}>
                <AppText variant="bodySmall">{split.categoryName}</AppText>
                <MoneyText amount={split.amount} variant="numericCaption" tone="neutral" showSign={false} />
              </Row>
            ))}
            <Row justify="space-between" style={{ marginTop: theme.spacing.sm, paddingTop: theme.spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
              <AppText variant="bodySmall" tone="secondary">
                Total
              </AppText>
              <MoneyText amount={detail.splits.reduce((sum, split) => sum + split.amount, 0)} variant="numericBody" tone="neutral" showSign={false} />
            </Row>
          </View>
        ) : null}

        {/* Tags */}
        <View style={{ marginTop: theme.spacing.lg, backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, padding: theme.spacing.lg }}>
          <Row justify="space-between">
            <AppText variant="label" tone="muted">
              TAGS
            </AppText>
            <Pressable onPress={() => setTagPickerOpen(true)} hitSlop={8}>
              <AppText variant="captionMedium" tone="accent">
                {detail.tagIds.length > 0 ? 'Edit' : 'Add'}
              </AppText>
            </Pressable>
          </Row>
          <Row gap="sm" wrap style={{ marginTop: theme.spacing.md }}>
            {detail.tagIds.length === 0 ? (
              <AppText variant="caption" tone="muted">
                No tags yet — useful for trips, work or tax.
              </AppText>
            ) : (
              detail.tagIds.map((tagId) => {
                const tag = tags.find((entry) => entry.id === tagId);
                if (!tag) return null;
                return <Chip key={tagId} label={tag.name} size="sm" selected color={tag.color} onPress={() => setTagPickerOpen(true)} />;
              })
            )}
          </Row>
        </View>

        {/* Receipts */}
        <View style={{ marginTop: theme.spacing.lg, backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, padding: theme.spacing.lg }}>
          <Row justify="space-between">
            <AppText variant="label" tone="muted">
              RECEIPTS
            </AppText>
            <Pressable onPress={attachReceipt} hitSlop={8}>
              <AppText variant="captionMedium" tone="accent">
                Attach
              </AppText>
            </Pressable>
          </Row>
          {attachments.length === 0 ? (
            <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.md }}>
              No receipts attached. Stored locally on this device only.
            </AppText>
          ) : (
            <Row gap="sm" wrap style={{ marginTop: theme.spacing.md }}>
              {attachments.map((attachment) => (
                <Pressable
                  key={attachment.id}
                  onLongPress={async () => {
                    const ok = await confirm({ title: 'Remove this attachment?', tone: 'danger', confirmLabel: 'Remove' });
                    if (ok) {
                      await deleteAttachment(attachment.id);
                      toast.show('Attachment removed');
                    }
                  }}
                  style={{
                    width: 84,
                    height: 84,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.inputBackground,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.colors.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}>
                  {attachment.kind === 'image' ? (
                    <Image source={{ uri: attachment.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  ) : (
                    <Ionicons name={attachment.kind === 'pdf' ? 'document-text-outline' : 'attach-outline'} size={22} color={theme.colors.textSecondary} />
                  )}
                </Pressable>
              ))}
            </Row>
          )}
          <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
            Long-press a receipt to remove it.
          </AppText>
        </View>

        <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.sm }}>
          <Button
            label="Edit transaction"
            variant="secondary"
            fullWidth
            onPress={() => router.push(`/transaction/new?id=${detail.id}` as never)}
          />
          <Button label="Delete" variant="danger" fullWidth onPress={removeTransaction} />
        </View>
      </ScrollView>

      <PickerSheet
        visible={tagPickerOpen}
        onClose={() => setTagPickerOpen(false)}
        title="Tags"
        items={tags.map((tag) => ({ id: tag.id, label: tag.name, icon: 'pricetag-outline' as IconName, color: tag.color }))}
        createLabel="New tag"
        onCreate={async () => {
          const { createTag } = await import('@/services/tags.service');
          await createTag(`Tag ${tags.length + 1}`);
        }}
        onSelect={async (item) => {
          const next = detail.tagIds.includes(item.id)
            ? detail.tagIds.filter((tagId) => tagId !== item.id)
            : [...detail.tagIds, item.id];
          await setTransactionTags(detail.id, next);
          await query.refresh();
        }}
      />
    </View>
  );
}
