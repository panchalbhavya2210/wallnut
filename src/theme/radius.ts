/** Corner treatment chosen in Appearance → Shape. */
export type CornerStyle = 'round' | 'boxy';

/** Moderate corner radii. Pills are reserved for chips/status controls. */
export const roundRadius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 28,
  full: 999,
};

/** Sharp-edged variant: panels read as rectangles, circles stay circular. */
export const boxyRadius: typeof roundRadius = {
  xs: 0,
  sm: 2,
  md: 4,
  lg: 6,
  xl: 8,
  xxl: 12,
  full: 999,
};

export const radius = roundRadius;

export type RadiusToken = keyof typeof radius;

export function radiusFor(style: CornerStyle | undefined): typeof radius {
  return style === 'boxy' ? boxyRadius : roundRadius;
}
