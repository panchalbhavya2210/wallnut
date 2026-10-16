import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, Chip, IconButton, ProgressBar } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { AmountField, DatePickerSheet, FormSheet, PickerSheet } from '@/components/ui/sheets';
import { Gauge } from '@/components/Gauge';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import { addContribution, createGoal, deleteGoal, getGoalsProgress, updateGoal } from '@/services/goals.service';
import { listAccounts } from '@/services/accounts.service';
import { toISODate } from '@/utils/date';
import { formatPercent } from '@/utils/money';

/** Savings goals — money being accumulated, deliberately separate from budgets. */
export default function GoalsScreen() {
  const theme = useTheme();
  const money = useMoney();
  const params = useLocalSearchParams<{ action?: string }>();
  const [editorOpen, setEditorOpen] = useState(params.action === 'new');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState(0);
  const [targetDate, setTargetDate] = useState<Date | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [contributeTo, setContributeTo] = useState<string | null>(params.action === 'contribute' ? '__pick__' : null);
  const [contributionAmount, setContributionAmount] = useState(0);
  const [contributionAccountId, setContributionAccountId] = useState<string | null>(null);

  const query = useQuery(() => getGoalsProgress(), []);
  const accounts = useQuery(() => listAccounts(), []);
  const goals = query.data ?? [];

  const openEditor = (goalId: string | null) => {
    const existing = goalId ? goals.find((entry) => entry.goal.id === goalId) : null;
    setEditingId(goalId);
    setName(existing?.goal.name ?? '');
    setTarget(existing?.goal.targetAmount ?? 0);
    setTargetDate(existing?.goal.targetDate ? new Date(existing.goal.targetDate) : null);
    setAccountId(existing?.goal.linkedAccountId ?? null);
    setEditorOpen(true);
  };

  const save = async () => {
    try {
      if (!name.trim()) throw new Error('Give the goal a name.');
      if (target <= 0) throw new Error('Set a target amount.');
      const payload = {
        name: name.trim(),
        targetAmount: target,
        targetDate: targetDate ? toISODate(targetDate) : null,
        linkedAccountId: accountId,
      };
      if (editingId) {
        await updateGoal(editingId, payload);
        toast.success('Goal updated');
      } else {
        await createGoal(payload);
        toast.success('Goal created');
      }
      setEditorOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the goal');
    }
  };

  const contribute = async () => {
    if (!contributeTo || contributeTo === '__pick__') return;
    try {
      await addContribution({
        goalId: contributeTo,
        amount: contributionAmount,
        accountId: contributionAccountId,
      });
      toast.success('Contribution added');
      setContributeTo(null);
      setContributionAmount(0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add the contribution');
    }
  };

  const remove = async () => {
    if (!editingId) return;
    const ok = await confirm({ title: 'Delete this goal?', message: 'Contribution history is removed too. Money already moved stays in your accounts.', tone: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;
    await deleteGoal(editingId);
    setEditorOpen(false);
    toast.show('Goal deleted');
  };

  const activeGoal = contributeTo && contributeTo !== '__pick__' ? goals.find((entry) => entry.goal.id === contributeTo) : null;

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Goals"
        subtitle={goals.length > 0 ? `${goals.filter((goal) => goal.isComplete).length} of ${goals.length} funded` : 'Money you are setting aside'}
        hint={{ id: 'goals', message: "Goals hold money you're setting aside. Add a target and date, contribute from any account, and Wallnut shows the monthly amount needed to get there." }}
        right={<IconButton icon="add" onPress={() => openEditor(null)} accessibilityLabel="Add goal" />}
      />

      {query.loading && !query.data ? (
        <LoadingBlock label="Loading goals…" />
      ) : goals.length === 0 ? (
        <EmptyState
          icon="flag-outline"
          title="No goals yet"
          message="Goals track money you're accumulating — a trip, an emergency fund, a new laptop. They are never counted as spending."
          actionLabel="Create a goal"
          onAction={() => openEditor(null)}
        />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          {goals.map((progress) => (
            <Card key={progress.goal.id}>
              <Pressable onPress={() => router.push(`/goal/${progress.goal.id}` as never)} android_ripple={{ color: theme.colors.ripple }}>
                <Row justify="space-between" style={{ marginBottom: theme.spacing.md }}>
                  <Row gap="sm">
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: theme.radius.md,
                        backgroundColor: `${progress.goal.color}22`,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                      <Ionicons name={progress.goal.icon as IconName} size={17} color={progress.goal.color} />
                    </View>
                    <View>
                      <AppText variant="bodyMedium">{progress.goal.name}</AppText>
                      <AppText variant="caption" tone="muted">
                        {progress.isComplete ? 'Funded' : `${money.format(progress.remaining)} to go`}
                        {progress.goal.targetDate ? ` · by ${progress.goal.targetDate}` : ''}
                      </AppText>
                    </View>
                  </Row>
                  <AppText variant="numericCaption" tone="secondary">
                    {formatPercent(progress.percent, 0)}
                  </AppText>
                </Row>
              </Pressable>

              <Row justify="space-between" gap="lg" style={{ marginTop: theme.spacing.sm }}>
                <View style={{ flex: 1, gap: 6 }}>
                  <MoneyText amount={progress.saved} variant="numericSmall" tone="neutral" showSign={false} />
                  <AppText variant="caption" tone="muted">
                    of {money.format(progress.goal.targetAmount)}
                  </AppText>
                  {progress.requiredMonthly !== null && !progress.isComplete ? (
                    <AppText variant="caption" tone="muted">
                      {money.format(progress.requiredMonthly)}/month to hit the target
                      {progress.daysLeft !== null ? ` (${progress.daysLeft} days left)` : ''}
                    </AppText>
                  ) : progress.isComplete ? (
                    <AppText variant="caption" tone="positive">
                      Target reached
                    </AppText>
                  ) : (
                    <AppText variant="caption" tone="muted">
                      {money.format(progress.remaining)} to go
                    </AppText>
                  )}
                </View>
                <Gauge
                  progress={progress.percent}
                  size={86}
                  thickness={9}
                  color={progress.goal.color}
                  label={formatPercent(progress.percent, 0)}
                />
              </Row>

              <Row gap="sm" style={{ marginTop: theme.spacing.md }}>
                <Button
                  label="Add money"
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    setContributeTo(progress.goal.id);
                    setContributionAmount(0);
                  }}
                />
                <Button label="Edit" size="sm" variant="ghost" onPress={() => openEditor(progress.goal.id)} />
              </Row>
            </Card>
          ))}

          <InfoBanner message="Contributions update the saved amount. If a goal is linked to an account, contributing also records a transfer so your ledger stays truthful." />
        </View>
      )}

      <FormSheet
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingId ? 'Edit goal' : 'New goal'}
        submitLabel={editingId ? 'Save goal' : 'Create goal'}
        onSubmit={save}
        destructive={Boolean(editingId)}
        onDelete={editingId ? remove : undefined}>
        <AmountField label="Target amount" valueMinor={target} onChangeMinor={setTarget} currencySymbol={money.currency === 'INR' ? '₹' : money.currency} />
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="captionMedium" tone="secondary">
            Goal name
          </AppText>
          <ChipRow
            options={['Emergency fund', 'Trip', 'New laptop', 'Home deposit', 'Car']}
            onPick={(value) => setName(value)}
          />
        </View>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="captionMedium" tone="secondary">
            Name
          </AppText>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
            <AppText variant="bodyMedium" style={{ flex: 1 }}>
              {name || 'Tap a suggestion or type below'}
            </AppText>
          </View>
          <SuggestionInput value={name} onChange={setName} />
        </View>
        <Row gap="sm">
          <Chip
            label={targetDate ? `Target ${toISODate(targetDate)}` : 'Set target date'}
            selected={Boolean(targetDate)}
            onPress={() => setDatePickerOpen(true)}
          />
          {targetDate ? <Chip label="Clear" onPress={() => setTargetDate(null)} /> : null}
        </Row>
        <Row gap="sm">
          <Chip
            label={accountId ? accounts.data?.find((account) => account.id === accountId)?.name ?? 'Linked account' : 'Link an account (optional)'}
            selected={Boolean(accountId)}
            onPress={() => setAccountPickerOpen(true)}
          />
          {accountId ? <Chip label="Unlink" onPress={() => setAccountId(null)} /> : null}
        </Row>
      </FormSheet>

      <FormSheet
        visible={Boolean(contributeTo)}
        onClose={() => setContributeTo(null)}
        title={activeGoal ? `Add to ${activeGoal.goal.name}` : 'Add contribution'}
        submitLabel="Add contribution"
        onSubmit={contribute}
        submitDisabled={contributionAmount <= 0}>
        {contributeTo === '__pick__' ? (
          <View style={{ gap: theme.spacing.sm }}>
            {goals.map((goal) => (
              <Chip key={goal.goal.id} label={goal.goal.name} onPress={() => setContributeTo(goal.goal.id)} />
            ))}
          </View>
        ) : (
          <>
            <AmountField
              label="Contribution"
              valueMinor={contributionAmount}
              onChangeMinor={setContributionAmount}
              currencySymbol={money.currency === 'INR' ? '₹' : money.currency}
            />
            <Chip
              label={contributionAccountId ? `From ${accounts.data?.find((account) => account.id === contributionAccountId)?.name}` : 'From account (optional)'}
              selected={Boolean(contributionAccountId)}
              onPress={() => setAccountPickerOpen(true)}
            />
            <AppText variant="caption" tone="muted">
              {activeGoal?.goal.linkedAccountId
                ? 'This goal is linked to an account, so contributing records a real transfer.'
                : 'Without a linked account this only tracks progress — no money moves.'}
            </AppText>
          </>
        )}
      </FormSheet>

      <DatePickerSheet
        visible={datePickerOpen}
        onClose={() => setDatePickerOpen(false)}
        value={targetDate ?? new Date()}
        onSelect={setTargetDate}
        title="Target date"
      />
      <PickerSheet
        visible={accountPickerOpen}
        onClose={() => setAccountPickerOpen(false)}
        title="Choose account"
        items={(accounts.data ?? []).map((account) => ({
          id: account.id,
          label: account.name,
          subtitle: money.format(account.currentBalance),
          icon: 'wallet-outline' as IconName,
        }))}
        onSelect={(item) => {
          if (contributeTo) setContributionAccountId(item.id);
          else setAccountId(item.id);
          setAccountPickerOpen(false);
        }}
      />
    </ScrollScreen>
  );
}

function ChipRow({ options, onPick }: { options: string[]; onPick: (value: string) => void }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
      {options.map((option) => (
        <Chip key={option} label={option} onPress={() => onPick(option)} />
      ))}
    </View>
  );
}

function SuggestionInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        backgroundColor: theme.colors.inputBackground,
        borderRadius: theme.radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        paddingHorizontal: theme.spacing.md,
        height: 46,
      }}>
      <Ionicons name="create-outline" size={16} color={theme.colors.muted} />
      <SuggestionTextInput value={value} onChange={onChange} />
    </View>
  );
}

function SuggestionTextInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { TextInput } = require('react-native') as typeof import('react-native');
  const theme = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="Goal name"
      placeholderTextColor={theme.colors.muted}
      style={{ flex: 1, color: theme.colors.text, fontFamily: theme.typography.body.fontFamily, fontSize: 15, paddingVertical: 0 }}
    />
  );
}
