import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { widgetTaskHandler } from './widget-task-handler';

/** Registers the Android widget task handler with the React Native runtime. */
export function registerWallnutWidgets(): void {
  registerWidgetTaskHandler(widgetTaskHandler);
}
