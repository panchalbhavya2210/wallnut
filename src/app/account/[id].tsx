import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, ScrollScreen, ScreenHeader, Row, KeyValueRow } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, ProgressBar, Chip } from '@/components/ui/controls';
import { EmptyState, ErrorBlock, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { LineChart } from '@/components/charts';
import { AccountEditor } from '@/components/AccountEditor';
import { AnimatedMoney, Gauge } from '@/components/Gauge';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { toast } from '@/stores/ui.store';
import {
  ACCOUNT_TYPE_LABELS,
  accountTransactionCounts,
  getAccount,
  getCreditCardInfo,
  investmentSummary,
  investmentTypeLabel,
  isLiability,
  updateAccount,
} from '@/services/accounts.service';
import { getAccountBalanceTrend, getPeriodSummary, getTrend } from '@/services/analytics.service';
import { listTransactions } from '@/services/transactions.service';
import { formatDayMonth, formatMonthYear, getPeriodRange, previousRange } from '@/utils/date';
import { formatPercent } from '@/utils/money';

/**
 * Account detail — balance history, this-vs-last period flows, credit-card
 * panel with available credit and due dates, investment valuation, and the
 * actions that keep the ledger honest: reconcile, adjust, archive.
 */
export default function AccountDetailScreen() {
  const theme = useTheme();
  const money = useMoney();
  const { id } = useLocalSearchParams<{ id: string }>();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const [editorOpen, setEditorOpen] = useState(false);

  const query = useQuery(async () => {
    if (!id) return null;
    const account = await getAccount(id);
    if (!account) return null;
    const range = getPeriodRange('thisMonth', { monthStartDay });
    const previous = previousRange(range);
    const [trend, current, prior, recent, counts, card] = await Promise.all([
      getAccountBalanceTrend(id, getPeriodRange('1y', { monthStartDay }), 'month'),
      getPeriodSummary({ range, accountIds: [id] }),
      getPeriodSummary({ range: previous, accountIds: [id] }),
      listTransactions({ accountIds: [id], limit: 25, includeTransfers: true, includeRefunds: true, includeAdjustments: true, includeDebtActivity: true }),
      accountTransactionCounts(id),
      account.type === 'credit_card' ? getCreditCardInfo(id) : Promise.resolve(null),
    ]);
    return { account, trend, current, prior, recent, counts, card, range };
  }, [id, monthStartDay]);

  if (query.loading) return <ScrollScreen><LoadingBlock label="Loading account…" /></ScrollScreen>;
  if (query.error || !query.data) {
    return (
      <ScrollScreen>
        <ScreenHeader title="Account" />
        <ErrorBlock message={query.error?.message ?? 'This account no longer exists.'} onRetry={query.refresh} />
      </ScrollScreen>
    );
  }

  const { account, trend, current, prior, recent, counts, card, range } = query.data;
  const liability = isLiability(account.type);
  const investment = account.type === 'investment' ? investmentSummary(account) : null;

  const archive = async () => {
    const ok = await confirm({
      title: account.isArchived ? 'Restore account?' : 'Archive account?',
      message: account.isArchived
        ? 'It returns to your accounts list.'
        : 'Archived accounts keep their history but leave lists and totals.',
      confirmLabel: account.isArchived ? 'Restore' : 'Archive',
    });
    if (!ok) return;
    await updateAccount(account.id, { isArchived: !account.isArchived });
    toast.show(account.isArchived ? 'Account restored' : 'Account archived');
  };

  return (
    <ScrollScreen>
      <ScreenHeader
        title={account.name}
        subtitle={`${ACCOUNT_TYPE_LABELS[account.type]}${account.institution ? ` · ${account.institution}` : ''}${
          account.isArchived ? ' · archived' : ''
        }`}
        right={
          <Row gap="xs">
            <Button label="Edit" variant="ghost" size="sm" onPress={() => setEditorOpen(true)} />
          </Row>
        }
      />

      <View style={{ gap: theme.spacing.lg }}>
        {/* Balance hero */}
        <Card>
          <AppText variant="label" tone="muted">
            {liability ? 'OUTSTANDING' : 'BALANCE'}
          </AppText>
          <AppText variant="numericLarge" style={{ marginTop: 6 }} tone={liability && account.currentBalance < 0 ? 'negative' : 'primary'}>
            {money.format(liability ? Math.abs(account.currentBalance) : account.currentBalance)}
          </AppText>
          <AppText variant="caption" tone="muted" style={{ marginTop: 4 }}>
            {counts.count} transactions{counts.min ? ` · since ${formatDayMonth(new Date(counts.min))}` : ''}
          </AppText>
        </Card>

        {/* Credit card panel */}
        {card ? (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <AppText variant="label" tone="muted">
                CREDIT CARD
              </AppText>
              <Ionicons name="card-outline" size={16} color={theme.colors.muted} />
            </View>
            <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.md }}>
              <Row justify="space-between">
                <View>
                  <AppText variant="caption" tone="muted">
                    Available credit
                  </AppText>
                  <AppText variant="numericMedium">{card.available === null ? '—' : money.format(card.available)}</AppText>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <AppText variant="caption" tone="muted">
                    Limit
                  </AppText>
                  <AppText variant="numericSmall" tone="secondary">
                    {card.account.creditLimit ? money.format(card.account.creditLimit) : 'not set'}
                  </AppText>
                </View>
              </Row>
              {card.utilizationPercent !== null ? (
                <>
                  <Gauge
                    progress={card.utilizationPercent}
                    size={140}
                    thickness={12}
                    tone={card.utilizationPercent > 70 ? 'warning' : 'accent'}
                    label={formatPercent(card.utilizationPercent, 0)}
                    caption="of limit used"
                  />
                  <AppText variant="caption" tone="muted">
                    {money.format(card.outstanding)} outstanding · {money.format(card.available ?? 0)} available
                  </AppText>
                </>
              ) : (
                <AppText variant="caption" tone="muted">
                  Set a credit limit in the account editor to see available credit and utilisation.
                </AppText>
              )}
              <View style={{ gap: 2 }}>
                <KeyValueRow
                  label="Statement date"
                  value={card.statementDate ? formatDayMonth(card.statementDate) : 'not set'}
                />
                <KeyValueRow label="Payment due" value={card.dueDate ? formatDayMonth(card.dueDate) : 'not set'} />
                {card.minimumPayment ? (
                  <KeyValueRow label="Minimum payment" value={money.format(card.minimumPayment)} />
                ) : null}
                <KeyValueRow label="This cycle spend" value={money.format(card.currentCycleSpend)} />
                <KeyValueRow label="Previous cycle" value={money.format(card.previousCycleSpend)} />
              </View>
              <InfoBanner
                message="Card payments are recorded as transfers, so settling this bill never counts as a second expense."
              />
              {(card.outstanding ?? 0) > 0 ? (
                <Row gap="sm">
                  <Button
                    label="Pay full"
                    size="sm"
                    style={{ flex: 1 }}
                    onPress={() =>
                      router.push(
                        `/transaction/new?type=transfer&to=${account.id}&amount=${((card.outstanding ?? 0) / 100).toFixed(2).replace(/\.00$/, '')}` as never,
                      )
                    }
                  />
                  <Button
                    label="Pay minimum"
                    size="sm"
                    variant="secondary"
                    style={{ flex: 1 }}
                    disabled={(card.minimumPayment ?? 0) <= 0}
                    onPress={() =>
                      router.push(
                        `/transaction/new?type=transfer&to=${account.id}&amount=${((card.minimumPayment ?? 0) / 100).toFixed(2).replace(/\.00$/, '')}` as never,
                      )
                    }
                  />
                </Row>
              ) : null}
            </View>
          </Card>
        ) : null}

        {/* Investment panel */}
        {investment ? (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <AppText variant="label" tone="muted">
                {investmentTypeLabel(investment.investmentType).toUpperCase()}
              </AppText>
              <Ionicons name="trending-up-outline" size={16} color={theme.colors.muted} />
            </View>
            <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
              <Row justify="space-between">
                <View>
                  <AppText variant="caption" tone="muted">
                    Current value
                  </AppText>
                  <AppText variant="numericMedium">{money.format(investment.value)}</AppText>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <AppText variant="caption" tone="muted">
                    Gain
                  </AppText>
                  <MoneyText
                    amount={investment.gain}
                    variant="numericSmall"
                    tone="positive-negative"
                    showSign
                  />
                  {investment.gainPercent !== null ? (
                    <AppText variant="caption" tone={investment.gain >= 0 ? 'positive' : 'negative'}>
                      {investment.gainPercent >= 0 ? '+' : '−'}
                      {formatPercent(Math.abs(investment.gainPercent), 1)}
                    </AppText>
                  ) : null}
                </View>
              </Row>
              <KeyValueRow label="Invested" value={money.format(investment.invested)} />
              <KeyValueRow label="Last valuation" value={investment.lastValuationDate ? formatDayMonth(new Date(investment.lastValuationDate)) : '—'} />
              <Button
                label="Update value"
                variant="secondary"
                size="sm"
                onPress={() => setEditorOpen(true)}
              />
            </View>
          </Card>
        ) : null}

        {/* Balance history */}
        {trend.length > 1 ? (
          <Card>
            <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.md }}>
              BALANCE HISTORY
            </AppText>
            <View style={{ marginHorizontal: -8 }}>
              <LineChart
                points={trend.map((point) => ({ key: point.key, label: point.label, fullLabel: point.fullLabel, value: point.value }))}
                height={150}
                showArea
                baseline="auto"
              />
            </View>
          </Card>
        ) : null}

        {/* Period flows */}
        <Card>
          <AppText variant="label" tone="muted">
            {formatMonthYear(range.start).toUpperCase()}
          </AppText>
          <View style={{ marginTop: theme.spacing.sm }}>
            <KeyValueRow label="Money in" value={<MoneyText amount={current.totals.income} variant="numericBody" tone="positive" />} />
            <KeyValueRow label="Money out" value={<MoneyText amount={-current.totals.netExpense} variant="numericBody" tone="negative" />} />
            <KeyValueRow
              label="Transfers"
              value={<MoneyText amount={-current.totals.transfers} variant="numericBody" tone="muted" absolute />}
            />
            <KeyValueRow label="Transactions" value={String(current.totals.transactionCount)} />
          </View>
          {prior.totals.transactionCount > 0 ? (
            <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
              Last month: {money.format(prior.totals.netExpense)} spent
            </AppText>
          ) : null}
        </Card>

        {/* Recent transactions */}
        <View>
          <Row justify="space-between" style={{ marginBottom: theme.spacing.sm }}>
            <AppText variant="label" tone="muted">
              RECENT
            </AppText>
            <Pressable
              onPress={() => router.push('/transactions')}
              hitSlop={8}>
              <AppText variant="captionMedium" tone="accent">
                See all
              </AppText>
            </Pressable>
          </Row>
          {recent.length === 0 ? (
            <EmptyState
              icon="receipt-outline"
              title="No transactions yet"
              message="Add a transaction to see activity for this account."
              actionLabel="Add transaction"
              onAction={() => router.push(`/transaction/new?type=expense` as never)}
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
              {recent.map((row, index) => (
                <Pressable
                  key={row.id}
                  onPress={() => router.push(`/transaction/${row.id}` as never)}
                  android_ripple={{ color: theme.colors.ripple }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.md,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.border,
                  }}>
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: theme.radius.md,
                      backgroundColor: `${row.categoryColor ?? theme.colors.muted}22`,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <Ionicons name={(row.categoryIcon as IconName) ?? 'pricetag-outline'} size={16} color={row.categoryColor ?? theme.colors.muted} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="bodySmall" numberOfLines={1}>
                      {row.merchant || row.description || row.categoryName || 'Transaction'}
                    </AppText>
                    <AppText variant="caption" tone="muted" numberOfLines={1}>
                      {formatDayMonth(new Date(row.date))}
                      {row.categoryName ? ` · ${row.categoryName}` : ''}
                      {row.isTransfer ? ' · transfer' : ''}
                    </AppText>
                  </View>
                  <MoneyText amount={row.amount} variant="numericCaption" tone={row.isTransfer ? 'neutral' : 'auto'} />
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Actions */}
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label="Reconcile balance"
            variant="secondary"
            icon="git-compare-outline"
            fullWidth
            onPress={() => router.push(`/adjust?accountId=${account.id}` as never)}
          />
          <Button label={account.isArchived ? 'Restore account' : 'Archive account'} variant="ghost" fullWidth onPress={archive} />
        </View>
      </View>

      <AccountEditor visible={editorOpen} onClose={() => setEditorOpen(false)} account={account} />
    </ScrollScreen>
  );
}
