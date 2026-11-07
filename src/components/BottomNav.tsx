import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/theme';
import { AppText } from './ui/text';
import { PressableBounce } from './ui/bounce';
import { QuickAddFab } from './QuickAdd';
import { useUiStore } from '@/stores/ui.store';
import type { IconName } from './ui/layout';

/**
 * One-handed primary navigation. Five destinations match the product map
 * (Home · Transactions · Budgets · Insights · More); creating a transaction
 * lives in a raised action button so it is always one tap away without
 * crowding the tab bar.
 */
export function BottomNav() {
  const theme = useTheme();
  const c = theme.m3.color;
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const nativeDrawerOpen = useUiStore((state) => state.nativeDrawerOpen);
  const overlayDrawerOpen = useUiStore((state) => state.drawerOpen);
  const navigation = useNavigation() as unknown as { openDrawer?: () => void };

  const openMore = () => {
    if (typeof navigation.openDrawer === 'function') {
      navigation.openDrawer();
      return;
    }
    useUiStore.getState().openDrawer();
  };

  const inShell =
    pathname === '/' ||
    pathname[0] === '/' && ['/transactions', '/budgets', '/analytics'].some((route) => pathname.startsWith(route));
  const goTab = (href: string) => {
    if (inShell) router.navigate(href as never);
    else router.dismissTo(href as never);
  };

  const tabs: { key: string; label: string; icon: IconName; activeIcon: IconName; active: boolean; onPress: () => void }[] = [
    {
      key: 'home',
      label: 'Home',
      icon: 'home-outline',
      activeIcon: 'home',
      active: pathname === '/' || pathname === '/index',
      onPress: () => goTab('/'),
    },
    {
      key: 'transactions',
      label: 'Transactions',
      icon: 'receipt-outline',
      activeIcon: 'receipt',
      active: pathname.startsWith('/transactions') || pathname.startsWith('/transaction/'),
      onPress: () => goTab('/transactions'),
    },
    {
      key: 'budgets',
      label: 'Budgets',
      icon: 'wallet-outline',
      activeIcon: 'wallet',
      active: pathname.startsWith('/budgets') || pathname.startsWith('/budget/'),
      onPress: () => goTab('/budgets'),
    },
    {
      key: 'insights',
      label: 'Insights',
      icon: 'stats-chart-outline',
      activeIcon: 'stats-chart',
      active: pathname.startsWith('/analytics') || pathname.startsWith('/merchant/') || pathname.startsWith('/category/'),
      onPress: () => goTab('/analytics'),
    },
    {
      key: 'more',
      label: 'More',
      icon: 'grid-outline',
      activeIcon: 'grid',
      active: nativeDrawerOpen || overlayDrawerOpen,
      onPress: openMore,
    },
  ];

  return (
    <>
      <View
        style={{
          position: 'absolute',
          left: theme.spacing.md,
          right: theme.spacing.md,
          bottom: Math.max(insets.bottom, theme.spacing.sm),
          height: theme.m3.size.navBar,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: c.surfaceContainerHigh,
          borderRadius: theme.m3.shape.extraLarge,
          paddingHorizontal: theme.spacing.xs,
          ...theme.shadow('md'),
        }}>
        {tabs.map((tab) => (
          <PressableBounce
            key={tab.key}
            onPress={tab.onPress}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: tab.active }}
            scaleTo={0.94}
            style={{
              flex: 1,
              height: 56,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
            }}>
            <View
              style={{
                width: theme.m3.size.navIndicatorWidth,
                height: theme.m3.size.navIndicatorHeight,
                borderRadius: theme.m3.shape.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: tab.active ? c.secondaryContainer : 'transparent',
              }}>
              <Ionicons
                name={tab.active ? tab.activeIcon : tab.icon}
                size={22}
                color={tab.active ? c.onSecondaryContainer : c.onSurfaceVariant}
              />
            </View>
            <AppText
              variant="labelMedium"
              numberOfLines={1}
              style={{
                fontSize: 11,
                lineHeight: 14,
                color: tab.active ? c.onSecondaryContainer : c.onSurfaceVariant,
              }}>
              {tab.label}
            </AppText>
          </PressableBounce>
        ))}
      </View>

      <QuickAddFab bottomOffset={72} hidden={pathname.startsWith('/transaction/new') || pathname.startsWith('/quick-entry')} />
    </>
  );
}
