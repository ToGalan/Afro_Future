import { create } from 'zustand';

interface WebGLState {
  contextLost: boolean;
  lostCount: number;
  restoredCount: number;
  lastEvent?: number;
  markLost: () => void;
  markRestored: () => void;
  reset: () => void;
}

export const useWebGLStore = create<WebGLState>()((set) => ({
  contextLost: false,
  lostCount: 0,
  restoredCount: 0,
  lastEvent: undefined,
  markLost: () => set((st) => ({ contextLost: true, lostCount: st.lostCount + 1, lastEvent: Date.now() })),
  markRestored: () => set((st) => ({ contextLost: false, restoredCount: st.restoredCount + 1, lastEvent: Date.now() })),
  reset: () => set({ contextLost: false, lostCount: 0, restoredCount: 0, lastEvent: undefined }),
}));

export const getWebGLSnapshot = () => useWebGLStore.getState();
