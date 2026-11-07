import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, HeaderScrollScreen, IconName, KeyValueRow, Row, SectionHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { ProgressBar, SegmentedControl } from '@/components/ui/controls';
import { EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { AppHeader, TopTabs } from '@/components/AppHeader';
import { GradientBlobs } from '@/components/ui/backdrop';
import { BarChart, DonutChart, LineChart } from '@/components/charts';
import { CustomRangeSheet, PeriodPill, shortPeriodLabel } from '@/components/PeriodPicker';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import {
  getAccountBreakdown,
  getCategoryBreakdown,
  getDailySpendingStats,
  getMerchantOverview,
  getNetWorthChanges,
  getNetWorthRangeChange,
  getNetWorthTrend,
  getPeriodSummary,
  getSpendingVelocity,
  getTrend,
  getWeekdaySpending,
  type CategoryBreakdownRow,
  type MerchantRow,
} from '@/services/analytics.service';
import { getBudgetProgressList } from '@/services/budgets.service';
import { getSubscriptionSummary } from '@/services/recurring.service';
import {
  daysInRange,
  formatDayMonth,
  getPeriodRange,
  pickTrendGranularity,
  previousRange,
  type DateRange,
  type PeriodPreset,
} from '@/utils/date';
import { formatPercent, percentageChange } from '@/utils/money';

/**
 * Insights — four questions, four tabs:
 *  Overview   → what came in, what went out, and what changed
 *  Categories → where the money went, with budgets and drill-down
 *  Trends     → spending over time, compared with the previous period
 *  Merchants  → which businesses received the money
 *
 * Every number on the screen comes from the same selected range and the same
 * SQL aggregation rules: transfers excluded, refunds netting against spending,
 * adjustments/debt movements never treated as income or expense.
 */

type InsightTab = 'overview' | 'categories' | 'trends' | 'merchants';
type CategoryKind = 'expense' | 'income';

const INSIGHT_PERIODS: PeriodPreset[] = ['thisWeek', 'thisMonth', 'lastMonth', '3m', '6m', '1y', 'custom'];

export default function InsightsScreen() {
  const theme = useTheme();
  const money = useMoney();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const [tab, setTab] = useState<InsightTab>('overview');
  const [period, setPeriod] = useState<PeriodPreset>('thisMonth');
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [categoryKind, setCategoryKind] = useState<CategoryKind>('expense');
  const [merchantSearch, setMerchantSearch] = useState('');

  const range = useMemo(
    () => (period === 'custom' && customRange ? customRange : getPeriodRange(period, { monthStartDay })),
    [period, customRange, monthStartDay],
  );
  const previous = useMemo(() => previousRange(range), [range]);

  const query = useQuery(
    async () => {
      const [
        summary,
        categories,
        incomeCategories,
        merchantOverview,
        trend,
        previousTrend,
        velocity,
        daily,
        weekday,
        budgets,
        netWorthChanges,
        netWorthRange,
        netWorthTrend,
        accountsBreakdown,
        subscriptions,
      ] = await Promise.all([
        getPeriodSummary({ range }),
        getCategoryBreakdown({ range }, { kind: 'expense' }),
        getCategoryBreakdown({ range }, { kind: 'income' }),
        getMerchantOverview({ range }, 100),
        getTrend({ range }),
        getTrend({ range: previous }),
        getSpendingVelocity({ range }),
        getDailySpendingStats({ range }),
        getWeekdaySpending({ range }),
        getBudgetProgressList(),
        getNetWorthChanges(monthStartDay),
        getNetWorthRangeChange(range),
        getNetWorthTrend(range, pickTrendGranularity(range)),
        getAccountBreakdown({ range }),
        getSubscriptionSummary(),
      ]);
      return {
        summary,
        categories,
        incomeCategories,
        merchantOverview,
        trend,
        previousTrend,
        velocity,
        daily,
        weekday,
        budgets,
        netWorthChanges,
        netWorthRange,
        netWorthTrend,
        accountsBreakdown,
        subscriptions,
      };
    },
    [range.start.getTime(), range.end.getTime(), monthStartDay],
  );

  const data = query.data;
  const spendingChange = data ? percentageChange(data.summary.totals.netExpense, data.summary.previous.netExpense) : null;
  const incomeChange = data ? percentageChange(data.summary.totals.income, data.summary.previous.income) : null;
  const netWorthRangeChange = data ? data.netWorthRange.change : null;

  const insight = useMemo(() => {
    if (!data) return null;
    const rows = data.categories.rows;
    if (rows.length === 0) {
      return 'No spending is recorded in this period. Record a transaction and this view will explain where it went.';
    }
    const driver = [...rows].sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0))[0];
    if (spendingChange === null) {
      return `Spending was ${money.format(data.summary.totals.netExpense)}. There is no previous period with spending to compare against yet.`;
    }
    if (Math.abs(spendingChange) < 2) {
      return `Spending is broadly steady versus the previous ${shortPeriodLabel(period).toLowerCase()}. Biggest category: ${rows[0]!.name} at ${money.format(rows[0]!.total)}.`;
    }
    if (spendingChange > 0) {
      return driver?.change !== null && driver?.change !== undefined && driver.change > 0
        ? `Spending is up ${formatPercent(spendingChange, 0)} versus the previous period, led by ${driver.name} (${formatPercent(driver.change, 0)} higher).`
        : `Spending is up ${formatPercent(spendingChange, 0)} versus the previous period.`;
    }
    return `Spending is down ${formatPercent(Math.abs(spendingChange), 0)} versus the previous period. Biggest category: ${rows[0]!.name} at ${money.format(rows[0]!.total)}.`;
  }, [data, money, period, spendingChange]);

  const categoryBudget = useMemo(() => {
    const map = new Map<string, (typeof data extends null ? never : NonNullable<typeof data>['budgets'][number])>();
    for (const budget of data?.budgets ?? []) {
      if (budget.budget.categoryId) map.set(budget.budget.categoryId, budget);
    }
    return map;
  }, [data?.budgets]);

  const visibleMerchants = useMemo(() => {
    const needle = merchantSearch.trim().toLowerCase();
    const rows = data?.merchantOverview.rows ?? [];
    return needle ? rows.filter((row) => row.name.toLowerCase().includes(needle)) : rows;
  }, [data?.merchantOverview.rows, merchantSearch]);

  const overviewEmpty = data ? data.summary.totals.transactionCount === 0 && data.summary.totals.income === 0 : false;

  return (
    <HeaderScrollScreen
      header={
        <>
          <AppHeader
            title="Insights"
            subtitle={`${formatDayMonth(range.start)} – ${formatDayMonth(range.end)}`}
            onSearch={() => router.push('/transactions?search=1' as never)}
          />
          <TopTabs
            tabs={[
              { value: 'overview', label: 'Overview' },
              { value: 'categories', label: 'Categories' },
              { value: 'trends', label: 'Trends' },
              { value: 'merchants', label: 'Merchants' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </>
      }>
      <GradientBlobs />

      <Row justify="space-between" style={{ marginTop: theme.spacing.md, marginBottom: theme.spacing.sm }}>
        <PeriodPill
          value={period}
          onChange={(next) => {
            if (next === 'custom') {
              setCustomOpen(true);
              return;
            }
            setPeriod(next);
          }}
          options={INSIGHT_PERIODS}
          monthStartDay={monthStartDay}
        />
        <AppText variant="caption" tone="muted">
          {daysInRange(range)} days · both dates included
        </AppText>
      </Row>
      {period === 'custom' && customRange ? (
        <Pressable onPress={() => setCustomOpen(true)} style={{ marginBottom: theme.spacing.md, alignSelf: 'flex-start' }}>
          <AppText variant="captionMedium" tone="accent">
            {formatDayMonth(customRange.start)} → {formatDayMonth(customRange.end)} · edit
          </AppText>
        </Pressable>
      ) : null}

      {query.loading && !data ? (
        <LoadingBlock label="Crunching your numbers…" />
      ) : !data ? (
        <EmptyState icon="analytics-outline" title="No data yet" message="Add transactions to unlock insights." />
      ) : overviewEmpty ? (
        <EmptyState
          icon="analytics-outline"
          title="Nothing recorded in this period"
          message="Choose a wider date range, or add your first transaction. Insights will build themselves from the ledger."
          actionLabel="Add transaction"
          onAction={() => router.push('/transaction/new' as never)}
        />
      ) : (
        <View style={{ gap: theme.spacing.xl }}>
          {tab === 'overview' ? (
            <>
              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                <MetricTile
                  label="Total spending"
                  amount={data.summary.totals.netExpense}
                  change={spendingChange}
                  invert
                  tone="negative"
                />
                <MetricTile
                  label="Total income"
                  amount={data.summary.totals.income}
                  change={incomeChange}
                  tone="positive"
                />
              </View>

              <Card>
                <Row justify="space-between" align="flex-end">
                  <View style={{ gap: 3, flex: 1, minWidth: 0 }}>
                    <AppText variant="caption" tone="muted">
                      Net cash flow
                    </AppText>
                    <MoneyText amount={data.summary.totals.savings} variant="numericMedium" tone="positive-negative" showSign />
                    <AppText variant="caption" tone="muted">
                      Income minus spending in this period
                    </AppText>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <AppText variant="caption" tone="muted">
                      Savings rate
                    </AppText>
                    <AppText variant="numericSmall" tone={data.summary.totals.savings >= 0 ? 'positive' : 'negative'}>
                      {formatPercent(data.summary.totals.savingsRate, 0)}
                    </AppText>
                  </View>
                </Row>
              </Card>

              {insight ? (
                <View
                  style={{
                    flexDirection: 'row',
                    gap: theme.spacing.sm,
                    alignItems: 'flex-start',
                    padding: theme.spacing.lg,
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.accent.soft,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: `${theme.colors.accent.base}33`,
                  }}>
                  <Ionicons name="sparkles-outline" size={18} color={theme.colors.accent.base} />
                  <AppText variant="bodySmall" tone="secondary" style={{ flex: 1 }}>
                    {insight}
                  </AppText>
                </View>
              ) : null}

              <Section title="Spending trend">
                <Card>
                  {data.trend.points.some((point) => point.net > 0) ? (
                    <>
                      <View
                        accessible
                        accessibilityLabel={`Spending trend by ${data.trend.granularity} from ${formatDayMonth(range.start)} to ${formatDayMonth(range.end)}`}>
                        <BarChart
                          points={data.trend.points.map((point) => ({
                            key: point.key,
                            label: point.label,
                            fullLabel: point.fullLabel,
                            value: point.net,
                          }))}
                          height={132}
                          color={theme.colors.accent.base}
                          compactLabels
                        />
                      </View>
                      <Row justify="space-between" style={{ marginTop: theme.spacing.md }}>
                        <AppText variant="caption" tone="muted">
                          {data.trend.granularity === 'day' ? 'Daily' : data.trend.granularity === 'week' ? 'Weekly' : 'Monthly'} spending
                        </AppText>
                        <AppText variant="caption" tone="muted">
                          Highest {money.format(data.trend.max, { compact: true })}
                        </AppText>
                      </Row>
                    </>
                  ) : (
                    <EmptyState compact icon="bar-chart-outline" title="No spending yet" message="No expenses were recorded in this range." />
                  )}
                </Card>
              </Section>

              <Section title="Net worth" actionLabel="Health report" onPress={() => router.push('/reports/health' as never)}>
                <Card>
                  <View style={{ gap: theme.spacing.md }}>
                    <Row justify="space-between" align="flex-end">
                      <View style={{ gap: 3 }}>
                        <AppText variant="caption" tone="muted">
                          Current net worth
                        </AppText>
                        <MoneyText amount={data.netWorthChanges.current} variant="numericMedium" tone="neutral" showSign={false} />
                      </View>
                      {netWorthRangeChange !== null ? (
                        <AppText variant="caption" tone={netWorthRangeChange >= 0 ? 'positive' : 'negative'}>
                          {netWorthRangeChange >= 0 ? '+' : '−'}
                          {money.format(Math.abs(netWorthRangeChange), { compact: true })} in this period
                        </AppText>
                      ) : null}
                    </Row>
                    {data.netWorthTrend.length > 1 ? (
                      <View style={{ marginHorizontal: -8 }} accessible accessibilityLabel="Net worth trend for the selected period">
                        <LineChart
                          points={data.netWorthTrend.map((point) => ({
                            key: point.key,
                            label: point.label,
                            fullLabel: point.fullLabel,
                            value: point.value,
                          }))}
                          height={128}
                          baseline="auto"
                          showArea
                        />
                      </View>
                    ) : (
                      <AppText variant="caption" tone="muted">
                        Add another account or transaction to see the trend.
                      </AppText>
                    )}
                  </View>
                </Card>
              </Section>

              <Section title="Budgets in focus" actionLabel="All budgets" onPress={() => router.push('/budgets' as never)}>
                {data.budgets.length === 0 ? (
                  <Card>
                    <EmptyState
                      compact
                      icon="wallet-outline"
                      title="No budgets yet"
                      message="Set a category limit to see progress and remaining money here."
                      actionLabel="Create a budget"
                      onAction={() => router.push('/budgets' as never)}
                    />
                  </Card>
                ) : (
                  <Card>
                    <View style={{ gap: theme.spacing.lg }}>
                      {[...data.budgets]
                        .sort((a, b) => b.percent - a.percent)
                        .slice(0, 4)
                        .map((budget) => (
                          <Pressable
                            key={budget.budget.id}
                            onPress={() => router.push(`/budget/${budget.budget.id}` as never)}
                            style={{ gap: 6 }}>
                            <Row justify="space-between">
                              <AppText variant="bodySmall" numberOfLines={1} style={{ flex: 1, marginRight: 8 }}>
                                {budget.categoryName}
                              </AppText>
                              <AppText variant="numericCaption" tone="secondary">
                                {money.format(budget.spent)} / {money.format(budget.budget.amount)}
                              </AppText>
                            </Row>
                            <ProgressBar
                              progress={budget.percent}
                              height={6}
                              color={budget.percent >= 100 ? theme.colors.negative : budget.percent >= 85 ? theme.colors.warning : theme.colors.positive}
                            />
                            <AppText variant="caption" tone={budget.remaining < 0 ? 'negative' : 'muted'}>
                              {budget.remaining >= 0
                                ? `${money.format(budget.remaining)} left · ${money.format(budget.safeToSpendPerDay)}/day safe`
                                : `${money.format(Math.abs(budget.remaining))} over budget`}
                            </AppText>
                          </Pressable>
                        ))}
                    </View>
                  </Card>
                )}
              </Section>

              {data.subscriptions.activeCount > 0 ? (
                <Section title="Subscriptions" onPress={() => router.push('/recurring' as never)}>
                  <Card>
                    <Row justify="space-between">
                      <View>
                        <AppText variant="caption" tone="muted">
                          Monthly
                        </AppText>
                        <AppText variant="numericSmall">{money.format(data.subscriptions.monthlyTotal)}</AppText>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <AppText variant="caption" tone="muted">
                          Annualised
                        </AppText>
                        <AppText variant="numericSmall">{money.format(data.subscriptions.annualTotal)}</AppText>
                      </View>
                    </Row>
                  </Card>
                </Section>
              ) : null}
            </>
          ) : null}

          {tab === 'categories' ? (
            <>
              <SegmentedControl
                options={[
                  { value: 'expense', label: 'Spending' },
                  { value: 'income', label: 'Income' },
                ]}
                value={categoryKind}
                onChange={setCategoryKind}
              />

              {(() => {
                const breakdown = categoryKind === 'expense' ? data.categories : data.incomeCategories;
                const rows = breakdown.rows;
                if (rows.length === 0) {
                  return (
                    <Card>
                      <EmptyState
                        icon="pie-chart-outline"
                        title={categoryKind === 'expense' ? 'No spending yet' : 'No income yet'}
                        message={
                          categoryKind === 'expense'
                            ? 'Expense categories appear here once you record spending in this period.'
                            : 'Income categories appear here once you record income in this period.'
                        }
                        actionLabel="Add transaction"
                        onAction={() => router.push('/transaction/new' as never)}
                      />
                    </Card>
                  );
                }
                const top = rows.slice(0, 6);
                const otherTotal = rows.slice(6).reduce((sum, row) => sum + row.total, 0);
                return (
                  <>
                    <Card>
                      <AppText variant="caption" tone="muted">
                        {categoryKind === 'expense' ? 'Total spending' : 'Total income'}
                      </AppText>
                      <MoneyText
                        amount={breakdown.total}
                        variant="numericLarge"
                        tone={categoryKind === 'expense' ? 'neutral' : 'positive'}
                        showSign={false}
                      />
                      <AppText variant="caption" tone="muted">
                        {rows.length} {categoryKind === 'expense' ? 'spending' : 'income'} categor{rows.length === 1 ? 'y' : 'ies'} · 100% reconciled with the transactions in this range
                      </AppText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg, marginTop: theme.spacing.lg }}>
                        <DonutChart
                          size={146}
                          thickness={19}
                          slices={[
                            ...top.map((row) => ({
                              id: row.categoryId ?? 'uncategorised',
                              label: row.name,
                              value: row.total,
                              color: row.color,
                            })),
                            ...(otherTotal > 0
                              ? [{ id: 'others', label: 'Others', value: otherTotal, color: theme.colors.muted }]
                              : []),
                          ]}
                          centerTop="Total"
                          centerBottom={money.format(breakdown.total, { compact: true })}
                        />
                        <View style={{ flex: 1, gap: 9 }}>
                          {[...top, ...(otherTotal > 0 ? [{ categoryId: null, name: 'Others', color: theme.colors.muted, icon: 'ellipsis-horizontal', total: otherTotal, share: breakdown.total > 0 ? (otherTotal / breakdown.total) * 100 : 0, count: 0, gross: otherTotal, refunds: 0, previousTotal: 0, change: null, children: [] } as CategoryBreakdownRow] : [])].map((row) => (
                            <Pressable
                              key={row.categoryId ?? row.name}
                              onPress={() => openCategory(row, categoryKind)}
                              style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: row.color }} />
                              <AppText variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                                {row.name}
                              </AppText>
                              <AppText variant="numericCaption" tone="secondary">
                                {formatPercent(row.share, 0)}
                              </AppText>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    </Card>

                    <Card padded={false}>
                      {rows.map((row, index) => {
                        const budget = categoryKind === 'expense' && row.categoryId ? categoryBudget.get(row.categoryId) : undefined;
                        return (
                          <Pressable
                            key={row.categoryId ?? 'uncategorised'}
                            onPress={() => openCategory(row, categoryKind)}
                            android_ripple={{ color: theme.colors.ripple }}
                            accessibilityRole="button"
                            accessibilityLabel={`${row.name}, ${money.format(row.total)}, ${formatPercent(row.share, 0)} of total`}
                            style={{
                              paddingHorizontal: theme.spacing.lg,
                              paddingVertical: theme.spacing.md,
                              borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                              borderTopColor: theme.colors.border,
                              gap: 7,
                            }}>
                            <Row justify="space-between" gap="sm">
                              <Row gap="sm" style={{ flex: 1, minWidth: 0 }}>
                                <View
                                  style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: theme.radius.full,
                                    backgroundColor: `${row.color}24`,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}>
                                  <Ionicons name={(row.icon as IconName) ?? 'pricetag-outline'} size={16} color={row.color} />
                                </View>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <AppText variant="bodySmall" numberOfLines={1}>
                                    {row.name}
                                  </AppText>
                                  <AppText variant="caption" tone="muted" numberOfLines={1}>
                                    {row.count} transaction{row.count === 1 ? '' : 's'} · {formatPercent(row.share, 1)} of {categoryKind === 'expense' ? 'spending' : 'income'}
                                  </AppText>
                                </View>
                              </Row>
                              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                                <MoneyText amount={row.total} variant="numericCaption" tone="neutral" showSign={false} />
                                <ChangePill change={row.change} invert={categoryKind === 'expense'} compact />
                              </View>
                            </Row>
                            <ProgressBar progress={row.share} height={5} color={row.color} />
                            {budget ? (
                              <AppText variant="caption" tone={budget.remaining < 0 ? 'negative' : 'muted'}>
                                Budget {formatPercent(budget.percent, 0)} used ·{' '}
                                {budget.remaining >= 0 ? `${money.format(budget.remaining)} left` : `${money.format(Math.abs(budget.remaining))} over`}
                              </AppText>
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </Card>
                    <AppText variant="caption" tone="muted">
                      Percentages use total {categoryKind === 'expense' ? 'spending' : 'income'} for this period. Refunds reduce the category they belong to; transfers are excluded.
                    </AppText>
                  </>
                );
              })()}
            </>
          ) : null}

          {tab === 'trends' ? (
            <>
              <Card>
                <AppText variant="caption" tone="muted">
                  Spending over time · {data.trend.granularity === 'day' ? 'daily' : data.trend.granularity === 'week' ? 'weekly' : 'monthly'}
                </AppText>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm, marginTop: 2 }}>
                  <MoneyText amount={data.summary.totals.netExpense} variant="numericMedium" tone="neutral" showSign={false} />
                  <ChangePill change={spendingChange} invert />
                </View>
                {data.trend.points.some((point) => point.net > 0 || (data.previousTrend.points ?? []).some((p) => p.net > 0)) ? (
                  <>
                    <View
                      style={{ marginTop: theme.spacing.md }}
                      accessible
                      accessibilityLabel={`Spending this period compared with the previous period, by ${data.trend.granularity}`}>
                      <LineChart
                        points={data.trend.points.map((point) => ({
                          key: point.key,
                          label: point.label,
                          fullLabel: point.fullLabel,
                          value: point.net,
                        }))}
                        comparison={data.previousTrend.points.map((point, index) => ({
                          key: `previous-${point.key}`,
                          label: data.trend.points[index]?.label ?? point.label,
                          fullLabel: point.fullLabel,
                          value: point.net,
                        }))}
                        height={178}
                        showAverage
                      />
                    </View>
                    <Row gap="lg" style={{ marginTop: theme.spacing.sm }}>
                      <Legend color={theme.colors.accent.base} label="This period" />
                      <Legend color={theme.colors.muted} label="Previous period" dashed />
                    </Row>
                  </>
                ) : (
                  <EmptyState compact icon="analytics-outline" title="No trend yet" message="There is no spending in either this period or the previous one." />
                )}
              </Card>

              <Section title="What changed">
                <Card>
                  {data.categories.rows.filter((row) => row.change !== null && Math.abs(row.change) >= 3).length === 0 ? (
                    <EmptyState compact icon="swap-vertical-outline" title="No notable changes" message="Category changes of 3% or more will appear here once a previous period has activity." />
                  ) : (
                    <View style={{ gap: theme.spacing.md }}>
                      {data.categories.rows
                        .filter((row) => row.change !== null && Math.abs(row.change) >= 3)
                        .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0))
                        .slice(0, 6)
                        .map((row) => (
                          <Pressable
                            key={row.categoryId ?? row.name}
                            onPress={() => openCategory(row, 'expense')}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: row.color }} />
                            <AppText variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>
                              {row.name}
                            </AppText>
                            <AppText variant="caption" tone="muted">
                              {money.format(row.previousTotal, { compact: true })} → {money.format(row.total, { compact: true })}
                            </AppText>
                            <ChangePill change={row.change} invert compact />
                          </Pressable>
                        ))}
                    </View>
                  )}
                </Card>
              </Section>

              <Section title="Pace & daily">
                <Card>
                  <View style={{ gap: theme.spacing.md }}>
                    <Row justify="space-between">
                      <AppText variant="bodySmall" tone="secondary">
                        Spending pace
                      </AppText>
                      <AppText variant="numericBody">{money.format(data.velocity.currentPerDay)}/day</AppText>
                    </Row>
                    <ProgressBar
                      progress={data.velocity.previousPerDay > 0 ? Math.min(200, (data.velocity.currentPerDay / data.velocity.previousPerDay) * 100) / 2 : 50}
                      height={8}
                      color={data.velocity.change !== null && data.velocity.change > 0 ? theme.colors.negative : theme.colors.positive}
                    />
                    <KeyValueRow label="Previous pace" value={`${money.format(data.velocity.previousPerDay)}/day`} />
                    <KeyValueRow label="Projected by period end" value={money.format(data.velocity.projectedTotal)} />
                    <KeyValueRow label="Today" value={money.format(data.daily.today)} />
                    <KeyValueRow label="7-day average" value={money.format(data.daily.average7)} />
                    <KeyValueRow label="30-day average" value={money.format(data.daily.average30)} />
                    <KeyValueRow
                      label="Heaviest day"
                      value={data.daily.highest ? `${money.format(data.daily.highest.amount)} · ${formatDayMonth(new Date(data.daily.highest.date))}` : '—'}
                    />
                    <WeekdayBars weekday={data.weekday} />
                  </View>
                </Card>
              </Section>

              <Section title="Spending by account" actionLabel="Accounts" onPress={() => router.push('/accounts' as never)}>
                <Card>
                  {data.accountsBreakdown.rows.filter((row) => row.spent > 0).length === 0 ? (
                    <EmptyState compact icon="wallet-outline" title="No account activity" message="Record spending to see which account it came from." />
                  ) : (
                    <View style={{ gap: theme.spacing.md }}>
                      {[...data.accountsBreakdown.rows]
                        .filter((row) => row.spent > 0)
                        .sort((a, b) => b.spent - a.spent)
                        .slice(0, 6)
                        .map((row) => (
                          <Pressable
                            key={row.accountId}
                            onPress={() => router.push(`/account/${row.accountId}` as never)}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: row.color ?? theme.colors.accent.base }} />
                            <AppText variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>
                              {row.name}
                            </AppText>
                            <AppText variant="numericCaption" tone="secondary">
                              {money.format(row.spent)}
                            </AppText>
                            <AppText variant="caption" tone="muted" style={{ width: 42, textAlign: 'right' }}>
                              {formatPercent(row.share, 0)}
                            </AppText>
                          </Pressable>
                        ))}
                    </View>
                  )}
                </Card>
              </Section>
            </>
          ) : null}

          {tab === 'merchants' ? (
            <>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  backgroundColor: theme.colors.inputBackground,
                  borderRadius: theme.radius.full,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                  paddingHorizontal: theme.spacing.md,
                  height: 42,
                }}>
                <Ionicons name="search-outline" size={16} color={theme.colors.muted} />
                <TextInput
                  value={merchantSearch}
                  onChangeText={setMerchantSearch}
                  placeholder="Search merchants…"
                  placeholderTextColor={theme.colors.muted}
                  autoCorrect={false}
                  style={{ flex: 1, color: theme.colors.text, fontFamily: theme.typography.body.fontFamily, fontSize: 15, paddingVertical: 0 }}
                />
                {merchantSearch ? (
                  <Pressable onPress={() => setMerchantSearch('')} hitSlop={8} accessibilityLabel="Clear merchant search">
                    <Ionicons name="close-circle" size={16} color={theme.colors.muted} />
                  </Pressable>
                ) : null}
              </View>

              <Card>
                <Row justify="space-between">
                  <View style={{ gap: 2 }}>
                    <AppText variant="caption" tone="muted">
                      Merchant spending
                    </AppText>
                    <MoneyText amount={data.merchantOverview.attributedSpending} variant="numericMedium" tone="neutral" showSign={false} />
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <AppText variant="caption" tone="muted">
                      Merchants
                    </AppText>
                    <AppText variant="numericSmall">{data.merchantOverview.merchantCount}</AppText>
                  </View>
                </Row>
                <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.xs }}>
                  A merchant is where you spent (Amazon); a category is what you bought (shopping). Shares use all spending in this period.
                </AppText>
              </Card>

              {visibleMerchants.length === 0 ? (
                <Card>
                  <EmptyState
                    icon="storefront-outline"
                    title={merchantSearch ? 'No matching merchants' : 'No merchant data yet'}
                    message={
                      merchantSearch
                        ? 'Try a different name or clear the search.'
                        : 'Add a merchant when recording a transaction to see where your money goes.'
                    }
                    actionLabel={merchantSearch ? undefined : 'Add transaction'}
                    onAction={merchantSearch ? undefined : () => router.push('/transaction/new' as never)}
                  />
                </Card>
              ) : (
                <Card padded={false}>
                  {visibleMerchants.map((merchant, index) => (
                    <MerchantListRow key={merchant.name} merchant={merchant} rank={index + 1} />
                  ))}
                </Card>
              )}

              {data.merchantOverview.unattributedSpending > 0 ? (
                <AppText variant="caption" tone="muted">
                  {money.format(data.merchantOverview.unattributedSpending)} of spending has no merchant name. Those transactions still count in every total; they simply cannot be ranked here.
                </AppText>
              ) : null}

              <Pressable
                onPress={() => router.push('/merchants' as never)}
                accessibilityRole="button"
                accessibilityLabel="Open merchant names and aliases"
                style={({ pressed }) => ({
                  paddingVertical: theme.spacing.md,
                  borderRadius: theme.radius.full,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                  alignItems: 'center',
                  backgroundColor: pressed ? theme.colors.pressed : 'transparent',
                })}>
                <AppText variant="captionMedium" tone="accent">
                  Merchant names & aliases
                </AppText>
              </Pressable>
            </>
          ) : null}
        </View>
      )}

      <CustomRangeSheet
        visible={customOpen}
        onClose={() => setCustomOpen(false)}
        value={customRange}
        onApply={(next) => {
          setCustomRange(next);
          setPeriod('custom');
        }}
      />
    </HeaderScrollScreen>
  );
}

/* ------------------------------- Components -------------------------------- */

function openCategory(row: CategoryBreakdownRow, kind: CategoryKind) {
  if (!row.categoryId) {
    router.push('/transactions?uncategorised=1' as never);
    return;
  }
  if (kind === 'income') {
    router.push(
      `/transactions?categoryId=${encodeURIComponent(row.categoryId)}&categoryName=${encodeURIComponent(row.name)}` as never,
    );
    return;
  }
  router.push(`/category/${row.categoryId}` as never);
}

function Section({ title, children, onPress, actionLabel }: { title: string; children: React.ReactNode; onPress?: () => void; actionLabel?: string }) {
  return (
    <View>
      <SectionHeader title={title} actionLabel={actionLabel} onAction={onPress} />
      {children}
    </View>
  );
}

function MetricTile({
  label,
  amount,
  change,
  tone,
  invert,
}: {
  label: string;
  amount: number;
  change: number | null;
  tone: 'positive' | 'negative';
  invert?: boolean;
}) {
  return (
    <Card style={{ flex: 1 }}>
      <View style={{ gap: 4 }}>
        <AppText variant="labelMedium" tone="muted" numberOfLines={1}>
          {label}
        </AppText>
        <MoneyText amount={amount} variant="numericMedium" tone={tone} showSign={false} numberOfLines={1} adjustsFontSizeToFit />
        <ChangePill change={change} invert={invert} compact />
      </View>
    </Card>
  );
}

function ChangePill({ change, invert = false, compact }: { change: number | null; invert?: boolean; compact?: boolean }) {
  const theme = useTheme();
  if (change === null) {
    return (
      <View style={{ paddingHorizontal: compact ? 8 : theme.spacing.sm, paddingVertical: 3, borderRadius: theme.m3.shape.small, backgroundColor: theme.m3.color.surfaceContainerHighest, alignSelf: 'flex-start' }}>
        <AppText variant="labelSmall" tone="muted">
          No prior period
        </AppText>
      </View>
    );
  }
  const up = change >= 0;
  const good = invert ? !up : up;
  const color = good ? theme.m3.color.positive : theme.m3.color.error;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: compact ? 8 : theme.spacing.sm,
        paddingVertical: compact ? 2 : 4,
        borderRadius: theme.m3.shape.small,
        backgroundColor: `${color}1A`,
        alignSelf: 'flex-start',
      }}>
      <Ionicons name={up ? 'arrow-up' : 'arrow-down'} size={compact ? 11 : 12} color={color} />
      <AppText variant="labelSmall" style={{ color }}>
        {Math.abs(change) < 10 ? `${Math.abs(change).toFixed(1)}%` : `${Math.round(Math.abs(change))}%`}
      </AppText>
    </View>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  const theme = useTheme();
  return (
    <Row gap="xs" align="center">
      <View style={{ width: 18, height: 2, borderRadius: 1, backgroundColor: color, opacity: dashed ? 0.7 : 1 }} />
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <View style={{ width: StyleSheet.hairlineWidth, height: 1, backgroundColor: theme.colors.border }} />
    </Row>
  );
}

function WeekdayBars({ weekday }: { weekday: { weekday: number; total: number }[] }) {
  const theme = useTheme();
  const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const max = Math.max(1, ...weekday.map((day) => day.total));
  const money = useMoney();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <AppText variant="caption" tone="muted">
        Day of week
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 58 }}>
        {weekday.map((day, index) => (
          <View key={day.weekday} style={{ flex: 1, alignItems: 'center', gap: 4 }} accessibilityLabel={`${labels[index]}: ${money.format(day.total)}`}>
            <View style={{ width: '100%', height: Math.max(3, (day.total / max) * 40), borderRadius: 4, backgroundColor: day.total === max && max > 1 ? theme.colors.accent.base : theme.colors.accent.soft }} />
            <AppText variant="caption" tone="muted" style={{ fontSize: 10 }}>
              {labels[index]}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

function MerchantListRow({ merchant, rank }: { merchant: MerchantRow; rank: number }) {
  const theme = useTheme();
  const money = useMoney();
  return (
    <Pressable
      onPress={() => router.push(`/merchant/${encodeURIComponent(merchant.name)}` as never)}
      android_ripple={{ color: theme.colors.ripple }}
      accessibilityRole="button"
      accessibilityLabel={`${merchant.name}, ${money.format(merchant.total)}, ${merchant.count} transactions`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        borderTopWidth: rank === 1 ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border,
      }}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: theme.radius.full,
          backgroundColor: theme.colors.accent.soft,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <AppText variant="numericCaption" tone="accent">
          {rank}
        </AppText>
      </View>
      <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
        <Row justify="space-between">
          <AppText variant="bodySmall" numberOfLines={1} style={{ flex: 1, marginRight: 8 }}>
            {merchant.name}
          </AppText>
          <AppText variant="numericCaption">{money.format(merchant.total)}</AppText>
        </Row>
        <ProgressBar progress={merchant.share} height={4} color={theme.colors.accent.base} />
        <Row justify="space-between">
          <AppText variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {merchant.count}× · avg {money.format(merchant.average)} · {formatPercent(merchant.share, 1)} of spending
          </AppText>
          <ChangePill change={merchant.change} invert compact />
        </Row>
      </View>
      <Ionicons name="chevron-forward" size={15} color={theme.colors.muted} />
    </Pressable>
  );
}
