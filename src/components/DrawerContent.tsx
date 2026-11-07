import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDrawerStatus, type DrawerContentComponentProps } from 'expo-router/drawer';

import { useTheme, type Theme } from '@/theme/theme';
import { AppText } from './ui/text';
import { useMoney } from '@/hooks/useMoney';
import { getNetWorthSummary } from '@/services/analytics.service';
import { useDbStore } from '@/stores/db.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useUiStore } from '@/stores/ui.store';
import type { IconName } from './ui/layout';

/**
 * Drawer menu — the app's navigation hub. A searchable, grouped index of every
 * destination, with the net-worth summary pinned at the top. It is shared by
 * the in-shell drawer and the root-level overlay (see GlobalDrawer), so pushed
 * screens get the same menu without losing their place in the stack.
 */

export interface DrawerDestination {
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
  items: DrawerDestination[];
}

const GROUPS: DestinationGroup[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Home', detail: 'Balance, actions and recent activity', icon: 'home-outline', screen: 'index', href: '/', keywords: 'home dashboard widgets overview' },
      { label: 'Transactions', detail: 'Full ledger, search and filters', icon: 'receipt-outline', screen: 'transactions', href: '/transactions', keywords: 'records ledger history search' },
      { label: 'Budgets', detail: 'Category limits and pace', icon: 'pie-chart-outline', screen: 'budgets', href: '/budgets', keywords: 'limits spending safe to spend category' },
      { label: 'Insights', detail: 'Spending, categories and merchants', icon: 'stats-chart-outline', screen: 'analytics', href: '/analytics', keywords: 'charts stats reports insights analytics trends merchants' },
    ],
  },
  {
    title: 'Money',
    items: [
      { label: 'Accounts', icon: 'wallet-outline', href: '/accounts', keywords: 'balance bank cash credit card wallet groups reconcile' },
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
    title: 'Understand',
    items: [
      { label: 'Categories', icon: 'pricetag-outline', href: '/categories', keywords: 'category name colour icon budget uncategorised' },
      { label: 'Merchant names', detail: 'Clean up how banks write shops', icon: 'storefront-outline', href: '/merchants', keywords: 'merchants aliases stores names normalise' },
      { label: 'Category trends', detail: 'Month-on-month by category', icon: 'bar-chart-outline', href: '/category-trends', keywords: 'category month over month monthly compare trends spending growth' },
      { label: 'Reports', icon: 'document-text-outline', href: '/reports', keywords: 'cash flow monthly review health summary' },
      { label: 'Financial Inbox', detail: 'What needs your attention', icon: 'mail-unread-outline', href: '/inbox', keywords: 'inbox attention review duplicates subscriptions suggestions unrestored' },
      { label: 'Review queue', icon: 'checkmark-done-outline', href: '/review', keywords: 'needs review duplicates uncategorised' },
      { label: 'Calendar', icon: 'calendar-outline', href: '/calendar', keywords: 'day month schedule bills' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { label: 'Import & export', detail: 'CSV, JSON and backups', icon: 'swap-vertical-outline', href: '/data', keywords: 'backup restore csv json data export' },
      { label: 'Transaction rules', icon: 'git-branch-outline', href: '/rules', keywords: 'automation categorise rules' },
      { label: 'Quick templates', icon: 'flash-outline', href: '/templates', keywords: 'reuse frequent transaction shortcut' },
      { label: 'Tags', icon: 'pricetags-outline', href: '/tags', keywords: 'labels trip work tax' },
      { label: 'Financial Intelligence', detail: 'Ask about your money', icon: 'sparkles-outline', href: '/ai', keywords: 'ai assistant deepseek ask question intelligence' },
    ],
  },
  {
    title: 'App',
    items: [
      { label: 'Settings', icon: 'settings-outline', href: '/settings', keywords: 'appearance finance notifications security about preferences' },
      { label: 'Help & feedback', icon: 'help-circle-outline', href: '/settings/about', keywords: 'help about feedback version support' },
    ],
  },
];

function isFocused(destination: DrawerDestination, pathname: string): boolean {
  if (!destination.href) return false;
  if (destination.href === '/') return pathname === '/' || pathname === '/index';
  return pathname === destination.href || pathname.startsWith(`${destination.href}/`);
}

interface DrawerSummary {
  netWorth: number;
  count: number;
}

/**
 * The drawer's net-worth snapshot is prefetched while the app is idle and kept
 * warm across drawer opens. Opening the drawer must never start a database
 * query: on Android that query ran on the JS thread during the slide animation,
 * which is exactly what made the menu feel delayed.
 */
let drawerSummary: DrawerSummary | null = null;
let drawerSummaryRequest: Promise<DrawerSummary> | null = null;

function loadDrawerSummary(): Promise<DrawerSummary> {
  if (drawerSummaryRequest) return drawerSummaryRequest;
  drawerSummaryRequest = getNetWorthSummary()
    .then((summary) => {
      drawerSummary = { netWorth: summary.netWorth, count: summary.accounts.length };
      return drawerSummary;
    })
    .finally(() => {
      drawerSummaryRequest = null;
    });
  return drawerSummaryRequest;
}

function useDrawerSummary(active: boolean): DrawerSummary | null {
  const revision = useDbStore((state) => state.revision);
  const [summary, setSummary] = useState<DrawerSummary | null>(drawerSummary);

  useEffect(() => {
    // While the menu is open, never start a database query: a write elsewhere
    // must not turn into jank in the middle of the slide. Refresh happens while
    // the drawer is closed and idle instead.
    if (active && drawerSummary) return;
    let cancelled = false;
    const delay = active ? 0 : 450;
    const timer = setTimeout(() => {
      void loadDrawerSummary()
        .then((next) => {
          if (!cancelled) setSummary(next);
        })
        .catch(() => undefined);
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, revision]);

  return summary;
}

export function DrawerMenu({
  active,
  onNavigate,
}: {
  active: boolean;
  onNavigate: (destination: DrawerDestination) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const money = useMoney();
  const pathname = usePathname();
  const [search, setSearch] = useState('');
  const userName = useSettingsStore((state) => state.general.userName);
  const summary = useDrawerSummary(active);
  const c = theme.m3.color;

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

  return (
    <View style={{ flex: 1, backgroundColor: c.surfaceContainerLow, paddingTop: insets.top }}>
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
              <AppText variant="titleLarge">Wallnut</AppText>
              <AppText variant="bodyMedium" tone="muted">
                {userName ? `Signed for ${userName}` : 'Local-first finance'}
              </AppText>
            </View>
          </View>
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: theme.m3.shape.full,
              borderWidth: 1,
              borderColor: c.outlineVariant,
            }}>
            <AppText variant="labelSmall" tone="muted">
              V1.0
            </AppText>
          </View>
        </View>

        <Pressable
          onPress={() => onNavigate({ label: 'Accounts', icon: 'wallet-outline', href: '/accounts', keywords: '' })}
          android_ripple={{ color: theme.colors.ripple }}
          style={({ pressed }) => ({
            padding: theme.spacing.lg,
            borderRadius: theme.m3.shape.extraLarge,
            backgroundColor: c.primaryContainer,
            opacity: pressed ? 0.9 : 1,
            gap: 4,
          })}>
          <AppText variant="labelMedium" style={{ color: c.onPrimaryContainer, opacity: 0.8 }}>
            Net worth
          </AppText>
          <AppText variant="headlineMedium" style={{ color: c.onPrimaryContainer }}>
            {summary ? money.format(summary.netWorth) : '—'}
          </AppText>
          <AppText variant="bodyMedium" style={{ color: c.onPrimaryContainer, opacity: 0.8 }}>
            {summary
              ? `${summary.count} account${summary.count === 1 ? '' : 's'} · tap to manage`
              : 'Preparing your summary…'}
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
          backgroundColor: c.surfaceContainerHigh,
          borderRadius: theme.m3.shape.full,
          paddingHorizontal: theme.spacing.md,
          height: theme.m3.size.searchBar,
        }}>
        <Ionicons name="search" size={22} color={c.onSurfaceVariant} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search settings & tools"
          placeholderTextColor={c.onSurfaceVariant}
          autoCorrect={false}
          style={{ flex: 1, color: c.onSurface, fontFamily: theme.typography.bodyLarge.fontFamily, fontSize: theme.typography.bodyLarge.fontSize, paddingVertical: 0 }}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={20} color={c.onSurfaceVariant} />
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
              variant="titleSmall"
              tone="muted"
              style={{ marginLeft: theme.spacing.md, marginTop: theme.spacing.sm, marginBottom: theme.spacing.xs }}>
              {group.title}
            </AppText>
            {group.items.map((destination) => (
              <DrawerRow
                key={destination.label}
                destination={destination}
                focused={isFocused(destination, pathname)}
                theme={theme}
                onPress={onNavigate}
              />
            ))}
          </View>
        ))}

        {groups.length === 0 ? (
          <View style={{ alignItems: 'center', padding: theme.spacing.xxl, gap: 6 }}>
            <Ionicons name="search" size={20} color={c.onSurfaceVariant} />
            <AppText variant="bodyMedium" tone="muted">
              Nothing matches “{search}”.
            </AppText>
          </View>
        ) : null}

        <View style={{ alignItems: 'center', gap: 2, paddingTop: theme.spacing.md }}>
          <AppText variant="labelSmall" tone="muted">
            Wallnut · v1.0
          </AppText>
          <AppText variant="labelSmall" tone="muted" style={{ opacity: 0.7 }}>
            Your data never leaves this device.
          </AppText>
        </View>
      </ScrollView>
    </View>
  );
}

/** Routes that live inside the drawer shell (not pushed on the root stack). */
const DRAWER_SHELL_ROUTES = new Set(['/', '/transactions', '/budgets', '/analytics']);

export function WallnutDrawerContent(props: DrawerContentComponentProps) {
  const status = useDrawerStatus();
  const pathname = usePathname();
  const { navigate, closeDrawer } = props.navigation;

  useEffect(() => {
    useUiStore.getState().setNativeDrawerOpen(status === 'open');
    return () => useUiStore.getState().setNativeDrawerOpen(false);
  }, [status]);

  const go = useCallback(
    (destination: DrawerDestination) => {
      if (destination.screen) {
        navigate(destination.screen as never);
        closeDrawer();
        return;
      }
      if (!destination.href) return;
      closeDrawer();
      if (pathname === destination.href) return;
      if (DRAWER_SHELL_ROUTES.has(destination.href)) {
        // Switch the tab and drop any pushed screens above the shell.
        router.dismissTo(destination.href as never);
        return;
      }
      // Pushed page (Settings, Accounts, …). `navigate` reuses an existing
      // instance instead of stacking duplicates; crucially it does NOT replace
      // the dashboard, so Android back always has somewhere to return to.
      router.navigate(destination.href as never);
    },
    [navigate, closeDrawer, pathname],
  );

  return <DrawerMenu active={status === 'open'} onNavigate={go} />;
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
  destination: DrawerDestination;
  focused: boolean;
  theme: Theme;
  onPress: (destination: DrawerDestination) => void;
}) {
  const c = theme.m3.color;
  const tint = focused ? c.onSecondaryContainer : c.onSurfaceVariant;
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
        minHeight: 56,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: theme.m3.shape.full,
        backgroundColor: focused ? c.secondaryContainer : pressed ? theme.colors.pressed : 'transparent',
      })}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: theme.m3.shape.full,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: focused ? 'transparent' : c.surfaceContainerHigh,
        }}>
        <Ionicons name={destination.icon} size={22} color={tint} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <AppText variant="titleSmall" style={{ color: focused ? c.onSecondaryContainer : c.onSurface }} numberOfLines={1}>
          {destination.label}
        </AppText>
        {destination.detail ? (
          <AppText variant="bodyMedium" style={{ color: focused ? c.onSecondaryContainer : c.onSurfaceVariant, opacity: focused ? 0.8 : 1 }} numberOfLines={1}>
            {destination.detail}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
});
