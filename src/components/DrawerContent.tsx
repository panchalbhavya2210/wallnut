import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDrawerStatus, type DrawerContentComponentProps } from 'expo-router/drawer';

import { useTheme, type Theme } from '@/theme/theme';
import { AppText } from './ui/text';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { getNetWorthSummary } from '@/services/analytics.service';
import { useSettingsStore } from '@/stores/settings.store';
import type { IconName } from './ui/layout';

/**
 * Drawer menu — the app's navigation hub. A searchable, grouped index of every
 * destination, with the net-worth summary pinned at the top. Registered drawer
 * screens navigate in place; everything else pushes onto the root stack.
 */

interface Destination {
  label: string;
  detail?: string;
  icon: IconName;
  /** Drawer screen name (navigates in place) or href (pushes). */
  screen?: string;
  href?: string;
  keywords: string;
}

interface DestinationGroup {
  title: string;
  items: Destination[];
}

const GROUPS: DestinationGroup[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Home', detail: 'Dashboard & insights', icon: 'home-outline', screen: 'index', keywords: 'home dashboard widgets' },
      { label: 'Transactions', detail: 'Search, filter, edit', icon: 'receipt-outline', screen: 'transactions', keywords: 'records ledger history search' },
      { label: 'Analytics', detail: 'Charts, trends, categories', icon: 'stats-chart-outline', screen: 'analytics', keywords: 'charts stats reports insights' },
    ],
  },
  {
    title: 'Financial',
    items: [
      { label: 'Accounts', icon: 'wallet-outline', href: '/accounts', keywords: 'balance bank cash credit card wallet groups reconcile' },
      { label: 'Budgets', icon: 'pie-chart-outline', href: '/budgets', keywords: 'limits spending safe to spend category' },
      { label: 'Goals', icon: 'flag-outline', href: '/goals', keywords: 'savings target contribute' },
      { label: 'Money owed', icon: 'people-outline', href: '/debts', keywords: 'lending debt loan borrowed person owed' },
      { label: 'Shared expenses', icon: 'people-circle-outline', href: '/shared', keywords: 'split splitwise group trip settle share bill' },
      { label: 'Recurring & subscriptions', icon: 'repeat-outline', href: '/recurring', keywords: 'bills planned payments subscription salary rent' },
      { label: 'Installments', icon: 'layers-outline', href: '/installments', keywords: 'emi monthly charges split purchase' },
      { label: 'Investments', icon: 'trending-up-outline', href: '/investments', keywords: 'portfolio stocks mutual funds gains' },
      { label: 'Shopping lists', icon: 'basket-outline', href: '/shopping', keywords: 'groceries shopping items prices list record' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { label: 'Financial Inbox', detail: 'What needs your attention', icon: 'mail-unread-outline', href: '/inbox', keywords: 'inbox attention review duplicates subscriptions suggestions unrestored' },
      { label: 'Financial Intelligence', detail: 'Ask about your money', icon: 'sparkles-outline', href: '/ai', keywords: 'ai assistant deepseek ask question intelligence' },
      { label: 'Calendar', icon: 'calendar-outline', href: '/calendar', keywords: 'day month schedule bills' },
      { label: 'Category trends', detail: 'Month-on-month by category', icon: 'bar-chart-outline', href: '/category-trends', keywords: 'category month over month monthly compare trends spending growth' },
      { label: 'Reports', icon: 'document-text-outline', href: '/reports', keywords: 'cash flow monthly review health summary' },
      { label: 'Transaction rules', icon: 'git-branch-outline', href: '/rules', keywords: 'automation categorise rules' },
      { label: 'Quick templates', icon: 'flash-outline', href: '/templates', keywords: 'reuse frequent transaction shortcut' },
      { label: 'Tags', icon: 'pricetags-outline', href: '/tags', keywords: 'labels trip work tax' },
      { label: 'Merchants', icon: 'storefront-outline', href: '/merchants', keywords: 'aliases stores names' },
      { label: 'Import & export', icon: 'swap-vertical-outline', href: '/data', keywords: 'backup restore csv json data export' },
    ],
  },
  {
    title: 'App',
    items: [
      { label: 'Settings', icon: 'settings-outline', href: '/settings', keywords: 'appearance finance notifications security about preferences' },
      { label: 'Review queue', icon: 'checkmark-done-outline', href: '/review', keywords: 'needs review duplicates uncategorised' },
    ],
  },
];

export function WallnutDrawerContent(props: DrawerContentComponentProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const money = useMoney();
  const [search, setSearch] = useState('');
  const userName = useSettingsStore((state) => state.general.userName);

  // Opening the drawer re-renders this whole tree (the drawer's open/closed
  // state lives in navigation state). The net-worth query is the only real
  // work here, so it is skipped entirely while the drawer is closed — on a
  // long-lived Android session that DB hop during the open animation was what
  // made the menu feel slow.
  const drawerStatus = useDrawerStatus();
  const summaryRef = useRef<{ netWorth: number; count: number } | null>(null);
  const summary = useQuery(async () => {
    if (drawerStatus !== 'open') return summaryRef.current;
    const netWorth = await getNetWorthSummary();
    const next = { netWorth: netWorth.netWorth, count: netWorth.accounts.length };
    summaryRef.current = next;
    return next;
  }, [drawerStatus]);

  const activeRouteName = props.state.routeNames[props.state.index];
  const { navigate, closeDrawer } = props.navigation;

  const query = search.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!query) return GROUPS;
    return GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.label.toLowerCase().includes(query) ||
          (item.detail ?? '').toLowerCase().includes(query) ||
          item.keywords.includes(query),
      ),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  const go = useCallback(
    (destination: Destination) => {
      if (destination.screen) {
        navigate(destination.screen as never);
        closeDrawer();
        return;
      }
      if (destination.href) {
        const href = destination.href;
        closeDrawer();
        setTimeout(() => router.push(href as never), 160);
      }
    },
    [navigate, closeDrawer],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface, paddingTop: insets.top }}>
      {/* Brand + net worth summary */}
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg, gap: theme.spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Image
              source={theme.mode === 'dark' ? require('../../assets/images/logo-mark-dark.png') : require('../../assets/images/logo-mark-light.png')}
              style={{ width: 32, height: 32 }}
              resizeMode="contain"
            />
            <View>
              <AppText variant="titleSmall">Wallnut</AppText>
              <AppText variant="caption" tone="muted">
                {userName ? `Signed for ${userName}` : 'Local-first finance'}
              </AppText>
            </View>
          </View>
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: theme.radius.full,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.borderStrong,
            }}>
            <AppText variant="caption" tone="muted" style={{ fontSize: 10, letterSpacing: 0.6 }}>
              BETA
            </AppText>
          </View>
        </View>

        <Pressable
          onPress={() => go({ label: 'Accounts', icon: 'wallet-outline', href: '/accounts', keywords: '' })}
          android_ripple={{ color: theme.colors.ripple }}
          style={({ pressed }) => ({
            padding: theme.spacing.lg,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.accent.soft,
            opacity: pressed ? 0.85 : 1,
            gap: 4,
          })}>
          <AppText variant="caption" tone="secondary">
            Net worth
          </AppText>
          <AppText variant="numericMedium">{money.format(summary.data?.netWorth ?? 0)}</AppText>
          <AppText variant="caption" tone="muted">
            {summary.data
              ? `${summary.data.count} account${summary.data.count === 1 ? '' : 's'} · tap to manage`
              : 'Opening your ledger…'}
          </AppText>
        </Pressable>
      </View>

      {/* Search */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          marginHorizontal: theme.spacing.lg,
          marginTop: theme.spacing.lg,
          backgroundColor: theme.colors.inputBackground,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          paddingHorizontal: theme.spacing.md,
          height: 42,
        }}>
        <Ionicons name="search-outline" size={16} color={theme.colors.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search settings & tools"
          placeholderTextColor={theme.colors.muted}
          autoCorrect={false}
          style={{ flex: 1, color: theme.colors.text, fontFamily: theme.typography.body.fontFamily, fontSize: 15, paddingVertical: 0 }}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={theme.colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        style={{ flex: 1, marginTop: theme.spacing.sm }}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.md, paddingBottom: insets.bottom + theme.spacing.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {groups.map((group) => (
          <View key={group.title} style={{ marginBottom: theme.spacing.md }}>
            <AppText
              variant="label"
              tone="muted"
              style={{ marginLeft: theme.spacing.md, marginTop: theme.spacing.sm, marginBottom: theme.spacing.xs }}>
              {group.title.toUpperCase()}
            </AppText>
            {group.items.map((destination) => (
              <DrawerRow
                key={destination.label}
                destination={destination}
                focused={destination.screen !== undefined && destination.screen === activeRouteName}
                theme={theme}
                onPress={go}
              />
            ))}
          </View>
        ))}

        {groups.length === 0 ? (
          <View style={{ alignItems: 'center', padding: theme.spacing.xxl, gap: 6 }}>
            <Ionicons name="search-outline" size={20} color={theme.colors.muted} />
            <AppText variant="caption" tone="muted">
              Nothing matches “{search}”.
            </AppText>
          </View>
        ) : null}

        <View style={{ alignItems: 'center', gap: 2, paddingTop: theme.spacing.md }}>
          <AppText variant="caption" tone="muted">
            Wallnut · beta
          </AppText>
          <AppText variant="caption" tone="muted" style={{ opacity: 0.7 }}>
            Your data never leaves this device.
          </AppText>
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * One destination row. Memoized: re-rendering ~50 rows inside the open
 * animation was the other half of the slow drawer.
 */
const DrawerRow = React.memo(function DrawerRow({
  destination,
  focused,
  theme,
  onPress,
}: {
  destination: Destination;
  focused: boolean;
  theme: Theme;
  onPress: (destination: Destination) => void;
}) {
  const tint = focused ? theme.colors.accent.base : theme.colors.textSecondary;
  return (
    <Pressable
      onPress={() => onPress(destination)}
      android_ripple={{ color: theme.colors.ripple }}
      accessibilityRole="button"
      accessibilityLabel={destination.label}
      accessibilityState={{ selected: focused }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 11,
        paddingHorizontal: 12,
        borderRadius: theme.radius.md,
        backgroundColor: focused ? theme.colors.accent.soft : pressed ? theme.colors.pressed : 'transparent',
      })}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: theme.radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: focused ? `${theme.colors.accent.base}26` : theme.colors.neutralSoft,
        }}>
        <Ionicons name={destination.icon} size={18} color={tint} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <AppText variant="bodyMedium" tone={focused ? 'accent' : 'primary'} numberOfLines={1}>
          {destination.label}
        </AppText>
        {destination.detail ? (
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {destination.detail}
          </AppText>
        ) : null}
      </View>
      {focused ? <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: theme.colors.accent.base }} /> : null}
    </Pressable>
  );
});
