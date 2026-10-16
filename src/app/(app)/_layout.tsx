import React from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { Drawer } from 'expo-router/drawer';

import { useTheme } from '@/theme/theme';
import { useSettingsStore } from '@/stores/settings.store';
import { useBootstrapStore } from '@/stores/bootstrap.store';
import { toast } from '@/stores/ui.store';
import { WallnutDrawerContent } from '@/components/DrawerContent';
import { BottomNav } from '@/components/BottomNav';

/**
 * Top-level shell: a one-handed bottom navigation bar for the primary
 * destinations (with the create action in the centre), plus the full searchable
 * drawer behind "More" and the header menu. Detail screens are pushed on the
 * root stack above this shell (so they get a back chevron instead of a
 * hamburger).
 */
export default function AppLayout() {
  const onboarded = useSettingsStore((state) => state.general.onboarded);
  const theme = useTheme();

  // Tell the user when the app posted scheduled payments on launch — the local
  // equivalent of a “payment processed” notification.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      const { postedRecurring, postedInstallments, recurringTotal, notified, markNotified } = useBootstrapStore.getState();
      if (notified || (postedRecurring === 0 && postedInstallments === 0)) return;
      markNotified();
      const parts: string[] = [];
      if (postedRecurring > 0) {
        parts.push(
          `${postedRecurring} recurring payment${postedRecurring === 1 ? '' : 's'} posted · ₹${(recurringTotal / 100).toLocaleString('en-IN')}`,
        );
      }
      if (postedInstallments > 0) parts.push(`${postedInstallments} installment${postedInstallments === 1 ? '' : 's'} posted`);
      toast.show(parts.join(' · '));
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  if (!onboarded) return <Redirect href="/onboarding" />;

  return (
    <>
      <Drawer
        drawerContent={(props) => <WallnutDrawerContent {...props} />}
        screenLayout={({ children }) => (
          <View style={{ flex: 1 }}>
            {children}
            <BottomNav />
          </View>
        )}
        screenOptions={{
          headerShown: false,
          drawerType: 'front',
          swipeEnabled: true,
          swipeEdgeWidth: 56,
          overlayColor: theme.mode === 'dark' ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.42)',
          drawerStyle: { width: 316, backgroundColor: theme.colors.surface },
          sceneStyle: { backgroundColor: theme.colors.background },
        }}>
        <Drawer.Screen name="index" options={{ title: 'Home' }} />
        <Drawer.Screen name="transactions" options={{ title: 'Transactions' }} />
        <Drawer.Screen name="analytics" options={{ title: 'Analytics' }} />
      </Drawer>
    </>
  );
}
