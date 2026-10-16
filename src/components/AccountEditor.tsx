import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { AppText, MoneyText } from './ui/text';
import { Button, Chip, IconButton, SettingSwitch } from './ui/controls';
import { BottomSheet, Field, PickerSheet } from './ui/sheets';
import { ColorField } from './ui/ColorField';
import { Row } from './ui/layout';
import { confirm } from './ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import {
  ACCOUNT_TYPE_LABELS,
  createAccount,
  deleteAccount,
  isLiability,
  listAccountGroups,
  listAccounts,
  updateAccount,
  updateInvestmentValue,
  type AccountInput,
} from '@/services/accounts.service';
import type { Account, AccountType, InvestmentType } from '@/db/schema';
import { createAccountGroup } from '@/services/accounts.service';
import type { IconName } from './ui/layout';

/**
 * Create / edit account sheet. Handles cash, bank, wallet, card, savings,
 * investment, loan, mortgage and insurance accounts — including credit-card
 * billing fields, investment valuation, colour + icon, and the visibility
 * controls that decide how each account feeds net worth, totals, cash flow and
 * the transaction composer.
 */

export interface AccountEditorProps {
  visible: boolean;
  onClose: () => void;
  account?: Account | null;
  defaultGroupId?: string | null;
}

const ACCOUNT_TYPES: AccountType[] = [
  'bank', 'cash', 'wallet', 'savings', 'credit_card', 'loan', 'mortgage', 'investment', 'insurance', 'other',
];
const INVESTMENT_TYPES: InvestmentType[] = ['stocks', 'mutual_funds', 'etf', 'crypto', 'fd', 'gold', 'other'];

/** Icons that suit money containers, cards and property. */
const ACCOUNT_ICONS: IconName[] = [
  'wallet-outline', 'business-outline', 'cash-outline', 'card-outline', 'lock-closed-outline',
  'trending-up-outline', 'document-outline', 'home-outline', 'shield-checkmark-outline',
  'phone-portrait-outline', 'logo-bitcoin', 'diamond-outline', 'storefront-outline', 'people-outline',
  'airplane-outline', 'ellipsis-horizontal-outline',
];

const DEFAULT_ACCOUNT_COLOR = '#5E9BFF';

function defaultIconForType(type: AccountType): IconName {
  switch (type) {
    case 'credit_card':
      return 'card-outline';
    case 'cash':
      return 'cash-outline';
    case 'wallet':
      return 'wallet-outline';
    case 'savings':
      return 'lock-closed-outline';
    case 'investment':
      return 'trending-up-outline';
    case 'loan':
      return 'document-outline';
    case 'mortgage':
      return 'home-outline';
    case 'insurance':
      return 'shield-checkmark-outline';
    default:
      return 'business-outline';
  }
}

function defaultColorForType(type: AccountType): string {
  switch (type) {
    case 'credit_card':
      return '#FF647C';
    case 'cash':
    case 'wallet':
      return '#42D392';
    case 'savings':
      return '#5EDBA6';
    case 'investment':
      return '#B79CFF';
    case 'loan':
    case 'mortgage':
      return '#F5B84B';
    case 'insurance':
      return '#6FB4FF';
    default:
      return DEFAULT_ACCOUNT_COLOR;
  }
}

export function AccountEditor({ visible, onClose, account, defaultGroupId }: AccountEditorProps) {
  const theme = useTheme();
  const money = useMoney();
  const editing = Boolean(account);

  const groupsQuery = useQuery(() => listAccountGroups(), [visible]);
  const accountsQuery = useQuery(() => listAccounts({ includeArchived: true }), [visible]);

  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('bank');
  const [institution, setInstitution] = useState('');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [color, setColor] = useState(DEFAULT_ACCOUNT_COLOR);
  const [icon, setIcon] = useState<IconName>('wallet-outline');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [creditLimit, setCreditLimit] = useState('');
  const [statementDay, setStatementDay] = useState('');
  const [paymentDueDay, setPaymentDueDay] = useState('');
  const [minimumPayment, setMinimumPayment] = useState('');
  const [investmentType, setInvestmentType] = useState<InvestmentType>('mutual_funds');
  const [costBasis, setCostBasis] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [includeInNetWorth, setIncludeInNetWorth] = useState(true);
  const [includeInTotalBalance, setIncludeInTotalBalance] = useState(true);
  const [includeInCashFlow, setIncludeInCashFlow] = useState(true);
  const [visibleOnDashboard, setVisibleOnDashboard] = useState(true);
  const [hiddenFromTransactionCreation, setHiddenFromTransactionCreation] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (account) {
      setName(account.name);
      setType(account.type);
      setInstitution(account.institution ?? '');
      setOpeningBalance(String(account.initialBalance / 100));
      setGroupId(account.groupId);
      setColor(account.color ?? defaultColorForType(account.type));
      setIcon((account.icon as IconName | null) ?? defaultIconForType(account.type));
      setCreditLimit(account.creditLimit ? String(account.creditLimit / 100) : '');
      setStatementDay(account.statementDay ? String(account.statementDay) : '');
      setPaymentDueDay(account.paymentDueDay ? String(account.paymentDueDay) : '');
      setMinimumPayment(account.minimumPayment ? String(account.minimumPayment / 100) : '');
      setInvestmentType(account.investmentType ?? 'mutual_funds');
      setCostBasis(account.costBasis ? String(account.costBasis / 100) : '');
      setCurrentValue(String(account.currentBalance / 100));
      setIncludeInNetWorth(account.includeInNetWorth);
      setIncludeInTotalBalance(account.includeInTotalBalance);
      setIncludeInCashFlow(account.includeInCashFlow);
      setVisibleOnDashboard(account.visibleOnDashboard);
      setHiddenFromTransactionCreation(account.hiddenFromTransactionCreation);
    } else {
      setName('');
      setType('bank');
      setInstitution('');
      setOpeningBalance('0');
      setGroupId(defaultGroupId ?? null);
      setColor(defaultColorForType('bank'));
      setIcon(defaultIconForType('bank'));
      setCreditLimit('');
      setStatementDay('');
      setPaymentDueDay('');
      setMinimumPayment('');
      setCurrentValue('');
      setCostBasis('');
      setIncludeInNetWorth(true);
      setIncludeInTotalBalance(true);
      setIncludeInCashFlow(true);
      setVisibleOnDashboard(true);
      setHiddenFromTransactionCreation(false);
    }
  }, [visible, account, defaultGroupId]);

  const isCard = type === 'credit_card';
  const isInvestment = type === 'investment';
  const isLoan = type === 'loan';
  const isMortgage = type === 'mortgage';
  const isDebtAccount = isCard || isLoan || isMortgage;

  const groupItems = useMemo(
    () => [
      { id: '__none__', label: 'No group', icon: 'remove-circle-outline' as const },
      ...(groupsQuery.data ?? []).map((group) => ({
        id: group.id,
        label: group.name,
        icon: 'folder-outline' as const,
        color: group.color,
      })),
    ],
    [groupsQuery.data],
  );

  const submit = async () => {
    setBusy(true);
    try {
      if (!name.trim()) throw new Error('Give the account a name.');
      const payload: AccountInput = {
        name: name.trim(),
        type,
        initialBalance: Math.round(Number(openingBalance.replace(/[^0-9.-]/g, '') || '0') * 100),
        institution: institution.trim() || null,
        groupId: groupId === '__none__' ? null : groupId,
        color,
        icon,
        includeInNetWorth,
        includeInTotalBalance,
        includeInCashFlow,
        visibleOnDashboard,
        hiddenFromTransactionCreation,
        creditLimit: isCard ? Math.round(Number(creditLimit.replace(/[^0-9.]/g, '') || '0') * 100) : null,
        statementDay: isCard ? Number(statementDay) || null : null,
        paymentDueDay: isDebtAccount ? Number(paymentDueDay) || null : null,
        minimumPayment: isCard ? Math.round(Number(minimumPayment.replace(/[^0-9.]/g, '') || '0') * 100) : null,
        investmentType: isInvestment ? investmentType : null,
        costBasis: isInvestment ? Math.round(Number(costBasis.replace(/[^0-9.]/g, '') || '0') * 100) : null,
      };

      if (account) {
        await updateAccount(account.id, payload);
        if (isInvestment && currentValue) {
          const value = Math.round(Number(currentValue.replace(/[^0-9.]/g, '') || '0') * 100);
          if (value !== account.currentBalance) {
            await updateInvestmentValue(account.id, value);
          }
        }
        toast.success('Account updated');
      } else {
        await createAccount(payload);
        toast.success('Account created');
      }
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the account');
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!account) return;
    const ok = await confirm({
      title: account.isArchived ? 'Restore this account?' : 'Archive this account?',
      message: account.isArchived
        ? 'It will appear in the accounts list again.'
        : 'It stays in your history but is hidden from lists and totals.',
      confirmLabel: account.isArchived ? 'Restore' : 'Archive',
    });
    if (!ok) return;
    await updateAccount(account.id, { isArchived: !account.isArchived });
    toast.show(account.isArchived ? 'Account restored' : 'Account archived');
    onClose();
  };

  const remove = async () => {
    if (!account) return;
    const ok = await confirm({
      title: 'Delete this account?',
      message: 'Only possible when it has no transactions.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteAccount(account.id);
      toast.show('Account deleted');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete');
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={editing ? 'Edit account' : 'New account'}
      maxHeightRatio={0.92}
      footer={
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {account ? (
            <>
              <IconButton icon={account.isArchived ? 'refresh-outline' : 'archive-outline'} onPress={archive} size={44} background={theme.colors.inputBackground} accessibilityLabel="Archive" />
              <IconButton icon="trash-outline" onPress={remove} size={44} background={theme.colors.negativeSoft} color={theme.colors.negative} accessibilityLabel="Delete" />
            </>
          ) : null}
          <Button label={editing ? 'Save account' : 'Create account'} onPress={submit} loading={busy} style={{ flex: 1 }} />
        </View>
      }>
      <View style={{ gap: theme.spacing.lg }}>
        <Field label="Account name" value={name} onChangeText={setName} placeholder="e.g. Kotak Bank" autoFocus={!editing} />

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="captionMedium" tone="secondary">
            Type
          </AppText>
          <Row gap="sm" wrap>
            {ACCOUNT_TYPES.map((entry) => (
              <Chip
                key={entry}
                label={ACCOUNT_TYPE_LABELS[entry]}
                selected={type === entry}
                onPress={() => {
                  setType(entry);
                  if (!editing) {
                    setColor(defaultColorForType(entry));
                    setIcon(defaultIconForType(entry));
                  }
                }}
              />
            ))}
          </Row>
        </View>

        <Field label="Institution (optional)" value={institution} onChangeText={setInstitution} placeholder="e.g. HDFC Bank" />

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="captionMedium" tone="secondary">
            Appearance
          </AppText>
          <Row gap="md" align="center">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose account icon"
              onPress={() => setIconPickerOpen(true)}
              style={{
                width: 56,
                height: 56,
                borderRadius: theme.radius.lg,
                backgroundColor: `${color}22`,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: `${color}55`,
              }}>
              <Ionicons name={icon} size={26} color={color} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Button label="Change icon" variant="secondary" icon="apps-outline" onPress={() => setIconPickerOpen(true)} fullWidth />
            </View>
          </Row>
          <ColorField
            value={color}
            onChange={setColor}
            hint="The colour follows this account through lists, charts and analytics (including the per-account analytics view)."
          />
        </View>

        <Button
          label={`Group: ${groupItems.find((item) => item.id === (groupId ?? '__none__'))?.label ?? 'No group'}`}
          variant="secondary"
          icon="folder-outline"
          onPress={() => setGroupPickerOpen(true)}
        />

        {!editing ? (
          <Field
            label="Opening balance"
            value={openingBalance}
            onChangeText={setOpeningBalance}
            keyboardType="decimal-pad"
            prefix={money.currency === 'INR' ? '₹' : money.currency}
            money
          />
        ) : (
          <Field
            label="Initial balance (ledger start)"
            value={openingBalance}
            onChangeText={setOpeningBalance}
            keyboardType="decimal-pad"
            prefix={money.currency === 'INR' ? '₹' : money.currency}
            money
          />
        )}

        {isCard ? (
          <View style={{ gap: theme.spacing.md, padding: theme.spacing.lg, borderRadius: theme.radius.md, backgroundColor: theme.colors.inputBackground }}>
            <Row gap="sm">
              <Ionicons name="card-outline" size={16} color={theme.colors.textSecondary} />
              <AppText variant="captionMedium" tone="secondary">
                Credit card details
              </AppText>
            </Row>
            <Field label="Credit limit" value={creditLimit} onChangeText={setCreditLimit} keyboardType="decimal-pad" prefix={money.currency === 'INR' ? '₹' : money.currency} money />
            <Row gap="sm">
              <View style={{ flex: 1 }}>
                <Field label="Statement day" value={statementDay} onChangeText={setStatementDay} keyboardType="numeric" placeholder="e.g. 12" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Payment due day" value={paymentDueDay} onChangeText={setPaymentDueDay} keyboardType="numeric" placeholder="e.g. 28" />
              </View>
            </Row>
            <Field label="Minimum payment" value={minimumPayment} onChangeText={setMinimumPayment} keyboardType="decimal-pad" prefix={money.currency === 'INR' ? '₹' : money.currency} money />
          </View>
        ) : null}

        {isInvestment ? (
          <View style={{ gap: theme.spacing.md, padding: theme.spacing.lg, borderRadius: theme.radius.md, backgroundColor: theme.colors.inputBackground }}>
            <Row gap="sm">
              <Ionicons name="trending-up-outline" size={16} color={theme.colors.textSecondary} />
              <AppText variant="captionMedium" tone="secondary">
                Investment details
              </AppText>
            </Row>
            <View style={{ gap: theme.spacing.sm }}>
              <AppText variant="caption" tone="muted">
                Asset class
              </AppText>
              <Row gap="sm" wrap>
                {INVESTMENT_TYPES.map((entry) => (
                  <Chip key={entry} label={entry.replace('_', ' ')} selected={investmentType === entry} onPress={() => setInvestmentType(entry)} />
                ))}
              </Row>
            </View>
            <Field label="Invested (cost basis)" value={costBasis} onChangeText={setCostBasis} keyboardType="decimal-pad" prefix={money.currency === 'INR' ? '₹' : money.currency} money />
            <Field label="Current value" value={currentValue} onChangeText={setCurrentValue} keyboardType="decimal-pad" prefix={money.currency === 'INR' ? '₹' : money.currency} money />
            <AppText variant="caption" tone="muted">
              Updating the current value records a valuation adjustment — your ledger history stays intact.
            </AppText>
          </View>
        ) : null}

        {isLoan || isMortgage ? (
          <View style={{ gap: theme.spacing.md, padding: theme.spacing.lg, borderRadius: theme.radius.md, backgroundColor: theme.colors.inputBackground }}>
            <Row gap="sm">
              <Ionicons name={isMortgage ? 'home-outline' : 'document-outline'} size={16} color={theme.colors.textSecondary} />
              <AppText variant="captionMedium" tone="secondary">
                {isMortgage ? 'Mortgage details' : 'Loan details'}
              </AppText>
            </Row>
            <Field label="Payment due day" value={paymentDueDay} onChangeText={setPaymentDueDay} keyboardType="numeric" placeholder="e.g. 5" />
          </View>
        ) : null}

        <View style={{ borderRadius: theme.radius.md, backgroundColor: theme.colors.inputBackground, overflow: 'hidden' }}>
          <SettingSwitch title="Count in net worth" value={includeInNetWorth} onValueChange={setIncludeInNetWorth} />
          <SettingSwitch
            title="Count in total balance"
            subtitle="Day-to-day spendable balance"
            value={includeInTotalBalance}
            onValueChange={setIncludeInTotalBalance}
          />
          <SettingSwitch title="Include in cash flow" value={includeInCashFlow} onValueChange={setIncludeInCashFlow} />
          <SettingSwitch title="Show on dashboard" value={visibleOnDashboard} onValueChange={setVisibleOnDashboard} />
          <SettingSwitch
            title="Hide when adding transactions"
            subtitle="Keep zero-value or closed accounts out of the composer"
            value={hiddenFromTransactionCreation}
            onValueChange={setHiddenFromTransactionCreation}
          />
        </View>

        {editing ? (
          <Row justify="space-between">
            <AppText variant="caption" tone="muted">
              Current balance
            </AppText>
            <MoneyText amount={account?.currentBalance ?? 0} variant="numericCaption" tone={isLiability(type) ? 'negative' : 'neutral'} />
          </Row>
        ) : null}
      </View>

      <PickerSheet
        visible={groupPickerOpen}
        onClose={() => setGroupPickerOpen(false)}
        title="Account group"
        items={groupItems}
        selectedId={groupId ?? '__none__'}
        onSelect={(item) => {
          setGroupId(item.id === '__none__' ? null : item.id);
          setGroupPickerOpen(false);
        }}
        createLabel="New group"
        onCreate={async () => {
          const group = await createAccountGroup({ name: `Group ${(groupsQuery.data?.length ?? 0) + 1}` });
          setGroupId(group.id);
          setGroupPickerOpen(false);
        }}
      />

      <PickerSheet
        visible={iconPickerOpen}
        onClose={() => setIconPickerOpen(false)}
        title="Choose account icon"
        items={ACCOUNT_ICONS.map((choice) => ({
          id: choice,
          label: choice.replace('-outline', '').replace(/-/g, ' '),
          icon: choice,
          color,
        }))}
        selectedId={icon}
        onSelect={(item) => {
          setIcon(item.id as IconName);
          setIconPickerOpen(false);
        }}
      />
    </BottomSheet>
  );
}

export const AccountEditorStyles = StyleSheet.create({
  hidden: { display: 'none' },
});
