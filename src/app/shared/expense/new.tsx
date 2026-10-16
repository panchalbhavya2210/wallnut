import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/theme';
import type { IconName } from '@/components/ui/layout';
import { Row } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, IconButton, SegmentedControl } from '@/components/ui/controls';
import { AmountField, DatePickerSheet, Field, FormSheet, PickerSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { toast } from '@/stores/ui.store';
import { listSelectableAccounts } from '@/services/accounts.service';
import { listCategories } from '@/services/categories.service';
import { createPerson, listPeople } from '@/services/debts.service';
import {
  createSharedExpense,
  createSharedGroup,
  deleteSharedExpense,
  getSharedExpense,
  listGroupMembers,
  listSharedGroups,
  updateSharedExpense,
} from '@/services/shared.service';
import { fromISODate, toISODate } from '@/utils/date';
import { createId } from '@/utils/id';
import { computeSplit, planSharedLedger, type SharedSplitType } from '@/utils/split';

/**
 * Shared expense composer.
 *
 * A trip is paid for by several people at different times, so "Paid by" is a
 * list: tapping more than one person splits the bill between them (adjust the
 * amounts), and tapping down to one person means they covered it all. The
 * preview always shows the accounting outcome: your share, what you paid, and
 * what is owed — never the full bill as personal spending.
 */

const SELF = 'self';

export default function SharedExpenseComposer() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const money = useMoney();
  const params = useLocalSearchParams<{ id?: string; groupId?: string; amount?: string }>();
  const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const editingId = param(params.id);
  const settings = useSettingsStore((state) => state);

  /** Dynamic line items — "Train travel", "Hotel stay", … at least one. */
  const [items, setItems] = useState<{ key: string; name: string; amount: number }[]>(() => {
    const prefill = Number((param(params.amount) ?? '').replace(/,/g, ''));
    return [{ key: createId('itm'), name: '', amount: Number.isFinite(prefill) ? Math.round(prefill * 100) : 0 }];
  });
  /** Payers, in tap order: 'self' or a person id. First tap = they paid it all. */
  const [payerIds, setPayerIds] = useState<string[]>([SELF]);
  /** Only used when there is more than one payer. */
  const [payerAmounts, setPayerAmounts] = useState<Record<string, number>>({});
  const [selfIncluded, setSelfIncluded] = useState(true);
  const [selectedPersonIds, setSelectedPersonIds] = useState<string[]>([]);
  const [splitType, setSplitType] = useState<SharedSplitType>('equal');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(settings.finance.defaultAccountId);
  const [date, setDate] = useState(() => new Date());
  const [groupId, setGroupId] = useState<string | null>(param(params.groupId) ?? null);
  const [notes, setNotes] = useState('');
  const [sheet, setSheet] = useState<'none' | 'category' | 'account' | 'date' | 'group'>('none');
  const [newPersonOpen, setNewPersonOpen] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [loaded, setLoaded] = useState(!editingId);
  const [saving, setSaving] = useState(false);

  const peopleQuery = useQuery(() => listPeople(), []);
  const groupsQuery = useQuery(() => listSharedGroups(), []);
  const categoriesQuery = useQuery(() => listCategories(), []);
  const accountsQuery = useQuery(() => listSelectableAccounts(), []);

  /* ------------------------------ Load for edit ----------------------------- */
  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    void (async () => {
      const detail = await getSharedExpense(editingId);
      if (cancelled || !detail) return;
      setItems(
        detail.items.length > 0
          ? detail.items.map((item) => ({ key: createId('itm'), name: item.name, amount: item.amount }))
          : [{ key: createId('itm'), name: detail.expense.title, amount: detail.expense.amount }],
      );
      setPayerIds(detail.payers.map((payer) => payer.personId ?? SELF));
      setPayerAmounts(
        Object.fromEntries(detail.payers.map((payer) => [payer.personId ?? SELF, payer.amount])),
      );
      setSelfIncluded(detail.participants.some((participant) => participant.personId === null));
      setSplitType(detail.expense.splitType);
      setCategoryId(detail.expense.categoryId);
      setAccountId(detail.expense.accountId);
      setDate(fromISODate(detail.expense.date) ?? new Date());
      setGroupId(detail.expense.groupId);
      setNotes(detail.expense.notes ?? '');
      setSelectedPersonIds(
        detail.participants.filter((participant) => participant.personId).map((participant) => participant.personId!),
      );
      const nextInputs: Record<string, string> = {};
      if (detail.expense.splitType !== 'equal') {
        for (const participant of detail.participants) {
          if (participant.inputValue === null) continue;
          const key = participant.personId ?? SELF;
          nextInputs[key] =
            detail.expense.splitType === 'shares'
              ? String(participant.inputValue)
              : (participant.inputValue / 100).toString();
        }
      }
      setInputs(nextInputs);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [editingId]);

  /* --------------------------- Group members prefill ------------------------ */
  useEffect(() => {
    if (editingId) return;
    const preset = param(params.groupId);
    if (!preset) return;
    let cancelled = false;
    void (async () => {
      const members = await listGroupMembers(preset);
      if (cancelled) return;
      setSelectedPersonIds((current) => Array.from(new Set([...current, ...members.map((member) => member.personId)])));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  /* ------------------------------ Derived state ----------------------------- */
  const participantKeys = useMemo(
    () => [...(selfIncluded ? [SELF] : []), ...selectedPersonIds],
    [selfIncluded, selectedPersonIds],
  );

  const totalMinor = useMemo(
    () => items.reduce((sum, item) => sum + Math.max(0, item.amount), 0),
    [items],
  );

  const addItem = () => {
    setItems((current) => [...current, { key: createId('itm'), name: '', amount: 0 }]);
  };

  const removeItem = (key: string) => {
    setItems((current) => (current.length <= 1 ? current : current.filter((item) => item.key !== key)));
  };

  const updateItem = (key: string, patch: Partial<{ name: string; amount: number }>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const nameFor = (key: string): string => {
    if (key === SELF) return 'You';
    return peopleQuery.data?.find((person) => person.id === key)?.name ?? 'Person';
  };

  const parseValue = (key: string): number | null => {
    const raw = inputs[key];
    if (raw === undefined || raw.trim() === '') return null;
    const num = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(num)) return null;
    if (splitType === 'exact') return Math.round(num * 100);
    if (splitType === 'percentage') return Math.round(num * 100);
    if (splitType === 'shares') return Math.round(num);
    return null;
  };

  const split = useMemo(() => {
    try {
      const shares = computeSplit(
        totalMinor,
        splitType,
        participantKeys.map((key) => {
          const raw = inputs[key];
          let value: number | null = null;
          if (raw !== undefined && raw.trim() !== '') {
            const num = Number(raw.replace(/,/g, ''));
            if (Number.isFinite(num)) {
              if (splitType === 'exact') value = Math.round(num * 100);
              else if (splitType === 'percentage') value = Math.round(num * 100);
              else if (splitType === 'shares') value = Math.round(num);
            }
          }
          return { key, value };
        }),
      );
      return { shares, error: null as string | null };
    } catch (error) {
      return { shares: null, error: error instanceof Error ? error.message : 'Cannot split this expense.' };
    }
  }, [totalMinor, splitType, participantKeys, inputs]);

  const effectivePayers = useMemo(() => {
    if (payerIds.length === 0) return [];
    if (payerIds.length === 1) {
      const key = payerIds[0]!;
      return [{ key, personId: key === SELF ? null : key, amount: totalMinor }];
    }
    return payerIds.map((key) => ({
      key,
      personId: key === SELF ? null : key,
      amount: payerAmounts[key] ?? 0,
    }));
  }, [payerIds, payerAmounts, totalMinor]);

  const payerTotal = effectivePayers.reduce((sum, payer) => sum + payer.amount, 0);
  const payerRemaining = totalMinor - payerTotal;
  const selfPaid = effectivePayers
    .filter((payer) => payer.personId === null)
    .reduce((sum, payer) => sum + payer.amount, 0);
  const selfShare = split.shares?.find((share) => share.key === SELF)?.amount ?? 0;
  const plan = planSharedLedger({ selfPaid, selfShare });
  const multiPayer = payerIds.length > 1;

  const selectedCategory = categoriesQuery.data?.find((entry) => entry.id === categoryId) ?? null;
  // The default account can arrive after the first render; resolve it here
  // instead of writing state from an effect.
  const effectiveAccountId = accountId ?? settings.finance.defaultAccountId ?? accountsQuery.data?.[0]?.id ?? null;
  const selectedAccount = accountsQuery.data?.find((entry) => entry.id === effectiveAccountId) ?? null;
  const selectedGroup = groupsQuery.data?.find((entry) => entry.id === groupId) ?? null;

  const categoryItems = useMemo(() => {
    const list = categoriesQuery.data ?? [];
    const filtered = list.filter((category) => !category.parentId && category.type === 'expense');
    const byParent = new Map<string, typeof list>();
    for (const category of list) {
      if (!category.parentId) continue;
      const bucket = byParent.get(category.parentId) ?? [];
      bucket.push(category);
      byParent.set(category.parentId, bucket);
    }
    return filtered.flatMap((parent) => [
      { id: parent.id, label: parent.name, icon: parent.icon as IconName, color: parent.color, section: 'Categories' },
      ...(byParent.get(parent.id) ?? []).map((child) => ({
        id: child.id,
        label: child.name,
        icon: child.icon as IconName,
        color: child.color,
        section: parent.name,
      })),
    ]);
  }, [categoriesQuery.data]);

  /** Pre-fills sensible values when the split type changes. */
  const applySplitType = (next: SharedSplitType) => {
    setSplitType(next);
    if (next === 'equal') return;
    if (next === 'shares') {
      setInputs(Object.fromEntries(participantKeys.map((key) => [key, '1'])));
      return;
    }
    if (next === 'exact') {
      try {
        const shares = computeSplit(totalMinor, 'equal', participantKeys.map((key) => ({ key })));
        setInputs(Object.fromEntries(shares.map((share) => [share.key, (share.amount / 100).toString()])));
      } catch {
        setInputs({});
      }
      return;
    }
    const count = participantKeys.length;
    const base = Math.floor(10_000 / count);
    setInputs(
      Object.fromEntries(
        participantKeys.map((key, index) => [key, String((index === 0 ? 10_000 - base * (count - 1) : base) / 100)]),
      ),
    );
  };

  const addParticipant = (key: string) => {
    if (key === SELF) {
      setSelfIncluded(true);
      return;
    }
    setSelectedPersonIds((current) => (current.includes(key) ? current : [...current, key]));
    if (splitType === 'shares') setInputs((current) => ({ ...current, [key]: '1' }));
    else if (splitType !== 'equal') setInputs((current) => ({ ...current, [key]: current[key] ?? '0' }));
  };

  const removeParticipant = (key: string) => {
    if (key === SELF) {
      setSelfIncluded(false);
      setInputs((current) => {
        const next = { ...current };
        delete next[SELF];
        return next;
      });
      return;
    }
    setSelectedPersonIds((current) => current.filter((id) => id !== key));
    setInputs((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  /** Adding a payer splits the bill evenly across everyone who has paid so far. */
  const addPayer = (key: string) => {
    if (payerIds.includes(key)) return;
    const nextIds = [...payerIds, key];
    const count = nextIds.length;
    const base = Math.floor(totalMinor / count);
    const amounts: Record<string, number> = {};
    nextIds.forEach((id, index) => {
      amounts[id] = index === 0 ? totalMinor - base * (count - 1) : base;
    });
    setPayerAmounts(amounts);
    setPayerIds(nextIds);
    if (key !== SELF) addParticipant(key);
  };

  const removePayer = (key: string) => {
    setPayerIds((current) => (current.length <= 1 ? current : current.filter((id) => id !== key)));
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (items.some((item) => !item.name.trim())) throw new Error('Give every item a name.');
      if (items.some((item) => item.amount <= 0)) throw new Error('Every item needs an amount.');
      if (payerIds.length > 1 && payerTotal !== totalMinor) {
        throw new Error('What each person paid must add up to the full bill.');
      }
      if (selectedPersonIds.length === 0 && selfIncluded) {
        throw new Error('Add at least one other person to share this expense.');
      }
      if (!selfIncluded && !payerIds.includes(SELF) && participantKeys.length === 0) {
        throw new Error('Add the people who shared this expense.');
      }
      if (split.error || !split.shares) throw new Error(split.error ?? 'The split is not valid.');
      if (selfPaid > 0 && !effectiveAccountId) throw new Error('Choose the account you paid from.');

      const payload = {
        items: items.map((item) => ({ name: item.name, amount: item.amount })),
        date: toISODate(date),
        categoryId,
        accountId: selfPaid > 0 ? effectiveAccountId : null,
        groupId,
        notes: notes || null,
        splitType,
        payers: effectivePayers.map((payer) => ({
          personId: payer.personId,
          amount: payerIds.length > 1 ? payer.amount : null,
        })),
        participants: participantKeys.map((key) => ({
          personId: key === SELF ? null : key,
          value: parseValue(key),
        })),
      };

      if (editingId) {
        await updateSharedExpense(editingId, payload);
        toast.success('Shared expense updated');
      } else {
        await createSharedExpense(payload);
        toast.success('Shared expense added');
      }
      router.back();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the shared expense');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editingId) return;
    const ok = await confirm({ title: 'Delete this shared expense?', message: 'Its cash entries are removed too. Balances update everywhere.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    await deleteSharedExpense(editingId);
    toast.show('Shared expense deleted');
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm }}>
        <IconButton icon="close" onPress={() => router.back()} accessibilityLabel="Close" />
        <AppText variant="titleSmall">{editingId ? 'Edit shared expense' : 'Shared expense'}</AppText>
        {editingId ? (
          <IconButton icon="trash-outline" onPress={remove} color={theme.colors.negative} accessibilityLabel="Delete" />
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {/* Dynamic line items — one batch like "Train travel + Hotel stay". */}
        <View style={{ paddingTop: theme.spacing.md, gap: theme.spacing.sm }}>
          <Row justify="space-between">
            <AppText variant="label" tone="muted">
              EXPENSES
            </AppText>
            <AppText variant="caption" tone="muted">
              {items.length} item{items.length === 1 ? '' : 's'}
            </AppText>
          </Row>

          {items.map((item, index) => (
            <View key={item.key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Field
                  value={item.name}
                  onChangeText={(text) => updateItem(item.key, { name: text })}
                  placeholder={index === 0 ? 'e.g. Train travel' : 'e.g. Hotel stay'}
                />
              </View>
              <View style={{ width: 142 }}>
                <AmountField
                  valueMinor={item.amount}
                  onChangeMinor={(amount) => updateItem(item.key, { amount })}
                  currencySymbol={money.currency === 'INR' ? '₹' : money.currency}
                />
              </View>
              <IconButton
                icon="close-circle-outline"
                size={30}
                color={items.length <= 1 ? theme.colors.border : theme.colors.muted}
                disabled={items.length <= 1}
                accessibilityLabel={item.name.trim() ? `Remove ${item.name.trim()}` : `Remove item ${index + 1}`}
                onPress={() => removeItem(item.key)}
              />
            </View>
          ))}

          <Row justify="space-between" style={{ marginTop: theme.spacing.xs }}>
            <Button label="Add another expense" size="sm" variant="secondary" icon="add" onPress={addItem} />
            <View style={{ alignItems: 'flex-end' }}>
              <AppText variant="caption" tone="muted">
                TOTAL
              </AppText>
              <MoneyText amount={totalMinor} variant="numericMedium" showSign={false} />
            </View>
          </Row>
        </View>

        <View
          style={{
            marginTop: theme.spacing.lg,
            borderRadius: theme.radius.lg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            overflow: 'hidden',
          }}>
          <RowField
            icon="people-outline"
            label="Group"
            value={selectedGroup?.name ?? 'No group'}
            muted={!selectedGroup}
            onPress={() => setSheet('group')}
          />
          <RowField
            icon={(selectedCategory?.icon as IconName) ?? 'pricetag-outline'}
            iconColor={selectedCategory?.color}
            label="Category"
            value={selectedCategory?.name ?? 'Uncategorised'}
            onPress={() => setSheet('category')}
          />
          {selfPaid > 0 ? (
            <RowField
              icon="wallet-outline"
              iconColor={selectedAccount?.color ?? undefined}
              label="Account"
              value={selectedAccount?.name ?? 'Choose account'}
              onPress={() => setSheet('account')}
            />
          ) : null}
          <RowField icon="calendar-outline" label="Date" value={formatDateLabel(date)} onPress={() => setSheet('date')} last />
        </View>

        {/* Paid by — a list where rows toggle multiple payers */}
        <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.sm }}>
          <Row justify="space-between">
            <AppText variant="label" tone="muted">
              PAID BY
            </AppText>
            <AppText variant="caption" tone="muted">
              {payerIds.length === 1 ? 'tap more to split the payment' : `${payerIds.length} payers`}
            </AppText>
          </Row>
          <View
            style={{
              borderRadius: theme.radius.lg,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              overflow: 'hidden',
            }}>
            <PersonRow
              label="You"
              selected={payerIds.includes(SELF)}
              accessibilityLabel="Payer You"
              onPress={() => (payerIds.includes(SELF) ? removePayer(SELF) : addPayer(SELF))}
            />
            {(peopleQuery.data ?? []).map((person) => (
              <PersonRow
                key={person.id}
                label={person.name}
                selected={payerIds.includes(person.id)}
                accessibilityLabel={`Payer ${person.name}`}
                onPress={() => (payerIds.includes(person.id) ? removePayer(person.id) : addPayer(person.id))}
              />
            ))}
            <AddPersonRow
              accessibilityLabel="Add person as payer"
              onPress={() => {
                setNewPersonName('');
                setNewPersonOpen(true);
              }}
            />
          </View>

          {multiPayer ? (
            <View
              style={{
                marginTop: theme.spacing.sm,
                borderRadius: theme.radius.lg,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
                padding: theme.spacing.lg,
                gap: theme.spacing.md,
              }}>
              {effectivePayers.map((payer) => (
                <Row key={payer.key} gap="md">
                  <AppText variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>
                    {nameFor(payer.key)}
                  </AppText>
                  <View style={{ width: 150 }}>
                    <AmountField
                      valueMinor={payer.amount}
                      onChangeMinor={(value) => setPayerAmounts((current) => ({ ...current, [payer.key]: value }))}
                      currencySymbol={money.currency === 'INR' ? '₹' : money.currency}
                    />
                  </View>
                </Row>
              ))}
              <AppText variant="caption" tone={payerRemaining === 0 ? 'positive' : 'negative'}>
                {payerRemaining === 0
                  ? `Payments add up to ${money.format(totalMinor)}.`
                  : payerRemaining > 0
                    ? `${money.format(payerRemaining)} of the bill is still unassigned.`
                    : `Payments exceed the bill by ${money.format(Math.abs(payerRemaining))}.`}
              </AppText>
            </View>
          ) : (
            <AppText variant="caption" tone="muted">
              {nameFor(payerIds[0] ?? SELF)} covered the full bill.
            </AppText>
          )}
        </View>

        {/* Split between — a list with every person's share */}
        <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.sm }}>
          <AppText variant="label" tone="muted">
            SPLIT BETWEEN
          </AppText>
          <View
            style={{
              borderRadius: theme.radius.lg,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              overflow: 'hidden',
            }}>
            <PersonRow
              label="You"
              selected={selfIncluded}
              accessibilityLabel="Split You"
              right={selfIncluded && split.shares ? <MoneyText amount={selfShare} variant="numericSmall" showSign={false} /> : undefined}
              onPress={() => (selfIncluded ? removeParticipant(SELF) : addParticipant(SELF))}
            />
            {(peopleQuery.data ?? []).map((person) => {
              const selected = selectedPersonIds.includes(person.id);
              const computed = split.shares?.find((share) => share.key === person.id)?.amount ?? 0;
              return (
                <PersonRow
                  key={person.id}
                  label={person.name}
                  selected={selected}
                  accessibilityLabel={`Split ${person.name}`}
                  right={selected && split.shares ? <MoneyText amount={computed} variant="numericSmall" showSign={false} /> : undefined}
                  onPress={() => (selected ? removeParticipant(person.id) : addParticipant(person.id))}
                />
              );
            })}
            <AddPersonRow
              accessibilityLabel="Add person to split"
              onPress={() => {
                setNewPersonName('');
                setNewPersonOpen(true);
              }}
            />
          </View>
          {!selfIncluded ? (
            <AppText variant="caption" tone="muted">
              You are not part of this expense — it will only affect the group balances.
            </AppText>
          ) : null}
        </View>

        {/* Split type */}
        {participantKeys.length > 0 ? (
          <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.sm }}>
            <SegmentedControl
              options={[
                { value: 'equal', label: 'Equal' },
                { value: 'exact', label: 'Exact' },
                { value: 'percentage', label: '%' },
                { value: 'shares', label: 'Shares' },
              ]}
              value={splitType}
              onChange={applySplitType}
            />

            <View
              style={{
                marginTop: theme.spacing.sm,
                borderRadius: theme.radius.lg,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
                padding: theme.spacing.lg,
                gap: theme.spacing.md,
              }}>
              {participantKeys.map((key) => {
                const computed = split.shares?.find((share) => share.key === key)?.amount ?? 0;
                return (
                  <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                    <AppText variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>
                      {nameFor(key)}
                    </AppText>
                    {splitType === 'equal' ? (
                      <AppText variant="numericSmall" tone="secondary">
                        {money.format(computed)}
                      </AppText>
                    ) : (
                      <View style={{ width: 140 }}>
                        <Field
                          value={inputs[key] ?? ''}
                          onChangeText={(text) => setInputs((current) => ({ ...current, [key]: text }))}
                          keyboardType="decimal-pad"
                          placeholder={splitType === 'shares' ? '1' : '0'}
                          money={splitType === 'exact'}
                          prefix={splitType === 'exact' ? (money.currency === 'INR' ? '₹' : money.currency) : undefined}
                          suffix={splitType === 'percentage' ? '%' : splitType === 'shares' ? 'shares' : undefined}
                        />
                      </View>
                    )}
                    {splitType !== 'equal' && split.shares ? (
                      <AppText variant="caption" tone="muted" style={{ width: 72, textAlign: 'right' }}>
                        {money.format(computed)}
                      </AppText>
                    ) : null}
                  </View>
                );
              })}
              {split.error ? (
                <AppText variant="caption" tone="negative">
                  {split.error}
                </AppText>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Accounting preview */}
        {split.shares && participantKeys.length > 0 ? (
          <View
            style={{
              marginTop: theme.spacing.lg,
              padding: theme.spacing.lg,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.accent.soft,
              gap: theme.spacing.sm,
            }}>
            <AppText variant="label" tone="accent">
              WHAT THIS MEANS
            </AppText>
            {selfIncluded ? <PreviewRow label="Your share" amount={selfShare} /> : null}
            <PreviewRow label="You paid" amount={selfPaid} />
            {plan.receivableAmount > 0 ? <PreviewRow label="You are owed" amount={plan.receivableAmount} tone="positive" /> : null}
            {plan.payableAmount > 0 ? <PreviewRow label="You owe" amount={plan.payableAmount} tone="negative" /> : null}
            {!selfIncluded && selfPaid === 0 ? (
              <AppText variant="caption" tone="muted">
                This bill is between other people — your money is not involved.
              </AppText>
            ) : (
              <AppText variant="caption" tone="muted">
                Only your share counts as spending. The rest is tracked as money owed.
              </AppText>
            )}
          </View>
        ) : null}

        <View style={{ marginTop: theme.spacing.lg }}>
          <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" multiline />
        </View>

        {!loaded ? <AppText variant="caption" tone="muted">Loading…</AppText> : null}
      </ScrollView>

      <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: Math.max(insets.bottom, theme.spacing.md) }}>
        <Button
          label={editingId ? 'Save changes' : 'Add shared expense'}
          size="lg"
          fullWidth
          loading={saving}
          disabled={!loaded || totalMinor <= 0 || payerIds.length === 0 || Boolean(split.error) || (multiPayer && payerRemaining !== 0)}
          onPress={save}
        />
      </View>

      {/* Sheets */}
      <PickerSheet
        visible={sheet === 'group'}
        onClose={() => setSheet('none')}
        title="Group"
        items={[
          { id: '__none__', label: 'No group', icon: 'close-circle-outline' as IconName },
          ...(groupsQuery.data ?? []).map((group) => ({
            id: group.id,
            label: group.name,
            icon: group.icon as IconName,
            color: group.color,
          })),
        ]}
        selectedId={groupId ?? '__none__'}
        onSelect={(item) => {
          setGroupId(item.id === '__none__' ? null : item.id);
          setSheet('none');
        }}
        createLabel="New group"
        onCreate={() => {
          setSheet('none');
          setNewGroupName('');
          setNewGroupOpen(true);
        }}
      />
      <PickerSheet
        visible={sheet === 'category'}
        onClose={() => setSheet('none')}
        title="Category"
        items={categoryItems}
        selectedId={categoryId}
        onSelect={(item) => {
          setCategoryId(item.id);
          setSheet('none');
        }}
      />
      <PickerSheet
        visible={sheet === 'account'}
        onClose={() => setSheet('none')}
        title="Account you paid from"
        items={(accountsQuery.data ?? []).map((account) => ({
          id: account.id,
          label: account.name,
          subtitle: money.format(account.currentBalance),
          icon: 'wallet-outline' as IconName,
          color: account.color ?? undefined,
        }))}
        selectedId={effectiveAccountId}
        onSelect={(item) => {
          setAccountId(item.id);
          setSheet('none');
        }}
      />
      <DatePickerSheet visible={sheet === 'date'} onClose={() => setSheet('none')} value={date} onSelect={setDate} />

      <FormSheet
        visible={newPersonOpen}
        onClose={() => setNewPersonOpen(false)}
        title="New person"
        submitLabel="Add person"
        submitDisabled={!newPersonName.trim()}
        onSubmit={async () => {
          try {
            const person = await createPerson({ name: newPersonName });
            addParticipant(person.id);
            setNewPersonOpen(false);
            toast.success(`${person.name} added`);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not add the person');
          }
        }}>
        <Field label="Name" value={newPersonName} onChangeText={setNewPersonName} placeholder="e.g. Rahul" autoFocus />
        <AppText variant="caption" tone="muted">
          Just a name — no account, phone number or invite needed. Everything stays on this device.
        </AppText>
      </FormSheet>

      <FormSheet
        visible={newGroupOpen}
        onClose={() => setNewGroupOpen(false)}
        title="New group"
        submitLabel="Create group"
        submitDisabled={!newGroupName.trim()}
        onSubmit={async () => {
          try {
            const group = await createSharedGroup({ name: newGroupName });
            setGroupId(group.id);
            setNewGroupOpen(false);
            toast.success(`Group "${group.name}" created`);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not create the group');
          }
        }}>
        <Field label="Group name" value={newGroupName} onChangeText={setNewGroupName} placeholder="e.g. Goa Trip" autoFocus />
      </FormSheet>
    </View>
  );
}

/* --------------------------------- Pieces ---------------------------------- */

function PersonRow({
  label,
  selected,
  onPress,
  accessibilityLabel,
  right,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  right?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      android_ripple={{ color: theme.colors.ripple }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        minHeight: 54,
        backgroundColor: pressed ? theme.colors.pressed : 'transparent',
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
      })}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: selected ? `${theme.colors.accent.base}22` : theme.colors.neutralSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <AppText variant="bodySmall" tone={selected ? 'accent' : 'secondary'}>
          {label.slice(0, 1).toUpperCase()}
        </AppText>
      </View>
      <AppText variant="bodyMedium" numberOfLines={1} style={{ flex: 1 }}>
        {label}
      </AppText>
      {right}
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={20}
        color={selected ? theme.colors.accent.base : theme.colors.muted}
      />
    </Pressable>
  );
}

function AddPersonRow({ onPress, accessibilityLabel }: { onPress: () => void; accessibilityLabel: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      android_ripple={{ color: theme.colors.ripple }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        minHeight: 50,
        backgroundColor: pressed ? theme.colors.pressed : 'transparent',
      })}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: `${theme.colors.accent.base}22`,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Ionicons name="add" size={18} color={theme.colors.accent.base} />
      </View>
      <AppText variant="bodyMedium" tone="accent" style={{ flex: 1 }}>
        New person
      </AppText>
    </Pressable>
  );
}

function RowField({
  icon,
  iconColor,
  label,
  value,
  onPress,
  muted,
  last,
}: {
  icon: IconName;
  iconColor?: string;
  label: string;
  value: string;
  onPress: () => void;
  muted?: boolean;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        minHeight: 52,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.pressed : 'transparent',
      })}>
      <Ionicons name={icon} size={17} color={iconColor ?? theme.colors.textSecondary} />
      <AppText variant="caption" tone="muted" style={{ width: 76 }}>
        {label}
      </AppText>
      <AppText variant="bodyMedium" tone={muted ? 'muted' : 'primary'} numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>
        {value}
      </AppText>
      <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} />
    </Pressable>
  );
}

function PreviewRow({ label, amount, tone = 'secondary' }: { label: string; amount: number; tone?: 'secondary' | 'positive' | 'negative' }) {
  return (
    <Row justify="space-between">
      <AppText variant="bodySmall" tone="secondary">
        {label}
      </AppText>
      <MoneyText amount={amount} variant="numericSmall" tone={tone} showSign={tone !== 'secondary'} />
    </Row>
  );
}

function formatDateLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}
