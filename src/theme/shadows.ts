import { Platform, type ViewStyle } from 'react-native';

export type ShadowLevel = 'none' | 'sm' | 'md' | 'lg' | 'fab';

/**
 * Shadows are extremely subtle. The dark theme relies on surface contrast and
 * borders rather than shadows; Android elevation is disabled in dark mode.
 */
export function shadow(level: ShadowLevel, mode: 'light' | 'dark'): ViewStyle {
  if (level === 'none') return {};

  const light: Record<Exclude<ShadowLevel, 'none'>, ViewStyle> = {
    sm: {
      shadowColor: '#111318',
      shadowOpacity: 0.04,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    md: {
      shadowColor: '#111318',
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 5 },
      elevation: 3,
    },
    lg: {
      shadowColor: '#111318',
      shadowOpacity: 0.1,
      shadowRadius: 26,
      shadowOffset: { width: 0, height: 12 },
      elevation: 8,
    },
    fab: {
      shadowColor: '#111318',
      shadowOpacity: 0.22,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
    },
  };

  const dark: Record<Exclude<ShadowLevel, 'none'>, ViewStyle> = {
    sm: { shadowColor: '#000000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 0 },
    md: { shadowColor: '#000000', shadowOpacity: 0.4, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 0 },
    lg: { shadowColor: '#000000', shadowOpacity: 0.5, shadowRadius: 28, shadowOffset: { width: 0, height: 14 }, elevation: 0 },
    fab: { shadowColor: '#000000', shadowOpacity: 0.55, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  };

  const style = mode === 'light' ? light[level] : dark[level];
  if (Platform.OS === 'web') {
    const blur = { sm: 6, md: 14, lg: 26, fab: 20 }[level as Exclude<ShadowLevel, 'none'>];
    const y = { sm: 2, md: 5, lg: 12, fab: 8 }[level as Exclude<ShadowLevel, 'none'>];
    const alpha = mode === 'light' ? { sm: 0.05, md: 0.07, lg: 0.09, fab: 0.18 }[level as Exclude<ShadowLevel, 'none'>] : { sm: 0.3, md: 0.35, lg: 0.45, fab: 0.5 }[level as Exclude<ShadowLevel, 'none'>];
    return { boxShadow: `0 ${y}px ${blur}px rgba(0,0,0,${alpha})` } as ViewStyle;
  }
  return style;
}
