import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { AppText } from '@/components/ui/text';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Shared numeric pad for PIN entry (lock screen + PIN setup). Deliberately
 * minimal: no amount formatting, no decimal key.
 */
export function PinPad({
  onDigit,
  onBackspace,
  disabled,
}: {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const keyStyle = {
    height: 54,
    borderRadius: theme.radius.lg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  };

  return (
    <View style={{ gap: theme.spacing.sm, width: '100%', maxWidth: 300, alignSelf: 'center' }}>
      {[0, 1, 2].map((row) => (
        <View key={row} style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {KEYS.slice(row * 3, row * 3 + 3).map((key) => (
            <Pressable
              key={key}
              role="button"
              accessibilityRole="button"
              accessibilityLabel={`PIN key ${key}`}
              disabled={disabled}
              onPress={() => onDigit(key)}
              android_ripple={{ color: theme.colors.ripple, borderless: true }}
              style={({ pressed }) => [keyStyle, { flex: 1, opacity: pressed || disabled ? 0.6 : 1 }]}>
              <AppText variant="title">{key}</AppText>
            </Pressable>
          ))}
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }} />
        <Pressable
          role="button"
          accessibilityRole="button"
          accessibilityLabel="PIN key 0"
          disabled={disabled}
          onPress={() => onDigit('0')}
          android_ripple={{ color: theme.colors.ripple, borderless: true }}
          style={({ pressed }) => [keyStyle, { flex: 1, opacity: pressed || disabled ? 0.6 : 1 }]}>
          <AppText variant="title">0</AppText>
        </Pressable>
        <Pressable
          role="button"
          accessibilityRole="button"
          accessibilityLabel="PIN backspace"
          disabled={disabled}
          onPress={onBackspace}
          android_ripple={{ color: theme.colors.ripple, borderless: true }}
          style={({ pressed }) => [keyStyle, { flex: 1, opacity: pressed || disabled ? 0.6 : 1 }]}>
          <Ionicons name="backspace-outline" size={22} color={theme.colors.text} />
        </Pressable>
      </View>
    </View>
  );
}
