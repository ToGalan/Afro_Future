import React, { useMemo, useState, useEffect, Suspense, useRef } from 'react';
import { usePlayerProfile } from '../hooks/usePlayerProfile';
import { usePlayerSession } from '../hooks/usePlayerSession';
import { usePetXP } from '../hooks/usePetXP';
import { useCollectibles, RESOURCE_DEFS } from '../hooks/useCollectibles';
import type { Mesh } from 'three';
import * as THREE from 'three';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Sky, ContactShadows } from '@react-three/drei';
import { GameAvatar, type AvatarColors } from './GameAvatarMesh';
import { resolveHeroModel } from '../config/heroModels';
import { useCreeps, type CreepCamp } from '../hooks/useCreeps';
import { useOutposts } from '../hooks/useOutposts';
import { useRefugeeCamps, factionKey, type FactionKey } from '../hooks/useRefugeeCamps';
import { useFactionEnemies, DOCTRINE, type FactionEnemy, type GuardPost } from '../hooks/useFactionEnemies';
import { useDuel, type RemoteHero } from '../hooks/useDuel';
import { watchOpenRooms } from '../services/duelSignaling';
import { useMobaMatch, type MobaHero } from '../hooks/useMobaMatch';
import { MOBA_SCORING, type Faction } from '../services/mobaMatch';
import { PLAYSTYLES, PLAYSTYLE_ORDER, emptyReputation, dominantPlaystyle, type Playstyle, type PlaystyleReputation } from '../services/playstyles';
import { useSkillStore } from '../store/skillStore';
import { skillEffectFor, type SkillEffect } from '../store/skillData';
import { pruneEffects, aggregateEffects, type ActiveEffect } from '../services/statusEffects';
import { getLevelFromXp, getTotalXpForLevel, getXpForNextLevel } from '../services/playerExpEconomy';
import { IsometricCharacter } from './IsometricCharacter';
import type { Archetype, CharacterLoadout } from '../types/loadout';
import { GameHUD, type MinimapData, type Ability, type Item } from './gameHUD';
import { SceneSetupVerifier, AvatarRenderingVerifier, PerformanceChecker } from './SceneSetupVerifier';
// Side-effect imports: reference systems attach to window.* and expect global THREE
import '../assets/ref_3d_map/mountain-system.js';
import '../assets/ref_3d_map/integration-helper.js';
import '../assets/ref_3d_map/tree-system.js';
import '../assets/ref_3d_map/water-isometric.js';
import '../assets/ref_3d_map/hills-system.js';
import '../assets/ref_3d_map/desert-system.js';
import { useVisibleChunks } from '../hooks/useVisibleChunks';
import { getCachedChunk } from '../services/mapChunks';
import { updateAvatarCollision, createFloorCollider } from '../services/collisionDetection';

// Types
type TileType = 'water' | 'desert' | 'plains' | 'forest' | 'jungle' | 'hills' | 'mountain';
type ResourceType = 'ore' | 'energy' | 'bio' | null;
interface Axial { q: number; r: number; }
type TerrainChar = 'P' | 'F' | 'J' | 'H' | 'D' | 'O' | 'R' | 'M' | 'L' | 'N' | 'V';
interface Tile extends Axial { type: TileType; resource: ResourceType; char: TerrainChar; }
interface Actor { id: string; pos: Axial; vision: number; kind: 'actor' | 'pet'; xp?: number; }
interface WorldPos { x: number; z: number; }

// Hex helpers & orientation
// Force flat-top orientation (edges horizontal). We rotate geometry so adjacent sides touch.
const ORIENT: 'pointy' | 'flat' = 'flat';
// Apothem helper (distance from center to middle of an edge)
function hexApothem(R: number) { return R * Math.cos(Math.PI / 6); }

function axialDistance(a: Axial, b: Axial) {
  const aq = a.q, ar = a.r, as = -aq - ar;
  const bq = b.q, br = b.r, bs = -bq - br;
  return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(as - bs));
}

function axialToWorld(a: Axial, R_outer: number) {
  if (ORIENT === 'pointy') {
    // pointy-top layout
    const x = R_outer * (Math.sqrt(3) * (a.q + a.r / 2));
    const z = R_outer * (1.5 * a.r);
    return { x, z };
  } else {
    // flat-top layout
    const x = R_outer * (1.5 * a.q);
    const z = R_outer * (Math.sqrt(3) * (a.r + a.q / 2));
    return { x, z };
  }
}

function axialNeighbors(a: Axial): Axial[] {
  return [
    { q: a.q + 1, r: a.r },
    { q: a.q - 1, r: a.r },
    { q: a.q, r: a.r + 1 },
    { q: a.q, r: a.r - 1 },
    { q: a.q + 1, r: a.r - 1 },
    { q: a.q - 1, r: a.r + 1 },
  ];
}

// PRNG
function seededRand(seed: number) {
  let t = seed + 0x6d2b79f5;
  return () => {
    t |= 0;
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate a hex map and ensure the outer perimeter (distance==radius) is a continuous walkable ring.
// Small integer hash for per-tile seeded noise
function hash2(q: number, r: number, seed: number) {
  let h = 2166136261 ^ seed;
  h = Math.imul(h ^ q, 16777619);
  h = Math.imul(h ^ r, 16777619);
  return h >>> 0;
}

// Generate a hex map and ensure the outer perimeter (distance==radius) is a continuous walkable ring.
function charToType(c: TerrainChar): TileType {
  if (c === 'L' || c === 'N' || c === 'V') return 'water';
  if (c === 'F') return 'forest';
  if (c === 'J') return 'jungle';
  if (c === 'H') return 'hills';
  if (c === 'D') return 'desert';
  if (c === 'O' || c === 'R' || c === 'M') return 'mountain';
  return 'plains';
}

// Rectangular flat-top hex grid generation using even-q offset -> axial conversion
function generateTerrainMapRect(width: number, height: number, seed = 42): Tile[] {
  // Contiguous region generator using multi-source stochastic growth.
  // 1. Build coordinate list (rectangular even-q offset -> axial)
  const rng = seededRand(seed);
  interface Coord { q: number; r: number; }
  const coords: Coord[] = [];
  for (let col = 0; col < width; col++) {
    for (let row = 0; row < height; row++) {
      const q = col;
      const r = row - ((col & 1) ? ((col + 1) >> 1) : (col >> 1));
      coords.push({ q, r });
    }
  }
  const total = coords.length;

  // 2. Biome configuration (target coverage ratios sum < 1; leftover becomes plains)
  // Ratios tuned for large map readability (clustered but diverse)
  const biomeConfigs: Array<{
    key: string;
    ratio: number;               // target fraction of total tiles
    minSeeds: number;             // number of initial seeds (regions) for this biome
    maxSeeds: number;
    chars: TerrainChar[];         // possible chars used for this biome
    growthProb: number;           // base probability to claim neighbor (adds ragged edges)
  }> = [
    // Slightly reduced ratios for large maps to allow more plains buffer and clearer macro regions
    { key: 'water',    ratio: 0.085, minSeeds: 6,  maxSeeds: 14, chars: ['L','N','V'], growthProb: 0.58 },
    { key: 'desert',   ratio: 0.105, minSeeds: 7, maxSeeds: 16, chars: ['D'],        growthProb: 0.63 },
    { key: 'forest',   ratio: 0.135, minSeeds: 8, maxSeeds: 18, chars: ['F'],        growthProb: 0.66 },
    { key: 'jungle',   ratio: 0.065, minSeeds: 5, maxSeeds: 12, chars: ['J'],        growthProb: 0.60 },
    { key: 'hills',    ratio: 0.105, minSeeds: 7, maxSeeds: 16, chars: ['H'],        growthProb: 0.60 },
    { key: 'mountain', ratio: 0.075, minSeeds: 6, maxSeeds: 14, chars: ['O','R','M'],growthProb: 0.53 },
  ];

  // Shuffle helper (Fisher–Yates)
  function shuffle<T>(arr: T[]) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // 3. Prepare assignment maps
  const assigned = new Map<string, TerrainChar>();
  const claimedByBiome = new Map<string, number>(); // biome key -> count
  const targetByBiome = new Map<string, number>();  // biome key -> target tiles
  const frontierByBiome = new Map<string, Array<{ q: number; r: number }>>();

  function key(a: Axial) { return `${a.q},${a.r}`; }

  // 4. Determine targets & seeds
  const isLarge = width * height > 15000; // threshold for macro-region tuning
  for (const cfg of biomeConfigs) {
    const target = Math.max(1, Math.floor(total * cfg.ratio));
    targetByBiome.set(cfg.key, target);
    claimedByBiome.set(cfg.key, 0);
    frontierByBiome.set(cfg.key, []);
    // Number of seeds scaled loosely to sqrt of target for reasonable region sizes
    let seedCount = Math.min(cfg.maxSeeds, Math.max(cfg.minSeeds, Math.floor(Math.sqrt(target) * 0.9)));
    if (isLarge) {
      // On very large maps reduce seed counts further to encourage bigger contiguous biomes
      seedCount = Math.max(cfg.minSeeds, Math.floor(seedCount * 0.55));
    }
    // Pick seed tiles uniformly from unassigned coordinates (shuffle view each loop)
    const pool = shuffle([...coords]);
    let placed = 0; let idx = 0;
    while (placed < seedCount && idx < pool.length) {
      const c = pool[idx++];
      const k = key(c);
      if (assigned.has(k)) continue;
      // Avoid clumping seeds too tightly: skip if too many same-biome neighbors already
      let sameAdj = 0;
      for (const n of axialNeighbors(c)) if (assigned.get(key(n)) && assigned.get(key(n)) === assigned.get(k)) sameAdj++;
      // (simple heuristic; mostly seeds are empty zone)
      const char = cfg.chars[Math.floor(rng() * cfg.chars.length)];
      assigned.set(k, char);
      claimedByBiome.set(cfg.key, (claimedByBiome.get(cfg.key) || 0) + 1);
      frontierByBiome.get(cfg.key)!.push(c);
      placed++;
    }
  }

  // 5. Region growth loop (cap iterations to prevent infinite loops)
  const maxIterations = total * 4; // generous cap
  let iterations = 0;
  // Precompute set of all coords for boundary checks
  const coordSet = new Set<string>(coords.map(c => key(c)));
  const unfinished = () => biomeConfigs.some(cfg => (claimedByBiome.get(cfg.key) || 0) < (targetByBiome.get(cfg.key) || 0));
  while (unfinished() && iterations < maxIterations) {
    iterations++;
    // Randomize order each pass for fairness
    const order = shuffle([...biomeConfigs]);
    for (const cfg of order) {
      const current = claimedByBiome.get(cfg.key)!;
      const target = targetByBiome.get(cfg.key)!;
      if (current >= target) continue;
      const frontier = frontierByBiome.get(cfg.key)!;
      if (frontier.length === 0) continue;
      // Pick a random frontier cell
      const fi = Math.floor(rng() * frontier.length);
      const cell = frontier[fi];
      // Explore neighbors
      const neigh = shuffle(axialNeighbors(cell));
      for (const n of neigh) {
        if (claimedByBiome.get(cfg.key)! >= target) break;
        const nk = key(n);
        if (!coordSet.has(nk)) continue; // outside rectangle
        if (assigned.has(nk)) continue;  // already claimed
        // Probability gating (slightly reduce probability as region overshoots half target to slow expansion)
        const fillRatio = current / target;
        const prob = cfg.growthProb * (fillRatio < 0.5 ? 1 : (1 - 0.4 * (fillRatio - 0.5))); // taper after 50%
        if (rng() < prob) {
          const char = cfg.chars[Math.floor(rng() * cfg.chars.length)];
          assigned.set(nk, char);
          claimedByBiome.set(cfg.key, (claimedByBiome.get(cfg.key) || 0) + 1);
          frontier.push(n);
        }
      }
      // Cull frontier entries that are surrounded (all neighbors claimed) periodically
      if (iterations % 25 === 0) {
        for (let i = frontier.length - 1; i >= 0; i--) {
          const c = frontier[i];
            let open = false;
            for (const n of axialNeighbors(c)) {
              const nk = key(n);
              if (coordSet.has(nk) && !assigned.has(nk)) { open = true; break; }
            }
            if (!open) frontier.splice(i,1);
        }
      }
    }
  }

  // 6. Convert to tiles; unassigned -> plains 'P'
  const tiles: Tile[] = [];
  for (const c of coords) {
    const k = key(c);
    const char = assigned.get(k) || 'P';
    const type = charToType(char);
    tiles.push({ q: c.q, r: c.r, char, type, resource: null });
  }

  if (isLarge) {
    // 7. Smoothing pass: unify tiny outlier cells that have a dominant neighbor biome (>=4 of 6 neighbors)
    const byKey = new Map<string, Tile>();
    for (const t of tiles) byKey.set(`${t.q},${t.r}`, t);
    const toFlip: Tile[] = [];
    for (const t of tiles) {
      const counts = new Map<TerrainChar, number>();
      for (const n of axialNeighbors(t)) {
        const nt = byKey.get(`${n.q},${n.r}`);
        if (!nt) continue;
        counts.set(nt.char, (counts.get(nt.char) || 0) + 1);
      }
      let bestChar: TerrainChar | null = null; let bestCount = 0;
      counts.forEach((cCnt, cChar) => { if (cCnt > bestCount) { bestCount = cCnt; bestChar = cChar; } });
      if (bestChar && bestChar !== t.char && bestCount >= 4) {
        toFlip.push(t);
      }
    }
    for (const t of toFlip) {
      t.char = byKey.get(`${t.q},${t.r}`)!.char = ( () => {
        // Re-evaluate majority to avoid stale choice if neighbors changed earlier this loop
        const counts = new Map<TerrainChar, number>();
        for (const n of axialNeighbors(t)) {
          const nt = byKey.get(`${n.q},${n.r}`);
          if (!nt) continue;
          counts.set(nt.char, (counts.get(nt.char) || 0) + 1);
        }
        let bestChar2: TerrainChar = t.char;
        let bestCount2 = 0;
        counts.forEach((cCnt, cChar) => { if (cCnt > bestCount2) { bestCount2 = cCnt; bestChar2 = cChar; } });
        return bestChar2;
      })();
      t.type = charToType(t.char);
    }
  }

  return tiles;
}

// Assign gatherable resources by terrain: ore on rocky ground (mountains/hills),
// energy in the desert, bio in forest/jungle. Deterministic per-tile hash so the
// same map always seeds the same resources.
function assignResources(tiles: Tile[]) {
  for (const t of tiles) {
    t.resource = null;
    const h = Math.abs(Math.sin(t.q * 12.9898 + t.r * 78.233) * 43758.5453) % 1;
    if (t.type === 'mountain' || t.type === 'hills') { if (h < 0.26) t.resource = 'ore'; }
    else if (t.type === 'desert') { if (h < 0.18) t.resource = 'energy'; }
    else if (t.type === 'forest' || t.type === 'jungle') { if (h < 0.16) t.resource = 'bio'; }
  }
}

function keyOf(a: Axial) { return `${a.q},${a.r}`; }

// Visibility with terrain attenuation: forests/jungles reduce range more; mountains block.
function computeVisibleSet(tiles: Tile[], center: Axial, baseRange: number) {
  const byKey = new Map<string, Tile>();
  for (const t of tiles) byKey.set(keyOf(t), t);
  const bestRemaining = new Map<string, number>();
  const q: Array<{ pos: Axial; rem: number }> = [{ pos: center, rem: baseRange }];
  const visible = new Set<string>();
  let head = 0;
  while (head < q.length) {
    const { pos, rem } = q[head++];
    const posKey = keyOf(pos);
    const curTile = byKey.get(posKey);
    if (!curTile) continue;
    // Always mark current tile visible: mountains ARE visible (you can see them &
    // stand on them), they just don't propagate vision further.
    visible.add(posKey);
    // Mountains (and budget exhaustion) stop propagation — but the tile itself is counted above.
    if (rem <= 0 || curTile.type === 'mountain') continue;
    for (const n of axialNeighbors(pos)) {
      const nKey = keyOf(n);
      const nTile = byKey.get(nKey);
      if (!nTile) continue;
      // Allow mountain neighbors to be queued — they'll be visible but won't propagate (handled above).
      const stepCost = (nTile.type === 'forest' || nTile.type === 'jungle') ? 2 : 1;
      const nextRem = rem - stepCost;
      if (nextRem < 0) continue;
      const prev = bestRemaining.get(nKey);
      if (prev === undefined || nextRem > prev) {
        bestRemaining.set(nKey, nextRem);
        q.push({ pos: n, rem: nextRem });
      }
    }
  }
  return visible;
}

function adjacentMountains(tilesByKey: Map<string, Tile>, a: Axial) {
  let count = 0;
  for (const n of axialNeighbors(a)) {
    const t = tilesByKey.get(keyOf(n));
    if (t && t.type === 'mountain') count++;
  }
  return count;
}

/** Low-poly neutral creep camp: alive creeps in a ring, each with an HP bar + a level tag. */
function CreepCampMesh({ camp, size }: { camp: CreepCamp; size: number }) {
  const alive = camp.creeps.filter(c => c.hp > 0);
  if (!alive.length) return null;
  const cs = size * 0.3;
  return (
    <group>
      {alive.map((c, i) => {
        const ang = (i / alive.length) * Math.PI * 2;
        const rad = alive.length > 1 ? size * 0.42 : 0;
        const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
        const hpPct = Math.max(0, c.hp / c.maxHp);
        return (
          <group key={c.id} position={[x, 0, z]} rotation={[0, ang, 0]}>
            {/* Lower body / haunches */}
            <mesh position={[0, cs * 0.6, -cs * 0.08]} castShadow><dodecahedronGeometry args={[cs * 0.5, 0]} /><meshStandardMaterial color="#47182a" roughness={0.8} flatShading /></mesh>
            {/* Chest / torso */}
            <mesh position={[0, cs * 0.98, 0]} castShadow>
              <icosahedronGeometry args={[cs * 0.66, 0]} />
              <meshStandardMaterial color="#5a2233" roughness={0.7} emissive="#3a0d18" emissiveIntensity={0.35} flatShading />
            </mesh>
            {/* Cyber shoulder plates */}
            {[0.5, -0.5].map((px, pi) => (
              <mesh key={pi} position={[cs * px, cs * 1.15, -cs * 0.05]} rotation={[0, 0, px > 0 ? -0.4 : 0.4]} castShadow><octahedronGeometry args={[cs * 0.24, 0]} /><meshStandardMaterial color="#241018" metalness={0.5} roughness={0.5} flatShading /></mesh>
            ))}
            {/* Head + snout/maw */}
            <mesh position={[0, cs * 1.28, cs * 0.12]} castShadow><icosahedronGeometry args={[cs * 0.34, 0]} /><meshStandardMaterial color="#4a1c2b" roughness={0.7} flatShading /></mesh>
            <mesh position={[0, cs * 1.16, cs * 0.4]} rotation={[0.5, 0, 0]} castShadow><coneGeometry args={[cs * 0.2, cs * 0.4, 6]} /><meshStandardMaterial color="#3a1622" roughness={0.75} flatShading /></mesh>
            {/* Fangs */}
            {[0.09, -0.09].map((fx, fi) => (
              <mesh key={fi} position={[cs * fx, cs * 1.02, cs * 0.5]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[cs * 0.04, cs * 0.16, 4]} /><meshStandardMaterial color="#e8dcc0" flatShading /></mesh>
            ))}
            {/* Glowing eyes */}
            <mesh position={[cs * 0.16, cs * 1.34, cs * 0.36]}><sphereGeometry args={[cs * 0.09, 8, 8]} /><meshBasicMaterial color="#ff3b3b" /></mesh>
            <mesh position={[-cs * 0.16, cs * 1.34, cs * 0.36]}><sphereGeometry args={[cs * 0.09, 8, 8]} /><meshBasicMaterial color="#ff3b3b" /></mesh>
            {/* Horns (paired, swept) */}
            {[[0.32, -0.5], [-0.32, 0.5]].map(([hx, rz], hi) => (
              <mesh key={hi} position={[cs * hx, cs * 1.55, -cs * 0.05]} rotation={[-0.3, 0, rz]} castShadow><coneGeometry args={[cs * 0.11, cs * 0.52, 6]} /><meshStandardMaterial color="#2a0e16" roughness={0.8} flatShading /></mesh>
            ))}
            {/* Glowing cyber spine implants */}
            {[0.45, 0.7, 0.95].map((sy, si) => (
              <mesh key={si} position={[0, cs * sy, -cs * 0.42]}><octahedronGeometry args={[cs * (0.12 - si * 0.015), 0]} /><meshStandardMaterial color="#ff5a3c" emissive="#ff2a10" emissiveIntensity={0.9} flatShading /></mesh>
            ))}
            {/* Tail */}
            <mesh position={[0, cs * 0.5, -cs * 0.6]} rotation={[0.8, 0, 0]} castShadow><coneGeometry args={[cs * 0.14, cs * 0.7, 6]} /><meshStandardMaterial color="#3a1622" roughness={0.85} flatShading /></mesh>
            {/* Clawed arms — upper + forearm + claws */}
            {[0.62, -0.62].map((ax, ai) => (
              <group key={ai} position={[cs * ax, cs * 0.85, cs * 0.1]} rotation={[0, 0, ax > 0 ? -0.9 : 0.9]}>
                <mesh castShadow><cylinderGeometry args={[cs * 0.09, cs * 0.11, cs * 0.6, 6]} /><meshStandardMaterial color="#4a1c2b" roughness={0.75} flatShading /></mesh>
                {[-0.08, 0, 0.08].map((clx, ci) => (
                  <mesh key={ci} position={[cs * clx, -cs * 0.42, cs * 0.06]} rotation={[0.4, 0, 0]}><coneGeometry args={[cs * 0.03, cs * 0.2, 4]} /><meshStandardMaterial color="#d8ccb0" flatShading /></mesh>
                ))}
              </group>
            ))}
            {/* Legs — thigh + clawed foot */}
            {[0.26, -0.26].map((lx, li) => (
              <group key={li} position={[cs * lx, 0, 0]}>
                <mesh position={[0, cs * 0.32, 0]} castShadow><cylinderGeometry args={[cs * 0.1, cs * 0.12, cs * 0.6, 6]} /><meshStandardMaterial color="#3a1622" roughness={0.8} flatShading /></mesh>
                <mesh position={[0, cs * 0.04, cs * 0.08]} castShadow><boxGeometry args={[cs * 0.2, cs * 0.1, cs * 0.3]} /><meshStandardMaterial color="#2a0e16" flatShading /></mesh>
              </group>
            ))}
            {/* HP bar */}
            <mesh position={[0, cs * 1.95, 0]}><boxGeometry args={[cs * 1.2, cs * 0.16, cs * 0.05]} /><meshBasicMaterial color="#300000" /></mesh>
            <mesh position={[-(cs * 1.2) * (1 - hpPct) / 2, cs * 1.95, cs * 0.04]}><boxGeometry args={[Math.max(0.001, cs * 1.2 * hpPct), cs * 0.12, cs * 0.05]} /><meshBasicMaterial color="#ff4d4d" /></mesh>
          </group>
        );
      })}
      <Text position={[0, cs * 2.7, 0]} fontSize={size * 0.3} color="#ff9a9a" anchorX="center" anchorY="middle" outlineWidth={size * 0.02} outlineColor="#000">Lv {camp.level}  ⚔️{camp.dmgPerCreep}</Text>
    </group>
  );
}

/**
 * Per-faction enemy palette — the SAME lore colours the hero avatar uses (see
 * FACTION_DEFAULTS inside SoloMissionMap3D). Enemies are always rival factions, so
 * they never clash with the player's own colours. Feeds the chibi IsometricCharacter.
 */
const ENEMY_FACTION_COLORS: Record<FactionEnemy['faction'], AvatarColors> = {
  PAA: { primary: '#00A37A', secondary: '#D4AF37', skin: '#8B5A2B' }, // Afrofuture green + gold
  ASF: { primary: '#C75B1E', secondary: '#4A4A5A', skin: '#5C3317' }, // Military amber + dark
  WC:  { primary: '#1E40AF', secondary: '#9CA3AF', skin: '#D4A87A' }, // Corporate blue + light
};

// Deterministic 0/1 from an enemy id → stable gender pick (so a unit doesn't flip
// gender across renders, but the roster still has a mix of male/female chibis).
function enemyHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return h;
}

/**
 * EnemyUnitMesh — a single mobile faction enemy. Owns its world position and smoothly
 * lerps toward the target tile each frame so the discrete AI steps read as walking.
 *
 * The body is the shared chibi IsometricCharacter (same style as the hero), tinted +
 * kitted per faction so ASF raiders / PAA peacekeepers / WC scavengers read as actual
 * characters rather than faceless mechs. The enemy-only overlays — boss crown, HP bar,
 * name label, and a ground threat aura (red while hunting) — live on top.
 */
function EnemyUnitMesh({ enemy, size, target }: { enemy: FactionEnemy; size: number; target: [number, number, number] }) {
  const ref = React.useRef<THREE.Group>(null);
  const snapped = React.useRef(false);
  useFrame(() => {
    const g = ref.current; if (!g) return;
    if (!snapped.current) { g.position.set(target[0], target[1], target[2]); snapped.current = true; return; }
    g.position.x += (target[0] - g.position.x) * 0.2;
    g.position.y += (target[1] - g.position.y) * 0.2;
    g.position.z += (target[2] - g.position.z) * 0.2;
    // Face the direction of travel (the whole unit — character + overlays — rotates).
    const dx = target[0] - g.position.x, dz = target[2] - g.position.z;
    if (dx * dx + dz * dz > 1e-4) g.rotation.y = Math.atan2(dx, dz);
  });
  const doc = DOCTRINE[enemy.faction];
  const boss = enemy.role === 'boss';
  const hpPct = Math.max(0, enemy.hp / enemy.maxHp);
  const hunting = enemy.state === 'pursue' || enemy.state === 'attack';
  const moving = enemy.state === 'pursue' || enemy.state === 'patrol' || enemy.state === 'retreat';

  // Chibi body sizing. IsometricCharacter's native top-of-head ≈ hexSize × 1.6 (feet at
  // y=0); scale the wrapper so a grunt lands a touch under the hero and a boss towers.
  const CHAR_NATIVE_TOP = 1.6;
  const targetH = size * (boss ? 1.3 : 0.85);
  const charScale = targetH / (size * CHAR_NATIVE_TOP);
  const topY = targetH; // world height of the head after scaling

  const gender = enemyHash(enemy.id) % 2 === 0 ? 'MALE' : 'FEMALE';
  const auraColor = hunting ? '#ff3b3b' : doc.color;

  return (
    <group ref={ref} frustumCulled={false}>
      {/* Chibi character body (same rig/style as the hero), faction-tinted + kitted.
          facingAngle is left undefined so it inherits this group's travel rotation. */}
      <group scale={charScale} frustumCulled={false}>
        <IsometricCharacter
          gender={gender}
          colors={ENEMY_FACTION_COLORS[enemy.faction]}
          hexSize={size}
          faction={enemy.faction}
          isMoving={moving}
        />
      </group>

      {/* Ground threat aura — doctrine-coloured, flares red while actively hunting. */}
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false}>
        <ringGeometry args={[targetH * 0.34, targetH * 0.46, 20]} />
        <meshBasicMaterial color={auraColor} transparent opacity={hunting ? 0.55 : 0.25} side={THREE.DoubleSide} />
      </mesh>

      {/* Boss crown — marks the faction champion ("the faction player"). */}
      {boss && (
        <mesh position={[0, topY + size * 0.12, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[size * 0.17, size * 0.2, 5]} />
          <meshStandardMaterial color="#ffd24a" emissive="#8a6a10" emissiveIntensity={0.5} roughness={0.4} metalness={0.6} flatShading />
        </mesh>
      )}

      {/* HP bar */}
      <mesh position={[0, topY + size * 0.3, 0]}><boxGeometry args={[size * 0.66, size * 0.08, size * 0.025]} /><meshBasicMaterial color="#300000" /></mesh>
      <mesh position={[-(size * 0.66) * (1 - hpPct) / 2, topY + size * 0.3, size * 0.02]}><boxGeometry args={[Math.max(0.001, size * 0.66 * hpPct), size * 0.06, size * 0.025]} /><meshBasicMaterial color={hunting ? '#ff4d4d' : '#ffa24d'} /></mesh>

      <Text position={[0, topY + size * 0.5, 0]} fontSize={size * (boss ? 0.32 : 0.26)} color={boss ? '#ffd24a' : doc.color} anchorX="center" anchorY="middle" outlineWidth={size * 0.02} outlineColor="#000">
        {boss ? `👑 ${enemy.faction} Commander Lv${enemy.level}` : `${hunting ? '⚔️ ' : ''}${enemy.faction} ${doc.label} Lv${enemy.level}`}
      </Text>
    </group>
  );
}

/** Floating combat number that rises and is removed after ~1s (damage counter). */
function FloatingCombatText({ text, color, onDone }: { text: string; color: string; onDone: () => void }) {
  const ref = React.useRef<THREE.Group>(null);
  const t0 = React.useRef(performance.now());
  useFrame(() => {
    const g = ref.current; if (!g) return;
    const dt = (performance.now() - t0.current) / 1000;
    g.position.y = 3 + dt * 2.4;
    const s = 1 + Math.min(0.4, dt * 0.6);
    g.scale.setScalar(s);
    if (dt > 1.0) onDone();
  });
  return (
    <group ref={ref} position={[0, 3, 0]}>
      <Text fontSize={1.5} color={color} anchorX="center" anchorY="middle" outlineWidth={0.08} outlineColor="#000">{text}</Text>
    </group>
  );
}

/** Player base / command center — the hub the pet fetches from and terraforming ties to. */
function CommandCenter({ size, color = '#3aa37a' }: { size: number; color?: string }) {
  const glowRef = React.useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (glowRef.current) glowRef.current.rotation.y = clock.getElapsedTime() * 0.5; });
  const S = size;
  return (
    <group>
      <mesh position={[0, S * 0.15, 0]} rotation={[0, Math.PI / 6, 0]} castShadow receiveShadow><cylinderGeometry args={[S * 0.9, S * 1.05, S * 0.3, 6]} /><meshStandardMaterial color="#2a3038" roughness={0.85} flatShading /></mesh>
      <mesh position={[0, S * 0.7, 0]} castShadow><cylinderGeometry args={[S * 0.45, S * 0.62, S * 0.8, 6]} /><meshStandardMaterial color="#454e57" roughness={0.6} metalness={0.2} flatShading /></mesh>
      <mesh position={[0, S * 1.2, 0]} castShadow><coneGeometry args={[S * 0.52, S * 0.5, 6]} /><meshStandardMaterial color={color} roughness={0.5} metalness={0.3} flatShading /></mesh>
      <mesh ref={glowRef} position={[0, S * 0.72, 0]}><icosahedronGeometry args={[S * 0.24, 0]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} flatShading /></mesh>
      <mesh position={[0, S * 1.72, 0]}><cylinderGeometry args={[S * 0.03, S * 0.03, S * 0.5, 4]} /><meshStandardMaterial color="#888" metalness={0.5} /></mesh>
      <mesh position={[0, S * 1.98, 0]}><sphereGeometry args={[S * 0.08, 6, 6]} /><meshBasicMaterial color="#ff5555" /></mesh>
      <Text position={[0, S * 2.35, 0]} fontSize={S * 0.42} color="#cfe8ff" anchorX="center" anchorY="middle" outlineWidth={S * 0.03} outlineColor="#000">BASE</Text>
    </group>
  );
}

/** Terraforming device — a progress ring that fills as you invest gathered resources. */
function Terraformer({ size, progress, done }: { size: number; progress: number; done: boolean }) {
  const ringRef = React.useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (ringRef.current) ringRef.current.rotation.z = clock.getElapsedTime() * 0.6; });
  const S = size;
  const col = done ? '#4caf50' : '#c99a4a';
  return (
    <group>
      <mesh position={[0, S * 0.4, 0]} castShadow><cylinderGeometry args={[S * 0.2, S * 0.32, S * 0.8, 6]} /><meshStandardMaterial color="#4a4e57" roughness={0.6} metalness={0.3} flatShading /></mesh>
      <mesh position={[0, S * 0.95, 0]}><icosahedronGeometry args={[S * 0.28, 0]} /><meshStandardMaterial color={col} emissive={col} emissiveIntensity={done ? 1.4 : 0.7} flatShading /></mesh>
      <mesh ref={ringRef} position={[0, S * 0.95, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[S * 0.42, S * 0.52, 40, 1, 0, Math.PI * 2 * Math.max(0.02, progress / 100)]} /><meshBasicMaterial color={done ? '#4caf50' : '#8fd66b'} side={THREE.DoubleSide} /></mesh>
      <Text position={[0, S * 1.6, 0]} fontSize={S * 0.34} color={done ? '#8fe38f' : '#e6c98a'} anchorX="center" anchorY="middle" outlineWidth={S * 0.03} outlineColor="#000">{done ? 'Terraformed ✓' : `Terraform ${Math.round(progress)}%`}</Text>
    </group>
  );
}

/** Capturable outpost flag — grey when neutral, faction-colored when owned. */
function OutpostMarker({ size, owned, color }: { size: number; owned: boolean; color: string }) {
  const flagRef = React.useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (flagRef.current) flagRef.current.rotation.z = Math.sin(clock.getElapsedTime() * 2) * 0.08; });
  const S = size;
  const banner = owned ? color : '#8a8f96';
  return (
    <group>
      <mesh position={[0, S * 0.08, 0]} rotation={[0, Math.PI / 6, 0]}><cylinderGeometry args={[S * 0.55, S * 0.62, S * 0.16, 6]} /><meshStandardMaterial color="#33383f" roughness={0.85} flatShading /></mesh>
      <mesh position={[0, S * 0.9, 0]} castShadow><cylinderGeometry args={[S * 0.04, S * 0.05, S * 1.6, 6]} /><meshStandardMaterial color="#555" metalness={0.4} /></mesh>
      <mesh ref={flagRef} position={[S * 0.26, S * 1.45, 0]}><boxGeometry args={[S * 0.5, S * 0.34, S * 0.02]} /><meshStandardMaterial color={banner} emissive={owned ? color : '#000'} emissiveIntensity={owned ? 0.4 : 0} roughness={0.6} side={THREE.DoubleSide} /></mesh>
      <Text position={[0, S * 1.9, 0]} fontSize={S * 0.3} color={owned ? '#bfead0' : '#cfd4da'} anchorX="center" anchorY="middle" outlineWidth={S * 0.03} outlineColor="#000">{owned ? 'Outpost ✓' : 'Outpost'}</Text>
    </group>
  );
}

// Refugee camp — a friendly settlement (tents + campfire) that offers a
// faction-specific side mission. Amber banner when the mission is open, green ✓ once
// its aid mission is complete.
function RefugeeCampMarker({ size, done, label, icon, mode, subtitle }: { size: number; done: boolean; label: string; icon: string; mode: 'aid' | 'loot'; subtitle?: string }) {
  const fireRef = React.useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (fireRef.current) { const s = 1 + Math.sin(clock.getElapsedTime() * 6) * 0.15; fireRef.current.scale.set(s, s, s); } });
  const S = size;
  const loot = mode === 'loot';
  // Rival camps read hostile (dark/red tents); friendly camps read warm (tan tents).
  const tents = loot ? ['#7a4a3a', '#8a4030', '#6a3a2a'] : ['#b8895a', '#a8734a', '#c79968'];
  const flame = done ? '#7fd66b' : loot ? '#ff5a3c' : '#ff9a3c';
  const titleCol = done ? '#a7e8b6' : loot ? '#ffb59a' : '#ffdca3';
  const poleCol = loot ? '#2a1c16' : '#5a4636';
  // Tent: conical canopy + ridge pole + dark entrance flap + peg ring.
  const tent = (x: number, z: number, rot: number, col: string) => (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, S * 0.36, 0]} castShadow><coneGeometry args={[S * 0.44, S * 0.72, 7]} /><meshStandardMaterial color={col} roughness={0.9} flatShading /></mesh>
      {/* entrance flap */}
      <mesh position={[0, S * 0.2, S * 0.4]} rotation={[0.2, 0, 0]}><coneGeometry args={[S * 0.14, S * 0.42, 3]} /><meshStandardMaterial color="#1a120c" roughness={1} flatShading /></mesh>
      {/* ridge pole tip */}
      <mesh position={[0, S * 0.74, 0]}><cylinderGeometry args={[S * 0.02, S * 0.02, S * 0.16, 4]} /><meshStandardMaterial color={poleCol} roughness={0.8} /></mesh>
      {/* peg base */}
      <mesh position={[0, S * 0.02, 0]}><cylinderGeometry args={[S * 0.46, S * 0.48, S * 0.04, 7]} /><meshStandardMaterial color="#2a2118" roughness={1} flatShading /></mesh>
    </group>
  );
  // Stacked supply crate.
  const crate = (x: number, z: number, col = '#8a6a3a') => (
    <group position={[x, 0, z]}>
      <mesh position={[0, S * 0.11, 0]} castShadow><boxGeometry args={[S * 0.24, S * 0.22, S * 0.24]} /><meshStandardMaterial color={col} roughness={0.85} flatShading /></mesh>
      <mesh position={[0, S * 0.3, 0]} rotation={[0, 0.4, 0]} castShadow><boxGeometry args={[S * 0.18, S * 0.16, S * 0.18]} /><meshStandardMaterial color={col} roughness={0.85} flatShading /></mesh>
    </group>
  );
  // Fuel/water barrel.
  const barrel = (x: number, z: number, col: string) => (
    <mesh position={[x, S * 0.16, z]} castShadow><cylinderGeometry args={[S * 0.12, S * 0.12, S * 0.32, 8]} /><meshStandardMaterial color={col} metalness={0.3} roughness={0.6} flatShading /></mesh>
  );
  return (
    <group>
      {tent(-S * 0.5, 0, Math.PI / 4, tents[0])}
      {tent(S * 0.55, S * 0.2, -Math.PI / 5, tents[1])}
      {tent(0, -S * 0.6, Math.PI / 3, tents[2])}
      {/* supplies scattered around the settlement */}
      {crate(S * 0.7, -S * 0.55, loot ? '#6a4030' : '#8a6a3a')}
      {barrel(-S * 0.72, -S * 0.4, loot ? '#5a2a22' : '#3a6a5a')}
      {barrel(-S * 0.5, -S * 0.62, loot ? '#4a2018' : '#2f5a4a')}
      {/* Aid camps fly a med cross; rival camps show a scavenged loot pile + spikes */}
      {loot ? (
        <>
          <mesh position={[S * 0.4, S * 0.14, S * 0.5]} rotation={[0, 0.5, 0]} castShadow><dodecahedronGeometry args={[S * 0.2, 0]} /><meshStandardMaterial color="#5a4a2a" roughness={0.9} flatShading /></mesh>
          <mesh position={[-S * 0.85, S * 0.3, S * 0.3]} rotation={[0, 0, 0.2]}><coneGeometry args={[S * 0.05, S * 0.6, 4]} /><meshStandardMaterial color="#2a1a16" roughness={0.9} flatShading /></mesh>
        </>
      ) : (
        <group position={[S * 0.75, S * 0.55, S * 0.35]}>
          <mesh><boxGeometry args={[S * 0.34, S * 0.12, S * 0.06]} /><meshStandardMaterial color="#e8f4f0" emissive="#4fd6a0" emissiveIntensity={0.5} flatShading /></mesh>
          <mesh><boxGeometry args={[S * 0.12, S * 0.34, S * 0.06]} /><meshStandardMaterial color="#e8f4f0" emissive="#4fd6a0" emissiveIntensity={0.5} flatShading /></mesh>
        </group>
      )}
      {/* campfire */}
      <mesh position={[0, S * 0.06, S * 0.35]}><cylinderGeometry args={[S * 0.18, S * 0.22, S * 0.08, 8]} /><meshStandardMaterial color="#3a2a1e" roughness={1} flatShading /></mesh>
      {/* stones ring */}
      {[0, 1, 2, 3, 4].map(i => { const a = (i / 5) * Math.PI * 2; return (
        <mesh key={i} position={[Math.cos(a) * S * 0.2, S * 0.05, S * 0.35 + Math.sin(a) * S * 0.2]}><dodecahedronGeometry args={[S * 0.05, 0]} /><meshStandardMaterial color="#555049" roughness={1} flatShading /></mesh>
      ); })}
      {/* logs */}
      <mesh position={[0, S * 0.05, S * 0.35]} rotation={[Math.PI / 2, 0, 0.4]}><cylinderGeometry args={[S * 0.03, S * 0.03, S * 0.34, 5]} /><meshStandardMaterial color="#2a1c12" roughness={1} flatShading /></mesh>
      <mesh ref={fireRef} position={[0, S * 0.22, S * 0.35]}><coneGeometry args={[S * 0.1, S * 0.28, 6]} /><meshBasicMaterial color={flame} /></mesh>
      <Text position={[0, S * 1.8, 0]} fontSize={S * 0.3} color={titleCol} anchorX="center" anchorY="middle" outlineWidth={S * 0.03} outlineColor="#000">
        {done ? 'Camp Cleared ✓' : `${icon} ${label}`}
      </Text>
      {!done && subtitle && (
        <Text position={[0, S * 1.45, 0]} fontSize={S * 0.22} color="#e8e0d0" anchorX="center" anchorY="middle" outlineWidth={S * 0.02} outlineColor="#000">{subtitle}</Text>
      )}
    </group>
  );
}

const TERRAIN_ICON: Record<string, string> = {
  water: '🌊', desert: '🏜️', plains: '🌾', forest: '🌲', jungle: '🌴', hills: '⛰️', mountain: '🏔️',
};

// ── Mobile touch controls ─────────────────────────────────────────────────────
// Dispatches synthetic keyboard events so the existing WASD/action key handlers work
// unchanged on touch devices.
function dispatchGameKey(key: string, type: 'keydown' | 'keyup') {
  window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
}

function TouchButton({ kbdKey, label, hold, size = 'h-12 w-12 text-lg' }: { kbdKey: string; label: React.ReactNode; hold?: boolean; size?: string }) {
  const timer = React.useRef<number | null>(null);
  const fire = () => { dispatchGameKey(kbdKey, 'keydown'); window.setTimeout(() => dispatchGameKey(kbdKey, 'keyup'), 50); };
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    fire();
    if (hold) timer.current = window.setInterval(fire, 200);
  };
  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  return (
    <button className={`touch-btn pointer-events-auto ${size}`} onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}>{label}</button>
  );
}

/** On-screen d-pad + action buttons, floated just above the HUD bar. */
function TouchControls() {
  return (
    <div
      className="fixed inset-x-0 z-30 px-3 flex items-end justify-between pointer-events-none"
      style={{ bottom: 'calc(clamp(5.5rem, 30vw, 15.5rem) + 0.5rem)' }}
    >
      {/* Movement d-pad */}
      <div className="grid grid-cols-3 grid-rows-3 gap-1">
        <span /><TouchButton kbdKey="w" label="▲" hold size="h-11 w-11 text-base" /><span />
        <TouchButton kbdKey="a" label="◀" hold size="h-11 w-11 text-base" />
        <span className="rounded-lg bg-white/5" />
        <TouchButton kbdKey="d" label="▶" hold size="h-11 w-11 text-base" />
        <span /><TouchButton kbdKey="s" label="▼" hold size="h-11 w-11 text-base" /><span />
      </div>
      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2">
        <TouchButton kbdKey="f" label="⚔️" size="h-12 w-12 text-xl" />
        <TouchButton kbdKey="c" label="✋" size="h-12 w-12 text-xl" />
        <TouchButton kbdKey="h" label="🤝" size="h-12 w-12 text-xl" />
        <TouchButton kbdKey="g" label="🚩" size="h-12 w-12 text-xl" />
      </div>
    </div>
  );
}

function tileColor(t: Tile) {
  if (t.type === 'water') return '#87d5ff';
  if (t.type === 'desert') return '#f7d08a';
  if (t.type === 'plains') return '#a7e39b';
  if (t.type === 'forest') return '#59b96b';
  if (t.type === 'jungle') return '#2a7f49';
  if (t.type === 'hills') return '#a2b86a';
  if (t.type === 'mountain') return '#9aa3a7';
  return '#c9c6c0';
}

// All tiles same low height for flat prototype
function heightFor(_t: Tile) { return 0.4; }

/**
 * Remote duelist — renders the opponent's hero + pet, INTERPOLATING position/facing from
 * the duel snapshot buffer each frame (exponential smoothing) so movement is smooth
 * instead of snapping between 15 Hz network updates. HP/name come from React state.
 */
function RemoteDuelist({ bufRef, remote, hexSize, colors }: {
  bufRef: React.MutableRefObject<RemoteHero | null>;
  remote: RemoteHero | null;
  hexSize: number;
  colors: any;
}) {
  const groupRef = React.useRef<THREE.Group>(null);
  const petRef = React.useRef<THREE.Group>(null);
  const curPos = React.useRef(new THREE.Vector3());
  const inited = React.useRef(false);
  const rivalColors = React.useMemo(() => ({ ...colors, primary: '#d0453f', secondary: '#7a1f1b' }), [colors]);
  useFrame((_, delta) => {
    const buf = bufRef.current;
    if (!buf || !groupRef.current) return;
    const k = 1 - Math.pow(0.0025, Math.min(0.05, delta)); // smoothing factor
    const w = axialToWorld(buf.pos, hexSize);
    const target = new THREE.Vector3(w.x, 0.48, w.z);
    if (!inited.current) { curPos.current.copy(target); inited.current = true; }
    curPos.current.lerp(target, k);
    groupRef.current.position.copy(curPos.current);
    // Smoothly rotate toward the target facing (shortest angular path).
    const tRot = buf.facing ?? 0;
    let d = ((tRot - groupRef.current.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    groupRef.current.rotation.y += d * k;
    // Pet
    if (petRef.current) {
      if (buf.pet) {
        const pw = axialToWorld(buf.pet, hexSize);
        petRef.current.position.x += (pw.x - petRef.current.position.x) * k;
        petRef.current.position.z += (pw.z - petRef.current.position.z) * k;
        petRef.current.position.y = 0.48;
        petRef.current.visible = true;
      } else {
        petRef.current.visible = false;
      }
    }
  });
  const hpPct = remote ? Math.max(0, Math.min(1, remote.hp / Math.max(1, remote.maxHp))) : 1;
  const isDogPet = (remote?.pet?.type ?? bufRef.current?.pet?.type) === 'CYBER_DOG';
  return (
    <>
      <group ref={groupRef} frustumCulled={false}>
        <IsometricCharacter gender={(remote?.gender as any) ?? 'MALE'} colors={rivalColors} hexSize={hexSize} faction={remote?.faction as any} isMoving={!!remote?.moving} facingAngle={0} />
        <Text position={[0, hexSize * 2.4, 0]} fontSize={hexSize * 0.42} color="#ff9a9a" anchorX="center" anchorY="middle" outlineWidth={hexSize * 0.03} outlineColor="#000">{`⚔️ ${remote?.name ?? 'Rival'}`}</Text>
        <group position={[0, hexSize * 2.0, 0]}>
          <mesh><planeGeometry args={[hexSize * 1.4, hexSize * 0.16]} /><meshBasicMaterial color="#2a0a0a" /></mesh>
          <mesh position={[-(hexSize * 1.4 * (1 - hpPct)) / 2, 0, 0.01]}><planeGeometry args={[hexSize * 1.4 * hpPct, hexSize * 0.16]} /><meshBasicMaterial color="#e0453f" /></mesh>
        </group>
      </group>
      <group ref={petRef} frustumCulled={false}>
        {isDogPet ? <IsometricDog ps={hexSize * 0.32} isMoving /> : <IsometricPet ps={hexSize * 0.32} isMoving />}
      </group>
    </>
  );
}

// Per-faction colours for MOBA heroes, outpost banners, and the scoreboard.
const FACTION_COLORS: Record<string, { primary: string; secondary: string; label: string }> = {
  PAA: { primary: '#34d399', secondary: '#065f46', label: '#6ee7b7' },
  ASF: { primary: '#fb7185', secondary: '#7f1d1d', label: '#fda4af' },
  WC:  { primary: '#38bdf8', secondary: '#075985', label: '#7dd3fc' },
};
const FACTION_LABEL: Record<string, string> = { PAA: 'Pan-African Alliance', ASF: 'African Sovereignty Front', WC: 'World Coalition' };

/** A remote MOBA hero (another player OR an AI faction). Interpolated between the host's
 *  15 Hz world snapshots; faction-coloured. Reads its live position from the shared
 *  interpolation buffer each frame (keyed by uid) so movement stays smooth. */
function RemoteMobaHero({ uid, bufRef, hero, hexSize }: {
  uid: string;
  bufRef: React.MutableRefObject<Map<string, MobaHero>>;
  hero: MobaHero;
  hexSize: number;
}) {
  const groupRef = React.useRef<THREE.Group>(null);
  const petRef = React.useRef<THREE.Group>(null);
  const curPos = React.useRef(new THREE.Vector3());
  const inited = React.useRef(false);
  const derivedFacing = React.useRef(0); // fallback facing for heroes that don't transmit one (AI)
  const fc = FACTION_COLORS[hero.faction] ?? FACTION_COLORS.PAA;
  const colors = React.useMemo(() => ({ primary: fc.primary, secondary: fc.secondary, skin: '#8d5524' }), [fc.primary, fc.secondary]);
  useFrame((_, delta) => {
    const buf = bufRef.current.get(uid);
    if (!buf || !groupRef.current) return;
    const k = 1 - Math.pow(0.0025, Math.min(0.05, delta));
    const w = axialToWorld(buf.pos, hexSize);
    const target = new THREE.Vector3(w.x, 0.48, w.z);
    if (!inited.current) { curPos.current.copy(target); inited.current = true; }
    // Derive a facing from actual movement (matches the local hero's atan2(dx,dz) convention)
    // so AI heroes — which don't send a facing — still turn to face where they walk.
    const dx = target.x - curPos.current.x, dz = target.z - curPos.current.z;
    if (Math.abs(dx) > 0.002 || Math.abs(dz) > 0.002) derivedFacing.current = Math.atan2(dx, dz);
    curPos.current.lerp(target, k);
    groupRef.current.position.copy(curPos.current);
    const tRot = buf.facing ?? derivedFacing.current;
    let d = ((tRot - groupRef.current.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    groupRef.current.rotation.y += d * k;
    if (petRef.current) {
      if (buf.pet) {
        const pw = axialToWorld(buf.pet, hexSize);
        petRef.current.position.x += (pw.x - petRef.current.position.x) * k;
        petRef.current.position.z += (pw.z - petRef.current.position.z) * k;
        petRef.current.position.y = 0.48;
        petRef.current.visible = true;
      } else petRef.current.visible = false;
    }
  });
  const hpPct = Math.max(0, Math.min(1, hero.hp / Math.max(1, hero.maxHp)));
  const isDogPet = hero.pet?.type === 'CYBER_DOG';
  const tag = hero.isAI ? `🤖 ${hero.faction} Bot` : `${hero.faction} · ${hero.name ?? 'Rival'}`;
  return (
    <>
      <group ref={groupRef} frustumCulled={false}>
        <IsometricCharacter gender={(hero.gender as any) ?? 'MALE'} colors={colors} hexSize={hexSize} faction={hero.faction as any} isMoving={!!hero.moving} facingAngle={0} />
        <Text position={[0, hexSize * 2.4, 0]} fontSize={hexSize * 0.4} color={fc.label} anchorX="center" anchorY="middle" outlineWidth={hexSize * 0.03} outlineColor="#000">{tag}</Text>
        <group position={[0, hexSize * 2.0, 0]}>
          <mesh><planeGeometry args={[hexSize * 1.4, hexSize * 0.16]} /><meshBasicMaterial color="#20242c" /></mesh>
          <mesh position={[-(hexSize * 1.4 * (1 - hpPct)) / 2, 0, 0.01]}><planeGeometry args={[hexSize * 1.4 * hpPct, hexSize * 0.16]} /><meshBasicMaterial color={fc.primary} /></mesh>
        </group>
      </group>
      <group ref={petRef} frustumCulled={false}>
        {isDogPet ? <IsometricDog ps={hexSize * 0.32} isMoving /> : <IsometricPet ps={hexSize * 0.32} isMoving />}
      </group>
    </>
  );
}

function ResourceIcon({ t, size }: { t: Tile; size: number }) {
  const label = t.resource ? (RESOURCE_DEFS[t.resource]?.icon ?? '') : '';
  if (!label) return null;
  // Local positioning: parent tile group already placed in world space
  return (
    <Text position={[0, heightFor(t) + 2.2, 0]} fontSize={1.2} color="#374151" anchorX="center" anchorY="middle">{label}</Text>
  );
}

/** Low-poly 3D resource node placed on a tile (ore/energy/bio). Isometric, faceted,
 *  with a soft glow for energy/bio so gatherables read at a glance. */
function ResourceProp({ type, size, seed = 1 }: { type: ResourceType; size: number; seed?: number }) {
  const glowRef = React.useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!glowRef.current) return;
    const s = 0.85 + 0.15 * Math.sin(clock.getElapsedTime() * 2 + seed);
    glowRef.current.scale.setScalar(s);
  });
  if (!type) return null;
  const S = size * 0.42;
  // Offset toward a tile corner so the node doesn't fully overlap terrain decor.
  const ox = Math.cos(seed) * size * 0.28;
  const oz = Math.sin(seed) * size * 0.28;

  if (type === 'ore') {
    return (
      <group position={[ox, 0, oz]} rotation={[0, seed, 0]}>
        {/* Rocky base cluster with embedded metallic crystals */}
        <mesh castShadow position={[0, S * 0.4, 0]}>
          <dodecahedronGeometry args={[S * 0.7, 0]} />
          <meshStandardMaterial color="#5b5f6b" roughness={0.9} metalness={0.15} flatShading />
        </mesh>
        <mesh castShadow position={[S * 0.34, S * 0.7, -S * 0.1]} rotation={[0.3, 0.6, 0.2]}>
          <octahedronGeometry args={[S * 0.34, 0]} />
          <meshStandardMaterial color="#8aa0b8" roughness={0.35} metalness={0.75} flatShading />
        </mesh>
        <mesh castShadow position={[-S * 0.3, S * 0.62, S * 0.16]} rotation={[0.5, -0.4, 0]}>
          <octahedronGeometry args={[S * 0.26, 0]} />
          <meshStandardMaterial color="#b7c4d4" roughness={0.3} metalness={0.8} flatShading />
        </mesh>
      </group>
    );
  }
  if (type === 'energy') {
    return (
      <group position={[ox, 0, oz]} rotation={[0, seed, 0]}>
        <mesh ref={glowRef} position={[0, S * 0.9, 0]}>
          <sphereGeometry args={[S * 0.7, 10, 10]} />
          <meshBasicMaterial color="#38e1ff" transparent opacity={0.16} depthWrite={false} />
        </mesh>
        <mesh castShadow position={[0, S * 0.95, 0]} rotation={[0, 0, 0.05]}>
          <coneGeometry args={[S * 0.34, S * 1.5, 6]} />
          <meshStandardMaterial color="#22c3e6" emissive="#0ea5c4" emissiveIntensity={0.9} roughness={0.25} metalness={0.4} flatShading />
        </mesh>
        <mesh castShadow position={[S * 0.32, S * 0.55, 0]} rotation={[0, 0, -0.5]}>
          <coneGeometry args={[S * 0.18, S * 0.85, 6]} />
          <meshStandardMaterial color="#5fe6ff" emissive="#22c3e6" emissiveIntensity={0.8} roughness={0.25} metalness={0.4} flatShading />
        </mesh>
      </group>
    );
  }
  // bio
  return (
    <group position={[ox, 0, oz]} rotation={[0, seed, 0]}>
      <mesh ref={glowRef} position={[0, S * 0.7, 0]}>
        <sphereGeometry args={[S * 0.6, 10, 10]} />
        <meshBasicMaterial color="#7CFF6B" transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <mesh castShadow position={[0, S * 0.55, 0]}>
        <icosahedronGeometry args={[S * 0.5, 0]} />
        <meshStandardMaterial color="#3fa14a" emissive="#2e8b3a" emissiveIntensity={0.5} roughness={0.6} flatShading />
      </mesh>
      <mesh position={[0, S * 0.95, 0]}>
        <icosahedronGeometry args={[S * 0.24, 0]} />
        <meshStandardMaterial color="#8fe36b" emissive="#5fd44a" emissiveIntensity={0.7} roughness={0.5} flatShading />
      </mesh>
    </group>
  );
}

// Extracted so each canopy has a stable useRef + useFrame — avoids the inline-arrow-ref
// null-flush problem that occurs when the parent re-renders (new arrow = React clears old ref).
// Sways an entire canopy group (not just one cone) so detailed multi-mesh trees move.
function SwayingCanopy({ phase, children }: { phase: number; children: React.ReactNode }) {
  const ref = React.useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.rotation.z = Math.sin(t * 0.75 + phase) * 0.06;
    ref.current.rotation.x = Math.cos(t * 0.55 + phase) * 0.04;
  });
  return <group ref={ref}>{children}</group>;
}

const TREE_GREENS = ['#3f8f4e', '#4aa05c', '#5bb56a', '#357f45'];

function TreeCluster({ size, seed = 1 }: { size: number; seed?: number }) {
  const rng = useMemo(() => seededRand(seed), [seed]);
  const trees = useMemo(() => {
    const count = 3 + Math.floor(rng() * 4); // 3–6 trees
    return Array.from({ length: count }, () => {
      const ang = rng() * Math.PI * 2;
      const rad = (0.15 + rng() * 0.6) * size * 0.9;
      return {
        x: Math.cos(ang) * rad, z: Math.sin(ang) * rad,
        s: 0.7 + rng() * 0.6, h: 1.2 + rng() * 0.7,
        pine: rng() > 0.42,                       // conifer vs broadleaf
        c1: TREE_GREENS[Math.floor(rng() * TREE_GREENS.length)],
        c2: TREE_GREENS[Math.floor(rng() * TREE_GREENS.length)],
        snow: rng() > 0.72,
      };
    });
  }, [rng, size]);
  const phaseOffsets = useMemo(() => trees.map((_, i) => i * 1.37 + seed * 0.01), [trees, seed]);
  return (
    <group>
      {trees.map((t, i) => {
        const trunkH = 1.0 * t.s;
        const S = size * t.s;
        return (
          <group key={i} position={[t.x, 0, t.z]}>
            {/* Trunk (tapered, faceted) */}
            <mesh position={[0, trunkH * 0.5, 0]} castShadow>
              <cylinderGeometry args={[size * 0.06 * t.s, size * 0.1 * t.s, trunkH, 6]} />
              <meshStandardMaterial color="#7a5236" roughness={0.92} flatShading />
            </mesh>
            <group position={[0, trunkH, 0]}>
              <SwayingCanopy phase={phaseOffsets[i]}>
                {t.pine ? (
                  <>
                    {/* Layered conifer tiers */}
                    <mesh position={[0, t.h * 0.35, 0]} castShadow><coneGeometry args={[S * 0.42, t.h * 0.85, 7]} /><meshStandardMaterial color={t.c1} roughness={0.72} flatShading /></mesh>
                    <mesh position={[0, t.h * 0.78, 0]} castShadow><coneGeometry args={[S * 0.32, t.h * 0.75, 7]} /><meshStandardMaterial color={t.c2} roughness={0.72} flatShading /></mesh>
                    <mesh position={[0, t.h * 1.15, 0]} castShadow><coneGeometry args={[S * 0.22, t.h * 0.62, 7]} /><meshStandardMaterial color={t.c1} roughness={0.72} flatShading /></mesh>
                    {t.snow && <mesh position={[0, t.h * 1.42, 0]}><coneGeometry args={[S * 0.12, t.h * 0.3, 7]} /><meshStandardMaterial color="#eef4f7" roughness={0.55} flatShading /></mesh>}
                  </>
                ) : (
                  <>
                    {/* Rounded broadleaf foliage clumps */}
                    <mesh position={[0, t.h * 0.55, 0]} castShadow><icosahedronGeometry args={[S * 0.44, 0]} /><meshStandardMaterial color={t.c1} roughness={0.78} flatShading /></mesh>
                    <mesh position={[S * 0.2, t.h * 0.82, S * 0.1]} castShadow><icosahedronGeometry args={[S * 0.28, 0]} /><meshStandardMaterial color={t.c2} roughness={0.78} flatShading /></mesh>
                    <mesh position={[-S * 0.18, t.h * 0.76, -S * 0.08]} castShadow><icosahedronGeometry args={[S * 0.24, 0]} /><meshStandardMaterial color={t.c1} roughness={0.78} flatShading /></mesh>
                  </>
                )}
              </SwayingCanopy>
            </group>
          </group>
        );
      })}
    </group>
  );
}

function RockScatter({ size, seed = 1, count = 3 }: { size: number; seed?: number; count?: number }) {
  const rng = useMemo(() => seededRand(seed), [seed]);
  const rocks = useMemo(() => {
    const arr: Array<{ x: number; z: number; s: number }>=[];
    for (let i=0;i<count;i++){
      const ang = rng()*Math.PI*2;
      const rad = (0.2 + rng()*0.65) * size * 0.9;
      arr.push({ x: Math.cos(ang)*rad, z: Math.sin(ang)*rad, s: 0.5 + rng()*0.8 });
    }
    return arr;
  }, [rng, count, size]);
  return (
    <group>
      {rocks.map((r, i)=> (
        <mesh key={i} position={[r.x, 0.4*r.s, r.z]} castShadow>
          <icosahedronGeometry args={[size * 0.18 * r.s, 0]} />
          <meshStandardMaterial color="#bfbcb6" roughness={0.9} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}

// Grassy hills: rounded low mounds (real elevation) topped with rocks and grass tufts,
// instead of the old flat rock scatter — reads as rolling hills in isometric view.
function HillsDeco({ size, seed = 1 }: { size: number; seed?: number }) {
  const rng = useMemo(() => seededRand(seed), [seed]);
  const ap = hexApothem(size);
  // Hills read as GRASS: taller, rounder green knolls (much taller than desert dunes),
  // topped with grass-blade tufts and grey rocks — matches the green hills tile.
  const mounds = useMemo(() => {
    const n = 2 + Math.floor(rng() * 2); // 2–3 knolls
    return Array.from({ length: n }, (_, i) => {
      const ang = rng() * Math.PI * 2;
      const rad = rng() * ap * 0.4;
      const r = ap * (0.44 + rng() * 0.28);
      return { x: Math.cos(ang) * rad, z: Math.sin(ang) * rad, r, flat: 0.5 + rng() * 0.35, rot: rng() * Math.PI, light: i % 2 === 0 };
    });
  }, [rng, ap]);
  const rocks = useMemo(() => {
    const n = 1 + Math.floor(rng() * 2);
    return Array.from({ length: n }, () => {
      const ang = rng() * Math.PI * 2;
      const rad = (0.25 + rng() * 0.55) * ap;
      return { x: Math.cos(ang) * rad, z: Math.sin(ang) * rad, s: 0.4 + rng() * 0.6, rx: rng() * 0.6, ry: rng() * Math.PI * 2, y: 0.25 + rng() * 0.35 };
    });
  }, [rng, ap]);
  // Grass-blade tufts scattered over the tile so hills read as grassy, not sandy.
  const tufts = useMemo(() => Array.from({ length: 5 + Math.floor(rng() * 4) }, () => ({
    x: (rng() - 0.5) * ap * 1.2, z: (rng() - 0.5) * ap * 1.2, h: size * (0.16 + rng() * 0.16), tilt: (rng() - 0.5) * 0.4, light: rng() > 0.5,
  })), [rng, ap, size]);
  return (
    <group>
      {mounds.map((m, i) => (
        <mesh key={`m${i}`} position={[m.x, 0, m.z]} rotation={[0, m.rot, 0]} scale={[1, m.flat, 1]} castShadow receiveShadow>
          <sphereGeometry args={[m.r, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={m.light ? '#9cc255' : '#84ac4a'} roughness={0.9} metalness={0} flatShading />
        </mesh>
      ))}
      {tufts.map((g, i) => (
        <mesh key={`g${i}`} position={[g.x, g.h * 0.5, g.z]} rotation={[g.tilt, 0, g.tilt]}>
          <coneGeometry args={[size * 0.05, g.h, 4]} />
          <meshStandardMaterial color={g.light ? '#a9d65f' : '#8bbf4a'} roughness={0.85} flatShading />
        </mesh>
      ))}
      {rocks.map((r, i) => (
        <mesh key={`r${i}`} position={[r.x, r.y * r.s, r.z]} rotation={[r.rx, r.ry, 0]} castShadow>
          <dodecahedronGeometry args={[size * 0.15 * r.s, 0]} />
          <meshStandardMaterial color="#a8a49c" roughness={0.9} metalness={0.04} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function MountainDeco({ size, seed=1 }: { size: number; seed?: number }) {
  const rng = useMemo(()=>seededRand(seed),[seed]);
  // A main peak + two shoulders, each with a darker strata band and a snow cap.
  const peaks = useMemo(() => [
    { x: 0,           z: 0,          r: size * 1.05, h: size * 1.55 * (0.9 + rng() * 0.5), main: true },
    { x: -size * 0.7, z: size * 0.42, r: size * 0.62, h: size * 0.9 * (0.8 + rng() * 0.4), main: false },
    { x: size * 0.78, z: -size * 0.5, r: size * 0.56, h: size * 0.78 * (0.8 + rng() * 0.4), main: false },
  ], [rng, size]);
  const rocks = useMemo(() => Array.from({ length: 3 }, () => ({
    x: (rng() - 0.5) * size * 1.5, z: (rng() - 0.5) * size * 1.5, s: 0.3 + rng() * 0.4, rx: rng() * 0.5, ry: rng() * Math.PI,
  })), [rng, size]);
  return (
    <group>
      {peaks.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          {/* Rock body */}
          <mesh position={[0, p.h * 0.5, 0]} castShadow receiveShadow>
            <coneGeometry args={[p.r, p.h, 6]} />
            <meshStandardMaterial color={p.main ? '#8b959b' : '#7e878c'} roughness={0.92} metalness={0.03} flatShading />
          </mesh>
          {/* Darker strata band (rotated so facets differ from the body) */}
          <mesh position={[0, p.h * 0.3, 0]} rotation={[0, 0.4, 0]}>
            <coneGeometry args={[p.r * 0.9, p.h * 0.42, 6]} />
            <meshStandardMaterial color="#69726f" roughness={0.95} flatShading />
          </mesh>
          {/* Snow cap — matches the peak's upper taper */}
          <mesh position={[0, p.h * 0.84, 0]} castShadow>
            <coneGeometry args={[p.r * 0.34, p.h * 0.34, 6]} />
            <meshStandardMaterial color="#eef4f7" roughness={0.55} flatShading />
          </mesh>
        </group>
      ))}
      {/* Scattered boulders at the base */}
      {rocks.map((r, i) => (
        <mesh key={`rk${i}`} position={[r.x, size * 0.12 * r.s, r.z]} rotation={[r.rx, r.ry, 0]} castShadow>
          <dodecahedronGeometry args={[size * 0.18 * r.s, 0]} />
          <meshStandardMaterial color="#7c8489" roughness={0.9} metalness={0.03} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function LakeDeco({ size }: { size: number }) {
  return (
    <group>
      {/* Hex water surface */}
      <mesh rotation={[-Math.PI/2,0,0]} position={[0, 0.08, 0]} receiveShadow>
        <circleGeometry args={[hexApothem(size) * 0.98, 6]} />
        <meshStandardMaterial color="#82d7ff" transparent opacity={0.9} roughness={0.3} metalness={0.1} />
      </mesh>
    </group>
  );
}

// Animated 3D wave rings on water tiles — three concentric ripple rings offset in time/scale.
function WaterWaves({ size }: { size: number }) {
  const ring1 = React.useRef<THREE.Mesh>(null);
  const ring2 = React.useRef<THREE.Mesh>(null);
  const ring3 = React.useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    // Each ring pulses opacity and scales in/out at different phases
    const animate = (ref: React.RefObject<THREE.Mesh | null>, phase: number) => {
      if (!ref.current) return;
      const s = 0.55 + 0.45 * Math.abs(Math.sin(t * 0.7 + phase));
      ref.current.scale.setScalar(s);
      const mat = ref.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.15 + 0.40 * (1 - Math.abs(Math.sin(t * 0.7 + phase)));
    };
    animate(ring1, 0);
    animate(ring2, Math.PI * 0.65);
    animate(ring3, Math.PI * 1.3);
  });
  const ap = hexApothem(size);
  const surfRef = React.useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (surfRef.current) surfRef.current.position.y = 0.12 + Math.sin(clock.getElapsedTime() * 1.3) * 0.03; // gentle swell
  });
  return (
    <group>
      {/* Deep-water floor — darker, slightly recessed to give the tile depth */}
      <mesh rotation={[-Math.PI/2,0,0]} position={[0, -0.04, 0]} receiveShadow>
        <circleGeometry args={[ap * 0.98, 6]} />
        <meshStandardMaterial color="#1e6f9c" roughness={0.55} metalness={0.2} />
      </mesh>
      {/* Reflective translucent surface (gently swells up/down) */}
      <mesh ref={surfRef} rotation={[-Math.PI/2,0,0]} position={[0, 0.12, 0]}>
        <circleGeometry args={[ap * 0.9, 6]} />
        <meshStandardMaterial color="#4ab8e8" transparent opacity={0.82} roughness={0.12} metalness={0.55} />
      </mesh>
      {/* Foam shoreline ring hugging the hex edge */}
      <mesh rotation={[-Math.PI/2,0,0]} position={[0, 0.13, 0]}>
        <ringGeometry args={[ap * 0.88, ap * 0.99, 6]} />
        <meshStandardMaterial color="#d6f2ff" roughness={0.7} transparent opacity={0.85} />
      </mesh>
      {/* Animated ripple rings */}
      <mesh ref={ring1} rotation={[-Math.PI/2,0,0]} position={[0, 0.15, 0]}>
        <ringGeometry args={[ap * 0.18, ap * 0.30, 24]} />
        <meshBasicMaterial color="#bfeaff" transparent opacity={0.45} depthWrite={false} />
      </mesh>
      <mesh ref={ring2} rotation={[-Math.PI/2,0,0]} position={[0, 0.16, 0]}>
        <ringGeometry args={[ap * 0.36, ap * 0.50, 24]} />
        <meshBasicMaterial color="#bfeaff" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh ref={ring3} rotation={[-Math.PI/2,0,0]} position={[0, 0.17, 0]}>
        <ringGeometry args={[ap * 0.56, ap * 0.70, 24]} />
        <meshBasicMaterial color="#e2f6ff" transparent opacity={0.25} depthWrite={false} />
      </mesh>
    </group>
  );
}

// Pokemon-style grass tile: cute isometric leaf-blade tufts + occasional flower clusters.
// Overall scale reduced 0.5x vs previous iteration (S = size * 0.5 applied throughout).
function GrassCluster({ size, seed = 1 }: { size: number; seed?: number }) {
  const S = size * 0.5; // 0.5x global scale
  const rng = useMemo(() => seededRand(seed), [seed]);

  const plants = useMemo(() => {
    const count = 4 + Math.floor(rng() * 4); // 4-7 plants
    const leafGreens = ['#5ecf6a', '#48b856', '#6dda78', '#3da84a', '#78e082'];
    const stemColors = ['#2e7c38', '#3d9146', '#277035'];
    // ~30% chance each plant is a flower, rest are leaf-blade tufts
    return Array.from({ length: count }, (_, i) => {
      const ang = rng() * Math.PI * 2;
      const rad = (0.12 + rng() * 0.65) * S * 1.6;
      const s = 0.55 + rng() * 0.45;
      const isFlower = rng() < 0.30;
      const flowerColors = ['#f9d84a', '#ff8ecb', '#ff6b6b', '#c87dff', '#ffa940'];
      return {
        x: Math.cos(ang) * rad,
        z: Math.sin(ang) * rad,
        s,
        isFlower,
        leafColor: leafGreens[i % leafGreens.length],
        stemColor: stemColors[i % stemColors.length],
        petalColor: flowerColors[Math.floor(rng() * flowerColors.length)],
      };
    });
  }, [rng, S]);

  return (
    <group>
      {plants.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          {p.isFlower ? (
            /* ── Flower plant ── */
            <>
              {/* Stem */}
              <mesh position={[0, S * 0.18 * p.s, 0]} castShadow>
                <cylinderGeometry args={[S * 0.025 * p.s, S * 0.03 * p.s, S * 0.36 * p.s, 4]} />
                <meshStandardMaterial color={p.stemColor} roughness={0.9} metalness={0} />
              </mesh>
              {/* Two leaf blades fanning out from stem mid-point */}
              <mesh position={[-S * 0.06 * p.s, S * 0.14 * p.s, 0]} rotation={[0, 0, -0.6]} castShadow>
                <boxGeometry args={[S * 0.22 * p.s, S * 0.07 * p.s, S * 0.04 * p.s]} />
                <meshStandardMaterial color={p.leafColor} roughness={0.85} metalness={0} />
              </mesh>
              <mesh position={[S * 0.06 * p.s, S * 0.16 * p.s, 0]} rotation={[0, 0, 0.6]} castShadow>
                <boxGeometry args={[S * 0.22 * p.s, S * 0.07 * p.s, S * 0.04 * p.s]} />
                <meshStandardMaterial color={p.leafColor} roughness={0.85} metalness={0} />
              </mesh>
              {/* Flower head — flat disc petals (4-petal cross, low poly) */}
              {[0, Math.PI / 2, Math.PI, 3 * Math.PI / 2].map((rot, pi) => (
                <mesh
                  key={pi}
                  position={[
                    Math.cos(rot) * S * 0.085 * p.s,
                    S * 0.38 * p.s,
                    Math.sin(rot) * S * 0.085 * p.s,
                  ]}
                  castShadow
                >
                  <sphereGeometry args={[S * 0.065 * p.s, 4, 3]} />
                  <meshStandardMaterial color={p.petalColor} roughness={0.7} metalness={0} />
                </mesh>
              ))}
              {/* Yellow center */}
              <mesh position={[0, S * 0.41 * p.s, 0]} castShadow>
                <sphereGeometry args={[S * 0.055 * p.s, 5, 4]} />
                <meshStandardMaterial color="#ffe44a" roughness={0.6} metalness={0} />
              </mesh>
            </>
          ) : (
            /* ── Leaf-blade tuft (Pokemon-style pointy blades) ── */
            <>
              {/* Three blades: center upright + two angled outward */}
              <mesh position={[0, S * 0.22 * p.s, 0]} castShadow>
                <coneGeometry args={[S * 0.055 * p.s, S * 0.44 * p.s, 3]} />
                <meshStandardMaterial color={p.leafColor} roughness={0.85} metalness={0} />
              </mesh>
              <mesh position={[-S * 0.09 * p.s, S * 0.18 * p.s, 0]} rotation={[0, 0, 0.38]} castShadow>
                <coneGeometry args={[S * 0.045 * p.s, S * 0.36 * p.s, 3]} />
                <meshStandardMaterial color={p.stemColor} roughness={0.85} metalness={0} />
              </mesh>
              <mesh position={[S * 0.09 * p.s, S * 0.18 * p.s, 0]} rotation={[0, 0, -0.38]} castShadow>
                <coneGeometry args={[S * 0.045 * p.s, S * 0.36 * p.s, 3]} />
                <meshStandardMaterial color={p.stemColor} roughness={0.85} metalness={0} />
              </mesh>
              {/* Small rounded base rosette */}
              <mesh position={[0, S * 0.04 * p.s, 0]} castShadow>
                <sphereGeometry args={[S * 0.1 * p.s, 5, 4]} />
                <meshStandardMaterial color={p.leafColor} roughness={0.88} metalness={0} />
              </mesh>
            </>
          )}
        </group>
      ))}
    </group>
  );
}

// Collectible healing flower for pet - renders with glow effect
function CollectibleFlower({ size }: { size: number }) {
  const S = size * 0.7; // 0.7x size for visibility
  const petalColor = '#ff6b9d';
  const stemColor = '#2d8659';
  
  return (
    <group>
      {/* Petals and stem - rest of component */}
      {/* Stem */}
      <mesh position={[0, S * 0.18, 0]} castShadow>
        <cylinderGeometry args={[S * 0.035, S * 0.04, S * 0.4, 4]} />
        <meshStandardMaterial color={stemColor} roughness={0.8} metalness={0} />
      </mesh>
      {/* Two leaf blades */}
      <mesh position={[-S * 0.08, S * 0.16, 0]} rotation={[0, 0, -0.6]} castShadow>
        <boxGeometry args={[S * 0.25, S * 0.08, S * 0.04]} />
        <meshStandardMaterial color="#3da85a" roughness={0.8} metalness={0} />
      </mesh>
      <mesh position={[S * 0.08, S * 0.18, 0]} rotation={[0, 0, 0.6]} castShadow>
        <boxGeometry args={[S * 0.25, S * 0.08, S * 0.04]} />
        <meshStandardMaterial color="#3da85a" roughness={0.8} metalness={0} />
      </mesh>
      {/* Flower petals (6-petal ring for more visual impact) */}
      {Array.from({ length: 6 }).map((_, i) => {
        const rot = (i / 6) * Math.PI * 2;
        return (
          <mesh
            key={`petal-${i}`}
            position={[
              Math.cos(rot) * S * 0.12,
              S * 0.42,
              Math.sin(rot) * S * 0.12,
            ]}
            castShadow
          >
            <sphereGeometry args={[S * 0.08, 5, 4]} />
            <meshStandardMaterial 
              color={petalColor} 
              roughness={0.6} 
              metalness={0}
              emissive="#ff4d85"
              emissiveIntensity={0.4}
            />
          </mesh>
        );
      })}
      {/* Golden center with extra glow */}
      <mesh position={[0, S * 0.48, 0]} castShadow>
        <sphereGeometry args={[S * 0.07, 6, 5]} />
        <meshStandardMaterial 
          color="#ffe066" 
          roughness={0.4} 
          metalness={0.2}
          emissive="#ffcc00"
          emissiveIntensity={0.8}
        />
      </mesh>
    </group>
  );
}

// Collectible mushroom for forest tiles - restores EP
function CollectibleMushroom({ size }: { size: number }) {
  const S = size * 0.7;
  const glowRef = React.useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (glowRef.current) {
      (glowRef.current.material as any).emissiveIntensity = 0.8 + 0.5 * Math.sin(t * 2.5);
    }
  });

  return (
    <group>
      {/* Pulsing blue glow halo at ground level */}
      <mesh ref={glowRef} position={[0, S * 0.28, 0]} renderOrder={24}>
        <sphereGeometry args={[S * 0.45, 10, 10]} />
        <meshStandardMaterial
          color="#00aaff"
          emissive="#00aaff"
          emissiveIntensity={1.0}
          transparent
          opacity={0.30}
          depthWrite={false}
          roughness={1}
          metalness={0}
        />
      </mesh>
      {/* Stem - sits on tile surface, center at half stem height */}
      <mesh position={[0, S * 0.18, 0]} renderOrder={25}>
        <cylinderGeometry args={[S * 0.06, S * 0.08, S * 0.36, 7]} />
        <meshStandardMaterial
          color="#aaddff"
          emissive="#66bbff"
          emissiveIntensity={0.6}
          roughness={0.4}
          metalness={0.1}
        />
      </mesh>
      {/* Cap - vivid blue dome sitting on top of stem */}
      <mesh position={[0, S * 0.44, 0]} renderOrder={25}>
        <sphereGeometry args={[S * 0.24, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
        <meshStandardMaterial
          color="#0066ff"
          emissive="#0044cc"
          emissiveIntensity={0.8}
          roughness={0.3}
          metalness={0.2}
        />
      </mesh>
      {/* White spots on cap */}
      {Array.from({ length: 5 }).map((_, i) => {
        const angle = (i / 5) * Math.PI * 2;
        return (
          <mesh key={`spot-${i}`} position={[Math.cos(angle) * S * 0.12, S * 0.48, Math.sin(angle) * S * 0.12]} renderOrder={26}>
            <sphereGeometry args={[S * 0.04, 5, 4]} />
            <meshStandardMaterial color="#ffffff" emissive="#aaddff" emissiveIntensity={1.0} roughness={0.2} metalness={0} />
          </mesh>
        );
      })}
      {/* Companion mushrooms — a small cluster reads richer than a lone cap */}
      {[{ x: S * 0.3, z: S * 0.12, s: 0.55 }, { x: -S * 0.26, z: -S * 0.16, s: 0.42 }].map((m, i) => (
        <group key={`mini-${i}`} position={[m.x, 0, m.z]} renderOrder={25}>
          <mesh position={[0, S * 0.12 * m.s, 0]}><cylinderGeometry args={[S * 0.04 * m.s, S * 0.055 * m.s, S * 0.24 * m.s, 6]} /><meshStandardMaterial color="#aaddff" emissive="#66bbff" emissiveIntensity={0.5} roughness={0.4} metalness={0.1} /></mesh>
          <mesh position={[0, S * 0.28 * m.s, 0]}><sphereGeometry args={[S * 0.15 * m.s, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6]} /><meshStandardMaterial color="#0066ff" emissive="#0044cc" emissiveIntensity={0.7} roughness={0.3} metalness={0.2} /></mesh>
        </group>
      ))}
      {/* Glowing spores drifting up */}
      {[0, 1, 2].map(i => (
        <mesh key={`spore-${i}`} position={[Math.cos(i * 2.1) * S * 0.2, S * (0.6 + i * 0.14), Math.sin(i * 2.1) * S * 0.2]}>
          <sphereGeometry args={[S * 0.025, 5, 4]} />
          <meshBasicMaterial color="#bfe9ff" transparent opacity={0.7} />
        </mesh>
      ))}
    </group>
  );
}

function DesertDunes({ size, seed = 1 }: { size: number; seed?: number }) {
  const rng = useMemo(() => seededRand(seed), [seed]);
  const ap = hexApothem(size);
  // Desert reads as SAND: low, wide, smooth wind-swept dunes (much flatter than the
  // grassy hill knolls), sandy-coloured to match the tile, with ripple lines and small
  // sand pebbles — no grass, no tall mounds.
  const dunes = useMemo(() => {
    const n = 2 + Math.floor(rng() * 2); // 2–3 dunes
    const arr: Array<{ x:number; z:number; r:number; flat:number; rot:number; light:boolean }> = [];
    for (let i = 0; i < n; i++) {
      const ang = rng() * Math.PI * 2;
      const rad = rng() * ap * 0.4;
      const r = ap * (0.42 + rng() * 0.34);               // wider
      arr.push({ x: Math.cos(ang) * rad, z: Math.sin(ang) * rad, r, flat: 0.12 + rng() * 0.1, rot: rng() * Math.PI, light: i % 2 === 0 }); // much flatter
    }
    return arr;
  }, [rng, ap]);
  const ripples = useMemo(() => Array.from({ length: 4 }, () => ({
    x: (rng() - 0.5) * ap * 0.75, z: (rng() - 0.5) * ap * 0.75, r: ap * (0.12 + rng() * 0.2), rot: rng() * Math.PI * 2,
  })), [rng, ap]);
  const pebbles = useMemo(() => Array.from({ length: 2 + Math.floor(rng() * 2) }, () => ({
    x: (rng() - 0.5) * ap * 1.1, z: (rng() - 0.5) * ap * 1.1, s: 0.3 + rng() * 0.4, rot: rng() * Math.PI,
  })), [rng, ap]);
  return (
    <group>
      {/* Sandy base — matches the desert tile colour */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} receiveShadow>
        <circleGeometry args={[ap * 0.98, 6]} />
        <meshStandardMaterial color="#f7d08a" roughness={1} metalness={0} flatShading />
      </mesh>
      {/* Low, wide dune mounds */}
      {dunes.map((d, i) => (
        <mesh key={`dune${i}`} position={[d.x, 0.06, d.z]} rotation={[0, d.rot, 0]} scale={[1.35, d.flat, 1]} castShadow>
          <sphereGeometry args={[d.r, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={d.light ? '#f2c877' : '#e3b45e'} roughness={1} metalness={0} flatShading />
        </mesh>
      ))}
      {/* Wind-ripple arcs */}
      {ripples.map((p, i) => (
        <mesh key={`rip${i}`} rotation={[-Math.PI / 2, 0, p.rot]} position={[p.x, 0.11, p.z]}>
          <ringGeometry args={[p.r, p.r + ap * 0.025, 16, 1, 0, Math.PI * 0.85]} />
          <meshBasicMaterial color="#d9a94e" transparent opacity={0.55} depthWrite={false} />
        </mesh>
      ))}
      {/* Small sand pebbles (sandstone-coloured, not grey rock) */}
      {pebbles.map((p, i) => (
        <mesh key={`peb${i}`} position={[p.x, 0.08 * p.s, p.z]} rotation={[p.rot, p.rot * 1.3, 0]} castShadow>
          <dodecahedronGeometry args={[size * 0.07 * p.s, 0]} />
          <meshStandardMaterial color="#cda15c" roughness={0.95} metalness={0} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function WaterRipple({ radius }: { radius: number }) {
  const ref = React.useRef<Mesh>(null);
  React.useEffect(() => {
    let raf: number;
    const loop = () => {
      if (ref.current) ref.current.position.y = 0.05 * Math.sin(performance.now() / 600);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
  <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, heightFor({ q: 0, r: 0, type: 'water', char: 'L', resource: null }) + 0.06, 0]}>
      <ringGeometry args={[radius * 0.5, radius * 0.92, 32]} />
      <meshBasicMaterial color="#bcecff" transparent opacity={0.7} />
    </mesh>
  );
}

// Bridge the R3F scene to the global window for reference systems that expect window.threeScene
function SceneBridge({ onReady, outerRadius }: { onReady?: (caps: { mountain: boolean; tree: boolean; water: boolean; hills: boolean; desert: boolean }) => void; outerRadius: number }) {
  const { scene } = useThree();
  // Keep onReady in a ref so changing it never re-triggers the effect (avoids infinite loop
  // caused by an inline arrow prop regenerating on every parent render).
  const onReadyRef = React.useRef(onReady);
  onReadyRef.current = onReady;
  React.useEffect(() => {
    (window as any).THREE = (window as any).THREE || THREE;
    (window as any).threeScene = scene;
    // Size globals for reference systems
    const ap = hexApothem(outerRadius);
    (window as any).HEX_OUTER_RADIUS = outerRadius;
    (window as any).HEX_APOTHEM = ap;
    (window as any).HEX_RADIUS_3D = ap; // many ref scripts expect this name
    // Try to initialize reference systems if helper exposed an initializer
    const init = (window as any).initialize3DSystems as undefined | (() => boolean);
    try {
      if (typeof init === 'function') init();
    } catch {}
    const hasMountain = typeof (window as any).addMountainToTile === 'function';
    const hasTree = typeof (window as any).addTreeToTile === 'function';
    const hasWater = typeof (window as any).addWaterToTile === 'function';
    const hasHills = typeof (window as any).addHillsToTile === 'function';
    const hasDesert = typeof (window as any).addDesertToTile === 'function';
    onReadyRef.current?.({ mountain: hasMountain, tree: hasTree, water: hasWater, hills: hasHills, desert: hasDesert });
    return () => {
      if ((window as any).threeScene === scene) {
        (window as any).threeScene = undefined;
      }
    };
  // outerRadius is stable (derived from a constant); scene changes only when Canvas remounts.
  // onReady intentionally omitted — captured via ref above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, outerRadius]);
  return null;
}

// Reference-integrated mountain: uses global window.addMountainToTile from integration-helper
function RefMountain({
  tileChar,
  tileX,
  tileY,
  actualHeight
}: {
  tileChar: 'M' | 'O' | 'R';
  tileX: number;
  tileY: number;
  actualHeight: number;
}) {
  const groupRef = React.useRef<THREE.Group>(null);
  // Ensure THREE and scene are exposed for the ref system
  const exposeGlobals = React.useCallback(() => {
    (window as any).THREE = (window as any).THREE || THREE;
  }, []);
  React.useEffect(() => {
    exposeGlobals();
    const grp = groupRef.current;
    // Clear any previous children to avoid duplicates on re-renders
    if (grp) {
      while (grp.children.length > 0) grp.remove(grp.children[0]);
    }
    const addMountain = (window as any).addMountainToTile as
      | ((tileGroup: THREE.Group, terrainChar: string, tileX: number, tileY: number, actualHeight: number) => void)
      | undefined;
    if (grp && typeof addMountain === 'function') {
      try {
        addMountain(grp, tileChar, tileX, tileY, actualHeight);
      } catch (e) {
        // Fallback: no-op if reference system not ready
        // console.warn('Ref mountain add failed', e);
      }
    }
  }, [tileChar, tileX, tileY, actualHeight, exposeGlobals]);
  return <group ref={groupRef} />;
}

// Reference-integrated trees: uses global window.addTreeToTile from tree-system
function RefTree({
  tileChar,
  tileX,
  tileY,
  actualHeight,
  hexSize
}: {
  tileChar: 'F' | 'J';
  tileX: number;
  tileY: number;
  actualHeight: number;
  hexSize: number;
}) {
  const groupRef = React.useRef<THREE.Group>(null);
  const exposeGlobals = React.useCallback(() => {
    (window as any).THREE = (window as any).THREE || THREE;
  }, []);
  React.useEffect(() => {
    exposeGlobals();
  // Provide sizing constants expected by reference system
  const ap = hexApothem(hexSize);
  (window as any).HEX_OUTER_RADIUS = hexSize;
  (window as any).HEX_APOTHEM = ap;
  (window as any).HEX_RADIUS_3D = ap;
    const grp = groupRef.current;
    if (grp) {
      while (grp.children.length > 0) grp.remove(grp.children[0]);
    }
    const addTree = (window as any).addTreeToTile as
      | ((tileGroup: THREE.Group, terrainChar: string, tileX: number, tileY: number, actualHeight: number) => void)
      | undefined;
    if (grp && typeof addTree === 'function') {
      try {
        addTree(grp, tileChar, tileX, tileY, actualHeight);
      } catch {
        // ignore
      }
    }
  }, [tileChar, tileX, tileY, actualHeight, hexSize, exposeGlobals]);
  return <group ref={groupRef} />;
}

// Reference-integrated water: uses global window.addWaterToTile
function RefWater({
  tileChar,
  tileX,
  tileY,
  actualHeight,
  hexSize,
}: {
  tileChar: 'L' | 'N' | 'V';
  tileX: number;
  tileY: number;
  actualHeight: number;
  hexSize: number;
}) {
  const groupRef = React.useRef<THREE.Group>(null);
  const exposeGlobals = React.useCallback(() => {
    (window as any).THREE = (window as any).THREE || THREE;
  }, []);
  React.useEffect(() => {
    exposeGlobals();
    // Provide sizing constants expected by reference system
  const ap = hexApothem(hexSize);
  (window as any).HEX_OUTER_RADIUS = hexSize;
  (window as any).HEX_APOTHEM = ap;
  (window as any).HEX_RADIUS_3D = ap;
  (window as any).HEX_HEIGHT_3D = actualHeight;
    const grp = groupRef.current;
    if (grp) {
      while (grp.children.length > 0) grp.remove(grp.children[0]);
    }
    const addWater = (window as any).addWaterToTile as
      | ((tileGroup: THREE.Group, terrainChar: string, tileX: number, tileY: number, actualHeight: number) => void)
      | undefined;
    if (grp && typeof addWater === 'function') {
      try {
        addWater(grp, tileChar, tileX, tileY, actualHeight);
      } catch {
        // ignore
      }
    }
  }, [tileChar, tileX, tileY, actualHeight, hexSize, exposeGlobals]);
  return <group ref={groupRef} />;
}

// Reference-integrated hills: uses global window.addHillsToTile
function RefHills({
  tileChar,
  tileX,
  tileY,
  actualHeight,
  hexSize,
}: {
  tileChar: 'H';
  tileX: number;
  tileY: number;
  actualHeight: number;
  hexSize: number;
}) {
  const groupRef = React.useRef<THREE.Group>(null);
  const exposeGlobals = React.useCallback(() => {
    (window as any).THREE = (window as any).THREE || THREE;
  }, []);
  React.useEffect(() => {
    exposeGlobals();
  const ap = hexApothem(hexSize);
  (window as any).HEX_OUTER_RADIUS = hexSize;
  (window as any).HEX_APOTHEM = ap;
  (window as any).HEX_RADIUS_3D = ap;
  (window as any).HEX_HEIGHT_3D = actualHeight;
    const grp = groupRef.current;
    if (grp) {
      while (grp.children.length > 0) grp.remove(grp.children[0]);
    }
    const addHills = (window as any).addHillsToTile as
      | ((tileGroup: THREE.Group, terrainChar: string, tileX: number, tileY: number, actualHeight: number) => void)
      | undefined;
    if (grp && typeof addHills === 'function') {
      try {
        addHills(grp, tileChar, tileX, tileY, actualHeight);
      } catch {
        // ignore
      }
    }
  }, [tileChar, tileX, tileY, actualHeight, hexSize, exposeGlobals]);
  return <group ref={groupRef} />;
}

// Reference-integrated desert: uses global window.addDesertToTile
function RefDesert({
  tileChar,
  tileX,
  tileY,
  actualHeight,
  hexSize,
}: {
  tileChar: 'D';
  tileX: number;
  tileY: number;
  actualHeight: number;
  hexSize: number;
}) {
  const groupRef = React.useRef<THREE.Group>(null);
  const exposeGlobals = React.useCallback(() => {
    (window as any).THREE = (window as any).THREE || THREE;
  }, []);
  React.useEffect(() => {
    exposeGlobals();
  const ap = hexApothem(hexSize);
  (window as any).HEX_OUTER_RADIUS = hexSize;
  (window as any).HEX_APOTHEM = ap;
  (window as any).HEX_RADIUS_3D = ap;
  (window as any).HEX_HEIGHT_3D = actualHeight;
    const grp = groupRef.current;
    if (grp) {
      while (grp.children.length > 0) grp.remove(grp.children[0]);
    }
    const addDesert = (window as any).addDesertToTile as
      | ((tileGroup: THREE.Group, terrainChar: string, tileX: number, tileY: number, actualHeight: number) => void)
      | undefined;
    if (grp && typeof addDesert === 'function') {
      try {
        addDesert(grp, tileChar, tileX, tileY, actualHeight);
      } catch {
        // ignore
      }
    }
  }, [tileChar, tileX, tileY, actualHeight, hexSize, exposeGlobals]);
  return <group ref={groupRef} />;
}

/**
 * Avatar Collision Detector Component
 * Runs each frame to enforce floor collision for player and pet avatars
 * Prevents them from falling through terrain
 */
function AvatarCollisionDetector({ 
  heroAvatarRef, 
  heroWorldPos, 
  culledTiles, 
  hexSize 
}: { 
  heroAvatarRef: React.MutableRefObject<THREE.Group | null>;
  heroWorldPos: { x: number; z: number };
  culledTiles: Tile[];
  hexSize: number;
}) {
  const { scene } = useThree();
  const floorColliderRef = React.useRef<THREE.Group | null>(null);
  
  // Build floor collider on first mount from culled tiles
  React.useEffect(() => {
    if (!floorColliderRef.current && culledTiles.length > 0) {
      const group = new THREE.Group();
      group.userData.type = 'floor-colliders';
      
      for (const tile of culledTiles) {
        const { x, z } = axialToWorld(tile, hexSize);
        const floorMesh = createFloorCollider(hexSize * 1.2, new THREE.Vector3(x, 0.01, z));
        group.add(floorMesh);
      }
      
      scene.add(group);
      floorColliderRef.current = group;
      console.log('[collision] Created floor collider with', culledTiles.length, 'tiles');
    }
  }, [culledTiles.length, hexSize, scene]);
  
  // Update collider position and hero avatar collision each frame
  useFrame(() => {
    if (!heroAvatarRef.current || !floorColliderRef.current) return;
    
    // Hero avatar is positioned at world coordinates
    const heroPos = new THREE.Vector3(heroWorldPos.x, heroAvatarRef.current.position.y, heroWorldPos.z);
    
    // Update collision and clamp avatar to floor
    try {
      updateAvatarCollision(heroPos, heroAvatarRef, floorColliderRef.current, {
        rayDirection: new THREE.Vector3(0, -1, 0),
        rayLength: 5,
        floorOffset: 0.1,
        debugVisualize: false,
      });
    } catch (e) {
      // Silently ignore collision errors to prevent frame drops
      if (Math.random() < 0.0001) console.warn('[collision] Error:', e);
    }
  });
  
  return null; // No rendering, just collision updates
}

function HexTile({ t, size, onClick, onHover }: { t: Tile; size: number; onClick: (t: Tile) => void; onHover?: (t: Tile | null) => void }) {
  const h = heightFor(t);
  const color = tileColor(t);
  return (
    <group position={[0, h / 2, 0]}>
      <mesh
        onClick={() => onClick(t)}
        onPointerOver={(e) => { e.stopPropagation(); onHover?.(t); }}
        onPointerOut={(e) => { e.stopPropagation(); onHover?.(null); }}
        castShadow
        receiveShadow
        // Rotate by 30deg so flat-top hex aligns by sides (cylinderGeometry default is pointy-up).
        rotation={[0, Math.PI / 6, 0]}
      >
        <cylinderGeometry args={[size, size, h, 6]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

/** Animated isometric cat pet with leg & tail walk cycle */
function IsometricPet({ ps, isMoving }: { ps: number; isMoving: boolean }) {
  const flRef = React.useRef<THREE.Mesh>(null);  // front-left leg
  const frRef = React.useRef<THREE.Mesh>(null);  // front-right leg
  const blRef = React.useRef<THREE.Mesh>(null);  // back-left leg
  const brRef = React.useRef<THREE.Mesh>(null);  // back-right leg
  const tailRef = React.useRef<THREE.Mesh>(null); // tail cylinder
  const tipRef = React.useRef<THREE.Mesh>(null);  // tail tip
  const timeRef = React.useRef(0);

  // Base positions (rest pose)
  const flBase = [-ps * 0.32, ps * 0.38, ps * 0.28] as const;
  const frBase = [ps * 0.32, ps * 0.38, ps * 0.28] as const;
  const blBase = [-ps * 0.36, ps * 0.38, -ps * 0.24] as const;
  const brBase = [ps * 0.36, ps * 0.38, -ps * 0.24] as const;

  useFrame((_, delta) => {
    timeRef.current += delta;
    const t = timeRef.current;

    if (isMoving) {
      const freq = 10.0;
      const phase = t * freq;
      const legSwing = Math.sin(phase) * ps * 0.18;
      const tailSwing = Math.sin(phase * 1.5) * 0.6;

      // Front legs alternate with back legs (diagonal gait)
      if (flRef.current) flRef.current.position.z = flBase[2] + legSwing;
      if (brRef.current) brRef.current.position.z = brBase[2] + legSwing;
      if (frRef.current) frRef.current.position.z = frBase[2] - legSwing;
      if (blRef.current) blRef.current.position.z = blBase[2] - legSwing;

      // Tail wag
      if (tailRef.current) tailRef.current.rotation.z = 0.1 + tailSwing;
      if (tipRef.current) tipRef.current.position.x = -ps * 0.14 + Math.sin(phase * 1.5) * ps * 0.15;
    } else {
      // Snap to rest instantly
      if (flRef.current) flRef.current.position.z = flBase[2];
      if (frRef.current) frRef.current.position.z = frBase[2];
      if (blRef.current) blRef.current.position.z = blBase[2];
      if (brRef.current) brRef.current.position.z = brBase[2];
      if (tailRef.current) tailRef.current.rotation.z = 0.1;
      if (tipRef.current) tipRef.current.position.x = -ps * 0.14;
    }
  });

  return (
    <group frustumCulled={false}>
      {/* Drop shadow */}
      <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, 0.01, 0]} frustumCulled={false}>
        <circleGeometry args={[ps * 0.85, 20]} />
        <meshBasicMaterial color="#000" transparent opacity={0.18} depthWrite={false} />
      </mesh>
      {/* Body */}
      <mesh position={[0, ps * 0.72, 0]} castShadow frustumCulled={false}>
        <sphereGeometry args={[ps * 0.62, 14, 10]} />
        <meshStandardMaterial color="#f5c97a" roughness={0.6} />
      </mesh>
      {/* Belly patch */}
      <mesh position={[0, ps * 0.68, ps * 0.48]} frustumCulled={false}>
        <sphereGeometry args={[ps * 0.36, 10, 8]} />
        <meshStandardMaterial color="#fdecc8" roughness={0.7} />
      </mesh>
      {/* Head */}
      <mesh position={[0, ps * 1.5, 0]} castShadow frustumCulled={false}>
        <sphereGeometry args={[ps * 0.72, 16, 12]} />
        <meshStandardMaterial color="#f5c97a" roughness={0.6} />
      </mesh>
      {/* Collar */}
      <mesh position={[0, ps * 1.02, 0]} rotation={[Math.PI / 2, 0, 0]} frustumCulled={false}>
        <torusGeometry args={[ps * 0.5, ps * 0.07, 6, 16]} />
        <meshStandardMaterial color="#c0392b" roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[0, ps * 0.86, ps * 0.5]} frustumCulled={false}>
        <sphereGeometry args={[ps * 0.1, 8, 6]} />
        <meshStandardMaterial color="#ffd54a" roughness={0.3} metalness={0.6} />
      </mesh>
      {/* Whiskers — near-horizontal, splayed out from the muzzle */}
      {[[ps * 0.3, -1.4, 0.12], [ps * 0.3, -1.55, -0.05], [-ps * 0.3, 1.4, 0.12], [-ps * 0.3, 1.55, -0.05]].map((w, i) => (
        <mesh key={`wh${i}`} position={[w[0], ps * (1.42 + w[2]), ps * 0.58]} rotation={[0, 0, w[1]]} frustumCulled={false}>
          <cylinderGeometry args={[ps * 0.012, ps * 0.012, ps * 0.42, 3]} />
          <meshBasicMaterial color="#fff8e8" />
        </mesh>
      ))}
      {/* Muzzle */}
      <mesh position={[0, ps * 1.42, ps * 0.56]} frustumCulled={false}>
        <sphereGeometry args={[ps * 0.28, 10, 8]} />
        <meshStandardMaterial color="#fdecc8" roughness={0.7} />
      </mesh>
      {/* Nose */}
      <mesh position={[0, ps * 1.52, ps * 0.8]} frustumCulled={false}>
        <sphereGeometry args={[ps * 0.08, 8, 6]} />
        <meshStandardMaterial color="#e07090" roughness={0.4} />
      </mesh>
      {/* Left eye */}
      <mesh position={[-ps * 0.28, ps * 1.64, ps * 0.56]} frustumCulled={false}>
        <sphereGeometry args={[ps * 0.14, 10, 8]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.3} />
      </mesh>
      {/* Left eye shine */}
      <mesh position={[-ps * 0.24, ps * 1.68, ps * 0.67]} frustumCulled={false}>
        <sphereGeometry args={[ps * 0.05, 6, 6]} />
        <meshBasicMaterial color="white" />
      </mesh>
      {/* Right eye */}
      <mesh position={[ps * 0.28, ps * 1.64, ps * 0.56]} frustumCulled={false}>
        <sphereGeometry args={[ps * 0.14, 10, 8]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.3} />
      </mesh>
      {/* Right eye shine */}
      <mesh position={[ps * 0.24, ps * 1.68, ps * 0.67]} frustumCulled={false}>
        <sphereGeometry args={[ps * 0.05, 6, 6]} />
        <meshBasicMaterial color="white" />
      </mesh>
      {/* Left ear */}
      <mesh position={[-ps * 0.48, ps * 2.18, 0]} rotation={[0, 0, -0.35]} frustumCulled={false}>
        <coneGeometry args={[ps * 0.22, ps * 0.52, 8]} />
        <meshStandardMaterial color="#f5c97a" roughness={0.6} />
      </mesh>
      {/* Left ear inner */}
      <mesh position={[-ps * 0.44, ps * 2.18, ps * 0.06]} rotation={[0, 0, -0.35]} frustumCulled={false}>
        <coneGeometry args={[ps * 0.12, ps * 0.34, 8]} />
        <meshStandardMaterial color="#f0a0b0" roughness={0.5} />
      </mesh>
      {/* Right ear */}
      <mesh position={[ps * 0.48, ps * 2.18, 0]} rotation={[0, 0, 0.35]} frustumCulled={false}>
        <coneGeometry args={[ps * 0.22, ps * 0.52, 8]} />
        <meshStandardMaterial color="#f5c97a" roughness={0.6} />
      </mesh>
      {/* Right ear inner */}
      <mesh position={[ps * 0.44, ps * 2.18, ps * 0.06]} rotation={[0, 0, 0.35]} frustumCulled={false}>
        <coneGeometry args={[ps * 0.12, ps * 0.34, 8]} />
        <meshStandardMaterial color="#f0a0b0" roughness={0.5} />
      </mesh>
      {/* Front left leg */}
      <mesh ref={flRef} position={[flBase[0], flBase[1], flBase[2]]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[ps * 0.13, ps * 0.14, ps * 0.45, 8]} />
        <meshStandardMaterial color="#f5c97a" roughness={0.6} />
      </mesh>
      {/* Front right leg */}
      <mesh ref={frRef} position={[frBase[0], frBase[1], frBase[2]]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[ps * 0.13, ps * 0.14, ps * 0.45, 8]} />
        <meshStandardMaterial color="#f5c97a" roughness={0.6} />
      </mesh>
      {/* Back left leg */}
      <mesh ref={blRef} position={[blBase[0], blBase[1], blBase[2]]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[ps * 0.13, ps * 0.14, ps * 0.42, 8]} />
        <meshStandardMaterial color="#f5c97a" roughness={0.6} />
      </mesh>
      {/* Back right leg */}
      <mesh ref={brRef} position={[brBase[0], brBase[1], brBase[2]]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[ps * 0.13, ps * 0.14, ps * 0.42, 8]} />
        <meshStandardMaterial color="#f5c97a" roughness={0.6} />
      </mesh>
      {/* Tail */}
      <mesh ref={tailRef} position={[-ps * 0.1, ps * 0.9, -ps * 0.62]} rotation={[0.7, 0.3, 0.1]} frustumCulled={false}>
        <cylinderGeometry args={[ps * 0.08, ps * 0.12, ps * 0.8, 8]} />
        <meshStandardMaterial color="#f5a040" roughness={0.5} />
      </mesh>
      {/* Tail tip */}
      <mesh ref={tipRef} position={[-ps * 0.14, ps * 1.3, -ps * 0.9]} frustumCulled={false}>
        <sphereGeometry args={[ps * 0.16, 8, 8]} />
        <meshStandardMaterial color="#fff5e0" roughness={0.5} />
      </mesh>
    </group>
  );
}

/** Cyber-Dog companion (strength/recon) — sturdier build, long snout, floppy ears. */
function IsometricDog({ ps, isMoving }: { ps: number; isMoving: boolean }) {
  const flRef = React.useRef<THREE.Mesh>(null);
  const frRef = React.useRef<THREE.Mesh>(null);
  const blRef = React.useRef<THREE.Mesh>(null);
  const brRef = React.useRef<THREE.Mesh>(null);
  const tailRef = React.useRef<THREE.Mesh>(null);
  const timeRef = React.useRef(0);
  const flBase = [-ps * 0.34, ps * 0.42, ps * 0.34] as const;
  const frBase = [ps * 0.34, ps * 0.42, ps * 0.34] as const;
  const blBase = [-ps * 0.38, ps * 0.42, -ps * 0.3] as const;
  const brBase = [ps * 0.38, ps * 0.42, -ps * 0.3] as const;
  const FUR = '#8a6a4a'; const FUR2 = '#6f5238'; const BELLY = '#c9ad86';
  useFrame((_, delta) => {
    timeRef.current += delta; const t = timeRef.current;
    if (isMoving) {
      const phase = t * 10; const swing = Math.sin(phase) * ps * 0.2;
      if (flRef.current) flRef.current.position.z = flBase[2] + swing;
      if (brRef.current) brRef.current.position.z = brBase[2] + swing;
      if (frRef.current) frRef.current.position.z = frBase[2] - swing;
      if (blRef.current) blRef.current.position.z = blBase[2] - swing;
      if (tailRef.current) tailRef.current.rotation.z = 0.2 + Math.sin(phase * 1.4) * 0.5;
    } else {
      if (flRef.current) flRef.current.position.z = flBase[2];
      if (frRef.current) frRef.current.position.z = frBase[2];
      if (blRef.current) blRef.current.position.z = blBase[2];
      if (brRef.current) brRef.current.position.z = brBase[2];
      if (tailRef.current) tailRef.current.rotation.z = 0.2 + Math.sin(t * 3) * 0.15; // idle wag
    }
  });
  return (
    <group frustumCulled={false}>
      {/* Drop shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} frustumCulled={false}>
        <circleGeometry args={[ps * 0.95, 20]} /><meshBasicMaterial color="#000" transparent opacity={0.18} depthWrite={false} />
      </mesh>
      {/* Body (longer, sturdier than the cat) */}
      <mesh position={[0, ps * 0.82, -ps * 0.05]} scale={[1, 0.85, 1.25]} castShadow frustumCulled={false}>
        <sphereGeometry args={[ps * 0.66, 14, 10]} /><meshStandardMaterial color={FUR} roughness={0.65} />
      </mesh>
      <mesh position={[0, ps * 0.72, ps * 0.5]} frustumCulled={false}>
        <sphereGeometry args={[ps * 0.34, 10, 8]} /><meshStandardMaterial color={BELLY} roughness={0.7} />
      </mesh>
      {/* Head */}
      <mesh position={[0, ps * 1.45, ps * 0.35]} castShadow frustumCulled={false}>
        <sphereGeometry args={[ps * 0.6, 16, 12]} /><meshStandardMaterial color={FUR} roughness={0.65} />
      </mesh>
      {/* Long snout */}
      <mesh position={[0, ps * 1.3, ps * 0.95]} scale={[1, 0.8, 1.4]} castShadow frustumCulled={false}>
        <sphereGeometry args={[ps * 0.26, 10, 8]} /><meshStandardMaterial color={BELLY} roughness={0.7} />
      </mesh>
      {/* Nose */}
      <mesh position={[0, ps * 1.34, ps * 1.28]} frustumCulled={false}>
        <sphereGeometry args={[ps * 0.1, 8, 6]} /><meshStandardMaterial color="#1a1a1a" roughness={0.3} />
      </mesh>
      {/* Eyes */}
      <mesh position={[-ps * 0.24, ps * 1.6, ps * 0.85]} frustumCulled={false}><sphereGeometry args={[ps * 0.11, 8, 6]} /><meshStandardMaterial color="#1a1a2e" /></mesh>
      <mesh position={[ps * 0.24, ps * 1.6, ps * 0.85]} frustumCulled={false}><sphereGeometry args={[ps * 0.11, 8, 6]} /><meshStandardMaterial color="#1a1a2e" /></mesh>
      {/* Floppy ears (hang down along the head) */}
      <mesh position={[-ps * 0.5, ps * 1.5, ps * 0.1]} rotation={[0.2, 0, 0.35]} scale={[0.5, 1, 0.7]} frustumCulled={false}>
        <sphereGeometry args={[ps * 0.3, 8, 8]} /><meshStandardMaterial color={FUR2} roughness={0.7} />
      </mesh>
      <mesh position={[ps * 0.5, ps * 1.5, ps * 0.1]} rotation={[0.2, 0, -0.35]} scale={[0.5, 1, 0.7]} frustumCulled={false}>
        <sphereGeometry args={[ps * 0.3, 8, 8]} /><meshStandardMaterial color={FUR2} roughness={0.7} />
      </mesh>
      {/* Cybernetic collar */}
      <mesh position={[0, ps * 1.02, ps * 0.2]} rotation={[Math.PI / 2, 0, 0]} frustumCulled={false}>
        <torusGeometry args={[ps * 0.48, ps * 0.07, 6, 16]} /><meshStandardMaterial color="#2b8fd6" emissive="#1668a8" emissiveIntensity={0.5} roughness={0.4} metalness={0.5} />
      </mesh>
      {/* Legs */}
      {[flRef, frRef, blRef, brRef].map((r, i) => {
        const base = [flBase, frBase, blBase, brBase][i];
        return <mesh key={i} ref={r} position={[base[0], base[1], base[2]]} castShadow frustumCulled={false}><cylinderGeometry args={[ps * 0.14, ps * 0.15, ps * 0.5, 8]} /><meshStandardMaterial color={FUR2} roughness={0.65} /></mesh>;
      })}
      {/* Tail (up, wags) */}
      <mesh ref={tailRef} position={[0, ps * 1.0, -ps * 0.6]} rotation={[-0.6, 0, 0.2]} frustumCulled={false}>
        <cylinderGeometry args={[ps * 0.06, ps * 0.12, ps * 0.7, 8]} /><meshStandardMaterial color={FUR} roughness={0.6} />
      </mesh>
    </group>
  );
}

export default function SoloMissionMap3D({
  onExit, 
  onMapUpdate, 
  abilitySlots: externalAbilities, 
  defenseSlots: externalDefense,
  heroVitals,
  petData,
  resources,
  skillTokens,
  factionName,
  elapsedTime,
  skillPoints,
  totalPlayTime,
  heroInventory,
  petInventory,
  playerProfile,
  onOpenSkillTree,
  onHealHP,
  onRestoreEP,
  onDamageHP,
  onDrainEP,
  heroAttack = 8,
  combatStats,
  heroAvatar,
  autoMultiplayer,
  mobaMode,
  sharedProfile,
  sharedSaveProgress,
  inputPaused,
}: {
  onExit?: () => void;
  onMapUpdate?: (data: MinimapData) => void; 
  abilitySlots?: Ability[]; 
  defenseSlots?: Ability[];
  heroVitals?: { hp: { current: number; max: number }; ep: { current: number; max: number }; xp: { current: number; max: number }; level: number; name: string; portraitUrl?: string; buffs?: string[] };
  petData?: { name: string; level: number; hp: { current: number; max: number }; ep: { current: number; max: number }; icon?: string; portraitUrl?: string };
  resources?: { id: string; label: string; value: number; icon?: string }[];
  skillTokens?: number;
  factionName?: string;
  elapsedTime?: string;
  skillPoints?: number;
  totalPlayTime?: number;
  heroInventory?: Array<{ id: string; type: string; quantity: number; value?: number }>;
  petInventory?: Array<{ id: string; type: string; quantity: number; value?: number }>;
  playerProfile?: { uid: string; displayName?: string; email?: string; faction?: string };
  onOpenSkillTree?: () => void;
  onHealHP?: (amount: number) => void;
  onRestoreEP?: (amount: number) => void;
  onDamageHP?: (amount: number) => void;
  /** Spend energy (ability cost). */
  onDrainEP?: (amount: number) => void;
  /** Hero attack stat — creep-camp combat damage per tick. */
  heroAttack?: number;
  /** Combat stats (atk/def/spd) shown in the in-game menu overview. */
  combatStats?: { atk: number; def: number; spd: number };
  /** Active loadout passed from App — used as the source of truth for avatar data
   *  so changes in the configurator reflect immediately without a page reload. */
  heroAvatar?: CharacterLoadout | null;
  /** Launched from the dashboard's Multiplayer mode — auto-open the duel lobby + quick-match. */
  autoMultiplayer?: boolean;
  /** Launched from the dashboard's 1v1v1 MOBA mode — auto-open the MOBA lobby. */
  mobaMode?: boolean;
  /** Shared player-profile instance from MissionScreen (single source of truth). */
  sharedProfile?: ReturnType<typeof usePlayerProfile>['profile'];
  sharedSaveProgress?: ReturnType<typeof usePlayerProfile>['saveProgress'];
  /** When true (e.g. skill-tree overlay open), mission keyboard input is ignored. */
  inputPaused?: boolean;
} = {}) {
  const useChunks = import.meta.env.VITE_USE_CHUNKS === 'true';
  // Adjusted map size to requested 240 x 240 tiles (square) (legacy full-map path only)
  const GRID_W = 240;
  const GRID_H = 240;
  const MAP_SCALE = 3; // new scale factor
  const hexSize = 1.0 * MAP_SCALE;
  
  // Use Web Worker for terrain generation to avoid blocking main thread
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [generatingTerrain, setGeneratingTerrain] = useState(!useChunks);
  
  useEffect(() => {
    if (useChunks) {
      setTiles([]);
      setGeneratingTerrain(false);
      return;
    }
    
    setGeneratingTerrain(true);
    
    // Create worker if available
    const worker = new Worker(new URL('../workers/terrainGenerator.ts', import.meta.url), { type: 'module' });
    
    const messageId = 'terrain-' + Date.now();
    
    const handleMessage = (event: MessageEvent) => {
      if (event.data.id === messageId && event.data.type === 'complete') {
        try {
          const generatedTiles: Tile[] = JSON.parse(event.data.tileData);
          assignResources(generatedTiles);
          setTiles(generatedTiles);
          console.log('[map:init:worker]', { width: GRID_W, height: GRID_H, tileCount: generatedTiles.length });
        } catch (e) {
          console.error('[map:worker] parse failed', e);
        }
        setGeneratingTerrain(false);
        worker.terminate();
      }
    };
    
    const handleError = (error: ErrorEvent) => {
      console.error('[map:worker] error', error);
      setGeneratingTerrain(false);
      worker.terminate();
    };
    
    worker.onmessage = handleMessage;
    worker.onerror = handleError;
    
    // Send generation request
    worker.postMessage({ type: 'generate', width: GRID_W, height: GRID_H, seed: 1337, id: messageId });
    
    return () => {
      worker.terminate();
    };
  }, [useChunks, GRID_W, GRID_H]);
  // If chunk mode enabled, center using world midpoint assumptions
  const chunkCenterAxial = useMemo(() => ({ q: Math.floor(GRID_W/2), r: Math.floor(GRID_H/2) }), []);
  // Player profile (anonymous auth + progress). Prefer the SHARED instance passed from
  // MissionScreen so the whole session reads/writes ONE profile — otherwise a second
  // copy diverges (heroVitals vs HUD XP) and its writes clobber the other's (e.g. the
  // periodic play-time save overwriting earned XP). Falls back to a local hook if none.
  const localPP = usePlayerProfile();
  const profile = sharedProfile ?? localPP.profile;
  const profileLoading = localPP.loading;
  const saveProgress = sharedSaveProgress ?? localPP.saveProgress;
  const { session, updateHeroPosition, syncing: sessionSyncing, lastSync: sessionLastSync } = usePlayerSession();
  // Compute approximate center axial coordinate by averaging q,r
  const centerAxial = useMemo(() => {
    if (tiles.length === 0) return { q: 0, r: 0 };
    // Derive bounding box in axial coordinates
    let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
    for (const t of tiles) { if (t.q < minQ) minQ = t.q; if (t.q > maxQ) maxQ = t.q; if (t.r < minR) minR = t.r; if (t.r > maxR) maxR = t.r; }
    const cq = Math.round((minQ + maxQ) / 2);
    const cr = Math.round((minR + maxR) / 2);
    return { q: cq, r: cr };
  }, [tiles]);
  // Find the nearest walkable (non-mountain, non-water) tile to the map center.
  // This prevents the hero spawning on an impassable tile which would make heroVisible empty.
  const spawnPos = useMemo(() => {
    if (tiles.length === 0) return { q: 0, r: 0 };
    const tileMap = new Map<string, Tile>();
    for (const t of tiles) tileMap.set(`${t.q},${t.r}`, t);
    const visited = new Set<string>();
    const bfsQueue: Axial[] = [centerAxial];
    while (bfsQueue.length) {
      const pos = bfsQueue.shift()!;
      const k = `${pos.q},${pos.r}`;
      if (visited.has(k)) continue;
      visited.add(k);
      const t = tileMap.get(k);
      if (t && t.type !== 'mountain' && t.type !== 'water') return pos;
      for (const n of axialNeighbors(pos)) {
        if (!visited.has(`${n.q},${n.r}`)) bfsQueue.push(n);
      }
    }
    return centerAxial; // fallback (shouldn't happen)
  }, [tiles, centerAxial]);
  // Demo actors (player + pet) with different vision ranges
  const [hero, setHero] = useState<Actor>({ id: 'hero', pos: useChunks ? chunkCenterAxial : spawnPos, vision: 8, kind: 'actor' });
  const [collisionMessage, setCollisionMessage] = useState<{ type: 'water' | 'mountain'; show: boolean }>({ type: 'water', show: false });
  const [pet, setPet] = useState<Actor>({ id: 'pet', pos: { q: (useChunks?chunkCenterAxial.q:centerAxial.q) + 4, r: (useChunks?chunkCenterAxial.r:centerAxial.r) - 1 }, vision: 3, kind: 'pet' });
  const heroAvatarRef = React.useRef<THREE.Group>(null); // For collision detection

  // ── Pet XP system (standalone hook) ─────────────────────────────────────
  const petXPSystem = usePetXP({
    uid: profile?.uid ?? '',
    email: profile?.email,
    displayName: profile?.displayName,
    profile,
    saveProgress,
  });

  // Visual XP feedback funnel (assigned after awardHeroXp/bumpHeroXpVisual are defined
  // below; used here via a ref because collectibles is constructed earlier).
  const bumpHeroXpVisualRef = React.useRef<((amount: number) => void) | null>(null);

  // ── Collectibles / inventory / item-slot system (standalone hook) ────────
  const collectibles = useCollectibles({
    uid: profile?.uid ?? '',
    email: profile?.email,
    displayName: profile?.displayName,
    tiles,
    heroQ: hero.pos.q,
    heroR: hero.pos.r,
    profile,
    heroInventoryProp: heroInventory as any,
    petInventoryProp: petInventory as any,
    saveProgress,
    onHealHP,
    onRestoreEP,
    onHeroXp: (amt) => bumpHeroXpVisualRef.current?.(amt),
  });

  // Destructure for convenience (avoids updating all downstream call sites)
  const {
    collectibleFlowers, collectibleMushrooms, collectibleResources,
    nearbyFlower, nearbyMushroom, nearbyResource,
    collectingFlower, collectingMushroom, collectingResource, collectingProgress,
    nearbyFlowerRef, nearbyMushroomRef, nearbyResourceRef, collectingFlowerRef, collectingMushroomRef, collectTimerRef,
    localHeroInventory, setLocalHeroInventory,
    localPetInventory, setLocalPetInventory,
    itemSlots, setItemSlots,
    handleCollect,
    handleItemUse,
  } = collectibles;

  // ── Hero XP + progression ─────────────────────────────────────────────────────
  const profileForXpRef = React.useRef(profile);
  profileForXpRef.current = profile;
  const heroPosRef = React.useRef(hero.pos);
  heroPosRef.current = hero.pos;

  // Floating combat/feedback numbers (damage, heal, +XP).
  const [combatTexts, setCombatTexts] = React.useState<Array<{ id: number; x: number; z: number; text: string; color: string }>>([]);
  const nextTextId = React.useRef(0);
  const spawnCombatText = React.useCallback((x: number, z: number, text: string, color: string) => {
    const id = nextTextId.current++;
    setCombatTexts(prev => [...prev.slice(-14), { id, x, z, text, color }]);
  }, []);

  // Monotonic live XP mirror — the single value the HUD reads. Bumped OPTIMISTICALLY on
  // every gain (instant feedback) and reconciled upward from the saved profile.
  const [heroXpLive, setHeroXpLive] = useState(() => Math.floor(profile?.progress?.hero?.xp ?? 0));
  React.useEffect(() => {
    const x = Math.floor(profile?.progress?.hero?.xp ?? 0);
    setHeroXpLive(prev => (x > prev ? x : prev));
  }, [profile?.progress?.hero?.xp]);

  // Visual-only XP bump (+HUD +"+X XP" popup) — for sources that persist XP themselves
  // (collectibles). Kept in a ref so the earlier collectibles hook can call it.
  const bumpHeroXpVisual = React.useCallback((amount: number) => {
    if (amount <= 0) return;
    setHeroXpLive(x => x + amount);
    const hw = axialToWorld({ q: heroPosRef.current.q, r: heroPosRef.current.r }, hexSize);
    spawnCombatText(hw.x, hw.z, `+${Math.round(amount)} XP`, '#ffd24a');
  }, [spawnCombatText, hexSize]);
  bumpHeroXpVisualRef.current = bumpHeroXpVisual;

  // Full award: visual bump + persist (level derived from XP). Used by creeps/missions.
  const awardHeroXp = React.useCallback((amount: number) => {
    if (amount <= 0) return;
    bumpHeroXpVisual(amount);
    const prof = profileForXpRef.current;
    const heroXp = prof?.progress?.hero?.xp ?? 0;
    const newXp = heroXp + amount;
    const newLevel = Math.max(prof?.progress?.hero?.level ?? 1, getLevelFromXp(newXp));
    // Patch ONLY xp/level — mergeProgress preserves the existing hero (skills, traits),
    // so we never risk wiping unlocked skills from a stale snapshot.
    saveProgress({ hero: { xp: newXp, level: newLevel } });
  }, [saveProgress, bumpHeroXpVisual]);

  // Level-up: keep the skill-store level in sync so points unlock LIVE, and flash a
  // "Level Up" banner — this is the meta-progression link (XP → level → skill points).
  const [levelUpBanner, setLevelUpBanner] = useState<number | null>(null);
  const prevHeroLevelRef = React.useRef(Math.max(1, getLevelFromXp(Math.floor(heroXpLive))));
  React.useEffect(() => {
    const lvl = Math.max(1, getLevelFromXp(Math.floor(heroXpLive)));
    try { useSkillStore.getState().setLevel(lvl); } catch {}
    if (lvl > prevHeroLevelRef.current) {
      prevHeroLevelRef.current = lvl;
      setLevelUpBanner(lvl);
      const hw = axialToWorld({ q: heroPosRef.current.q, r: heroPosRef.current.r }, hexSize);
      spawnCombatText(hw.x, hw.z, `⭐ LEVEL ${lvl}`, '#8fe38f');
      const t = setTimeout(() => setLevelUpBanner(null), 2600);
      return () => clearTimeout(t);
    } else if (lvl < prevHeroLevelRef.current) {
      prevHeroLevelRef.current = lvl;
    }
  }, [heroXpLive, hexSize, spawnCombatText]);

  // Award Faction Points (persisted) — earned from faction activities (creep clears, resources).
  const awardFactionPoints = React.useCallback((amount: number) => {
    const cur = (profileForXpRef.current?.progress as any)?.factionPoints ?? 0;
    saveProgress({ factionPoints: cur + amount } as any);
  }, [saveProgress]);

  // ── Pet type & roles (GDD): Dog = strength/combat assist, Cat = stealth/recon ──
  const petType: string = (heroAvatar as any)?.pet?.type ?? profile?.progress?.pet?.type ?? 'CYBER_CAT';
  const isDog = petType === 'CYBER_DOG';
  const petLevel = petData?.level ?? profile?.progress?.pet?.level ?? 1;
  const petCombatBonus = isDog ? 3 + petLevel * 2 : 0;         // Dog fights alongside you
  const petVisionBonus = isDog ? 0 : 1;                        // Cat scouts (+vision)

  // Attack/Defense mode — drives which ability set QWER uses AND the fight math:
  // Attack mode hits harder; Defense mode hits softer but you take far less damage.
  const [abilityMode, setAbilityMode] = useState<'offense' | 'defense'>('offense');
  const combatAtkMult = abilityMode === 'offense' ? 1.3 : 0.6;
  const combatIncomingScale = abilityMode === 'offense' ? 1 : 0.5;

  // Faction-enemy provoke handle, assigned once useFactionEnemies is constructed below.
  // Declared early so mission callbacks (loot a rival camp, capture an outpost) can make
  // the responsible faction's nearby units drop their leash and hunt the hero.
  const enemyProvokeRef = React.useRef<((q: number, r: number, fk?: FactionKey, radius?: number) => void) | null>(null);

  const { camps: creepCamps, nearbyCamp: nearbyCreepCamp, attackNearby: attackNearbyCamp, strikeNearby: strikeNearbyCamp } = useCreeps({
    tiles,
    heroQ: hero.pos.q,
    heroR: hero.pos.r,
    centerQ: centerAxial.q,
    centerR: centerAxial.r,
    heroAttack: Math.round((heroAttack + petCombatBonus) * combatAtkMult),
    incomingDamageScale: combatIncomingScale,
    onHeroDamage: (amt) => applyIncomingDamageRef.current(amt),
    awardXp: awardHeroXp,
    awardShards: awardFactionPoints, // camp clears grant Faction Points
    onCombat: ({ campQ, campR, toCreep, toHero, killed }) => {
      if (toCreep > 0) { const cw = axialToWorld({ q: campQ, r: campR }, hexSize); spawnCombatText(cw.x, cw.z, `-${toCreep}`, '#ffd24a'); }
      if (toHero > 0) { const hw = axialToWorld({ q: hero.pos.q, r: hero.pos.r }, hexSize); spawnCombatText(hw.x, hw.z, `-${toHero}`, '#ff5555'); }
      if (killed > 0) recordPlaystyleRef.current('dominate'); }, // combat kills → Conqueror path
  });
  // Stable ref so the keydown 'F' handler always calls the current attack action.
  const attackNearbyRef = React.useRef(attackNearbyCamp);
  attackNearbyRef.current = attackNearbyCamp;

  // ── Base / Command Center & Terraforming ────────────────────────────────────
  const baseAxial = centerAxial; // command center sits at the map centre (spawn hub)
  const terraformAxial = useMemo(() => ({ q: centerAxial.q + 6, r: centerAxial.r - 4 }), [centerAxial]);
  const [terraformProgress, setTerraformProgress] = React.useState(0);
  const terraformDone = terraformProgress >= 100;
  const nearTerraformer = axialDistance(hero.pos, terraformAxial) <= 1;
  const TERRAFORM_RADIUS = 3; // tiles greened around the terraformer on completion

  // Terrain that has been terraformed: tile key → new (greener) type. Applied as a
  // render override so the barren region visibly turns fertile.
  const [terraformedTiles, setTerraformedTiles] = React.useState<Map<string, TileType>>(new Map());

  // One step "greener": barren → grassland → forest. Water/mountain are left alone.
  const greener = (type: TileType): TileType => {
    if (type === 'desert' || type === 'hills') return 'plains';
    if (type === 'plains') return 'forest';
    return type;
  };

  // Convert the region around the terraformer to fertile terrain (the visible payoff of
  // completing the terraforming mission).
  const terraformRegion = React.useCallback(() => {
    setTerraformedTiles(prev => {
      const next = new Map(prev);
      for (const t of tiles) {
        if (axialDistance({ q: t.q, r: t.r }, terraformAxial) > TERRAFORM_RADIUS) continue;
        const cur = next.get(`${t.q},${t.r}`) ?? t.type;
        const g = greener(cur);
        if (g !== cur) next.set(`${t.q},${t.r}`, g);
      }
      console.log('[terraform] Region greened around', terraformAxial);
      return next;
    });
  }, [tiles, terraformAxial]);

  // Invest one gathered resource (ore/energy/bio) into the terraformer (plain fn so it
  // always closes over the current hero position / inventory).
  const investTerraform = () => {
    if (!nearTerraformer) return;
    let consumed = false;
    setLocalHeroInventory(prev => {
      const idx = prev.findIndex(i => (i.type === 'ore' || i.type === 'energy' || i.type === 'bio') && i.quantity > 0);
      if (idx < 0) return prev;
      consumed = true;
      return prev.map((i, k) => (k === idx ? { ...i, quantity: i.quantity - 1 } : i)).filter(i => i.quantity > 0);
    });
    if (consumed) {
      setTerraformProgress(p => {
        const np = Math.min(100, p + 12);
        if (np >= 100 && p < 100) { awardHeroXp(60); awardFactionPoints(5); terraformRegion(); if (mobaActiveRef.current) mobaReportObjectiveRef.current('terraform'); console.log('[terraform] Region terraformed! +60 XP, +5 FP'); }
        return np;
      });
    }
  };

  // ── Outposts / region control ────────────────────────────────────────────────
  const {
    outposts, nearbyOutpost, captureNearby, control: outpostControl,
    territory: outpostTerritory, regions: outpostRegions, nearestOwnedOutpost,
  } = useOutposts({
    tiles,
    heroQ: hero.pos.q,
    heroR: hero.pos.r,
    centerQ: centerAxial.q,
    centerR: centerAxial.r,
    onCapture: (_region, regionCleared) => {
      awardFactionPoints(regionCleared ? 6 : 2); awardHeroXp(regionCleared ? 40 : 15);
      // Seizing contested ground draws a response from any rival units in the area.
      enemyProvokeRef.current?.(heroPosRef.current.q, heroPosRef.current.r, undefined, 7);
      const hw = axialToWorld({ q: heroPosRef.current.q, r: heroPosRef.current.r }, hexSize);
      if (regionCleared) spawnCombatText(hw.x, hw.z, '🚩 Region controlled!', '#ffd24a');
    },
  });
  // Refs so the passive income/respawn loops read live control state without re-subscribing.
  const outpostControlRef = React.useRef(outpostControl); outpostControlRef.current = outpostControl;
  const outpostTerritoryRef = React.useRef(outpostTerritory); outpostTerritoryRef.current = outpostTerritory;
  const outpostsRef2 = React.useRef(outposts); outpostsRef2.current = outposts;
  const nearestOwnedOutpostRef = React.useRef(nearestOwnedOutpost); nearestOwnedOutpostRef.current = nearestOwnedOutpost;
  // ── Refugee camps — faction-specific side missions + resource rewards ─────────
  // Grant a gathered resource straight into the hero inventory (stacks by type).
  const grantResource = React.useCallback((type: keyof typeof RESOURCE_DEFS, amount: number) => {
    const def = RESOURCE_DEFS[type];
    setLocalHeroInventory(prev => {
      const ex = prev.find(i => i.type === type);
      return ex
        ? prev.map(i => (i.type === type ? { ...i, quantity: i.quantity + amount } : i))
        : [...prev, { id: `${type}-refugee`, type, quantity: amount, effect: def.effect, value: def.hp || def.ep, icon: def.icon }];
    });
  }, [setLocalHeroInventory]);

  const { camps: refugeeCamps, nearbyCamp: nearbyRefugeeCamp, deliverToNearby: deliverRefugee, lootNearby: lootRefugee, negotiateNearby: negotiateRefugee, progress: refugeeProgress } = useRefugeeCamps({
    tiles,
    heroQ: hero.pos.q,
    heroR: hero.pos.r,
    centerQ: centerAxial.q,
    centerR: centerAxial.r,
    faction: factionName,
    onComplete: (camp, approach) => {
      // The player's CHOSEN approach (GDD: help / negotiate / loot) drives the outcome,
      // reward, reputation, and consequences — not the camp's faction.
      const cw = axialToWorld({ q: camp.q, r: camp.r }, hexSize);
      const resLbl = RESOURCE_DEFS[camp.loot.resource].label;
      if (approach === 'loot' && camp.loot.amount > 0) {
        grantResource(camp.loot.resource, camp.loot.amount);
        spawnCombatText(cw.x, cw.z, `🔥 +${camp.loot.amount} ${resLbl}`, '#fb923c');
        enemyProvokeRef.current?.(camp.q, camp.r, factionKey(camp.campFaction), 8); // raiding enrages defenders
        recordPlaystyleRef.current('loot');
        awardHeroXp(camp.reward.xp); awardFactionPoints(camp.reward.fp);
      } else if (approach === 'negotiate') {
        // Tactical diplomacy — a modest, peaceful share; NO provoked defenders; extra standing.
        const gain = Math.max(1, Math.round(camp.loot.amount * 0.5));
        grantResource(camp.loot.resource, gain);
        spawnCombatText(cw.x, cw.z, `🕊️ Peace · +${gain} ${resLbl}`, '#7dd3fc');
        recordPlaystyleRef.current('negotiate');
        awardHeroXp(Math.round(camp.reward.xp * 0.8)); awardFactionPoints(camp.reward.fp + 2);
      } else { // aid / help — heal the camp, build standing
        spawnCombatText(cw.x, cw.z, `✚ Camp aided`, '#7fd66b');
        recordPlaystyleRef.current('help');
        awardHeroXp(camp.reward.xp); awardFactionPoints(camp.reward.fp);
      }
      // Feed the competitive score: force → economy bucket, help/diplomacy → refugee bucket.
      if (mobaActiveRef.current) mobaReportObjectiveRef.current(approach === 'loot' ? 'resource' : 'refugee');
    },
  });

  // ── Faction enemies — mobile rival-faction AI units (active PvE) ──────────────
  // Guard posts are the rival factions' refugee camps ('loot' camps belong to a rival;
  // 'aid' camps are your own faction). Their defenders spawn there and, together with
  // free-roaming patrols, hunt the hero per each faction's doctrine.
  const enemyGuardPosts = useMemo<GuardPost[]>(() => {
    const posts: GuardPost[] = [];
    for (const c of refugeeCamps.values()) {
      if (c.mode === 'loot') posts.push({ key: c.key, q: c.q, r: c.r, faction: c.campFaction });
    }
    return posts;
  }, [refugeeCamps]);
  const heroHpFrac = heroVitals ? Math.max(0, Math.min(1, heroVitals.hp.current / Math.max(1, heroVitals.hp.max))) : 1;
  // GDD: a PAA player fights non-lethally — defeats read as "Pacify/Disable", not kills.
  const playerFactionKey = factionKey(factionName);
  const paaPlayer = playerFactionKey === 'PAA';

  const {
    enemies: factionEnemies, nearbyEnemy: nearbyFactionEnemy,
    attackNearby: attackNearbyEnemy, strikeNearby: strikeNearbyEnemy,
    applyEnemyEffect, provoke: provokeEnemies, threat: enemyThreat,
  } = useFactionEnemies({
    tiles,
    heroQ: hero.pos.q,
    heroR: hero.pos.r,
    centerQ: centerAxial.q,
    centerR: centerAxial.r,
    faction: factionName,
    guardPosts: enemyGuardPosts,
    heroAttack: Math.round((heroAttack + petCombatBonus) * combatAtkMult),
    heroHpFrac,
    incomingDamageScale: combatIncomingScale,
    enabled: !autoMultiplayer, // solo PvE only — duels are handled by useDuel
    paused: !!inputPaused,     // freeze combat while the skill-tree overlay is open
    onHeroDamage: (amt) => applyIncomingDamageRef.current(amt),
    awardXp: awardHeroXp,
    awardFactionPoints,
    onEvent: (ev) => {
      const w = axialToWorld({ q: ev.q, r: ev.r }, hexSize);
      if (ev.kind === 'attack') {
        const hw = axialToWorld({ q: heroPosRef.current.q, r: heroPosRef.current.r }, hexSize);
        spawnCombatText(hw.x, hw.z, `-${ev.dmg}`, '#ff5555');
      } else if (ev.kind === 'hurt') {
        spawnCombatText(w.x, w.z, `-${ev.dmg}`, '#ffd24a');
      } else if (ev.kind === 'kill') {
        // PAA disables/pacifies (non-lethal ethos); other factions defeat lethally.
        // A faction champion (boss) gets a louder callout.
        const verb = ev.boss
          ? (paaPlayer ? '🕊️ Commander Pacified' : '💀 Commander Defeated')
          : (paaPlayer ? '🕊️ Pacified' : '☠️');
        spawnCombatText(w.x, w.z, `${verb} +${ev.xp} XP`, ev.boss ? '#ffd24a' : '#8fe38f');
      }
    },
  });
  enemyProvokeRef.current = provokeEnemies;
  const attackNearbyEnemyRef = React.useRef(attackNearbyEnemy); attackNearbyEnemyRef.current = attackNearbyEnemy;
  const strikeNearbyEnemyRef = React.useRef(strikeNearbyEnemy); strikeNearbyEnemyRef.current = strikeNearbyEnemy;
  const applyEnemyEffectRef = React.useRef(applyEnemyEffect); applyEnemyEffectRef.current = applyEnemyEffect;

  // ── Hero status-effect layer (GDD skill buffs/debuffs) ──────────────────────
  // Self-targeted skill effects become timed hero buffs; the map applies their
  // aggregate (shield absorb, regen, atk/def bonus, stealth). Enemy-targeted effects
  // (burst/stun/pacify) are dispatched straight to the enemy hook.
  const heroEffectsRef = React.useRef<ActiveEffect[]>([]);
  const heroShieldRef = React.useRef(0);
  const heroAtkBonusRef = React.useRef(0);
  const heroDefBonusRef = React.useRef(0);
  const heroStealthRef = React.useRef(false);

  const refreshEffectAggregate = React.useCallback(() => {
    heroEffectsRef.current = pruneEffects(heroEffectsRef.current, performance.now());
    const agg = aggregateEffects(heroEffectsRef.current, heroShieldRef.current);
    heroAtkBonusRef.current = agg.atkBonus;
    heroDefBonusRef.current = agg.defBonus;
    heroStealthRef.current = agg.stealthed;
  }, []);

  // Incoming damage passes through defence buffs + the shield pool before reaching HP.
  const applyIncomingDamage = React.useCallback((amt: number) => {
    let dmg = Math.max(0, amt);
    if (heroDefBonusRef.current > 0) dmg = Math.max(1, dmg - heroDefBonusRef.current);
    if (heroShieldRef.current > 0 && dmg > 0) {
      const absorbed = Math.min(heroShieldRef.current, dmg);
      heroShieldRef.current -= absorbed; dmg -= absorbed;
      if (absorbed > 0) { const hw = axialToWorld({ q: heroPosRef.current.q, r: heroPosRef.current.r }, hexSize); spawnCombatText(hw.x, hw.z, `🛡️ -${Math.round(absorbed)}`, '#7aa2ff'); }
    }
    if (dmg > 0) onDamageHP?.(Math.round(dmg));
  }, [hexSize, onDamageHP]);
  const applyIncomingDamageRef = React.useRef(applyIncomingDamage); applyIncomingDamageRef.current = applyIncomingDamage;

  // Apply a self-targeted skill effect as a timed hero buff.
  const applySelfBuff = React.useCallback((eff: SkillEffect, icon: string) => {
    const now = performance.now();
    const hw = axialToWorld({ q: heroPosRef.current.q, r: heroPosRef.current.r }, hexSize);
    const push = (kind: ActiveEffect['kind'], magnitude: number, ms: number) =>
      heroEffectsRef.current.push({ kind, magnitude, expiresAt: now + ms, label: kind, icon });
    switch (eff.kind) {
      case 'shield':  heroShieldRef.current += eff.magnitude; push('shield', eff.magnitude, eff.durationMs ?? 6000); spawnCombatText(hw.x, hw.z, `${icon} +${eff.magnitude} shield`, '#7aa2ff'); break;
      case 'regen':   push('regen', eff.magnitude, eff.durationMs ?? 6000); spawnCombatText(hw.x, hw.z, `${icon} regen`, '#7fd66b'); break;
      case 'atkBuff': push('atkBuff', eff.magnitude, eff.durationMs ?? 8000); spawnCombatText(hw.x, hw.z, `${icon} +${eff.magnitude} ATK`, '#ffd24a'); break;
      case 'defBuff': push('defBuff', eff.magnitude, eff.durationMs ?? 8000); spawnCombatText(hw.x, hw.z, `${icon} +${eff.magnitude} DEF`, '#7aa2ff'); break;
      case 'haste':   onRestoreEP?.(20); push('haste', eff.magnitude, eff.durationMs ?? 6000); spawnCombatText(hw.x, hw.z, `${icon} haste`, '#8fe3ff'); break;
      case 'stealth': push('stealth', 1, eff.durationMs ?? 5000); spawnCombatText(hw.x, hw.z, `${icon} stealth`, '#c4b5fd'); break;
      default: break;
    }
    refreshEffectAggregate();
  }, [hexSize, onRestoreEP, refreshEffectAggregate]);
  const applySelfBuffRef = React.useRef(applySelfBuff); applySelfBuffRef.current = applySelfBuff;

  // Buff heartbeat: prune expired buffs, tick regen, and clear a spent shield pool.
  React.useEffect(() => {
    const id = window.setInterval(() => {
      refreshEffectAggregate();
      const agg = aggregateEffects(heroEffectsRef.current, heroShieldRef.current);
      if (agg.regenPerSec > 0) onHealHP?.(Math.max(1, Math.round(agg.regenPerSec * 0.5)));
      if (heroShieldRef.current <= 0) heroEffectsRef.current = heroEffectsRef.current.filter(e => e.kind !== 'shield');
    }, 500);
    return () => window.clearInterval(id);
  }, [refreshEffectAggregate, onHealHP]);

  // Interact with the nearby refugee camp (H): loot rivals in one action; for your own
  // faction's camp, deliver as much of the required resource as you're carrying.
  const localHeroInventoryRef = React.useRef(localHeroInventory); localHeroInventoryRef.current = localHeroInventory;
  const nearbyRefugeeCampRef = React.useRef(nearbyRefugeeCamp); nearbyRefugeeCampRef.current = nearbyRefugeeCamp;
  // Resolve the adjacent refugee camp with the player's CHOSEN approach (GDD strategy layer):
  //   help     — deliver aid to your own faction's camp (build standing).
  //   negotiate— tactical diplomacy at a rival camp (peaceful, modest reward, no reprisal).
  //   loot     — seize a rival camp by force (rich reward, enrages its defenders).
  const resolveRefugee = React.useCallback((approach: 'help' | 'negotiate' | 'loot') => {
    const camp = nearbyRefugeeCampRef.current;
    if (!camp) return;
    const hw = axialToWorld({ q: hero.pos.q, r: hero.pos.r }, hexSize);
    if (camp.mode === 'loot') {
      if (approach === 'loot') lootRefugee();
      else negotiateRefugee();                 // any non-force choice → peaceful resolution
      return;
    }
    // Own-faction camp → HELP by delivering the required resource.
    const resType = camp.required.resource;
    const held = localHeroInventoryRef.current.filter(i => i.type === resType).reduce((s, i) => s + (i.quantity || 0), 0);
    const need = Math.max(0, camp.required.amount - camp.delivered);
    const give = Math.min(held, need);
    if (give <= 0) { spawnCombatText(hw.x, hw.z, `Need ${need} ${RESOURCE_DEFS[resType].label}`, '#ff8888'); return; }
    setLocalHeroInventory(prev => {
      let remaining = give;
      return prev.map(i => {
        if (i.type !== resType || remaining <= 0) return i;
        const take = Math.min(i.quantity, remaining); remaining -= take;
        return { ...i, quantity: i.quantity - take };
      }).filter(i => i.quantity > 0);
    });
    const res = deliverRefugee(give);
    if (res && !res.completed) spawnCombatText(hw.x, hw.z, `Delivered ${give} ${RESOURCE_DEFS[resType].label}`, '#7fd66b');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverRefugee, lootRefugee, negotiateRefugee, hexSize, setLocalHeroInventory]);
  const resolveRefugeeRef = React.useRef(resolveRefugee); resolveRefugeeRef.current = resolveRefugee;
  // H key = the peaceful default (help your camp / negotiate a rival's); force is a click-choice.
  const handleRefugeeInteract = React.useCallback(() => {
    resolveRefugeeRef.current(nearbyRefugeeCampRef.current?.mode === 'loot' ? 'negotiate' : 'help');
  }, []);

  // Refs so the keydown handler always calls the current actions.
  const investTerraformRef = React.useRef(investTerraform); investTerraformRef.current = investTerraform;
  const captureNearbyRef = React.useRef(captureNearby); captureNearbyRef.current = captureNearby;
  const nearbyOutpostRef = React.useRef(nearbyOutpost); nearbyOutpostRef.current = nearbyOutpost;
  const assistRefugeeRef = React.useRef(handleRefugeeInteract); assistRefugeeRef.current = handleRefugeeInteract;

  // Toggle for the outpost control-zone perimeter overlay (HUD "Zones" button / 'Y').
  const [showOutpostZones, setShowOutpostZones] = useState(false);

  // Tiles kept free of terrain decorations: every camp/outpost/refugee/terraformer tile
  // PLUS its 1-tile ring, so these interactable sites always have clear sightlines.
  const decoBlockedKeys = React.useMemo(() => {
    const set = new Set<string>();
    const block = (q: number, r: number) => {
      set.add(`${q},${r}`);
      for (const n of axialNeighbors({ q, r })) set.add(`${n.q},${n.r}`);
    };
    for (const c of creepCamps.values()) if (!c.cleared) block(c.q, c.r);
    for (const o of outposts.values()) block(o.q, o.r);
    for (const c of refugeeCamps.values()) block(c.q, c.r);
    block(terraformAxial.q, terraformAxial.r);
    return set;
  }, [creepCamps, outposts, refugeeCamps, terraformAxial]);

  // Tiles that sit on a territory border (a neighbour belongs to a different outpost) —
  // drawn brighter in the zone overlay so the perimeters read across the whole map.
  const zoneBoundary = React.useMemo(() => {
    const b = new Set<string>();
    for (const [key, outKey] of outpostTerritory) {
      const [q, r] = key.split(',').map(Number);
      for (const n of axialNeighbors({ q, r })) {
        const no = outpostTerritory.get(`${n.q},${n.r}`);
        if (no && no !== outKey) { b.add(key); break; }
      }
    }
    return b;
  }, [outpostTerritory]);

  // ── 1v1 PvP duel (WebRTC data channel, Firestore-signaled) ───────────────────
  const [duelLobbyOpen, setDuelLobbyOpen] = useState(false);
  const [duelJoinCode, setDuelJoinCode] = useState('');
  const [duelDeathReported, setDuelDeathReported] = useState(false);
  const [duelWaiting, setDuelWaiting] = useState(0); // players in the matchmaking queue
  const [codeCopied, setCodeCopied] = useState(false);
  const copyDuelCode = React.useCallback((c: string | null) => {
    if (!c) return;
    try { navigator.clipboard?.writeText(c); } catch {}
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
  }, []);
  const pasteDuelCode = React.useCallback(async () => {
    try { const t = await navigator.clipboard?.readText(); if (t) setDuelJoinCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)); } catch {}
  }, []);
  const duel = useDuel({
    onHit: (dmg, at) => {
      // Receiver-side range check vs MY hero (the hook already checked the attacker's
      // claim against their broadcast). Reject hits from out of melee range.
      const myPos = heroPosRef.current;
      if (at && axialDistance(myPos, at) > 2) { console.warn('[duel] rejected out-of-range hit', at); return; }
      onDamageHP?.(dmg);
      const hw = axialToWorld({ q: myPos.q, r: myPos.r }, hexSize);
      spawnCombatText(hw.x, hw.z, `-${dmg}`, '#ff5555');
    },
    onCast: (icon, at) => {
      if (at) { const w = axialToWorld(at, hexSize); spawnCombatText(w.x, w.z, icon, '#c9b3ff'); }
    },
    onRemoteDead: (at) => {
      if (at) { const w = axialToWorld(at, hexSize); spawnCombatText(w.x, w.z, '☠️', '#ff5555'); }
    },
  });
  const {
    active: duelActive, remote: duelRemote, remoteBufRef: duelRemoteBufRef,
    setLocalSnapshot: duelSetSnapshot, reportLocalDeath: duelReportDeath,
    attackRemote: duelAttackRemote, castAbility: duelCastAbility,
  } = duel;

  // ── 1v1v1 MOBA (host-authoritative, Firestore-signaled WebRTC) ───────────────
  const [mobaLobbyOpen, setMobaLobbyOpen] = useState(false);
  const [mobaJoinCode, setMobaJoinCode] = useState('');
  const [mobaFactionPick, setMobaFactionPick] = useState<Faction>('PAA');
  const [mobaDeathReported, setMobaDeathReported] = useState(false);
  const [mobaCodeCopied, setMobaCodeCopied] = useState(false);
  const copyMobaCode = React.useCallback((c: string | null) => {
    if (!c) return;
    try { navigator.clipboard?.writeText(c); } catch {}
    setMobaCodeCopied(true); setTimeout(() => setMobaCodeCopied(false), 1500);
  }, []);
  const moba = useMobaMatch({
    onHit: (dmg, at) => {
      const myPos = heroPosRef.current;
      if (at && axialDistance(myPos, at) > 2) { return; }
      onDamageHP?.(dmg);
      const hw = axialToWorld({ q: myPos.q, r: myPos.r }, hexSize);
      spawnCombatText(hw.x, hw.z, `-${dmg}`, '#ff5555');
    },
    onCast: (icon, at) => { if (at) { const w = axialToWorld(at, hexSize); spawnCombatText(w.x, w.z, icon, '#c9b3ff'); } },
    onRemoteDead: (at) => { if (at) { const w = axialToWorld(at, hexSize); spawnCombatText(w.x, w.z, '☠️', '#ff5555'); } },
  });
  const mobaActive = moba.status === 'active';
  const mobaActiveRef = React.useRef(mobaActive); mobaActiveRef.current = mobaActive;
  const mobaSetSnapshotRef = React.useRef(moba.setLocalSnapshot); mobaSetSnapshotRef.current = moba.setLocalSnapshot;
  const mobaRequestCaptureRef = React.useRef(moba.requestCapture); mobaRequestCaptureRef.current = moba.requestCapture;
  const mobaReportObjectiveRef = React.useRef(moba.reportObjective); mobaReportObjectiveRef.current = moba.reportObjective;

  // ── Strategy playstyles (GDD): the player's emergent approach across interactions ──────
  // Every dynamic decision (help / negotiate / scavenge / loot / dominate) accretes into a
  // reputation that names the player's path (Healer / Diplomat / Scavenger / Raider / Conqueror).
  const [reputation, setReputation] = useState<PlaystyleReputation>(emptyReputation);
  const recordPlaystyle = React.useCallback((p: Playstyle) => {
    setReputation(prev => ({ ...prev, [p]: prev[p] + 1 }));
  }, []);
  const recordPlaystyleRef = React.useRef(recordPlaystyle); recordPlaystyleRef.current = recordPlaystyle;
  const dominantStyle = React.useMemo(() => dominantPlaystyle(reputation), [reputation]);
  // Gathering a world resource node is the "scavenge" approach.
  const handleCollectWithStyle = React.useCallback(
    (flowerKey: string | null, mushroomKey: string | null, resource?: { key: string; type: 'ore' | 'energy' | 'bio' } | null) => {
      if (resource) recordPlaystyle('scavenge');
      handleCollect(flowerKey, mushroomKey, resource);
    }, [handleCollect, recordPlaystyle]);
  // Factions already claimed by OTHER players (for lobby dedupe).
  const mobaTakenFactions = React.useMemo(() => {
    const s = new Set<Faction>();
    for (const p of moba.players) if (p.uid !== moba.myUid) s.add(p.faction);
    return s;
  }, [moba.players, moba.myUid]);
  // Fast lookup of authoritative outpost ownership by "q,r" key. Sourced from the host's
  // world snapshots (works on host AND guest — both derive the same map geometry locally).
  const mobaOutpostOwner = React.useMemo(() => {
    const m = new Map<string, Faction | 'neutral'>();
    for (const [k, owner] of Object.entries(moba.outpostOwners)) m.set(k, owner as Faction | 'neutral');
    return m;
  }, [moba.outpostOwners]);

  // 4X campaign score — a running point total for solo play, using the SAME weights as the
  // competitive MOBA so both ladders read consistently (eXpand: outposts/regions;
  // eXploit: terraform/refugee camps; eXterminate: tracked via kills where available).
  const fourXScore = React.useMemo(() => {
    const s = MOBA_SCORING;
    return outpostControl.owned * s.captureBonus
      + outpostControl.regionsControlled * s.regionControlBonus
      + (terraformDone ? s.terraformScore : 0)
      + refugeeProgress.done * s.refugeeCampScore;
  }, [outpostControl.owned, outpostControl.regionsControlled, terraformDone, refugeeProgress.done]);

  // Auto-open the MOBA lobby when launched from the MOBA mode.
  const mobaAutoRef = React.useRef(false);
  React.useEffect(() => {
    if (mobaMode && !mobaAutoRef.current) { mobaAutoRef.current = true; setMobaLobbyOpen(true); }
  }, [mobaMode]);

  // Live count of players waiting for a quick-match — only while the lobby is open and
  // we're not already in a session.
  React.useEffect(() => {
    if (!duelLobbyOpen || duelActive) return;
    const unsub = watchOpenRooms(setDuelWaiting);
    return () => unsub();
  }, [duelLobbyOpen, duelActive]);

  // Launched from the dashboard "Multiplayer" mode → open the lobby and start a
  // quick-match automatically (once).
  const duelAutoStartedRef = React.useRef(false);
  React.useEffect(() => {
    if (autoMultiplayer && !duelAutoStartedRef.current) {
      duelAutoStartedRef.current = true;
      setDuelLobbyOpen(true);
      duel.findMatch();
    }
  }, [autoMultiplayer, duel]);

  // Push our latest snapshot into the duel hook (it broadcasts at a fixed 15 Hz tick).
  // The actual push effect is declared further down, once the hero render fields are in
  // scope; this ref keeps the pusher current.
  const duelSetSnapshotRef = React.useRef(duelSetSnapshot); duelSetSnapshotRef.current = duelSetSnapshot;

  // Announce our own death once (defender-authoritative → opponent wins).
  React.useEffect(() => {
    const hp = heroVitals?.hp.current ?? 1;
    if (duelActive && !duelDeathReported && hp <= 0) { duelReportDeath(); setDuelDeathReported(true); }
    else if (hp > 0 && duelDeathReported) setDuelDeathReported(false);
  }, [duelActive, duelDeathReported, heroVitals?.hp.current, duelReportDeath]);

  // Attack the opposing player if they're adjacent (invoked from the F key). Sends our
  // position so the defender can range-validate the hit.
  const duelFightRef = React.useRef<() => void>(() => {});
  duelFightRef.current = () => {
    if (!duelActive) return;
    const rpos = duelRemoteBufRef.current?.pos ?? duelRemote?.pos;
    if (!rpos || axialDistance(hero.pos, rpos) > 1) return;
    const dmg = Math.max(1, Math.round((heroAttack + petCombatBonus) * combatAtkMult));
    duelAttackRemote(dmg, hero.pos);
    const rw = axialToWorld(rpos, hexSize);
    spawnCombatText(rw.x, rw.z, `-${dmg}`, '#ffd24a');
  };

  // MOBA melee: strike the nearest ADJACENT rival hero (a different faction). Routes the
  // hit through the host, who relays it to the victim (their HP is defender-authoritative).
  const mobaFightRef = React.useRef<() => void>(() => {});
  mobaFightRef.current = () => {
    if (!mobaActive) return;
    let bestUid: string | null = null; let bestPos: { q: number; r: number } | null = null; let bestD = Infinity;
    for (const [uid, h] of moba.remotesBufRef.current) {
      if (h.faction === moba.myFaction) continue; // don't hit same-faction allies
      const d = axialDistance(hero.pos, h.pos);
      if (d <= 1 && d < bestD) { bestD = d; bestUid = uid; bestPos = h.pos; }
    }
    if (!bestUid || !bestPos) return;
    const dmg = Math.max(1, Math.round((heroAttack + petCombatBonus) * combatAtkMult));
    moba.attack(bestUid, dmg, hero.pos);
    const rw = axialToWorld(bestPos, hexSize);
    spawnCombatText(rw.x, rw.z, `-${dmg}`, '#ffd24a');
  };

  // Pet fetch (GDD): the companion periodically carries a supply from base to the field.
  React.useEffect(() => {
    const iv = setInterval(() => {
      setLocalHeroInventory(prev => {
        const ex = prev.find(i => i.type === 'flower');
        return ex
          ? prev.map(i => (i.type === 'flower' ? { ...i, quantity: i.quantity + 1 } : i))
          : [...prev, { id: 'flower-fetch', type: 'flower', quantity: 1, effect: 'heal', value: 20, icon: '🌸' }];
      });
      console.log(`[pet] ${isDog ? 'Dog' : 'Cat'} fetched a healing flower from base`);
    }, 30000);
    return () => clearInterval(iv);
  }, [setLocalHeroInventory, isDog]);

  // Pet-pack supplies are used via the number-key hotbar (1–8), which merges the
  // hero and pet inventories so each carried item gets its own key (see
  // useCollectibles → itemSlots / handleItemUse).

  // Ability slots (QWER) — still managed locally as they are tightly coupled
  // to the in-map keydown handler; skill-tree abilities come in via externalAbilities prop.
  // Abilities come ONLY from the skill tree (offensive loadout). Empty until the
  // player assigns skills to ability slots — no hardcoded defaults.
  const [abilitySlots, setAbilitySlots] = useState<Ability[]>(externalAbilities ? [...externalAbilities] : []);
  // Defensive ability set (Defense mode) — also ONLY from the skill tree's defensive loadout.
  const [defenseSlots, setDefenseSlots] = useState<Ability[]>(externalDefense ? [...externalDefense] : []);
  // (abilityMode is declared above so the creep-combat math can use it.)

  // Active set derived from mode; refs so the keydown closure reads current values.
  const activeSlots = abilityMode === 'defense' ? defenseSlots : abilitySlots;
  const setActiveSlots = abilityMode === 'defense' ? setDefenseSlots : setAbilitySlots;
  const abilitySlotsRef = React.useRef(activeSlots);
  abilitySlotsRef.current = activeSlots;
  const setActiveSlotsRef = React.useRef(setActiveSlots);
  setActiveSlotsRef.current = setActiveSlots;

  // Energy cost per ability cast — abilities are gated on EP (no passive EP regen;
  // refuel with energy/ore items).
  const ABILITY_EP_COST = 12;
  const strikeNearbyRef = React.useRef(strikeNearbyCamp); strikeNearbyRef.current = strikeNearbyCamp;

  // Activate an ability by id (shared by QWER keys and HUD clicks). Costs energy, then
  // applies an effect: OFFENSE mode damages the nearest enemy (rival duelist or creep
  // camp); DEFENSE mode heals/shields. Starts the cooldown on success.
  const activateAbility = React.useCallback((id: string) => {
    const ability = abilitySlotsRef.current.find(a => a.id === id);
    if (!ability || (ability.cooldown ?? 0) !== 0) return;

    const hw = axialToWorld({ q: hero.pos.q, r: hero.pos.r }, hexSize);
    // ── Energy gate ──
    const curEp = heroVitals?.ep?.current ?? 0;
    if (curEp < ABILITY_EP_COST) { spawnCombatText(hw.x, hw.z, '⚡ No energy', '#7aa2ff'); return; }
    onDrainEP?.(ABILITY_EP_COST);

    const icon = ability.icon ?? '✨';
    // Drive the cast from the skill's GDD effect (store/skillData). Passives with no
    // effect fall back to a mode-based strike/heal.
    const eff = skillEffectFor(id);

    if (eff?.target === 'enemy' && eff.kind === 'burst') {
      // Damage burst — hits a rival duelist in range first, else an enemy / creep camp.
      const power = Math.round((heroAttack + petCombatBonus) * (combatAtkMult + 0.3)) + eff.magnitude + heroAtkBonusRef.current;
      if (duelActive && duelRemote && axialDistance(hero.pos, duelRemote.pos) <= 2) {
        duelCastAbility(icon, hero.pos);
        duelAttackRemote(power, hero.pos);
        const rw = axialToWorld(duelRemote.pos, hexSize);
        spawnCombatText(rw.x, rw.z, `${icon} -${power}`, '#ffd24a');
      } else if (strikeNearbyEnemyRef.current(power).hit || strikeNearbyRef.current(power).hit) {
        spawnCombatText(hw.x, hw.z, `${icon} -${power}`, '#ffd24a');
      } else {
        spawnCombatText(hw.x, hw.z, `${icon} (no target)`, '#9aa4b2');
      }
    } else if (eff?.target === 'enemy') {
      // Control debuff — stun / pacify / slow the nearest enemy, plus light damage.
      const dmg = Math.round((heroAttack + petCombatBonus) * combatAtkMult * 0.4) + heroAtkBonusRef.current;
      const hit = strikeNearbyEnemyRef.current(dmg).hit;
      const controlled = applyEnemyEffectRef.current(eff.kind as 'stun' | 'pacify' | 'slow', eff.magnitude, 2);
      spawnCombatText(hw.x, hw.z, (hit || controlled) ? `${icon} ${eff.kind}` : `${icon} (no target)`, (hit || controlled) ? '#c4b5fd' : '#9aa4b2');
    } else if (eff) {
      // Self buff (shield / regen / haste / atk-def / stealth).
      applySelfBuffRef.current(eff, icon);
      if (eff.kind === 'stealth') applyEnemyEffectRef.current('pacify', eff.durationMs ?? 5000, 3); // vanish → nearby enemies lose you
    } else if (abilityMode === 'offense') {
      const power = Math.round((heroAttack + petCombatBonus) * (combatAtkMult + 0.6)) + 12 + heroAtkBonusRef.current;
      spawnCombatText(hw.x, hw.z, (strikeNearbyEnemyRef.current(power).hit || strikeNearbyRef.current(power).hit) ? `${icon} -${power}` : `${icon} (no target)`, '#ffd24a');
    } else {
      onHealHP?.(28); spawnCombatText(hw.x, hw.z, `${icon} +28 HP`, '#7fd66b');
    }

    // Start cooldown on a successful cast.
    setActiveSlotsRef.current(prev => prev.map(a => a.id === id ? { ...a, cooldown: a.maxCooldown } : a));
  }, [heroVitals, hero.pos, hexSize, abilityMode, heroAttack, petCombatBonus, combatAtkMult, duelActive, duelRemote, duelAttackRemote, duelCastAbility, onDrainEP, onHealHP]);
  // Keep a fresh ref so the keydown QWER closure always calls the latest activation.
  const activateAbilityRef = React.useRef(activateAbility); activateAbilityRef.current = activateAbility;

  // Always mirror the skill-tree loadout (including empty), so abilities appear only
  // after they're selected in the skill tree and update the moment the loadout changes.
  React.useEffect(() => { setAbilitySlots(externalAbilities ? [...externalAbilities] : []); }, [externalAbilities]);
  React.useEffect(() => { setDefenseSlots(externalDefense ? [...externalDefense] : []); }, [externalDefense]);

  // ── Inventory transfer between hero and pet ─────────────────────────────────
  const transferItem = React.useCallback((type: string, dir: 'toPet' | 'toHero') => {
    const src = dir === 'toPet' ? localHeroInventory : localPetInventory;
    const item = src.find(i => i.type === type && i.quantity > 0);
    if (!item) return;
    const dec = (prev: typeof src) => prev.map(i => i.type === type ? { ...i, quantity: i.quantity - 1 } : i).filter(i => i.quantity > 0);
    const inc = (prev: typeof src) => {
      const ex = prev.find(i => i.type === type);
      return ex ? prev.map(i => i.type === type ? { ...i, quantity: i.quantity + 1 } : i)
                : [...prev, { id: `${type}-${Date.now()}`, type, quantity: 1, effect: item.effect, value: item.value, icon: (item as any).icon }];
    };
    if (dir === 'toPet') { setLocalHeroInventory(dec); setLocalPetInventory(inc); }
    else { setLocalPetInventory(dec); setLocalHeroInventory(inc); }
  }, [localHeroInventory, localPetInventory, setLocalHeroInventory, setLocalPetInventory]);

  // Persist both inventories (debounced) so transfers/pickups survive reloads.
  React.useEffect(() => {
    const h = setTimeout(() => {
      saveProgress({ heroInventory: localHeroInventory as any, petInventory: localPetInventory as any });
    }, 800);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localHeroInventory, localPetInventory]);

  // Ability cooldown countdown (1 second intervals)
  React.useEffect(() => {
    const tick = (prev: Ability[]) => {
      if (!prev.some(a => (a.cooldown ?? 0) > 0)) return prev; // preserve ref when nothing to tick
      return prev.map(ability =>
        (ability.cooldown ?? 0) > 0 ? { ...ability, cooldown: Math.max(0, (ability.cooldown ?? 0) - 1) } : ability
      );
    };
    const interval = setInterval(() => {
      setAbilitySlots(tick);   // offensive cooldowns
      setDefenseSlots(tick);   // defensive cooldowns
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const tilesMoveRef = React.useRef(0); // Track tiles moved for pet XP reward
  // When profile loads, adopt stored hero position if present
  useEffect(() => {
    if (profile && profile.progress?.heroPosition) {
      setHero(h => ({ ...h, pos: profile.progress.heroPosition }));
      console.log('[hero] restored position from profile', profile.progress.heroPosition);
      // trigger camera recenter once after load
      setRecenterSignal(s => s + 1);
    }
  }, [profile]);

  // After tiles load, move hero to the real spawn position (center of map) if no
  // saved profile position exists. This is needed because useState initializes
  // with spawnPos={q:0,r:0} before tiles are available from the worker.
  const heroMovedToSpawn = React.useRef(false);
  useEffect(() => {
    if (tiles.length === 0 || heroMovedToSpawn.current) return;
    if (profile && profile.progress?.heroPosition) return; // profile will handle it
    heroMovedToSpawn.current = true;
    setHero(h => ({ ...h, pos: spawnPos }));
    // Pet must also teleport to spawn — without this, pet stays at its useState
    // initial position ({q:4, r:-1} near the map origin) while the hero and camera
    // move to the real map center, leaving the pet hundreds of units off-screen.
    setPet(p => ({ ...p, pos: spawnPos }));
    setRecenterSignal(s => s + 1);
    console.log('[hero] moved to map spawn', spawnPos);
  }, [tiles, spawnPos, profile]);

  // FOV always on now; removed toggle state

  // Hero will be moved via keyboard commands now (auto path removed)

  // Dynamic pet patrol state (declared early; logic after tilesByKey exists)
  const [petTarget, setPetTarget] = useState<Axial | null>(null);

  // Leash enforcement (rare): if external changes push pet outside leash, pull it inward one step
  useEffect(() => {
    setPet(p => {
      const leash = Math.max(0, hero.vision - 1);
      if (axialDistance(p.pos, hero.pos) <= leash) return p;
      let best = p.pos; let bestDist = axialDistance(p.pos, hero.pos);
      for (const n of axialNeighbors(p.pos)) {
        const d = axialDistance(n, hero.pos);
        if (d < bestDist) { bestDist = d; best = n; }
      }
      if (best.q === p.pos.q && best.r === p.pos.r) return p;
      return { ...p, pos: best };
    });
  }, [hero.pos, hero.vision]);

  // (Patrol logic moved below tilesByKey for declaration order)

  const heroVisible = useMemo(() => computeVisibleSet(tiles, hero.pos, hero.vision + petVisionBonus), [tiles, hero.pos.q, hero.pos.r, hero.vision, petVisionBonus]);

  // Primary render radius — covers active viewport around the hero.
  // Kept at 22 (≈1520 tiles) which is well under the ~43k that caused the fiber stack overflow.
  const RENDER_RADIUS = 22;
  const culledTiles = useMemo(() => {
    return tiles.filter(t => axialDistance(t, hero.pos) <= RENDER_RADIUS);
  }, [tiles, hero.pos.q, hero.pos.r]);

  // Memory / tile count instrumentation (periodic)
  useEffect(() => {
    let lastLog = 0;
    let raf: number;
    const loop = () => {
      const now = performance.now();
      if (now - lastLog > 5000) { // every 5s
        lastLog = now;
        const mem: any = (performance as any).memory;
        const usedMB = mem ? (mem.usedJSHeapSize / 1024 / 1024).toFixed(1) : 'n/a';
        console.log('[map] tiles(total,rendered)', tiles.length, culledTiles.length, 'heapMB', usedMB);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tiles.length, culledTiles.length]);
  // Explore accumulation (union of all heroVisible over time)
  const exploredRef = React.useRef<Set<string>>(new Set());
  const [exploredCount, setExploredCount] = useState(0);
  const explorationGoal = 100; // exploration objective: discover 100 tiles
  const [explorationComplete, setExplorationComplete] = useState(false);
  // Seed from profile once when profile loads
  useEffect(() => {
    if (profile?.progress?.explored && exploredRef.current.size === 0) {
      for (const k of profile.progress.explored) exploredRef.current.add(k);
    }
  }, [profile]);
  // petVisible computed before explored accumulation so it can be unioned into exploredRef
  const petVisible = useMemo(() => computeVisibleSet(tiles, pet.pos, pet.vision), [tiles, pet.pos.q, pet.pos.r, pet.vision]);
  // Merged visible set for minimap (hero + pet FoV)
  const minimapVisibleKeys = useMemo(
    () => new Set([...heroVisible, ...petVisible]),
    [heroVisible, petVisible],
  );
  
  // Territory ownership for the minimap: tiles claimed by a player-owned outpost, plus a
  // compact outpost list. Recomputed only when outposts/territory change (not each move).
  const ownedTileKeys = useMemo(() => {
    const s = new Set<string>();
    for (const [tileKey, outKey] of outpostTerritory) if (outposts.get(outKey)?.owner === 'player') s.add(tileKey);
    return s;
  }, [outpostTerritory, outposts]);
  const minimapOutposts = useMemo(
    () => Array.from(outposts.values()).map(o => ({ q: o.q, r: o.r, owned: o.owner === 'player' })),
    [outposts],
  );
  // A single scalar that changes whenever ownership/control changes → triggers redraw.
  const controlRevision = outpostControl.owned * 100 + outpostControl.regionsControlled;

  // Push minimap data to parent whenever explored / visibility / positions / control change
  useEffect(() => {
    if (!onMapUpdate) return;
    onMapUpdate({
      exploredKeys: exploredRef.current,
      exploredRevision: exploredCount,
      visibleKeys: minimapVisibleKeys,
      tileTypes: tileTypesMap,
      heroPos: hero.pos,
      petPos: pet.pos,
      hexSize,
      mapBounds,
      ownedTileKeys,
      outposts: minimapOutposts,
      ownerColor: heroColors.primary,
      controlRevision,
      control: { regionsControlled: outpostControl.regionsControlled, regionCount: outpostControl.regionCount },
    });
  // mapBounds and tileTypesMap are stable after initial tile generation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploredCount, minimapVisibleKeys, hero.pos.q, hero.pos.r, pet.pos.q, pet.pos.r, onMapUpdate, controlRevision, ownedTileKeys, minimapOutposts]);
  useEffect(() => {
    let changed = false;
    const mark = (tileKey: string) => {
      if (!exploredRef.current.has(tileKey)) { exploredRef.current.add(tileKey); changed = true; }
    };
    // Hero + pet vision both contribute to the explored/discovered area
    heroVisible.forEach(mark);
    petVisible.forEach(mark);
    if (!changed) return; // nothing new this visibility frame
    setExploredCount(exploredRef.current.size);
    if(!explorationComplete && exploredRef.current.size >= explorationGoal){
      setExplorationComplete(true);
      console.log('[objective] exploration complete');
    }
    const to = setTimeout(() => {
      saveProgress({ explored: Array.from(exploredRef.current) });
    }, 800);
    return () => clearTimeout(to);
  }, [heroVisible, petVisible, saveProgress]);

  // Explored tiles outside RENDER_RADIUS — rendered as cheap "memory" layer so explored
  // tiles don't disappear as the hero walks away. Capped at MEMORY_RADIUS to bound count.
  const MEMORY_RADIUS = 55;
  const exploredMemoryTiles = useMemo(() => {
    return tiles.filter(t => {
      const d = axialDistance(t, hero.pos);
      return d > RENDER_RADIUS && d <= MEMORY_RADIUS && exploredRef.current.has(`${t.q},${t.r}`);
    });
  // exploredCount as proxy to re-run when explored set changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, hero.pos.q, hero.pos.r, exploredCount]);

  // World position of hero (for camera recentering)
  const heroWorld = useMemo(() => axialToWorld(hero.pos, hexSize), [hero.pos.q, hero.pos.r, hexSize]);

  // Movement tracking for IsometricCharacter walk animation
  const prevHeroWorldRef = React.useRef<{ x: number; z: number } | null>(null);
  const [heroFacingAngle, setHeroFacingAngle] = React.useState(0);
  const [isHeroMoving, setIsHeroMoving] = React.useState(false);
  const heroMovingTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pet facing angle tracking
  const prevPetWorldRef = React.useRef<{ x: number; z: number } | null>(null);
  const [petFacingAngle, setPetFacingAngle] = React.useState(0);
  const [isPetMoving, setIsPetMoving] = React.useState(false);
  const petMovingTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const prev = prevHeroWorldRef.current;
    if (prev) {
      const dx = heroWorld.x - prev.x;
      const dz = heroWorld.z - prev.z;
      if (Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01) {
        setHeroFacingAngle(Math.atan2(dx, dz));
        setIsHeroMoving(true);
        if (heroMovingTimerRef.current) clearTimeout(heroMovingTimerRef.current);
        heroMovingTimerRef.current = setTimeout(() => setIsHeroMoving(false), 200);
      }
    }
    prevHeroWorldRef.current = { x: heroWorld.x, z: heroWorld.z };
  }, [heroWorld]);

  React.useEffect(() => {
    const pw = axialToWorld(pet.pos, hexSize);
    const prev = prevPetWorldRef.current;
    if (prev) {
      const dx = pw.x - prev.x;
      const dz = pw.z - prev.z;
      if (Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01) {
        setPetFacingAngle(Math.atan2(dx, dz));
        setIsPetMoving(true);
        if (petMovingTimerRef.current) clearTimeout(petMovingTimerRef.current);
        petMovingTimerRef.current = setTimeout(() => setIsPetMoving(false), 250);
      }
    }
    prevPetWorldRef.current = { x: pw.x, z: pw.z };
  }, [pet.pos.q, pet.pos.r, hexSize]);

  // Log actor positions for debugging
  useEffect(() => {
    const petWorld = axialToWorld(pet.pos, hexSize);
    const petVisualHeight = 0.4 + hexSize * 0.45;
    const heroVisualHeight = 0.4 + hexSize * 0.45; // Outer group + GameAvatar container offset
    console.log('[SoloMissionMap3D] Actor Heights - SHOULD MATCH:', {
      hero: { group: '0.4', container: `hexSize*0.45=${(hexSize * 0.45).toFixed(3)}`, total: heroVisualHeight.toFixed(3) },
      pet: { group: '0.4', sphere: `hexSize*0.45=${(hexSize * 0.45).toFixed(3)}`, total: petVisualHeight.toFixed(3) }
    });
    if (Math.abs(heroVisualHeight - petVisualHeight) > 0.01) {
      console.error(`❌ HEIGHT MISMATCH: Hero ${heroVisualHeight.toFixed(2)} vs Pet ${petVisualHeight.toFixed(2)}`);
    } else {
      console.log(`✅ Heights match perfectly: both at Y = ${heroVisualHeight.toFixed(3)}`);
    }
  }, [hero.pos.q, hero.pos.r, pet.pos.q, pet.pos.r, heroWorld, hexSize]);

  // ─── Avatar data ────────────────────────────────────────────────────────────
  // Faction-specific default colours — used when threeConfig has no explicit overrides.
  // Each faction has a distinct palette + skin tone matching its world lore.
  const FACTION_DEFAULTS: Record<string, AvatarColors> = useMemo(() => ({
    PAA: { primary: '#00A37A', secondary: '#D4AF37', skin: '#8B5A2B' }, // Afrofuture green + gold
    ASF: { primary: '#C75B1E', secondary: '#4A4A5A', skin: '#5C3317' }, // Military amber + dark
    WC:  { primary: '#1E40AF', secondary: '#9CA3AF', skin: '#D4A87A' }, // Corporate blue + light
  }), []);

  // Priority: localStorage activeLoadout → Firestore profile.progress.avatar → faction defaults.
  // Always returns all four fields (parts, colors, archetype, modelUrl) with safe values.
  const avatarData = useMemo(() => {
    // Prefer the live prop from App (stays in sync when loadout changes in configurator)
    const src = heroAvatar ?? (() => {
      try {
        const raw = localStorage.getItem('afrofuture.activeLoadout');
        if (raw) return JSON.parse(raw) as CharacterLoadout;
      } catch (err) {
        console.warn('[avatar:load] localStorage parse failed:', err);
      }
      return null;
    })();

    if (src) {
      const faction: string = src.faction || 'PAA';
      const archetype: Archetype = src.archetype === 'MALE' ? 'MALE' : 'FEMALE';
      const fd: AvatarColors = FACTION_DEFAULTS[faction] ?? FACTION_DEFAULTS.PAA;
      const tc = src.threeConfig;
      const colors: AvatarColors = {
        primary:   tc?.colors?.primary   || fd.primary,
        secondary: tc?.colors?.secondary || fd.secondary,
        skin:      (tc?.colors as any)?.skin || fd.skin,
      };
      const parts = (tc?.parts || {}) as Record<string, string | undefined>;
      // Explicit per-loadout GLB wins; otherwise fall back to the faction/gender hero model.
      const modelUrl = ((tc as any)?.modelUrl as string | undefined) ?? resolveHeroModel(faction, archetype);
      return { parts, colors, archetype, faction, modelUrl };
    }

    // Firestore / default fallback — use profile faction if available
    const fpFaction: string = (profile as any)?.progress?.faction || 'PAA';
    const fd: AvatarColors = FACTION_DEFAULTS[fpFaction] ?? FACTION_DEFAULTS.PAA;
    const fpAvatar = (profile as any)?.progress?.avatar;
    return {
      parts: (fpAvatar?.parts || {}) as Record<string, string | undefined>,
      modelUrl: resolveHeroModel(fpFaction, 'FEMALE') as string | undefined,
      colors: {
        primary:   fpAvatar?.colors?.primary   || fd.primary,
        secondary: fpAvatar?.colors?.secondary || fd.secondary,
        skin:      fpAvatar?.colors?.skin      || fd.skin,
      } as AvatarColors,
      archetype: 'FEMALE' as Archetype,
      faction: fpFaction,
    };
  }, [heroAvatar, profile, FACTION_DEFAULTS]);

  const heroModelUrl = avatarData.modelUrl;
  const heroGender   = avatarData.archetype;
  const heroParts    = avatarData.parts;
  const heroColors   = avatarData.colors;
  const heroFaction  = avatarData.faction;

  // Push our latest snapshot (hero + pet) to the duel hook while connected; the hook
  // broadcasts it at a fixed 15 Hz tick. Runs on any relevant change (cheap ref write).
  React.useEffect(() => {
    if (!duelActive) return;
    duelSetSnapshotRef.current({
      pos: hero.pos,
      hp: heroVitals?.hp.current ?? 100,
      maxHp: heroVitals?.hp.max ?? 100,
      faction: heroFaction, gender: heroGender, name: heroVitals?.name,
      moving: isHeroMoving, facing: heroFacingAngle,
      pet: { q: pet.pos.q, r: pet.pos.r, type: petType, moving: isPetMoving },
    });
  }, [duelActive, hero.pos, heroVitals?.hp.current, heroVitals?.hp.max, heroVitals?.name, isHeroMoving, heroFacingAngle, heroFaction, heroGender, pet.pos, petType, isPetMoving]);

  // Same, for the MOBA: push our hero snapshot up to the host (guest) / into the sim (host).
  React.useEffect(() => {
    if (!mobaActive) return;
    mobaSetSnapshotRef.current({
      pos: hero.pos,
      hp: heroVitals?.hp.current ?? 100,
      maxHp: heroVitals?.hp.max ?? 100,
      gender: heroGender, name: heroVitals?.name,
      moving: isHeroMoving, facing: heroFacingAngle,
      pet: { q: pet.pos.q, r: pet.pos.r, type: petType, moving: isPetMoving },
    });
  }, [mobaActive, hero.pos, heroVitals?.hp.current, heroVitals?.hp.max, heroVitals?.name, isHeroMoving, heroFacingAngle, heroGender, pet.pos, petType, isPetMoving]);

  // Report our own death once → the killer faction scores an elimination (GDD).
  React.useEffect(() => {
    const hp = heroVitals?.hp.current ?? 1;
    if (mobaActive && !mobaDeathReported && hp <= 0) { moba.reportLocalDeath(); setMobaDeathReported(true); }
    else if (hp > 0 && mobaDeathReported) setMobaDeathReported(false);
  }, [mobaActive, mobaDeathReported, heroVitals?.hp.current]);
  // avatarReady: always true since IsometricCharacter is procedural (no async loading).
  // Only reset briefly when a custom GLB modelUrl changes to avoid stale-model flash.
  const [avatarReady, setAvatarReady] = useState(true);
  useEffect(() => {
    if (!heroModelUrl) return; // procedural — no need to gate
    setAvatarReady(false);
    const raf = requestAnimationFrame(() => setAvatarReady(true));
    return () => cancelAnimationFrame(raf);
  }, [heroModelUrl]);
  // Precompute world bounds for camera panning
  const mapBounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const t of tiles) {
      const { x, z } = axialToWorld(t, hexSize);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    // Add small margin
    const m = hexSize * 2;
    // Y bounds for camera vertical panning: keep camera from showing white canvas
    // Initial camera Y is 22, so limit panning to prevent going below ground
    const yBound = 12;
    return { minX: minX - m, maxX: maxX + m, minZ: minZ - m, maxZ: maxZ + m, minY: -yBound, maxY: yBound };
  }, [tiles, hexSize]);
  // Precompute indices for quick adjacency/zones
  const tilesByKey = useMemo(() => {
    const m = new Map<string, Tile>();
    for (const t of tiles) m.set(`${t.q},${t.r}`, t);
    return m;
  }, [tiles]);
  // Separate type-only map for minimap canvas (avoids passing full Tile objects)
  const tileTypesMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tiles) m.set(`${t.q},${t.r}`, t.type);
    return m;
  }, [tiles]);
  
  // Build minimap data for HUD display
  const minimapData = useMemo(
    () => ({
      exploredKeys: exploredRef.current,
      exploredRevision: exploredCount,
      visibleKeys: minimapVisibleKeys,
      tileTypes: tileTypesMap,
      heroPos: hero.pos,
      petPos: pet.pos,
      hexSize,
      mapBounds,
    }),
    [exploredCount, minimapVisibleKeys, hero.pos.q, hero.pos.r, pet.pos.q, pet.pos.r, tileTypesMap]
  );
  // Patrol candidates: walkable tiles within hero leash radius
  const patrolCandidates = useMemo(() => {
    const leash = Math.max(0, hero.vision - 1);
    return tiles.filter(t => axialDistance(t, hero.pos) <= leash && t.type !== 'mountain' && t.type !== 'water');
  }, [tiles, hero.pos, hero.vision]);
  // ─── Pet patrol — refs keep the setInterval closure always current ──────────
  const petTargetRef = React.useRef<Axial | null>(null);
  petTargetRef.current = petTarget;
  const heroRef = React.useRef(hero);
  heroRef.current = hero;
  const tilesByKeyRef = React.useRef(tilesByKey);
  tilesByKeyRef.current = tilesByKey;

  // Pick a new patrol target whenever the current one is reached or drifts out of leash
  useEffect(() => {
    if (!petTarget || axialDistance(petTarget, hero.pos) > hero.vision - 1) {
      if (patrolCandidates.length) setPetTarget(patrolCandidates[Math.floor(Math.random() * patrolCandidates.length)]);
    }
  }, [petTarget, patrolCandidates, hero.pos, hero.vision]);

  // Interval reads from refs so it never needs to restart on target/hero/tile changes.
  // This fixes the stale-closure bug where the interval would see an outdated petTarget.
  useEffect(() => {
    const interval = setInterval(() => {
      const target = petTargetRef.current;
      const h = heroRef.current;
      const byKey = tilesByKeyRef.current;
      setPet(curr => {
        if (!target) return curr;
        if (curr.pos.q === target.q && curr.pos.r === target.r) { setPetTarget(null); return curr; }
        const leash = Math.max(0, h.vision - 1);
        let best = curr.pos; let bestDist = axialDistance(best, target);
        for (const n of axialNeighbors(curr.pos)) {
          const tile = byKey.get(`${n.q},${n.r}`);
          if (!tile) continue;
          // Pet is blocked by mountains but CAN cross water tiles
          if (tile.type === 'mountain') continue;
          if (axialDistance(n, h.pos) > leash) continue;
          const d = axialDistance(n, target);
          if (d < bestDist) { bestDist = d; best = n; }
        }
        if (best.q === curr.pos.q && best.r === curr.pos.r) { setPetTarget(null); return curr; }
        // Pet moves but does NOT collect flowers — only player can collect
        return { ...curr, pos: best };
      });
    }, 400);
    return () => clearInterval(interval);
  // Empty deps: interval runs for the lifetime of the component; all state read via refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Precompute axial bounds for collider logic
  const axialBounds = useMemo(() => {
    let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
    for (const t of tiles) { if (t.q < minQ) minQ = t.q; if (t.q > maxQ) maxQ = t.q; if (t.r < minR) minR = t.r; if (t.r > maxR) maxR = t.r; }
    return { minQ, maxQ, minR, maxR };
  }, [tiles]);
  // Precompute boundary planes (stable — only changes when tiles array changes)
  const boundaryPlanes = useMemo(() => {
    const planes: JSX.Element[] = [];
    const { minQ, maxQ, minR, maxR } = axialBounds;
    for (const t of tiles) {
      if (t.q !== minQ && t.q !== maxQ && t.r !== minR && t.r !== maxR) continue;
      const { x, z } = axialToWorld(t, hexSize);
      planes.push(
        <mesh key={`boundary-${t.q},${t.r}`} position={[x, 0.2, z]} rotation={[-Math.PI/2, 0, 0]}>
          <circleGeometry args={[hexSize*0.95, 6]} />
          <meshBasicMaterial color="#000" transparent opacity={0} />
        </mesh>
      );
    }
    return planes;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, axialBounds, hexSize]);
  const [hover, setHover] = useState<Tile | null>(null);
  const [refMountains, setRefMountains] = useState(false);
  const [refTrees, setRefTrees] = useState(false);
  const [refWater, setRefWater] = useState(false);
  const [refHills, setRefHills] = useState(false);
  const [refDesert, setRefDesert] = useState(false);
  // Recenter camera on double-tap spacebar
  const [recenterSignal, setRecenterSignal] = useState(0);


  // Touch device? Show on-screen controls for phones/tablets.
  const [coarsePointer, setCoarsePointer] = useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarsePointer(mq.matches || 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  // ── Death → respawn: when HP hits 0, return to base at full vitals ──────────
  const [deathBanner, setDeathBanner] = useState(false);
  const diedRef = React.useRef(false);
  React.useEffect(() => {
    const hp = heroVitals?.hp.current ?? 1;
    if (hp <= 0 && !diedRef.current) {
      diedRef.current = true;
      // Respawn at the NEAREST player-owned outpost (a forward spawn point — the payoff
      // of capturing territory); fall back to the base/spawn hub if none is owned.
      const own = nearestOwnedOutpostRef.current?.(heroPosRef.current.q, heroPosRef.current.r);
      const spawn = own ? { q: own.q, r: own.r } : { ...baseAxial };
      setHero(h => ({ ...h, pos: { ...spawn } }));
      saveProgress({ heroPosition: { ...spawn } });
      updateHeroPosition({ ...spawn });
      setRecenterSignal(s => s + 1);
      onHealHP?.(999999);
      onRestoreEP?.(999999);
      setDeathBanner(true);
      setTimeout(() => setDeathBanner(false), 1600);
      console.log(`[death] Hero defeated — respawned at ${own ? 'owned outpost ' + own.key : 'base'}`);
    } else if (hp > 0 && diedRef.current) {
      diedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroVitals?.hp.current]);

  // ── Territory economy (4X "eXploit"): owned outposts yield resources every few
  //    seconds; controlled regions add a bonus; standing on owned ground slowly heals
  //    the hero (home-turf regen). Reads live control state via refs. ────────────────
  const grantResourceRef = React.useRef(grantResource); grantResourceRef.current = grantResource;
  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (inputPausedRef.current) return; // paused with the overlay open
      const ctrl = outpostControlRef.current;
      if (ctrl.owned > 0) {
        const gain = ctrl.owned + ctrl.regionsControlled * 2; // +2 per fully-controlled region
        grantResourceRef.current('ore', gain);
      }
      const hp = heroPosRef.current;
      const outKey = outpostTerritoryRef.current.get(`${hp.q},${hp.r}`);
      if (outKey && outpostsRef2.current.get(outKey)?.owner === 'player') onHealHP?.(6);
    }, 4000);
    return () => window.clearInterval(id);
  }, [onHealHP]);

  const lastSpaceRef = React.useRef(0);
  useEffect(() => {
    function onSpace(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      const now = performance.now();
      if (now - lastSpaceRef.current < 320) {
        setRecenterSignal(s => s + 1);
      }
      lastSpaceRef.current = now;
    }
    window.addEventListener('keydown', onSpace);
    return () => window.removeEventListener('keydown', onSpace);
  }, []);

  // Enemy spawn zones: near deserts or mountain passes (tiles adjacent to >=2 mountains) and on open ground
  // enemy spawn / patrol hints removed pending gameplay implementation

  function tileKey(t: Axial) { return `${t.q},${t.r}`; }
  // Char-based rules closer to legacy
  function passable(t: Tile | undefined) {
    if (!t) return { passable: false, reason: null };
    // Mountains are impassable for everyone; water is impassable for the player (pet can traverse it)
    if (t.type === 'mountain') return { passable: false, reason: 'mountain' };
    if (t.type === 'water') return { passable: false, reason: 'water' };
    return { passable: true, reason: null };
  }
  function clampAxial(a: Axial): Axial {
    // Clamp to nearest existing tile inside bounds. If clamped coordinate missing (edge shape differences) search nearby.
    let q = Math.min(axialBounds.maxQ, Math.max(axialBounds.minQ, a.q));
    let r = Math.min(axialBounds.maxR, Math.max(axialBounds.minR, a.r));
    if (tilesByKey.has(`${q},${r}`)) return { q, r };
    // Fallback: BFS small radius to find nearest existing tile
    const visited = new Set<string>();
    const queue: Axial[] = [{ q, r }];
    while (queue.length) {
      const cur = queue.shift()!;
      const k = `${cur.q},${cur.r}`;
      if (visited.has(k)) continue;
      visited.add(k);
      if (tilesByKey.has(k)) return cur;
      for (const n of axialNeighbors(cur)) {
        if (Math.abs(n.q - q) > 4 || Math.abs(n.r - r) > 4) continue; // limit search radius
        queue.push(n);
      }
    }
    return a; // fallback
  }
  const inputPausedRef = React.useRef(inputPaused);
  inputPausedRef.current = inputPaused;
  useEffect(() => {
    const downSet = new Set<string>();
    function onKey(e: KeyboardEvent) {
      if (inputPausedRef.current) return; // skill-tree overlay open — ignore game input
      const k = e.key.toLowerCase();

      // ─── MOVEMENT (WASD ONLY) ─────────────────────────────────────
      // Arrow keys reserved for camera control
      const dirMap: Record<string, Axial> = {
        w: { q: 0, r: -1 },       // North
        s: { q: 0, r: 1 },        // South
        a: { q: -1, r: 1 },       // Southwest
        d: { q: 1, r: -1 },       // Northeast
      };
      
      const delta = dirMap[k];
      if (delta) {
        if (e.repeat || downSet.has(k)) return;
        downSet.add(k);
        e.preventDefault();
        
        setHero(h => {
          const targetRaw = { q: h.pos.q + delta.q, r: h.pos.r + delta.r };
          const clamped = clampAxial(targetRaw);
          const tile = tilesByKey.get(`${clamped.q},${clamped.r}`);
          const check = passable(tile);
          if (!check.passable) {
            if (check.reason === 'water' || check.reason === 'mountain') {
              setCollisionMessage({ type: check.reason, show: true });
            }
            return h;
          }
          const next = { ...h, pos: clamped };
          saveProgress({ heroPosition: clamped });
          updateHeroPosition(clamped);
          tilesMoveRef.current++;
          if (tilesMoveRef.current >= 40) {
            tilesMoveRef.current = 0;
            // Pet XP + hero XP gain delegated to usePetXP hook. Read the CURRENT hero XP
            // from the ref (this keydown closure's `profile` is stale — its effect deps
            // don't include profile), otherwise each tick re-saves the same stale value
            // and hero XP never accumulates.
            petXPSystem.gainXPOnMove(
              profileForXpRef.current?.progress?.hero?.xp ?? 0,
              profileForXpRef.current?.progress?.hero?.level ?? 1,
            );
            console.log('[XP] Hero +0.5 XP, Pet +1 XP!');
          }
          return next;
        });
        return;
      }
      
      // ─── ATTACK/DEFENSE MODE TOGGLE (Tab) ─────────────────────────────
      if (k === 'tab') {
        e.preventDefault();
        setAbilityMode(m => (m === 'offense' ? 'defense' : 'offense'));
        return;
      }

      // ─── ATTACK NEARBY ENEMY / CREEP CAMP / RIVAL PLAYER (F) — a deliberate choice ─
      if (k === 'f') {
        if (e.repeat) return;
        // Faction enemies take priority (they can move onto you); fall back to camps.
        const hitEnemy = attackNearbyEnemyRef.current().hit;
        if (!hitEnemy) attackNearbyRef.current();  // creep camp if adjacent
        duelFightRef.current();     // rival duelist if adjacent (1v1)
        mobaFightRef.current();     // rival hero if adjacent (MOBA)
        return;
      }
      // ─── TERRAFORM (Y) — invest a resource at the terraformer ──────────
      // (Moved off T so T can serve as the 4th offensive ability slot.)
      if (k === 'y') {
        if (e.repeat) return;
        investTerraformRef.current();
        return;
      }
      // ─── CAPTURE OUTPOST (G) ───────────────────────────────────────────
      if (k === 'g') {
        if (e.repeat) return;
        captureNearbyRef.current();
        // In a MOBA, also submit the capture intent to the authoritative host.
        if (mobaActiveRef.current) { const no = nearbyOutpostRef.current; if (no) mobaRequestCaptureRef.current(`${no.q},${no.r}`); }
        return;
      }
      // ─── TOGGLE OUTPOST CONTROL-ZONE OVERLAY (O) ───────────────────────
      // (Moved off Y, which now triggers Terraform.)
      if (k === 'o') {
        if (e.repeat) return;
        setShowOutpostZones(v => !v);
        return;
      }
      // ─── AID A REFUGEE CAMP (H) — complete its faction mission ──────────
      if (k === 'h') {
        if (e.repeat) return;
        assistRefugeeRef.current();
        return;
      }
      // (Pet-pack supplies are now used via the number keys 1–8, alongside hero
      //  items — each unique item has its own key. See the ITEM ACTIVATION block.)

      // ─── ABILITY ACTIVATION — uses the ACTIVE mode's ability set ────────
      // Offensive keys are Q/E/R/T (NOT W — that's movement); defensive keys are
      // Z/X/C/V. Resolve the pressed key against the active set's own key labels
      // (case-insensitive) so BOTH sets fire and neither collides with WASD.
      // (Previously hard-coded to QWER and compared upper-vs-lower case, so no
      //  offensive ability ever activated and the defensive set had no handler.)
      const abilityHit = abilitySlotsRef.current.find(a => a.key?.toLowerCase() === k);
      if (abilityHit) {
        if (e.repeat) return;
        activateAbilityRef.current(abilityHit.id);
        return;
      }
      
      // ─── ITEM ACTIVATION (12345678) ─────────────────────────────────
      const itemMap: Record<string, string> = {
        '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8',
      };

      if (itemMap[k]) {
        if (e.repeat) return;
        const slotIndex = parseInt(itemMap[k]) - 1;
        // Item use delegated to useCollectibles hook
        handleItemUse(slotIndex);
        return;
      }
    }
    function onKeyUp(e: KeyboardEvent){
      const k = e.key.toLowerCase();
      if (downSet.has(k)) downSet.delete(k);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
  }, [tilesByKey, saveProgress, setAbilitySlots, setCollisionMessage, updateHeroPosition, petXPSystem.gainXPOnMove, handleItemUse]);
  // endTurn logic removed (turn system disabled)

  // Keyboard hex movement (pointy axial layout with q,r; adapt to 6 neighbors)
  // Keyboard disabled for now

  return (
  <div className="relative w-screen h-screen bg-[#111827] overflow-hidden">
      {/* Helper overlay removed for production */}
      <div className="absolute inset-0 select-none">
    {/* Camera elevation ≈ 33.3° above the ground plane (height/horizontal = tan(33.3°)). */}
    <Canvas shadows camera={{ position: [0, 14.47, 22], fov: 45 }} gl={{ alpha: false }} style={{ background: '#111827' }} onCreated={({ gl, scene }) => { gl.setClearColor('#111827', 1); scene.background = new THREE.Color('#111827'); }}>
  <MapCameraController
    bounds={mapBounds}
    gameMode={true}
    heroWorld={heroWorld}
    recenterSignal={recenterSignal}
    nearbyFlowerRef={nearbyFlowerRef}
    nearbyMushroomRef={nearbyMushroomRef}
    nearbyResourceRef={nearbyResourceRef}
    collectingFlowerRef={collectingFlowerRef}
    collectingMushroomRef={collectingMushroomRef}
    handleCollect={handleCollectWithStyle}
    abilitySlots={abilitySlots}
    setAbilitySlots={setAbilitySlots}
  />
              <SceneSetupVerifier />
              <AvatarRenderingVerifier />
              <PerformanceChecker />
              <AvatarCollisionDetector heroAvatarRef={heroAvatarRef} heroWorldPos={heroWorld} culledTiles={culledTiles} hexSize={hexSize} />
              <SceneBridge outerRadius={hexSize} onReady={(caps) => { setRefMountains(!!caps.mountain); setRefTrees(!!caps.tree); setRefWater(!!caps.water); setRefHills(!!caps.hills); setRefDesert(!!caps.desert); }} />
              <Sky inclination={0.6} azimuth={0.25} sunPosition={[50, 50, 10]} turbidity={2} rayleigh={0.7} mieCoefficient={0.005} mieDirectionalG={0.8} />
              <hemisphereLight args={["#bde0fe", "#e6f3ff", 0.8]} />
              <directionalLight position={[30, 40, 15]} intensity={0.7} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
              <group position={[0, 0, 0]}>
                {/* Dark ground plane: prevents white canvas showing at RENDER_RADIUS edge */}
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}>
                  <planeGeometry args={[2000, 2000]} />
                  <meshBasicMaterial color="#111827" />
                </mesh>

                {/* ── Explored-memory tiles outside RENDER_RADIUS — dim overlay, no decorations ── */}
                {exploredMemoryTiles.map(t => {
                  const { x, z } = axialToWorld(t, hexSize);
                  const key = `exp-mem-${t.q},${t.r}`;
                  const tileTop = heightFor(t);
                  return (
                    <group key={key} position={[x, 0, z]}>
                      <HexTile t={t} size={hexSize} onClick={() => {}} onHover={setHover} />
                      <mesh rotation={[0, Math.PI / 6, 0]} position={[0, tileTop + 0.016, 0]} renderOrder={14}>
                        <cylinderGeometry args={[hexSize, hexSize, 0.03, 6]} />
                        <meshBasicMaterial color="#000" transparent opacity={0.42} depthWrite={false} />
                      </mesh>
                    </group>
                  );
                })}

                {/* ── Active render radius tiles ── */}
                {culledTiles.map((rawT) => {
                  const key = `${rawT.q},${rawT.r}`;
                  // Apply the terraforming override so greened tiles render as fertile.
                  const ov = terraformedTiles.get(key);
                  const t: Tile = ov ? { ...rawT, type: ov } : rawT;
                  const { x, z } = axialToWorld(t, hexSize);
                  const inHero = heroVisible.has(key);
                  const inPet = petVisible.has(key);
                  const inVision = inHero || inPet;
                  const explored = exploredRef.current.has(key);
                  const tileTop = heightFor(t);
                  // Keep camp / outpost / terraformer tiles AND the ring of tiles around
                  // them clear of terrain clutter so the player can fight/capture/deliver
                  // with clear sightlines (no trees or rocks overlaying the area).
                  const blockDeco = decoBlockedKeys.has(key);
                  return (
                    <group key={key} position={[x, 0, z]}>
                      <HexTile t={t} size={hexSize} onClick={() => {}} onHover={setHover} />
                      {/* Terrain decorations — visible now OR previously explored (FoW dim sits on top) */}
                      {(inVision || explored) && t.type === 'forest' && !collectibleMushrooms.has(key) && !blockDeco && (
                        <group position={[0, tileTop, 0]}><TreeCluster size={hexSize} seed={t.q * 31 + t.r * 17} /></group>
                      )}
                      {(inVision || explored) && t.type === 'jungle' && !blockDeco && (
                        <group position={[0, tileTop, 0]}><TreeCluster size={hexSize} seed={t.q * 31 + t.r * 17} /></group>
                      )}
                      {(inVision || explored) && t.type === 'mountain' && !blockDeco && (
                        <group position={[0, tileTop, 0]}><MountainDeco size={hexSize} seed={t.q * 31 + t.r * 17} /></group>
                      )}
                      {(inVision || explored) && t.type === 'hills' && !blockDeco && (
                        <group position={[0, tileTop, 0]}><HillsDeco size={hexSize} seed={t.q * 31 + t.r * 17} /></group>
                      )}
                      {(inVision || explored) && t.type === 'water' && (
                        <group position={[0, tileTop, 0]}><WaterWaves size={hexSize} /></group>
                      )}
                      {(inVision || explored) && t.type === 'plains' && !blockDeco && (
                        <group position={[0, tileTop, 0]}><GrassCluster size={hexSize} seed={t.q * 37 + t.r * 13} /></group>
                      )}
                      {(inVision || explored) && t.type === 'desert' && !blockDeco && (
                        <group position={[0, tileTop, 0]} renderOrder={5}><DesertDunes size={hexSize} seed={t.q * 41 + t.r * 19} /></group>
                      )}
                      {/* Gatherable resource node (ore / energy / bio) — removed from the
                          map on collect, so drive it off the collectible map, not t.resource. */}
                      {(inVision || explored) && collectibleResources.has(key) && (
                        <group position={[0, tileTop, 0]} renderOrder={22}><ResourceProp type={collectibleResources.get(key)!} size={hexSize} seed={t.q * 29 + t.r * 23} /></group>
                      )}
                      {/* Collectible healing flowers (plains only) */}
                      {inVision && collectibleFlowers.has(key) && (
                        <group position={[0, tileTop, 0]} renderOrder={23}>
                          <CollectibleFlower size={hexSize} />
                        </group>
                      )}
                      {/* Collectible mushrooms (forest only) - raised so they show above trees */}
                      {inVision && collectibleMushrooms.has(key) && (
                        <group position={[0, tileTop, 0]} renderOrder={30}>
                          <CollectibleMushroom size={hexSize} />
                        </group>
                      )}
                      {/* FoW: solid black over completely unexplored+invisible tiles */}
                      {!inVision && !explored && (
                        <mesh rotation={[0, Math.PI / 6, 0]} position={[0, tileTop + 0.02, 0]} renderOrder={15}>
                          <cylinderGeometry args={[hexSize, hexSize, 0.04, 6]} />
                          <meshBasicMaterial color="#000" transparent opacity={0.88} depthWrite={false} />
                        </mesh>
                      )}
                      {/* FoW: dim overlay on explored-but-not-currently-visible tiles */}
                      {!inVision && explored && (
                        <mesh rotation={[0, Math.PI / 6, 0]} position={[0, tileTop + 0.016, 0]} renderOrder={14}>
                          <cylinderGeometry args={[hexSize, hexSize, 0.03, 6]} />
                          <meshBasicMaterial color="#000" transparent opacity={0.38} depthWrite={false} />
                        </mesh>
                      )}
                      {/* Territory ownership — each tile tinted by its controlling outpost's
                          owner (faction colour if captured, grey if neutral). Owned ground is
                          always shown faintly so the map reads as claimed territory; the 'O'
                          overlay reveals the FULL partition (incl. neutral) with bright borders. */}
                      {(inVision || explored) && outpostTerritory.has(key) && (() => {
                        const owned = outposts.get(outpostTerritory.get(key)!)?.owner === 'player';
                        // Without the overlay, only owned tiles tint (ownership feedback).
                        if (!showOutpostZones && !owned) return null;
                        const onBorder = zoneBoundary.has(key);
                        const col = owned ? heroColors.primary : '#8a8f96';
                        const op = showOutpostZones
                          ? (owned ? (onBorder ? 0.42 : 0.16) : (onBorder ? 0.24 : 0.06))
                          : (onBorder ? 0.30 : 0.10); // always-on owned tint
                        return (
                          <mesh rotation={[0, Math.PI / 6, 0]} position={[0, tileTop + 0.05, 0]} renderOrder={13}>
                            <cylinderGeometry args={[hexSize * (onBorder ? 1 : 0.9), hexSize * (onBorder ? 1 : 0.9), 0.02, 6]} />
                            <meshBasicMaterial color={col} transparent opacity={op} depthWrite={false} />
                          </mesh>
                        );
                      })()}
                    </group>
                  );
                })}
                {/* Actor markers */}
                {/* Hero avatar replaced with billboard; pet retains simple sphere marker */}
                {/* Hero avatar — inlined JSX (not a sub-component) so React never
                    unmounts/remounts this group on parent re-renders.
                    Positioned at tile surface (y = 0.4), with avatar mesh foot-anchored
                    so feet sit exactly at the surface. */}
                <group ref={heroAvatarRef} position={[heroWorld.x, 0.48, heroWorld.z]} name="HeroAvatar" frustumCulled={false}>
                  {/* Drop shadow — renderOrder 20 */}
                  <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, 0.01, 0]} receiveShadow renderOrder={20}>
                    <circleGeometry args={[hexSize * 0.42, 24]} />
                    <meshStandardMaterial color="#000" transparent opacity={0.22} depthWrite={false} />
                  </mesh>
                  {/* Floor collider — invisible plane at tile surface */}
                  <mesh position={[0, -0.01, 0]} userData={{ type: 'avatar-floor' }} visible={false}>
                    <planeGeometry args={[hexSize * 0.8, hexSize * 0.8]} />
                    <meshBasicMaterial />
                  </mesh>
                  {/* Yellow selection ring — renderOrder 21 */}
                  <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, 0.015, 0]} renderOrder={21}>
                    <ringGeometry args={[hexSize * 0.62, hexSize * 0.78, 40]} />
                    <meshBasicMaterial color="#facc15" transparent opacity={0.85} depthWrite={false} />
                  </mesh>
                  {/* Avatar mesh is a direct child of HeroAvatar. React updates this group's
                      position via JSX prop each time hero moves, which triggers R3F to call
                      group.position.set() + updateMatrix(), setting matrixWorldNeedsUpdate=true.
                      During gl.render → scene.updateMatrixWorld(), force=true cascades through
                      all descendants including GLB primitive nodes. */}
                  {/* Render the real GLTF avatar (a full hero GLB, or the modular parts
                      assembled from public/assets/3d) whenever one is available. GameAvatar
                      auto-fits it to game-map scale and foot-anchors it, and falls back to the
                      procedural IsometricCharacter if nothing loads. Only when there is neither a
                      model nor any parts do we use the procedural character directly. */}
                  {(heroModelUrl || Object.values(heroParts).some(Boolean)) ? (
                    avatarReady && (
                      <Suspense fallback={
                        <IsometricCharacter gender={heroGender ?? 'FEMALE'} colors={heroColors} hexSize={hexSize} faction={heroFaction} isMoving={isHeroMoving} facingAngle={heroFacingAngle} />
                      }>
                        <GameAvatar heroModelUrl={heroModelUrl} heroParts={heroParts} heroColors={heroColors} hexSize={hexSize} gender={heroGender} isMoving={isHeroMoving} facingAngle={heroFacingAngle} />
                      </Suspense>
                    )
                  ) : (
                    <IsometricCharacter gender={heroGender ?? 'FEMALE'} colors={heroColors} hexSize={hexSize} faction={heroFaction} isMoving={isHeroMoving} facingAngle={heroFacingAngle} />
                  )}
                </group>
                {(() => { const world = axialToWorld(pet.pos, hexSize); const ps = hexSize * 0.32; return (
                  <group key={pet.id} position={[world.x, 0.48, world.z]} rotation={[0, petFacingAngle, 0]} frustumCulled={false}>
                    {isDog ? <IsometricDog ps={ps} isMoving={isPetMoving} /> : <IsometricPet ps={ps} isMoving={isPetMoving} />}
                    {/* Name label + role/attack counter */}
                    <Text position={[0, ps * 3.1, 0]} fontSize={ps * 0.5} color="#fff" anchorX="center" anchorY="middle" outlineWidth={ps * 0.03} outlineColor="#000">{isDog ? `Dog  ⚔️${petCombatBonus}` : `Cat  👁️+${petVisionBonus}`}</Text>
                  </group> ); })()}
                {/* Remote duelist (1v1 PvP) — interpolated between 15 Hz snapshots */}
                {duelRemote && (
                  <RemoteDuelist bufRef={duelRemoteBufRef} remote={duelRemote} hexSize={hexSize} colors={heroColors} />
                )}
                {/* Remote MOBA heroes (other players + AI factions) */}
                {mobaActive && moba.remotes.map(h => (
                  <RemoteMobaHero key={`moba-${h.uid}`} uid={h.uid} bufRef={moba.remotesBufRef} hero={h} hexSize={hexSize} />
                ))}
                {/* Creep camps — only on explored/visible tiles (hidden by fog of war),
                    near the hero, and hidden once cleared. */}
                {Array.from(creepCamps.values()).map(camp => {
                  if (camp.cleared) return null;
                  const ckey = `${camp.q},${camp.r}`;
                  if (!exploredRef.current.has(ckey) && !heroVisible.has(ckey)) return null; // fog of war
                  if (axialDistance({ q: camp.q, r: camp.r }, hero.pos) > RENDER_RADIUS) return null;
                  const cw = axialToWorld({ q: camp.q, r: camp.r }, hexSize);
                  return (
                    <group key={`camp-${camp.key}`} position={[cw.x, heightFor({ q: camp.q, r: camp.r, type: 'plains', char: 'P', resource: null }), cw.z]} frustumCulled={false}>
                      <CreepCampMesh camp={camp} size={hexSize} />
                    </group>
                  );
                })}
                {/* Faction enemies — mobile rival-faction AI units (active PvE). Rendered
                    at absolute world coords so they walk across tiles; fog-of-war + range
                    culled like camps. */}
                {factionEnemies.map(en => {
                  if (en.hp <= 0) return null;
                  const ekey = `${en.q},${en.r}`;
                  if (!exploredRef.current.has(ekey) && !heroVisible.has(ekey)) return null; // fog of war
                  if (axialDistance({ q: en.q, r: en.r }, hero.pos) > RENDER_RADIUS) return null;
                  const ew = axialToWorld({ q: en.q, r: en.r }, hexSize);
                  const tile = tilesByKey.get(ekey);
                  const y = heightFor(tile ?? { q: en.q, r: en.r, type: 'plains', char: 'P', resource: null });
                  return <EnemyUnitMesh key={en.id} enemy={en} size={hexSize} target={[ew.x, y, ew.z]} />;
                })}
                {/* Base / Command Center at spawn */}
                {(() => { const bw = axialToWorld(baseAxial, hexSize); return (
                  <group key="base" position={[bw.x, heightFor({ q: baseAxial.q, r: baseAxial.r, type: 'plains', char: 'P', resource: null }), bw.z]} frustumCulled={false}>
                    <CommandCenter size={hexSize} color={heroColors.primary} />
                  </group>
                ); })()}
                {/* Terraformer objective */}
                {(() => { const tw = axialToWorld(terraformAxial, hexSize); return (
                  <group key="terraformer" position={[tw.x, heightFor({ q: terraformAxial.q, r: terraformAxial.r, type: 'plains', char: 'P', resource: null }), tw.z]} frustumCulled={false}>
                    <Terraformer size={hexSize} progress={terraformProgress} done={terraformDone} />
                    {terraformDone && <GrassCluster size={hexSize} seed={terraformAxial.q * 7 + terraformAxial.r} />}
                  </group>
                ); })()}
                {/* Outposts (fog-gated) */}
                {Array.from(outposts.values()).map(o => {
                  const okey = `${o.q},${o.r}`;
                  if (!exploredRef.current.has(okey) && !heroVisible.has(okey)) return null;
                  if (axialDistance({ q: o.q, r: o.r }, hero.pos) > RENDER_RADIUS) return null;
                  const ow = axialToWorld({ q: o.q, r: o.r }, hexSize);
                  return (
                    <group key={`outpost-${o.key}`} position={[ow.x, heightFor({ q: o.q, r: o.r, type: 'plains', char: 'P', resource: null }), ow.z]} frustumCulled={false}>
                      {(() => {
                        // In a MOBA, colour the banner by the authoritative owning faction;
                        // otherwise fall back to the single-player owned/neutral flag.
                        const mobaOwner = mobaActive ? mobaOutpostOwner.get(o.key) : undefined;
                        if (mobaActive) {
                          const owned = !!mobaOwner && mobaOwner !== 'neutral';
                          const color = owned ? (FACTION_COLORS[mobaOwner as string]?.primary ?? heroColors.primary) : heroColors.primary;
                          return <OutpostMarker size={hexSize} owned={owned} color={color} />;
                        }
                        return <OutpostMarker size={hexSize} owned={o.owner === 'player'} color={heroColors.primary} />;
                      })()}
                    </group>
                  );
                })}
                {/* Region name + control labels (revealed with the 'O' territory overlay). */}
                {showOutpostZones && outpostRegions.map(rg => {
                  const rkey = `${rg.centroid.q},${rg.centroid.r}`;
                  if (!exploredRef.current.has(rkey) && !minimapVisibleKeys.has(rkey)) return null;
                  const rw = axialToWorld({ q: rg.centroid.q, r: rg.centroid.r }, hexSize);
                  return (
                    <Text key={`region-${rg.id}`} position={[rw.x, hexSize * 2.4, rw.z]} fontSize={hexSize * 0.6}
                      color={rg.controlled ? heroColors.primary : '#e5e7eb'} anchorX="center" anchorY="middle"
                      outlineWidth={hexSize * 0.03} outlineColor="#000">
                      {`${rg.controlled ? '🚩 ' : ''}${rg.name}  ${rg.owned}/${rg.total}`}
                    </Text>
                  );
                })}
                {/* Refugee camps (fog-gated) — faction side missions */}
                {Array.from(refugeeCamps.values()).map(c => {
                  const rkey = `${c.q},${c.r}`;
                  if (!exploredRef.current.has(rkey) && !heroVisible.has(rkey)) return null;
                  if (axialDistance({ q: c.q, r: c.r }, hero.pos) > RENDER_RADIUS) return null;
                  const rw = axialToWorld({ q: c.q, r: c.r }, hexSize);
                  return (
                    <group key={`refugee-${c.key}`} position={[rw.x, heightFor({ q: c.q, r: c.r, type: 'plains', char: 'P', resource: null }), rw.z]} frustumCulled={false}>
                      <RefugeeCampMarker
                        size={hexSize}
                        done={c.completed}
                        label={c.mission.title}
                        icon={c.mission.icon}
                        mode={c.mode}
                        subtitle={c.mode === 'aid' ? `${c.delivered}/${c.required.amount} ${RESOURCE_DEFS[c.required.resource].label}` : undefined}
                      />
                    </group>
                  );
                })}
                {/* Floating combat numbers (damage counters) */}
                {combatTexts.map(ct => (
                  <group key={ct.id} position={[ct.x, 0, ct.z]}>
                    <FloatingCombatText text={ct.text} color={ct.color} onDone={() => setCombatTexts(prev => prev.filter(p => p.id !== ct.id))} />
                  </group>
                ))}
                {/* Boundary reference planes */}
                <group>{boundaryPlanes}</group>
              </group>
              {(() => {
                const planeWidth = (mapBounds.maxX - mapBounds.minX) + 30;
                const planeHeight = (mapBounds.maxZ - mapBounds.minZ) + 30;
                return null; // remove solid background plane
              })()}
              <ContactShadows position={[0, 0, 0]} opacity={0.15} blur={1.5} far={15} />
              {/* OrbitControls removed in favor of custom edge + drag panning controller */}
            </Canvas>
              {/* Collision message box */}
              {collisionMessage.show && (
                <div className="absolute inset-0 flex items-center justify-center z-50">
                  <div className="bg-black/80 border-2 border-white/30 rounded-lg p-6 max-w-sm text-center">
                    <h2 className="text-white font-bold text-lg mb-4">
                      {collisionMessage.type === 'water' ? '🌊 Water Ahead!' : '⛰️ Mountain Ahead!'}
                    </h2>
                    <p className="text-white/80 mb-6 text-sm">
                      {collisionMessage.type === 'water' 
                        ? 'You cannot cross water. Choose another path.'
                        : 'The mountain blocks your way. Find another route.'}
                    </p>
                    <div className="flex gap-3 justify-center">
                      <button
                        onClick={() => setCollisionMessage({ ...collisionMessage, show: false })}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setCollisionMessage({ ...collisionMessage, show: false })}
                        className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded font-medium transition-colors"
                      >
                        No
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* Exploration objective tracker */}
              <div className="absolute top-10 left-2 px-3 py-2 rounded-lg bg-black/60 text-xs text-white border border-white/10 font-medium tracking-wide">
                Explore: {exploredCount}/{explorationGoal} {explorationComplete ? '✓' : ''}
              </div>
              {/* Territory control readout (4X/MOBA macro state). Press O for region map. */}
              <div className="absolute top-[4.6rem] left-2 px-3 py-2 rounded-lg bg-black/60 text-xs text-white border border-white/10 font-medium tracking-wide flex items-center gap-2">
                <span style={{ color: heroColors.primary }}>🚩 {outpostControl.regionsControlled}/{outpostControl.regionCount} regions</span>
                <span className="opacity-70">· {outpostControl.owned}/{outpostControl.total} outposts</span>
                <span className="opacity-70">· {outpostControl.tilePct}% land</span>
              </div>
              
              {/* Terrain / resource tooltip on hover */}
              {hover && (
                <div className="fixed top-16 left-3 z-40 px-3 py-2 rounded-xl bg-[#0c1219]/92 ring-1 ring-white/12 text-xs pointer-events-none shadow-lg">
                  <div className="font-semibold capitalize flex items-center gap-1.5">
                    <span>{TERRAIN_ICON[hover.type] || '⬡'}</span>{hover.type}
                  </div>
                  {hover.resource && (
                    <div className="mt-0.5 text-emerald-300 flex items-center gap-1">
                      {RESOURCE_DEFS[hover.resource as keyof typeof RESOURCE_DEFS]?.icon} {RESOURCE_DEFS[hover.resource as keyof typeof RESOURCE_DEFS]?.label} resource
                    </div>
                  )}
                  <div className="mt-0.5 opacity-40 text-[10px]">{hover.q}, {hover.r}</div>
                </div>
              )}

              {/* Nearby faction enemy — takes priority over a creep camp (press F) */}
              {nearbyFactionEnemy && (() => {
                const en = nearbyFactionEnemy;
                const isBoss = en.role === 'boss';
                const label = isBoss ? `${en.faction} Commander` : `${en.faction} ${DOCTRINE[en.faction].label}`;
                const verb = paaPlayer ? 'to pacify' : 'to attack';
                return (
                  <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40">
                    <div className={`px-4 py-2 rounded-xl bg-rose-900/85 border-2 text-sm font-bold text-rose-100 backdrop-blur-sm shadow-lg flex items-center gap-2 ${isBoss ? 'border-amber-400/80' : 'border-rose-400/70'}`}>
                      <span style={{ color: isBoss ? '#ffd24a' : DOCTRINE[en.faction].color }}>{isBoss ? '👑' : '⚔️'} {label}</span>
                      <span className="opacity-80">Lv {en.level} · {Math.ceil(en.hp)}/{en.maxHp} HP</span>
                      <span className="ml-1 px-1.5 py-0.5 rounded bg-rose-700 font-bold">F</span> {verb}
                    </div>
                  </div>
                );
              })()}
              {/* Nearby creep camp — attacking is a deliberate choice (press F) */}
              {!nearbyFactionEnemy && nearbyCreepCamp && (
                <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40">
                  <div className="px-4 py-2 rounded-xl bg-rose-900/80 border border-rose-400/60 text-sm font-bold text-rose-100 backdrop-blur-sm shadow-lg flex items-center gap-2">
                    ⚔️ Enemy Camp — Lv {nearbyCreepCamp.level} · {nearbyCreepCamp.creeps.filter(c => c.hp > 0).length} left
                    <span className="ml-1 px-1.5 py-0.5 rounded bg-rose-700 font-bold">F</span> to attack
                  </div>
                </div>
              )}
              {/* Faction threat indicator — flags rival units actively hunting the hero. */}
              {enemyThreat.hunting > 0 && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40">
                  <div className="px-3 py-1 rounded-full bg-red-950/85 border border-red-500/60 text-xs font-bold text-red-200 backdrop-blur-sm shadow animate-pulse flex items-center gap-1.5">
                    🚨 {enemyThreat.hunting} enemy {enemyThreat.hunting === 1 ? 'unit' : 'units'} hunting you
                  </div>
                </div>
              )}

              {/* Terraformer / outpost prompts */}
              {(nearTerraformer && !terraformDone) && (
                <div className="fixed top-28 left-1/2 -translate-x-1/2 z-40">
                  <div className="px-4 py-2 rounded-xl bg-amber-900/80 border border-amber-400/60 text-sm font-bold text-amber-100 backdrop-blur-sm shadow-lg flex items-center gap-2">
                    🌱 Terraformer {terraformProgress}% — <span className="px-1.5 py-0.5 rounded bg-amber-700 font-bold">T</span> to invest a resource
                  </div>
                </div>
              )}
              {nearbyOutpost && (
                <div className="fixed top-28 left-1/2 -translate-x-1/2 z-40">
                  <div className="px-4 py-2 rounded-xl bg-indigo-900/80 border border-indigo-400/60 text-sm font-bold text-indigo-100 backdrop-blur-sm shadow-lg flex items-center gap-2">
                    🚩 Neutral Outpost — <span className="px-1.5 py-0.5 rounded bg-indigo-700 font-bold">G</span> to capture
                  </div>
                </div>
              )}
              {nearbyRefugeeCamp && (() => {
                const c = nearbyRefugeeCamp;
                const loot = c.mode === 'loot';
                const held = localHeroInventory.filter(i => i.type === c.required.resource).reduce((s, i) => s + (i.quantity || 0), 0);
                const resLbl = RESOURCE_DEFS[c.required.resource]?.label ?? '';
                return (
                  <div className="fixed top-40 left-1/2 -translate-x-1/2 z-40 max-w-[94vw] pointer-events-auto">
                    <div className="px-4 py-2.5 rounded-xl border bg-[#0c1219]/90 border-white/15 text-xs sm:text-sm backdrop-blur-sm shadow-lg text-center space-y-2">
                      <div className="font-bold flex flex-wrap items-center justify-center gap-x-2">
                        <span>{c.mission.icon} {c.mission.title}</span>
                        <span className="opacity-70 font-normal">
                          {loot ? `— ${FACTION_LABEL[c.campFaction]} camp` : `— ${c.delivered}/${c.required.amount} ${resLbl} · holding ${held}`}
                        </span>
                      </div>
                      {/* Player DECIDES the approach (GDD strategy layer) */}
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {loot ? (
                          <>
                            <button onClick={() => resolveRefugeeRef.current('negotiate')} title={PLAYSTYLES.negotiate.desc}
                              className="px-3 py-1.5 rounded-lg font-bold bg-sky-700/80 hover:bg-sky-600 ring-1 ring-sky-400/40">🕊️ Negotiate</button>
                            <button onClick={() => resolveRefugeeRef.current('loot')} title={PLAYSTYLES.loot.desc}
                              className="px-3 py-1.5 rounded-lg font-bold bg-orange-700/80 hover:bg-orange-600 ring-1 ring-orange-400/40">🔥 Loot</button>
                          </>
                        ) : (
                          <button onClick={() => resolveRefugeeRef.current('help')} title={PLAYSTYLES.help.desc}
                            className="px-3 py-1.5 rounded-lg font-bold bg-emerald-700/80 hover:bg-emerald-600 ring-1 ring-emerald-400/40">✚ Help — deliver {resLbl}</button>
                        )}
                      </div>
                      <div className="text-[10px] opacity-50"><span className="px-1 rounded bg-white/10 font-bold">H</span> = {loot ? 'negotiate' : 'help'} (peaceful default)</div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Civ-style top yield bar — full width, yields left, identity right ────── */}
              <div className="fixed top-0 left-0 right-0 z-30 pointer-events-none">
                <div className="flex items-center justify-between gap-2 px-3 py-1 bg-gradient-to-b from-[#0a0f16]/95 to-[#0a0f16]/75 border-b border-white/10 shadow-lg text-[12px] text-gray-100 overflow-x-auto no-scrollbar">
                  {/* Left cluster: yields */}
                  <div className="flex items-center gap-x-3 gap-y-0.5 flex-nowrap">
                    <div className="flex items-center gap-1.5" title="4X campaign score — outposts, regions, terraforming & refugee camps">
                      <span>🏆</span><span className="opacity-50 hidden md:inline">Score</span><span className="font-extrabold tabular-nums text-amber-300">{fourXScore}</span>
                    </div>
                    <div className="flex items-center gap-1.5" title="Unspent skill points — open the skill tree to invest">
                      <span>⭐</span><span className="opacity-50 hidden md:inline">Skill</span>
                      <span className={`font-extrabold tabular-nums ${(skillPoints ?? 0) > 0 ? 'text-emerald-300' : 'text-gray-300'}`}>{skillPoints ?? 0}</span>
                    </div>
                    <span className="w-px h-4 bg-white/15" />
                    <div className="flex items-center gap-1" title="Terraform progress"><span>🌱</span><span className="font-semibold tabular-nums">{terraformDone ? '✓' : `${terraformProgress}%`}</span></div>
                    <div className="flex items-center gap-1" title="Outposts owned"><span>🚩</span><span className="font-semibold tabular-nums">{outpostControl.owned}/{outpostControl.total}</span></div>
                    <div className="flex items-center gap-1" title="Regions controlled"><span>🗺️</span><span className="font-semibold tabular-nums">{outpostControl.regionsControlled}/{outpostControl.regionCount}</span></div>
                    <div className="flex items-center gap-1" title="Territory held"><span>🟩</span><span className="font-semibold tabular-nums">{outpostControl.tilePct}%</span></div>
                    <div className="flex items-center gap-1" title="Refugee camps completed"><span>⛺</span><span className="font-semibold tabular-nums">{refugeeProgress.done}/{refugeeProgress.total}</span></div>
                    {localPetInventory.length > 0 && (
                      <div className="flex items-center gap-1" title="Pet pack supplies (hotkeys 1–8)"><span>🐾</span><span className="font-semibold tabular-nums">{localPetInventory.reduce((s, i) => s + (i.quantity || 0), 0)}</span></div>
                    )}
                    {duelActive && (
                      <><span className="w-px h-4 bg-white/15" /><div className="flex items-center gap-1" title="Duel score"><span>⚔️</span><span className="font-semibold tabular-nums">{duel.status === 'connected' ? `${duel.myScore}–${duel.oppScore}` : duel.status}</span></div></>
                    )}
                  </div>
                  {/* Right cluster: emergent playstyle identity + faction */}
                  <div className="flex items-center gap-3 flex-nowrap">
                    {dominantStyle && (
                      <div className="flex items-center gap-1.5" title={`Your emergent playstyle — ${PLAYSTYLES[dominantStyle].desc}`} style={{ color: PLAYSTYLES[dominantStyle].color }}>
                        <span>{PLAYSTYLES[dominantStyle].icon}</span><span className="font-bold whitespace-nowrap">{PLAYSTYLES[dominantStyle].title}</span>
                      </div>
                    )}
                    <span className="w-px h-4 bg-white/15" />
                    <div className="flex items-center gap-1.5" title={FACTION_LABEL[heroFaction as string] ?? String(heroFaction)}>
                      <span className="w-2 h-2 rounded-full" style={{ background: FACTION_COLORS[heroFaction as string]?.primary ?? '#8a8f96' }} />
                      <span className="font-bold" style={{ color: FACTION_COLORS[heroFaction as string]?.label ?? '#e5e7eb' }}>{String(heroFaction)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── 1v1 PvP Duel: launcher button + lobby + result ─────────────── */}
              {!mobaMode && (
              <button
                onClick={() => setDuelLobbyOpen(o => !o)}
                className={`fixed top-16 right-3 z-40 px-3 py-1.5 rounded-lg text-sm font-bold shadow-lg ring-1 transition pointer-events-auto ${
                  duelActive ? 'bg-rose-800/90 ring-rose-400 text-rose-50' : 'bg-[#141b26]/90 ring-white/15 text-gray-200 hover:ring-rose-400/60'
                }`}
              >⚔️ Duel{duelActive && duel.status === 'connected' ? ' •' : ''}</button>
              )}

              {!mobaMode && duelLobbyOpen && (
                <div className="fixed top-28 right-3 z-40 w-[min(18rem,92vw)] p-4 rounded-xl bg-[#0c1219]/95 ring-1 ring-white/12 shadow-2xl text-sm text-gray-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">⚔️ 1v1 Duel</span>
                    <button onClick={() => setDuelLobbyOpen(false)} className="opacity-60 hover:opacity-100">✕</button>
                  </div>

                  {(duel.status === 'idle' || duel.status === 'error') && (
                    <>
                      <button onClick={() => duel.findMatch()} className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold flex items-center justify-center gap-2">
                        🎯 Find Opponent
                        {duelWaiting > 0 && <span className="px-1.5 py-0.5 rounded-full bg-black/30 text-[10px] font-bold">{duelWaiting} waiting</span>}
                      </button>
                      <div className="text-[11px] opacity-50 text-center">— or play a friend: host, share the code, they paste & join —</div>
                      <button onClick={() => duel.host()} className="w-full py-2 rounded-lg bg-rose-700 hover:bg-rose-600 font-bold">Host with a code</button>
                      <div className="flex gap-1.5">
                        <input
                          value={duelJoinCode}
                          onChange={(e) => setDuelJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
                          maxLength={5}
                          placeholder="CODE"
                          className="flex-1 min-w-0 px-2 py-2 rounded-lg bg-black/40 ring-1 ring-white/15 uppercase tracking-widest font-mono text-center"
                        />
                        <button onClick={pasteDuelCode} title="Paste code" className="px-2.5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">📋</button>
                        <button onClick={() => duel.join(duelJoinCode)} disabled={duelJoinCode.length < 4} className="px-3 py-2 rounded-lg bg-indigo-700 hover:bg-indigo-600 font-bold disabled:opacity-40">Join</button>
                      </div>
                      {duel.status === 'error' && <div className="text-[11px] text-rose-400">Couldn't connect — try again or check the code.</div>}
                    </>
                  )}

                  {duel.status === 'searching' && (
                    <div className="space-y-2 text-center">
                      <div className="text-[12px] text-emerald-400 font-bold animate-pulse py-1">🎯 Searching for an opponent…</div>
                      {duel.code && <div className="text-[11px] opacity-60">You're in the queue{duel.role === 'host' ? ' as host' : ''} — hang tight.</div>}
                      <button onClick={() => duel.leave()} className="w-full py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs">Cancel search</button>
                    </div>
                  )}

                  {duel.status === 'hosting' && (
                    <div className="space-y-2 text-center">
                      <div className="text-[11px] opacity-60">Share this code with your opponent:</div>
                      {/* Big, copyable room code */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 select-all text-2xl font-mono font-bold tracking-[0.3em] text-amber-300 py-2 rounded-lg bg-black/40 ring-1 ring-amber-400/40">{duel.code}</div>
                        <button onClick={() => copyDuelCode(duel.code)} className="px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 font-bold text-sm">{codeCopied ? '✓' : 'Copy'}</button>
                      </div>
                      <div className="text-[11px] opacity-60 animate-pulse">Waiting for opponent to join…</div>
                      <button onClick={() => duel.leave()} className="w-full py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs">Cancel</button>
                    </div>
                  )}

                  {duel.status === 'connecting' && (
                    <div className="text-center text-[12px] opacity-70 animate-pulse py-2">Connecting to {duel.code}…</div>
                  )}

                  {duel.status === 'connected' && (
                    <div className="space-y-2">
                      <div className="text-center text-emerald-400 font-bold">Connected — Fight!</div>
                      <div className="text-center text-lg font-extrabold tabular-nums">
                        <span className="text-amber-300">You {duel.myScore}</span>
                        <span className="opacity-50"> — </span>
                        <span className="text-rose-300">{duel.oppScore} Rival</span>
                      </div>
                      <div className="text-[11px] opacity-70 text-center">First to {duel.winTarget} · get adjacent & press <span className="px-1 rounded bg-white/10 font-bold">F</span> to strike.</div>
                      <button onClick={() => duel.leave()} className="w-full py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs">Leave duel</button>
                    </div>
                  )}

                  {duel.status === 'reconnecting' && (
                    <div className="space-y-2 text-center">
                      <div className="text-[12px] text-amber-300 font-bold animate-pulse">Connection dropped — reconnecting…</div>
                      <div className="text-[11px] opacity-60">Hang tight, trying to recover the link.</div>
                      <button onClick={() => duel.leave()} className="w-full py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs">Leave duel</button>
                    </div>
                  )}

                  {duel.status === 'closed' && (
                    <div className="space-y-2 text-center">
                      <div className="text-[12px] opacity-70">Connection closed.</div>
                      <button onClick={() => duel.leave()} className="w-full py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs">Back</button>
                    </div>
                  )}
                </div>
              )}

              {/* Level-up flash — XP crossed a threshold → new skill points available */}
              {levelUpBanner !== null && (
                <div className="fixed top-1/3 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
                  <div className="px-6 py-3 rounded-2xl bg-emerald-900/85 ring-1 ring-emerald-400/60 text-center shadow-2xl animate-bounce">
                    <div className="text-2xl font-extrabold text-emerald-300">⭐ Level {levelUpBanner}!</div>
                    <div className="text-xs opacity-80 mt-0.5">New skill points available — open the skill tree</div>
                  </div>
                </div>
              )}

              {/* Death → respawn flash (PvE) */}
              {deathBanner && !duel.result && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-rose-950/40 backdrop-blur-[2px] pointer-events-none">
                  <div className="px-8 py-5 rounded-2xl bg-[#1a0c0e]/90 ring-1 ring-rose-500/40 text-center shadow-2xl">
                    <div className="text-3xl font-extrabold text-rose-400 mb-1">💀 Defeated</div>
                    <div className="opacity-70 text-sm">Respawning at base…</div>
                  </div>
                </div>
              )}

              {/* Duel result banner */}
              {duel.result && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <div className="px-10 py-8 rounded-2xl bg-[#0c1219]/95 ring-1 ring-white/15 text-center shadow-2xl">
                    <div className={`text-4xl font-extrabold mb-2 ${duel.result === 'win' ? 'text-amber-300' : 'text-rose-400'}`}>
                      {duel.result === 'win' ? '🏆 Victory' : '☠️ Defeat'}
                    </div>
                    <div className="text-lg font-bold tabular-nums mb-1"><span className="text-amber-300">{duel.myScore}</span> <span className="opacity-50">—</span> <span className="text-rose-300">{duel.oppScore}</span></div>
                    <div className="opacity-70 text-sm mb-4">{duel.result === 'win' ? `Best of ${duel.winTarget * 2 - 1} — you won the match.` : 'Your rival won the match.'}</div>
                    <button onClick={() => { duel.leave(); setDuelLobbyOpen(false); }} className="px-6 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 font-bold">Close</button>
                  </div>
                </div>
              )}

              {/* ── 1v1v1 MOBA: launcher + lobby + scoreboard + result ─────────── */}
              {mobaMode && (
                <button
                  onClick={() => setMobaLobbyOpen(o => !o)}
                  className={`fixed top-16 right-3 z-40 px-3 py-1.5 rounded-lg text-sm font-bold shadow-lg ring-1 transition pointer-events-auto ${
                    mobaActive ? 'bg-emerald-800/90 ring-emerald-400 text-emerald-50' : 'bg-[#141b26]/90 ring-white/15 text-gray-200 hover:ring-emerald-400/60'
                  }`}
                >🌍 MOBA{mobaActive ? ' •' : ''}</button>
              )}

              {/* Shared 3-faction scoreboard (top-center) while a match is live. */}
              {mobaMode && mobaActive && (
                <div className="fixed top-12 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#0c1219]/90 ring-1 ring-white/12 shadow-lg">
                    {(['PAA','ASF','WC'] as Faction[]).map(f => (
                      <div key={f} className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg ${moba.myFaction === f ? 'bg-white/10 ring-1 ring-white/25' : ''}`}>
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: FACTION_COLORS[f].primary }} />
                        <span className="text-[11px] font-bold" style={{ color: FACTION_COLORS[f].label }}>{f}</span>
                        <span className="text-sm font-extrabold tabular-nums text-white">{moba.scores[f] ?? 0}</span>
                      </div>
                    ))}
                    <span className="text-[10px] opacity-50 ml-1">/ 300</span>
                  </div>
                </div>
              )}

              {mobaMode && mobaLobbyOpen && (
                <div className="fixed top-28 right-3 z-40 w-[min(20rem,92vw)] p-4 rounded-xl bg-[#0c1219]/95 ring-1 ring-white/12 shadow-2xl text-sm text-gray-100 space-y-3 pointer-events-auto">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">🌍 1v1v1 MOBA</span>
                    <button onClick={() => setMobaLobbyOpen(false)} className="opacity-60 hover:opacity-100">✕</button>
                  </div>

                  {(moba.status === 'idle' || moba.status === 'error') && (
                    <>
                      <div className="text-[11px] opacity-60">Pick your faction — the 3rd is played by AI.</div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(['PAA','ASF','WC'] as Faction[]).map(f => {
                          const taken = mobaTakenFactions.has(f);
                          const sel = mobaFactionPick === f;
                          return (
                            <button
                              key={f}
                              disabled={taken}
                              onClick={() => setMobaFactionPick(f)}
                              title={FACTION_LABEL[f]}
                              className={`py-2 rounded-lg text-xs font-bold ring-1 transition disabled:opacity-30 ${sel ? 'ring-2' : 'ring-white/15 hover:ring-white/40'}`}
                              style={sel ? { background: FACTION_COLORS[f].secondary, boxShadow: `inset 0 0 0 2px ${FACTION_COLORS[f].primary}`, color: FACTION_COLORS[f].label } : { color: FACTION_COLORS[f].label }}
                            >{f}{taken ? ' 🔒' : ''}</button>
                          );
                        })}
                      </div>
                      <button onClick={() => moba.host(mobaFactionPick)} className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold">Host a match</button>
                      <div className="text-[11px] opacity-50 text-center">— or join a friend's code —</div>
                      <div className="flex gap-1.5">
                        <input
                          value={mobaJoinCode}
                          onChange={(e) => setMobaJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
                          maxLength={5}
                          placeholder="CODE"
                          className="flex-1 min-w-0 px-2 py-2 rounded-lg bg-black/40 ring-1 ring-white/15 uppercase tracking-widest font-mono text-center"
                        />
                        <button onClick={() => moba.join(mobaJoinCode, mobaFactionPick)} disabled={mobaJoinCode.length < 4} className="px-3 py-2 rounded-lg bg-indigo-700 hover:bg-indigo-600 font-bold disabled:opacity-40">Join</button>
                      </div>
                      {moba.status === 'error' && <div className="text-[11px] text-rose-400">Couldn't connect — try again or check the code.</div>}
                    </>
                  )}

                  {moba.status === 'joining' && (
                    <div className="text-center text-[12px] opacity-70 animate-pulse py-2">Connecting to {moba.code}…</div>
                  )}

                  {/* Lobby (pre-match): roster + host controls. */}
                  {(moba.status === 'hosting' || moba.status === 'lobby') && (
                    <div className="space-y-2">
                      {moba.role === 'host' && moba.code && (
                        <div className="space-y-1">
                          <div className="text-[11px] opacity-60">Share this code:</div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 select-all text-2xl font-mono font-bold tracking-[0.3em] text-emerald-300 py-1.5 text-center rounded-lg bg-black/40 ring-1 ring-emerald-400/40">{moba.code}</div>
                            <button onClick={() => copyMobaCode(moba.code)} className="px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 font-bold text-sm">{mobaCodeCopied ? '✓' : 'Copy'}</button>
                          </div>
                        </div>
                      )}
                      {/* Change your faction in the lobby (locked out if a rival already took it). */}
                      <div className="text-[11px] uppercase tracking-wide opacity-50">Your faction</div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(['PAA','ASF','WC'] as Faction[]).map(f => {
                          const taken = mobaTakenFactions.has(f);
                          const sel = moba.myFaction === f;
                          return (
                            <button
                              key={f}
                              disabled={taken && !sel}
                              onClick={() => moba.setFaction(f)}
                              title={FACTION_LABEL[f]}
                              className={`py-1.5 rounded-lg text-xs font-bold ring-1 transition disabled:opacity-30 ${sel ? 'ring-2' : 'ring-white/15 hover:ring-white/40'}`}
                              style={sel ? { background: FACTION_COLORS[f].secondary, boxShadow: `inset 0 0 0 2px ${FACTION_COLORS[f].primary}`, color: FACTION_COLORS[f].label } : { color: FACTION_COLORS[f].label }}
                            >{f}{taken && !sel ? ' 🔒' : ''}</button>
                          );
                        })}
                      </div>
                      <div className="text-[11px] uppercase tracking-wide opacity-50">Players</div>
                      <div className="space-y-1">
                        {moba.players.map(p => (
                          <div key={p.uid} className="flex items-center gap-2 text-xs">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: FACTION_COLORS[p.faction]?.primary }} />
                            <span className="font-semibold" style={{ color: FACTION_COLORS[p.faction]?.label }}>{p.faction}</span>
                            <span className="opacity-70 truncate">{p.displayName || (p.uid === moba.myUid ? 'You' : p.uid.slice(0, 6))}</span>
                            {p.isHost && <span className="ml-auto text-[10px] px-1 rounded bg-white/10">HOST</span>}
                          </div>
                        ))}
                        {(['PAA','ASF','WC'] as Faction[]).filter(f => !moba.players.some(p => p.faction === f)).map(f => (
                          <div key={f} className="flex items-center gap-2 text-xs opacity-50">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: FACTION_COLORS[f].primary }} />
                            <span className="font-semibold">{f}</span>
                            <span className="ml-auto text-[10px] px-1 rounded bg-white/10">🤖 AI</span>
                          </div>
                        ))}
                      </div>
                      {moba.role === 'host' ? (() => {
                        const dupFactions = new Set(moba.players.map(p => p.faction)).size !== moba.players.length;
                        const notReady = outposts.size === 0 || dupFactions;
                        return (
                          <>
                            <button
                              onClick={() => moba.startMatch(Array.from(outposts.values()).map(o => ({ key: o.key, q: o.q, r: o.r, region: o.region, owner: 'neutral' as const })))}
                              disabled={notReady}
                              className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold disabled:opacity-40"
                            >{outposts.size === 0 ? 'Loading map…' : 'Start Match'}</button>
                            {dupFactions && <div className="text-[11px] text-amber-400 text-center">Two players share a faction — pick distinct factions to start.</div>}
                          </>
                        );
                      })() : (
                        <div className="text-[11px] text-center opacity-60 animate-pulse py-1">Waiting for the host to start…</div>
                      )}
                      <button onClick={() => moba.leave()} className="w-full py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs">Leave</button>
                    </div>
                  )}

                  {mobaActive && (
                    <div className="space-y-2">
                      <div className="text-center text-emerald-400 font-bold text-[13px]">Match live — {FACTION_LABEL[moba.myFaction ?? 'PAA']}</div>
                      <div className="text-[11px] opacity-70 text-center">Get adjacent to an outpost & press <span className="px-1 rounded bg-white/10 font-bold">G</span> to capture. Reach 300 to win.</div>
                      <button onClick={() => moba.leave()} className="w-full py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs">Leave match</button>
                    </div>
                  )}
                </div>
              )}

              {/* MOBA result banner */}
              {mobaMode && moba.result && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <div className="px-10 py-8 rounded-2xl bg-[#0c1219]/95 ring-1 ring-white/15 text-center shadow-2xl">
                    <div className={`text-4xl font-extrabold mb-2 ${moba.result === 'win' ? 'text-emerald-300' : 'text-rose-400'}`}>
                      {moba.result === 'win' ? '🏆 Victory' : '☠️ Defeat'}
                    </div>
                    <div className="opacity-80 text-sm mb-1">{moba.winner ? `${FACTION_LABEL[moba.winner]} controls the region.` : ''}</div>
                    <div className="flex items-center justify-center gap-3 my-3">
                      {(['PAA','ASF','WC'] as Faction[]).map(f => (
                        <div key={f} className="text-center">
                          <div className="text-[10px] font-bold" style={{ color: FACTION_COLORS[f].label }}>{f}</div>
                          <div className="text-lg font-extrabold tabular-nums">{moba.scores[f] ?? 0}</div>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => { moba.leave(); setMobaLobbyOpen(false); }} className="px-6 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 font-bold">Close</button>
                  </div>
                </div>
              )}

              {/* Nearby collectible prompt (flower / mushroom / resource node) */}
              {(nearbyFlower || nearbyMushroom || nearbyResource) && (
                <div className="fixed bottom-56 left-1/2 -translate-x-1/2 animate-bounce">
                  <div className="relative px-6 py-3 rounded-xl bg-emerald-900/80 border border-emerald-400/60 text-sm font-semibold text-emerald-100 backdrop-blur-sm shadow-lg overflow-hidden">
                    {(collectingFlower || collectingMushroom || collectingResource) && (
                      <div className="absolute inset-0 rounded-xl pointer-events-none" style={{
                        background: `conic-gradient(#10b981 ${collectingProgress * 360}deg, transparent 0)`,
                      }} />
                    )}
                    <div className="relative z-10 flex items-center gap-2">
                      {nearbyFlower ? '🌸 Flower'
                        : nearbyMushroom ? '🍄 Mushroom'
                        : nearbyResource ? `${RESOURCE_DEFS[nearbyResource.type].icon} ${RESOURCE_DEFS[nearbyResource.type].label}`
                        : ''} Press <span className="px-1.5 py-0.5 rounded bg-emerald-700 font-bold">C</span> to Collect
                      {(collectingFlower || collectingMushroom || collectingResource) && <span className="ml-1 text-xs text-emerald-300">{Math.round(collectingProgress * 100)}%</span>}
                    </div>
                  </div>
                </div>
              )}

              {/* Game HUD with XP, abilities, and inventory */}
              {coarsePointer && <TouchControls />}
              <GameHUD
                team={factionName || "radiant"}
                clock={elapsedTime || new Date().toLocaleTimeString()}
                score={{ radiant: 0, dire: 0 }}
                hero={(() => {
                  // Hero XP is cumulative; use the monotonic live mirror so the ring/bar/
                  // level track every gain and never flicker down from a save race.
                  const total = Math.floor(heroXpLive);
                  const lvl = Math.max(1, getLevelFromXp(total));
                  const max = Math.max(1, getXpForNextLevel(lvl));
                  const cur = Math.max(0, Math.min(max, total - getTotalXpForLevel(lvl)));
                  return {
                    name: heroVitals?.name ?? 'Hero',
                    level: lvl,
                    hp: heroVitals?.hp ?? { current: 100, max: 100 },
                    ep: heroVitals?.ep ?? { current: 50, max: 50 },
                    xp: { current: cur, max },
                    portraitUrl: heroVitals?.portraitUrl,
                    buffs: heroVitals?.buffs,
                  };
                })()}
                pet={(() => {
                  // Pet level/XP come from the live usePetXP state (petXp is the remainder
                  // within the current level; xpToNext is the level's requirement).
                  const lvl = petXPSystem.petLevel;
                  const max = Math.max(1, petXPSystem.xpToNext || 1);
                  const cur = Math.max(0, Math.min(max, Math.floor(petXPSystem.petXp)));
                  return {
                    name: petData?.name ?? (isDog ? 'Cyber-Dog' : 'Cyber-Cat'),
                    level: lvl,
                    hp: petData?.hp ?? { current: 50, max: 50 },
                    ep: petData?.ep ?? { current: 25, max: 25 },
                    xp: { current: cur, max },
                    icon: petData?.icon ?? '🐾',
                    portraitUrl: petData?.portraitUrl,
                  };
                })()}
                abilities={abilitySlots}
                defensiveAbilities={defenseSlots}
                abilityMode={abilityMode}
                onSetAbilityMode={setAbilityMode}
                showOutpostZones={showOutpostZones}
                onToggleOutpostZones={() => setShowOutpostZones(v => !v)}
                onTransferToPet={(type: string) => transferItem(type, 'toPet')}
                onTransferToHero={(type: string) => transferItem(type, 'toHero')}
                heroStats={combatStats}
                onAbility={activateAbility}
                onItem={(id: string) => { const idx = itemSlots.findIndex(s => s.id === id); if (idx >= 0) handleItemUse(idx); }}
                items={itemSlots}
                resources={[{ id: 'shards', label: 'Faction Points', value: (profile?.progress as any)?.factionPoints ?? 0, icon: '✦' }, ...(resources || [])]}
                skillTokens={skillTokens || 0}
                petTokens={0}
                minimapData={minimapData}
                onMenu={onExit}
                onSave={autoMultiplayer ? undefined : () => {
                  // Explicit "Save Game" (solo only): flush a full live snapshot so the
                  // player can quit and resume exactly where they left off. Mirrors the
                  // auto-save fields but bundles them into one write on demand. Disabled
                  // in multiplayer duels where the arena position isn't meaningful to save.
                  try {
                    const s = useSkillStore.getState();
                    const lvl = Math.max(1, getLevelFromXp(Math.floor(heroXpLive)), s.level);
                    s.setLevel(lvl);
                    saveProgress({
                      heroPosition: { q: heroPosRef.current.q, r: heroPosRef.current.r },
                      hero: { xp: Math.floor(heroXpLive), level: lvl, unlockedSkillIds: s.unlocked, unlockOrder: s.unlockOrder },
                      heroInventory: localHeroInventory as any,
                      petInventory: localPetInventory as any,
                      explored: Array.from(exploredRef.current),
                    });
                  } catch {}
                }}
                skillPoints={skillPoints}
                totalPlayTime={totalPlayTime}
                heroInventory={localHeroInventory}
                petInventory={localPetInventory}
                playerProfile={playerProfile}
                onTalents={() => {
                  // Auto-save the live progression BEFORE leaving the mission for the skill
                  // tree, via the shared profile (correct XP), and sync the skill-store level
                  // so points are immediately available and nothing resets.
                  try {
                    const s = useSkillStore.getState();
                    const lvl = Math.max(1, getLevelFromXp(Math.floor(heroXpLive)), s.level);
                    s.setLevel(lvl);
                    saveProgress({ hero: { xp: Math.floor(heroXpLive), level: lvl, unlockedSkillIds: s.unlocked, unlockOrder: s.unlockOrder } });
                  } catch {}
                  onOpenSkillTree?.();
                }}
              />
      </div>
    </div>
  );
}

// --- Chunk debug visual (lightweight placeholder before instancing) ---
function ChunkDebugTiles({ heroPos, hexSize }: { heroPos: Axial; hexSize: number }) {
  const useChunks = import.meta.env.VITE_USE_CHUNKS === 'true';
  const viewRadius = 48; // tiles
  const chunkSize = 32;
  const playerCol = heroPos.q; // using axial q,r directly for now
  const playerRow = heroPos.r;
  const { chunks } = useVisibleChunks({ playerCol, playerRow, viewRadiusTiles: viewRadius, chunkSize, enabled: useChunks });
  const ap = hexApothem(hexSize);
  // Pre-cap total tiles to 5000 to avoid mutable counter in render body.
  const cappedChunks = useMemo(() => {
    let count = 0;
    return chunks.map(ch => ({ ...ch, tiles: ch.tiles.filter(() => count++ < 5000) }));
  }, [chunks]);
  return (
    <group name="ChunkDebugTiles">
      {useChunks && cappedChunks.map(ch => (
        <group key={`chunk-${ch.cx}-${ch.cy}`}>
          {ch.tiles.map(t => {
            // Quick axial->world approximation using flat-top assumptions similar to legacy col/row.
            const x = (1.5 * hexSize) * t.col;
            const z = (Math.sqrt(3) * hexSize) * (t.row + (t.col * 0.5));
            let color = '#88aa77';
            switch (t.char) {
              case 'F': color = '#2f6b2f'; break;
              case 'J': color = '#0f5b3f'; break;
              case 'H': color = '#888870'; break;
              case 'D': color = '#d2b070'; break;
              case 'O': case 'M': color = '#777980'; break;
              case 'L': color = '#3aa8d0'; break;
              default: color = '#88aa77';
            }
            const h = (t.char === 'M' ? 2.2 : t.char === 'O' ? 1.6 : t.char === 'H' ? 1.3 : t.char === 'D' ? 0.9 : t.char === 'F' ? 1.0 : t.char === 'J' ? 1.0 : t.char === 'L' ? 0.5 : 0.8) * 0.9 * hexSize;
            return (
              <group key={`t-${t.col}-${t.row}`} position={[x, h/2, z]}>
                <mesh castShadow receiveShadow rotation={[0, Math.PI/6, 0]}>
                  <cylinderGeometry args={[ap*0.98, ap*0.98, h, 6]} />
                  <meshStandardMaterial color={color} />
                </mesh>
              </group>
            );
          })}
        </group>
      ))}
    </group>
  );
}

// Custom camera controller: edge pan & drag (game mode) with optional follow axial coord
function MapCameraController({
  bounds, gameMode, heroWorld, recenterSignal,
  nearbyFlowerRef, nearbyMushroomRef, nearbyResourceRef, collectingFlowerRef, collectingMushroomRef,
  handleCollect,
  abilitySlots, setAbilitySlots,
}: {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY?: number; maxY?: number };
  gameMode: boolean;
  heroWorld?: { x: number; z: number };
  recenterSignal?: number;
  nearbyFlowerRef: React.MutableRefObject<string | null>;
  nearbyMushroomRef: React.MutableRefObject<string | null>;
  nearbyResourceRef: React.MutableRefObject<{ key: string; type: 'ore' | 'energy' | 'bio' } | null>;
  collectingFlowerRef: React.MutableRefObject<string | null>;
  collectingMushroomRef: React.MutableRefObject<string | null>;
  /** Delegated to useCollectibles — starts the 1200 ms collection animation. */
  handleCollect: (flowerKey: string | null, mushroomKey: string | null, resource?: { key: string; type: 'ore' | 'energy' | 'bio' } | null) => void;
  abilitySlots: Ability[];
  setAbilitySlots: React.Dispatch<React.SetStateAction<Ability[]>>;
}) {
  // Keep handleCollect in a ref so the keydown closure never goes stale
  const handleCollectRef = React.useRef(handleCollect);
  handleCollectRef.current = handleCollect;
  const { camera, gl } = useThree();
  const targetRef = React.useRef(new THREE.Vector3(0, 0, 0));
  const offsetRef = React.useRef<THREE.Vector3 | null>(null); // camera.position - target
  const edgeRef = React.useRef({ dx: 0, dy: 0 });
  const dragging = React.useRef(false);
  const altDragging = React.useRef(false); // middle/right
  const lastMouse = React.useRef({ x: 0, y: 0 });
  const dragStartMouse = React.useRef({ x: 0, y: 0 });
  const dragActivated = React.useRef(false); // true once mouse/touch moved ≥4px from start
  const lastTouchDist = React.useRef(0);
  const keysPressed = React.useRef({ ArrowUp: false, ArrowDown: false, PageUp: false, PageDown: false });
  const threshold = 24; // px edge region
  const baseSpeed = 17.5; // halved for slower edge pan
  // Keyboard panning disabled (camera fixed except mouse drag / edge)
  const velocity = React.useRef(new THREE.Vector3()); // world-space velocity applied to target
  const lastMoveFrame = React.useRef(0);
  const frameCount = React.useRef(0);
  // Always-current bounds ref — event-handler closures (useEffect([gameMode])) are stale;
  // reading boundsRef.current avoids the stale-closure + Infinity-bounds dark-screen bug.
  const boundsRef = React.useRef(bounds);
  boundsRef.current = bounds;
  const baseMin = 12;
  const zoomConfig = { min: baseMin, zoomSpeed: 0.12 };
  function currentMaxZoom() {
    const b = boundsRef.current;
    const bw = b.maxX - b.minX;
    const bh = b.maxZ - b.minZ;
    // Use live bounds to compute diagonal; fall back to 250 if bounds are still Infinity (tiles not loaded).
    const diag = (isFinite(bw) && isFinite(bh) && bw > 0) ? Math.sqrt(bw * bw + bh * bh) : 250;
    const aspect = gl.domElement.clientWidth / Math.max(1, gl.domElement.clientHeight);
    const aspectCap = baseMin * 5 * aspect;
    const diagCap = diag * 0.55;
    // Never return less than 2× min so off.setLength() never collapses the offset to (0,0,0).
    return Math.max(baseMin * 2, Math.min(aspectCap, diagCap, 110));
  }

  // Initialize offset and optionally center on heroWorld once tiles/hero provided
  React.useEffect(() => {
    if (!offsetRef.current) {
      offsetRef.current = camera.position.clone().sub(targetRef.current);
    }
    if (heroWorld && offsetRef.current) {
      // Center target on hero and keep same vertical distance
      targetRef.current.set(heroWorld.x, 0, heroWorld.z);
      camera.position.copy(targetRef.current).add(offsetRef.current);
      camera.lookAt(targetRef.current);
    }
  // run when heroWorld first stable
  }, [camera, heroWorld]);

  // Recenter on recenterSignal change (double-tap spacebar)
  React.useEffect(() => {
    if (recenterSignal && heroWorld && offsetRef.current) {
      targetRef.current.set(heroWorld.x, 0, heroWorld.z);
      camera.position.copy(targetRef.current).add(offsetRef.current);
      camera.lookAt(targetRef.current);
    }
  }, [recenterSignal, heroWorld]);

  // Event handlers
  React.useEffect(() => {
    // Shared pan helper used by both mouse and touch drag handlers
    function panCamera(dx: number, dy: number) {
      if (!offsetRef.current) return;
      const off = offsetRef.current;
      const forward = new THREE.Vector3(-off.x, 0, -off.z).normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0,1,0)).normalize();
      const pixelScale = 0.01 * off.length() / 45;
      const move = new THREE.Vector3();
      move.addScaledVector(right, -dx * pixelScale);
      move.addScaledVector(forward, dy * pixelScale);
      targetRef.current.add(move);
      clampTarget();
    }
    function onMouseMove(e: MouseEvent) {
      if (!gameMode) return;
      if (dragging.current || altDragging.current) {
        // Require ≥4px movement from click start before panning starts (prevents
        // accidental panning on normal clicks)
        if (!dragActivated.current) {
          const tdx = e.clientX - dragStartMouse.current.x;
          const tdy = e.clientY - dragStartMouse.current.y;
          if (Math.abs(tdx) < 4 && Math.abs(tdy) < 4) return;
          dragActivated.current = true;
          gl.domElement.style.cursor = 'grabbing';
        }
        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        panCamera(dx, dy);
      }
    }
    function onMouseDown(e: MouseEvent) {
      if (!gameMode) return;
      if (e.button === 0) dragging.current = true; // left
      else if (e.button === 1 || e.button === 2) altDragging.current = true; // mid/right
      lastMouse.current = { x: e.clientX, y: e.clientY };
      dragStartMouse.current = { x: e.clientX, y: e.clientY };
      dragActivated.current = false;
      gl.domElement.style.cursor = 'grab';
      // Suspend edge motion while dragging
      edgeRef.current.dx = 0; edgeRef.current.dy = 0;
    }
    function onMouseUp(e: MouseEvent) {
      if (e.button === 0) dragging.current = false;
      if (e.button === 1 || e.button === 2) altDragging.current = false;
      if (!dragging.current && !altDragging.current) {
        dragActivated.current = false;
        gl.domElement.style.cursor = 'grab';
      }
    }
    function onLeave() { if (!dragging.current && !altDragging.current) { edgeRef.current.dx = 0; edgeRef.current.dy = 0; } }
    function onKeyDown(e: KeyboardEvent) {
      try {
        if (!gameMode) return;
        if (e.key === 'ArrowUp' || e.key === 'PageUp') {
          keysPressed.current.ArrowUp = true;
          keysPressed.current.PageUp = true;
        }
        if (e.key === 'ArrowDown' || e.key === 'PageDown') {
          keysPressed.current.ArrowDown = true;
          keysPressed.current.PageDown = true;
        }
        // 'C' key to collect a nearby flower, mushroom, or resource node (ore/energy/bio)
        // Delegated to useCollectibles hook via handleCollect ref
        if (e.key.toLowerCase() === 'c' && !collectingFlowerRef.current && !collectingMushroomRef.current) {
          handleCollectRef.current(nearbyFlowerRef.current, nearbyMushroomRef.current, nearbyResourceRef.current);
        }
      } catch (err) {
        console.error('[KeybindError]', err);
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        keysPressed.current.ArrowUp = false;
        keysPressed.current.PageUp = false;
      }
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        keysPressed.current.ArrowDown = false;
        keysPressed.current.PageDown = false;
      }
    }
    // ── Touch support (single-finger pan, two-finger pinch-zoom) ─────────────
    function onTouchStart(e: TouchEvent) {
      if (!gameMode) return;
      if (e.touches.length === 1) {
        dragging.current = true;
        lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        dragStartMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        dragActivated.current = false;
        lastTouchDist.current = 0;
      } else if (e.touches.length === 2) {
        dragging.current = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist.current = Math.sqrt(dx * dx + dy * dy);
      }
      edgeRef.current.dx = 0; edgeRef.current.dy = 0;
    }
    function onTouchMove(e: TouchEvent) {
      if (!gameMode) return;
      e.preventDefault();
      if (e.touches.length === 1 && dragging.current) {
        if (!dragActivated.current) {
          const tdx = e.touches[0].clientX - dragStartMouse.current.x;
          const tdy = e.touches[0].clientY - dragStartMouse.current.y;
          if (Math.abs(tdx) < 4 && Math.abs(tdy) < 4) return;
          dragActivated.current = true;
        }
        const dx = e.touches[0].clientX - lastMouse.current.x;
        const dy = e.touches[0].clientY - lastMouse.current.y;
        lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        panCamera(dx, dy);
      } else if (e.touches.length === 2 && offsetRef.current) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (lastTouchDist.current > 0) {
          const ratio = lastTouchDist.current / dist; // pinch in = zoom out
          const off = offsetRef.current;
          const len = off.length();
          const maxZoom = currentMaxZoom();
          const next = THREE.MathUtils.clamp(len * ratio, zoomConfig.min, maxZoom);
          off.multiplyScalar(next / len);
          camera.position.copy(targetRef.current).add(off);
        }
        lastTouchDist.current = dist;
      }
    }
    function onTouchEnd() {
      dragging.current = false;
      dragActivated.current = false;
      lastTouchDist.current = 0;
    }
    function onWheel(e: WheelEvent) {
      try {
        if (!gameMode) return;
        if (!offsetRef.current) return;
        e.preventDefault();
        const off = offsetRef.current;
        const len = off.length();
        const delta = e.deltaY * zoomConfig.zoomSpeed * (len/60);
        const maxZoom = currentMaxZoom();
        const next = THREE.MathUtils.clamp(len + delta, zoomConfig.min, maxZoom);
        // Ray cast from cursor to ground plane (y=0) to find world point under mouse BEFORE zoom
        const rect = gl.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -(((e.clientY - rect.top) / rect.height) * 2 - 1)
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, camera);
        const planeY0 = new THREE.Plane(new THREE.Vector3(0,1,0), 0); // y=0
        const hit = new THREE.Vector3();
        raycaster.ray.intersectPlane(planeY0, hit);
        // Scale offset to new distance preserving direction
        const ratio = next / len;
        off.multiplyScalar(ratio);
        // After zoom, compute new ray to same screen point to preserve focus
        camera.position.copy(targetRef.current).add(off);
        camera.updateMatrixWorld();
        raycaster.setFromCamera(ndc, camera);
        const newHit = new THREE.Vector3();
        raycaster.ray.intersectPlane(planeY0, newHit);
        if (hit.lengthSq() > 0 && newHit.lengthSq() > 0) {
          // Adjust target by the delta so the point under cursor remains stable
          const adjust = hit.clone().sub(newHit);
          targetRef.current.add(adjust);
          clampTarget();
          camera.position.copy(targetRef.current).add(off);
        }
      } catch (err) {
        console.error('[ZoomError]', err);
      }
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mouseleave', onLeave);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // Touch events on canvas element (needs { passive: false } so touchmove can preventDefault)
    gl.domElement.addEventListener('touchstart', onTouchStart, { passive: true });
    gl.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    gl.domElement.addEventListener('touchend', onTouchEnd);
    // Default grab cursor
    gl.domElement.style.cursor = 'grab';
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('wheel', onWheel as any);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      gl.domElement.removeEventListener('touchstart', onTouchStart);
      gl.domElement.removeEventListener('touchmove', onTouchMove);
      gl.domElement.removeEventListener('touchend', onTouchEnd);
      gl.domElement.style.cursor = '';
    };
  // NOTE: abilitySlots intentionally omitted — unused in these handlers.
  }, [gameMode]);

  function clampTarget() {
    const b = boundsRef.current;
    // Skip clamping entirely while bounds are still Infinity (tiles not yet loaded);
    // applying Infinity/−Infinity bounds pushes the target to −∞, causing a black screen.
    if (!isFinite(b.minX) || !isFinite(b.maxX) || !isFinite(b.minZ) || !isFinite(b.maxZ)) return;
    const t = targetRef.current;
    t.x = Math.min(b.maxX, Math.max(b.minX, t.x));
    t.z = Math.min(b.maxZ, Math.max(b.minZ, t.z));
    // Clamp Y (vertical camera movement) if bounds provided
    if (b.minY !== undefined && b.maxY !== undefined) {
      t.y = Math.min(b.maxY, Math.max(b.minY, t.y));
    }
    // Also keep the camera body (position = target + offset) within map bounds
    if (offsetRef.current) {
      const ox = offsetRef.current.x;
      const oz = offsetRef.current.z;
      const cx = t.x + ox;
      const cz = t.z + oz;
      if (cx < b.minX) t.x += b.minX - cx;
      else if (cx > b.maxX) t.x -= cx - b.maxX;
      if (cz < b.minZ) t.z += b.minZ - cz;
      else if (cz > b.maxZ) t.z -= cz - b.maxZ;
    }
  }

  useFrame((_, delta) => {
    if (!gameMode) return;
    if (!offsetRef.current) {
      // Initialize offset if missing (prevents white screen)
      offsetRef.current = new THREE.Vector3(0, 22, 22);
      camera.position.copy(targetRef.current).add(offsetRef.current);
      camera.lookAt(targetRef.current);
      return;
    }
    const off = offsetRef.current;
    // Validate offset is not NaN (prevents white screen)
    if (!Number.isFinite(off.length())) {
      offsetRef.current.set(0, 22, 22);
      camera.position.copy(targetRef.current).add(offsetRef.current);
      camera.lookAt(targetRef.current);
      return;
    }
    // Follow mode removed; camera target only changes via edge/drag inertia
    let appliedAny = false;
    
    // Keyboard vertical panning (Y-axis movement)
    const verticalSpeed = 20; // units per second
    if (keysPressed.current.ArrowUp || keysPressed.current.PageUp) {
      targetRef.current.y += verticalSpeed * delta;
      appliedAny = true;
    }
    if (keysPressed.current.ArrowDown || keysPressed.current.PageDown) {
      targetRef.current.y -= verticalSpeed * delta;
      appliedAny = true;
    }
    // Clamp vertical movement to bounds
    if (appliedAny && (bounds.minY !== undefined && bounds.maxY !== undefined)) {
      targetRef.current.y = Math.min(bounds.maxY, Math.max(bounds.minY, targetRef.current.y));
    }
    
    // Camera moves only via drag / scroll — no edge panning
    // Keyboard panning removed
    // Inertia: if no inputs & velocity remains, apply damping
    if (!appliedAny && !dragging.current && velocity.current.lengthSq() > 0.0001) {
      const damping = Math.pow(0.92, (delta * 60)); // frame-rate independent damping (~8% loss per 1/60s)
      velocity.current.multiplyScalar(damping);
      const move = velocity.current.clone().multiplyScalar(delta);
      targetRef.current.add(move);
      clampTarget();
      // Zero out when very small
      if (velocity.current.length() < 0.02) velocity.current.set(0,0,0);
    }
    // Keep camera offset constant relative to target
    // Clamp zoom distance each frame in case window resized changed max
    const maxAllowed = currentMaxZoom();
    if (off.length() > maxAllowed) {
      off.setLength(maxAllowed);
    }
    camera.position.copy(targetRef.current).add(off);
    camera.lookAt(targetRef.current);
  });

  // Prevent context menu interfering with drag
  React.useEffect(() => {
    function onCtx(e: MouseEvent) { if (dragging.current) { e.preventDefault(); e.stopPropagation(); } }
    window.addEventListener('contextmenu', onCtx, { capture: true });
    return () => window.removeEventListener('contextmenu', onCtx, { capture: true } as any);
  }, []);

  return null;
}
