import React, { useMemo } from 'react';
import { MD3DarkTheme, MD3LightTheme, PaperProvider, type MD3Theme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme, type Theme } from '@/theme/theme';

/**
 * React Native Paper bridge.
 *
 * Wallnut keeps its own M3 token layer (`theme/m3.ts`) as the source of truth
 * for color roles, shape, type and motion. Paper supplies the standard Material
 * *behaviour* (ripple, state layers, accessibility, snackbars, text fields),
 * so its theme is derived from ours rather than configured separately.
 *
 * Rule: screens keep importing `@/components/ui/*`; only this file and the
 * wrapper internals may import from `react-native-paper`.
 */
function buildPaperTheme(theme: Theme): MD3Theme {
  const base = theme.mode === 'dark' ? MD3DarkTheme : MD3LightTheme;
  const c = theme.m3.color;
  return {
    ...base,
    roundness: theme.radius.lg,
    colors: {
      ...base.colors,
      primary: c.primary,
      onPrimary: c.onPrimary,
      primaryContainer: c.primaryContainer,
      onPrimaryContainer: c.onPrimaryContainer,
      secondary: c.secondary,
      onSecondary: c.onSecondary,
      secondaryContainer: c.secondaryContainer,
      onSecondaryContainer: c.onSecondaryContainer,
      tertiary: c.tertiary,
      onTertiary: c.onTertiary,
      tertiaryContainer: c.tertiaryContainer,
      onTertiaryContainer: c.onTertiaryContainer,
      error: c.error,
      onError: c.onError,
      errorContainer: c.errorContainer,
      onErrorContainer: c.onErrorContainer,
      background: c.surface,
      onBackground: c.onSurface,
      surface: c.surface,
      onSurface: c.onSurface,
      surfaceVariant: c.surfaceVariant,
      onSurfaceVariant: c.onSurfaceVariant,
      surfaceDisabled: c.surfaceContainerHighest,
      onSurfaceDisabled: c.onSurfaceVariant,
      outline: c.outline,
      outlineVariant: c.outlineVariant,
      inverseSurface: c.inverseSurface,
      inverseOnSurface: c.inverseOnSurface,
      inversePrimary: c.inversePrimary,
      backdrop: c.scrim,
      elevation: {
        ...base.colors.elevation,
        level0: 'transparent',
        level1: c.surfaceContainerLow,
        level2: c.surfaceContainer,
        level3: c.surfaceContainerHigh,
        level4: c.surfaceContainerHigh,
        level5: c.surfaceContainerHighest,
      },
    },
  };
}

export function PaperThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const paperTheme = useMemo(() => buildPaperTheme(theme), [theme]);

  return (
    <PaperProvider
      theme={paperTheme}
      settings={{
        rippleEffectEnabled: true,
        icon: (props) => (
          <MaterialCommunityIcons
            name={props.name as never}
            color={props.color}
            size={props.size}
            direction={props.direction as never}
          />
        ),
      }}>
      {children}
    </PaperProvider>
  );
}
