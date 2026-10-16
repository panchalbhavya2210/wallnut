import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, KeyValueRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, Chip, ProgressBar } from '@/components/ui/controls';
import { EmptyState, ErrorBlock, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { AmountField, FormSheet } from '@/components/ui/sheets';
import { AnimatedMoney, Gauge } from '@/components/Gauge';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import { deleteBudget, getBudget, getBudgetProgress, updateBudget } from '@/services/budgets.service';
import { listTransactions } from '@/services/transactions.service';
import { formatDayMonth, fromISODate } from '@/utils/date';
import { formatPercent } from '@/utils/money';

/** Budget detail — progress, pace, projected end, matching transactions. */
export default function BudgetDetailScreen() {
  const theme = useTheme();
  const money = useMoney();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [editOpen, setEditOpen] = useState(false);
  const [amount, setAmount] = useState(0);
  const [rollover, setRollover] = useState(false);

  const query = useQuery(async () => {
    if (!id) return null;
    const budget = await getBudget(id);
    if (!budget) return null;
    const progress = await getBudgetProgress(budget);
    const transactions = await listTransactions({
      categoryIds: budget.categoryId ? [budget.categoryId] : [],
      from: progress.periodStart,
      to: progress.periodEnd,
      limit: 40,
      includeRefunds: true,
      sort: 'date_desc',
    });
    return { budget, progress, transactions };
  }, [id]);

  if (query.loading) return <ScrollScreen><LoadingBlock label="Loading budget…" /></ScrollScreen>;
  if (query.error || !query.data) {
    return (
      <ScrollScreen>
        <ScreenHeader title="Budget" />
        <ErrorBlock message={query.error?.message ?? 'This budget no longer exists.'} onRetry={query.refresh} />
      </ScrollScreen>
    );
  }

  const { budget, progress, transactions } = query.data;
  const statusTone = progress.percent >= 100 ? 'negative' : progress.percent >= 85 ? 'warning' : 'positive';

  const startEdit = () => {
    setAmount(budget.amount);
    setRollover(budget.rolloverEnabled);
    setEditOpen(true);
  };

  const save = async () => {
    try {
      await updateBudget(budget.id, { amount, rolloverEnabled: rollover });
      setEditOpen(false);
      toast.success('Budget updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update');
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: 'Delete this budget?', tone: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;
    await deleteBudget(budget.id);
    router.back();
  };

  const daysGone = progress.daysElapsed;
  const expectedPercent = (daysGone / progress.daysTotal) * 100;
  const ahead = progress.percent > expectedPercent + 5;
  const behind = progress.percent < expectedPercent - 5;

  return (
    <ScrollScreen>
      <ScreenHeader
        title={progress.categoryName ?? 'Budget'}
        subtitle={`${budget.period} · ${formatDayMonth(fromISODate(progress.periodStart) ?? new Date())} → ${formatDayMonth(fromISODate(progress.periodEnd) ?? new Date())}`}
        right={<Button label="Edit" variant="ghost" size="sm" onPress={startEdit} />}
      />

      <View style={{ gap: theme.spacing.lg }}>
        <Card>
          <Row justify="space-between" gap="lg">
            <View style={{ flex: 1, gap: theme.spacing.sm }}>
              <AppText variant="label" tone="muted">
                SPENT
              </AppText>
              <AnimatedMoney amount={progress.spent} variant="numericMedium" tone="neutral" />
              <AppText variant="caption" tone="muted">
                of {money.format(budget.amount)} · {formatPercent(progress.percent, 1)} used
              </AppText>
              <AppText variant="caption" tone={progress.remaining >= 0 ? 'muted' : 'negative'}>
                {progress.remaining >= 0
                  ? `${money.format(progress.remaining)} left`
                  : `${money.format(Math.abs(progress.remaining))} over budget`}
              </AppText>
              <AppText variant="caption" tone="muted">
                Day {daysGone} of {progress.daysTotal} · even pace {formatPercent(expectedPercent, 0)}
              </AppText>
            </View>
            <Gauge
              progress={progress.percent}
              size={150}
              thickness={13}
              tone={progress.percent >= 100 ? 'negative' : progress.percent >= 85 ? 'warning' : 'positive'}
              label={formatPercent(progress.percent, 0)}
              caption={ahead ? 'ahead of pace' : behind ? 'under pace' : 'on pace'}
            />
          </Row>
        </Card>

        <Card>
          <AppText variant="label" tone="muted">
            OUTLOOK
          </AppText>
          <View style={{ marginTop: theme.spacing.sm }}>
            <KeyValueRow
              label="Remaining"
              value={
                <MoneyText
                  amount={progress.remaining}
                  variant="numericBody"
                  tone={progress.remaining >= 0 ? 'positive' : 'negative'}
                />
              }
            />
            <KeyValueRow label="Safe to spend" value={`${money.format(progress.safeToSpendPerDay)}/day`} />
            <KeyValueRow label="Days remaining" value={String(progress.daysRemaining)} />
            <KeyValueRow
              label="Projected end"
              value={
                <MoneyText
                  amount={progress.projected}
                  variant="numericBody"
                  tone={progress.projected > budget.amount ? 'negative' : 'positive'}
                />
              }
            />
          </View>
          <View style={{ marginTop: theme.spacing.md }}>
            {ahead ? (
              <InfoBanner tone="warning" message={`You're running ahead of pace — ${formatPercent(progress.percent - expectedPercent, 0)} above the even line.`} />
            ) : behind ? (
              <InfoBanner tone="accent" message={`You're under pace by ${formatPercent(expectedPercent - progress.percent, 0)} — comfortably on track.`} />
            ) : (
              <InfoBanner tone="accent" message="You're tracking almost exactly on pace." />
            )}
          </View>
        </Card>

        <View>
          <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.sm }}>
            TRANSACTIONS IN THIS PERIOD
          </AppText>
          {transactions.length === 0 ? (
            <EmptyState compact icon="receipt-outline" title="Nothing yet" message="No spending in this category for the current period." />
          ) : (
            <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, overflow: 'hidden' }}>
              {transactions.map((row, index) => (
                <Pressable
                  key={row.id}
                  onPress={() => router.push(`/transaction/${row.id}` as never)}
                  android_ripple={{ color: theme.colors.ripple }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.md,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.border,
                  }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="bodySmall" numberOfLines={1}>
                      {row.merchant || row.description || 'Transaction'}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {formatDayMonth(new Date(row.date))} · {row.accountName}
                      {row.type === 'refund' ? ' · refund' : ''}
                    </AppText>
                  </View>
                  <MoneyText amount={row.amount} variant="numericCaption" tone="auto" />
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <Button label="Delete budget" variant="danger" fullWidth onPress={remove} />
      </View>

      <FormSheet
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit budget"
        submitLabel="Save budget"
        onSubmit={save}>
        <AmountField label="Budget amount" valueMinor={amount} onChangeMinor={setAmount} currencySymbol={money.currency === 'INR' ? '₹' : money.currency} />
        <Row gap="sm">
          <Chip label={rollover ? 'Rollover on' : 'Rollover off'} selected={rollover} onPress={() => setRollover(!rollover)} />
        </Row>
      </FormSheet>
    </ScrollScreen>
  );
}
