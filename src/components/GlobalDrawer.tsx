import React, { useEffect, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { useUiStore } from '@/stores/ui.store';
import { DrawerMenu, type DrawerDestination } from './DrawerContent';

/**
 * Root-level drawer overlay for screens that sit above the drawer shell
 * (settings, editors, detail screens). It mirrors the native drawer without
 * dismissing the stack, so opening the menu never loses the screen you were on.
 */
export function GlobalDrawer() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const open = useUiStore((state) => state.drawerOpen);
  const closeDrawer = useUiStore((state) => state.closeDrawer);
  const [progress] = useState(() => new Animated.Value(0));
  const panelWidth = Math.min(width * 0.86, 340);

  useEffect(() => {
    if (!open) {
      progress.setValue(0);
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [open, progress]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-panelWidth - 24, 0] });
  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] });

  const go = (destination: DrawerDestination) => {
    if (!destination.href) return;
    closeDrawer();
    setTimeout(() => router.dismissTo(destination.href as never), 60);
  };

  return (
    <Modal transparent visible={open} animationType="none" statusBarTranslucent onRequestClose={closeDrawer}>
      <View style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: backdropOpacity }]} />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={closeDrawer}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
        />
        <Animated.View
          accessibilityViewIsModal
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: panelWidth,
            transform: [{ translateX }],
            backgroundColor: theme.colors.surface,
            borderRightWidth: StyleSheet.hairlineWidth,
            borderRightColor: theme.colors.border,
            ...theme.shadow('lg'),
          }}>
          <DrawerMenu active={open} onNavigate={go} />
        </Animated.View>
      </View>
    </Modal>
  );
}
