import React from 'react';
import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { useTheme } from '@/theme/theme';
import type { TypographyVariant } from '@/theme/typography';
import { useMoney } from '@/hooks/useMoney';

export type TextTone =
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'positive'
  | 'negative'
  | 'warning'
  | 'accent'
  | 'inverse';

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  tone?: TextTone;
  /** Shortcut for accent behaviour on labels. */
  uppercase?: boolean;
}

/** Typography-aware Text. Every string in the app goes through this. */
export function AppText({ variant = 'body', tone = 'primary', style, uppercase, ...rest }: AppTextProps) {
  const theme = useTheme();
  const color = toneColor(tone, theme);
  return (
    <Text
      {...rest}
      style={[
        theme.typography[variant],
        { color },
        uppercase ? styles.uppercase : null,
        style,
      ]}
    />
  );
}

function toneColor(tone: TextTone, theme: ReturnType<typeof useTheme>): string {
  switch (tone) {
    case 'secondary':
      return theme.colors.textSecondary;
    case 'muted':
      return theme.colors.muted;
    case 'positive':
      return theme.colors.positive;
    case 'negative':
      return theme.colors.negative;
    case 'warning':
      return theme.colors.warning;
    case 'accent':
      return theme.colors.accent.base;
    case 'inverse':
      return theme.colors.textInverse;
    case 'primary':
    default:
      return theme.colors.text;
  }
}

export interface MoneyTextProps extends Omit<TextProps, 'children'> {
  amount: number; // signed minor units
  variant?: TypographyVariant;
  /**
   * auto → red for negative, green for positive (sign-driven);
   * positive-negative → green when >= 0 (for deltas);
   * neutral/secondary/muted → fixed colours;
   * positive/negative → force the semantic colour regardless of sign.
   */
  tone?: 'auto' | 'positive-negative' | 'neutral' | 'muted' | 'secondary' | 'positive' | 'negative';
  /** Show an explicit + / − sign. Defaults to true for signed display. */
  showSign?: boolean;
  compact?: boolean;
  absolute?: boolean;
  /** Render the currency symbol. */
  showSymbol?: boolean;
}

/**
 * The single way money is rendered. Uses tabular numerals, true minus signs and
 * semantic colors, so a reader can tell income from expense without relying on
 * color alone (sign + color + label).
 */
export function MoneyText({
  amount,
  variant = 'numericBody',
  tone = 'auto',
  showSign,
  compact,
  absolute,
  showSymbol = true,
  style,
  ...rest
}: MoneyTextProps) {
  const theme = useTheme();
  const money = useMoney();

  const text = money.format(amount, {
    sign: showSign === false ? 'never' : showSign === true ? 'always' : 'auto',
    compact,
    absolute,
    showSymbol,
  });
  // True minus sign for visual polish.
  const display = text.replace(/^-/, '−');

  let color = theme.colors.text;
  if (tone === 'auto') {
    if (amount < 0) color = theme.colors.negative;
    else if (amount > 0) color = theme.colors.positive;
  } else if (tone === 'positive-negative') {
    color = amount >= 0 ? theme.colors.positive : theme.colors.negative;
  } else if (tone === 'positive') {
    color = theme.colors.positive;
  } else if (tone === 'negative') {
    color = theme.colors.negative;
  } else if (tone === 'muted') color = theme.colors.muted;
  else if (tone === 'secondary') color = theme.colors.textSecondary;

  return (
    <Text {...rest} style={[theme.typography[variant], { color }, style]}>
      {display}
    </Text>
  );
}

/** Small uppercase section label ("TODAY", "ASSETS"). */
export function SectionLabel({ children, style, tone = 'muted' }: { children: React.ReactNode; style?: TextStyle; tone?: TextTone }) {
  return (
    <AppText variant="label" tone={tone} style={style}>
      {children}
    </AppText>
  );
}

const styles = StyleSheet.create({
  uppercase: { textTransform: 'uppercase' },
});
