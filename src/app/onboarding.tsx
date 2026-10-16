import React, { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Screen } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { Button, Chip } from '@/components/ui/controls';
import { Field } from '@/components/ui/sheets';
import { ACCOUNT_TYPE_LABELS, createAccount } from '@/services/accounts.service';
import { seedDefaultCategories } from '@/services/categories.service';
import { seedDefaultMerchantAliases } from '@/services/merchant.service';
import { seedDefaultDashboardWidgets } from '@/services/seed.service';
import { useSettingsStore } from '@/stores/settings.store';
import { toast } from '@/stores/ui.store';
import { CURRENCIES, type CurrencyCode } from '@/utils/money';
import type { AccountType } from '@/db/schema';

/**
 * First launch: currency → name → first account → done. Deliberately short —
 * every later decision has a sane default and can be changed in Settings.
 */
export default function OnboardingScreen() {
  const theme = useTheme();
  const updateGeneral = useSettingsStore((state) => state.update);
  const userName = useSettingsStore((state) => state.general.userName);
  const currency = useSettingsStore((state) => state.general.currency);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(userName);
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>(currency as CurrencyCode);
  const [accountName, setAccountName] = useState('Kotak Bank');
  const [accountType, setAccountType] = useState<AccountType>('bank');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    try {
      await seedDefaultCategories();
      await seedDefaultMerchantAliases();
      await seedDefaultDashboardWidgets();
      updateGeneral('general', {
        onboarded: true,
        userName: name.trim(),
        currency: selectedCurrency,
        numberGrouping: CURRENCIES[selectedCurrency].grouping,
      });
      const balance = Math.round(Number(openingBalance.replace(/[^0-9.]/g, '') || '0') * 100);
      if (accountName.trim()) {
        await createAccount({
          name: accountName.trim(),
          type: accountType,
          currency: selectedCurrency,
          initialBalance: balance,
        });
      }
      toast.success('Welcome to Wallnut');
      router.replace('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not finish setup');
      setBusy(false);
    }
  };

  const steps = [
    <WelcomeStep key="welcome" />,
    <CurrencyStep
      key="currency"
      currency={selectedCurrency}
      onCurrency={setSelectedCurrency}
      name={name}
      onName={setName}
    />,
    <AccountStep
      key="account"
      accountName={accountName}
      onAccountName={setAccountName}
      accountType={accountType}
      onAccountType={setAccountType}
      openingBalance={openingBalance}
      onOpeningBalance={setOpeningBalance}
      currencySymbol={CURRENCIES[selectedCurrency].symbol}
    />,
  ];

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'space-between', paddingVertical: theme.spacing.xxxl }}>
        <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.xxl }}>{steps[step]}</View>
        <View style={{ gap: theme.spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
            {steps.map((_, index) => (
              <View
                key={index}
                style={{
                  width: index === step ? 18 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: index === step ? theme.colors.accent.base : theme.colors.border,
                }}
              />
            ))}
          </View>
          <Button
            label={step === steps.length - 1 ? (busy ? 'Setting up…' : 'Start using Wallnut') : 'Continue'}
            size="lg"
            fullWidth
            loading={busy}
            onPress={() => {
              if (step === steps.length - 1) void finish();
              else setStep(step + 1);
            }}
          />
          {step > 0 && step < steps.length - 1 ? (
            <Button label="Skip for now" variant="ghost" onPress={() => setStep(step + 1)} />
          ) : null}
          {step === steps.length - 1 ? (
            <Button label="Skip account" variant="ghost" disabled={busy} onPress={() => { setAccountName(''); void finish(); }} />
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

function WelcomeStep() {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: theme.spacing.lg }}>
      <View
        style={{
          width: 76,
          height: 76,
          borderRadius: 24,
          backgroundColor: theme.colors.accent.base,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <AppText variant="headline" style={{ color: theme.colors.accent.on }}>
          W
        </AppText>
      </View>
      <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <AppText variant="headline">Wallnut</AppText>
        <AppText variant="body" tone="secondary" style={{ textAlign: 'center', maxWidth: 280 }}>
          Your money. Your device. Private by default — nothing leaves this phone.
        </AppText>
      </View>
    </View>
  );
}

function CurrencyStep({
  currency,
  onCurrency,
  name,
  onName,
}: {
  currency: CurrencyCode;
  onCurrency: (currency: CurrencyCode) => void;
  name: string;
  onName: (name: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xl }}>
      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="title">Set your currency</AppText>
        <AppText variant="bodySmall" tone="muted">
          Everything is stored in integer minor units, so amounts round-trip exactly.
        </AppText>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {(Object.keys(CURRENCIES) as CurrencyCode[]).map((code) => (
          <Chip
            key={code}
            label={`${CURRENCIES[code].symbol} ${code}`}
            selected={currency === code}
            onPress={() => onCurrency(code)}
          />
        ))}
      </View>
      <Field label="Your name (optional)" value={name} onChangeText={onName} placeholder="Used for the greeting only" />
    </View>
  );
}

function AccountStep({
  accountName,
  onAccountName,
  accountType,
  onAccountType,
  openingBalance,
  onOpeningBalance,
  currencySymbol,
}: {
  accountName: string;
  onAccountName: (value: string) => void;
  accountType: AccountType;
  onAccountType: (value: AccountType) => void;
  openingBalance: string;
  onOpeningBalance: (value: string) => void;
  currencySymbol: string;
}) {
  const theme = useTheme();
  const types: AccountType[] = ['bank', 'cash', 'credit_card', 'savings'];
  return (
    <View style={{ gap: theme.spacing.xl }}>
      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="title">Add your first account</AppText>
        <AppText variant="bodySmall" tone="muted">
          Balances are derived from your ledger, starting from this opening balance.
        </AppText>
      </View>
      <Field label="Account name" value={accountName} onChangeText={onAccountName} placeholder="e.g. Kotak Bank" />
      <View style={{ gap: theme.spacing.sm }}>
        <AppText variant="captionMedium" tone="secondary">
          Account type
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {types.map((type) => (
            <Chip key={type} label={ACCOUNT_TYPE_LABELS[type]} selected={accountType === type} onPress={() => onAccountType(type)} />
          ))}
        </View>
      </View>
      <Field
        label="Opening balance"
        value={openingBalance}
        onChangeText={onOpeningBalance}
        keyboardType="decimal-pad"
        prefix={currencySymbol}
        placeholder="0"
        money
      />
      {Platform.OS === 'web' ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
          <Ionicons name="information-circle-outline" size={15} color={theme.colors.muted} />
          <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
            Development note: in the browser the database lives in memory unless SharedArrayBuffer headers are active; the Android build persists normally.
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

export const OnboardingStyles = StyleSheet.create({
  hidden: { display: 'none' },
});
