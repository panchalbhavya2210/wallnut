import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { ListGroup, Row, ScrollScreen } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { SettingSwitch } from '@/components/ui/controls';
import { useSettingsStore } from '@/stores/settings.store';

export default function TransactionSettings() {
  const theme = useTheme();
  const transactions = useSettingsStore((state) => state.transactions);
  const update = useSettingsStore((state) => state.update);

  return (
    <ScrollScreen>
      <Row gap="sm" style={{ paddingTop: theme.spacing.md, paddingBottom: theme.spacing.lg }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <AppText variant="title">Transactions</AppText>
      </Row>

      <View style={{ gap: theme.spacing.lg }}>
        <ListGroup title="List behaviour">
          <SettingSwitch
            title="Group by date"
            subtitle="Show TODAY / YESTERDAY headers with daily totals"
            value={transactions.groupByDate}
            onValueChange={(value) => update('transactions', { groupByDate: value })}
          />
          <SettingSwitch
            title="Show category icons"
            subtitle="Colour-coded icon tiles in the list"
            value={transactions.showIcons}
            onValueChange={(value) => update('transactions', { showIcons: value })}
          />
          <SettingSwitch
            title="Confirm before deleting"
            subtitle="Swipe-to-delete asks first"
            value={transactions.confirmDeletion}
            onValueChange={(value) => update('transactions', { confirmDeletion: value })}
          />
        </ListGroup>

        <ListGroup title="Entry">
          <SettingSwitch
            title="Remember merchant"
            subtitle="Prefill the merchant from your recent activity"
            value={transactions.rememberMerchant}
            onValueChange={(value) => update('transactions', { rememberMerchant: value })}
          />
          <SettingSwitch
            title="Smart dates"
            subtitle="Default new entries to today, yesterday when backfilling"
            value={transactions.smartDate}
            onValueChange={(value) => update('transactions', { smartDate: value })}
          />
        </ListGroup>

        <ListGroup title="Review">
          <SettingSwitch
            title="Flag imported transactions"
            subtitle="Imports land in the review queue until you approve them"
            value={transactions.autoReviewImports}
            onValueChange={(value) => update('transactions', { autoReviewImports: value })}
          />
          <SettingSwitch
            title="Flag unusually large expenses"
            subtitle="Anything far above your average is surfaced for review"
            value={transactions.flagLargeExpenses}
            onValueChange={(value) => update('transactions', { flagLargeExpenses: value })}
          />
        </ListGroup>

        <ListGroup title="Automation">
          <Row
            gap="md"
            justify="space-between"
            style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, minHeight: 56 }}>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyMedium">Transaction rules</AppText>
              <AppText variant="caption" tone="muted">
                Categorise and flag new transactions automatically
              </AppText>
            </View>
            <Pressable onPress={() => router.push('/rules')} hitSlop={8}>
              <AppText variant="captionMedium" tone="accent">
                Manage
              </AppText>
            </Pressable>
          </Row>
          <Row
            gap="md"
            justify="space-between"
            style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, minHeight: 56 }}>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyMedium">Quick templates</AppText>
              <AppText variant="caption" tone="muted">
                Reusable one-tap transactions
              </AppText>
            </View>
            <Pressable onPress={() => router.push('/templates')} hitSlop={8}>
              <AppText variant="captionMedium" tone="accent">
                Manage
              </AppText>
            </Pressable>
          </Row>
        </ListGroup>
      </View>
    </ScrollScreen>
  );
}
