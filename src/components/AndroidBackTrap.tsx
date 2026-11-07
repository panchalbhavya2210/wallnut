import React, { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
import { router, usePathname } from 'expo-router';

import { toast, useUiStore } from '@/stores/ui.store';

/**
 * Android back policy.
 *
 *  - Home: first back shows “Press back again to exit”; a second one within
 *    2 seconds exits the app.
 *  - Any other screen: the navigator pops normally. If there is no history
 *    (deep links, drawer routes opened with `dismissTo`), go to the dashboard
 *    instead of letting Android close the whole app.
 *  - Open sheets/drawers register their own BackHandler later, so they always
 *    get the first back press; this handler only sees what they didn't consume.
 */

const HOME_ROUTES = new Set(['/', '/index']);
const EXIT_WINDOW_MS = 2000;

export function AndroidBackTrap() {
  const pathname = usePathname();
  const lastBack = useRef(0);

  useEffect(() => {
    lastBack.current = 0;
  }, [pathname]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // The drawer and sheets register later, so they normally run first. This
      // guard covers the drawer's own handler ordering on some Expo versions.
      if (useUiStore.getState().nativeDrawerOpen) return false;

      if (HOME_ROUTES.has(pathname)) {
        const now = Date.now();
        if (now - lastBack.current <= EXIT_WINDOW_MS) {
          lastBack.current = 0;
          BackHandler.exitApp();
          return true;
        }
        lastBack.current = now;
        toast.show('Press back again to exit');
        return true;
      }

      // A pushed screen with history: let React Navigation pop it.
      if (router.canGoBack()) return false;

      // No history (deep link / drawer replace): never fall through to Android's
      // app exit. Every root tab and pushed page lands on the dashboard first.
      router.replace('/' as never);
      return true;
    });

    return () => subscription.remove();
  }, [pathname]);

  return null;
}
