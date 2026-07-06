/**
 * useOutposts — capturable outposts + region control (GDD macro loop).
 *
 * Outposts are strategic tiles scattered across the map. Standing adjacent and
 * choosing to capture flips a neutral outpost to the player. Outposts are grouped
 * into regions; controlling every outpost in a region grants a control bonus.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

type TileType = 'water' | 'desert' | 'plains' | 'forest' | 'jungle' | 'hills' | 'mountain';
interface MinTile { q: number; r: number; type: TileType }

export interface Outpost {
  key: string; q: number; r: number;
  region: number;
  owner: 'neutral' | 'player';
}

function axialDist(aq: number, ar: number, bq: number, br: number): number {
  return (Math.abs(aq - bq) + Math.abs(ar - br) + Math.abs(aq + ar - bq - br)) / 2;
}
function hash(q: number, r: number): number {
  return Math.abs(Math.sin(q * 33.7 + r * 71.3) * 24634.6345) % 1;
}
// Coarse region id from the tile's quadrant relative to the map centre.
function regionOf(q: number, r: number, cq: number, cr: number): number {
  const bx = q >= cq ? 1 : 0;
  const bz = r >= cr ? 1 : 0;
  return bx + bz * 2; // 0..3 quadrants
}

interface UseOutpostsOptions {
  tiles: MinTile[];
  heroQ: number;
  heroR: number;
  centerQ: number;
  centerR: number;
  onCapture?: (region: number, regionCleared: boolean) => void;
}

export function useOutposts({ tiles, heroQ, heroR, centerQ, centerR, onCapture }: UseOutpostsOptions) {
  const [outposts, setOutposts] = useState<Map<string, Outpost>>(new Map());
  const [nearbyOutpost, setNearbyOutpost] = useState<Outpost | null>(null);

  const outpostsRef = useRef(outposts); outpostsRef.current = outposts;
  const heroRef = useRef({ q: heroQ, r: heroR }); heroRef.current = { q: heroQ, r: heroR };
  const onCaptureRef = useRef(onCapture); onCaptureRef.current = onCapture;

  // Generate outposts once tiles load — a handful, spread out, away from spawn.
  useEffect(() => {
    if (!tiles.length) return;
    const m = new Map<string, Outpost>();
    for (const t of tiles) {
      if (t.type === 'water' || t.type === 'mountain') continue;
      const dist = axialDist(t.q, t.r, centerQ, centerR);
      if (dist < 6) continue;
      if (hash(t.q, t.r) >= 0.012) continue; // ~1.2% → a small set
      m.set(`${t.q},${t.r}`, { key: `${t.q},${t.r}`, q: t.q, r: t.r, region: regionOf(t.q, t.r, centerQ, centerR), owner: 'neutral' });
    }
    setOutposts(m);
    console.log('[outposts] Generated', m.size, 'outposts');
  }, [tiles, centerQ, centerR]);

  const engagedKey = useCallback((): string | null => {
    const { q, r } = heroRef.current;
    for (const o of outpostsRef.current.values()) {
      if (o.owner === 'player') continue;
      if (axialDist(q, r, o.q, o.r) <= 1) return o.key;
    }
    return null;
  }, []);

  useEffect(() => {
    const key = engagedKey();
    setNearbyOutpost(key ? (outpostsRef.current.get(key) ?? null) : null);
  }, [outposts, heroQ, heroR, engagedKey]);

  // Capture the adjacent neutral outpost — a deliberate action.
  const captureNearby = useCallback((): boolean => {
    const key = engagedKey();
    if (!key) return false;
    const cur = outpostsRef.current;
    const o = cur.get(key);
    if (!o || o.owner === 'player') return false;
    const next = new Map(cur);
    next.set(key, { ...o, owner: 'player' });
    // Region cleared if every outpost in this region is now player-owned.
    const regionCleared = Array.from(next.values()).filter(x => x.region === o.region).every(x => x.owner === 'player');
    setOutposts(next);
    onCaptureRef.current?.(o.region, regionCleared);
    console.log(`[outposts] Captured ${key} (region ${o.region})${regionCleared ? ' — REGION CONTROLLED' : ''}`);
    return true;
  }, [engagedKey]);

  const control = useMemo(() => {
    const all = Array.from(outposts.values());
    const owned = all.filter(o => o.owner === 'player').length;
    const regions = new Map<number, { total: number; owned: number }>();
    for (const o of all) {
      const r = regions.get(o.region) || { total: 0, owned: 0 };
      r.total++; if (o.owner === 'player') r.owned++;
      regions.set(o.region, r);
    }
    const regionsControlled = Array.from(regions.values()).filter(r => r.total > 0 && r.owned === r.total).length;
    return { owned, total: all.length, regionsControlled, regionCount: regions.size };
  }, [outposts]);

  return { outposts, nearbyOutpost, captureNearby, control };
}
