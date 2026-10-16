import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, IconButton } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { getDebtOverview } from '@/services/debts.service';
import { formatDayMonth } from '@/utils/date';

/** Money owed — receivables and payables, by person. */
export default function DebtsScreen() {
  const theme = useTheme();
  const money = useMoney();
  const query = useQuery(() => getDebtOverview(), []);
  const data = query.data;

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Money owed"
        subtitle="Lending and borrowing, kept out of income and spending"
        hint={{ id: 'debts', message: "Track money you've lent or borrowed without touching income/spending. Record payments as they happen — balances update in place." }}
        right={
          <Row gap="xs">
            <IconButton icon="add" onPress={() => router.push('/debt/new?direction=lent' as never)} accessibilityLabel="Add debt" />
          </Row>
        }
      />

      {query.loading && !data ? (
        <LoadingBlock label="Loading…" />
      ) : !data || (data.openCount === 0 && data.sharedCount === 0) ? (
        <EmptyState
          icon="people-outline"
          title="Nothing owed"
          message="Track money you lend or borrow, or split a bill — shared expenses appear in this same balance."
          actionLabel="Record a debt"
          onAction={() => router.push('/debt/new?direction=lent' as never)}
        />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Card>
            <Row justify="space-between">
              <View style={{ flex: 1 }}>
                <AppText variant="label" tone="muted">
                  THEY OWE YOU
                </AppText>
                <MoneyText amount={data.theyOweYou} variant="numericMedium" tone="positive" style={{ marginTop: 4 }} />
              </View>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <AppText variant="label" tone="muted">
                  YOU OWE
                </AppText>
                <MoneyText amount={data.youOwe} variant="numericMedium" tone="negative" style={{ marginTop: 4 }} />
              </View>
            </Row>
            <View style={{ marginTop: theme.spacing.md, paddingTop: theme.spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
              <Row justify="space-between">
                <AppText variant="bodySmall" tone="secondary">
                  Net position
                </AppText>
                <MoneyText amount={data.net} variant="numericBody" tone="positive-negative" showSign />
              </Row>
              {data.overdueCount > 0 ? (
                <AppText variant="caption" tone="warning" style={{ marginTop: 6 }}>
                  {data.overdueCount} past its due date
                </AppText>
              ) : null}
              {data.dueThisMonth > 0 ? (
                <AppText variant="caption" tone="muted" style={{ marginTop: 4 }}>
                  {money.format(data.dueThisMonth)} due this month
                </AppText>
              ) : null}
            </View>
          </Card>

          <View>
            <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.sm }}>
              PEOPLE
            </AppText>
            <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, overflow: 'hidden' }}>
              {data.people.map((summary, index) => (
                <Pressable
                  key={summary.person.id}
                  onPress={() => router.push(`/person/${summary.person.id}` as never)}
                  android_ripple={{ color: theme.colors.ripple }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.md,
                    minHeight: 62,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.border,
                  }}>
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 19,
                      backgroundColor: theme.colors.neutralSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <AppText variant="bodyMedium" tone="secondary">
                      {summary.person.name.slice(0, 1).toUpperCase()}
                    </AppText>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="bodyMedium">{summary.person.name}</AppText>
                    <AppText variant="caption" tone="muted">
                      {summary.openCount > 0 ? `${summary.openCount} open · ` : ''}
                      {summary.lentRemaining > 0 ? `${money.format(summary.lentRemaining)} in` : ''}
                      {summary.borrowedRemaining > 0 ? `${summary.lentRemaining > 0 ? ' · ' : ''}${money.format(summary.borrowedRemaining)} out` : ''}
                      {summary.openCount === 0 && summary.sharedNet !== 0 ? 'shared expenses' : ''}
                      {summary.openCount > 0 && summary.sharedNet !== 0 ? ' · incl. shared' : ''}
                    </AppText>
                  </View>
                  <MoneyText amount={summary.net} variant="numericBody" tone="positive-negative" showSign />
                </Pressable>
              ))}
            </View>
          </View>

          {data.recent.length > 0 ? (
            <View>
              <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.sm }}>
                OPEN DEBTS
              </AppText>
              <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, overflow: 'hidden' }}>
                {data.recent.map((debt, index) => (
                  <Pressable
                    key={debt.id}
                    onPress={() => router.push(`/person/${debt.personId}` as never)}
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
                    <Ionicons
                      name={debt.direction === 'lent' ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'}
                      size={20}
                      color={debt.direction === 'lent' ? theme.colors.positive : theme.colors.negative}
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="bodySmall">
                        {debt.direction === 'lent' ? `${debt.personName} owes you` : `You owe ${debt.personName}`}
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        {formatDayMonth(new Date(debt.date))}
                        {debt.dueDate ? ` · due ${formatDayMonth(new Date(debt.dueDate))}` : ''}
                        {debt.description ? ` · ${debt.description}` : ''}
                      </AppText>
                    </View>
                    <MoneyText
                      amount={debt.direction === 'lent' ? debt.remaining : -debt.remaining}
                      variant="numericBody"
                      tone={debt.direction === 'lent' ? 'positive' : 'negative'}
                    />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <Row gap="sm">
            <Button label="I lent money" variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/debt/new?direction=lent' as never)} />
            <Button label="I borrowed" variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/debt/new?direction=borrowed' as never)} />
          </Row>

          <Button label="Shared expenses" variant="secondary" fullWidth onPress={() => router.push('/shared' as never)} />

          <InfoBanner message="Lending moves money out of an account and creates a receivable. Repayments reduce it. Shared expenses add their computed balances here too — neither is ever counted as income or spending." />
        </View>
      )}
    </ScrollScreen>
  );
}
