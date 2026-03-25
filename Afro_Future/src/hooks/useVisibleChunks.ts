import { useEffect, useState } from 'react';
import { fetchChunk, getCachedChunk, requiredChunksAround, MapChunk } from '../services/mapChunks';

interface Options {
  playerCol: number; // approximate player map column
  playerRow: number; // approximate player map row
  viewRadiusTiles: number; // how many tiles outward
  chunkSize?: number;
  enabled?: boolean; // feature flag
}

interface UseVisibleChunksResult {
  chunks: MapChunk[];
  loading: boolean;
  requested: Array<{ cx: number; cy: number }>;
}

export function useVisibleChunks(opts: Options): UseVisibleChunksResult {
  const { playerCol, playerRow, viewRadiusTiles, chunkSize = 32, enabled = true } = opts;
  const [requested, setRequested] = useState<Array<{ cx: number; cy: number }>>([]);
  const [tick, setTick] = useState(0); // force refresh when new chunks arrive

  useEffect(() => {
    if (!enabled) return;
    const needed = requiredChunksAround(playerCol, playerRow, viewRadiusTiles, chunkSize);
    setRequested(needed);
    let cancelled = false;
    (async () => {
      for (const { cx, cy } of needed) {
        if (cancelled) break;
        if (!getCachedChunk(cx, cy)) {
          try { await fetchChunk(cx, cy); setTick(t => t + 1); } catch (e) { console.warn('chunk load failed', cx, cy, e); }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [playerCol, playerRow, viewRadiusTiles, chunkSize, enabled]);

  const chunks: MapChunk[] = [];
  if (enabled) {
    for (const { cx, cy } of requested) {
      const c = getCachedChunk(cx, cy);
      if (c) chunks.push(c);
    }
  }

  return { chunks, loading: enabled && chunks.length !== requested.length, requested };
}
