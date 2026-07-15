/**
 * useOutposts — capturable outposts + strategic region control (GDD macro loop).
 *
 * Outposts are strategic tiles scattered across the map. Standing adjacent and choosing
 * to capture flips a neutral outpost to the player. Each outpost owns a Voronoi territory
 * (the nearest-outpost tiles), so capturing claims a contiguous chunk of ground. Outposts
 * are grouped into NAMED regions; controlling every outpost in a region grants a control
 * bonus (the "eXpand/eXploit" payoff). This is the 4X/MOBA backbone of the map.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

type TileType = 'water' | 'desert' | 'plains' | 'forest' | 'jungle' | 'hills' | 'mountain';
interface MinTile { q: number; r: number; type: TileType }

export interface Outpost {
  key: string; q: number; r: number;
  region: number;
  owner: 'neutral' | 'player';
}

/** A named strategic region grouping several outposts. */
export interface RegionInfo {
  id: number;
  name: string;
  total: number;
  owned: number;
  controlled: boolean;   // player owns every outpost in the region
  centroid: { q: number; r: number };
}

// Afro-futurist region names, assigned by spatial bucket (index → name).
const REGION_NAMES = [
  'Verdant Reach', 'Sunspire', 'Cobalt Steppe',
  'Ashen Delta', 'Ironbloom', 'Emberwaste',
  'Duskmere', 'Palewood', 'Zenith Flats',
];
const REGION_COLS = 3;
const REGION_ROWS = 3;

function axialDist(aq: number, ar: number, bq: number, br: number): number {
  return (Math.abs(aq - bq) + Math.abs(ar - br) + Math.abs(aq + ar - bq - br)) / 2;
}
function hash(q: number, r: number): number {
  return Math.abs(Math.sin(q * 33.7 + r * 71.3) * 24634.6345) % 1;
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
  // Voronoi partition: every tile → the key of its nearest outpost. Together the
  // outposts' territories tile the ENTIRE map, so capturing an outpost claims a
  // contiguous chunk of ground.
  const [territory, setTerritory] = useState<Map<string, string>>(new Map());
  // Region metadata (names, centroids). Ownership counts are derived live from `outposts`.
  const [regionMeta, setRegionMeta] = useState<Map<number, { name: string; centroid: { q: number; r: number } }>>(new Map());

  const outpostsRef = useRef(outposts); outpostsRef.current = outposts;
  const heroRef = useRef({ q: heroQ, r: heroR }); heroRef.current = { q: heroQ, r: heroR };
  const onCaptureRef = useRef(onCapture); onCaptureRef.current = onCapture;

  // Generate outposts once tiles load — spread out, away from spawn — then group them into
  // named regions (3×3 spatial buckets over the outpost span) and assign every tile to its
  // nearest outpost so territories cover the whole map.
  useEffect(() => {
    if (!tiles.length) return;

    // 1) Candidate outpost coords: sparse, walkable, away from spawn.
    const coords: { q: number; r: number }[] = [];
    for (const t of tiles) {
      if (t.type === 'water' || t.type === 'mountain') continue;
      if (axialDist(t.q, t.r, centerQ, centerR) < 6) continue;
      if (hash(t.q, t.r) >= 0.007) continue;
      coords.push({ q: t.q, r: t.r });
    }
    if (!coords.length) { setOutposts(new Map()); setTerritory(new Map()); setRegionMeta(new Map()); return; }

    // 2) Region bucketing: a 3×3 grid over the outposts' bounding box. Only non-empty
    //    buckets become regions; ids are remapped to a contiguous 0..k range.
    const qs = coords.map(c => c.q), rs = coords.map(c => c.r);
    const minQ = Math.min(...qs), maxQ = Math.max(...qs), minR = Math.min(...rs), maxR = Math.max(...rs);
    const spanQ = (maxQ - minQ + 1) / REGION_COLS, spanR = (maxR - minR + 1) / REGION_ROWS;
    const bucketOf = (q: number, r: number) => {
      const cx = Math.min(REGION_COLS - 1, Math.floor((q - minQ) / spanQ));
      const cy = Math.min(REGION_ROWS - 1, Math.floor((r - minR) / spanR));
      return cy * REGION_COLS + cx; // 0..8
    };
    const bucketIds = new Set(coords.map(c => bucketOf(c.q, c.r)));
    const remap = new Map<number, number>();
    Array.from(bucketIds).sort((a, b) => a - b).forEach((b, i) => remap.set(b, i));

    // 3) Build outposts with their remapped region id.
    const m = new Map<string, Outpost>();
    for (const c of coords) {
      const region = remap.get(bucketOf(c.q, c.r))!;
      const key = `${c.q},${c.r}`;
      m.set(key, { key, q: c.q, r: c.r, region, owner: 'neutral' });
    }
    setOutposts(m);

    // 4) Region metadata: name (by bucket index) + centroid (avg of member outposts).
    const meta = new Map<number, { name: string; centroid: { q: number; r: number } }>();
    const acc = new Map<number, { sq: number; sr: number; n: number; bucket: number }>();
    for (const o of m.values()) {
      const a = acc.get(o.region) || { sq: 0, sr: 0, n: 0, bucket: bucketOf(o.q, o.r) };
      a.sq += o.q; a.sr += o.r; a.n++; acc.set(o.region, a);
    }
    for (const [id, a] of acc) {
      meta.set(id, {
        name: REGION_NAMES[a.bucket % REGION_NAMES.length] ?? `Region ${id + 1}`,
        centroid: { q: Math.round(a.sq / a.n), r: Math.round(a.sr / a.n) },
      });
    }
    setRegionMeta(meta);

    // 5) Nearest-outpost assignment for every tile (Voronoi). Positions are fixed, so this
    //    runs once; only ownership flips afterward.
    const outs = Array.from(m.values());
    const terr = new Map<string, string>();
    for (const t of tiles) {
      let best = outs[0].key, bestD = Infinity;
      for (const o of outs) {
        const d = axialDist(t.q, t.r, o.q, o.r);
        if (d < bestD) { bestD = d; best = o.key; }
      }
      terr.set(`${t.q},${t.r}`, best);
    }
    setTerritory(terr);
    console.log('[outposts] Generated', m.size, 'outposts in', meta.size, 'regions;', terr.size, 'tiles partitioned');
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

  // Rival raid — a faction AI retakes a player-owned outpost, flipping it back to neutral.
  // Returns true if an owned outpost was actually flipped (so callers can surface a banner).
  const raidOutpost = useCallback((key: string): boolean => {
    const cur = outpostsRef.current;
    const o = cur.get(key);
    if (!o || o.owner !== 'player') return false;
    const next = new Map(cur);
    next.set(key, { ...o, owner: 'neutral' });
    setOutposts(next);
    console.log(`[outposts] Raided ${key} (region ${o.region}) — lost to a rival faction`);
    return true;
  }, []);

  // Restore saved ownership (solo save/load) — flip the given "q,r" keys to player-owned.
  const applyOwnership = useCallback((ownedKeys: string[]) => {
    if (!ownedKeys || !ownedKeys.length) return;
    const set = new Set(ownedKeys);
    setOutposts(prev => {
      let changed = false;
      const next = new Map(prev);
      for (const [k, o] of next) if (set.has(k) && o.owner !== 'player') { next.set(k, { ...o, owner: 'player' }); changed = true; }
      return changed ? next : prev;
    });
  }, []);

  // Nearest player-owned outpost to a point — the respawn anchor (null → fall back to base).
  const nearestOwnedOutpost = useCallback((q: number, r: number): Outpost | null => {
    let best: Outpost | null = null, bestD = Infinity;
    for (const o of outpostsRef.current.values()) {
      if (o.owner !== 'player') continue;
      const d = axialDist(q, r, o.q, o.r);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }, []);

  // Live region roster with ownership counts (drives labels + regional bonuses).
  const regions = useMemo<RegionInfo[]>(() => {
    const counts = new Map<number, { total: number; owned: number }>();
    for (const o of outposts.values()) {
      const c = counts.get(o.region) || { total: 0, owned: 0 };
      c.total++; if (o.owner === 'player') c.owned++;
      counts.set(o.region, c);
    }
    const list: RegionInfo[] = [];
    for (const [id, c] of counts) {
      const meta = regionMeta.get(id);
      list.push({
        id, name: meta?.name ?? `Region ${id + 1}`,
        total: c.total, owned: c.owned, controlled: c.total > 0 && c.owned === c.total,
        centroid: meta?.centroid ?? { q: centerQ, r: centerR },
      });
    }
    return list.sort((a, b) => a.id - b.id);
  }, [outposts, regionMeta, centerQ, centerR]);

  const control = useMemo(() => {
    const all = Array.from(outposts.values());
    const owned = all.filter(o => o.owner === 'player').length;
    const regionsControlled = regions.filter(r => r.controlled).length;
    // Share of the map (by tiles) whose controlling outpost is player-owned.
    let ownedTiles = 0;
    for (const outKey of territory.values()) {
      if (outposts.get(outKey)?.owner === 'player') ownedTiles++;
    }
    const totalTiles = territory.size;
    const tilePct = totalTiles ? Math.round((ownedTiles / totalTiles) * 100) : 0;
    return { owned, total: all.length, regionsControlled, regionCount: regions.length, ownedTiles, totalTiles, tilePct };
  }, [outposts, territory, regions]);

  return { outposts, nearbyOutpost, captureNearby, raidOutpost, control, territory, regions, nearestOwnedOutpost, applyOwnership };
}
