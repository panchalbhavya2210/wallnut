import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { AppText, MoneyText } from './ui/text';
import { Row } from './ui/layout';
import { Button } from './ui/controls';
import { AmountField, BottomSheet, PickerSheet } from './ui/sheets';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { toast } from '@/stores/ui.store';
import { listSelectableAccounts } from '@/services/accounts.service';
import { recordSettlement } from '@/services/shared.service';
import type { PersonBalance } from '@/utils/split';

/**
 * Records a settlement with one person. Direction is decided by the balance —
 * you cannot "pay" someone who owes you — and the amount is capped at the
 * outstanding net. The cash movement is written as a `debt_payment`, so it is
 * never income and never an expense.
 */
export function SettleSheet({
  visible,
  onClose,
  personId,
  personName,
  balance,
  groupId = null,
  onSettled,
}: {
  visible: boolean;
  onClose: () => void;
  personId: string | null;
  personName: string;
  balance: PersonBalance;
  groupId?: string | null;
  onSettled?: () => void;
}) {
  const theme = useTheme();
  const money = useMoney();
  const accountsQuery = useQuery(() => listSelectableAccounts(), []);
  const defaultAccountId = useSettingsStore((state) => state.finance.defaultAccountId);
  const [amount, setAmount] = useState(() => Math.max(0, Math.abs(balance.net)));
  /** undefined = not chosen yet (falls back to the default), null = track without an account. */
  const [accountChoice, setAccountChoice] = useState<string | null | undefined>(undefined);
  const [pickingAccount, setPickingAccount] = useState(false);
  const [working, setWorking] = useState(false);

  const direction = balance.net >= 0 ? ('received' as const) : ('paid' as const);
  const max = Math.abs(balance.net);
  const remaining = Math.max(0, max - amount);
  const accountId = accountChoice === undefined ? (defaultAccountId ?? accountsQuery.data?.[0]?.id ?? null) : accountChoice;

  const account = useMemo(
    () => accountsQuery.data?.find((entry) => entry.id === accountId) ?? null,
    [accountsQuery.data, accountId],
  );

  const save = async () => {
    if (!personId || working) return;
    setWorking(true);
    try {
      await recordSettlement({
        // 'received' means they paid you; 'paid' means you paid them.
        fromPersonId: direction === 'received' ? personId : null,
        toPersonId: direction === 'received' ? null : personId,
        amount,
        accountId: accountId ?? null,
        groupId,
      });
      toast.success('Settlement recorded');
      onSettled?.();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not record the settlement');
    } finally {
      setWorking(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Settle up"
      footer={
        <Button
          label={working ? 'Recording…' : 'Record settlement'}
          fullWidth
          loading={working}
          disabled={!personId || amount <= 0 || amount > max}
          onPress={save}
        />
      }>
      <View style={{ gap: theme.spacing.lg }}>
        <View
          style={{
            padding: theme.spacing.lg,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.accent.soft,
            gap: 4,
          }}>
          <AppText variant="caption" tone="secondary">
            {direction === 'received' ? `${personName} owes you` : `You owe ${personName}`}
          </AppText>
          <MoneyText amount={max} variant="numericMedium" tone={direction === 'received' ? 'positive' : 'negative'} />
          <AppText variant="caption" tone="muted">
            Settlements move cash and reduce the balance — they are never income or spending.
          </AppText>
        </View>

        <AmountField
          label="Amount"
          valueMinor={amount}
          onChangeMinor={setAmount}
          currencySymbol={money.currency === 'INR' ? '₹' : money.currency}
          autoFocus
        />

        <Row gap="sm">
          <Button label={`Full ${money.format(max)}`} size="sm" variant="secondary" onPress={() => setAmount(max)} />
          <Button label="Half" size="sm" variant="secondary" onPress={() => setAmount(Math.round(max / 2))} />
        </Row>

        <Pressable
          onPress={() => setPickingAccount(true)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            padding: theme.spacing.md,
            borderRadius: theme.radius.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            backgroundColor: pressed ? theme.colors.pressed : theme.colors.inputBackground,
          })}>
          <Ionicons name="wallet-outline" size={17} color={theme.colors.textSecondary} />
          <View style={{ flex: 1 }}>
            <AppText variant="caption" tone="muted">
              Account
            </AppText>
            <AppText variant="bodySmall">{account?.name ?? 'Track without an account'}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} />
        </Pressable>

        {remaining > 0 ? (
          <AppText variant="caption" tone="muted">
            {money.format(remaining)} will remain outstanding.
          </AppText>
        ) : (
          <AppText variant="caption" tone="positive">
            This settles the balance in full.
          </AppText>
        )}
      </View>

      <PickerSheet
        visible={pickingAccount}
        onClose={() => setPickingAccount(false)}
        title="Settlement account"
        items={[
          { id: '__none__', label: 'Track without an account', subtitle: 'No cash movement is recorded', icon: 'eye-off-outline' as const },
          ...(accountsQuery.data ?? []).map((entry) => ({
            id: entry.id,
            label: entry.name,
            subtitle: money.format(entry.currentBalance),
            icon: 'wallet-outline' as const,
            color: entry.color ?? undefined,
          })),
        ]}
        selectedId={accountId ?? '__none__'}
        onSelect={(item) => {
          setAccountChoice(item.id === '__none__' ? null : item.id);
          setPickingAccount(false);
        }}
      />
    </BottomSheet>
  );
}
