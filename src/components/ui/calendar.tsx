import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Calendar, type CalendarProps, type DateData } from 'react-native-calendars';

import { useTheme, type Theme } from '@/theme/theme';
import { AppText } from './text';

/**
 * One calendar everywhere: the maintained `react-native-calendars` month grid,
 * skinned with Wallnut's tokens. Date pickers, the cash-flow calendar and any
 * future date control all render through these components so the app never
 * grows a second hand-rolled calendar.
 */

export type CalendarDayState = 'inactive' | 'today' | 'selected' | 'disabled' | '';

/**
 * Props the library hands to a custom `dayComponent`. `date` is the DateData
 * object at runtime; the library's own type intersects it with `string`, so it
 * stays optional here and the cells guard against it.
 */
export interface CalendarDayComponentProps {
  date?: DateData;
  state?: CalendarDayState;
  marking?: { selected?: boolean; marked?: boolean; dotColor?: string };
  onPress?: (date?: DateData) => void;
  onLongPress?: (date?: DateData) => void;
  children?: React.ReactNode;
}

export function calendarTheme(theme: Theme): NonNullable<CalendarProps['theme']> {
  const { colors, typography } = theme;
  return {
    backgroundColor: colors.surface,
    calendarBackground: colors.surface,
    textSectionTitleColor: colors.muted,
    textSectionTitleDisabledColor: colors.muted,
    selectedDayBackgroundColor: colors.accent.base,
    selectedDayTextColor: colors.accent.on,
    todayTextColor: colors.accent.base,
    todayBackgroundColor: 'transparent',
    dayTextColor: colors.text,
    textDisabledColor: colors.muted,
    textInactiveColor: colors.muted,
    monthTextColor: colors.text,
    textMonthFontFamily: typography.titleSmall.fontFamily,
    textMonthFontSize: 16,
    textMonthFontWeight: '600',
    textDayFontFamily: typography.body.fontFamily,
    textDayHeaderFontFamily: typography.captionMedium.fontFamily,
    textDayFontSize: 14,
    textDayHeaderFontSize: 12,
    arrowColor: colors.accent.base,
    disabledArrowColor: colors.muted,
    dotColor: colors.accent.base,
    selectedDotColor: colors.accent.on,
  };
}

/** Themed month grid. Swipe between months and tap a day — nothing else. */
export function AppCalendar({ style, firstDay = 1, theme: overrides, ...props }: CalendarProps) {
  const theme = useTheme();
  return (
    <Calendar
      firstDay={firstDay}
      enableSwipeMonths
      hideExtraDays
      theme={{ ...calendarTheme(theme), ...overrides }}
      style={[{ borderRadius: theme.radius.md, overflow: 'hidden' }, style] as StyleProp<ViewStyle>}
      {...props}
    />
  );
}

/**
 * Circular day cell used by every date picker sheet: accent-filled selection,
 * hairline ring for today, muted out-of-month days.
 */
export function PickerDayCell({ date, state, marking, onPress, onLongPress }: CalendarDayComponentProps) {
  const theme = useTheme();
  if (!date) return <View style={{ flex: 1 }} />;
  const selected = Boolean(marking?.selected) || state === 'selected';
  const today = state === 'today';
  const disabled = state === 'disabled';
  const inactive = state === 'inactive';
  const textColor = selected
    ? theme.colors.accent.on
    : disabled || inactive
      ? theme.colors.muted
      : today
        ? theme.colors.accent.base
        : theme.colors.text;

  return (
    <Pressable
      onPress={() => onPress?.(date)}
      onLongPress={() => onLongPress?.(date)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={date.dateString}
      accessibilityState={{ selected, disabled }}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected ? theme.colors.accent.base : 'transparent',
          borderWidth: today && !selected ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: theme.colors.accent.base,
        }}>
        <AppText variant="bodySmall" style={{ color: textColor }}>
          {date.day}
        </AppText>
      </View>
    </Pressable>
  );
}

export interface LedgerDayCellProps extends CalendarDayComponentProps {
  /** Money rolled up for the day (signed minor units, formatted by the caller). */
  renderFooter?: (date: DateData) => React.ReactNode;
  highlighted?: boolean;
  intensity?: number;
}

/** Day cell for the cash-flow calendar: an amount line under the day number. */
export function LedgerDayCell({
  date,
  state,
  marking,
  onPress,
  onLongPress,
  renderFooter,
  highlighted,
  intensity = 0,
}: LedgerDayCellProps) {
  const theme = useTheme();
  if (!date) return <View style={{ flex: 1 }} />;
  const selected = Boolean(marking?.selected);
  const today = state === 'today';
  const inactive = state === 'inactive';
  const tint = highlighted ? theme.colors.accent.soft : 'transparent';
  return (
    <Pressable
      onPress={() => onPress?.(date)}
      onLongPress={() => onLongPress?.(date)}
      accessibilityRole="button"
      accessibilityLabel={date.dateString}
      accessibilityState={{ selected }}
      style={{ flex: 1, padding: 1 }}>
      <View
        style={{
          flex: 1,
          minHeight: 54,
          borderRadius: theme.radius.sm,
          paddingHorizontal: 3,
          paddingVertical: 3,
          gap: 1,
          backgroundColor: selected
            ? theme.colors.accent.soft
            : today
              ? theme.colors.neutralSoft
              : tint,
          borderWidth: today || selected ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: theme.colors.accent.base,
          opacity: inactive ? 0.38 : 1,
        }}>
        <AppText
          variant="captionMedium"
          tone={today ? 'accent' : 'secondary'}
          style={{ fontSize: 11.5, lineHeight: 14 }}>
          {date.day}
        </AppText>
        {renderFooter ? renderFooter(date) : null}
        {intensity > 0 ? (
          <View
            style={{
              height: 2.5,
              width: 16,
              borderRadius: 2,
              backgroundColor: theme.colors.accent.base,
              opacity: Math.min(1, 0.25 + intensity * 0.75),
            }}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

/** Month/period chevrons matching the app's icon buttons. */
export function CalendarArrow({ direction, onPress, color }: { direction: 'left' | 'right'; onPress?: () => void; color?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={direction === 'left' ? 'Previous month' : 'Next month'}
      style={{ padding: theme.spacing.sm }}>
      <Ionicons name={direction === 'left' ? 'chevron-back' : 'chevron-forward'} size={18} color={color ?? theme.colors.text} />
    </Pressable>
  );
}

export type { DateData };
