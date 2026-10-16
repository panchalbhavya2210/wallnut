import React, { useEffect, useRef, useState } from 'react';
import { AppState, Image, Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { Stack, router } from 'expo-router';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';

import { bootstrapApp } from '@/db/bootstrap';
import { ThemeProvider, useTheme } from '@/theme/theme';
import { AppText } from '@/components/ui/text';
import { Button } from '@/components/ui/controls';
import { ConfirmHost } from '@/components/ui/confirm';
import { ToastHost } from '@/components/ui/feedback';
import { LockScreen } from '@/security/LockScreen';
import { canUnlock } from '@/security/pin';
import { useLockStore } from '@/stores/lock.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useWidgetAutoRefresh } from '@/widgets/useWidgetAutoRefresh';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    let cancelled = false;
    bootstrapApp()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((bootError: unknown) => {
        if (!cancelled) {
          setError(bootError instanceof Error ? bootError : new Error(String(bootError)));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if ((ready || error) && (fontsLoaded || fontError)) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [ready, error, fontsLoaded, fontError]);

  // Tapping a reminder notification opens the relevant screen.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const href = response.notification.request.content.data?.href;
      if (typeof href === 'string' && href.length > 0) {
        router.push(href as never);
      }
    });
    return () => subscription.remove();
  }, []);

  const showApp = ready && (fontsLoaded || Boolean(fontError));
  const locked = useLockStore((state) => state.locked);
  const appState = useRef(AppState.currentState);
  const backgroundedAt = useRef<number | null>(null);

  // Keep Android home-screen widgets in sync with every ledger/setting change.
  useWidgetAutoRefresh(ready);

  // Lock on launch when the setting is on and there is a way back in.
  useEffect(() => {
    if (!ready) return;
    const security = useSettingsStore.getState().security;
    if (security.appLock && canUnlock(security, Platform.OS === 'web' ? 'web' : 'native')) {
      useLockStore.getState().lock();
    }
  }, [ready]);

  // Auto-lock after time in the background (0 minutes = immediately).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const previous = appState.current;
      appState.current = next;
      if (next === 'background' || next === 'inactive') {
        if (previous === 'active') backgroundedAt.current = Date.now();
        return;
      }
      if (next === 'active' && (previous === 'background' || previous === 'inactive')) {
        const security = useSettingsStore.getState().security;
        const away = backgroundedAt.current ? (Date.now() - backgroundedAt.current) / 60_000 : Number.POSITIVE_INFINITY;
        backgroundedAt.current = null;
        if (security.appLock && away >= security.lockAfterMinutes) {
          useLockStore.getState().lock();
        }
      }
    });
    return () => subscription.remove();
  }, []);

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedStatusBar />
          {error ? (
            <BootError error={error} onRetry={() => setError(null)} />
          ) : showApp ? (
            <>
              <Stack
                screenOptions={{
                  headerShown: false,
                  animation: 'slide_from_right',
                  animationDuration: 220,
                  gestureEnabled: true,
                }}>
                <Stack.Screen name="(app)" options={{ animation: 'fade' }} />
                <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
                <Stack.Screen
                  name="transaction/new"
                  options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
                />
                <Stack.Screen name="transaction/[id]" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen
                  name="quick-entry"
                  options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
                />
                <Stack.Screen name="data" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                <Stack.Screen name="import/[batchId]" options={{ animation: 'slide_from_right' }} />
              </Stack>
              {locked ? <LockScreen /> : null}
              <ToastHost />
              <ConfirmHost />
            </>
          ) : (
            <BootScreen />
          )}
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ThemedStatusBar() {
  const theme = useTheme();
  return <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />;
}

/** Branded loading screen shown while SQLite opens and settings hydrate. */
function BootScreen() {
  const theme = useTheme();
  const mark = theme.mode === 'dark' ? require('../../assets/images/logo-mark-dark.png') : require('../../assets/images/logo-mark-light.png');
  return (
    <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
      <Image source={mark} style={{ width: 84, height: 84 }} resizeMode="contain" />
      <AppText variant="label" tone="muted" style={{ letterSpacing: 3 }}>
        WALLNUT
      </AppText>
    </View>
  );
}

function BootError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.centered, { backgroundColor: theme.colors.background, gap: theme.spacing.lg }]}>
      <View style={[styles.bootMark, { backgroundColor: theme.colors.negativeSoft }]}>
        <AppText variant="headline" style={{ color: theme.colors.negative }}>
          !
        </AppText>
      </View>
      <AppText variant="title" style={{ textAlign: 'center' }}>
        Wallnut couldn't start
      </AppText>
      <AppText variant="bodySmall" tone="muted" style={{ textAlign: 'center', maxWidth: 300 }}>
        {error.message}
      </AppText>
      <Button label="Try again" onPress={onRetry} style={{ alignSelf: 'center', minWidth: 160 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    padding: 24,
  },
  bootMark: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
