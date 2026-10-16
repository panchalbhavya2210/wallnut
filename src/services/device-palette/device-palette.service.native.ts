import { Platform } from 'react-native';

import type { DevicePaletteResult } from './device-palette.service';

/**
 * Android device palette via Expo UI's Material 3 colours.
 *
 * `@expo/ui/jetpack-compose` exposes the platform's Material You palette
 * (`getMaterialColors`): on Android 12+ it is derived from the user's wallpaper,
 * below that it falls back to the static M3 baseline (which is why we check
 * `isDynamicColorAvailable` before promising wallpaper colours).
 *
 * The module is required lazily and guarded: its native side is Android-only,
 * and requiring it elsewhere must never break boot.
 */
export async function getDevicePaletteSeed(): Promise<DevicePaletteResult> {
  if (Platform.OS !== 'android') {
    return {
      available: false,
      seed: null,
      source: 'none',
      detail: 'Device colours are only available in the Android app.',
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const material = require('@expo/ui/jetpack-compose') as {
      getMaterialColors?: () => { primary?: string } | null | undefined;
      isDynamicColorAvailable?: boolean;
    };

    const dynamic = Boolean(material.isDynamicColorAvailable);
    const palette = material.getMaterialColors?.();
    const raw = palette?.primary;
    if (dynamic && raw && /^#?[0-9a-f]{6,8}$/i.test(raw)) {
      // MaterialColors are #RRGGBBAA; the palette generator works in #RRGGBB.
      const hex = raw.replace('#', '').slice(0, 6);
      return {
        available: true,
        seed: `#${hex.toUpperCase()}`,
        source: 'device',
        detail: 'Using your wallpaper palette (Material You).',
      };
    }

    return {
      available: false,
      seed: null,
      source: 'none',
      detail: 'Wallpaper colours need Android 12 or newer — this device falls back to the chosen accent.',
    };
  } catch {
    return {
      available: false,
      seed: null,
      source: 'none',
      detail: 'The Material colours native module is unavailable in this build.',
    };
  }
}
