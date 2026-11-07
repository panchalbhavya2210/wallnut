import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { AppText } from './ui/text';
import { HeaderMenuButton } from './HeaderMenuButton';

/**
 * The finance-app header: brand or page title on the left, then the search /
 * filter / review actions, and the menu button pinned at the far right. Every
 * primary screen uses the same shape so the app reads as one product instead of
 * a pile of screens, and the drawer is always one tap from the top-right.
 */
export function AppHeader({
  title,
  brand,
  subtitle,
  onSearch,
  reviewCount = 0,
  onFilter,
  right,
  sticky,
}: {
  /** Page title — ignored when `brand` is set. */
  title?: string;
  /** Renders the Wallnut mark + wordmark instead of a title. */
  brand?: boolean;
  subtitle?: string;
  onSearch?: () => void;
  reviewCount?: number;
  onFilter?: () => void;
  right?: React.ReactNode;
  sticky?: boolean;
}) {
  const theme = useTheme();
  const c = theme.m3.color;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        minHeight: theme.m3.size.appBar,
        paddingTop: theme.spacing.sm,
        paddingBottom: theme.spacing.sm,
        ...(sticky ? { backgroundColor: c.surface } : null),
      }}>
      {brand ? (
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Image
            source={theme.mode === 'dark' ? require('../../assets/images/logo-mark-dark.png') : require('../../assets/images/logo-mark-light.png')}
            style={{ width: 28, height: 28 }}
            resizeMode="contain"
          />
          <AppText variant="titleLarge">Wallnut</AppText>
        </View>
      ) : (
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
      )}

      {right}
      {onSearch ? <HeaderAction icon="search-outline" onPress={onSearch} label="Search transactions" /> : null}
      {onFilter ? <HeaderAction icon="options-outline" onPress={onFilter} label="Filters" /> : null}
      <HeaderBell count={reviewCount} />
      <HeaderMenuButton />
    </View>
  );
}

function HeaderAction({ icon, onPress, label }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: theme.colors.ripple, borderless: true }}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: theme.m3.shape.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.colors.pressed : 'transparent',
      })}>
      <Ionicons name={icon} size={24} color={theme.m3.color.onSurface} />
    </Pressable>
  );
}

export function HeaderBell({ count = 0 }: { count?: number }) {
  const theme = useTheme();
  const c = theme.m3.color;
  return (
    <Pressable
      onPress={() => router.push('/review' as never)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `${count} transactions to review` : 'Notifications'}
      android_ripple={{ color: theme.colors.ripple, borderless: true }}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: theme.m3.shape.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.colors.pressed : 'transparent',
      })}>
      <Ionicons name="notifications-outline" size={24} color={c.onSurface} />
      {count > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: 7,
            right: 7,
            minWidth: 17,
            height: 17,
            borderRadius: 9,
            paddingHorizontal: 4,
            backgroundColor: c.error,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <AppText variant="labelSmall" style={{ color: c.onError, fontSize: 10, lineHeight: 12 }}>
            {count > 9 ? '9+' : count}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Primary tabs (Material "primary" tabs): sentence-case labels with a short
 * accent underline for the active destination.
 */
export function TopTabs<T extends string>({
  tabs,
  value,
  onChange,
  style,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  style?: object;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={style}
      contentContainerStyle={{ gap: theme.spacing.xl, paddingRight: theme.spacing.lg }}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            onPress={() => onChange(tab.value)}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            style={{ paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.sm }}>
            <AppText
              variant="bodyMedium"
              style={{
                color: active ? theme.colors.text : theme.colors.muted,
                fontFamily: active ? theme.typography.titleSmall.fontFamily : theme.typography.body.fontFamily,
              }}>
              {tab.label}
            </AppText>
            <View
              style={{
                height: 2.5,
                borderRadius: 2,
                marginTop: 6,
                backgroundColor: active ? theme.colors.accent.base : 'transparent',
              }}
            />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Small circular icon button used by the header-adjacent actions. */
export function RoundIconButton({
  icon,
  onPress,
  label,
  tone = 'neutral',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
  tone?: 'neutral' | 'accent';
}) {
  const theme = useTheme();
  const c = theme.m3.color;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: theme.colors.ripple, borderless: true }}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: theme.m3.shape.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tone === 'accent' ? c.primaryContainer : c.surfaceContainerHigh,
        opacity: pressed ? 0.7 : 1,
      })}>
      <Ionicons name={icon} size={22} color={tone === 'accent' ? c.onPrimaryContainer : c.onSurfaceVariant} />
    </Pressable>
  );
}
