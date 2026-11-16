import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { BottomSheet } from '@/components/ui/sheets';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button } from '@/components/ui/controls';
import { EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { useQuery } from '@/hooks/useQuery';
import { getInbox } from '@/services/inbox.service';
import { countInboxItems, INBOX_PRIORITY_LABELS, type InboxItem } from '@/utils/inbox';
import { useSettingsStore } from '@/stores/settings.store';

/**
 * The notification panel behind the header bell.
 *
 * It is not a second inbox: it surfaces the same derived attention queue
 * (review, upcoming bills, detected subscriptions, money owed), plus the daily
 * check-in, and hands each row to its real screen. Nothing is stored here.
 */
export function NotificationPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Notifications" maxHeightRatio={0.82}>
      {visible ? <NotificationContent onClose={onClose} /> : null}
    </BottomSheet>
  );
}

function NotificationContent({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const dailyReminder = useSettingsStore((state) => state.notifications.dailyReminder);
  const query = useQuery(() => getInbox(), []);
  const items = query.data ?? [];
  const counts = countInboxItems(items);
  const visibleItems = items.slice(0, 6);

  const openItem = (item: InboxItem) => {
    onClose();
    if (item.href) router.push(item.href as never);
    else router.push('/inbox' as never);
  };

  return (
    <View style={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <SummaryPill label="Urgent" value={counts.urgent} tone={theme.m3.color.error} />
        <SummaryPill label="Action" value={counts.action} tone={theme.m3.color.warning} />
        <SummaryPill label="Ideas" value={counts.suggestion} tone={theme.m3.color.primary} />
      </View>

      {dailyReminder ? (
        <Pressable
          onPress={() => {
            onClose();
            router.push('/transaction/new?type=expense' as never);
          }}
          android_ripple={{ color: theme.colors.ripple }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            padding: theme.spacing.lg,
            borderRadius: theme.m3.shape.large,
            backgroundColor: theme.m3.color.primaryContainer,
            opacity: pressed ? 0.85 : 1,
          })}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: theme.m3.shape.full,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.m3.color.onPrimaryContainer,
            }}>
            <Ionicons name="add" size={22} color={theme.m3.color.primaryContainer} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="titleSmall" style={{ color: theme.m3.color.onPrimaryContainer }}>
              Today’s check-in
            </AppText>
            <AppText variant="caption" style={{ color: theme.m3.color.onPrimaryContainer, opacity: 0.78 }}>
              Add today’s spending while it is still fresh.
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.m3.color.onPrimaryContainer} />
        </Pressable>
      ) : null}

      {query.loading && !query.data ? <LoadingBlock label="Checking what needs you…" /> : null}
      {!query.loading && visibleItems.length === 0 ? (
        <EmptyState
          compact
          icon="notifications-off-outline"
          title="Nothing needs you"
          message="Bills, reviews and suggestions will appear here the moment they do."
        />
      ) : null}

      {visibleItems.map((item, index) => (
        <Pressable
          key={item.id}
          onPress={() => openItem(item)}
          android_ripple={{ color: theme.colors.ripple }}
          accessibilityRole="button"
          accessibilityLabel={`${item.title}. ${item.detail}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            paddingVertical: theme.spacing.md,
            borderTopWidth: index === 0 ? 0 : 1,
            borderTopColor: theme.m3.color.outlineVariant,
          }}>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: theme.m3.shape.full,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.m3.color.surfaceContainerHigh,
            }}>
            <Ionicons name={item.icon as never} size={19} color={theme.m3.color.onSurfaceVariant} />
          </View>
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <AppText variant="bodyMedium" numberOfLines={1}>
              {item.title}
            </AppText>
            <AppText variant="caption" tone="muted" numberOfLines={2}>
              {INBOX_PRIORITY_LABELS[item.priority]} · {item.detail}
            </AppText>
          </View>
          {item.amount !== null ? <MoneyText amount={item.amount} variant="numericCaption" tone="auto" /> : null}
          <Ionicons name="chevron-forward" size={16} color={theme.m3.color.onSurfaceVariant} />
        </Pressable>
      ))}

      {items.length > visibleItems.length ? (
        <Pressable
          onPress={() => {
            onClose();
            router.push('/inbox' as never);
          }}
          style={{ alignItems: 'center', paddingVertical: theme.spacing.sm }}>
          <AppText variant="captionMedium" tone="accent">
            See all {items.length} in Financial Inbox
          </AppText>
        </Pressable>
      ) : null}

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <Button
          label="Financial Inbox"
          variant="secondary"
          size="sm"
          style={{ flex: 1 }}
          onPress={() => {
            onClose();
            router.push('/inbox' as never);
          }}
        />
        <Button
          label="Settings"
          variant="ghost"
          size="sm"
          style={{ flex: 1 }}
          onPress={() => {
            onClose();
            router.push('/settings/notifications' as never);
          }}
        />
      </View>
    </View>
  );
}

function SummaryPill({ label, value, tone }: { label: string; value: number; tone: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.sm,
        borderRadius: theme.m3.shape.large,
        backgroundColor: `${tone}1F`,
        gap: 2,
        alignItems: 'center',
      }}>
      <AppText variant="numericMedium" style={{ color: tone }}>
        {value}
      </AppText>
      <AppText variant="labelSmall" tone="muted">
        {label}
      </AppText>
    </View>
  );
}
