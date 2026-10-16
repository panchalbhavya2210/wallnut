import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, KeyValueRow, Row, ScrollScreen, ScreenHeader, SectionHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Chip, SegmentedControl } from '@/components/ui/controls';
import { BarChart, Sparkline } from '@/components/charts';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/feedback';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useChartColors } from '@/hooks/useChartColors';
import { useSettingsStore } from '@/stores/settings.store';
import { useUiStore } from '@/stores/ui.store';
import { getCategoryMonthlyTrends, type CategoryMonthlyRow } from '@/services/analytics.service';
import { addMonths } from '@/utils/date';
import { formatPercent } from '@/utils/money';
import { shortCategoryLabel as formatShortCategoryLabel } from '@/utils/format';
import { MonthCyclePicker } from '@/components/MonthCyclePicker';

/**
 * Category trends — month-on-month spending per category.
 *
 * One place to answer "is this category getting more expensive?". Bars compare
 * the selected cycle with the one before it, and every row carries the last six
 * or twelve months as a sparkline. The cycle is a dropdown (any of the last two
 * years, defaulting to the current one). Tapping a category opens its detail.
 */
export default function CategoryTrendsScreen() {
  const theme = useTheme();
  const money = useMoney();
  const chart = useChartColors();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const scopeAccountId = useUiStore((state) => state.accountScopeId);
  const [window, setWindow] = useState<'6m' | '12m'>('6m');
  // 0 = the current cycle; >0 anchors the window on a past cycle.
  const [cycleOffset, setCycleOffset] = useState(0);

  const months = window === '6m' ? 6 : 12;

  const anchor = useMemo(
    () => (cycleOffset === 0 ? undefined : addMonths(new Date(), -cycleOffset)),
    [cycleOffset],
  );

  const query = useQuery(
    () =>
      getCategoryMonthlyTrends({
        months,
        monthStartDay,
        anchor,
        accountIds: scopeAccountId ? [scopeAccountId] : undefined,
      }),
    [months, monthStartDay, scopeAccountId, cycleOffset],
  );

  const data = query.data;
  const buckets = data?.months ?? [];
  const current = buckets[buckets.length - 1] ?? null;
  const previous = buckets[buckets.length - 2] ?? null;
  const rows = data?.rows ?? [];

  const currentTotal = useMemo(() => rows.reduce((sum, row) => sum + row.current, 0), [rows]);
  const previousTotal = useMemo(() => rows.reduce((sum, row) => sum + row.previous, 0), [rows]);
  const change = previousTotal > 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : null;

  const chartRows = useMemo(() => rows.filter((row) => row.current > 0 || row.previous > 0).slice(0, 8), [rows]);

  if (query.loading && !data) {
    return (
      <ScrollScreen>
        <ScreenHeader title="Category trends" />
        <LoadingBlock label="Crunching your categories…" />
      </ScrollScreen>
    );
  }

  if (query.error) {
    return (
      <ScrollScreen>
        <ScreenHeader title="Category trends" />
        <ErrorBlock message={query.error.message} onRetry={query.refresh} />
      </ScrollScreen>
    );
  }

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Category trends"
        subtitle="Month-on-month spending by category"
        right={
          <SegmentedControl
            options={[
              { value: '6m', label: '6M' },
              { value: '12m', label: '1Y' },
            ]}
            value={window}
            onChange={setWindow}
            style={{ width: 128 }}
          />
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="analytics-outline"
          title={cycleOffset > 0 && current ? `Nothing in ${current.fullLabel}` : 'No spending to compare'}
          message={
            cycleOffset > 0
              ? 'That cycle has no expenses in this window. Pick another month, or jump back to the current one.'
              : 'Once you have expenses in two months, this screen shows which categories are growing and which are calming down.'
          }
          actionLabel={cycleOffset > 0 ? 'Back to this cycle' : 'Add a transaction'}
          onAction={() => (cycleOffset > 0 ? setCycleOffset(0) : router.push('/transaction/new'))}
        />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Card>
            <Row justify="space-between" align="flex-start">
              <View style={{ gap: 6, flexShrink: 1 }}>
                <MonthCyclePicker
                  monthStartDay={monthStartDay}
                  value={cycleOffset}
                  onChange={setCycleOffset}
                  label={current ? current.fullLabel : 'This cycle'}
                />
                <AppText variant="numericLarge">{money.format(currentTotal)}</AppText>
              </View>
              {change !== null ? <ChangePill change={change} invert /> : null}
            </Row>
            <View style={{ marginTop: theme.spacing.md }}>
              <KeyValueRow label={previous ? `Previous · ${previous.fullLabel}` : 'Previous cycle'} value={money.format(previousTotal)} />
              <KeyValueRow label="Average per month" value={money.format(Math.round((currentTotal + previousTotal) / 2))} />
              <KeyValueRow label="Categories tracked" value={String(rows.length)} />
            </View>
          </Card>

          {chartRows.length > 0 ? (
            <Card>
              <Row justify="space-between" align="center" style={{ marginBottom: theme.spacing.md }}>
                <AppText variant="label" tone="muted">
                  {current && previous ? `${current.label.toUpperCase()} VS ${previous.label.toUpperCase()}` : 'THIS CYCLE VS LAST'}
                </AppText>
                <Row gap="sm">
                  <LegendDot color={chart.slice(0, theme.colors.accent.base)} label={current?.label ?? 'This cycle'} />
                  <LegendDot color={theme.colors.muted} label={previous?.label ?? 'Previous'} />
                </Row>
              </Row>
              <BarChart
                points={chartRows.map((row) => ({
                  key: row.categoryId ?? row.name,
                  label: shortCategoryLabel(row.name),
                  fullLabel: `${row.name} · ${current?.fullLabel ?? ''}`,
                  value: row.current,
                }))}
                secondary={chartRows.map((row) => ({
                  key: `${row.categoryId ?? row.name}-prev`,
                  label: shortCategoryLabel(row.name),
                  fullLabel: `${row.name} · ${previous?.fullLabel ?? ''}`,
                  value: row.previous,
                }))}
                height={170}
                color={chart.slice(0, theme.colors.accent.base)}
                secondaryColor={theme.colors.muted}
                compactLabels
              />
            </Card>
          ) : null}

          <View>
            <SectionHeader title="CATEGORIES" />
            <View style={{ gap: theme.spacing.sm }}>
              {rows.map((row, index) => (
                <CategoryTrendRow
                  key={row.categoryId ?? 'uncategorised'}
                  row={row}
                  months={buckets.map((bucket) => bucket.label)}
                  color={chart.slice(index, row.color)}
                  onPress={() => (row.categoryId ? router.push(`/category/${row.categoryId}` as never) : undefined)}
                />
              ))}
            </View>
          </View>

          <AppText variant="caption" tone="muted">
            Refunds net against the month they landed in. Cycles follow your month-start day from Settings → Finance.
          </AppText>
        </View>
      )}
    </ScrollScreen>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <Row gap="xs" align="center">
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <AppText variant="caption" tone="muted" style={{ fontSize: 11 }}>
        {label}
      </AppText>
    </Row>
  );
}

function CategoryTrendRow({
  row,
  months,
  color,
  onPress,
}: {
  row: CategoryMonthlyRow;
  months: string[];
  color: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const money = useMoney();
  const up = (row.change ?? 0) > 0;
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: theme.colors.ripple }}
      accessibilityRole="button"
      accessibilityLabel={`${row.name}, ${money.format(row.current)} this cycle`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: theme.radius.md,
          backgroundColor: `${color}26`,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Ionicons name={(row.icon as IconName) ?? 'pricetag-outline'} size={17} color={color} />
      </View>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <AppText variant="bodyMedium" numberOfLines={1}>
          {row.name}
        </AppText>
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          avg {money.format(row.average)}/mo · {row.count} transaction{row.count === 1 ? '' : 's'}
        </AppText>
      </View>
      {row.totals.length > 1 ? (
        <Sparkline values={row.totals} width={54} height={26} color={color} />
      ) : null}
      <View style={{ alignItems: 'flex-end', gap: 3, minWidth: 88 }}>
        <MoneyText amount={row.current} variant="numericSmall" tone="neutral" />
        {row.change !== null ? (
          <Row gap="xs" align="center">
            <Ionicons
              name={up ? 'arrow-up' : 'arrow-down'}
              size={11}
              color={up ? theme.colors.negative : theme.colors.positive}
            />
            <AppText variant="caption" tone={up ? 'negative' : 'positive'} style={{ fontSize: 11 }}>
              {formatPercent(Math.abs(row.change), 0)} vs {months[months.length - 2] ?? 'previous'}
            </AppText>
          </Row>
        ) : (
          <AppText variant="caption" tone="muted" style={{ fontSize: 11 }}>
            new this cycle
          </AppText>
        )}
      </View>
    </Pressable>
  );
}

/** "+12%" with an arrow, in the semantic colour. `invert` = growth is bad. */
export function ChangePill({ change, invert }: { change: number; invert?: boolean }) {
  const theme = useTheme();
  const up = change > 0;
  const bad = invert ? up : !up;
  const color = bad ? theme.colors.negative : theme.colors.positive;
  return (
    <Row gap="xs" align="center" style={{ backgroundColor: `${color}1F`, paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.full }}>
      <Ionicons name={up ? 'arrow-up' : 'arrow-down'} size={11} color={color} />
      <AppText variant="captionMedium" style={{ color, fontSize: 11 }}>
        {formatPercent(Math.abs(change), 0)}
      </AppText>
    </Row>
  );
}

/** First word, capped — the chart axis has room for about eight characters. */
export const shortCategoryLabel = formatShortCategoryLabel;

/** Quick access chips for the categories that changed the most. */
export function TopMovers({ rows, onPress }: { rows: CategoryMonthlyRow[]; onPress: (row: CategoryMonthlyRow) => void }) {
  const movers = useMemo(
    () =>
      rows
        .filter((row) => row.change !== null && Math.abs(row.change) >= 10 && (row.current > 0 || row.previous > 0))
        .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0))
        .slice(0, 4),
    [rows],
  );
  if (movers.length === 0) return null;
  return (
    <Row gap="sm" wrap>
      {movers.map((row) => (
        <Chip
          key={row.categoryId ?? row.name}
          label={`${row.name} ${(row.change ?? 0) > 0 ? '+' : '−'}${formatPercent(Math.abs(row.change ?? 0), 0)}`}
          onPress={() => onPress(row)}
        />
      ))}
    </Row>
  );
}
