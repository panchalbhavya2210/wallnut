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

export function notifyDbChanged(): void {
  useDbStore.getState().bump();
}
