/** Moderate corner radii. Pills are reserved for chips/status controls. */
export const radius = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  full: 999,
} as const;

export type RadiusToken = keyof typeof radius;
