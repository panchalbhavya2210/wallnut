import { create } from 'zustand';

export interface ToastMessage {
  id: number;
  text: string;
  tone: 'neutral' | 'positive' | 'negative';
  actionLabel?: string;
  onAction?: () => void;
}

interface UiState {
  toasts: ToastMessage[];
  /** ids currently selected in multi-select mode on the transactions screen. */
  selectionMode: boolean;
  selectedIds: string[];
  /** Filter sheet visibility + committed filter state live on the screen. */
  filterSheetOpen: boolean;
  dashboardEditing: boolean;
  /**
   * True while a chart is being scrubbed. Scroll screens disable their
   * ScrollView so a horizontal scrub never turns into a page scroll.
   */
  chartScrubbing: boolean;
  /** Account scope on Home: null = every account. */
  accountScopeId: string | null;

  setSelectionMode: (enabled: boolean) => void;
  toggleSelected: (id: string) => void;
  setSelected: (ids: string[]) => void;
  clearSelection: () => void;
  setFilterSheetOpen: (open: boolean) => void;
  setDashboardEditing: (editing: boolean) => void;
  setChartScrubbing: (scrubbing: boolean) => void;
  setAccountScope: (accountId: string | null) => void;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  selectionMode: false,
  selectedIds: [],
  filterSheetOpen: false,
  dashboardEditing: false,
  chartScrubbing: false,
  accountScopeId: null,

  setSelectionMode: (enabled) =>
    set({ selectionMode: enabled, selectedIds: enabled ? get().selectedIds : [] }),
  toggleSelected: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((x) => x !== id)
        : [...state.selectedIds, id],
    })),
  setSelected: (ids) => set({ selectedIds: ids }),
  clearSelection: () => set({ selectionMode: false, selectedIds: [] }),
  setFilterSheetOpen: (open) => set({ filterSheetOpen: open }),
  setDashboardEditing: (editing) => set({ dashboardEditing: editing }),
  setChartScrubbing: (scrubbing) => {
    if (get().chartScrubbing !== scrubbing) set({ chartScrubbing: scrubbing });
  },
  setAccountScope: (accountId) => set({ accountScopeId: accountId }),

  showToast: (toast) => {
    const id = ++toastId;
    set((state) => ({ toasts: [...state.toasts.slice(-2), { ...toast, id }] }));
    if (!toast.onAction) {
      setTimeout(() => get().dismissToast(id), 3200);
    }
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  show(text: string, tone: ToastMessage['tone'] = 'neutral') {
    useUiStore.getState().showToast({ text, tone });
  },
  undo(text: string, onAction: () => void) {
    useUiStore.getState().showToast({ text, tone: 'neutral', actionLabel: 'Undo', onAction });
  },
  error(text: string) {
    useUiStore.getState().showToast({ text, tone: 'negative' });
  },
  success(text: string) {
    useUiStore.getState().showToast({ text, tone: 'positive' });
  },
};
