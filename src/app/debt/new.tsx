import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, Chip } from '@/components/ui/controls';
import { InfoBanner } from '@/components/ui/feedback';
import { AmountField, DatePickerSheet, Field, PickerSheet } from '@/components/ui/sheets';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import { createDebt, listPeople } from '@/services/debts.service';
import { listAccounts } from '@/services/accounts.service';
import { fromISODate, toISODate } from '@/utils/date';

/** Record money lent or borrowed (creates the cash movement too). */
export default function NewDebtScreen() {
  const theme = useTheme();
  const money = useMoney();
  const params = useLocalSearchParams<{
    direction?: string;
    amount?: string;
    person?: string;
    date?: string;
    accountId?: string;
    description?: string;
  }>();
  const [direction, setDirection] = useState<'lent' | 'borrowed'>(params.direction === 'borrowed' ? 'borrowed' : 'lent');
  const [personName, setPersonName] = useState(() => params.person ?? '');
  const [amount, setAmount] = useState(() => {
    const major = Number(params.amount ?? '');
    return Number.isFinite(major) && major > 0 ? Math.round(major * 100) : 0;
  });
  const [date, setDate] = useState(() => fromISODate(params.date ?? '') ?? new Date());
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [accountId, setAccountId] = useState<string | null>(params.accountId ?? null);
  const [description, setDescription] = useState(() => params.description ?? '');
  const [datePicker, setDatePicker] = useState<'none' | 'date' | 'due'>('none');
  const [accountPicker, setAccountPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  const accounts = useQuery(() => listAccounts(), []);
  const people = useQuery(() => listPeople(), []);

  const save = async () => {
    setBusy(true);
    try {
      if (!personName.trim()) throw new Error('Who is this with?');
      if (amount <= 0) throw new Error('Enter an amount.');
      await createDebt({
        personName: personName.trim(),
        direction,
        amount,
        date: toISODate(date),
        dueDate: dueDate ? toISODate(dueDate) : null,
        accountId,
        description: description.trim() || null,
      });
      toast.success(direction === 'lent' ? 'Money lent recorded' : 'Borrowing recorded');
      router.back();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollScreen>
      <ScreenHeader title={direction === 'lent' ? 'I lent money' : 'I borrowed money'} subtitle="Tracked outside income and spending" />

      <View style={{ gap: theme.spacing.lg }}>
        <Row gap="sm">
          <Chip label="I lent" selected={direction === 'lent'} onPress={() => setDirection('lent')} />
          <Chip label="I borrowed" selected={direction === 'borrowed'} onPress={() => setDirection('borrowed')} />
        </Row>

        <AmountField
          label="Amount"
          valueMinor={amount}
          onChangeMinor={setAmount}
          currencySymbol={money.currency === 'INR' ? '₹' : money.currency}
        />

        <Field label="Person" value={personName} onChangeText={setPersonName} placeholder="e.g. Rahul" />
        {people.data && people.data.length > 0 ? (
          <Row gap="sm" wrap>
            {people.data.slice(0, 6).map((person) => (
              <Chip key={person.id} label={person.name} onPress={() => setPersonName(person.name)} />
            ))}
          </Row>
        ) : null}

        <Field label="What for? (optional)" value={description} onChangeText={setDescription} placeholder="e.g. Trip deposit" />

        <Row gap="sm" wrap>
          <Chip label={`Date ${toISODate(date)}`} onPress={() => setDatePicker('date')} />
          <Chip label={dueDate ? `Due ${toISODate(dueDate)}` : 'Add due date'} selected={Boolean(dueDate)} onPress={() => setDatePicker('due')} />
          {dueDate ? <Chip label="Clear due date" onPress={() => setDueDate(null)} /> : null}
        </Row>

        <Pressable onPress={() => setAccountPicker(true)} android_ripple={{ color: theme.colors.ripple }}>
          <Card>
            <Row justify="space-between">
              <View style={{ flex: 1 }}>
                <AppText variant="bodySmall">
                  {direction === 'lent' ? 'Money leaves from' : 'Money arrives into'}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {accountId ? accounts.data?.find((account) => account.id === accountId)?.name : 'No account — track only'}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
            </Row>
          </Card>
        </Pressable>

        <InfoBanner
          message={
            direction === 'lent'
              ? 'Recording this moves the money out of the chosen account and creates a receivable. It is never counted as spending.'
              : 'Recording this adds money to the chosen account and creates a liability. It is never counted as income.'
          }
        />

        <Button
          label={direction === 'lent' ? 'Record lending' : 'Record borrowing'}
          size="lg"
          fullWidth
          loading={busy}
          onPress={save}
        />
      </View>

      <DatePickerSheet
        visible={datePicker !== 'none'}
        onClose={() => setDatePicker('none')}
        value={datePicker === 'due' ? dueDate ?? new Date() : date}
        onSelect={(value) => (datePicker === 'due' ? setDueDate(value) : setDate(value))}
        title={datePicker === 'due' ? 'Due date' : 'Date'}
      />
      <PickerSheet
        visible={accountPicker}
        onClose={() => setAccountPicker(false)}
        title="Choose account"
        items={[
          { id: '__none__', label: 'No account (track only)', icon: 'remove-circle-outline' as IconName },
          ...(accounts.data ?? []).map((account) => ({
            id: account.id,
            label: account.name,
            subtitle: money.format(account.currentBalance),
            icon: 'wallet-outline' as IconName,
          })),
        ]}
        selectedId={accountId ?? '__none__'}
        onSelect={(item) => {
          setAccountId(item.id === '__none__' ? null : item.id);
          setAccountPicker(false);
        }}
      />
    </ScrollScreen>
  );
}
