import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { AppText } from './ui/text';
import { BottomSheet } from './ui/sheets';
import { ListRow } from './ui/layout';
import { AccountEditor } from './AccountEditor';
import { useMoney } from '@/hooks/useMoney';
import { useQuery } from '@/hooks/useQuery';
import { useUiStore } from '@/stores/ui.store';
import { listAccounts } from '@/services/accounts.service';
import type { Account } from '@/db/schema';

/**
 * Home account scope — one tinted pill per account (name + balance), an
 * "All accounts" pill showing the combined balance, and an "Add account" pill.
 *
 * Tap a pill to scope the whole dashboard to that account; long-press opens
 * quick actions (open / adjust / edit). The colour of each pill is the
 * account's own colour, so the scope picker doubles as a legend for the
 * per-account charts.
 */
export function AccountScopeRow() {
  const theme = useTheme();
  const money = useMoney();
  const selectedId = useUiStore((state) => state.accountScopeId);
  const setScope = useUiStore((state) => state.setAccountScope);

  const accountsQuery = useQuery(() => listAccounts(), []);
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);

  const [actionAccount, setActionAccount] = useState<Account | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);

  // A deleted account must not stay selected.
  React.useEffect(() => {
    if (selectedId && accounts.length > 0 && !accounts.some((account) => account.id === selectedId)) {
      setScope(null);
    }
  }, [selectedId, accounts, setScope]);

  const combinedBalance = useMemo(
    () => accounts.reduce((sum, account) => sum + account.currentBalance, 0),
    [accounts],
  );

  const openEditor = (account: Account | null) => {
    setActionAccount(null);
    setEditing(account);
    setEditorOpen(true);
  };

  const longPress = (account: Account) => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    }
    setActionAccount(account);
  };

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: theme.spacing.sm, paddingRight: theme.spacing.sm }}>
        {accounts.length > 0 ? (
          <ScopePill
            label="All accounts"
            balance={money.format(combinedBalance, { decimals: 0 })}
            tone={theme.colors.accent.base}
            icon="wallet-outline"
            selected={selectedId === null}
            onPress={() => setScope(null)}
            onLongPress={accounts.length > 1 ? () => router.push('/accounts' as never) : undefined}
          />
        ) : null}
        {accounts.map((account) => (
          <ScopePill
            key={account.id}
            label={account.name}
            balance={money.format(account.currentBalance, { decimals: 0 })}
            tone={account.color ?? theme.colors.accent.base}
            liability={account.currentBalance < 0}
            selected={selectedId === account.id}
            onPress={() => setScope(account.id)}
            onLongPress={() => longPress(account)}
          />
        ))}
        <Pressable
          onPress={() => openEditor(null)}
          accessibilityRole="button"
          accessibilityLabel="Add account"
          android_ripple={{ color: theme.colors.ripple }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radius.lg,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: theme.colors.borderStrong,
            backgroundColor: pressed ? theme.colors.pressed : 'transparent',
          })}>
          <Ionicons name="add" size={16} color={theme.colors.textSecondary} />
          <AppText variant="captionMedium" tone="secondary">
            Add account
          </AppText>
        </Pressable>
      </ScrollView>

      {/* Long-press quick actions */}
      <BottomSheet
        visible={Boolean(actionAccount)}
        onClose={() => setActionAccount(null)}
        title={actionAccount?.name ?? ''}>
        <View style={{ gap: 2, paddingBottom: theme.spacing.sm }}>
          <ListRow
            title="Open account"
            subtitle="History, statements and reconcile"
            icon="open-outline"
            onPress={() => {
              const account = actionAccount;
              setActionAccount(null);
              if (account) router.push(`/account/${account.id}` as never);
            }}
          />
          <ListRow
            title="Adjust balance"
            subtitle="Match the balance your bank shows"
            icon="options-outline"
            onPress={() => {
              const account = actionAccount;
              setActionAccount(null);
              if (account) router.push(`/adjust?accountId=${account.id}` as never);
            }}
          />
          <ListRow
            title="Edit account"
            subtitle="Name, colour, icon, type and flags"
            icon="create-outline"
            onPress={() => openEditor(actionAccount)}
          />
          {actionAccount && actionAccount.id !== selectedId ? (
            <ListRow
              title="Scope dashboard here"
              subtitle="Every balance and analytic follows this account"
              icon="funnel-outline"
              onPress={() => {
                const account = actionAccount;
                setActionAccount(null);
                if (account) setScope(account.id);
              }}
            />
          ) : null}
        </View>
      </BottomSheet>

      <AccountEditor visible={editorOpen} onClose={() => setEditorOpen(false)} account={editing} />
    </>
  );
}

function ScopePill({
  label,
  balance,
  tone,
  icon,
  liability,
  selected,
  onPress,
  onLongPress,
}: {
  label: string;
  balance: string;
  tone: string;
  icon?: keyof typeof Ionicons.glyphMap;
  liability?: boolean;
  selected: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${balance}`}
      accessibilityHint={onLongPress ? 'Long-press for account actions' : undefined}
      accessibilityState={selected ? { selected: true } : {}}
      android_ripple={{ color: theme.colors.ripple }}
      style={({ pressed }) => ({
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        minWidth: 104,
        maxWidth: 190,
        borderRadius: theme.radius.lg,
        backgroundColor: selected ? theme.colors.accent.soft : theme.colors.surface,
        borderWidth: 1,
        borderColor: selected ? theme.colors.accent.base : `${tone}33`,
        gap: 2,
        opacity: pressed ? 0.85 : 1,
      })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon ? (
          <Ionicons name={icon} size={13} color={selected ? theme.colors.accent.base : tone} />
        ) : (
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone }} />
        )}
        <AppText
          variant="caption"
          numberOfLines={1}
          style={{ color: selected ? theme.colors.accent.base : theme.colors.textSecondary, flexShrink: 1 }}>
          {label}
        </AppText>
      </View>
      <AppText
        variant="numericCaption"
        numberOfLines={1}
        style={{ color: selected ? theme.colors.accent.base : liability ? theme.colors.negative : theme.colors.text }}>
        {balance}
      </AppText>
    </Pressable>
  );
}
