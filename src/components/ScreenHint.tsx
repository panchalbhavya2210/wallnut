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
        borderRadius: theme.m3.shape.large,
        backgroundColor: theme.m3.color.tertiaryContainer,
        marginBottom: theme.spacing.lg,
      }}>
      <Ionicons name="bulb-outline" size={18} color={theme.m3.color.onTertiaryContainer} style={{ marginTop: 1 }} />
      <AppText variant="bodyMedium" style={{ flex: 1, color: theme.m3.color.onTertiaryContainer }}>
        {message}
      </AppText>
      <Pressable
        onPress={() => update('hints', { dismissed: [...useSettingsStore.getState().hints.dismissed, id] })}
        hitSlop={10}
        accessibilityLabel="Dismiss hint">
        <Ionicons name="close" size={18} color={theme.m3.color.onTertiaryContainer} />
      </Pressable>
    </View>
  );
}
