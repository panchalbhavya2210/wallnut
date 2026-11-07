import React from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
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
  const { typography } = theme;
  const c = theme.m3.color;
  return {
    backgroundColor: c.surfaceContainerLow,
    calendarBackground: c.surfaceContainerLow,
    textSectionTitleColor: c.onSurfaceVariant,
    textSectionTitleDisabledColor: c.outline,
    selectedDayBackgroundColor: c.primary,
    selectedDayTextColor: c.onPrimary,
    todayTextColor: c.primary,
    todayBackgroundColor: 'transparent',
    dayTextColor: c.onSurface,
    textDisabledColor: c.outline,
    textInactiveColor: c.outline,
    monthTextColor: c.onSurface,
    textMonthFontFamily: typography.titleMedium.fontFamily,
    textMonthFontSize: 16,
    textMonthFontWeight: '600',
    textDayFontFamily: typography.bodyLarge.fontFamily,
    textDayHeaderFontFamily: typography.labelMedium.fontFamily,
    textDayFontSize: 14,
    textDayHeaderFontSize: 12,
    arrowColor: c.primary,
    disabledArrowColor: c.outline,
    dotColor: c.primary,
    selectedDotColor: c.onPrimary,
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
      style={[{ borderRadius: theme.m3.shape.large, overflow: 'hidden' }, style] as StyleProp<ViewStyle>}
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
  const c = theme.m3.color;
  const selected = Boolean(marking?.selected) || state === 'selected';
  const today = state === 'today';
  const disabled = state === 'disabled';
  const inactive = state === 'inactive';
  const textColor = selected
    ? c.onPrimary
    : disabled || inactive
      ? c.outline
      : today
        ? c.primary
        : c.onSurface;

  return (
    <Pressable
      onPress={() => onPress?.(date)}
      onLongPress={() => onLongPress?.(date)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={date.dateString}
      accessibilityState={{ selected, disabled }}
      style={[
        { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
        Platform.OS === 'web' ? ({ outlineWidth: 0, outlineColor: 'transparent' } as ViewStyle) : null,
      ]}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: theme.m3.shape.full,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected ? c.primary : 'transparent',
          borderWidth: today && !selected ? 1 : 0,
          borderColor: c.primary,
        }}>
        <AppText variant="bodyMedium" style={{ color: textColor }}>
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
  const c = theme.m3.color;
  const selected = Boolean(marking?.selected);
  const today = state === 'today';
  const inactive = state === 'inactive';

  return (
    <Pressable
      onPress={() => onPress?.(date)}
      onLongPress={() => onLongPress?.(date)}
      accessibilityRole="button"
      accessibilityLabel={date.dateString}
      accessibilityState={{ selected }}
      style={[
        { flex: 1, padding: 2 },
        Platform.OS === 'web' ? ({ outlineWidth: 0, outlineColor: 'transparent' } as ViewStyle) : null,
      ]}>
      <View
        style={{
          flex: 1,
          minHeight: 64,
          borderRadius: theme.m3.shape.medium,
          paddingHorizontal: 5,
          paddingVertical: 4,
          gap: 1,
          backgroundColor: selected
            ? c.primaryContainer
            : highlighted
              ? c.surfaceContainerHigh
              : 'transparent',
          borderWidth: today && !selected ? 1 : 0,
          borderColor: c.primary,
          opacity: inactive ? 0.38 : 1,
        }}>
        <AppText
          variant="labelMedium"
          style={{
            color: selected ? c.onPrimaryContainer : today ? c.primary : c.onSurface,
            fontSize: 11.5,
            lineHeight: 14,
          }}>
          {date.day}
        </AppText>
        {renderFooter ? renderFooter(date) : null}
        {intensity > 0 ? (
          <View
            style={{
              height: 2.5,
              width: 14,
              borderRadius: 2,
              backgroundColor: selected ? c.onPrimaryContainer : c.primary,
              opacity: Math.min(1, 0.3 + intensity * 0.7),
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
