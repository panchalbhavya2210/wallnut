import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, type RefreshControlProps, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/theme';
import { useUiStore } from '@/stores/ui.store';
import { AppText, type TextTone } from './text';
import { ScreenHint } from '../ScreenHint';
import { HeaderMenuButton } from '../HeaderMenuButton';

export type IconName = keyof typeof Ionicons.glyphMap;

/* --------------------------------- Screen --------------------------------- */

export interface ScreenProps {
  children: React.ReactNode;
  /** Adds bottom padding so content clears the tab bar. */
  bottomInset?: boolean;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  edges?: 'top' | 'none';
}

export function Screen({ children, bottomInset, style, padded = true, edges = 'top' }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      entering={theme.motion.reduceMotion ? undefined : FadeInUp.duration(220)}
      style={[
        { flex: 1, backgroundColor: theme.colors.background },
        padded ? { paddingHorizontal: theme.spacing.lg } : null,
        edges === 'top' ? { paddingTop: insets.top } : null,
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

export function ScrollScreen({
  children,
  bottomInset = true,
  contentContainerStyle,
  refreshControl,
  ...rest
}: ScreenProps & { contentContainerStyle?: StyleProp<ViewStyle>; refreshControl?: React.ReactElement<RefreshControlProps> }) {
  const theme = useTheme();
  const chartScrubbing = useUiStore((state) => state.chartScrubbing);
  return (
    <Screen padded={false} {...rest}>
      <ScrollView
        style={{ flex: 1 }}
        scrollEnabled={!chartScrubbing}
        contentContainerStyle={[
          {
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.sm,
            paddingBottom: bottomInset ? theme.spacing.colossal * 2 : theme.spacing.xxl,
          },
          contentContainerStyle,
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}>
        {children}
      </ScrollView>
    </Screen>
  );
}

/**
 * Same as `ScrollScreen`, but the header row stays put while the content
 * scrolls — the menu button, tabs and search never leave the top of the screen.
 */
export function HeaderScrollScreen({
  header,
  children,
  bottomInset = true,
  contentContainerStyle,
  refreshControl,
  ...rest
}: ScreenProps & {
  header: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
}) {
  const theme = useTheme();
  const chartScrubbing = useUiStore((state) => state.chartScrubbing);
  return (
    <Screen padded={false} {...rest}>
      <View style={{ paddingHorizontal: theme.spacing.lg }}>{header}</View>
      <ScrollView
        style={{ flex: 1 }}
        scrollEnabled={!chartScrubbing}
        contentContainerStyle={[
          {
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.sm,
            paddingBottom: bottomInset ? theme.spacing.colossal * 2 : theme.spacing.xxl,
          },
          contentContainerStyle,
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}>
        {children}
      </ScrollView>
    </Screen>
  );
}

/* ---------------------------------- Card ---------------------------------- */

export function Card({
  children,
  style,
  padded = true,
  elevation = false,
  variant,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  elevation?: boolean;
  /** M3 card styles: filled (default), elevated, outlined. */
  variant?: 'filled' | 'elevated' | 'outlined';
}) {
  const theme = useTheme();
  const c = theme.m3.color;
  const resolved = variant ?? (elevation ? 'elevated' : 'filled');
  const background =
    resolved === 'filled' ? c.surfaceContainerHigh : resolved === 'elevated' ? c.surfaceContainerLow : c.surface;
  return (
    <View
      style={[
        {
          backgroundColor: background,
          borderRadius: theme.m3.shape.large,
          borderWidth: resolved === 'outlined' ? 1 : 0,
          borderColor: c.outlineVariant,
        },
        padded ? { padding: theme.spacing.lg } : null,
        resolved === 'elevated' ? theme.shadow('sm') : null,
        style,
      ]}>
      {children}
    </View>
  );
}

/* -------------------------------- List group ------------------------------- */

export function ListGroup({
  children,
  title,
  style,
  footer,
}: {
  children: React.ReactNode;
  title?: string;
  style?: StyleProp<ViewStyle>;
  footer?: React.ReactNode;
}) {
  const theme = useTheme();
  const c = theme.m3.color;
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={style}>
      {title ? (
        <AppText variant="titleSmall" tone="muted" style={{ marginBottom: theme.spacing.sm, marginLeft: theme.spacing.xs }}>
          {title}
        </AppText>
      ) : null}
      <View
        style={{
          backgroundColor: c.surfaceContainerLow,
          borderRadius: theme.m3.shape.large,
          overflow: 'hidden',
        }}>
        {items.map((child, index) => (
          <View key={index}>
            {index > 0 ? (
              <View
                style={{
                  height: StyleSheet.hairlineWidth,
                  backgroundColor: c.outlineVariant,
                  marginLeft: theme.spacing.lg + 40,
                }}
              />
            ) : null}
            {child}
          </View>
        ))}
      </View>
      {footer}
    </View>
  );
}

export interface ListRowProps {
  title: string;
  subtitle?: string | null;
  /** Right-side text (usually MoneyText or a value). */
  value?: React.ReactNode;
  icon?: IconName;
  iconColor?: string;
  /** Render the icon in a tinted tile (categories/accounts). */
  iconTile?: boolean;
  iconTint?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  chevron?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Renders a small dot/check to the left of the title. */
  selected?: boolean;
  titleTone?: TextTone;
  compact?: boolean;
}

export function ListRow({
  title,
  subtitle,
  value,
  icon,
  iconColor,
  iconTile = true,
  iconTint,
  right,
  onPress,
  onLongPress,
  chevron,
  danger,
  disabled,
  selected,
  titleTone,
  compact,
}: ListRowProps) {
  const theme = useTheme();
  const c = theme.m3.color;
  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: compact ? theme.spacing.md : theme.spacing.lg - 2,
        minHeight: compact ? 56 : 64,
        opacity: disabled ? 0.38 : 1,
      }}>
      {icon ? (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: theme.m3.shape.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: iconTile ? `${iconTint ?? iconColor ?? c.primary}22` : 'transparent',
          }}>
          <Ionicons name={icon} size={20} color={iconColor ?? iconTint ?? c.primary} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyLarge" tone={titleTone} numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="bodyMedium" tone="muted" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {value ?? null}
      {right ?? null}
      {selected ? <Ionicons name="checkmark" size={20} color={c.primary} /> : null}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={c.onSurfaceVariant} /> : null}
    </View>
  );

  if (!onPress && !onLongPress) return body;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => (pressed ? { backgroundColor: theme.colors.pressed } : null)}>
      {body}
    </Pressable>
  );
}

/* ------------------------------ Section header ----------------------------- */

export function SectionHeader({
  title,
  actionLabel,
  onAction,
  style,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const c = theme.m3.color;
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm },
        style,
      ]}>
      <AppText variant="titleSmall">{title}</AppText>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={10}>
          <AppText variant="labelLarge" style={{ color: c.primary }}>
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Divider({ inset = 0, style }: { inset?: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: theme.m3.color.outlineVariant, marginLeft: inset }, style]} />;
}

export function Row({
  children,
  gap = 'sm',
  align = 'center',
  justify = 'flex-start',
  style,
  wrap,
}: {
  children: React.ReactNode;
  gap?: 'xs' | 'sm' | 'md' | 'lg';
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  style?: StyleProp<ViewStyle>;
  wrap?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: align, justifyContent: justify, gap: theme.spacing[gap], flexWrap: wrap ? 'wrap' : 'nowrap' },
        style,
      ]}>
      {children}
    </View>
  );
}

export function KeyValueRow({ label, value, tone }: { label: string; value: React.ReactNode; tone?: TextTone }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.sm }}>
      <AppText variant="body" tone="secondary">
        {label}
      </AppText>
      {typeof value === 'string' ? (
        <AppText variant="numericBody" tone={tone}>
          {value}
        </AppText>
      ) : (
        value
      )}
    </View>
  );
}

export const isWeb = Platform.OS === 'web';

/** Standard screen header: back chevron, title, optional subtitle and actions. */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
  showBack = true,
  hint,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  showBack?: boolean;
  /** First-visit explainer under the header (dismissed per id). */
  hint?: { id: string; message: string };
}) {
  const theme = useTheme();
  const c = theme.m3.color;
  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          minHeight: theme.m3.size.appBar,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.md,
        }}>
        {showBack ? (
          <Pressable
            onPress={onBack ?? (() => routerBack())}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            android_ripple={{ color: theme.colors.ripple, borderless: true }}
            style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-back" size={24} color={c.onSurface} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="titleLarge" numberOfLines={1}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="bodyMedium" tone="muted" numberOfLines={1}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {right}
        <HeaderMenuButton compact />
      </View>
      {hint ? <ScreenHint id={hint.id} message={hint.message} /> : null}
    </>
  );
}

/** Router is imported lazily to keep this UI module free of navigation deps. */
function routerBack() {
  const { router } = require('expo-router') as typeof import('expo-router');
  // Deep links (and pages opened directly by URL) have no history entry to pop,
  // so fall back to the dashboard instead of doing nothing.
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
