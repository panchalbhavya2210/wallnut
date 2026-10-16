import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/theme';
import { AppText } from './ui/text';
import { PressableBounce } from './ui/bounce';
import { QuickAddSheet } from './QuickAdd';
import type { IconName } from './ui/layout';

/**
 * One-handed bottom navigation for the primary destinations, with the create
 * action in the thumb's natural centre position. The full destination drawer
 * stays reachable from the header avatar and the "More" destinations inside it.
 */

export function BottomNav() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [addOpen, setAddOpen] = useState(false);

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
      active: pathname.startsWith('/transactions'),
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
      active: pathname.startsWith('/analytics'),
      onPress: () => router.navigate('/analytics' as never),
    },
  ];

  const left = tabs.slice(0, 2);
  const right = tabs.slice(2);

  const renderTab = (tab: (typeof tabs)[number]) => (
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
        size={22}
        color={tab.active ? theme.colors.accent.base : theme.colors.muted}
      />
      <AppText
        variant="caption"
        style={{
          fontSize: 10,
          color: tab.active ? theme.colors.accent.base : theme.colors.muted,
          fontFamily: tab.active ? theme.typography.captionMedium.fontFamily : theme.typography.caption.fontFamily,
        }}>
        {tab.label}
      </AppText>
    </PressableBounce>
  );

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
          paddingHorizontal: 4,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: theme.colors.surfaceElevated,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
        }}>
        {left.map(renderTab)}

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <PressableBounce
            onPress={() => setAddOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Add transaction"
            scaleTo={0.95}
            style={[{ width: 52, height: 52, borderRadius: 26, marginTop: -28 }, theme.shadow('fab')]}>
            <LinearGradient
              colors={[theme.gradient[0], theme.gradient[1]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: '100%', height: '100%', borderRadius: 26, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" size={28} color="#FFFFFF" />
            </LinearGradient>
          </PressableBounce>
        </View>

        {right.map(renderTab)}
      </View>

      <QuickAddSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onNavigate={(href) => {
          setAddOpen(false);
          setTimeout(() => router.push(href as never), 120);
        }}
      />
    </>
  );
}
