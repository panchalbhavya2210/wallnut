import { create } from 'zustand';

import {
  DEFAULT_SETTINGS,
  loadAllSettings,
  saveSettingGroup,
  type SettingsGroupKey,
  type SettingsGroups,
} from '@/services/settings.service';

interface SettingsState extends SettingsGroups {
  hydrated: boolean;
  /** Merge persisted values over defaults. */
  hydrate: (partial: Partial<SettingsGroups>) => void;
  /** Patch one group and persist it. */
  update: <K extends SettingsGroupKey>(group: K, patch: Partial<SettingsGroups[K]>) => void;
  /** Replace every group (used by restore/reset flows). */
  resetAll: () => void;
}

function mergeWithDefaults(partial: Partial<SettingsGroups>): SettingsGroups {
  const merged = {} as SettingsGroups;
  (Object.keys(DEFAULT_SETTINGS) as SettingsGroupKey[]).forEach((key) => {
    // @ts-expect-error — indexing heterogeneous groups
    merged[key] = { ...DEFAULT_SETTINGS[key], ...(partial[key] ?? {}) };
  });
  return merged;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  hydrated: false,

  hydrate: (partial) => set({ ...mergeWithDefaults(partial), hydrated: true }),

  update: (group, patch) => {
    const next = { ...get()[group], ...patch } as SettingsGroups[typeof group];
    set({ [group]: next } as Pick<SettingsGroups, typeof group>);
    void saveSettingGroup(group, next).catch((error) => {
      console.warn('[settings] failed to persist', group, error);
    });
  },

  resetAll: () => {
    set({ ...DEFAULT_SETTINGS });
    void Promise.all(
      (Object.keys(DEFAULT_SETTINGS) as SettingsGroupKey[]).map((key) =>
        saveSettingGroup(key, DEFAULT_SETTINGS[key]).catch(() => undefined),
      ),
    );
  },
}));

/** Loads persisted settings into the store. Called once during bootstrap. */
export async function hydrateSettings(): Promise<void> {
  try {
    const persisted = await loadAllSettings();
    useSettingsStore.getState().hydrate(persisted);
  } catch (error) {
    console.warn('[settings] falling back to defaults', error);
    useSettingsStore.getState().hydrate({});
  }
}
