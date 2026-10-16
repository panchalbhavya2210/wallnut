import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, ListGroup, ListRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, IconButton } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { Field, FormSheet } from '@/components/ui/sheets';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import { createSharedGroup, getSharedOverview, payerLabel } from '@/services/shared.service';
import { formatDayMonth } from '@/utils/date';

/** Shared expenses — groups, balances and recent splits in one place. */
export default function SharedExpensesScreen() {
  const theme = useTheme();
  const money = useMoney();
  const query = useQuery(() => getSharedOverview(), []);
  const data = query.data;
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Shared expenses"
        subtitle="Split bills with people — without inflating your spending"
        hint={{
          id: 'shared',
          message:
            'When you pay ₹4,000 for a dinner where your share is ₹1,000, Wallnut records ₹1,000 as your spending and ₹3,000 as money owed to you. The cash account still drops by ₹4,000.',
        }}
        right={
          <Row gap="xs">
            <IconButton icon="add" onPress={() => router.push('/shared/expense/new' as never)} accessibilityLabel="New shared expense" />
          </Row>
        }
      />

      {query.loading && !data ? (
        <LoadingBlock label="Loading…" />
      ) : !data || (data.expenseCount === 0 && data.groups.length === 0) ? (
        <View style={{ gap: theme.spacing.lg }}>
          <EmptyState
            icon="people-circle-outline"
            title="No shared expenses yet"
            message="Split a trip, a dinner or the rent. Your share counts as spending; the rest becomes money owed."
            actionLabel="Create a shared expense"
            onAction={() => router.push('/shared/expense/new' as never)}
          />
          <Button
            label="Start a group instead"
            variant="secondary"
            fullWidth
            onPress={() => {
              setGroupName('');
              setCreatingGroup(true);
            }}
          />
        </View>
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Card>
            <Row justify="space-between">
              <View style={{ flex: 1 }}>
                <AppText variant="label" tone="muted">
                  YOU ARE OWED
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
            <View
              style={{
                marginTop: theme.spacing.md,
                paddingTop: theme.spacing.md,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: theme.colors.border,
                gap: 4,
              }}>
              <Row justify="space-between">
                <AppText variant="bodySmall" tone="secondary">
                  Net position
                </AppText>
                <MoneyText amount={data.net} variant="numericBody" tone="positive-negative" showSign />
              </Row>
              <AppText variant="caption" tone="muted">
                {data.expenseCount} shared expense{data.expenseCount === 1 ? '' : 's'} · {money.format(data.totalSpent)} in total bills
              </AppText>
              <AppText variant="caption" tone="muted">
                Your share {money.format(data.yourShare)} · you paid {money.format(data.youPaid)}
              </AppText>
            </View>
          </Card>

          <Row gap="sm">
            <Button label="New expense" style={{ flex: 1 }} onPress={() => router.push('/shared/expense/new' as never)} />
            <Button
              label="New group"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => {
                setGroupName('');
                setCreatingGroup(true);
              }}
            />
          </Row>

          {data.groups.length > 0 ? (
            <ListGroup title="GROUPS">
              {data.groups.map((entry) => (
                <ListRow
                  key={entry.group.id}
                  icon={entry.group.icon as never}
                  iconColor={entry.group.color}
                  title={entry.group.name}
                  subtitle={`${entry.expenseCount} expense${entry.expenseCount === 1 ? '' : 's'} · your share ${money.format(entry.yourShare)}`}
                  value={
                    <View style={{ alignItems: 'flex-end' }}>
                      <MoneyText amount={entry.net} variant="numericSmall" tone="positive-negative" showSign />
                      <AppText variant="caption" tone="muted">
                        {entry.net === 0 ? 'settled' : entry.net > 0 ? 'they owe you' : 'you owe'}
                      </AppText>
                    </View>
                  }
                  chevron
                  onPress={() => router.push(`/shared/group/${entry.group.id}` as never)}
                />
              ))}
            </ListGroup>
          ) : null}

          {data.people.length > 0 ? (
            <ListGroup title="PEOPLE">
              {data.people.map((balance) => (
                <ListRow
                  key={balance.personId}
                  icon="person-outline"
                  title={balance.name}
                  subtitle={balance.net > 0 ? 'Owes you (shared)' : 'You owe them (shared)'}
                  value={<MoneyText amount={balance.net} variant="numericBody" tone="positive-negative" showSign />}
                  chevron
                  onPress={() => router.push(`/person/${balance.personId}` as never)}
                />
              ))}
            </ListGroup>
          ) : null}

          {data.recent.length > 0 ? (
            <ListGroup title="RECENT SPLITS">
              {data.recent.map((entry) => (
                <ListRow
                  key={entry.expense.id}
                  icon="receipt-outline"
                  title={entry.expense.title}
                  subtitle={`${formatDayMonth(new Date(entry.expense.date))} · ${payerLabel(entry)}${
                    entry.items.length > 1 ? ` · ${entry.items.length} items` : ''
                  }${entry.groupName ? ` · ${entry.groupName}` : ''}`}
                  value={
                    <View style={{ alignItems: 'flex-end' }}>
                      <MoneyText amount={entry.expense.amount} variant="numericSmall" tone="neutral" showSign={false} />
                      <AppText variant="caption" tone="muted">
                        your share {money.format(entry.selfShare)}
                      </AppText>
                    </View>
                  }
                  chevron
                  onPress={() => router.push(`/shared/expense/${entry.expense.id}` as never)}
                />
              ))}
            </ListGroup>
          ) : null}

          <InfoBanner message="Only your own share counts as spending. Other people's shares become money owed to you, and the full bill still leaves the paying account." />

          {data.groups.some((entry) => entry.expenseCount > 0) ? (
            <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
              <Ionicons name="lock-closed-outline" size={12} color={theme.colors.muted} /> Everyone stays local — no accounts, no invites.
            </AppText>
          ) : null}
        </View>
      )}

      <FormSheet
        visible={creatingGroup}
        onClose={() => setCreatingGroup(false)}
        title="New group"
        submitLabel="Create group"
        submitDisabled={!groupName.trim()}
        onSubmit={async () => {
          try {
            const group = await createSharedGroup({ name: groupName });
            setCreatingGroup(false);
            toast.success(`Group "${group.name}" created`);
            router.push(`/shared/group/${group.id}` as never);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not create the group');
          }
        }}>
        <Field
          label="Group name"
          value={groupName}
          onChangeText={setGroupName}
          placeholder="e.g. Goa Trip, Flat expenses, Office lunch"
          autoFocus
        />
        <AppText variant="caption" tone="muted">
          Groups keep a trip or a household together. Balances still roll up into Money owed per person.
        </AppText>
      </FormSheet>
    </ScrollScreen>
  );
}
