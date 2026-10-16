import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, Row, ScrollScreen, SectionHeader, KeyValueRow } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { ProgressBar } from '@/components/ui/controls';
import { EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { HeaderMenuButton } from '@/components/HeaderMenuButton';
import { ScreenHint } from '@/components/ScreenHint';
import { DonutChart, FlowBars, LineChart } from '@/components/charts';
import { Gauge } from '@/components/Gauge';
import { PeriodChips, shortPeriodLabel, CustomRangeSheet } from '@/components/PeriodPicker';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useChartColors } from '@/hooks/useChartColors';
import { useSettingsStore } from '@/stores/settings.store';
import {
  getAccountBreakdown,
  getCategoryBreakdown,
  getDailySpendingStats,
  getNetWorthChanges,
  getNetWorthTrend,
  getPeriodSummary,
  getSpendingVelocity,
  getTopMerchants,
  getTrend,
  getWeekdaySpending,
} from '@/services/analytics.service';
import { getBudgetProgressList } from '@/services/budgets.service';
import { listAccounts } from '@/services/accounts.service';
import { getSubscriptionSummary } from '@/services/recurring.service';
import { formatDayMonth, formatMonthYear, getPeriodRange, previousRange, type DateRange, type PeriodPreset } from '@/utils/date';
import { formatPercent, percentageChange } from '@/utils/money';

/**
 * Analytics — everything is real SQL aggregation, everything is tappable:
 * categories → category detail, merchants → merchant detail, chart points →
 * filtered transactions, months → monthly review.
 */
export default function AnalyticsScreen() {
  const theme = useTheme();
  const money = useMoney();
  const chart = useChartColors();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const [period, setPeriod] = useState<PeriodPreset>('30d');
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  const range = useMemo(
    () => (period === 'custom' && customRange ? customRange : getPeriodRange(period, { monthStartDay })),
    [period, customRange, monthStartDay],
  );
  const previous = useMemo(() => previousRange(range), [range]);

  const query = useQuery(
    async () => {
      const [summary, previousSummary, categories, merchants, trend, velocity, daily, weekday, budgets, netWorthChanges, netWorthTrend, subscriptions, accounts, accountsBreakdown] =
        await Promise.all([
          getPeriodSummary({ range }),
          getPeriodSummary({ range: previous }),
          getCategoryBreakdown({ range }),
          getTopMerchants({ range }, 8),
          getTrend({ range }),
          getSpendingVelocity({ range }),
          getDailySpendingStats({ range }),
          getWeekdaySpending({ range }),
          getBudgetProgressList(),
          getNetWorthChanges(monthStartDay),
          getNetWorthTrend(getPeriodRange('1y', { monthStartDay }), 'month'),
          getSubscriptionSummary(),
          listAccounts(),
          getAccountBreakdown({ range }),
        ]);
      return { summary, previousSummary, categories, merchants, trend, velocity, daily, weekday, budgets, netWorthChanges, netWorthTrend, subscriptions, accounts, accountsBreakdown };
    },
    [range.start.getTime(), range.end.getTime(), monthStartDay],
  );

  const data = query.data;

  const budgetUsage = useMemo(() => {
    if (!data || data.budgets.length === 0) return 0;
    return Math.min(150, data.budgets.reduce((sum, entry) => sum + entry.percent, 0) / data.budgets.length);
  }, [data]);

  const cardUsage = useMemo(() => {
    const cards = (data?.accounts ?? []).filter((account) => account.type === 'credit_card' && account.creditLimit);
    if (cards.length === 0) return 0;
    const total = cards.reduce(
      (sum, account) => sum + (Math.abs(Math.min(0, account.currentBalance)) / (account.creditLimit ?? 1)) * 100,
      0,
    );
    return Math.min(150, total / cards.length);
  }, [data]);

  const gaugeTone = (value: number, good: number, warn: number) =>
    value <= good ? 'positive' : value <= warn ? 'warning' : 'negative';

  const changes = useMemo(() => {
    if (!data) return [] as { label: string; change: number; invert?: boolean }[];
    const pct = (current: number, previousValue: number) => (previousValue > 0 ? ((current - previousValue) / previousValue) * 100 : null);
    const rows: { label: string; change: number; invert?: boolean }[] = [];
    const income = pct(data.summary.totals.income, data.previousSummary.totals.income);
    const spend = pct(data.summary.totals.netExpense, data.previousSummary.totals.netExpense);
    const saved = pct(data.summary.totals.savings, data.previousSummary.totals.savings);
    if (income !== null) rows.push({ label: 'Income', change: income });
    if (spend !== null) rows.push({ label: 'Spending', change: spend, invert: true });
    if (saved !== null) rows.push({ label: 'Saved', change: saved });
    const categories = data.categories.rows
      .filter((row) => row.change !== null && Math.abs(row.change) >= 3)
      .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0))
      .slice(0, 3)
      .map((row) => ({ label: row.name, change: row.change as number, invert: true }));
    return [...rows, ...categories].slice(0, 6);
  }, [data]);

  return (
    <ScrollScreen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingTop: theme.spacing.md }}>
        <HeaderMenuButton />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="title">Analytics</AppText>
          <AppText variant="caption" tone="muted">
            {formatMonthYear(range.start)} → {formatMonthYear(range.end)}
          </AppText>
        </View>
      </View>

      <PeriodChips
        value={period}
        onChange={(next) => {
          if (next === 'custom') {
            setCustomOpen(true);
            return;
          }
          setPeriod(next);
        }}
        options={['7d', '30d', '3m', '6m', '1y', 'thisMonth', 'lastMonth', 'thisYear', 'custom']}
        style={{ marginTop: theme.spacing.md, marginBottom: theme.spacing.lg }}
      />
      {period === 'custom' && customRange ? (
        <Pressable onPress={() => setCustomOpen(true)} style={{ marginTop: -theme.spacing.sm, marginBottom: theme.spacing.md, alignSelf: 'flex-start' }}>
          <AppText variant="captionMedium" tone="accent">
            {formatMonthYear(customRange.start)} {customRange.start.getDate()} → {formatMonthYear(customRange.end)} {customRange.end.getDate()} · edit
          </AppText>
        </Pressable>
      ) : null}

      <ScreenHint
        id="analytics"
        message="Every chart follows the period above — pick a preset or a custom From/To range. Tap any section to drill into the full report."
      />

      {query.loading && !data ? (
        <LoadingBlock label="Crunching numbers…" />
      ) : !data ? (
        <EmptyState title="No data yet" message="Add transactions to unlock analytics." icon="analytics-outline" />
      ) : (
        <View style={{ gap: theme.spacing.xl }}>
          {/* Health gauges — the “how am I doing?” glance */}
          <Section title="Health">
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Gauge
                    progress={Math.max(0, Math.min(100, data.summary.totals.savingsRate))}
                    size={104}
                    thickness={10}
                    tone={(data.summary.totals.savingsRate >= 20 ? 'positive' : data.summary.totals.savingsRate >= 0 ? 'accent' : 'negative') as never}
                    label={`${Math.round(data.summary.totals.savingsRate)}%`}
                    caption="Saved"
                  />
                </View>
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Gauge
                    progress={Math.max(0, Math.min(100, budgetUsage))}
                    size={104}
                    thickness={10}
                    tone={gaugeTone(budgetUsage, 85, 100) as never}
                    label={`${Math.round(budgetUsage)}%`}
                    caption="Budgets used"
                  />
                </View>
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Gauge
                    progress={Math.max(0, Math.min(100, cardUsage))}
                    size={104}
                    thickness={10}
                    tone={gaugeTone(cardUsage, 50, 80) as never}
                    label={`${Math.round(cardUsage)}%`}
                    caption="Card used"
                  />
                </View>
              </View>
            </Card>
          </Section>

          {/* What changed — the delta story, not another chart */}
          <Section title="What changed" onPress={() => router.push('/reports/monthly')}>
            <Card>
              {changes.length === 0 ? (
                <EmptyState compact icon="swap-vertical-outline" title="Nothing to compare yet" message="Once there is a previous period with activity, the notable changes appear here." />
              ) : (
                <View style={{ gap: 12 }}>
                  {changes.map((row) => {
                    const up = row.change >= 0;
                    const positive = row.invert ? !up : up;
                    const tone = positive ? 'positive' : 'negative';
                    return (
                      <Row key={row.label} justify="space-between">
                        <AppText variant="bodySmall" tone="secondary" numberOfLines={1} style={{ flex: 1, marginRight: 8 }}>
                          {row.label}
                        </AppText>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Ionicons name={up ? 'arrow-up' : 'arrow-down'} size={12} color={positive ? theme.colors.positive : theme.colors.negative} />
                          <AppText variant="numericSmall" tone={tone}>
                            {Math.abs(row.change).toFixed(0)}%
                          </AppText>
                        </View>
                      </Row>
                    );
                  })}
                  <AppText variant="caption" tone="muted">
                    Compared with the previous {shortPeriodLabel(period).toLowerCase()} period
                  </AppText>
                </View>
              )}
            </Card>
          </Section>

          {/* Cash flow */}
          <Section title="Cash flow" onPress={() => router.push('/reports/cashflow')}>
            <Card>
              <View style={{ gap: theme.spacing.lg }}>
                <Row justify="space-between">
                  <View>
                    <AppText variant="caption" tone="muted">
                      Income
                    </AppText>
                    <MoneyText amount={data.summary.totals.income} variant="numericMedium" tone="positive" />
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <AppText variant="caption" tone="muted">
                      Expenses
                    </AppText>
                    <MoneyText amount={-data.summary.totals.netExpense} variant="numericMedium" tone="negative" />
                  </View>
                </Row>
                <ProgressBar
                  progress={
                    Math.max(data.summary.totals.income, data.summary.totals.netExpense) > 0
                      ? (data.summary.totals.netExpense / Math.max(data.summary.totals.income, data.summary.totals.netExpense)) * 100
                      : 0
                  }
                  height={8}
                  color={data.summary.totals.savings >= 0 ? theme.colors.positive : theme.colors.negative}
                />
                <KeyValueRow
                  label="Saved"
                  value={<MoneyText amount={data.summary.totals.savings} variant="numericBody" tone="positive-negative" showSign />}
                />
                <KeyValueRow label="Savings rate" value={formatPercent(data.summary.totals.savingsRate, 1)} />
                <KeyValueRow
                  label="Transfers (excluded from spending)"
                  value={<MoneyText amount={-data.summary.totals.transfers} variant="numericBody" tone="muted" absolute />}
                />
                {data.summary.totals.refunds > 0 ? (
                  <KeyValueRow label="Refunds" value={<MoneyText amount={data.summary.totals.refunds} variant="numericBody" tone="positive" />} />
                ) : null}
              </View>
            </Card>
          </Section>

          {/* Income vs expenses chart */}
          <Section title="Income vs expenses">
            <Card>
              {data.trend.points.some((point) => point.income > 0 || point.expense > 0) ? (
                <>
                  <LineChart
                    points={data.trend.points.map((point) => ({ key: `e-${point.key}`, label: point.label, fullLabel: point.fullLabel, value: point.net }))}
                    height={150}
                  />
                  <View style={{ flexDirection: 'row', gap: theme.spacing.lg, marginTop: theme.spacing.md }}>
                    <Legend color={theme.colors.accent.base} label="Spending" />
                    <Legend color={theme.colors.positive} label="Income" dashed />
                  </View>
                  <View style={{ marginTop: theme.spacing.md, marginHorizontal: -8 }}>
                    <LineChart
                      points={data.trend.points.map((point) => ({ key: `i-${point.key}`, label: point.label, fullLabel: point.fullLabel, value: point.income }))}
                      height={110}
                      color={theme.colors.positive}
                      showArea={false}
                      yTicks={2}
                    />
                  </View>
                </>
              ) : (
                <EmptyState compact icon="bar-chart-outline" title="No activity yet" message="Add a few transactions to see income and expenses over time." />
              )}
            </Card>
          </Section>

          {/* Categories */}
          <Section title="Categories" onPress={() => router.push('/transactions')}>
            <Card>
              {data.categories.rows.length === 0 ? (
                <EmptyState compact icon="pie-chart-outline" title="No spending yet" message="Add a few transactions to see your spending breakdown." />
              ) : (
                <View style={{ gap: theme.spacing.lg }}>
                  <Row gap="lg">
                    <DonutChart
                      size={150}
                      thickness={20}
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
                        <Pressable
                          key={row.categoryId ?? 'none'}
                          onPress={() => row.categoryId && router.push(`/category/${row.categoryId}` as never)}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: chart.slice(index, row.color) }} />
                          <AppText variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                            {row.name}
                          </AppText>
                          <AppText variant="numericCaption" tone="secondary">
                            {formatPercent(row.share, 0)}
                          </AppText>
                        </Pressable>
                      ))}
                    </View>
                  </Row>

                  <View style={{ gap: 2 }}>
                    {data.categories.rows.slice(0, 10).map((row) => (
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
                          <Ionicons name={row.icon as IconName} size={17} color={row.color} />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <AppText variant="bodySmall">{row.name}</AppText>
                          <AppText variant="caption" tone="muted">
                            {row.count} transaction{row.count === 1 ? '' : 's'} · {formatPercent(row.share, 1)} of spending
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
          </Section>

          {/* Accounts — every account keeps its own colour */}
          <Section title="Accounts" onPress={() => router.push('/accounts')}>
            <Card>
              {data.accountsBreakdown.rows.filter((row) => row.spent > 0).length === 0 ? (
                <EmptyState compact icon="wallet-outline" title="No account activity" message="Record spending to see which accounts it came from." />
              ) : (
                <View style={{ gap: theme.spacing.lg }}>
                  <Row gap="lg">
                    <DonutChart
                      size={150}
                      thickness={20}
                      slices={data.accountsBreakdown.rows
                        .filter((row) => row.spent > 0)
                        .slice(0, 6)
                        .map((row) => ({
                          id: row.accountId,
                          label: row.name,
                          value: row.spent,
                          color: row.color ?? theme.colors.accent.base,
                        }))}
                      centerTop="Spent"
                      centerBottom={money.format(
                        data.accountsBreakdown.rows.reduce((sum, row) => sum + row.spent, 0),
                        { compact: true },
                      )}
                      onSlicePress={(slice) => router.push(`/account/${slice.id}` as never)}
                    />
                    <View style={{ flex: 1, gap: 10 }}>
                      {data.accountsBreakdown.rows
                        .filter((row) => row.spent > 0)
                        .slice(0, 5)
                        .map((row) => (
                          <Pressable
                            key={row.accountId}
                            onPress={() => router.push(`/account/${row.accountId}` as never)}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: row.color ?? theme.colors.accent.base }} />
                            <AppText variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                              {row.name}
                            </AppText>
                            <AppText variant="numericCaption" tone="secondary">
                              {formatPercent(row.share, 0)}
                            </AppText>
                          </Pressable>
                        ))}
                    </View>
                  </Row>

                  <View style={{ gap: 2 }}>
                    {data.accountsBreakdown.rows.slice(0, 10).map((row) => {
                      const rowColor = row.color ?? theme.colors.accent.base;
                      return (
                        <Pressable
                          key={row.accountId}
                          onPress={() => router.push(`/account/${row.accountId}` as never)}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: 10 }}>
                          <View
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: theme.radius.md,
                              backgroundColor: `${rowColor}22`,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}>
                            <Ionicons
                              name={
                                (row.icon as IconName | null) ??
                                (row.type === 'credit_card'
                                  ? 'card-outline'
                                  : row.type === 'cash' || row.type === 'wallet'
                                    ? 'wallet-outline'
                                    : 'business-outline')
                              }
                              size={17}
                              color={rowColor}
                            />
                          </View>
                          <View style={{ flex: 1, gap: 2 }}>
                            <AppText variant="bodySmall" numberOfLines={1}>
                              {row.name}
                            </AppText>
                            <AppText variant="caption" tone="muted">
                              {row.count} transaction{row.count === 1 ? '' : 's'}
                              {row.spent > 0 ? ` · ${formatPercent(row.share, 1)} of spending` : ''}
                              {row.income > 0 ? ` · +${money.format(row.income, { compact: true })} received` : ''}
                            </AppText>
                          </View>
                          <View style={{ alignItems: 'flex-end', gap: 2 }}>
                            <MoneyText amount={row.spent} variant="numericCaption" tone="neutral" showSign={false} />
                            <AppText variant="caption" tone="muted">
                              {money.format(row.balance, { compact: true })} bal
                            </AppText>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
            </Card>
          </Section>

          {/* Merchants */}
          <Section title="Merchants">
            <Card>
              {data.merchants.length === 0 ? (
                <EmptyState compact icon="storefront-outline" title="No merchant data" message="Merchants appear once you record merchant names." />
              ) : (
                <View style={{ gap: 2 }}>
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
                          {merchant.count}× · avg {money.format(merchant.average)}
                          {merchant.change !== null ? ` · ${merchant.change > 0 ? '+' : '−'}${formatPercent(Math.abs(merchant.change), 0)}` : ''}
                        </AppText>
                      </View>
                      <MoneyText amount={merchant.total} variant="numericCaption" tone="neutral" showSign={false} />
                    </Pressable>
                  ))}
                </View>
              )}
            </Card>
          </Section>

          {/* Spending pace + daily */}
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
                  progress={
                    data.velocity.previousPerDay > 0
                      ? Math.min(200, (data.velocity.currentPerDay / data.velocity.previousPerDay) * 100) / 2
                      : 50
                  }
                  height={8}
                  color={data.velocity.change !== null && data.velocity.change > 0 ? theme.colors.negative : theme.colors.positive}
                />
                <KeyValueRow label="Previous pace" value={`${money.format(data.velocity.previousPerDay)}/day`} />
                <KeyValueRow
                  label="Projection"
                  value={`${money.format(data.velocity.projectedTotal)} by ${formatDayMonth(range.end)}`}
                />
                <KeyValueRow label="Today" value={money.format(data.daily.today)} />
                <KeyValueRow label="7-day average" value={money.format(data.daily.average7)} />
                <KeyValueRow label="30-day average" value={money.format(data.daily.average30)} />
                <KeyValueRow
                  label="Heaviest day"
                  value={data.daily.highest ? `${money.format(data.daily.highest.amount)} · ${formatDayMonth(new Date(data.daily.highest.date))}` : '—'}
                />
                <WeekdayChart weekday={data.weekday} />
              </View>
            </Card>
          </Section>

          {/* Net worth */}
          <Section title="Net worth" onPress={() => router.push('/reports/health')}>
            <Card>
              <View style={{ gap: theme.spacing.md }}>
                <Row justify="space-between">
                  <View>
                    <AppText variant="caption" tone="muted">
                      This month
                    </AppText>
                    <MoneyText amount={data.netWorthChanges.changeThisMonth} variant="numericMedium" tone="positive-negative" showSign />
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <AppText variant="caption" tone="muted">
                      vs last year
                    </AppText>
                    <MoneyText amount={data.netWorthChanges.changeThisYear} variant="numericBody" tone="positive-negative" showSign />
                  </View>
                </Row>
                <View style={{ marginHorizontal: -8 }}>
                  <LineChart
                    points={data.netWorthTrend.map((point) => ({ key: point.key, label: point.label, fullLabel: point.fullLabel, value: point.value }))}
                    height={130}
                    showArea
                    baseline="auto"
                  />
                </View>
              </View>
            </Card>
          </Section>

          {/* Money flow */}
          <Section title="Money flow" onPress={() => router.push('/reports/cashflow')}>
            <Card>
              {data.categories.rows.length === 0 ? (
                <EmptyState compact icon="git-branch-outline" title="Nothing to flow yet" message="Record spending to see where money goes." />
              ) : (
                <FlowBars
                  totalLabel="Outflow"
                  totalValue={data.categories.total}
                  items={data.categories.rows.slice(0, 6).map((row, index) => ({
                    id: row.categoryId ?? 'none',
                    label: row.name,
                    value: row.total,
                    color: chart.slice(index, row.color),
                    onPress: row.categoryId ? () => router.push(`/category/${row.categoryId}` as never) : undefined,
                  }))}
                />
              )}
            </Card>
          </Section>

          {/* Budget performance */}
          <Section title="Budget performance" onPress={() => router.push('/budgets')}>
            <Card>
              {data.budgets.length === 0 ? (
                <EmptyState compact icon="wallet-outline" title="No budgets" message="Create budgets to track category limits." />
              ) : (
                <View style={{ gap: theme.spacing.lg }}>
                  {data.budgets.slice(0, 5).map((budget) => (
                    <Pressable key={budget.budget.id} onPress={() => router.push(`/budget/${budget.budget.id}` as never)} style={{ gap: 7 }}>
                      <Row justify="space-between">
                        <AppText variant="bodySmall">{budget.categoryName}</AppText>
                        <AppText variant="numericCaption" tone="secondary">
                          {money.format(budget.spent)} / {money.format(budget.budget.amount)}
                        </AppText>
                      </Row>
                      <ProgressBar
                        progress={budget.percent}
                        height={6}
                        color={budget.percent >= 100 ? theme.colors.negative : budget.percent >= 85 ? theme.colors.warning : theme.colors.positive}
                      />
                      <AppText variant="caption" tone="muted">
                        {budget.projected > budget.budget.amount
                          ? `Projected ${money.format(budget.projected)} — over by ${money.format(budget.projected - budget.budget.amount)}`
                          : `Projected ${money.format(budget.projected)} · on track`}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              )}
            </Card>
          </Section>

          {/* Subscriptions */}
          {data.subscriptions.activeCount > 0 ? (
            <Section title="Subscriptions" onPress={() => router.push('/recurring')}>
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
        </View>
      )}
      <CustomRangeSheet
        visible={customOpen}
        onClose={() => setCustomOpen(false)}
        value={customRange}
        onApply={(next) => {
          setCustomRange(next);
          // Without this the applied range stayed inert (range memo keys off period).
          setPeriod('custom');
        }}
      />
    </ScrollScreen>
  );
}

function Section({ title, children, onPress }: { title: string; children: React.ReactNode; onPress?: () => void }) {
  return (
    <View>
      <SectionHeader title={title.toUpperCase()} actionLabel={onPress ? 'View' : undefined} onAction={onPress} />
      {children}
    </View>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: color, opacity: dashed ? 0.5 : 1 }} />
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

function WeekdayChart({ weekday }: { weekday: { weekday: number; total: number }[] }) {
  const theme = useTheme();
  const money = useMoney();
  const max = Math.max(...weekday.map((day) => day.total), 1);
  const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return (
    <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
      <AppText variant="caption" tone="muted">
        Spending by weekday
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 70 }}>
        {weekday.map((day) => (
          <View key={day.weekday} style={{ flex: 1, alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
            <View
              style={{
                width: '100%',
                height: Math.max(3, (day.total / max) * 52),
                borderRadius: 4,
                backgroundColor: theme.chart.series[0],
                opacity: 0.85,
              }}
            />
            <AppText variant="caption" tone="muted" style={{ fontSize: 10 }}>
              {labels[day.weekday]}
            </AppText>
          </View>
        ))}
      </View>
      <AppText variant="caption" tone="muted">
        Peak day: {money.format(Math.max(...weekday.map((d) => d.total)))}
      </AppText>
    </View>
  );
}
