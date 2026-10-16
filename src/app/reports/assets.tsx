import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, KeyValueRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { DonutChart } from '@/components/charts';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import {
  ACCOUNT_TYPE_LABELS,
  investmentSummary,
  isInvestment,
  isLiability,
  listAccounts,
} from '@/services/accounts.service';
import { getDebtOverview } from '@/services/debts.service';
import { getNetWorthBreakdown } from '@/services/net-worth.service';
import { formatPercent } from '@/utils/money';

/**
 * Assets report — what you own, split into spendable, invested and owed,
 * with investment performance and per-person receivables.
 */
export default function AssetsReportScreen() {
  const theme = useTheme();
  const money = useMoney();

  const query = useQuery(async () => {
    const [accounts, breakdown, debts] = await Promise.all([
      listAccounts(),
      getNetWorthBreakdown(),
      getDebtOverview(),
    ]);
    return { accounts, breakdown, debts };
  }, []);

  const data = query.data;
  const accounts = data?.accounts ?? [];
  const assetAccounts = accounts.filter((account) => account.includeInNetWorth && !isLiability(account.type));
  const investments = accounts.filter((account) => isInvestment(account.type));
  const liquid = assetAccounts.filter((account) => account.type !== 'investment' && account.type !== 'insurance');
  const insurance = assetAccounts.filter((account) => account.type === 'insurance');

  const liquidTotal = liquid.reduce((sum, account) => sum + account.currentBalance, 0);
  const investmentTotal = investments.reduce((sum, account) => sum + account.currentBalance, 0);
  const insuranceTotal = insurance.reduce((sum, account) => sum + account.currentBalance, 0);
  const receivables = data?.breakdown.receivables ?? 0;
  const totalAssets = data?.breakdown.assets ?? 0;

  const slices = [
    { id: 'liquid', label: 'Cash & bank', value: Math.max(0, liquidTotal), color: theme.colors.positive },
    { id: 'investments', label: 'Investments', value: Math.max(0, investmentTotal), color: theme.colors.accent.base },
    { id: 'receivables', label: 'Money owed to you', value: receivables, color: theme.colors.warning },
    { id: 'insurance', label: 'Insurance', value: Math.max(0, insuranceTotal), color: '#6FB4FF' },
  ].filter((slice) => slice.value > 0);

  return (
    <ScrollScreen>
      <ScreenHeader title="Assets report" subtitle="What you own and what it earns" />

      {query.loading || !data ? (
        <LoadingBlock label="Collecting your assets…" />
      ) : accounts.length === 0 ? (
        <EmptyState icon="pie-chart-outline" title="No accounts yet" message="Add accounts to see your asset composition." />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Card>
            <AppText variant="label" tone="muted">
              TOTAL ASSETS
            </AppText>
            <AppText variant="numericLarge" style={{ marginTop: 6 }} tone="positive">
              {money.format(totalAssets)}
            </AppText>
            {slices.length > 0 ? (
              <View style={{ marginTop: theme.spacing.lg, alignItems: 'center' }}>
                <DonutChart
                  size={160}
                  thickness={21}
                  slices={slices}
                  centerTop="Assets"
                  centerBottom={money.format(totalAssets, { compact: true })}
                />
              </View>
            ) : null}
            <View style={{ marginTop: theme.spacing.lg }}>
              <KeyValueRow label="Cash & bank" value={<MoneyText amount={liquidTotal} variant="numericBody" />} />
              <KeyValueRow label="Investments" value={<MoneyText amount={investmentTotal} variant="numericBody" />} />
              <KeyValueRow label="Money owed to you" value={<MoneyText amount={receivables} variant="numericBody" tone="positive" />} />
              {insuranceTotal > 0 ? <KeyValueRow label="Insurance" value={<MoneyText amount={insuranceTotal} variant="numericBody" />} /> : null}
            </View>
          </Card>

          <Card>
            <AppText variant="label" tone="muted">
              CASH &amp; BANK
            </AppText>
            {liquid.length === 0 ? (
              <AppText variant="bodySmall" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                No spendable accounts.
              </AppText>
            ) : (
              <View style={{ marginTop: theme.spacing.sm }}>
                {liquid.map((account) => (
                  <Pressable
                    key={account.id}
                    onPress={() => router.push(`/account/${account.id}` as never)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: 10 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: account.color ?? theme.colors.positive }} />
                    <View style={{ flex: 1 }}>
                      <AppText variant="bodySmall" numberOfLines={1}>
                        {account.name}
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        {ACCOUNT_TYPE_LABELS[account.type]}
                        {account.institution ? ` · ${account.institution}` : ''}
                      </AppText>
                    </View>
                    <MoneyText amount={account.currentBalance} variant="numericCaption" tone="neutral" />
                  </Pressable>
                ))}
              </View>
            )}
          </Card>

          <Card>
            <AppText variant="label" tone="muted">
              INVESTMENTS
            </AppText>
            {investments.length === 0 ? (
              <AppText variant="bodySmall" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                No investment accounts. Add one to track value and gains here.
              </AppText>
            ) : (
              <View style={{ marginTop: theme.spacing.sm }}>
                {investments.map((account) => {
                  const summary = investmentSummary(account);
                  return (
                    <Pressable
                      key={account.id}
                      onPress={() => router.push(`/account/${account.id}` as never)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: 10 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: account.color ?? theme.colors.accent.base }} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="bodySmall" numberOfLines={1}>
                          {account.name}
                        </AppText>
                        <AppText variant="caption" tone="muted">
                          Invested {money.format(summary.invested, { compact: true })}
                          {summary.gain !== 0 ? ` · ${money.format(summary.gain, { compact: true, sign: 'always' })}` : ''}
                          {summary.lastValuationDate ? ` · valued ${summary.lastValuationDate}` : ''}
                        </AppText>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 2 }}>
                        <MoneyText amount={summary.value} variant="numericCaption" tone="neutral" />
                        {summary.gainPercent !== null ? (
                          <AppText variant="caption" tone={summary.gainPercent >= 0 ? 'positive' : 'negative'}>
                            {summary.gainPercent >= 0 ? '+' : '−'}
                            {formatPercent(Math.abs(summary.gainPercent), 1)}
                          </AppText>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {investmentTotal > 0 ? (
              <View
                style={{
                  marginTop: theme.spacing.md,
                  paddingTop: theme.spacing.md,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.border,
                }}>
                <Row justify="space-between">
                  <AppText variant="bodyMedium">Total invested value</AppText>
                  <MoneyText amount={investmentTotal} variant="numericBody" />
                </Row>
              </View>
            ) : null}
          </Card>

          <Card>
            <AppText variant="label" tone="muted">
              MONEY OWED TO YOU
            </AppText>
            {data.debts.people.filter((person) => person.lentRemaining > 0).length === 0 ? (
              <AppText variant="bodySmall" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                Nobody owes you right now.
              </AppText>
            ) : (
              <View style={{ marginTop: theme.spacing.sm }}>
                {data.debts.people
                  .filter((person) => person.lentRemaining > 0)
                  .map((person) => (
                    <Pressable
                      key={person.person.id}
                      onPress={() => router.push(`/person/${person.person.id}` as never)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: 10 }}>
                      <View style={{ flex: 1 }}>
                        <AppText variant="bodySmall">{person.person.name}</AppText>
                        <AppText variant="caption" tone="muted">
                          {person.openCount} open item{person.openCount === 1 ? '' : 's'}
                        </AppText>
                      </View>
                      <MoneyText amount={person.lentRemaining} variant="numericCaption" tone="positive" />
                    </Pressable>
                  ))}
              </View>
            )}
            <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
              Lending moves cash into a receivable — it is not spending, so it does not reduce your assets.
            </AppText>
          </Card>

          <Card>
            <AppText variant="label" tone="muted">
              FOR CONTRAST · WHAT YOU OWE
            </AppText>
            <View style={{ marginTop: theme.spacing.sm }}>
              <KeyValueRow label="Cards, loans & mortgages" value={<MoneyText amount={data.breakdown.accountsLiabilities} variant="numericBody" tone="negative" />} />
              <KeyValueRow label="Money you owe people" value={<MoneyText amount={-data.breakdown.payables} variant="numericBody" tone="negative" />} />
              <KeyValueRow
                label="Total liabilities"
                value={<MoneyText amount={data.breakdown.liabilities} variant="numericBody" tone="negative" />}
              />
              <KeyValueRow label="Net worth" value={<MoneyText amount={data.breakdown.netWorth} variant="numericBody" tone="positive-negative" showSign />} />
            </View>
          </Card>
        </View>
      )}
    </ScrollScreen>
  );
}

export const AssetsReportStyles = StyleSheet.create({ hidden: { display: 'none' } });
