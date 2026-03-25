import { useState, useEffect, useRef } from 'react';
import { axialNeighbors } from '../types/map';
import type { Actor, Axial, Tile } from '../types/map';
import type { Ability } from '../components/gameHUD';
import type { PlayerProgress } from '../types/player';

interface AxialBounds {
  minQ: number; maxQ: number;
  minR: number; maxR: number;
}

interface UseMapInputOptions {
  tilesByKey: Map<string, Tile>;
  axialBounds: AxialBounds;
  saveProgress: (data: Partial<PlayerProgress>) => void;
  updateHeroPosition: (pos: Axial) => void;
  abilitySlots: Ability[];
  setAbilitySlots: React.Dispatch<React.SetStateAction<Ability[]>>;
  handleItemUse: (slotIndex: number) => void;
  gainXPOnMove: () => void;
  setHero: React.Dispatch<React.SetStateAction<Actor>>;
}

interface UseMapInputReturn {
  collisionMessage: { type: 'water' | 'mountain'; show: boolean };
  setCollisionMessage: React.Dispatch<React.SetStateAction<{ type: 'water' | 'mountain'; show: boolean }>>;
}

// ── Pure helpers (exported for testing / reuse outside this hook) ─────────

export function clampAxial(
  a: Axial,
  bounds: AxialBounds,
  tilesByKey: Map<string, Tile>
): Axial {
  let q = Math.min(bounds.maxQ, Math.max(bounds.minQ, a.q));
  let r = Math.min(bounds.maxR, Math.max(bounds.minR, a.r));
  if (tilesByKey.has(`${q},${r}`)) return { q, r };
  // BFS fallback for edge-shaped gaps
  const visited = new Set<string>();
  const queue: Axial[] = [{ q, r }];
  while (queue.length) {
    const cur = queue.shift()!;
    const k = `${cur.q},${cur.r}`;
    if (visited.has(k)) continue;
    visited.add(k);
    if (tilesByKey.has(k)) return cur;
    for (const n of axialNeighbors(cur)) {
      if (Math.abs(n.q - q) > 4 || Math.abs(n.r - r) > 4) continue;
      queue.push(n);
    }
  }
  return a;
}

export function tilePassable(
  tile: Tile | undefined
): { passable: boolean; reason: 'water' | 'mountain' | null } {
  if (!tile) return { passable: false, reason: null };
  if (tile.type === 'mountain') return { passable: false, reason: 'mountain' };
  if (tile.type === 'water') return { passable: false, reason: 'water' };
  return { passable: true, reason: null };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMapInput({
  tilesByKey,
  axialBounds,
  saveProgress,
  updateHeroPosition,
  abilitySlots,
  setAbilitySlots,
  handleItemUse,
  gainXPOnMove,
  setHero,
}: UseMapInputOptions): UseMapInputReturn {
  const [collisionMessage, setCollisionMessage] = useState<{
    type: 'water' | 'mountain';
    show: boolean;
  }>({ type: 'water', show: false });

  // Tile moves counter — pet earns XP every 40 hero steps
  const tilesMoveRef = useRef(0);

  // Keep volatile callback/state refs so the keydown closure never goes stale
  const abilityRef = useRef(abilitySlots);
  abilityRef.current = abilitySlots;

  useEffect(() => {
    const downSet = new Set<string>();

    function onKey(e: KeyboardEvent) {
      const k = e.key.toLowerCase();

      // ─── MOVEMENT (WASD) ─────────────────────────────────────────────────
      const dirMap: Record<string, Axial> = {
        w: { q: 0, r: -1 },   // North
        s: { q: 0, r: 1 },    // South
        a: { q: -1, r: 1 },   // Southwest
        d: { q: 1, r: -1 },   // Northeast
      };

      const delta = dirMap[k];
      if (delta) {
        if (e.repeat || downSet.has(k)) return;
        downSet.add(k);
        e.preventDefault();

        setHero(h => {
          const targetRaw = { q: h.pos.q + delta.q, r: h.pos.r + delta.r };
          const clamped = clampAxial(targetRaw, axialBounds, tilesByKey);
          const tile = tilesByKey.get(`${clamped.q},${clamped.r}`);
          const check = tilePassable(tile);
          if (!check.passable) {
            if (check.reason === 'water' || check.reason === 'mountain') {
              setCollisionMessage({ type: check.reason, show: true });
            }
            return h;
          }
          saveProgress({ heroPosition: clamped });
          updateHeroPosition(clamped);
          tilesMoveRef.current++;
          if (tilesMoveRef.current >= 40) {
            tilesMoveRef.current = 0;
            gainXPOnMove();
          }
          return { ...h, pos: clamped };
        });
        return;
      }

      // ─── ABILITY ACTIVATION (QWER) ────────────────────────────────────────
      const abilityKeys: Record<string, string> = { q: 'Q', w: 'W', e: 'E', r: 'R' };
      if (abilityKeys[k]) {
        if (e.repeat) return;
        const slotKey = abilityKeys[k];
        const ability = abilityRef.current.find(a => a.key === slotKey);
        if (ability && (ability.cooldown ?? 0) === 0) {
          setAbilitySlots(prev =>
            prev.map(a => (a.key === slotKey ? { ...a, cooldown: a.maxCooldown } : a))
          );
        }
        return;
      }

      // ─── ITEM ACTIVATION (1-8) ────────────────────────────────────────────
      if (k >= '1' && k <= '8') {
        if (e.repeat) return;
        handleItemUse(parseInt(k) - 1);
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      downSet.delete(e.key.toLowerCase());
    }

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [tilesByKey, axialBounds, saveProgress, updateHeroPosition, abilitySlots, setAbilitySlots, handleItemUse, gainXPOnMove, setHero]);

  return { collisionMessage, setCollisionMessage };
}
