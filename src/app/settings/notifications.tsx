import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { ListGroup, Row, ScrollScreen } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { Button, SettingSwitch } from '@/components/ui/controls';
import { InfoBanner } from '@/components/ui/feedback';
import { useSettingsStore } from '@/stores/settings.store';
import { syncReminderNotifications, type SyncResult } from '@/services/notifications.service';

/**
 * Reminder notifications. Wallnut schedules real local notifications at 9:00
 * on each reminder date — no push service, no network, nothing leaves the
 * device. The same reminders stay visible inside the app.
 */
export default function NotificationSettings() {
  const theme = useTheme();
  const notifications = useSettingsStore((state) => state.notifications);
  const update = useSettingsStore((state) => state.update);
  const [sync, setSync] = useState<SyncResult | null>(null);
  const [syncing, setSyncing] = useState(false);

  const runSync = React.useCallback(async () => {
    setSyncing(true);
    try {
      setSync(await syncReminderNotifications());
    } finally {
      setSyncing(false);
    }
  }, []);

  // Re-schedule whenever a category is toggled.
  useEffect(() => {
    void runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    notifications.budgetAlerts,
    notifications.recurringReminders,
    notifications.installmentReminders,
    notifications.debtReminders,
    notifications.cardReminders,
    notifications.goalReminders,
    notifications.sharedReminders,
  ]);

  const toggle = (key: keyof typeof notifications) => (value: boolean) => update('notifications', { [key]: value });

  return (
    <ScrollScreen>
      <Row gap="sm" style={{ paddingTop: theme.spacing.md, paddingBottom: theme.spacing.lg }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <AppText variant="title">Notifications</AppText>
      </Row>

      <View style={{ gap: theme.spacing.lg }}>
        <InfoBanner
          icon="notifications-outline"
          message="Wallnut posts a local notification at 9:00 on each reminder date (a day or two before the payment, per schedule). Everything is computed and delivered on this device — no push service, no network."
        />

        <ListGroup title="Notify me about">
          <SettingSwitch
            title="Budget alerts"
            subtitle="When a category budget passes 85%"
            value={notifications.budgetAlerts}
            onValueChange={toggle('budgetAlerts')}
          />
          <SettingSwitch
            title="Recurring payments"
            subtitle="Bills and subscriptions, per their reminder setting"
            value={notifications.recurringReminders}
            onValueChange={toggle('recurringReminders')}
          />
          <SettingSwitch
            title="Installments"
            subtitle="Upcoming installment charges"
            value={notifications.installmentReminders}
            onValueChange={toggle('installmentReminders')}
          />
          <SettingSwitch
            title="Debt reminders"
            subtitle="Money you owe coming due"
            value={notifications.debtReminders}
            onValueChange={toggle('debtReminders')}
          />
          <SettingSwitch
            title="Shared money owed"
            subtitle="A quiet nudge when someone has owed you for 2+ weeks (in-app only)"
            value={notifications.sharedReminders}
            onValueChange={toggle('sharedReminders')}
          />
          <SettingSwitch
            title="Credit card due dates"
            subtitle="Cards with a balance and a due date this month"
            value={notifications.cardReminders}
            onValueChange={toggle('cardReminders')}
          />
          <SettingSwitch
            title="Goal deadlines"
            subtitle="Goals approaching their target date"
            value={notifications.goalReminders}
            onValueChange={toggle('goalReminders')}
          />
        </ListGroup>

        <ListGroup title="Scheduled">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <Row justify="space-between">
              <AppText variant="bodySmall" tone="secondary">
                Notifications queued
              </AppText>
              <AppText variant="numericSmall">{sync ? sync.scheduled : '—'}</AppText>
            </Row>
            {sync && !sync.permission ? (
              <AppText variant="caption" tone="warning">
                Android/iOS still needs permission. Enable notifications for Wallnut in your system settings, then tap
                refresh.
              </AppText>
            ) : null}
            <Button
              label={syncing ? 'Refreshing…' : 'Refresh reminders'}
              variant="secondary"
              onPress={() => void runSync()}
              disabled={syncing}
            />
            <AppText variant="caption" tone="muted">
              Reminders refresh on every launch and whenever you finish editing a schedule. Nothing here affects your data —
              the same reminders stay visible on Home.
            </AppText>
          </View>
        </ListGroup>
      </View>
    </ScrollScreen>
  );
}
