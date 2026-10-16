import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { useSettingsStore } from '@/stores/settings.store';
import { toast } from '@/stores/ui.store';

/**
 * The menu button: fixed at the top-right of every primary screen, it opens the
 * full destination drawer. Long-press toggles privacy mode (the eye that used
 * to live on Home) so amounts can be hidden from anywhere.
 *
 * The navigation object is typed structurally because `openDrawer` only exists
 * on drawer navigators and expo-router's generic `useNavigation` does not
 * surface it.
 */
export function HeaderMenuButton({ size = 20, compact }: { size?: number; compact?: boolean }) {
  const theme = useTheme();
  const navigation = useNavigation() as unknown as {
    openDrawer?: () => void;
    dispatch?: (action: { type: string }) => void;
  };
  const hideAmounts = useSettingsStore((state) => state.security.hideAmounts);
  const updateSettings = useSettingsStore((state) => state.update);

  const open = () => {
    if (typeof navigation.openDrawer === 'function') navigation.openDrawer();
    else navigation.dispatch?.({ type: 'OPEN_DRAWER' });
  };

  return (
    <Pressable
      onPress={open}
      onLongPress={() => {
        // Privacy mode lives on this button because the eye used to clutter the
        // hero. The toast makes the gesture discoverable (and never a mystery).
        const next = !hideAmounts;
        updateSettings('security', { hideAmounts: next });
        toast.show(next ? 'Amounts hidden — long-press again to show' : 'Amounts visible again');
      }}
      delayLongPress={280}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={hideAmounts ? 'Open menu. Amounts are hidden' : 'Open menu'}
      accessibilityHint="Long-press to hide or show amounts"
      android_ripple={{ color: theme.colors.ripple, borderless: true }}
      style={({ pressed }) => ({
        width: compact ? 34 : 40,
        height: compact ? 34 : 40,
        borderRadius: theme.radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: hideAmounts ? theme.colors.accent.soft : 'transparent',
        borderWidth: hideAmounts ? StyleSheet.hairlineWidth : 0,
        borderColor: theme.colors.accent.base,
        opacity: pressed ? 0.7 : 1,
      })}>
      <View>
        <Ionicons name="menu" size={size} color={hideAmounts ? theme.colors.accent.base : theme.colors.text} />
      </View>
    </Pressable>
  );
}
