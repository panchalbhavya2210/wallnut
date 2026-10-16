import React, { useState } from 'react';
import { Platform, View } from 'react-native';

import { useTheme } from '@/theme/theme';
import { ListGroup, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { Button, Chip, SettingSwitch } from '@/components/ui/controls';
import { InfoBanner } from '@/components/ui/feedback';
import { toast } from '@/stores/ui.store';
import { useSettingsStore } from '@/stores/settings.store';
import { publishWidgetSnapshot } from '@/widgets/publish';
import { pinWallnutWidget } from '@/widgets/pin';
import { WIDGET_LABELS } from '@/widgets/defs';

/**
 * Settings → Widgets.
 *
 * Widgets are registered home-screen only (the Android provider XML declares
 * `home_screen`), so financial amounts are never offered on the lock screen —
 * a build-time guarantee, hence the informational row instead of a fake toggle.
 */

const WIDGET_SETTING_TO_NAME: Record<string, string> = {
  snapshot: 'Snapshot',
  balance: 'Balance',
  upcoming: 'Upcoming',
  quickAdd: 'QuickAdd',
};

export default function WidgetsSettingsScreen() {
  const theme = useTheme();
  const widgets = useSettingsStore((state) => state.widgets);
  const updateWidgets = useSettingsStore((state) => state.update);
  const [pinning, setPinning] = useState(false);

  const onAndroid = Platform.OS === 'android';

  const pin = async () => {
    setPinning(true);
    try {
      const name = WIDGET_SETTING_TO_NAME[widgets.defaultWidget] ?? 'Snapshot';
      const accepted = await pinWallnutWidget(name);
      if (accepted) {
        toast.success(`Add ${WIDGET_LABELS[name as keyof typeof WIDGET_LABELS] ?? name} from the launcher prompt`);
        void publishWidgetSnapshot();
      } else {
        toast.show('This launcher has no pin prompt — add Wallnut from the widget picker instead');
      }
    } finally {
      setPinning(false);
    }
  };

  return (
    <ScrollScreen>
      <ScreenHeader title="Widgets" subtitle="Android home screen" />

      <View style={{ gap: theme.spacing.lg }}>
        {!onAndroid ? (
          <InfoBanner
            message="Home-screen widgets are an Android feature and require the Android build (they do not work in Expo Go or on the web)."
          />
        ) : null}

        <ListGroup title="Widgets">
          <SettingSwitch
            title="Widgets enabled"
            subtitle="When off, added widgets show “Open Wallnut” instead of data"
            value={widgets.enabled}
            onValueChange={(value) => updateWidgets('widgets', { enabled: value })}
          />
          <SettingSwitch
            title="Show amounts"
            subtitle="Turn off to hide every figure on the home screen"
            value={widgets.showAmounts}
            onValueChange={(value) => updateWidgets('widgets', { showAmounts: value })}
          />
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <AppText variant="captionMedium" tone="secondary">
              Default widget
            </AppText>
            <Row gap="sm" wrap>
              {(
                [
                  { value: 'snapshot', label: 'Safe to Spend' },
                  { value: 'balance', label: 'Net Worth' },
                  { value: 'upcoming', label: 'Upcoming' },
                  { value: 'quickAdd', label: 'Quick Add' },
                ] as const
              ).map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  selected={widgets.defaultWidget === option.value}
                  onPress={() => updateWidgets('widgets', { defaultWidget: option.value })}
                />
              ))}
            </Row>
            {onAndroid ? (
              <Button
                label={pinning ? 'Opening launcher…' : 'Add to home screen'}
                loading={pinning}
                onPress={() => void pin()}
              />
            ) : null}
          </View>
        </ListGroup>

        <ListGroup title="Available widgets">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            {(
              [
                { name: 'Snapshot', detail: '2×2 · safe to spend, per-day figure and today’s spending' },
                { name: 'Balance', detail: '4×2 · net worth, available cash and safe to spend' },
                { name: 'Quick Add', detail: '4×2 · expense / income / transfer buttons and Ask Wallnut' },
                { name: 'Upcoming', detail: '4×2 · the next recurring bills and income' },
              ] as const
            ).map((entry) => (
              <View key={entry.name} style={{ gap: 2 }}>
                <AppText variant="bodyMedium">{entry.name}</AppText>
                <AppText variant="caption" tone="muted">
                  {entry.detail}
                </AppText>
              </View>
            ))}
            <AppText variant="caption" tone="muted">
              Values refresh automatically whenever the ledger changes, on app start, and every 30 minutes from Android.
            </AppText>
          </View>
        </ListGroup>

        <ListGroup title="Privacy">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
            <AppText variant="bodyMedium">Lock screen</AppText>
            <AppText variant="caption" tone="muted">
              Wallnut widgets are registered for the home screen only, so amounts are never shown on the lock screen. This is
              set when the app is installed and cannot be toggled at runtime — that is exactly why the setting is enforced,
              not faked.
            </AppText>
          </View>
        </ListGroup>
      </View>
    </ScrollScreen>
  );
}
