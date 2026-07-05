/**
 * useCreeps — neutral creep camps (DOTA-style) scattered across the map.
 *
 * - Camps spawn deterministically on eligible tiles, tougher the farther from spawn.
 * - Each camp holds 2–4 creeps with scaling HP.
 * - When the hero stands on/adjacent to an uncleared camp, auto-combat ticks each
 *   second: the hero damages the front creep; alive creeps damage the hero back.
 * - Clearing a camp awards XP + shards.
 *
 * Rendering is delegated to SoloMissionMap3D (reads `camps`); combat callbacks
 * (onHeroDamage / awardXp / awardShards) are provided by the map/HUD.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

type TileType = 'water' | 'desert' | 'plains' | 'forest' | 'jungle' | 'hills' | 'mountain';
interface MinTile { q: number; r: number; type: TileType }

export interface Creep { id: string; hp: number; maxHp: number }
export interface CreepCamp {
  key: string; q: number; r: number; level: number;
  creeps: Creep[]; cleared: boolean;
  xpReward: number; shardReward: number;
  dmgPerCreep: number;
}

function axialDist(aq: number, ar: number, bq: number, br: number): number {
  return (Math.abs(aq - bq) + Math.abs(ar - br) + Math.abs(aq + ar - bq - br)) / 2;
}
// Deterministic 0..1 hash per tile.
function hash(q: number, r: number): number {
  return Math.abs(Math.sin(q * 49.17 + r * 91.7) * 43758.5453) % 1;
}

interface UseCreepsOptions {
  tiles: MinTile[];
  heroQ: number;
  heroR: number;
  centerQ: number;
  centerR: number;
  /** Hero attack stat (damage per combat tick). */
  heroAttack: number;
  onHeroDamage?: (amount: number) => void;
  awardXp?: (amount: number) => void;
  awardShards?: (amount: number) => void;
}

export function useCreeps({
  tiles, heroQ, heroR, centerQ, centerR, heroAttack,
  onHeroDamage, awardXp, awardShards,
}: UseCreepsOptions) {
  const [camps, setCamps] = useState<Map<string, CreepCamp>>(new Map());
  const [inCombat, setInCombat] = useState(false);

  // Refs so the combat interval never goes stale / never needs to restart.
  const campsRef = useRef(camps); campsRef.current = camps;
  const heroRef = useRef({ q: heroQ, r: heroR }); heroRef.current = { q: heroQ, r: heroR };
  const atkRef = useRef(heroAttack); atkRef.current = heroAttack;
  const onHeroDamageRef = useRef(onHeroDamage); onHeroDamageRef.current = onHeroDamage;
  const awardXpRef = useRef(awardXp); awardXpRef.current = awardXp;
  const awardShardsRef = useRef(awardShards); awardShardsRef.current = awardShards;

  // ── Generate camps once tiles load ─────────────────────────────────────────
  useEffect(() => {
    if (!tiles.length) return;
    const m = new Map<string, CreepCamp>();
    for (const t of tiles) {
      if (t.type === 'water' || t.type === 'mountain') continue; // impassable
      const dist = axialDist(t.q, t.r, centerQ, centerR);
      if (dist < 5) continue;                    // keep spawn area safe
      const h = hash(t.q, t.r);
      if (h >= 0.028) continue;                  // ~2.8% of eligible tiles
      const level = 1 + Math.floor(dist / 7);    // farther = tougher
      const n = 2 + (Math.floor(h * 1000) % 3);  // 2–4 creeps
      const maxHp = 18 + level * 12;
      const creeps: Creep[] = Array.from({ length: n }, (_, i) => ({ id: `${t.q},${t.r}-${i}`, hp: maxHp, maxHp }));
      m.set(`${t.q},${t.r}`, {
        key: `${t.q},${t.r}`, q: t.q, r: t.r, level, creeps, cleared: false,
        xpReward: 12 + level * 10,
        shardReward: 4 + level * 3,
        dmgPerCreep: 2 + level,
      });
    }
    setCamps(m);
    console.log('[creeps] Generated', m.size, 'camps');
  }, [tiles, centerQ, centerR]);

  // Camp the hero is currently engaging (same tile or adjacent), still alive.
  const engagedKey = useCallback((): string | null => {
    const { q, r } = heroRef.current;
    for (const camp of campsRef.current.values()) {
      if (camp.cleared) continue;
      if (axialDist(q, r, camp.q, camp.r) <= 1 && camp.creeps.some(c => c.hp > 0)) return camp.key;
    }
    return null;
  }, []);

  // ── Combat tick (1/s) ───────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const key = engagedKey();
      if (!key) { setInCombat(false); return; }
      setInCombat(true);
      setCamps(prev => {
        const camp = prev.get(key);
        if (!camp || camp.cleared) return prev;
        const creeps = camp.creeps.map(c => ({ ...c }));
        // Hero hits the front (first alive) creep.
        let dmg = Math.max(1, atkRef.current || 5);
        for (const c of creeps) {
          if (c.hp <= 0) continue;
          const applied = Math.min(c.hp, dmg);
          c.hp -= applied; dmg -= applied;
          if (dmg <= 0) break;
        }
        const alive = creeps.filter(c => c.hp > 0);
        // Alive creeps retaliate.
        if (alive.length) onHeroDamageRef.current?.(alive.length * camp.dmgPerCreep);
        const cleared = alive.length === 0;
        if (cleared) {
          awardXpRef.current?.(camp.xpReward);
          awardShardsRef.current?.(camp.shardReward);
          console.log(`[creeps] Camp ${key} cleared → +${camp.xpReward} XP, +${camp.shardReward} shards`);
        }
        const next = new Map(prev);
        next.set(key, { ...camp, creeps, cleared });
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [engagedKey]);

  return { camps, inCombat };
}
