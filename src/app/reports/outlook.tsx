import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { Card, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Gauge } from '@/components/Gauge';
import { LoadingBlock } from '@/components/ui/feedback';
import { ForecastCard } from '@/components/ForecastCard';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { getForecast } from '@/services/reports.service';
import { getSafeToSpend } from '@/services/safe-to-spend.service';
import { getUpcoming } from '@/services/recurring.service';
import { listAccounts } from '@/services/accounts.service';
import { formatDayMonth } from '@/utils/date';

/**
 * Outlook — the forward-looking report: safe to spend, the deterministic
 * month-end forecast, and every scheduled payment on the horizon.
 */
export default function OutlookReportScreen() {
  const theme = useTheme();
  const money = useMoney();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);

  const query = useQuery(async () => {
    const [safe, forecast, upcoming, accounts] = await Promise.all([
      getSafeToSpend(monthStartDay),
      getForecast(monthStartDay),
      getUpcoming(14),
      listAccounts(),
    ]);
    return { safe, forecast, upcoming, accounts };
  }, [monthStartDay]);

  const data = query.data;

  return (
    <ScrollScreen>
      <ScreenHeader title="Outlook" subtitle="What's coming and what's safe to spend" />

      {query.loading || !data ? (
        <LoadingBlock label="Looking ahead…" />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Card>
            <AppText variant="label" tone="muted">
              SAFE TO SPEND
            </AppText>
            <View style={{ alignItems: 'center', marginVertical: theme.spacing.md }}>
              <Gauge
                progress={data.safe.available > 0 ? Math.max(0, Math.min(100, (data.safe.safe / Math.max(1, data.safe.available)) * 100)) : 0}
                size={150}
                thickness={14}
                tone={data.safe.safe > 0 ? 'accent' : 'negative'}
                label={money.format(data.safe.safe, { compact: true })}
                caption="safe to spend"
              />
            </View>
            <AppText variant="numericMedium" tone={data.safe.safe > 0 ? 'positive' : 'negative'} style={{ textAlign: 'center' }}>
              {money.format(data.safe.perDay)}/day
            </AppText>
            <AppText variant="caption" tone="muted" style={{ textAlign: 'center', marginTop: 4 }}>
              {data.safe.nextIncomeDate
                ? `until ${data.safe.nextIncomeLabel ?? 'your next income'} on ${formatDayMonth(new Date(data.safe.nextIncomeDate))}`
                : `${data.safe.days} days to the end of this month's cycle`}
            </AppText>

            <View style={{ marginTop: theme.spacing.lg, gap: 2 }}>
              <Row justify="space-between" style={{ paddingVertical: 6 }}>
                <AppText variant="caption" tone="muted">
                  Available cash
                </AppText>
                <AppText variant="numericCaption">{money.format(data.safe.available)}</AppText>
              </Row>
              <Row justify="space-between" style={{ paddingVertical: 6 }}>
                <AppText variant="caption" tone="muted">
                  Upcoming bills
                </AppText>
                <AppText variant="numericCaption" tone="negative">
                  − {money.format(data.safe.upcomingBills)}
                </AppText>
              </Row>
              <Row justify="space-between" style={{ paddingVertical: 6 }}>
                <AppText variant="caption" tone="muted">
                  Planned goal savings
                </AppText>
                <AppText variant="numericCaption" tone="negative">
                  − {money.format(data.safe.plannedSavings)}
                </AppText>
              </Row>
              <Row justify="space-between" style={{ paddingVertical: 6 }}>
                <AppText variant="caption" tone="muted">
                  Remaining budget commitments
                </AppText>
                <AppText variant="numericCaption" tone="negative">
                  − {money.format(data.safe.budgetCommitments)}
                </AppText>
              </Row>
            </View>
          </Card>

          <ForecastCard forecast={data.forecast} />

          <Card>
            <AppText variant="label" tone="muted">
              UPCOMING · NEXT 14 ITEMS
            </AppText>
            {data.upcoming.length === 0 ? (
              <AppText variant="bodySmall" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                Nothing scheduled yet. Add recurring payments to make this report useful.
              </AppText>
            ) : (
              <View style={{ marginTop: theme.spacing.sm }}>
                {data.upcoming.map((entry) => (
                  <Pressable
                    key={`${entry.recurring.id}-${entry.recurring.nextDate}`}
                    onPress={() => router.push('/recurring')}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: 10 }}>
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: theme.radius.md,
                        backgroundColor:
                          entry.recurring.type === 'income' ? `${theme.colors.positive}22` : `${theme.colors.negative}18`,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                      <Ionicons
                        name={entry.recurring.type === 'income' ? 'arrow-down-outline' : 'arrow-up-outline'}
                        size={16}
                        color={entry.recurring.type === 'income' ? theme.colors.positive : theme.colors.negative}
                      />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="bodySmall" numberOfLines={1}>
                        {entry.recurring.merchant}
                      </AppText>
                      <AppText variant="caption" tone={entry.overdue ? 'negative' : 'muted'}>
                        {entry.overdue ? 'Due now · ' : ''}
                        {formatDayMonth(entry.nextDate)}
                        {entry.recurring.isSubscription ? ' · subscription' : ''}
                      </AppText>
                    </View>
                    <MoneyText
                      amount={entry.recurring.type === 'income' ? entry.recurring.amount : -entry.recurring.amount}
                      variant="numericCaption"
                      tone={entry.recurring.type === 'income' ? 'positive' : 'neutral'}
                      showSign
                    />
                  </Pressable>
                ))}
              </View>
            )}
            <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
              Scheduled items are plans, not transactions — they only move money when posted.
            </AppText>
          </Card>
        </View>
      )}
    </ScrollScreen>
  );
}

export const OutlookReportStyles = StyleSheet.create({ hidden: { display: 'none' } });
