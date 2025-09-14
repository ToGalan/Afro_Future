import { create } from 'zustand';
export const useWebGLStore = create()((set) => ({
    contextLost: false,
    lostCount: 0,
    restoredCount: 0,
    lastEvent: undefined,
    markLost: () => set((st) => ({ contextLost: true, lostCount: st.lostCount + 1, lastEvent: Date.now() })),
    markRestored: () => set((st) => ({ contextLost: false, restoredCount: st.restoredCount + 1, lastEvent: Date.now() })),
    reset: () => set({ contextLost: false, lostCount: 0, restoredCount: 0, lastEvent: undefined }),
}));
export const getWebGLSnapshot = () => useWebGLStore.getState();
