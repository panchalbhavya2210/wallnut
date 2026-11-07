import type { TextStyle } from 'react-native';

import { FONT_OPTIONS, fontFamiliesFor, type FontFamilies } from './fonts';
import { buildM3Typography, numericStyle, type M3TypeRole } from './m3';

/**
 * Wallnut's text roles mapped onto the Material 3 type scale.
 *
 * The variant names are kept from the previous design system because every
 * screen already uses them; their metrics now come from M3. New code should
 * prefer the M3 role styles (`theme.m3.type.titleLarge`, etc.).
 */

export type TypographyVariant =
  | 'display'
  | 'headline'
  | 'title'
  | 'titleSmall'
  | 'body'
  | 'bodyMedium'
  | 'bodySmall'
  | 'caption'
  | 'captionMedium'
  | 'label'
  | 'overline'
  | 'numericLarge'
  | 'numericMedium'
  | 'numericSmall'
  | 'numericBody'
  | 'numericCaption'
  | M3TypeRole;

export type AppTypography = Record<TypographyVariant, TextStyle> & Record<M3TypeRole, TextStyle>;

export function buildTypography(families: FontFamilies, factor = 1): AppTypography {
  const m3 = buildM3Typography(families, factor);
  return {
    ...m3,
    display: m3.displaySmall,
    headline: m3.headlineMedium,
    title: m3.titleLarge,
    titleSmall: m3.titleMedium,
    body: m3.bodyLarge,
    // Emphasised body copy keeps the M3 metrics but uses the medium face.
    bodyMedium: { ...m3.bodyLarge, fontFamily: families.medium },
    bodySmall: m3.bodyMedium,
    caption: m3.bodySmall,
    captionMedium: m3.labelMedium,
    label: m3.labelMedium,
    overline: m3.labelSmall,
    numericLarge: numericStyle({ ...m3.displaySmall, fontSize: round(40, factor), lineHeight: round(48, factor) }),
    numericMedium: numericStyle({ ...m3.headlineMedium, fontSize: round(28, factor), lineHeight: round(36, factor) }),
    numericSmall: numericStyle({ ...m3.titleLarge, fontSize: round(20, factor), lineHeight: round(28, factor) }),
    numericBody: numericStyle(m3.bodyLarge),
    numericCaption: numericStyle(m3.labelMedium),
  };
}

function round(value: number, factor: number) {
  return Math.round(value * factor);
}

export const DEFAULT_FONT_ID = 'inter';

/** Inter-based default — keeps direct imports working when no theme is present. */
export const typography = buildTypography(fontFamiliesFor(DEFAULT_FONT_ID));

export { FONT_OPTIONS };
export type { FontFamilies };
