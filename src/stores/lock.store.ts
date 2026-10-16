import { create } from 'zustand';

/**
 * Global lock state. The root layout renders the lock screen as a full-screen
 * overlay, so unlocking never re-mounts the app or loses screen state.
 */
interface LockState {
  locked: boolean;
  lock: () => void;
  unlock: () => void;
}

export const useLockStore = create<LockState>((set) => ({
  locked: false,
  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false }),
}));
