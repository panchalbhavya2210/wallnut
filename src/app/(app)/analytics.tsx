import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, HeaderScrollScreen, IconName, Row, ScrollScreen, SectionHeader, KeyValueRow } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { ProgressBar, SegmentedControl } from '@/components/ui/controls';
import { EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { AppHeader, TopTabs } from '@/components/AppHeader';
import { ScreenHint } from '@/components/ScreenHint';
import { BarChart, DonutChart, FlowBars, LineChart } from '@/components/charts';
import { Gauge } from '@/components/Gauge';
import { CustomRangeSheet, PeriodPill, shortPeriodLabel } from '@/components/PeriodPicker';
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
  type CategoryBreakdownRow,
} from '@/services/analytics.service';
import { getBudgetProgressList } from '@/services/budgets.service';
import { listAccounts } from '@/services/accounts.service';
import { getSubscriptionSummary } from '@/services/recurring.service';
import { formatDayMonth, getPeriodRange, previousRange, type DateRange, type PeriodPreset } from '@/utils/date';
import { formatPercent } from '@/utils/money';

/**
 * Insights — four questions about the numbers, four tabs:
 * where the money went (Spending), what came in (Income), what it's worth
 * (Net worth) and how behaviour is changing (Trends). Everything is real SQL
 * aggregation and everything is tappable: categories → category detail,
 * merchants → merchant detail, months → monthly review.
 */

type InsightTab = 'spending' | 'income' | 'netWorth' | 'trends';
type AmountMode = 'amount' | 'percent';

const RANGE_SEGMENTS: { value: PeriodPreset; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '1y', label: '1Y' },
];

/** Presets the pill offers, including the custom-range escape hatch. */
const INSIGHT_PERIODS: PeriodPreset[] = ['7d', '30d', '3m', '6m', '1y', 'thisMonth', 'lastMonth', 'thisYear', 'custom'];

export default function InsightsScreen() {
  const theme = useTheme();
  const money = useMoney();
  const chart = useChartColors();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const [tab, setTab] = useState<InsightTab>('spending');
  const [period, setPeriod] = useState<PeriodPreset>('30d');
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [categoryMode, setCategoryMode] = useState<AmountMode>('amount');
  const [incomeMode, setIncomeMode] = useState<AmountMode>('amount');

  const range = useMemo(
    () => (period === 'custom' && customRange ? customRange : getPeriodRange(period, { monthStartDay })),
    [period, customRange, monthStartDay],
  );
  const previous = useMemo(() => previousRange(range), [range]);

  const query = useQuery(
    async () => {
      const [
        summary,
        previousSummary,
        categories,
        incomeCategories,
        merchants,
        trend,
        velocity,
        daily,
        weekday,
        budgets,
        netWorthChanges,
        netWorthTrend,
        subscriptions,
        accounts,
        accountsBreakdown,
      ] = await Promise.all([
        getPeriodSummary({ range }),
        getPeriodSummary({ range: previous }),
        getCategoryBreakdown({ range }),
        getCategoryBreakdown({ range }, { kind: 'income' }),
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
      return {
        summary,
        previousSummary,
        categories,
        incomeCategories,
        merchants,
        trend,
        velocity,
        daily,
        weekday,
        budgets,
        netWorthChanges,
        netWorthTrend,
        subscriptions,
        accounts,
        accountsBreakdown,
      };
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

  const periodLabel = useMemo(() => shortPeriodLabel(period).toLowerCase(), [period]);
  const percentChange = (current: number, prior: number) => (prior > 0 ? ((current - prior) / prior) * 100 : null);
  const spendingChange = data ? percentChange(data.summary.totals.netExpense, data.previousSummary.totals.netExpense) : null;
  const incomeChange = data ? percentChange(data.summary.totals.income, data.previousSummary.totals.income) : null;

  /** The one-line story at the top of the Spending tab. */
  const insight = useMemo(() => {
    if (!data) return null;
    const delta = spendingChange;
    const driver = data.categories.rows.find((row) => (row.change ?? 0) > 5) ?? data.categories.rows[0] ?? null;
    if (delta === null || Math.abs(delta) < 1) {
      return {
        icon: 'information-circle-outline' as const,
        text: `Spending is steady versus the previous ${periodLabel}.${driver ? ` Biggest category: ${driver.name} at ${money.format(driver.total)}.` : ''}`,
      };
    }
    if (delta > 0) {
      return {
        icon: 'trending-up' as const,
        text: `You spent ${formatPercent(Math.abs(delta), 0)} more than the previous ${periodLabel}.${driver ? ` Mainly due to higher ${driver.name}.` : ''}`,
      };
    }
    return {
      icon: 'trending-down' as const,
      text: `You spent ${formatPercent(Math.abs(delta), 0)} less than the previous ${periodLabel}.${driver ? ` Largest category: ${driver.name} at ${money.format(driver.total)}.` : ''}`,
    };
  }, [data, spendingChange, periodLabel, money]);

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
              { value: 'spending', label: 'Spending' },
              { value: 'income', label: 'Income' },
              { value: 'netWorth', label: 'Net worth' },
              { value: 'trends', label: 'Trends' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </>
      }>

      {/* Period: a named pill for every preset, a segmented control for the
          four windows people actually flip between. */}
      <Row gap="sm" style={{ marginTop: theme.spacing.md }}>
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
        <SegmentedControl
          options={RANGE_SEGMENTS}
          value={RANGE_SEGMENTS.some((segment) => segment.value === period) ? period : null}
          onChange={setPeriod}
          style={{ flex: 1 }}
        />
      </Row>
      {period === 'custom' && customRange ? (
        <Pressable onPress={() => setCustomOpen(true)} style={{ marginTop: theme.spacing.sm, alignSelf: 'flex-start' }}>
          <AppText variant="captionMedium" tone="accent">
            {formatDayMonth(customRange.start)} → {formatDayMonth(customRange.end)} · edit
          </AppText>
        </Pressable>
      ) : null}

      <ScreenHint
        id="analytics"
        message="Every tab follows the period above. Tap a category, merchant or account to drill into the full report."
      />

      {query.loading && !data ? (
        <LoadingBlock label="Crunching numbers…" />
      ) : !data ? (
        <EmptyState title="No data yet" message="Add transactions to unlock insights." icon="analytics-outline" />
      ) : (
        <View style={{ gap: theme.spacing.xl }}>
          {tab === 'spending' ? (
            <>
              <TrendHeroCard
                title="Total spending"
                amount={data.summary.totals.netExpense}
                amountTone="neutral"
                change={spendingChange}
                invert
                rangeCaption={`${formatDayMonth(range.start)} – ${formatDayMonth(range.end)} · ${data.summary.totals.transactionCount} transactions`}
                points={data.trend.points.map((point) => ({
                  key: point.key,
                  label: point.label,
                  fullLabel: point.fullLabel,
                  value: point.net,
                }))}
                barColor={theme.colors.accent.base}
                emptyMessage="No spending recorded in this period yet."
              />

              {insight ? (
                <View
                  style={{
                    flexDirection: 'row',
                    gap: theme.spacing.sm,
                    alignItems: 'flex-start',
                    padding: theme.spacing.md,
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.accent.soft,
                  }}>
                  <Ionicons name={insight.icon} size={18} color={theme.colors.accent.base} />
                  <AppText variant="bodySmall" tone="secondary" style={{ flex: 1 }}>
                    {insight.text}
                  </AppText>
                </View>
              ) : null}

              <Section title="Categories" actionLabel="View all" onPress={() => router.push('/transactions')}>
                <CategoryCard
                  rows={data.categories.rows}
                  total={data.categories.total}
                  mode={categoryMode}
                  onModeChange={setCategoryMode}
                  emptyTitle="No spending yet"
                  emptyMessage="Add a few transactions to see your spending breakdown."
                />
              </Section>

              <Section title="Top merchants">
                <MerchantList merchants={data.merchants.slice(0, 5)} />
              </Section>
            </>
          ) : null}

          {tab === 'income' ? (
            <>
              <TrendHeroCard
                title="Total income"
                amount={data.summary.totals.income}
                amountTone="positive"
                change={incomeChange}
                rangeCaption={`${formatDayMonth(range.start)} – ${formatDayMonth(range.end)}`}
                points={data.trend.points.map((point) => ({
                  key: point.key,
                  label: point.label,
                  fullLabel: point.fullLabel,
                  value: point.income,
                }))}
                barColor={theme.colors.positive}
                emptyMessage="No income recorded in this period yet."
              />

              <Section title="Income sources">
                <CategoryCard
                  rows={data.incomeCategories.rows}
                  total={data.incomeCategories.total}
                  mode={incomeMode}
                  onModeChange={setIncomeMode}
                  emptyTitle="No income yet"
                  emptyMessage="Income shows up here once you record it, grouped by category."
                />
              </Section>

              <Section title="Income vs expenses">
                <Card>
                  {data.trend.points.some((point) => point.income > 0 || point.expense > 0) ? (
                    <>
                      <BarChart
                        points={data.trend.points.map((point) => ({ key: `e-${point.key}`, label: point.label, fullLabel: point.fullLabel, value: point.net }))}
                        secondary={data.trend.points.map((point) => ({ key: `i-${point.key}`, label: point.label, fullLabel: point.fullLabel, value: point.income }))}
                        height={150}
                        compactLabels
                      />
                      <View style={{ flexDirection: 'row', gap: theme.spacing.lg, marginTop: theme.spacing.md }}>
                        <Legend color={theme.colors.accent.base} label="Spending" />
                        <Legend color={theme.colors.positive} label="Income" />
                      </View>
                    </>
                  ) : (
                    <EmptyState compact icon="bar-chart-outline" title="No activity yet" message="Add a few transactions to see income and expenses over time." />
                  )}
                </Card>
              </Section>

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
            </>
          ) : null}

          {tab === 'netWorth' ? (
            <>
              <Section title="Net worth" onPress={() => router.push('/reports/health')}>
                <Card>
                  <View style={{ gap: theme.spacing.md }}>
                    <View style={{ gap: 4 }}>
                      <AppText variant="caption" tone="muted">
                        Net worth
                      </AppText>
                      <MoneyText amount={data.netWorthChanges.current} variant="numericLarge" tone="neutral" showSign={false} />
                      <AppText variant="caption" tone="muted">
                        {data.netWorthChanges.changeThisMonth >= 0 ? 'Up ' : 'Down '}
                        {money.format(Math.abs(data.netWorthChanges.changeThisMonth))} this month ·{' '}
                        {data.accounts.length} account{data.accounts.length === 1 ? '' : 's'}
                      </AppText>
                    </View>
                    <View style={{ marginHorizontal: -8 }}>
                      <LineChart
                        points={data.netWorthTrend.map((point) => ({ key: point.key, label: point.label, fullLabel: point.fullLabel, value: point.value }))}
                        height={140}
                        showArea
                        baseline="auto"
                      />
                    </View>
                    <Row justify="space-between">
                      <View>
                        <AppText variant="caption" tone="muted">
                          This month
                        </AppText>
                        <MoneyText amount={data.netWorthChanges.changeThisMonth} variant="numericSmall" tone="positive-negative" showSign />
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <AppText variant="caption" tone="muted">
                          vs last year
                        </AppText>
                        <MoneyText amount={data.netWorthChanges.changeThisYear} variant="numericSmall" tone="positive-negative" showSign />
                      </View>
                    </Row>
                  </View>
                </Card>
              </Section>

              <Section title="Health check">
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

              <Section title="Accounts" actionLabel="View all" onPress={() => router.push('/accounts')}>
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
                                  width: 36,
                                  height: 36,
                                  borderRadius: theme.radius.full,
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
            </>
          ) : null}

          {tab === 'trends' ? (
            <>
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
                        Compared with the previous {periodLabel} period
                      </AppText>
                    </View>
                  )}
                </Card>
              </Section>

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

              <Section title="Merchants" actionLabel="View all" onPress={() => router.push('/merchants')}>
                <MerchantList merchants={data.merchants} showChange />
              </Section>

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
          // Without this the applied range stayed inert (range memo keys off period).
          setPeriod('custom');
        }}
      />
    </HeaderScrollScreen>
  );
}

/* ------------------------------- Pieces ----------------------------------- */

function Section({ title, children, onPress, actionLabel }: { title: string; children: React.ReactNode; onPress?: () => void; actionLabel?: string }) {
  return (
    <View>
      <SectionHeader title={title} actionLabel={actionLabel ?? (onPress ? 'View' : undefined)} onAction={onPress} />
      {children}
    </View>
  );
}

/** The big-number card at the top of Spending / Income. */
function TrendHeroCard({
  title,
  amount,
  amountTone,
  change,
  invert,
  rangeCaption,
  points,
  barColor,
  emptyMessage,
}: {
  title: string;
  amount: number;
  amountTone: 'neutral' | 'positive' | 'negative';
  change: number | null;
  invert?: boolean;
  rangeCaption: string;
  points: { key: string; label: string; fullLabel?: string; value: number }[];
  barColor: string;
  emptyMessage: string;
}) {
  const theme = useTheme();
  return (
    <Card>
      <View style={{ gap: theme.spacing.md }}>
        <Row justify="space-between" align="flex-start">
          <View style={{ gap: 4, flex: 1, minWidth: 0 }}>
            <AppText variant="caption" tone="muted">
              {title}
            </AppText>
            <MoneyText amount={amount} variant="numericLarge" tone={amountTone} showSign={false} />
            <AppText variant="caption" tone="muted">
              {rangeCaption}
            </AppText>
          </View>
          <ChangePill change={change} invert={invert} />
        </Row>
        {points.some((point) => point.value > 0) ? (
          <BarChart points={points} height={120} color={barColor} compactLabels />
        ) : (
          <AppText variant="caption" tone="muted">
            {emptyMessage}
          </AppText>
        )}
      </View>
    </Card>
  );
}

/** Percent delta versus the previous period — arrow first, colour second. */
function ChangePill({ change, invert = false }: { change: number | null; invert?: boolean }) {
  const theme = useTheme();
  if (change === null) {
    return (
      <View style={{ paddingHorizontal: theme.spacing.sm, paddingVertical: 4, borderRadius: theme.radius.full, backgroundColor: theme.colors.pressed }}>
        <AppText variant="caption" tone="muted">
          No prior period
        </AppText>
      </View>
    );
  }
  const up = change >= 0;
  const good = invert ? !up : up;
  const color = good ? theme.colors.positive : theme.colors.negative;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 4,
        borderRadius: theme.radius.full,
        backgroundColor: `${color}1A`,
      }}>
      <Ionicons name={up ? 'arrow-up' : 'arrow-down'} size={12} color={color} />
      <AppText variant="numericCaption" style={{ color }}>
        {Math.abs(change) < 10 ? `${Math.abs(change).toFixed(1)}%` : `${Math.round(Math.abs(change))}%`}
      </AppText>
    </View>
  );
}

/** Amount / percentage toggle plus top categories with share bars. */
function CategoryCard({
  rows,
  total,
  mode,
  onModeChange,
  emptyTitle,
  emptyMessage,
}: {
  rows: CategoryBreakdownRow[];
  total: number;
  mode: AmountMode;
  onModeChange: (mode: AmountMode) => void;
  emptyTitle: string;
  emptyMessage: string;
}) {
  const theme = useTheme();
  const money = useMoney();
  const visible = rows.slice(0, 5);
  const rest = rows.slice(5);
  const restTotal = rest.reduce((sum, row) => sum + row.total, 0);
  const restCount = rest.reduce((sum, row) => sum + row.count, 0);
  const restShare = total > 0 ? (restTotal / total) * 100 : 0;

  return (
    <Card>
      <View style={{ gap: theme.spacing.lg }}>
        <Row justify="space-between">
          <AppText variant="caption" tone="muted">
            {mode === 'amount' ? 'Amount' : 'Percentage'} view
          </AppText>
          <SegmentedControl
            options={[
              { value: 'amount', label: 'Amount' },
              { value: 'percent', label: '%' },
            ]}
            value={mode}
            onChange={onModeChange}
            style={{ minWidth: 150 }}
          />
        </Row>

        {rows.length === 0 ? (
          <EmptyState compact icon="pie-chart-outline" title={emptyTitle} message={emptyMessage} />
        ) : (
          <View style={{ gap: theme.spacing.lg }}>
            {visible.map((row) => (
              <CategoryRow key={row.categoryId ?? 'none'} row={row} total={total} mode={mode} />
            ))}
            {rest.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Row gap="sm">
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: theme.radius.full,
                      backgroundColor: theme.colors.pressed,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <Ionicons name="ellipsis-horizontal" size={17} color={theme.colors.muted} />
                  </View>
                  <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                    <AppText variant="bodySmall" numberOfLines={1}>
                      Others
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {restCount} transaction{restCount === 1 ? '' : 's'} · {rest.length} categories
                    </AppText>
                  </View>
                  <AppText variant="numericSmall" tone="secondary">
                    {mode === 'amount' ? money.format(restTotal, { absolute: true }) : formatPercent(restShare, 0)}
                  </AppText>
                </Row>
                <ProgressBar progress={restShare} height={6} color={theme.colors.muted} />
              </View>
            ) : null}
          </View>
        )}
      </View>
    </Card>
  );
}

function CategoryRow({ row, total, mode }: { row: CategoryBreakdownRow; total: number; mode: AmountMode }) {
  const theme = useTheme();
  const money = useMoney();
  const share = total > 0 ? (row.total / total) * 100 : row.share;
  return (
    <Pressable
      onPress={row.categoryId ? () => router.push(`/category/${row.categoryId}` as never) : undefined}
      style={{ gap: 8 }}>
      <Row gap="sm">
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: theme.radius.full,
            backgroundColor: `${row.color}22`,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Ionicons name={row.icon as IconName} size={17} color={row.color} />
        </View>
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <AppText variant="bodySmall" numberOfLines={1}>
            {row.name}
          </AppText>
          <AppText variant="caption" tone="muted">
            {row.count} transaction{row.count === 1 ? '' : 's'} · {formatPercent(share, 0)}
          </AppText>
        </View>
        <AppText variant="numericSmall" tone="secondary">
          {mode === 'amount' ? money.format(row.total, { absolute: true }) : formatPercent(row.share, 0)}
        </AppText>
      </Row>
      <ProgressBar progress={share} height={6} color={row.color} />
    </Pressable>
  );
}

/** Compact merchant list used by Spending (top 5) and Trends (all + deltas). */
function MerchantList({
  merchants,
  showChange,
}: {
  merchants: { name: string; total: number; count: number; average: number; change: number | null }[];
  showChange?: boolean;
}) {
  const theme = useTheme();
  const money = useMoney();
  if (merchants.length === 0) {
    return (
      <Card>
        <EmptyState compact icon="storefront-outline" title="No merchant data" message="Merchants appear once you record merchant names." />
      </Card>
    );
  }
  return (
    <Card>
      {merchants.map((merchant, index) => (
        <View key={merchant.name}>
          {index > 0 ? (
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border }} />
          ) : null}
          <Pressable
            onPress={() => router.push(`/merchant/${encodeURIComponent(merchant.name)}` as never)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11 }}>
            <View style={{ flex: 1, gap: 2, marginRight: 12, minWidth: 0 }}>
              <AppText variant="bodySmall" numberOfLines={1}>
                {merchant.name}
              </AppText>
              <AppText variant="caption" tone="muted">
                {merchant.count}× · avg {money.format(merchant.average)}
                {showChange && merchant.change !== null
                  ? ` · ${merchant.change > 0 ? '+' : '−'}${formatPercent(Math.abs(merchant.change), 0)}`
                  : ''}
              </AppText>
            </View>
            <MoneyText amount={merchant.total} variant="numericSmall" tone="neutral" showSign={false} />
          </Pressable>
        </View>
      ))}
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: color }} />
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
