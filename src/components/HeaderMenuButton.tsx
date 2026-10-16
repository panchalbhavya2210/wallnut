import React from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from 'expo-router';

import { useTheme } from '@/theme/theme';

/**
 * Hamburger that opens the drawer. The navigation object is typed structurally
 * because `openDrawer` only exists on drawer navigators and expo-router's
 * generic `useNavigation` does not surface it.
 */
export function HeaderMenuButton({ size = 22 }: { size?: number }) {
  const theme = useTheme();
  const navigation = useNavigation<{ openDrawer?: () => void }>();
  return (
    <Pressable
      onPress={() => navigation.openDrawer?.()}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Open menu"
      android_ripple={{ color: theme.colors.ripple, borderless: true }}>
      <Ionicons name="menu-outline" size={size} color={theme.colors.text} />
    </Pressable>
  );
}
