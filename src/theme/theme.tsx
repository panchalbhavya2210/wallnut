import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import * as Font from 'expo-font';
import { useShallow } from 'zustand/react/shallow';

import { accents, darkColors, lightColors, type AccentName, type AccentTokens, type ThemeColors } from './colors';
import { DEFAULT_FONT_ID, fontFamiliesFor, fontModulesFor } from './fonts';
import { accentGradient, buildChartTokens, buildThemeColors, type ChartTokens, type PaletteChoice } from './palette';
import { radius } from './radius';
import { shadow, type ShadowLevel } from './shadows';
import { spacing } from './spacing';
import { buildTypography, typography, type TypographyVariant } from './typography';
import { useSettingsStore } from '@/stores/settings.store';
import { getDevicePaletteSeed } from '@/services/device-palette/device-palette.service';

export type ThemeModePreference = 'system' | 'light' | 'dark';

export interface Theme {
  mode: 'light' | 'dark';
  colors: ThemeColors & { accent: AccentTokens };
  chart: ChartTokens;
  /** Two-stop brand gradient for hero surfaces and the floating add button. */
  gradient: [string, string];
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  shadow: (level: ShadowLevel) => ReturnType<typeof shadow>;
  motion: { fast: number; normal: number; slow: number; reduceMotion: boolean };
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const { modePreference, accentName, reduceMotion, fontScale, fontId, palette, deviceColors, amoled } = useSettingsStore(
    useShallow((s) => ({
      modePreference: s.appearance.theme,
      accentName: s.appearance.accent,
      reduceMotion: s.appearance.reduceMotion,
      fontScale: s.appearance.fontScale,
      fontId: s.appearance.fontFamily,
      palette: s.appearance.palette,
      deviceColors: s.appearance.deviceColors,
      amoled: s.appearance.amoled,
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
    if (!deviceColors) {
      setDeviceSeed(null);
      return;
    }
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
    const resolvedAccent = (accentName as AccentName) ?? 'magenta';
    const colors = buildThemeColors({
      mode,
      accent: resolvedAccent,
      palette: (palette as PaletteChoice) ?? 'wallnut',
      deviceSeed,
      amoled,
    });
    return {
      mode,
      colors,
      chart: buildChartTokens(mode, resolvedAccent, (palette as PaletteChoice) ?? 'wallnut', deviceSeed),
      gradient: accentGradient(colors.accent.base, mode),
      spacing,
      radius,
      typography: buildTypography(fontFamiliesFor(loadedFontId), fontScale === 'default' ? 1 : fontScale === 'large' ? 1.08 : 1.16),
      shadow: (level) => shadow(level, mode),
      motion: { fast: 140, normal: 220, slow: 320, reduceMotion },
    };
  }, [modePreference, accentName, reduceMotion, systemScheme, fontScale, fontId, loadedFontId, palette, deviceSeed, amoled]);

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

export type { ThemeColors, AccentTokens, TypographyVariant };
export { accents, typography, spacing, radius };
