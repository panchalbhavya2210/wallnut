import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { useMoney } from '@/hooks/useMoney';
import { BottomSheet } from './ui/sheets';
import { AppText } from './ui/text';
import { Button } from './ui/controls';
import { currencyInfo, toMinor } from '@/utils/money';
import { evaluateCalculator, formatCalculatorAmount } from '@/utils/calculator';

const KEYS: { token: string; label: string; kind?: 'operator' | 'action' | 'equals' }[][] = [
  [
    { token: 'C', label: 'C', kind: 'action' },
    { token: '(', label: '(', kind: 'action' },
    { token: ')', label: ')', kind: 'action' },
    { token: '/', label: '÷', kind: 'operator' },
  ],
  [
    { token: '7', label: '7' },
    { token: '8', label: '8' },
    { token: '9', label: '9' },
    { token: '*', label: '×', kind: 'operator' },
  ],
  [
    { token: '4', label: '4' },
    { token: '5', label: '5' },
    { token: '6', label: '6' },
    { token: '-', label: '−', kind: 'operator' },
  ],
  [
    { token: '1', label: '1' },
    { token: '2', label: '2' },
    { token: '3', label: '3' },
    { token: '+', label: '+', kind: 'operator' },
  ],
  [
    { token: '0', label: '0' },
    { token: '.', label: '.' },
    { token: 'backspace', label: '⌫', kind: 'action' },
    { token: '=', label: '=', kind: 'equals' },
  ],
];

/**
 * Inline amount calculator for the expense composer. It is display arithmetic
 * only — the value is handed back to the normal amount field, then the existing
 * validation and integer-minor-unit write path still apply.
 */
export function AmountCalculatorSheet({
  visible,
  onClose,
  initialMinor,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  initialMinor: number;
  onApply: (minor: number) => void;
}) {
  const theme = useTheme();
  const money = useMoney();
  const decimals = currencyInfo(money.currency).decimals;
  const factor = 10 ** decimals;
  // The composer remounts this sheet when it opens (see its `key`), so the
  // initial expression is correct without a state-syncing effect.
  const [expression, setExpression] = useState(() =>
    initialMinor > 0 ? formatCalculatorAmount(initialMinor / factor) : '',
  );

  const result = useMemo(() => evaluateCalculator(expression), [expression]);
  const preview = result.ok ? money.format(toMinor(result.value, decimals)) : null;
  const canApply = result.ok && result.value > 0;

  const press = (token: string) => {
    if (token === 'C') {
      setExpression('');
      return;
    }
    if (token === 'backspace') {
      setExpression((current) => current.slice(0, -1));
      return;
    }
    if (token === '=') {
      if (result.ok) setExpression(formatCalculatorAmount(result.value));
      return;
    }
    setExpression((current) => {
      if (token === '.') {
        const lastNumber = current.split(/[^0-9.]/).pop() ?? '';
        if (lastNumber.includes('.')) return current;
        return `${current}${lastNumber === '' ? '0.' : '.'}`;
      }
      if (['+', '-', '*', '/'].includes(token)) {
        if (current === '') return token === '-' ? '-' : current;
        if (/[+\-*/]$/.test(current)) return `${current.slice(0, -1)}${token}`;
        return `${current}${token}`;
      }
      return `${current}${token}`;
    });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Amount calculator"
      maxHeightRatio={0.86}
      footer={
        <Button
          label={preview ? `Use ${preview}` : 'Enter a valid expression'}
          icon="checkmark"
          fullWidth
          disabled={!canApply}
          onPress={() => {
            if (!canApply) return;
            onApply(toMinor(result.value, decimals));
            setExpression('');
            onClose();
          }}
        />
      }>
      <View style={{ gap: theme.spacing.lg }}>
        <View
          style={{
            padding: theme.spacing.lg,
            borderTopLeftRadius: theme.m3.shape.extraSmall,
            borderTopRightRadius: theme.m3.shape.extraSmall,
            backgroundColor: theme.m3.color.surfaceContainerHighest,
            gap: 4,
          }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: '100%' }}>
            <AppText
              variant="bodyLarge"
              tone={expression ? 'secondary' : 'muted'}
              numberOfLines={1}
              style={{ flex: 1, textAlign: 'right' }}>
              {expression || '0'}
            </AppText>
          </ScrollView>
          <AppText
            variant="headlineLarge"
            tone={result.ok ? 'primary' : 'negative'}
            numberOfLines={1}
            adjustsFontSizeToFit
            style={{ textAlign: 'right' }}>
            {result.ok ? money.format(toMinor(result.value, decimals)) : '—'}
          </AppText>
          {!result.ok && result.error && expression ? (
            <AppText variant="caption" tone="negative" style={{ textAlign: 'right' }}>
              {result.error}
            </AppText>
          ) : (
            <AppText variant="caption" tone="muted" style={{ textAlign: 'right' }}>
              Tip: 450 + 120 × 2 — totals update as you type.
            </AppText>
          )}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {KEYS.flat().map((key, index) => {
            const isOperator = key.kind === 'operator';
            const isAction = key.kind === 'action';
            const isEquals = key.kind === 'equals';
            return (
              <Pressable
                key={`${key.token}-${index}`}
                onPress={() => press(key.token)}
                accessibilityRole="button"
                accessibilityLabel={key.token === 'backspace' ? 'Backspace' : key.label}
                style={({ pressed }) => ({
                  width: '22.8%',
                  height: 56,
                  borderRadius: theme.m3.shape.medium,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isEquals
                    ? theme.m3.color.primary
                    : isOperator
                      ? theme.m3.color.secondaryContainer
                      : isAction
                        ? theme.m3.color.surfaceContainerHighest
                        : theme.m3.color.surfaceContainerHigh,
                  opacity: pressed ? 0.72 : 1,
                })}>
                {key.token === 'backspace' ? (
                  <Ionicons name="backspace-outline" size={22} color={theme.m3.color.onSurfaceVariant} />
                ) : (
                  <AppText
                    variant="titleLarge"
                    style={{
                      color: isEquals
                        ? theme.m3.color.onPrimary
                        : isOperator
                          ? theme.m3.color.onSecondaryContainer
                          : theme.m3.color.onSurface,
                    }}>
                    {key.label}
                  </AppText>
                )}
              </Pressable>
            );
          })}
        </View>
        <AppText variant="caption" tone="muted">
          Decimals follow your currency. The result is applied to the amount field; nothing is saved until you tap Save transaction.
        </AppText>
      </View>
    </BottomSheet>
  );
}
