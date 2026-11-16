import { useSettingsStore } from '@/stores/settings.store';
import type { ChartsSettings } from '@/services/settings.service';

/**
 * Global chart presentation defaults.
 *
 * Charts read these directly, so a settings change restyles every graph without
 * touching a screen. An explicit prop on a chart (or a widget override) still
 * wins — callers pass it to the component as usual.
 *
 * `animate` is already folded with reduce-motion: consumers never need to check
 * both flags.
 */
export function useChartSettings(): ChartsSettings & { reduceMotion: boolean } {
  const charts = useSettingsStore((state) => state.charts);
  const reduceMotion = useSettingsStore((state) => state.appearance.reduceMotion);
  return {
    ...charts,
    animate: charts.animate && !reduceMotion,
    reduceMotion,
  };
}
