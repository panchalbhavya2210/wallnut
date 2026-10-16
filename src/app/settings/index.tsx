import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { ListGroup, ListRow, ScrollScreen } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { useSettingsStore } from '@/stores/settings.store';

/**
 * Settings hub. Every row here changes real behaviour — no cosmetic toggles.
 */
export default function SettingsScreen() {
  const theme = useTheme();
  const general = useSettingsStore((state) => state.general);
  const appearance = useSettingsStore((state) => state.appearance);
  const dashboard = useSettingsStore((state) => state.dashboard);
  const ai = useSettingsStore((state) => state.ai);
  const widgets = useSettingsStore((state) => state.widgets);

  return (
    <ScrollScreen>
      <View style={{ paddingTop: theme.spacing.md, paddingBottom: theme.spacing.lg }}>
        <AppText variant="title">Settings</AppText>
        <AppText variant="caption" tone="muted" style={{ marginTop: 2 }}>
          {general.currency} · {appearance.theme === 'system' ? 'System theme' : appearance.theme === 'dark' ? 'Dark' : 'Light'} ·{' '}
          {appearance.accent} accent
        </AppText>
      </View>

      <View style={{ gap: theme.spacing.lg }}>
        <ListGroup title="Personalise">
          <ListRow
            title="Appearance"
            subtitle="Theme, accent colour, font size, motion"
            icon="color-palette-outline"
            value={`${appearance.theme === 'system' ? 'System' : appearance.theme === 'dark' ? 'Dark' : 'Light'}`}
            onPress={() => router.push('/settings/appearance')}
            chevron
          />
          <ListRow
            title="AI & Automation"
            subtitle="Quick entry, DeepSeek explanations, privacy"
            icon="sparkles-outline"
            value={ai.enabled ? (ai.apiKey.trim() ? 'On' : 'Key needed') : 'Off'}
            onPress={() => router.push('/settings/ai' as never)}
            chevron
          />
          <ListRow
            title="Widgets"
            subtitle="Android home-screen widgets and privacy"
            icon="apps-outline"
            value={widgets.enabled ? (widgets.showAmounts ? 'Amounts on' : 'Amounts hidden') : 'Off'}
            onPress={() => router.push('/settings/widgets' as never)}
            chevron
          />
          <ListRow
            title="Dashboard"
            subtitle="Widgets, order, sizes, presets"
            icon="grid-outline"
            value={dashboard.density === 'compact' ? 'Compact' : 'Comfortable'}
            onPress={() => router.push('/settings/dashboard')}
            chevron
          />
          <ListRow
            title="Finance"
            subtitle="Currency, month start, default accounts"
            icon="calculator-outline"
            onPress={() => router.push('/settings/finance')}
            chevron
          />
          <ListRow
            title="Transactions"
            subtitle="Grouping, icons, deletion confirmation"
            icon="receipt-outline"
            onPress={() => router.push('/settings/transactions')}
            chevron
          />
          <ListRow
            title="Notifications"
            subtitle="In-app reminders for bills, budgets, debts"
            icon="notifications-outline"
            onPress={() => router.push('/settings/notifications')}
            chevron
          />
        </ListGroup>

        <ListGroup title="Manage">
          <ListRow title="Accounts & groups" icon="wallet-outline" onPress={() => router.push('/accounts')} chevron />
          <ListRow title="Categories" icon="pricetags-outline" onPress={() => router.push('/categories')} chevron />
          <ListRow title="Budgets" icon="pie-chart-outline" onPress={() => router.push('/budgets')} chevron />
          <ListRow title="Recurring & subscriptions" icon="repeat-outline" onPress={() => router.push('/recurring')} chevron />
          <ListRow title="Goals" icon="flag-outline" onPress={() => router.push('/goals')} chevron />
          <ListRow title="Money owed" icon="people-outline" onPress={() => router.push('/debts')} chevron />
          <ListRow title="Transaction rules" icon="git-branch-outline" onPress={() => router.push('/rules')} chevron />
        </ListGroup>

        <ListGroup title="Data">
          <ListRow title="Import, export & backup" icon="swap-vertical-outline" onPress={() => router.push('/data')} chevron />
          <ListRow title="Merchant names" subtitle="Group messy merchant strings" icon="storefront-outline" onPress={() => router.push('/merchants')} chevron />
        </ListGroup>

        <ListGroup title="Privacy">
          <ListRow
            title="App lock"
            subtitle="Fingerprint / face unlock on the Android app"
            icon="lock-closed-outline"
            onPress={() => router.push('/settings/security')}
            chevron
          />
          <ListRow title="About Wallnut" icon="information-circle-outline" onPress={() => router.push('/settings/about')} chevron />
        </ListGroup>
      </View>
    </ScrollScreen>
  );
}
