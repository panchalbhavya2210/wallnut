import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, ListGroup, ListRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, Chip, IconButton, SegmentedControl } from '@/components/ui/controls';
import { EmptyState, ErrorBlock, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { Field, FormSheet, PickerSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { SettleSheet } from '@/components/SettleSheet';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import { createPerson, listPeople } from '@/services/debts.service';
import {
  addGroupMember,
  deleteSharedGroup,
  deleteSettlement,
  getSharedBalances,
  getSharedGroupSummary,
  listSettlements,
  listSharedExpenses,
  payerLabel,
  recordSettlement,
  removeGroupMember,
  updateSharedGroup,
} from '@/services/shared.service';
import { formatDayMonth } from '@/utils/date';
import type { SettlementSuggestionWithNames } from '@/services/shared.service';
import type { PersonBalance } from '@/utils/split';

type GroupTab = 'expenses' | 'balances' | 'members' | 'settlements';

/** One group (trip, flat, office lunch): expenses, balances, members, settlements. */
export default function SharedGroupScreen() {
  const theme = useTheme();
  const money = useMoney();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<GroupTab>('expenses');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [newPersonOpen, setNewPersonOpen] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [settling, setSettling] = useState<{ personId: string; name: string; balance: PersonBalance } | null>(null);
  const [recording, setRecording] = useState<SettlementSuggestionWithNames | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useQuery(async () => {
    if (!id) return null;
    const summary = await getSharedGroupSummary(id);
    if (!summary) return null;
    const [globalBalances, expenses, settlements, people] = await Promise.all([
      getSharedBalances(),
      listSharedExpenses({ groupId: id }),
      listSettlements({ groupId: id }),
      listPeople(),
    ]);
    return { summary, globalBalances, expenses, settlements, people };
  }, [id]);

  const peopleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of query.data?.people ?? []) map.set(person.id, person.name);
    return map;
  }, [query.data]);

  if (query.loading) return <ScrollScreen><LoadingBlock label="Loading…" /></ScrollScreen>;
  if (query.error || !query.data) {
    return (
      <ScrollScreen>
        <ScreenHeader title="Group" />
        <ErrorBlock message={query.error?.message ?? 'That group no longer exists.'} onRetry={query.refresh} />
      </ScrollScreen>
    );
  }

  const { summary, globalBalances, expenses, settlements, people } = query.data;
  const group = summary.group;

  const nameOf = (key: string | null) => (key === null ? 'You' : (peopleById.get(key) ?? 'Unknown'));

  const settleFor = (personId: string, name: string, fallback: PersonBalance) => {
    const global = globalBalances.people.find((balance) => balance.personId === personId);
    setSettling({
      personId,
      name,
      balance: global ?? { personId, theyOwe: Math.max(0, fallback.net), youOwe: Math.max(0, -fallback.net), net: fallback.net },
    });
  };

  const recordSuggestion = async (suggestion: SettlementSuggestionWithNames) => {
    if (busy) return;
    const fromPersonId = suggestion.fromKey === 'self' ? null : suggestion.fromKey;
    const toPersonId = suggestion.toKey === 'self' ? null : suggestion.toKey;

    // When the user's own cash moves, settle through the sheet so an account
    // can be chosen. Between two other members there is no cash movement.
    if (fromPersonId === null || toPersonId === null) {
      settleFor(
        fromPersonId ?? toPersonId!,
        fromPersonId ? suggestion.fromName : suggestion.toName,
        { personId: fromPersonId ?? toPersonId!, theyOwe: 0, youOwe: 0, net: 0 },
      );
      return;
    }

    setRecording(suggestion);
  };

  return (
    <ScrollScreen>
      <ScreenHeader
        title={group.name}
        subtitle="Shared group"
        right={
          <Row gap="xs">
            <IconButton icon="create-outline" onPress={() => { setEditName(group.name); setEditing(true); }} accessibilityLabel="Edit group" />
            <IconButton icon="add" onPress={() => router.push(`/shared/expense/new?groupId=${group.id}` as never)} accessibilityLabel="New expense in group" />
          </Row>
        }
      />

      <View style={{ gap: theme.spacing.lg }}>
        <Card>
          <Row justify="space-between">
            <View style={{ flex: 1 }}>
              <AppText variant="label" tone="muted">
                TOTAL SPENT
              </AppText>
              <MoneyText amount={summary.totalSpent} variant="numericMedium" style={{ marginTop: 4 }} showSign={false} />
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <AppText variant="label" tone="muted">
                YOU PAID
              </AppText>
              <MoneyText amount={summary.youPaid} variant="numericMedium" style={{ marginTop: 4 }} showSign={false} />
            </View>
          </Row>
          <View
            style={{
              marginTop: theme.spacing.md,
              paddingTop: theme.spacing.md,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.colors.border,
              gap: 6,
            }}>
            <Row justify="space-between">
              <AppText variant="bodySmall" tone="secondary">
                Your share
              </AppText>
              <MoneyText amount={summary.yourShare} variant="numericSmall" showSign={false} />
            </Row>
            <Row justify="space-between">
              <AppText variant="bodySmall" tone="secondary">
                You should receive
              </AppText>
              <MoneyText amount={summary.youAreOwed} variant="numericSmall" tone="positive" />
            </Row>
            <Row justify="space-between">
              <AppText variant="bodySmall" tone="secondary">
                You owe
              </AppText>
              <MoneyText amount={summary.youOwe} variant="numericSmall" tone="negative" />
            </Row>
            <AppText variant="caption" tone="muted">
              {expenses.length} expense{expenses.length === 1 ? '' : 's'} paid by {new Set(expenses.flatMap((entry) => entry.payers.map((payer) => payer.name))).size} member(s)
            </AppText>
          </View>
        </Card>

        <SegmentedControl
          options={[
            { value: 'expenses', label: 'Expenses' },
            { value: 'balances', label: 'Balances' },
            { value: 'members', label: 'Members' },
            { value: 'settlements', label: 'Settled' },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'expenses' ? (
          expenses.length === 0 ? (
            <EmptyState
              icon="receipt-outline"
              title="No expenses in this group"
              message="Add the first bill — the group summary updates instantly."
              actionLabel="New expense"
              onAction={() => router.push(`/shared/expense/new?groupId=${group.id}` as never)}
            />
          ) : (
            <ListGroup>
              {expenses.map((entry) => (
                <ListRow
                  key={entry.expense.id}
                  icon="receipt-outline"
                  title={entry.expense.title}
                  subtitle={`${formatDayMonth(new Date(entry.expense.date))} · ${payerLabel(entry)}${
                    entry.items.length > 1 ? ` · ${entry.items.length} items` : ''
                  }`}
                  value={
                    <View style={{ alignItems: 'flex-end' }}>
                      <MoneyText amount={entry.expense.amount} variant="numericSmall" showSign={false} />
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
          )
        ) : null}

        {tab === 'balances' ? (
          <View style={{ gap: theme.spacing.lg }}>
            {summary.suggestions.length > 0 ? (
              <View>
                <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.sm }}>
                  SETTLEMENTS TO MAKE
                </AppText>
                <ListGroup>
                  {summary.suggestions.map((suggestion) => (
                    <ListRow
                      key={`${suggestion.fromKey}-${suggestion.toKey}`}
                      icon="swap-horizontal-outline"
                      iconColor={theme.colors.accent.base}
                      title={`${suggestion.fromName} → ${suggestion.toName}`}
                      subtitle="Fewest transfers to settle the group"
                      value={
                        <Row gap="sm">
                          <MoneyText amount={suggestion.amount} variant="numericSmall" showSign={false} />
                          <Button
                            label="Record"
                            size="sm"
                            variant="secondary"
                            accessibilityLabel={`Record ${suggestion.fromName} to ${suggestion.toName}`}
                            onPress={() => void recordSuggestion(suggestion)}
                          />
                        </Row>
                      }
                    />
                  ))}
                </ListGroup>
                <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                  Settling through the app between two other members records it without touching your cash.
                </AppText>
              </View>
            ) : null}

            {summary.balances.length === 0 ? (
              <EmptyState icon="scale-outline" title="All settled" message="Nobody owes anybody in this group." />
            ) : (
              <View>
                <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.sm }}>
                  MEMBER BALANCES
                </AppText>
                <ListGroup>
                  {summary.balances.map((balance) => {
                    const global = balance.personId ? globalBalances.people.find((entry) => entry.personId === balance.personId) : null;
                    return (
                      <ListRow
                        key={balance.key}
                        icon={balance.personId === null ? 'person-circle-outline' : 'person-outline'}
                        title={balance.name}
                        subtitle={balance.net > 0 ? `gets back ${money.format(balance.net)}` : `owes ${money.format(-balance.net)}`}
                        value={
                          global && global.net !== 0 ? (
                            <Chip label="Settle" size="sm" onPress={() => settleFor(global.personId, balance.name, global)} />
                          ) : undefined
                        }
                        chevron={Boolean(balance.personId)}
                        onPress={balance.personId ? () => router.push(`/person/${balance.personId}` as never) : undefined}
                      />
                    );
                  })}
                </ListGroup>
                <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                  Balances are what each person paid minus what they consumed. Suggested transfers above clear the group with the fewest payments.
                </AppText>
              </View>
            )}
          </View>
        ) : null}

        {tab === 'members' ? (
          <View style={{ gap: theme.spacing.sm }}>
            <ListGroup>
              {summary.members.map((member) => (
                <ListRow
                  key={member.personId}
                  icon="person-outline"
                  title={member.name}
                  onPress={() => router.push(`/person/${member.personId}` as never)}
                  chevron
                  right={
                    <IconButton
                      icon="close-circle-outline"
                      size={30}
                      color={theme.colors.muted}
                      accessibilityLabel={`Remove ${member.name}`}
                      onPress={async () => {
                        await removeGroupMember(group.id, member.personId);
                        toast.show(`${member.name} removed from ${group.name}`);
                        query.refresh();
                      }}
                    />
                  }
                />
              ))}
            </ListGroup>
            <Button label="Add member" variant="secondary" fullWidth onPress={() => setAddingMember(true)} />
            <AppText variant="caption" tone="muted">
              Removing a member only removes them from this group — their expenses and balances stay.
            </AppText>
          </View>
        ) : null}

        {tab === 'settlements' ? (
          settlements.length === 0 ? (
            <EmptyState icon="checkmark-done-outline" title="No settlements yet" message="Record a suggested transfer or settle up with a person — settlements never count as income or spending." />
          ) : (
            <ListGroup>
              {settlements.map((settlement) => (
                <ListRow
                  key={settlement.id}
                  icon="swap-horizontal-outline"
                  iconColor={theme.colors.accent.base}
                  title={`${nameOf(settlement.fromPersonId)} → ${nameOf(settlement.toPersonId)}`}
                  subtitle={`${formatDayMonth(new Date(settlement.date))}${settlement.note ? ` · ${settlement.note}` : ''}`}
                  value={<MoneyText amount={settlement.amount} variant="numericSmall" tone="neutral" showSign={false} />}
                  right={
                    <IconButton
                      icon="trash-outline"
                      size={30}
                      color={theme.colors.muted}
                      accessibilityLabel="Delete settlement"
                      onPress={async () => {
                        const ok = await confirm({ title: 'Delete this settlement?', message: 'The balances go back up.', confirmLabel: 'Delete', tone: 'danger' });
                        if (!ok) return;
                        await deleteSettlement(settlement.id);
                        toast.show('Settlement deleted');
                        query.refresh();
                      }}
                    />
                  }
                />
              ))}
            </ListGroup>
          )
        ) : null}

        <InfoBanner message="All shares sum to each bill. Your ledger only records cash that actually left your accounts — the rest is money owed, and settlements are never income or spending." />
      </View>

      {/* Confirm a settlement between two other members */}
      <FormSheet
        visible={Boolean(recording)}
        onClose={() => setRecording(null)}
        title="Record settlement"
        submitLabel="Record"
        submitDisabled={busy}
        onSubmit={async () => {
          if (!recording) return;
          setBusy(true);
          try {
            await recordSettlement({
              fromPersonId: recording.fromKey === 'self' ? null : recording.fromKey,
              toPersonId: recording.toKey === 'self' ? null : recording.toKey,
              amount: recording.amount,
              groupId: group.id,
              note: 'Group settlement',
            });
            toast.success('Settlement recorded');
            setRecording(null);
            query.refresh();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not record the settlement');
          } finally {
            setBusy(false);
          }
        }}>
        <AppText variant="bodyMedium">
          {recording ? `${recording.fromName} pays ${recording.toName}` : ''}
        </AppText>
        <Row justify="space-between">
          <AppText variant="bodySmall" tone="secondary">
            Amount
          </AppText>
          <MoneyText amount={recording?.amount ?? 0} variant="numericMedium" showSign={false} />
        </Row>
        <AppText variant="caption" tone="muted">
          This adjusts the group balances. Neither person's cash accounts are touched because the app only tracks your own accounts.
        </AppText>
      </FormSheet>

      {/* Edit group */}
      <FormSheet
        visible={editing}
        onClose={() => setEditing(false)}
        title="Edit group"
        submitLabel="Save"
        submitDisabled={!editName.trim()}
        destructive
        onDelete={async () => {
          try {
            await deleteSharedGroup(group.id);
            setEditing(false);
            toast.show('Group deleted');
            router.back();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not delete the group');
          }
        }}
        onSubmit={async () => {
          await updateSharedGroup(group.id, { name: editName });
          setEditing(false);
          toast.success('Group updated');
          query.refresh();
        }}>
        <Field label="Group name" value={editName} onChangeText={setEditName} autoFocus />
        <Button
          label={group.isArchived ? 'Unarchive group' : 'Archive group'}
          variant="secondary"
          fullWidth
          onPress={async () => {
            await updateSharedGroup(group.id, { isArchived: !group.isArchived });
            toast.show(group.isArchived ? 'Group unarchived' : 'Group archived');
            setEditing(false);
            query.refresh();
          }}
        />
        <AppText variant="caption" tone="muted">
          Archiving hides the group without touching its expenses or balances. Deleting is only possible when the group has no expenses.
        </AppText>
      </FormSheet>

      {/* Add member */}
      <PickerSheet
        visible={addingMember}
        onClose={() => setAddingMember(false)}
        title="Add member"
        items={people
          .filter((person) => !summary.members.some((member) => member.personId === person.id))
          .map((person) => ({ id: person.id, label: person.name, icon: 'person-outline' as const }))}
        emptyTitle="Everyone is already a member"
        emptyMessage="Create a new person to add them."
        onSelect={async (item) => {
          await addGroupMember(group.id, item.id);
          setAddingMember(false);
          toast.success(`${item.label} added`);
          query.refresh();
        }}
        createLabel="New person"
        onCreate={() => {
          setAddingMember(false);
          setNewPersonName('');
          setNewPersonOpen(true);
        }}
      />

      <FormSheet
        visible={newPersonOpen}
        onClose={() => setNewPersonOpen(false)}
        title="New person"
        submitLabel="Add person"
        submitDisabled={!newPersonName.trim()}
        onSubmit={async () => {
          try {
            const person = await createPerson({ name: newPersonName });
            await addGroupMember(group.id, person.id);
            setNewPersonOpen(false);
            toast.success(`${person.name} added`);
            query.refresh();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not add the person');
          }
        }}>
        <Field label="Name" value={newPersonName} onChangeText={setNewPersonName} placeholder="e.g. Neha" autoFocus />
      </FormSheet>

      {settling ? (
        <SettleSheet
          visible
          onClose={() => setSettling(null)}
          personId={settling.personId}
          personName={settling.name}
          balance={settling.balance}
          groupId={group.id}
          onSettled={query.refresh}
        />
      ) : null}
    </ScrollScreen>
  );
}
