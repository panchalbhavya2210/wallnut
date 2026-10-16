import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { ListGroup, ListRow, ScrollScreen, ScreenHeader, IconName } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { getCashFlowReport, getMonthlyReview, getFinancialHealth } from '@/services/reports.service';
import { getPeriodRange, formatMonthYear } from '@/utils/date';
import { formatPercent } from '@/utils/money';

/** Reports hub — cash flow, monthly review, financial health. */
export default function ReportsScreen() {
  const theme = useTheme();
  const money = useMoney();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);

  const query = useQuery(async () => {
    const range = getPeriodRange('thisMonth', { monthStartDay });
    const [cashflow, review, health] = await Promise.all([
      getCashFlowReport(range),
      getMonthlyReview(monthStartDay),
      getFinancialHealth(monthStartDay),
    ]);
    return { cashflow, review, health, range };
  }, [monthStartDay]);

  const data = query.data;

  return (
    <ScrollScreen>
      <ScreenHeader title="Reports" subtitle={data ? formatMonthYear(data.range.start) : 'This month'} />

      <View style={{ gap: theme.spacing.lg }}>
        <ListGroup title="Statements">
          <ListRow
            title="Cash flow"
            subtitle={data ? `Net ${money.format(data.cashflow.netCashChange, { sign: 'always' })} this month` : 'Income, spending, investments, debt'}
            icon="swap-vertical-outline"
            iconColor={theme.colors.accent.base}
            onPress={() => router.push('/reports/cashflow')}
            chevron
          />
          <ListRow
            title="Monthly review"
            subtitle={data ? `Saved ${money.format(data.review.saved)} · ${formatPercent(data.review.savingsRate, 0)} of income` : 'What happened this month'}
            icon="document-text-outline"
            iconColor={theme.colors.positive}
            onPress={() => router.push('/reports/monthly')}
            chevron
          />
          <ListRow
            title="Financial health"
            subtitle={data ? `${data.health.emergencyReserveMonths.toFixed(1)} months of reserve · ${money.format(data.health.monthlyRecurringCommitments)}/mo committed` : 'Reserves, commitments, adherence'}
            icon="heart-outline"
            iconColor={theme.colors.negative}
            onPress={() => router.push('/reports/health')}
            chevron
          />
        </ListGroup>

        <ListGroup title="Detailed reports">
          <ListRow
            title="Balance report"
            subtitle="Assets, liabilities, net worth trend"
            icon="scale-outline"
            iconColor={theme.colors.accent.base}
            onPress={() => router.push('/reports/balance')}
            chevron
          />
          <ListRow
            title="Outlook"
            subtitle="Safe to spend and the month-end forecast"
            icon="telescope-outline"
            iconColor={theme.colors.positive}
            onPress={() => router.push('/reports/outlook')}
            chevron
          />
          <ListRow
            title="Spending report"
            subtitle="Categories, merchants, pace and rhythm"
            icon="cart-outline"
            iconColor={theme.colors.negative}
            onPress={() => router.push('/reports/spending')}
            chevron
          />
          <ListRow
            title="Credit report"
            subtitle="Cards, loans, utilisation and due dates"
            icon="card-outline"
            iconColor={theme.colors.warning}
            onPress={() => router.push('/reports/credit')}
            chevron
          />
          <ListRow
            title="Assets report"
            subtitle="Cash, investments and money owed to you"
            icon="pie-chart-outline"
            iconColor={theme.colors.accent.base}
            onPress={() => router.push('/reports/assets')}
            chevron
          />
        </ListGroup>

        <ListGroup title="Focus">
          <ListRow title="Analytics" subtitle="Charts, categories, merchants, pace" icon="analytics-outline" onPress={() => router.push('/analytics')} chevron />
          <ListRow title="Calendar" subtitle="Income and spending by day" icon="calendar-outline" onPress={() => router.push('/calendar')} chevron />
          <ListRow title="Review queue" subtitle="Rows that need attention" icon="checkmark-done-outline" onPress={() => router.push('/review')} chevron />
        </ListGroup>

        <ListGroup title="Export">
          <ListRow title="Export data" subtitle="CSV, backup and restore" icon="cloud-download-outline" onPress={() => router.push('/data')} chevron />
        </ListGroup>

        <View style={{ paddingHorizontal: theme.spacing.xs }}>
          <AppText variant="caption" tone="muted">
            Every report is computed from your ledger at the moment you open it — no cached snapshots, no approximated totals.
          </AppText>
        </View>
      </View>
    </ScrollScreen>
  );
}
