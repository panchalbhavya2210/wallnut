import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/theme';

/**
 * Web-only phone viewport.
 *
 * The web build is the development/preview environment for a mobile app. On a
 * desktop browser the app used to stretch across the whole window, which hides
 * the real mobile layout, spacing and touch targets. Constrain it to a phone
 * width (430dp, centered) with the rest of the window as a neutral mat.
 *
 * Nothing changes on native: the wrapper disappears entirely, so Android/iOS
 * keep the full screen and their real safe-area insets.
 */
export function PhonePreviewFrame({ children }: { children: React.ReactNode }) {
  const theme = useTheme();

  if (Platform.OS !== 'web') return <>{children}</>;

  return (
    <View
      style={[
        styles.outer,
        { backgroundColor: theme.mode === 'dark' ? '#030405' : '#E7EBE8' },
      ]}>
      <View
        testID="phone-preview-frame"
        style={[
          styles.phone,
          {
            backgroundColor: theme.colors.background,
            borderColor: theme.colors.border,
            ...theme.shadow('lg'),
          },
        ]}>
        {children}
      </View>
    </View>
  );
}

const PHONE_WIDTH = 392;

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phone: {
    flex: 1,
    width: '100%',
    maxWidth: PHONE_WIDTH,
    overflow: 'hidden',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
});
