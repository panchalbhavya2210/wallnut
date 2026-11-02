import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/theme/theme';
import { ListGroup, Row, ScreenHeader, ScrollScreen } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { Button, Chip, SettingSwitch } from '@/components/ui/controls';
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
    // Defer the permission/scheduling pass off the effect body so toggling a
    // switch never causes a synchronous render cascade.
    const timer = setTimeout(() => void runSync(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    notifications.budgetAlerts,
    notifications.recurringReminders,
    notifications.installmentReminders,
    notifications.debtReminders,
    notifications.cardReminders,
    notifications.goalReminders,
    notifications.sharedReminders,
    notifications.dailyReminder,
    notifications.dailyReminderTime,
  ]);

  const toggle = (key: keyof typeof notifications) => (value: boolean) => update('notifications', { [key]: value });

  return (
    <ScrollScreen>
      <ScreenHeader title="Notifications" />

      <View style={{ gap: theme.spacing.lg }}>
        <InfoBanner
          icon="notifications-outline"
          message="Wallnut posts local notifications at 9:00 on each reminder date, plus a daily check-in at the time you choose. Everything is scheduled on this device — no push service, no network."
        />

        <ListGroup title="Daily check-in">
          <SettingSwitch
            title="Remind me to add expenses"
            subtitle="One quiet nudge a day so today's spending does not get lost"
            value={notifications.dailyReminder}
            onValueChange={toggle('dailyReminder')}
          />
          {notifications.dailyReminder ? (
            <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg, gap: theme.spacing.sm }}>
              <AppText variant="captionMedium" tone="secondary">
                Reminder time
              </AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {['09:00', '18:00', '20:00', '21:00', '22:00'].map((time) => (
                  <Chip
                    key={time}
                    label={time}
                    selected={notifications.dailyReminderTime === time}
                    onPress={() => update('notifications', { dailyReminderTime: time })}
                  />
                ))}
              </View>
              <AppText variant="caption" tone="muted">
                This is a repeating local notification. It does not depend on an internet connection.
              </AppText>
            </View>
          ) : null}
        </ListGroup>

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
            <Row justify="space-between">
              <AppText variant="bodySmall" tone="secondary">
                Daily check-in
              </AppText>
              <AppText variant="captionMedium" tone={sync?.daily ? 'positive' : notifications.dailyReminder ? 'warning' : 'muted'}>
                {notifications.dailyReminder ? (sync?.daily ? `Scheduled · ${notifications.dailyReminderTime}` : 'Not scheduled') : 'Off'}
              </AppText>
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
