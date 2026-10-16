import {
  getCategoryBreakdown,
  getDailySpendingStats,
  getPeriodSummary,
  getSpendingVelocity,
  getTopMerchants,
  getWeekdaySpending,
  type RangeParams,
} from '@/services/analytics.service';
import { getBudgetProgressList } from '@/services/budgets.service';
import { daysInRange, formatWeekdayLong, toDate } from '@/utils/date';
import { formatMoney, formatPercent } from '@/utils/money';

/**
 * The insights engine. Fully deterministic — no AI, no randomness. Each rule
 * produces a ranked, human-readable observation; the UI shows only the top few
 * so the dashboard never becomes noise.
 */

export type InsightTone = 'positive' | 'negative' | 'warning' | 'neutral';

export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  detail: string;
  /** Higher = more important. */
  priority: number;
  icon: string;
  /** Optional drill-down target. */
  href?: string;
}

export interface InsightContext {
  currency: string;
  grouping: 'indian' | 'western';
  decimals: number | 'auto';
  /** When true, upward spending movement is bad (default for expenses). */
  spendingIncreasesAreNegative?: boolean;
}

function money(value: number, ctx: InsightContext, options: { sign?: 'auto' | 'always' | 'never'; absolute?: boolean } = {}) {
  return formatMoney(value, {
    currency: ctx.currency,
    grouping: ctx.grouping,
    decimals: ctx.decimals,
    sign: options.sign,
    absolute: options.absolute,
  });
}

export async function generateInsights(params: RangeParams, monthStartDay: number, ctx: InsightContext): Promise<Insight[]> {
  const insights: Insight[] = [];

  const [summary, categories, velocity, merchants, weekday, daily, budgets] = await Promise.all([
    getPeriodSummary(params),
    getCategoryBreakdown(params),
    getSpendingVelocity(params),
    getTopMerchants(params, 5),
    getWeekdaySpending(params),
    getDailySpendingStats(params),
    getBudgetProgressList(),
  ]);

  const { totals, previous } = summary;

  /* ------------------------------ Savings rate ------------------------------ */
  if (totals.income > 0) {
    if (totals.savings < 0) {
      insights.push({
        id: 'savings-negative',
        tone: 'negative',
        title: 'Spending exceeded income',
        detail: `You spent ${money(Math.abs(totals.savings), ctx)} more than you earned this period.`,
        priority: 96,
        icon: 'alert-circle-outline',
      });
    } else {
      const delta = totals.savingsRate - previous.savingsRate;
      insights.push({
        id: 'savings-rate',
        tone: totals.savingsRate >= 20 ? 'positive' : 'neutral',
        title: `You kept ${formatPercent(totals.savingsRate, 0)} of your income`,
        detail:
          previous.income > 0
            ? `That's ${money(totals.savings, ctx)} saved vs ${formatPercent(previous.savingsRate, 0)} in the previous period${
                Math.abs(delta) >= 1 ? ` (${delta >= 0 ? '+' : '−'}${formatPercent(Math.abs(delta), 0)})` : ''
              }.`
            : `That's ${money(totals.savings, ctx)} set aside this period.`,
        priority: 82,
        icon: 'shield-checkmark-outline',
      });
    }
  }

  /* --------------------------- Budget pressure rule --------------------------- */
  for (const budget of budgets.slice(0, 6)) {
    if (budget.percent >= 100) {
      insights.push({
        id: `budget-over-${budget.budget.id}`,
        tone: 'negative',
        title: `${budget.categoryName} is over budget`,
        detail: `${money(budget.spent, ctx)} spent of ${money(budget.budget.amount, ctx)} — ${money(Math.abs(budget.remaining), ctx)} over.`,
        priority: 94,
        icon: 'warning-outline',
        href: `/budget/${budget.budget.id}`,
      });
    } else if (budget.percent >= 85) {
      insights.push({
        id: `budget-near-${budget.budget.id}`,
        tone: 'warning',
        title: `${budget.categoryName} budget is ${formatPercent(budget.percent, 0)} used`,
        detail: `${money(budget.remaining, ctx)} left with ${budget.daysRemaining} day${budget.daysRemaining === 1 ? '' : 's'} to go. Safe to spend ${money(budget.safeToSpendPerDay, ctx)}/day.`,
        priority: 88,
        icon: 'pie-chart-outline',
        href: `/budget/${budget.budget.id}`,
      });
    }
  }

  /* -------------------------- Category change insight ------------------------- */
  const movers = categories.rows
    .filter((row) => row.total >= 50000 && row.change !== null && Math.abs(row.change) >= 12)
    .sort((a, b) => Math.abs(b.change ?? 0) * b.total - Math.abs(a.change ?? 0) * a.total)
    .slice(0, 2);

  for (const row of movers) {
    const up = (row.change ?? 0) > 0;
    insights.push({
      id: `category-change-${row.categoryId ?? 'none'}`,
      tone: up ? 'negative' : 'positive',
      title: `${row.name} spending is ${formatPercent(Math.abs(row.change ?? 0), 0)} ${up ? 'higher' : 'lower'}`,
      detail: `${money(row.total, ctx)} vs ${money(row.previousTotal, ctx)} in the previous period.`,
      priority: 70 + Math.min(20, Math.abs(row.change ?? 0) / 4),
      icon: up ? 'trending-up-outline' : 'trending-down-outline',
      href: row.categoryId ? `/category/${row.categoryId}` : undefined,
    });
  }

  /* ------------------------------ Velocity rule ------------------------------ */
  if (velocity.previousPerDay > 0 && velocity.change !== null && Math.abs(velocity.change) >= 8) {
    const up = velocity.change > 0;
    const diff = Math.abs(velocity.currentPerDay - velocity.previousPerDay);
    insights.push({
      id: 'velocity',
      tone: up ? 'negative' : 'positive',
      title: `Spending pace is ${formatPercent(Math.abs(velocity.change), 0)} ${up ? 'faster' : 'slower'}`,
      detail: `${money(velocity.currentPerDay, ctx, { absolute: true })}/day now vs ${money(velocity.previousPerDay, ctx, {
        absolute: true,
      })}/day previously (${up ? '+' : '−'}${money(diff, ctx, { absolute: true })}/day).`,
      priority: 64,
      icon: 'speedometer-outline',
    });
  }

  /* ----------------------------- Top merchant -------------------------------- */
  const topMerchant = merchants[0];
  if (topMerchant && topMerchant.share >= 10 && topMerchant.count >= 2) {
    insights.push({
      id: 'top-merchant',
      tone: 'neutral',
      title: `${topMerchant.name} is ${formatPercent(topMerchant.share, 0)} of your spending`,
      detail: `${money(topMerchant.total, ctx)} across ${topMerchant.count} transaction${topMerchant.count === 1 ? '' : 's'}.`,
      priority: 52,
      icon: 'storefront-outline',
      href: `/merchant/${encodeURIComponent(topMerchant.name)}`,
    });
  }

  /* ------------------------------ Weekday rule ------------------------------- */
  const activeWeekdays = weekday.filter((w) => w.total > 0);
  if (activeWeekdays.length >= 4) {
    const max = activeWeekdays.reduce((best, w) => (w.total > best.total ? w : best), activeWeekdays[0]!);
    const others = activeWeekdays.filter((w) => w.weekday !== max.weekday);
    const avgOther = others.reduce((sum, w) => sum + w.total, 0) / Math.max(1, others.length);
    if (max.total > avgOther * 1.35) {
      insights.push({
        id: 'weekday',
        tone: 'neutral',
        title: `${formatWeekdayLong(toDate(`2024-01-0${max.weekday + 1}`)!)}s are your heaviest spending day`,
        detail: `${money(max.total, ctx, { absolute: true })} total — ${formatPercent(((max.total - avgOther) / avgOther) * 100, 0)} above your other days.`,
        priority: 46,
        icon: 'calendar-outline',
      });
    }
  }

  /* ------------------------------- Daily stats ------------------------------- */
  if (daily.average30 > 0) {
    const rangeDays = daysInRange(params.range);
    const today = new Date();
    const elapsedDays = Math.min(
      rangeDays,
      Math.max(1, Math.floor((today.getTime() - params.range.start.getTime()) / 86400000) + 1),
    );
    const noSpendDays = Math.max(0, elapsedDays - daily.activeDays);
    insights.push({
      id: 'daily-average',
      tone: 'neutral',
      title: `Your average daily spend is ${money(daily.average30, ctx, { absolute: true })}`,
      detail:
        noSpendDays >= 2
          ? `Across the last 30 days, with ${noSpendDays} no-spend days this period.`
          : `Across the last 30 days${daily.highest ? `, with ${money(daily.highest.amount, ctx, { absolute: true })} on your heaviest day` : ''}.`,
      priority: 38,
      icon: 'analytics-outline',
    });
  }

  /* -------------------------------- Refunds --------------------------------- */
  if (totals.refunds > 0) {
    insights.push({
      id: 'refunds',
      tone: 'positive',
      title: `${money(totals.refunds, ctx)} came back as refunds`,
      detail: `Net spending after refunds is ${money(totals.netExpense, ctx, { absolute: true })}.`,
      priority: 34,
      icon: 'return-down-back-outline',
    });
  }

  /* ------------------------------ Largest expense ----------------------------- */
  if (daily.highest && categories.rows[0]) {
    insights.push({
      id: 'largest-expense',
      tone: 'neutral',
      title: `Biggest category: ${categories.rows[0].name}`,
      detail: `${money(categories.rows[0].total, ctx)} (${formatPercent(categories.rows[0].share, 0)} of spending, ${categories.rows[0].count} transaction${categories.rows[0].count === 1 ? '' : 's'}).`,
      priority: 30,
      icon: 'podium-outline',
      href: categories.rows[0].categoryId ? `/category/${categories.rows[0].categoryId}` : undefined,
    });
  }

  return insights.sort((a, b) => b.priority - a.priority);
}

export async function getTopInsights(
  params: RangeParams,
  monthStartDay: number,
  ctx: InsightContext,
  limit = 3,
): Promise<Insight[]> {
  const all = await generateInsights(params, monthStartDay, ctx);
  return all.slice(0, limit);
}
