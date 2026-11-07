import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
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

  // M3 Expressive button heights: small 40, medium 56 is the spec default, but
  // app forms are denser; our md stays 40 and lg 48 while keeping the M3 shape,
  // label and color roles.
  const heights: Record<ButtonSize, number> = { sm: 32, md: 40, lg: 48 };
  const padding: Record<ButtonSize, number> = { sm: theme.spacing.md, md: theme.spacing.xl, lg: theme.spacing.xxl };
  const textVariant = 'labelLarge';

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
          borderWidth: border ? 1 : 0,
          height: heights[size],
          paddingHorizontal: padding[size],
          borderRadius: theme.m3.shape.full,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.sm,
          opacity: disabled ? 0.38 : 1,
        },
        // No forced alignment: column parents stretch it (full-width CTAs),
        // row/centered parents keep it intrinsic instead of hugging the left.
        fullWidth ? { alignSelf: 'stretch' } : null,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : icon ? (
        <Ionicons name={icon} size={size === 'sm' ? 16 : 20} color={foreground} />
      ) : null}
      <AppText variant={textVariant} style={{ color: foreground }} numberOfLines={1}>
        {label}
      </AppText>
    </PressableBounce>
  );
}

function buttonColors(variant: ButtonVariant, theme: ReturnType<typeof useTheme>) {
  const c = theme.m3.color;
  switch (variant) {
    case 'secondary':
      // M3 tonal button.
      return { background: c.secondaryContainer, foreground: c.onSecondaryContainer, border: '' };
    case 'ghost':
      return { background: 'transparent', foreground: c.primary, border: '' };
    case 'danger':
      // M3 filled error button — white label on the error fill.
      return { background: c.error, foreground: c.onError, border: '' };
    case 'success':
      return { background: c.positive, foreground: c.onPositive, border: '' };
    case 'primary':
    default:
      return { background: c.primary, foreground: c.onPrimary, border: '' };
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
        borderRadius: theme.m3.shape.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: background ?? 'transparent',
        opacity: disabled ? 0.38 : 1,
      }}>
      <Ionicons name={icon} size={Math.round(size * 0.5)} color={color ?? theme.m3.color.onSurfaceVariant} />
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
  const c = theme.m3.color;
  const custom = Boolean(color);
  const selectedBackground = custom ? `${color}2E` : c.secondaryContainer;
  const selectedForeground = custom ? c.onSurface : c.onSecondaryContainer;
  const unselectedForeground = c.onSurfaceVariant;

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
        gap: 6,
        paddingHorizontal: size === 'sm' ? theme.spacing.md : theme.spacing.lg - 2,
        height: size === 'sm' ? 28 : 32,
        borderRadius: theme.m3.shape.small,
        backgroundColor: selected ? selectedBackground : 'transparent',
        borderWidth: 1,
        borderColor: selected ? (custom ? color : c.secondaryContainer) : c.outline,
      }}>
      {selected ? (
        <Ionicons name="checkmark" size={14} color={selectedForeground} />
      ) : icon ? (
        <Ionicons name={icon} size={14} color={unselectedForeground} />
      ) : null}
      <AppText
        variant="labelLarge"
        style={{ color: selected ? selectedForeground : unselectedForeground }}>
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
  /** `null` renders with no segment highlighted (active value lives outside the set). */
  value: T | null;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const c = theme.m3.color;
  const index = options.findIndex((option) => option.value === value);
  const selected = index >= 0;
  const width = useSharedValue(0);
  const animatedIndex = useSharedValue(Math.max(0, index));

  React.useEffect(() => {
    animatedIndex.value = theme.motion.reduceMotion
      ? Math.max(0, index)
      : withSpring(Math.max(0, index), theme.motion.spring.effects);
  }, [index, animatedIndex, theme.motion.reduceMotion, theme.motion.spring.effects]);

  const indicatorStyle = useAnimatedStyle(() => {
    const segment = width.value / Math.max(1, options.length);
    return {
      opacity: selected ? 1 : 0,
      transform: [{ translateX: animatedIndex.value * segment }],
      width: segment,
    };
  }, [options.length, selected]);

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          backgroundColor: c.surface,
          borderRadius: theme.m3.shape.full,
          padding: 4,
          borderWidth: 1,
          borderColor: c.outline,
          overflow: 'hidden',
        },
        style,
      ]}>
      <View
        style={{ flex: 1, flexDirection: 'row', height: 36 }}
        onLayout={(event) => {
          width.value = event.nativeEvent.layout.width;
        }}>
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              borderRadius: theme.m3.shape.full,
              backgroundColor: c.secondaryContainer,
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
              style={[
                { flex: 1, height: 36, alignItems: 'center', justifyContent: 'center' },
                // The browser's default focus ring spills outside the pill on
                // web; the selected container already communicates focus.
                Platform.OS === 'web' ? ({ outlineWidth: 0, outlineColor: 'transparent' } as ViewStyle) : null,
              ]}>
              <AppText
                variant="labelLarge"
                style={{ color: selected ? c.onSecondaryContainer : c.onSurfaceVariant }}>
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
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
    value.value = theme.motion.reduceMotion
      ? target
      : withSpring(target, theme.motion.spring.effects);
  }, [target, theme.motion.reduceMotion, theme.motion.spring.effects, value]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${value.value}%` }));

  return (
    <View
      style={[
        {
          height,
          borderRadius: height / 2,
          backgroundColor: trackColor ?? theme.m3.color.surfaceContainerHighest,
          overflow: 'hidden',
        },
        style,
      ]}>
      <Animated.View
        style={[
          { height: '100%', borderRadius: height / 2, backgroundColor: color ?? theme.m3.color.primary },
          fillStyle,
        ]}
      />
    </View>
  );
}

/* ------------------------------- M3 switch -------------------------------- */

/**
 * Material 3 switch. React Native's `Switch` ignores the M3 track/thumb roles on
 * web (it fell back to the browser's teal/pink default), so the app renders its
 * own: 52×32 track, 16dp off thumb / 24dp on thumb, spring-driven thumb.
 */
export function M3Switch({
  value,
  onValueChange,
  disabled,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const c = theme.m3.color;
  const progress = useSharedValue(value ? 1 : 0);

  React.useEffect(() => {
    progress.value = theme.motion.reduceMotion
      ? value
        ? 1
        : 0
      : withSpring(value ? 1 : 0, theme.motion.spring.effectsFast);
  }, [value, progress, theme.motion.reduceMotion, theme.motion.spring.effectsFast]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * 20 }, { scale: 0.667 + progress.value * 0.333 }],
  }));

  return (
    <Pressable
      onPress={() => {
        if (!disabled) onValueChange(!value);
      }}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={value ? 'On' : 'Off'}
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      hitSlop={6}
      style={{ width: 52, height: 48, justifyContent: 'center', opacity: disabled ? 0.38 : 1 }}>
      <View
        style={{
          width: 52,
          height: 32,
          borderRadius: 16,
          justifyContent: 'center',
          backgroundColor: value ? c.primary : c.surfaceContainerHighest,
          borderWidth: value ? 0 : 2,
          borderColor: c.outline,
        }}>
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 4,
              top: 4,
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: value ? c.onPrimary : c.outline,
            },
            thumbStyle,
          ]}
        />
      </View>
    </Pressable>
  );
}

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
  const c = theme.m3.color;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        minHeight: 64,
      }}>
      {icon ? (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: theme.m3.shape.full,
            backgroundColor: c.secondaryContainer,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Ionicons name={icon} size={20} color={c.onSecondaryContainer} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyLarge">{title}</AppText>
        {subtitle ? (
          <AppText variant="bodyMedium" tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <M3Switch value={value} onValueChange={onValueChange} />
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
