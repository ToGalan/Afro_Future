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
import { useRefugeeCamps } from '../hooks/useRefugeeCamps';
import { useDuel } from '../hooks/useDuel';
import { watchOpenRooms } from '../services/duelSignaling';
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
            {/* Body */}
            <mesh position={[0, cs * 0.95, 0]} castShadow>
              <icosahedronGeometry args={[cs * 0.7, 0]} />
              <meshStandardMaterial color="#5a2233" roughness={0.7} emissive="#3a0d18" emissiveIntensity={0.35} flatShading />
            </mesh>
            {/* Glowing eyes */}
            <mesh position={[cs * 0.22, cs * 1.05, cs * 0.5]}><sphereGeometry args={[cs * 0.1, 6, 6]} /><meshBasicMaterial color="#ff3b3b" /></mesh>
            <mesh position={[-cs * 0.22, cs * 1.05, cs * 0.5]}><sphereGeometry args={[cs * 0.1, 6, 6]} /><meshBasicMaterial color="#ff3b3b" /></mesh>
            {/* Horns */}
            <mesh position={[cs * 0.32, cs * 1.4, -cs * 0.1]} rotation={[0, 0, -0.5]} castShadow><coneGeometry args={[cs * 0.12, cs * 0.5, 5]} /><meshStandardMaterial color="#2a0e16" roughness={0.8} flatShading /></mesh>
            <mesh position={[-cs * 0.32, cs * 1.4, -cs * 0.1]} rotation={[0, 0, 0.5]} castShadow><coneGeometry args={[cs * 0.12, cs * 0.5, 5]} /><meshStandardMaterial color="#2a0e16" roughness={0.8} flatShading /></mesh>
            {/* Back spikes */}
            {[0.15, -0.15].map((sx, si) => (
              <mesh key={si} position={[cs * sx, cs * 1.25, -cs * 0.5]} rotation={[-0.6, 0, 0]} castShadow><coneGeometry args={[cs * 0.09, cs * 0.36, 4]} /><meshStandardMaterial color="#3a1622" roughness={0.85} flatShading /></mesh>
            ))}
            {/* Clawed arms */}
            <mesh position={[cs * 0.6, cs * 0.85, cs * 0.1]} rotation={[0, 0, -0.9]} castShadow><cylinderGeometry args={[cs * 0.09, cs * 0.11, cs * 0.7, 5]} /><meshStandardMaterial color="#4a1c2b" roughness={0.75} flatShading /></mesh>
            <mesh position={[-cs * 0.6, cs * 0.85, cs * 0.1]} rotation={[0, 0, 0.9]} castShadow><cylinderGeometry args={[cs * 0.09, cs * 0.11, cs * 0.7, 5]} /><meshStandardMaterial color="#4a1c2b" roughness={0.75} flatShading /></mesh>
            {/* Legs */}
            <mesh position={[cs * 0.26, cs * 0.32, 0]} castShadow><cylinderGeometry args={[cs * 0.1, cs * 0.1, cs * 0.64, 5]} /><meshStandardMaterial color="#3a1622" flatShading /></mesh>
            <mesh position={[-cs * 0.26, cs * 0.32, 0]} castShadow><cylinderGeometry args={[cs * 0.1, cs * 0.1, cs * 0.64, 5]} /><meshStandardMaterial color="#3a1622" flatShading /></mesh>
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
  const tent = (x: number, z: number, rot: number, col: string) => (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <mesh position={[0, S * 0.32, 0]} castShadow><coneGeometry args={[S * 0.42, S * 0.64, 4]} /><meshStandardMaterial color={col} roughness={0.9} flatShading /></mesh>
    </group>
  );
  return (
    <group>
      {tent(-S * 0.5, 0, Math.PI / 4, tents[0])}
      {tent(S * 0.55, S * 0.2, -Math.PI / 5, tents[1])}
      {tent(0, -S * 0.6, Math.PI / 3, tents[2])}
      {/* campfire */}
      <mesh position={[0, S * 0.06, S * 0.35]}><cylinderGeometry args={[S * 0.18, S * 0.22, S * 0.08, 6]} /><meshStandardMaterial color="#3a2a1e" roughness={1} /></mesh>
      <mesh ref={fireRef} position={[0, S * 0.22, S * 0.35]}><coneGeometry args={[S * 0.1, S * 0.28, 5]} /><meshBasicMaterial color={flame} /></mesh>
      <Text position={[0, S * 1.8, 0]} fontSize={S * 0.3} color={titleCol} anchorX="center" anchorY="middle" outlineWidth={S * 0.03} outlineColor="#000">
        {done ? 'Camp Cleared ✓' : `${icon} ${label}`}
      </Text>
      {!done && subtitle && (
        <Text position={[0, S * 1.45, 0]} fontSize={S * 0.22} color="#e8e0d0" anchorX="center" anchorY="middle" outlineWidth={S * 0.02} outlineColor="#000">{subtitle}</Text>
      )}
    </group>
  );
}

// Control-zone perimeter around an outpost — a flat ring on the ground showing the
// area of influence. Player-owned zones glow in the faction colour; neutral ones are
// a dim grey. Toggled from the HUD ("Zones" button).
function OutpostZoneRing({ size, owned, color }: { size: number; owned: boolean; color: string }) {
  const R = size * 3.4;            // ~2 hex rings of influence
  const tint = owned ? color : '#8a8f96';
  return (
    <group position={[0, 0.46, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* filled disc (subtle) */}
      <mesh renderOrder={1}>
        <circleGeometry args={[R, 48]} />
        <meshBasicMaterial color={tint} transparent opacity={owned ? 0.12 : 0.05} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* perimeter band */}
      <mesh renderOrder={2}>
        <ringGeometry args={[R * 0.92, R, 48]} />
        <meshBasicMaterial color={tint} transparent opacity={owned ? 0.9 : 0.4} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
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
  heroAttack = 8,
  combatStats,
  heroAvatar,
  autoMultiplayer,
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
  /** Hero attack stat — creep-camp combat damage per tick. */
  heroAttack?: number;
  /** Combat stats (atk/def/spd) shown in the in-game menu overview. */
  combatStats?: { atk: number; def: number; spd: number };
  /** Active loadout passed from App — used as the source of truth for avatar data
   *  so changes in the configurator reflect immediately without a page reload. */
  heroAvatar?: CharacterLoadout | null;
  /** Launched from the dashboard's Multiplayer mode — auto-open the duel lobby + quick-match. */
  autoMultiplayer?: boolean;
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
  // Player profile (anonymous auth + progress)
    const { profile, loading: profileLoading, saveProgress } = usePlayerProfile();
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

  // ── Creep camps ─────────────────────────────────────────────────────────────
  // Award hero XP (preserving skill data) — used by creep-camp clears.
  const profileForXpRef = React.useRef(profile);
  profileForXpRef.current = profile;
  const awardHeroXp = React.useCallback((amount: number) => {
    const prof = profileForXpRef.current;
    const heroXp = prof?.progress?.hero?.xp ?? 0;
    const heroLevel = prof?.progress?.hero?.level ?? 1;
    const newXp = heroXp + amount;
    const newLevel = Math.max(heroLevel, getLevelFromXp(newXp));
    saveProgress({
      hero: {
        traits: prof?.progress?.hero?.traits ?? [],
        unlockedSkillIds: prof?.progress?.hero?.unlockedSkillIds ?? [],
        unlockOrder: prof?.progress?.hero?.unlockOrder ?? [],
        ...prof?.progress?.hero,
        xp: newXp,
        level: newLevel,
      },
    });
  }, [saveProgress]);

  // Floating combat numbers (damage counters).
  const [combatTexts, setCombatTexts] = React.useState<Array<{ id: number; x: number; z: number; text: string; color: string }>>([]);
  const nextTextId = React.useRef(0);
  const spawnCombatText = React.useCallback((x: number, z: number, text: string, color: string) => {
    const id = nextTextId.current++;
    setCombatTexts(prev => [...prev.slice(-14), { id, x, z, text, color }]);
  }, []);

  // Award Faction Points (persisted) — earned from faction activities (creep clears, resources).
  const awardFactionPoints = React.useCallback((amount: number) => {
    const cur = profileForXpRef.current?.progress?.factionPoints ?? 0;
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

  const { camps: creepCamps, nearbyCamp: nearbyCreepCamp, attackNearby: attackNearbyCamp } = useCreeps({
    tiles,
    heroQ: hero.pos.q,
    heroR: hero.pos.r,
    centerQ: centerAxial.q,
    centerR: centerAxial.r,
    heroAttack: Math.round((heroAttack + petCombatBonus) * combatAtkMult),
    incomingDamageScale: combatIncomingScale,
    onHeroDamage: (amt) => onDamageHP?.(amt),
    awardXp: awardHeroXp,
    awardShards: awardFactionPoints, // camp clears grant Faction Points
    onCombat: ({ campQ, campR, toCreep, toHero }) => {
      if (toCreep > 0) { const cw = axialToWorld({ q: campQ, r: campR }, hexSize); spawnCombatText(cw.x, cw.z, `-${toCreep}`, '#ffd24a'); }
      if (toHero > 0) { const hw = axialToWorld({ q: hero.pos.q, r: hero.pos.r }, hexSize); spawnCombatText(hw.x, hw.z, `-${toHero}`, '#ff5555'); } },
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
        if (np >= 100 && p < 100) { awardHeroXp(60); awardFactionPoints(5); terraformRegion(); console.log('[terraform] Region terraformed! +60 XP, +5 FP'); }
        return np;
      });
    }
  };

  // ── Outposts / region control ────────────────────────────────────────────────
  const { outposts, nearbyOutpost, captureNearby, control: outpostControl } = useOutposts({
    tiles,
    heroQ: hero.pos.q,
    heroR: hero.pos.r,
    centerQ: centerAxial.q,
    centerR: centerAxial.r,
    onCapture: (_region, regionCleared) => { awardFactionPoints(regionCleared ? 6 : 2); awardHeroXp(regionCleared ? 40 : 15); },
  });
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

  const { camps: refugeeCamps, nearbyCamp: nearbyRefugeeCamp, deliverToNearby: deliverRefugee, lootNearby: lootRefugee, progress: refugeeProgress } = useRefugeeCamps({
    tiles,
    heroQ: hero.pos.q,
    heroR: hero.pos.r,
    centerQ: centerAxial.q,
    centerR: centerAxial.r,
    faction: factionName,
    onComplete: (camp) => {
      // AID: standing only (the resources were the cost). LOOT: seize the rival's cache.
      if (camp.mode === 'loot' && camp.loot.amount > 0) {
        grantResource(camp.loot.resource, camp.loot.amount);
        const cw = axialToWorld({ q: camp.q, r: camp.r }, hexSize);
        spawnCombatText(cw.x, cw.z, `+${camp.loot.amount} ${RESOURCE_DEFS[camp.loot.resource].label}`, '#ffd24a');
      } else {
        const cw = axialToWorld({ q: camp.q, r: camp.r }, hexSize);
        spawnCombatText(cw.x, cw.z, `Camp aided ✓`, '#7fd66b');
      }
      awardHeroXp(camp.reward.xp);
      awardFactionPoints(camp.reward.fp);
    },
  });

  // Interact with the nearby refugee camp (H): loot rivals in one action; for your own
  // faction's camp, deliver as much of the required resource as you're carrying.
  const localHeroInventoryRef = React.useRef(localHeroInventory); localHeroInventoryRef.current = localHeroInventory;
  const nearbyRefugeeCampRef = React.useRef(nearbyRefugeeCamp); nearbyRefugeeCampRef.current = nearbyRefugeeCamp;
  const handleRefugeeInteract = React.useCallback(() => {
    const camp = nearbyRefugeeCampRef.current;
    if (!camp) return;
    if (camp.mode === 'loot') { lootRefugee(); return; }
    // Aid: deliver held units of the required resource.
    const resType = camp.required.resource;
    const held = localHeroInventoryRef.current.filter(i => i.type === resType).reduce((s, i) => s + (i.quantity || 0), 0);
    const need = Math.max(0, camp.required.amount - camp.delivered);
    const give = Math.min(held, need);
    const hw = axialToWorld({ q: hero.pos.q, r: hero.pos.r }, hexSize);
    if (give <= 0) {
      spawnCombatText(hw.x, hw.z, `Need ${need} ${RESOURCE_DEFS[resType].label}`, '#ff8888');
      return;
    }
    // Consume exactly `give` of the resource from the hero inventory.
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
  }, [deliverRefugee, lootRefugee, hexSize, setLocalHeroInventory]);

  // Refs so the keydown handler always calls the current actions.
  const investTerraformRef = React.useRef(investTerraform); investTerraformRef.current = investTerraform;
  const captureNearbyRef = React.useRef(captureNearby); captureNearbyRef.current = captureNearby;
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

  // ── 1v1 PvP duel (WebRTC data channel, Firestore-signaled) ───────────────────
  const [duelLobbyOpen, setDuelLobbyOpen] = useState(false);
  const [duelJoinCode, setDuelJoinCode] = useState('');
  const [duelDeathReported, setDuelDeathReported] = useState(false);
  const [duelWaiting, setDuelWaiting] = useState(0); // players in the matchmaking queue
  const duel = useDuel({
    onHit: (dmg) => {
      onDamageHP?.(dmg);
      const hw = axialToWorld({ q: hero.pos.q, r: hero.pos.r }, hexSize);
      spawnCombatText(hw.x, hw.z, `-${dmg}`, '#ff5555');
    },
  });
  const { active: duelActive, remote: duelRemote, sendState: duelSendState, reportLocalDeath: duelReportDeath, attackRemote: duelAttackRemote } = duel;

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

  // Broadcast our hero snapshot to the opponent while connected. (The actual effect is
  // declared further down, after the hero render fields it reads are in scope.)
  const duelSendStateRef = React.useRef(duelSendState); duelSendStateRef.current = duelSendState;

  // Announce our own death once (defender-authoritative → opponent wins).
  React.useEffect(() => {
    const hp = heroVitals?.hp.current ?? 1;
    if (duelActive && !duelDeathReported && hp <= 0) { duelReportDeath(); setDuelDeathReported(true); }
    else if (hp > 0 && duelDeathReported) setDuelDeathReported(false);
  }, [duelActive, duelDeathReported, heroVitals?.hp.current, duelReportDeath]);

  // Attack the opposing player if they're adjacent (invoked from the F key).
  const duelFightRef = React.useRef<() => void>(() => {});
  duelFightRef.current = () => {
    if (!duelActive || !duelRemote) return;
    if (axialDistance(hero.pos, duelRemote.pos) > 1) return;
    const dmg = Math.max(1, Math.round((heroAttack + petCombatBonus) * combatAtkMult));
    duelAttackRemote(dmg);
    const rw = axialToWorld(duelRemote.pos, hexSize);
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

  // Activate an ability by id (shared by QWER keys and HUD clicks) — respects
  // cooldown and applies defensive effects.
  const activateAbility = React.useCallback((id: string) => {
    const ability = abilitySlotsRef.current.find(a => a.id === id);
    if (!ability || (ability.cooldown ?? 0) !== 0) return;
    setActiveSlotsRef.current(prev => prev.map(a => a.id === id ? { ...a, cooldown: a.maxCooldown } : a));
    if (id === 'heal') onHealHP?.(25);
    else if (id === 'ward' || id === 'shield') onRestoreEP?.(15);
  }, [onHealHP, onRestoreEP]);

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
  
  // Push minimap data to parent whenever explored / visibility / positions change
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
    });
  // mapBounds and tileTypesMap are stable after initial tile generation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploredCount, minimapVisibleKeys, hero.pos.q, hero.pos.r, pet.pos.q, pet.pos.r, onMapUpdate]);
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

  // Broadcast our hero snapshot to the duel opponent while connected (declared here so
  // the hero render fields — faction/gender/facing/moving — are in scope).
  React.useEffect(() => {
    if (!duelActive) return;
    duelSendStateRef.current({
      pos: hero.pos,
      hp: heroVitals?.hp.current ?? 100,
      maxHp: heroVitals?.hp.max ?? 100,
      faction: heroFaction, gender: heroGender, name: heroVitals?.name,
      moving: isHeroMoving, facing: heroFacingAngle,
    });
  }, [duelActive, hero.pos, heroVitals?.hp.current, heroVitals?.hp.max, heroVitals?.name, isHeroMoving, heroFacingAngle, heroFaction, heroGender]);
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
      // Teleport to the base/spawn hub and refill HP + EP.
      setHero(h => ({ ...h, pos: { ...baseAxial } }));
      saveProgress({ heroPosition: { ...baseAxial } });
      updateHeroPosition({ ...baseAxial });
      setRecenterSignal(s => s + 1);
      onHealHP?.(999999);
      onRestoreEP?.(999999);
      setDeathBanner(true);
      setTimeout(() => setDeathBanner(false), 1600);
      console.log('[death] Hero defeated — respawned at base');
    } else if (hp > 0 && diedRef.current) {
      diedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroVitals?.hp.current]);
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
  useEffect(() => {
    const downSet = new Set<string>();
    function onKey(e: KeyboardEvent) {
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
            // Pet XP + hero XP gain delegated to usePetXP hook
            petXPSystem.gainXPOnMove(
              profile?.progress?.hero?.xp ?? 0,
              profile?.progress?.hero?.level ?? 1,
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

      // ─── ATTACK NEARBY CREEP CAMP or RIVAL PLAYER (F) — a deliberate choice ─
      if (k === 'f') {
        if (e.repeat) return;
        attackNearbyRef.current();  // creep camp if adjacent
        duelFightRef.current();     // rival duelist if adjacent
        return;
      }
      // ─── TERRAFORM (T) — invest a resource at the terraformer ──────────
      if (k === 't') {
        if (e.repeat) return;
        investTerraformRef.current();
        return;
      }
      // ─── CAPTURE OUTPOST (G) ───────────────────────────────────────────
      if (k === 'g') {
        if (e.repeat) return;
        captureNearbyRef.current();
        return;
      }
      // ─── TOGGLE OUTPOST CONTROL-ZONE OVERLAY (Y) ───────────────────────
      if (k === 'y') {
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

      // ─── ABILITY ACTIVATION (QWER) — uses the ACTIVE mode's ability set ─
      const abilityMap: Record<string, string> = { q: 'q', w: 'w', e: 'e', r: 'r' };
      if (abilityMap[k]) {
        if (e.repeat) return;
        const slotKey = abilityMap[k].toUpperCase();
        const ability = abilitySlotsRef.current.find(a => a.key === slotKey);
        if (ability) activateAbility(ability.id);
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
    handleCollect={handleCollect}
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
                {/* Remote duelist (1v1 PvP) — rendered at their synced position */}
                {duelRemote && axialDistance(hero.pos, duelRemote.pos) <= RENDER_RADIUS && (() => {
                  const world = axialToWorld(duelRemote.pos, hexSize);
                  const rivalColors = { ...heroColors, primary: '#d0453f', secondary: '#7a1f1b' } as typeof heroColors;
                  const hpPct = Math.max(0, Math.min(1, duelRemote.hp / Math.max(1, duelRemote.maxHp)));
                  return (
                    <group key="duel-remote" position={[world.x, 0.48, world.z]} rotation={[0, duelRemote.facing ?? 0, 0]} frustumCulled={false}>
                      <IsometricCharacter gender={(duelRemote.gender as any) ?? 'MALE'} colors={rivalColors} hexSize={hexSize} faction={duelRemote.faction as any} isMoving={!!duelRemote.moving} facingAngle={duelRemote.facing ?? 0} />
                      <Text position={[0, hexSize * 2.4, 0]} fontSize={hexSize * 0.42} color="#ff9a9a" anchorX="center" anchorY="middle" outlineWidth={hexSize * 0.03} outlineColor="#000">{`⚔️ ${duelRemote.name ?? 'Rival'}`}</Text>
                      {/* Enemy HP bar */}
                      <group position={[0, hexSize * 2.0, 0]}>
                        <mesh><planeGeometry args={[hexSize * 1.4, hexSize * 0.16]} /><meshBasicMaterial color="#2a0a0a" /></mesh>
                        <mesh position={[-(hexSize * 1.4 * (1 - hpPct)) / 2, 0, 0.01]}><planeGeometry args={[hexSize * 1.4 * hpPct, hexSize * 0.16]} /><meshBasicMaterial color="#e0453f" /></mesh>
                      </group>
                    </group>
                  );
                })()}
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
                      <OutpostMarker size={hexSize} owned={o.owner === 'player'} color={heroColors.primary} />
                      {showOutpostZones && <OutpostZoneRing size={hexSize} owned={o.owner === 'player'} color={heroColors.primary} />}
                    </group>
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

              {/* Nearby creep camp — attacking is a deliberate choice (press F) */}
              {nearbyCreepCamp && (
                <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40">
                  <div className="px-4 py-2 rounded-xl bg-rose-900/80 border border-rose-400/60 text-sm font-bold text-rose-100 backdrop-blur-sm shadow-lg flex items-center gap-2">
                    ⚔️ Enemy Camp — Lv {nearbyCreepCamp.level} · {nearbyCreepCamp.creeps.filter(c => c.hp > 0).length} left
                    <span className="ml-1 px-1.5 py-0.5 rounded bg-rose-700 font-bold">F</span> to attack
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
                  <div className="fixed top-40 left-1/2 -translate-x-1/2 z-40 max-w-[94vw]">
                    <div className={`px-4 py-2 rounded-xl border text-xs sm:text-sm font-bold backdrop-blur-sm shadow-lg flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center ${
                      loot ? 'bg-orange-900/80 border-orange-400/60 text-orange-100' : 'bg-emerald-900/80 border-emerald-400/60 text-emerald-100'
                    }`}>
                      {c.mission.icon} {c.mission.title}
                      {loot
                        ? <span className="opacity-80 font-normal">— {c.mission.desc}</span>
                        : <span className="opacity-80 font-normal">— {c.delivered}/{c.required.amount} {resLbl} delivered · holding {held}</span>
                      }
                      <span className={`px-1.5 py-0.5 rounded font-bold ${loot ? 'bg-orange-700' : 'bg-emerald-700'}`}>H</span> to {c.mission.verb.toLowerCase()}
                    </div>
                  </div>
                );
              })()}

              {/* Objectives panel (top-left) */}
              <div className="fixed top-32 left-3 z-30 px-3 py-2 rounded-xl bg-[#0c1219]/85 ring-1 ring-white/10 text-[11px] pointer-events-none shadow-lg space-y-1">
                <div className="uppercase tracking-wide opacity-50 text-[9px]">Objectives</div>
                <div className="flex items-center gap-2"><span>🌱</span><span className="opacity-70">Terraform</span><span className="ml-auto font-semibold tabular-nums">{terraformDone ? '✓' : `${terraformProgress}%`}</span></div>
                <div className="flex items-center gap-2"><span>🚩</span><span className="opacity-70">Outposts</span><span className="ml-auto font-semibold tabular-nums">{outpostControl.owned}/{outpostControl.total}</span></div>
                <div className="flex items-center gap-2"><span>🗺️</span><span className="opacity-70">Regions</span><span className="ml-auto font-semibold tabular-nums">{outpostControl.regionsControlled}/{outpostControl.regionCount}</span></div>
                <div className="flex items-center gap-2"><span>⛺</span><span className="opacity-70">Refugee camps</span><span className="ml-auto font-semibold tabular-nums">{refugeeProgress.done}/{refugeeProgress.total}</span></div>
                {localPetInventory.length > 0 && (
                  <div className="flex items-center gap-2 pt-1 mt-1 border-t border-white/10"><span>🐾</span><span className="opacity-70">Pet pack</span><span className="ml-auto font-semibold tabular-nums">{localPetInventory.reduce((s, i) => s + (i.quantity || 0), 0)}</span><span className="px-1 py-0.5 rounded bg-white/10 text-[9px] font-bold">1–8</span></div>
                )}
                {duelActive && (
                  <div className="flex items-center gap-2 pt-1 mt-1 border-t border-white/10"><span>⚔️</span><span className="opacity-70">Duel</span><span className="ml-auto font-semibold tabular-nums">{duel.status === 'connected' ? (duelRemote ? 'vs ' + (duelRemote.name || 'Rival') : 'connected') : duel.status}</span></div>
                )}
              </div>

              {/* ── 1v1 PvP Duel: launcher button + lobby + result ─────────────── */}
              <button
                onClick={() => setDuelLobbyOpen(o => !o)}
                className={`fixed top-16 right-3 z-40 px-3 py-1.5 rounded-lg text-sm font-bold shadow-lg ring-1 transition pointer-events-auto ${
                  duelActive ? 'bg-rose-800/90 ring-rose-400 text-rose-50' : 'bg-[#141b26]/90 ring-white/15 text-gray-200 hover:ring-rose-400/60'
                }`}
              >⚔️ Duel{duelActive && duel.status === 'connected' ? ' •' : ''}</button>

              {duelLobbyOpen && (
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
                      <div className="text-[11px] opacity-50 text-center">— or play a friend —</div>
                      <button onClick={() => duel.host()} className="w-full py-2 rounded-lg bg-rose-700 hover:bg-rose-600 font-bold">Host with a code</button>
                      <div className="flex gap-2">
                        <input
                          value={duelJoinCode}
                          onChange={(e) => setDuelJoinCode(e.target.value.toUpperCase())}
                          maxLength={5}
                          placeholder="CODE"
                          className="flex-1 min-w-0 px-2 py-2 rounded-lg bg-black/40 ring-1 ring-white/15 uppercase tracking-widest font-mono text-center"
                        />
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
                      <div className="text-2xl font-mono font-bold tracking-[0.3em] text-amber-300">{duel.code}</div>
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
                      <div className="text-[11px] opacity-70 text-center">Get adjacent to your rival and press <span className="px-1 rounded bg-white/10 font-bold">F</span> to strike.</div>
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
                    <div className="opacity-70 text-sm mb-4">{duel.result === 'win' ? 'You defeated your rival.' : 'Your rival bested you.'}</div>
                    <button onClick={() => { duel.leave(); setDuelLobbyOpen(false); }} className="px-6 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 font-bold">Close</button>
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
                        : nearbyMushroom ? '🍃 Mushroom'
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
                  // Hero XP is cumulative in the profile (the instance that receives all
                  // in-game saves). Derive level from total so level + ring + bar all
                  // track live as XP is gained.
                  const total = Math.floor(profile?.progress?.hero?.xp ?? 0);
                  const lvl = profile ? Math.max(1, getLevelFromXp(total)) : (heroVitals?.level ?? 1);
                  const max = Math.max(1, getXpForNextLevel(lvl));
                  const cur = profile
                    ? Math.max(0, Math.min(max, total - getTotalXpForLevel(lvl)))
                    : (heroVitals?.xp?.current ?? 0);
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
                resources={resources || []}
                skillTokens={skillTokens || 0}
                petTokens={0}
                minimapData={minimapData}
                onMenu={onExit}
                skillPoints={skillPoints}
                totalPlayTime={totalPlayTime}
                heroInventory={localHeroInventory}
                petInventory={localPetInventory}
                playerProfile={playerProfile}
                onTalents={onOpenSkillTree}
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
