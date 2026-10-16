import React, { useId, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Line, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/theme/theme';
import { useUiStore } from '@/stores/ui.store';
import { AppText } from './ui/text';
import { useMoney } from '@/hooks/useMoney';

/* --------------------------------- shared ---------------------------------- */

export interface Point {
  key: string;
  label: string;
  fullLabel?: string;
  value: number;
}

function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const controlX = (previous.x + current.x) / 2;
    path += ` C ${controlX} ${previous.y}, ${controlX} ${current.y}, ${current.x} ${current.y}`;
  }
  return path;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Horizontal scrub gesture for charts.
 *
 * The failure/activation offsets are the important part: moving vertically
 * fails the pan immediately (so the surrounding ScrollView keeps scrolling),
 * while a horizontal drag activates the scrub and temporarily locks the
 * scroll screen (`chartScrubbing`) so the page never steals the gesture.
 * Selection stays visible after release — the insight shouldn't vanish.
 */
function useChartScrub({
  count,
  paddingLeft,
  innerWidth,
  onSelect,
  onTap,
}: {
  count: number;
  paddingLeft: number;
  innerWidth: number;
  onSelect: (index: number) => void;
  onTap?: (index: number) => void;
}) {
  const setChartScrubbing = useUiStore((state) => state.setChartScrubbing);

  const indexAt = React.useCallback(
    (x: number) => {
      if (count === 0) return -1;
      const step = innerWidth / Math.max(1, count - 1);
      return clamp(Math.round((x - paddingLeft) / step), 0, count - 1);
    },
    [count, innerWidth, paddingLeft],
  );

  const select = React.useCallback(
    (x: number, tap = false) => {
      const index = indexAt(x);
      if (index < 0) return;
      onSelect(index);
      if (tap && onTap) onTap(index);
    },
    [indexAt, onSelect, onTap],
  );

  const start = React.useCallback(() => setChartScrubbing(true), [setChartScrubbing]);
  const stop = React.useCallback(() => setChartScrubbing(false), [setChartScrubbing]);

  const pan = React.useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-8, 8])
        .failOffsetY([-16, 16])
        .onStart((event) => {
          runOnJS(select)(event.x);
          runOnJS(start)();
        })
        .onUpdate((event) => {
          runOnJS(select)(event.x);
        })
        .onFinalize(() => {
          runOnJS(stop)();
        }),
    [select, start, stop],
  );

  const tap = React.useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(14)
        .onEnd((event) => {
          runOnJS(select)(event.x, true);
        }),
    [select],
  );

  return React.useMemo(() => Gesture.Exclusive(pan, tap), [pan, tap]);
}

/** Floating value tooltip pinned above a chart point. */
function ChartTooltip({
  x,
  width,
  label,
  value,
  visible,
}: {
  x: number;
  width: number;
  label: string;
  value: string;
  visible: boolean;
}) {
  const theme = useTheme();
  if (!visible) return null;
  const tooltipWidth = 132;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: clamp(x - tooltipWidth / 2, 0, Math.max(0, width - tooltipWidth)),
        minWidth: tooltipWidth,
        backgroundColor: theme.colors.surfaceElevated,
        borderColor: theme.colors.border,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: theme.radius.md,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 5,
        ...theme.shadow('md'),
      }}>
      <AppText variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant="numericCaption">{value}</AppText>
    </View>
  );
}

/* -------------------------------- Line chart ------------------------------- */

export interface LineChartProps {
  points: Point[];
  height?: number;
  color?: string;
  /** Second, lighter series (e.g. previous period). */
  comparison?: Point[];
  showAverage?: boolean;
  showArea?: boolean;
  /**
   * `zero` (default) starts the axis at 0 — correct for spending charts.
   * `auto` fits the axis to the data — correct for balances and net worth,
   * where a zero baseline flattens the interesting movement.
   */
  baseline?: 'zero' | 'auto';
  /** Called when the user taps a point (index into `points`). */
  onPointPress?: (point: Point, index: number) => void;
  style?: StyleProp<ViewStyle>;
  yTicks?: number;
  /** Renders grid, labels and markers for a dark hero surface. */
  onDark?: boolean;
}

export const LineChart = React.memo(function LineChart({
  points,
  height = 170,
  color,
  comparison,
  showAverage,
  showArea = true,
  baseline = 'zero',
  onPointPress,
  style,
  yTicks = 3,
  onDark,
}: LineChartProps) {
  const theme = useTheme();
  const money = useMoney();
  const gradientId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const selectedRef = useRef<number | null>(null);
  const reveal = useSharedValue(0);

  React.useEffect(() => {
    reveal.value = theme.motion.reduceMotion ? 1 : withTiming(1, { duration: 420 });
  }, [reveal, theme.motion.reduceMotion]);

  const revealStyle = useAnimatedStyle(() => ({ opacity: reveal.value }));

  const padding = { left: 4, right: 4, top: 22, bottom: 24 };
  const innerWidth = Math.max(0, width - padding.left - padding.right);
  const innerHeight = Math.max(0, height - padding.top - padding.bottom);

  const scale = useMemo(() => {
    const values = [...points.map((point) => point.value), ...(comparison ?? []).map((point) => point.value)];
    if (baseline === 'auto' && values.length > 0) {
      const dataMin = Math.min(...values);
      const dataMax = Math.max(...values);
      const span = dataMax - dataMin || Math.abs(dataMax) * 0.2 || 1;
      const min = dataMin - span * 0.15;
      const max = dataMax + span * 0.15;
      return { min, max, range: max - min || 1 };
    }
    const min = Math.min(0, ...values);
    const max = niceMax(Math.max(1, ...values));
    return { min, max, range: max - min || 1 };
  }, [points, comparison, baseline]);

  const yFor = React.useCallback(
    (value: number) => padding.top + innerHeight - ((value - scale.min) / scale.range) * innerHeight,
    [innerHeight, padding.top, scale],
  );

  const coords = useMemo(() => {
    if (points.length === 0 || innerWidth <= 0) return [];
    const step = points.length > 1 ? innerWidth / (points.length - 1) : 0;
    return points.map((point, index) => ({ x: padding.left + index * step, y: yFor(point.value) }));
  }, [points, innerWidth, yFor, padding.left]);

  const comparisonCoords = useMemo(() => {
    if (!comparison || comparison.length === 0 || innerWidth <= 0) return [];
    const step = comparison.length > 1 ? innerWidth / (comparison.length - 1) : 0;
    return comparison.map((point, index) => ({ x: padding.left + index * step, y: yFor(point.value) }));
  }, [comparison, innerWidth, yFor, padding.left]);

  const average = points.length > 0 ? points.reduce((sum, point) => sum + point.value, 0) / points.length : 0;
  const averageY = yFor(average);
  const strokeColor = color ?? theme.chart.series[0] ?? theme.colors.accent.base;
  const gridColor = onDark ? 'rgba(255, 255, 255, 0.16)' : theme.colors.chartGrid;
  const labelColor = onDark ? 'rgba(255, 255, 255, 0.75)' : theme.colors.muted;
  const averageColor = onDark ? 'rgba(255, 255, 255, 0.5)' : theme.chart.average;
  const cursorColor = onDark ? 'rgba(255, 255, 255, 0.45)' : theme.colors.borderStrong;
  const last = coords[coords.length - 1];

  const handleSelect = React.useCallback((index: number) => {
    if (selectedRef.current === index) return;
    selectedRef.current = index;
    setSelected(index);
  }, []);

  const handleTap = React.useCallback(
    (index: number) => {
      if (onPointPress && points[index]) onPointPress(points[index]!, index);
    },
    [onPointPress, points],
  );

  const gesture = useChartScrub({
    count: points.length,
    paddingLeft: padding.left,
    innerWidth,
    onSelect: handleSelect,
    onTap: onPointPress ? handleTap : undefined,
  });

  const labelStep = Math.max(1, Math.ceil(points.length / 5));
  const selectedPoint = selected !== null ? points[selected] : null;
  const selectedCoord = selected !== null ? coords[selected] : null;

  return (
    <Animated.View style={[style, revealStyle]}>
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ width: '100%' }}>
        {width > 0 ? (
          <GestureDetector gesture={gesture} touchAction="pan-y">
            <View style={{ width, height }}>
              <Svg width={width} height={height}>
                <Defs>
                  <LinearGradient id={`grad-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={strokeColor} stopOpacity="0.32" />
                    <Stop offset="1" stopColor={strokeColor} stopOpacity="0" />
                  </LinearGradient>
                </Defs>

                {Array.from({ length: yTicks + 1 }, (_, index) => {
                  const y = padding.top + (innerHeight / yTicks) * index;
                  return (
                    <Line
                      key={`grid-${index}`}
                      x1={padding.left}
                      y1={y}
                      x2={width - padding.right}
                      y2={y}
                      stroke={gridColor}
                      strokeWidth={StyleSheet.hairlineWidth}
                      strokeDasharray={index === yTicks ? undefined : '3 5'}
                    />
                  );
                })}

                {showArea && coords.length > 1 ? (
                  <Path
                    d={`${buildSmoothPath(coords)} L ${coords[coords.length - 1]!.x} ${padding.top + innerHeight} L ${coords[0]!.x} ${padding.top + innerHeight} Z`}
                    fill={`url(#grad-${gradientId})`}
                  />
                ) : null}

                {comparisonCoords.length > 1 ? (
                  <Path
                    d={buildSmoothPath(comparisonCoords)}
                    fill="none"
                    stroke={onDark ? 'rgba(255, 255, 255, 0.55)' : theme.colors.muted}
                    strokeWidth={1.4}
                    strokeDasharray="4 4"
                    opacity={0.7}
                  />
                ) : null}

                <Path d={buildSmoothPath(coords)} fill="none" stroke={strokeColor} strokeWidth={2.4} strokeLinecap="round" />

                {showAverage && average > 0 ? (
                  <Line
                    x1={padding.left}
                    y1={averageY}
                    x2={width - padding.right}
                    y2={averageY}
                    stroke={averageColor}
                    strokeWidth={1}
                    strokeDasharray="5 4"
                    opacity={0.8}
                  />
                ) : null}

                {last && selected === null ? (
                  <G>
                    <Circle cx={last.x} cy={last.y} r={6} fill={`${strokeColor}22`} />
                    <Circle cx={last.x} cy={last.y} r={3} fill={strokeColor} />
                  </G>
                ) : null}

                {selectedCoord ? (
                  <G>
                    <Line
                      x1={selectedCoord.x}
                      y1={padding.top}
                      x2={selectedCoord.x}
                      y2={padding.top + innerHeight}
                      stroke={cursorColor}
                      strokeWidth={1}
                    />
                    <Circle cx={selectedCoord.x} cy={selectedCoord.y} r={9} fill={`${strokeColor}22`} />
                    <Circle
                      cx={selectedCoord.x}
                      cy={selectedCoord.y}
                      r={4.5}
                      fill={onDark ? '#12241A' : theme.colors.surfaceElevated}
                      stroke={strokeColor}
                      strokeWidth={2.5}
                    />
                  </G>
                ) : null}

                {points.map((point, index) =>
                  index % labelStep === 0 || index === points.length - 1 ? (
                    <SvgText
                      key={`label-${point.key}`}
                      x={coords[index]?.x ?? 0}
                      y={height - 6}
                      fill={labelColor}
                      fontSize={10}
                      textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>
                      {point.label}
                    </SvgText>
                  ) : null,
                )}

                <SvgText x={width - padding.right} y={padding.top - 6} fill={labelColor} fontSize={10} textAnchor="end">
                  {money.format(scale.max, { compact: true })}
                </SvgText>
              </Svg>
              <ChartTooltip
                x={selectedCoord?.x ?? 0}
                width={width}
                label={selectedPoint?.fullLabel ?? selectedPoint?.label ?? ''}
                value={selectedPoint ? money.format(selectedPoint.value, { compact: false }) : ''}
                visible={Boolean(selectedCoord && selectedPoint)}
              />
            </View>
          </GestureDetector>
        ) : (
          <View style={{ height }} />
        )}
      </View>
    </Animated.View>
  );
});

/* -------------------------------- Bar chart -------------------------------- */

export interface BarChartProps {
  points: Point[];
  secondary?: Point[];
  height?: number;
  color?: string;
  secondaryColor?: string;
  onBarPress?: (point: Point, index: number) => void;
  style?: StyleProp<ViewStyle>;
  compactLabels?: boolean;
}

export const BarChart = React.memo(function BarChart({
  points,
  secondary,
  height = 160,
  color,
  secondaryColor,
  onBarPress,
  style,
  compactLabels,
}: BarChartProps) {
  const theme = useTheme();
  const money = useMoney();
  const gradientId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const selectedRef = useRef<number | null>(null);
  const padding = { left: 4, right: 4, top: 20, bottom: 20 };
  const innerWidth = Math.max(0, width - padding.left - padding.right);
  const innerHeight = Math.max(0, height - padding.top - padding.bottom);

  const scale = useMemo(() => {
    const values = [...points.map((point) => point.value), ...(secondary ?? []).map((point) => point.value)];
    const min = Math.min(0, ...values);
    const max = niceMax(Math.max(1, ...values));
    return { min, max, range: max - min || 1 };
  }, [points, secondary]);

  const slotWidth = points.length > 0 ? innerWidth / points.length : 0;
  const barWidth = Math.max(4, Math.min(20, slotWidth * (secondary ? 0.34 : 0.52)));
  const reveal = useSharedValue(0);
  React.useEffect(() => {
    reveal.value = theme.motion.reduceMotion ? 1 : withTiming(1, { duration: 380 });
  }, [reveal, theme.motion.reduceMotion]);
  const revealStyle = useAnimatedStyle(() => ({ opacity: reveal.value }));
  const labelStep = Math.max(1, Math.ceil(points.length / (compactLabels ? 4 : 6)));
  const primary = color ?? theme.chart.series[0] ?? theme.colors.accent.base;
  const secondaryFill = secondaryColor ?? theme.colors.positive;

  const baseline = padding.top + innerHeight - ((0 - scale.min) / scale.range) * innerHeight;
  const barHeight = (value: number) => Math.max(2, (Math.abs(value) / scale.range) * innerHeight);

  const handleSelect = React.useCallback((index: number) => {
    if (selectedRef.current === index) return;
    selectedRef.current = index;
    setSelected(index);
  }, []);

  const handleTap = React.useCallback(
    (index: number) => {
      if (onBarPress && points[index]) onBarPress(points[index]!, index);
    },
    [onBarPress, points],
  );

  const gesture = useChartScrub({
    count: points.length,
    paddingLeft: padding.left,
    innerWidth,
    onSelect: handleSelect,
    onTap: onBarPress ? handleTap : undefined,
  });

  const selectedPoint = selected !== null ? points[selected] : null;
  const selectedCenter = selected !== null ? padding.left + slotWidth * selected + slotWidth / 2 : 0;

  return (
    <Animated.View style={[style, revealStyle]}>
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ width: '100%' }}>
        {width > 0 ? (
          <GestureDetector gesture={gesture} touchAction="pan-y">
            <View style={{ width, height }}>
              <Svg width={width} height={height}>
                <Defs>
                  <LinearGradient id={`bar-p-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={primary} stopOpacity="1" />
                    <Stop offset="1" stopColor={primary} stopOpacity="0.55" />
                  </LinearGradient>
                  <LinearGradient id={`bar-s-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={secondaryFill} stopOpacity="0.95" />
                    <Stop offset="1" stopColor={secondaryFill} stopOpacity="0.45" />
                  </LinearGradient>
                </Defs>
                {[0, 0.5, 1].map((ratio) => {
                  const y = padding.top + innerHeight * ratio;
                  return (
                    <Line
                      key={ratio}
                      x1={padding.left}
                      y1={y}
                      x2={width - padding.right}
                      y2={y}
                      stroke={theme.colors.chartGrid}
                      strokeWidth={StyleSheet.hairlineWidth}
                      strokeDasharray={ratio === 1 ? undefined : '3 5'}
                    />
                  );
                })}
                {points.map((point, index) => {
                  const slotCenter = padding.left + slotWidth * index + slotWidth / 2;
                  const primaryHeight = barHeight(point.value);
                  const primaryX = secondary ? slotCenter - barWidth - 1 : slotCenter - barWidth / 2;
                  const secondaryHeight = secondary ? barHeight(secondary[index]?.value ?? 0) : 0;
                  const isSelected = selected === index;
                  const dim = selected !== null && !isSelected;
                  return (
                    <G key={point.key}>
                      <Rect
                        x={primaryX}
                        y={padding.top + innerHeight - primaryHeight}
                        width={barWidth}
                        height={primaryHeight}
                        rx={Math.min(5, barWidth / 2)}
                        fill={`url(#bar-p-${gradientId})`}
                        opacity={dim ? 0.45 : isSelected ? 1 : 0.94}
                      />
                      {secondary ? (
                        <Rect
                          x={slotCenter + 1}
                          y={padding.top + innerHeight - secondaryHeight}
                          width={barWidth}
                          height={secondaryHeight}
                          rx={Math.min(5, barWidth / 2)}
                          fill={`url(#bar-s-${gradientId})`}
                          opacity={dim ? 0.4 : 0.9}
                        />
                      ) : null}
                      {index % labelStep === 0 || index === points.length - 1 ? (
                        <SvgText
                          x={slotCenter}
                          y={height - 5}
                          fill={isSelected ? theme.colors.text : theme.colors.muted}
                          fontSize={10}
                          textAnchor="middle">
                          {point.label}
                        </SvgText>
                      ) : null}
                    </G>
                  );
                })}
                <Line x1={padding.left} y1={baseline} x2={width - padding.right} y2={baseline} stroke={theme.colors.borderStrong} strokeWidth={1} />
                <SvgText x={width - padding.right} y={padding.top - 6} fill={theme.colors.muted} fontSize={10} textAnchor="end">
                  {money.format(scale.max, { compact: true })}
                </SvgText>
              </Svg>
              <ChartTooltip
                x={selectedCenter}
                width={width}
                label={selectedPoint?.fullLabel ?? selectedPoint?.label ?? ''}
                value={selectedPoint ? money.format(selectedPoint.value, { compact: false }) : ''}
                visible={Boolean(selectedPoint)}
              />
            </View>
          </GestureDetector>
        ) : (
          <View style={{ height }} />
        )}
      </View>
    </Animated.View>
  );
});

/* -------------------------------- Donut chart ------------------------------ */

export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  color: string;
}

export const DonutChart = React.memo(function DonutChart({
  slices,
  size = 168,
  thickness = 22,
  centerTop,
  centerBottom,
  onSlicePress,
}: {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerTop?: string;
  centerBottom?: string;
  onSlicePress?: (slice: DonutSlice) => void;
}) {
  const theme = useTheme();
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: size, height: size }}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={theme.colors.inputBackground}
            strokeWidth={thickness}
            fill="none"
          />
          {total > 0
            ? slices.map((slice) => {
                const fraction = Math.max(0, slice.value) / total;
                const dash = fraction * circumference;
                // A small gap plus round caps reads as separate "petals" even
                // when two slices are adjacent; tiny slices still render a cap.
                const gap = Math.min(6, dash * 0.35);
                const element = (
                  <Circle
                    key={slice.id}
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke={slice.color}
                    strokeWidth={thickness}
                    strokeDasharray={`${Math.max(0.5, dash - gap)} ${circumference}`}
                    strokeDashoffset={-offset}
                    strokeLinecap="round"
                    fill="none"
                    onPress={onSlicePress ? () => onSlicePress(slice) : undefined}
                  />
                );
                offset += dash;
                return element;
              })
            : null}
        </G>
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center', gap: 2 }}>
        {centerTop ? (
          <AppText variant="caption" tone="muted">
            {centerTop}
          </AppText>
        ) : null}
        {centerBottom ? <AppText variant="numericMedium">{centerBottom}</AppText> : null}
      </View>
    </View>
  );
});

/* --------------------------------- Sparkline -------------------------------- */

export const Sparkline = React.memo(function Sparkline({
  values,
  width = 96,
  height = 30,
  color,
  strokeWidth = 1.8,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const theme = useTheme();
  const stroke = color ?? theme.chart.series[0] ?? theme.colors.accent.base;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const coords = values.map((value, index) => ({
    x: index * step,
    y: height - 3 - ((value - min) / range) * (height - 8),
  }));
  return (
    <Svg width={width} height={height}>
      <Path d={buildSmoothPath(coords)} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
});

/* ------------------------------ Flow bars ----------------------------------- */

export interface FlowItem {
  id: string;
  label: string;
  value: number;
  color: string;
  onPress?: () => void;
}

/**
 * A stable, readable alternative to a Sankey diagram: one source total
 * distributing into proportional bars with connecting rails.
 */
export const FlowBars = React.memo(function FlowBars({
  totalLabel,
  totalValue,
  items,
  style,
}: {
  totalLabel: string;
  totalValue: number;
  items: FlowItem[];
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const money = useMoney();
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <View style={[{ gap: theme.spacing.md }, style]}>
      <View style={{ gap: 4 }}>
        <AppText variant="label" tone="muted">
          {totalLabel}
        </AppText>
        <AppText variant="numericMedium">{money.format(totalValue, { compact: false })}</AppText>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: theme.chart.series[0] ?? theme.colors.accent.base,
          opacity: 0.9,
          width: '100%',
        }}
      />
      <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.xs }}>
        {items.map((item) => {
          const ratio = item.value / max;
          return (
            <View key={item.id} style={{ gap: 5 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: item.color }} />
                  <AppText variant="bodySmall">{item.label}</AppText>
                </View>
                <AppText variant="numericCaption" tone="secondary">
                  {money.format(item.value, { compact: false })}
                </AppText>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.inputBackground, overflow: 'hidden' }}>
                <View
                  style={{
                    width: `${Math.max(2, ratio * 100)}%`,
                    height: '100%',
                    borderRadius: 3,
                    backgroundColor: item.color,
                    opacity: 0.95,
                  }}
                />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
});
