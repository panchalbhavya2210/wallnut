import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { useTheme } from '@/theme/theme';
import { AppText } from './text';
import { PressableBounce } from './bounce';
import type { IconName } from './layout';

/* --------------------------------- Button --------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Overrides the accessible name when several buttons share a label. */
  accessibilityLabel?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled,
  loading,
  fullWidth,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const theme = useTheme();
  const { background, foreground, border } = buttonColors(variant, theme);

  const heights: Record<ButtonSize, number> = { sm: 34, md: 44, lg: 52 };
  const padding: Record<ButtonSize, number> = { sm: theme.spacing.md, md: theme.spacing.lg, lg: theme.spacing.xl };
  const textVariant = size === 'sm' ? 'bodySmall' : 'bodyMedium';

  return (
    <PressableBounce
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(disabled || loading) }}
      scaleTo={size === 'sm' ? 0.97 : 0.98}
      style={[
        {
          backgroundColor: background,
          borderColor: border,
          borderWidth: border ? StyleSheet.hairlineWidth * 2 : 0,
          height: heights[size],
          paddingHorizontal: padding[size],
          borderRadius: theme.radius.md,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.sm,
          opacity: disabled ? 0.45 : 1,
        },
        variant === 'primary' ? theme.shadow('sm') : null,
        // No forced alignment: column parents stretch it (full-width CTAs),
        // row/centered parents keep it intrinsic instead of hugging the left.
        fullWidth ? { alignSelf: 'stretch' } : null,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : icon ? (
        <Ionicons name={icon} size={size === 'sm' ? 14 : 17} color={foreground} />
      ) : null}
      <AppText variant={textVariant} style={{ color: foreground }} numberOfLines={1}>
        {label}
      </AppText>
    </PressableBounce>
  );
}

function buttonColors(variant: ButtonVariant, theme: ReturnType<typeof useTheme>) {
  switch (variant) {
    case 'secondary':
      return { background: theme.colors.surfaceElevated, foreground: theme.colors.text, border: theme.colors.border };
    case 'ghost':
      return { background: 'transparent', foreground: theme.colors.accent.base, border: '' };
    case 'danger':
      return { background: theme.colors.negativeSoft, foreground: theme.colors.negative, border: '' };
    case 'success':
      return { background: theme.colors.positive, foreground: theme.mode === 'dark' ? theme.colors.textInverse : '#FFFFFF', border: '' };
    case 'primary':
    default:
      return { background: theme.colors.accent.base, foreground: theme.colors.accent.on, border: '' };
  }
}

/* ------------------------------- Icon button ------------------------------- */

export function IconButton({
  icon,
  onPress,
  size = 40,
  color,
  background,
  accessibilityLabel,
  disabled,
}: {
  icon: IconName;
  onPress?: () => void;
  size?: number;
  color?: string;
  background?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <PressableBounce
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      scaleTo={0.94}
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: background ?? 'transparent',
        opacity: disabled ? 0.4 : 1,
      }}>
      <Ionicons name={icon} size={Math.round(size * 0.5)} color={color ?? theme.colors.text} />
    </PressableBounce>
  );
}

/* ---------------------------------- Chip ---------------------------------- */

export function Chip({
  label,
  selected,
  onPress,
  icon,
  color,
  size = 'md',
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  color?: string;
  size?: 'sm' | 'md';
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const activeColor = color ?? theme.colors.accent.base;
  return (
    <PressableBounce
      onPress={onPress}
      scaleTo={0.97}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: Boolean(selected) }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: size === 'sm' ? theme.spacing.md : theme.spacing.lg - 2,
        height: size === 'sm' ? 28 : 34,
        borderRadius: theme.radius.full,
        backgroundColor: selected ? `${activeColor}22` : theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? `${activeColor}66` : theme.colors.border,
      }}>
      {selected ? (
        <Ionicons name="checkmark" size={12} color={activeColor} />
      ) : icon ? (
        <Ionicons name={icon} size={13} color={theme.colors.textSecondary} />
      ) : null}
      <AppText
        variant={size === 'sm' ? 'captionMedium' : 'bodySmall'}
        style={{ color: selected ? activeColor : theme.colors.textSecondary }}>
        {label}
      </AppText>
    </PressableBounce>
  );
}

/* --------------------------- Segmented control ---------------------------- */

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const width = useSharedValue(0);
  const animatedIndex = useSharedValue(index);

  React.useEffect(() => {
    animatedIndex.value = withSpring(index, { damping: 22, stiffness: 260, overshootClamping: true });
  }, [index, animatedIndex]);

  const indicatorStyle = useAnimatedStyle(() => {
    const segment = width.value / Math.max(1, options.length);
    return {
      transform: [{ translateX: animatedIndex.value * segment }],
      width: segment,
    };
  }, [options.length]);

  return (
    <View
      onLayout={(event) => {
        width.value = event.nativeEvent.layout.width;
      }}
      style={[
        {
          flexDirection: 'row',
          backgroundColor: theme.colors.inputBackground,
          borderRadius: theme.radius.md,
          padding: 3,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        style,
      ]}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: 3,
            bottom: 3,
            left: 3,
            borderRadius: theme.radius.sm,
            backgroundColor: theme.colors.surfaceElevated,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
          },
          indicatorStyle,
        ]}
      />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            style={{ flex: 1, height: 34, alignItems: 'center', justifyContent: 'center' }}>
            <AppText variant="bodySmall" tone={selected ? 'primary' : 'secondary'} style={selected ? { fontFamily: theme.typography.bodyMedium.fontFamily } : undefined}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------- Progress bar ------------------------------ */

export function ProgressBar({
  progress,
  color,
  height = 8,
  trackColor,
  style,
}: {
  /** 0–100+ (values above 100 clamp visually). */
  progress: number;
  color?: string;
  height?: number;
  trackColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const target = Math.min(100, Math.max(0, progress));
  const value = useSharedValue(0);

  React.useEffect(() => {
    value.value = theme.motion.reduceMotion ? target : withTiming(target, { duration: 520 });
  }, [target, theme.motion.reduceMotion, value]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${value.value}%` }));

  return (
    <View
      style={[
        {
          height,
          borderRadius: height / 2,
          backgroundColor: trackColor ?? theme.colors.inputBackground,
          overflow: 'hidden',
        },
        style,
      ]}>
      <Animated.View style={[{ height: '100%', borderRadius: height / 2, backgroundColor: color ?? theme.colors.accent.base }, fillStyle]} />
    </View>
  );
}

/* ------------------------------- Setting row ------------------------------- */

export function SettingSwitch({
  title,
  subtitle,
  value,
  onValueChange,
  icon,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  icon?: IconName;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        minHeight: 56,
      }}>
      {icon ? <Ionicons name={icon} size={18} color={theme.colors.textSecondary} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyMedium">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.colors.inputBackground, true: `${theme.colors.accent.base}88` }}
        thumbColor={value ? theme.colors.accent.base : theme.colors.muted}
      />
    </View>
  );
}

/** Full-width tappable row with a right chevron — used for navigation lists. */
export function LinkRow({
  title,
  subtitle,
  value,
  icon,
  onPress,
  tone = 'primary',
  chevron = true,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: IconName;
  onPress?: () => void;
  tone?: 'primary' | 'negative' | 'accent';
  chevron?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        minHeight: 56,
        backgroundColor: pressed ? theme.colors.pressed : 'transparent',
      })}>
      {icon ? <Ionicons name={icon} size={18} color={tone === 'negative' ? theme.colors.negative : theme.colors.textSecondary} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyMedium" tone={tone === 'primary' ? 'primary' : tone}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {value ? (
        <AppText variant="bodySmall" tone="muted">
          {value}
        </AppText>
      ) : null}
      {chevron ? <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} /> : null}
    </Pressable>
  );
}
