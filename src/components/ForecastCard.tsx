import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/theme';
import { Card, KeyValueRow, Row } from './ui/layout';
import { AppText, MoneyText } from './ui/text';
import { useMoney } from '@/hooks/useMoney';
import type { Forecast } from '@/services/reports.service';

/**
 * The deterministic month-end projection, shared by the cash-flow report and
 * the Outlook report so both always show the same numbers. Every line is
 * labelled an estimate and carries its basis.
 */
export function ForecastCard({ forecast }: { forecast: Forecast }) {
  const theme = useTheme();
  const money = useMoney();

  return (
    <Card>
      <AppText variant="label" tone="muted">
        FORECAST TO MONTH END
      </AppText>
      <AppText
        variant="numericLarge"
        style={{ marginTop: 6 }}
        tone={forecast.projectedEndBalance >= forecast.startingBalance ? 'positive' : 'negative'}>
        {money.format(forecast.projectedEndBalance)}
      </AppText>
      <AppText variant="caption" tone="muted" style={{ marginTop: 4 }}>
        Projected from today's {money.format(forecast.startingBalance)} with {forecast.daysRemaining} day
        {forecast.daysRemaining === 1 ? '' : 's'} left.
      </AppText>
      <View style={{ marginTop: theme.spacing.md }}>
        <KeyValueRow label="Current balance" value={<MoneyText amount={forecast.startingBalance} variant="numericBody" />} />
        {forecast.lines.map((line) => (
          <KeyValueRow
            key={line.label}
            label={line.detail ? `${line.label}\n${line.detail}` : line.label}
            value={
              <MoneyText amount={line.amount} variant="numericBody" tone={line.amount >= 0 ? 'positive' : 'muted'} showSign />
            }
          />
        ))}
      </View>
      <View
        style={{
          marginTop: theme.spacing.md,
          paddingTop: theme.spacing.md,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
        }}>
        <Row justify="space-between">
          <AppText variant="bodyMedium">Projected balance</AppText>
          <MoneyText amount={forecast.projectedEndBalance} variant="numericBody" tone="positive-negative" />
        </Row>
      </View>
      <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
        An estimate, never a transaction — based on {forecast.basis.length > 0 ? forecast.basis.join(', ') : 'no scheduled items yet'}.
      </AppText>
    </Card>
  );
}
