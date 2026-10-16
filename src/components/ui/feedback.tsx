import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme/theme';
import { useUiStore, type ToastMessage } from '@/stores/ui.store';
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

/**
 * Saving feedback should feel like a receipt being handed to you, not a
 * status bar. Each toast is a card: tone-tinted icon, a bold heading with the
 * muted detail underneath, an Undo pill when the action is reversible, and a
 * countdown line that shows exactly how long it will stay.
 */
export function ToastHost() {
  const theme = useTheme();
  const toasts = useUiStore((state) => state.toasts);
  const dismissToast = useUiStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[
        StyleSheet.absoluteFill,
        { justifyContent: 'flex-end', paddingHorizontal: theme.spacing.lg, paddingBottom: 104, gap: theme.spacing.sm },
      ]}>
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </View>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  const theme = useTheme();
  const reduceMotion = theme.motion.reduceMotion;
  const color =
    toast.tone === 'positive' ? theme.colors.positive : toast.tone === 'negative' ? theme.colors.negative : theme.colors.accent.base;
  const icon = toast.tone === 'positive' ? 'checkmark-circle' : toast.tone === 'negative' ? 'alert-circle' : 'information-circle';

  // The countdown shrinks a hairline under the card so the dismissal never
  // feels abrupt — and Undo toasts visibly run out of time.
  const [barWidth, setBarWidth] = useState(0);
  const progress = useSharedValue(1);
  useEffect(() => {
    progress.value = 1;
    progress.value = withTiming(0, { duration: toast.durationMs, easing: Easing.linear });
  }, [progress, toast.durationMs, toast.id]);
  const barStyle = useAnimatedStyle(() => ({ width: Math.max(0, barWidth * progress.value) }));

  return (
    <Animated.View
      entering={reduceMotion ? undefined : SlideInDown.springify().damping(19).stiffness(230)}
      exiting={FadeOut.duration(150)}>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          backgroundColor: theme.colors.surfaceElevated,
          borderColor: theme.colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: theme.radius.lg,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md + 2,
          overflow: 'hidden',
          ...theme.shadow('md'),
        }}>
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: `${color}1F`,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Ionicons name={icon} size={17} color={color} />
        </View>

        <View style={{ flex: 1, gap: 1 }}>
          {toast.title ? (
            <>
              <AppText variant="bodyMedium" numberOfLines={1}>
                {toast.title}
              </AppText>
              <AppText variant="caption" tone="muted" numberOfLines={2}>
                {toast.text}
              </AppText>
            </>
          ) : (
            <AppText variant="bodyMedium" numberOfLines={2}>
              {toast.text}
            </AppText>
          )}
        </View>

        {toast.actionLabel ? (
          <Pressable
            onPress={() => {
              onDismiss();
              toast.onAction?.();
            }}
            hitSlop={6}
            accessibilityRole="button"
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              height: 32,
              borderRadius: theme.radius.full,
              backgroundColor: theme.colors.accent.soft,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}>
            <AppText variant="captionMedium" tone="accent">
              {toast.actionLabel}
            </AppText>
          </Pressable>
        ) : null}

        {!reduceMotion ? (
          <View
            pointerEvents="none"
            onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 }}>
            <Animated.View style={[{ height: 3, backgroundColor: color, opacity: 0.5 }, barStyle]} />
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
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
