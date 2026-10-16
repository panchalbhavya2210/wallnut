import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, Chip } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { PickerSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { toast } from '@/stores/ui.store';
import { approveMany, approveReviewItem, REVIEW_REASON_LABELS, getReviewQueue, findDuplicateGroups, reviewItemSubtitle } from '@/services/review.service';
import { bulkUpdateCategory, deleteTransaction } from '@/services/transactions.service';
import { buildCategoryTree, listCategories } from '@/services/categories.service';
import { formatDayMonth } from '@/utils/date';

/**
 * Review queue — the fast lane for messy data: approve, categorise, delete
 * duplicates, or mark unreviewed imports as checked.
 */
export default function ReviewScreen() {
  const theme = useTheme();
  const [filter, setFilter] = useState<'all' | 'uncategorised' | 'duplicate' | 'large'>('all');
  const [categoryPickerFor, setCategoryPickerFor] = useState<string | null>(null);

  const query = useQuery(async () => {
    const [items, duplicates, categories] = await Promise.all([
      getReviewQueue(120),
      findDuplicateGroups(),
      listCategories(),
    ]);
    return { items, duplicates, categories };
  }, []);

  const items = query.data?.items ?? [];
  const filtered = items.filter((item) => (filter === 'all' ? true : item.reasons.includes(filter)));

  const counts = {
    all: items.length,
    uncategorised: items.filter((item) => item.reasons.includes('uncategorised')).length,
    duplicate: items.filter((item) => item.reasons.includes('duplicate')).length,
    large: items.filter((item) => item.reasons.includes('large')).length,
  };

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Review"
        subtitle={items.length === 0 ? 'Everything is reviewed' : `${items.length} need attention`}
        hint={{ id: 'review', message: 'Transactions Wallnut thinks need a look: duplicates, missing categories, unusual amounts. Approve, fix or ignore each one.' }}
        right={
          items.length > 0 ? (
            <Button
              label="Approve all"
              size="sm"
              variant="secondary"
              onPress={async () => {
                const ok = await confirm({
                  title: `Mark all ${items.length} as reviewed?`,
                  message: 'They stay in your ledger — this only clears the review flag.',
                  confirmLabel: 'Mark reviewed',
                });
                if (!ok) return;
                await approveMany(items.map((item) => item.id));
                toast.success('All reviewed');
              }}
            />
          ) : undefined
        }
      />

      {query.loading && !query.data ? (
        <LoadingBlock label="Checking your ledger…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon="checkmark-done-outline"
          title="Nothing to review"
          message="Wallnut flags uncategorised rows, unreviewed imports, likely duplicates and unusually large expenses. You're all clear."
        />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Row gap="sm" wrap>
            <Chip label={`All ${counts.all}`} selected={filter === 'all'} onPress={() => setFilter('all')} />
            <Chip label={`Needs category ${counts.uncategorised}`} selected={filter === 'uncategorised'} onPress={() => setFilter('uncategorised')} />
            <Chip label={`Duplicates ${counts.duplicate}`} selected={filter === 'duplicate'} onPress={() => setFilter('duplicate')} />
            <Chip label={`Unusual ${counts.large}`} selected={filter === 'large'} onPress={() => setFilter('large')} />
          </Row>

          {filtered.map((item) => (
            <Card key={item.id}>
              <Row justify="space-between" style={{ marginBottom: theme.spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyMedium" numberOfLines={1}>
                    {item.merchant || item.description || 'Transaction'}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {formatDayMonth(new Date(item.date))} · {item.accountName ?? 'account'} · {reviewItemSubtitle(item)}
                  </AppText>
                </View>
                <MoneyText amount={item.amount} variant="numericBody" tone="auto" />
              </Row>

              <Row gap="sm" wrap style={{ marginBottom: theme.spacing.md }}>
                {item.reasons.map((reason) => (
                  <Chip
                    key={reason}
                    size="sm"
                    label={REVIEW_REASON_LABELS[reason]}
                    color={reason === 'duplicate' ? theme.colors.warning : reason === 'large' ? theme.colors.warning : theme.colors.accent.base}
                    selected
                  />
                ))}
              </Row>

              <Row gap="sm" wrap>
                <Button label="Open" size="sm" variant="ghost" onPress={() => router.push(`/transaction/${item.id}` as never)} />
                {item.reasons.includes('uncategorised') ? (
                  <Button label="Set category" size="sm" variant="secondary" onPress={() => setCategoryPickerFor(item.id)} />
                ) : null}
                <Button
                  label="Approve"
                  size="sm"
                  onPress={async () => {
                    await approveReviewItem(item.id);
                    toast.show('Reviewed');
                  }}
                />
                {item.reasons.includes('duplicate') ? (
                  <Button
                    label="Delete this one"
                    size="sm"
                    variant="danger"
                    onPress={async () => {
                      const ok = await confirm({
                        title: 'Delete this duplicate?',
                        message: 'Keep the other copy — only this row is removed.',
                        confirmLabel: 'Delete',
                        tone: 'danger',
                      });
                      if (!ok) return;
                      await deleteTransaction(item.id);
                      toast.show('Duplicate removed');
                    }}
                  />
                ) : null}
              </Row>
            </Card>
          ))}

          {(query.data?.duplicates.length ?? 0) > 0 ? (
            <InfoBanner
              tone="warning"
              message={`${query.data?.duplicates.length} fingerprint${query.data?.duplicates.length === 1 ? '' : 's'} matched more than once. Wallnut never auto-deletes: duplicates are always yours to confirm.`}
            />
          ) : null}
        </View>
      )}

      <PickerSheet
        visible={Boolean(categoryPickerFor)}
        onClose={() => setCategoryPickerFor(null)}
        title="Choose category"
        items={buildCategoryTree(query.data?.categories ?? []).flatMap((parent) => [
          { id: parent.id, label: parent.name, icon: parent.icon as IconName, color: parent.color },
          ...parent.children.map((child) => ({ id: child.id, label: child.name, icon: child.icon as IconName, color: child.color, section: parent.name })),
        ])}
        onSelect={async (item) => {
          if (!categoryPickerFor) return;
          await bulkUpdateCategory([categoryPickerFor], item.id);
          await approveReviewItem(categoryPickerFor);
          setCategoryPickerFor(null);
          toast.success(`Categorised as ${item.label}`);
        }}
      />
    </ScrollScreen>
  );
}
