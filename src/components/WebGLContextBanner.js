import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useWebGLStore } from '../store/webglStore';
export function WebGLContextBanner() {
    const contextLost = useWebGLStore(s => s.contextLost);
    const lostCount = useWebGLStore(s => s.lostCount);
    const restored = useWebGLStore(s => s.restoredCount);
    if (!contextLost && lostCount === 0)
        return null;
    return (_jsx("div", { className: "pointer-events-none fixed top-2 left-1/2 -translate-x-1/2 z-[200]", children: contextLost ? (_jsx("div", { className: "px-4 py-2 rounded-xl bg-amber-600/90 text-white text-xs shadow-lg border border-amber-400/60 animate-pulse", children: "WebGL context lost \u2013 rendering paused. Attempting automatic restore..." })) : (_jsxs("div", { className: "px-4 py-2 rounded-xl bg-emerald-600/90 text-white text-xs shadow-lg border border-emerald-400/60", children: ["WebGL context restored (losses: ", lostCount, ", restores: ", restored, ")"] })) }));
}
export default WebGLContextBanner;
