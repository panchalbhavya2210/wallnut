import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/theme';
import { BottomSheet } from '@/components/ui/sheets';
import { AppText } from '@/components/ui/text';
import { Row } from '@/components/ui/layout';
import { PressableBounce } from '@/components/ui/bounce';

/**
 * Floating add button + quick-add sheet. Lives in the app layout so it is
 * available from every top-level screen.
 */

const PRIMARY_ACTIONS = [
  { label: 'Expense', icon: 'arrow-up-circle-outline' as const, href: '/transaction/new?type=expense', tintKey: 'negative' as const },
  { label: 'Income', icon: 'arrow-down-circle-outline' as const, href: '/transaction/new?type=income', tintKey: 'positive' as const },
  { label: 'Transfer', icon: 'swap-horizontal-outline' as const, href: '/transaction/new?type=transfer', tintKey: 'accent' as const },
];

const SECONDARY_ACTIONS = [
  { label: 'Lend money', subtitle: 'Track money someone owes you', icon: 'person-add-outline' as const, href: '/debt/new?direction=lent' },
  { label: 'Borrow money', subtitle: 'Track money you owe someone', icon: 'person-remove-outline' as const, href: '/debt/new?direction=borrowed' },
  { label: 'Shared expense', subtitle: 'Split a bill and track who owes whom', icon: 'people-circle-outline' as const, href: '/shared/expense/new' },
  { label: 'Goal contribution', subtitle: 'Move money toward a savings goal', icon: 'flag-outline' as const, href: '/goals?action=contribute' },
  { label: 'Balance adjustment', subtitle: 'Correct an account balance', icon: 'options-outline' as const, href: '/adjust' },
  { label: 'Quick templates', subtitle: 'Reuse a frequent transaction', icon: 'flash-outline' as const, href: '/templates' },
];

export function QuickAddFab() {  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  return (
    <>
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <PressableBounce
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Add transaction"
          scaleTo={0.95}
          style={[
            styles.fab,
            {
              right: Math.max(insets.right, 16) + 4,
              bottom: Math.max(insets.bottom, 12) + 14,
            },
            theme.shadow('fab'),
          ]}>
          <LinearGradient
            colors={[theme.gradient[0], theme.gradient[1]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.fabInner}>
            <Ionicons name="add" size={30} color="#FFFFFF" />
          </LinearGradient>
        </PressableBounce>
      </View>
      <QuickAddSheet
        visible={open}
        onClose={() => setOpen(false)}
        onNavigate={(href) => {
          setOpen(false);
          setTimeout(() => router.push(href as never), 120);
        }}
      />
    </>
  );
}

export function QuickAddSheet({
  visible,
  onClose,
  onNavigate,
}: {
  visible: boolean;
  onClose: () => void;
  onNavigate: (href: string) => void;
}) {
  const theme = useTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose} title="New">
      <View style={{ gap: theme.spacing.sm }}>
        <Pressable
          onPress={() => onNavigate('/quick-entry')}
          accessibilityRole="button"
          accessibilityLabel="Ask Wallnut quick entry"
          android_ripple={{ color: theme.colors.ripple }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            padding: theme.spacing.lg,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.accent.soft,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: `${theme.colors.accent.base}44`,
            opacity: pressed ? 0.8 : 1,
          })}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.accent.base,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Ionicons name="sparkles" size={20} color={theme.colors.accent.on} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyMedium" tone="accent">
              Ask Wallnut
            </AppText>
            <AppText variant="caption" tone="muted">
              “Spent 450 at Zomato” — AI interprets, you confirm
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.accent.base} />
        </Pressable>

        <Row gap="sm">
          {PRIMARY_ACTIONS.map((action) => {
            const tint =
              action.tintKey === 'negative'
                ? theme.colors.negative
                : action.tintKey === 'positive'
                  ? theme.colors.positive
                  : theme.colors.accent.base;
            return (
              <Pressable
                key={action.label}
                onPress={() => onNavigate(action.href)}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                android_ripple={{ color: theme.colors.ripple }}
                style={({ pressed }) => ({
                  flex: 1,
                  alignItems: 'center',
                  gap: 8,
                  paddingVertical: theme.spacing.lg,
                  borderRadius: theme.radius.lg,
                  backgroundColor: `${tint}14`,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: `${tint}44`,
                  opacity: pressed ? 0.75 : 1,
                })}>
                <Ionicons name={action.icon} size={24} color={tint} />
                <AppText variant="bodySmall" style={{ color: tint }}>
                  {action.label}
                </AppText>
              </Pressable>
            );
          })}
        </Row>

        <View style={{ marginTop: theme.spacing.md }}>
          {SECONDARY_ACTIONS.map((action, index) => (
            <Pressable
              key={action.label}
              onPress={() => onNavigate(action.href)}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                paddingVertical: theme.spacing.md,
                borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: theme.colors.border,
                opacity: pressed ? 0.7 : 1,
              })}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.neutralSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Ionicons name={action.icon} size={18} color={theme.colors.textSecondary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="bodyMedium">{action.label}</AppText>
                <AppText variant="caption" tone="muted">
                  {action.subtitle}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
            </Pressable>
          ))}
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  fabInner: {
    width: '100%',
    height: '100%',
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
