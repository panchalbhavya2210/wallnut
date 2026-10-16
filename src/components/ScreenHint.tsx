import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { useSettingsStore } from '@/stores/settings.store';
import { AppText } from './ui/text';

/**
 * First-visit explainer.
 *
 * Shown once per screen/feature (dismissal is stored in settings), it says what
 * the screen is for and what the user can actually do there — the in-app
 * equivalent of onboarding, without a modal parade.
 */
export function ScreenHint({ id, message }: { id: string; message: string }) {
  const theme = useTheme();
  const dismissed = useSettingsStore((state) => state.hints.dismissed);
  const update = useSettingsStore((state) => state.update);
  if (dismissed.includes(id)) return null;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: theme.spacing.sm,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.accent.soft,
        borderWidth: 1,
        borderColor: `${theme.colors.accent.base}33`,
        marginBottom: theme.spacing.lg,
      }}>
      <Ionicons name="bulb-outline" size={16} color={theme.colors.accent.base} style={{ marginTop: 1 }} />
      <AppText variant="caption" tone="secondary" style={{ flex: 1 }}>
        {message}
      </AppText>
      <Pressable
        onPress={() => update('hints', { dismissed: [...useSettingsStore.getState().hints.dismissed, id] })}
        hitSlop={10}
        accessibilityLabel="Dismiss hint">
        <Ionicons name="close" size={15} color={theme.colors.muted} />
      </Pressable>
    </View>
  );
}
