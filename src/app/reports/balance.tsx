import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, KeyValueRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { LoadingBlock } from '@/components/ui/feedback';
import { DonutChart, LineChart } from '@/components/charts';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { getAccountGroupsSummary, isLiability } from '@/services/accounts.service';
import { getNetWorthChanges, getNetWorthSummary, getNetWorthTrend } from '@/services/analytics.service';
import { formatPercent } from '@/utils/money';
import { getPeriodRange } from '@/utils/date';

/**
 * Balance report — what you own, what you owe, and how the total has moved.
 * Every figure comes from the canonical net-worth engine (flags + money owed).
 */
export default function BalanceReportScreen() {
  const theme = useTheme();
  const money = useMoney();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);

  const query = useQuery(async () => {
    const [summary, changes, trend, groups] = await Promise.all([
      getNetWorthSummary(),
      getNetWorthChanges(monthStartDay),
      getNetWorthTrend(getPeriodRange('1y', { monthStartDay }), 'month'),
      getAccountGroupsSummary(),
    ]);
    return { summary, changes, trend, groups };
  }, [monthStartDay]);

  const data = query.data;

  const assetAccounts = (data?.groups.groups.flatMap((group) => group.accounts) ?? [])
    .concat(data?.groups.ungrouped?.accounts ?? [])
    .filter((account) => account.includeInNetWorth && !isLiability(account.type));
  const liabilityAccounts = (data?.groups.groups.flatMap((group) => group.accounts) ?? [])
    .concat(data?.groups.ungrouped?.accounts ?? [])
    .filter((account) => account.includeInNetWorth && isLiability(account.type));

  const totalAssets = data?.summary.assetsTotal ?? 0;
  const totalLiabilities = Math.abs(data?.summary.liabilitiesTotal ?? 0);

  const slices = [
    ...assetAccounts.map((account) => ({
      id: account.id,
      label: account.name,
      value: Math.max(0, account.currentBalance),
      color: account.color ?? theme.colors.accent.base,
    })),
    ...(data && data.summary.receivables > 0
      ? [{ id: '__receivables__', label: 'Money owed to you', value: data.summary.receivables, color: theme.colors.positive }]
      : []),
  ]
    .filter((slice) => slice.value > 0)
    .sort((a, b) => b.value - a.value);

  return (
    <ScrollScreen>
      <ScreenHeader title="Balance report" subtitle="Assets, liabilities and net worth" />

      {query.loading || !data ? (
        <LoadingBlock label="Adding it all up…" />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Card>
            <AppText variant="label" tone="muted">
              NET WORTH
            </AppText>
            <AppText variant="numericLarge" style={{ marginTop: 6 }}>
              {money.format(data.summary.netWorth)}
            </AppText>
            <View style={{ flexDirection: 'row', gap: theme.spacing.lg, marginTop: theme.spacing.md }}>
              <View style={{ flex: 1 }}>
                <AppText variant="caption" tone="muted">
                  This month
                </AppText>
                <MoneyText amount={data.changes.changeThisMonth} variant="numericSmall" tone="positive-negative" showSign />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="caption" tone="muted">
                  This year
                </AppText>
                <MoneyText amount={data.changes.changeThisYear} variant="numericSmall" tone="positive-negative" showSign />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="caption" tone="muted">
                  vs last year
                </AppText>
                <AppText variant="numericSmall" tone={(data.summary.netWorth - data.changes.yearAgoValue) >= 0 ? 'positive' : 'negative'}>
                  {data.changes.yearAgoValue !== 0
                    ? formatPercent(((data.summary.netWorth - data.changes.yearAgoValue) / Math.abs(data.changes.yearAgoValue)) * 100, 1)
                    : '—'}
                </AppText>
              </View>
            </View>
            <View style={{ marginTop: theme.spacing.lg, marginHorizontal: -8 }}>
              <LineChart
                points={data.trend.map((point) => ({ key: point.key, label: point.label, fullLabel: point.fullLabel, value: point.value }))}
                height={160}
                showArea
                baseline="auto"
              />
            </View>
          </Card>

          <Card>
            <AppText variant="label" tone="muted">
              ASSETS · {money.format(totalAssets, { compact: true })}
            </AppText>
            {slices.length > 0 ? (
              <View style={{ marginTop: theme.spacing.md, alignItems: 'center' }}>
                <DonutChart
                  size={150}
                  thickness={20}
                  slices={slices.slice(0, 7)}
                  centerTop="Assets"
                  centerBottom={money.format(totalAssets, { compact: true })}
                />
              </View>
            ) : null}
            <View style={{ marginTop: theme.spacing.md }}>
              {assetAccounts.map((account) => (
                <Pressable
                  key={account.id}
                  onPress={() => router.push(`/account/${account.id}` as never)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: 10 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: account.color ?? theme.colors.accent.base }} />
                  <AppText variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>
                    {account.name}
                  </AppText>
                  <MoneyText amount={account.currentBalance} variant="numericCaption" tone="neutral" />
                </Pressable>
              ))}
              {data.summary.receivables > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: 10 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.positive }} />
                  <AppText variant="bodySmall" style={{ flex: 1 }}>
                    Money owed to you
                  </AppText>
                  <MoneyText amount={data.summary.receivables} variant="numericCaption" tone="positive" />
                </View>
              ) : null}
            </View>
            <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
              Accounts with "Count in net worth" switched off are excluded, as are archived-only entries you unticked.
            </AppText>
          </Card>

          <Card>
            <AppText variant="label" tone="muted">
              LIABILITIES · {money.format(totalLiabilities, { compact: true })}
            </AppText>
            <View style={{ marginTop: theme.spacing.md }}>
              {liabilityAccounts.map((account) => (
                <Pressable
                  key={account.id}
                  onPress={() => router.push(`/account/${account.id}` as never)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: 10 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: account.color ?? theme.colors.negative }} />
                  <AppText variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>
                    {account.name}
                  </AppText>
                  <MoneyText amount={account.currentBalance} variant="numericCaption" tone="negative" />
                </Pressable>
              ))}
              {data.summary.payables > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: 10 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.warning }} />
                  <AppText variant="bodySmall" style={{ flex: 1 }}>
                    Money you owe
                  </AppText>
                  <MoneyText amount={-data.summary.payables} variant="numericCaption" tone="negative" />
                </View>
              ) : null}
              {liabilityAccounts.length === 0 && data.summary.payables === 0 ? (
                <AppText variant="bodySmall" tone="muted" style={{ paddingVertical: theme.spacing.sm }}>
                  No liabilities — nothing owed on cards, loans or mortgages.
                </AppText>
              ) : null}
            </View>
          </Card>

          <Card>
            <AppText variant="label" tone="muted">
              SUMMARY
            </AppText>
            <View style={{ marginTop: theme.spacing.sm }}>
              <KeyValueRow label="Assets" value={<MoneyText amount={totalAssets} variant="numericBody" tone="positive" />} />
              <KeyValueRow label="Liabilities" value={<MoneyText amount={-totalLiabilities} variant="numericBody" tone="negative" />} />
              <KeyValueRow
                label="Net worth"
                value={<MoneyText amount={data.summary.netWorth} variant="numericBody" tone="positive-negative" showSign />}
              />
              <KeyValueRow label="Money owed to you" value={<MoneyText amount={data.summary.receivables} variant="numericBody" />} />
              <KeyValueRow label="Money you owe" value={<MoneyText amount={-data.summary.payables} variant="numericBody" />} />
            </View>
          </Card>
        </View>
      )}
    </ScrollScreen>
  );
}

export const BalanceReportStyles = StyleSheet.create({ hidden: { display: 'none' } });
