import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { ListGroup, Row, ScrollScreen } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { Button, SettingSwitch } from '@/components/ui/controls';
import { InfoBanner } from '@/components/ui/feedback';
import { BottomSheet, PickerSheet } from '@/components/ui/sheets';
import { PinPad } from '@/security/PinPad';
import { PIN_LENGTH, hashPin, verifyPin } from '@/security/pin';
import { useSettingsStore } from '@/stores/settings.store';
import { useLockStore } from '@/stores/lock.store';
import { toast } from '@/stores/ui.store';

const LOCK_TIMEOUT_OPTIONS = [
  { id: '0', label: 'Immediately', subtitle: 'Lock as soon as the app leaves the screen' },
  { id: '1', label: 'After 1 minute' },
  { id: '5', label: 'After 5 minutes' },
  { id: '15', label: 'After 15 minutes' },
];

function timeoutLabel(minutes: number): string {
  if (minutes <= 0) return 'Immediately';
  if (minutes === 1) return 'After 1 minute';
  return `After ${minutes} minutes`;
}

/**
 * Security & privacy. App lock is real here: enabling it requires a 4-digit
 * PIN (the fallback), biometrics can be layered on top on devices that support
 * them, and the auto-lock timeout is enforced by the root layout.
 */
export default function SecuritySettings() {
  const theme = useTheme();
  const security = useSettingsStore((state) => state.security);
  const update = useSettingsStore((state) => state.update);
  const lock = useLockStore((state) => state.lock);
  const [hardware, setHardware] = useState<{ available: boolean; enrolled: boolean; types: string[] } | null>(null);
  const [pinSheet, setPinSheet] = useState<'none' | 'setup' | 'change'>('none');
  const [timeoutSheet, setTimeoutSheet] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    void (async () => {
      try {
        const LocalAuthentication = await import('expo-local-authentication');
        const [available, enrolled, types] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
          LocalAuthentication.supportedAuthenticationTypesAsync(),
        ]);
        if (!cancelled) {
          setHardware({
            available,
            enrolled,
            types: types.map((type) =>
              type === LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION ? 'Face' : 'Fingerprint',
            ),
          });
        }
      } catch {
        if (!cancelled) setHardware({ available: false, enrolled: false, types: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const disableLock = () => {
    update('security', { appLock: false, biometrics: false, pinHash: null, pinSalt: null });
    useLockStore.getState().unlock();
    toast.show('App lock disabled');
  };

  const enableBiometrics = async (value: boolean) => {
    if (!value) {
      update('security', { biometrics: false });
      return;
    }
    if (Platform.OS === 'web') {
      toast.error('Browsers cannot offer trustworthy biometrics — use the PIN instead.');
      return;
    }
    try {
      const LocalAuthentication = await import('expo-local-authentication');
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirm biometrics for Wallnut' });
      if (!result.success) {
        toast.error('Authentication cancelled');
        return;
      }
      update('security', { biometrics: true });
      toast.success('Biometric unlock enabled');
    } catch {
      toast.error('Biometric authentication unavailable');
    }
  };

  const biometricsSwitchVisible = Platform.OS !== 'web' && Boolean(hardware?.available && hardware?.enrolled);

  return (
    <ScrollScreen>
      <Row gap="sm" style={{ paddingTop: theme.spacing.md, paddingBottom: theme.spacing.lg }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <AppText variant="title">Security & privacy</AppText>
      </Row>

      <View style={{ gap: theme.spacing.lg }}>
        <InfoBanner
          icon="shield-checkmark-outline"
          tone="accent"
          title="Local-first by design"
          message="Your ledger lives in a SQLite database inside this app. There is no account, no server and no analytics — nothing to leak and nothing to sync."
        />

        <ListGroup title="App lock">
          <SettingSwitch
            title="Require unlock to open Wallnut"
            subtitle={
              security.appLock
                ? security.pinHash
                  ? `PIN set${security.biometrics ? ' · biometrics on' : ''}`
                  : 'No PIN set'
                : 'Locks the app on launch and after time in the background'
            }
            value={security.appLock}
            onValueChange={(value) => {
              if (value) {
                setPinSheet('setup');
              } else {
                disableLock();
              }
            }}
          />
          {security.appLock ? (
            <>
              {biometricsSwitchVisible ? (
                <SettingSwitch
                  title="Unlock with biometrics"
                  subtitle={`Uses ${hardware?.types.join(' or ') || 'device biometrics'} · PIN always works as fallback`}
                  value={security.biometrics}
                  onValueChange={enableBiometrics}
                />
              ) : null}
              <Pressable
                onPress={() => setPinSheet('change')}
                android_ripple={{ color: theme.colors.ripple }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: theme.spacing.lg,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.border,
                }}>
                <AppText variant="bodyMedium">Change PIN</AppText>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
              </Pressable>
              <Pressable
                onPress={() => setTimeoutSheet(true)}
                android_ripple={{ color: theme.colors.ripple }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: theme.spacing.lg,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.border,
                }}>
                <View>
                  <AppText variant="bodyMedium">Lock after leaving the app</AppText>
                  <AppText variant="caption" tone="muted">
                    {timeoutLabel(security.lockAfterMinutes)}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
              </Pressable>
              <View style={{ padding: theme.spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
                <Button
                  label="Lock now"
                  variant="secondary"
                  icon="lock-closed-outline"
                  onPress={() => {
                    lock();
                    toast.show('Locked');
                  }}
                />
              </View>
            </>
          ) : null}
        </ListGroup>

        <ListGroup title="Privacy mode">
          <SettingSwitch
            title="Hide all amounts"
            subtitle="Blur every figure to ₹•••• — the eye toggle on Home flips it quickly"
            value={security.hideAmounts}
            onValueChange={(value) => update('security', { hideAmounts: value })}
          />
        </ListGroup>

        <ListGroup title="What Wallnut never does">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            {[
              'No bank logins or account credentials',
              'No cloud sync or remote backup',
              'No transaction data in logs or crash reports',
              'No third-party analytics or advertising SDKs',
            ].map((line) => (
              <Row key={line} gap="sm">
                <Ionicons name="close-circle-outline" size={15} color={theme.colors.muted} />
                <AppText variant="bodySmall" tone="secondary" style={{ flex: 1 }}>
                  {line}
                </AppText>
              </Row>
            ))}
          </View>
        </ListGroup>

        <ListGroup title="Device storage">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
            <AppText variant="caption" tone="muted">
              The database file and any receipts you attach are stored in the app's private storage. Uninstalling the app removes
              them; export a backup first if you want a copy.
            </AppText>
            <Pressable onPress={() => router.push('/data')} hitSlop={8}>
              <AppText variant="captionMedium" tone="accent">
                Go to backup & export →
              </AppText>
            </Pressable>
          </View>
        </ListGroup>
      </View>

      <PinSetupSheet
        mode={pinSheet}
        onClose={() => setPinSheet('none')}
        currentHash={security.pinHash}
        currentSalt={security.pinSalt}
        onSaved={() => {
          setPinSheet('none');
          toast.success('App lock is on');
        }}
      />

      <PickerSheet
        visible={timeoutSheet}
        onClose={() => setTimeoutSheet(false)}
        title="Lock after leaving the app"
        items={LOCK_TIMEOUT_OPTIONS.map((option) => ({ id: option.id, label: option.label, subtitle: option.subtitle }))}
        selectedId={String(security.lockAfterMinutes)}
        onSelect={(item) => {
          update('security', { lockAfterMinutes: Number(item.id) });
          setTimeoutSheet(false);
        }}
      />
    </ScrollScreen>
  );
}

/* ------------------------------- PIN sheet --------------------------------- */

function PinSetupSheet({
  mode,
  onClose,
  currentHash,
  currentSalt,
  onSaved,
}: {
  mode: 'none' | 'setup' | 'change';
  onClose: () => void;
  currentHash: string | null;
  currentSalt: string | null;
  onSaved: () => void;
}) {
  const theme = useTheme();
  const update = useSettingsStore((state) => state.update);
  const [step, setStep] = useState<'current' | 'enter' | 'confirm'>('enter');
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = useCallback(() => {
    setStep(mode === 'change' && currentHash ? 'current' : 'enter');
    setPin('');
    setFirstPin('');
    setError('');
    setBusy(false);
  }, [mode, currentHash]);

  useEffect(() => {
    if (mode !== 'none') reset();
  }, [mode, reset]);

  const finish = useCallback(
    async (candidate: string) => {
      setBusy(true);
      try {
        const { hash, salt } = await hashPin(candidate);
        update('security', { appLock: true, pinHash: hash, pinSalt: salt });
        onSaved();
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Could not save the PIN');
        setBusy(false);
      }
    },
    [onSaved, update],
  );

  const complete = useCallback(
    async (candidate: string) => {
      if (step === 'current') {
        const ok = await verifyPin(candidate, currentHash, currentSalt);
        if (!ok) {
          setError('Incorrect current PIN');
          setPin('');
          return;
        }
        setStep('enter');
        setPin('');
        setError('');
        return;
      }
      if (step === 'enter') {
        setFirstPin(candidate);
        setStep('confirm');
        setPin('');
        setError('');
        return;
      }
      if (candidate !== firstPin) {
        setError('PINs did not match — start again');
        setFirstPin('');
        setStep('enter');
        setPin('');
        return;
      }
      await finish(candidate);
    },
    [currentHash, currentSalt, finish, firstPin, step],
  );

  const handleDigit = (digit: string) => {
    setError('');
    const next = `${pin}${digit}`.slice(0, PIN_LENGTH);
    setPin(next);
    if (next.length === PIN_LENGTH) void complete(next);
  };

  const title = step === 'current' ? 'Enter your current PIN' : step === 'enter' ? 'Choose a 4-digit PIN' : 'Confirm your PIN';

  return (
    <BottomSheet visible={mode !== 'none'} onClose={onClose} title={title}>
      <View style={{ alignItems: 'center', gap: theme.spacing.md, paddingBottom: theme.spacing.md }}>
        <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {step === 'enter'
            ? 'The PIN is stored as a salted hash on this device — it is never written anywhere else.'
            : step === 'confirm'
              ? 'Enter the same PIN once more.'
              : 'Verify it is you before changing the PIN.'}
        </AppText>
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
        <PinPad onDigit={handleDigit} onBackspace={() => setPin((current) => current.slice(0, -1))} disabled={busy} />
      </View>
    </BottomSheet>
  );
}
