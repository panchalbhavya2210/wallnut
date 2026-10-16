import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { AppText } from './text';
import type { IconName } from './layout';

/**
 * Swipeable list row: swipe right → primary action (edit / approve),
 * swipe left past the threshold → destructive action (delete).
 *
 * Long-press belongs to the child row (multi-select) — it must NOT be wired
 * through here too: two competing long-press recognizers (gesture-handler +
 * the row's own Pressable) made long-press flaky and double-fired on Android.
 */
export interface SwipeAction {
  icon: IconName;
  label: string;
  color?: string;
  background?: string;
  onTrigger: () => void;
}

const ACTION_WIDTH = 88;

export function SwipeableRow({
  children,
  leftAction,
  rightAction,
  enabled = true,
}: {
  children: React.ReactNode;
  /** Revealed when swiping right. */
  leftAction?: SwipeAction;
  /** Revealed when swiping left (usually delete). */
  rightAction?: SwipeAction;
  enabled?: boolean;
}) {
  const theme = useTheme();
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);

  // Actions are inline props; refs keep the gesture object stable so a list of
  // rows does not rebuild a Pan recognizer on every render.
  const actionsRef = useRef({ leftAction, rightAction });
  useEffect(() => {
    actionsRef.current = { leftAction, rightAction };
  });

  const trigger = useCallback(
    (direction: 'left' | 'right') => {
      translateX.value = withTiming(0, { duration: theme.motion.fast });
      const action = direction === 'left' ? actionsRef.current.leftAction : actionsRef.current.rightAction;
      action?.onTrigger();
    },
    [translateX, theme.motion.fast],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX([-14, 14])
        .failOffsetY([-12, 12])
        .onBegin(() => {
          startX.value = translateX.value;
        })
        .onUpdate((event) => {
          const next = startX.value + event.translationX;
          const max = ACTION_WIDTH * 1.15;
          translateX.value = Math.max(-max, Math.min(max, next));
        })
        .onEnd((event) => {
          const offset = event.translationX;
          if (offset > ACTION_WIDTH * 0.7 && actionsRef.current.leftAction) {
            runOnJS(trigger)('left');
          } else if (offset < -ACTION_WIDTH * 0.7 && actionsRef.current.rightAction) {
            runOnJS(trigger)('right');
          } else {
            translateX.value = withSpring(0, { damping: 24, stiffness: 260 });
          }
        }),
    [enabled, translateX, startX, trigger],
  );

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  return (
    <View style={{ overflow: 'hidden' }}>
      {leftAction ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: leftAction.background ?? `${theme.colors.accent.base}22`, alignItems: 'flex-start', justifyContent: 'center', paddingLeft: 22 },
          ]}>
          <View style={{ alignItems: 'center', gap: 2, width: ACTION_WIDTH - 20 }}>
            <Ionicons name={leftAction.icon} size={20} color={leftAction.color ?? theme.colors.accent.base} />
            <AppText variant="caption" style={{ color: leftAction.color ?? theme.colors.accent.base }}>
              {leftAction.label}
            </AppText>
          </View>
        </View>
      ) : null}
      {rightAction ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: rightAction.background ?? theme.colors.negative, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 22 },
          ]}>
          <View style={{ alignItems: 'center', gap: 2, width: ACTION_WIDTH - 20 }}>
            <Ionicons name={rightAction.icon} size={20} color={rightAction.color ?? theme.colors.onNegative} />
            <AppText variant="caption" style={{ color: rightAction.color ?? theme.colors.onNegative }}>
              {rightAction.label}
            </AppText>
          </View>
        </View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ backgroundColor: theme.colors.background }, rowStyle]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
