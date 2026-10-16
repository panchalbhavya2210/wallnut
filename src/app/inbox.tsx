import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button } from '@/components/ui/controls';
import { EmptyState, ErrorBlock, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { PickerSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { toast } from '@/stores/ui.store';
import { buildCategoryTree, listCategories } from '@/services/categories.service';
import { approveReviewItem } from '@/services/review.service';
import { bulkUpdateCategory, deleteTransaction } from '@/services/transactions.service';
import { addRecurringFromInbox, getInbox } from '@/services/inbox.service';
import {
  countInboxDismissals,
  dismissInboxItem,
  restoreInboxDismissals,
  snoozeInboxItem,
} from '@/services/dismissals.service';
import { countInboxItems, inboxSubtitle, INBOX_PRIORITY_LABELS, INBOX_PRIORITY_ORDER, type InboxActionKind, type InboxItem } from '@/utils/inbox';

/**
 * Financial Inbox — one place for everything that needs a decision, grouped by
 * how much it matters (Urgent → Action → Suggestion → Information). Clearing
 * an item always means fixing the underlying fact; ignoring is stored and can
 * be restored.
 */

const PRIORITY_TONES: Record<string, { color: (theme: ReturnType<typeof useTheme>) => string; icon: string }> = {
  urgent: { color: (theme) => theme.colors.negative, icon: 'alert-circle-outline' },
  action: { color: (theme) => theme.colors.warning, icon: 'alert-outline' },
  suggestion: { color: (theme) => theme.colors.accent.base, icon: 'bulb-outline' },
  info: { color: (theme) => theme.colors.muted, icon: 'information-circle-outline' },
};

export default function FinancialInboxScreen() {
  const theme = useTheme();
  const [categoryPickerFor, setCategoryPickerFor] = useState<InboxItem | null>(null);

  const query = useQuery(async () => {
    const [items, categories] = await Promise.all([getInbox(), listCategories()]);
    return { items, categories };
  }, []);
  const dismissedQuery = useQuery(() => countInboxDismissals(), []);

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const counts = useMemo(() => countInboxItems(items), [items]);
  const groups = useMemo(
    () =>
      INBOX_PRIORITY_ORDER.map((priority) => ({
        priority,
        items: items.filter((item) => item.priority === priority),
      })).filter((group) => group.items.length > 0),
    [items],
  );

  const refresh = () => {
    query.refresh();
    dismissedQuery.refresh();
  };

  const run = async (item: InboxItem, action: InboxActionKind) => {
    switch (action) {
      case 'set_category':
        setCategoryPickerFor(item);
        return;
      case 'approve':
        if (!item.transactionId) return;
        await approveReviewItem(item.transactionId);
        toast.show('Reviewed');
        return;
      case 'open_transaction':
      case 'open':
        if (item.href) router.push(item.href as never);
        return;
      case 'delete_transaction':
        if (!item.transactionId) return;
        {
          const ok = await confirm({
            title: 'Delete this duplicate?',
            message: 'Keep the other copy — only this row is removed.',
            confirmLabel: 'Delete',
            tone: 'danger',
          });
          if (!ok) return;
          await deleteTransaction(item.transactionId);
          toast.show('Duplicate removed');
        }
        return;
      case 'create_recurring':
        if (!item.candidate) return;
        await addRecurringFromInbox(item.candidate);
        toast.success(`${item.candidate.merchant} added as a monthly schedule`);
        return;
      case 'dismiss':
        await dismissInboxItem(item.kind, item.refKey);
        toast.show('Ignored — restore it any time');
        return;
      case 'snooze':
        await snoozeInboxItem(item.kind, item.refKey, 7);
        toast.show('Back in 7 days');
        return;
      default:
        return;
    }
  };

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Financial Inbox"
        subtitle={inboxSubtitle(counts)}
        hint={{
          id: 'inbox',
          message:
            'Everything Wallnut thinks needs a look: duplicates and uncategorised rows, detected subscriptions, upcoming bills, finished goals and money owed to you. Fix it, ignore it, or snooze it.',
        }}
        right={
          items.some((item) => item.kind === 'transaction') ? (
            <Button label="Bulk review" size="sm" variant="secondary" onPress={() => router.push('/review' as never)} />
          ) : undefined
        }
      />

      {query.loading && !query.data ? (
        <LoadingBlock label="Checking your ledger…" />
      ) : query.error ? (
        <ErrorBlock message={query.error.message} onRetry={query.refresh} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="checkmark-done-outline"
          title="Nothing needs attention"
          message="Duplicates, missing categories, detected subscriptions, upcoming bills and stale balances all land here the moment they need a decision."
        />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          {counts.urgent > 0 ? (
            <InfoBanner
              tone="warning"
              message={`${counts.urgent} item${counts.urgent === 1 ? '' : 's'} look wrong and may affect your numbers — handle those first.`}
            />
          ) : null}

          {groups.map((group) => {
            const tone = PRIORITY_TONES[group.priority]!;
            return (
              <View key={group.priority}>
                <Row justify="space-between" style={{ marginBottom: theme.spacing.sm }}>
                  <Row gap="sm">
                    <Ionicons name={tone.icon as never} size={15} color={tone.color(theme)} />
                    <AppText variant="label" tone="muted">
                      {INBOX_PRIORITY_LABELS[group.priority].toUpperCase()}
                    </AppText>
                  </Row>
                  <AppText variant="caption" tone="muted">
                    {group.items.length}
                  </AppText>
                </Row>

                <View style={{ gap: theme.spacing.md }}>
                  {group.items.map((item) => (
                    <Card key={item.id}>
                      <Row justify="space-between" style={{ marginBottom: theme.spacing.md }}>
                        <Row gap="sm" style={{ flex: 1 }}>
                          <View
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: theme.radius.md,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: `${tone.color(theme)}22`,
                            }}>
                            <Ionicons name={item.icon as never} size={17} color={tone.color(theme)} />
                          </View>
                          <View style={{ flex: 1, gap: 2 }}>
                            <AppText variant="bodyMedium" numberOfLines={1}>
                              {item.title}
                            </AppText>
                            <AppText variant="caption" tone="muted" numberOfLines={2}>
                              {item.detail}
                            </AppText>
                          </View>
                        </Row>
                        {item.amount !== null ? (
                          <MoneyText amount={item.amount} variant="numericSmall" tone="auto" />
                        ) : null}
                      </Row>

                      <Row gap="sm" wrap>
                        {item.actions.map((action) => {
                          const spec = ACTION_SPECS[action];
                          return (
                            <Button
                              key={action}
                              label={labelForAction(action, item)}
                              size="sm"
                              variant={spec.variant}
                              onPress={() => void run(item, action)}
                            />
                          );
                        })}
                      </Row>
                    </Card>
                  ))}
                </View>
              </View>
            );
          })}

          {(dismissedQuery.data ?? 0) > 0 ? (
            <Card>
              <Row justify="space-between">
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="bodySmall">{dismissedQuery.data} ignored or snoozed</AppText>
                  <AppText variant="caption" tone="muted">
                    Ignored items come back if the underlying fact changes.
                  </AppText>
                </View>
                <Button
                  label="Restore"
                  size="sm"
                  variant="secondary"
                  onPress={async () => {
                    const ok = await confirm({
                      title: 'Restore ignored items?',
                      message: 'Everything you ignored or snoozed will show up again.',
                      confirmLabel: 'Restore',
                    });
                    if (!ok) return;
                    await restoreInboxDismissals();
                    toast.show('Inbox restored');
                    refresh();
                  }}
                />
              </Row>
            </Card>
          ) : null}
        </View>
      )}

      <PickerSheet
        visible={Boolean(categoryPickerFor)}
        onClose={() => setCategoryPickerFor(null)}
        title="Choose category"
        items={buildCategoryTree(query.data?.categories ?? []).flatMap((parent) => [
          { id: parent.id, label: parent.name, icon: parent.icon as IconName, color: parent.color },
          ...parent.children.map((child) => ({
            id: child.id,
            label: child.name,
            icon: child.icon as IconName,
            color: child.color,
            section: parent.name,
          })),
        ])}
        onSelect={async (selected) => {
          if (!categoryPickerFor?.transactionId) return;
          await bulkUpdateCategory([categoryPickerFor.transactionId], selected.id);
          await approveReviewItem(categoryPickerFor.transactionId);
          setCategoryPickerFor(null);
          toast.success(`Categorised as ${selected.label}`);
          refresh();
        }}
      />
    </ScrollScreen>
  );
}

const ACTION_SPECS: Record<InboxActionKind, { variant: 'primary' | 'secondary' | 'ghost' | 'danger' }> = {
  approve: { variant: 'primary' },
  set_category: { variant: 'secondary' },
  open_transaction: { variant: 'ghost' },
  open: { variant: 'primary' },
  create_recurring: { variant: 'primary' },
  delete_transaction: { variant: 'danger' },
  dismiss: { variant: 'ghost' },
  snooze: { variant: 'ghost' },
};

function labelForAction(action: InboxActionKind, item: InboxItem): string {
  switch (action) {
    case 'approve':
      return 'Approve';
    case 'set_category':
      return 'Set category';
    case 'open_transaction':
      return 'Open';
    case 'open':
      return item.kind === 'shared_balance'
        ? 'Settle up'
        : item.kind === 'goal_complete'
          ? 'View goal'
          : item.kind === 'import_review'
            ? 'Review'
            : 'View';
    case 'create_recurring':
      return 'Create schedule';
    case 'delete_transaction':
      return 'Delete this one';
    case 'dismiss':
      return 'Ignore';
    case 'snooze':
      return 'Remind later';
    default:
      return 'Open';
  }
}
