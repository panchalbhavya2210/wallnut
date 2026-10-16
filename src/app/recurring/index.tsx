import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, ListGroup, ListRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, Chip, IconButton, SettingSwitch } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { AmountField, DatePickerSheet, Field, FormSheet, PickerSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { toast } from '@/stores/ui.store';
import {
  createRecurring,
  createRecurringFromCandidate,
  deleteRecurring,
  detectRecurringCandidates,
  frequencyLabel,
  getSubscriptionSummary,
  getUpcoming,
  listRecurring,
  postNow,
  skipNext,
  updateRecurring,
  type RecurringCandidate,
} from '@/services/recurring.service';
import { dismissInboxItem, listInboxDismissals } from '@/services/dismissals.service';
import { isInboxDismissed } from '@/utils/inbox';
import { buildCategoryTree, listCategories } from '@/services/categories.service';
import { ACCOUNT_TYPE_LABELS, listAccounts } from '@/services/accounts.service';
import { formatDayMonth, monthKey, getPeriodRange, toISODate } from '@/utils/date';
import { getRecurringCalendar } from '@/services/recurring.service';
import type { RecurringFrequency, RecurringTransaction } from '@/db/schema';
import { formatPercent } from '@/utils/money';

/**
 * Recurring & subscriptions — upcoming payments, annualised subscription cost,
 * and a month-by-month calendar of what's coming.
 */
export default function RecurringScreen() {
  const theme = useTheme();
  const money = useMoney();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringTransaction | null>(null);
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState(0);
  const [type, setType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [interval, setIntervalValue] = useState(1);
  const [nextDate, setNextDate] = useState(new Date());
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [transferAccountId, setTransferAccountId] = useState<string | null>(null);
  const [autoPost, setAutoPost] = useState(true);
  const [isSubscription, setIsSubscription] = useState(false);
  const [picker, setPicker] = useState<'none' | 'category' | 'account' | 'transfer' | 'date'>('none');

  const query = useQuery(async () => {
    const [items, upcoming, subscriptions, accounts, categories] = await Promise.all([
      listRecurring(),
      getUpcoming(12),
      getSubscriptionSummary(),
      listAccounts(),
      listCategories(),
    ]);
    const month = getPeriodRange('thisMonth', {});
    const calendar = await getRecurringCalendar(month.start, month.end);
    const candidates = await detectRecurringCandidates();
    const dismissals = await listInboxDismissals();
    return { items, upcoming, subscriptions, accounts, categories, calendar, month, candidates, dismissals };
  }, []);

  const data = query.data;
  const dismissedHints = useSettingsStore((state) => state.hints.dismissed);
  // Suggestions dismissed before the inbox existed are stored as hints; new
  // dismissals live in the shared inbox_dismissals table so both screens agree.
  const visibleSuggestions = (data?.candidates ?? []).filter(
    (candidate) =>
      !dismissedHints.includes(`rec-suggest:${candidate.merchant.toLowerCase()}`) &&
      !isInboxDismissed(data?.dismissals ?? [], 'recurring_candidate', candidate.merchant.toLowerCase()),
  );

  const dismissCandidate = (merchant: string) => {
    void dismissInboxItem('recurring_candidate', merchant.toLowerCase());
  };

  const createFromCandidate = async (candidate: RecurringCandidate) => {
    await createRecurringFromCandidate(candidate);
    toast.success(`${candidate.merchant} added as a monthly schedule`);
  };

  const monthlyRecurring = useMemo(() => {
    if (!data) return 0;
    return data.items
      .filter((item) => item.type === 'expense')
      .reduce((sum, item) => {
        const multiplier =
          item.frequency === 'monthly' ? item.interval : item.frequency === 'yearly' ? item.interval / 12 : item.frequency === 'weekly' ? (item.interval * 52) / 12 : item.interval * 30;
        return sum + item.amount * multiplier;
      }, 0);
  }, [data]);

  const openEditor = (item: RecurringTransaction | null) => {
    setEditing(item);
    setMerchant(item?.merchant ?? '');
    setAmount(item?.amount ?? 0);
    setType(item?.type ?? 'expense');
    setFrequency(item?.frequency ?? 'monthly');
    setIntervalValue(item?.interval ?? 1);
    setNextDate(item?.nextDate ? new Date(item.nextDate) : new Date());
    setCategoryId(item?.categoryId ?? null);
    setAccountId(item?.accountId ?? null);
    setTransferAccountId(item?.transferAccountId ?? null);
    setAutoPost(item?.autoPost ?? true);
    setIsSubscription(item?.isSubscription ?? false);
    setEditorOpen(true);
  };

  const save = async () => {
    try {
      if (!merchant.trim()) throw new Error('Give it a name.');
      if (amount <= 0) throw new Error('Enter an amount.');
      if (!accountId) throw new Error('Choose an account.');
      if (type === 'transfer' && (!transferAccountId || transferAccountId === accountId)) {
        throw new Error('Choose a different destination account.');
      }
      const payload = {
        merchant: merchant.trim(),
        amount,
        type,
        frequency,
        interval,
        nextDate: toISODate(nextDate),
        categoryId: type === 'transfer' ? null : categoryId,
        accountId,
        transferAccountId: type === 'transfer' ? transferAccountId : null,
        autoPost,
        isSubscription,
      };
      if (editing) {
        await updateRecurring(editing.id, payload);
        toast.success('Updated');
      } else {
        await createRecurring(payload);
        toast.success('Recurring payment added');
      }
      setEditorOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save');
    }
  };

  const remove = async () => {
    if (!editing) return;
    const ok = await confirm({ title: `Delete ${editing.merchant}?`, message: 'Already-posted transactions stay in your ledger.', tone: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;
    await deleteRecurring(editing.id);
    setEditorOpen(false);
    toast.show('Recurring payment deleted');
  };

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Recurring"
        subtitle={
          data
            ? `${money.format(monthlyRecurring)}/month committed · ${money.format(data.subscriptions.annualTotal)}/year in subscriptions`
            : 'Bills, salary, SIPs and subscriptions'
        }
        hint={{ id: 'recurring', message: 'Schedules post themselves on their date, or wait for your confirmation. Overdue items stay marked “due now” until you confirm or skip them.' }}
        right={<IconButton icon="add" onPress={() => openEditor(null)} accessibilityLabel="Add recurring" />}
      />

      {query.loading && !data ? (
        <LoadingBlock label="Loading schedules…" />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Card>
            <AppText variant="label" tone="muted">
              UPCOMING
            </AppText>
            {data && data.upcoming.length > 0 ? (
              <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.md }}>
                {data.upcoming.slice(0, 6).map((entry) => (
                  <Row key={entry.recurring.id} justify="space-between">
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="bodySmall" numberOfLines={1}>
                        {entry.recurring.merchant}
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        {formatDayMonth(entry.nextDate)} · {frequencyLabel(entry.recurring.frequency, entry.recurring.interval)}
                        {entry.recurring.isSubscription ? ' · subscription' : ''}
                        {entry.overdue ? ' · due now' : ''}
                        {!entry.recurring.autoPost ? ' · confirm first' : ''}
                      </AppText>
                    </View>
                    <MoneyText
                      amount={entry.recurring.type === 'income' ? entry.recurring.amount : -entry.recurring.amount}
                      variant="numericCaption"
                      tone={entry.recurring.type === 'income' ? 'positive' : 'neutral'}
                    />
                  </Row>
                ))}
              </View>
            ) : (
              <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                Nothing scheduled yet.
              </AppText>
            )}
          </Card>

          {visibleSuggestions.length > 0 ? (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <Ionicons name="sparkles-outline" size={15} color={theme.colors.accent.base} />
                <AppText variant="label" tone="muted">
                  SUGGESTED
                </AppText>
              </View>
              <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                These look like monthly payments we've already seen. Create them so they post and remind automatically.
              </AppText>
              <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.md }}>
                {visibleSuggestions.map((candidate) => (
                  <Row key={candidate.merchant} justify="space-between" gap="sm">
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="bodySmall" numberOfLines={1}>
                        {candidate.merchant}
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        ≈ {money.format(candidate.amount)}/month · seen {candidate.count}×
                      </AppText>
                    </View>
                    <Row gap="xs">
                      <Button label="Create" size="sm" onPress={() => void createFromCandidate(candidate)} />
                      <Button label="Dismiss" size="sm" variant="secondary" onPress={() => dismissCandidate(candidate.merchant)} />
                    </Row>
                  </Row>
                ))}
              </View>
            </Card>
          ) : null}

          {data && data.subscriptions.activeCount > 0 ? (
            <Card>
              <Row justify="space-between">
                <View>
                  <AppText variant="label" tone="muted">
                    SUBSCRIPTIONS
                  </AppText>
                  <AppText variant="numericMedium" style={{ marginTop: 4 }}>
                    {money.format(data.subscriptions.monthlyTotal)}
                    <AppText variant="caption" tone="muted">
                      /mo
                    </AppText>
                  </AppText>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <AppText variant="caption" tone="muted">
                    Annualised
                  </AppText>
                  <AppText variant="numericSmall">{money.format(data.subscriptions.annualTotal)}</AppText>
                </View>
              </Row>
              <View style={{ marginTop: theme.spacing.md, gap: 8 }}>
                {data.subscriptions.items.slice(0, 5).map((item) => (
                  <Row key={item.recurring.id} justify="space-between">
                    <AppText variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1, marginRight: 8 }}>
                      {item.recurring.merchant}
                    </AppText>
                    <AppText variant="numericCaption" tone="muted">
                      {money.format(item.monthlyAmount)}/mo · {money.format(item.annualAmount)}/yr
                    </AppText>
                  </Row>
                ))}
              </View>
            </Card>
          ) : null}

          {data && data.calendar.length > 0 ? (
            <Card>
              <AppText variant="label" tone="muted">
                THIS MONTH
              </AppText>
              <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
                {data.calendar.map((entry, index) => (
                  <Row key={`${entry.recurring.id}-${entry.date}-${index}`} gap="md">
                    <AppText variant="numericCaption" tone="muted" style={{ width: 34 }}>
                      {new Date(entry.date).getDate().toString().padStart(2, '0')}
                    </AppText>
                    <AppText variant="bodySmall" style={{ flex: 1 }} numberOfLines={1}>
                      {entry.recurring.merchant}
                    </AppText>
                    <MoneyText amount={entry.amount} variant="numericCaption" tone="neutral" />
                  </Row>
                ))}
              </View>
            </Card>
          ) : null}

          <ListGroup title="All schedules">
            {(data?.items ?? []).map((item) => (
              <ListRow
                key={item.id}
                title={item.merchant}
                subtitle={`${frequencyLabel(item.frequency, item.interval)} · next ${formatDayMonth(new Date(item.nextDate))}${
                  item.isPaused ? ' · paused' : ''
                }${item.isSubscription ? ' · subscription' : ''}`}
                icon={item.isSubscription ? 'repeat-outline' : item.type === 'income' ? 'arrow-down-circle-outline' : 'calendar-outline'}
                iconColor={item.type === 'income' ? theme.colors.positive : theme.colors.accent.base}
                value={
                  <MoneyText
                    amount={item.type === 'income' ? item.amount : -item.amount}
                    variant="numericCaption"
                    tone={item.type === 'income' ? 'positive' : 'neutral'}
                  />
                }
                onPress={() => openEditor(item)}
                right={
                  <Row gap="xs">
                    <IconButton
                      icon="checkmark-circle-outline"
                      size={30}
                      onPress={async () => {
                        await postNow(item.id);
                        toast.success('Posted now');
                      }}
                      accessibilityLabel="Post now"
                    />
                    <IconButton
                      icon="play-skip-forward-outline"
                      size={30}
                      onPress={async () => {
                        await skipNext(item.id);
                        toast.show('Skipped this occurrence');
                      }}
                      accessibilityLabel="Skip"
                    />
                  </Row>
                }
              />
            ))}
            {(data?.items.length ?? 0) === 0 ? (
              <View style={{ padding: theme.spacing.lg }}>
                <EmptyState
                  compact
                  icon="repeat-outline"
                  title="No recurring payments"
                  message="Add rent, subscriptions or salary so Wallnut can forecast and remind you."
                  actionLabel="Add recurring"
                  onAction={() => openEditor(null)}
                />
              </View>
            ) : null}
          </ListGroup>

          <InfoBanner message="Recurring items post automatically on their date (or wait for your confirmation if you turn auto-post off). Posting is idempotent — reopening the app never double-posts." />
        </View>
      )}

      <FormSheet
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? 'Edit recurring payment' : 'New recurring payment'}
        submitLabel={editing ? 'Save' : 'Add'}
        onSubmit={save}
        destructive={Boolean(editing)}
        onDelete={editing ? remove : undefined}>
        <AmountField label="Amount" valueMinor={amount} onChangeMinor={setAmount} currencySymbol={money.currency === 'INR' ? '₹' : money.currency} />
        <Row gap="sm">
          <Chip label="Expense" selected={type === 'expense'} onPress={() => setType('expense')} />
          <Chip label="Income" selected={type === 'income'} onPress={() => setType('income')} />
          <Chip label="Transfer" selected={type === 'transfer'} onPress={() => setType('transfer')} />
        </Row>
        <Row gap="sm" wrap>
          <Chip label="Monthly" selected={frequency === 'monthly'} onPress={() => setFrequency('monthly')} />
          <Chip label="Weekly" selected={frequency === 'weekly'} onPress={() => setFrequency('weekly')} />
          <Chip label="Yearly" selected={frequency === 'yearly'} onPress={() => setFrequency('yearly')} />
          <Chip label="Daily" selected={frequency === 'daily'} onPress={() => setFrequency('daily')} />
          <Chip label="Custom days" selected={frequency === 'custom'} onPress={() => setFrequency('custom')} />
        </Row>
        {frequency === 'custom' ? (
          <Field label="Every N days" value={String(interval)} onChangeText={(value) => setIntervalValue(Number(value) || 1)} keyboardType="numeric" />
        ) : null}
        <Row gap="sm" wrap>
          <Chip label={editing ? 'Name: tap to edit' : 'Name'} selected={false} onPress={() => undefined} />
        </Row>
        <Field label="Name" value={merchant} onChangeText={setMerchant} placeholder="e.g. Netflix" />
        <Row gap="sm" wrap>
          <Chip label={data?.accounts.find((account) => account.id === accountId)?.name ?? 'Choose account'} selected={Boolean(accountId)} onPress={() => setPicker('account')} />
          {type === 'transfer' ? (
            <Chip
              label={data?.accounts.find((account) => account.id === transferAccountId)?.name ?? 'To account'}
              selected={Boolean(transferAccountId)}
              onPress={() => setPicker('transfer')}
            />
          ) : (
            <Chip
              label={data?.categories.find((category) => category.id === categoryId)?.name ?? 'Category'}
              selected={Boolean(categoryId)}
              onPress={() => setPicker('category')}
            />
          )}
          <Chip label={`Next ${toISODate(nextDate)}`} onPress={() => setPicker('date')} />
        </Row>
        <View style={{ borderRadius: theme.radius.md, backgroundColor: theme.colors.inputBackground, overflow: 'hidden' }}>
          <SettingSwitch title="Post automatically" subtitle="Otherwise it waits for confirmation" value={autoPost} onValueChange={setAutoPost} />
          <SettingSwitch title="This is a subscription" subtitle="Tracks its annualised cost" value={isSubscription} onValueChange={setIsSubscription} />
        </View>
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
        visible={picker === 'transfer'}
        onClose={() => setPicker('none')}
        title="Destination account"
        items={(data?.accounts ?? [])
          .filter((account) => account.id !== accountId)
          .map((account) => ({ id: account.id, label: account.name, icon: 'wallet-outline' as IconName }))}
        onSelect={(item) => {
          setTransferAccountId(item.id);
          setPicker('none');
        }}
      />
      <PickerSheet
        visible={picker === 'category'}
        onClose={() => setPicker('none')}
        title="Category"
        items={buildCategoryTree(data?.categories ?? []).flatMap((parent) => [
          { id: parent.id, label: parent.name, icon: parent.icon as IconName, color: parent.color },
          ...parent.children.map((child) => ({
            id: child.id,
            label: child.name,
            icon: child.icon as IconName,
            color: child.color,
            section: parent.name,
          })),
        ])}
        onSelect={(item) => {
          setCategoryId(item.id);
          setPicker('none');
        }}
      />
      <DatePickerSheet
        visible={picker === 'date'}
        onClose={() => setPicker('none')}
        value={nextDate}
        onSelect={setNextDate}
        title="Next occurrence"
      />
    </ScrollScreen>
  );
}
