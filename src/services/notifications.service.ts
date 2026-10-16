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
}

/** Cancels and re-schedules every reminder notification. Safe to call often. */
export async function syncReminderNotifications(): Promise<SyncResult> {
  if (Platform.OS === 'web') return { scheduled: 0, permission: false };
  installHandler();

  const notificationSettings = useSettingsStore.getState().notifications;
  const anyEnabled = Object.values(notificationSettings).some(Boolean);

  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
  if (!anyEnabled) return { scheduled: 0, permission: true };

  const granted = await ensureNotificationPermission();
  if (!granted) return { scheduled: 0, permission: false };

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#FF3D8B',
    }).catch(() => undefined);
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
    return { scheduled: 0, permission: true };
  }

  let scheduled = 0;
  const now = Date.now();
  // iOS keeps only 64 pending notifications; stay well below.
  for (const reminder of reminders.slice(0, 48)) {
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

  return { scheduled, permission: true };
}
