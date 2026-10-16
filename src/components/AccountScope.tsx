import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { AppText } from './ui/text';
import { useMoney } from '@/hooks/useMoney';
import { useQuery } from '@/hooks/useQuery';
import { useUiStore } from '@/stores/ui.store';
import { listAccounts } from '@/services/accounts.service';

/**
 * Home account scope — “All accounts” plus one card per account. Selecting a
 * card scopes every balance and analytic on the dashboard to that account,
 * exactly like Wallet's account selector.
 */
export function AccountScopeRow() {
  const theme = useTheme();
  const money = useMoney();
  const selectedId = useUiStore((state) => state.accountScopeId);
  const setScope = useUiStore((state) => state.setAccountScope);

  const accountsQuery = useQuery(() => listAccounts(), []);
  const accounts = accountsQuery.data ?? [];

  // A deleted account must not stay selected.
  React.useEffect(() => {
    if (selectedId && accounts.length > 0 && !accounts.some((account) => account.id === selectedId)) {
      setScope(null);
    }
  }, [selectedId, accounts, setScope]);

  if (accounts.length === 0) return null;

  const allBalance = accounts
    .filter((account) => account.includeInTotalBalance)
    .reduce((sum, account) => sum + account.currentBalance, 0);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: theme.spacing.sm, paddingRight: theme.spacing.sm }}>
      <ScopeCard
        label="All accounts"
        balance={allBalance}
        selected={selectedId === null}
        onPress={() => setScope(null)}
        icon="wallet-outline"
      />
      {accounts.map((account) => (
        <ScopeCard
          key={account.id}
          label={account.name}
          balance={account.currentBalance}
          color={account.color ?? theme.colors.accent.base}
          selected={selectedId === account.id}
          onPress={() => setScope(account.id)}
        />
      ))}
    </ScrollView>
  );
}

function ScopeCard({
  label,
  balance,
  color,
  selected,
  onPress,
  icon,
}: {
  label: string;
  balance: number;
  color?: string;
  selected: boolean;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useTheme();
  const money = useMoney();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={selected ? { selected: true } : {}}
      android_ripple={{ color: theme.colors.ripple }}
      style={({ pressed }) => ({
        minWidth: 108,
        maxWidth: 168,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.md - 1,
        borderRadius: theme.radius.lg,
        backgroundColor: selected ? theme.colors.accent.soft : theme.colors.inputBackground,
        borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
        borderColor: selected ? theme.colors.accent.base : theme.colors.border,
        opacity: pressed ? 0.85 : 1,
        gap: 4,
      })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon ? (
          <Ionicons name={icon} size={13} color={selected ? theme.colors.accent.base : theme.colors.textSecondary} />
        ) : (
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        )}
        <AppText
          variant="captionMedium"
          numberOfLines={1}
          style={{ color: selected ? theme.colors.accent.base : theme.colors.textSecondary, flexShrink: 1 }}>
          {label}
        </AppText>
      </View>
      <AppText variant="numericCaption" tone={selected ? 'primary' : 'secondary'}>
        {money.format(balance, { compact: true })}
      </AppText>
    </Pressable>
  );
}
