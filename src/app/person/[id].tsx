import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, ListGroup, ListRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, IconButton } from '@/components/ui/controls';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/feedback';
import { AmountField, FormSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { SettleSheet } from '@/components/SettleSheet';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import { listDebts, listPayments, listPeople, recordPayment, settleDebt } from '@/services/debts.service';
import { deleteSettlement, getPersonSharedActivity, payerLabel } from '@/services/shared.service';
import { formatDayMonth } from '@/utils/date';
import type { PersonSharedActivity } from '@/services/shared.service';

/** Person detail — money owed (manual debts) plus shared expenses and settlements. */
export default function PersonScreen() {
  const theme = useTheme();
  const money = useMoney();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [paymentFor, setPaymentFor] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [settling, setSettling] = useState(false);

  const query = useQuery(async () => {
    if (!id) return null;
    const people = await listPeople();
    const person = people.find((entry) => entry.id === id) ?? null;
    if (!person) return null;
    const debts = (await listDebts({ includeSettled: true })).filter((debt) => debt.personId === id);
    const payments = await Promise.all(debts.map((debt) => listPayments(debt.id)));
    const shared: PersonSharedActivity = await getPersonSharedActivity(id);
    return { person, debts, payments: payments.flat(), shared };
  }, [id]);

  const activity = useMemo(() => {
    const shared = query.data?.shared;
    if (!shared) return [];
    return [
      ...shared.expenses.map((entry) => ({
        kind: 'expense' as const,
        id: entry.expense.id,
        date: entry.expense.date,
        title: entry.expense.title,
        detail: `${payerLabel(entry)}${entry.items.length > 1 ? ` · ${entry.items.length} items` : ''}${entry.groupName ? ` · ${entry.groupName}` : ''} · your share ${money.format(entry.selfShare)}`,
        amount: entry.expense.amount,
        tone: 'neutral' as const,
      })),
      ...shared.settlements.map((settlement) => {
        const received = settlement.toPersonId === null;
        return {
          kind: 'settlement' as const,
          id: settlement.id,
          date: settlement.date,
          title: received ? 'Settlement received' : 'Settlement paid',
          detail: settlement.note ?? 'Never income or spending',
          amount: received ? settlement.amount : -settlement.amount,
          tone: received ? ('positive' as const) : ('negative' as const),
        };
      }),
    ]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10);
  }, [query.data, money]);

  if (query.loading) return <ScrollScreen><LoadingBlock label="Loading…" /></ScrollScreen>;
  if (query.error || !query.data) {
    return (
      <ScrollScreen>
        <ScreenHeader title="Person" />
        <ErrorBlock message={query.error?.message ?? 'That person has no records.'} onRetry={query.refresh} />
      </ScrollScreen>
    );
  }

  const { person, debts, shared } = query.data;
  const open = debts.filter((debt) => debt.status === 'open');
  const theyOwe = open.filter((debt) => debt.direction === 'lent').reduce((sum, debt) => sum + debt.remaining, 0);
  const youOwe = open.filter((debt) => debt.direction === 'borrowed').reduce((sum, debt) => sum + debt.remaining, 0);
  const activeDebt = paymentFor ? debts.find((debt) => debt.id === paymentFor) ?? null : null;
  const hasShared = shared.expenses.length > 0 || shared.balance.net !== 0;

  return (
    <ScrollScreen>
      <ScreenHeader title={person.name} subtitle={person.note ?? 'Money owed'} />

      <View style={{ gap: theme.spacing.lg }}>
        <Card>
          <Row justify="space-between">
            <View style={{ flex: 1 }}>
              <AppText variant="label" tone="muted">
                THEY OWE YOU
              </AppText>
              <MoneyText amount={theyOwe} variant="numericMedium" tone="positive" style={{ marginTop: 4 }} />
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <AppText variant="label" tone="muted">
                YOU OWE
              </AppText>
              <MoneyText amount={youOwe} variant="numericMedium" tone="negative" style={{ marginTop: 4 }} />
            </View>
          </Row>
        </Card>

        {hasShared ? (
          <Card>
            <AppText variant="label" tone="muted">
              SHARED EXPENSES
            </AppText>
            <Row justify="space-between" style={{ marginTop: theme.spacing.sm }}>
              <AppText variant="bodySmall" tone="secondary">
                {shared.balance.net >= 0 ? `${person.name} owes you` : `You owe ${person.name}`}
              </AppText>
              <MoneyText
                amount={Math.abs(shared.balance.net)}
                variant="numericMedium"
                tone={shared.balance.net >= 0 ? 'positive' : 'negative'}
              />
            </Row>
            <AppText variant="caption" tone="muted" style={{ marginTop: 4 }}>
              {shared.expenses.length} shared expense{shared.expenses.length === 1 ? '' : 's'} · split bills, not loans
            </AppText>
            <Button
              label={shared.balance.net === 0 ? 'Settled up' : 'Settle up'}
              size="sm"
              variant={shared.balance.net === 0 ? 'secondary' : 'primary'}
              disabled={shared.balance.net === 0}
              style={{ marginTop: theme.spacing.md, alignSelf: 'flex-start' }}
              onPress={() => setSettling(true)}
            />
          </Card>
        ) : null}

        {debts.length === 0 && !hasShared ? (
          <EmptyState icon="people-outline" title="No debts with this person" message="Record money lent or borrowed, or split a bill with them." />
        ) : null}

        {debts.map((debt) => (
          <Card key={debt.id}>
            <Row justify="space-between" style={{ marginBottom: theme.spacing.md }}>
              <Row gap="sm">
                <Ionicons
                  name={debt.direction === 'lent' ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'}
                  size={20}
                  color={debt.direction === 'lent' ? theme.colors.positive : theme.colors.negative}
                />
                <View>
                  <AppText variant="bodyMedium">{debt.direction === 'lent' ? 'You lent' : 'You borrowed'}</AppText>
                  <AppText variant="caption" tone="muted">
                    {formatDayMonth(new Date(debt.date))}
                    {debt.dueDate ? ` · due ${formatDayMonth(new Date(debt.dueDate))}` : ''}
                  </AppText>
                </View>
              </Row>
              <AppText variant="caption" tone={debt.status === 'settled' ? 'positive' : 'muted'}>
                {debt.status}
              </AppText>
            </Row>

            <Row justify="space-between">
              <View>
                <AppText variant="caption" tone="muted">
                  Original
                </AppText>
                <AppText variant="numericSmall" tone="secondary">
                  {money.format(debt.principal)}
                </AppText>
              </View>
              <View>
                <AppText variant="caption" tone="muted">
                  Paid
                </AppText>
                <AppText variant="numericSmall" tone="secondary">
                  {money.format(debt.principal - debt.remaining)}
                </AppText>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <AppText variant="caption" tone="muted">
                  Remaining
                </AppText>
                <MoneyText amount={debt.remaining} variant="numericSmall" tone={debt.direction === 'lent' ? 'positive' : 'negative'} />
              </View>
            </Row>

            {debt.description ? (
              <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                {debt.description}
              </AppText>
            ) : null}

            {debt.status === 'open' ? (
              <Row gap="sm" style={{ marginTop: theme.spacing.md }}>
                <Button
                  label={debt.direction === 'lent' ? 'Record repayment' : 'Repay'}
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    setPaymentFor(debt.id);
                    setPaymentAmount(0);
                  }}
                />
                <Button
                  label="Settle fully"
                  size="sm"
                  variant="ghost"
                  onPress={async () => {
                    await settleDebt(debt.id);
                    toast.success('Debt settled');
                    query.refresh();
                  }}
                />
              </Row>
            ) : null}
          </Card>
        ))}

        {activity.length > 0 ? (
          <ListGroup title="SHARED ACTIVITY">
            {activity.map((entry) =>
              entry.kind === 'expense' ? (
                <ListRow
                  key={`expense-${entry.id}`}
                  icon="receipt-outline"
                  title={entry.title}
                  subtitle={`${formatDayMonth(new Date(entry.date))} · ${entry.detail}`}
                  value={<MoneyText amount={entry.amount} variant="numericSmall" showSign={false} />}
                  chevron
                  onPress={() => router.push(`/shared/expense/${entry.id}` as never)}
                />
              ) : (
                <ListRow
                  key={`settlement-${entry.id}`}
                  icon={entry.amount > 0 ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
                  iconColor={entry.amount > 0 ? theme.colors.positive : theme.colors.negative}
                  title={entry.title}
                  subtitle={`${formatDayMonth(new Date(entry.date))} · ${entry.detail}`}
                  value={<MoneyText amount={entry.amount} variant="numericSmall" tone={entry.tone} showSign />}
                  right={
                    <IconButton
                      icon="trash-outline"
                      size={30}
                      color={theme.colors.muted}
                      accessibilityLabel="Delete settlement"
                      onPress={async () => {
                        const ok = await confirm({
                          title: 'Delete this settlement?',
                          message: 'The balance goes back up.',
                          confirmLabel: 'Delete',
                          tone: 'danger',
                        });
                        if (!ok) return;
                        await deleteSettlement(entry.id);
                        toast.show('Settlement deleted');
                        query.refresh();
                      }}
                    />
                  }
                />
              ),
            )}
          </ListGroup>
        ) : null}

        <Button label="Record a new debt" variant="secondary" fullWidth onPress={() => router.push('/debt/new' as never)} />
      </View>

      <FormSheet
        visible={Boolean(paymentFor)}
        onClose={() => setPaymentFor(null)}
        title={activeDebt?.direction === 'lent' ? 'Repayment received' : 'Repayment made'}
        submitLabel="Record payment"
        onSubmit={async () => {
          if (!paymentFor) return;
          try {
            await recordPayment({
              debtId: paymentFor,
              amount: paymentAmount,
              accountId: activeDebt?.accountId ?? null,
              note: activeDebt?.direction === 'lent' ? 'Repayment received' : 'Repayment made',
            });
            setPaymentFor(null);
            toast.success('Payment recorded');
            query.refresh();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not record the payment');
          }
        }}
        submitDisabled={paymentAmount <= 0}>
        <AmountField
          label="Amount"
          valueMinor={paymentAmount}
          onChangeMinor={setPaymentAmount}
          currencySymbol={money.currency === 'INR' ? '₹' : money.currency}
          autoFocus
        />
        <AppText variant="caption" tone="muted">
          Repayments never count as income or spending — they reduce the debt and move cash.
        </AppText>
      </FormSheet>

      {settling ? (
        <SettleSheet
          visible
          onClose={() => setSettling(false)}
          personId={person.id}
          personName={person.name}
          balance={shared.balance}
          onSettled={query.refresh}
        />
      ) : null}
    </ScrollScreen>
  );
}
