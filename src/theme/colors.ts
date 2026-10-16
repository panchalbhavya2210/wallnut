/**
 * Wallnut palette.
 *
 * Design intent: a quiet, precise financial instrument. Surfaces are used
 * sparingly; typography and hairline dividers carry most of the hierarchy.
 * Color is reserved for meaning: money in (positive), money out (negative),
 * attention (warning), and the single user-chosen accent.
 */

export type AccentName =
  | 'magenta'
  | 'indigo'
  | 'violet'
  | 'blue'
  | 'sky'
  | 'teal'
  | 'green'
  | 'lime'
  | 'amber'
  | 'gold'
  | 'orange'
  | 'coral'
  | 'red'
  | 'rose'
  | 'neonPink'
  | 'neonPurple'
  | 'neonGreen'
  | 'neonCyan'
  | 'neonOrange';

export interface AccentTokens {
  /** Interactive color: buttons, selected states, chart strokes. */
  base: string;
  /** Low-emphasis tinted background for the accent. */
  soft: string;
  /** Readable text/icon color placed on top of `base`. */
  on: string;
}

export interface ThemeColors {
  /** App canvas. */
  background: string;
  /** Grouped containers (cards, list groups). */
  surface: string;
  /** Raised elements above `surface` (sheets, menus, pressed states). */
  surfaceElevated: string;
  /** Translucent surface for floating bars (tab bar). */
  surfaceTranslucent: string;
  /** Hairline borders and separators. */
  border: string;
  /** Stronger border for focused controls. */
  borderStrong: string;

  text: string;
  textSecondary: string;
  muted: string;
  textInverse: string;

  positive: string;
  positiveSoft: string;
  negative: string;
  negativeSoft: string;
  warning: string;
  warningSoft: string;
  neutralSoft: string;
  /** Text/icon color used on top of a solid semantic fill (destructive buttons). */
  onNegative: string;

  /** Material-style press ripple (Android). */
  ripple: string;
  /** Chart gridlines / axis. */
  chartGrid: string;
  /** Chart fill gradients start from this alpha-tinted accent. */
  overlay: string;
  inputBackground: string;
  pressed: string;
}

export const darkColors: ThemeColors = {
  // Deep violet-tinted charcoal — alive, not dead gray. Surfaces step up in
  // luminance so filled cards read as Material containers rather than holes.
  background: '#0A0A13',
  surface: '#14141F',
  surfaceElevated: '#1C1C2B',
  surfaceTranslucent: 'rgba(20, 20, 31, 0.98)',
  border: '#2B2B3F',
  borderStrong: '#3D3D57',

  text: '#F7F5FB',
  textSecondary: '#A9A6BD',
  muted: '#726E8A',
  textInverse: '#0C0A14',

  positive: '#3DDC97',
  positiveSoft: 'rgba(61, 220, 151, 0.15)',
  negative: '#FF5C7A',
  negativeSoft: 'rgba(255, 92, 122, 0.15)',
  warning: '#FFB547',
  warningSoft: 'rgba(255, 181, 71, 0.15)',
  neutralSoft: 'rgba(169, 166, 189, 0.12)',
  onNegative: '#FFFFFF',

  ripple: 'rgba(255, 255, 255, 0.10)',
  chartGrid: 'rgba(43, 43, 63, 0.9)',
  overlay: 'rgba(5, 4, 12, 0.66)',
  inputBackground: '#0F0F1A',
  pressed: 'rgba(255, 255, 255, 0.05)',
};

export const lightColors: ThemeColors = {
  // Off-white with a violet cast so the light theme belongs to the same family.
  background: '#F7F5FB',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceTranslucent: 'rgba(255, 255, 255, 0.98)',
  border: '#E7E3F0',
  borderStrong: '#D4CFE2',

  text: '#161223',
  textSecondary: '#5E5875',
  muted: '#8B86A0',
  textInverse: '#FFFFFF',

  positive: '#0E9F6E',
  positiveSoft: 'rgba(14, 159, 110, 0.10)',
  negative: '#D93843',
  negativeSoft: 'rgba(217, 56, 67, 0.10)',
  warning: '#B7740E',
  warningSoft: 'rgba(183, 116, 14, 0.12)',
  neutralSoft: 'rgba(94, 88, 117, 0.10)',
  onNegative: '#FFFFFF',

  ripple: 'rgba(22, 18, 35, 0.08)',
  chartGrid: 'rgba(231, 227, 240, 0.9)',
  overlay: 'rgba(22, 18, 35, 0.40)',
  inputBackground: '#F1EEF7',
  pressed: 'rgba(22, 18, 35, 0.04)',
};

/**
 * Curated accents. Each accent supplies dark and light variants so contrast
 * stays readable on both canvases. Accents never override semantic colors
 * (income stays green, expense stays red).
 */
export const accents: Record<AccentName, { label: string; dark: AccentTokens; light: AccentTokens }> = {
  magenta: {
    label: 'Magenta',
    dark: { base: '#FF3D8B', soft: 'rgba(255, 61, 139, 0.16)', on: '#1C0512' },
    light: { base: '#D6006E', soft: 'rgba(214, 0, 110, 0.10)', on: '#FFFFFF' },
  },
  indigo: {
    label: 'Indigo',
    dark: { base: '#8B8CFF', soft: 'rgba(139, 140, 255, 0.16)', on: '#0A0C18' },
    light: { base: '#5B5FEF', soft: 'rgba(91, 95, 239, 0.10)', on: '#FFFFFF' },
  },
  violet: {
    label: 'Violet',
    dark: { base: '#B79CFF', soft: 'rgba(183, 156, 255, 0.16)', on: '#120A22' },
    light: { base: '#7C4DFF', soft: 'rgba(124, 77, 255, 0.10)', on: '#FFFFFF' },
  },
  blue: {
    label: 'Blue',
    dark: { base: '#6FB4FF', soft: 'rgba(111, 180, 255, 0.16)', on: '#04101F' },
    light: { base: '#1D6FE0', soft: 'rgba(29, 111, 224, 0.10)', on: '#FFFFFF' },
  },
  green: {
    label: 'Green',
    dark: { base: '#5EDBA6', soft: 'rgba(94, 219, 166, 0.16)', on: '#04150D' },
    light: { base: '#0E9F6E', soft: 'rgba(14, 159, 110, 0.10)', on: '#FFFFFF' },
  },
  amber: {
    label: 'Amber',
    dark: { base: '#F5B84B', soft: 'rgba(245, 184, 75, 0.16)', on: '#1A1204' },
    light: { base: '#C97C10', soft: 'rgba(201, 124, 16, 0.12)', on: '#FFFFFF' },
  },
  rose: {
    label: 'Rose',
    dark: { base: '#FF8FA8', soft: 'rgba(255, 143, 168, 0.16)', on: '#20060D' },
    light: { base: '#E11D48', soft: 'rgba(225, 29, 72, 0.10)', on: '#FFFFFF' },
  },
  red: {
    label: 'Red',
    dark: { base: '#FF4D5E', soft: 'rgba(255, 77, 94, 0.16)', on: '#1C0508' },
    light: { base: '#D92D3F', soft: 'rgba(217, 45, 63, 0.10)', on: '#FFFFFF' },
  },
  neonPink: {
    label: 'Neon Pink',
    dark: { base: '#FF2FB3', soft: 'rgba(255, 47, 179, 0.18)', on: '#22001A' },
    light: { base: '#E0009A', soft: 'rgba(224, 0, 154, 0.10)', on: '#FFFFFF' },
  },
  neonPurple: {
    label: 'Neon Purple',
    dark: { base: '#B026FF', soft: 'rgba(176, 38, 255, 0.18)', on: '#17002A' },
    light: { base: '#8A1FD6', soft: 'rgba(138, 31, 214, 0.10)', on: '#FFFFFF' },
  },
  neonGreen: {
    label: 'Neon Green',
    dark: { base: '#39FF88', soft: 'rgba(57, 255, 136, 0.16)', on: '#00220E' },
    light: { base: '#00A85A', soft: 'rgba(0, 168, 90, 0.10)', on: '#FFFFFF' },
  },
  neonCyan: {
    label: 'Neon Cyan',
    dark: { base: '#22F5F0', soft: 'rgba(34, 245, 240, 0.16)', on: '#00201F' },
    light: { base: '#009E9A', soft: 'rgba(0, 158, 154, 0.10)', on: '#FFFFFF' },
  },
  neonOrange: {
    label: 'Neon Orange',
    dark: { base: '#FF7A1A', soft: 'rgba(255, 122, 26, 0.18)', on: '#1F0A00' },
    light: { base: '#D55600', soft: 'rgba(213, 86, 0, 0.10)', on: '#FFFFFF' },
  },
  lime: {
    label: 'Lime',
    dark: { base: '#C6F432', soft: 'rgba(198, 244, 50, 0.16)', on: '#16200A' },
    light: { base: '#6C8A00', soft: 'rgba(108, 138, 0, 0.12)', on: '#FFFFFF' },
  },
  teal: {
    label: 'Teal',
    dark: { base: '#2DD4BF', soft: 'rgba(45, 212, 191, 0.16)', on: '#00201B' },
    light: { base: '#0D9488', soft: 'rgba(13, 148, 136, 0.10)', on: '#FFFFFF' },
  },
  sky: {
    label: 'Sky',
    dark: { base: '#38BDF8', soft: 'rgba(56, 189, 248, 0.16)', on: '#001A26' },
    light: { base: '#0284C7', soft: 'rgba(2, 132, 199, 0.10)', on: '#FFFFFF' },
  },
  gold: {
    label: 'Gold',
    dark: { base: '#E8C547', soft: 'rgba(232, 197, 71, 0.16)', on: '#1C1603' },
    light: { base: '#A67C00', soft: 'rgba(166, 124, 0, 0.12)', on: '#FFFFFF' },
  },
  orange: {
    label: 'Orange',
    dark: { base: '#FFA24D', soft: 'rgba(255, 162, 77, 0.16)', on: '#1F0F00' },
    light: { base: '#C2620A', soft: 'rgba(194, 98, 10, 0.10)', on: '#FFFFFF' },
  },
  coral: {
    label: 'Coral',
    dark: { base: '#FF6B5B', soft: 'rgba(255, 107, 91, 0.16)', on: '#240804' },
    light: { base: '#E0452F', soft: 'rgba(224, 69, 47, 0.10)', on: '#FFFFFF' },
  },
};
