import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { AppText } from '@/components/ui/text';
import { Button } from '@/components/ui/controls';
import { useSettingsStore } from '@/stores/settings.store';
import { useLockStore } from '@/stores/lock.store';
import { PIN_LENGTH, verifyPin } from './pin';
import { PinPad } from './PinPad';

/**
 * Full-screen lock overlay. Shown instead of the app whenever the lock is
 * engaged; unlocking keeps the app mounted underneath, so no screen state is
 * lost. Biometrics are attempted once when available, with the PIN as the
 * always-available fallback.
 */
export function LockScreen() {
  const theme = useTheme();
  const security = useSettingsStore((state) => state.security);
  const unlock = useLockStore((state) => state.unlock);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const attemptedRef = useRef(false);

  const tryBiometrics = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'web') return false;
    try {
      const LocalAuthentication = await import('expo-local-authentication');
      const [available, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      const usable = available && enrolled;
      setBiometricsAvailable(usable);
      if (!usable) return false;
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Wallnut' });
      if (result.success) {
        unlock();
        return true;
      }
    } catch {
      setBiometricsAvailable(false);
    }
    return false;
  }, [unlock]);

  // One automatic attempt per lock, then the PIN pad takes over.
  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;
    if (security.biometrics) void tryBiometrics();
  }, [security.biometrics, tryBiometrics]);

  const submit = useCallback(
    async (candidate: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const ok = await verifyPin(candidate, security.pinHash, security.pinSalt);
        if (ok) {
          unlock();
          return;
        }
        setError('Incorrect PIN — try again');
        setPin('');
      } finally {
        setBusy(false);
      }
    },
    [busy, security.pinHash, security.pinSalt, unlock],
  );

  const handleDigit = (digit: string) => {
    setError('');
    const next = `${pin}${digit}`.slice(0, PIN_LENGTH);
    setPin(next);
    if (next.length === PIN_LENGTH) void submit(next);
  };

  const mark =
    theme.mode === 'dark'
      ? require('../../assets/images/logo-mark-dark.png')
      : require('../../assets/images/logo-mark-light.png');

  const hasPin = Boolean(security.pinHash);

  return (
    <View style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: theme.colors.background, zIndex: 100 }]}>
      <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <Image source={mark} style={{ width: 64, height: 64 }} resizeMode="contain" />
        <AppText variant="title">Wallnut is locked</AppText>
        <AppText variant="caption" tone="muted">
          {hasPin ? 'Enter your PIN to continue' : 'Unlock to continue'}
        </AppText>
      </View>

      {hasPin ? (
        <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            {Array.from({ length: PIN_LENGTH }).map((_, index) => (
              <View
                key={index}
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: 7,
                  borderWidth: StyleSheet.hairlineWidth * 2,
                  borderColor: index < pin.length ? theme.colors.accent.base : theme.colors.borderStrong,
                  backgroundColor: index < pin.length ? theme.colors.accent.base : 'transparent',
                }}
              />
            ))}
          </View>
          <AppText variant="caption" tone={error ? 'negative' : 'muted'} style={{ minHeight: 16 }}>
            {error || ' '}
          </AppText>
        </View>
      ) : null}

      {hasPin ? <PinPad onDigit={handleDigit} onBackspace={() => setPin((current) => current.slice(0, -1))} disabled={busy} /> : null}

      <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        {Platform.OS !== 'web' && security.biometrics && biometricsAvailable ? (
          <Pressable onPress={() => void tryBiometrics()} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="finger-print-outline" size={18} color={theme.colors.accent.base} />
            <AppText variant="bodySmall" tone="accent">
              Unlock with biometrics
            </AppText>
          </Pressable>
        ) : null}
        {!hasPin ? <Button label="Unlock" onPress={unlock} style={{ minWidth: 160 }} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
    padding: 24,
  },
});
