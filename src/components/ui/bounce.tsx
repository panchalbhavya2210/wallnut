import React, { useCallback } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/theme/theme';

/**
 * Touch feedback that feels physical: every press compresses slightly and
 * springs back smoothly. The press is shallow and the release has no
 * overshoot, so buttons with text never look springy or jittery.
 *
 * The animated style is applied to the Pressable *itself* (via
 * `createAnimatedComponent`) rather than to a wrapper, so `flex`, `alignSelf`
 * and every other layout prop keep working exactly as before.
 *
 * Respects the reduce-motion setting (no animation in that case).
 */

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableBounceProps extends Omit<PressableProps, 'style'> {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** How far the element compresses. 0.98 is a good default for buttons. */
  scaleTo?: number;
  bounce?: boolean;
}

export function PressableBounce({
  children,
  style,
  scaleTo = 0.98,
  disabled,
  bounce = true,
  ...rest
}: PressableBounceProps) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const animate = bounce && !theme.motion.reduceMotion;

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const onPressIn = useCallback(() => {
    if (animate) scale.value = withTiming(scaleTo, { duration: 80 });
  }, [animate, scale, scaleTo]);

  const onPressOut = useCallback(() => {
    if (!animate) return;
    // Settle straight back to 1 — damped, no overshoot.
    scale.value = withSpring(1, { damping: 22, stiffness: 340, mass: 0.7 });
  }, [animate, scale]);

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={[style as ViewStyle, animatedStyle]}>
      {children}
    </AnimatedPressable>
  );
}

/**
 * A value that pops when it changes — used for hero numbers so a new balance
 * lands with a small bounce rather than appearing silently.
 */
export function usePopOnChange(value: number) {
  const theme = useTheme();
  const scale = useSharedValue(1);

  React.useEffect(() => {
    if (theme.motion.reduceMotion) return;
    scale.value = withSequence(
      withTiming(1.035, { duration: 110 }),
      withSpring(1, { damping: 9, stiffness: 240, mass: 0.5 }),
    );
  }, [value, scale, theme.motion.reduceMotion]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return style;
}
