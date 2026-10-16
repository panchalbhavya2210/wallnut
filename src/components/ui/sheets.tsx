import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { useSettingsStore } from '@/stores/settings.store';
import { useTheme } from '@/theme/theme';
import { AppText } from './text';
import { Button } from './controls';
import { PressableBounce } from './bounce';
import { EmptyState } from './feedback';
import {
  addDays,
  addMonths,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  toISODate,
} from '@/utils/date';
import type { IconName } from './layout';

/* ------------------------------- Bottom sheet ------------------------------ */

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Fraction of window height the sheet may occupy. */
  maxHeightRatio?: number;
  footer?: React.ReactNode;
  /** Removes inner padding for full-bleed content. */
  bare?: boolean;
}

export function BottomSheet({ visible, onClose, title, children, maxHeightRatio = 0.88, footer, bare }: BottomSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const translateY = useSharedValue(height);
  const backdrop = useSharedValue(0);

  // The sheet lifts with the keyboard so fields are never hidden behind it.
  // Modal windows on Android do not resize with the soft keyboard, so this
  // padding is the fix rather than relying on `adjustResize`.
  const lifted = Math.max(0, keyboardHeight - insets.bottom);
  const availableHeight = Math.max(260, height - lifted - insets.top - 24);

  useEffect(() => {
    if (visible) {
      backdrop.value = withTiming(1, { duration: theme.motion.fast });
      translateY.value = theme.motion.reduceMotion
        ? 0
        : withSpring(0, { damping: 28, stiffness: 300, overshootClamping: true });
    } else {
      backdrop.value = withTiming(0, { duration: theme.motion.fast });
      translateY.value = withTiming(height, { duration: theme.motion.fast });
    }
  }, [visible, height, theme.motion.reduceMotion, backdrop, translateY]);

  const pan = Gesture.Pan()
    .onUpdate((event) => {
      translateY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (event.translationY > 130 || event.velocityY > 900) {
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, { damping: 28, stiffness: 300, overshootClamping: true });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const maxHeight = Math.min(height * maxHeightRatio, availableHeight);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: lifted }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }, backdropStyle]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View
          style={[
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderTopLeftRadius: theme.radius.xxl,
              borderTopRightRadius: theme.radius.xxl,
              borderColor: theme.colors.border,
              borderWidth: StyleSheet.hairlineWidth,
              maxHeight,
              paddingBottom: Math.max(insets.bottom, theme.spacing.md),
              ...theme.shadow('lg'),
            },
            sheetStyle,
          ]}>
          <GestureDetector gesture={pan}>
            <View style={{ paddingTop: theme.spacing.md, paddingBottom: theme.spacing.sm, alignItems: 'center' }}>
              <View
                style={{
                  width: 38,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: theme.colors.borderStrong,
                }}
              />
              {title ? (
                <AppText variant="titleSmall" style={{ marginTop: theme.spacing.md }}>
                  {title}
                </AppText>
              ) : null}
            </View>
          </GestureDetector>
          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{
              paddingHorizontal: bare ? 0 : theme.spacing.lg,
              paddingBottom: theme.spacing.md + (keyboardHeight > 0 ? theme.spacing.xl : 0),
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
            automaticallyAdjustKeyboardInsets
            showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

/* -------------------------------- Picker sheet ------------------------------ */

export interface PickerItem {
  id: string;
  label: string;
  subtitle?: string | null;
  icon?: IconName;
  color?: string;
  /** Optional grouping label. */
  section?: string;
  keywords?: string;
}

export function PickerSheet({
  visible,
  onClose,
  title,
  items,
  selectedId,
  selectedIds,
  onSelect,
  searchPlaceholder = 'Search…',
  emptyTitle = 'Nothing here yet',
  emptyMessage,
  createLabel,
  onCreate,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  items: PickerItem[];
  selectedId?: string | null;
  /** Multi-select mode: every id in this list renders as selected. */
  selectedIds?: string[];
  onSelect: (item: PickerItem) => void;
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  createLabel?: string;
  onCreate?: () => void;
  footer?: React.ReactNode;
}) {
  const theme = useTheme();
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!visible) setSearch('');
  }, [visible]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        (item.subtitle ?? '').toLowerCase().includes(query) ||
        (item.keywords ?? '').toLowerCase().includes(query),
    );
  }, [items, search]);

  const sections = useMemo(() => {
    const map = new Map<string, PickerItem[]>();
    for (const item of filtered) {
      const key = item.section ?? '';
      const bucket = map.get(key) ?? [];
      bucket.push(item);
      map.set(key, bucket);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} footer={footer}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          backgroundColor: theme.colors.inputBackground,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          paddingHorizontal: theme.spacing.md,
          height: 42,
          marginBottom: theme.spacing.md,
        }}>
        <Ionicons name="search-outline" size={16} color={theme.colors.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={searchPlaceholder}
          placeholderTextColor={theme.colors.muted}
          style={{ flex: 1, color: theme.colors.text, fontFamily: theme.typography.body.fontFamily, fontSize: 15, paddingVertical: 0 }}
          autoCorrect={false}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={theme.colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {createLabel && onCreate ? (
        <Pressable
          onPress={onCreate}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            paddingVertical: theme.spacing.md,
            opacity: pressed ? 0.7 : 1,
          })}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: theme.radius.md,
              backgroundColor: `${theme.colors.accent.base}22`,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Ionicons name="add" size={18} color={theme.colors.accent.base} />
          </View>
          <AppText variant="bodyMedium" tone="accent">
            {createLabel}
          </AppText>
        </Pressable>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState icon="search-outline" title={emptyTitle} message={emptyMessage} compact />
      ) : (
        sections.map(([section, sectionItems]) => (
          <View key={section || 'all'}>
            {section ? (
              <AppText variant="label" tone="muted" style={{ marginTop: theme.spacing.md, marginBottom: theme.spacing.xs }}>
                {section}
              </AppText>
            ) : null}
            {sectionItems.map((item) => {
              const selected = selectedIds ? selectedIds.includes(item.id) : item.id === selectedId;
              return (
                <PressableBounce
                  key={item.id}
                  onPress={() => onSelect(item)}
                  scaleTo={0.98}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  accessibilityState={{ selected }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    paddingVertical: theme.spacing.md,
                    paddingHorizontal: selected ? theme.spacing.sm : 0,
                    borderRadius: theme.radius.md,
                    backgroundColor: selected ? `${item.color ?? theme.colors.accent.base}14` : 'transparent',
                  }}>
                  {item.icon ? (
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: theme.radius.md,
                        backgroundColor: `${item.color ?? theme.colors.accent.base}22`,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                      <Ionicons name={item.icon} size={17} color={item.color ?? theme.colors.accent.base} />
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <AppText variant="bodyMedium" numberOfLines={1}>
                      {item.label}
                    </AppText>
                    {item.subtitle ? (
                      <AppText variant="caption" tone="muted" numberOfLines={1}>
                        {item.subtitle}
                      </AppText>
                    ) : null}
                  </View>
                  {selected ? <Ionicons name="checkmark-circle" size={20} color={theme.colors.accent.base} /> : null}
                </PressableBounce>
              );
            })}
          </View>
        ))
      )}
    </BottomSheet>
  );
}

/* ------------------------------ Date picker sheet --------------------------- */

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function DatePickerSheet({
  visible,
  onClose,
  value,
  onSelect,
  title = 'Choose date',
}: {
  visible: boolean;
  onClose: () => void;
  value: Date;
  onSelect: (date: Date) => void;
  title?: string;
}) {
  const theme = useTheme();
  const [month, setMonth] = useState(() => startOfMonth(value));

  useEffect(() => {
    if (visible) setMonth(startOfMonth(value));
  }, [visible, value]);

  const cells = useMemo(() => {
    const first = startOfMonth(month);
    const gridStart = startOfWeek(first, { weekStartsOn: 1 });
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [month]);

  const today = new Date();
  const quick = [
    { label: 'Today', date: today },
    { label: 'Yesterday', date: addDays(today, -1) },
    { label: 'Tomorrow', date: addDays(today, 1) },
  ];

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} maxHeightRatio={0.8}>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.lg }}>
        {quick.map((entry) => (
          <Pressable
            key={entry.label}
            onPress={() => {
              onSelect(entry.date);
              onClose();
            }}
            style={{
              paddingHorizontal: theme.spacing.lg,
              height: 32,
              borderRadius: theme.radius.full,
              backgroundColor: theme.colors.inputBackground,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <AppText variant="captionMedium" tone="secondary">
              {entry.label}
            </AppText>
          </Pressable>
        ))}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.md }}>
        <Pressable onPress={() => setMonth(addMonths(month, -1))} hitSlop={10} style={{ padding: theme.spacing.sm }}>
          <Ionicons name="chevron-back" size={18} color={theme.colors.text} />
        </Pressable>
        <AppText variant="titleSmall">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </AppText>
        <Pressable onPress={() => setMonth(addMonths(month, 1))} hitSlop={10} style={{ padding: theme.spacing.sm }}>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.text} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', marginBottom: theme.spacing.xs }}>
        {WEEKDAYS.map((day, index) => (
          <View key={`${day}-${index}`} style={{ flex: 1, alignItems: 'center', paddingVertical: theme.spacing.xs }}>
            <AppText variant="caption" tone="muted">
              {day}
            </AppText>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((cell) => {
          const inMonth = isSameMonth(cell, month);
          const selected = isSameDay(cell, value);
          const isToday = isSameDay(cell, today);
          return (
            <Pressable
              key={toISODate(cell)}
              onPress={() => {
                onSelect(cell);
                onClose();
              }}
              style={{ width: `${100 / 7}%`, height: 42, alignItems: 'center', justifyContent: 'center' }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: selected ? theme.colors.accent.base : 'transparent',
                  borderWidth: isToday && !selected ? StyleSheet.hairlineWidth * 2 : 0,
                  borderColor: theme.colors.accent.base,
                }}>
                <AppText
                  variant="bodySmall"
                  style={{
                    color: selected
                      ? theme.colors.accent.on
                      : inMonth
                        ? theme.colors.text
                        : theme.colors.muted,
                  }}>
                  {cell.getDate()}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

/* -------------------------------- Form sheet -------------------------------- */

/** Reusable sheet for small forms (budget, goal, debt) with a submit button. */
export function FormSheet({
  visible,
  onClose,
  title,
  children,
  submitLabel = 'Save',
  onSubmit,
  submitDisabled,
  destructive,
  onDelete,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  submitLabel?: string;
  onSubmit: () => void;
  submitDisabled?: boolean;
  destructive?: boolean;
  onDelete?: () => void;
}) {
  const theme = useTheme();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {destructive && onDelete ? (
            <Button label="Delete" variant="danger" onPress={onDelete} style={{ flex: 1 }} />
          ) : null}
          <Button
            label={submitLabel}
            onPress={onSubmit}
            disabled={submitDisabled}
            style={{ flex: 1 }}
          />
        </View>
      }>
      <View style={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>{children}</View>
    </BottomSheet>
  );
}

/* ------------------------------ Text field ---------------------------------- */

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  multiline,
  autoFocus,
  prefix,
  suffix,
  style,
  money,
}: {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad' | 'email-address';
  multiline?: boolean;
  autoFocus?: boolean;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<ViewStyle>;
  /** Formats digits as they are typed (1,23,456.78) and returns the raw string. */
  money?: boolean;
}) {
  const theme = useTheme();
  const grouping = useSettingsStore((state) => state.general.numberGrouping);
  const displayValue = money ? formatAmountInput(value, grouping) : value;
  return (
    <View style={[{ gap: theme.spacing.xs }, style]}>
      {label ? (
        <AppText variant="captionMedium" tone="secondary">
          {label}
        </AppText>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          gap: theme.spacing.sm,
          backgroundColor: theme.colors.inputBackground,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: multiline ? theme.spacing.md : 0,
          minHeight: 46,
          minWidth: 0,
        }}>
        {prefix ? (
          <AppText variant="bodyMedium" tone="muted">
            {prefix}
          </AppText>
        ) : null}
        <TextInput
          value={displayValue}
          onChangeText={(next) => onChangeText(money ? normalizeAmountInput(next) : next)}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.muted}
          keyboardType={keyboardType}
          multiline={multiline}
          autoFocus={autoFocus}
          style={{
            flex: 1,
            minWidth: 0,
            color: theme.colors.text,
            fontFamily: theme.typography.body.fontFamily,
            fontSize: 15,
            paddingVertical: 0,
            minHeight: multiline ? 64 : undefined,
            textAlignVertical: multiline ? 'top' : 'center',
          }}
        />
        {suffix ? (
          <AppText variant="bodyMedium" tone="muted">
            {suffix}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/** Strips grouping and non-numeric characters, caps at two decimals, and returns a parseable string. */
export function normalizeAmountInput(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const [whole = '', ...rest] = cleaned.split('.');
  const decimals = rest.join('').slice(0, 2);
  const trimmedWhole = whole.replace(/^0+(?=\d)/, '');
  return rest.length > 0 ? `${trimmedWhole || '0'}.${decimals}` : trimmedWhole;
}

/** Groups the integer part for display without touching the stored value. */
export function formatAmountInput(raw: string, grouping: 'indian' | 'western'): string {
  if (!/^[0-9]*(\.[0-9]*)?$/.test(raw)) return raw;
  const [whole = '', decimals] = raw.split('.');
  const grouped = whole ? Number(whole).toLocaleString(grouping === 'indian' ? 'en-IN' : 'en-US', { maximumFractionDigits: 0 }) : whole;
  return raw.includes('.') ? `${grouped}.${decimals ?? ''}` : grouped;
}

/* ------------------------------ Amount field -------------------------------- */

/**
 * Text-based amount input that keeps money in integer minor units via the
 * money parser. Used inside forms; the quick-add flow uses the keypad instead.
 */
export function AmountField({
  label,
  valueMinor,
  onChangeMinor,
  currencySymbol,
  autoFocus,
}: {
  label?: string;
  valueMinor: number;
  onChangeMinor: (minor: number) => void;
  currencySymbol: string;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  const [text, setText] = useState(() => (valueMinor ? (valueMinor / 100).toFixed(2).replace(/\.00$/, '') : ''));

  useEffect(() => {
    const next = valueMinor ? (valueMinor / 100).toFixed(2).replace(/\.00$/, '') : '';
    setText((current) => {
      const parsed = Number(current.replace(/,/g, ''));
      return Number.isFinite(parsed) && Math.round(parsed * 100) === valueMinor ? current : next;
    });
  }, [valueMinor]);

  return (
    <Field
      label={label}
      value={text}
      onChangeText={(next) => {
        setText(next);
        const cleaned = Number(next.replace(/,/g, ''));
        onChangeMinor(Number.isFinite(cleaned) ? Math.round(cleaned * 100) : 0);
      }}
      placeholder="0"
      keyboardType="decimal-pad"
      prefix={currencySymbol}
      money
      autoFocus={autoFocus}
      style={{ backgroundColor: theme.colors.inputBackground }}
    />
  );
}
