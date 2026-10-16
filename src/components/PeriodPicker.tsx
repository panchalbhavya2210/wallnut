import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { AppText } from './ui/text';
import { BottomSheet, DatePickerSheet } from './ui/sheets';
import { Button, Chip, SegmentedControl } from './ui/controls';
import { Row } from './ui/layout';
import {
  PERIOD_LABELS,
  eachDayInRange,
  formatDayMonth,
  formatMonthYear,
  getPeriodRange,
  subDays,
  toISODate,
  type DateRange,
  type PeriodPreset,
} from '@/utils/date';
import {
  RECORDS_GROUPING_LABELS,
  resolveRecordsGrouping,
  type RecordsGrouping,
} from '@/utils/records';

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
    case '12w':
      return '12W';
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

/** The five thumb-sized presets the Records screen shows first. */
export const RECORDS_PERIOD_OPTIONS: PeriodPreset[] = ['7d', '30d', '12w', '6m', '1y'];
/** Everything else the statement view can be asked for. */
export const RECORDS_EXTRA_PERIODS: PeriodPreset[] = ['3m', 'thisMonth', 'lastMonth', 'thisYear', 'all'];

/**
 * Statement-style period sheet: a segmented control for the common windows plus
 * chips for the rest, a live range preview, and the grouping switch. Used by the
 * Records (transactions) screen.
 */
export function CompactPeriodSheet({
  visible,
  onClose,
  value,
  onChange,
  monthStartDay,
  grouping,
  onGroupingChange,
}: {
  visible: boolean;
  onClose: () => void;
  value: PeriodPreset;
  onChange: (preset: PeriodPreset) => void;
  monthStartDay: number;
  grouping: RecordsGrouping;
  onGroupingChange: (grouping: RecordsGrouping) => void;
}) {
  const theme = useTheme();
  const segmentedValue = RECORDS_PERIOD_OPTIONS.includes(value) ? value : RECORDS_EXTRA_PERIODS.includes(value) ? value : '30d';
  const range = useMemo(() => getPeriodRange(value, { monthStartDay }), [value, monthStartDay]);
  const days = useMemo(() => eachDayInRange(range).length, [range]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Records">
      <View style={{ gap: theme.spacing.lg }}>
        <SegmentedControl
          options={RECORDS_PERIOD_OPTIONS.map((preset) => ({ value: preset, label: shortPeriodLabel(preset) }))}
          value={segmentedValue}
          onChange={(preset) => {
            onChange(preset);
            onClose();
          }}
        />

        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
          {RECORDS_EXTRA_PERIODS.map((preset) => (
            <Chip
              key={preset}
              label={shortPeriodLabel(preset)}
              selected={value === preset}
              onPress={() => {
                onChange(preset);
                onClose();
              }}
            />
          ))}
        </View>

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: theme.spacing.md,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
          }}>
          <View style={{ gap: 2 }}>
            <AppText variant="captionMedium" tone="secondary">
              {PERIOD_LABELS[value]}
            </AppText>
            <AppText variant="caption" tone="muted">
              {formatDayMonth(range.start)} – {formatDayMonth(range.end)} · {days} day{days === 1 ? '' : 's'}
            </AppText>
          </View>
          <AppText variant="caption" tone="muted">
            {groupingLabel(resolveRecordsGrouping(value, grouping))}
          </AppText>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="captionMedium" tone="secondary">
            Group by
          </AppText>
          <SegmentedControl
            options={(['auto', 'day', 'week', 'month'] as RecordsGrouping[]).map((option) => ({
              value: option,
              label: RECORDS_GROUPING_LABELS[option],
            }))}
            value={grouping}
            onChange={onGroupingChange}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

function groupingLabel(grouping: 'day' | 'week' | 'month'): string {
  return grouping === 'day' ? 'Grouped by day' : grouping === 'week' ? 'Grouped by week' : 'Grouped by month';
}

/**
 * From/To range picker. Analytics and reports treat the result as the active
 * period until another preset is chosen, so every chart follows one range.
 */export function CustomRangeSheet({
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

/**
 * The inline period control used on hero cards and screen toolbars: a pill that
 * names the active period and opens a sheet of presets. Mirrors the reference
 * apps' "This month ⌄" affordance.
 */
export function PeriodPill({
  value,
  onChange,
  onRequestOpen,
  options = ['7d', '30d', 'thisMonth', 'lastMonth', '3m', '1y'],
  monthStartDay = 1,
  appearance = 'surface',
}: {
  value: PeriodPreset;
  /** Called by the built-in preset sheet. Unused when `onRequestOpen` is set. */
  onChange?: (preset: PeriodPreset) => void;
  /**
   * Delegate opening to the parent (screens with a richer sheet, like the
   * statement view's preset + grouping control).
   */
  onRequestOpen?: () => void;
  options?: PeriodPreset[];
  monthStartDay?: number;
  /** `onDark` renders for a dark hero card. */
  appearance?: 'surface' | 'onDark';
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const onDark = appearance === 'onDark';
  return (
    <>
      <Pressable
        onPress={() => (onRequestOpen ? onRequestOpen() : setOpen(true))}
        accessibilityRole="button"
        accessibilityLabel={`Period: ${PERIOD_LABELS[value]}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          paddingHorizontal: theme.spacing.md,
          height: 30,
          borderRadius: theme.radius.full,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: onDark ? 'rgba(255, 255, 255, 0.35)' : theme.colors.border,
          backgroundColor: onDark ? 'rgba(255, 255, 255, 0.14)' : theme.colors.surface,
          opacity: pressed ? 0.75 : 1,
        })}>
        <AppText variant="captionMedium" style={onDark ? { color: '#FFFFFF' } : undefined}>
          {PERIOD_LABELS[value]}
        </AppText>
        <Ionicons name="chevron-down" size={12} color={onDark ? 'rgba(255, 255, 255, 0.9)' : theme.colors.muted} />
      </Pressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title="Period">
        <View style={{ gap: theme.spacing.xs }}>
          {options.map((option) => {
            const range = getPeriodRange(option, { monthStartDay });
            const selected = option === value;
            return (
              <Pressable
                key={option}
                onPress={() => {
                  onChange?.(option);
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={PERIOD_LABELS[option]}
                accessibilityState={{ selected }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: theme.spacing.md,
                  paddingHorizontal: theme.spacing.sm,
                  borderRadius: theme.radius.md,
                  backgroundColor: pressed || selected ? theme.colors.pressed : 'transparent',
                })}>
                <View style={{ gap: 2 }}>
                  <AppText variant="bodyMedium" tone={selected ? 'accent' : 'primary'}>
                    {PERIOD_LABELS[option]}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {formatDayMonth(range.start)} – {formatDayMonth(range.end)}
                  </AppText>
                </View>
                {selected ? <Ionicons name="checkmark" size={18} color={theme.colors.accent.base} /> : null}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </>
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
