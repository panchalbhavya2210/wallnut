import {
  getCategoryBreakdown,
  getLargestExpenses,
  getNetWorthSummary,
  getPeriodSummary,
  getSpendingVelocity,
  getTopMerchants,
} from '@/services/analytics.service';
import { getDebtOverview } from '@/services/debts.service';
import { isSpendable, listAccounts } from '@/services/accounts.service';
import { getUpcoming } from '@/services/recurring.service';
import { getGoalsProgress } from '@/services/goals.service';
import { getPeriodRange, previousRange, toISODate, type DateRange } from '@/utils/date';
import { formatPercent } from '@/utils/money';

import { computeAffordability, type AffordabilityResult } from './affordability';
import { toMajor } from './context';
import type { Json } from './privacy';
import type { FinanceIntent } from './intents';

/**
 * Runs a detected intent against the financial engine and returns a
 * deterministic fact plus the structured data an AI explanation may use.
 * Every number in `fact` comes from the engine — never from a model.
 */

export interface ResolvedAnswer {
  fact: string;
  data: Json;
  href?: string;
}

export interface ResolverOptions {
  monthStartDay: number;
}

export async function resolveIntent(intent: FinanceIntent, options: ResolverOptions): Promise<ResolvedAnswer | null> {
  const range = getPeriodRange('thisMonth', { monthStartDay: options.monthStartDay });
  const prev = previousRange(range);

  switch (intent.kind) {
    case 'category_spend': {
      const [categories, merchants] = await Promise.all([
        getCategoryBreakdown({ range }),
        getTopMerchants({ range }, 200),
      ]);
      const query = intent.query.toLowerCase();
      const category = categories.rows.find((row) => row.name.toLowerCase().includes(query));
      if (category) {
        const previousRow = (await getCategoryBreakdown({ range: prev })).rows.find((row) => row.categoryId === category.categoryId);
        return {
          fact: `You spent ₹${toMajor(category.total).toLocaleString('en-IN')} on ${category.name} this month${category.change !== null ? ` — ${formatPercent(Math.abs(category.change), 0)} ${category.change >= 0 ? 'more' : 'less'} than last month` : ''}.`,
          data: {
            type: 'category_spend',
            category: category.name,
            amount: toMajor(category.total),
            previousAmount: previousRow ? toMajor(previousRow.total) : 0,
            changePercent: category.change,
            count: category.count,
          },
          href: category.categoryId ? `/category/${category.categoryId}` : '/transactions',
        };
      }
      const merchant = merchants.find((row) => row.name.toLowerCase().includes(query));
      if (merchant) {
        return {
          fact: `You spent ₹${toMajor(merchant.total).toLocaleString('en-IN')} at ${merchant.name} this month across ${merchant.count} transaction${merchant.count === 1 ? '' : 's'}.`,
          data: {
            type: 'merchant_spend',
            merchant: merchant.name,
            amount: toMajor(merchant.total),
            count: merchant.count,
            average: toMajor(merchant.average),
            largest: toMajor(merchant.largest),
            changePercent: merchant.change,
          },
          href: `/merchant/${encodeURIComponent(merchant.name)}`,
        };
      }
      return {
        fact: `I couldn't find a category or merchant matching “${intent.query}” in this month's spending.`,
        data: { type: 'not_found', query: intent.query },
      };
    }

    case 'month_spend': {
      const target = intent.month === 'last' ? prev : range;
      const summary = await getPeriodSummary({ range: target });
      const label = intent.month === 'last' ? 'Last month' : 'This month';
      const categories = await getCategoryBreakdown({ range: target });
      return {
        fact: `${label} you spent ₹${toMajor(summary.totals.netExpense).toLocaleString('en-IN')} across ${summary.totals.transactionCount} transactions. Income was ₹${toMajor(summary.totals.income).toLocaleString('en-IN')}.`,
        data: {
          type: 'month_spend',
          month: intent.month,
          expenses: toMajor(summary.totals.netExpense),
          income: toMajor(summary.totals.income),
          savings: toMajor(summary.totals.savings),
          savingsRate: summary.totals.savingsRate,
          topCategories: categories.rows.slice(0, 5).map((row) => ({ name: row.name, amount: toMajor(row.total) })),
        },
        href: '/analytics',
      };
    }

    case 'savings_rate': {
      const summary = await getPeriodSummary({ range });
      return {
        fact: `Your savings rate this month is ${formatPercent(summary.totals.savingsRate, 1)} — you kept ₹${toMajor(summary.totals.savings).toLocaleString('en-IN')} of ₹${toMajor(summary.totals.income).toLocaleString('en-IN')} income.`,
        data: {
          type: 'savings_rate',
          savingsRate: summary.totals.savingsRate,
          savings: toMajor(summary.totals.savings),
          income: toMajor(summary.totals.income),
          previousSavingsRate: (await getPeriodSummary({ range: prev })).totals.savingsRate,
        },
        href: '/reports/monthly',
      };
    }

    case 'income': {
      const summary = await getPeriodSummary({ range });
      return {
        fact: `Your income this month is ₹${toMajor(summary.totals.income).toLocaleString('en-IN')}.`,
        data: { type: 'income', income: toMajor(summary.totals.income), expenses: toMajor(summary.totals.netExpense) },
        href: '/reports/cashflow',
      };
    }

    case 'owe_people':
    case 'lent': {
      const debt = await getDebtOverview();
      const lent = intent.kind === 'lent';
      return {
        fact: lent
          ? `People owe you ₹${toMajor(debt.theyOweYou).toLocaleString('en-IN')} across ${debt.openCount} open item${debt.openCount === 1 ? '' : 's'}.`
          : `You owe ₹${toMajor(debt.youOwe).toLocaleString('en-IN')} across ${debt.openCount} open item${debt.openCount === 1 ? '' : 's'}.`,
        data: {
          type: lent ? 'lent' : 'owe_people',
          theyOweYou: toMajor(debt.theyOweYou),
          youOwe: toMajor(debt.youOwe),
          overdue: debt.overdueCount,
        },
        href: '/debts',
      };
    }

    case 'biggest_expense': {
      const largest = await getLargestExpenses({ range }, 1);
      const top = largest[0];
      if (!top) return { fact: 'No expenses recorded this month yet.', data: { type: 'biggest_expense', found: false } };
      return {
        fact: `Your biggest expense this month is ${top.merchant ?? top.description ?? top.categoryName ?? 'a transaction'} at ₹${Math.abs(toMajor(top.amount)).toLocaleString('en-IN')} on ${top.date}.`,
        data: {
          type: 'biggest_expense',
          merchant: top.merchant,
          category: top.categoryName,
          amount: Math.abs(toMajor(top.amount)),
          date: top.date,
        },
        href: `/transaction/${top.id}`,
      };
    }

    case 'category_increase': {
      const categories = await getCategoryBreakdown({ range });
      const increased = categories.rows
        .filter((row) => row.change !== null && row.change > 5)
        .sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
      const top = increased[0];
      if (!top) return { fact: 'No category increased significantly compared with last month.', data: { type: 'category_increase', found: false } };
      return {
        fact: `${top.name} increased the most — ${formatPercent(top.change ?? 0, 0)} to ₹${toMajor(top.total).toLocaleString('en-IN')} this month.`,
        data: {
          type: 'category_increase',
          category: top.name,
          amount: toMajor(top.total),
          previousAmount: toMajor(top.previousTotal),
          changePercent: top.change,
        },
        href: top.categoryId ? `/category/${top.categoryId}` : '/analytics',
      };
    }

    case 'affordability': {
      if (intent.amountMinor === null) {
        return {
          fact: `I need a price to check that — try something like “Can I afford ₹55,000 for a ${intent.item}?”`,
          data: { type: 'affordability_missing_amount', item: intent.item },
        };
      }
      const resolution = await resolveAffordability(intent.amountMinor, options.monthStartDay);
      return {
        fact: resolution.fact,
        data: { type: 'affordability', item: intent.item, purchase: toMajor(intent.amountMinor), ...resolution.data },
        href: '/analytics',
      };
    }

    default:
      return null;
  }
}

export interface AffordabilityResolution {
  fact: string;
  data: AffordabilityResult & { liquidCash: number; upcoming: number; projectedRemaining: number; creditCardDue: number; savingsCommitments: number };
}

/** Gathers every input for the pure affordability maths. */
export async function resolveAffordability(purchaseMinor: number, monthStartDay: number): Promise<AffordabilityResolution> {
  const range = getPeriodRange('thisMonth', { monthStartDay });
  const [summary, previousSummary, pace, upcoming, netWorth, accounts, goals] = await Promise.all([
    getPeriodSummary({ range }),
    getPeriodSummary({ range: previousRange(range) }),
    getSpendingVelocity({ range }),
    getUpcoming(50),
    getNetWorthSummary(),
    listAccounts(),
    getGoalsProgress(),
  ]);

  const liquidCash = netWorth.accounts
    .filter((account) => account.includeInTotalBalance && isSpendable(account.type))
    .reduce((sum, account) => sum + account.currentBalance, 0);

  const creditCardDue = accounts
    .filter((account) => account.type === 'credit_card')
    .reduce((sum, account) => sum + Math.max(0, -account.currentBalance), 0);

  const upcomingObligations = upcoming
    .filter((entry) => entry.recurring.type !== 'income' && toISODate(entry.nextDate) <= toISODate(range.end))
    .reduce((sum, entry) => sum + entry.recurring.amount, 0);

  const savingsCommitments = goals.reduce((sum, goal) => sum + (goal.requiredMonthly ?? 0), 0);
  const projectedRemaining = Math.max(0, pace.projectedTotal - pace.currentTotal);
  const averageMonthlyExpense = Math.max(previousSummary.totals.netExpense, summary.totals.netExpense);

  const result = computeAffordability({
    purchase: purchaseMinor,
    liquidCash,
    remainingProjectedSpend: projectedRemaining,
    upcomingObligations,
    creditCardDue,
    savingsCommitments,
    averageMonthlyExpense,
  });

  const verdictLine =
    result.verdict === 'comfortable'
      ? 'fits comfortably'
      : result.verdict === 'tight'
        ? 'fits but would tighten your buffer'
        : 'does not fit your current buffer';

  return {
    fact: `A ₹${toMajor(purchaseMinor).toLocaleString('en-IN')} purchase ${verdictLine}: your buffer drops from ₹${toMajor(result.bufferBefore).toLocaleString('en-IN')} to ₹${toMajor(result.bufferAfter).toLocaleString('en-IN')} (${result.bufferReducedPercent}% of the buffer, ${result.shareOfMonthlySpend}% of an average month).`,
    data: {
      ...result,
      liquidCash: toMajor(liquidCash),
      upcoming: toMajor(upcomingObligations),
      projectedRemaining: toMajor(projectedRemaining),
      creditCardDue: toMajor(creditCardDue),
      savingsCommitments: toMajor(savingsCommitments),
    },
  };
}
