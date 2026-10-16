import React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import {
  WallnutBalanceWidget,
  WallnutFallbackWidget,
  WallnutQuickAddWidget,
  WallnutSnapshotWidget,
  WallnutUpcomingWidget,
} from './components';
import { getWidgetSnapshot } from './snapshot';

/**
 * Android widget task handler.
 *
 * Registered from the custom entry point (index.ts) because `expo-router/entry`
 * owns the main component. It runs in a headless JS context: the database is
 * opened on demand, the snapshot is rebuilt through WidgetDataService (the
 * canonical services), and the result is handed to the launcher.
 *
 * Click actions use `OPEN_URI` deep links, which the platform resolves
 * natively — no JS is woken for navigation.
 */

const WIDGET_COMPONENTS = {
  Snapshot: WallnutSnapshotWidget,
  Balance: WallnutBalanceWidget,
  QuickAdd: WallnutQuickAddWidget,
  Upcoming: WallnutUpcomingWidget,
} as const;

type WidgetName = keyof typeof WIDGET_COMPONENTS;

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const name = props.widgetInfo.widgetName as WidgetName;
  const Component = WIDGET_COMPONENTS[name];
  if (!Component) return;

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      try {
        // Fresh on add; otherwise WidgetDataService reuses a recent snapshot so
        // a launcher refresh never hammers the ledger.
        const snapshot = await getWidgetSnapshot({ force: props.widgetAction === 'WIDGET_ADDED' });
        props.renderWidget({
          light: <Component snapshot={snapshot} theme="light" />,
          dark: <Component snapshot={snapshot} theme="dark" />,
        });
      } catch {
        props.renderWidget({
          light: <WallnutFallbackWidget mode="light" message="Open Wallnut to refresh" />,
          dark: <WallnutFallbackWidget mode="dark" message="Open Wallnut to refresh" />,
        });
      }
      break;
    }
    case 'WIDGET_DELETED':
      // Nothing to clean up — snapshots are derived data.
      break;
    case 'WIDGET_CLICK':
      // OPEN_URI / OPEN_APP are handled by the launcher natively.
      break;
    default:
      break;
  }
}
