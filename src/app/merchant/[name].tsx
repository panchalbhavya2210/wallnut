import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, KeyValueRow, Row, ScrollScreen, ScreenHeader, SectionHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button } from '@/components/ui/controls';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/feedback';
import { LineChart } from '@/components/charts';
import { PeriodChips } from '@/components/PeriodPicker';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { getTopMerchants } from '@/services/analytics.service';
import { listTransactions } from '@/services/transactions.service';
import { formatDayMonth, getPeriodRange, monthKey, parseMonthKey, toISODate, type PeriodPreset } from '@/utils/date';
import { formatPercent } from '@/utils/money';

/**
 * Merchant detail — aggregates the canonical (alias-normalised) merchant, so
 * "Amazon" includes "AMZN Mktp IN" and "Amazon Pay India".
 */
export default function MerchantDetailScreen() {
  const theme = useTheme();
  const money = useMoney();
  const { name } = useLocalSearchParams<{ name: string }>();
  const merchantName = name ? decodeURIComponent(name) : '';
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const [period, setPeriod] = useState<PeriodPreset>('6m');

  const range = useMemo(() => getPeriodRange(period, { monthStartDay }), [period, monthStartDay]);

  const query = useQuery(async () => {
    if (!merchantName) return null;
    const [rows, merchants] = await Promise.all([
      listTransactions({
        merchantCanonical: merchantName,
        limit: 400,
        includeRefunds: true,
        sort: 'date_desc',
      }),
      getTopMerchants({ range }, 50),
    ]);
    const inRange = rows.filter((row) => row.date >= toISODate(range.start) && row.date <= toISODate(range.end));

    const expenses = inRange.filter((row) => row.type === 'expense');
    const refunds = inRange.filter((row) => row.type === 'refund');
    const total = expenses.reduce((sum, row) => sum + Math.abs(row.amount), 0) - refunds.reduce((sum, row) => sum + Math.abs(row.amount), 0);
    const count = expenses.length;
    const largest = expenses.reduce((max, row) => Math.max(max, Math.abs(row.amount)), 0);
    const average = count > 0 ? Math.round(total / count) : 0;
    const share = merchants.find((entry) => entry.name === merchantName) ?? null;

    // Bucket by month for the trend chart.
    const buckets = new Map<string, number>();
    for (const row of inRange) {
      if (row.type !== 'expense' && row.type !== 'refund') continue;
      const key = monthKey(new Date(row.date));
      const value = row.type === 'refund' ? -Math.abs(row.amount) : Math.abs(row.amount);
      buckets.set(key, (buckets.get(key) ?? 0) + value);
    }
    const trend = Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => {
        const date = parseMonthKey(key) ?? new Date();
        return {
          key,
          label: date.toLocaleDateString(undefined, { month: 'short' }),
          fullLabel: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
          value: Math.max(0, value),
        };
      });

    const lastUsed = inRange[0]?.date ?? rows[0]?.date ?? null;
    return { inRange, total, count, largest, average, share, trend, lastUsed };
  }, [merchantName, range.start.getTime(), range.end.getTime()]);

  if (query.loading) return <ScrollScreen><LoadingBlock label="Loading merchant…" /></ScrollScreen>;
  if (query.error) {
    return (
      <ScrollScreen>
        <ScreenHeader title={merchantName || 'Merchant'} />
        <ErrorBlock message={query.error.message} onRetry={query.refresh} />
      </ScrollScreen>
    );
  }

  const data = query.data;
  if (!data || data.count === 0) {
    return (
      <ScrollScreen>
        <ScreenHeader title={merchantName || 'Merchant'} />
        <EmptyState
          icon="storefront-outline"
          title="No spending"
          message={`No expenses from ${merchantName} in the selected period.`}
        />
      </ScrollScreen>
    );
  }

  return (
    <ScrollScreen>
      <ScreenHeader title={merchantName} subtitle="Merchant" />

      <PeriodChips
        value={period}
        onChange={setPeriod}
        options={['30d', '3m', '6m', '1y', 'all']}
        style={{ marginBottom: theme.spacing.lg }}
      />

      <View style={{ gap: theme.spacing.lg }}>
        <Card>
          <AppText variant="label" tone="muted">
            TOTAL SPENT
          </AppText>
          <AppText variant="numericLarge" style={{ marginTop: 6 }}>
            {money.format(data.total)}
          </AppText>
          <View style={{ marginTop: theme.spacing.md }}>
            <KeyValueRow label="Transactions" value={String(data.count)} />
            <KeyValueRow label="Average" value={money.format(data.average)} />
            <KeyValueRow label="Largest" value={money.format(data.largest)} />
            {data.share ? <KeyValueRow label="Share of spending" value={formatPercent(data.share.share, 1)} /> : null}
            {data.lastUsed ? <KeyValueRow label="Last used" value={formatDayMonth(new Date(data.lastUsed))} /> : null}
            {data.share?.change !== null && data.share?.change !== undefined ? (
              <KeyValueRow
                label="vs previous period"
                value={`${data.share.change > 0 ? '+' : '−'}${formatPercent(Math.abs(data.share.change), 0)}`}
              />
            ) : null}
          </View>
        </Card>

        {data.trend.length > 1 ? (
          <Card>
            <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.md }}>
              MONTHLY TREND
            </AppText>
            <View style={{ marginHorizontal: -8 }}>
              <LineChart points={data.trend} height={140} showAverage />
            </View>
          </Card>
        ) : null}

        <View>
          <SectionHeader title={`TRANSACTIONS (${data.inRange.length})`} />
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, overflow: 'hidden' }}>
            {data.inRange.slice(0, 50).map((row, index) => (
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
                    {row.description || row.merchant || 'Transaction'}
                  </AppText>
                  <AppText variant="caption" tone="muted" numberOfLines={1}>
                    {formatDayMonth(new Date(row.date))} · {row.categoryName ?? 'Uncategorised'} · {row.accountName}
                  </AppText>
                </View>
                <MoneyText amount={row.amount} variant="numericCaption" tone="auto" />
              </Pressable>
            ))}
          </View>
        </View>

        <Button label="Open in transactions" variant="secondary" fullWidth onPress={() => router.push('/transactions')} />
      </View>
    </ScrollScreen>
  );
}
