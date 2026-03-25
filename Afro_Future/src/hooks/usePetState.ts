import { useState, useEffect, useRef, useMemo } from 'react';
import { axialDistance, axialNeighbors } from '../types/map';
import type { Actor, Axial, Tile } from '../types/map';
import type { PlayerProfile } from '../types/player';

interface UsePetStateOptions {
  /** Current hero actor — used for leash radius calculations */
  hero: Actor;
  /** All loaded tiles — used for walkability checks */
  tiles: Tile[];
  useChunks: boolean;
  chunkCenterAxial: Axial;
  /** Best walkable spawn position (may be {q:0,r:0} until tiles load) */
  spawnPos: Axial;
  /** Profile used to determine whether to defer to a saved hero position */
  profile: PlayerProfile | null;
}

interface UsePetStateReturn {
  pet: Actor;
  setPet: React.Dispatch<React.SetStateAction<Actor>>;
}

export function usePetState({
  hero,
  tiles,
  useChunks,
  chunkCenterAxial,
  spawnPos,
  profile,
}: UsePetStateOptions): UsePetStateReturn {
  const initialQ = useChunks ? chunkCenterAxial.q : 0;
  const initialR = useChunks ? chunkCenterAxial.r : 0;

  const [pet, setPet] = useState<Actor>({
    id: 'pet',
    pos: { q: initialQ + 4, r: initialR - 1 },
    vision: 3,
    kind: 'pet',
  });

  const [petTarget, setPetTarget] = useState<Axial | null>(null);
  const petMovedToSpawn = useRef(false);

  // ── Spawn alignment ────────────────────────────────────────────────────────
  // Mirror the hero spawn timing so both hero and pet start at the map centre.
  useEffect(() => {
    if (tiles.length === 0 || petMovedToSpawn.current) return;
    if (profile?.progress?.heroPosition) return; // hero restored from profile; pet stays nearby
    petMovedToSpawn.current = true;
    setPet(p => ({ ...p, pos: spawnPos }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles.length, spawnPos]);

  // ── Leash enforcement ──────────────────────────────────────────────────────
  // If the pet drifts too far from the hero (e.g. hero teleports), pull it back one step.
  useEffect(() => {
    setPet(p => {
      const leash = Math.max(0, hero.vision - 1);
      if (axialDistance(p.pos, hero.pos) <= leash) return p;
      let best = p.pos;
      let bestDist = axialDistance(p.pos, hero.pos);
      for (const n of axialNeighbors(p.pos)) {
        const d = axialDistance(n, hero.pos);
        if (d < bestDist) { bestDist = d; best = n; }
      }
      if (best.q === p.pos.q && best.r === p.pos.r) return p;
      return { ...p, pos: best };
    });
  }, [hero.pos, hero.vision]);

  // ── Patrol candidates — walkable tiles within leash radius ─────────────────
  const patrolCandidates = useMemo(() => {
    const leash = Math.max(0, hero.vision - 1);
    return tiles.filter(
      t => axialDistance(t, hero.pos) <= leash && t.type !== 'mountain' && t.type !== 'water'
    );
  }, [tiles, hero.pos, hero.vision]);

  // Pick a new patrol target whenever the current one is reached or drifted out of leash
  useEffect(() => {
    if (!petTarget || axialDistance(petTarget, hero.pos) > hero.vision - 1) {
      if (patrolCandidates.length) {
        setPetTarget(patrolCandidates[Math.floor(Math.random() * patrolCandidates.length)]);
      }
    }
  }, [petTarget, patrolCandidates, hero.pos, hero.vision]);

  // ── Patrol step interval ───────────────────────────────────────────────────
  // Read volatile state via refs so the interval never needs to restart,
  // avoiding the stale-closure bug where it would see an outdated petTarget.
  const petTargetRef = useRef<Axial | null>(null);
  petTargetRef.current = petTarget;
  const heroRef = useRef(hero);
  heroRef.current = hero;

  // Build a tiles-by-key map for fast adjacency lookups in the interval
  const tilesByKeyRef = useRef<Map<string, Tile>>(new Map());
  useEffect(() => {
    const m = new Map<string, Tile>();
    for (const t of tiles) m.set(`${t.q},${t.r}`, t);
    tilesByKeyRef.current = m;
  }, [tiles]);

  useEffect(() => {
    const interval = setInterval(() => {
      const target = petTargetRef.current;
      const h = heroRef.current;
      const byKey = tilesByKeyRef.current;

      setPet(curr => {
        if (!target) return curr;
        if (curr.pos.q === target.q && curr.pos.r === target.r) {
          setPetTarget(null);
          return curr;
        }
        const leash = Math.max(0, h.vision - 1);
        let best = curr.pos;
        let bestDist = axialDistance(best, target);
        for (const n of axialNeighbors(curr.pos)) {
          const tile = byKey.get(`${n.q},${n.r}`);
          if (!tile) continue;
          if (tile.type === 'mountain') continue; // pet blocked by mountains only
          if (axialDistance(n, h.pos) > leash) continue;
          const d = axialDistance(n, target);
          if (d < bestDist) { bestDist = d; best = n; }
        }
        if (best.q === curr.pos.q && best.r === curr.pos.r) {
          setPetTarget(null);
          return curr;
        }
        return { ...curr, pos: best };
      });
    }, 400);

    return () => clearInterval(interval);
  // Empty deps — runs for the component lifetime; all state read via refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { pet, setPet };
}
