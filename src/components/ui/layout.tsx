import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, type RefreshControlProps, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/theme';
import { useUiStore } from '@/stores/ui.store';
import { AppText, type TextTone } from './text';
import { ScreenHint } from '../ScreenHint';

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

/* ---------------------------------- Card ---------------------------------- */

export function Card({
  children,
  style,
  padded = true,
  elevation = false,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  elevation?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        padded ? { padding: theme.spacing.lg } : null,
        elevation ? theme.shadow('sm') : null,
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
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={style}>
      {title ? (
        <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.sm, marginLeft: theme.spacing.xs }}>
          {title}
        </AppText>
      ) : null}
      <View
        style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          overflow: 'hidden',
        }}>
        {items.map((child, index) => (
          <View key={index}>
            {index > 0 ? (
              <View
                style={{
                  height: StyleSheet.hairlineWidth,
                  backgroundColor: theme.colors.border,
                  marginLeft: theme.spacing.lg + 44,
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
  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: compact ? theme.spacing.md : theme.spacing.lg - 2,
        opacity: disabled ? 0.45 : 1,
      }}>
      {icon ? (
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: theme.radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: iconTile ? `${iconTint ?? iconColor ?? theme.colors.accent.base}22` : 'transparent',
          }}>
          <Ionicons name={icon} size={18} color={iconColor ?? iconTint ?? theme.colors.accent.base} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyMedium" tone={titleTone} numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="bodySmall" tone="muted" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {value ?? null}
      {right ?? null}
      {selected ? <Ionicons name="checkmark" size={18} color={theme.colors.accent.base} /> : null}
      {chevron ? <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} /> : null}
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
}) {  const theme = useTheme();
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm },
        style,
      ]}>
      <AppText variant="label" tone="muted">
        {title}
      </AppText>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={10}>
          <AppText variant="captionMedium" tone="accent">
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Divider({ inset = 0, style }: { inset?: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginLeft: inset }, style]} />;
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
  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.lg,
        }}>
        {showBack ? (
          <Pressable
            onPress={onBack ?? (() => routerBack())}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            android_ripple={{ color: theme.colors.ripple, borderless: true }}>
            <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <AppText variant="title" numberOfLines={1}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {right}
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
