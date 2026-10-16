/**
 * Material-style tonal palettes.
 *
 * Wallnut's default theme is its own (quiet, data-first). Users who prefer
 * Material You can switch the *palette* to tonal roles derived from a seed
 * colour — either one of Wallnut's accents or, on Android, the device wallpaper
 * palette when the native bridge is available.
 *
 * The generator is deterministic and dependency-free (HSL-based tone mapping),
 * so it can be unit-tested and produces identical output on every platform.
 */

export interface MaterialPalette {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  surface: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  inverseSurface: string;
  inverseOnSurface: string;
}

export type Tone = 0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 95 | 99 | 100;

/* ------------------------------ colour maths ------------------------------- */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((char) => char + char).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h: Math.round(h), s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * Maps an M3-style tone (0–100, where 0 is black) to HSL lightness. Tone 40
 * lands near 40% and tone 90 near 88%, which keeps contrast close to the real
 * tonal palette without implementing CAM16.
 */
function toneToLightness(tone: number): number {
  return clamp(tone === 0 ? 6 : tone === 100 ? 98 : tone - (tone - 50) * 0.06, 4, 98);
}

/* ------------------------------- generation -------------------------------- */

export function generateMaterialPalette(seedHex: string, mode: 'light' | 'dark'): MaterialPalette {
  const { h, s } = hexToHsl(seedHex);
  const primarySat = clamp(s < 12 ? 44 : Math.max(36, Math.min(60, s)), 30, 64);
  const secondaryHue = h;
  const tertiaryHue = h + 60;
  const neutralSat = 7;
  const neutralVariantSat = 12;

  const role = (tone: number, sat = primarySat, hue = h) => hslToHex(hue, sat, toneToLightness(tone));

  const dark = mode === 'dark';
  const primaryTone = dark ? 80 : 40;
  const onPrimaryTone = dark ? 20 : 100;
  const containerTone = dark ? 30 : 90;
  const onContainerTone = dark ? 90 : 10;

  return {
    primary: role(primaryTone),
    onPrimary: role(onPrimaryTone, primarySat * 0.7),
    primaryContainer: role(containerTone),
    onPrimaryContainer: role(onContainerTone),

    secondary: role(primaryTone, primarySat * 0.45, secondaryHue),
    onSecondary: role(onPrimaryTone, primarySat * 0.3),
    secondaryContainer: role(dark ? 30 : 90, primarySat * 0.4),
    onSecondaryContainer: role(onContainerTone, primarySat * 0.4),

    tertiary: role(primaryTone, primarySat * 0.75, tertiaryHue),
    onTertiary: role(onPrimaryTone, primarySat * 0.5, tertiaryHue),
    tertiaryContainer: role(dark ? 30 : 90, primarySat * 0.6, tertiaryHue),
    onTertiaryContainer: role(onContainerTone, primarySat * 0.6, tertiaryHue),

    surface: hslToHex(h, neutralSat, toneToLightness(dark ? 10 : 98)),
    surfaceContainerLowest: hslToHex(h, neutralSat, toneToLightness(dark ? 6 : 100)),
    surfaceContainerLow: hslToHex(h, neutralSat, toneToLightness(dark ? 12 : 96)),
    surfaceContainer: hslToHex(h, neutralSat, toneToLightness(dark ? 15 : 94)),
    surfaceContainerHigh: hslToHex(h, neutralVariantSat, toneToLightness(dark ? 20 : 92)),
    surfaceContainerHighest: hslToHex(h, neutralVariantSat, toneToLightness(dark ? 24 : 90)),

    onSurface: hslToHex(h, neutralVariantSat, toneToLightness(dark ? 90 : 12)),
    onSurfaceVariant: hslToHex(h, neutralVariantSat, toneToLightness(dark ? 80 : 32)),
    outline: hslToHex(h, neutralVariantSat, toneToLightness(dark ? 60 : 48)),
    outlineVariant: hslToHex(h, neutralVariantSat, toneToLightness(dark ? 30 : 80)),

    inverseSurface: hslToHex(h, neutralVariantSat, toneToLightness(dark ? 90 : 20)),
    inverseOnSurface: hslToHex(h, neutralVariantSat, toneToLightness(dark ? 20 : 95)),
  };
}

/* ------------------------------ tuning helpers ------------------------------ */

/** Slightly deepens a palette for dark surfaces so contrast stays comfortable. */
export function adjustForContrast(hex: string, mode: 'light' | 'dark'): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, s, mode === 'dark' ? clamp(l, 62, 88) : clamp(l, 22, 52));
}

export { hslToHex };
