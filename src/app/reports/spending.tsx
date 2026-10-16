import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, KeyValueRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { ProgressBar } from '@/components/ui/controls';
import { LoadingBlock } from '@/components/ui/feedback';
import { DonutChart, LineChart } from '@/components/charts';
import { PeriodChips } from '@/components/PeriodPicker';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useChartColors } from '@/hooks/useChartColors';
import { useSettingsStore } from '@/stores/settings.store';
import {
  getCategoryBreakdown,
  getDailySpendingStats,
  getPeriodSummary,
  getSpendingVelocity,
  getTopMerchants,
  getTrend,
  getWeekdaySpending,
} from '@/services/analytics.service';
import { formatDayMonth, getPeriodRange, previousRange, type PeriodPreset } from '@/utils/date';
import { formatPercent } from '@/utils/money';

/**
 * Spending report — the deep dive behind the Analytics summary: totals and
 * pace, the full category tree, merchants, daily rhythm and weekday pattern.
 */
export default function SpendingReportScreen() {
  const theme = useTheme();
  const money = useMoney();
  const chart = useChartColors();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const [period, setPeriod] = useState<PeriodPreset>('thisMonth');

  const range = useMemo(() => getPeriodRange(period, { monthStartDay }), [period, monthStartDay]);
  const previous = useMemo(() => previousRange(range), [range]);

  const query = useQuery(
    async () => {
      const [summary, previousSummary, categories, merchants, trend, velocity, daily, weekday] = await Promise.all([
        getPeriodSummary({ range }),
        getPeriodSummary({ range: previous }),
        getCategoryBreakdown({ range }),
        getTopMerchants({ range }, 15),
        getTrend({ range }),
        getSpendingVelocity({ range }),
        getDailySpendingStats({ range }),
        getWeekdaySpending({ range }),
      ]);
      return { summary, previousSummary, categories, merchants, trend, velocity, daily, weekday };
    },
    [range.start.getTime(), range.end.getTime()],
  );

  const data = query.data;
  const weekdayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const weekdayMax = Math.max(...(data?.weekday.map((day) => day.total) ?? [1]), 1);

  return (
    <ScrollScreen>
      <ScreenHeader title="Spending report" subtitle="Where every rupee went" />
      <PeriodChips
        value={period}
        onChange={setPeriod}
        options={['thisMonth', 'lastMonth', '7d', '30d', '3m', '6m', '1y']}
        style={{ marginBottom: theme.spacing.lg }}
      />

      {query.loading || !data ? (
        <LoadingBlock label="Reading your spending…" />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Card>
            <AppText variant="label" tone="muted">
              TOTAL SPENDING · NET OF REFUNDS
            </AppText>
            <AppText variant="numericLarge" style={{ marginTop: 6 }}>
              {money.format(data.summary.totals.netExpense)}
            </AppText>
            <View style={{ marginTop: theme.spacing.md }}>
              <KeyValueRow label="Income" value={<MoneyText amount={data.summary.totals.income} variant="numericBody" tone="positive" />} />
              <KeyValueRow label="Gross expenses" value={<MoneyText amount={-data.summary.totals.expenses} variant="numericBody" tone="negative" />} />
              {data.summary.totals.refunds > 0 ? (
                <KeyValueRow label="Refunds" value={<MoneyText amount={data.summary.totals.refunds} variant="numericBody" tone="positive" />} />
              ) : null}
              <KeyValueRow
                label="Saved"
                value={<MoneyText amount={data.summary.totals.savings} variant="numericBody" tone="positive-negative" showSign />}
              />
              <KeyValueRow label="Transactions" value={String(data.summary.totals.transactionCount)} />
            </View>
          </Card>

          <Card>
            <AppText variant="label" tone="muted">
              PACE & DAILY RHYTHM
            </AppText>
            <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
              <Row justify="space-between">
                <AppText variant="bodySmall" tone="secondary">
                  Spending pace
                </AppText>
                <AppText variant="numericBody">{money.format(data.velocity.currentPerDay)}/day</AppText>
              </Row>
              <ProgressBar
                progress={
                  data.velocity.previousPerDay > 0
                    ? Math.min(200, (data.velocity.currentPerDay / data.velocity.previousPerDay) * 100) / 2
                    : 50
                }
                height={8}
                color={data.velocity.change !== null && data.velocity.change > 0 ? theme.colors.negative : theme.colors.positive}
              />
              <KeyValueRow label="Previous pace" value={`${money.format(data.velocity.previousPerDay)}/day`} />
              <KeyValueRow label="Projection by period end" value={money.format(data.velocity.projectedTotal)} />
              <KeyValueRow label="Today" value={money.format(data.daily.today)} />
              <KeyValueRow label="7-day average" value={money.format(data.daily.average7)} />
              <KeyValueRow label="30-day average" value={money.format(data.daily.average30)} />
              <KeyValueRow
                label="Heaviest day"
                value={
                  data.daily.highest
                    ? `${money.format(data.daily.highest.amount)} · ${formatDayMonth(new Date(data.daily.highest.date))}`
                    : '—'
                }
              />
              <KeyValueRow label="Active days" value={`${data.daily.activeDays}`} />
              <KeyValueRow label="Average per active day" value={money.format(data.daily.averagePerActiveDay)} />
            </View>

            <View style={{ marginTop: theme.spacing.md, marginHorizontal: -8 }}>
              <LineChart
                points={data.trend.points.map((point) => ({
                  key: point.key,
                  label: point.label,
                  fullLabel: point.fullLabel,
                  value: point.net,
                }))}
                height={130}
                showArea
              />
            </View>

            <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
              <AppText variant="caption" tone="muted">
                Spending by weekday
              </AppText>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 70 }}>
                {data.weekday.map((day) => (
                  <View key={day.weekday} style={{ flex: 1, alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                    <View
                      style={{
                        width: '100%',
                        height: Math.max(3, (day.total / weekdayMax) * 52),
                        borderRadius: 4,
                        backgroundColor: theme.chart.series[0],
                        opacity: 0.85,
                      }}
                    />
                    <AppText variant="caption" tone="muted" style={{ fontSize: 10 }}>
                      {weekdayLabels[day.weekday]}
                    </AppText>
                  </View>
                ))}
              </View>
            </View>
          </Card>

          <Card>
            <AppText variant="label" tone="muted">
              CATEGORIES
            </AppText>
            {data.categories.rows.length === 0 ? (
              <AppText variant="bodySmall" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                No spending in this period.
              </AppText>
            ) : (
              <View style={{ gap: theme.spacing.lg, marginTop: theme.spacing.md }}>
                <Row gap="lg">
                  <DonutChart
                    size={140}
                    thickness={19}
                    slices={data.categories.rows.slice(0, 6).map((row, index) => ({
                      id: row.categoryId ?? 'none',
                      label: row.name,
                      value: row.total,
                      color: chart.slice(index, row.color),
                    }))}
                    centerTop="Total"
                    centerBottom={money.format(data.categories.total, { compact: true })}
                    onSlicePress={(slice) => {
                      if (slice.id !== 'none') router.push(`/category/${slice.id}` as never);
                    }}
                  />
                  <View style={{ flex: 1, gap: 10 }}>
                    {data.categories.rows.slice(0, 5).map((row, index) => (
                      <View key={row.categoryId ?? 'none'} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: chart.slice(index, row.color) }} />
                        <AppText variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                          {row.name}
                        </AppText>
                        <AppText variant="numericCaption" tone="secondary">
                          {formatPercent(row.share, 0)}
                        </AppText>
                      </View>
                    ))}
                  </View>
                </Row>

                <View style={{ gap: 2 }}>
                  {data.categories.rows.map((row) => (
                    <Pressable
                      key={row.categoryId ?? 'none'}
                      onPress={() => row.categoryId && router.push(`/category/${row.categoryId}` as never)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: 10 }}>
                      <View
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: theme.radius.md,
                          backgroundColor: `${row.color}22`,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: row.color }} />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="bodySmall">{row.name}</AppText>
                        <AppText variant="caption" tone="muted">
                          {row.count} transaction{row.count === 1 ? '' : 's'} · {formatPercent(row.share, 1)} of spending
                          {row.children.length > 0 ? ` · ${row.children.length} subcategories` : ''}
                        </AppText>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 2 }}>
                        <MoneyText amount={row.total} variant="numericBody" tone="neutral" showSign={false} />
                        {row.change !== null ? (
                          <AppText variant="caption" tone={row.change > 0 ? 'negative' : 'positive'}>
                            {row.change > 0 ? '+' : '−'}
                            {formatPercent(Math.abs(row.change), 0)} vs prev
                          </AppText>
                        ) : (
                          <AppText variant="caption" tone="muted">
                            new
                          </AppText>
                        )}
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </Card>

          <Card>
            <AppText variant="label" tone="muted">
              MERCHANTS
            </AppText>
            {data.merchants.length === 0 ? (
              <AppText variant="bodySmall" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                No merchant data in this period.
              </AppText>
            ) : (
              <View style={{ gap: 2, marginTop: theme.spacing.sm }}>
                {data.merchants.map((merchant) => (
                  <Pressable
                    key={merchant.name}
                    onPress={() => router.push(`/merchant/${encodeURIComponent(merchant.name)}` as never)}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}>
                    <View style={{ flex: 1, gap: 2, marginRight: 12 }}>
                      <AppText variant="bodySmall" numberOfLines={1}>
                        {merchant.name}
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        {merchant.count}× · avg {money.format(merchant.average)} · largest {money.format(merchant.largest)}
                        {merchant.change !== null ? ` · ${merchant.change > 0 ? '+' : '−'}${formatPercent(Math.abs(merchant.change), 0)}` : ''}
                      </AppText>
                    </View>
                    <MoneyText amount={merchant.total} variant="numericCaption" tone="neutral" showSign={false} />
                  </Pressable>
                ))}
              </View>
            )}
          </Card>
        </View>
      )}
    </ScrollScreen>
  );
}

export const SpendingReportStyles = StyleSheet.create({ hidden: { display: 'none' } });
