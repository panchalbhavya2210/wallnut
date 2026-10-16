import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { AppText } from '@/components/ui/text';
import { Button, Chip, IconButton } from '@/components/ui/controls';
import { BottomSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { Row, ScrollScreen, IconName } from '@/components/ui/layout';
import { useQuery } from '@/hooks/useQuery';
import { toast } from '@/stores/ui.store';
import { useSettingsStore } from '@/stores/settings.store';
import { getDb } from '@/db/client';
import { dashboardWidgets, type DashboardWidget } from '@/db/schema';
import { asc, eq } from 'drizzle-orm';
import { getWidgetDefinition, listWidgetDefinitions, WIDGET_PRESETS } from '@/components/widgets';
import { createId } from '@/utils/id';
import { notifyDbChanged } from '@/stores/db.store';
import type { PeriodPreset } from '@/utils/date';
import { PeriodChips } from '@/components/PeriodPicker';

/**
 * Customise dashboard — drag to reorder, toggle visibility, size each widget,
 * give any widget its own period, apply presets or reset to the default set.
 */

const ROW_HEIGHT = 58;

export default function DashboardSettings() {
  const theme = useTheme();
  const density = useSettingsStore((state) => state.dashboard.density);
  const defaultPeriod = useSettingsStore((state) => state.dashboard.defaultPeriod);
  const updateDashboard = useSettingsStore((state) => state.update);
  const [configuring, setConfiguring] = useState<DashboardWidget | null>(null);
  const [addingOpen, setAddingOpen] = useState(false);

  const query = useQuery(async () => {
    const db = getDb();
    return db.select().from(dashboardWidgets).orderBy(asc(dashboardWidgets.position));
  }, []);

  const widgets = query.data ?? [];
  const visible = useMemo(() => widgets.filter((widget) => widget.isVisible), [widgets]);
  const hidden = useMemo(() => widgets.filter((widget) => !widget.isVisible), [widgets]);
  const usedTypes = useMemo(() => new Set(widgets.map((widget) => widget.type)), [widgets]);
  const availableTypes = useMemo(
    () => listWidgetDefinitions().filter((definition) => !usedTypes.has(definition.type)),
    [usedTypes],
  );

  const persistOrder = useCallback(async (ordered: DashboardWidget[]) => {
    const db = getDb();
    for (let index = 0; index < ordered.length; index++) {
      await db.update(dashboardWidgets).set({ position: index }).where(eq(dashboardWidgets.id, ordered[index]!.id));
    }
    notifyDbChanged();
  }, []);

  const reorder = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      const next = [...visible];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return;
      next.splice(toIndex, 0, moved);
      await persistOrder(next);
    },
    [visible, persistOrder],
  );

  const toggleVisibility = async (widget: DashboardWidget, isVisible: boolean) => {
    const db = getDb();
    await db.update(dashboardWidgets).set({ isVisible }).where(eq(dashboardWidgets.id, widget.id));
    if (isVisible) {
      const max = widgets.reduce((value, entry) => Math.max(value, entry.position), -1);
      await db.update(dashboardWidgets).set({ position: max + 1 }).where(eq(dashboardWidgets.id, widget.id));
    }
    notifyDbChanged();
    toast.show(isVisible ? `${getWidgetDefinition(widget.type)?.title ?? 'Widget'} shown` : 'Widget hidden');
  };

  const addWidget = async (type: string) => {
    const definition = getWidgetDefinition(type);
    if (!definition) return;
    const db = getDb();
    const max = widgets.reduce((value, entry) => Math.max(value, entry.position), -1);
    await db.insert(dashboardWidgets).values({
      id: createId('wdg'),
      type,
      position: max + 1,
      width: definition.defaultWidth,
      height: definition.defaultHeight,
      configuration: '{}',
      isVisible: true,
    });
    notifyDbChanged();
    setAddingOpen(false);
    toast.show(`${definition.title} added`);
  };

  const applyPreset = async (presetKey: string) => {
    const preset = WIDGET_PRESETS[presetKey];
    if (!preset) return;
    const ok = await confirm({
      title: `Apply the ${preset.label} preset?`,
      message: 'Your current widget arrangement will be replaced. Your data is untouched.',
      confirmLabel: 'Apply preset',
    });
    if (!ok) return;

    const db = getDb();
    await db.delete(dashboardWidgets);
    let position = 0;
    for (const type of preset.widgets) {
      const definition = getWidgetDefinition(type);
      if (!definition) continue;
      await db.insert(dashboardWidgets).values({
        id: createId('wdg'),
        type,
        position: position++,
        width: definition.defaultWidth,
        height: definition.defaultHeight,
        configuration: '{}',
        isVisible: true,
      });
    }
    notifyDbChanged();
    toast.success(`${preset.label} preset applied`);
  };

  const resetToDefault = async () => {
    await applyPreset('overview');
  };

  return (
    <ScrollScreen>
      <Row gap="sm" style={{ paddingTop: theme.spacing.md, paddingBottom: theme.spacing.md }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText variant="title">Dashboard</AppText>
          <AppText variant="caption" tone="muted">
            {visible.length} shown · {hidden.length} hidden
          </AppText>
        </View>
        <IconButton icon="add" onPress={() => setAddingOpen(true)} accessibilityLabel="Add widget" />
      </Row>

      <View style={{ gap: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="label" tone="muted">
            PRESETS
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {Object.entries(WIDGET_PRESETS).map(([key, preset]) => (
              <Chip key={key} label={preset.label} onPress={() => applyPreset(key)} />
            ))}
          </View>
          <AppText variant="caption" tone="muted">
            Presets swap which widgets appear. Everything stays editable afterwards.
          </AppText>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="label" tone="muted">
            SHOWN — LONG-PRESS THE HANDLE TO DRAG
          </AppText>
          <View style={{ height: visible.length * ROW_HEIGHT }}>
            {visible.map((widget, index) => (
              <DraggableWidgetRow
                key={widget.id}
                widget={widget}
                index={index}
                total={visible.length}
                onReorder={reorder}
                onToggle={() => toggleVisibility(widget, false)}
                onConfigure={() => setConfiguring(widget)}
                isFirst={index === 0}
                isLast={index === visible.length - 1}
                onMoveUp={() => reorder(index, Math.max(0, index - 1))}
                onMoveDown={() => reorder(index, Math.min(visible.length - 1, index + 1))}
              />
            ))}
          </View>
        </View>

        {hidden.length > 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="label" tone="muted">
              HIDDEN
            </AppText>
            <View style={{ borderRadius: theme.radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, overflow: 'hidden' }}>
              {hidden.map((widget, index) => {
                const definition = getWidgetDefinition(widget.type);
                return (
                  <Row
                    key={widget.id}
                    gap="md"
                    justify="space-between"
                    style={{
                      paddingHorizontal: theme.spacing.lg,
                      height: ROW_HEIGHT,
                      borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                      borderTopColor: theme.colors.border,
                      opacity: 0.7,
                    }}>
                    <Row gap="md" style={{ flex: 1 }}>
                      <Ionicons name={(definition?.icon ?? 'apps-outline') as IconName} size={17} color={theme.colors.muted} />
                      <AppText variant="bodyMedium" numberOfLines={1}>
                        {definition?.title ?? widget.type}
                      </AppText>
                    </Row>
                    <IconButton icon="add-circle-outline" onPress={() => toggleVisibility(widget, true)} accessibilityLabel="Show widget" />
                  </Row>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="label" tone="muted">
            DENSITY
          </AppText>
          <Row gap="sm">
            <Chip label="Comfortable" selected={density === 'comfortable'} onPress={() => updateDashboard('dashboard', { density: 'comfortable' })} />
            <Chip label="Compact" selected={density === 'compact'} onPress={() => updateDashboard('dashboard', { density: 'compact' })} />
          </Row>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="label" tone="muted">
            DEFAULT PERIOD FOR WIDGETS
          </AppText>
          <PeriodChips
            value={defaultPeriod}
            onChange={(period) => updateDashboard('dashboard', { defaultPeriod: period })}
            options={['7d', '30d', '3m', '6m', '1y', 'thisMonth', 'lastMonth']}
          />
          <AppText variant="caption" tone="muted">
            Individual widgets can override this from their configure sheet.
          </AppText>
        </View>

        <Button label="Reset to default dashboard" variant="secondary" icon="refresh-outline" onPress={resetToDefault} />

        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="label" tone="muted">
            AVAILABLE WIDGETS
          </AppText>
          {listWidgetDefinitions().map((definition) => (
            <Row key={definition.type} gap="md" justify="space-between" style={{ paddingVertical: theme.spacing.sm }}>
              <Row gap="md" style={{ flex: 1 }}>
                <Ionicons name={definition.icon} size={16} color={theme.colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <AppText variant="bodySmall">{definition.title}</AppText>
                  <AppText variant="caption" tone="muted">
                    {definition.description}
                  </AppText>
                </View>
              </Row>
              {usedTypes.has(definition.type) ? (
                <AppText variant="caption" tone="muted">
                  on dashboard
                </AppText>
              ) : (
                <IconButton icon="add" onPress={() => addWidget(definition.type)} accessibilityLabel={`Add ${definition.title}`} />
              )}
            </Row>
          ))}
        </View>
      </View>

      {/* Add widget sheet (kept for quick access from the header) */}
      <BottomSheet visible={addingOpen} onClose={() => setAddingOpen(false)} title="Add widget">
        <View style={{ gap: theme.spacing.sm }}>
          {availableTypes.length === 0 ? (
            <AppText variant="bodySmall" tone="muted">
              Every widget is already on your dashboard. Hide one to re-add it later.
            </AppText>
          ) : (
            availableTypes.map((definition) => (
              <Pressable
                key={definition.type}
                onPress={() => addWidget(definition.type)}
                android_ripple={{ color: theme.colors.ripple }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.md }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.neutralSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Ionicons name={definition.icon} size={17} color={theme.colors.textSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyMedium">{definition.title}</AppText>
                  <AppText variant="caption" tone="muted">
                    {definition.description}
                  </AppText>
                </View>
                <Ionicons name="add" size={18} color={theme.colors.accent.base} />
              </Pressable>
            ))
          )}
        </View>
      </BottomSheet>

      {/* Configure sheet */}
      <WidgetConfigSheet
        widget={configuring}
        onClose={() => setConfiguring(null)}
        onChanged={() => query.refresh()}
      />
    </ScrollScreen>
  );
}

/* ------------------------------ Draggable row ------------------------------ */

function DraggableWidgetRow({
  widget,
  index,
  total,
  onReorder,
  onToggle,
  onConfigure,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
}: {
  widget: DashboardWidget;
  index: number;
  total: number;
  onReorder: (from: number, to: number) => void;
  onToggle: () => void;
  onConfigure: () => void;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const theme = useTheme();
  const definition = getWidgetDefinition(widget.type);
  const translateY = useSharedValue(0);
  const [dragging, setDragging] = useState(false);

  const commit = useCallback(
    (offsetY: number) => {
      const target = Math.max(0, Math.min(total - 1, index + Math.round(offsetY / ROW_HEIGHT)));
      onReorder(index, target);
      translateY.value = 0;
    },
    [index, total, onReorder, translateY],
  );

  const pan = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart(() => {
      runOnJS(setDragging)(true);
    })
    .onUpdate((event) => {
      translateY.value = event.translationY;
    })
    .onEnd((event) => {
      runOnJS(commit)(event.translationY);
      runOnJS(setDragging)(false);
    })
    .onFinalize(() => {
      translateY.value = withSpring(0, { damping: 24, stiffness: 280 });
      runOnJS(setDragging)(false);
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    zIndex: dragging ? 10 : 1,
    opacity: dragging ? 0.96 : 1,
    shadowOpacity: dragging ? 0.25 : 0,
  }));

  let config: { period?: PeriodPreset } = {};
  try {
    config = JSON.parse(widget.configuration || '{}') as { period?: PeriodPreset };
  } catch {
    config = {};
  }

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          top: index * ROW_HEIGHT,
          height: ROW_HEIGHT,
          backgroundColor: dragging ? theme.colors.surfaceElevated : 'transparent',
        },
        style,
      ]}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          height: ROW_HEIGHT,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          marginBottom: 6,
        }}>
        <GestureDetector gesture={pan}>
          <View style={{ padding: 6 }} accessibilityLabel="Drag handle">
            <Ionicons name="reorder-three-outline" size={20} color={theme.colors.muted} />
          </View>
        </GestureDetector>
        <Pressable onPress={onConfigure} style={{ flex: 1 }} android_ripple={{ color: theme.colors.ripple }}>
          <AppText variant="bodyMedium" numberOfLines={1}>
            {definition?.title ?? widget.type}
          </AppText>
          <AppText variant="caption" tone="muted">
            {widget.width === 'half' ? 'Half width' : 'Full width'} ·{' '}
            {config.period ? config.period.toUpperCase() : `default (${'—'})`}
          </AppText>
        </Pressable>
        <View style={{ alignItems: 'flex-end' }}>
          <IconButton icon={isFirst ? 'chevron-up-outline' : 'chevron-up'} onPress={onMoveUp} disabled={isFirst} size={30} accessibilityLabel="Move up" />
          <IconButton icon={isLast ? 'chevron-down-outline' : 'chevron-down'} onPress={onMoveDown} disabled={isLast} size={30} accessibilityLabel="Move down" />
        </View>
        <IconButton icon="eye-off-outline" onPress={onToggle} size={34} accessibilityLabel="Hide widget" />
      </View>
    </Animated.View>
  );
}

/* ----------------------------- Configure sheet ----------------------------- */

function WidgetConfigSheet({
  widget,
  onClose,
  onChanged,
}: {
  widget: DashboardWidget | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const theme = useTheme();
  const defaultPeriod = useSettingsStore((state) => state.dashboard.defaultPeriod);
  const [config, setConfig] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!widget) return;
    try {
      setConfig(JSON.parse(widget.configuration || '{}') as Record<string, unknown>);
    } catch {
      setConfig({});
    }
  }, [widget]);

  if (!widget) return null;
  const definition = getWidgetDefinition(widget.type);
  const period = (config.period as PeriodPreset | undefined) ?? undefined;

  const update = async (patch: Partial<DashboardWidget>) => {
    const db = getDb();
    await db.update(dashboardWidgets).set(patch).where(eq(dashboardWidgets.id, widget.id));
    notifyDbChanged();
    onChanged();
  };

  const updateConfig = async (patch: Record<string, unknown>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    await update({ configuration: JSON.stringify(next) });
  };

  return (
    <BottomSheet
      visible={Boolean(widget)}
      onClose={onClose}
      title={definition?.title ?? 'Widget'}
      footer={
        <Row gap="sm">
          <Button
            label="Remove from dashboard"
            variant="danger"
            onPress={async () => {
              const db = getDb();
              await db.delete(dashboardWidgets).where(eq(dashboardWidgets.id, widget.id));
              notifyDbChanged();
              onClose();
              onChanged();
              toast.show('Widget removed');
            }}
            style={{ flex: 1 }}
          />
          <Button label="Done" onPress={onClose} style={{ flex: 1 }} />
        </Row>
      }>
      <View style={{ gap: theme.spacing.xl, paddingBottom: theme.spacing.md }}>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="captionMedium" tone="secondary">
            Width
          </AppText>
          <Row gap="sm">
            <Chip label="Half" selected={widget.width === 'half'} onPress={() => update({ width: 'half' })} />
            <Chip label="Full" selected={widget.width === 'full'} onPress={() => update({ width: 'full' })} />
          </Row>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="captionMedium" tone="secondary">
            Height
          </AppText>
          <Row gap="sm">
            <Chip label="Compact" selected={widget.height === 'compact'} onPress={() => update({ height: 'compact' })} />
            <Chip label="Medium" selected={widget.height === 'medium'} onPress={() => update({ height: 'medium' })} />
            <Chip label="Tall" selected={widget.height === 'tall'} onPress={() => update({ height: 'tall' })} />
          </Row>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="captionMedium" tone="secondary">
            Period
          </AppText>
          <Row gap="sm" wrap>
            <Chip label="Dashboard default" selected={!period} onPress={() => updateConfig({ period: undefined })} />
            {(['7d', '30d', '3m', '6m', '1y', 'thisMonth', 'lastMonth'] as PeriodPreset[]).map((entry) => (
              <Chip key={entry} label={entry.toUpperCase()} selected={period === entry} onPress={() => updateConfig({ period: entry })} />
            ))}
          </Row>
          <AppText variant="caption" tone="muted">
            Dashboard default is currently {defaultPeriod.toUpperCase()}.
          </AppText>
        </View>

        {widget.type === 'spending_trend' ? (
          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="captionMedium" tone="secondary">
              Chart
            </AppText>
            <Row gap="sm">
              <Chip label="Line" selected={(config.chart ?? 'line') === 'line'} onPress={() => updateConfig({ chart: 'line' })} />
              <Chip label="Bars" selected={config.chart === 'bar'} onPress={() => updateConfig({ chart: 'bar' })} />
            </Row>
            <Chip
              label="Show average line"
              selected={config.showAverage !== false}
              onPress={() => updateConfig({ showAverage: config.showAverage === false })}
            />
          </View>
        ) : null}

        <Pressable onPress={() => onClose()} android_ripple={{ color: theme.colors.ripple }}>
          <AppText variant="caption" tone="muted">
            Widgets read live from your ledger — changes appear on Home immediately.
          </AppText>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
