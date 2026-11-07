import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
  type BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import { ReduceMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSettingsStore } from '@/stores/settings.store';
import { useTheme } from '@/theme/theme';
import { AppText } from './text';
import { Button, Chip } from './controls';
import { PressableBounce } from './bounce';
import { EmptyState } from './feedback';
import { AppCalendar, PickerDayCell } from './calendar';
import { addDays, fromISODate, toISODate } from '@/utils/date';
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

/**
 * App-wide bottom sheet.
 *
 * Backed by `@gorhom/bottom-sheet` — a portal rendered once at the app root —
 * instead of React Native's native `Modal`. This is deliberate: on Android the
 * new architecture corrupts `Modal` windows that contain Reanimated styles
 * (sheets open squashed, invisible, or not at all), and two `Modal`s cannot be
 * reliably shown at the same time (filter → picker → date). The portal engine
 * has no native window, stacks sheets correctly, handles the Android back
 * button and the keyboard, and keeps the same API for every caller.
 */
export function BottomSheet({ visible, onClose, title, children, maxHeightRatio = 0.88, footer, bare }: BottomSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const sheetRef = useRef<BottomSheetModal>(null);
  const visibleRef = useRef(visible);
  const firstRender = useRef(true);
  const onCloseRef = useRef(onClose);
  const c = theme.m3.color;

  useEffect(() => {
    visibleRef.current = visible;
    onCloseRef.current = onClose;
  });

  const maxHeight = Math.max(280, Math.min(height * maxHeightRatio, height - insets.top - 24));

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      // Some callers mount the sheet already open (e.g. the filter sheet).
      // Give the portal one frame to attach before presenting.
      if (visible) {
        const frame = requestAnimationFrame(() => sheetRef.current?.present());
        return () => cancelAnimationFrame(frame);
      }
      return;
    }
    if (visible) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [visible]);

  // The portal-based sheet is not a native window, so it does not get Android's
  // back button for free (React Native's Modal did). Register while open; the
  // most recently opened sheet runs first, which matches the visual stack.
  useEffect(() => {
    if (!visible || Platform.OS === 'web') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onCloseRef.current();
      return true;
    });
    return () => subscription.remove();
  }, [visible]);

  // Closing from the backdrop/swipe is completed by the sheet itself; mirror it
  // back into the caller's state. A caller-driven close never loops because
  // `visible` is already false by the time this runs.
  const handleDismiss = useCallback(() => {
    if (visibleRef.current) onCloseRef.current();
  }, []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.4}
        pressBehavior="close"
      />
    ),
    [],
  );

  const renderHandle = useCallback(
    () => (
      <View style={{ paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.sm, alignItems: 'center' }}>
        <View
          style={{
            width: theme.m3.size.sheetHandleWidth,
            height: theme.m3.size.sheetHandleHeight,
            borderRadius: theme.m3.size.sheetHandleHeight / 2,
            backgroundColor: c.onSurfaceVariant,
            opacity: 0.4,
          }}
        />
        {title ? (
          <AppText variant="titleLarge" style={{ marginTop: theme.spacing.md }}>
            {title}
          </AppText>
        ) : null}
        <Pressable
          onPress={() => onCloseRef.current()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => ({
            position: 'absolute',
            top: theme.spacing.sm,
            right: theme.spacing.lg,
            width: 40,
            height: 40,
            borderRadius: theme.m3.shape.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? theme.colors.pressed : 'transparent',
          })}>
          <Ionicons name="close" size={22} color={c.onSurfaceVariant} />
        </Pressable>
      </View>
    ),
    // `onClose` is read through a ref so typing in a field never remounts the
    // handle (which would interrupt an in-flight drag).
    [theme, title, c.onSurfaceVariant],
  );

  const renderFooter = useCallback(
    ({ animatedFooterPosition }: BottomSheetFooterProps) => (
      <BottomSheetFooter animatedFooterPosition={animatedFooterPosition} bottomInset={insets.bottom}>
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.sm,
            paddingBottom: theme.spacing.md,
            backgroundColor: c.surfaceContainerLow,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.outlineVariant,
          }}>
          {footer}
        </View>
      </BottomSheetFooter>
    ),
    [footer, insets.bottom, theme, c.outlineVariant, c.surfaceContainerLow],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      // Keep the parent sheet open underneath instead of minimizing/restoring
      // it. The filter → picker → date stack is then a pure render-order stack
      // with no restore animation to race against (Android was flaky there).
      stackBehavior="push"
      enableDynamicSizing
      maxDynamicContentSize={maxHeight}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      footerComponent={footer ? renderFooter : undefined}
      handleComponent={renderHandle}
      onDismiss={handleDismiss}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      overrideReduceMotion={theme.motion.reduceMotion ? ReduceMotion.Always : ReduceMotion.System}
      accessible
      accessibilityLabel={title}
      backgroundStyle={{
        backgroundColor: c.surfaceContainerLow,
        borderTopLeftRadius: theme.m3.shape.extraLarge,
        borderTopRightRadius: theme.m3.shape.extraLarge,
      }}>
      <BottomSheetScrollView
        contentContainerStyle={{
          paddingHorizontal: bare ? 0 : theme.spacing.lg,
          paddingBottom: theme.spacing.md + (footer ? 0 : Math.max(insets.bottom, theme.spacing.md)),
        }}
        enableFooterMarginAdjustment={Boolean(footer)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
        showsVerticalScrollIndicator={false}>
        {children}
      </BottomSheetScrollView>
    </BottomSheetModal>
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
          backgroundColor: theme.m3.color.surfaceContainerHigh,
          borderRadius: theme.m3.shape.full,
          paddingHorizontal: theme.spacing.lg,
          height: theme.m3.size.searchBar,
          marginBottom: theme.spacing.md,
        }}>
        <Ionicons name="search" size={22} color={theme.m3.color.onSurfaceVariant} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={searchPlaceholder}
          placeholderTextColor={theme.m3.color.onSurfaceVariant}
          style={{ flex: 1, color: theme.m3.color.onSurface, fontFamily: theme.typography.bodyLarge.fontFamily, fontSize: theme.typography.bodyLarge.fontSize, paddingVertical: 0 }}
          autoCorrect={false}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={20} color={theme.m3.color.onSurfaceVariant} />
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

/**
 * Every date picker in the app opens this sheet — now backed by the maintained
 * `react-native-calendars` grid (month navigation, swipe, accessibility) with
 * Wallnut's theming instead of a hand-rolled month view.
 */
export function DatePickerSheet({
  visible,
  onClose,
  value,
  onSelect,
  title = 'Choose date',
  minDate,
  maxDate,
}: {
  visible: boolean;
  onClose: () => void;
  value: Date;
  onSelect: (date: Date) => void;
  title?: string;
  /** YYYY-MM-DD bounds (greyed out and not selectable). */
  minDate?: string;
  maxDate?: string;
}) {
  const theme = useTheme();

  const today = new Date();
  const quick = [
    { label: 'Today', date: today },
    { label: 'Yesterday', date: addDays(today, -1) },
    { label: 'Tomorrow', date: addDays(today, 1) },
  ].filter((entry) => {
    const iso = toISODate(entry.date);
    if (minDate && iso < minDate) return false;
    if (maxDate && iso > maxDate) return false;
    return true;
  });

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} maxHeightRatio={0.86}>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.md }}>
        {quick.map((entry) => (
          <Chip
            key={entry.label}
            size="sm"
            label={entry.label}
            selected={toISODate(entry.date) === toISODate(value)}
            onPress={() => {
              onSelect(entry.date);
              onClose();
            }}
          />
        ))}
      </View>

      <AppCalendar
        initialDate={toISODate(value)}
        minDate={minDate}
        maxDate={maxDate}
        dayComponent={PickerDayCell}
        onDayPress={(day) => {
          const parsed = fromISODate(day.dateString);
          if (!parsed) return;
          onSelect(parsed);
          onClose();
        }}
      />
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
  const [focused, setFocused] = React.useState(false);
  const c = theme.m3.color;
  return (
    <View style={[{ gap: theme.spacing.xs }, style]}>
      {label ? (
        <AppText variant="labelMedium" tone="secondary">
          {label}
        </AppText>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          gap: theme.spacing.sm,
          backgroundColor: c.surfaceContainerHighest,
          borderTopLeftRadius: theme.m3.shape.extraSmall,
          borderTopRightRadius: theme.m3.shape.extraSmall,
          borderBottomWidth: focused ? 2 : 1,
          borderBottomColor: focused ? c.primary : c.onSurfaceVariant,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: multiline ? theme.spacing.md : 0,
          minHeight: 56,
          minWidth: 0,
        }}>
        {prefix ? (
          <AppText variant="bodyLarge" tone="muted">
            {prefix}
          </AppText>
        ) : null}
        <TextInput
          value={displayValue}
          onChangeText={(next) => onChangeText(money ? normalizeAmountInput(next) : next)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={c.onSurfaceVariant}
          keyboardType={keyboardType}
          multiline={multiline}
          autoFocus={autoFocus}
          style={{
            flex: 1,
            minWidth: 0,
            color: c.onSurface,
            fontFamily: theme.typography.bodyLarge.fontFamily,
            fontSize: theme.typography.bodyLarge.fontSize,
            paddingVertical: 0,
            minHeight: multiline ? 64 : undefined,
            textAlignVertical: multiline ? 'top' : 'center',
          }}
        />
        {suffix ? (
          <AppText variant="bodyLarge" tone="muted">
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
    />
  );
}
