import { useTheme } from '@/theme/theme';
import { useSettingsStore } from '@/stores/settings.store';

/**
 * Resolves colours for charts and category visualisations.
 *
 * `theme` (default): every chart follows the palette picked in Settings — the
 * accent swatch, or Material's tonal roles. Single-series charts get
 * `series[0]`, multi-category charts walk the categorical sequence in order.
 *
 * `category`: categories keep their own stored colour, which is useful when you
 * recognise categories by colour across the app.
 */
export function useChartColors() {
  const theme = useTheme();
  const preference = useSettingsStore((state) => state.appearance.chartColors);

  return {
    preference,
    primary: theme.chart.series[0]!,
    series: theme.chart.series,
    average: theme.chart.average,
    grid: theme.chart.grid,
    positive: theme.chart.positive,
    negative: theme.chart.negative,
    neutral: theme.chart.neutral,
    /** Colour for the nth slice of a categorical chart. */
    slice: (index: number, categoryColor?: string | null): string => {
      if (preference === 'category' && categoryColor) return categoryColor;
      return theme.chart.categorical[index % theme.chart.categorical.length]!;
    },
  };
}
