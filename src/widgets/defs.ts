/** Widget provider names — must match the `name` fields in app.json. */
export const WIDGET_NAMES = ['Snapshot', 'Balance', 'QuickAdd', 'Upcoming'] as const;
export type WidgetName = (typeof WIDGET_NAMES)[number];

export const WIDGET_LABELS: Record<WidgetName, string> = {
  Snapshot: 'Safe to Spend',
  Balance: 'Balance',
  QuickAdd: 'Quick Add',
  Upcoming: 'Upcoming',
};
