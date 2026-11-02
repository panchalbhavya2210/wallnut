import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, KeyValueRow, Row, ScrollScreen, ScreenHeader, SectionHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, ProgressBar } from '@/components/ui/controls';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/feedback';
import { LineChart } from '@/components/charts';
import { PeriodChips } from '@/components/PeriodPicker';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { getMerchantDetail } from '@/services/analytics.service';
import { listTransactions } from '@/services/transactions.service';
import { formatDayMonth, getPeriodRange, toISODate, type PeriodPreset } from '@/utils/date';
import { formatPercent } from '@/utils/money';

/**
 * Merchant detail — the answer to "where did my money go at this business?".
 *
 * A merchant is the shop/recipient; categories say what the purchase was for.
 * Totals are net of refunds, the share denominator is all spending in the
 * period, and the transaction list is filtered to the same range as the cards.
 */
export default function MerchantDetailScreen() {
  const theme = useTheme();
  const money = useMoney();
  const { name } = useLocalSearchParams<{ name: string }>();
  const merchantName = name ? decodeURIComponent(name) : '';
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const [period, setPeriod] = useState<PeriodPreset>('thisMonth');

  const range = useMemo(() => getPeriodRange(period, { monthStartDay }), [period, monthStartDay]);

  const query = useQuery(async () => {
    if (!merchantName) return null;
    const from = toISODate(range.start);
    const to = toISODate(range.end);
    const [detail, transactions] = await Promise.all([
      getMerchantDetail({ range }, merchantName),
      listTransactions({
        merchantCanonical: merchantName,
        from,
        to,
        limit: 200,
        includeRefunds: true,
        sort: 'date_desc',
      }),
    ]);
    return { detail, transactions };
  }, [merchantName, range.start.getTime(), range.end.getTime()]);

  if (query.loading) {
    return (
      <ScrollScreen>
        <ScreenHeader title={merchantName || 'Merchant'} />
        <LoadingBlock label="Loading merchant…" />
      </ScrollScreen>
    );
  }
  if (query.error) {
    return (
      <ScrollScreen>
        <ScreenHeader title={merchantName || 'Merchant'} />
        <ErrorBlock message={query.error.message} onRetry={query.refresh} />
      </ScrollScreen>
    );
  }

  const data = query.data;
  if (!data || (data.detail.count === 0 && data.detail.refundCount === 0)) {
    return (
      <ScrollScreen>
        <ScreenHeader title={merchantName || 'Merchant'} />
        <EmptyState
          icon="storefront-outline"
          title="No activity here"
          message={`No expenses from ${merchantName || 'this merchant'} in the selected period. Try a wider date range.`}
        />
      </ScrollScreen>
    );
  }

  const { detail, transactions } = data;

  return (
    <ScrollScreen>
      <ScreenHeader
        title={detail.name}
        subtitle="Merchant · where you spent"
        right={
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: theme.radius.full,
              backgroundColor: theme.colors.accent.soft,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Ionicons name="storefront-outline" size={20} color={theme.colors.accent.base} />
          </View>
        }
      />

      <PeriodChips
        value={period}
        onChange={setPeriod}
        options={['thisMonth', 'lastMonth', '30d', '3m', '6m', '1y', 'all']}
        style={{ marginBottom: theme.spacing.lg }}
      />

      <View style={{ gap: theme.spacing.lg }}>
        <Card>
          <View style={{ gap: 4 }}>
            <AppText variant="caption" tone="muted">
              Spent {formatDayMonth(range.start)} – {formatDayMonth(range.end)}
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.spacing.md }}>
              <AppText variant="numericLarge" style={{ flexShrink: 1 }} numberOfLines={1}>
                {money.format(detail.total)}
              </AppText>
              {detail.change !== null && detail.previousTotal > 0 ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: theme.spacing.sm,
                    paddingVertical: 4,
                    borderRadius: theme.radius.full,
                    backgroundColor: detail.change > 0 ? theme.colors.negativeSoft : theme.colors.positiveSoft,
                  }}>
                  <Ionicons
                    name={detail.change > 0 ? 'arrow-up' : 'arrow-down'}
                    size={12}
                    color={detail.change > 0 ? theme.colors.negative : theme.colors.positive}
                  />
                  <AppText variant="numericCaption" tone={detail.change > 0 ? 'negative' : 'positive'}>
                    {formatPercent(Math.abs(detail.change), 0)} vs previous
                  </AppText>
                </View>
              ) : null}
            </View>
            {detail.refunds > 0 ? (
              <AppText variant="caption" tone="muted">
                Net of {money.format(detail.refunds)} in refunds · {formatPercent(detail.share, 1)} of all spending this period
              </AppText>
            ) : (
              <AppText variant="caption" tone="muted">
                {formatPercent(detail.share, 1)} of all spending this period
              </AppText>
            )}
          </View>

          <View style={{ marginTop: theme.spacing.md }}>
            <KeyValueRow label="Transactions" value={String(detail.count)} />
            <KeyValueRow label="Average" value={money.format(detail.average)} />
            <KeyValueRow label="Largest" value={money.format(detail.largest)} />
            <KeyValueRow label="Last used" value={detail.lastUsed ? formatDayMonth(new Date(detail.lastUsed)) : '—'} />
          </View>
        </Card>

        {detail.categories.length > 0 ? (
          <Card>
            <AppText variant="titleSmall" style={{ marginBottom: theme.spacing.md }}>
              What you bought here
            </AppText>
            <View style={{ gap: theme.spacing.md }}>
              {detail.categories.map((category) => (
                <Pressable
                  key={category.categoryId ?? 'uncategorised'}
                  onPress={() => category.categoryId && router.push(`/category/${category.categoryId}` as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`${category.name}, ${money.format(category.total)}`}
                  style={{ gap: 6 }}>
                  <Row justify="space-between">
                    <Row gap="sm" style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: category.color }} />
                      <AppText variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>
                        {category.name}
                      </AppText>
                    </Row>
                    <AppText variant="numericCaption" tone="secondary">
                      {money.format(category.total)} · {formatPercent(category.share, 0)}
                    </AppText>
                  </Row>
                  <ProgressBar progress={category.share} height={5} color={category.color} />
                </Pressable>
              ))}
            </View>
          </Card>
        ) : null}

        {detail.trend.some((point) => point.value > 0) ? (
          <Card>
            <AppText variant="titleSmall" style={{ marginBottom: theme.spacing.md }}>
              Monthly trend
            </AppText>
            {detail.trend.filter((point) => point.value > 0).length > 1 ? (
              <View style={{ marginHorizontal: -8 }}>
                <LineChart points={detail.trend} height={140} showAverage />
              </View>
            ) : (
              <AppText variant="caption" tone="muted">
                There is only one month of activity in this range, so there is no trend line to compare yet.
              </AppText>
            )}
          </Card>
        ) : null}

        <View>
          <SectionHeader title={`Transactions (${transactions.length})`} actionLabel="Open ledger" onAction={() =>
            router.push(
              `/transactions?merchantCanonical=${encodeURIComponent(detail.name)}&merchantName=${encodeURIComponent(detail.name)}` as never,
            )
          } />
          {transactions.length === 0 ? (
            <EmptyState
              icon="receipt-outline"
              title="No rows in this range"
              message="The summary and the transaction list always use the same date range."
            />
          ) : (
            <View
              style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.lg,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                overflow: 'hidden',
              }}>
              {transactions.slice(0, 60).map((row, index) => (
                <Pressable
                  key={row.id}
                  onPress={() => router.push(`/transaction/${row.id}` as never)}
                  android_ripple={{ color: theme.colors.ripple }}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.merchant || row.description || 'Transaction'}, ${money.format(row.amount)}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.md,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.border,
                  }}>
                  <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                    <AppText variant="bodySmall" numberOfLines={1}>
                      {row.description || row.merchant || 'Transaction'}
                    </AppText>
                    <AppText variant="caption" tone="muted" numberOfLines={1}>
                      {formatDayMonth(new Date(row.date))} · {row.categoryName ?? 'Uncategorised'} · {row.accountName}
                      {row.type === 'refund' ? ' · refund' : ''}
                    </AppText>
                  </View>
                  <MoneyText amount={row.amount} variant="numericCaption" tone="auto" />
                </Pressable>
              ))}
            </View>
          )}
          {transactions.length > 60 ? (
            <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm, textAlign: 'center' }}>
              Showing 60 of {transactions.length}. Open the ledger for the full list.
            </AppText>
          ) : null}
        </View>

        <Button
          label="Open all transactions"
          variant="secondary"
          icon="receipt-outline"
          fullWidth
          onPress={() =>
            router.push(
              `/transactions?merchantCanonical=${encodeURIComponent(detail.name)}&merchantName=${encodeURIComponent(detail.name)}` as never,
            )
          }
        />
      </View>
    </ScrollScreen>
  );
}
