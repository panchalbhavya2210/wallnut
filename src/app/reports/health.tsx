import React from 'react';
import { View } from 'react-native';

import { useTheme } from '@/theme/theme';
import { Card, KeyValueRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { ProgressBar } from '@/components/ui/controls';
import { InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { getFinancialHealth } from '@/services/reports.service';
import { formatPercent } from '@/utils/money';

/**
 * Financial health — descriptive metrics only. No scores, no advice, no
 * predictions dressed up as certainty.
 */
export default function FinancialHealthScreen() {
  const theme = useTheme();
  const money = useMoney();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const query = useQuery(() => getFinancialHealth(monthStartDay), [monthStartDay]);
  const health = query.data;

  return (
    <ScrollScreen>
      <ScreenHeader title="Financial health" subtitle="Six-month view of the numbers that matter" />

      {query.loading || !health ? (
        <LoadingBlock label="Measuring…" />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Card>
            <AppText variant="label" tone="muted">
              SAVINGS RATE
            </AppText>
            <AppText variant="display" style={{ marginTop: 4 }}>
              {formatPercent(health.savingsRate, 0)}
            </AppText>
            <ProgressBar progress={Math.max(0, Math.min(100, health.savingsRate))} height={8} style={{ marginTop: theme.spacing.md }} />
            <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
              Share of income kept over the last six months.
            </AppText>
          </Card>

          <Card>
            <AppText variant="label" tone="muted">
              RESERVES & COMMITMENTS
            </AppText>
            <View style={{ marginTop: theme.spacing.sm }}>
              <KeyValueRow label="Emergency reserve" value={`${health.emergencyReserveMonths.toFixed(1)} months`} />
              <KeyValueRow label="Recurring commitments" value={`${money.format(health.monthlyRecurringCommitments)}/month`} />
              <KeyValueRow label="Subscriptions" value={`${money.format(health.subscriptionAnnualCost)}/year`} />
            </View>
            <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
              Reserve = spendable balances ÷ your average monthly spending.
            </AppText>
          </Card>

          <Card>
            <AppText variant="label" tone="muted">
              DEBT & RECEIVABLES
            </AppText>
            <View style={{ marginTop: theme.spacing.sm }}>
              <KeyValueRow label="Money you owe" value={<MoneyText amount={-health.totalDebt} variant="numericBody" tone="negative" />} />
              <KeyValueRow label="Money owed to you" value={<MoneyText amount={health.receivables} variant="numericBody" tone="positive" />} />
            </View>
          </Card>

          <Card>
            <AppText variant="label" tone="muted">
              WEALTH
            </AppText>
            <View style={{ marginTop: theme.spacing.sm }}>
              <KeyValueRow label="Net worth" value={<MoneyText amount={health.netWorth} variant="numericBody" tone="neutral" />} />
              <KeyValueRow
                label="Net worth growth (1 year)"
                value={
                  health.netWorthGrowthPercent === null
                    ? '—'
                    : `${health.netWorthGrowthPercent >= 0 ? '+' : '−'}${formatPercent(Math.abs(health.netWorthGrowthPercent), 1)}`
                }
              />
              <KeyValueRow label="Investment value" value={money.format(health.investmentValue)} />
              <KeyValueRow label="Investment gain" value={<MoneyText amount={health.investmentGain} variant="numericBody" tone="positive-negative" showSign />} />
            </View>
          </Card>

          <Card>
            <AppText variant="label" tone="muted">
              DISCIPLINE
            </AppText>
            <View style={{ marginTop: theme.spacing.sm }}>
              <KeyValueRow
                label="Budget adherence"
                value={health.budgetAdherencePercent === null ? 'no budgets' : formatPercent(health.budgetAdherencePercent, 0)}
              />
              <KeyValueRow label="Budgets over limit" value={String(health.budgetsOverCount)} />
              <KeyValueRow
                label="Goal progress"
                value={health.goalProgressPercent === null ? 'no goals' : formatPercent(health.goalProgressPercent, 0)}
              />
            </View>
          </Card>

          <InfoBanner message="These are descriptions of your own data, not advice. Wallnut has no opinion about how you should spend — it just makes the numbers legible." />
        </View>
      )}
    </ScrollScreen>
  );
}
