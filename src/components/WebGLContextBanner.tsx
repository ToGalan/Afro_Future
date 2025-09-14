import React from 'react';
import { useWebGLStore } from '../store/webglStore';

export function WebGLContextBanner() {
  const contextLost = useWebGLStore(s => s.contextLost);
  const lostCount = useWebGLStore(s => s.lostCount);
  const restored = useWebGLStore(s => s.restoredCount);

  if (!contextLost && lostCount === 0) return null;

  return (
    <div className="pointer-events-none fixed top-2 left-1/2 -translate-x-1/2 z-[200]">
      {contextLost ? (
        <div className="px-4 py-2 rounded-xl bg-amber-600/90 text-white text-xs shadow-lg border border-amber-400/60 animate-pulse">
          WebGL context lost – rendering paused. Attempting automatic restore...
        </div>
      ) : (
        <div className="px-4 py-2 rounded-xl bg-emerald-600/90 text-white text-xs shadow-lg border border-emerald-400/60">
          WebGL context restored (losses: {lostCount}, restores: {restored})
        </div>
      )}
    </div>
  );
}

export default WebGLContextBanner;
