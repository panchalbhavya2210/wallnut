import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import * as Font from 'expo-font';
import { useShallow } from 'zustand/react/shallow';

import { accents, type AccentName, type AccentTokens } from './colors';
import { DEFAULT_FONT_ID, fontFamiliesFor, fontModulesFor } from './fonts';
import { accentGradient, buildChartTokens, buildThemeColors, heroGradient, type ChartTokens, type PaletteChoice, type ResolvedThemeColors } from './palette';
import { buildM3Typography, m3Motion, m3Shape, m3Size, m3Spacing, type M3ColorRoles, type M3MotionScheme, type M3TypeRole } from './m3';
import { radius, radiusFor } from './radius';
import { shadow, type ShadowLevel } from './shadows';
import { spacing } from './spacing';
import { buildTypography, typography, type TypographyVariant } from './typography';
import { useSettingsStore } from '@/stores/settings.store';
import { getDevicePaletteSeed } from '@/services/device-palette/device-palette.service';

export type ThemeModePreference = 'system' | 'light' | 'dark';

export interface Theme {
  mode: 'light' | 'dark';
  colors: ResolvedThemeColors;
  m3: {
    color: M3ColorRoles;
    shape: typeof m3Shape;
    spacing: typeof m3Spacing;
    size: typeof m3Size;
    type: Record<M3TypeRole, ReturnType<typeof buildM3Typography>[M3TypeRole]>;
    motion: M3MotionScheme;
  };
  chart: ChartTokens;
  /** Three-stop brand gradient for action surfaces (floating add button). */
  gradient: [string, string, string];
  /** Deeper three-stop gradient for hero cards that carry white type. */
  heroGradient: [string, string, string];
  spacing: typeof spacing;
  radius: typeof radius;
  typography: ReturnType<typeof buildTypography>;
  shadow: (level: ShadowLevel) => ReturnType<typeof shadow>;
  motion: {
    fast: number;
    normal: number;
    slow: number;
    reduceMotion: boolean;
    /** M3 Expressive springs for spatial + effects motion. */
    spring: M3MotionScheme;
  };
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const { modePreference, accentName, reduceMotion, fontScale, fontId, palette, deviceColors, amoled, cornerStyle, motionScheme } = useSettingsStore(
    useShallow((s) => ({
      modePreference: s.appearance.theme,
      accentName: s.appearance.accent,
      reduceMotion: s.appearance.reduceMotion,
      fontScale: s.appearance.fontScale,
      fontId: s.appearance.fontFamily,
      palette: s.appearance.palette,
      deviceColors: s.appearance.deviceColors,
      amoled: s.appearance.amoled,
      cornerStyle: s.appearance.cornerStyle,
      motionScheme: s.appearance.motionScheme,
    })),
  );

  // Fonts load on demand: the theme keeps rendering with the last loaded
  // family until the new one is registered, so switching never flashes.
  const [loadedFontId, setLoadedFontId] = useState(DEFAULT_FONT_ID);
  useEffect(() => {
    if (!fontId || fontId === loadedFontId) return;
    let cancelled = false;
    void Font.loadAsync(fontModulesFor(fontId))
      .then(() => {
        if (!cancelled) setLoadedFontId(fontId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fontId, loadedFontId]);

  // Wallpaper palette (Android) — resolved once when the option is enabled.
  const [deviceSeed, setDeviceSeed] = useState<string | null>(null);
  useEffect(() => {
    if (!deviceColors) return;
    let cancelled = false;
    void getDevicePaletteSeed()
      .then((result) => {
        if (!cancelled && result.available) setDeviceSeed(result.seed);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [deviceColors]);

  const theme = useMemo<Theme>(() => {
    const system: 'light' | 'dark' = systemScheme === 'dark' ? 'dark' : 'light';
    const mode = modePreference === 'system' ? system : modePreference;
    const resolvedAccent = (accentName as AccentName) ?? 'indigo';
    const colors = buildThemeColors({
      mode,
      accent: resolvedAccent,
      palette: (palette as PaletteChoice) ?? 'material',
      deviceSeed: deviceColors ? deviceSeed : null,
      amoled,
    });
    const families = fontFamiliesFor(loadedFontId);
    // Wallnut is a data-dense finance app, so it runs the M3 scale at 92%
    // density (still the official proportions, just one step tighter). The
    // user's text-size setting stacks on top of this base.
    const density = 0.92;
    const factor = (fontScale === 'default' ? 1 : fontScale === 'large' ? 1.08 : 1.16) * density;
    const appTypography = buildTypography(families, factor);
    const m3Type = buildM3Typography(families, factor);
    const scheme = motionScheme === 'standard' ? 'standard' : 'expressive';
    return {
      mode,
      colors,
      m3: {
        color: colors.m3,
        shape: m3Shape,
        spacing: m3Spacing,
        size: m3Size,
        type: m3Type,
        motion: m3Motion[scheme],
      },
      chart: buildChartTokens(mode, resolvedAccent, (palette as PaletteChoice) ?? 'material', deviceColors ? deviceSeed : null),
      gradient: accentGradient(colors.accent.base, mode),
      heroGradient: heroGradient(colors.accent.base, mode),
      spacing,
      radius: radiusFor(cornerStyle),
      typography: appTypography,
      shadow: (level) => shadow(level, mode),
      motion: { fast: 140, normal: 220, slow: 320, reduceMotion, spring: m3Motion[scheme] },
    };
  }, [modePreference, accentName, reduceMotion, systemScheme, fontScale, loadedFontId, palette, deviceSeed, deviceColors, amoled, cornerStyle, motionScheme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/** Builds a memoized stylesheet from the active theme. */
export function useThemedStyles<T extends Record<string, unknown>>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [theme, factory]);
}

export type { AccentTokens, TypographyVariant };
export type { ThemeColors } from './colors';
export { accents, typography, spacing, radius };
