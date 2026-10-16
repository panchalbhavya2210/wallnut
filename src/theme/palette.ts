import { accents, darkColors, lightColors, type AccentName, type AccentTokens, type ThemeColors } from './colors';
import { generateMaterialPalette, hexToHsl, hslToHex } from './material';

export type PaletteChoice = 'wallnut' | 'material';

/**
 * Chart tokens. Single-series charts use `series[0]`; multi-category charts use
 * `categorical`, which is derived from the active palette so visualisations
 * always match the accent (or Material tonal palette) chosen in Settings.
 */
export interface ChartTokens {
  series: string[];
  categorical: string[];
  grid: string;
  average: string;
  positive: string;
  negative: string;
  neutral: string;
}

export interface BuildColorsInput {
  mode: 'light' | 'dark';
  accent: AccentName;
  palette: PaletteChoice;
  /** Wallpaper-derived seed when the device bridge provides one. */
  deviceSeed?: string | null;
  /** Pure-black OLED canvas (dark mode only). */
  amoled?: boolean;
}

/** Rotates a colour's hue to build a harmonious categorical sequence. */
function rotate(hex: string, degrees: number, mode: 'light' | 'dark'): string {
  const { h, s, l } = hexToHsl(hex);
  const clamped = mode === 'dark' ? Math.max(56, Math.min(82, l)) : Math.max(32, Math.min(58, l));
  return hslToHex(h + degrees, Math.max(38, Math.min(72, s)), clamped);
}

/**
 * Mixes `foreground` into `background` (amount = strength of the foreground,
 * 0–1). Used to build deep tonal hero gradients that stay premium instead of
 * flooding the screen with the raw accent.
 */
export function mixHex(foreground: string, background: string, amount: number): string {
  const parse = (hex: string) => {
    const clean = hex.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((char) => char + char).join('') : clean;
    return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16));
  };
  const [r1, g1, b1] = parse(foreground);
  const [r2, g2, b2] = parse(background);
  const t = Math.max(0, Math.min(1, amount));
  const mix = (a: number, b: number) => Math.round(a * t + b * (1 - t));
  const hex = (value: number) => value.toString(16).padStart(2, '0');
  return `#${hex(mix(r1!, r2!))}${hex(mix(g1!, g2!))}${hex(mix(b1!, b2!))}`.toUpperCase();
}

/**
 * Two-stop gradient for hero surfaces and the add button: the accent plus a
 * hue-shifted partner, so the brand colour feels alive instead of flat.
 */
export function accentGradient(base: string, mode: 'light' | 'dark'): [string, string] {
  const { h, s, l } = hexToHsl(base);
  const partner = hslToHex(
    h - 36,
    Math.max(55, Math.min(92, s + 14)),
    mode === 'dark' ? Math.max(56, Math.min(72, l)) : Math.max(36, Math.min(52, l)),
  );
  return [base, partner];
}

export function buildChartTokens(
  mode: 'light' | 'dark',
  accent: AccentName,
  palette: PaletteChoice,
  deviceSeed?: string | null,
): ChartTokens {
  const base = mode === 'dark' ? darkColors : lightColors;
  const accentTokens = mode === 'dark' ? accents[accent].dark : accents[accent].light;

  if (palette === 'material') {
    const tonal = generateMaterialPalette(deviceSeed ?? accentTokens.base, mode);
    return {
      // Material's own guidance: primary, secondary and tertiary lead the chart.
      series: [tonal.primary, tonal.secondary, tonal.tertiary],
      categorical: [
        tonal.primary,
        tonal.tertiary,
        tonal.secondary,
        rotate(tonal.primary, 24, mode),
        rotate(tonal.tertiary, -20, mode),
        rotate(tonal.secondary, 30, mode),
        rotate(tonal.primary, -28, mode),
        rotate(tonal.tertiary, 42, mode),
      ],
      grid: tonal.outlineVariant,
      average: tonal.onSurfaceVariant,
      positive: base.positive,
      negative: base.negative,
      neutral: tonal.outline,
    };
  }

  const seed = accentTokens.base;
  return {
    series: [seed, rotate(seed, 148, mode), base.positive],
    categorical: [
      seed,
      rotate(seed, 32, mode),
      rotate(seed, 64, mode),
      rotate(seed, 180, mode),
      rotate(seed, 212, mode),
      rotate(seed, 244, mode),
      rotate(seed, 300, mode),
      rotate(seed, 336, mode),
    ],
    grid: base.chartGrid,
    average: base.muted,
    positive: base.positive,
    negative: base.negative,
    neutral: base.muted,
  };
}

/**
 * Resolves the active colour tokens.
 *
 * `wallnut` is the hand-tuned default: dark leans on surface contrast and
 * hairlines; light uses an off-white canvas so cards read as material.
 *
 * `material` swaps the surfaces and accent for a Material-style tonal palette
 * derived from a seed (device wallpaper when available, otherwise the accent),
 * while semantic income/expense/warning colours stay exactly the same — money
 * meaning never changes with the palette.
 */
/**
 * AMOLED overrides: a true-black canvas with just enough surface separation
 * for cards to stay readable on OLED panels.
 */
const AMOLED_OVERRIDES: Partial<ThemeColors> = {
  background: '#000000',
  surface: '#0B0B10',
  surfaceElevated: '#14141A',
  surfaceTranslucent: 'rgba(11, 11, 16, 0.98)',
  inputBackground: '#08080C',
  border: '#26262E',
  borderStrong: '#3A3A46',
  chartGrid: 'rgba(38, 38, 46, 0.9)',
};

export function buildThemeColors(input: BuildColorsInput): ThemeColors & { accent: AccentTokens } {
  const { mode, accent, palette, deviceSeed, amoled } = input;
  const base = mode === 'dark' ? darkColors : lightColors;
  const accentTokens = mode === 'dark' ? accents[accent].dark : accents[accent].light;
  const finalize = (colors: ThemeColors, tokens: AccentTokens) =>
    amoled && mode === 'dark' ? { ...colors, ...AMOLED_OVERRIDES, accent: tokens } : { ...colors, accent: tokens };

  if (palette !== 'material') {
    return finalize(base, accentTokens);
  }

  const seed = deviceSeed ?? accentTokens.base;
  const tonal = generateMaterialPalette(seed, mode);

  // Material 3 elevation: the canvas sits at surface, cards are *lighter*
  // filled containers (surfaceContainer), inputs the highest container. This
  // is what gives the palette its obvious, tonal "filled" look.
  const colors: ThemeColors = {
    ...base,
    background: tonal.surface,
    surface: tonal.surfaceContainer,
    surfaceElevated: tonal.surfaceContainerHigh,
    surfaceTranslucent: `${tonal.surfaceContainerHigh}F2`,
    border: tonal.outlineVariant,
    borderStrong: tonal.outline,
    text: tonal.onSurface,
    textSecondary: tonal.onSurfaceVariant,
    muted: tonal.outline,
    textInverse: tonal.inverseOnSurface,
    inputBackground: mode === 'dark' ? tonal.surfaceContainerHighest : tonal.surfaceContainer,
    chartGrid: tonal.outlineVariant,
    neutralSoft: mode === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)',
    pressed: mode === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
  };

  return finalize(colors, {
    base: tonal.primary,
    soft: tonal.primaryContainer,
    on: tonal.onPrimary,
  });
}
