import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useNavigation, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/theme';
import { AppText } from './ui/text';
import { PressableBounce } from './ui/bounce';
import { QuickAddSheet } from './QuickAdd';
import type { IconName } from './ui/layout';

/**
 * One-handed bottom navigation for the primary destinations, with the create
 * action in the thumb's natural centre position. "More" opens the full drawer
 * so every other screen stays one gesture away.
 */

export function BottomNav() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const navigation = useNavigation();
  const [addOpen, setAddOpen] = useState(false);

  const openDrawer = () => {
    const nav = navigation as unknown as { openDrawer?: () => void; dispatch?: (action: { type: string }) => void };
    if (typeof nav.openDrawer === 'function') nav.openDrawer();
    else nav.dispatch?.({ type: 'OPEN_DRAWER' });
  };

  const tabs: { key: string; label: string; icon: IconName; activeIcon: IconName; href: string; active: boolean; onPress: () => void }[] = [
    {
      key: 'home',
      label: 'Home',
      icon: 'home-outline',
      activeIcon: 'home',
      href: '/',
      active: pathname === '/' || pathname === '/index',
      onPress: () => router.navigate('/' as never),
    },
    {
      key: 'transactions',
      label: 'Activity',
      icon: 'receipt-outline',
      activeIcon: 'receipt',
      href: '/transactions',
      active: pathname.startsWith('/transactions'),
      onPress: () => router.navigate('/transactions' as never),
    },
    {
      key: 'analytics',
      label: 'Analytics',
      icon: 'stats-chart-outline',
      activeIcon: 'stats-chart',
      href: '/analytics',
      active: pathname.startsWith('/analytics'),
      onPress: () => router.navigate('/analytics' as never),
    },
    {
      key: 'more',
      label: 'More',
      icon: 'grid-outline',
      activeIcon: 'grid',
      href: '',
      active: false,
      onPress: openDrawer,
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
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 6 }}>
      <Ionicons
        name={tab.active ? tab.activeIcon : tab.icon}
        size={21}
        color={tab.active ? theme.colors.accent.base : theme.colors.muted}
      />
      <AppText
        variant="caption"
        style={{
          fontSize: 10,
          color: tab.active ? theme.colors.accent.base : theme.colors.muted,
          fontWeight: tab.active ? '600' : '400',
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
          paddingHorizontal: 6,
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
            accessibilityLabel="Add"
            scaleTo={0.95}
            style={[{ width: 50, height: 50, borderRadius: 25, marginTop: -26 }, theme.shadow('fab')]}>
            <LinearGradient
              colors={[theme.gradient[0], theme.gradient[1]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: '100%', height: '100%', borderRadius: 25, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" size={26} color="#FFFFFF" />
            </LinearGradient>
          </PressableBounce>
        </View>

        {right.map((tab) =>
          tab.key === 'more' ? (
            <Pressable
              key={tab.key}
              onPress={tab.onPress}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              android_ripple={{ color: theme.colors.ripple, borderless: true }}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 6 }}>
              <Ionicons name={tab.icon} size={21} color={theme.colors.muted} />
              <AppText variant="caption" style={{ fontSize: 10, color: theme.colors.muted }}>
                {tab.label}
              </AppText>
            </Pressable>
          ) : (
            renderTab(tab)
          ),
        )}
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
