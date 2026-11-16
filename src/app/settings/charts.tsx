import React, { useMemo } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/theme/theme';
import { Card, ListGroup, Row, ScreenHeader, ScrollScreen } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { Button, Chip, SettingSwitch } from '@/components/ui/controls';
import { BarChart, DonutChart, LineChart, type Point } from '@/components/charts';
import { useChartSettings } from '@/hooks/useChartSettings';
import { useSettingsStore } from '@/stores/settings.store';
import { toast } from '@/stores/ui.store';
import { DEFAULT_SETTINGS, type ChartsSettings } from '@/services/settings.service';

/**
 * Chart presentation settings. The preview at the top uses the real chart
 * components, so every change is visible immediately and cannot drift from what
 * the rest of the app renders.
 */
export default function ChartSettingsScreen() {
  const theme = useTheme();
  const charts = useSettingsStore((state) => state.charts);
  const reduceMotion = useSettingsStore((state) => state.appearance.reduceMotion);
  const update = useSettingsStore((state) => state.update);
  const effective = useChartSettings();
  const set = <K extends keyof ChartsSettings>(key: K, value: ChartsSettings[K]) => update('charts', { [key]: value });

  const previewPoints = useMemo<Point[]>(
    () => [
      { key: '1', label: 'W1', fullLabel: 'Week 1', value: 8200_00 },
      { key: '2', label: 'W2', fullLabel: 'Week 2', value: 6100_00 },
      { key: '3', label: 'W3', fullLabel: 'Week 3', value: 9400_00 },
      { key: '4', label: 'W4', fullLabel: 'Week 4', value: 7200_00 },
      { key: '5', label: 'W5', fullLabel: 'Week 5', value: 11200_00 },
      { key: '6', label: 'W6', fullLabel: 'Week 6', value: 8800_00 },
    ],
    [],
  );

  const previewSlices = useMemo(
    () =>
      ['Food', 'Travel', 'Home', 'Shopping'].map((label, index) => ({
        id: label,
        label,
        value: [4200, 2800, 1800, 1200][index]!,
        color: theme.chart.categorical[index % theme.chart.categorical.length]!,
      })),
    [theme.chart.categorical],
  );

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Charts"
        subtitle="One visual language for every graph"
        hint={{
          id: 'charts',
          message:
            'These are the defaults for every chart in Wallnut. Individual dashboard widgets can override a few of them from the widget configure sheet; an explicit per-widget choice always wins.',
        }}
      />

      <View style={{ gap: theme.spacing.lg }}>
        <Card>
          <Row justify="space-between" align="flex-end" style={{ marginBottom: theme.spacing.md }}>
            <View style={{ gap: 2 }}>
              <AppText variant="titleSmall">Preview</AppText>
              <AppText variant="caption" tone="muted">
                {charts.trendStyle === 'bar' ? 'Bar' : charts.trendStyle === 'area' ? 'Area' : 'Line'} ·{' '}
                {charts.colorSource === 'category' ? 'Category colours' : 'Theme colours'}
              </AppText>
            </View>
            <AppText variant="caption" tone="muted">
              {effective.showGrid ? 'Grid on' : 'Clean'}
            </AppText>
          </Row>
          {charts.trendStyle === 'bar' ? (
            <BarChart points={previewPoints} height={132} color={theme.chart.series[0]} compactLabels />
          ) : (
            <LineChart
              points={previewPoints}
              height={132}
              color={theme.chart.series[0]}
              showArea={charts.trendStyle === 'area'}
              showAverage={charts.showAverage}
            />
          )}
          <Row justify="space-between" align="center" style={{ marginTop: theme.spacing.lg }}>
            <DonutChart
              slices={previewSlices}
              size={104}
              thickness={16}
              centerTop="Total"
              centerBottom="₹10k"
            />
            <View style={{ gap: 6, flex: 1, marginLeft: theme.spacing.lg }}>
              {previewSlices.map((slice) => (
                <Row key={slice.id} justify="space-between" gap="sm">
                  <Row gap="xs" align="center">
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: slice.color }} />
                    <AppText variant="caption" tone="secondary">
                      {slice.label}
                    </AppText>
                  </Row>
                  <AppText variant="numericCaption" tone="muted">
                    {Math.round((slice.value / 10_000) * 100)}%
                  </AppText>
                </Row>
              ))}
            </View>
          </Row>
        </Card>

        <ListGroup title="Style">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <AppText variant="captionMedium" tone="secondary">
              Trend chart
            </AppText>
            <Row gap="sm" wrap>
              {(['line', 'area', 'bar'] as const).map((style) => (
                <Chip
                  key={style}
                  label={style === 'line' ? 'Line' : style === 'area' ? 'Area' : 'Bars'}
                  selected={charts.trendStyle === style}
                  onPress={() => set('trendStyle', style)}
                />
              ))}
            </Row>
            <AppText variant="caption" tone="muted">
              Area is the default: it reads as a trend without hiding the magnitude.
            </AppText>

            <AppText variant="captionMedium" tone="secondary" style={{ marginTop: theme.spacing.sm }}>
              Colours
            </AppText>
            <Row gap="sm" wrap>
              <Chip
                label="Follow theme"
                selected={charts.colorSource === 'theme'}
                onPress={() => set('colorSource', 'theme')}
              />
              <Chip
                label="Category colours"
                selected={charts.colorSource === 'category'}
                onPress={() => set('colorSource', 'category')}
              />
            </Row>
            <AppText variant="caption" tone="muted">
              {charts.colorSource === 'theme'
                ? 'Charts use the accent palette, so changing the accent restyles every graph.'
                : 'Charts keep each category’s own colour so you can recognise them at a glance.'}
            </AppText>

            <AppText variant="captionMedium" tone="secondary" style={{ marginTop: theme.spacing.sm }}>
              Category breakdown
            </AppText>
            <Row gap="sm" wrap>
              <Chip
                label="Donut"
                selected={charts.breakdownStyle === 'donut'}
                onPress={() => set('breakdownStyle', 'donut')}
              />
              <Chip
                label="Pie"
                selected={charts.breakdownStyle === 'pie'}
                onPress={() => set('breakdownStyle', 'pie')}
              />
            </Row>
          </View>
        </ListGroup>

        <ListGroup title="Details">
          <SettingSwitch
            title="Grid lines"
            subtitle="Faint horizontal guides behind the data"
            value={charts.showGrid}
            onValueChange={(value) => set('showGrid', value)}
          />
          <SettingSwitch
            title="Average line"
            subtitle="Dashed line where an average is meaningful"
            value={charts.showAverage}
            onValueChange={(value) => set('showAverage', value)}
          />
          <SettingSwitch
            title="Point markers"
            subtitle="Dots on line-chart points"
            value={charts.showMarkers}
            onValueChange={(value) => set('showMarkers', value)}
          />
          <SettingSwitch
            title="Value tooltips"
            subtitle="Tap or scrub a chart to see the exact amount"
            value={charts.showTooltips}
            onValueChange={(value) => set('showTooltips', value)}
          />
          <SettingSwitch
            title="Centre total"
            subtitle="Show the total inside a donut"
            value={charts.showCentreTotal}
            onValueChange={(value) => set('showCentreTotal', value)}
          />
        </ListGroup>

        <ListGroup title="Motion & density">
          <SettingSwitch
            title="Animate charts"
            subtitle={
              reduceMotion
                ? 'Off because Reduce motion is enabled in Appearance'
                : 'Reveal charts with a short fade — never a bouncing bar'
            }
            value={charts.animate && !reduceMotion}
            onValueChange={(value) => set('animate', value)}
          />
          <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg, gap: theme.spacing.md }}>
            <AppText variant="captionMedium" tone="secondary">
              Point budget
            </AppText>
            <Row gap="sm" wrap>
              {([60, 120, 240] as const).map((value) => (
                <Chip
                  key={value}
                  label={`${value} points`}
                  selected={charts.maxPoints === value}
                  onPress={() => set('maxPoints', value)}
                />
              ))}
            </Row>
            <AppText variant="caption" tone="muted">
              Longer series are sampled evenly (first and last always kept) so a one-year daily chart never turns into hundreds
              of SVG nodes. 120 is the right balance for a phone.
            </AppText>
          </View>
        </ListGroup>

        <Button
          label="Reset chart settings"
          variant="secondary"
          onPress={() => {
            update('charts', DEFAULT_SETTINGS.charts);
            toast.success('Chart settings reset');
          }}
        />
        <AppText variant="caption" tone="muted" style={{ paddingHorizontal: theme.spacing.xs }}>
          Dashboard widgets can still override the chart type and average line from their own configure sheet.
        </AppText>
      </View>
    </ScrollScreen>
  );
}
