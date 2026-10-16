import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useTheme } from '@/theme/theme';
import { useSettingsStore } from '@/stores/settings.store';
import { AppText } from './ui/text';

/**
 * Numeric keypad for the quick-add flow. The amount is the visual focus of the
 * screen; digits append to a string that is parsed into integer minor units.
 * Amount is the visual focus; digits append to a string that is parsed into
 * integer minor units by the caller.
 */

export interface AmountKeypadProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  hapticsEnabled?: boolean;
}

const KEYS: (string | 'backspace')[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'backspace'];

async function tapFeedback(enabled: boolean) {
  if (!enabled) return;
  try {
    await Haptics.selectionAsync();
  } catch {
    // Haptics are unavailable on some platforms (web) — never block input.
  }
}

export function AmountKeypad({ value, onChange, onSubmit, hapticsEnabled = true }: AmountKeypadProps) {
  const theme = useTheme();

  const press = (key: string | 'backspace') => {
    void tapFeedback(hapticsEnabled && !theme.motion.reduceMotion);
    if (key === 'backspace') {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === '.') {
      if (value.includes('.')) return;
      onChange(value.length === 0 ? '0.' : `${value}.`);
      return;
    }
    // Prevent more than two decimals.
    const [, decimals] = value.split('.');
    if (decimals && decimals.length >= 2) return;
    // Prevent leading zeros like "007".
    const next = value === '0' ? key : value + key;
    if (next.replace('.', '').length > 10) return;
    onChange(next);
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {KEYS.map((key) => (
          <View key={key} style={{ width: '33.333%', padding: 3 }}>
            <Pressable
              onPress={() => press(key)}
              onLongPress={key === 'backspace' ? () => onChange('') : undefined}
              style={({ pressed }) => ({
                height: 54,
                borderRadius: theme.radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? theme.colors.pressed : theme.colors.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
              })}>
              {key === 'backspace' ? (
                <Ionicons name="backspace-outline" size={22} color={theme.colors.text} />
              ) : (
                <AppText variant="titleSmall">{key}</AppText>
              )}
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Renders "450.5" as a large, centered money display for the quick-add screen. */
export function AmountDisplay({
  value,
  currencySymbol,
  tone = 'primary',
  size = 'large',
  onPress,
}: {
  value: string;
  currencySymbol: string;
  tone?: 'primary' | 'positive' | 'negative';
  size?: 'large' | 'medium';
  onPress?: () => void;
}) {
  const theme = useTheme();
  const grouping = useSettingsStore((state) => state.general.numberGrouping);
  const color =
    tone === 'negative' ? theme.colors.negative : tone === 'positive' ? theme.colors.positive : theme.colors.text;
  const [whole, decimals] = (value || '0').split('.');
  // Group digits as they are typed (1,23,456.78) — the string stays clean for
  // the parser; only the display is formatted.
  const groupedWhole = React.useMemo(() => {
    if (!whole) return '0';
    const numeric = Number(whole);
    if (!Number.isFinite(numeric)) return whole;
    return numeric.toLocaleString(grouping === 'indian' ? 'en-IN' : 'en-US', { maximumFractionDigits: 0 });
  }, [whole, grouping]);

  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' }}>
      <AppText
        variant={size === 'large' ? 'headline' : 'title'}
        tone="secondary"
        style={{ color, marginTop: size === 'large' ? 10 : 6, marginRight: 2 }}>
        {currencySymbol}
      </AppText>
      <AppText
        variant={size === 'large' ? 'display' : 'headline'}
        style={{ color, fontSize: size === 'large' ? 52 : 34, lineHeight: size === 'large' ? 58 : 40 }}>
        {groupedWhole}
      </AppText>
      {value.includes('.') ? (
        <AppText
          variant={size === 'large' ? 'headline' : 'title'}
          style={{ color, marginTop: size === 'large' ? 10 : 6 }}>
          .{decimals ?? ''}
        </AppText>
      ) : null}
    </Pressable>
  );
}
