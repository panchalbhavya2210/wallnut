import { useEffect } from 'react';
import { Platform } from 'react-native';

import { useDbStore } from '@/stores/db.store';
import { useSettingsStore } from '@/stores/settings.store';

import { publishWidgetSnapshot } from './publish';

/**
 * Keeps Android home-screen widgets in sync with the ledger.
 *
 * The database revision bus fires on every write (transactions, transfers,
 * settlements, recurring posts, budgets, goals…) and the settings store fires
 * on appearance/widgets changes. Both are debounced into one snapshot rebuild
 * plus a launcher update, so widgets never go stale and never recompute for
 * every keystroke.
 */
export function useWidgetAutoRefresh(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || Platform.OS !== 'android') return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void publishWidgetSnapshot();
      }, 1200);
    };

    schedule(); // publish once when the app becomes ready
    const unsubscribeDb = useDbStore.subscribe(schedule);
    const unsubscribeSettings = useSettingsStore.subscribe(schedule);
    return () => {
      unsubscribeDb();
      unsubscribeSettings();
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);
}
