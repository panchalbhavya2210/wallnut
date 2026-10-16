import React, { useCallback } from 'react';
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
 * Long-press is handled by the child (multi-select).
 */

export interface SwipeAction {
  icon: IconName;
  label: string;
  color?: string;
  background?: string;
  onTrigger: () => void;
}

export function SwipeableRow({
  children,
  leftAction,
  rightAction,
  enabled = true,
  onLongPress,
}: {
  children: React.ReactNode;
  /** Revealed when swiping right. */
  leftAction?: SwipeAction;
  /** Revealed when swiping left (usually delete). */
  rightAction?: SwipeAction;
  enabled?: boolean;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  const ACTION_WIDTH = 88;

  const trigger = useCallback(
    (action: SwipeAction) => {
      translateX.value = withTiming(0, { duration: theme.motion.fast });
      action.onTrigger();
    },
    [translateX, theme.motion.fast],
  );

  const pan = Gesture.Pan()
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
      if (offset > ACTION_WIDTH * 0.7 && leftAction) {
        runOnJS(trigger)(leftAction);
      } else if (offset < -ACTION_WIDTH * 0.7 && rightAction) {
        runOnJS(trigger)(rightAction);
      } else {
        translateX.value = withSpring(0, { damping: 24, stiffness: 260 });
      }
    });

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
        <Animated.View style={[{ backgroundColor: theme.colors.background }, rowStyle]}>
          <LongPressable onLongPress={onLongPress}>{children}</LongPressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function LongPressable({ children, onLongPress }: { children: React.ReactNode; onLongPress?: () => void }) {
  if (!onLongPress) return <>{children}</>;
  return (
    <GestureDetector gesture={Gesture.LongPress().minDuration(320).onStart(() => runOnJS(onLongPress)())}>
      <View>{children}</View>
    </GestureDetector>
  );
}
