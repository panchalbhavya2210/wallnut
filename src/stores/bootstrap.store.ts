import { create } from 'zustand';

/**
 * Result of the last bootstrap pass. Screens read this to notify the user about
 * things the app did on their behalf — e.g. "3 recurring payments posted" — which
 * is the closest thing to a local notification without a background service.
 */
interface BootstrapState {
  seeded: boolean;
  postedRecurring: number;
  postedInstallments: number;
  recurringTotal: number;
  /** Set once the notification has been shown so it never repeats. */
  notified: boolean;
  setResult: (result: {
    seeded: boolean;
    postedRecurring: number;
    postedInstallments: number;
    recurringTotal: number;
  }) => void;
  markNotified: () => void;
}

export const useBootstrapStore = create<BootstrapState>((set) => ({
  seeded: false,
  postedRecurring: 0,
  postedInstallments: 0,
  recurringTotal: 0,
  notified: false,
  setResult: (result) => set({ ...result, notified: false }),
  markNotified: () => set({ notified: true }),
}));
