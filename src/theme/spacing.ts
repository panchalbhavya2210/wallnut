/** Consistent spacing scale on the M3 8dp grid. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
  giant: 56,
  colossal: 64,
} as const;

export type SpacingToken = keyof typeof spacing;
