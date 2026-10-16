/**
 * No-op registration for platforms without Android widgets (iOS, web).
 * Android resolves `register.android.ts` instead.
 */
export function registerWallnutWidgets(): void {
  // Android only.
}
