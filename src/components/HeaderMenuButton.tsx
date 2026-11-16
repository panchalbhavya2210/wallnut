import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { useSettingsStore } from '@/stores/settings.store';
import { toast, useUiStore } from '@/stores/ui.store';

/**
 * The menu button: fixed at the top-right of every primary screen, it opens the
 * full destination drawer. Long-press toggles privacy mode (the eye that used
 * to live on Home) so amounts can be hidden from anywhere.
 *
 * In the drawer shell it opens the native drawer; everywhere else it opens the
 * root-level overlay so the current screen is never dismissed.
 */
export function HeaderMenuButton({ size = 20, compact }: { size?: number; compact?: boolean }) {
  const theme = useTheme();
  const c = theme.m3.color;
  const hideAmounts = useSettingsStore((state) => state.security.hideAmounts);
  const updateSettings = useSettingsStore((state) => state.update);

  const open = () => {
    // One drawer implementation everywhere: the root overlay. The native
    // drawer's open/close state was the source of the "closed it and it
    // reopened" bug, and it behaved differently from the overlay on pushed
    // screens. The overlay animates, closes on backdrop/X/back, and resets on
    // route changes.
    const ui = useUiStore.getState();
    if (ui.drawerOpen) ui.closeDrawer();
    else ui.openDrawer();
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
        width: compact ? 40 : 48,
        height: compact ? 40 : 48,
        borderRadius: theme.m3.shape.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: hideAmounts ? c.primaryContainer : 'transparent',
        borderWidth: hideAmounts ? 1 : 0,
        borderColor: c.primary,
        opacity: pressed ? 0.7 : 1,
      })}>
      <View>
        <Ionicons name="menu" size={compact ? 22 : 24} color={hideAmounts ? c.onPrimaryContainer : c.onSurface} />
      </View>
    </Pressable>
  );
}
