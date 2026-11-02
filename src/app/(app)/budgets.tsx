import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, HeaderScrollScreen, IconName, Row } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Chip, SettingSwitch } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { AppHeader, RoundIconButton } from '@/components/AppHeader';
import { ScreenHint } from '@/components/ScreenHint';
import { AmountField, FormSheet, PickerSheet } from '@/components/ui/sheets';
import { AnimatedMoney, Gauge } from '@/components/Gauge';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { toast } from '@/stores/ui.store';
import { createBudget, deleteBudget, getBudgetProgressList, updateBudget, type BudgetProgress } from '@/services/budgets.service';
import { buildCategoryTree, listCategories } from '@/services/categories.service';
import { toISODate } from '@/utils/date';
import { formatPercent } from '@/utils/money';

/** Budgets — category limits with safe-to-spend, projection and rollover. */
export default function BudgetsScreen() {
  const theme = useTheme();
  const money = useMoney();
  const defaultPeriod = useSettingsStore((state) => state.budgets.defaultPeriod);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetProgress | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [period, setPeriod] = useState<'weekly' | 'monthly' | 'yearly'>(defaultPeriod);
  const [rollover, setRollover] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const query = useQuery(() => getBudgetProgressList(), []);
  const categories = useQuery(() => listCategories(), []);
  const budgets = query.data ?? [];

  const totalBudgeted = budgets.reduce((sum, budget) => sum + budget.budget.amount, 0);
  const totalSpent = budgets.reduce((sum, budget) => sum + budget.spent, 0);

  const openEditor = (budget: BudgetProgress | null) => {
    setEditing(budget);
    setCategoryId(budget?.budget.categoryId ?? null);
    setAmount(budget?.budget.amount ?? 0);
    setPeriod((budget?.budget.period === 'weekly' || budget?.budget.period === 'yearly' ? budget.budget.period : 'monthly'));
    setRollover(budget?.budget.rolloverEnabled ?? false);
    setEditorOpen(true);
  };

  const save = async () => {
    try {
      if (amount <= 0) throw new Error('Enter a budget amount.');
      if (editing) {
        await updateBudget(editing.budget.id, { categoryId, amount, period, rolloverEnabled: rollover });
        toast.success('Budget updated');
      } else {
        await createBudget({
          categoryId,
          amount,
          period,
          startDate: toISODate(new Date()),
          rolloverEnabled: rollover,
        });
        toast.success('Budget created');
      }
      setEditorOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the budget');
    }
  };

  const remove = async () => {
    if (!editing) return;
    const ok = await confirm({ title: 'Delete this budget?', tone: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;
    await deleteBudget(editing.budget.id);
    setEditorOpen(false);
    toast.show('Budget deleted');
  };

  return (
    <HeaderScrollScreen
      header={
        <>
          <AppHeader
            title="Budgets"
            subtitle={budgets.length > 0 ? `${money.format(totalSpent)} of ${money.format(totalBudgeted)} used` : 'Set limits that actually adapt'}
            right={<RoundIconButton icon="add" onPress={() => openEditor(null)} label="Add budget" tone="accent" />}
          />
          <ScreenHint
            id="budgets"
            message="Budgets track category limits for the period. Tap a budget for its pace and safe-to-spend, edit the amount, or turn on rollover to carry unused money forward."
          />
        </>
      }>
      {query.loading && !query.data ? (
        <LoadingBlock label="Loading budgets…" />
      ) : budgets.length === 0 ? (
        <EmptyState
          icon="pie-chart-outline"
          title="No budgets yet"
          message="Budgets track category limits with safe-to-spend and end-of-period projections. They never block a transaction."
          actionLabel="Create a budget"
          onAction={() => openEditor(null)}
        />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Card>
            <Row justify="space-between" gap="lg">
              <View style={{ flex: 1, gap: 6 }}>
                <AppText variant="caption" tone="muted">
                  This period
                </AppText>
                <AnimatedMoney
                  amount={totalBudgeted - totalSpent}
                  variant="numericMedium"
                  tone={totalBudgeted - totalSpent >= 0 ? 'positive' : 'negative'}
                />
                <AppText variant="caption" tone="muted">
                  left of {money.format(totalBudgeted)} across {budgets.length} budget{budgets.length === 1 ? '' : 's'}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {formatPercent(totalBudgeted > 0 ? (totalSpent / totalBudgeted) * 100 : 0, 0)} used
                </AppText>
              </View>
              <Gauge
                progress={totalBudgeted > 0 ? (totalSpent / totalBudgeted) * 100 : 0}
                size={126}
                thickness={12}
                tone={
                  totalBudgeted > 0 && (totalSpent / totalBudgeted) * 100 >= 100
                    ? 'negative'
                    : totalBudgeted > 0 && (totalSpent / totalBudgeted) * 100 >= 85
                      ? 'warning'
                      : 'positive'
                }
                label={formatPercent(totalBudgeted > 0 ? (totalSpent / totalBudgeted) * 100 : 0, 0)}
                caption="of budget used"
              />
            </Row>
          </Card>

          {budgets.map((budget) => (
            <Pressable key={budget.budget.id} onPress={() => router.push(`/budget/${budget.budget.id}` as never)} android_ripple={{ color: theme.colors.ripple }}>
              <Card>
                <Row justify="space-between" gap="lg">
                  <View style={{ flex: 1, gap: theme.spacing.sm }}>
                    <Row gap="sm">
                      <View
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: theme.radius.full,
                          backgroundColor: `${budget.categoryColor ?? theme.colors.accent.base}22`,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                        <Ionicons name={(budget.categoryIcon as IconName) ?? 'pie-chart-outline'} size={16} color={budget.categoryColor ?? theme.colors.accent.base} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <AppText variant="bodyMedium">{budget.categoryName}</AppText>
                        <AppText variant="caption" tone="muted">
                          {budget.budget.period} · {budget.daysRemaining} day{budget.daysRemaining === 1 ? '' : 's'} left
                          {budget.budget.rolloverEnabled ? ' · rollover' : ''}
                        </AppText>
                      </View>
                    </Row>

                    <Row justify="space-between">
                      <MoneyText amount={budget.spent} variant="numericSmall" tone="neutral" showSign={false} />
                      <AppText variant="caption" tone="muted">
                        of {money.format(budget.budget.amount)}
                      </AppText>
                    </Row>

                    <AppText variant="caption" tone={budget.remaining >= 0 ? 'muted' : 'negative'}>
                      {budget.remaining >= 0
                        ? `${money.format(budget.remaining)} left · ${money.format(budget.safeToSpendPerDay)}/day safe to spend`
                        : `${money.format(Math.abs(budget.remaining))} over budget`}
                    </AppText>
                  </View>

                  <Gauge
                    progress={budget.percent}
                    size={92}
                    thickness={9}
                    tone={budget.percent >= 100 ? 'negative' : budget.percent >= 85 ? 'warning' : 'positive'}
                    label={formatPercent(budget.percent, 0)}
                  />
                </Row>
              </Card>
            </Pressable>
          ))}

          <InfoBanner message="Rollover carries unspent money into the next period. Safe-to-spend is simply what remains divided by the days left — your daily allowance, not a rule." />
        </View>
      )}

      <FormSheet
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? 'Edit budget' : 'New budget'}
        submitLabel={editing ? 'Save budget' : 'Create budget'}
        onSubmit={save}
        destructive={Boolean(editing)}
        onDelete={editing ? remove : undefined}>
        <Pressable onPress={() => setPickerOpen(true)} android_ripple={{ color: theme.colors.ripple }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              padding: theme.spacing.md,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.inputBackground,
            }}>
            <Ionicons name={(editing?.categoryIcon as IconName) ?? 'pricetag-outline'} size={17} color={editing?.categoryColor ?? theme.colors.textSecondary} />
            <AppText variant="bodySmall" style={{ flex: 1 }}>
              {categories.data?.find((category) => category.id === categoryId)?.name ?? 'All categories (overall budget)'}
            </AppText>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
          </View>
        </Pressable>

        <AmountField label="Budget amount" valueMinor={amount} onChangeMinor={setAmount} currencySymbol={money.currency === 'INR' ? '₹' : money.currency} />

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="captionMedium" tone="secondary">
            Period
          </AppText>
          <Row gap="sm">
            <Chip label="Weekly" selected={period === 'weekly'} onPress={() => setPeriod('weekly')} />
            <Chip label="Monthly" selected={period === 'monthly'} onPress={() => setPeriod('monthly')} />
            <Chip label="Yearly" selected={period === 'yearly'} onPress={() => setPeriod('yearly')} />
          </Row>
        </View>

        <View style={{ borderRadius: theme.radius.md, backgroundColor: theme.colors.inputBackground, overflow: 'hidden' }}>
          <SettingSwitch
            title="Rollover unspent money"
            subtitle="Unused budget carries into the next period"
            value={rollover}
            onValueChange={setRollover}
          />
        </View>
      </FormSheet>

      <PickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Budget category"
        items={[
          { id: '__all__', label: 'All categories', subtitle: 'An overall spending budget', icon: 'apps-outline' as IconName },
          ...buildCategoryTree(categories.data ?? []).flatMap((parent) => [
            { id: parent.id, label: parent.name, icon: parent.icon as IconName, color: parent.color, section: 'Categories' },
            ...parent.children.map((child) => ({
              id: child.id,
              label: child.name,
              subtitle: `${parent.name} · includes subcategories`,
              icon: child.icon as IconName,
              color: child.color,
              section: parent.name,
            })),
          ]),
        ]}
        selectedId={categoryId ?? '__all__'}
        onSelect={(item) => {
          setCategoryId(item.id === '__all__' ? null : item.id);
          setPickerOpen(false);
        }}
      />
    </HeaderScrollScreen>
  );
}
