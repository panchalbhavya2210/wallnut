/**
 * Wallnut custom entry point.
 *
 * Expo Router keeps ownership of the app component (imported last, per the
 * Expo Router manual-installation guidance); the Android widget task handler is
 * registered alongside it so the launcher can render widgets even when the app
 * UI was never opened.
 *
 * Do not replace `expo-router/entry` — the router must stay the root component.
 */
import { registerWallnutWidgets } from './src/widgets/register';

import 'expo-router/entry';

registerWallnutWidgets();
