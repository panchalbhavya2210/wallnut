import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withSpring, Easing } from 'react-native-reanimated';
import Svg, { Circle, G } from 'react-native-svg';

import { useTheme } from '@/theme/theme';
import { AppText, MoneyText } from './ui/text';
import { useMoney } from '@/hooks/useMoney';
import { usePopOnChange } from './ui/bounce';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * Gauge — the Wallet-style circular indicator used for budgets, savings rate,
 * goal funding and credit-card utilisation.
 *
 * The sweep animates on mount and whenever the value changes, and takes its
 * colour from the palette (accent or Material tonal) unless a semantic tone
 * (`positive` / `warning` / `negative`) is more meaningful.
 */

export type GaugeTone = 'accent' | 'positive' | 'warning' | 'negative' | 'custom';

export interface GaugeProps {
  /** 0–100+ (values above 100 fill the ring and are reported in the label). */
  progress: number;
  size?: number;
  thickness?: number;
  tone?: GaugeTone;
  color?: string;
  /** Big centre content. Pass a formatted string, or use `amount` for money. */
  label?: string;
  amount?: number;
  /** Small text under the centre label. */
  caption?: string;
  /** Renders the percentage in the centre when no label is given. */
  showPercent?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Gauge({
  progress,
  size = 132,
  thickness = 12,
  tone = 'accent',
  color,
  label,
  amount,
  caption,
  showPercent = true,
  style,
}: GaugeProps) {
  const theme = useTheme();
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, progress));

  const sweep = useSharedValue(0);
  useEffect(() => {
    // Springy sweep — the ring settles with a small overshoot so progress feels
    // tangible rather than merely redrawn.
    sweep.value = theme.motion.reduceMotion
      ? clamped
      : withSpring(clamped, { damping: 14, stiffness: 130, mass: 0.9, overshootClamping: false });
  }, [clamped, sweep, theme.motion.reduceMotion]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - sweep.value / 100),
  }));

  const strokeColor =
    color ??
    (tone === 'positive'
      ? theme.colors.positive
      : tone === 'warning'
        ? theme.colors.warning
        : tone === 'negative'
          ? theme.colors.negative
          : theme.chart.series[0] ?? theme.colors.accent.base);

  const over = progress > 100;

  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={theme.colors.inputBackground}
            strokeWidth={thickness}
            fill="none"
          />
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={strokeColor}
            strokeWidth={thickness}
            strokeDasharray={`${circumference} ${circumference}`}
            animatedProps={animatedProps}
            strokeLinecap="round"
            fill="none"
          />
        </G>
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center', gap: 2, maxWidth: size - thickness * 2 }}>
        {amount !== undefined ? (
          <MoneyText amount={amount} variant={size >= 150 ? 'numericMedium' : 'numericSmall'} tone="neutral" showSign={false} />
        ) : label ? (
          <AppText variant={size >= 150 ? 'numericMedium' : 'numericSmall'}>{label}</AppText>
        ) : showPercent ? (
          <AppText variant={size >= 150 ? 'numericMedium' : 'numericSmall'}>
            {`${Math.round(progress)}%`}
          </AppText>
        ) : null}
        {caption ? (
          <AppText variant="caption" tone={over ? 'negative' : 'muted'} style={{ textAlign: 'center' }}>
            {caption}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/* ----------------------------- Animated numbers ---------------------------- */

/**
 * Count-up number for hero figures. Uses requestAnimationFrame rather than a
 * Reanimated text node so it behaves identically on web and native and can be
 * disabled by the reduce-motion setting.
 */
export function useCountUp(value: number, duration = 700): number {
  const theme = useTheme();
  const [display, setDisplay] = useState(() => (theme.motion.reduceMotion ? value : 0));
  const fromRef = useRef(theme.motion.reduceMotion ? value : 0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (theme.motion.reduceMotion) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const delta = value - from;
    if (delta === 0) return;
    const started = Date.now();

    const tick = () => {
      const elapsed = Date.now() - started;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + delta * eased);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      fromRef.current = value;
    };
  }, [value, duration, theme.motion.reduceMotion]);

  return display;
}

/** Money text that counts up to its value, with a small pop on change. */
export function AnimatedMoney({
  amount,
  variant = 'numericLarge',
  tone = 'neutral',
  style,
  showSign = false,
}: {
  amount: number;
  variant?: React.ComponentProps<typeof MoneyText>['variant'];
  tone?: React.ComponentProps<typeof MoneyText>['tone'];
  style?: React.ComponentProps<typeof MoneyText>['style'];
  showSign?: boolean;
}) {
  const displayed = useCountUp(amount);
  const popStyle = usePopOnChange(amount);
  return (
    <Animated.View style={popStyle}>
      <MoneyText amount={Math.round(displayed)} variant={variant} tone={tone} style={style} showSign={showSign} />
    </Animated.View>
  );
}

export const gaugeStyles = StyleSheet.create({
  hidden: { display: 'none' },
});
