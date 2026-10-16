/**
 * Device palette (Material You) bridge.
 *
 * Android 12+ exposes a wallpaper-derived colour palette to native apps. There
 * is no JS API for it, so the seed must come from a native module. This file is
 * the platform-neutral fallback; `device-palette.service.native.ts` attempts the
 * native bridge and `device-palette.service.web.ts` reports it as unavailable.
 *
 * Wallnut never fakes this: when the bridge is missing the UI says so and the
 * Material palette derives from the user's chosen accent instead.
 */

export interface DevicePaletteResult {
  available: boolean;
  /** Seed colour as `#RRGGBB`, when the platform provides one. */
  seed: string | null;
  source: 'device' | 'none';
  /** Human-readable explanation shown in Settings. */
  detail: string;
}

export async function getDevicePaletteSeed(): Promise<DevicePaletteResult> {
  return {
    available: false,
    seed: null,
    source: 'none',
    detail: 'Device colours are only available in the Android app.',
  };
}
