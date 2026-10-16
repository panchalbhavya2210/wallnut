import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { AppText } from './ui/text';
import { BottomSheet, DatePickerSheet } from './ui/sheets';
import { Button, Chip } from './ui/controls';
import { Row } from './ui/layout';
import {
  PERIOD_LABELS,
  eachDayInRange,
  formatMonthYear,
  getPeriodRange,
  subDays,
  toISODate,
  type DateRange,
  type PeriodPreset,
} from '@/utils/date';

/** Period presets offered across the app (widgets, analytics, reports). */
export const PERIOD_OPTIONS: PeriodPreset[] = ['7d', '30d', '3m', '6m', '1y', 'thisMonth', 'lastMonth', 'thisYear', 'all'];

export function usePeriodRange(preset: PeriodPreset, monthStartDay: number): DateRange {
  return useMemo(() => getPeriodRange(preset, { monthStartDay }), [preset, monthStartDay]);
}

/** Compact segmented period selector: scrollable chips. */
export function PeriodChips({
  value,
  onChange,
  options = ['7d', '30d', '3m', '6m', '1y'],
  compact,
  style,
}: {
  value: PeriodPreset;
  onChange: (preset: PeriodPreset) => void;
  options?: PeriodPreset[];
  compact?: boolean;
  style?: object;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={style}
      contentContainerStyle={{ gap: theme.spacing.sm, paddingRight: theme.spacing.lg }}>
      {options.map((option) => (
        <Chip
          key={option}
          size={compact ? 'sm' : 'md'}
          label={shortPeriodLabel(option)}
          selected={option === value}
          onPress={() => onChange(option)}
        />
      ))}
    </ScrollView>
  );
}

export function shortPeriodLabel(preset: PeriodPreset): string {
  switch (preset) {
    case '7d':
      return '7D';
    case '30d':
      return '30D';
    case '3m':
      return '3M';
    case '6m':
      return '6M';
    case '1y':
      return '1Y';
    case 'thisMonth':
      return 'This month';
    case 'lastMonth':
      return 'Last month';
    case 'thisWeek':
      return 'This week';
    case 'thisYear':
      return 'This year';
    case 'all':
      return 'All time';
    case 'custom':
      return 'Custom';
    default:
      return preset;
  }
}

/** Full period picker sheet with a range summary. */
export function PeriodSheet({
  visible,
  onClose,
  value,
  onChange,
  monthStartDay,
  allowCustom,
}: {
  visible: boolean;
  onClose: () => void;
  value: PeriodPreset;
  onChange: (preset: PeriodPreset) => void;
  monthStartDay: number;
  allowCustom?: boolean;
}) {
  const theme = useTheme();
  const [customFrom, setCustomFrom] = useState(() => new Date());
  const [customTo, setCustomTo] = useState(() => new Date());
  const options = allowCustom ? [...PERIOD_OPTIONS, 'custom' as PeriodPreset] : PERIOD_OPTIONS;

  const preview = useMemo(() => {
    if (value === 'custom') {
      return { start: customFrom, end: customTo, label: 'Custom' };
    }
    return getPeriodRange(value, { monthStartDay });
  }, [value, monthStartDay, customFrom, customTo]);

  const dayCount = useMemo(() => eachDayInRange(preview).length, [preview]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Period">
      <View style={{ gap: theme.spacing.lg }}>
        {options.map((option) => {
          const range = option === 'custom' ? null : getPeriodRange(option, { monthStartDay });
          const selected = option === value;
          return (
            <Pressable
              key={option}
              onPress={() => {
                onChange(option);
                if (option !== 'custom') onClose();
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: theme.spacing.md,
                opacity: pressed ? 0.7 : 1,
              })}>
              <View style={{ gap: 2 }}>
                <AppText variant="bodyMedium">{PERIOD_LABELS[option]}</AppText>
                {range ? (
                  <AppText variant="caption" tone="muted">
                    {formatMonthYear(range.start)} – {formatMonthYear(range.end)}
                  </AppText>
                ) : null}
              </View>
              {selected ? <Ionicons name="checkmark-circle" size={20} color={theme.colors.accent.base} /> : null}
            </Pressable>
          );
        })}
        {value === 'custom' ? (
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="caption" tone="muted">
              Custom ranges use the filters in Transactions for precision. Showing the last {dayCount} days for now.
            </AppText>
            <AppText variant="bodySmall" tone="secondary">
              {toISODate(preview.start)} → {toISODate(preview.end)}
            </AppText>
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
}

/**
 * From/To range picker. Analytics and reports treat the result as the active
 * period until another preset is chosen, so every chart follows one range.
 */
export function CustomRangeSheet({
  visible,
  onClose,
  value,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  value: DateRange | null;
  onApply: (range: DateRange) => void;
}) {
  const theme = useTheme();
  const [from, setFrom] = useState<Date>(() => value?.start ?? subDays(new Date(), 29));
  const [to, setTo] = useState<Date>(() => value?.end ?? new Date());
  const [picker, setPicker] = useState<'none' | 'from' | 'to'>('none');

  useEffect(() => {
    if (!visible) return;
    setFrom(value?.start ?? subDays(new Date(), 29));
    setTo(value?.end ?? new Date());
    setPicker('none');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const invalid = from.getTime() > to.getTime();
  const days = invalid ? 0 : eachDayInRange({ start: from, end: to, label: 'Custom' }).length;

  const quick = [
    { label: 'Last 7 days', days: 7 },
    { label: 'Last 30 days', days: 30 },
    { label: 'Last 90 days', days: 90 },
    { label: 'This year', days: 0 },
  ];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Custom range"
      footer={
        <Button
          label={invalid ? 'Pick a valid range' : `Apply · ${days} days`}
          fullWidth
          disabled={invalid}
          onPress={() => {
            if (invalid) return;
            onApply({ start: from, end: to, label: 'Custom' });
            onClose();
          }}
        />
      }>
      <View style={{ gap: theme.spacing.lg }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm }}>
          {quick.map((entry) => (
            <Chip
              key={entry.label}
              label={entry.label}
              onPress={() => {
                const end = new Date();
                setTo(end);
                setFrom(entry.days > 0 ? subDays(end, entry.days - 1) : new Date(end.getFullYear(), 0, 1));
              }}
            />
          ))}
        </ScrollView>

        <Row gap="sm">
          <Pressable
            onPress={() => setPicker('from')}
            style={({ pressed }) => ({
              flex: 1,
              gap: 2,
              padding: theme.spacing.md,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.inputBackground,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.8 : 1,
            })}>
            <AppText variant="caption" tone="muted">
              From
            </AppText>
            <AppText variant="bodySmall">{toISODate(from)}</AppText>
          </Pressable>
          <Pressable
            onPress={() => setPicker('to')}
            style={({ pressed }) => ({
              flex: 1,
              gap: 2,
              padding: theme.spacing.md,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.inputBackground,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.8 : 1,
            })}>
            <AppText variant="caption" tone="muted">
              To
            </AppText>
            <AppText variant="bodySmall">{toISODate(to)}</AppText>
          </Pressable>
        </Row>

        {invalid ? (
          <AppText variant="caption" tone="negative">
            The start date must be on or before the end date.
          </AppText>
        ) : null}

        <AppText variant="caption" tone="muted">
          Charts, categories and totals on this screen follow the range until you pick another period.
        </AppText>
      </View>

      <DatePickerSheet visible={picker === 'from'} onClose={() => setPicker('none')} value={from} onSelect={setFrom} title="From" />
      <DatePickerSheet visible={picker === 'to'} onClose={() => setPicker('none')} value={to} onSelect={setTo} title="To" />
    </BottomSheet>
  );
}

/** Header used inside widget cards: title, optional subtitle, actions. */export function WidgetHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
  right,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  right?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: theme.spacing.md,
        gap: theme.spacing.md,
      }}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="label" tone="muted">
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="secondary">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={10}>
          <AppText variant="captionMedium" tone="accent">
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export const widgetCardStyle = StyleSheet.create({
  base: { borderRadius: 16 },
});
