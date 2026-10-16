import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/theme';
import { Card, KeyValueRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { LoadingBlock } from '@/components/ui/feedback';
import { FlowBars } from '@/components/charts';
import { ForecastCard } from '@/components/ForecastCard';
import { PeriodChips } from '@/components/PeriodPicker';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { getCashFlowReport, getForecast } from '@/services/reports.service';
import { getCategoryBreakdown } from '@/services/analytics.service';
import { getPeriodRange, type PeriodPreset } from '@/utils/date';

/** Cash flow statement — income, spending, investments, debt, net cash change. */
export default function CashFlowReportScreen() {
  const theme = useTheme();
  const money = useMoney();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const [period, setPeriod] = useState<PeriodPreset>('thisMonth');

  const range = useMemo(() => getPeriodRange(period, { monthStartDay }), [period, monthStartDay]);

  const query = useQuery(async () => {
    const [report, categories] = await Promise.all([getCashFlowReport(range), getCategoryBreakdown({ range }, { limit: 8 })]);
    return { report, categories };
  }, [range.start.getTime(), range.end.getTime()]);

  const forecastQuery = useQuery(() => getForecast(monthStartDay), [monthStartDay]);

  const report = query.data?.report;
  const forecast = forecastQuery.data;

  return (
    <ScrollScreen>
      <ScreenHeader title="Cash flow" subtitle="Where money actually went" />

      <PeriodChips value={period} onChange={setPeriod} options={['thisMonth', 'lastMonth', '30d', '3m', '6m', '1y']} style={{ marginBottom: theme.spacing.lg }} />

      {query.loading || !report ? (
        <LoadingBlock label="Building the statement…" />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Card>
            <AppText variant="label" tone="muted">
              NET CASH CHANGE
            </AppText>
            <AppText variant="numericLarge" style={{ marginTop: 6 }} tone={report.netCashChange >= 0 ? 'positive' : 'negative'}>
              {money.format(report.netCashChange, { sign: 'always' })}
            </AppText>
            <AppText variant="caption" tone="muted" style={{ marginTop: 4 }}>
              What's left in your spendable accounts after everything below.
            </AppText>
          </Card>

          <Card>
            <AppText variant="label" tone="muted">
              STATEMENT
            </AppText>
            <View style={{ marginTop: theme.spacing.sm }}>
              <KeyValueRow label="Income" value={<MoneyText amount={report.income} variant="numericBody" tone="positive" />} />
              <KeyValueRow label="Spending (net of refunds)" value={<MoneyText amount={-report.expenses} variant="numericBody" tone="negative" />} />
              {report.refunds > 0 ? (
                <KeyValueRow label="  of which refunded" value={<MoneyText amount={report.refunds} variant="numericCaption" tone="muted" />} />
              ) : null}
              <KeyValueRow label="Investments" value={<MoneyText amount={-report.investments} variant="numericBody" tone="muted" />} />
              {report.cardAndLoanPayments > 0 ? (
                <KeyValueRow label="Card & loan payments" value={<MoneyText amount={-report.cardAndLoanPayments} variant="numericBody" tone="muted" />} />
              ) : null}
              {report.insurance > 0 ? (
                <KeyValueRow label="Insurance premiums" value={<MoneyText amount={-report.insurance} variant="numericBody" tone="muted" />} />
              ) : null}
              {report.savingsTransfers > 0 ? (
                <KeyValueRow label="Savings transfers" value={<MoneyText amount={-report.savingsTransfers} variant="numericBody" tone="muted" />} />
              ) : null}
              {report.lentOut > 0 ? (
                <KeyValueRow label="Lent to others" value={<MoneyText amount={-report.lentOut} variant="numericBody" tone="muted" />} />
              ) : null}
              {report.borrowedIn > 0 ? (
                <KeyValueRow label="Borrowed" value={<MoneyText amount={report.borrowedIn} variant="numericBody" tone="muted" />} />
              ) : null}
              {report.debtCollected > 0 ? (
                <KeyValueRow label="Repayments received" value={<MoneyText amount={report.debtCollected} variant="numericBody" tone="muted" />} />
              ) : null}
              {report.debtRepaid > 0 ? (
                <KeyValueRow label="Repayments made" value={<MoneyText amount={-report.debtRepaid} variant="numericBody" tone="muted" />} />
              ) : null}
            </View>
            <View style={{ marginTop: theme.spacing.md, paddingTop: theme.spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
              <Row justify="space-between">
                <AppText variant="bodyMedium">Net cash change</AppText>
                <MoneyText amount={report.netCashChange} variant="numericBody" tone="positive-negative" showSign />
              </Row>
            </View>
            <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
              Transfers between your own spendable accounts never appear here — moving money is not spending.
            </AppText>
          </Card>

          {forecast ? <ForecastCard forecast={forecast} /> : null}

          {query.data && query.data.categories.rows.length > 0 ? (
            <Card>
              <AppText variant="label" tone="muted">
                MONEY FLOW
              </AppText>
              <View style={{ marginTop: theme.spacing.md }}>
                <FlowBars
                  totalLabel="Outflow by category"
                  totalValue={query.data.categories.total}
                  items={query.data.categories.rows.map((row) => ({
                    id: row.categoryId ?? 'none',
                    label: row.name,
                    value: row.total,
                    color: row.color,
                  }))}
                />
              </View>
            </Card>
          ) : null}
        </View>
      )}
    </ScrollScreen>
  );
}
