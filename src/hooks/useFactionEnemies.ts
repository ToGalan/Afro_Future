/**
 * useFactionEnemies — mobile, AI-driven enemy units belonging to the RIVAL factions.
 *
 * This is the active-PvE enemy layer that sits on top of the neutral creep camps
 * (useCreeps) and the faction-aligned refugee settlements (useRefugeeCamps). Where a
 * creep camp is static and only fights back when struck, a faction enemy roams, hunts,
 * and attacks the hero in real time — its behaviour driven by its faction's doctrine
 * and by the mission objectives it is defending.
 *
 * Faction doctrines (the "faction goals" that shape the AI):
 *   - PAA (Pan-African Alliance)  "Heal & Unite"  → defensive Peacekeepers: short leash,
 *                                   guard their camps, retreat + regen when hurt.
 *   - ASF (African Sovereign Front) "Africa First" → aggressive Raiders: wide aggro,
 *                                   relentless pursuit (guerrilla), never retreat.
 *   - WC  (World Coalition)        "Survival"       → opportunistic Scavengers: strike
 *                                   harder when the hero is weak, retreat when losing.
 *
 * Mission linkage: rival units GUARD their faction's refugee camps/outposts (`guardPosts`).
 * Hostile mission actions — looting a rival camp, capturing a contested outpost — call
 * `provoke()`, which makes nearby same-faction units drop their leash and hunt the hero.
 *
 * Rendering is delegated to SoloMissionMap3D (reads `enemies`); combat hooks
 * (onHeroDamage / awardXp / awardFactionPoints / onEvent) are provided by the map.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { factionKey, type FactionKey } from './useRefugeeCamps';
import { PLAYER_XP_REWARDS } from '../services/playerExpEconomy';

type TileType = 'water' | 'desert' | 'plains' | 'forest' | 'jungle' | 'hills' | 'mountain';
interface MinTile { q: number; r: number; type: TileType }

export type EnemyState = 'guard' | 'patrol' | 'pursue' | 'attack' | 'retreat';

export interface FactionEnemy {
  id: string;
  faction: FactionKey;
  q: number; r: number;
  hp: number; maxHp: number;
  atk: number; level: number;
  state: EnemyState;
  role: 'guard' | 'roamer' | 'boss';
  homeQ: number; homeR: number;
  wanderQ: number; wanderR: number;
  attackReadyAt: number;   // performance.now() ms — next time this unit may strike
  provokedUntil: number;   // performance.now() ms — ignore leash while > now
  stunnedUntil?: number;   // performance.now() ms — frozen (no move/attack) while > now (stun/pacify/slow)
}

export interface GuardPost { key: string; q: number; r: number; faction: FactionKey }

export type EnemyEvent =
  | { kind: 'attack'; q: number; r: number; faction: FactionKey; dmg: number }
  | { kind: 'hurt';   q: number; r: number; faction: FactionKey; dmg: number }
  | { kind: 'kill';   q: number; r: number; faction: FactionKey; xp: number; fp: number; boss: boolean };

// Per-faction combat doctrine — the numbers that make each faction *feel* different.
interface Doctrine {
  color: string;
  label: string;
  aggro: number;      // detection radius (tiles)
  leash: number;      // how far from home it will chase (99 = relentless)
  retreat: number;    // retreat when hp fraction below this (0 = never)
  atkMult: number;    // damage multiplier
  hpMult: number;     // health multiplier
  moveEvery: number;  // move once every N ticks (lower = faster)
  opportunistic?: boolean; // widen aggro when the hero is weak
  passive?: boolean;       // GDD "diplomacy over war" — never aggress unless provoked/struck
}

export const DOCTRINE: Record<FactionKey, Doctrine> = {
  // PAA "Heal & Unite" — diplomatic Peacekeepers: never strike first (passive), guard
  // their camps, retreat + self-heal when hurt. They fight only once provoked.
  PAA: { color: '#37d3a6', label: 'Peacekeeper', aggro: 3, leash: 4,  retreat: 0.40, atkMult: 0.85, hpMult: 1.25, moveEvery: 2, passive: true },
  ASF: { color: '#e0574a', label: 'Raider',      aggro: 6, leash: 99, retreat: 0.00, atkMult: 1.30, hpMult: 0.95, moveEvery: 1 },
  WC:  { color: '#e0b64a', label: 'Scavenger',   aggro: 4, leash: 6,  retreat: 0.28, atkMult: 1.00, hpMult: 1.00, moveEvery: 1, opportunistic: true },
};

// Boss ("faction champion") multipliers — one per rival faction, the hero-tier leader
// defending that faction's mission objective. Worth GDD combat.bossDefeated XP.
const BOSS = { hpMult: 4, atkMult: 1.5, levelBonus: 4 };

const TICK_MS = 300;             // AI heartbeat
const ATTACK_INTERVAL_MS = 1100; // min time between a unit's strikes
const PROVOKE_MS = 12000;        // how long a provoked unit hunts before calming
const SAFE_RADIUS = 6;           // enemies won't engage the hero this near the base/spawn hub

function axialDist(aq: number, ar: number, bq: number, br: number): number {
  return (Math.abs(aq - bq) + Math.abs(ar - br) + Math.abs(aq + ar - bq - br)) / 2;
}
function hash(q: number, r: number): number {
  return Math.abs(Math.sin(q * 61.31 + r * 27.19) * 38211.117) % 1;
}
function neighbors(q: number, r: number): Array<{ q: number; r: number }> {
  return [
    { q: q + 1, r }, { q: q - 1, r },
    { q, r: r + 1 }, { q, r: r - 1 },
    { q: q + 1, r: r - 1 }, { q: q - 1, r: r + 1 },
  ];
}

interface UseFactionEnemiesOptions {
  tiles: MinTile[];
  heroQ: number;
  heroR: number;
  centerQ: number;
  centerR: number;
  /** Player faction (its own units are allies and never spawn as enemies). */
  faction?: string;
  /** Rival assets to defend — spawns guards around them (e.g. rival refugee camps). */
  guardPosts?: GuardPost[];
  /** Hero attack value for the player's melee/ability strikes against enemies. */
  heroAttack?: number;
  /** Hero HP fraction 0..1 — drives WC "opportunistic" aggression. */
  heroHpFrac?: number;
  /** Multiplier on damage the hero TAKES (e.g. lower in Defense mode). Default 1. */
  incomingDamageScale?: number;
  /** Master switch — disabled in multiplayer duels (also clears the roster). */
  enabled?: boolean;
  /** Freeze the AI (no movement/attacks) without despawning — e.g. skill-tree overlay open. */
  paused?: boolean;
  onHeroDamage?: (amount: number) => void;
  awardXp?: (amount: number) => void;
  awardFactionPoints?: (amount: number) => void;
  /** Combat feedback funnel (spawns floating text on the map). */
  onEvent?: (e: EnemyEvent) => void;
}

export function useFactionEnemies({
  tiles, heroQ, heroR, centerQ, centerR, faction, guardPosts,
  heroAttack = 8, heroHpFrac = 1, incomingDamageScale = 1, enabled = true, paused = false,
  onHeroDamage, awardXp, awardFactionPoints, onEvent,
}: UseFactionEnemiesOptions) {
  const [enemies, setEnemies] = useState<FactionEnemy[]>([]);
  const [nearbyEnemy, setNearbyEnemy] = useState<FactionEnemy | null>(null);

  // Refs so the AI interval + combat callbacks never go stale and never restart.
  const enemiesRef = useRef(enemies); enemiesRef.current = enemies;
  const heroRef = useRef({ q: heroQ, r: heroR }); heroRef.current = { q: heroQ, r: heroR };
  const atkRef = useRef(heroAttack); atkRef.current = heroAttack;
  const hpFracRef = useRef(heroHpFrac); hpFracRef.current = heroHpFrac;
  const incomingRef = useRef(incomingDamageScale); incomingRef.current = incomingDamageScale;
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const centerRef = useRef({ q: centerQ, r: centerR }); centerRef.current = { q: centerQ, r: centerR };
  const onHeroDamageRef = useRef(onHeroDamage); onHeroDamageRef.current = onHeroDamage;
  const awardXpRef = useRef(awardXp); awardXpRef.current = awardXp;
  const awardFpRef = useRef(awardFactionPoints); awardFpRef.current = awardFactionPoints;
  const onEventRef = useRef(onEvent); onEventRef.current = onEvent;

  // Walkable tile lookup (mountains/water block movement — same rule as the hero).
  const walkableRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const s = new Set<string>();
    for (const t of tiles) if (t.type !== 'mountain' && t.type !== 'water') s.add(`${t.q},${t.r}`);
    walkableRef.current = s;
  }, [tiles]);
  const isWalkable = (q: number, r: number) => walkableRef.current.has(`${q},${r}`);

  const me = factionKey(faction);

  // Stable signature of the guard posts so the spawn effect only re-runs when they
  // actually change (the array identity churns every render otherwise).
  const postsSig = useMemo(
    () => (guardPosts || []).map(p => `${p.key}:${p.faction}`).sort().join('|'),
    [guardPosts],
  );

  // ── Spawn enemies once tiles + guard posts are ready ────────────────────────
  useEffect(() => {
    if (!enabled) { if (enemiesRef.current.length) { enemiesRef.current = []; setEnemies([]); } return; }
    if (!tiles.length) return;
    const list: FactionEnemy[] = [];
    let idc = 0;
    const walk = walkableRef.current;
    const push = (fk: FactionKey, q: number, r: number, homeQ: number, homeR: number, role: 'guard' | 'roamer') => {
      const dist = axialDist(q, r, centerQ, centerR);
      const level = 1 + Math.floor(dist / 7);
      const doc = DOCTRINE[fk];
      const maxHp = Math.round((20 + level * 10) * doc.hpMult);
      const atk = Math.max(1, Math.round((3 + level * 1.5) * doc.atkMult));
      list.push({
        id: `enemy-${idc++}`, faction: fk, q, r, hp: maxHp, maxHp, atk, level,
        state: role === 'guard' ? 'guard' : 'patrol', role,
        homeQ, homeR, wanderQ: q, wanderR: r,
        attackReadyAt: 0, provokedUntil: 0,
      });
    };

    // 1) Defenders around each RIVAL faction's guarded asset (refugee camps/outposts).
    for (const post of guardPosts || []) {
      if (post.faction === me) continue; // your own faction's camps are friendly
      if (!walk.has(`${post.q},${post.r}`)) continue;
      const count = 2 + (Math.floor(hash(post.q * 5 + 3, post.r * 9 + 7) * 100) % 2); // 2–3
      let placed = 0;
      // Guard sits on adjacent walkable tiles; falls back to the post tile itself.
      const spots = [{ q: post.q, r: post.r }, ...neighbors(post.q, post.r)];
      for (const s of spots) {
        if (placed >= count) break;
        if (!walk.has(`${s.q},${s.r}`)) continue;
        push(post.faction, s.q, s.r, post.q, post.r, 'guard');
        placed++;
      }
    }

    // 2) Free-roaming rival patrols, sparse and away from the spawn hub.
    const rivals = (['PAA', 'ASF', 'WC'] as FactionKey[]).filter(f => f !== me);
    for (const t of tiles) {
      if (t.type === 'water' || t.type === 'mountain') continue;
      const dist = axialDist(t.q, t.r, centerQ, centerR);
      if (dist < 8) continue;                 // keep the area near base safe
      const h = hash(t.q, t.r);
      if (h >= 0.006) continue;               // ~0.6% of eligible tiles
      const fk = rivals[Math.floor(hash(t.q * 7 + 1, t.r * 3 + 5) * rivals.length) % rivals.length];
      push(fk, t.q, t.r, t.q, t.r, 'roamer');
    }

    // 3) Promote one unit per rival faction to a BOSS — the faction's champion/leader
    //    ("the faction player"), guarding that faction's deepest mission objective.
    for (const fk of rivals) {
      const units = list.filter(e => e.faction === fk);
      if (!units.length) continue;
      // Farthest-from-spawn unit = that faction's stronghold guardian.
      let boss = units[0], bd = -1;
      for (const u of units) { const d = axialDist(u.q, u.r, centerQ, centerR); if (d > bd) { bd = d; boss = u; } }
      boss.role = 'boss';
      boss.level += BOSS.levelBonus;
      boss.maxHp = Math.round(boss.maxHp * BOSS.hpMult);
      boss.hp = boss.maxHp;
      boss.atk = Math.round(boss.atk * BOSS.atkMult);
      boss.homeQ = boss.q; boss.homeR = boss.r; // anchor the boss to its objective
    }

    setEnemies(list);
    enemiesRef.current = list;
    console.log('[enemies] Spawned', list.length, `faction units (player ${me})`);
  }, [tiles, centerQ, centerR, me, postsSig, enabled]);

  // ── Nearby enemy (for the "press to attack" prompt) ─────────────────────────
  useEffect(() => {
    let best: FactionEnemy | null = null;
    let bestHp = Infinity;
    for (const en of enemies) {
      if (en.hp <= 0) continue;
      if (axialDist(heroQ, heroR, en.q, en.r) <= 1 && en.hp < bestHp) { best = en; bestHp = en.hp; }
    }
    setNearbyEnemy(best);
  }, [enemies, heroQ, heroR]);

  // ── AI heartbeat — movement + real-time attacks, computed off the ref ───────
  useEffect(() => {
    let tick = 0;
    const id = window.setInterval(() => {
      if (!enabledRef.current || pausedRef.current) return; // frozen while a menu/overlay is open
      const cur = enemiesRef.current;
      if (!cur.length) return;
      tick++;
      const now = performance.now();
      const h = heroRef.current;
      const hpFrac = hpFracRef.current;
      const c = centerRef.current;
      // While the hero is inside the base safe-zone, no unit engages (prevents provoked
      // long-leash raiders from spawn-camping the respawn point into a death loop).
      const heroSafe = axialDist(h.q, h.r, c.q, c.r) <= SAFE_RADIUS;
      let heroDamage = 0;
      const events: EnemyEvent[] = [];

      // Step a unit one tile toward `target`, over walkable ground, optionally never
      // stepping onto the hero's tile (so pursuers halt adjacent instead of overlapping).
      const stepToward = (en: FactionEnemy, tq: number, tr: number, avoidHero: boolean) => {
        let bq = en.q, br = en.r, bestD = axialDist(en.q, en.r, tq, tr);
        for (const n of neighbors(en.q, en.r)) {
          if (!isWalkable(n.q, n.r)) continue;
          if (avoidHero && n.q === h.q && n.r === h.r) continue;
          const d = axialDist(n.q, n.r, tq, tr);
          if (d < bestD) { bestD = d; bq = n.q; br = n.r; }
        }
        return { q: bq, r: br };
      };
      // Step AWAY from the hero (retreat) — maximise distance over walkable ground.
      const stepAway = (en: FactionEnemy) => {
        let bq = en.q, br = en.r, bestD = axialDist(en.q, en.r, h.q, h.r);
        for (const n of neighbors(en.q, en.r)) {
          if (!isWalkable(n.q, n.r)) continue;
          const d = axialDist(n.q, n.r, h.q, h.r);
          if (d > bestD) { bestD = d; bq = n.q; br = n.r; }
        }
        return { q: bq, r: br };
      };

      const next = cur.map(en => {
        if (en.hp <= 0) return en;
        // Stunned / pacified (player debuff): frozen — cannot move or strike this tick.
        if (en.stunnedUntil && en.stunnedUntil > now) return en;
        const doc = DOCTRINE[en.faction];
        const dHero = axialDist(en.q, en.r, h.q, h.r);
        const dHome = axialDist(en.q, en.r, en.homeQ, en.homeR);
        const provoked = en.provokedUntil > now;
        const canMove = tick % doc.moveEvery === 0;

        let aggro = doc.aggro;
        if (provoked) aggro = Math.max(aggro, 8);
        if (doc.opportunistic && hpFrac < 0.5) aggro += 3; // WC pounces on a weak hero

        const wantsRetreat = doc.retreat > 0 && en.hp / en.maxHp < doc.retreat;
        const withinLeash = doc.leash >= 99 || provoked || dHome <= doc.leash;
        // GDD: passive factions (PAA "diplomacy over war") never strike first — they only
        // engage once provoked (struck, or reacting to a hostile mission action).
        // No unit engages a hero sheltering in the base safe-zone.
        const hostile = (!doc.passive || provoked) && !heroSafe;

        // ── Retreat: fall back toward home and self-heal a little ──────────────
        if (wantsRetreat && dHero <= aggro + 2) {
          const pos = canMove ? stepToward(en, en.homeQ, en.homeR, false) : { q: en.q, r: en.r };
          const hp = Math.min(en.maxHp, en.hp + Math.round(en.maxHp * 0.03));
          return { ...en, ...pos, hp, state: 'retreat' as EnemyState };
        }

        // ── Engaged: pursue and strike ────────────────────────────────────────
        if (hostile && dHero <= aggro && withinLeash) {
          if (dHero <= 1) {
            // Adjacent → attack on cooldown (do not move onto the hero).
            if (now >= en.attackReadyAt) {
              const dmg = Math.max(1, Math.round(en.atk * incomingRef.current));
              heroDamage += dmg;
              events.push({ kind: 'attack', q: en.q, r: en.r, faction: en.faction, dmg });
              return { ...en, state: 'attack' as EnemyState, attackReadyAt: now + ATTACK_INTERVAL_MS };
            }
            return { ...en, state: 'attack' as EnemyState };
          }
          const pos = canMove ? stepToward(en, h.q, h.r, true) : { q: en.q, r: en.r };
          return { ...en, ...pos, state: 'pursue' as EnemyState };
        }

        // ── Idle: guard / patrol near home ────────────────────────────────────
        if (canMove) {
          if (dHome > 2) {
            const pos = stepToward(en, en.homeQ, en.homeR, false);
            return { ...en, ...pos, state: en.role === 'roamer' ? 'patrol' as EnemyState : 'guard' as EnemyState };
          }
          // Gentle wander around home every few ticks.
          if (tick % (doc.moveEvery * 3) === 0) {
            const opts = neighbors(en.q, en.r).filter(n => isWalkable(n.q, n.r) && axialDist(n.q, n.r, en.homeQ, en.homeR) <= 2);
            if (opts.length) {
              const pick = opts[Math.floor(hash(en.q + tick, en.r) * opts.length) % opts.length];
              return { ...en, q: pick.q, r: pick.r, state: en.role === 'roamer' ? 'patrol' as EnemyState : 'guard' as EnemyState };
            }
          }
        }
        return en.state === 'pursue' || en.state === 'attack' || en.state === 'retreat'
          ? { ...en, state: en.role === 'roamer' ? 'patrol' as EnemyState : 'guard' as EnemyState }
          : en;
      });

      // Only re-render when something actually changed — idle units at home return their
      // own ref, so a still hero near no enemies costs no map re-render.
      const changed = next.length !== cur.length || next.some((e, i) => e !== cur[i]);
      if (changed) { enemiesRef.current = next; setEnemies(next); }
      if (heroDamage > 0) onHeroDamageRef.current?.(heroDamage);
      for (const ev of events) onEventRef.current?.(ev);
    }, TICK_MS);
    return () => window.clearInterval(id);
    // Empty deps: heartbeat runs for the hook's lifetime; all state read via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Hero → enemy damage. Resolve the adjacent (or, for abilities, near) unit ──
  const applyHeroDamage = useCallback((power: number, reach: number): { hit: boolean; killed: number } => {
    const cur = enemiesRef.current;
    const h = heroRef.current;
    const now = performance.now();
    // Target the lowest-HP live enemy in reach (finish off wounded units first).
    let idx = -1, bestHp = Infinity;
    for (let i = 0; i < cur.length; i++) {
      const en = cur[i];
      if (en.hp <= 0) continue;
      if (axialDist(en.q, en.r, h.q, h.r) <= reach && en.hp < bestHp) { idx = i; bestHp = en.hp; }
    }
    if (idx < 0) return { hit: false, killed: 0 };
    const target = cur[idx];
    const dmg = Math.max(1, Math.round(power));
    const hp = target.hp - dmg;
    const next = cur.slice();
    let killed = 0;
    if (hp <= 0) {
      killed = 1;
      // GDD economy: flat combat rewards — a grunt is `enemyDefeated`, a faction champion
      // is `bossDefeated`. Faction Points scale with the unit's threat.
      const boss = target.role === 'boss';
      const xp = boss ? PLAYER_XP_REWARDS.combat.bossDefeated : PLAYER_XP_REWARDS.combat.enemyDefeated;
      const fp = boss ? 10 + target.level : 2 + Math.floor(target.level / 2);
      awardXpRef.current?.(xp);
      awardFpRef.current?.(fp);
      onEventRef.current?.({ kind: 'kill', q: target.q, r: target.r, faction: target.faction, xp, fp, boss });
      next.splice(idx, 1);
    } else {
      onEventRef.current?.({ kind: 'hurt', q: target.q, r: target.r, faction: target.faction, dmg });
      next[idx] = { ...target, hp };
    }
    // Striking a unit alerts nearby same-faction units — they drop leash and hunt.
    for (let i = 0; i < next.length; i++) {
      const en = next[i];
      if (en.faction === target.faction && axialDist(en.q, en.r, target.q, target.r) <= 4) {
        next[i] = { ...en, provokedUntil: now + PROVOKE_MS };
      }
    }
    enemiesRef.current = next;
    setEnemies(next);
    return { hit: true, killed };
  }, []);

  // Player melee (F): hit an adjacent enemy with the hero's attack value.
  const attackNearby = useCallback((): { hit: boolean; killed: number } => {
    return applyHeroDamage(atkRef.current || 5, 1);
  }, [applyHeroDamage]);

  // Ability strike (Q/W/E/R): a burst of `power` damage at slightly longer reach.
  const strikeNearby = useCallback((power: number): { hit: boolean; killed: number } => {
    return applyHeroDamage(power, 2);
  }, [applyHeroDamage]);

  // Player debuff: freeze the nearest enemy in reach (stun/pacify/slow from a skill).
  // Pacify also clears its aggression. Returns whether a target was affected.
  const applyEnemyEffect = useCallback((kind: 'stun' | 'pacify' | 'slow', durationMs: number, reach = 2): boolean => {
    const cur = enemiesRef.current;
    const h = heroRef.current;
    const now = performance.now();
    let idx = -1, best = Infinity;
    for (let i = 0; i < cur.length; i++) {
      const en = cur[i];
      if (en.hp <= 0) continue;
      const d = axialDist(en.q, en.r, h.q, h.r);
      if (d <= reach && d < best) { idx = i; best = d; }
    }
    if (idx < 0) return false;
    const next = cur.slice();
    const en = next[idx];
    next[idx] = {
      ...en,
      stunnedUntil: Math.max(en.stunnedUntil || 0, now + durationMs),
      provokedUntil: kind === 'pacify' ? 0 : en.provokedUntil,
    };
    enemiesRef.current = next;
    setEnemies(next);
    return true;
  }, []);

  // Mission reaction: provoke same-faction units near a point (loot/capture/aggression).
  const provoke = useCallback((q: number, r: number, fk: FactionKey | undefined, radius = 6) => {
    const now = performance.now();
    const cur = enemiesRef.current;
    let changed = false;
    const next = cur.map(en => {
      if (fk && en.faction !== fk) return en;
      if (axialDist(en.q, en.r, q, r) > radius) return en;
      changed = true;
      return { ...en, provokedUntil: now + PROVOKE_MS };
    });
    if (changed) { enemiesRef.current = next; setEnemies(next); }
  }, []);

  const threat = useMemo(() => {
    const byFaction: Partial<Record<FactionKey, number>> = {};
    let hunting = 0;
    for (const en of enemies) {
      if (en.hp <= 0) continue;
      byFaction[en.faction] = (byFaction[en.faction] || 0) + 1;
      if (en.state === 'pursue' || en.state === 'attack') hunting++;
    }
    return { total: enemies.length, hunting, byFaction };
  }, [enemies]);

  return { enemies, nearbyEnemy, attackNearby, strikeNearby, applyEnemyEffect, provoke, threat };
}
