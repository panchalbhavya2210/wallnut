import { create } from 'zustand';

export interface ToastMessage {
  id: number;
  /** The message body. Renders as the muted detail line when `title` is set. */
  text: string;
  /** Optional heading — makes "what happened" instant to read. */
  title?: string;
  tone: 'neutral' | 'positive' | 'negative';
  actionLabel?: string;
  onAction?: () => void;
  /** Auto-dismiss delay in ms (the toast shows a countdown for it). */
  durationMs: number;
}

/** Per-call tweaks for the toast helpers. */
export interface ToastOptions {
  /** Heading line; `text` then renders as the muted detail beneath it. */
  title?: string;
  durationMs?: number;
}

const TOAST_BASE_MS = 3400;
/** Undo/action toasts linger — you need time to actually hit Undo. */
const TOAST_ACTION_MS = 6500;
/** Errors you should be able to finish reading. */
const TOAST_ERROR_MS = 5200;

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
  showToast: (toast: Omit<ToastMessage, 'id' | 'durationMs'> & { durationMs?: number }) => void;
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
    const durationMs =
      toast.durationMs ??
      (toast.onAction ? TOAST_ACTION_MS : toast.tone === 'negative' ? TOAST_ERROR_MS : TOAST_BASE_MS);
    set((state) => ({ toasts: [...state.toasts.slice(-2), { ...toast, id, durationMs }] }));
    // Undo toasts auto-dismiss too — they used to sit there until tapped.
    setTimeout(() => get().dismissToast(id), durationMs);
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  show(text: string, tone: ToastMessage['tone'] = 'neutral', options: ToastOptions = {}) {
    useUiStore.getState().showToast({ text, tone, ...options });
  },
  undo(text: string, onAction: () => void, options: ToastOptions = {}) {
    useUiStore.getState().showToast({ text, tone: 'neutral', actionLabel: 'Undo', onAction, ...options });
  },
  error(text: string, options: ToastOptions = {}) {
    useUiStore.getState().showToast({ text, tone: 'negative', ...options });
  },
  success(text: string, options: ToastOptions = {}) {
    useUiStore.getState().showToast({ text, tone: 'positive', ...options });
  },
};
