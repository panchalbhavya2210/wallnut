import type { DevicePaletteResult } from './device-palette.service';

/** Browsers do not expose the OS wallpaper palette — reported honestly. */
export async function getDevicePaletteSeed(): Promise<DevicePaletteResult> {
  return {
    available: false,
    seed: null,
    source: 'none',
    detail: 'Browsers do not expose the device colour palette — this works in the Android build.',
  };
}
