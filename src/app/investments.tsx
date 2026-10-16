import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, ProgressBar } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { investmentSummary, investmentTypeLabel, listInvestmentAccounts } from '@/services/accounts.service';
import { LineChart } from '@/components/charts';
import { getNetWorthTrend, getNetWorthChanges } from '@/services/analytics.service';
import { getPeriodRange } from '@/utils/date';
import { formatPercent } from '@/utils/money';

/** Investments — portfolio value, invested capital, gains and allocation. */
export default function InvestmentsScreen() {
  const theme = useTheme();
  const money = useMoney();
  const query = useQuery(async () => {
    const [accounts, changes, trend] = await Promise.all([
      listInvestmentAccounts(),
      getNetWorthChanges(1),
      getNetWorthTrend(getPeriodRange('1y', {}), 'month'),
    ]);
    return { accounts, changes, trend };
  }, []);

  if (query.loading && !query.data) return <ScrollScreen><LoadingBlock label="Loading portfolio…" /></ScrollScreen>;

  const accounts = query.data?.accounts ?? [];
  const summaries = accounts.map(investmentSummary);
  const value = summaries.reduce((sum, item) => sum + item.value, 0);
  const invested = summaries.reduce((sum, item) => sum + item.invested, 0);
  const gain = value - invested;

  const allocation = new Map<string, number>();
  for (const item of summaries) {
    const key = item.investmentType ?? 'other';
    allocation.set(key, (allocation.get(key) ?? 0) + item.value);
  }

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Investments"
        subtitle="Manual valuations - no market feeds, no credentials"
        hint={{ id: 'investments', message: 'Investments are valued manually — update the current value any time. Wallnut tracks cost basis and gains on top of your ledger.' }}
        right={
          <Button
            label="Add"
            size="sm"
            variant="secondary"
            onPress={() => router.push('/accounts' as never)}
          />
        }
      />

      {accounts.length === 0 ? (
        <EmptyState
          icon="trending-up-outline"
          title="No investment accounts"
          message="Add an investment account to track portfolio value, invested capital and gains."
          actionLabel="Add investment account"
          onAction={() => router.push('/accounts' as never)}
        />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Card>
            <AppText variant="label" tone="muted">
              PORTFOLIO VALUE
            </AppText>
            <AppText variant="numericLarge" style={{ marginTop: 6 }}>
              {money.format(value)}
            </AppText>
            <Row gap="lg" style={{ marginTop: theme.spacing.md }}>
              <View style={{ flex: 1 }}>
                <AppText variant="caption" tone="muted">
                  Invested
                </AppText>
                <AppText variant="numericSmall" tone="secondary">
                  {money.format(invested)}
                </AppText>
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="caption" tone="muted">
                  Gain / loss
                </AppText>
                <MoneyText amount={gain} variant="numericSmall" tone="positive-negative" showSign />
                {invested > 0 ? (
                  <AppText variant="caption" tone={gain >= 0 ? 'positive' : 'negative'}>
                    {gain >= 0 ? '+' : '−'}
                    {formatPercent(Math.abs((gain / invested) * 100), 1)}
                  </AppText>
                ) : null}
              </View>
            </Row>
          </Card>

          {query.data?.trend && query.data.trend.length > 1 ? (
            <Card>
              <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.md }}>
                NET WORTH (1 YEAR)
              </AppText>
              <View style={{ marginHorizontal: -8 }}>
                <LineChart
                  points={query.data.trend.map((point) => ({ key: point.key, label: point.label, fullLabel: point.fullLabel, value: point.value }))}
                  height={140}
                  showArea
                  baseline="auto"
                />
              </View>
            </Card>
          ) : null}

          {allocation.size > 1 ? (
            <Card>
              <AppText variant="label" tone="muted">
                ALLOCATION
              </AppText>
              <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.md }}>
                {Array.from(allocation.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, total]) => (
                    <View key={key} style={{ gap: 6 }}>
                      <Row justify="space-between">
                        <AppText variant="bodySmall" tone="secondary">
                          {investmentTypeLabel(key as never)}
                        </AppText>
                        <AppText variant="numericCaption" tone="muted">
                          {formatPercent(value > 0 ? (total / value) * 100 : 0, 0)}
                        </AppText>
                      </Row>
                      <ProgressBar progress={value > 0 ? (total / value) * 100 : 0} height={6} />
                    </View>
                  ))}
              </View>
            </Card>
          ) : null}

          {summaries.map((item) => (
            <Pressable key={item.accountId} onPress={() => router.push(`/account/${item.accountId}` as never)} android_ripple={{ color: theme.colors.ripple }}>
              <Card>
                <Row justify="space-between" style={{ marginBottom: theme.spacing.md }}>
                  <View>
                    <AppText variant="bodyMedium">{item.name}</AppText>
                    <AppText variant="caption" tone="muted">
                      {investmentTypeLabel(item.investmentType)}
                      {item.lastValuationDate ? ` · valued ${item.lastValuationDate}` : ''}
                    </AppText>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <MoneyText amount={item.value} variant="numericBody" tone="neutral" showSign={false} />
                    <MoneyText amount={item.gain} variant="numericCaption" tone="positive-negative" showSign />
                  </View>
                </Row>
                <ProgressBar
                  progress={item.invested > 0 ? Math.min(100, (item.value / item.invested) * 100) : 0}
                  height={6}
                  color={item.gain >= 0 ? theme.colors.positive : theme.colors.negative}
                />
                <Row justify="space-between" style={{ marginTop: theme.spacing.sm }}>
                  <AppText variant="caption" tone="muted">
                    Invested {money.format(item.invested)}
                  </AppText>
                  {item.gainPercent !== null ? (
                    <AppText variant="caption" tone={item.gain >= 0 ? 'positive' : 'negative'}>
                      {item.gain >= 0 ? '+' : '−'}
                      {formatPercent(Math.abs(item.gainPercent), 1)}
                    </AppText>
                  ) : null}
                </Row>
              </Card>
            </Pressable>
          ))}

          <InfoBanner message="Valuations are yours to enter. Updating a value writes an adjustment transaction, so your history stays auditable instead of being silently rewritten." />
        </View>
      )}
    </ScrollScreen>
  );
}
