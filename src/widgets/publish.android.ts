import React from 'react';
import { requestWidgetUpdate } from 'react-native-android-widget';

import {
  WallnutBalanceWidget,
  WallnutQuickAddWidget,
  WallnutSnapshotWidget,
  WallnutUpcomingWidget,
} from './components';
import { WIDGET_NAMES, type WidgetName } from './defs';
import { getWidgetSnapshot } from './snapshot';

/**
 * Redraws every added Wallnut widget from a freshly built snapshot. Runs in the
 * app's JS context, so it is safe to call after any ledger write; the update is
 * pushed to the launcher and the widget task handler is not needed.
 */

const COMPONENTS = {
  Snapshot: WallnutSnapshotWidget,
  Balance: WallnutBalanceWidget,
  QuickAdd: WallnutQuickAddWidget,
  Upcoming: WallnutUpcomingWidget,
} as const;

let inFlight: Promise<void> | null = null;

export async function publishWidgetSnapshot(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const snapshot = await getWidgetSnapshot({ force: true });
      for (const name of WIDGET_NAMES) {
        const Component = COMPONENTS[name as WidgetName];
        await requestWidgetUpdate({
          widgetName: name,
          renderWidget: () => ({
            light: React.createElement(Component, { snapshot, theme: 'light' as const }),
            dark: React.createElement(Component, { snapshot, theme: 'dark' as const }),
          }),
          widgetNotFound: () => undefined,
        }).catch(() => undefined);
      }
    } catch {
      // The ledger may be mid-boot; the next refresh will pick it up.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
