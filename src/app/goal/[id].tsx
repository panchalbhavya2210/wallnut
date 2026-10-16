import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, KeyValueRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, ProgressBar } from '@/components/ui/controls';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/feedback';
import { AmountField, FormSheet, PickerSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import { addContribution, deleteGoal, getGoalProgress, listContributions, updateGoal } from '@/services/goals.service';
import { listAccounts } from '@/services/accounts.service';
import { formatDayMonth } from '@/utils/date';
import { formatPercent } from '@/utils/money';

/** Goal detail — progress, required pace, and the contribution history. */
export default function GoalDetailScreen() {
  const theme = useTheme();
  const money = useMoney();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [contributeOpen, setContributeOpen] = useState(false);
  const [amount, setAmount] = useState(0);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [editAmount, setEditAmount] = useState(0);
  const [editOpen, setEditOpen] = useState(false);

  const query = useQuery(async () => {
    if (!id) return null;
    const progress = await getGoalProgress(id);
    if (!progress) return null;
    const contributions = await listContributions(id);
    return { progress, contributions };
  }, [id]);

  const accounts = useQuery(() => listAccounts(), []);

  if (query.loading) return <ScrollScreen><LoadingBlock label="Loading goal…" /></ScrollScreen>;
  if (query.error || !query.data) {
    return (
      <ScrollScreen>
        <ScreenHeader title="Goal" />
        <ErrorBlock message={query.error?.message ?? 'That goal no longer exists.'} onRetry={query.refresh} />
      </ScrollScreen>
    );
  }

  const { progress, contributions } = query.data;
  const goal = progress.goal;

  const contribute = async () => {
    try {
      await addContribution({ goalId: goal.id, amount, accountId });
      toast.success('Contribution added');
      setContributeOpen(false);
      setAmount(0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not contribute');
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: 'Delete this goal?', tone: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;
    await deleteGoal(goal.id);
    router.back();
  };

  return (
    <ScrollScreen>
      <ScreenHeader
        title={goal.name}
        subtitle={progress.isComplete ? 'Fully funded' : `${formatPercent(progress.percent, 0)} funded`}
        right={<Button label="Edit" variant="ghost" size="sm" onPress={() => { setEditAmount(goal.targetAmount); setEditOpen(true); }} />}
      />

      <View style={{ gap: theme.spacing.lg }}>
        <Card>
          <AppText variant="numericLarge">
            {money.format(progress.saved)}
            <AppText variant="caption" tone="muted">
              {' '}
              of {money.format(goal.targetAmount)}
            </AppText>
          </AppText>
          <ProgressBar progress={progress.percent} height={10} color={goal.color} style={{ marginTop: theme.spacing.md }} />
          <Row justify="space-between" style={{ marginTop: theme.spacing.sm }}>
            <AppText variant="caption" tone="muted">
              {formatPercent(progress.percent, 1)}
            </AppText>
            <AppText variant="caption" tone="muted">
              {progress.remaining > 0 ? `${money.format(progress.remaining)} to go` : 'Target reached'}
            </AppText>
          </Row>
          <View style={{ marginTop: theme.spacing.md }}>
            {goal.targetDate ? (
              <KeyValueRow label="Target date" value={formatDayMonth(new Date(goal.targetDate))} />
            ) : null}
            {progress.requiredMonthly !== null ? (
              <KeyValueRow label="Required monthly" value={`${money.format(progress.requiredMonthly)}/month`} />
            ) : null}
            {progress.daysLeft !== null ? <KeyValueRow label="Days left" value={String(progress.daysLeft)} /> : null}
            <KeyValueRow label="Contributions" value={String(progress.contributionsCount)} />
            {progress.lastContributionDate ? (
              <KeyValueRow label="Last contribution" value={formatDayMonth(new Date(progress.lastContributionDate))} />
            ) : null}
          </View>
        </Card>

        <Button label="Add contribution" size="lg" fullWidth onPress={() => setContributeOpen(true)} />

        <View>
          <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.sm }}>
            HISTORY
          </AppText>
          {contributions.length === 0 ? (
            <EmptyState compact icon="flag-outline" title="No contributions yet" message="Add money to start tracking progress." />
          ) : (
            <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, overflow: 'hidden' }}>
              {[...contributions].reverse().map((entry, index) => (
                <Row
                  key={entry.id}
                  justify="space-between"
                  style={{
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.md,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.border,
                  }}>
                  <View>
                    <AppText variant="bodySmall">{formatDayMonth(new Date(entry.date))}</AppText>
                    {entry.note ? (
                      <AppText variant="caption" tone="muted">
                        {entry.note}
                      </AppText>
                    ) : null}
                  </View>
                  <MoneyText amount={entry.amount} variant="numericBody" tone={entry.amount >= 0 ? 'positive' : 'negative'} showSign />
                </Row>
              ))}
            </View>
          )}
        </View>

        <Button label="Delete goal" variant="danger" fullWidth onPress={remove} />
      </View>

      <FormSheet
        visible={contributeOpen}
        onClose={() => setContributeOpen(false)}
        title={`Add to ${goal.name}`}
        submitLabel="Add contribution"
        onSubmit={contribute}
        submitDisabled={amount <= 0}>
        <AmountField label="Contribution" valueMinor={amount} onChangeMinor={setAmount} currencySymbol={money.currency === 'INR' ? '₹' : money.currency} />
        <Pressable onPress={() => setAccountPickerOpen(true)} android_ripple={{ color: theme.colors.ripple }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, padding: theme.spacing.md, borderRadius: theme.radius.md, backgroundColor: theme.colors.inputBackground }}>
            <Ionicons name="wallet-outline" size={16} color={theme.colors.textSecondary} />
            <AppText variant="bodySmall" style={{ flex: 1 }}>
              {accountId ? accounts.data?.find((account) => account.id === accountId)?.name ?? 'Account' : 'From account (optional)'}
            </AppText>
            <Ionicons name="chevron-forward" size={15} color={theme.colors.muted} />
          </View>
        </Pressable>
        <AppText variant="caption" tone="muted">
          {goal.linkedAccountId
            ? 'Linked to an account — contributing also records a transfer.'
            : 'Not linked to an account — progress only, no money moves.'}
        </AppText>
      </FormSheet>

      <FormSheet
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit target"
        submitLabel="Save target"
        onSubmit={async () => {
          try {
            await updateGoal(goal.id, { targetAmount: editAmount });
            setEditOpen(false);
            toast.success('Target updated');
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not update');
          }
        }}>
        <AmountField label="Target amount" valueMinor={editAmount} onChangeMinor={setEditAmount} currencySymbol={money.currency === 'INR' ? '₹' : money.currency} />
      </FormSheet>

      <PickerSheet
        visible={accountPickerOpen}
        onClose={() => setAccountPickerOpen(false)}
        title="Contribute from"
        items={(accounts.data ?? []).map((account) => ({
          id: account.id,
          label: account.name,
          subtitle: money.format(account.currentBalance),
          icon: 'wallet-outline' as const,
        }))}
        selectedId={accountId}
        onSelect={(item) => {
          setAccountId(item.id);
          setAccountPickerOpen(false);
        }}
      />
    </ScrollScreen>
  );
}
