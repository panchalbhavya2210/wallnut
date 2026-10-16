import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, KeyValueRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, Chip, IconButton } from '@/components/ui/controls';
import { InfoBanner } from '@/components/ui/feedback';
import { Field, PickerSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import { ACCOUNT_TYPE_LABELS, adjustBalance, getAccount, getReconcileInfo, listAccounts } from '@/services/accounts.service';
import { formatDayMonth, toISODate } from '@/utils/date';

/**
 * Reconcile / adjust balance. The app balance is shown next to the real balance
 * you type in; the difference is written as an `adjustment` transaction so the
 * correction is auditable and never silently mutates the ledger.
 */
export default function AdjustScreen() {
  const theme = useTheme();
  const money = useMoney();
  const params = useLocalSearchParams<{ accountId?: string }>();

  const [accountId, setAccountId] = useState<string | null>(params.accountId ?? null);
  const [actualText, setActualText] = useState('');
  const [reason, setReason] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const accounts = useQuery(() => listAccounts(), []);
  const selected = accounts.data?.find((entry) => entry.id === accountId) ?? null;

  const info = useQuery(async () => {
    if (!accountId) return null;
    const actual = actualText ? Math.round(Number(actualText.replace(/[^0-9.-]/g, '') || '0') * 100) : null;
    return getReconcileInfo(accountId, actual);
  }, [accountId, actualText]);

  const difference = info.data?.difference ?? null;
  const likelyCauses = useMemo(() => {
    if (difference === null || difference === 0) return [];
    const causes = ['Missing transaction', 'Incorrect transaction amount', 'Bank fee or charge', 'Pending transaction'];
    if (difference > 0) causes.unshift('Money in you have not recorded yet');
    else causes.unshift('Money out you have not recorded yet');
    return causes.slice(0, 4);
  }, [difference]);

  const apply = async () => {
    if (!accountId) {
      toast.error('Choose an account first.');
      return;
    }
    if (difference === null || difference === 0) {
      toast.error('Enter the balance your bank shows.');
      return;
    }
    const ok = await confirm({
      title: 'Create adjustment?',
      message: `${difference > 0 ? '+' : '−'}${money.format(Math.abs(difference))} will be recorded as a balance adjustment transaction.`,
      confirmLabel: 'Create adjustment',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const actual = Math.round(Number(actualText.replace(/[^0-9.-]/g, '') || '0') * 100);
      const result = await adjustBalance({
        accountId,
        actualBalance: actual,
        reason: reason.trim() || 'Reconciliation adjustment',
        date: toISODate(new Date()),
      });
      toast.success(`Adjusted by ${money.format(result.delta, { sign: 'always' })}`);
      router.back();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not adjust the balance');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Reconcile account"
        subtitle="Compare Wallnut with your bank, then record the difference"
      />

      <View style={{ gap: theme.spacing.lg }}>
        <Card>
          <Row justify="space-between">
            <View style={{ flex: 1 }}>
              <AppText variant="label" tone="muted">
                ACCOUNT
              </AppText>
              <AppText variant="titleSmall" style={{ marginTop: 4 }}>
                {selected?.name ?? 'Choose an account'}
              </AppText>
              {selected ? (
                <AppText variant="caption" tone="muted">
                  {ACCOUNT_TYPE_LABELS[selected.type]}
                </AppText>
              ) : null}
            </View>
            <IconButton icon="chevron-down" onPress={() => setPickerOpen(true)} accessibilityLabel="Choose account" />
          </Row>
        </Card>

        {selected ? (
          <Card>
            <View style={{ gap: theme.spacing.md }}>
              <KeyValueRow
                label="Wallnut balance"
                value={<MoneyText amount={selected.currentBalance} variant="numericBody" tone="neutral" />}
              />
              <Field
                label="Actual balance (as your bank shows)"
                value={actualText}
                onChangeText={setActualText}
                keyboardType="decimal-pad"
                prefix={money.currency === 'INR' ? '₹' : money.currency}
                autoFocus
                money
              />
              <View
                style={{
                  padding: theme.spacing.lg,
                  borderRadius: theme.radius.md,
                  backgroundColor:
                    difference === null || difference === 0
                      ? theme.colors.inputBackground
                      : difference > 0
                        ? theme.colors.positiveSoft
                        : theme.colors.negativeSoft,
                }}>
                <AppText variant="caption" tone="muted">
                  Difference
                </AppText>
                <AppText
                  variant="numericMedium"
                  tone={difference === null || difference === 0 ? 'secondary' : difference > 0 ? 'positive' : 'negative'}
                  style={{ marginTop: 4 }}>
                  {difference === null ? '—' : money.format(difference, { sign: 'always' })}
                </AppText>
                {difference !== null && difference !== 0 ? (
                  <AppText variant="caption" tone="secondary" style={{ marginTop: 6 }}>
                    This will be recorded as an adjustment — excluded from income and expense analytics.
                  </AppText>
                ) : null}
              </View>
              <Field
                label="Reason (optional)"
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. Bank service charge, missed UPI"
              />
            </View>
          </Card>
        ) : null}

        {likelyCauses.length > 0 ? (
          <Card>
            <AppText variant="label" tone="muted">
              POSSIBLE CAUSES
            </AppText>
            <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
              {likelyCauses.map((cause) => (
                <Row key={cause} gap="sm">
                  <Ionicons name="ellipse" size={6} color={theme.colors.muted} />
                  <AppText variant="bodySmall" tone="secondary" style={{ flex: 1 }}>
                    {cause}
                  </AppText>
                </Row>
              ))}
            </View>
            <Button
              label="Review recent transactions"
              variant="secondary"
              size="sm"
              style={{ marginTop: theme.spacing.md }}
              onPress={() => router.push('/transactions')}
            />
          </Card>
        ) : null}

        {info.data?.largeGaps?.length ? (
          <Card>
            <AppText variant="label" tone="muted">
              LARGEST RECENT ITEMS
            </AppText>
            <View style={{ marginTop: theme.spacing.sm }}>
              {info.data.largeGaps.map((row) => (
                <Row key={row.id} justify="space-between" style={{ paddingVertical: 8 }}>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <AppText variant="bodySmall" numberOfLines={1}>
                      {row.merchant ?? row.description ?? 'Transaction'}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {formatDayMonth(new Date(row.date))}
                    </AppText>
                  </View>
                  <MoneyText amount={row.amount} variant="numericCaption" tone="auto" />
                </Row>
              ))}
            </View>
          </Card>
        ) : null}

        <InfoBanner
          message="Wallnut never edits balances directly. Every correction is a visible adjustment transaction you can find, edit or delete later."
        />

        <Button
          label={difference && difference !== 0 ? `Record adjustment of ${money.format(difference, { sign: 'always' })}` : 'No difference to record'}
          size="lg"
          fullWidth
          disabled={!difference}
          loading={busy}
          onPress={apply}
        />
      </View>

      <PickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Choose account"
        items={(accounts.data ?? []).map((account) => ({
          id: account.id,
          label: account.name,
          subtitle: `${ACCOUNT_TYPE_LABELS[account.type]} · ${money.format(account.currentBalance)}`,
          icon: 'wallet-outline' as const,
        }))}
        selectedId={accountId}
        onSelect={(item) => {
          setAccountId(item.id);
          setPickerOpen(false);
        }}
      />
    </ScrollScreen>
  );
}
