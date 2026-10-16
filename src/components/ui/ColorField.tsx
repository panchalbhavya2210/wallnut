import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/theme';
import { AppText } from './text';
import { Row } from './layout';
import { Field } from './sheets';

/**
 * Shared colour picker: 22 curated swatches plus any 6-digit hex. Used by
 * accounts and categories so colour choices feel identical everywhere.
 */

export const COLOR_CHOICES = [
  '#FF3D8B', '#FF647C', '#FF8FA8', '#F472B6', '#E879F9',
  '#FF9F0A', '#F5B84B', '#FFD60A', '#FFB547',
  '#42D392', '#22C55E', '#6EE7A8', '#5EDBA6', '#14B8A6',
  '#5E9BFF', '#6FB4FF', '#3B82F6', '#8B8CFF', '#B79CFF', '#C4A9FF', '#8B5CF6', '#929AA8',
];

export function ColorField({
  label = 'Colour',
  value,
  onChange,
  hint,
}: {
  label?: string;
  value: string;
  onChange: (color: string) => void;
  hint?: string;
}) {
  const theme = useTheme();
  const [draft, setDraft] = React.useState(value);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <AppText variant="captionMedium" tone="secondary">
        {label}
      </AppText>
      <Row gap="sm" wrap>
        {COLOR_CHOICES.map((choice) => (
          <Pressable
            key={choice}
            accessibilityRole="button"
            accessibilityLabel={`Colour ${choice}`}
            onPress={() => onChange(choice)}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: choice,
              borderWidth: value === choice ? 3 : 0,
              borderColor: theme.colors.text,
            }}
          />
        ))}
      </Row>
      <Row gap="sm" align="center">
        <View style={{ flex: 1 }}>
          <Field
            label="Custom colour"
            value={draft}
            onChangeText={(next) => {
              setDraft(next);
              const clean = next.trim().replace('#', '');
              if (/^[0-9a-fA-F]{6}$/.test(clean)) onChange(`#${clean.toUpperCase()}`);
            }}
            placeholder="#FF3D8B"
          />
        </View>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor: value,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.borderStrong,
          }}
        />
      </Row>
      <AppText variant="caption" tone="muted">
        {hint ?? 'Pick a swatch or paste any 6-digit hex. The colour follows this account through lists, charts and analytics.'}
      </AppText>
    </View>
  );
}
