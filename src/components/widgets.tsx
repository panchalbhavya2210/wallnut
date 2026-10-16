import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { mixHex } from '@/theme/palette';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText, MoneyText } from './ui/text';
import { Card, IconName, Row, SectionHeader } from './ui/layout';
import { ProgressBar } from './ui/controls';
import { EmptyState, LoadingBlock } from './ui/feedback';
import { FlowBars, LineChart, BarChart, DonutChart, Sparkline } from './charts';
import { AnimatedMoney, Gauge } from './Gauge';
import { useChartColors } from '@/hooks/useChartColors';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { getPeriodRange, daysInRange, formatDayMonth, formatMonthYear, previousRange, toISODate, type PeriodPreset } from '@/utils/date';
import { percentageChange } from '@/utils/money';
import { formatPercent } from '@/utils/money';
import { shortCategoryLabel } from '@/utils/format';
import {
  getAccountBalanceTrend,
  getAccountScopeSummary,
  getCategoryBreakdown,
  getCategoryMonthlyTrends,
  getDailySpendingStats,
  getLargestExpenses,
  getNetWorthChanges,
  getNetWorthSummary,
  getNetWorthTrend,
  getPeriodSummary,
  getRecentLedgerTransactions,
  getSpendingVelocity,
  getTopMerchants,
  getTrend,
} from '@/services/analytics.service';
import { getBudgetProgressList } from '@/services/budgets.service';
import { getGoalsProgress } from '@/services/goals.service';
import { getSafeToSpend } from '@/services/safe-to-spend.service';
import { getDebtOverview } from '@/services/debts.service';
import { getSubscriptionSummary, getUpcoming } from '@/services/recurring.service';
import { getFinancialHealth, getReminders } from '@/services/reports.service';
import { getReviewQueue } from '@/services/review.service';
import { isSpendable } from '@/services/accounts.service';
import type { DashboardWidget } from '@/db/schema';

/**
 * Dashboard widget registry. Each widget is independent: it reads its own
 * configuration (period/accounts/categories) and queries the database directly,
 * so one global filter never silently changes every card.
 */

export interface WidgetConfig {
  period?: PeriodPreset;
  accountIds?: string[];
  categoryIds?: string[];
  showAverage?: boolean;
  chart?: 'line' | 'bar';
  compactNumbers?: boolean;
}

export interface WidgetProps {
  widget: DashboardWidget;
  config: WidgetConfig;
  onNavigate: (href: string) => void;
  editing?: boolean;
}

export interface WidgetDefinition {
  type: string;
  title: string;
  description: string;
  icon: IconName;
  defaultWidth: 'full' | 'half';
  defaultHeight: 'compact' | 'medium' | 'tall';
  Component: React.FC<WidgetProps>;
}

/* ------------------------------- Shared shell ------------------------------- */

export function WidgetCard({
  title,
  subtitle,
  actionLabel,
  onAction,
  children,
  onPress,
  bare,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
  onPress?: () => void;
  /** Gradient hero variant used for the net-worth card. */
  bare?: boolean;
}) {
  const theme = useTheme();
  const onGradient = Boolean(bare) && theme.mode === 'dark';
  const header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: theme.spacing.md,
        gap: theme.spacing.sm,
      }}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="label" style={onGradient ? { color: 'rgba(255, 255, 255, 0.85)' } : undefined}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone={onGradient ? undefined : 'secondary'} style={onGradient ? { color: 'rgba(255, 255, 255, 0.72)' } : undefined}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={10}>
          <AppText variant="captionMedium" tone={onGradient ? undefined : 'accent'} style={onGradient ? { color: '#FFFFFF' } : undefined}>
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );

  const body = (
    <Pressable onPress={onPress} disabled={!onPress}>
      {children}
    </Pressable>
  );

  if (bare) {
    // Deep tonal gradient hero: the accent is mixed into the canvas rather
    // than flooded raw, so white text stays crisp and the accent line pops.
    const gradientColors =
      theme.mode === 'dark'
        ? ([mixHex(theme.gradient[0], theme.colors.background, 0.4), mixHex(theme.gradient[1], theme.colors.background, 0.26)] as const)
        : ([`${theme.gradient[0]}2E`, `${theme.gradient[1]}1F`] as const);
    return (
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          padding: theme.spacing.lg,
          borderRadius: theme.radius.xxl,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.mode === 'dark' ? `${theme.gradient[0]}66` : theme.colors.border,
        }}>
        {header}
        {body}
      </LinearGradient>
    );
  }

  return (
    <Card style={{ gap: 0 }}>
      {header}
      {body}
    </Card>
  );
}

function WidgetEmpty({ message, icon }: { message: string; icon?: IconName }) {
  const theme = useTheme();
  return (
    <View style={{ paddingVertical: theme.spacing.xl, alignItems: 'center', gap: theme.spacing.sm }}>
      <Ionicons name={icon ?? 'analytics-outline'} size={22} color={theme.colors.muted} />
      <AppText variant="bodySmall" tone="muted" style={{ textAlign: 'center', maxWidth: 240 }}>
        {message}
      </AppText>
    </View>
  );
}

function WidgetLoading() {
  return <LoadingBlock />;
}

function useWidgetPeriod(config: WidgetConfig): PeriodPreset {
  const defaultPeriod = useSettingsStore((state) => state.dashboard.defaultPeriod);
  return config.period ?? defaultPeriod;
}

function useRange(config: WidgetConfig) {
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const period = useWidgetPeriod(config);
  return React.useMemo(() => getPeriodRange(period, { monthStartDay }), [period, monthStartDay]);
}

/* ------------------------------- Money widgets ------------------------------ */

const NetWorthWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const theme = useTheme();
  const money = useMoney();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const scopeAccountId = config.accountIds?.[0] ?? null;
  const { data, loading } = useQuery(async () => {
    if (scopeAccountId) {
      const [scope, trend] = await Promise.all([
        getAccountScopeSummary(scopeAccountId, monthStartDay),
        getAccountBalanceTrend(scopeAccountId, getPeriodRange('6m', { monthStartDay }), 'month'),
      ]);
      return { summary: null, changes: null, scope, trend };
    }
    const [summary, changes, trend] = await Promise.all([
      getNetWorthSummary(),
      getNetWorthChanges(monthStartDay),
      getNetWorthTrend(getPeriodRange('6m', { monthStartDay }), 'month'),
    ]);
    return { summary, changes, scope: null, trend };
  }, [monthStartDay, scopeAccountId]);

  if (loading || !data) return <WidgetCard title="NET WORTH"><WidgetLoading /></WidgetCard>;

  if (data.scope) {
    const { scope } = data;
    const change = scope.changeThisMonth;
    const base = scope.balance - change;
    const changePercent = base !== 0 ? (change / Math.abs(base)) * 100 : null;
    return (
      <WidgetCard
        bare
        title={scope.account?.name?.toUpperCase() ?? 'ACCOUNT BALANCE'}
        subtitle="Account balance"
        onPress={() => scope.account && onNavigate(`/account/${scope.account.id}`)}>
        <View style={{ gap: 6 }}>
          <AnimatedMoney amount={scope.balance} variant="numericLarge" tone="neutral" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Ionicons name={change >= 0 ? 'trending-up-outline' : 'trending-down-outline'} size={14} color={theme.colors.muted} />
            <MoneyText amount={change} variant="numericCaption" tone="positive-negative" showSign absolute={false} />
            {changePercent !== null ? (
              <AppText variant="caption" tone={changePercent >= 0 ? 'positive' : 'negative'}>
                {changePercent >= 0 ? '+' : '−'}
                {formatPercent(Math.abs(changePercent), 1)}
              </AppText>
            ) : null}
            <AppText variant="caption" tone="muted">
              this month
            </AppText>
          </View>
          <View style={{ marginTop: 10, marginHorizontal: -8 }}>
            <LineChart
              points={scope.trend.map((point) => ({ key: point.key, label: point.label, fullLabel: point.fullLabel, value: point.value }))}
              height={150}
              showArea
              baseline="auto"
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
            <AppText variant="caption" tone="muted">
              {scope.account?.type?.replace('_', ' ') ?? 'Account'}
            </AppText>
            <AppText variant="caption" tone="muted">
              Tap for details
            </AppText>
          </View>
        </View>
      </WidgetCard>
    );
  }

  const { summary, changes, trend } = data;
  if (!summary || !changes) return null;
  const heroBase = summary.netWorth - changes.changeThisMonth;
  const heroPercent = heroBase !== 0 ? (changes.changeThisMonth / Math.abs(heroBase)) * 100 : null;

  return (
    <WidgetCard bare title="NET WORTH" onPress={() => onNavigate('/accounts')}>
      <View style={{ gap: 6 }}>
        <AnimatedMoney amount={summary.netWorth} variant="numericLarge" tone="neutral" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Ionicons
            name={changes.changeThisMonth >= 0 ? 'trending-up-outline' : 'trending-down-outline'}
            size={14}
            color={undefined}
          />
          <MoneyText
            amount={changes.changeThisMonth}
            variant="numericCaption"
            tone="positive-negative"
            showSign
            absolute={false}
          />
          {heroPercent !== null ? (
            <AppText variant="caption" tone={heroPercent >= 0 ? 'positive' : 'negative'}>
              {heroPercent >= 0 ? '+' : '−'}
              {formatPercent(Math.abs(heroPercent), 1)}
            </AppText>
          ) : null}
          <AppText variant="caption" tone="muted">
            this month
          </AppText>
        </View>
        <View style={{ marginTop: 10, marginHorizontal: -8 }}>
          <LineChart
            points={trend.map((point) => ({ key: point.key, label: point.label, fullLabel: point.fullLabel, value: point.value }))}
            height={150}
            showArea
            baseline="auto"
          />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
          <AppText variant="caption" tone="muted">
            Assets {money.format(summary.assetsTotal, { compact: true })}
          </AppText>
          <AppText variant="caption" tone="muted">
            Liabilities {money.format(Math.abs(summary.liabilitiesTotal), { compact: true })}
          </AppText>
        </View>
      </View>
    </WidgetCard>
  );
};

const SafeToSpendWidget: React.FC<WidgetProps> = ({ onNavigate }) => {
  const money = useMoney();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const { data, loading } = useQuery(() => getSafeToSpend(monthStartDay), [monthStartDay]);
  if (loading || !data) return <WidgetCard title="SAFE TO SPEND"><WidgetLoading /></WidgetCard>;

  const rows = [
    { label: 'Available cash', amount: data.available, negative: false },
    { label: 'Upcoming bills', amount: data.upcomingBills, negative: true },
    { label: 'Planned savings', amount: data.plannedSavings, negative: true },
    { label: 'Budget commitments', amount: data.budgetCommitments, negative: true },
  ].filter((row) => row.amount > 0 || !row.negative);

  return (
    <WidgetCard
      title="SAFE TO SPEND"
      subtitle={
        data.nextIncomeDate && data.nextIncomeLabel
          ? `Until ${data.nextIncomeLabel} · ${formatDayMonth(new Date(data.nextIncomeDate))}`
          : `For the next ${data.days} days`
      }
      onPress={() => onNavigate('/budgets')}>
      <AppText variant="numericMedium" tone={data.safe > 0 ? 'positive' : 'negative'}>
        {money.format(data.safe)}
      </AppText>
      <View style={{ gap: 7, marginTop: 12 }}>
        {rows.map((row) => (
          <Row key={row.label} justify="space-between">
            <AppText variant="caption" tone="muted">
              {row.label}
            </AppText>
            <AppText variant="numericCaption" tone={row.negative ? 'negative' : 'secondary'}>
              {row.negative ? '− ' : ''}
              {money.format(Math.abs(row.amount))}
            </AppText>
          </Row>
        ))}
      </View>
      <AppText variant="caption" tone="muted" style={{ marginTop: 10 }}>
        ≈ {money.format(data.perDay)}/day for the next {data.days} day{data.days === 1 ? '' : 's'}
      </AppText>
    </WidgetCard>
  );
};

const TotalBalanceWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {  const money = useMoney();
  const scopeAccountId = config.accountIds?.[0] ?? null;
  const { data, loading } = useQuery(() => getNetWorthSummary(config.accountIds), [config.accountIds?.join(',')]);
  if (loading || !data) return <WidgetCard title="TOTAL BALANCE"><WidgetLoading /></WidgetCard>;
  const liquid = data.accounts
    .filter((account) => account.includeInTotalBalance && isSpendable(account.type))
    .reduce((sum, account) => sum + account.currentBalance, 0);
  const count = data.accounts.filter((account) => account.includeInTotalBalance).length;
  return (
    <WidgetCard title="TOTAL BALANCE" actionLabel="Accounts" onAction={() => onNavigate('/accounts')} onPress={() => onNavigate('/accounts')}>
      <AppText variant="numericMedium">{money.format(liquid)}</AppText>
      <AppText variant="caption" tone="muted" style={{ marginTop: 4 }}>
        {scopeAccountId ? 'This account' : `Across ${count} account${count === 1 ? '' : 's'}`}
      </AppText>
    </WidgetCard>
  );
};

const IncomeExpenseWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const theme = useTheme();
  const money = useMoney();
  const range = useRange(config);
  const { data, loading } = useQuery(
    () => getPeriodSummary({ range, accountIds: config.accountIds }),
    [range.start.getTime(), range.end.getTime(), config.accountIds?.join(',')],
  );
  if (loading || !data) return <WidgetCard title="CASH FLOW"><WidgetLoading /></WidgetCard>;
  const { totals } = data;

  if (totals.income === 0 && totals.expenses === 0) {
    return (
      <WidgetCard title="CASH FLOW">
        <WidgetEmpty message="No income or spending recorded in this period." icon="swap-vertical-outline" />
      </WidgetCard>
    );
  }

  const max = Math.max(totals.income, totals.netExpense, 1);

  return (
    <WidgetCard title="CASH FLOW" onPress={() => onNavigate('/reports/cashflow')}>
      <View style={{ gap: 14 }}>
        <View style={{ gap: 7 }}>
          <Row justify="space-between">
            <AppText variant="bodySmall" tone="secondary">
              Income
            </AppText>
            <MoneyText amount={totals.income} variant="numericSmall" tone="positive-negative" />
          </Row>
          <ProgressBar progress={(totals.income / max) * 100} height={8} color={theme.colors.positive} />
        </View>
        <View style={{ gap: 7 }}>
          <Row justify="space-between">
            <AppText variant="bodySmall" tone="secondary">
              Expenses
            </AppText>
            <MoneyText amount={-totals.netExpense} variant="numericSmall" tone="positive-negative" />
          </Row>
          <ProgressBar progress={(totals.netExpense / max) * 100} height={8} color={theme.colors.negative} />
        </View>
        <Row gap="lg" style={{ marginTop: 2 }}>
          <View style={{ flex: 1 }}>
            <AppText variant="caption" tone="muted">
              Saved
            </AppText>
            <MoneyText amount={totals.savings} variant="numericSmall" tone="positive-negative" showSign />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="caption" tone="muted">
              Savings rate
            </AppText>
            <AppText variant="numericSmall">{money.format(totals.savings, { compact: true })} · {formatPercent(totals.savingsRate, 0)}</AppText>
          </View>
        </Row>
      </View>
    </WidgetCard>
  );
};

const SpendingTotalWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const money = useMoney();
  const range = useRange(config);
  const { data, loading } = useQuery(() => getPeriodSummary({ range, accountIds: config.accountIds }), [range.start.getTime(), range.end.getTime()]);
  if (loading || !data) return <WidgetCard title="SPENDING"><WidgetLoading /></WidgetCard>;
  const change = percentageChange(data.totals.netExpense, data.previous.netExpense);
  return (
    <WidgetCard title="SPENDING" onPress={() => onNavigate('/analytics')}>
      <AppText variant="numericMedium">{money.format(data.totals.netExpense)}</AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
        {change === null ? (
          <AppText variant="caption" tone="muted">
            No previous data
          </AppText>
        ) : (
          <>
            <Ionicons name={change > 0 ? 'arrow-up' : 'arrow-down'} size={12} color={change > 0 ? undefined : undefined} />
            <AppText variant="caption" tone={change > 0 ? 'negative' : 'positive'}>
              {formatPercent(Math.abs(change), 0)} vs previous
            </AppText>
          </>
        )}
      </View>
    </WidgetCard>
  );
};

const SavingsRateWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const theme = useTheme();
  const money = useMoney();
  const range = useRange(config);
  const { data, loading } = useQuery(
    () => getPeriodSummary({ range, accountIds: config.accountIds }),
    [range.start.getTime(), range.end.getTime(), config.accountIds?.join(',')],
  );
  if (loading || !data) return <WidgetCard title="SAVINGS RATE"><WidgetLoading /></WidgetCard>;
  const rate = data.totals.savingsRate;
  const tone = rate >= 20 ? 'positive' : rate >= 0 ? 'accent' : 'negative';
  return (
    <WidgetCard title="SAVINGS RATE" onPress={() => onNavigate('/reports/monthly')}>
      <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <Gauge
          progress={rate}
          size={124}
          thickness={11}
          tone={tone as never}
          label={`${Math.round(rate)}%`}
          caption={data.totals.income > 0 ? `${money.format(data.totals.savings, { compact: true })} kept` : 'No income'}
        />
      </View>
    </WidgetCard>
  );
};

const SpendingPaceWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const money = useMoney();
  const range = useRange(config);
  const { data, loading } = useQuery(
    () => getSpendingVelocity({ range, accountIds: config.accountIds }),
    [range.start.getTime(), range.end.getTime(), config.accountIds?.join(',')],
  );
  if (loading || !data) return <WidgetCard title="SPENDING PACE"><WidgetLoading /></WidgetCard>;
  const expectedPerDay = data.daysInPeriod > 0 ? data.previousTotal / data.daysInPeriod : 0;
  const diff = data.currentPerDay - expectedPerDay;
  return (
    <WidgetCard title="SPENDING PACE" onPress={() => onNavigate('/analytics')}>
      <AppText variant="numericMedium">
        {money.format(data.currentPerDay)}
        <AppText variant="caption" tone="muted">
          /day
        </AppText>
      </AppText>
      <AppText variant="caption" tone="muted" style={{ marginTop: 6 }}>
        Day {data.daysElapsed} of {data.daysInPeriod} · previous {money.format(data.previousPerDay)}/day
      </AppText>
      <AppText variant="bodySmall" tone={diff > 0 ? 'negative' : 'positive'} style={{ marginTop: 10 }}>
        {diff >= 0
          ? `You are spending ${money.format(Math.abs(diff))} more per day`
          : `You are spending ${money.format(Math.abs(diff))} less per day`}
      </AppText>
      <AppText variant="caption" tone="muted" style={{ marginTop: 6 }}>
        Projected month-end · {money.format(data.projectedTotal)}
      </AppText>
    </WidgetCard>
  );
};

const SpendingTrendWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const money = useMoney();
  const range = useRange(config);
  const { data, loading } = useQuery(
    () => getTrend({ range, accountIds: config.accountIds }, undefined, ['expense']),
    [range.start.getTime(), range.end.getTime()],
  );
  if (loading || !data) return <WidgetCard title="SPENDING TREND"><WidgetLoading /></WidgetCard>;
  const points = data.points.filter((point) => point.net > 0);
  if (points.length === 0) {
    return (
      <WidgetCard title="SPENDING TREND">
        <WidgetEmpty message="No spending data yet. Add a few transactions to see your trend." icon="trending-up-outline" />
      </WidgetCard>
    );
  }
  return (
    <WidgetCard title="SPENDING TREND" subtitle={`Average ${money.format(data.average)}`} onPress={() => onNavigate('/analytics')}>
      {config.chart === 'bar' ? (
        <BarChart points={data.points.map((point) => ({ key: point.key, label: point.label, fullLabel: point.fullLabel, value: point.net }))} height={150} />
      ) : (
        <LineChart
          points={data.points.map((point) => ({ key: point.key, label: point.label, fullLabel: point.fullLabel, value: point.net }))}
          height={150}
          showAverage={config.showAverage !== false}
        />
      )}
    </WidgetCard>
  );
};

const CategoryBreakdownWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const money = useMoney();
  const chart = useChartColors();
  const range = useRange(config);
  const { data, loading } = useQuery(() => getCategoryBreakdown({ range, accountIds: config.accountIds }), [range.start.getTime(), range.end.getTime()]);
  if (loading || !data) return <WidgetCard title="SPENDING CATEGORIES"><WidgetLoading /></WidgetCard>;
  if (data.rows.length === 0) {
    return (
      <WidgetCard title="SPENDING CATEGORIES">
        <WidgetEmpty message="No categories to show for this period." icon="pie-chart-outline" />
      </WidgetCard>
    );
  }
  const top = data.rows.slice(0, 5);
  return (
    <WidgetCard title="SPENDING CATEGORIES" actionLabel="Analytics" onAction={() => onNavigate('/analytics')}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
        <DonutChart
          size={140}
          thickness={18}
          slices={top.map((row, index) => ({ id: row.categoryId ?? 'none', label: row.name, value: row.total, color: chart.slice(index, row.color) }))}
          centerTop="Total"
          centerBottom={money.format(data.total, { compact: true })}
        />
        <View style={{ flex: 1, gap: 10 }}>
          {top.slice(0, 4).map((row, index) => (
            <Pressable
              key={row.categoryId ?? 'none'}
              onPress={() => (row.categoryId ? onNavigate(`/category/${row.categoryId}`) : undefined)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
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
      </View>
    </WidgetCard>
  );
};

const BudgetProgressWidget: React.FC<WidgetProps> = ({ onNavigate }) => {
  const theme = useTheme();
  const money = useMoney();
  const { data, loading } = useQuery(() => getBudgetProgressList(), []);
  if (loading || !data) return <WidgetCard title="BUDGETS"><WidgetLoading /></WidgetCard>;
  if (data.length === 0) {
    return (
      <WidgetCard title="BUDGETS" actionLabel="Set up" onAction={() => onNavigate('/budgets')}>
        <WidgetEmpty message="No budgets yet. Create one to track category spending limits." icon="wallet-outline" />
      </WidgetCard>
    );
  }
  return (
    <WidgetCard title="BUDGETS" subtitle={`${data.length} active`} actionLabel="All" onAction={() => onNavigate('/budgets')}>
      <View style={{ gap: 18 }}>
        {data.slice(0, 3).map((budget) => (
          <Pressable key={budget.budget.id} onPress={() => onNavigate(`/budget/${budget.budget.id}`)} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <AppText variant="bodyMedium" numberOfLines={1} style={{ flex: 1, marginRight: 8 }}>
                {budget.categoryName}
              </AppText>
              <AppText variant="numericSmall" tone={budget.percent > 100 ? 'negative' : 'primary'}>
                {money.format(budget.spent)}
                <AppText variant="caption" tone="muted"> of {money.format(budget.budget.amount)}</AppText>
              </AppText>
            </View>
            <ProgressBar
              progress={budget.percent}
              height={7}
              color={
                budget.percent >= 100
                  ? theme.colors.negative
                  : budget.percent >= 85
                    ? theme.colors.warning
                    : theme.colors.positive
              }
            />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <AppText variant="caption" tone={budget.remaining >= 0 ? 'secondary' : 'negative'}>
                {budget.remaining >= 0 ? `${money.format(budget.remaining)} remaining` : `${money.format(Math.abs(budget.remaining))} over budget`}
              </AppText>
              {budget.remaining >= 0 ? (
                <AppText variant="caption" tone="muted">
                  {money.format(budget.safeToSpendPerDay)}/day safe
                </AppText>
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
    </WidgetCard>
  );
};

const RecentTransactionsWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const theme = useTheme();
  const range = React.useMemo(() => getPeriodRange('30d', {}), []);
  const { data, loading } = useQuery(
    () => getRecentLedgerTransactions({ range, accountIds: config.accountIds }, 6, true),
    [config.accountIds?.join(',')],
  );
  if (loading || !data) return <WidgetCard title="RECENT"><WidgetLoading /></WidgetCard>;
  if (data.length === 0) {
    return (
      <WidgetCard title="RECENT">
        <WidgetEmpty message="No transactions yet." icon="receipt-outline" />
      </WidgetCard>
    );
  }
  return (
    <WidgetCard title="RECENT" actionLabel="All" onAction={() => onNavigate('/transactions')}>
      <View style={{ gap: 2 }}>
        {data.map((row) => (
          <Pressable
            key={`${row.id}-${row.categoryId ?? 'none'}`}
            onPress={() => onNavigate(`/transaction/${row.id}`)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 }}>
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 11,
                backgroundColor: `${row.categoryColor ?? theme.colors.muted}22`,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Ionicons name={(row.categoryIcon as IconName) ?? 'pricetag-outline'} size={16} color={row.categoryColor ?? theme.colors.muted} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <AppText variant="bodySmall" numberOfLines={1}>
                {row.merchant ?? row.description ?? row.categoryName ?? 'Transaction'}
              </AppText>
              <AppText variant="caption" tone="muted" numberOfLines={1}>
                {row.categoryName ?? 'Uncategorised'} · {row.accountName}
              </AppText>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 1 }}>
              <MoneyText amount={row.amount} variant="numericSmall" tone={row.isTransfer ? 'neutral' : 'auto'} />
              <AppText variant="caption" tone="muted">
                {formatDayMonth(new Date(row.date))}
              </AppText>
            </View>
          </Pressable>
        ))}
      </View>
    </WidgetCard>
  );
};

const TopMerchantsWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const theme = useTheme();
  const money = useMoney();
  const range = useRange(config);
  const { data, loading } = useQuery(() => getTopMerchants({ range, accountIds: config.accountIds }, 5), [range.start.getTime(), range.end.getTime()]);
  if (loading || !data) return <WidgetCard title="TOP MERCHANTS"><WidgetLoading /></WidgetCard>;
  if (data.length === 0) {
    return (
      <WidgetCard title="TOP MERCHANTS">
        <WidgetEmpty message="No merchant data for this period." icon="storefront-outline" />
      </WidgetCard>
    );
  }
  const max = Math.max(...data.map((row) => row.total), 1);
  return (
    <WidgetCard title="TOP MERCHANTS">
      <View style={{ gap: 14 }}>
        {data.map((row) => (
          <Pressable key={row.name} onPress={() => onNavigate(`/merchant/${encodeURIComponent(row.name)}`)} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <AppText variant="bodySmall" numberOfLines={1} style={{ flex: 1, marginRight: 8 }}>
                {row.name}
              </AppText>
              <AppText variant="numericCaption" tone="secondary">
                {money.format(row.total)} · {row.count}×
              </AppText>
            </View>
            <ProgressBar progress={(row.total / max) * 100} height={5} color={theme.colors.accent.base} />
          </Pressable>
        ))}
      </View>
    </WidgetCard>
  );
};

const LargestExpensesWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const money = useMoney();
  const range = useRange(config);
  const { data, loading } = useQuery(
    () => getLargestExpenses({ range, accountIds: config.accountIds }, 5),
    [range.start.getTime(), range.end.getTime(), config.accountIds?.join(',')],
  );
  if (loading || !data) return <WidgetCard title="LARGEST EXPENSES"><WidgetLoading /></WidgetCard>;
  if (data.length === 0) {
    return (
      <WidgetCard title="LARGEST EXPENSES">
        <WidgetEmpty message="Nothing to show for this period." icon="podium-outline" />
      </WidgetCard>
    );
  }
  return (
    <WidgetCard title="LARGEST EXPENSES">
      <View style={{ gap: 2 }}>
        {data.map((row) => (
          <Pressable
            key={row.id}
            onPress={() => onNavigate(`/transaction/${row.id}`)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 }}>
            <View style={{ flex: 1 }}>
              <AppText variant="bodySmall" numberOfLines={1}>
                {row.merchant ?? row.description ?? row.categoryName ?? 'Expense'}
              </AppText>
              <AppText variant="caption" tone="muted">
                {formatDayMonth(new Date(row.date))} · {row.categoryName ?? 'Uncategorised'}
              </AppText>
            </View>
            <MoneyText amount={-Math.abs(row.amount)} variant="numericCaption" />
          </Pressable>
        ))}
      </View>
    </WidgetCard>
  );
};

const AccountBalancesWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const theme = useTheme();
  const money = useMoney();
  const scopeAccountId = config.accountIds?.[0] ?? null;
  const { data, loading } = useQuery(() => getNetWorthSummary(config.accountIds), [config.accountIds?.join(',')]);
  if (loading || !data) return <WidgetCard title="ACCOUNTS"><WidgetLoading /></WidgetCard>;
  const visible = data.accounts.filter((account) => account.visibleOnDashboard);
  if (visible.length === 0) {
    return (
      <WidgetCard title="ACCOUNTS" actionLabel="Add" onAction={() => onNavigate('/accounts')}>
        <WidgetEmpty message="No accounts yet." icon="wallet-outline" />
      </WidgetCard>
    );
  }
  return (
    <WidgetCard title="ACCOUNTS" actionLabel="All" onAction={() => onNavigate('/accounts')}>
      <View style={{ gap: 2 }}>
        {visible.slice(0, scopeAccountId ? 1 : 5).map((account) => (
          <Pressable
            key={account.id}
            onPress={() => onNavigate(`/account/${account.id}`)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: account.color ?? theme.colors.accent.base }} />
              <AppText variant="bodySmall">{account.name}</AppText>
            </View>
            <MoneyText amount={account.currentBalance} variant="numericCaption" tone="neutral" />
          </Pressable>
        ))}
      </View>
    </WidgetCard>
  );
};

const NetWorthTrendWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const money = useMoney();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const period = config.period ?? '1y';
  const scopeAccountId = config.accountIds?.[0] ?? null;
  const { data, loading } = useQuery(async () => {
    if (scopeAccountId) return getAccountBalanceTrend(scopeAccountId, getPeriodRange(period, { monthStartDay }), 'month');
    return getNetWorthTrend(getPeriodRange(period, { monthStartDay }), 'month');
  }, [period, monthStartDay, scopeAccountId]);
  if (loading || !data) return <WidgetCard title="NET WORTH TREND"><WidgetLoading /></WidgetCard>;
  if (data.length < 2) {
    return (
      <WidgetCard title="NET WORTH TREND">
        <WidgetEmpty message="Add more history to see your net worth trend." icon="trending-up-outline" />
      </WidgetCard>
    );
  }
  const first = data[0]!.value;
  const last = data[data.length - 1]!.value;
  const change = percentageChange(last, first);
  return (
    <WidgetCard
      title={scopeAccountId ? 'BALANCE TREND' : 'NET WORTH TREND'}
      subtitle={change === null ? undefined : `${change >= 0 ? '+' : '−'}${formatPercent(Math.abs(change), 1)} over the period`}
      onPress={() => onNavigate(scopeAccountId ? `/account/${scopeAccountId}` : '/reports/health')}>
      <LineChart
        points={data.map((point) => ({ key: point.key, label: point.label, fullLabel: point.fullLabel, value: point.value }))}
        height={150}
        baseline="auto"
      />
    </WidgetCard>
  );
};

const MonthlyComparisonWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const theme = useTheme();
  const money = useMoney();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const { data, loading } = useQuery(async () => {
    const range = getPeriodRange('thisMonth', { monthStartDay });
    const prev = previousRange(range);
    const [current, previous] = await Promise.all([
      getCategoryBreakdown({ range, accountIds: config.accountIds }),
      getCategoryBreakdown({ range: prev, accountIds: config.accountIds }),
    ]);
    return { current, previous };
  }, [monthStartDay, config.accountIds?.join(',')]);
  if (loading || !data) return <WidgetCard title="MONTHLY COMPARISON"><WidgetLoading /></WidgetCard>;
  const previousMap = new Map(data.previous.rows.map((row) => [row.categoryId ?? 'none', row.total]));
  const comparisons = data.current.rows.slice(0, 5).map((row) => {
    const previous = previousMap.get(row.categoryId ?? 'none') ?? 0;
    return { ...row, previous, change: percentageChange(row.total, previous) };
  });
  if (comparisons.length === 0) {
    return (
      <WidgetCard title="MONTHLY COMPARISON">
        <WidgetEmpty message="No spending to compare yet." icon="calendar-outline" />
      </WidgetCard>
    );
  }
  return (
    <WidgetCard title="MONTHLY COMPARISON" subtitle="This month vs last" actionLabel="Review" onAction={() => onNavigate('/reports/monthly')}>
      <View style={{ gap: 2 }}>
        {comparisons.map((row) => (
          <Pressable
            key={row.categoryId ?? 'none'}
            onPress={() => (row.categoryId ? onNavigate(`/category/${row.categoryId}`) : undefined)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: row.color }} />
              <AppText variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>
                {row.name}
              </AppText>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <AppText variant="numericCaption" tone="muted">
                {money.format(row.previous, { compact: true })}
              </AppText>
              <Ionicons name="arrow-forward" size={11} color={theme.colors.muted} />
              <AppText variant="numericCaption">{money.format(row.total, { compact: true })}</AppText>
              {row.change !== null ? (
                <AppText variant="caption" tone={row.change > 0 ? 'negative' : 'positive'} style={{ minWidth: 46, textAlign: 'right' }}>
                  {row.change > 0 ? '+' : '−'}
                  {formatPercent(Math.abs(row.change), 0)}
                </AppText>
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
    </WidgetCard>
  );
};

const DailySpendingWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const money = useMoney();
  const range = useRange(config);
  const { data, loading } = useQuery(
    () => getDailySpendingStats({ range, accountIds: config.accountIds }),
    [range.start.getTime(), range.end.getTime(), config.accountIds?.join(',')],
  );
  if (loading || !data) return <WidgetCard title="DAILY SPENDING"><WidgetLoading /></WidgetCard>;
  return (
    <WidgetCard title="DAILY SPENDING" onPress={() => onNavigate('/analytics')}>
      <Row gap="lg">
        <View style={{ flex: 1 }}>
          <AppText variant="caption" tone="muted">
            Today
          </AppText>
          <AppText variant="numericSmall">{money.format(data.today)}</AppText>
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="caption" tone="muted">
            7-day avg
          </AppText>
          <AppText variant="numericSmall">{money.format(data.average7)}</AppText>
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="caption" tone="muted">
            30-day avg
          </AppText>
          <AppText variant="numericSmall">{money.format(data.average30)}</AppText>
        </View>
      </Row>
      <Row gap="lg" style={{ marginTop: 4 }}>
        <View style={{ flex: 1 }}>
          <AppText variant="caption" tone="muted">
            Highest day
          </AppText>
          <AppText variant="bodySmall">{data.highest ? money.format(data.highest.amount) : '—'}</AppText>
          <AppText variant="caption" tone="muted">
            {data.highest ? formatDayMonth(new Date(data.highest.date)) : ''}
          </AppText>
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="caption" tone="muted">
            Lowest day
          </AppText>
          <AppText variant="bodySmall">{data.lowest ? money.format(data.lowest.amount) : '—'}</AppText>
          <AppText variant="caption" tone="muted">
            {data.lowest ? formatDayMonth(new Date(data.lowest.date)) : ''}
          </AppText>
        </View>
      </Row>
    </WidgetCard>
  );
};

const RecurringUpcomingWidget: React.FC<WidgetProps> = ({ onNavigate }) => {
  const money = useMoney();
  const { data, loading } = useQuery(() => getUpcoming(4), []);
  if (loading || !data) return <WidgetCard title="UPCOMING"><WidgetLoading /></WidgetCard>;
  if (data.length === 0) {
    return (
      <WidgetCard title="UPCOMING" actionLabel="Add" onAction={() => onNavigate('/recurring')}>
        <WidgetEmpty message="No upcoming recurring payments." icon="repeat-outline" />
      </WidgetCard>
    );
  }
  return (
    <WidgetCard title="UPCOMING" actionLabel="Manage" onAction={() => onNavigate('/recurring')}>
      <View style={{ gap: 2 }}>
        {data.map((item) => (
          <Pressable
            key={item.recurring.id}
            onPress={() => onNavigate('/recurring')}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 }}>
            <View style={{ flex: 1 }}>
              <AppText variant="bodySmall" numberOfLines={1}>
                {item.recurring.merchant}
              </AppText>
              <AppText variant="caption" tone="muted">
                {formatDayMonth(item.nextDate)}
                {item.recurring.isSubscription ? ' · Subscription' : ''}
              </AppText>
            </View>
            <MoneyText amount={item.recurring.type === 'income' ? item.recurring.amount : -item.recurring.amount} variant="numericCaption" tone="neutral" />
          </Pressable>
        ))}
      </View>
    </WidgetCard>
  );
};

const CashFlowWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const money = useMoney();
  const chart = useChartColors();
  const range = useRange(config);
  const { data, loading } = useQuery(() => getCategoryBreakdown({ range, accountIds: config.accountIds }, { limit: 6 }), [range.start.getTime(), range.end.getTime()]);
  if (loading || !data) return <WidgetCard title="MONEY FLOW"><WidgetLoading /></WidgetCard>;
  if (data.rows.length === 0) {
    return (
      <WidgetCard title="MONEY FLOW">
        <WidgetEmpty message="No outflow data for this period." icon="git-branch-outline" />
      </WidgetCard>
    );
  }
  return (
    <WidgetCard title="MONEY FLOW" onPress={() => onNavigate('/reports/cashflow')}>
      <FlowBars
        totalLabel="Money out"
        totalValue={data.total}
        items={data.rows.map((row, index) => ({
          id: row.categoryId ?? 'none',
          label: row.name,
          value: row.total,
          color: chart.slice(index, row.color),
          onPress: row.categoryId ? () => onNavigate(`/category/${row.categoryId}`) : undefined,
        }))}
      />
    </WidgetCard>
  );
};

const ReviewQueueWidget: React.FC<WidgetProps> = ({ onNavigate }) => {
  const { data, loading } = useQuery(() => getReviewQueue(3), []);
  if (loading) return <WidgetCard title="REVIEW"><WidgetLoading /></WidgetCard>;
  const items = data ?? [];
  if (items.length === 0) return null; // Nothing to review → no widget.
  return (
    <WidgetCard title="REVIEW" subtitle={`${items.length} need${items.length === 1 ? 's' : ''} attention`} actionLabel="Review all" onAction={() => onNavigate('/review')}>
      <View style={{ gap: 2 }}>
        {items.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => onNavigate(`/transaction/${item.id}`)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 }}>
            <View style={{ flex: 1 }}>
              <AppText variant="bodySmall" numberOfLines={1}>
                {item.merchant ?? item.description ?? 'Transaction'}
              </AppText>
              <AppText variant="caption" tone="warning">
                {item.reasons[0]==='duplicate' ? 'Possible duplicate' : item.reasons[0] === 'uncategorised' ? 'Category unknown' : item.reasons[0] === 'large' ? 'Unusual amount' : 'Not reviewed'}
              </AppText>
            </View>
            <MoneyText amount={item.amount} variant="numericCaption" tone="neutral" />
          </Pressable>
        ))}
      </View>
    </WidgetCard>
  );
};

const GoalsWidget: React.FC<WidgetProps> = ({ onNavigate }) => {
  const money = useMoney();
  const { data, loading } = useQuery(() => getGoalsProgress(), []);
  if (loading || !data) return <WidgetCard title="GOALS"><WidgetLoading /></WidgetCard>;
  if (data.length === 0) {
    return (
      <WidgetCard title="GOALS" actionLabel="Create" onAction={() => onNavigate('/goals')}>
        <EmptyState
          compact
          icon="flag-outline"
          title="No goals yet"
          message="Set aside money for something you actually care about."
          actionLabel="Create your first goal"
          onAction={() => onNavigate('/goals')}
        />
      </WidgetCard>
    );
  }
  return (
    <WidgetCard title="GOALS" actionLabel="All" onAction={() => onNavigate('/goals')}>
      <View style={{ gap: 14 }}>
        {data.slice(0, 3).map((progress) => (
          <Pressable key={progress.goal.id} onPress={() => onNavigate(`/goal/${progress.goal.id}`)} style={{ gap: 7 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <AppText variant="bodySmall">{progress.goal.name}</AppText>
              <AppText variant="numericCaption" tone="secondary">
                {money.format(progress.saved)} / {money.format(progress.goal.targetAmount)}
              </AppText>
            </View>
            <ProgressBar progress={progress.percent} height={6} color={progress.goal.color} />
            {progress.requiredMonthly !== null && !progress.isComplete ? (
              <AppText variant="caption" tone="muted">
                {money.format(progress.requiredMonthly)}/month to hit {progress.goal.targetDate ? formatDayMonth(new Date(progress.goal.targetDate)) : 'target'}
              </AppText>
            ) : null}
          </Pressable>
        ))}
      </View>
    </WidgetCard>
  );
};

const DebtSummaryWidget: React.FC<WidgetProps> = ({ onNavigate }) => {
  const money = useMoney();
  const { data, loading } = useQuery(() => getDebtOverview(), []);
  if (loading || !data) return <WidgetCard title="MONEY OWED"><WidgetLoading /></WidgetCard>;
  const isEmpty = data.theyOweYou === 0 && data.youOwe === 0;
  return (
    <WidgetCard title="MONEY OWED" actionLabel={isEmpty ? 'Add' : undefined} onAction={isEmpty ? () => onNavigate('/debts') : undefined} onPress={() => onNavigate('/debts')}>
      <Row gap="lg">
        <View style={{ flex: 1 }}>
          <AppText variant="caption" tone="muted">
            They owe you
          </AppText>
          <AppText variant="numericSmall" tone={data.theyOweYou > 0 ? 'positive' : 'muted'}>
            {money.format(data.theyOweYou)}
          </AppText>
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="caption" tone="muted">
            You owe
          </AppText>
          <AppText variant="numericSmall" tone={data.youOwe > 0 ? 'negative' : 'muted'}>
            {money.format(data.youOwe)}
          </AppText>
        </View>
      </Row>
      {isEmpty ? (
        <AppText variant="caption" tone="muted" style={{ marginTop: 10 }}>
          Track money you've lent or borrowed.
        </AppText>
      ) : data.overdueCount > 0 ? (
        <AppText variant="caption" tone="warning" style={{ marginTop: 10 }}>
          {data.overdueCount} overdue
        </AppText>
      ) : null}
    </WidgetCard>
  );
};

const SubscriptionsWidget: React.FC<WidgetProps> = ({ onNavigate }) => {
  const money = useMoney();
  const { data, loading } = useQuery(() => getSubscriptionSummary(), []);
  if (loading || !data) return <WidgetCard title="SUBSCRIPTIONS"><WidgetLoading /></WidgetCard>;
  if (data.activeCount === 0) {
    return (
      <WidgetCard title="SUBSCRIPTIONS" actionLabel="Manage" onAction={() => onNavigate('/recurring')} onPress={() => onNavigate('/recurring')}>
        <AppText variant="numericMedium">{money.format(0)}<AppText variant="caption" tone="muted">/mo</AppText></AppText>
        <AppText variant="bodySmall" tone="secondary" style={{ marginTop: 8 }}>
          No recurring subscriptions yet.
        </AppText>
        <AppText variant="caption" tone="muted" style={{ marginTop: 4 }}>
          Add recurring payments to track their annual cost.
        </AppText>
      </WidgetCard>
    );
  }
  return (
    <WidgetCard title="SUBSCRIPTIONS" subtitle={`${data.activeCount} active`} actionLabel="Manage" onAction={() => onNavigate('/recurring')} onPress={() => onNavigate('/recurring')}>
      <Row gap="lg">
        <View style={{ flex: 1 }}>
          <AppText variant="caption" tone="muted">
            Monthly
          </AppText>
          <AppText variant="numericSmall">{money.format(data.monthlyTotal)}</AppText>
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="caption" tone="muted">
            Annualised
          </AppText>
          <AppText variant="numericSmall">{money.format(data.annualTotal)}</AppText>
        </View>
      </Row>
      <View style={{ gap: 8, marginTop: 12 }}>
        {data.items.slice(0, 3).map((item) => (
          <View key={item.recurring.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <AppText variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1, marginRight: 8 }}>
              {item.recurring.merchant}
            </AppText>
            <AppText variant="numericCaption" tone="secondary">
              {money.format(item.monthlyAmount)}/mo · {money.format(item.annualAmount)}/yr
            </AppText>
          </View>
        ))}
      </View>
    </WidgetCard>
  );
};

const InsightsWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const theme = useTheme();
  const range = useRange(config);
  const currency = useSettingsStore((state) => state.general.currency);
  const grouping = useSettingsStore((state) => state.general.numberGrouping);
  const showDecimals = useSettingsStore((state) => state.general.showDecimals);
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);

  const { data, loading } = useQuery(async () => {
    const { getTopInsights } = await import('@/services/insights.service');
    return getTopInsights({ range, accountIds: config.accountIds }, monthStartDay, {
      currency,
      grouping,
      decimals: showDecimals ? 2 : 'auto',
    }, 3);
  }, [range.start.getTime(), range.end.getTime(), currency, grouping, showDecimals, monthStartDay]);

  if (loading || !data) return <WidgetCard title="INSIGHTS"><WidgetLoading /></WidgetCard>;
  if (data.length === 0) return null;

  const toneColors: Record<string, string> = {
    positive: theme.colors.positive,
    negative: theme.colors.negative,
    warning: theme.colors.warning,
    neutral: theme.colors.muted,
  };

  return (
    <WidgetCard title="INSIGHTS">
      <View style={{ gap: 14 }}>
        {data.map((insight) => (
          <Pressable
            key={insight.id}
            onPress={() => insight.href && onNavigate(insight.href)}
            style={{ flexDirection: 'row', gap: 10 }}>
            <Ionicons name={insight.icon as IconName} size={16} color={toneColors[insight.tone]} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="bodySmall">{insight.title}</AppText>
              <AppText variant="caption" tone="muted">
                {insight.detail}
              </AppText>
            </View>
          </Pressable>
        ))}
      </View>
    </WidgetCard>
  );
};

const FinancialHealthWidget: React.FC<WidgetProps> = ({ onNavigate }) => {
  const money = useMoney();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const { data, loading } = useQuery(() => getFinancialHealth(monthStartDay), [monthStartDay]);
  if (loading || !data) return <WidgetCard title="FINANCIAL HEALTH"><WidgetLoading /></WidgetCard>;
  return (
    <WidgetCard title="FINANCIAL HEALTH" actionLabel="Details" onAction={() => onNavigate('/reports/health')}>
      <View style={{ gap: 10 }}>
        <Row justify="space-between">
          <AppText variant="bodySmall" tone="secondary">Savings rate</AppText>
          <AppText variant="numericSmall">{formatPercent(data.savingsRate, 0)}</AppText>
        </Row>
        <Row justify="space-between">
          <AppText variant="bodySmall" tone="secondary">Emergency reserve</AppText>
          <AppText variant="numericSmall">{data.emergencyReserveMonths.toFixed(1)} months</AppText>
        </Row>
        <Row justify="space-between">
          <AppText variant="bodySmall" tone="secondary">Recurring commitments</AppText>
          <AppText variant="numericSmall">{money.format(data.monthlyRecurringCommitments)}/mo</AppText>
        </Row>
        <Row justify="space-between">
          <AppText variant="bodySmall" tone="secondary">Net worth growth (1y)</AppText>
          <AppText variant="numericSmall" tone={data.netWorthGrowthPercent !== null && data.netWorthGrowthPercent < 0 ? 'negative' : 'positive'}>
            {data.netWorthGrowthPercent === null ? '—' : `${data.netWorthGrowthPercent >= 0 ? '+' : '−'}${formatPercent(Math.abs(data.netWorthGrowthPercent), 1)}`}
          </AppText>
        </Row>
      </View>
    </WidgetCard>
  );
};

const InstallmentsWidget: React.FC<WidgetProps> = ({ onNavigate }) => {
  const money = useMoney();
  const { data, loading } = useQuery(() => import('@/services/installments.service').then((m) => m.listInstallmentProgress()), []);
  if (loading || !data) return <WidgetCard title="INSTALLMENTS"><WidgetLoading /></WidgetCard>;
  if (data.length === 0) return null;
  return (
    <WidgetCard title="INSTALLMENTS" actionLabel="Manage" onAction={() => onNavigate('/installments')}>
      <View style={{ gap: 14 }}>
        {data.slice(0, 3).map((plan) => (
          <View key={plan.plan.id} style={{ gap: 7 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <AppText variant="bodySmall">{plan.plan.name}</AppText>
              <AppText variant="numericCaption" tone="secondary">
                {plan.plan.postedCount}/{plan.plan.totalCount}
              </AppText>
            </View>
            <ProgressBar progress={plan.percent} height={6} />
            <AppText variant="caption" tone="muted">
              {money.format(plan.nextAmount)} next{plan.nextDate ? ` · ${formatDayMonth(new Date(plan.nextDate))}` : ''} · {money.format(plan.remainingAmount)} left
            </AppText>
          </View>
        ))}
      </View>
    </WidgetCard>
  );
};

const UpcomingPaymentsWidget: React.FC<WidgetProps> = ({ onNavigate }) => {
  const theme = useTheme();
  const money = useMoney();
  const notifications = useSettingsStore((state) => state.notifications);
  const { data, loading } = useQuery(
    () =>
      getReminders({
        recurring: notifications.recurringReminders,
        debt: notifications.debtReminders,
        budget: notifications.budgetAlerts,
        goal: notifications.goalReminders,
        card: notifications.cardReminders,
        installment: notifications.installmentReminders,
        shared: notifications.sharedReminders,
      }),
    [
      notifications.recurringReminders,
      notifications.debtReminders,
      notifications.budgetAlerts,
      notifications.goalReminders,
      notifications.cardReminders,
      notifications.installmentReminders,
      notifications.sharedReminders,
    ],
  );
  if (loading) return <WidgetCard title="REMINDERS"><WidgetLoading /></WidgetCard>;
  const items = (data ?? []).slice(0, 4);
  if (items.length === 0) return null;
  return (
    <WidgetCard title="REMINDERS" actionLabel="Settings" onAction={() => onNavigate('/settings/notifications')}>
      <View style={{ gap: 10 }}>
        {items.map((reminder) => (
          <Pressable
            key={reminder.id}
            onPress={() => reminder.href && onNavigate(reminder.href)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor:
                  reminder.severity === 'negative'
                    ? theme.colors.negative
                    : reminder.severity === 'warning'
                      ? theme.colors.warning
                      : theme.colors.accent.base,
              }}
            />
            <View style={{ flex: 1 }}>
              <AppText variant="bodySmall" numberOfLines={1}>
                {reminder.title}
              </AppText>
              <AppText variant="caption" tone="muted">
                {reminder.detail}
                {reminder.date ? ` · ${formatDayMonth(new Date(reminder.date))}` : ''}
              </AppText>
            </View>
            {reminder.amount !== null ? (
              <MoneyText amount={reminder.amount} variant="numericCaption" tone="neutral" />
            ) : null}
          </Pressable>
        ))}
      </View>
    </WidgetCard>
  );
};

// ------------------- Category trends (month on month) ----------------------

/**
 * Month-on-month spending per category. Grouped bars compare the current cycle
 * with the one before it; the list underneath spells out the change, and every
 * row opens the category's own detail screen.
 */
const CategoryMonthlyWidget: React.FC<WidgetProps> = ({ config, onNavigate }) => {
  const theme = useTheme();
  const money = useMoney();
  const chart = useChartColors();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const { data, loading } = useQuery(
    () => getCategoryMonthlyTrends({ months: 6, monthStartDay, accountIds: config.accountIds }),
    [config.accountIds?.join(','), monthStartDay],
  );

  if (loading || !data) return <WidgetCard title="CATEGORY TRENDS"><WidgetLoading /></WidgetCard>;

  const current = data.months[data.months.length - 1];
  const previous = data.months[data.months.length - 2];
  const rows = data.rows.filter((row) => row.current > 0 || row.previous > 0).slice(0, 5);
  if (rows.length === 0) {
    return (
      <WidgetCard title="CATEGORY TRENDS" actionLabel="Analytics" onAction={() => onNavigate('/analytics')}>
        <WidgetEmpty message="No spending in the last cycles to compare yet." icon="analytics-outline" />
      </WidgetCard>
    );
  }

  return (
    <WidgetCard
      title="CATEGORY TRENDS"
      subtitle={current && previous ? `${current.fullLabel} vs ${previous.fullLabel}` : 'Month on month'}
      actionLabel="All"
      onAction={() => onNavigate('/category-trends')}>
      <View style={{ marginHorizontal: -6 }}>
        <BarChart
          points={rows.map((row) => ({
            key: row.categoryId ?? row.name,
            label: shortCategoryLabel(row.name),
            fullLabel: `${row.name} · ${current?.fullLabel ?? 'This cycle'}`,
            value: row.current,
          }))}
          secondary={rows.map((row) => ({
            key: `${row.categoryId ?? row.name}-previous`,
            label: shortCategoryLabel(row.name),
            fullLabel: `${row.name} · ${previous?.fullLabel ?? 'Previous cycle'}`,
            value: row.previous,
          }))}
          height={150}
          color={chart.slice(0, theme.colors.accent.base)}
          secondaryColor={theme.colors.muted}
          compactLabels
        />
      </View>

      <View style={{ gap: 12, marginTop: theme.spacing.md }}>
        {rows.slice(0, 4).map((row, index) => (
          <Pressable
            key={row.categoryId ?? row.name}
            onPress={() => (row.categoryId ? onNavigate(`/category/${row.categoryId}`) : undefined)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: chart.slice(index, row.color) }} />
            <AppText variant="caption" numberOfLines={1} style={{ flex: 1 }}>
              {row.name}
            </AppText>
            <AppText variant="numericCaption" tone="secondary">
              {money.format(row.current, { compact: true })}
            </AppText>
            {row.change !== null ? (
              <Row gap="xs" align="center" style={{ minWidth: 52, justifyContent: 'flex-end' }}>
                <Ionicons
                  name={row.change > 0 ? 'arrow-up' : 'arrow-down'}
                  size={11}
                  color={row.change > 0 ? theme.colors.negative : theme.colors.positive}
                />
                <AppText
                  variant="caption"
                  tone={row.change > 0 ? 'negative' : 'positive'}
                  style={{ fontSize: 11 }}>
                  {formatPercent(Math.abs(row.change), 0)}
                </AppText>
              </Row>
            ) : (
              <AppText variant="caption" tone="muted" style={{ fontSize: 11, minWidth: 52, textAlign: 'right' }}>
                new
              </AppText>
            )}
          </Pressable>
        ))}
      </View>
    </WidgetCard>
  );
};

/* ------------------------------- Registry -------------------------------- */

const REGISTRY: Record<string, WidgetDefinition> = {
  net_worth: { type: 'net_worth', title: 'Net Worth', description: 'Your wealth with month-over-month change', icon: 'trending-up-outline', defaultWidth: 'full', defaultHeight: 'tall', Component: NetWorthWidget },
  safe_to_spend: { type: 'safe_to_spend', title: 'Safe to Spend', description: 'Cash minus bills, savings and budget commitments', icon: 'shield-checkmark-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: SafeToSpendWidget },
  total_balance: { type: 'total_balance', title: 'Total Balance', description: 'Spendable balance across accounts', icon: 'wallet-outline', defaultWidth: 'half', defaultHeight: 'compact', Component: TotalBalanceWidget },
  income_expense: { type: 'income_expense', title: 'Cash Flow', description: 'Income vs expenses this period', icon: 'swap-vertical-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: IncomeExpenseWidget },
  spending_total: { type: 'spending_total', title: 'Spending', description: 'Total spending this period', icon: 'card-outline', defaultWidth: 'half', defaultHeight: 'compact', Component: SpendingTotalWidget },
  savings_rate: { type: 'savings_rate', title: 'Savings Rate', description: 'Share of income kept', icon: 'shield-checkmark-outline', defaultWidth: 'half', defaultHeight: 'compact', Component: SavingsRateWidget },
  spending_pace: { type: 'spending_pace', title: 'Spending Pace', description: 'Daily pace vs previous period', icon: 'speedometer-outline', defaultWidth: 'half', defaultHeight: 'compact', Component: SpendingPaceWidget },
  spending_trend: { type: 'spending_trend', title: 'Spending Trend', description: 'Chart of spending over time', icon: 'analytics-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: SpendingTrendWidget },
  category_breakdown: { type: 'category_breakdown', title: 'Spending Categories', description: 'Donut with category shares', icon: 'pie-chart-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: CategoryBreakdownWidget },
  category_monthly: { type: 'category_monthly', title: 'Category Trends', description: 'Month-on-month spending per category', icon: 'analytics-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: CategoryMonthlyWidget },
  budget_progress: { type: 'budget_progress', title: 'Budgets', description: 'Progress of your active budgets', icon: 'wallet-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: BudgetProgressWidget },
  recent_transactions: { type: 'recent_transactions', title: 'Recent Transactions', description: 'Your latest activity', icon: 'receipt-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: RecentTransactionsWidget },
  top_merchants: { type: 'top_merchants', title: 'Top Merchants', description: 'Where the money goes', icon: 'storefront-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: TopMerchantsWidget },
  largest_expenses: { type: 'largest_expenses', title: 'Largest Expenses', description: 'Biggest single transactions', icon: 'podium-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: LargestExpensesWidget },
  account_balances: { type: 'account_balances', title: 'Account Balances', description: 'Balances of your accounts', icon: 'wallet-outline', defaultWidth: 'half', defaultHeight: 'medium', Component: AccountBalancesWidget },
  net_worth_trend: { type: 'net_worth_trend', title: 'Net Worth Trend', description: 'Historical net worth chart', icon: 'trending-up-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: NetWorthTrendWidget },
  monthly_comparison: { type: 'monthly_comparison', title: 'Monthly Comparison', description: 'This month vs last month by category', icon: 'calendar-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: MonthlyComparisonWidget },
  daily_spending: { type: 'daily_spending', title: 'Daily Spending', description: 'Today, averages, highs and lows', icon: 'today-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: DailySpendingWidget },
  recurring_upcoming: { type: 'recurring_upcoming', title: 'Upcoming', description: 'Next recurring payments', icon: 'repeat-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: RecurringUpcomingWidget },
  cash_flow: { type: 'cash_flow', title: 'Money Flow', description: 'Where money flows out (flow bars)', icon: 'git-branch-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: CashFlowWidget },
  review_queue: { type: 'review_queue', title: 'Review', description: 'Transactions needing attention', icon: 'checkmark-done-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: ReviewQueueWidget },
  goals: { type: 'goals', title: 'Goals', description: 'Savings goal progress', icon: 'flag-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: GoalsWidget },
  debt_summary: { type: 'debt_summary', title: 'Money Owed', description: 'Receivables and payables', icon: 'people-outline', defaultWidth: 'half', defaultHeight: 'compact', Component: DebtSummaryWidget },
  subscriptions: { type: 'subscriptions', title: 'Subscriptions', description: 'Monthly and annual subscription cost', icon: 'repeat-outline', defaultWidth: 'half', defaultHeight: 'compact', Component: SubscriptionsWidget },
  insights: { type: 'insights', title: 'Insights', description: 'Deterministic observations from your data', icon: 'bulb-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: InsightsWidget },
  financial_health: { type: 'financial_health', title: 'Financial Health', description: 'Savings, reserves, commitments', icon: 'heart-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: FinancialHealthWidget },
  installments: { type: 'installments', title: 'Installments', description: 'Active installment plans', icon: 'layers-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: InstallmentsWidget },
  upcoming_payments: { type: 'upcoming_payments', title: 'Reminders', description: 'Bills, debts and due dates coming up', icon: 'alarm-outline', defaultWidth: 'full', defaultHeight: 'medium', Component: UpcomingPaymentsWidget },
};

export function getWidgetDefinition(type: string): WidgetDefinition | null {
  return REGISTRY[type] ?? null;
}

export function listWidgetDefinitions(): WidgetDefinition[] {
  return Object.values(REGISTRY);
}

export function renderWidget(
  widget: DashboardWidget,
  onNavigate: (href: string) => void,
  scopeAccountId?: string | null,
): React.ReactNode {
  const definition = getWidgetDefinition(widget.type);
  if (!definition) return null;
  let config: WidgetConfig = {};
  try {
    config = JSON.parse(widget.configuration || '{}') as WidgetConfig;
  } catch {
    config = {};
  }
  // A Home account scope overrides (never silences) each widget's own filter.
  const scopedConfig: WidgetConfig = scopeAccountId ? { ...config, accountIds: [scopeAccountId] } : config;
  return <definition.Component widget={widget} config={scopedConfig} onNavigate={onNavigate} />;
}

export const WIDGET_PRESETS: Record<string, { label: string; description: string; widgets: string[] }> = {
  overview: {
    label: 'Overview',
    description: 'The default blend of net worth, cash flow and spending',
    widgets: ['net_worth', 'safe_to_spend', 'income_expense', 'spending_total', 'savings_rate', 'spending_trend', 'category_breakdown', 'budget_progress', 'recent_transactions'],
  },
  cash_flow: {
    label: 'Cash Flow',
    description: 'Focus on money in and out, pace and forecasting',
    widgets: ['cash_flow', 'income_expense', 'spending_pace', 'upcoming_payments', 'daily_spending', 'recurring_upcoming', 'recent_transactions'],
  },
  spending: {
    label: 'Spending',
    description: 'Deep dive into where money goes',
    widgets: ['spending_total', 'spending_pace', 'category_breakdown', 'category_monthly', 'top_merchants', 'largest_expenses', 'spending_trend', 'monthly_comparison'],
  },
  budget: {
    label: 'Budget',
    description: 'Budgets, pace and pending transactions',
    widgets: ['budget_progress', 'spending_pace', 'spending_total', 'review_queue', 'recent_transactions'],
  },
  net_worth: {
    label: 'Net Worth',
    description: 'Wealth tracking and account balances',
    widgets: ['net_worth', 'net_worth_trend', 'account_balances', 'total_balance', 'debt_summary', 'financial_health'],
  },
  planning: {
    label: 'Planning',
    description: 'Goals, debts, subscriptions and reminders',
    widgets: ['goals', 'debt_summary', 'subscriptions', 'upcoming_payments', 'installments', 'recurring_upcoming'],
  },
  minimal: {
    label: 'Minimal',
    description: 'Just the essentials',
    widgets: ['net_worth', 'spending_total', 'recent_transactions'],
  },
  power: {
    label: 'Power User',
    description: 'Everything at a glance',
    widgets: ['net_worth', 'income_expense', 'spending_pace', 'budget_progress', 'goals', 'debt_summary', 'subscriptions', 'net_worth_trend', 'insights', 'review_queue', 'recent_transactions'],
  },
};
