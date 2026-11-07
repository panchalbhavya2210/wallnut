import type { TextStyle } from 'react-native';

import type { FontFamilies } from './fonts';

/**
 * Material 3 Expressive system tokens.
 *
 * Source of truth: m3.material.io (M3 Expressive, May 2025 + I/O 2026 layout,
 * lists, menus and search updates). These are the platform-agnostic system
 * tokens; components in `src/components/ui` consume them so the app has one
 * design language on Android, iOS and web.
 *
 * Rules of the system:
 *  - Use color *roles*, never raw hex values, in components.
 *  - Type follows the M3 scale (display / headline / title / body / label).
 *  - Shape follows the M3 corner scale; expressive surfaces lean large.
 *  - Motion uses springs, not fixed durations, for spatial movement.
 *  - Spacing uses the 8dp scale (4dp for fine adjustments).
 */

export type M3ColorRoles = {
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
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;

  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  surfaceDim: string;
  surfaceBright: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;

  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;

  outline: string;
  outlineVariant: string;
  scrim: string;
  shadow: string;

  /** Finance semantic roles (custom, fixed across themes). */
  positive: string;
  onPositive: string;
  positiveContainer: string;
  onPositiveContainer: string;
  warning: string;
  onWarning: string;
  warningContainer: string;
  onWarningContainer: string;
};

/** M3 corner scale. Expressive surfaces use large / extra-large radii. */
export const m3Shape = {
  none: 0,
  extraSmall: 4,
  small: 8,
  medium: 12,
  large: 16,
  extraLarge: 28,
  extraLargeIncreased: 32,
  extraExtraLarge: 48,
  full: 999,
} as const;

export type M3ShapeToken = keyof typeof m3Shape;

/** M3 spacing follows an 8dp grid (4dp for fine adjustments). */
export const m3Spacing = {
  none: 0,
  space1: 4,
  space2: 8,
  space3: 12,
  space4: 16,
  space5: 24,
  space6: 32,
  space7: 40,
  space8: 48,
  space10: 64,
} as const;

/** Component sizing guidance from the M3 specs. */
export const m3Size = {
  touchTarget: 48,
  icon: 24,
  iconSmall: 20,
  buttonSmall: 40,
  buttonMedium: 56,
  buttonLarge: 96,
  fabSmall: 40,
  fab: 56,
  fabLarge: 96,
  appBar: 64,
  navBar: 64,
  navIndicatorWidth: 64,
  navIndicatorHeight: 32,
  searchBar: 56,
  chip: 32,
  segmented: 40,
  listItem: 56,
  listItemTwoLine: 72,
  listItemThreeLine: 88,
  sheetHandleWidth: 32,
  sheetHandleHeight: 4,
  sheetMaxWidth: 640,
} as const;

export type M3Spring = {
  damping: number;
  stiffness: number;
  mass: number;
};

export type M3MotionScheme = {
  /** Position, size, rotation, corner radius — may overshoot. */
  spatialFast: M3Spring;
  spatial: M3Spring;
  spatialSlow: M3Spring;
  /** Color and opacity — never overshoots. */
  effectsFast: M3Spring;
  effects: M3Spring;
};

/**
 * M3 Expressive spring presets. `expressive` is the opinionated default;
 * `standard` is the calmer, utilitarian scheme.
 */
export const m3Motion: Record<'expressive' | 'standard', M3MotionScheme> = {
  expressive: {
    spatialFast: { damping: 16, stiffness: 420, mass: 0.7 },
    spatial: { damping: 18, stiffness: 300, mass: 0.9 },
    spatialSlow: { damping: 20, stiffness: 180, mass: 1 },
    effectsFast: { damping: 30, stiffness: 500, mass: 1 },
    effects: { damping: 30, stiffness: 320, mass: 1 },
  },
  standard: {
    spatialFast: { damping: 26, stiffness: 420, mass: 1 },
    spatial: { damping: 28, stiffness: 300, mass: 1 },
    spatialSlow: { damping: 30, stiffness: 180, mass: 1 },
    effectsFast: { damping: 34, stiffness: 500, mass: 1 },
    effects: { damping: 34, stiffness: 320, mass: 1 },
  },
};

export type M3TypeRole =
  | 'displayLarge'
  | 'displayMedium'
  | 'displaySmall'
  | 'headlineLarge'
  | 'headlineMedium'
  | 'headlineSmall'
  | 'titleLarge'
  | 'titleMedium'
  | 'titleSmall'
  | 'bodyLarge'
  | 'bodyMedium'
  | 'bodySmall'
  | 'labelLarge'
  | 'labelMedium'
  | 'labelSmall';

const tabular = { fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] };

/**
 * The M3 type scale, built from the active font family. `emphasized` variants
 * are the M3 Expressive heavy weights for hero numbers and key actions.
 */
export function buildM3Typography(families: FontFamilies, factor = 1): Record<M3TypeRole, TextStyle> {
  const s = (value: number) => Math.round(value * factor);
  return {
    displayLarge: { fontFamily: families.bold, fontSize: s(57), lineHeight: s(64), letterSpacing: -0.25 },
    displayMedium: { fontFamily: families.bold, fontSize: s(45), lineHeight: s(52), letterSpacing: 0 },
    displaySmall: { fontFamily: families.bold, fontSize: s(36), lineHeight: s(44), letterSpacing: 0 },
    headlineLarge: { fontFamily: families.semibold, fontSize: s(32), lineHeight: s(40), letterSpacing: 0 },
    headlineMedium: { fontFamily: families.semibold, fontSize: s(28), lineHeight: s(36), letterSpacing: 0 },
    headlineSmall: { fontFamily: families.semibold, fontSize: s(24), lineHeight: s(32), letterSpacing: 0 },
    titleLarge: { fontFamily: families.semibold, fontSize: s(22), lineHeight: s(28), letterSpacing: 0 },
    titleMedium: { fontFamily: families.medium, fontSize: s(16), lineHeight: s(24), letterSpacing: 0.15 },
    titleSmall: { fontFamily: families.medium, fontSize: s(14), lineHeight: s(20), letterSpacing: 0.1 },
    bodyLarge: { fontFamily: families.regular, fontSize: s(16), lineHeight: s(24), letterSpacing: 0.5 },
    bodyMedium: { fontFamily: families.regular, fontSize: s(14), lineHeight: s(20), letterSpacing: 0.25 },
    bodySmall: { fontFamily: families.regular, fontSize: s(12), lineHeight: s(16), letterSpacing: 0.4 },
    labelLarge: { fontFamily: families.medium, fontSize: s(14), lineHeight: s(20), letterSpacing: 0.1 },
    labelMedium: { fontFamily: families.medium, fontSize: s(12), lineHeight: s(16), letterSpacing: 0.5 },
    labelSmall: { fontFamily: families.medium, fontSize: s(11), lineHeight: s(16), letterSpacing: 0.5 },
  };
}

/** Emphasized (M3 Expressive) style for a role: heavier weight, same metrics. */
export function emphasize(style: TextStyle, families: FontFamilies): TextStyle {
  const isLarge = (style.fontSize ?? 14) >= 24;
  return {
    ...style,
    fontFamily: isLarge ? families.bold : families.semibold,
    letterSpacing: (style.letterSpacing ?? 0) - 0.1,
  };
}

export function numericStyle(style: TextStyle): TextStyle {
  return { ...style, ...tabular };
}
