import { create } from 'zustand';

/**
 * Lightweight revision counter. Any database write bumps `revision`, and
 * screens re-run their queries when it changes — a simple, reliable
 * invalidation bus that behaves identically on web and native.
 */
interface DbState {
  revision: number;
  bump: () => void;
}

export const useDbStore = create<DbState>((set) => ({
  revision: 0,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
}));

/**
 * Coalesces write notifications within one tick. A single user action (save a
 * transaction, settle a debt, import a batch) can fan out into several service
 * writes; without coalescing every subscriber would re-run its query once per
 * write, which is what made dashboards visibly janky during multi-step saves.
 * The bump still lands before the browser/native event loop paints again, so
 * freshness is identical — there are just fewer redundant query passes.
 */
let bumpScheduled = false;

export function notifyDbChanged(): void {
  if (bumpScheduled) return;
  bumpScheduled = true;
  // `queueMicrotask` is not guaranteed on the oldest Hermes builds; a resolved
  // promise has the same "end of current tick" semantics everywhere.
  void Promise.resolve().then(() => {
    bumpScheduled = false;
    useDbStore.getState().bump();
  });
}
