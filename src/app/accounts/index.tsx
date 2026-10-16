import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, IconButton, ProgressBar } from '@/components/ui/controls';
import { EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { AccountEditor } from '@/components/AccountEditor';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { getAccountGroupsSummary, isInvestment, isLiability } from '@/services/accounts.service';
import type { Account, AccountGroup } from '@/db/schema';

/**
 * Accounts — net worth hero, then collapsible groups of account cards. Every
 * row leads to the account detail (balance history, reconcile, statements).
 */
export default function AccountsScreen() {
  const theme = useTheme();
  const money = useMoney();
  const [editing, setEditing] = useState<Account | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const query = useQuery(() => getAccountGroupsSummary(), []);
  const data = query.data;

  const sections = useMemo(() => {
    if (!data) return [];
    const list: { key: string; group: AccountGroup | null; accounts: Account[]; total: number }[] = [];
    for (const summary of data.groups) {
      if (summary.accounts.length === 0) continue;
      list.push({ key: summary.group?.id ?? 'ungrouped', group: summary.group, accounts: summary.accounts, total: summary.total });
    }
    if (data.ungrouped) {
      list.push({ key: 'ungrouped', group: null, accounts: data.ungrouped.accounts, total: data.ungrouped.total });
    }
    return list;
  }, [data]);

  const openEditor = (account: Account | null) => {
    setEditing(account);
    setEditorOpen(true);
  };

  return (
    <>
      <ScrollScreen>
        <ScreenHeader
          title="Accounts"
          subtitle={
            data
              ? `${sections.reduce((sum, section) => sum + section.accounts.length, 0)} accounts · ${money.format(data.liquidTotal, { compact: true })} spendable`
              : 'Balances, groups and cards'
          }
          hint={{ id: 'accounts', message: 'Balances are derived from your transactions. Tap an account for history and reconcile; use visibility flags to keep cards or old accounts off the dashboard.' }}
          right={<IconButton icon="add" onPress={() => openEditor(null)} accessibilityLabel="Add account" />}
        />

        {query.loading && !data ? (
          <LoadingBlock label="Loading accounts…" />
        ) : sections.length === 0 ? (
          <EmptyState
            icon="wallet-outline"
            title="No accounts yet"
            message="Add your bank, cash, card or investment accounts. Balances are derived from your transactions."
            actionLabel="Add account"
            onAction={() => openEditor(null)}
          />
        ) : (
          <View style={{ gap: theme.spacing.xl }}>
            {/* Net worth hero — the filled anchor of the screen */}
            <View
              style={{
                padding: theme.spacing.lg,
                borderRadius: theme.radius.xxl,
                backgroundColor: theme.colors.accent.soft,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                gap: theme.spacing.md,
              }}>
              <View>
                <AppText variant="label" tone="muted">
                  NET WORTH
                </AppText>
                <AppText variant="numericLarge" style={{ marginTop: 6 }}>
                  {money.format(data?.netWorth ?? 0)}
                </AppText>
              </View>
              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                <View style={{ flex: 1 }}>
                  <AppText variant="caption" tone="muted">
                    Assets
                  </AppText>
                  <AppText variant="numericSmall" tone="positive">
                    {money.format(data?.assetsTotal ?? 0, { compact: true })}
                  </AppText>
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="caption" tone="muted">
                    Liabilities
                  </AppText>
                  <AppText variant="numericSmall" tone="negative">
                    {money.format(data?.liabilitiesTotal ?? 0, { compact: true })}
                  </AppText>
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="caption" tone="muted">
                    Spendable
                  </AppText>
                  <AppText variant="numericSmall">{money.format(data?.liquidTotal ?? 0, { compact: true })}</AppText>
                </View>
              </View>
            </View>

            {sections.map((section) => {
              const isCollapsed = section.group ? collapsed[section.group.id] : false;
              return (
                <View key={section.key}>
                  <Pressable
                    onPress={() =>
                      section.group &&
                      setCollapsed((current) => ({ ...current, [section.group!.id]: !current[section.group!.id] }))
                    }
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm, paddingVertical: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                      {section.group ? (
                        <Ionicons name={isCollapsed ? 'chevron-forward' : 'chevron-down'} size={14} color={theme.colors.muted} />
                      ) : null}
                      <AppText variant="label" tone={section.group?.isHidden ? 'muted' : 'secondary'}>
                        {(section.group?.name ?? 'Ungrouped').toUpperCase()}
                      </AppText>
                      {section.group?.isHidden ? <Ionicons name="eye-off-outline" size={13} color={theme.colors.muted} /> : null}
                    </View>
                    <MoneyText amount={section.total} variant="numericCaption" tone={section.total < 0 ? 'negative' : 'muted'} />
                  </Pressable>

                  {!isCollapsed ? (
                    <View style={{ gap: theme.spacing.sm }}>
                      {section.accounts.map((account) => (
                        <AccountCard key={account.id} account={account} onPress={() => router.push(`/account/${account.id}` as never)} />
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}

            <Button label="Manage groups" variant="secondary" icon="folder-outline" fullWidth onPress={() => router.push('/account-groups')} />
          </View>
        )}
      </ScrollScreen>

      <AccountEditor visible={editorOpen} onClose={() => setEditorOpen(false)} account={editing} />
    </>
  );
}

function AccountCard({ account, onPress }: { account: Account; onPress: () => void }) {
  const theme = useTheme();
  const money = useMoney();
  const liability = isLiability(account.type);
  const investment = isInvestment(account.type);

  const icon: IconName =
    (account.icon as IconName | null) ??
    (account.type === 'credit_card'
      ? 'card-outline'
      : account.type === 'cash'
        ? 'cash-outline'
        : account.type === 'wallet'
          ? 'wallet-outline'
          : account.type === 'savings'
            ? 'lock-closed-outline'
            : investment
              ? 'trending-up-outline'
              : account.type === 'loan'
                ? 'document-outline'
                : account.type === 'mortgage'
                  ? 'home-outline'
                  : account.type === 'insurance'
                    ? 'shield-checkmark-outline'
                    : 'business-outline');

  const typeLabel = account.type.replace('_', ' ');
  const cardUtilisation =
    account.type === 'credit_card' && account.creditLimit
      ? Math.abs(Math.min(0, account.currentBalance)) / account.creditLimit
      : null;

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: theme.colors.ripple }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.85 : account.isArchived ? 0.5 : 1,
      })}>
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: theme.radius.md + 2,
          backgroundColor: `${account.color ?? theme.colors.accent.base}22`,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Ionicons name={icon} size={20} color={account.color ?? theme.colors.accent.base} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <AppText variant="bodyMedium" numberOfLines={1} style={{ flexShrink: 1 }}>
            {account.name}
          </AppText>
          {account.isArchived ? (
            <AppText variant="caption" tone="muted">
              archived
            </AppText>
          ) : null}
        </View>
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {account.institution ? `${account.institution} · ` : ''}
          {investment && account.costBasis
            ? `${money.format(account.currentBalance - account.costBasis, { sign: 'always' })} gain`
            : cardUtilisation !== null
              ? `${money.format(Math.max(0, (account.creditLimit ?? 0) - Math.abs(Math.min(0, account.currentBalance))), { compact: true })} available`
              : typeLabel}
        </AppText>
        {cardUtilisation !== null ? (
          <View style={{ marginTop: 4 }}>
            <ProgressBar
              progress={cardUtilisation * 100}
              height={4}
              color={cardUtilisation > 0.7 ? theme.colors.warning : theme.colors.accent.base}
            />
          </View>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <MoneyText
          amount={account.currentBalance}
          variant="numericBody"
          tone={liability && account.currentBalance < 0 ? 'negative' : 'neutral'}
        />
        <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} />
      </View>
    </Pressable>
  );
}
