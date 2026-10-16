import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';

import { useTheme } from '@/theme/theme';
import { useUiStore } from '@/stores/ui.store';
import { AppText } from './text';
import { Button } from './controls';
import type { IconName } from './layout';

/* ------------------------------- Empty state ------------------------------- */

export function EmptyState({
  icon = 'sparkles-outline',
  title,
  message,
  actionLabel,
  onAction,
  compact,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: compact ? theme.spacing.xxl : theme.spacing.colossal,
        paddingHorizontal: theme.spacing.xl,
        gap: theme.spacing.sm,
      }}>
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.neutralSoft,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: theme.spacing.xs,
        }}>
        <Ionicons name={icon} size={24} color={theme.colors.muted} />
      </View>
      <AppText variant="titleSmall" style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      {message ? (
        <AppText variant="bodySmall" tone="muted" style={{ textAlign: 'center', maxWidth: 280 }}>
          {message}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} size="sm" style={{ marginTop: theme.spacing.sm }} />
      ) : null}
    </View>
  );
}

/* ------------------------------- Loading block ------------------------------ */

export function LoadingBlock({ label }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={{ paddingVertical: theme.spacing.colossal, alignItems: 'center', gap: theme.spacing.md }}>
      <ActivityIndicator color={theme.colors.accent.base} />
      {label ? (
        <AppText variant="bodySmall" tone="muted">
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

/* -------------------------------- Error block ------------------------------- */

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const theme = useTheme();
  return (
    <View
      style={{
        margin: theme.spacing.lg,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.negativeSoft,
        gap: theme.spacing.sm,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons name="alert-circle-outline" size={18} color={theme.colors.negative} />
        <AppText variant="bodyMedium" tone="negative">
          Something went wrong
        </AppText>
      </View>
      <AppText variant="bodySmall" tone="secondary">
        {message}
      </AppText>
      {onRetry ? <Button label="Try again" variant="secondary" size="sm" onPress={onRetry} /> : null}
    </View>
  );
}

/* --------------------------------- Banner ---------------------------------- */

export function InfoBanner({
  icon = 'information-circle-outline',
  title,
  message,
  tone = 'accent',
  actionLabel,
  onAction,
}: {
  icon?: IconName;
  title?: string;
  message: string;
  tone?: 'accent' | 'warning' | 'negative';
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  const color = tone === 'warning' ? theme.colors.warning : tone === 'negative' ? theme.colors.negative : theme.colors.accent.base;
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.lg,
        backgroundColor: `${color}14`,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: `${color}44`,
        alignItems: 'flex-start',
      }}>
      <Ionicons name={icon} size={18} color={color} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 3 }}>
        {title ? (
          <AppText variant="bodyMedium" style={{ color }}>
            {title}
          </AppText>
        ) : null}
        <AppText variant="bodySmall" tone="secondary">
          {message}
        </AppText>
        {actionLabel && onAction ? (
          <Pressable onPress={onAction} hitSlop={8} style={{ marginTop: 4 }}>
            <AppText variant="captionMedium" style={{ color }}>
              {actionLabel}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/* ---------------------------------- Toast ---------------------------------- */

export function ToastHost() {
  const theme = useTheme();
  const toasts = useUiStore((state) => state.toasts);
  const dismissToast = useUiStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end', padding: theme.spacing.lg, paddingBottom: 110 }]}>
      {toasts.map((toast) => (
        <Animated.View
          key={toast.id}
          entering={FadeInDown.duration(180)}
          exiting={FadeOut.duration(140)}
          style={{ marginTop: theme.spacing.sm }}>
          <Pressable
            onPress={() => dismissToast(toast.id)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.border,
              borderWidth: StyleSheet.hairlineWidth,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.md,
              ...theme.shadow('md'),
            }}>
            <Ionicons
              name={toast.tone === 'positive' ? 'checkmark-circle-outline' : toast.tone === 'negative' ? 'alert-circle-outline' : 'information-circle-outline'}
              size={17}
              color={toast.tone === 'positive' ? theme.colors.positive : toast.tone === 'negative' ? theme.colors.negative : theme.colors.accent.base}
            />
            <AppText variant="bodySmall" style={{ flex: 1 }}>
              {toast.text}
            </AppText>
            {toast.actionLabel ? (
              <Pressable
                onPress={() => {
                  dismissToast(toast.id);
                  toast.onAction?.();
                }}
                hitSlop={8}>
                <AppText variant="bodySmall" tone="accent">
                  {toast.actionLabel}
                </AppText>
              </Pressable>
            ) : null}
          </Pressable>
        </Animated.View>
      ))}
    </View>
  );
}

/* ------------------------------ Fade-in helper ----------------------------- */

export function Appear({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: object;
}) {
  const theme = useTheme();
  if (theme.motion.reduceMotion) return <View style={style}>{children}</View>;
  return (
    <Animated.View entering={FadeIn.delay(delay).duration(240)} style={style}>
      {children}
    </Animated.View>
  );
}
