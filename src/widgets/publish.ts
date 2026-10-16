/**
 * Widget refresh publisher — no-op off Android. Android resolves
 * `publish.android.ts`, which redraws every added widget from the current
 * snapshot. Called by the app after ledger changes and on startup.
 */
export async function publishWidgetSnapshot(): Promise<void> {
  // Android only.
}
