import { requestPinWidget } from 'react-native-android-widget';

/** Opens the launcher's native "add widget" prompt. */
export async function pinWallnutWidget(widgetName: string): Promise<boolean> {
  try {
    return await requestPinWidget({ widgetName });
  } catch {
    return false;
  }
}
