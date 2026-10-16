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
 * Home account scope — “All accounts” plus one chip per account. Selecting a
 * chip scopes every balance and analytic on the dashboard to that account.
 * Deliberately compact: the balance hero, not the scope picker, is the first
 * thing the eye should land on.
 */
export function AccountScopeRow() {
  const theme = useTheme();
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

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: theme.spacing.sm, paddingRight: theme.spacing.sm }}>
      <ScopeChip
        label="All accounts"
        selected={selectedId === null}
        onPress={() => setScope(null)}
        icon="wallet-outline"
      />
      {accounts.map((account) => (
        <ScopeChip
          key={account.id}
          label={account.name}
          color={account.color ?? theme.colors.accent.base}
          selected={selectedId === account.id}
          onPress={() => setScope(account.id)}
        />
      ))}
    </ScrollView>
  );
}

function ScopeChip({
  label,
  color,
  selected,
  onPress,
  icon,
}: {
  label: string;
  color?: string;
  selected: boolean;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected ? { selected: true } : {}}
      android_ripple={{ color: theme.colors.ripple }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: theme.spacing.md,
        height: 32,
        maxWidth: 200,
        borderRadius: theme.radius.full,
        backgroundColor: selected ? theme.colors.accent.soft : theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? theme.colors.accent.base : theme.colors.border,
        opacity: pressed ? 0.85 : 1,
      })}>
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
    </Pressable>
  );
}
