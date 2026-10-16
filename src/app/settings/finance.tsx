import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { ListGroup, Row, ScrollScreen } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { Chip } from '@/components/ui/controls';
import { Field } from '@/components/ui/sheets';
import { useQuery } from '@/hooks/useQuery';
import { useSettingsStore } from '@/stores/settings.store';
import { listAccounts } from '@/services/accounts.service';
import { buildCategoryTree, listCategories } from '@/services/categories.service';
import { CURRENCIES, type CurrencyCode } from '@/utils/money';

export default function FinanceSettings() {
  const theme = useTheme();
  const general = useSettingsStore((state) => state.general);
  const finance = useSettingsStore((state) => state.finance);
  const updateGeneral = useSettingsStore((state) => state.update);
  const updateFinance = useSettingsStore((state) => state.update);

  const accounts = useQuery(() => listAccounts(), []);
  const categories = useQuery(() => listCategories(), []);

  const monthStartOptions = [1, 5, 10, 15, 20, 25];

  return (
    <ScrollScreen>
      <Header title="Finance" />

      <View style={{ gap: theme.spacing.lg }}>
        <ListGroup title="Currency">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <Row gap="sm" wrap>
              {(Object.keys(CURRENCIES) as CurrencyCode[]).map((code) => (
                <Chip
                  key={code}
                  label={`${CURRENCIES[code].symbol} ${code}`}
                  selected={general.currency === code}
                  onPress={() =>
                    updateGeneral('general', {
                      currency: code,
                      numberGrouping: CURRENCIES[code].grouping,
                    })
                  }
                />
              ))}
            </Row>
            <AppText variant="caption" tone="muted">
              Amounts are stored as integers in the smallest unit, so switching currencies never re-rounds your data.
            </AppText>
          </View>
        </ListGroup>

        <ListGroup title="Number format">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <Row gap="sm">
              <Chip
                label="Indian (₹1,23,456)"
                selected={general.numberGrouping === 'indian'}
                onPress={() => updateGeneral('general', { numberGrouping: 'indian' })}
              />
              <Chip
                label="Western (₹123,456)"
                selected={general.numberGrouping === 'western'}
                onPress={() => updateGeneral('general', { numberGrouping: 'western' })}
              />
            </Row>
            <Row gap="sm">
              <Chip
                label="Hide .00"
                selected={!general.showDecimals}
                onPress={() => updateGeneral('general', { showDecimals: false })}
              />
              <Chip
                label="Always show decimals"
                selected={general.showDecimals}
                onPress={() => updateGeneral('general', { showDecimals: true })}
              />
            </Row>
          </View>
        </ListGroup>

        <ListGroup title="Month start day">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <Row gap="sm" wrap>
              {monthStartOptions.map((day) => (
                <Chip
                  key={day}
                  label={day === 1 ? '1st' : `${day}th`}
                  selected={general.monthStartDay === day}
                  onPress={() => updateGeneral('general', { monthStartDay: day })}
                />
              ))}
            </Row>
            <AppText variant="caption" tone="muted">
              Analytics, budgets and “this month” all start on this day — useful if your salary lands mid-month.
            </AppText>
          </View>
        </ListGroup>

        <ListGroup title="Defaults for new transactions">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <AppText variant="captionMedium" tone="secondary">
              Transaction type
            </AppText>
            <Row gap="sm">
              <Chip label="Expense" selected={finance.defaultTransactionType === 'expense'} onPress={() => updateFinance('finance', { defaultTransactionType: 'expense' })} />
              <Chip label="Income" selected={finance.defaultTransactionType === 'income'} onPress={() => updateFinance('finance', { defaultTransactionType: 'income' })} />
              <Chip label="Transfer" selected={finance.defaultTransactionType === 'transfer'} onPress={() => updateFinance('finance', { defaultTransactionType: 'transfer' })} />
            </Row>

            <AppText variant="captionMedium" tone="secondary" style={{ marginTop: theme.spacing.sm }}>
              Default account
            </AppText>
            <Row gap="sm" wrap>
              <Chip label="None" selected={!finance.defaultAccountId} onPress={() => updateFinance('finance', { defaultAccountId: null })} />
              {(accounts.data ?? []).map((account) => (
                <Chip
                  key={account.id}
                  label={account.name}
                  selected={finance.defaultAccountId === account.id}
                  onPress={() => updateFinance('finance', { defaultAccountId: account.id })}
                />
              ))}
            </Row>

            <AppText variant="captionMedium" tone="secondary" style={{ marginTop: theme.spacing.sm }}>
              Default category
            </AppText>
            <Row gap="sm" wrap>
              <Chip label="None" selected={!finance.defaultCategoryId} onPress={() => updateFinance('finance', { defaultCategoryId: null })} />
              {buildCategoryTree(categories.data ?? []).map((parent) => (
                <Chip
                  key={parent.id}
                  label={parent.name}
                  selected={finance.defaultCategoryId === parent.id}
                  onPress={() => updateFinance('finance', { defaultCategoryId: parent.id })}
                />
              ))}
            </Row>
          </View>
        </ListGroup>

        <ListGroup title="Spending rules">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <Row gap="sm" wrap>
              <Chip
                label="Transfers are not spending"
                selected={finance.excludeTransfersFromSpending}
                onPress={() => updateFinance('finance', { excludeTransfersFromSpending: !finance.excludeTransfersFromSpending })}
              />
            </Row>
            <AppText variant="caption" tone="muted">
              Keep this on. Moving money between your own accounts (including credit-card bill payments) should never be counted as spending.
            </AppText>
            <Row gap="sm" wrap>
              <Chip
                label="Auto-post recurring payments"
                selected={finance.autoPostRecurring}
                onPress={() => updateFinance('finance', { autoPostRecurring: !finance.autoPostRecurring })}
              />
            </Row>
            <AppText variant="caption" tone="muted">
              When off, due recurring items wait in Upcoming for you to confirm instead of posting automatically.
            </AppText>
          </View>
        </ListGroup>

        <ListGroup title="Month start">
          <View style={{ padding: theme.spacing.lg }}>
            <Field
              label="Your name (greeting)"
              value={general.userName}
              onChangeText={(value) => updateGeneral('general', { userName: value })}
              placeholder="Optional"
            />
          </View>
        </ListGroup>
      </View>
    </ScrollScreen>
  );
}

export function Header({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <Row gap="sm" style={{ paddingTop: theme.spacing.md, paddingBottom: theme.spacing.lg }}>
      <Pressable onPress={() => router.back()} hitSlop={10}>
        <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
      </Pressable>
      <AppText variant="title">{title}</AppText>
    </Row>
  );
}

export const SettingsScreenStyles = { hidden: { display: 'none' } } as const;
