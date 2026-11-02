import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation, usePathname } from 'expo-router';
import { useDrawerStatus } from 'expo-router/drawer';
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
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const drawerStatus = useDrawerStatus();
  const navigation = useNavigation() as unknown as { openDrawer?: () => void };

  const openMore = () => {
    if (typeof navigation.openDrawer === 'function') {
      navigation.openDrawer();
      return;
    }
    useUiStore.getState().openDrawer();
  };

  const tabs: { key: string; label: string; icon: IconName; activeIcon: IconName; active: boolean; onPress: () => void }[] = [
    {
      key: 'home',
      label: 'Home',
      icon: 'home-outline',
      activeIcon: 'home',
      active: pathname === '/' || pathname === '/index',
      onPress: () => router.navigate('/' as never),
    },
    {
      key: 'transactions',
      label: 'Transactions',
      icon: 'receipt-outline',
      activeIcon: 'receipt',
      active: pathname.startsWith('/transactions') || pathname.startsWith('/transaction/'),
      onPress: () => router.navigate('/transactions' as never),
    },
    {
      key: 'budgets',
      label: 'Budgets',
      icon: 'wallet-outline',
      activeIcon: 'wallet',
      active: pathname.startsWith('/budgets') || pathname.startsWith('/budget/'),
      onPress: () => router.navigate('/budgets' as never),
    },
    {
      key: 'insights',
      label: 'Insights',
      icon: 'stats-chart-outline',
      activeIcon: 'stats-chart',
      active: pathname.startsWith('/analytics') || pathname.startsWith('/merchant/') || pathname.startsWith('/category/'),
      onPress: () => router.navigate('/analytics' as never),
    },
    {
      key: 'more',
      label: 'More',
      icon: 'grid-outline',
      activeIcon: 'grid',
      active: drawerStatus === 'open',
      onPress: openMore,
    },
  ];

  return (
    <>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 6,
          paddingHorizontal: 2,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: theme.colors.surfaceTranslucent,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
        }}>
        {tabs.map((tab) => (
          <PressableBounce
            key={tab.key}
            onPress={tab.onPress}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: tab.active }}
            scaleTo={0.96}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 6 }}>
            <Ionicons
              name={tab.active ? tab.activeIcon : tab.icon}
              size={21}
              color={tab.active ? theme.colors.accent.base : theme.colors.muted}
            />
            <AppText
              variant="caption"
              numberOfLines={1}
              style={{
                fontSize: 10,
                color: tab.active ? theme.colors.accent.base : theme.colors.muted,
                fontFamily: tab.active ? theme.typography.captionMedium.fontFamily : theme.typography.caption.fontFamily,
              }}>
              {tab.label}
            </AppText>
          </PressableBounce>
        ))}
      </View>

      <QuickAddFab bottomOffset={48} />
    </>
  );
}
