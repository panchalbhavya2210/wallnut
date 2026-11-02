import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { ListGroup, ListRow, ScreenHeader, ScrollScreen } from '@/components/ui/layout';
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
      <ScreenHeader
        title="Settings"
        subtitle={`${general.currency} · ${appearance.theme === 'system' ? 'System' : appearance.theme === 'dark' ? 'Dark' : 'Light'} · ${appearance.cornerStyle === 'boxy' ? 'Boxy' : 'Round'} corners`}
      />

      <View style={{ gap: theme.spacing.lg }}>
        <ListGroup title="Personalise">
          <ListRow
            title="Appearance"
            subtitle="Theme, accent, shape, text and motion"
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

        <ListGroup title="Data & privacy">
          <ListRow title="Import, export & backup" icon="swap-vertical-outline" onPress={() => router.push('/data')} chevron />
          <ListRow title="Merchant names" subtitle="Group messy merchant strings" icon="storefront-outline" onPress={() => router.push('/merchants')} chevron />
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
