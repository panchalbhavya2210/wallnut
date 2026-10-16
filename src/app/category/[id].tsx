import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, KeyValueRow, Row, ScrollScreen, ScreenHeader, SectionHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { ProgressBar } from '@/components/ui/controls';
import { BarChart, DonutChart, LineChart } from '@/components/charts';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/feedback';
import { CustomRangeSheet, PeriodChips } from '@/components/PeriodPicker';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import {
  getCategoryBreakdown,
  getCategoryMonthlyTrends,
  getCategoryStats,
  getTopMerchants,
  getTrend,
} from '@/services/analytics.service';
import { listTransactions } from '@/services/transactions.service';
import { getCategory } from '@/services/categories.service';
import { addMonths, formatDayMonth, formatMonthYear, getPeriodRange, toISODate, type DateRange, type PeriodPreset } from '@/utils/date';
import { MonthCyclePicker } from '@/components/MonthCyclePicker';
import { formatPercent } from '@/utils/money';

/**
 * Category detail — spend, pace, month-on-month history, subcategory split,
 * merchant mix, trend and the transactions behind the number. Every parent
 * rolls up its children.
 */
export default function CategoryDetailScreen() {
  const theme = useTheme();
  const money = useMoney();
  const { id } = useLocalSearchParams<{ id: string }>();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const [period, setPeriod] = useState<PeriodPreset>('thisMonth');
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  // 0 = the current cycle; >0 anchors the month-on-month card on a past cycle.
  const [cycleOffset, setCycleOffset] = useState(0);

  // A custom From/To range (from the "Custom" chip) overrides the preset until
  // another chip is picked — same contract as Analytics. The month-on-month
  // card keeps its own cycle picker and is unaffected.
  const range = useMemo(
    () => (period === 'custom' && customRange ? customRange : getPeriodRange(period, { monthStartDay })),
    [period, customRange, monthStartDay],
  );

  const anchor = useMemo(
    () => (cycleOffset === 0 ? undefined : addMonths(new Date(), -cycleOffset)),
    [cycleOffset],
  );

  const query = useQuery(async () => {
    if (!id) return null;
    const [category, breakdown, stats, merchants, trend, transactions, monthly] = await Promise.all([
      getCategory(id),
      getCategoryBreakdown({ range, categoryIds: [id] }),
      getCategoryStats({ range, categoryIds: [id] }),
      getTopMerchants({ range, categoryIds: [id] }, 6),
      getTrend({ range, categoryIds: [id] }, undefined, ['expense', 'refund']),
      listTransactions({ categoryIds: [id], from: undefined, limit: 40, includeRefunds: true, sort: 'date_desc' }),
      // Month-on-month history is deliberately wider than the selected period.
      getCategoryMonthlyTrends({ months: 12, monthStartDay, categoryIds: [id], anchor }),
    ]);
    return { category, breakdown, stats, merchants, trend, transactions, monthly };
  }, [id, range.start.getTime(), range.end.getTime(), monthStartDay, cycleOffset]);

  if (query.loading) return <ScrollScreen><LoadingBlock label="Loading category…" /></ScrollScreen>;
  if (query.error || !query.data?.category) {
    return (
      <ScrollScreen>
        <ScreenHeader title="Category" />
        <ErrorBlock message={query.error?.message ?? 'That category no longer exists.'} onRetry={query.refresh} />
      </ScrollScreen>
    );
  }

  const { category, breakdown, stats, merchants, trend, transactions, monthly } = query.data;

  const monthlyRow = monthly.rows[0] ?? null;
  const currentCycle = monthly.months[monthly.months.length - 1] ?? null;
  const previousCycle = monthly.months[monthly.months.length - 2] ?? null;

  const periodTransactions = transactions.filter((row) => row.date >= toISODate(range.start) && row.date <= toISODate(range.end));

  return (
    <ScrollScreen>
      <ScreenHeader
        title={category.name}
        subtitle={category.parentId ? 'Subcategory' : 'Category'}
        right={
          <View style={{ width: 38, height: 38, borderRadius: theme.radius.md, backgroundColor: `${category.color}22`, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={category.icon as IconName} size={18} color={category.color} />
          </View>
        }
      />

      <PeriodChips
        value={period}
        onChange={(next) => {
          if (next === 'custom') {
            setCustomOpen(true);
            return;
          }
          setPeriod(next);
        }}
        options={['7d', '30d', '3m', '6m', '1y', 'thisMonth', 'lastMonth', 'custom']}
        style={{ marginBottom: theme.spacing.lg }}
      />
      {period === 'custom' && customRange ? (
        <Pressable
          onPress={() => setCustomOpen(true)}
          style={{ marginTop: -theme.spacing.sm, marginBottom: theme.spacing.md, alignSelf: 'flex-start' }}>
          <AppText variant="captionMedium" tone="accent">
            {formatMonthYear(customRange.start)} {customRange.start.getDate()} → {formatMonthYear(customRange.end)} {customRange.end.getDate()} · edit
          </AppText>
        </Pressable>
      ) : null}

      <View style={{ gap: theme.spacing.lg }}>
        <Card>
          <AppText variant="label" tone="muted">
            SPENT
          </AppText>
          <AppText variant="numericLarge" style={{ marginTop: 6 }}>
            {money.format(stats.total)}
          </AppText>
          <Row gap="sm" style={{ marginTop: theme.spacing.sm }}>
            {breakdown.rows[0]?.change !== null && breakdown.rows[0]?.previousTotal ? (
              <AppText variant="caption" tone={(breakdown.rows[0]?.change ?? 0) > 0 ? 'negative' : 'positive'}>
                {(breakdown.rows[0]?.change ?? 0) > 0 ? '+' : '−'}
                {formatPercent(Math.abs(breakdown.rows[0]?.change ?? 0), 1)} vs {formatPercent(100, 0).replace('100%', 'previous period')}
              </AppText>
            ) : (
              <AppText variant="caption" tone="muted">
                No previous data for comparison
              </AppText>
            )}
          </Row>
          <View style={{ marginTop: theme.spacing.md }}>
            <KeyValueRow label="Average per day" value={money.format(stats.averagePerDay)} />
            <KeyValueRow label="Average transaction" value={money.format(stats.average)} />
            <KeyValueRow label="Transactions" value={String(stats.count)} />
            <KeyValueRow label="Largest" value={money.format(stats.largest)} />
            <KeyValueRow
              label="Most recent"
              value={stats.lastDate ? formatDayMonth(new Date(stats.lastDate)) : '—'}
            />
          </View>
        </Card>

        {monthlyRow && monthlyRow.total > 0 ? (
          <Card>
            <SectionHeader
              title="MONTH ON MONTH"
              actionLabel="All categories"
              onAction={() => router.push('/category-trends' as never)}
            />
            <MonthCyclePicker
              monthStartDay={monthStartDay}
              value={cycleOffset}
              onChange={setCycleOffset}
              label={currentCycle?.fullLabel ?? 'This cycle'}
            />
            <Row justify="space-between" align="flex-end" style={{ marginTop: theme.spacing.sm }}>
              <AppText variant="numericLarge">{money.format(monthlyRow.current)}</AppText>
              {monthlyRow.change !== null ? (
                <Row gap="xs" align="center">
                  <Ionicons
                    name={monthlyRow.change > 0 ? 'arrow-up' : 'arrow-down'}
                    size={12}
                    color={monthlyRow.change > 0 ? theme.colors.negative : theme.colors.positive}
                  />
                  <AppText variant="captionMedium" tone={monthlyRow.change > 0 ? 'negative' : 'positive'}>
                    {formatPercent(Math.abs(monthlyRow.change), 0)} vs {previousCycle?.label ?? 'last cycle'}
                  </AppText>
                </Row>
              ) : (
                <AppText variant="caption" tone="muted">
                  no previous cycle
                </AppText>
              )}
            </Row>
            <View style={{ marginTop: theme.spacing.md, marginHorizontal: -8 }}>
              <BarChart
                points={monthly.months.map((bucket, index) => ({
                  key: bucket.key,
                  label: bucket.label,
                  fullLabel: bucket.fullLabel,
                  value: monthlyRow.totals[index] ?? 0,
                }))}
                height={132}
                color={category.color}
                compactLabels
              />
            </View>
            <View style={{ marginTop: theme.spacing.sm }}>
              <KeyValueRow
                label={previousCycle ? `Previous · ${previousCycle.fullLabel}` : 'Previous cycle'}
                value={money.format(monthlyRow.previous)}
              />
              <KeyValueRow label="Average per month" value={money.format(monthlyRow.average)} />
              <KeyValueRow label="Transactions (12M)" value={String(monthlyRow.count)} />
            </View>
          </Card>
        ) : null}

        {breakdown.rows[0]?.children.length ? (
          <Card>
            <AppText variant="label" tone="muted">
              SUBCATEGORIES
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg, marginTop: theme.spacing.md }}>
              <DonutChart
                size={128}
                thickness={16}
                slices={breakdown.rows[0].children.map((child) => ({
                  id: child.categoryId ?? 'none',
                  label: child.name,
                  value: child.total,
                  color: child.color,
                }))}
                centerTop="Total"
                centerBottom={money.format(stats.total, { compact: true })}
              />
              <View style={{ flex: 1, gap: 10 }}>
                {breakdown.rows[0].children.map((child) => (
                  <Pressable
                    key={child.categoryId ?? 'none'}
                    onPress={() => child.categoryId && router.push(`/category/${child.categoryId}` as never)}
                    style={{ gap: 5 }}>
                    <Row justify="space-between">
                      <Row gap="sm">
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: child.color }} />
                        <AppText variant="caption" numberOfLines={1}>
                          {child.name}
                        </AppText>
                      </Row>
                      <AppText variant="numericCaption" tone="secondary">
                        {money.format(child.total)}
                      </AppText>
                    </Row>
                    <ProgressBar progress={child.share} height={4} color={child.color} />
                  </Pressable>
                ))}
              </View>
            </View>
          </Card>
        ) : null}

        {trend.points.some((point) => point.net > 0) ? (
          <Card>
            <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.md }}>
              TREND
            </AppText>
            <View style={{ marginHorizontal: -8 }}>
              <LineChart
                points={trend.points.map((point) => ({ key: point.key, label: point.label, fullLabel: point.fullLabel, value: point.net }))}
                height={140}
                color={category.color}
                showAverage
              />
            </View>
          </Card>
        ) : null}

        {merchants.length > 0 ? (
          <Card>
            <AppText variant="label" tone="muted">
              MERCHANTS
            </AppText>
            <View style={{ marginTop: theme.spacing.sm }}>
              {merchants.map((merchant) => (
                <Pressable
                  key={merchant.name}
                  onPress={() => router.push(`/merchant/${encodeURIComponent(merchant.name)}` as never)}
                  android_ripple={{ color: theme.colors.ripple }}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <AppText variant="bodySmall" numberOfLines={1}>
                      {merchant.name}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {merchant.count}× · avg {money.format(merchant.average)}
                    </AppText>
                  </View>
                  <MoneyText amount={merchant.total} variant="numericCaption" tone="neutral" />
                </Pressable>
              ))}
            </View>
          </Card>
        ) : null}

        <View>
          <SectionHeader title="TRANSACTIONS" />
          {periodTransactions.length === 0 ? (
            <EmptyState icon="receipt-outline" title="Nothing here yet" message="No transactions in this category for the selected period." />
          ) : (
            <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, overflow: 'hidden' }}>
              {periodTransactions.map((row, index) => (
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
                    <AppText variant="caption" tone="muted" numberOfLines={1}>
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
      </View>

      <CustomRangeSheet
        visible={customOpen}
        onClose={() => setCustomOpen(false)}
        value={customRange}
        onApply={(next) => {
          setCustomRange(next);
          setPeriod('custom');
        }}
      />
    </ScrollScreen>
  );
}
