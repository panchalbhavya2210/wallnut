import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { Card, IconName, ListGroup, ListRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, IconButton, ProgressBar } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { AmountField, FormSheet, PickerSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import { cancelInstallment, createInstallment, deleteInstallment, listInstallmentProgress } from '@/services/installments.service';
import { ACCOUNT_TYPE_LABELS, listAccounts } from '@/services/accounts.service';
import { buildCategoryTree, listCategories } from '@/services/categories.service';
import { formatDayMonth } from '@/utils/date';
import { formatPercent } from '@/utils/money';

/** Installment plans — one purchase, N linked monthly charges. */
export default function InstallmentsScreen() {
  const theme = useTheme();
  const money = useMoney();
  const [editorOpen, setEditorOpen] = useState(false);
  const [name, setName] = useState('');
  const [merchant, setMerchant] = useState('');
  const [purchaseAmount, setPurchaseAmount] = useState(0);
  const [count, setCount] = useState(6);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [picker, setPicker] = useState<'none' | 'account' | 'category'>('none');

  const query = useQuery(async () => {
    const [plans, accounts, categories] = await Promise.all([listInstallmentProgress(), listAccounts(), listCategories()]);
    return { plans, accounts, categories };
  }, []);

  const data = query.data;
  const monthlyBurden = (data?.plans ?? []).reduce((sum, plan) => sum + plan.nextAmount, 0);

  const save = async () => {
    try {
      if (!name.trim()) throw new Error('Give the plan a name.');
      if (purchaseAmount <= 0) throw new Error('Enter the purchase amount.');
      if (!accountId) throw new Error('Choose the account the plan bills to.');
      await createInstallment({
        name: name.trim(),
        merchant: merchant.trim() || null,
        purchaseAmount,
        totalCount: count,
        accountId,
        categoryId,
      });
      setEditorOpen(false);
      toast.success('Installment plan created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the plan');
    }
  };

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Installments"
        subtitle={data && data.plans.length > 0 ? `${money.format(monthlyBurden)}/month in active plans` : 'Split purchases into monthly charges'}
        hint={{ id: 'installments', message: 'Installment plans split a purchase into monthly charges. Wallnut posts each charge and tracks the remaining balance.' }}
        right={<IconButton icon="add" onPress={() => setEditorOpen(true)} accessibilityLabel="Add installment plan" />}
      />

      {query.loading && !data ? (
        <LoadingBlock label="Loading plans…" />
      ) : (data?.plans.length ?? 0) === 0 ? (
        <EmptyState
          icon="layers-outline"
          title="No installment plans"
          message="Convert a big purchase into N linked monthly charges. The plan and its charges stay connected."
          actionLabel="Create a plan"
          onAction={() => setEditorOpen(true)}
        />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          {(data?.plans ?? []).map((plan) => (
            <Card key={plan.plan.id}>
              <Row justify="space-between" style={{ marginBottom: theme.spacing.md }}>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyMedium">{plan.plan.name}</AppText>
                  <AppText variant="caption" tone="muted">
                    {plan.plan.postedCount} of {plan.plan.totalCount} posted · {money.format(plan.plan.installmentAmount)}/month
                  </AppText>
                </View>
                <AppText variant="numericCaption" tone="secondary">
                  {formatPercent(plan.percent, 0)}
                </AppText>
              </Row>

              <ProgressBar progress={plan.percent} height={8} />

              <Row justify="space-between" style={{ marginTop: theme.spacing.sm }}>
                <AppText variant="caption" tone="muted">
                  Paid {money.format(plan.paidAmount)}
                </AppText>
                <AppText variant="caption" tone="muted">
                  Left {money.format(plan.remainingAmount)}
                </AppText>
              </Row>

              {plan.nextDate ? (
                <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                  Next charge {money.format(plan.nextAmount)} on {formatDayMonth(new Date(plan.nextDate))}
                </AppText>
              ) : (
                <AppText variant="caption" tone="positive" style={{ marginTop: theme.spacing.sm }}>
                  Plan complete
                </AppText>
              )}

              <Row gap="sm" style={{ marginTop: theme.spacing.md }}>
                <Button
                  label="Cancel remaining"
                  size="sm"
                  variant="secondary"
                  onPress={async () => {
                    const ok = await confirm({ title: 'Cancel the remaining installments?', message: 'Already-posted charges stay in your ledger.', confirmLabel: 'Cancel plan', tone: 'danger' });
                    if (!ok) return;
                    await cancelInstallment(plan.plan.id);
                    toast.show('Plan cancelled');
                  }}
                />
                <Button
                  label="Delete plan"
                  size="sm"
                  variant="ghost"
                  onPress={async () => {
                    const ok = await confirm({ title: 'Delete this plan?', message: 'Posted transactions are kept; the plan link is removed.', confirmLabel: 'Delete', tone: 'danger' });
                    if (!ok) return;
                    await deleteInstallment(plan.plan.id);
                    toast.show('Plan deleted');
                  }}
                />
              </Row>
            </Card>
          ))}

          <InfoBanner message="The first installment posts immediately; the rest post automatically on their dates. Every charge carries the plan's id, so you always know where it came from." />
        </View>
      )}

      <FormSheet
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        title="New installment plan"
        submitLabel="Create plan"
        onSubmit={save}
        submitDisabled={purchaseAmount <= 0 || !accountId}>
        <AmountField label="Purchase amount" valueMinor={purchaseAmount} onChangeMinor={setPurchaseAmount} currencySymbol={money.currency === 'INR' ? '₹' : money.currency} />
        <Row gap="sm" wrap>
          {[3, 6, 9, 12, 18, 24].map((option) => (
            <Button
              key={option}
              label={`${option} months`}
              size="sm"
              variant={count === option ? 'primary' : 'secondary'}
              onPress={() => setCount(option)}
            />
          ))}
        </Row>
        <AppText variant="caption" tone="muted">
          {purchaseAmount > 0 ? `About ${money.format(Math.round(purchaseAmount / count))}/month for ${count} months.` : 'Choose the number of installments.'}
        </AppText>
        <PickerRow label="Account" value={data?.accounts.find((account) => account.id === accountId)?.name ?? 'Choose account'} onPress={() => setPicker('account')} />
        <PickerRow label="Category" value={data?.categories.find((category) => category.id === categoryId)?.name ?? 'Uncategorised'} onPress={() => setPicker('category')} />
      </FormSheet>

      <PickerSheet
        visible={picker === 'account'}
        onClose={() => setPicker('none')}
        title="Account"
        items={(data?.accounts ?? []).map((account) => ({
          id: account.id,
          label: account.name,
          subtitle: ACCOUNT_TYPE_LABELS[account.type],
          icon: 'wallet-outline' as IconName,
        }))}
        onSelect={(item) => {
          setAccountId(item.id);
          setPicker('none');
        }}
      />
      <PickerSheet
        visible={picker === 'category'}
        onClose={() => setPicker('none')}
        title="Category"
        items={buildCategoryTree(data?.categories ?? []).flatMap((parent) => [
          { id: parent.id, label: parent.name, icon: parent.icon as IconName, color: parent.color },
          ...parent.children.map((child) => ({ id: child.id, label: child.name, icon: child.icon as IconName, color: child.color, section: parent.name })),
        ])}
        onSelect={(item) => {
          setCategoryId(item.id);
          setPicker('none');
        }}
      />
    </ScrollScreen>
  );
}

function PickerRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} android_ripple={{ color: theme.colors.ripple }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.md, borderRadius: theme.radius.md, backgroundColor: theme.colors.inputBackground }}>
        <AppText variant="caption" tone="muted" style={{ width: 70 }}>
          {label}
        </AppText>
        <AppText variant="bodySmall" style={{ flex: 1 }}>
          {value}
        </AppText>
        <Ionicons name="chevron-forward" size={15} color={theme.colors.muted} />
      </View>
    </Pressable>
  );
}
