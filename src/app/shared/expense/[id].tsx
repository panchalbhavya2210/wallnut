import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, IconButton } from '@/components/ui/controls';
import { ErrorBlock, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { SettleSheet } from '@/components/SettleSheet';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { getPersonSharedBalance, getSharedExpense, payerLabel } from '@/services/shared.service';
import { formatDayMonth } from '@/utils/date';
import type { PersonBalance } from '@/utils/split';

const EMPTY_BALANCE: PersonBalance = { personId: '', theyOwe: 0, youOwe: 0, net: 0 };

/** One shared expense: who paid, everyone's share, and the settlement action. */
export default function SharedExpenseDetailScreen() {
  const theme = useTheme();
  const money = useMoney();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [settling, setSettling] = useState<{ personId: string; name: string; balance: PersonBalance } | null>(null);

  const query = useQuery(async () => {
    if (!id) return null;
    const detail = await getSharedExpense(id);
    if (!detail) return null;
    const others = detail.participants.filter((participant) => participant.personId);
    const balance = others.length === 1 && others[0]?.personId
      ? await getPersonSharedBalance(others[0].personId)
      : null;
    return { detail, balance };
  }, [id]);

  if (query.loading) return <ScrollScreen><LoadingBlock label="Loading…" /></ScrollScreen>;
  if (query.error || !query.data) {
    return (
      <ScrollScreen>
        <ScreenHeader title="Shared expense" />
        <ErrorBlock message={query.error?.message ?? 'That shared expense no longer exists.'} onRetry={query.refresh} />
      </ScrollScreen>
    );
  }

  const { detail, balance } = query.data;
  const { expense, participants } = detail;
  const otherPeople = participants.filter((participant) => participant.personId);
  const singleOther = otherPeople.length === 1 ? otherPeople[0]! : null;
  const selfInvolved = participants.some((participant) => participant.personId === null) || detail.selfPaid > 0;
  const othersPaid = expense.amount - detail.selfPaid;

  return (
    <ScrollScreen>
      <ScreenHeader
        title={expense.title}
        subtitle={`${formatDayMonth(new Date(expense.date))}${detail.groupName ? ` · ${detail.groupName}` : ''}`}
        right={
          <Row gap="xs">
            <IconButton
              icon="create-outline"
              onPress={() => router.push(`/shared/expense/new?id=${expense.id}` as never)}
              accessibilityLabel="Edit shared expense"
            />
          </Row>
        }
      />

      <View style={{ gap: theme.spacing.lg }}>
        <Card>
          <AppText variant="label" tone="muted">
            TOTAL BILL
          </AppText>
          <MoneyText amount={expense.amount} variant="numericLarge" style={{ marginTop: 4 }} showSign={false} />
          <AppText variant="bodySmall" tone="secondary" style={{ marginTop: 6 }}>
            {payerLabel(detail).charAt(0).toUpperCase() + payerLabel(detail).slice(1)}
            {detail.groupName ? ` · ${detail.groupName}` : ''}
            {expense.splitType !== 'equal' ? ` · split by ${expense.splitType}` : ' · split equally'}
          </AppText>
        </Card>

        {detail.items.length > 1 ? (
          <View>
            <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.sm }}>
              ITEMS
            </AppText>
            <View
              style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.lg,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                overflow: 'hidden',
              }}>
              {detail.items.map((item, index) => (
                <View
                  key={item.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.md,
                    minHeight: 52,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.border,
                  }}>
                  <Ionicons name="pricetag-outline" size={16} color={theme.colors.textSecondary} />
                  <AppText variant="bodySmall" style={{ flex: 1 }} numberOfLines={1}>
                    {item.name}
                  </AppText>
                  <MoneyText amount={item.amount} variant="numericSmall" showSign={false} />
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {detail.payers.length > 0 ? (
          <View>
            <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.sm }}>
              PAID BY
            </AppText>
            <View
              style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.lg,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                overflow: 'hidden',
              }}>
              {detail.payers.map((payer, index) => (
                <Pressable
                  key={payer.id}
                  disabled={payer.personId === null}
                  onPress={() => payer.personId && router.push(`/person/${payer.personId}` as never)}
                  android_ripple={{ color: theme.colors.ripple }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.md,
                    minHeight: 54,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.border,
                  }}>
                  <Ionicons name="wallet-outline" size={17} color={theme.colors.textSecondary} />
                  <AppText variant="bodyMedium" style={{ flex: 1 }}>
                    {payer.personId === null ? 'You' : payer.name}
                  </AppText>
                  <MoneyText amount={payer.amount} variant="numericSmall" showSign={false} />
                  {payer.personId ? <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} /> : null}
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <Card style={{ backgroundColor: theme.colors.accent.soft, borderColor: 'transparent' }}>
          <AppText variant="label" tone="accent" style={{ marginBottom: theme.spacing.sm }}>
            WHAT THIS MEANS
          </AppText>
          <Row justify="space-between" style={{ marginBottom: 6 }}>
            <AppText variant="bodySmall" tone="secondary">
              Your share (spending)
            </AppText>
            <MoneyText amount={detail.selfShare} variant="numericSmall" />
          </Row>
          {detail.selfPaid > 0 ? (
            <Row justify="space-between" style={{ marginBottom: 6 }}>
              <AppText variant="bodySmall" tone="secondary">
                You paid
              </AppText>
              <MoneyText amount={detail.selfPaid} variant="numericSmall" />
            </Row>
          ) : othersPaid > 0 ? (
            <Row justify="space-between" style={{ marginBottom: 6 }}>
              <AppText variant="bodySmall" tone="secondary">
                Paid by others
              </AppText>
              <MoneyText amount={othersPaid} variant="numericSmall" />
            </Row>
          ) : null}
          {detail.owedToYou > 0 ? (
            <Row justify="space-between">
              <AppText variant="bodySmall" tone="secondary">
                You are owed
              </AppText>
              <MoneyText amount={detail.owedToYou} variant="numericSmall" tone="positive" />
            </Row>
          ) : detail.youOwe > 0 ? (
            <Row justify="space-between">
              <AppText variant="bodySmall" tone="secondary">
                You owe
              </AppText>
              <MoneyText amount={detail.youOwe} variant="numericSmall" tone="negative" />
            </Row>
          ) : !selfInvolved ? (
            <AppText variant="caption" tone="muted">
              Not your expense — tracked for the group only.
            </AppText>
          ) : null}
        </Card>

        <View>
          <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.sm }}>
            PARTICIPANTS
          </AppText>
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              overflow: 'hidden',
            }}>
            {participants.map((participant, index) => {
              const isSelf = participant.personId === null;
              const isPayer = detail.payers.some((payer) => payer.personId === participant.personId);
              return (
                <Pressable
                  key={participant.id}
                  disabled={isSelf}
                  onPress={() => participant.personId && router.push(`/person/${participant.personId}` as never)}
                  android_ripple={{ color: theme.colors.ripple }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.md,
                    minHeight: 58,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.border,
                  }}>
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      backgroundColor: theme.colors.neutralSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <AppText variant="bodySmall" tone="secondary">
                      {participant.name.slice(0, 1).toUpperCase()}
                    </AppText>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Row gap="sm">
                      <AppText variant="bodyMedium">{isSelf ? 'You' : participant.name}</AppText>
                      {isPayer ? (
                        <AppText variant="caption" tone="accent">
                          paid
                        </AppText>
                      ) : null}
                    </Row>
                    <AppText variant="caption" tone="muted">
                      {isSelf ? 'Your share' : 'Their share'}
                    </AppText>
                  </View>
                  <MoneyText amount={participant.share} variant="numericBody" showSign={false} />
                  {!isSelf ? <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        {expense.notes ? (
          <Card>
            <AppText variant="label" tone="muted" style={{ marginBottom: 6 }}>
              NOTES
            </AppText>
            <AppText variant="bodySmall" tone="secondary">
              {expense.notes}
            </AppText>
          </Card>
        ) : null}

        {singleOther && balance ? (
          <Button
            label={
              balance.net === 0
                ? `Settled up with ${singleOther.name}`
                : balance.net > 0
                  ? `Settle up · ${singleOther.name} owes you ${money.format(balance.net)}`
                  : `Settle up · you owe ${singleOther.name} ${money.format(-balance.net)}`
            }
            variant={balance.net === 0 ? 'secondary' : 'primary'}
            fullWidth
            disabled={balance.net === 0}
            onPress={() => setSettling({ personId: singleOther.personId!, name: singleOther.name, balance })}
          />
        ) : null}

        {otherPeople.length > 1 ? (
          <Button
            label="View balances to settle up"
            variant="secondary"
            fullWidth
            onPress={() => router.push('/shared' as never)}
          />
        ) : null}

        <InfoBanner message="Editing or deleting this expense recalculates everyone's balance and the linked cash entries. Settlements stay recorded separately." />
      </View>

      {settling ? (
        <SettleSheet
          visible
          onClose={() => setSettling(null)}
          personId={settling.personId}
          personName={settling.name}
          balance={settling.balance ?? EMPTY_BALANCE}
          onSettled={query.refresh}
        />
      ) : null}
    </ScrollScreen>
  );
}
