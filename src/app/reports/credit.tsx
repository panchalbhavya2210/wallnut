import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, KeyValueRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, ProgressBar } from '@/components/ui/controls';
import { EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { ACCOUNT_TYPE_LABELS, getCreditCardInfo, isCreditLike, listAccounts } from '@/services/accounts.service';
import { formatPercent } from '@/utils/money';

/**
 * Credit report — every card, loan and mortgage with its outstanding balance,
 * limit/available credit, billing cycle and due date. Card payments are
 * transfers (never expenses) and the payment button opens a prefilled one.
 */
export default function CreditReportScreen() {
  const theme = useTheme();
  const money = useMoney();

  const query = useQuery(async () => {
    const accounts = await listAccounts();
    const creditAccounts = accounts.filter((account) => isCreditLike(account.type));
    const infos = await Promise.all(creditAccounts.map((account) => getCreditCardInfo(account.id)));
    return { accounts: creditAccounts, infos: infos.filter((info) => info !== null) };
  }, []);

  const data = query.data;
  const totalOutstanding = data?.infos.reduce((sum, info) => sum + info.outstanding, 0) ?? 0;
  const totalLimit = data?.infos.reduce((sum, info) => sum + (info.account.creditLimit ?? 0), 0) ?? 0;
  const availableCredit = data?.infos.reduce((sum, info) => sum + (info.available ?? 0), 0) ?? 0;
  const overallUtilisation = totalLimit > 0 ? (totalOutstanding / totalLimit) * 100 : null;
  const cycleSpend = data?.infos.reduce((sum, info) => sum + info.currentCycleSpend, 0) ?? 0;

  return (
    <ScrollScreen>
      <ScreenHeader title="Credit report" subtitle="Cards, loans and mortgages" />

      {query.loading || !data ? (
        <LoadingBlock label="Checking your credit…" />
      ) : data.infos.length === 0 ? (
        <EmptyState
          icon="card-outline"
          title="No credit accounts"
          message="Add a credit card, loan or mortgage account to track outstanding balances, limits and due dates."
        />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Card>
            <AppText variant="label" tone="muted">
              TOTAL OUTSTANDING
            </AppText>
            <AppText variant="numericLarge" style={{ marginTop: 6 }} tone={totalOutstanding > 0 ? 'negative' : 'positive'}>
              {money.format(-totalOutstanding)}
            </AppText>
            {overallUtilisation !== null ? (
              <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
                <Row justify="space-between">
                  <AppText variant="caption" tone="muted">
                    Overall utilisation
                  </AppText>
                  <AppText variant="numericCaption" tone={overallUtilisation > 70 ? 'negative' : overallUtilisation > 30 ? 'warning' : 'positive'}>
                    {formatPercent(overallUtilisation, 1)}
                  </AppText>
                </Row>
                <ProgressBar
                  progress={Math.min(100, overallUtilisation)}
                  height={8}
                  color={overallUtilisation > 70 ? theme.colors.negative : overallUtilisation > 30 ? theme.colors.warning : theme.colors.positive}
                />
              </View>
            ) : null}
            <View style={{ marginTop: theme.spacing.md }}>
              <KeyValueRow label="Credit limit" value={<MoneyText amount={totalLimit} variant="numericBody" />} />
              <KeyValueRow label="Available credit" value={<MoneyText amount={availableCredit} variant="numericBody" tone="positive" />} />
              <KeyValueRow label="Spent this cycle" value={<MoneyText amount={cycleSpend} variant="numericBody" />} />
              <KeyValueRow label="Accounts" value={String(data.infos.length)} />
            </View>
            <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
              Paying a card is a transfer, never spending — the purchase was already counted when it happened.
            </AppText>
          </Card>

          {data.infos.map((info) => {
            const account = info.account;
            const colour = account.color ?? theme.colors.accent.base;
            const utilisation = info.utilizationPercent;
            return (
              <Card key={account.id}>
                <Pressable onPress={() => router.push(`/account/${account.id}` as never)}>
                  <Row gap="md" justify="space-between">
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, flex: 1 }}>
                      <View
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: theme.radius.md,
                          backgroundColor: `${colour}22`,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                        <AppText variant="numericCaption" style={{ color: colour }}>
                          {ACCOUNT_TYPE_LABELS[account.type].slice(0, 1)}
                        </AppText>
                      </View>
                      <View style={{ flex: 1 }}>
                        <AppText variant="bodyMedium" numberOfLines={1}>
                          {account.name}
                        </AppText>
                        <AppText variant="caption" tone="muted">
                          {account.institution ? `${account.institution} · ` : ''}
                          {ACCOUNT_TYPE_LABELS[account.type]}
                        </AppText>
                      </View>
                    </View>
                    <MoneyText amount={account.currentBalance} variant="numericSmall" tone="negative" />
                  </Row>
                </Pressable>

                {utilisation !== null ? (
                  <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
                    <Row justify="space-between">
                      <AppText variant="caption" tone="muted">
                        Utilisation
                      </AppText>
                      <AppText variant="numericCaption" tone={utilisation > 70 ? 'negative' : utilisation > 30 ? 'warning' : 'positive'}>
                        {formatPercent(utilisation, 1)}
                      </AppText>
                    </Row>
                    <ProgressBar
                      progress={Math.min(100, utilisation)}
                      height={6}
                      color={utilisation > 70 ? theme.colors.negative : utilisation > 30 ? theme.colors.warning : theme.colors.positive}
                    />
                  </View>
                ) : null}

                <View style={{ marginTop: theme.spacing.md }}>
                  {info.available !== null ? (
                    <KeyValueRow label="Available" value={<MoneyText amount={info.available} variant="numericBody" tone="positive" />} />
                  ) : null}
                  {account.creditLimit ? (
                    <KeyValueRow label="Limit" value={<MoneyText amount={account.creditLimit} variant="numericBody" />} />
                  ) : null}
                  {account.type === 'credit_card' ? (
                    <>
                      <KeyValueRow label="Current cycle spend" value={<MoneyText amount={info.currentCycleSpend} variant="numericBody" />} />
                      <KeyValueRow label="Previous cycle" value={<MoneyText amount={info.previousCycleSpend} variant="numericBody" tone="muted" />} />
                    </>
                  ) : null}
                  {info.minimumPayment ? (
                    <KeyValueRow label="Minimum due" value={<MoneyText amount={info.minimumPayment} variant="numericBody" />} />
                  ) : null}
                  {account.statementDay ? <KeyValueRow label="Statement day" value={`${account.statementDay}th`} /> : null}
                  {account.paymentDueDay ? (
                    <KeyValueRow
                      label="Payment due"
                      value={info.dueDate ? info.dueDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : `${account.paymentDueDay}th`}
                    />
                  ) : null}
                </View>

                {account.type === 'credit_card' && info.outstanding > 0 ? (
                  <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
                    <Button
                      label="Pay full"
                      size="sm"
                      variant="secondary"
                      onPress={() =>
                        router.push(
                          `/transaction/new?type=transfer&to=${account.id}&amount=${info.outstanding}` as never,
                        )
                      }
                    />
                    {account.minimumPayment ? (
                      <Button
                        label="Pay minimum"
                        size="sm"
                        variant="ghost"
                        onPress={() =>
                          router.push(
                            `/transaction/new?type=transfer&to=${account.id}&amount=${Math.min(account.minimumPayment ?? 0, info.outstanding)}` as never,
                          )
                        }
                      />
                    ) : null}
                  </View>
                ) : null}
              </Card>
            );
          })}
        </View>
      )}
    </ScrollScreen>
  );
}

export const CreditReportStyles = StyleSheet.create({ hidden: { display: 'none' } });
