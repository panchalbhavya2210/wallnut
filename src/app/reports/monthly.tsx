import React from 'react';
import { View } from 'react-native';

import { useTheme } from '@/theme/theme';
import { Card, KeyValueRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { ProgressBar } from '@/components/ui/controls';
import { EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { AiMonthlyReview } from '@/components/AiMonthlyReview';
import { DonutChart } from '@/components/charts';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { getMonthlyReview } from '@/services/reports.service';
import { formatMonthYear, formatDayMonth } from '@/utils/date';
import { formatPercent } from '@/utils/money';

/** Monthly review — the story of the month in one screen. */
export default function MonthlyReviewScreen() {
  const theme = useTheme();
  const money = useMoney();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const query = useQuery(() => getMonthlyReview(monthStartDay), [monthStartDay]);
  const review = query.data;

  return (
    <ScrollScreen>
      <ScreenHeader title="Monthly review" subtitle={review ? formatMonthYear(review.range.start) : 'This month'} />

      {query.loading || !review ? (
        <LoadingBlock label="Reviewing the month…" />
      ) : review.income === 0 && review.expenses === 0 ? (
        <EmptyState
          icon="document-text-outline"
          title="Nothing to review yet"
          message="Once you record income and spending this month, Wallnut writes a review from your actual numbers."
        />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Card>
            <Row justify="space-between" style={{ marginBottom: theme.spacing.lg }}>
              <View>
                <AppText variant="caption" tone="muted">
                  Income
                </AppText>
                <MoneyText amount={review.income} variant="numericMedium" tone="positive" />
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <AppText variant="caption" tone="muted">
                  Spent
                </AppText>
                <MoneyText amount={-review.expenses} variant="numericMedium" tone="negative" />
              </View>
            </Row>

            <AppText variant="label" tone="muted">
              SAVED
            </AppText>
            <AppText variant="display" style={{ marginTop: 4 }} tone={review.saved >= 0 ? 'positive' : 'negative'}>
              {money.format(review.saved)}
            </AppText>
            <ProgressBar progress={Math.max(0, Math.min(100, review.savingsRate))} height={8} style={{ marginTop: theme.spacing.md }} />
            <Row justify="space-between" style={{ marginTop: theme.spacing.sm }}>
              <AppText variant="caption" tone="muted">
                Savings rate {formatPercent(review.savingsRate, 1)}
              </AppText>
              <AppText variant="caption" tone={(review.savingsChangePercent ?? 0) >= 0 ? 'positive' : 'negative'}>
                {review.savingsChangePercent === null
                  ? 'no prior month'
                  : `${review.savingsChangePercent >= 0 ? '+' : '−'}${formatPercent(Math.abs(review.savingsChangePercent), 0)} vs last month`}
              </AppText>
            </Row>
          </Card>

          <AiMonthlyReview range={review.range} />

          <Card>
            <AppText variant="label" tone="muted">
              HIGHLIGHTS
            </AppText>
            <View style={{ marginTop: theme.spacing.sm }}>
              {review.biggestCategory ? (
                <KeyValueRow
                  label="Biggest category"
                  value={`${review.biggestCategory.name} · ${money.format(review.biggestCategory.total)}`}
                />
              ) : null}
              {review.biggestMerchant ? (
                <KeyValueRow label="Biggest merchant" value={`${review.biggestMerchant.name} · ${money.format(review.biggestMerchant.total)}`} />
              ) : null}
              {review.largestExpense ? (
                <KeyValueRow
                  label="Largest expense"
                  value={`${review.largestExpense.merchant ?? review.largestExpense.description ?? 'Expense'} · ${money.format(
                    review.largestExpense.amount,
                  )} (${formatDayMonth(new Date(review.largestExpense.date))})`}
                />
              ) : null}
              <KeyValueRow label="Transactions" value={String(review.transactionCount)} />
              {review.refunds > 0 ? <KeyValueRow label="Refunded" value={money.format(review.refunds)} /> : null}
            </View>
          </Card>

          <Card>
            <AppText variant="label" tone="muted">
              COMPARED WITH {formatMonthYear(review.previousRange.start).toUpperCase()}
            </AppText>
            <View style={{ marginTop: theme.spacing.sm }}>
              <KeyValueRow
                label="Spending"
                value={
                  review.spendingChangePercent === null
                    ? '—'
                    : `${review.spendingChangePercent > 0 ? '+' : '−'}${formatPercent(Math.abs(review.spendingChangePercent), 1)}`
                }
              />
              <KeyValueRow
                label="Savings"
                value={
                  review.savingsChangePercent === null
                    ? '—'
                    : `${review.savingsChangePercent > 0 ? '+' : '−'}${formatPercent(Math.abs(review.savingsChangePercent), 1)}`
                }
              />
              <KeyValueRow
                label="Net worth"
                value={<MoneyText amount={review.netWorthChange} variant="numericBody" tone="positive-negative" showSign />}
              />
            </View>
          </Card>

          {review.topCategories.length > 0 ? (
            <Card>
              <AppText variant="label" tone="muted">
                WHERE IT WENT
              </AppText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg, marginTop: theme.spacing.md }}>
                <DonutChart
                  size={130}
                  thickness={16}
                  slices={review.topCategories.map((category) => ({
                    id: category.name,
                    label: category.name,
                    value: category.total,
                    color: category.color,
                  }))}
                  centerTop="Spent"
                  centerBottom={money.format(review.expenses, { compact: true })}
                />
                <View style={{ flex: 1, gap: 10 }}>
                  {review.topCategories.map((category) => (
                    <View key={category.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: category.color }} />
                      <AppText variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                        {category.name}
                      </AppText>
                      <AppText variant="numericCaption" tone="secondary">
                        {money.format(category.total)}
                      </AppText>
                      {category.change !== null ? (
                        <AppText variant="caption" tone={category.change > 0 ? 'negative' : 'positive'} style={{ width: 46, textAlign: 'right' }}>
                          {category.change > 0 ? '+' : '−'}
                          {formatPercent(Math.abs(category.change), 0)}
                        </AppText>
                      ) : null}
                    </View>
                  ))}
                </View>
              </View>
            </Card>
          ) : null}
        </View>
      )}
    </ScrollScreen>
  );
}
