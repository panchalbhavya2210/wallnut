import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { useSettingsStore } from '@/stores/settings.store';
import { getReminders } from '@/services/reports.service';
import { fromISODate } from '@/utils/date';

/**
 * Real local notifications.
 *
 * The in-app reminder engine (`getReminders`) already knows what is due; this
 * service mirrors those reminders into the OS notification centre at 9:00 on
 * their reminder date. Everything is local — no push service, no network.
 * Failures are swallowed: notifications must never break the finance app.
 */

let handlerInstalled = false;

function installHandler() {
  if (handlerInstalled || Platform.OS === 'web') return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  installHandler();
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

export interface SyncResult {
  scheduled: number;
  permission: boolean;
  /** Whether the repeating daily check-in was queued. */
  daily: boolean;
}

function parseReminderTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const hour = match ? Number(match[1]) : 21;
  const minute = match ? Number(match[2]) : 0;
  return {
    hour: Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 21,
    minute: Number.isFinite(minute) ? Math.max(0, Math.min(59, minute)) : 0,
  };
}

/** Cancels and re-schedules every reminder notification. Safe to call often. */
export async function syncReminderNotifications(): Promise<SyncResult> {
  if (Platform.OS === 'web') return { scheduled: 0, permission: false, daily: false };
  installHandler();

  const notificationSettings = useSettingsStore.getState().notifications;
  const anyEnabled =
    notificationSettings.budgetAlerts ||
    notificationSettings.debtReminders ||
    notificationSettings.recurringReminders ||
    notificationSettings.goalReminders ||
    notificationSettings.cardReminders ||
    notificationSettings.installmentReminders ||
    notificationSettings.sharedReminders ||
    notificationSettings.dailyReminder;

  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
  if (!anyEnabled) return { scheduled: 0, permission: true, daily: false };

  // Android 13 only shows the notification permission prompt after at least
  // one channel exists. Creating it after requesting permission was the root
  // cause of "notifications never appear" on newer devices.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Reminders',
      description: 'Daily check-ins and upcoming payments',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#8B8CFF',
    }).catch(() => undefined);
  }

  const granted = await ensureNotificationPermission();
  if (!granted) return { scheduled: 0, permission: false, daily: false };

  let scheduled = 0;
  let dailyScheduled = false;

  // The daily "log today's spending" nudge is independent of the ledger
  // reminder engine: a failure there must not silently remove it.
  if (notificationSettings.dailyReminder) {
    const { hour, minute } = parseReminderTime(notificationSettings.dailyReminderTime);
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Log today's spending",
          body: 'A 20-second check-in keeps your budgets and insights accurate.',
          data: { href: '/transaction/new?type=expense' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
          channelId: 'reminders',
        },
      });
      scheduled++;
      dailyScheduled = true;
    } catch {
      // Permission or platform limitation — reported honestly in Settings.
    }
  }

  let reminders;
  try {
    reminders = await getReminders({
      recurring: notificationSettings.recurringReminders,
      debt: notificationSettings.debtReminders,
      budget: notificationSettings.budgetAlerts,
      goal: notificationSettings.goalReminders,
      card: notificationSettings.cardReminders,
      installment: notificationSettings.installmentReminders,
      shared: notificationSettings.sharedReminders,
    });
  } catch {
    return { scheduled, permission: true, daily: dailyScheduled };
  }

  const now = Date.now();
  // iOS keeps only 64 pending notifications; stay well below.
  for (const reminder of reminders.slice(0, 47)) {
    if (!reminder.date) continue;
    const day = fromISODate(reminder.date);
    if (!day) continue;
    const when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0);
    // Overdue items would fire instantly — nudge them to the next morning.
    if (when.getTime() <= now) when.setDate(when.getDate() + 1);
    if (when.getTime() - now > 30 * 24 * 60 * 60 * 1000) continue;

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: reminder.title,
          body: reminder.detail,
          data: { href: reminder.href ?? '/' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: when,
          channelId: 'reminders',
        },
      });
      scheduled++;
    } catch {
      // Skip this one; scheduling the rest matters more.
    }
  }

  return { scheduled, permission: true, daily: dailyScheduled };
}
