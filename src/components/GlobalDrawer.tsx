import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { useUiStore } from '@/stores/ui.store';
import { DrawerMenu, type DrawerDestination } from './DrawerContent';

/** Routes that live inside the drawer shell (not pushed on the root stack). */
const DRAWER_SHELL_ROUTES = new Set(['/', '/transactions', '/budgets', '/analytics']);

/**
 * Root-level drawer overlay for screens that sit above the drawer shell
 * (settings, editors, detail screens). It mirrors the native drawer without
 * dismissing the stack, so opening the menu never loses the screen you were on.
 *
 * The modal stays open while the exit animation runs: closing sets `open` to
 * false only after the slide finishes, so dismissal never snaps. Navigation
 * starts in the same tick as the close, so a destination tap never waits for
 * the animation.
 */
export function GlobalDrawer() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const open = useUiStore((state) => state.drawerOpen);
  const closeDrawer = useUiStore((state) => state.closeDrawer);
  const [progress] = useState(() => new Animated.Value(0));
  const closing = useRef(false);
  const panelWidth = Math.min(width * 0.88, 344);
  const duration = theme.motion.reduceMotion ? 0 : theme.motion.normal;

  useEffect(() => {
    if (!open) return;
    closing.current = false;
    progress.setValue(theme.motion.reduceMotion ? 1 : 0);
    Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    // `progress` is a stable Animated.Value; only opening should replay the
    // entrance, so `open` is the meaningful dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, duration, theme.motion.reduceMotion]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, {
      toValue: 0,
      duration,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      closing.current = false;
      closeDrawer();
    });
    // `progress` and `closeDrawer` are stable for the overlay's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, closeDrawer]);

  const go = useCallback(
    (destination: DrawerDestination) => {
      if (!destination.href) return;
      close();
      if (DRAWER_SHELL_ROUTES.has(destination.href)) {
        router.dismissTo(destination.href as never);
        return;
      }
      // Pushed page: keep the current screen below it so Android back works.
      router.navigate(destination.href as never);
    },
    [close],
  );

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-panelWidth - 32, 0] });
  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  // The overlay is a plain root-level view (not a native Modal window), so
  // Android's back button needs to be wired manually.
  useEffect(() => {
    if (!open || Platform.OS === 'web') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => subscription.remove();
  }, [open, close]);

  if (!open) return null;

  return (
    // No native Modal: the overlay is a sibling of the navigator at the app
    // root, which paints above every pushed screen without a second window.
    // Native Modal windows with animated content are the Android new-arch
    // bug this whole change set removes.
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay, opacity: backdropOpacity }]} />
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close menu" />
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
        <DrawerMenu active onNavigate={go} />
      </Animated.View>
    </View>
  );
}
