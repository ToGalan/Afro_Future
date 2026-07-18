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
/** Fortify = dug-in, defensive camp (bunker/watchtower dressing); raid = aggressive
 *  raiding-party camp (war banners/spike totems, bigger bonfire). Purely cosmetic —
 *  read by CreepCampMesh to pick which satellite decor set to render. */
export type CreepCampKind = 'fortify' | 'raid';
export interface CreepCamp {
  key: string; q: number; r: number; level: number;
  creeps: Creep[]; cleared: boolean;
  xpReward: number; shardReward: number;
  dmgPerCreep: number;
  kind: CreepCampKind;
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
  /** Multiplier on damage the hero TAKES (e.g. lower in Defense mode). Default 1. */
  incomingDamageScale?: number;
  /** Fired each combat tick with damage dealt to the camp and taken by the hero. */
  onCombat?: (info: { campQ: number; campR: number; toCreep: number; toHero: number; killed: number; cleared: boolean }) => void;
}

export function useCreeps({
  tiles, heroQ, heroR, centerQ, centerR, heroAttack,
  onHeroDamage, awardXp, awardShards, incomingDamageScale, onCombat,
}: UseCreepsOptions) {
  const [camps, setCamps] = useState<Map<string, CreepCamp>>(new Map());
  const [nearbyCamp, setNearbyCamp] = useState<CreepCamp | null>(null);

  // Refs so the combat interval never goes stale / never needs to restart.
  const campsRef = useRef(camps); campsRef.current = camps;
  const heroRef = useRef({ q: heroQ, r: heroR }); heroRef.current = { q: heroQ, r: heroR };
  const atkRef = useRef(heroAttack); atkRef.current = heroAttack;
  const onHeroDamageRef = useRef(onHeroDamage); onHeroDamageRef.current = onHeroDamage;
  const awardXpRef = useRef(awardXp); awardXpRef.current = awardXp;
  const onCombatRef = useRef(onCombat); onCombatRef.current = onCombat;
  const incomingScaleRef = useRef(incomingDamageScale ?? 1); incomingScaleRef.current = incomingDamageScale ?? 1;
  const awardShardsRef = useRef(awardShards); awardShardsRef.current = awardShards;

  // ── Generate camps once tiles load ─────────────────────────────────────────
  useEffect(() => {
    if (!tiles.length) return;
    const m = new Map<string, CreepCamp>();
    const placed: { q: number; r: number }[] = [];
    const MIN_SPACING = 3; // hex-distance kept clear between any two camps
    for (const t of tiles) {
      if (t.type === 'water' || t.type === 'mountain') continue; // impassable
      const dist = axialDist(t.q, t.r, centerQ, centerR);
      if (dist < 5) continue;                    // keep spawn area safe
      const h = hash(t.q, t.r);
      if (h >= 0.028) continue;                  // ~2.8% of eligible tiles
      if (placed.some(p => axialDist(t.q, t.r, p.q, p.r) < MIN_SPACING)) continue; // too close to another camp
      placed.push({ q: t.q, r: t.r });
      const level = 1 + Math.floor(dist / 7);    // farther = tougher
      const n = 2 + (Math.floor(h * 1000) % 3);  // 2–4 creeps
      const maxHp = 18 + level * 12;
      const creeps: Creep[] = Array.from({ length: n }, (_, i) => ({ id: `${t.q},${t.r}-${i}`, hp: maxHp, maxHp }));
      // Deterministic fortify/raid split off a second, independent hash draw (roughly
      // even 50/50) so a camp's kind doesn't correlate with its level/creep-count roll.
      const kind: CreepCampKind = hash(t.q + 71, t.r + 71) < 0.5 ? 'fortify' : 'raid';
      m.set(`${t.q},${t.r}`, {
        key: `${t.q},${t.r}`, q: t.q, r: t.r, level, creeps, cleared: false,
        xpReward: 12 + level * 10,
        shardReward: 4 + level * 3,
        dmgPerCreep: 2 + level,
        kind,
      });
    }
    setCamps(m);
    console.log('[creeps] Generated', m.size, 'camps');
  }, [tiles, centerQ, centerR]);

  // Camp the hero is currently adjacent to (still alive) — the one you can choose to attack.
  const engagedKey = useCallback((): string | null => {
    const { q, r } = heroRef.current;
    for (const camp of campsRef.current.values()) {
      if (camp.cleared) continue;
      if (axialDist(q, r, camp.q, camp.r) <= 1 && camp.creeps.some(c => c.hp > 0)) return camp.key;
    }
    return null;
  }, []);

  // ── Nearby camp (for the "press to attack" prompt) ──────────────────────────
  useEffect(() => {
    const key = engagedKey();
    setNearbyCamp(key ? (campsRef.current.get(key) ?? null) : null);
  }, [camps, heroQ, heroR, engagedKey]);

  // ── Player-initiated attack — ONE round, only when the player chooses to ────
  // Attacking is a deliberate action (a key/click), not automatic proximity combat.
  const attackNearby = useCallback((): boolean => {
    const key = engagedKey();
    if (!key) return false;
    const camp = campsRef.current.get(key);
    if (!camp || camp.cleared) return false;
    const aliveBefore = camp.creeps.filter(c => c.hp > 0).length;
    const creeps = camp.creeps.map(c => ({ ...c }));
    let dmg = Math.max(1, atkRef.current || 5);
    let toCreep = 0;
    for (const c of creeps) {
      if (c.hp <= 0) continue;
      const applied = Math.min(c.hp, dmg);
      c.hp -= applied; dmg -= applied; toCreep += applied;
      if (dmg <= 0) break;
    }
    const alive = creeps.filter(c => c.hp > 0);
    const killed = aliveBefore - alive.length;
    const toHero = Math.round(alive.length * camp.dmgPerCreep * (incomingScaleRef.current ?? 1));
    if (toHero > 0) onHeroDamageRef.current?.(toHero); // creeps retaliate only when attacked
    const cleared = alive.length === 0;
    // XP per creep DEFEATED (registers incrementally), plus a clear bonus + Faction Points.
    const perCreepXp = Math.max(4, Math.round(camp.xpReward / Math.max(1, camp.creeps.length)));
    if (killed > 0) { awardXpRef.current?.(killed * perCreepXp); console.log(`[creeps] Defeated ${killed} → +${killed * perCreepXp} XP`); }
    if (cleared) {
      awardXpRef.current?.(Math.round(camp.xpReward * 0.25)); // completion bonus
      awardShardsRef.current?.(camp.shardReward);
      console.log(`[creeps] Camp ${key} cleared → +${camp.shardReward} FP`);
    }
    onCombatRef.current?.({ campQ: camp.q, campR: camp.r, toCreep, toHero, killed, cleared });
    setCamps(prev => {
      const c = prev.get(key);
      if (!c) return prev;
      const next = new Map(prev);
      next.set(key, { ...c, creeps, cleared });
      return next;
    });
    return true;
  }, [engagedKey]);

  // ── Ability strike — a burst of `power` damage to the nearby camp, NO retaliation
  //    (it's paid for with energy). Awards XP per kill + clear bonus like a normal hit.
  const strikeNearby = useCallback((power: number): { hit: boolean; killed: number; cleared: boolean } => {
    const key = engagedKey();
    if (!key) return { hit: false, killed: 0, cleared: false };
    const camp = campsRef.current.get(key);
    if (!camp || camp.cleared) return { hit: false, killed: 0, cleared: false };
    const aliveBefore = camp.creeps.filter(c => c.hp > 0).length;
    const creeps = camp.creeps.map(c => ({ ...c }));
    let dmg = Math.max(1, Math.round(power));
    let toCreep = 0;
    for (const c of creeps) {
      if (c.hp <= 0) continue;
      const applied = Math.min(c.hp, dmg);
      c.hp -= applied; dmg -= applied; toCreep += applied;
      if (dmg <= 0) break;
    }
    const alive = creeps.filter(c => c.hp > 0);
    const killed = aliveBefore - alive.length;
    const cleared = alive.length === 0;
    const perCreepXp = Math.max(4, Math.round(camp.xpReward / Math.max(1, camp.creeps.length)));
    if (killed > 0) awardXpRef.current?.(killed * perCreepXp);
    if (cleared) { awardXpRef.current?.(Math.round(camp.xpReward * 0.25)); awardShardsRef.current?.(camp.shardReward); }
    onCombatRef.current?.({ campQ: camp.q, campR: camp.r, toCreep, toHero: 0, killed, cleared });
    setCamps(prev => {
      const c = prev.get(key);
      if (!c) return prev;
      const next = new Map(prev);
      next.set(key, { ...c, creeps, cleared });
      return next;
    });
    return { hit: true, killed, cleared };
  }, [engagedKey]);

  return { camps, nearbyCamp, attackNearby, strikeNearby };
}
