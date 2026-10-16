import type { TextStyle } from 'react-native';

import { FONT_OPTIONS, fontFamiliesFor, type FontFamilies } from './fonts';

/**
 * The type system. Every variant names a weight slot; the active font family
 * fills those slots (Inter by default, Poppins/Manrope/etc. from Appearance).
 * Financial figures use tabular numerals so columns of amounts align.
 */

const tabular = { fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] };

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
  | 'numericCaption';

export function buildTypography(families: FontFamilies, factor = 1): Record<TypographyVariant, TextStyle> {
  const scale = (value: number) => Math.round(value * factor);
  return {
    display: { fontFamily: families.bold, fontSize: scale(34), lineHeight: scale(40), letterSpacing: -0.8 },
    headline: { fontFamily: families.semibold, fontSize: scale(26), lineHeight: scale(32), letterSpacing: -0.5 },
    title: { fontFamily: families.semibold, fontSize: scale(20), lineHeight: scale(26), letterSpacing: -0.3 },
    titleSmall: { fontFamily: families.semibold, fontSize: scale(17), lineHeight: scale(22), letterSpacing: -0.2 },
    body: { fontFamily: families.regular, fontSize: scale(15), lineHeight: scale(21) },
    bodyMedium: { fontFamily: families.medium, fontSize: scale(15), lineHeight: scale(21) },
    bodySmall: { fontFamily: families.regular, fontSize: scale(13), lineHeight: scale(18) },
    caption: { fontFamily: families.regular, fontSize: scale(12), lineHeight: scale(16) },
    captionMedium: { fontFamily: families.medium, fontSize: scale(12), lineHeight: scale(16) },
    label: {
      fontFamily: families.semibold,
      fontSize: scale(11),
      lineHeight: scale(14),
      letterSpacing: 0.9,
      textTransform: 'uppercase',
    },
    overline: {
      fontFamily: families.medium,
      fontSize: scale(11),
      lineHeight: scale(14),
      letterSpacing: 0.4,
    },
    numericLarge: {
      fontFamily: families.bold,
      fontSize: scale(40),
      lineHeight: scale(46),
      letterSpacing: -1.2,
      ...tabular,
    },
    numericMedium: {
      fontFamily: families.semibold,
      fontSize: scale(24),
      lineHeight: scale(30),
      letterSpacing: -0.6,
      ...tabular,
    },
    numericSmall: {
      fontFamily: families.semibold,
      fontSize: scale(17),
      lineHeight: scale(22),
      letterSpacing: -0.3,
      ...tabular,
    },
    numericBody: {
      fontFamily: families.medium,
      fontSize: scale(15),
      lineHeight: scale(20),
      letterSpacing: -0.2,
      ...tabular,
    },
    numericCaption: {
      fontFamily: families.medium,
      fontSize: scale(12),
      lineHeight: scale(16),
      letterSpacing: -0.1,
      ...tabular,
    },
  };
}

export const DEFAULT_FONT_ID = 'inter';

/** Inter-based default — keeps direct imports working when no theme is present. */
export const typography = buildTypography(fontFamiliesFor(DEFAULT_FONT_ID));

export { FONT_OPTIONS };
export type { FontFamilies };
