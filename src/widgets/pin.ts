/**
 * "Add widget to home screen" — no-op off Android. Android resolves
 * `pin.android.ts` and opens the launcher's native pin prompt.
 */
export async function pinWallnutWidget(_widgetName: string): Promise<boolean> {
  return false;
}
