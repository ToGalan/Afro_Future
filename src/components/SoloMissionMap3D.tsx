import React, { useMemo, useState, useEffect, Suspense, useRef } from 'react';
import { usePlayerProfile } from '../hooks/usePlayerProfile';
import { usePlayerSession } from '../hooks/usePlayerSession';
import { usePetXP } from '../hooks/usePetXP';
import { derivePetStats, bondTierIndex, bondTierProgress, unlockedPetAbilities, petAbilitiesWithState, BOND_TIERS } from '../services/petSpecies';
import { useCollectibles, RESOURCE_DEFS } from '../hooks/useCollectibles';
import type { Mesh } from 'three';
import * as THREE from 'three';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Sky, ContactShadows } from '@react-three/drei';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import { FbxProp, FbxPbrProp, FbxRawProp, GltfRawProp, FbxAnimatedProp, FbxAnimatedTexturedProp, NATURE_ASSETS, NATURE_TEX, MILITARY_ASSETS, MILITARY_TEX, PBR_PROP_ASSETS, PBR_PROP_TEX, MUSHROOM_ASSET, MUSHROOM_TEX, MINING_ASSETS, PET_ASSETS, WC_NPC_ASSET, WC_NPC_TEX, CREEP_ASSETS, CREEP_TEX, ELEPHANT_ASSET, CAMEL_ASSET, RHINO_ASSET, HOUSE_MANIFEST_URL, DESERT_OUTPOST_ASSET, MASK_ASSETS } from './FbxProps';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { arcFor, beatReady, storyNpc, storyText, MASK_LORE, MAIN_MISSIONS, FACTION_MOTIVATION, type StoryBeat, type StoryChoice, type StoryWorldState } from '../services/storyline';
import { nextUpgradeCost, militaryDefendChance, raidWeight, passiveIncome, SPEC_INFO, CAMP_UPGRADE_MAX_TIER, type CampSpecialization, type CampUpgradeState } from '../services/campUpgrades';
import { GameAvatar, type AvatarColors } from './GameAvatarMesh';
import { resolveHeroModel } from '../config/heroModels';
import { useCreeps, type CreepCamp } from '../hooks/useCreeps';
import { useOutposts } from '../hooks/useOutposts';
import { useRefugeeCamps, factionKey, type FactionKey } from '../hooks/useRefugeeCamps';
import { useFactionEnemies, DOCTRINE, type FactionEnemy, type GuardPost } from '../hooks/useFactionEnemies';
import { useDuel, type RemoteHero } from '../hooks/useDuel';
import { watchOpenRooms } from '../services/duelSignaling';
import { watchOpenMatches } from '../services/matchSignaling';
import { useMobaMatch, type MobaHero } from '../hooks/useMobaMatch';
import {
  MOBA_SCORING, VICTORY_TRACKS, VICTORY_TRACK_DEFS, VICTORY_POINTS, trackLeader, emptyVictory, addVictory, evaluateVictory, FACTIONS,
  type Faction, type FactionVictory, type VictoryTrack,
} from '../services/mobaMatch';
import { PLAYSTYLES, PLAYSTYLE_ORDER, emptyReputation, dominantPlaystyle, type Playstyle, type PlaystyleReputation } from '../services/playstyles';
import { useSkillStore } from '../store/skillStore';
import { skillEffectFor, type SkillEffect } from '../store/skillData';
import { pruneEffects, aggregateEffects, type ActiveEffect } from '../services/statusEffects';
import { getLevelFromXp, getTotalXpForLevel, getXpForNextLevel } from '../services/playerExpEconomy';
import { scaledMissionXp, scaledMissionFp, rivalMissionGain } from '../services/balance';
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

/** Inverse of axialToWorld (flat-top): world point → containing hex via cube rounding. */
function worldToAxial(x: number, z: number, R_outer: number): Axial {
  const q = x / (1.5 * R_outer);
  const r = z / (Math.sqrt(3) * R_outer) - q / 2;
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
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

/** Neutral creep camp: a demon-beast pack guarding a war-totem fire pit, ringed by a
 *  crooked palisade. Creeps idle-breathe, the fire flickers, and higher-level packs
 *  are visibly bulkier. Each creep keeps its HP bar; the camp keeps its level tag. */
// Species pool for creep-camp critters, in a stable order so the per-creep hash pick
// below stays deterministic across renders. Most are rigged FBX (played through
// FbxAnimatedTexturedProp); the megafauna (elephant/camel/rhino) are static glTF (no
// animation clip) so they're tagged separately and rendered through GltfRawProp
// instead — CreepBody below picks the right loader per entry. Every exported FBX/glTF
// species in the pack is wired here (2026-07-18: "use all available").
type CreepSpeciesEntry = { kind: 'fbx'; url: string; scale?: number } | { kind: 'gltf'; url: string; scale?: number };
const CREEP_SPECIES: CreepSpeciesEntry[] = [
  ...Object.values(CREEP_ASSETS).map(url => ({ kind: 'fbx' as const, url })),
  { kind: 'gltf' as const, url: ELEPHANT_ASSET, scale: 2 },
  { kind: 'gltf' as const, url: CAMEL_ASSET, scale: 1.3 },
  { kind: 'gltf' as const, url: RHINO_ASSET, scale: 1.7 },
];

/** Renders one creep-camp critter body, picking the loader that matches its export
 *  format (animated FBX vs. static glTF) — shared by both the combat creeps and the
 *  purely-cosmetic ambient wildlife below. */
function CreepBody({ species, size }: { species: CreepSpeciesEntry; size: number }) {
  // Megafauna (glTF entries) each carry their own scale so the pool reads as varied
  // wildlife sizes — elephant biggest, rhino close behind, camel a step up from the
  // FBX pack's smaller animals — instead of every glTF entry being uniformly 2x.
  const s = size * (species.scale ?? 1);
  return species.kind === 'gltf'
    ? <GltfRawProp url={species.url} size={s} />
    : <FbxAnimatedTexturedProp url={species.url} tex={CREEP_TEX} size={s} />;
}

function CreepCampMesh({ camp, size, terrain }: { camp: CreepCamp; size: number; terrain?: string }) {
  const alive = camp.creeps.filter(c => c.hp > 0);
  const breatheRefs = React.useRef<(THREE.Group | null)[]>([]);
  const flameRef = React.useRef<THREE.Mesh>(null);
  const emberRef = React.useRef<THREE.Mesh>(null);
  const isFortify = camp.kind === 'fortify';
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    breatheRefs.current.forEach((g, i) => {
      if (!g) return;
      g.position.y = Math.sin(t * 2.1 + i * 1.7) * 0.02 * size;
      g.rotation.z = Math.sin(t * 1.3 + i) * 0.03;
    });
    if (flameRef.current) { const s = 1 + Math.sin(t * 7) * 0.18; flameRef.current.scale.set(s, s + Math.sin(t * 9) * 0.12, s); }
    if (emberRef.current) (emberRef.current.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(t * 5) * 0.25;
  });
  // Spread the camp's dressing across its own tile PLUS two neighbor tiles (opposite
  // sides of the hex, picked deterministically from the camp's key) instead of cramming
  // everything onto one hex — reads as a small compound and fills the 3-tile clearing
  // decoBlockedKeys already keeps free around every camp. Offsets are in LOCAL space
  // since the caller already anchors this group at the camp's own tile center.
  const [satA, satB] = React.useMemo(() => {
    const nbrs = axialNeighbors({ q: camp.q, r: camp.r });
    const idxA = enemyHash(camp.key) % 6;
    const idxB = (idxA + 3) % 6; // opposite side of the hex ring → spreads instead of clumping
    const center = axialToWorld({ q: camp.q, r: camp.r }, size);
    const wA = axialToWorld(nbrs[idxA], size);
    const wB = axialToWorld(nbrs[idxB], size);
    return [
      [wA.x - center.x, wA.z - center.z] as [number, number],
      [wB.x - center.x, wB.z - center.z] as [number, number],
    ];
  }, [camp.key, camp.q, camp.r, size]);
  if (!alive.length) return null;
  const cs = size * (0.3 + Math.min(0.072, camp.level * 0.012)); // higher-level packs are bulkier
  const spikes = 8;
  // Camp footprint widened to read as ~2 tiles across (ground, palisade ring and the
  // creep spawn ring all pushed outward) instead of clustering inside one hex — the
  // satA/satB dressing above already reaches into neighbor tiles, this just makes the
  // core camp itself feel that size too.
  const campR = size * 1.6;
  // A couple of purely-cosmetic ambient critters (not combat creeps — no HP bar, don't
  // despawn as the camp's real creeps die) grazing at the edge of the widened footprint,
  // picked from the same species pool as the combat creeps for variety.
  const ambient = React.useMemo(() => (
    [0, 1].map(i => ({
      species: CREEP_SPECIES[enemyHash(`${camp.key}:amb:${i}`) % CREEP_SPECIES.length],
      a: (enemyHash(`${camp.key}:amb-a:${i}`) % 360) * (Math.PI / 180),
      r: campR * (0.62 + 0.18 * (enemyHash(`${camp.key}:amb-r:${i}`) % 100) / 100),
    }))
  ), [camp.key, campR]);
  return (
    <group>
      {/* scorched ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}><circleGeometry args={[campR, 12]} /><meshStandardMaterial color="#241a16" roughness={1} transparent opacity={0.85} /></mesh>
      {/* crooked palisade ring (gap left at the front) — modeled anti-obstacle props
          (hedgehog spikes alternating with barrier fencing) from the military pack,
          instead of plain procedural cones; fortify camps tint the hedgehogs steel-grey
          and stand taller, raid camps keep them at natural scrap-metal size. */}
      {Array.from({ length: spikes }, (_, i) => {
        const a = (i / spikes) * Math.PI * 2 + Math.PI / spikes;
        const px = Math.cos(a) * campR * 0.92, pz = Math.sin(a) * campR * 0.92;
        const lean = 0.28 + (i % 3) * 0.08;
        const h = size * (0.42 + (i % 2) * 0.16) * (isFortify ? 1.2 : 1);
        const useHedgehog = i % 2 === 0;
        return (
          <Suspense key={`spk${i}`} fallback={
            <mesh position={[px, h * 0.4, pz]} rotation={[Math.sin(a) * lean, 0, -Math.cos(a) * lean]} castShadow>
              <coneGeometry args={[size * (isFortify ? 0.065 : 0.05), h, isFortify ? 6 : 4]} /><meshStandardMaterial color={isFortify ? '#3a3f42' : '#221410'} roughness={0.95} flatShading />
            </mesh>
          }>
            <group position={[px, 0, pz]} rotation={[0, a, 0]}>
              {useHedgehog ? (
                <FbxProp url={MILITARY_ASSETS.hedgehog} tex={MILITARY_TEX} size={size * (isFortify ? 0.42 : 0.32)} tint={isFortify ? '#3a3f42' : undefined} />
              ) : (
                <FbxProp url={MILITARY_ASSETS.barriers[isFortify ? 0 : 1]} tex={MILITARY_TEX} size={size * (isFortify ? 0.5 : 0.4)} />
              )}
            </group>
          </Suspense>
        );
      })}
      {/* central fire pit — the modeled FBX campfire (logs + stones baked in), same prop
          the refugee camp uses, replacing the old procedural stone-ring; the flickering
          flame cone + ember glow stay separate synthetic meshes so they keep animating
          regardless of load state. */}
      <Suspense fallback={
        [0, 1, 2, 3, 4].map(i => { const a = (i / 5) * Math.PI * 2; return (
          <mesh key={`st${i}`} position={[Math.cos(a) * size * 0.14, size * 0.035, Math.sin(a) * size * 0.14]}><dodecahedronGeometry args={[size * 0.05, 0]} /><meshStandardMaterial color="#453f38" roughness={1} flatShading /></mesh>
        ); })
      }>
        <FbxPbrProp url={PBR_PROP_ASSETS.campfire} tex={PBR_PROP_TEX.campfire} size={size * 0.5} />
      </Suspense>
      <mesh ref={flameRef} position={[0, size * 0.16, 0]}><coneGeometry args={[size * 0.08, size * 0.26, 6]} /><meshBasicMaterial color="#ff6a2c" /></mesh>
      <mesh ref={emberRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}><circleGeometry args={[size * 0.2, 10]} /><meshBasicMaterial color="#ff4a1c" transparent opacity={0.5} /></mesh>
      {/* war totem behind the fire — fortify totems read as steel/cyan watch-idols, raid
          totems keep the blood-red skull-and-banner look. */}
      <group position={[-size * 0.3, 0, -size * 0.28]}>
        <mesh position={[0, size * 0.42, 0]} castShadow><cylinderGeometry args={[size * 0.045, size * 0.06, size * 0.84, 5]} /><meshStandardMaterial color={isFortify ? '#3a3f42' : '#2e1c14'} roughness={0.95} flatShading /></mesh>
        <mesh position={[0, size * 0.88, 0]} castShadow><icosahedronGeometry args={[size * 0.11, 0]} /><meshStandardMaterial color="#d8ccb0" roughness={0.8} flatShading /></mesh>
        {[0.06, -0.06].map((ex, ei) => (
          <mesh key={ei} position={[size * ex, size * 0.9, size * 0.09]}><sphereGeometry args={[size * 0.02, 5, 5]} /><meshBasicMaterial color={isFortify ? '#7ad9ff' : '#ff3b3b'} /></mesh>
        ))}
        {[[0.1, -0.5], [-0.1, 0.5]].map(([hx, rz], hi) => (
          <mesh key={`th${hi}`} position={[size * hx, size * 1.0, 0]} rotation={[0, 0, rz]} castShadow><coneGeometry args={[size * 0.025, size * 0.16, 4]} /><meshStandardMaterial color="#2a0e16" roughness={0.85} flatShading /></mesh>
        ))}
        <mesh position={[0, size * 0.62, size * 0.02]}><boxGeometry args={[size * 0.14, size * 0.24, size * 0.015]} /><meshStandardMaterial color={isFortify ? '#33424a' : '#7a1420'} emissive={isFortify ? '#1a2a30' : '#5a0a10'} emissiveIntensity={0.4} roughness={0.8} side={THREE.DoubleSide} flatShading /></mesh>
      </group>
      {/* satellite A (opposite side of the hex ring, on a neighbor tile) — fortify camps
          get a stone watchtower; raid camps get a leaning banner pole, both reading as
          camp dressing spread across the wider 3-tile clearing instead of one hex. */}
      <group position={[satA[0], 0, satA[1]]}>
        {isFortify ? (
          <Suspense fallback={<>
            <mesh position={[0, size * 0.5, 0]} castShadow><cylinderGeometry args={[size * 0.16, size * 0.2, size * 1.0, 6]} /><meshStandardMaterial color="#3a3f42" roughness={0.9} flatShading /></mesh>
            <mesh position={[0, size * 1.05, 0]} castShadow><boxGeometry args={[size * 0.5, size * 0.12, size * 0.5]} /><meshStandardMaterial color="#2a2d2f" roughness={0.85} flatShading /></mesh>
          </>}>
            <FbxProp url={MILITARY_ASSETS.tower} tex={MILITARY_TEX} size={size * 1.3} tint="#3a3f42" />
          </Suspense>
        ) : (
          <>
            <mesh rotation={[0, 0, 0.18]} position={[0, size * 0.5, 0]} castShadow><cylinderGeometry args={[size * 0.03, size * 0.045, size * 1.0, 5]} /><meshStandardMaterial color="#241410" roughness={0.9} flatShading /></mesh>
            <mesh position={[size * 0.14, size * 0.86, 0]} rotation={[0, 0, 0.18]}><planeGeometry args={[size * 0.32, size * 0.22]} /><meshStandardMaterial color="#7a1420" emissive="#4a0a10" emissiveIntensity={0.5} side={THREE.DoubleSide} roughness={0.9} /></mesh>
          </>
        )}
      </group>
      {/* desert/hills camps dress with the mining pack — ore, crates, a lantern —
          reading as a prospector's dig instead of the generic forest war-camp. */}
      {(terrain === 'desert' || terrain === 'hills') && (
        <Suspense fallback={null}>
          <group position={[size * 0.5, 0, -size * 0.18]}><FbxRawProp url={MINING_ASSETS.rockMoss} tint="#8a7350" size={size * 0.5} rotation={0.4} /></group>
          <group position={[-size * 0.5, 0, size * 0.4]}><FbxRawProp url={MINING_ASSETS.crateWooden} tint="#7a5a34" size={size * 0.4} rotation={-0.3} /></group>
          <group position={[size * 0.36, 0, size * 0.42]}><FbxRawProp url={MINING_ASSETS.lantern} tint="#e8c04a" size={size * 0.28} rotation={0.8} /></group>
        </Suspense>
      )}
      {/* satellite B (the ring's opposite-facing neighbor) — fortify camps stack a
          sandbag/stone barricade; raid camps pile plunder crates + a stolen-loot glow.
          The bone pile always sits close to the fire pit (unchanged). */}
      <group position={[satB[0], 0, satB[1]]}>
        {isFortify ? (
          <Suspense fallback={[0, 1, 2].map(i => (
            <mesh key={i} position={[size * (i - 1) * 0.24, size * 0.08, 0]} castShadow><boxGeometry args={[size * 0.26, size * 0.16, size * 0.2]} /><meshStandardMaterial color="#6b5d45" roughness={1} flatShading /></mesh>
          ))}>
            <group position={[-size * 0.24, 0, 0]} rotation={[0, 0.3, 0]}><FbxProp url={MILITARY_ASSETS.barriers[0]} tex={MILITARY_TEX} size={size * 0.55} /></group>
            <group position={[size * 0.24, 0, 0]} rotation={[0, -0.3, 0]}><FbxProp url={MILITARY_ASSETS.barriers[1]} tex={MILITARY_TEX} size={size * 0.5} /></group>
          </Suspense>
        ) : (
          <>
            <Suspense fallback={<>
              <mesh position={[0, size * 0.09, 0]} rotation={[0, 0.4, 0]} castShadow><boxGeometry args={[size * 0.28, size * 0.18, size * 0.28]} /><meshStandardMaterial color="#4a3620" roughness={0.9} flatShading /></mesh>
              <mesh position={[size * 0.22, size * 0.07, size * 0.12]} rotation={[0, -0.3, 0]} castShadow><boxGeometry args={[size * 0.2, size * 0.14, size * 0.2]} /><meshStandardMaterial color="#5a4128" roughness={0.9} flatShading /></mesh>
            </>}>
              <group position={[0, 0, 0]} rotation={[0, 0.4, 0]}><FbxPbrProp url={PBR_PROP_ASSETS.crateXBrace} tex={PBR_PROP_TEX.crateXBrace} size={size * 0.42} /></group>
              <group position={[size * 0.22, 0, size * 0.12]} rotation={[0, -0.3, 0]}><FbxPbrProp url={PBR_PROP_ASSETS.crateXBrace} tex={PBR_PROP_TEX.crateXBrace} size={size * 0.32} /></group>
            </Suspense>
            <mesh position={[0, size * 0.22, 0]}><octahedronGeometry args={[size * 0.05, 0]} /><meshStandardMaterial color="#ffd24a" emissive="#c9962e" emissiveIntensity={0.6} flatShading /></mesh>
          </>
        )}
      </group>
      {/* bone pile */}
      <group position={[size * 0.34, 0, size * 0.3]}>
        <mesh position={[0, size * 0.03, 0]} rotation={[Math.PI / 2, 0, 0.5]}><cylinderGeometry args={[size * 0.018, size * 0.018, size * 0.22, 4]} /><meshStandardMaterial color="#d8ccb0" roughness={0.9} flatShading /></mesh>
        <mesh position={[size * 0.03, size * 0.045, 0]} rotation={[Math.PI / 2, 0, -0.6]}><cylinderGeometry args={[size * 0.015, size * 0.015, size * 0.18, 4]} /><meshStandardMaterial color="#cfc2a4" roughness={0.9} flatShading /></mesh>
        <mesh position={[-size * 0.04, size * 0.04, size * 0.04]}><dodecahedronGeometry args={[size * 0.04, 0]} /><meshStandardMaterial color="#d8ccb0" roughness={0.9} flatShading /></mesh>
      </group>
      {alive.map((c, i) => {
        const ang = (i / alive.length) * Math.PI * 2;
        const rad = alive.length > 1 ? campR * 0.5 : campR * 0.22;
        const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
        const hpPct = Math.max(0, c.hp / c.maxHp);
        // Each creep is a real Africa-plausible critter FBX (rigged + its own baked
        // AnimStack clip) instead of the old procedural cyber-demon body — species picked
        // deterministically per creep so a camp shows a mix, not one clone repeated.
        const species = CREEP_SPECIES[enemyHash(`${camp.key}:${c.id}`) % CREEP_SPECIES.length];
        return (
          <group key={c.id} position={[x, 0, z]} rotation={[0, ang, 0]}>
            <group ref={el => { breatheRefs.current[i] = el; }}>
              <Suspense fallback={
                <mesh position={[0, cs * 0.5, 0]}><icosahedronGeometry args={[cs * 0.5, 0]} /><meshStandardMaterial color="#47182a" roughness={0.8} flatShading /></mesh>
              }>
                <CreepBody species={species} size={cs * 1.7} />
              </Suspense>
            </group>
            {/* HP bar (outside the breathing group so it stays steady) */}
            <mesh position={[0, cs * 1.95, 0]}><boxGeometry args={[cs * 1.2, cs * 0.16, cs * 0.05]} /><meshBasicMaterial color="#300000" /></mesh>
            <mesh position={[-(cs * 1.2) * (1 - hpPct) / 2, cs * 1.95, cs * 0.04]} scale={[Math.max(0.002, hpPct), 1, 1]}><boxGeometry args={[cs * 1.2, cs * 0.12, cs * 0.05]} /><meshBasicMaterial color="#ff4d4d" /></mesh>
          </group>
        );
      })}
      {/* ambient wildlife — purely cosmetic critters grazing at the edge of the widened
          camp footprint (no HP bar, don't despawn with the actual creeps) for atmosphere. */}
      {ambient.map((am, i) => (
        <Suspense key={`amb${i}`} fallback={null}>
          <group position={[Math.cos(am.a) * am.r, 0, Math.sin(am.a) * am.r]} rotation={[0, am.a + Math.PI, 0]}>
            <CreepBody species={am.species} size={cs * 1.3} />
          </group>
        </Suspense>
      ))}
      <Text position={[0, cs * 2.7, 0]} fontSize={size * 0.3} color="#ff9a9a" anchorX="center" anchorY="middle" outlineWidth={size * 0.02} outlineColor="#000">{isFortify ? '🏰' : '🔥'} Lv {camp.level}  ⚔️{camp.dmgPerCreep}</Text>
    </group>
  );
}

/** What a FORTIFY camp leaves behind once the player clears ("fortifies") it — a
 *  machine-gun emplacement (military pack) on a packed-earth pad marking the ground as
 *  secured, instead of vanishing like a raided camp. Purely visual, no gameplay effect. */
function FortifiedCampRemnant({ campKey, size }: { campKey: string; size: number }) {
  const gunUrl = MILITARY_ASSETS.machineGuns[enemyHash(campKey) % MILITARY_ASSETS.machineGuns.length];
  const facing = (enemyHash(`${campKey}:gun`) % 360) * (Math.PI / 180);
  return (
    <group>
      {/* packed-earth pad */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <circleGeometry args={[size * 0.85, 12]} /><meshStandardMaterial color="#3a352c" roughness={1} transparent opacity={0.8} />
      </mesh>
      <Suspense fallback={null}>
        <group rotation={[0, facing, 0]}><FbxProp url={gunUrl} tex={MILITARY_TEX} size={size * 0.62} /></group>
        {/* sandbag barrier covering the gun's firing arc */}
        <group position={[Math.cos(facing) * size * 0.55, 0, Math.sin(facing) * size * 0.55]} rotation={[0, -facing + Math.PI / 2, 0]}>
          <FbxProp url={MILITARY_ASSETS.barriers[0]} tex={MILITARY_TEX} size={size * 0.5} />
        </group>
      </Suspense>
      <Text position={[0, size * 1.1, 0]} fontSize={size * 0.26} color="#9fe3a8" anchorX="center" anchorY="middle" outlineWidth={size * 0.018} outlineColor="#000">🏰 Fortified</Text>
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
const EnemyUnitMesh = React.memo(function EnemyUnitMesh({ enemy, size, target }: { enemy: FactionEnemy; size: number; target: [number, number, number] }) {
  const ref = React.useRef<THREE.Group>(null);
  const snapped = React.useRef(false);
  // Last derived heading — kept across frames so the unit still faces its most recent
  // travel direction while idling/guarding between discrete AI ticks, instead of
  // reverting to a default +Z facing the moment it stops moving.
  const facingRef = React.useRef(0);
  useFrame((_, delta) => {
    const g = ref.current; if (!g) return;
    if (!snapped.current) { g.position.set(target[0], target[1], target[2]); snapped.current = true; return; }
    // Frame-rate-independent lerp (was a flat 0.2-per-frame step, which converged twice
    // as fast in real time on a 120Hz display as on 60Hz — same decay curve either way now).
    const k = 1 - Math.exp(-13.4 * Math.min(0.05, delta));
    // Derive the travel direction from the CURRENT position (before this frame's step)
    // so it reflects where the unit is actually headed this frame.
    const dx = target[0] - g.position.x, dz = target[2] - g.position.z;
    // +Math.PI: the character model's front faces -Z at rotation.y=0, opposite the
    // atan2(dx,dz) "facing +Z" convention used elsewhere (hero/RemoteMobaHero) — without
    // this offset the unit walks backwards-facing.
    if (dx * dx + dz * dz > 1e-6) facingRef.current = Math.atan2(dx, dz) + Math.PI;
    g.position.x += dx * k;
    g.position.y += (target[1] - g.position.y) * k;
    g.position.z += dz * k;
    // Smoothly turn the whole unit (character + overlays) toward its derived heading —
    // shortest-path angle interpolation (same convention as RemoteMobaHero) instead of
    // an instant snap, so the turn itself is visible rather than a hard pop.
    let da = ((facingRef.current - g.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (da < -Math.PI) da += Math.PI * 2;
    g.rotation.y += da * Math.min(1, k * 1.6);
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
  // Animation cadence follows the doctrine's AI move-tick rate (moveEvery: lower = moves
  // more often) so relentless Raiders visibly stride faster than leashed Peacekeepers.
  const speedMult = Math.max(0.6, Math.min(1.4, 1 / doc.moveEvery));

  return (
    <group ref={ref} frustumCulled={false}>
      {/* WC-faction grunts use the modeled wc_npc FBX (civilian-styled militia) instead
          of the procedural chibi rig other factions use; falls back to the chibi while
          the FBX/texture load. */}
      {enemy.faction === 'WC' ? (
        <Suspense fallback={
          <group scale={charScale} frustumCulled={false}>
            <IsometricCharacter gender={gender} colors={ENEMY_FACTION_COLORS[enemy.faction]} hexSize={size} faction={enemy.faction} isMoving={moving} speedMult={speedMult} />
          </group>
        }>
          <FbxAnimatedTexturedProp url={WC_NPC_ASSET} tex={WC_NPC_TEX} size={targetH} playing={moving} tint={hunting ? '#ff8a6a' : undefined} />
        </Suspense>
      ) : (
        /* Chibi character body (same rig/style as the hero), faction-tinted + kitted.
           facingAngle is left undefined so it inherits this group's travel rotation. */
        <group scale={charScale} frustumCulled={false}>
          <IsometricCharacter
            gender={gender}
            colors={ENEMY_FACTION_COLORS[enemy.faction]}
            hexSize={size}
            faction={enemy.faction}
            isMoving={moving}
            speedMult={speedMult}
          />
        </group>
      )}

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

      {/* HP bar — fill shrinks via scale.x, NOT geometry args: args that change per hit
          make R3F dispose + rebuild (and re-upload) a BoxGeometry for every damaged unit. */}
      <mesh position={[0, topY + size * 0.3, 0]}><boxGeometry args={[size * 0.66, size * 0.08, size * 0.025]} /><meshBasicMaterial color="#300000" /></mesh>
      <mesh position={[-(size * 0.66) * (1 - hpPct) / 2, topY + size * 0.3, size * 0.02]} scale={[Math.max(0.002, hpPct), 1, 1]}><boxGeometry args={[size * 0.66, size * 0.06, size * 0.025]} /><meshBasicMaterial color={hunting ? '#ff4d4d' : '#ffa24d'} /></mesh>

      <Text position={[0, topY + size * 0.5, 0]} fontSize={size * (boss ? 0.32 : 0.26)} color={boss ? '#ffd24a' : doc.color} anchorX="center" anchorY="middle" outlineWidth={size * 0.02} outlineColor="#000">
        {boss ? `👑 ${enemy.faction} Commander Lv${enemy.level}` : `${hunting ? '⚔️ ' : ''}${enemy.faction} ${doc.label} Lv${enemy.level}`}
      </Text>
    </group>
  );
}, (a, b) =>
  // The AI tick preserves object identity for unchanged units, so this bails out of
  // re-rendering the heavy chibi rig for every unit that didn't move/fight this tick.
  a.enemy === b.enemy && a.size === b.size &&
  a.target[0] === b.target[0] && a.target[1] === b.target[1] && a.target[2] === b.target[2]);

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

/** Self-contained combat-text layer. Owns the floating-number list so spawning or
 *  expiring a damage number re-renders ONLY this component — combat used to route each
 *  number through SoloMissionMap3D state, re-rendering the whole map per hit. The
 *  parent spawns through `spawnRef` (stable identity across map renders). */
type CombatTextItem = { id: number; x: number; z: number; text: string; color: string };
const CombatTextField = React.memo(function CombatTextField({ spawnRef }: {
  spawnRef: React.MutableRefObject<((x: number, z: number, text: string, color: string) => void) | null>;
}) {
  const [items, setItems] = React.useState<CombatTextItem[]>([]);
  const nextId = React.useRef(0);
  React.useEffect(() => {
    spawnRef.current = (x, z, text, color) => {
      const id = nextId.current++;
      setItems(prev => [...prev.slice(-14), { id, x, z, text, color }]);
    };
    return () => { spawnRef.current = null; };
  }, [spawnRef]);
  return (
    <>
      {items.map(ct => (
        <group key={ct.id} position={[ct.x, 0, ct.z]}>
          <FloatingCombatText text={ct.text} color={ct.color} onDone={() => setItems(prev => prev.filter(p => p.id !== ct.id))} />
        </group>
      ))}
    </>
  );
});

// ── Frame-rate management: 120fps ceiling + 30fps adaptive floor ────────────
/** Caps rendering at `maxFps` (demand-mode Canvas + our own rAF invalidator).
 *  On 60Hz displays this is a no-op; on 144/240Hz monitors it stops the GPU from
 *  rendering frames beyond 120. Uses an accumulator so the cadence stays smooth. */
function FrameLimiter({ maxFps = 120 }: { maxFps?: number }) {
  const invalidate = useThree(s => s.invalidate);
  React.useEffect(() => {
    let raf = 0; let last = 0;
    const minMs = 1000 / maxFps;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last >= minMs - 0.5) {
        last = Math.max(last + minMs, t - minMs); // accumulator: ~120 on 144Hz, not 72
        invalidate();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [invalidate, maxFps]);
  return null;
}

/** FPS cap options the player can cycle through (🎞 button next to ✨ Hi/Lo). */
const FPS_CAP_OPTIONS = [30, 60, 120] as const;

/** Counts frames the Canvas actually renders (demand mode renders ≤ the 🎞 cap,
 *  so a plain rAF counter would over-report). Lives inside the Canvas. */
function FpsProbe({ counter }: { counter: React.MutableRefObject<number> }) {
  useFrame(() => { counter.current++; });
  return null;
}

/** Dev-only FPS readout: ONE small chip. Replaces the drei <Stats/> panel, which
 *  duplicated itself under React 18 StrictMode double-mounting (two meters on screen). */
function DevFpsMeter({ counter }: { counter: React.MutableRefObject<number> }) {
  const [fps, setFps] = React.useState(0);
  React.useEffect(() => {
    let prev = counter.current;
    const id = setInterval(() => {
      setFps((counter.current - prev) * 2);
      prev = counter.current;
    }, 500);
    return () => clearInterval(id);
  }, [counter]);
  return (
    <div className="fixed bottom-2 left-2 z-50 px-2 py-0.5 rounded bg-black/70 text-[11px] font-mono text-emerald-300 pointer-events-none select-none">
      {fps} fps
    </div>
  );
}

// ── Base evolution (Civ-style "castle" growth) ──────────────────────────────
// The command center is not static: player level drives a build-out TIER that
// grows the hub (walls → watchtowers → annexes → citadel shield) and adds
// district pads on the neighbouring tiles — purely visual meta-progression.
// A new build-out "state" (tier) unlocks every 10 levels (user directive 2026-07-18) —
// 11 named states spanning L1 (Base Camp) to L100 (Megacity).
const BASE_TIER_NAMES = [
  'Base Camp', 'Outpost HQ', 'Settlement', 'Garrison', 'Stronghold',
  'Bastion', 'Citadel', 'Fortress City', 'Provincial Capital', 'Metropolis', 'Megacity',
];
function baseTierFor(level: number) {
  return 1 + Math.floor(Math.min(100, Math.max(1, level)) / 10); // 1..11
}
/** City growth stage = player level, 1:1 (user directive 2026-07-18: "1 new building
 *  every level"). Each stage adds one sprawl building — or, every 5th stage, a
 *  district pad instead (see cityBuildingSpots) — and creeps the territory stroke
 *  outward. */
function baseGrowthStage(level: number) {
  return Math.max(1, Math.min(100, Math.floor(level)));
}
/** Home-zone ring radius (in tiles) steps up at level milestones; between steps the
 *  border stroke creeps outward per growth stage (Civ culture-border feel). */
function baseZoneRadiusFor(level: number) {
  return level >= 50 ? 4 : level >= 25 ? 3 : level >= 10 ? 2 : 1;
}
function baseZoneRingStartLevel(level: number) {
  return level >= 50 ? 50 : level >= 25 ? 25 : level >= 10 ? 10 : 1;
}
/** Level at which the NEXT ring-radius jump kicks in (Infinity once at the final ring). */
function baseZoneRingNextLevel(level: number) {
  return level >= 50 ? Infinity : level >= 25 ? 50 : level >= 10 ? 25 : 10;
}

/** Player base / command center — purely the HQ house model (first entry in the
 *  houses manifest) plus a floating tier-name label. All procedural three.js
 *  build-out (platform, walls, towers, annexes, shield, ornaments) was removed per
 *  design direction; growth reads through the model's tier scaling, the +1%/stage
 *  scale, the district pads, the sprawl and the territory stroke. */
function CommandCenter({ size, tier = 1, stage = 0, playstyle = null, hqUrl = null }: { size: number; color?: string; tier?: number; stage?: number; playstyle?: Playstyle | null; hqUrl?: string | null }) {
  const S = size;
  // Continuous growth: +1% overall scale per city growth stage (per level to 10,
  // then per 5 levels), so the HQ visibly grows EVERY level between tier jumps.
  // 2026-07-19 (user: "keep the same fixed base, only make it bigger"): the HQ model
  // itself no longer swaps per tier (see the call site — hqUrl is always the ONE fixed
  // base model now); to keep growth reading clearly across all 11 tiers without a model
  // swap to lean on, the per-tier/per-stage scale coefficients were raised accordingly.
  const grow = 1 + Math.min(0.4, stage * 0.014);
  return (
    <group scale={grow}>
      {hqUrl && (
        <Suspense fallback={null}>
          <HouseVariantModel url={hqUrl} size={S * (1.35 + tier * 0.24)} rotation={Math.PI / 4} />
        </Suspense>
      )}
      <Text position={[0, S * (1.65 + tier * 0.26), 0]} fontSize={S * 0.4} color="#cfe8ff" anchorX="center" anchorY="middle" outlineWidth={S * 0.03} outlineColor="#000">{BASE_TIER_NAMES[Math.min(tier, BASE_TIER_NAMES.length) - 1]}{playstyle ? ` ${PLAYSTYLES[playstyle].icon}` : ''}</Text>
    </group>
  );
}

/** District pad on a tile adjacent to the base — unlocked one per tier (Civ districts). */
type BaseDistrictKind = 'habitat' | 'agro' | 'industry' | 'energy';
const DISTRICT_ICON: Record<BaseDistrictKind, string> = { habitat: '🏠', agro: '🌾', industry: '⚙️', energy: '🔋' };
// Cycle order districts unlock in — every 5th sprawl stage (user directive: "1 new
// district every 5 levels") becomes a district pad instead of a house, cycling
// through these 4 kinds; a 5th district (stage 25) repeats 'habitat' at a bigger size.
const DISTRICT_KIND_CYCLE: BaseDistrictKind[] = ['habitat', 'agro', 'industry', 'energy'];
/** Model-only district pads — no procedural three.js geometry (per design direction,
 *  the base builds out of real asset-pack models only): habitat = army tent, agro =
 *  bushes + flowers, industry = crate + barrel, energy = generator. Icon label on top. */
function BaseDistrictMesh({ size, kind, color }: { size: number; kind: BaseDistrictKind; color: string }) {
  const S = size;
  return (
    <group>
      <Suspense fallback={null}>
        {kind === 'habitat' && (
          <>
            <group position={[-S * 0.12, 0, S * 0.04]}><FbxProp url={MILITARY_ASSETS.tents[0]} tex={MILITARY_TEX} size={S * 0.85} rotation={0.5} tint="#c8a878" /></group>
            <group position={[S * 0.3, 0, -S * 0.26]}><FbxProp url={MILITARY_ASSETS.boxes[0]} tex={MILITARY_TEX} size={S * 0.24} rotation={1.1} /></group>
          </>
        )}
        {kind === 'agro' && (
          <>
            <group position={[-S * 0.24, 0, S * 0.02]}><FbxProp url={NATURE_ASSETS.bushes[0]} tex={NATURE_TEX} size={S * 0.42} rotation={0.3} /></group>
            <group position={[S * 0.24, 0, S * 0.26]}><FbxProp url={NATURE_ASSETS.flowers[0]} tex={NATURE_TEX} size={S * 0.34} rotation={1.8} /></group>
            <group position={[S * 0.18, 0, -S * 0.3]}><FbxProp url={NATURE_ASSETS.bushes[2]} tex={NATURE_TEX} size={S * 0.3} rotation={2.6} /></group>
          </>
        )}
        {kind === 'industry' && (
          <>
            <group position={[-S * 0.2, 0, S * 0.12]}><FbxProp url={MILITARY_ASSETS.boxes[1]} tex={MILITARY_TEX} size={S * 0.42} rotation={0.5} /></group>
            <group position={[-S * 0.02, 0, -S * 0.28]}><FbxProp url={MILITARY_ASSETS.barrel} tex={MILITARY_TEX} size={S * 0.3} rotation={1.2} /></group>
            <group position={[S * 0.3, 0, S * 0.02]}><FbxProp url={MILITARY_ASSETS.tires} tex={MILITARY_TEX} size={S * 0.28} rotation={2.1} /></group>
          </>
        )}
        {kind === 'energy' && (
          <>
            <group position={[S * 0.12, 0, S * 0.08]}><FbxProp url={MILITARY_ASSETS.generator} tex={MILITARY_TEX} size={S * 0.46} rotation={-0.6} /></group>
            <group position={[-S * 0.26, 0, -S * 0.18]}><FbxProp url={MILITARY_ASSETS.barrel} tex={MILITARY_TEX} size={S * 0.26} rotation={0.8} /></group>
          </>
        )}
      </Suspense>
      <Text position={[0, S * 1.0, 0]} fontSize={S * 0.3} color={color} anchorX="center" anchorY="middle" outlineWidth={S * 0.02} outlineColor="#000">{DISTRICT_ICON[kind]}</Text>
    </group>
  );
}

/** City sprawl spot, one per growth stage (2026-07-19 user directive: "1 house item per
 *  new district only, add elements from the assets folder for each level"). A stage is
 *  EITHER a district (every 5th — gets its themed BaseDistrictMesh dressing PLUS a house
 *  anchor building, the only stages that place a full house model now) OR a plain level
 *  (the other 4 of 5 — gets one small decorative ELEMENT from the wider asset pool
 *  instead, so growth still reads every level without a full building each time). */
interface CitySpot {
  x: number; y: number; z: number; rot: number;
  /** Set when this spot is a district (every 5th stage) — gets BaseDistrictMesh + a house. */
  districtKind?: BaseDistrictKind;
  /** How many times this district kind has repeated (0 = first) — grows its footprint. */
  districtRepeat?: number;
  /** House model selection — district stages only. kind 0=hut/1=house/2=tower (tracks
   *  the city's overall growth at the stage it unlocked, GDD "appropriate assets"). */
  kind?: number; h?: number; v?: number;
  /** Non-district stage — index into LEVEL_ELEMENTS + a size jitter. */
  elementIdx?: number; elementScale?: number;
}
/** A single house model variant, routed by file extension (.fbx vs .glb/.gltf). */
function HouseVariantModel({ url, size, rotation }: { url: string; size: number; rotation: number }) {
  return url.toLowerCase().endsWith('.fbx')
    ? <FbxRawProp url={url} size={size} rotation={rotation} />
    : <GltfRawProp url={url} size={size} rotation={rotation} />;
}
/** Picks a house URL from the manifest, segmented into 3 growth buckets (hut / house /
 *  tower — CitySpot.kind, itself derived from the stage the spot unlocked at). Which
 *  PART of the pool a building draws from tracks the city's growth instead of picking
 *  purely at random, so early sprawl reads as humble and late sprawl reads as grand
 *  (the "appropriate assets based on city growth" per user ask). */
function houseForSpot(houses: string[], kind: number, v: number): string {
  const n = houses.length;
  const bucket = Math.max(1, Math.round(n / 3));
  const start = Math.min(n - 1, kind * bucket);
  const end = kind >= 2 ? n : Math.min(n, start + bucket);
  const len = Math.max(1, end - start);
  return houses[start + Math.floor(v * len) % len];
}

// ── Per-level decorative elements (2026-07-19: "add elements from the assets folder
// for each level") — the smaller scattered props that mark a plain (non-district) level
// now that full houses are reserved for district-unlock stages only. Pulled from the
// SAME staged asset packs already used elsewhere (nature/military/mining), each tagged
// with which loader it needs (shared-atlas vs. own-material vs. full PBR map set).
type LevelElementSpec =
  | { loader: 'atlas'; url: string; tex: string }
  | { loader: 'raw'; url: string; tint?: string }
  | { loader: 'pbr'; url: string; tex: { diffuse: string; normal: string; roughness: string; metallic: string } };
const LEVEL_ELEMENTS: LevelElementSpec[] = [
  { loader: 'atlas', url: NATURE_ASSETS.trees[0], tex: NATURE_TEX },
  { loader: 'atlas', url: NATURE_ASSETS.trees[2], tex: NATURE_TEX },
  { loader: 'atlas', url: NATURE_ASSETS.trees[4], tex: NATURE_TEX },
  { loader: 'atlas', url: NATURE_ASSETS.bushes[0], tex: NATURE_TEX },
  { loader: 'atlas', url: NATURE_ASSETS.bushes[2], tex: NATURE_TEX },
  { loader: 'atlas', url: NATURE_ASSETS.rocks[1], tex: NATURE_TEX },
  { loader: 'atlas', url: NATURE_ASSETS.rocks[4], tex: NATURE_TEX },
  { loader: 'atlas', url: NATURE_ASSETS.flowers[0], tex: NATURE_TEX },
  { loader: 'atlas', url: NATURE_ASSETS.flowers[1], tex: NATURE_TEX },
  { loader: 'atlas', url: MILITARY_ASSETS.boxes[0], tex: MILITARY_TEX },
  { loader: 'atlas', url: MILITARY_ASSETS.boxes[1], tex: MILITARY_TEX },
  { loader: 'atlas', url: MILITARY_ASSETS.barrel, tex: MILITARY_TEX },
  { loader: 'atlas', url: MILITARY_ASSETS.tires, tex: MILITARY_TEX },
  { loader: 'atlas', url: MILITARY_ASSETS.cacti[0], tex: MILITARY_TEX },
  { loader: 'raw', url: MINING_ASSETS.rockMoss, tint: '#5b5f6b' },
  { loader: 'raw', url: MINING_ASSETS.crateWooden, tint: '#7a5a34' },
  { loader: 'raw', url: MINING_ASSETS.gemGreen, tint: '#4ade80' },
  { loader: 'raw', url: MINING_ASSETS.gemGold, tint: '#e8c04a' },
  { loader: 'raw', url: MINING_ASSETS.lantern, tint: '#e8c04a' },
  { loader: 'pbr', url: PBR_PROP_ASSETS.crateXBrace, tex: PBR_PROP_TEX.crateXBrace },
];
function LevelElementProp({ spec, size, rotation }: { spec: LevelElementSpec; size: number; rotation: number }) {
  if (spec.loader === 'atlas') return <FbxProp url={spec.url} tex={spec.tex} size={size} rotation={rotation} />;
  if (spec.loader === 'raw') return <FbxRawProp url={spec.url} size={size} rotation={rotation} tint={spec.tint} />;
  return <FbxPbrProp url={spec.url} tex={spec.tex} size={size} rotation={rotation} />;
}

/** MODEL-ONLY sprawl — no procedural three.js fallback geometry, at any level (per
 *  design direction). Every district stage (every 5th level) gets its themed
 *  BaseDistrictMesh dressing PLUS a house-model anchor building — the ONLY stages that
 *  place a full house now. Every other level gets one small LEVEL_ELEMENTS prop instead,
 *  so growth still reads every level without a full building each time. */
function CityBuildingsMesh({ spots, size, tier, color, houses }: { spots: CitySpot[]; size: number; tier: number; color?: string; houses?: string[] }) {
  const S = size * (0.92 + tier * 0.04); // the whole city's scale creeps up with tier
  return (
    <group>
      {spots.map((s, i) => (
        <group key={i} position={[s.x, s.y, s.z]} rotation={[0, s.rot, 0]}>
          {s.districtKind ? (
            <>
              <BaseDistrictMesh size={size * (0.85 + 0.08 * Math.min(3, s.districtRepeat ?? 0))} kind={s.districtKind} color={color ?? '#e5e7eb'} />
              {houses && houses.length > 0 && (
                <group position={[size * 0.6, 0, size * 0.45]}>
                  <Suspense fallback={null}>
                    <HouseVariantModel url={houseForSpot(houses, s.kind ?? 0, s.v ?? 0)} size={S * (0.5 + 0.24 * (s.h ?? 1))} rotation={0} />
                  </Suspense>
                </group>
              )}
            </>
          ) : (
            <Suspense fallback={null}>
              <LevelElementProp spec={LEVEL_ELEMENTS[(s.elementIdx ?? 0) % LEVEL_ELEMENTS.length]} size={size * (s.elementScale ?? 0.4)} rotation={s.rot} />
            </Suspense>
          )}
        </group>
      ))}
    </group>
  );
}

/** Stroked border around the base's home zone — the Civ-style territory outline.
 *  `positions` is a prebuilt ribbon (world-space triangles hugging the zone's outer
 *  hex edges); the material pulses gently so the border reads as a live perimeter. */
function BaseZoneRing({ positions, color }: { positions: Float32Array; color: string }) {
  const matRef = React.useRef<THREE.MeshBasicMaterial>(null);
  const geo = React.useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.computeBoundingSphere();
    return g;
  }, [positions]);
  React.useEffect(() => () => geo.dispose(), [geo]);
  useFrame(({ clock }) => { if (matRef.current) matRef.current.opacity = 0.6 + Math.sin(clock.getElapsedTime() * 1.6) * 0.18; });
  return (
    <mesh geometry={geo} renderOrder={16} frustumCulled={false}>
      <meshBasicMaterial ref={matRef} color={color} transparent opacity={0.7} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
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

/** Capturable outpost — the watchtower + garrison props; faction-colored glow when owned.
 *  Desert-region outposts (`desert`) swap the generic watchtower for the modeled
 *  desert-outpost building instead (2026-07-18: "add desert outposts to desert region"),
 *  keeping the same barrier/hedgehog perimeter dressing either way. */
function OutpostMarker({ size, owned, color, desert }: { size: number; owned: boolean; color: string; desert?: boolean }) {
  const S = size;
  return (
    <group>
      <Suspense fallback={null}>
        {desert ? (
          <group position={[-S * 0.42, 0, -S * 0.28]} rotation={[0, 0.5, 0]}>
            <GltfRawProp url={DESERT_OUTPOST_ASSET} size={S * 2.2} />
          </group>
        ) : (
          /* Garrison set-dressing from the military FBX pack: watchtower + barrier + tank trap */
          <group position={[-S * 0.55, 0, -S * 0.35]}><FbxProp url={MILITARY_ASSETS.tower} tex={MILITARY_TEX} size={S * 1.9} rotation={0.6} tint={owned ? color : undefined} /></group>
        )}
        <group position={[S * 0.5, 0, S * 0.45]}><FbxProp url={MILITARY_ASSETS.barriers[0]} tex={MILITARY_TEX} size={S * 0.55} rotation={-0.4} /></group>
        <group position={[-S * 0.15, 0, S * 0.62]}><FbxProp url={MILITARY_ASSETS.hedgehog} tex={MILITARY_TEX} size={S * 0.3} rotation={0.9} /></group>
      </Suspense>
      <Text position={[0, S * 1.9, 0]} fontSize={S * 0.3} color={owned ? '#bfead0' : '#cfd4da'} anchorX="center" anchorY="middle" outlineWidth={S * 0.03} outlineColor="#000">{desert ? '🏜️ ' : ''}{owned ? 'Outpost ✓' : 'Outpost'}</Text>
    </group>
  );
}

// Fixed field-shrine offset (from map center) per faction — the SAME three offsets
// regardless of which faction the player picked, so "mine" vs "rival" is purely which
// offset matches playerFactionKey. Spaced well apart so a hero near one is never also
// near another.
const MASK_OFFSETS: Record<'PAA' | 'ASF' | 'WC', { dq: number; dr: number }> = {
  PAA: { dq: -7, dr: 5 },
  ASF: { dq: 9, dr: -6 },
  WC:  { dq: -3, dr: -10 },
};

/** The faction relic mask itself — a slow idle spin so it reads as a display piece,
 *  not scenery, at both the field shrine and the base pedestal. */
function MaskProp({ faction, size }: { faction: 'PAA' | 'ASF' | 'WC'; size: number }) {
  const ref = React.useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 0.5; });
  const asset = MASK_ASSETS[faction];
  return (
    <group ref={ref}>
      {/* Source FBX exports sit face-down by default (2026-07-19 user report) — a fixed
          90° Z-axis correction stands the mask upright, facing outward. Applied on an
          inner group so it doesn't fight the outer idle Y-axis spin above. */}
      <group rotation={[0, 0, Math.PI / 2]}>
        <FbxProp url={asset.url} tex={asset.tex} size={size} />
      </group>
    </group>
  );
}

/** Field shrine holding an UNCLAIMED faction mask (GDD "collect and defend your
 *  mask") — a stone pedestal + the mask prop + a soft ground glow. Walking adjacent
 *  auto-claims it (see the mask-collect effect in the main component), no keypress. */
function MaskShrine({ faction, size }: { faction: 'PAA' | 'ASF' | 'WC'; size: number }) {
  const glowRef = React.useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (glowRef.current) (glowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(clock.getElapsedTime() * 1.8) * 0.15; });
  const S = size;
  const color = FACTION_COLORS[faction]?.primary ?? '#e5c07b';
  return (
    <group>
      <mesh ref={glowRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[S * 0.9, 20]} /><meshBasicMaterial color={color} transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <mesh castShadow position={[0, S * 0.34, 0]}><cylinderGeometry args={[S * 0.32, S * 0.42, S * 0.68, 8]} /><meshStandardMaterial color="#4a4438" roughness={0.9} flatShading /></mesh>
      <mesh castShadow position={[0, S * 0.7, 0]}><cylinderGeometry args={[S * 0.4, S * 0.34, S * 0.06, 8]} /><meshStandardMaterial color="#5c5646" roughness={0.85} flatShading /></mesh>
      <Suspense fallback={
        <mesh position={[0, S * 1.05, 0]}><octahedronGeometry args={[S * 0.28, 0]} /><meshStandardMaterial color={color} roughness={0.4} metalness={0.3} flatShading /></mesh>
      }>
        <group position={[0, S * 1.0, 0]}><MaskProp faction={faction} size={S * 0.85} /></group>
      </Suspense>
      <Text position={[0, S * 1.8, 0]} fontSize={S * 0.28} color={color} anchorX="center" anchorY="middle" outlineWidth={S * 0.02} outlineColor="#000">🎭 {MASK_LORE[faction].title}</Text>
    </group>
  );
}

/** Upgrade prompt content for a player-secured outpost or cleared fortify camp — pick a
 *  specialization (locked in on first upgrade) or advance the chosen one, showing cost
 *  and affordability against the hero's current ore/energy/bio. Shared by both prompt
 *  sites (nearbyOutpost when owned, nearbyFortifiedCamp) so the two 5-tier systems stay
 *  visually and mechanically identical. */
function UpgradePanelContent({ title, icon, current, heroInventory, petInventory, onUpgrade }: {
  title: string; icon: string; current: CampUpgradeState;
  heroInventory: Array<{ type: string; quantity: number }>;
  /** Combined with heroInventory for affordability — the pet's auto-fetch deposits into
   *  its OWN pack, but the item bar shows both merged, so the buttons must judge
   *  affordability the same way spending actually works (upgradeLocation). */
  petInventory: Array<{ type: string; quantity: number }>;
  onUpgrade: (spec: CampSpecialization) => void;
}) {
  const have = (type: 'ore' | 'energy' | 'bio') =>
    (heroInventory.find(i => i.type === type)?.quantity ?? 0) + (petInventory.find(i => i.type === type)?.quantity ?? 0);
  if (current.tier >= CAMP_UPGRADE_MAX_TIER && current.spec) {
    return (
      <div className="px-4 py-2.5 rounded-xl bg-[#0c1219]/90 border border-emerald-400/40 text-xs sm:text-sm backdrop-blur-sm shadow-lg text-center space-y-1">
        <div className="font-bold">{icon} {title}</div>
        <div className="text-emerald-300 font-semibold">{SPEC_INFO[current.spec].icon} {SPEC_INFO[current.spec].label} · Max Tier {CAMP_UPGRADE_MAX_TIER}</div>
      </div>
    );
  }
  const specs: CampSpecialization[] = current.spec ? [current.spec] : ['military', 'food', 'medicine'];
  return (
    <div className="px-4 py-2.5 rounded-xl bg-[#0c1219]/90 border border-white/15 text-xs sm:text-sm backdrop-blur-sm shadow-lg text-center space-y-2">
      <div className="font-bold">{icon} {title}{current.spec ? ` · ${SPEC_INFO[current.spec].icon} ${SPEC_INFO[current.spec].label} Tier ${current.tier}` : ' · Undeveloped'}</div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {specs.map(s => {
          const cost = nextUpgradeCost(current, s);
          const afford = have('ore') >= cost.ore && have('energy') >= cost.energy && have('bio') >= cost.bio;
          return (
            <button key={s} onClick={() => onUpgrade(s)} disabled={!afford}
              title={`${SPEC_INFO[s].desc} Costs ⬢${cost.ore} ⚡${cost.energy} 🌿${cost.bio}.`}
              className={`px-3 py-1.5 rounded-lg font-bold ring-1 ${afford ? 'bg-emerald-700/80 hover:bg-emerald-600 ring-emerald-400/40' : 'bg-gray-800/70 ring-white/10 opacity-50 cursor-not-allowed'}`}>
              {SPEC_INFO[s].icon} {current.spec ? `Tier ${current.tier + 1}` : SPEC_INFO[s].label}
            </button>
          );
        })}
      </div>
      <div className="text-[10px] opacity-60">reinforces the faction (military) · attracts looters (food) · invites negotiation (medicine)</div>
    </div>
  );
}

/** Mask display at the base once claimed — a small plinth showing the relic is home
 *  (and, per GDD, now a target rivals will raid). */
function MaskPedestal({ faction, size }: { faction: 'PAA' | 'ASF' | 'WC'; size: number }) {
  const S = size;
  const color = FACTION_COLORS[faction]?.primary ?? '#e5c07b';
  return (
    <group>
      <mesh castShadow position={[0, S * 0.22, 0]}><cylinderGeometry args={[S * 0.24, S * 0.3, S * 0.44, 8]} /><meshStandardMaterial color="#4a4438" roughness={0.9} flatShading /></mesh>
      <Suspense fallback={
        <mesh position={[0, S * 0.58, 0]}><octahedronGeometry args={[S * 0.2, 0]} /><meshStandardMaterial color={color} roughness={0.4} metalness={0.3} flatShading /></mesh>
      }>
        <group position={[0, S * 0.55, 0]}><MaskProp faction={faction} size={S * 0.6} /></group>
      </Suspense>
    </group>
  );
}

// Refugee camp — a friendly settlement (tents + campfire) that offers a
// faction-specific side mission. Amber banner when the mission is open, green ✓ once
// its aid mission is complete.
function RefugeeCampMarker({ size, done, label, icon, mode, subtitle, showWcNpc }: { size: number; done: boolean; label: string; icon: string; mode: 'aid' | 'loot'; subtitle?: string; showWcNpc?: boolean }) {
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
  // Stacked supply crate — the modeled X-braced wooden crate (FBX) replaces this when
  // loaded; the procedural boxes remain as the Suspense fallback.
  const crate = (x: number, z: number, col = '#8a6a3a') => (
    <Suspense fallback={
      <group position={[x, 0, z]}>
        <mesh position={[0, S * 0.11, 0]} castShadow><boxGeometry args={[S * 0.24, S * 0.22, S * 0.24]} /><meshStandardMaterial color={col} roughness={0.85} flatShading /></mesh>
        <mesh position={[0, S * 0.3, 0]} rotation={[0, 0.4, 0]} castShadow><boxGeometry args={[S * 0.18, S * 0.16, S * 0.18]} /><meshStandardMaterial color={col} roughness={0.85} flatShading /></mesh>
      </group>
    }>
      <group position={[x, 0, z]}><FbxPbrProp url={PBR_PROP_ASSETS.crateXBrace} tex={PBR_PROP_TEX.crateXBrace} size={S * 0.4} /></group>
    </Suspense>
  );
  // Fuel/water barrel.
  const barrel = (x: number, z: number, col: string) => (
    <mesh position={[x, S * 0.16, z]} castShadow><cylinderGeometry args={[S * 0.12, S * 0.12, S * 0.32, 8]} /><meshStandardMaterial color={col} metalness={0.3} roughness={0.6} flatShading /></mesh>
  );
  return (
    <group>
      {/* Modeled army tents (FBX pack), tinted warm for aid camps / hostile for rival
          camps; the procedural cone tents remain as the loading fallback. Aid camps get
          a civilian yellow camping tent as their 3rd tent instead of a military one. */}
      <Suspense fallback={<>
        {tent(-S * 0.5, 0, Math.PI / 4, tents[0])}
        {tent(S * 0.55, S * 0.2, -Math.PI / 5, tents[1])}
        {tent(0, -S * 0.6, Math.PI / 3, tents[2])}
      </>}>
        <group position={[-S * 0.5, 0, 0]}><FbxProp url={MILITARY_ASSETS.tents[0]} tex={MILITARY_TEX} size={S * 1.15} rotation={Math.PI / 4} tint={loot ? '#a05a44' : '#c8a878'} /></group>
        <group position={[S * 0.55, 0, S * 0.2]}><FbxProp url={MILITARY_ASSETS.tents[1]} tex={MILITARY_TEX} size={S * 0.95} rotation={-Math.PI / 5} tint={loot ? '#8a4030' : undefined} /></group>
        {loot ? (
          <group position={[0, 0, -S * 0.6]}><FbxProp url={MILITARY_ASSETS.tents[0]} tex={MILITARY_TEX} size={S * 0.9} rotation={Math.PI / 3} tint={'#6a3a2a'} /></group>
        ) : (
          <group position={[0, 0, -S * 0.6]}><FbxPbrProp url={PBR_PROP_ASSETS.tentYellow} tex={PBR_PROP_TEX.tentYellow} size={S * 0.85} rotation={Math.PI / 3} /></group>
        )}
      </Suspense>
      {/* A rolled carpet outside the tents — civilian touch, aid camps only. */}
      {!loot && (
        <Suspense fallback={null}>
          <group position={[-S * 0.15, 0, S * 0.15]}><FbxPbrProp url={PBR_PROP_ASSETS.carpet} tex={PBR_PROP_TEX.carpet} size={S * 0.55} rotation={0.3} /></group>
        </Suspense>
      )}
      {/* WC-faction civilian NPC (only shown for WC players, for now) standing outside
          an active aid camp — purely a decorative presence, no dialogue/logic yet. */}
      {!loot && !done && showWcNpc && (
        <Suspense fallback={null}>
          <group position={[S * 0.3, 0, -S * 0.2]} rotation={[0, 0.6, 0]}><FbxAnimatedTexturedProp url={WC_NPC_ASSET} tex={WC_NPC_TEX} size={S * 1.1} playing /></group>
        </Suspense>
      )}
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
      {/* campfire — the modeled FBX (logs + stones baked in) replaces the procedural
          base/stones/logs when loaded; the flickering flame cone stays separate so it
          keeps animating regardless of load state. */}
      <Suspense fallback={<>
        <mesh position={[0, S * 0.06, S * 0.35]}><cylinderGeometry args={[S * 0.18, S * 0.22, S * 0.08, 8]} /><meshStandardMaterial color="#3a2a1e" roughness={1} flatShading /></mesh>
        {[0, 1, 2, 3, 4].map(i => { const a = (i / 5) * Math.PI * 2; return (
          <mesh key={i} position={[Math.cos(a) * S * 0.2, S * 0.05, S * 0.35 + Math.sin(a) * S * 0.2]}><dodecahedronGeometry args={[S * 0.05, 0]} /><meshStandardMaterial color="#555049" roughness={1} flatShading /></mesh>
        ); })}
        <mesh position={[0, S * 0.05, S * 0.35]} rotation={[Math.PI / 2, 0, 0.4]}><cylinderGeometry args={[S * 0.03, S * 0.03, S * 0.34, 5]} /><meshStandardMaterial color="#2a1c12" roughness={1} flatShading /></mesh>
      </>}>
        <group position={[0, 0, S * 0.35]}><FbxPbrProp url={PBR_PROP_ASSETS.campfire} tex={PBR_PROP_TEX.campfire} size={S * 0.7} /></group>
      </Suspense>
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
      {/* Action buttons: basic attack, collect, and QUICK ATTACKS 1+2 (first two
          offensive ability slots, Q/E). Capture and aid don't need buttons here —
          outposts and camps show their own on-screen choice buttons when nearby. */}
      <div className="grid grid-cols-2 gap-2">
        <TouchButton kbdKey="f" label="⚔️" size="h-12 w-12 text-xl" />
        <TouchButton kbdKey="c" label="✋" size="h-12 w-12 text-xl" />
        <TouchButton kbdKey="q" label={<span className="leading-none">⚡<b className="text-[11px] align-top">1</b></span>} size="h-12 w-12 text-xl" />
        <TouchButton kbdKey="e" label={<span className="leading-none">⚡<b className="text-[11px] align-top">2</b></span>} size="h-12 w-12 text-xl" />
      </div>
    </div>
  );
}

function tileColor(t: Tile) {
  if (t.type === 'water') return '#87d5ff';
  if (t.type === 'desert') return '#f7d08a';
  // Matches the plains relief gradient's "high" tone (was a mismatched bright
  // mint '#a7e39b' that visibly clashed against the olive-green grass bump/relief
  // mesh painted on top, showing as a color seam on the tile's side walls).
  if (t.type === 'plains') return '#9cc968';
  if (t.type === 'forest') return '#59b96b';
  if (t.type === 'jungle') return '#2a7f49';
  if (t.type === 'hills') return '#a2b86a';
  if (t.type === 'mountain') return '#9aa3a7';
  return '#c9c6c0';
}

// All tiles are the same flat height — terrain "reads" through what's placed ON TOP
// (mountain massif/relief bump, forest trees, hills bumps, water waves) rather than the
// flat hex slab itself being taller/shorter per type, which used to create visible
// stepped cliffs between adjacent tiles of different terrain.
const TILE_HEIGHT: Record<string, number> = {
  water: 0.4, desert: 0.4, plains: 0.4, forest: 0.4, jungle: 0.4, hills: 0.4, mountain: 0.4,
};
function heightFor(t: Tile) { return TILE_HEIGHT[t.type] ?? 0.4; }

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
  // Walk-cycle rate synced from the opponent's own SPD+haste snapshot (falls back to a
  // normal 1x pace for stale/pre-sync frames) so their animation matches how fast they move.
  const speedMult = Math.max(0.55, Math.min(2.2, remote?.spd ?? 1));
  return (
    <>
      <group ref={groupRef} frustumCulled={false}>
        <IsometricCharacter gender={(remote?.gender as any) ?? 'MALE'} colors={rivalColors} hexSize={hexSize} faction={remote?.faction as any} isMoving={!!remote?.moving} facingAngle={0} speedMult={speedMult} />
        <Text position={[0, hexSize * 2.4, 0]} fontSize={hexSize * 0.42} color="#ff9a9a" anchorX="center" anchorY="middle" outlineWidth={hexSize * 0.03} outlineColor="#000">{`⚔️ ${remote?.name ?? 'Rival'}`}</Text>
        <group position={[0, hexSize * 2.0, 0]}>
          <mesh><planeGeometry args={[hexSize * 1.4, hexSize * 0.16]} /><meshBasicMaterial color="#2a0a0a" /></mesh>
          <mesh position={[-(hexSize * 1.4 * (1 - hpPct)) / 2, 0, 0.01]} scale={[Math.max(0.002, hpPct), 1, 1]}><planeGeometry args={[hexSize * 1.4, hexSize * 0.16]} /><meshBasicMaterial color="#e0453f" /></mesh>
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

/**
 * Victory-track chips — the four win-condition readouts that live INSIDE the Civ-6-style
 * top HUD bar. Each chip shows its icon (slightly enlarged), the leading faction's progress,
 * and is clickable to expand a per-faction breakdown (VictoryTrackDetail).
 */
const VictoryTrackChips = React.memo(function VictoryTrackChips({
  victory, myFaction, expanded, onToggle,
}: { victory: FactionVictory; myFaction?: string | null; expanded: VictoryTrack | null; onToggle: (t: VictoryTrack) => void }) {
  return (
    <div className="flex items-center gap-1 pointer-events-auto">
      {VICTORY_TRACKS.map(t => {
        const def = VICTORY_TRACK_DEFS[t];
        const lead = trackLeader(victory, t);
        const frac = Math.min(1, def.threshold > 0 ? lead.value / def.threshold : 0);
        const col = FACTION_COLORS[lead.faction]?.primary ?? '#8a8f96';
        const mine = !!myFaction && lead.faction === myFaction;
        const active = expanded === t;
        return (
          <button
            key={t}
            onClick={() => onToggle(t)}
            title={`${def.label}, ${def.blurb}. Click for details.`}
            className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-1 rounded-lg ring-1 transition ${active ? 'bg-white/12 ring-white/35' : 'ring-transparent hover:bg-white/[0.07] hover:ring-white/15'}`}
          >
            <span className="text-base sm:text-lg leading-none">{def.icon}</span>
            <div className="flex flex-col gap-0.5 w-8 sm:w-11">
              <div className="relative h-1 rounded-full bg-black/50 overflow-hidden ring-1 ring-white/10">
                <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300" style={{ width: `${frac * 100}%`, background: col }} />
              </div>
              <span className="text-[8.5px] font-semibold tabular-nums leading-none" style={{ color: mine ? col : 'rgba(255,255,255,0.6)' }}>
                {lead.faction} {Math.round(lead.value)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
});

/** Expanded per-faction breakdown for one victory track (opens under the top bar). */
const VictoryTrackDetail = React.memo(function VictoryTrackDetail({
  track, victory, myFaction, onClose,
}: { track: VictoryTrack; victory: FactionVictory; myFaction?: string | null; onClose: () => void }) {
  const def = VICTORY_TRACK_DEFS[track];
  const rows = FACTIONS.map(f => ({ f, v: victory[f][track] })).sort((a, b) => b.v - a.v);
  return (
    <div className="w-[16rem] max-w-[92vw] p-3 rounded-xl bg-[#0c1219]/97 ring-1 ring-white/15 shadow-2xl text-gray-100">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5"><span className="text-lg">{def.icon}</span><span className="font-bold text-sm">{def.label}</span></div>
        <button onClick={onClose} className="opacity-60 hover:opacity-100 text-sm leading-none">✕</button>
      </div>
      <div className="text-[11px] opacity-60 mb-2.5 leading-snug">
        {def.blurb}. First faction to {def.threshold} wins the match.{def.natural ? ` ${def.natural} earns ×1.5 here (its ethos track).` : ' Open to every faction equally.'}
      </div>
      <div className="space-y-1.5">
        {rows.map(({ f, v }) => {
          const col = FACTION_COLORS[f]?.primary ?? '#8a8f96';
          const frac = Math.min(1, def.threshold > 0 ? v / def.threshold : 0);
          return (
            <div key={f} className="flex items-center gap-2">
              <span className="w-9 text-[10px] font-bold" style={{ color: FACTION_COLORS[f]?.label }}>{f}{f === myFaction ? ' •' : ''}</span>
              <div className="flex-1 relative h-2 rounded-full bg-black/50 overflow-hidden ring-1 ring-white/10">
                <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${frac * 100}%`, background: col }} />
              </div>
              <span className="w-12 text-right text-[10px] tabular-nums opacity-80">{Math.round(v)}/{def.threshold}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

function cloneVictory(v: FactionVictory): FactionVictory {
  return { PAA: { ...v.PAA }, ASF: { ...v.ASF }, WC: { ...v.WC } };
}
// Each rival faction's off-screen 4X progress accrues on its ethos-aligned track.
const NATURAL_TRACK: Record<Faction, VictoryTrack> = { PAA: 'prosperity', ASF: 'domination', WC: 'exploitation' };

// Mission approaches are SKILL-GATED (GDD: the skill tree unlocks strategic options):
// tactical diplomacy needs the Diplomacy core ("Negotiation"), quiet takeovers need the
// Stealth core ("Stealth Mode"). Assault/help/loot are always available.
const APPROACH_SKILL: Record<'negotiate' | 'infiltrate', { skillId: string; label: string }> = {
  negotiate:  { skillId: 'diplomacy_core', label: 'Negotiation (Diplomacy core)' },
  infiltrate: { skillId: 'stealth_core',   label: 'Stealth Mode (Stealth core)' },
};
function approachSkillUnlocked(approach: string): boolean {
  const req = (APPROACH_SKILL as Record<string, { skillId: string }>)[approach];
  return !req || useSkillStore.getState().unlocked.includes(req.skillId);
}

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
  // Human rivals sync their own SPD+haste-derived pace; AI bots just walk at a normal rate.
  const speedMult = Math.max(0.55, Math.min(2.2, hero.spd ?? 1));
  return (
    <>
      <group ref={groupRef} frustumCulled={false}>
        <IsometricCharacter gender={(hero.gender as any) ?? 'MALE'} colors={colors} hexSize={hexSize} faction={hero.faction as any} isMoving={!!hero.moving} facingAngle={0} speedMult={speedMult} />
        <Text position={[0, hexSize * 2.4, 0]} fontSize={hexSize * 0.4} color={fc.label} anchorX="center" anchorY="middle" outlineWidth={hexSize * 0.03} outlineColor="#000">{tag}</Text>
        <group position={[0, hexSize * 2.0, 0]}>
          <mesh><planeGeometry args={[hexSize * 1.4, hexSize * 0.16]} /><meshBasicMaterial color="#20242c" /></mesh>
          <mesh position={[-(hexSize * 1.4 * (1 - hpPct)) / 2, 0, 0.01]} scale={[Math.max(0.002, hpPct), 1, 1]}><planeGeometry args={[hexSize * 1.4, hexSize * 0.16]} /><meshBasicMaterial color={fc.primary} /></mesh>
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

// Energy-crystal variants — the mining pack's gemstone models, varied per node so the
// map shows a mix of crystal types/colours instead of one repeated blue prop.
const GEM_VARIANTS = [
  { key: 'gemBlue' as const, tint: '#4aa8e0' },
  { key: 'gemGreen' as const, tint: '#4ade80' },
  { key: 'gemRed' as const, tint: '#e06060' },
  { key: 'gemGold' as const, tint: '#e8c04a' },
  { key: 'gemCopper' as const, tint: '#c8845a' },
  { key: 'crystalRed' as const, tint: '#d84a6a' },
];

/** Low-poly 3D resource node placed on a tile (ore/energy/bio). Isometric, faceted;
 *  no glow halos/emissives — gatherables read from their shape + colour (per design,
 *  the old pulsing-blue energy glow was removed 2026-07-18). */
function ResourceProp({ type, size, seed = 1 }: { type: ResourceType; size: number; seed?: number }) {
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
        {/* Extra mossy rock + gemstone glints from the mining prop pack, purely additive
            set-dressing (own vertex-color materials, no fallback needed if still loading). */}
        <Suspense fallback={null}>
          <group position={[S * 0.4, 0, S * 0.32]}><FbxRawProp url={MINING_ASSETS.rockMoss} tint="#5b5f6b" size={S * 0.5} rotation={seed} /></group>
          <group position={[-S * 0.38, 0, -S * 0.22]}><FbxRawProp url={MINING_ASSETS.gemGold} tint="#e8c04a" size={S * 0.24} rotation={seed * 1.7} /></group>
        </Suspense>
      </group>
    );
  }
  if (type === 'energy') {
    // Crystal node = the mining pack's modeled gemstones, main + companion picked per
    // node so types vary across the map. Plain materials, no glow/emissive.
    const main = GEM_VARIANTS[Math.floor(Math.abs(seed * 7.31)) % GEM_VARIANTS.length];
    const side = GEM_VARIANTS[(Math.floor(Math.abs(seed * 7.31)) + 2) % GEM_VARIANTS.length];
    return (
      <group position={[ox, 0, oz]} rotation={[0, seed, 0]}>
        <Suspense fallback={
          <mesh castShadow position={[0, S * 0.55, 0]}>
            <coneGeometry args={[S * 0.3, S * 1.1, 6]} />
            <meshStandardMaterial color={main.tint} roughness={0.3} metalness={0.3} flatShading />
          </mesh>
        }>
          <FbxRawProp url={MINING_ASSETS[main.key]} tint={main.tint} size={S * 1.15} rotation={seed} />
          <group position={[S * 0.5, 0, S * 0.34]}>
            <FbxRawProp url={MINING_ASSETS[side.key]} tint={side.tint} size={S * 0.55} rotation={seed * 2.3} />
          </group>
        </Suspense>
      </group>
    );
  }
  // bio — natural plant colors, no glow halo/emissive (matches the mushroom collectible's
  // earlier de-glow fix; a leafy resource node doesn't need to look radioactive).
  return (
    <group position={[ox, 0, oz]} rotation={[0, seed, 0]}>
      <mesh castShadow position={[0, S * 0.55, 0]}>
        <icosahedronGeometry args={[S * 0.5, 0]} />
        <meshStandardMaterial color="#3fa14a" roughness={0.7} flatShading />
      </mesh>
      <mesh position={[0, S * 0.95, 0]}>
        <icosahedronGeometry args={[S * 0.24, 0]} />
        <meshStandardMaterial color="#8fe36b" roughness={0.6} flatShading />
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

/** Forest tile dressed with the SimpleNature FBX pack: 3-4 modeled trees plus an
 *  occasional stump or bush, seeded per tile. Used under Suspense with the
 *  procedural TreeCluster as its loading fallback. */
function FbxForest({ size, seed = 1 }: { size: number; seed?: number }) {
  const rng = useMemo(() => seededRand(seed), [seed]);
  const items = useMemo(() => {
    const arr: Array<{ url: string; tex: string; x: number; z: number; s: number; rot: number }> = [];
    const n = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const ang = rng() * Math.PI * 2, rad = (0.15 + rng() * 0.6) * size * 0.9;
      arr.push({
        url: NATURE_ASSETS.trees[Math.floor(rng() * NATURE_ASSETS.trees.length)], tex: NATURE_TEX,
        x: Math.cos(ang) * rad, z: Math.sin(ang) * rad,
        s: size * (1.5 + rng() * 0.9), rot: rng() * Math.PI * 2,
      });
    }
    if (rng() > 0.45) {
      const ang = rng() * Math.PI * 2, rad = (0.4 + rng() * 0.4) * size * 0.9;
      // Occasionally a fly-agaric mushroom instead of the usual stump/bush.
      const pick = rng();
      const url = pick > 0.72 ? MUSHROOM_ASSET : pick > 0.36 ? NATURE_ASSETS.stump : NATURE_ASSETS.bushes[Math.floor(rng() * NATURE_ASSETS.bushes.length)];
      arr.push({
        url, tex: url === MUSHROOM_ASSET ? MUSHROOM_TEX : NATURE_TEX,
        x: Math.cos(ang) * rad, z: Math.sin(ang) * rad,
        s: size * (url === MUSHROOM_ASSET ? 0.22 + rng() * 0.1 : 0.3 + rng() * 0.2), rot: rng() * Math.PI * 2,
      });
    }
    return arr;
  }, [rng, size]);
  return (
    <group>
      {items.map((it, i) => (
        <group key={i} position={[it.x, 0, it.z]}>
          <FbxProp url={it.url} tex={it.tex} size={it.s} rotation={it.rot} />
        </group>
      ))}
    </group>
  );
}

/** A pair of desert cacti from the military pack, seeded per tile. */
function DesertCacti({ size, seed = 1 }: { size: number; seed?: number }) {
  const rng = useMemo(() => seededRand(seed), [seed]);
  const items = useMemo(() => {
    const n = 1 + Math.floor(rng() * 2);
    return Array.from({ length: n }, () => {
      const ang = rng() * Math.PI * 2, rad = (0.2 + rng() * 0.55) * size * 0.9;
      return {
        url: MILITARY_ASSETS.cacti[Math.floor(rng() * MILITARY_ASSETS.cacti.length)],
        x: Math.cos(ang) * rad, z: Math.sin(ang) * rad,
        s: size * (0.45 + rng() * 0.35), rot: rng() * Math.PI * 2,
      };
    });
  }, [rng, size]);
  return (
    <group>
      {items.map((it, i) => (
        <group key={i} position={[it.x, 0, it.z]}>
          <FbxProp url={it.url} tex={MILITARY_TEX} size={it.s} rotation={it.rot} />
        </group>
      ))}
    </group>
  );
}

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
// ── Noise-displaced terrain relief ──────────────────────────────────────────
// Adapts the three.js `webgl_geometry_terrain` technique (Perlin-fbm heightfield +
// height-tinted shading) to the hex map: each mountain/hills/desert/plains tile gets
// a hex-clipped displaced mesh whose edge falls to the tile top, so organic terrain
// sits ON the tiles without breaking tile-based gameplay (movement, vision, capture
// all still read the flat hex heights). Geometry is cached in 8 seed buckets per
// type, so the whole map shares a handful of geometries.
const reliefPerlin = new ImprovedNoise();
function reliefFbm(x: number, z: number, seedZ: number, octaves = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * reliefPerlin.noise(x * freq, z * freq, seedZ + o * 7.31);
    norm += amp; amp *= 0.5; freq *= 2.05;
  }
  return sum / norm; // ≈ [-1, 1]
}
/** Distance from center to the flat-top hex boundary at polar angle `a`. `HexTile`'s
 *  base tile mesh is rotated 30° (`Math.PI/6`) so its VERTICES sit at 0°,60°,120°,...
 *  and its FLAT EDGES face the neighbor directions (30°,90°,150°,...) — that's what
 *  actually tiles edge-to-edge with no gaps. This must return the hex's shortest
 *  reach (apothem) at those SAME edge-facing angles (30°,90°,...) and its longest
 *  reach (full circumradius, the corner) at 0°,60°,... to match. A previous version
 *  subtracted an extra `Math.PI/6` phase here, putting the corners at 30°,90°,...
 *  instead — i.e. this relief mesh's own hex footprint was rotated 30° relative to
 *  the tile beneath it, so its corners poked past the tile's real edge into the
 *  NEXT tile (at 30°,90°,...) while falling short of the tile's actual corners (at
 *  0°,60°,...). Visually that reads as "tiles meeting at a tip instead of an edge,
 *  with a gap" — only affects RELIEF_SPECS terrain (mountain/hills/desert/plains),
 *  since water/forest/jungle don't use hexReliefGeo. */
function hexBoundaryR(a: number, R: number) {
  const sector = Math.PI / 3;
  const d = ((a % sector) + sector) % sector - sector / 2;
  return (R * Math.cos(Math.PI / 6)) / Math.cos(d);
}
type ReliefKind = 'mountain' | 'hills' | 'desert' | 'plains' | 'water';
const RELIEF_SPECS: Record<ReliefKind, { amp: number; peak: number; freq: number; low: string; high: string; ridged?: boolean; dome?: boolean; snow?: string; snowFrom?: number }> = {
  // amp/peak are in units of hexSize; freq is noise cycles across a tile.
  // `dome` = relief peaks at the tile CENTER — only allowed on impassable terrain.
  // Walkable types instead use a ring profile that is FLAT at the center (where all
  // actors anchor at tileTop+0.08) and at the edges, so feet never sink into bumps.
  mountain: { amp: 1.1, peak: 0.8, freq: 1.7, ridged: true, dome: true, low: '#59636a', high: '#98a3a9', snow: '#eef4f7', snowFrom: 0.58 },
  hills:    { amp: 0.28, peak: 0.14, freq: 2.1, low: '#7ba244', high: '#a9d162' },
  desert:   { amp: 0.12, freq: 2.6, peak: 0, low: '#c5a55c', high: '#e6cd8c' },
  plains:   { amp: 0.09, freq: 2.4, peak: 0, low: '#7dab4c', high: '#9cc968' },
  // Gentle noise swells tinted deep→light blue, rendered with the translucent
  // water material below (replaces the old procedural rings/foam water).
  water:    { amp: 0.07, freq: 3.1, peak: 0, low: '#1e6f9c', high: '#7fd4f2' },
};
const reliefGeoCache = new Map<string, THREE.BufferGeometry>();
function hexReliefGeo(kind: ReliefKind, R: number, seed: number): THREE.BufferGeometry {
  const bucket = ((seed % 8) + 8) % 8;
  const key = `${kind}:${R.toFixed(3)}:${bucket}`;
  const hit = reliefGeoCache.get(key);
  if (hit) return hit;
  const spec = RELIEF_SPECS[kind];
  const rings = 8, spokes = 30;
  const pos: number[] = [], col: number[] = [];
  const cLow = new THREE.Color(spec.low), cHigh = new THREE.Color(spec.high);
  const cSnow = spec.snow ? new THREE.Color(spec.snow) : null;
  const seedZ = bucket * 13.7 + kind.length * 3.1;
  const maxY = (spec.amp + spec.peak) * R;
  const tmp = new THREE.Color();
  const pushVert = (f: number, a: number) => {
    const rB = hexBoundaryR(a, R) * f;
    const x = Math.cos(a) * rB, z = Math.sin(a) * rB;
    // Dome (impassable mountains): 1 at center → 0 at the hex edge. Walkable
    // terrain: ring profile, flat at BOTH the tile center (actors stand there,
    // anchored to the flat tileTop) and the edge — relief lives in between.
    const fall = spec.dome
      ? Math.pow(Math.max(0, 1 - f), 0.55)
      : Math.pow(Math.sin(Math.PI * Math.min(1, f)), 1.15);
    const n = reliefFbm((x / R) * spec.freq, (z / R) * spec.freq, seedZ);
    const nVal = spec.ridged ? Math.pow(1 - Math.abs(n), 1.6) : n * 0.5 + 0.5; // ridged fbm = crags
    const y = Math.max(0.012, R * (spec.amp * nVal * fall + spec.peak * fall * fall));
    pos.push(x, y, z);
    const h = Math.min(1, y / maxY);
    tmp.copy(cLow).lerp(cHigh, Math.min(1, h * 1.5));
    if (cSnow && spec.snowFrom != null && h > spec.snowFrom) {
      tmp.lerp(cSnow, Math.min(1, (h - spec.snowFrom) / (1 - spec.snowFrom) * 1.6));
    }
    col.push(tmp.r, tmp.g, tmp.b);
  };
  pushVert(0, 0); // center
  for (let i = 1; i <= rings; i++) for (let k = 0; k < spokes; k++) pushVert(i / rings, (k / spokes) * Math.PI * 2);
  const idx: number[] = [];
  const vAt = (i: number, k: number) => 1 + (i - 1) * spokes + (k % spokes); // ring i ≥ 1
  for (let k = 0; k < spokes; k++) idx.push(0, vAt(1, k + 1), vAt(1, k)); // center fan
  for (let i = 1; i < rings; i++) for (let k = 0; k < spokes; k++) {
    const a = vAt(i, k), b = vAt(i, k + 1), c = vAt(i + 1, k), d = vAt(i + 1, k + 1);
    idx.push(a, d, c, a, b, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  reliefGeoCache.set(key, g);
  return g;
}
/** Height of the noise relief bump at a tile's CENTER (mirrors hexReliefGeo's
 *  pushVert(0, a) math exactly) — used to lift actors (hero/pet/enemies/camps)
 *  so their feet meet the actual bumpy terrain surface instead of the flat tile
 *  top, which sits well below the grass/rock relief on plains/desert/hills. */
function reliefCenterHeight(kind: ReliefKind, R: number, seed: number): number {
  const spec = RELIEF_SPECS[kind];
  const bucket = ((seed % 8) + 8) % 8;
  const seedZ = bucket * 13.7 + kind.length * 3.1;
  const n = reliefFbm(0, 0, seedZ);
  const nVal = spec.ridged ? Math.pow(1 - Math.abs(n), 1.6) : n * 0.5 + 0.5;
  return Math.max(0.012, R * (spec.amp * nVal + spec.peak));
}
let reliefMatCache: THREE.MeshStandardMaterial | null = null;
let waterReliefMatCache: THREE.MeshStandardMaterial | null = null;
function sharedReliefMat(kind: ReliefKind) {
  if (kind === 'water') {
    if (!waterReliefMatCache) {
      waterReliefMatCache = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.18, metalness: 0.35, transparent: true, opacity: 0.9 });
      // GPU waves: displace water vertices by two travelling sine bands in WORLD space
      // (so the swell rolls continuously across tile boundaries). One shared shader +
      // one uniform driven by WaterWaveClock — no per-tile animation cost.
      waterReliefMatCache.onBeforeCompile = (shader) => {
        shader.uniforms.uWaveTime = { value: 0 };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uWaveTime;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
  vec3 afWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  transformed.y += sin(uWaveTime * 1.5 + afWorldPos.x * 1.2 + afWorldPos.z * 1.6) * 0.045
                 + sin(uWaveTime * 2.4 + afWorldPos.x * 2.8 - afWorldPos.z * 0.9) * 0.02;`);
        waterReliefMatCache!.userData.shader = shader;
      };
    }
    return waterReliefMatCache;
  }
  if (!reliefMatCache) reliefMatCache = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0.02 });
  return reliefMatCache;
}

/** Drives the shared water material's wave clock — mount ONCE inside the Canvas. */
function WaterWaveClock() {
  useFrame(({ clock }) => {
    const sh = waterReliefMatCache?.userData.shader;
    if (sh) sh.uniforms.uWaveTime.value = clock.getElapsedTime();
  });
  return null;
}

// World angle toward each axialNeighbors() entry (flat-top layout), for shoreline props.
const NEIGHBOR_ANGLES = [Math.PI / 6, (7 * Math.PI) / 6, Math.PI / 2, (3 * Math.PI) / 2, (11 * Math.PI) / 6, (5 * Math.PI) / 6];

/** Shoreline rocks: nature-pack rock models scattered along a water tile's land-facing
 *  edges (seeded per tile). Waves lap around them via the shared water shader. */
function ShoreRocks({ size, seed, landAngles }: { size: number; seed: number; landAngles: number[] }) {
  const rng = useMemo(() => seededRand(seed), [seed]);
  const items = useMemo(() => {
    const arr: Array<{ url: string; x: number; z: number; s: number; rot: number }> = [];
    const ap = hexApothem(size);
    for (const a of landAngles) {
      const n = rng() < 0.55 ? 1 : rng() < 0.5 ? 2 : 0; // some edges stay bare
      for (let i = 0; i < n; i++) {
        const ang = a + (rng() - 0.5) * 0.55;
        const rad = ap * (0.68 + rng() * 0.24); // hug the shoreline edge
        arr.push({
          url: NATURE_ASSETS.rocks[Math.floor(rng() * NATURE_ASSETS.rocks.length)],
          x: Math.cos(ang) * rad, z: Math.sin(ang) * rad,
          s: size * (0.16 + rng() * 0.16), rot: rng() * Math.PI * 2,
        });
      }
    }
    return arr;
  }, [rng, size, landAngles]);
  if (!items.length) return null;
  return (
    <group>
      {items.map((it, i) => (
        <group key={i} position={[it.x, -0.02, it.z]}>
          <FbxProp url={it.url} tex={NATURE_TEX} size={it.s} rotation={it.rot} />
        </group>
      ))}
    </group>
  );
}
/** One noise-displaced relief mesh, sitting on a tile top. */
function TerrainRelief({ kind, size, seed }: { kind: ReliefKind; size: number; seed: number }) {
  const geo = useMemo(() => hexReliefGeo(kind, size, seed), [kind, size, seed]);
  return <mesh geometry={geo} material={sharedReliefMat(kind)} castShadow={kind === 'mountain'} receiveShadow />;
}

function HillsDeco({ size, seed = 1 }: { size: number; seed?: number }) {
  const rng = useMemo(() => seededRand(seed), [seed]);
  const ap = hexApothem(size);
  // Hills read as GRASS: a rolling noise heightfield (same technique as mountains,
  // gentler amplitude) topped with grass-blade tufts and grey rocks.
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
      <TerrainRelief kind="hills" size={size} seed={seed} />
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

/** Mountain massif: a ridged-noise heightfield (three.js terrain technique) with
 *  height-tinted rock and snow baked into vertex colors, plus a scree apron. */
function MountainDeco({ size, seed=1 }: { size: number; seed?: number }) {
  const rng = useMemo(()=>seededRand(seed),[seed]);
  const scree = useMemo(() => Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2 + rng() * 0.8;
    const d = size * (0.78 + rng() * 0.45);
    return { x: Math.cos(a) * d, z: Math.sin(a) * d, s: 0.22 + rng() * 0.38, rx: rng() * 0.6, ry: rng() * Math.PI };
  }), [rng, size]);
  return (
    <group>
      <TerrainRelief kind="mountain" size={size} seed={seed} />
      {/* Scree apron at the base */}
      {scree.map((r, i) => (
        <mesh key={`rk${i}`} position={[r.x, size * 0.1 * r.s, r.z]} rotation={[r.rx, r.ry, 0]} castShadow>
          <dodecahedronGeometry args={[size * 0.17 * r.s, 0]} />
          <meshStandardMaterial color="#7c8489" roughness={0.9} metalness={0.03} flatShading />
        </mesh>
      ))}
    </group>
  );
}

// (The old procedural water — LakeDeco flat disc + WaterWaves floor/surface/foam/ripple
// rings — was removed: water tiles now render through the same noise TerrainRelief
// pipeline as every other terrain type, with a water-specific translucent material.)

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

  return (
    <group>
      {/* Mushroom body — the modeled fly-agaric FBX, natural texture colors (no tint).
          Procedural cone+sphere stand-in only while the model/texture are loading. */}
      <Suspense fallback={
        <>
          <mesh position={[0, S * 0.18, 0]} renderOrder={25}><cylinderGeometry args={[S * 0.06, S * 0.08, S * 0.36, 7]} /><meshStandardMaterial color="#e8dcc0" roughness={0.6} /></mesh>
          <mesh position={[0, S * 0.44, 0]} renderOrder={25}><sphereGeometry args={[S * 0.24, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.6]} /><meshStandardMaterial color="#c8342a" roughness={0.5} /></mesh>
        </>
      }>
        <group renderOrder={25}><FbxProp url={MUSHROOM_ASSET} tex={MUSHROOM_TEX} size={S * 0.9} /></group>
      </Suspense>
      {/* White spots on cap */}
      {Array.from({ length: 5 }).map((_, i) => {
        const angle = (i / 5) * Math.PI * 2;
        return (
          <mesh key={`spot-${i}`} position={[Math.cos(angle) * S * 0.12, S * 0.48, Math.sin(angle) * S * 0.12]} renderOrder={26}>
            <sphereGeometry args={[S * 0.04, 5, 4]} />
            <meshStandardMaterial color="#ffffff" roughness={0.4} />
          </mesh>
        );
      })}
      {/* Companion mushrooms — small FBX clones read richer than a lone cap */}
      {[{ x: S * 0.3, z: S * 0.12, s: 0.55 }, { x: -S * 0.26, z: -S * 0.16, s: 0.42 }].map((m, i) => (
        <Suspense key={`mini-${i}`} fallback={null}>
          <group position={[m.x, 0, m.z]} renderOrder={25}><FbxProp url={MUSHROOM_ASSET} tex={MUSHROOM_TEX} size={S * 0.6 * m.s} /></group>
        </Suspense>
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
/**
 * REMOVED: AvatarCollisionDetector — a legacy raycast-based floor clamp that built
 * FLAT plane colliders (hardcoded y=0.01) for every tile, ignoring the relief bump
 * height entirely, then clamped the hero group's Y every frame via
 * `Math.max(desiredY, currentPosition.y)`. Under normal terrain heights (base 0.4+)
 * this was a no-op (desiredY≈0.11 is always lower), but if the avatar's Y ever
 * dipped below ~0.11 for any reason (hit-react/knockback/jump), it would "correct"
 * the height back up to the flat 0.11 floor instead of the actual (possibly much
 * taller, e.g. mountain) terrain surface height — reading as the avatar's feet
 * sinking into the ground on elevated terrain. `tileTopAt()` (used directly on the
 * hero group's JSX `position`) is already the single, relief-aware source of truth
 * for every actor's ground height — this second, terrain-blind authority fighting
 * over the same Y value was the bug, not a fix. Deleted rather than patched.
 */

/**
 * Explored-memory tile layer as ONE instanced mesh. These tiles are pure map "memory"
 * (no interaction, dimmed, outside active play), yet they used to render as a full
 * HexTile + FoW overlay each — thousands of shadow-casting draw calls that GREW as the
 * player explored, which is exactly the "lags more the longer I play" curve. One
 * instanced draw with the FoW dim baked into per-instance colour replaces all of it.
 */
const MEMORY_TILE_CAP = 6000;
function MemoryTileField({ tiles: memTiles, hexSize }: { tiles: Tile[]; hexSize: number }) {
  const ref = React.useRef<THREE.InstancedMesh>(null);
  const geo = React.useMemo(() => new THREE.CylinderGeometry(hexSize * HEX_TILE_OVERLAP, hexSize * HEX_TILE_OVERLAP, 1, 6), [hexSize]);
  const mat = React.useMemo(() => new THREE.MeshLambertMaterial(), []);
  React.useEffect(() => {
    const m = ref.current; if (!m) return;
    const M = new THREE.Matrix4();
    const P = new THREE.Vector3();
    const Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 6, 0));
    const S = new THREE.Vector3();
    const c = new THREE.Color();
    const n = Math.min(memTiles.length, MEMORY_TILE_CAP);
    for (let i = 0; i < n; i++) {
      const t = memTiles[i];
      const { x, z } = axialToWorld(t, hexSize);
      const h = heightFor(t);
      P.set(x, h / 2, z); S.set(1, h, 1);
      M.compose(P, Q, S);
      m.setMatrixAt(i, M);
      c.set(tileColor(t)).multiplyScalar(0.48); // baked-in FoW "memory" dim
      m.setColorAt(i, c);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [memTiles, hexSize]);
  return <instancedMesh ref={ref} args={[undefined as any, undefined as any, MEMORY_TILE_CAP]} geometry={geo} material={mat} frustumCulled={false} />;
}

/**
 * Far-LOD stand-in for a rival unit: past FAR_ENEMY_DIST tiles the full chibi character
 * rig (dozens of meshes + a per-unit animation frame-loop) is wasted on a few pixels —
 * a faction-coloured cone using the shared material cache reads the same at that range.
 */
const FAR_ENEMY_DIST = 12;
const farConeGeoCache = new Map<string, THREE.ConeGeometry>();
function sharedFarConeGeo(size: number): THREE.ConeGeometry {
  const k = `${size}`;
  let g = farConeGeoCache.get(k);
  if (!g) { g = new THREE.ConeGeometry(size * 0.22, size * 0.7, 6); farConeGeoCache.set(k, g); }
  return g;
}

/**
 * Golden-hour sun that FOLLOWS the hero. The three.js default directional-light shadow
 * camera is a ±5-unit box at the world origin — on this map that meant shadows only
 * existed near spawn while every mesh still paid the castShadow cost. This wraps the
 * light + its target so the (wide) shadow frustum tracks the hero, giving real sun
 * shadows across the whole visible map at the same GPU price.
 */
function SunLight({ heroWorld, quality }: { heroWorld: { x: number; z: number }; quality: 'high' | 'low' }) {
  const lightRef = React.useRef<THREE.DirectionalLight>(null);
  const target = React.useMemo(() => new THREE.Object3D(), []);
  React.useEffect(() => {
    const l = lightRef.current; if (!l) return;
    l.position.set(heroWorld.x + 26, 38, heroWorld.z + 14);
    target.position.set(heroWorld.x, 0, heroWorld.z);
    target.updateMatrixWorld();
  }, [heroWorld.x, heroWorld.z, target]);
  const mapSize = quality === 'high' ? 2048 : 1024;
  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={lightRef}
        color="#ffd9a0"
        intensity={1.25}
        castShadow
        target={target}
        shadow-mapSize-width={mapSize}
        shadow-mapSize-height={mapSize}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-near={2}
        shadow-camera-far={110}
        shadow-bias={-0.00035}
      />
    </>
  );
}

// ── Shared geometry & material caches ─────────────────────────────────────────
// The map renders 1500+ hex tiles plus FoW/territory overlays; giving each mesh its
// own geometry/material (the JSX-child form) multiplies GPU state and memory for
// objects that are all identical. These caches hand every tile the SAME geometry
// and one material per distinct colour, which is a large chunk of the frame budget.
const hexGeoCache = new Map<string, THREE.CylinderGeometry>();
// Adjacent flat-top hex prisms sit with their side walls exactly touching at the shared
// edge — with every tile now the same flat height, those coincident walls z-fight at
// isometric angles and read as hairline gaps, worse between DIFFERENT terrain types
// (different tile materials/colors either side of the seam make any sliver of
// background bleeding through far more noticeable than a same-color seam). Inflate the
// rendered radius a bit beyond the perfect-tiling circumradius so neighbors overlap
// instead of exactly touching; tile CENTER spacing (axialToWorld) is untouched so
// nothing else (decor placement, actor anchoring) shifts.
const HEX_TILE_OVERLAP = 1.02;
function sharedHexGeo(radius: number, h: number): THREE.CylinderGeometry {
  const k = `${radius}:${h}`;
  let g = hexGeoCache.get(k);
  if (!g) { g = new THREE.CylinderGeometry(radius * HEX_TILE_OVERLAP, radius * HEX_TILE_OVERLAP, h, 6); hexGeoCache.set(k, g); }
  return g;
}
const tileMatCache = new Map<string, THREE.MeshStandardMaterial>();
// `variant` (0|1|2) nudges lightness ±3% so the terrain isn't a uniform carpet, while
// still sharing ONE material per (colour, variant) pair across the whole map.
function sharedTileMat(color: string, variant = 1): THREE.MeshStandardMaterial {
  const k = `${color}:${variant}`;
  let m = tileMatCache.get(k);
  if (!m) {
    const c = new THREE.Color(color);
    c.offsetHSL(0, 0, (variant - 1) * 0.03);
    m = new THREE.MeshStandardMaterial({ color: c });
    tileMatCache.set(k, m);
  }
  return m;
}
const overlayMatCache = new Map<string, THREE.MeshBasicMaterial>();
function sharedOverlayMat(color: string, opacity: number): THREE.MeshBasicMaterial {
  const k = `${color}:${opacity}`;
  let m = overlayMatCache.get(k);
  if (!m) { m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }); overlayMatCache.set(k, m); }
  return m;
}

function HexTile({ t, size, onClick, onHover }: { t: Tile; size: number; onClick: (t: Tile) => void; onHover?: (t: Tile | null) => void }) {
  const h = heightFor(t);
  const color = tileColor(t);
  // Deterministic per-tile shade variant — breaks the flat-carpet look for free.
  const variant = Math.abs(t.q * 31 + t.r * 57) % 3;
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
        geometry={sharedHexGeo(size, h)}
        material={sharedTileMat(color, variant)}
      />
    </group>
  );
}

/** Modeled cartoon dog/cat FBX — these packs are rigged with a baked "Take 001"
 *  walk-cycle clip, played via FbxAnimatedProp while moving and frozen (idle pose)
 *  while standing still. `tint` covers submeshes whose embedded material renders
 *  solid black (see FbxAnimatedProp doc). */
function PetFbxBody({ url, ps, isMoving, tint }: { url: string; ps: number; isMoving: boolean; tint?: string }) {
  return <FbxAnimatedProp url={url} size={ps * 1.8} playing={isMoving} tint={tint} />;
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
  /** Combat stats (atk/def/spd) — shown in the in-game menu overview AND drives real
   *  gameplay: def mitigates incoming damage (applyIncomingDamage), spd sets move speed. */
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
    petFetch,
  } = collectibles;

  // ── Hero XP + progression ─────────────────────────────────────────────────────
  const profileForXpRef = React.useRef(profile);
  profileForXpRef.current = profile;
  const heroPosRef = React.useRef(hero.pos);
  heroPosRef.current = hero.pos;

  // Floating combat/feedback numbers (damage, heal, +XP). The list lives inside
  // CombatTextField (own state) — spawning here goes through a ref so a damage number
  // never re-renders this whole component (that render storm was the combat lag).
  const combatTextSpawnRef = React.useRef<((x: number, z: number, text: string, color: string) => void) | null>(null);
  const spawnCombatText = React.useCallback((x: number, z: number, text: string, color: string) => {
    combatTextSpawnRef.current?.(x, z, text, color);
  }, []);

  // Monotonic live XP mirror — the single value the HUD reads. Bumped OPTIMISTICALLY on
  // every gain (instant feedback) and reconciled upward from the saved profile.
  const [heroXpLive, setHeroXpLive] = useState(() => Math.floor(profile?.progress?.hero?.xp ?? 0));
  // Live player level (from XP) — read by reward call-sites to scale mission payouts.
  const playerLevelRef = React.useRef(1);
  playerLevelRef.current = getLevelFromXp(Math.floor(heroXpLive));
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
    } else if (lvl < prevHeroLevelRef.current) {
      prevHeroLevelRef.current = lvl;
    }
  }, [heroXpLive, hexSize, spawnCombatText]);
  // Dismiss timer lives in its OWN effect, keyed only on levelUpBanner — it used to sit
  // inside the heroXpLive effect above, so ANY further XP gain within the 2600ms window
  // (extremely common right after leveling up) re-ran that effect, which cancelled the
  // pending dismiss via cleanup without rescheduling one (the level-up condition was now
  // false), leaving the banner stuck on screen forever. This is immune to that.
  React.useEffect(() => {
    if (levelUpBanner === null) return;
    const t = setTimeout(() => setLevelUpBanner(null), 2600);
    return () => clearTimeout(t);
  }, [levelUpBanner]);

  // Award Faction Points (persisted) — earned from faction activities (creep clears, resources).
  const awardFactionPoints = React.useCallback((amount: number) => {
    const cur = (profileForXpRef.current?.progress as any)?.factionPoints ?? 0;
    saveProgress({ factionPoints: cur + amount } as any);
  }, [saveProgress]);

  // Award Shards (persisted soft currency) — earned from major accomplishments (region
  // control, camp resolution, match wins). Surfaces a floating "+N ◈" and saves to profile.
  const awardShards = React.useCallback((amount: number) => {
    if (amount <= 0) return;
    const cur = (profileForXpRef.current?.progress as any)?.shards ?? 0;
    saveProgress({ shards: cur + amount } as any);
    const hw = axialToWorld({ q: heroPosRef.current.q, r: heroPosRef.current.r }, hexSize);
    spawnCombatText(hw.x, hw.z, `+${amount} ◈`, '#a7f3d0');
  }, [saveProgress, hexSize, spawnCombatText]);
  const awardShardsRef = React.useRef(awardShards); awardShardsRef.current = awardShards;
  // How the player chose to take the next outpost (GDD: stealth / combat / diplomacy).
  const captureApproachRef = React.useRef<'assault' | 'infiltrate' | 'negotiate'>('assault');

  // ── Pet type & roles (GDD): Dog = strength/combat assist, Cat = stealth/recon ──
  const petType: string = (heroAvatar as any)?.pet?.type ?? profile?.progress?.pet?.type ?? 'CYBER_CAT';
  const isDog = petType === 'CYBER_DOG';
  // Live level (from usePetXP, NOT the static avatar-configurator loadout) so the
  // combat/vision bonus below actually grows as the pet earns XP in-game.
  const petLevel = petXPSystem.petLevel;
  const petBond = petXPSystem.petBond;
  const petBondTier = bondTierIndex(petBond);
  const petUnlockedAbilities = useMemo(
    () => unlockedPetAbilities(petType, petLevel, petBond),
    [petType, petLevel, petBond],
  );
  const hasPetAbility = (id: string) => petUnlockedAbilities.some(a => a.id === id);
  const petStats = useMemo(() => derivePetStats(petType, petLevel), [petType, petLevel]);
  // Dog fights alongside you — passive attack bonus scales with species+level (petStats),
  // plus +2 once "Guard" (lvl5 / Familiar bond) is unlocked (GDD "Bonding … unlocks abilities").
  const petCombatBonus = isDog ? Math.round(petStats.attack + (hasPetAbility('dog_guard') ? 2 : 0)) : 0;
  // Cat scouts (+vision); "Sneak" is unlocked from lvl1 so this is always at least 1, and
  // widens further once "Distract" (lvl5 / Familiar bond) is unlocked.
  const petVisionBonus = isDog ? 0 : (hasPetAbility('cat_distract') ? 2 : 1);
  // "Guard" also has the dog physically soak some incoming damage for the hero
  // (applied to faction-enemy AND creep-camp damage alike).
  const petIncomingDamageMult = isDog && hasPetAbility('dog_guard') ? 0.9 : 1;
  // Cat "Sneak" / Ghost Protocol passive — enemies detect the hero at only 80% of their
  // normal range while the cat scouts alongside (read live by useFactionEnemies).
  const petDetectionScale = !isDog && hasPetAbility('cat_sneak') ? 0.8 : 1;
  const petDetectionScaleRef = React.useRef(petDetectionScale); petDetectionScaleRef.current = petDetectionScale;
  // HUD display data (Bonding & Skills panel) — surfaces bond tier + locked/unlocked
  // abilities to the player, which were previously computed but never shown anywhere.
  const petBondDisplay = useMemo(() => ({
    tierName: BOND_TIERS[petBondTier].name,
    pct: Math.round(bondTierProgress(petBond) * 100),
  }), [petBondTier, petBond]);
  const petAbilitiesDisplay = useMemo(
    () => petAbilitiesWithState(petType, petLevel, petBond).map(a => ({
      id: a.id, name: a.name, icon: a.icon, description: a.description,
      unlocked: a.unlocked, reqLevel: a.reqLevel, reqBondTierName: BOND_TIERS[a.reqBondTier].name,
    })),
    [petType, petLevel, petBond],
  );

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
    incomingDamageScale: combatIncomingScale * petIncomingDamageMult,
    onHeroDamage: (amt) => applyIncomingDamageRef.current(amt),
    awardXp: awardHeroXp,
    awardShards: awardFactionPoints, // camp clears grant Faction Points
    onCombat: ({ campQ, campR, toCreep, toHero, killed }) => {
      if (toCreep > 0) { const cw = axialToWorld({ q: campQ, r: campR }, hexSize); spawnCombatText(cw.x, cw.z, `-${toCreep}`, '#ffd24a'); }
      if (toHero > 0) { const hw = axialToWorld({ q: hero.pos.q, r: hero.pos.r }, hexSize); spawnCombatText(hw.x, hw.z, `-${toHero}`, '#ff5555'); }
      // Creep kills shape Conqueror reputation but do NOT feed the Domination victory
      // track — Domination is earned against rival FACTIONS, not neutral camps.
      if (killed > 0) recordPlaystyleRef.current('dominate', { victory: false }); },
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
  // Resources collected/used toward the Exploitation victory track (1 pt per 100 —
  // see bumpResourceCollected below, once playerFactionKey/bumpSoloVictoryRef exist).
  const resourcesCollectedRef = React.useRef(0);
  const [resourcesCollected, setResourcesCollected] = useState(0);
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
    // Hero's own carry first, then the pet's pack — the pet's auto-fetch (petFetch)
    // deposits into ITS OWN inventory, but the item bar shows hero+pet merged, so
    // terraforming looked broken whenever the player's visible resources happened to
    // be pet-carried (2026-07-19 bug report: "can't terraform either").
    setLocalHeroInventory(prev => {
      const idx = prev.findIndex(i => (i.type === 'ore' || i.type === 'energy' || i.type === 'bio') && i.quantity > 0);
      if (idx < 0) return prev;
      consumed = true;
      return prev.map((i, k) => (k === idx ? { ...i, quantity: i.quantity - 1 } : i)).filter(i => i.quantity > 0);
    });
    if (!consumed) {
      setLocalPetInventory(prev => {
        const idx = prev.findIndex(i => (i.type === 'ore' || i.type === 'energy' || i.type === 'bio') && i.quantity > 0);
        if (idx < 0) return prev;
        consumed = true;
        return prev.map((i, k) => (k === idx ? { ...i, quantity: i.quantity - 1 } : i)).filter(i => i.quantity > 0);
      });
    }
    if (consumed) {
      setTerraformProgress(p => {
        const np = Math.min(100, p + 12);
        if (np >= 100 && p < 100) { const lvl = playerLevelRef.current; awardHeroXp(scaledMissionXp(60, lvl)); awardFactionPoints(scaledMissionFp(5, lvl)); terraformRegion(); if (mobaActiveRef.current) mobaReportObjectiveRef.current('terraform'); }
        return np;
      });
    }
  };

  // ── Outposts / region control ────────────────────────────────────────────────
  // Keep outposts clear of creep camps (size-keyed memo so combat HP-only updates,
  // which replace the Map reference, don't re-trigger outpost generation).
  const creepCampCoords = React.useMemo(
    () => Array.from(creepCamps.values()).map(c => ({ q: c.q, r: c.r })),
    [creepCamps.size]
  );
  const {
    outposts, nearbyOutpost, captureNearby, raidOutpost, claimForFaction, control: outpostControl,
    territory: outpostTerritory, regions: outpostRegions, nearestOwnedOutpost,
    applyOwnership: applyOutpostOwnership, applyRivalOwnership,
  } = useOutposts({
    tiles,
    heroQ: hero.pos.q,
    heroR: hero.pos.r,
    centerQ: centerAxial.q,
    centerR: centerAxial.r,
    avoid: creepCampCoords,
    onCapture: (_region, regionCleared, prevOwner) => {
      const approach = captureApproachRef.current;
      const hw = axialToWorld({ q: heroPosRef.current.q, r: heroPosRef.current.r }, hexSize);
      { const lvl = playerLevelRef.current; awardFactionPoints(scaledMissionFp(regionCleared ? 6 : 2, lvl)); awardHeroXp(scaledMissionXp(regionCleared ? 40 : 15, lvl)); }
      // Taking/holding ground advances the Control victory track (1 pt per outpost; a
      // completed region pays the region bonus on top — ~100 outposts fill the track).
      bumpSoloVictoryRef.current?.(playerFactionKey, 'control',
        VICTORY_POINTS.outpostCapture + (regionCleared ? VICTORY_POINTS.regionControl : 0));
      // RECONQUEST — wresting ground back from a rival empire is still called out, but no
      // longer feeds Domination directly: Domination is earned ONLY by killing enemy units
      // (see the useFactionEnemies onEvent 'kill' handler below) — 1 pt per unit killed.
      const rivalHeld = prevOwner !== 'neutral' && prevOwner !== 'player';
      if (rivalHeld) {
        spawnCombatText(hw.x, hw.z, `⚔️ Reconquered from ${prevOwner}!`, '#ffd24a');
      }
      // Approach-specific outcome (GDD: "stealth operations, combat engagements, or tactical diplomacy").
      if (approach === 'assault') {
        enemyProvokeRef.current?.(heroPosRef.current.q, heroPosRef.current.r, undefined, 7); // loud → defenders respond
        recordPlaystyleRef.current('dominate');
        awardHeroXp(10);
      } else if (approach === 'negotiate') {
        recordPlaystyleRef.current('negotiate');
        const diplo = useSkillStore.getState().unlocked.filter((sid: string) => sid.startsWith('diplomacy')).length;
        awardFactionPoints(3 + Math.floor(diplo / 2)); // tactical diplomacy earns standing
      } else { // infiltrate — a quiet, stealthy takeover; no reprisal
        recordPlaystyleRef.current('scavenge');
      }
      spawnCombatText(hw.x, hw.z, regionCleared ? '🚩 Region controlled!' : '🚩 Outpost taken', regionCleared ? '#ffd24a' : '#a7d8ff');
      if (regionCleared) awardShardsRef.current(15); // controlling a full region → shards
      captureApproachRef.current = 'assault'; // reset default for the next capture
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

  // Keep refugee camps clear of both creep camps and outposts (size-keyed memo, same
  // rationale as creepCampCoords above).
  const outpostCoords = React.useMemo(
    () => Array.from(outposts.values()).map(o => ({ q: o.q, r: o.r })),
    [outposts.size]
  );
  const refugeeAvoidCoords = React.useMemo(
    () => [...creepCampCoords, ...outpostCoords],
    [creepCampCoords, outpostCoords]
  );
  const { camps: refugeeCamps, nearbyCamp: nearbyRefugeeCamp, deliverToNearby: deliverRefugee, lootNearby: lootRefugee, negotiateNearby: negotiateRefugee, applyCompleted: applyRefugeeCompleted, progress: refugeeProgress } = useRefugeeCamps({
    tiles,
    heroQ: hero.pos.q,
    heroR: hero.pos.r,
    centerQ: centerAxial.q,
    centerR: centerAxial.r,
    avoid: refugeeAvoidCoords,
    faction: factionName,
    onComplete: (camp, approach) => {
      // The player's CHOSEN approach (GDD: help / negotiate / loot) drives the outcome,
      // reward, reputation, and consequences — not the camp's faction.
      const cw = axialToWorld({ q: camp.q, r: camp.r }, hexSize);
      const resLbl = RESOURCE_DEFS[camp.loot.resource].label;
      const lvl = playerLevelRef.current; // scale camp payouts with player level
      if (approach === 'loot' && camp.loot.amount > 0) {
        grantResource(camp.loot.resource, camp.loot.amount);
        spawnCombatText(cw.x, cw.z, `🔥 +${camp.loot.amount} ${resLbl}`, '#fb923c');
        enemyProvokeRef.current?.(camp.q, camp.r, factionKey(camp.campFaction), 8); // raiding enrages defenders
        recordPlaystyleRef.current('loot');
        awardHeroXp(scaledMissionXp(camp.reward.xp, lvl)); awardFactionPoints(scaledMissionFp(camp.reward.fp, lvl));
      } else if (approach === 'negotiate') {
        // Tactical diplomacy — a modest, peaceful share; NO provoked defenders; extra standing.
        // Investment in the DIPLOMACY skill branch sweetens the deal (more resources + FP).
        const diplo = useSkillStore.getState().unlocked.filter((sid: string) => sid.startsWith('diplomacy')).length;
        const gain = Math.max(1, Math.round(camp.loot.amount * 0.5)) + diplo;
        grantResource(camp.loot.resource, gain);
        spawnCombatText(cw.x, cw.z, `🕊️ Peace · +${gain} ${resLbl}${diplo ? ' (diplomacy)' : ''}`, '#7dd3fc');
        // Prosperity is earned per camp HELPED (the 'help' branch below) only — negotiating
        // still builds reputation/standing but no longer double-credits the track.
        recordPlaystyleRef.current('negotiate', { victory: false });
        awardHeroXp(scaledMissionXp(Math.round(camp.reward.xp * 0.8), lvl)); awardFactionPoints(scaledMissionFp(camp.reward.fp + 2 + Math.floor(diplo / 2), lvl));
      } else { // aid / help — heal the camp, build standing
        spawnCombatText(cw.x, cw.z, `✚ Camp aided`, '#7fd66b');
        recordPlaystyleRef.current('help');
        awardHeroXp(scaledMissionXp(camp.reward.xp, lvl)); awardFactionPoints(scaledMissionFp(camp.reward.fp, lvl));
      }
      // Feed the competitive score: force → economy bucket, help/diplomacy → refugee bucket.
      if (mobaActiveRef.current) mobaReportObjectiveRef.current(approach === 'loot' ? 'resource' : 'refugee');
      awardShardsRef.current(approach === 'loot' ? 8 : 5); // resolving a camp yields shards
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

  // ── Story arc (solo narrative) — state lives up here so the enemy AI can pause while
  // a beat's dialog is open; triggers/choice handling live below with the solo systems.
  const storyArc = React.useMemo(() => arcFor(playerFactionKey), [playerFactionKey]);
  const [storyBeatIdx, setStoryBeatIdx] = useState(0);   // beats COMPLETED (persisted)
  const storyBeatIdxRef = React.useRef(0);
  const [activeStoryBeat, setActiveStoryBeat] = useState<StoryBeat | null>(null);
  const [storyOutcome, setStoryOutcome] = useState<string | null>(null);
  const [storyLineIdx, setStoryLineIdx] = useState(0); // which dialogue line is showing (paginated via "Next")
  const storyChoicesRef = React.useRef<Record<string, string>>({});
  // Dismiss the dialog entirely (the 'x' close) — resets pagination so the next beat starts clean.
  const closeStoryBeat = React.useCallback(() => {
    setActiveStoryBeat(null);
    setStoryOutcome(null);
    setStoryLineIdx(0);
  }, []);

  // ── Faction masks (GDD "collect and defend your mask") — one per faction, each at its
  // own fixed field shrine (same offsets regardless of which faction the PLAYER picked,
  // so "mine" vs "rival" is just which offset matches playerFactionKey). Press-to-collect
  // (G, not auto — 2026-07-19), each claim shows a storyline beat. Claiming YOUR OWN homes
  // it at base (a main objective, additional to the base) and makes it a strategic raid
  // target for rival AI (reuses the outpost-raid machinery via a synthetic 'mask-vault'
  // target). 2026-07-19 user directive: "domination victory should be by capturing
  // another faction's mask (same for domination loss)" — claiming a RIVAL's mask is an
  // instant Domination win; a rival stealing yours is an instant Domination loss (no more
  // "recoverable" theft).
  const maskAxialFor = React.useCallback((f: 'PAA' | 'ASF' | 'WC') => {
    const o = MASK_OFFSETS[f];
    return { q: centerAxial.q + o.dq, r: centerAxial.r + o.dr };
  }, [centerAxial]);
  const [maskHeld, setMaskHeld] = useState(false); // MY OWN mask is home at base
  const maskHeldRef = React.useRef(false); maskHeldRef.current = maskHeld;
  const maskIntroSeenRef = React.useRef(false);
  const [maskDialogOpen, setMaskDialogOpen] = useState(false);
  const closeMaskDialog = React.useCallback(() => {
    setMaskDialogOpen(false);
    maskIntroSeenRef.current = true;
    saveProgress({ solo: { maskIntroSeen: true } } as any);
  }, [saveProgress]);
  // The "you just claimed/captured/lost a mask" storyline beat — kind drives which
  // flavor renders; text is resolved AT RENDER (heroGender-dependent, see storyText),
  // never inside a callback (heroGender is declared later in this component — TDZ).
  const [maskClaimEvent, setMaskClaimEvent] = useState<{ kind: 'own' | 'rival' | 'lost'; faction: 'PAA' | 'ASF' | 'WC' } | null>(null);
  const closeMaskClaimEvent = React.useCallback(() => setMaskClaimEvent(null), []);
  // Which shrine (if any) the hero is standing adjacent to right now — drives the
  // "Press G to claim" prompt. My own shrine only counts while still unclaimed.
  const nearbyMask = useMemo(() => {
    const candidates: Array<'PAA' | 'ASF' | 'WC'> = maskHeld
      ? (['PAA', 'ASF', 'WC'] as const).filter(f => f !== playerFactionKey)
      : (['PAA', 'ASF', 'WC'] as const);
    for (const f of candidates) { if (axialDistance(hero.pos, maskAxialFor(f)) <= 1) return f; }
    return null;
  }, [hero.pos.q, hero.pos.r, maskHeld, maskAxialFor, playerFactionKey]);
  const nearbyMaskRef = React.useRef<typeof nearbyMask>(null); nearbyMaskRef.current = nearbyMask;
  const claimMask = React.useCallback(() => {
    const target = nearbyMaskRef.current;
    if (!target || soloResolvedRef.current) return;
    if (target === playerFactionKey) {
      if (maskHeldRef.current) return; // already home
      maskHeldRef.current = true; setMaskHeld(true);
      saveProgress({ solo: { maskHeld: true } } as any);
      awardHeroXp(40);
      awardFactionPoints(10);
      awardShardsRef.current(10);
      setMaskClaimEvent({ kind: 'own', faction: target });
    } else {
      // Capturing a RIVAL faction's mask — instant Domination victory, no threshold needed.
      setMaskClaimEvent({ kind: 'rival', faction: target });
      resolveSoloRef.current({ faction: playerFactionKey as Faction, track: 'domination' });
    }
  }, [playerFactionKey, saveProgress, awardHeroXp, awardFactionPoints]);
  const claimMaskRef = React.useRef(claimMask); claimMaskRef.current = claimMask;
  const [missionsOpen, setMissionsOpen] = useState(false);

  // ── Camp/outpost 5-tier specialization system (2026-07-19 user directive) ──────────
  // Player-secured ground (captured outposts + cleared FORTIFY creep camps) develops
  // along ONE specialization (military/food/medicine, locked in on the first upgrade),
  // paid for with ore/energy/bio from the hero's inventory. See services/campUpgrades
  // for the cost/effect math; this component owns the persisted state and wires the
  // effects into the existing raid/strategic-target systems below.
  const [outpostUpgrades, setOutpostUpgrades] = useState<Map<string, CampUpgradeState>>(new Map());
  const outpostUpgradesRef = React.useRef(outpostUpgrades); outpostUpgradesRef.current = outpostUpgrades;
  const [campUpgrades, setCampUpgrades] = useState<Map<string, CampUpgradeState>>(new Map());
  const campUpgradesRef = React.useRef(campUpgrades); campUpgradesRef.current = campUpgrades;
  const upgradeLocation = React.useCallback((kind: 'outpost' | 'camp', key: string, q: number, r: number, spec: CampSpecialization) => {
    const map = kind === 'outpost' ? outpostUpgradesRef.current : campUpgradesRef.current;
    const cur = map.get(key) ?? { tier: 0, spec: null };
    if (cur.tier >= CAMP_UPGRADE_MAX_TIER) return;
    if (cur.spec && cur.spec !== spec) return; // locked to its first-chosen specialization
    const cost = nextUpgradeCost(cur, spec);
    // Combined hero+pet supply — same fix/rationale as investTerraform above: the pet's
    // auto-fetch deposits into ITS OWN pack, but the item bar shows both merged, so
    // upgrades looked broken ("Not enough resources") whenever any of the visible total
    // was pet-carried (2026-07-19 bug report: "the fortify with resources has a bug").
    const have = (type: 'ore' | 'energy' | 'bio') =>
      (localHeroInventory.find(i => i.type === type)?.quantity ?? 0) + (localPetInventory.find(i => i.type === type)?.quantity ?? 0);
    const w = axialToWorld({ q, r }, hexSize);
    if (have('ore') < cost.ore || have('energy') < cost.energy || have('bio') < cost.bio) {
      spawnCombatText(w.x, w.z, '⚠️ Not enough resources', '#ff8888');
      return;
    }
    // Spend hero's stack first, then top up from the pet's — computed from the current
    // known quantities up front (not inside the updater) so the split doesn't depend on
    // React's setState-updater execution order.
    const spend = (type: 'ore' | 'energy' | 'bio', amount: number) => {
      if (amount <= 0) return;
      const heroHave = localHeroInventory.find(i => i.type === type)?.quantity ?? 0;
      const fromHero = Math.min(heroHave, amount);
      const fromPet = amount - fromHero;
      if (fromHero > 0) setLocalHeroInventory(prev => prev.map(i => (i.type === type ? { ...i, quantity: i.quantity - fromHero } : i)).filter(i => i.quantity > 0));
      if (fromPet > 0) setLocalPetInventory(prev => prev.map(i => (i.type === type ? { ...i, quantity: i.quantity - fromPet } : i)).filter(i => i.quantity > 0));
    };
    spend('ore', cost.ore); spend('energy', cost.energy); spend('bio', cost.bio);
    const next: CampUpgradeState = { tier: cur.tier + 1, spec };
    if (kind === 'outpost') setOutpostUpgrades(prevMap => { const n = new Map(prevMap); n.set(key, next); return n; });
    else setCampUpgrades(prevMap => { const n = new Map(prevMap); n.set(key, next); return n; });
    const info = SPEC_INFO[spec];
    spawnCombatText(w.x, w.z, `${info.icon} ${info.label} Tier ${next.tier}`, '#7fd66b');
    // Ties the specialization choice into the SAME playstyle-reputation system driving
    // the victory tracks ("as per playstyle" per the user's ask): military ~ dominate,
    // food ~ loot, medicine ~ negotiate.
    recordPlaystyleRef.current(spec === 'military' ? 'dominate' : spec === 'food' ? 'loot' : 'negotiate', { victory: false });
  }, [localHeroInventory, localPetInventory, setLocalHeroInventory, setLocalPetInventory, hexSize, spawnCombatText]);
  const upgradeLocationRef = React.useRef(upgradeLocation); upgradeLocationRef.current = upgradeLocation;
  // Passive income from food/medicine-specialized holdings (food → bio trickle,
  // medicine → Faction Point trickle) — military's payoff is defensive, see
  // militaryDefendChance in the raid handler below instead.
  React.useEffect(() => {
    // Inlined rather than the `soloEnabled` const (declared later in this component —
    // referencing it here in a dependency array would be a TDZ error, not just deferred
    // closure access).
    if (autoMultiplayer || mobaMode) return;
    const iv = setInterval(() => {
      let bioGain = 0, fpGain = 0;
      for (const [key, st] of outpostUpgradesRef.current) {
        if (outposts.get(key)?.owner !== 'player') continue;
        const inc = passiveIncome(st);
        bioGain += inc.bio; fpGain += inc.fp;
      }
      for (const [key, st] of campUpgradesRef.current) {
        if (!creepCamps.get(key)?.cleared) continue;
        const inc = passiveIncome(st);
        bioGain += inc.bio; fpGain += inc.fp;
      }
      if (bioGain > 0) grantResourceRef.current('bio', bioGain);
      if (fpGain > 0) awardFactionPoints(fpGain);
    }, 30000);
    return () => clearInterval(iv);
  }, [autoMultiplayer, mobaMode, outposts, creepCamps, awardFactionPoints]);

  // Outpost ownership snapshot the rival-faction AI reads to contest the player's territory
  // (solo only — MOBA/duel run their own authoritative outpost systems) — weighted by
  // any food/medicine specialization (food attracts raiders, medicine deters them).
  const outpostStrategicTargets = React.useMemo(
    () => Array.from(outposts.values()).map(o => ({ key: o.key, q: o.q, r: o.r, owner: o.owner, weight: raidWeight(outpostUpgrades.get(o.key) ?? { tier: 0, spec: null }) })),
    [outposts, outpostUpgrades],
  );
  // Cleared, UPGRADED fortify camps are strategic targets too (only once developed —
  // an un-upgraded cleared camp isn't worth AI attention). Treated as player-owned
  // ground for raid purposes (only the player can clear/upgrade a camp, solo).
  const campStrategicTargets = React.useMemo(
    () => Array.from(creepCamps.values())
      .filter(c => c.cleared && c.kind === 'fortify' && (campUpgrades.get(c.key)?.tier ?? 0) > 0)
      .map(c => ({ key: c.key, q: c.q, r: c.r, owner: 'player', weight: raidWeight(campUpgrades.get(c.key)!) })),
    [creepCamps, campUpgrades],
  );
  // The cleared fortify camp the hero is adjacent to right now, if any — drives the
  // camp-upgrade prompt (same UpgradePanelContent the outpost prompt uses).
  const nearbyFortifiedCamp = useMemo(() => {
    for (const c of creepCamps.values()) {
      if (c.cleared && c.kind === 'fortify' && axialDistance(hero.pos, c) <= 1) return c;
    }
    return null;
  }, [creepCamps, hero.pos.q, hero.pos.r]);
  const [raidBanner, setRaidBanner] = useState<{ faction: string; at: number; text?: string } | null>(null);
  const raidBannerTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (raidBannerTimerRef.current) clearTimeout(raidBannerTimerRef.current); }, []);
  const showRivalBanner = React.useCallback((faction: string, text: string) => {
    setRaidBanner({ faction, at: Date.now(), text });
    if (raidBannerTimerRef.current) clearTimeout(raidBannerTimerRef.current);
    raidBannerTimerRef.current = setTimeout(() => setRaidBanner(null), 4500);
  }, []);
  // The story arc's "rival pressure" trigger — flips true the first time a rival empire
  // claims or raids visibly on the map (also restored from a save with rival holdings).
  const rivalPressureSeenRef = React.useRef(false);
  const [rivalPressureSeen, setRivalPressureSeen] = useState(false);
  const markRivalPressure = React.useCallback(() => {
    if (!rivalPressureSeenRef.current) { rivalPressureSeenRef.current = true; setRivalPressureSeen(true); }
  }, []);

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
    incomingDamageScale: combatIncomingScale * petIncomingDamageMult,
    enabled: !autoMultiplayer, // solo PvE only — duels are handled by useDuel
    paused: !!inputPaused || !!activeStoryBeat || maskDialogOpen || !!maskClaimEvent, // freeze combat during skill tree AND story/mask dialogs
    getHeroStealthed: () => heroStealthRef.current, // Stealth branch shrinks enemy detection
    getDetectionScale: () => petDetectionScaleRef.current, // Cyber-Cat Sneak / Ghost Protocol
    // Objective awareness: rival factions march on & raid the player's outposts AND
    // developed fortify camps (solo only) — PLUS the mask vault at base once claimed.
    strategicTargets: (!autoMultiplayer && !mobaMode)
      ? [
          ...outpostStrategicTargets,
          ...campStrategicTargets,
          ...(maskHeld ? [{ key: 'mask-vault', q: baseAxial.q, r: baseAxial.r, owner: 'player' as const, weight: 1 }] : []),
        ]
      : undefined,
    onRaidOutpost: (key: string, fk: string) => {
      if (autoMultiplayer || mobaMode) return;
      // The mask vault isn't a real outpost. A successful steal is now an INSTANT
      // Domination LOSS for the player (2026-07-19: "domination victory should be by
      // capturing another faction's mask, same for domination loss") — no more sending
      // it back to the shrine to recover.
      if (key === 'mask-vault') {
        if (!maskHeldRef.current || soloResolvedRef.current) return;
        maskHeldRef.current = false; setMaskHeld(false);
        saveProgress({ solo: { maskHeld: false } } as any);
        const w = axialToWorld(baseAxial, hexSize);
        spawnCombatText(w.x, w.z, '🎭 Mask stolen!', '#ff5555');
        showRivalBanner(fk, `raided the vault and stole your mask, Domination is theirs!`);
        setMaskClaimEvent({ kind: 'lost', faction: fk as 'PAA' | 'ASF' | 'WC' });
        resolveSoloRef.current({ faction: fk as Faction, track: 'domination' });
        return;
      }
      // Military-tier defense (either an outpost or a cleared fortify camp): a growing
      // chance to fully repel the raid before it lands at all.
      const outUpg = outpostUpgradesRef.current.get(key);
      const campUpg = campUpgradesRef.current.get(key);
      const upg = outUpg ?? campUpg;
      if (upg && Math.random() < militaryDefendChance(upg)) {
        const pos = outposts.get(key) ?? creepCamps.get(key);
        if (pos) { const w = axialToWorld({ q: pos.q, r: pos.r }, hexSize); spawnCombatText(w.x, w.z, '🛡️ Raid repelled!', '#7aa2ff'); }
        return;
      }
      // A developed fortify camp being raided (camps have no owner field to flip) loses
      // a tier of investment instead — the "attract looters" downside of food/medicine.
      if (campUpg && creepCamps.get(key)?.cleared) {
        const nextTier = Math.max(0, campUpg.tier - 1);
        setCampUpgrades(prevMap => { const n = new Map(prevMap); n.set(key, { tier: nextTier, spec: nextTier > 0 ? campUpg.spec : null }); return n; });
        const c = creepCamps.get(key);
        if (c) { const w = axialToWorld({ q: c.q, r: c.r }, hexSize); spawnCombatText(w.x, w.z, '⚠️ Camp raided!', '#ff5555'); }
        showRivalBanner(fk, 'raided a developed camp, its investment took damage.');
        markRivalPressure();
        return;
      }
      // An ascendant rival (any track ≥ 50) PLANTS ITS FLAG on the raided outpost —
      // you must ride out and reconquer it; a weaker rival only breaks your hold.
      const rv = soloVictoryRef.current[fk as Faction];
      const ascendant = rv && Math.max(rv.domination, rv.control, rv.prosperity, rv.exploitation) >= 50;
      if (!raidOutpost(key, ascendant ? (fk as Faction) : undefined)) return;
      const o = outposts.get(key);
      if (o) { const w = axialToWorld({ q: o.q, r: o.r }, hexSize); spawnCombatText(w.x, w.z, ascendant ? `⚑ ${fk} banner raised` : '⚑ raided', '#ff5555'); }
      // A successful raid advances that faction's Domination track (aggressive expansion).
      bumpSoloVictoryRef.current?.(fk as Faction, 'domination', VICTORY_POINTS.raid);
      markRivalPressure();
      showRivalBanner(fk, ascendant ? 'seized your outpost, ride out and reconquer it!' : 'raided your outpost, recapture it!');
    },
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
        // Defeating a rival unit is a "dominate" (or, for PAA, a "negotiate"/pacify) act.
        recordPlaystyleRef.current(paaPlayer ? 'negotiate' : 'dominate');
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
  // Speed bonus from an active 'haste' buff (Mobility core / haste effect) — feeds movement.
  const heroHasteRef = React.useRef(0);

  const refreshEffectAggregate = React.useCallback(() => {
    heroEffectsRef.current = pruneEffects(heroEffectsRef.current, performance.now());
    const agg = aggregateEffects(heroEffectsRef.current, heroShieldRef.current);
    heroAtkBonusRef.current = agg.atkBonus;
    heroDefBonusRef.current = agg.defBonus;
    heroStealthRef.current = agg.stealthed;
    // Sum the magnitude of any active haste buffs → a temporary SPD boost.
    heroHasteRef.current = heroEffectsRef.current.reduce((s, e) => s + (e.kind === 'haste' ? (e.magnitude || 0) : 0), 0);
  }, []);

  // Incoming damage passes through defence buffs + the shield pool before reaching HP.
  const applyIncomingDamage = React.useCallback((amt: number) => {
    // Placement gate: for the first moments of a mission the hero sits at the raw
    // useState position (map corner 0,0) until the spawn/restore effects place them.
    // World AI is already live then, so corner units could land a deterministic
    // opening hit (or a kill) on a hero the player never controlled. No damage
    // counts until the hero is actually standing where the game put them.
    if (!heroPlacedRef.current) return;
    let dmg = Math.max(0, amt);
    // Permanent DEF (faction base + level growth + skill-tree investment + faction-
    // ability/trait bonus — combatStats.def, the SAME total driving the HUD's DEF
    // stat) mitigates ALL incoming damage via a diminishing-returns curve (doubling
    // DEF halves damage taken, never fully zeroes it). This was previously a NO-OP:
    // combatStats was computed with every bonus folded in but only ever READ for the
    // in-game menu display, so investing in Defense skills or picking a tanky faction
    // had zero effect on damage actually taken — only a temporary defBuff skill cast
    // (heroDefBonusRef, below) mattered.
    const permDef = combatStats?.def ?? 0;
    if (permDef > 0) dmg = dmg * (100 / (100 + permDef));
    if (heroDefBonusRef.current > 0) dmg = Math.max(1, dmg - heroDefBonusRef.current);
    if (heroShieldRef.current > 0 && dmg > 0) {
      const absorbed = Math.min(heroShieldRef.current, dmg);
      heroShieldRef.current -= absorbed; dmg -= absorbed;
      if (absorbed > 0) { const hw = axialToWorld({ q: heroPosRef.current.q, r: heroPosRef.current.r }, hexSize); spawnCombatText(hw.x, hw.z, `🛡️ -${Math.round(absorbed)}`, '#7aa2ff'); }
    }
    if (dmg > 0) onDamageHP?.(Math.round(dmg));
  }, [hexSize, onDamageHP, combatStats?.def]);
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
      else {
        // Peaceful resolution is a Diplomacy play — locked until Negotiation is skilled.
        if (!approachSkillUnlocked('negotiate')) { spawnCombatText(hw.x, hw.z, `🔒 Requires ${APPROACH_SKILL.negotiate.label}`, '#fbbf24'); return; }
        negotiateRefugee();
      }
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
  // T is context-sensitive: near the terraformer it invests (matching the on-screen
  // prompt), otherwise it stays the 4th offensive ability key.
  const nearTerraformerRef = React.useRef(nearTerraformer); nearTerraformerRef.current = nearTerraformer;
  const terraformDoneRef = React.useRef(terraformDone); terraformDoneRef.current = terraformDone;
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
    // Fortify camps stay blocked after clearing — the machine-gun emplacement remnant
    // needs its tile clear of trees/rocks just like the live camp did.
    for (const c of creepCamps.values()) if (!c.cleared || c.kind === 'fortify') block(c.q, c.r);
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

  // Game menu (rendered by GameHUD) is controlled here so its trigger can live inside the
  // shared top HUD bar instead of floating over it.
  const [hudMenuOpen, setHudMenuOpen] = useState(false);
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
  // Open the skill tree — first flush live XP/level so points are immediately available and
  // nothing resets. Shared by the top-bar Skills button and the in-menu "Open Skill Tree".
  const openSkillTree = () => {
    try {
      const s = useSkillStore.getState();
      const lvl = Math.max(1, getLevelFromXp(Math.floor(heroXpLive)), s.level);
      s.setLevel(lvl);
      saveProgress({ hero: { xp: Math.floor(heroXpLive), level: lvl, unlockedSkillIds: s.unlocked, unlockOrder: s.unlockOrder } });
    } catch {}
    onOpenSkillTree?.();
  };
  const duel = useDuel({
    onHit: (dmg, at) => {
      // Receiver-side range check vs MY hero (the hook already checked the attacker's
      // claim against their broadcast). Reject hits from out of melee range.
      const myPos = heroPosRef.current;
      if (at && axialDistance(myPos, at) > 2) { console.warn('[duel] rejected out-of-range hit', at); return; }
      // Route through applyIncomingDamage — the attacker only knows their own ATK, so
      // the defender's own DEF/shield/buffs must mitigate here on the receiving side,
      // same as PvE damage, or defense investment would be meaningless in PvP.
      applyIncomingDamageRef.current(dmg);
      const hw = axialToWorld({ q: myPos.q, r: myPos.r }, hexSize);
      spawnCombatText(hw.x, hw.z, `-${dmg}`, '#ff5555');
    },
    onCast: (icon, at) => {
      if (at) { const w = axialToWorld(at, hexSize); spawnCombatText(w.x, w.z, icon, '#c9b3ff'); }
    },
    onRemoteDead: (at) => {
      if (at) { const w = axialToWorld(at, hexSize); spawnCombatText(w.x, w.z, '☠️', '#ff5555'); }
      recordPlaystyleRef.current('dominate'); // beating your duel rival is a dominate act
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
  // Default the lobby pick to the faction the player chose at onboarding (still changeable).
  const [mobaFactionPick, setMobaFactionPick] = useState<Faction>(playerFactionKey as Faction);
  const [mobaDeathReported, setMobaDeathReported] = useState(false);
  const [mobaCodeCopied, setMobaCodeCopied] = useState(false);
  const [mobaWaiting, setMobaWaiting] = useState(0); // players in the MOBA quick-match queue
  const mobaLobbyEnteredRef = React.useRef(0);       // when we entered the lobby (backfill timer)
  const copyMobaCode = React.useCallback((c: string | null) => {
    if (!c) return;
    try { navigator.clipboard?.writeText(c); } catch {}
    setMobaCodeCopied(true); setTimeout(() => setMobaCodeCopied(false), 1500);
  }, []);
  const moba = useMobaMatch({
    onHit: (dmg, at) => {
      const myPos = heroPosRef.current;
      if (at && axialDistance(myPos, at) > 2) { return; }
      // Same rationale as the duel onHit above — mitigate on the receiving side.
      applyIncomingDamageRef.current(dmg);
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
  // Hydrate reputation from the persisted profile once it loads (survives across missions).
  const repHydratedRef = React.useRef(false);
  React.useEffect(() => {
    if (repHydratedRef.current || !profile) return;
    repHydratedRef.current = true;
    const saved = (profile.progress as any)?.reputation as Partial<PlaystyleReputation> | undefined;
    if (saved) setReputation({ ...emptyReputation(), ...saved });
  }, [profile]);
  // Skill-gated approach availability (reactive — prompt buttons update as skills unlock).
  const unlockedSkillIds = useSkillStore(s => s.unlocked);
  const canNegotiate = unlockedSkillIds.includes(APPROACH_SKILL.negotiate.skillId);
  const canInfiltrate = unlockedSkillIds.includes(APPROACH_SKILL.infiltrate.skillId);
  // ── Solo victory tracks — the multi-path win race against the AI factions ─────
  const soloEnabled = !autoMultiplayer && !mobaMode;
  const [soloVictory, setSoloVictory] = useState<FactionVictory>(() => emptyVictory());
  const soloVictoryRef = React.useRef(soloVictory); soloVictoryRef.current = soloVictory;
  // Which victory track's detail popover is open in the top HUD (null = collapsed).
  const [expandedTrack, setExpandedTrack] = useState<VictoryTrack | null>(null);
  // The decided result persists (campaign stays decided until a reset); dismissing the
  // overlay only hides it — it does NOT un-decide the campaign.
  const [soloVictoryResult, setSoloVictoryResult] = useState<{ faction: Faction; track: VictoryTrack } | null>(null);
  const [soloResultDismissed, setSoloResultDismissed] = useState(false);
  const soloResolvedRef = React.useRef(false); // match decided — freezes track accrual until a campaign reset
  const soloWinRewardedRef = React.useRef(false);

  const resolveSolo = (vr: { faction: Faction; track: VictoryTrack }) => {
    soloResolvedRef.current = true;
    setSoloVictoryResult(vr);
    if (vr.faction === playerFactionKey && !soloWinRewardedRef.current) { soloWinRewardedRef.current = true; awardShardsRef.current(60); }
  };
  const resolveSoloRef = React.useRef(resolveSolo); resolveSoloRef.current = resolveSolo;

  // Add points to a faction's victory track (solo only), and resolve the match if a track fills.
  // When the PLAYER earns points from a mission, every rival advances its natural track by a
  // fraction of that gain (rivalMissionGain) — the race is paced by YOUR mission completions,
  // never by wall-clock time, so a persistent campaign can't be lost while you're offline.
  const bumpSoloVictory = React.useCallback((faction: Faction, track: VictoryTrack, base: number) => {
    if (!soloEnabled || soloResolvedRef.current) return;
    const next = cloneVictory(soloVictoryRef.current);
    addVictory(next, faction, track, base);
    if (faction === playerFactionKey) {
      const rivals = (['PAA', 'ASF', 'WC'] as Faction[]).filter(f => f !== playerFactionKey);
      for (const f of rivals) addVictory(next, f, NATURAL_TRACK[f], rivalMissionGain(base));
    }
    soloVictoryRef.current = next; setSoloVictory(next);
    const vr = evaluateVictory(next);
    if (vr) resolveSoloRef.current(vr);
  }, [soloEnabled, playerFactionKey]);
  const bumpSoloVictoryRef = React.useRef(bumpSoloVictory); bumpSoloVictoryRef.current = bumpSoloVictory;

  const recordPlaystyle = React.useCallback((p: Playstyle, opts?: { victory?: boolean }) => {
    setReputation(prev => {
      const next = { ...prev, [p]: prev[p] + 1 };
      saveProgress({ reputation: next } as any); // persist to the profile
      return next;
    });
    // Playstyle actions also advance your victory track (help/negotiate→Prosperity,
    // scavenge/loot→Exploitation, dominate→Domination). One camp/outpost/defeat ≈ 1 pt
    // against the 100-point threshold; a resource scavenge is a half-point minor act.
    // Pass { victory: false } for acts that shape reputation but should NOT advance a
    // victory track (e.g. neutral-creep kills — Domination is about rival factions).
    if (opts?.victory === false) return;
    const pv = ({
      help: ['prosperity', VICTORY_POINTS.campResolve],
      negotiate: ['prosperity', VICTORY_POINTS.campResolve],
      scavenge: ['exploitation', VICTORY_POINTS.resource],
      loot: ['exploitation', VICTORY_POINTS.campResolve],
      dominate: ['domination', VICTORY_POINTS.kill],
    } as Record<string, [VictoryTrack, number]>)[p];
    if (pv) bumpSoloVictoryRef.current(playerFactionKey, pv[0], pv[1]);
  }, [saveProgress, playerFactionKey]);
  const recordPlaystyleRef = React.useRef(recordPlaystyle); recordPlaystyleRef.current = recordPlaystyle;
  const dominantStyle = React.useMemo(() => dominantPlaystyle(reputation), [reputation]);
  // Resources gathered toward the Exploitation track: 1 pt per 100 collected/used
  // (VICTORY_POINTS.resourceMilestone) — replaces the old per-pickup fractional credit
  // so resource spam alone can't out-race the other victory tracks.
  const bumpResourceCollected = React.useCallback(() => {
    resourcesCollectedRef.current += 1;
    setResourcesCollected(resourcesCollectedRef.current);
    if (resourcesCollectedRef.current % 100 === 0) {
      bumpSoloVictoryRef.current?.(playerFactionKey, 'exploitation', VICTORY_POINTS.resourceMilestone);
    }
  }, [playerFactionKey]);
  // Gathering a world resource node is the "scavenge" approach.
  const handleCollectWithStyle = React.useCallback(
    (flowerKey: string | null, mushroomKey: string | null, resource?: { key: string; type: 'ore' | 'energy' | 'bio' } | null) => {
      if (resource) {
        // Victory-track credit for resources is handled by bumpResourceCollected (100
        // collected/used → 1 pt) instead of a per-pickup fraction; reputation still accrues.
        recordPlaystyle('scavenge', { victory: false });
        bumpResourceCollected();
        // Resource gathering is a core GDD MOBA objective → feed the competitive score.
        if (mobaActiveRef.current) mobaReportObjectiveRef.current('resource');
      }
      handleCollect(flowerKey, mushroomKey, resource);
    }, [handleCollect, recordPlaystyle, bumpResourceCollected]);
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

  // ── Solo save/load: captured territory, terraforming & resolved camps persist ─────
  // Hydrate ONCE, after the profile has loaded and the world has generated. Guarded so the
  // auto-save below never fires (and overwrites the save with empty state) before this runs.
  const soloHydratedRef = React.useRef(false);
  const [soloHydrated, setSoloHydrated] = useState(false); // state mirror for effects that must wait
  const explorationRewardedRef = React.useRef(false); // one-time exploration reward (persisted)
  const victorySeenRef = React.useRef(false);         // result overlay already dismissed
  React.useEffect(() => {
    if (soloHydratedRef.current || autoMultiplayer || mobaMode || !profile || outposts.size === 0) return;
    soloHydratedRef.current = true;
    setSoloHydrated(true);
    const solo = (profile.progress as any)?.solo as NonNullable<import('../types/player').PlayerProgress['solo']> | undefined;
    if (!solo) return;
    if (solo.outpostsOwned?.length) applyOutpostOwnership(solo.outpostsOwned);
    if (solo.rivalOutposts && Object.keys(solo.rivalOutposts).length) {
      applyRivalOwnership(solo.rivalOutposts);
      rivalPressureSeenRef.current = true; setRivalPressureSeen(true); // arc trigger survives reload
    }
    if (typeof solo.storyBeat === 'number') { storyBeatIdxRef.current = solo.storyBeat; setStoryBeatIdx(solo.storyBeat); }
    if (solo.storyChoices) storyChoicesRef.current = { ...solo.storyChoices };
    if (solo.refugeeCampsDone?.length) applyRefugeeCompleted(solo.refugeeCampsDone);
    if (typeof solo.terraformProgress === 'number' && solo.terraformProgress > 0) setTerraformProgress(solo.terraformProgress);
    if (typeof solo.resourcesCollected === 'number' && solo.resourcesCollected > 0) {
      resourcesCollectedRef.current = solo.resourcesCollected;
      setResourcesCollected(solo.resourcesCollected);
    }
    explorationRewardedRef.current = !!solo.explorationRewarded;
    maskHeldRef.current = !!solo.maskHeld; setMaskHeld(!!solo.maskHeld);
    maskIntroSeenRef.current = !!solo.maskIntroSeen;
    if (solo.outpostUpgrades) {
      const m = new Map<string, CampUpgradeState>();
      for (const [k, v] of Object.entries(solo.outpostUpgrades as Record<string, { tier: number; spec: CampSpecialization | null }>)) m.set(k, v);
      outpostUpgradesRef.current = m; setOutpostUpgrades(m);
    }
    if (solo.campUpgrades) {
      const m = new Map<string, CampUpgradeState>();
      for (const [k, v] of Object.entries(solo.campUpgrades as Record<string, { tier: number; spec: CampSpecialization | null }>)) m.set(k, v);
      campUpgradesRef.current = m; setCampUpgrades(m);
    }
    // Victory race: restore every faction's track points (missing keys default to 0).
    if (solo.victory) {
      const v = emptyVictory();
      for (const f of FACTIONS) for (const t of VICTORY_TRACKS) v[f][t] = Number(solo.victory?.[f]?.[t]) || 0;
      soloVictoryRef.current = v; setSoloVictory(v);
    }
    // A decided campaign stays decided (tracks frozen); only re-show the overlay if the
    // player hasn't dismissed it yet — otherwise they resume free play until a reset.
    if (solo.victoryResult) {
      soloResolvedRef.current = true;
      soloWinRewardedRef.current = true; // never re-award the win shards on reload
      victorySeenRef.current = !!solo.victorySeen;
      setSoloVictoryResult(solo.victoryResult as { faction: Faction; track: VictoryTrack });
      setSoloResultDismissed(!!solo.victorySeen);
    }
  }, [profile, outposts.size, autoMultiplayer, mobaMode, applyOutpostOwnership, applyRefugeeCompleted]);
  // ── Rival empires EXIST on the map: each rival visibly claims one neutral outpost per
  // 25 points on its leading victory track (25/50/75 → 1/2/3 outposts, faction-tinted).
  // The top-bar race chips stop being a scoreboard and become a warning you can see.
  React.useEffect(() => {
    if (!soloEnabled || !soloHydrated || soloResolvedRef.current || outposts.size === 0) return;
    const ownedBy = (f: Faction) => { let n = 0; for (const o of outposts.values()) if (o.owner === f) n++; return n; };
    for (const f of (['PAA', 'ASF', 'WC'] as Faction[])) {
      if (f === playerFactionKey) continue;
      const rv = soloVictoryRef.current[f];
      const best = Math.max(rv.domination, rv.control, rv.prosperity, rv.exploitation);
      const target = Math.min(4, Math.floor(best / 25));
      if (target > ownedBy(f)) {
        const claimed = claimForFaction(f, target);
        if (claimed.length) {
          markRivalPressure();
          const w = axialToWorld({ q: claimed[0].q, r: claimed[0].r }, hexSize);
          spawnCombatText(w.x, w.z, `⚑ ${f} claims this outpost`, FACTION_COLORS[f]?.primary ?? '#ff5555');
          showRivalBanner(f, `claimed ${claimed.length > 1 ? `${claimed.length} outposts` : 'an outpost'}, their empire is growing.`);
        }
      }
    }
    // soloVictory drives the milestones; outposts keeps ownedBy() honest after reconquests.
  }, [soloVictory, outposts, soloEnabled, soloHydrated, playerFactionKey, claimForFaction, markRivalPressure, showRivalBanner, hexSize]);

  // ── Story beat triggering — fire the NEXT beat when the world satisfies its trigger.
  React.useEffect(() => {
    if (!soloEnabled || !soloHydrated || activeStoryBeat || soloResolvedRef.current) return;
    const beat = storyArc[storyBeatIdx];
    if (!beat) return;
    const pv = soloVictoryRef.current[playerFactionKey];
    const world: StoryWorldState = {
      started: true,
      outpostsOwned: outpostControl.owned,
      rivalPressureSeen,
      bestTrackValue: Math.max(pv.domination, pv.control, pv.prosperity, pv.exploitation),
    };
    if (!beatReady(beat, world)) return;
    const t = setTimeout(() => { setStoryLineIdx(0); setActiveStoryBeat(beat); }, 900); // small beat — never mid-click
    return () => clearTimeout(t);
  }, [soloEnabled, soloHydrated, activeStoryBeat, storyArc, storyBeatIdx, outpostControl.owned, rivalPressureSeen, soloVictory, playerFactionKey]);

  // ── Faction mask lore intro — fires once, after the player has engaged with the
  // first story beat (so it doesn't pile onto the tutorial + beat-1 dialog on spawn).
  React.useEffect(() => {
    if (!soloEnabled || !soloHydrated || maskIntroSeenRef.current || maskDialogOpen) return;
    if (storyBeatIdx < 1) return;
    const t = setTimeout(() => setMaskDialogOpen(true), 900);
    return () => clearTimeout(t);
  }, [soloEnabled, soloHydrated, storyBeatIdx, maskDialogOpen]);

  // Mask collection is now PRESS-TO-COLLECT (G, shared with outpost capture — see the
  // keydown handler's CAPTURE section) via claimMask/claimMaskRef above, not auto.

  // Apply a story choice: effects route through the systems that already exist
  // (reputation/victory via recordPlaystyle, FP, shards, XP), then persist the arc.
  const chooseStory = React.useCallback((beat: StoryBeat, choice: StoryChoice) => {
    const fx = choice.effect;
    if (fx.playstyle) recordPlaystyleRef.current(fx.playstyle);
    if (fx.fp) awardFactionPoints(fx.fp);
    if (fx.shards) awardShardsRef.current(fx.shards);
    if (fx.xp) awardHeroXp(fx.xp);
    storyBeatIdxRef.current = beat.index;
    setStoryBeatIdx(beat.index);
    storyChoicesRef.current = { ...storyChoicesRef.current, [beat.id]: choice.id };
    setStoryOutcome(choice.outcome); // raw — {player}/{npc} tokens resolve at render
    setStoryLineIdx(0);
    saveProgress({ solo: { storyBeat: beat.index, storyChoices: storyChoicesRef.current } } as any);
  }, [awardFactionPoints, awardHeroXp, saveProgress]);

  // ── Campaign reset — wipes the solo WORLD (territory, terraform, camps, exploration,
  // victory race) but keeps the HERO (level, skills, pet, shards, inventory). The map is
  // seed-fixed, so reloading after the wipe yields a clean campaign.
  const campaignResettingRef = React.useRef(false);
  const [campaignResetting, setCampaignResetting] = useState(false);
  // `full=true` ALSO wipes the hero back to Level 1 (xp, skill tree, pet bond/level) —
  // asked for explicitly at the New Campaign prompt (2026-07-19: "ask the player if
  // they want to reset and start from lv1"); the default (full=false) keeps hero/skills
  // /pet/shards/items and only wipes the WORLD, same as before.
  const resetCampaign = React.useCallback((full: boolean = false) => {
    if (campaignResettingRef.current) return;
    campaignResettingRef.current = true; // blocks the debounced auto-save from re-writing old state
    setCampaignResetting(true);
    if (full) { try { useSkillStore.getState().reset(); } catch {} }
    // { immediate: true } bypasses the throttle and is awaited, so the reload below only
    // happens once the wipe has actually landed on Firestore (previously this guessed a
    // fixed 1800ms delay, which could reload before the write actually completed).
    saveProgress({
      explored: [],
      heroPosition: { q: 0, r: 0 },
      ...(full ? {
        hero: { level: 1, xp: 0, traits: [], unlockedSkillIds: ['root'], unlockOrder: [] },
        pet: { level: 1, xp: 0, bond: 0 },
      } : {}),
      solo: {
        outpostsOwned: [], rivalOutposts: {}, storyBeat: 0, terraformProgress: 0, refugeeCampsDone: [],
        victory: emptyVictory(), victoryResult: null, victorySeen: false, explorationRewarded: false,
        maskHeld: false, maskIntroSeen: false, outpostUpgrades: {}, campUpgrades: {},
      },
    } as any, { immediate: true }).finally(() => window.location.reload());
  }, [saveProgress]);
  // Shows the "keep hero or reset to Lv 1?" choice before actually resetting.
  const [newCampaignChoice, setNewCampaignChoice] = useState(false);
  // Ref always holding the latest "build the solo snapshot" closure so the debounced
  // autosave, the manual Save Game button, and the tab-hide/close flush all persist
  // identical, fresh data (fixes the Save Game button previously omitting several fields).
  const buildSoloSnapshotRef = React.useRef<() => Record<string, unknown>>(() => ({}));
  buildSoloSnapshotRef.current = () => ({
    outpostsOwned: Array.from(outposts.values()).filter(o => o.owner === 'player').map(o => o.key),
    rivalOutposts: Object.fromEntries(
      Array.from(outposts.values())
        .filter(o => o.owner !== 'player' && o.owner !== 'neutral')
        .map(o => [o.key, o.owner]),
    ),
    storyBeat: storyBeatIdxRef.current,
    storyChoices: storyChoicesRef.current,
    terraformProgress,
    refugeeCampsDone: Array.from(refugeeCamps.values()).filter(c => c.completed).map(c => c.key),
    victory: soloVictoryRef.current,
    victoryResult: soloVictoryResult ?? null,
    victorySeen: victorySeenRef.current,
    explorationRewarded: explorationRewardedRef.current,
    resourcesCollected: resourcesCollectedRef.current,
    maskHeld: maskHeldRef.current,
    maskIntroSeen: maskIntroSeenRef.current,
    outpostUpgrades: Object.fromEntries(outpostUpgradesRef.current),
    campUpgrades: Object.fromEntries(campUpgradesRef.current),
  });
  // Debounced auto-save of the solo world state whenever it changes (solo only, post-hydration).
  React.useEffect(() => {
    if (autoMultiplayer || mobaMode || !soloHydratedRef.current || campaignResettingRef.current) return;
    const t = setTimeout(() => {
      if (campaignResettingRef.current) return;
      saveProgress({ solo: buildSoloSnapshotRef.current() } as any);
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outpostControl.owned, terraformProgress, refugeeProgress.done, soloVictory, soloVictoryResult, soloResultDismissed, autoMultiplayer, mobaMode, soloHydrated, resourcesCollected]);
  // Flush the solo snapshot immediately when the tab is hidden/closing — otherwise the
  // 900ms debounce above (stacked with usePlayerProfile's own 1.5s write throttle) can
  // silently drop the last few seconds of solo progress on a refresh or tab close.
  React.useEffect(() => {
    if (autoMultiplayer || mobaMode) return;
    const flush = () => {
      if (!soloHydratedRef.current || campaignResettingRef.current) return;
      saveProgress({ solo: buildSoloSnapshotRef.current() } as any, { immediate: true });
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [autoMultiplayer, mobaMode, saveProgress]);

  // Capture the adjacent outpost via a chosen approach; also submits the MOBA capture intent.
  // Infiltrate/negotiate are skill-gated (Stealth/Diplomacy cores) — locked picks just warn.
  const captureOutpostWith = React.useCallback((approach: 'assault' | 'infiltrate' | 'negotiate') => {
    if (!approachSkillUnlocked(approach)) {
      const hw = axialToWorld({ q: heroPosRef.current.q, r: heroPosRef.current.r }, hexSize);
      spawnCombatText(hw.x, hw.z, `🔒 Requires ${APPROACH_SKILL[approach as 'negotiate' | 'infiltrate'].label}`, '#fbbf24');
      return;
    }
    captureApproachRef.current = approach;
    const ok = captureNearbyRef.current();
    if (ok && mobaActiveRef.current) { const no = nearbyOutpostRef.current; if (no) mobaRequestCaptureRef.current(`${no.q},${no.r}`); }
  }, [hexSize, spawnCombatText]);
  const captureOutpostWithRef = React.useRef(captureOutpostWith); captureOutpostWithRef.current = captureOutpostWith;

  // Match-win shard rewards (once per result). MOBA win pays more than a 1v1 duel win.
  const mobaWinRewardedRef = React.useRef(false);
  React.useEffect(() => {
    if (moba.result === 'win' && !mobaWinRewardedRef.current) { mobaWinRewardedRef.current = true; awardShardsRef.current(50); }
    if (!moba.result) mobaWinRewardedRef.current = false;
  }, [moba.result]);
  const duelWinRewardedRef = React.useRef(false);
  React.useEffect(() => {
    if (duel.result === 'win' && !duelWinRewardedRef.current) { duelWinRewardedRef.current = true; awardShardsRef.current(30); }
    if (!duel.result) duelWinRewardedRef.current = false;
  }, [duel.result]);

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

  // Live count of players waiting in the MOBA quick-match queue (lobby open, not in a match).
  React.useEffect(() => {
    if (!mobaMode || !mobaLobbyOpen || mobaActive) return;
    const unsub = watchOpenMatches('FFA_1v1v1', setMobaWaiting);
    return () => unsub();
  }, [mobaMode, mobaLobbyOpen, mobaActive]);

  // Track when we entered the MOBA lobby, so quick-match can back-fill with AI on a timer.
  React.useEffect(() => {
    if (moba.status === 'lobby') { if (!mobaLobbyEnteredRef.current) mobaLobbyEnteredRef.current = Date.now(); }
    else mobaLobbyEnteredRef.current = 0;
  }, [moba.status]);

  // Quick-match auto-start (host only): begin the moment the lobby is full, or after a
  // back-fill wait so a solo quick-match still starts with AI filling the empty factions.
  React.useEffect(() => {
    if (!moba.quickMatch || moba.role !== 'host' || moba.status !== 'lobby' || outposts.size === 0) return;
    const distinctFactions = new Set(moba.players.map(p => p.faction));
    const dup = distinctFactions.size !== moba.players.length;
    if (dup) return; // wait for a clean faction split before starting
    const startNow = () => moba.startMatch(
      Array.from(outposts.values()).map(o => ({ key: o.key, q: o.q, r: o.r, region: o.region, owner: 'neutral' as const })),
    );
    // Full lobby (every seat taken) → start immediately.
    if (moba.players.length >= moba.modeConfig.players) { startNow(); return; }
    // Otherwise back-fill: start ~12s after entering the lobby (AI plays the empty factions).
    const elapsed = mobaLobbyEnteredRef.current ? Date.now() - mobaLobbyEnteredRef.current : 0;
    const t = setTimeout(startNow, Math.max(1500, 12000 - elapsed));
    return () => clearTimeout(t);
  }, [moba.quickMatch, moba.role, moba.status, moba.players, moba.modeConfig.players, outposts, moba]);

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
    recordPlaystyleRef.current('dominate'); // striking a rival hero is a dominate act
    const rw = axialToWorld(bestPos, hexSize);
    spawnCombatText(rw.x, rw.z, `-${dmg}`, '#ffd24a');
  };

  // Pet actively attacks (GDD: pets "assist in combat … attack") once bonded enough to
  // fight alongside the hero ("Guard", lvl5/Familiar) — on top of the passive combat
  // bonus above, the Dog periodically lands its own strike on the nearest enemy in
  // range. Once "Bark Stun" unlocks (lvl12/Bonded) each strike also briefly stuns.
  React.useEffect(() => {
    if (!isDog || !hasPetAbility('dog_guard')) return;
    const iv = setInterval(() => {
      if (duelActive || mobaActiveRef.current) return; // don't interfere with 1v1s
      const power = Math.max(1, Math.round(petStats.attack * 0.6));
      const res = strikeNearbyEnemyRef.current(power);
      if (res.hit) {
        const pw = axialToWorld(pet.pos, hexSize);
        spawnCombatText(pw.x, pw.z, `🐕 -${power}`, '#ffb454');
        if (hasPetAbility('dog_barkstun')) applyEnemyEffectRef.current('stun', 1200, 2);
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [isDog, petUnlockedAbilities, petStats.attack, duelActive, pet.pos, hexSize, spawnCombatText]);

  // Cat's "Hack Scratch" (lvl12/Bonded) — a periodic ranged shred on the nearest enemy,
  // distinct from the Dog's melee assist (GDD: cat "gathers intel", assists more subtly).
  React.useEffect(() => {
    if (isDog || !hasPetAbility('cat_hack')) return;
    const iv = setInterval(() => {
      if (duelActive || mobaActiveRef.current) return;
      const power = Math.max(1, Math.round(petStats.attack * 0.5));
      const res = strikeNearbyEnemyRef.current(power);
      if (res.hit) {
        const pw = axialToWorld(pet.pos, hexSize);
        spawnCombatText(pw.x, pw.z, `🐈 -${power}`, '#c084fc');
      }
    }, 4000);
    return () => clearInterval(iv);
  }, [isDog, petUnlockedAbilities, petStats.attack, duelActive, pet.pos, hexSize, spawnCombatText]);

  // Cat's "Distract" (lvl5/Familiar) — periodically baits the nearest enemy within
  // reach into chasing the cat: pacified units drop their target for a moment, pulling
  // aggro off the hero (GDD: "bait an enemy into chasing the cat").
  React.useEffect(() => {
    if (isDog || !hasPetAbility('cat_distract')) return;
    const iv = setInterval(() => {
      if (duelActive || mobaActiveRef.current) return;
      if (applyEnemyEffectRef.current('pacify', 2600, 5)) {
        const pw = axialToWorld(pet.pos, hexSize);
        spawnCombatText(pw.x, pw.z, '🐈 ✨ distracted', '#c084fc');
      }
    }, 10000);
    return () => clearInterval(iv);
  }, [isDog, petUnlockedAbilities, duelActive, pet.pos, hexSize, spawnCombatText]);

  // Dog's "Track" (lvl1 recon) — the sensor suite periodically sniffs out the nearest
  // uncollected cache (resource node / healing flower / mushroom) and marks it: a paw
  // ping at the cache plus a distance + direction hint over the hero (GDD: "sniff out
  // the nearest objective or hidden cache and mark it").
  const trackTargetsRef = React.useRef({ resources: collectibleResources, flowers: collectibleFlowers, mushrooms: collectibleMushrooms });
  trackTargetsRef.current = { resources: collectibleResources, flowers: collectibleFlowers, mushrooms: collectibleMushrooms };
  React.useEffect(() => {
    if (!isDog || !hasPetAbility('dog_track')) return;
    const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
    const iv = setInterval(() => {
      if (duelActive || mobaActiveRef.current) return;
      const { resources, flowers, mushrooms } = trackTargetsRef.current;
      const h = heroPosRef.current;
      let best: { q: number; r: number; icon: string } | null = null;
      let bestD = Infinity;
      const consider = (key: string, icon: string) => {
        const [q, r] = key.split(',').map(Number);
        if (!Number.isFinite(q) || !Number.isFinite(r)) return;
        const d = axialDistance({ q, r }, h);
        if (d >= 2 && d <= 14 && d < bestD) { bestD = d; best = { q, r, icon }; }
      };
      resources.forEach((_v, k) => consider(k, '💎'));
      flowers.forEach(k => consider(k, '🌸'));
      mushrooms.forEach(k => consider(k, '🍄'));
      if (!best) return;
      const found: { q: number; r: number; icon: string } = best;
      const hw = axialToWorld(h, hexSize);
      const tw = axialToWorld(found, hexSize);
      spawnCombatText(tw.x, tw.z, '🐾', '#ffb454');
      // 8-way arrow from the hero toward the cache (world-space heading).
      const ang = Math.atan2(tw.z - hw.z, tw.x - hw.x);
      const arrow = ARROWS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
      spawnCombatText(hw.x, hw.z, `🐾 ${found.icon} ${bestD} ${arrow}`, '#ffb454');
    }, 18000);
    return () => clearInterval(iv);
  }, [isDog, petUnlockedAbilities, duelActive, hexSize, spawnCombatText]);

  // Pet auto-gather focus — set via the pet card's Auto-Gather buttons; 'auto' (default)
  // picks whatever's nearest of any kind, matching the old always-flower interval's
  // "just grab something" spirit, but from what's actually around instead of thin air.
  const petFetchFocus = ((profile?.progress?.pet as any)?.fetchFocus as 'auto' | 'flower' | 'mushroom' | ResourceType | undefined) || 'auto';
  const petFetchFocusRef = React.useRef(petFetchFocus); petFetchFocusRef.current = petFetchFocus;

  // Pet auto-gather (GDD: the companion "carries a supply... from the field" while
  // exploring). Replaces a bug where a flat interval force-grew a single hero-inventory
  // 'flower' slot forever, regardless of pet type or what was actually nearby — now the
  // pet searches real collectibles around the hero and credits its OWN pack, species-
  // differentiated: Cyber-Cat is fast/light (speed) — fetches often, one item per trip,
  // wider search range. Cyber-Dog is slow/heavy (quantity) — fetches less often but
  // hauls up to two items per trip. Numbers are tuned for near-parity total yield
  // (~5 items/min either way) so neither pet is strictly better, just different pacing.
  React.useEffect(() => {
    const radius = isDog ? 4 : 6;
    const maxPicks = isDog ? 2 : 1;
    const intervalMs = isDog ? 22000 : 12000;
    const iv = setInterval(() => {
      const focus = petFetchFocusRef.current === 'auto' ? null : petFetchFocusRef.current;
      const got = petFetch(heroPosRef.current.q, heroPosRef.current.r, radius, maxPicks, focus);
      if (!got.length) return;
      const icon = isDog ? '🐕' : '🐈';
      for (const g of got) {
        const w = axialToWorld({ q: g.q, r: g.r }, hexSize);
        spawnCombatText(w.x, w.z, `${icon} fetched`, isDog ? '#ffb454' : '#c084fc');
      }
    }, intervalMs);
    return () => clearInterval(iv);
  }, [isDog, hexSize, spawnCombatText, petFetch]);

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

    // Start cooldown on a successful cast — the Utility stat (Hacking/Stealth/Mobility/etc.)
    // shortens cooldowns, up to −50% at high investment, so utility builds cast more often.
    const util = useSkillStore.getState().utility || 0;
    const cdMult = Math.max(0.5, 1 - util * 0.015);
    setActiveSlotsRef.current(prev => prev.map(a => a.id === id ? { ...a, cooldown: Math.max(2, Math.round((a.maxCooldown ?? 8) * cdMult)) } : a));
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
  // True once the hero stands at their real starting tile (restored save or base
  // spawn) — gates incoming damage so pre-placement frames can't hurt the hero.
  const heroPlacedRef = React.useRef(false);
  // A saved hero position is only trustworthy if it's a real walkable tile AND not
  // the {q:0,r:0} new-profile default. (0,0) used to be the map centre, but on the
  // rescaled 240×240 map it's the far CORNER — fresh profiles restored there loaded
  // ~175 tiles from base, outside the spawn safe-zone, straight into Lv 25+ units.
  const savedHeroPosUsable = React.useCallback((p: { q: number; r: number } | undefined | null) => {
    if (!p) return false;
    if (p.q === 0 && p.r === 0) return false; // new-profile default sentinel, not a real save
    const t = tiles.find(tt => tt.q === p.q && tt.r === p.r);
    return !!t && t.type !== 'water' && t.type !== 'mountain';
  }, [tiles]);
  // When profile loads (and tiles exist to validate against), adopt the stored hero
  // position if it's usable; otherwise the spawn effect below places us at base.
  const heroRestoredRef = React.useRef(false);
  useEffect(() => {
    if (heroRestoredRef.current || tiles.length === 0 || !profile) return;
    const saved = profile.progress?.heroPosition;
    if (savedHeroPosUsable(saved)) {
      heroRestoredRef.current = true;
      heroPlacedRef.current = true;
      setHero(h => ({ ...h, pos: saved! }));
      setPet(p => ({ ...p, pos: saved! }));
      console.log('[hero] restored position from profile', saved);
      setRecenterSignal(s => s + 1);
    }
  }, [profile, tiles, savedHeroPosUsable]);

  // After tiles load, move hero to the real spawn position (center of map) if no
  // usable saved position exists. This is needed because useState initializes
  // with spawnPos={q:0,r:0} before tiles are available from the worker.
  const heroMovedToSpawn = React.useRef(false);
  useEffect(() => {
    if (tiles.length === 0 || heroMovedToSpawn.current || heroRestoredRef.current) return;
    if (savedHeroPosUsable(profile?.progress?.heroPosition)) return; // restore effect handles it
    // Place at base immediately (don't wait for the profile); if a usable saved
    // position arrives later, the restore effect above overrides this.
    heroMovedToSpawn.current = true;
    heroPlacedRef.current = true;
    setHero(h => ({ ...h, pos: spawnPos }));
    // Pet must also teleport to spawn — without this, pet stays at its useState
    // initial position ({q:4, r:-1} near the map origin) while the hero and camera
    // move to the real map center, leaving the pet hundreds of units off-screen.
    setPet(p => ({ ...p, pos: spawnPos }));
    setRecenterSignal(s => s + 1);
    console.log('[hero] moved to map spawn', spawnPos);
  }, [tiles, spawnPos, profile, savedHeroPosUsable]);

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
  // Exploration objective: must require actually ROAMING. Hero vision is 8, so ~217
  // tiles are revealed by simply standing at spawn (which used to instantly complete
  // the old 100-tile goal on load, paying its reward before the player moved).
  const explorationGoal = 400;
  const [explorationComplete, setExplorationComplete] = useState(false);
  // Seed from profile once when profile loads. Also re-derive the HUD count and the
  // completion flag, so a reloaded save doesn't show 0/100 (or lose its ✓) until you move.
  useEffect(() => {
    if (profile?.progress?.explored && exploredRef.current.size === 0) {
      for (const k of profile.progress.explored) exploredRef.current.add(k);
      setExploredCount(exploredRef.current.size);
      if (exploredRef.current.size >= explorationGoal) setExplorationComplete(true);
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
      if (campaignResettingRef.current) return; // don't resurrect explored tiles mid-reset
      saveProgress({ explored: Array.from(exploredRef.current) });
    }, 800);
    return () => clearTimeout(to);
  }, [heroVisible, petVisible, saveProgress]);

  // Exploration objective is a real MISSION: completing it (once per campaign) pays
  // level-scaled XP/FP + shards and advances your victory race — which in turn paces the
  // rivals (bumpSoloVictory). The one-time flag persists so reloads never re-award it.
  useEffect(() => {
    // Solo-only, and only AFTER the solo save hydrated — otherwise a reloaded, already-
    // rewarded campaign would pay out again before its explorationRewarded flag arrives.
    if (!soloEnabled || !soloHydrated || !explorationComplete || explorationRewardedRef.current) return;
    explorationRewardedRef.current = true;
    const lvl = playerLevelRef.current;
    awardFactionPoints(scaledMissionFp(8, lvl));
    awardHeroXp(scaledMissionXp(60, lvl));
    awardShardsRef.current(20);
    // Discovery/scouting feeds the Exploitation track (the "work the land" path).
    bumpSoloVictoryRef.current?.(playerFactionKey, 'exploitation', VICTORY_POINTS.exploration);
    saveProgress({ solo: { explorationRewarded: true } } as any);
    const hw = axialToWorld(heroPosRef.current, hexSize);
    spawnCombatText(hw.x, hw.z, '🧭 Exploration complete!', '#6ee7b7');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explorationComplete, soloHydrated]);

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

  // ── Movement speed: SPD stat (skill tree: utility→spd, Ghost/Skirmisher traits) + an
  // active 'haste' buff drive the step cadence, so faster heroes cross ground faster. ──
  const MOVE_BASE_MS = 155, MOVE_REF_SPD = 8;
  const moveSpdRef = React.useRef(6);
  moveSpdRef.current = combatStats?.spd ?? 6;
  const moveStepMs = () => {
    const eff = moveSpdRef.current + heroHasteRef.current;      // base SPD + haste boost
    return Math.max(70, Math.min(300, MOVE_BASE_MS * (MOVE_REF_SPD / Math.max(1, eff))));
  };
  // Walk-cycle playback-rate multiplier so the avatar's legs/arms visibly speed up or
  // slow down with the SPD stat (previously the animation ran at a fixed cadence no
  // matter how fast the hero actually crossed tiles, so SPD investment "felt" inert).
  // Same eff (SPD + haste) that drives step cadence, normalised against the reference
  // SPD and clamped to a sane playback-rate range. Declared here (above the duel/MOBA
  // snapshot-push effects below) so it can be broadcast as `spd` for remote heroes too.
  const heroAnimSpeedMult = Math.max(0.55, Math.min(2.2, (moveSpdRef.current + heroHasteRef.current) / MOVE_REF_SPD));

  // Push our latest snapshot (hero + pet) to the duel hook while connected; the hook
  // broadcasts it at a fixed 15 Hz tick. Runs on any relevant change (cheap ref write).
  React.useEffect(() => {
    if (!duelActive) return;
    duelSetSnapshotRef.current({
      pos: hero.pos,
      hp: heroVitals?.hp.current ?? 100,
      maxHp: heroVitals?.hp.max ?? 100,
      faction: heroFaction, gender: heroGender, name: heroVitals?.name,
      moving: isHeroMoving, facing: heroFacingAngle, spd: heroAnimSpeedMult,
      pet: { q: pet.pos.q, r: pet.pos.r, type: petType, moving: isPetMoving },
    });
  }, [duelActive, hero.pos, heroVitals?.hp.current, heroVitals?.hp.max, heroVitals?.name, isHeroMoving, heroFacingAngle, heroFaction, heroGender, heroAnimSpeedMult, pet.pos, petType, isPetMoving]);

  // Same, for the MOBA: push our hero snapshot up to the host (guest) / into the sim (host).
  React.useEffect(() => {
    if (!mobaActive) return;
    mobaSetSnapshotRef.current({
      pos: hero.pos,
      hp: heroVitals?.hp.current ?? 100,
      maxHp: heroVitals?.hp.max ?? 100,
      gender: heroGender, name: heroVitals?.name,
      moving: isHeroMoving, facing: heroFacingAngle, spd: heroAnimSpeedMult,
      pet: { q: pet.pos.q, r: pet.pos.r, type: petType, moving: isPetMoving },
    });
  }, [mobaActive, hero.pos, heroVitals?.hp.current, heroVitals?.hp.max, heroVitals?.name, isHeroMoving, heroFacingAngle, heroGender, heroAnimSpeedMult, pet.pos, petType, isPetMoving]);

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

  // Top surface height of the tile at (q,r), honouring the terraform override — every
  // actor (hero, pet, enemies, camps, outposts) anchors through this so per-terrain
  // tile heights never leave anything floating or buried.
  const tileTopAt = React.useCallback((q: number, r: number) => {
    const key = `${q},${r}`;
    const t = tilesByKey.get(key);
    if (!t) return 0.4;
    const ov = terraformedTiles.get(key);
    const type = ov ?? t.type;
    const base = heightFor(ov ? { ...t, type: ov } : t);
    // Plains/desert/hills/mountain tiles render a noise-displaced relief bump ON TOP
    // of the flat tile top (grass/rock texture); without accounting for it here,
    // actors anchor to the flat height and visually sink below that bump. Add the
    // bump height at the tile's center (same seed TerrainRelief uses) so feet meet
    // the actual terrain surface instead of looking buried.
    const relief = (type in RELIEF_SPECS) ? reliefCenterHeight(type as ReliefKind, hexSize, t.q * 31 + t.r * 17) : 0;
    return base + relief;
  }, [tilesByKey, terraformedTiles, hexSize]);

  // ── Base evolution: player level → build-out tier + city growth stage (drives
  // the command-center growth, district pads, the sprawl buildings, and the
  // stroked home-zone border). Visual meta-progression only — no gameplay effect.
  const heroLevelLive = Math.max(1, getLevelFromXp(Math.floor(heroXpLive)));
  const baseTier = baseTierFor(heroLevelLive);
  const baseCityStage = baseGrowthStage(heroLevelLive); // +1/level to 10, then +1/5 levels
  const baseZoneRadius = baseZoneRadiusFor(heroLevelLive);
  // House model variations for the sprawl, from the user-editable manifest (empty →
  // procedural buildings). Fetched once; bad/missing manifest silently keeps fallback.
  const [houseVariants, setHouseVariants] = useState<string[]>([]);
  // Dedicated model for the Command Center's tier-1 ("Base Camp") appearance — the
  // base BEFORE any growth-stage buildings/districts are added. Separate from the
  // sprawl `houses` pool so it never gets picked as a regular building.
  const [baseHqUrl, setBaseHqUrl] = useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    fetch(HOUSE_MANIFEST_URL)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!alive || !j) return;
        if (Array.isArray(j.houses)) {
          setHouseVariants(j.houses.filter((h: unknown): h is string => typeof h === 'string' && h.length > 0));
        }
        if (typeof j.base === 'string' && j.base.length > 0) setBaseHqUrl(j.base);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  // Between ring-ups the border stroke creeps outward toward the next radius jump, so
  // EVERY level visibly pushes the territory line before it snaps to the next ring.
  // (Driven directly by level, not by baseCityStage — that stage only ticks once per
  // 5 levels past level 10, which froze the ring across most level-ups in that range.)
  const baseZoneCreep = (() => {
    const start = baseZoneRingStartLevel(heroLevelLive);
    const next = baseZoneRingNextLevel(heroLevelLive);
    if (!Number.isFinite(next)) return 0.3; // final ring: hold a steady partial creep
    const progress = Math.min(1, (heroLevelLive - start) / (next - start));
    return progress * 0.4;
  })();
  // City sprawl: one spot per growth stage (= player level, 1:1). Every 5th stage is a
  // DISTRICT (see DISTRICT_KIND_CYCLE) — the ONLY stages that place a full house model,
  // alongside the district's themed BaseDistrictMesh dressing (2026-07-19: "1 house item
  // per new district only"). Every other stage places one small LEVEL_ELEMENTS prop
  // instead ("add elements from the assets folder for each level") — so growth still
  // reads every level, just lighter-weight than a full building. Each stage builds
  // inside the ring the TERRITORY STROKE had when that stage unlocked (ring 1 until L10,
  // 2 until L25, 3 until L50, then 4) — so every border expansion opens fresh tiles and
  // what follows visibly settles them. Placement is append-only stable: a spot's ring/
  // kind/district-ness is a function of its stage number (never the current level), the
  // PRNG is consumed per-attempt, and world landmarks (outposts/camps/terraformer) are
  // excluded by fixed tile key, so old placements never move as the city grows.
  const cityBuildingSpots = useMemo(() => {
    const bw = axialToWorld(baseAxial, hexSize);
    const blocked = new Set<string>([`${baseAxial.q},${baseAxial.r}`, `${terraformAxial.q},${terraformAxial.r}`]);
    for (const k of outposts.keys()) blocked.add(k);
    for (const k of creepCamps.keys()) blocked.add(k);
    for (const k of refugeeCamps.keys()) blocked.add(k);
    // Radial band (units of hexSize) per home-zone ring — outside the previous ring's
    // band, inside that ring's stroke (min boundary ≈ (1.73·R + 0.87) · hexSize).
    const BANDS: Array<[number, number]> = [[1.55, 2.4], [2.65, 4.1], [4.35, 5.85], [6.05, 7.55]];
    const rand = seededRand(4242);
    const GA = Math.PI * (3 - Math.sqrt(5)); // golden angle
    const spots: CitySpot[] = [];
    for (let k = 0; k < baseCityStage; k++) {
      const stage = k + 1; // stage IS the level it unlocked at (baseGrowthStage is 1:1)
      const isDistrict = stage % 5 === 0;
      const districtIdx = isDistrict ? stage / 5 - 1 : -1;
      const districtKind = isDistrict ? DISTRICT_KIND_CYCLE[districtIdx % DISTRICT_KIND_CYCLE.length] : undefined;
      const districtRepeat = isDistrict ? Math.floor(districtIdx / DISTRICT_KIND_CYCLE.length) : 0;
      // House model "kind" (hut/house/tower, DISTRICT stages only now — 2026-07-19:
      // "1 house item per new district only") tracks the city's overall growth at the
      // stage it unlocked — early districts read as humble, late ones (Metropolis-tier)
      // as grand.
      const kind = stage < 34 ? 0 : stage < 67 ? 1 : 2;
      const ring = baseZoneRadiusFor(stage);
      const [rMin, rMax] = BANDS[ring - 1];
      for (let a = 0; a < 24; a++) {
        const jr = rand(), ja = rand(), jrot = rand(), jh = rand(), jv = rand(), je = rand(), jes = rand();
        const ang = k * GA + a * 0.73 + ja * 0.4;
        const rad = hexSize * (rMin + (rMax - rMin) * jr);
        const x = bw.x + Math.cos(ang) * rad, z = bw.z + Math.sin(ang) * rad;
        const t = worldToAxial(x, z, hexSize);
        const key = `${t.q},${t.r}`;
        const tile = tilesByKey.get(key);
        if (!tile || tile.type === 'water' || tile.type === 'mountain') continue;
        if (axialDistance(t, baseAxial) > ring) continue; // inside the stroke as of unlock
        if (blocked.has(key)) continue;                    // never on outposts/camps/objectives
        // Districts are bigger footprints, so keep extra clearance around them (in
        // EITHER direction — a plain element shouldn't crowd a neighboring district either).
        if (spots.some(s => {
          const minD = hexSize * ((isDistrict || s.districtKind) ? 0.75 : 0.55);
          return (x - s.x) ** 2 + (z - s.z) ** 2 < minD ** 2;
        })) continue;
        if (isDistrict) {
          // `v` picks a RANDOM house variant per district (seeded, so the pick is
          // stable across reloads but doesn't cycle the pool in order).
          spots.push({ x, y: tileTopAt(t.q, t.r), z, rot: jrot * Math.PI * 2, kind, h: 0.8 + jh * 0.5, v: jv, districtKind, districtRepeat });
        } else {
          // Plain level — a small decorative element instead of a full house.
          spots.push({ x, y: tileTopAt(t.q, t.r), z, rot: jrot * Math.PI * 2, elementIdx: Math.floor(je * LEVEL_ELEMENTS.length), elementScale: 0.32 + jes * 0.24 });
        }
        break;
      }
    }
    return spots;
  }, [baseAxial, baseCityStage, tilesByKey, tileTopAt, hexSize, terraformAxial, outposts, creepCamps, refugeeCamps]);
  // Ribbon triangles along every hex edge of the home zone whose far side is
  // outside it, scaled outward from the base by the per-level creep. Each vertex
  // re-anchors to the tile it lands on, so the stroke hugs terrain even mid-creep.
  const baseZoneRingPositions = useMemo(() => {
    const R = baseZoneRadius;
    const zone = new Set<string>();
    for (let dq = -R; dq <= R; dq++) {
      for (let dr = Math.max(-R, -dq - R); dr <= Math.min(R, -dq + R); dr++) {
        const q = baseAxial.q + dq, r = baseAxial.r + dr;
        if (tilesByKey.has(`${q},${r}`)) zone.add(`${q},${r}`);
      }
    }
    // Neighbour across edge i, where edge i spans hex corners at angles i·60° and (i+1)·60°.
    const EDGE_NEIGH: Array<[number, number]> = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
    const verts: number[] = [];
    const W = 0.14; // stroke width as a fraction of the hex radius
    const bw = axialToWorld(baseAxial, hexSize);
    const scaleF = 1 + baseZoneCreep;
    const push = (px: number, pz: number) => {
      const sx = bw.x + (px - bw.x) * scaleF, sz = bw.z + (pz - bw.z) * scaleF;
      const t = worldToAxial(sx, sz, hexSize);
      verts.push(sx, tileTopAt(t.q, t.r) + 0.06, sz);
    };
    for (const key of zone) {
      const [q, r] = key.split(',').map(Number);
      const c = axialToWorld({ q, r }, hexSize);
      for (let i = 0; i < 6; i++) {
        const [dq, dr] = EDGE_NEIGH[i];
        if (zone.has(`${q + dq},${r + dr}`)) continue;
        const a1 = (Math.PI / 3) * i, a2 = (Math.PI / 3) * (i + 1);
        const o1x = c.x + Math.cos(a1) * hexSize, o1z = c.z + Math.sin(a1) * hexSize;
        const o2x = c.x + Math.cos(a2) * hexSize, o2z = c.z + Math.sin(a2) * hexSize;
        const i1x = c.x + Math.cos(a1) * hexSize * (1 - W), i1z = c.z + Math.sin(a1) * hexSize * (1 - W);
        const i2x = c.x + Math.cos(a2) * hexSize * (1 - W), i2z = c.z + Math.sin(a2) * hexSize * (1 - W);
        push(o1x, o1z); push(o2x, o2z); push(i2x, i2z);
        push(o1x, o1z); push(i2x, i2z); push(i1x, i1z);
      }
    }
    return new Float32Array(verts);
  }, [baseAxial, baseZoneRadius, baseZoneCreep, tilesByKey, tileTopAt, hexSize]);

  // Graphics quality — 'high' adds post-processing (bloom/vignette) + 2048 shadows;
  // 'low' keeps the lean pipeline for weaker machines. Persisted per browser.
  const [gfxHigh, setGfxHigh] = useState<boolean>(() => {
    try { return localStorage.getItem('afrofuture.gfxHigh') !== '0'; } catch { return true; }
  });
  // Player-chosen FPS cap (30 / 60 / 120, persisted). No auto-tuning: quality and
  // framerate only change when the player asks via the ✨ and 🎞 buttons.
  const [fpsCap, setFpsCap] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem('afrofuture.fpsCap'));
      return (FPS_CAP_OPTIONS as readonly number[]).includes(v) ? v : 120;
    } catch { return 120; }
  });
  const cycleFpsCap = React.useCallback(() => setFpsCap(cur => {
    const i = (FPS_CAP_OPTIONS as readonly number[]).indexOf(cur);
    const next = FPS_CAP_OPTIONS[(i + 1) % FPS_CAP_OPTIONS.length];
    try { localStorage.setItem('afrofuture.fpsCap', String(next)); } catch {}
    return next;
  }), []);
  // Rendered-frame counter feeding the dev FPS chip (single meter, StrictMode-safe).
  const fpsCounterRef = React.useRef(0);

  // ── Tutorial card: centered, pageable (prev/next), closable. Auto-opens on a
  // player's first campaign (persisted per browser); reopenable via the ❓ button.
  const [tutorialOpen, setTutorialOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('afrofuture.tutorialSeen') !== '1'; } catch { return true; }
  });
  const [tutorialPage, setTutorialPage] = useState(0);
  const closeTutorial = React.useCallback(() => {
    setTutorialOpen(false);
    try { localStorage.setItem('afrofuture.tutorialSeen', '1'); } catch {}
  }, []);
  const openTutorial = React.useCallback(() => { setTutorialPage(0); setTutorialOpen(true); }, []);
  const tutorialPages = React.useMemo(() => [
    { icon: '🎯', title: 'Current Objective', body: storyArc[storyBeatIdx]?.objective ?? 'Fill any victory track to win the campaign.' },
    { icon: '🌍', title: `Why We Fight — ${FACTION_MOTIVATION[playerFactionKey].ethos}`, body: FACTION_MOTIVATION[playerFactionKey].why },
    { icon: '🕹️', title: 'Getting Around', body: 'Move with WASD. Pan the camera with the arrow keys or by dragging, and zoom with the mouse wheel.' },
    { icon: '🚩', title: 'Capturing Outposts', body: 'Walk next to an outpost and press G to assault it, or use its buttons to Infiltrate 🥷 or Negotiate 🕊️ (skill-gated). Captured outposts claim territory and feed the Control track.' },
    { icon: '⚔️', title: 'Combat & Abilities', body: 'Press F to attack an adjacent enemy or camp. Offensive abilities are on Q / E / R / T, defensive on Z / X / C / V. Tab swaps the active set.' },
    { icon: '🌱', title: 'Economy & Aid', body: 'Pick up resources as you explore. Invest them at the Terraformer with T, aid refugee camps with H, and use items with 1-8.' },
    { icon: '🏆', title: 'Winning', body: 'Fill any of the four victory tracks in the top bar (Domination, Control, Prosperity, Exploitation) before a rival faction fills theirs. Your base and borders grow as you level.' },
  ], [storyArc, storyBeatIdx, playerFactionKey]);
  const toggleGfx = React.useCallback(() => setGfxHigh(v => {
    const n = !v;
    try { localStorage.setItem('afrofuture.gfxHigh', n ? '1' : '0'); } catch {}
    return n;
  }), []);
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
      console.log(`[death] Hero defeated, respawned at ${own ? 'owned outpost ' + own.key : 'base'}`);
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

  // One hex step with collision + persistence + move-XP (shared by keydown & the held-key loop).
  const stepHeroRef = React.useRef<(d: Axial) => void>(() => {});
  stepHeroRef.current = (delta: Axial) => {
    setHero(h => {
      const targetRaw = { q: h.pos.q + delta.q, r: h.pos.r + delta.r };
      const clamped = clampAxial(targetRaw);
      const tile = tilesByKey.get(`${clamped.q},${clamped.r}`);
      const check = passable(tile);
      if (!check.passable) {
        if (check.reason === 'water' || check.reason === 'mountain') setCollisionMessage({ type: check.reason, show: true });
        return h;
      }
      const next = { ...h, pos: clamped };
      saveProgress({ heroPosition: clamped });
      updateHeroPosition(clamped);
      tilesMoveRef.current++;
      if (tilesMoveRef.current >= 40) {
        tilesMoveRef.current = 0;
        petXPSystem.gainXPOnMove(
          profileForXpRef.current?.progress?.hero?.xp ?? 0,
          profileForXpRef.current?.progress?.hero?.level ?? 1,
        );
      }
      return next;
    });
  };

  useEffect(() => {
    const downSet = new Set<string>();
    const lastStepAt: Record<string, number> = {};
    const dirMap: Record<string, Axial> = {
      w: { q: 0, r: -1 },       // North
      s: { q: 0, r: 1 },        // South
      a: { q: -1, r: 1 },       // Southwest
      d: { q: 1, r: -1 },       // Northeast
    };
    // Continuous movement: while a direction key is held, step at the SPD-scaled cadence.
    const moveTimer = window.setInterval(() => {
      if (inputPausedRef.current || downSet.size === 0) return;
      const now = performance.now();
      const stepMs = moveStepMs();
      for (const key of downSet) {
        const d = dirMap[key];
        if (d && now - (lastStepAt[key] ?? 0) >= stepMs) { stepHeroRef.current(d); lastStepAt[key] = now; }
      }
    }, 16);
    function onKey(e: KeyboardEvent) {
      if (inputPausedRef.current) return; // skill-tree overlay open — ignore game input
      const k = e.key.toLowerCase();

      // ─── MOVEMENT (WASD ONLY) — arrow keys reserved for camera ─────────────
      const delta = dirMap[k];
      if (delta) {
        e.preventDefault();
        if (e.repeat || downSet.has(k)) return; // held: the interval loop handles repeats
        downSet.add(k);
        stepHeroRef.current(delta);              // immediate first step for responsiveness
        lastStepAt[k] = performance.now();
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
      // ─── TERRAFORM — invest a resource at the terraformer ──────────────
      // Y is the dedicated terraform key (T is reserved for the 4th offensive
      // ability hotkey, so it's left alone here to avoid the conflict).
      if (k === 'y') {
        if (e.repeat) return;
        investTerraformRef.current();
        return;
      }
      // ─── CAPTURE OUTPOST / CLAIM MASK (G) ───────────────────────────────
      if (k === 'g') {
        if (e.repeat) return;
        // A nearby mask shrine takes priority (shrines are spaced away from outposts,
        // so this is mostly for determinism) — G = quick assault; the on-screen buttons
        // offer infiltrate / negotiate for outposts.
        if (nearbyMaskRef.current) { claimMaskRef.current(); return; }
        captureOutpostWithRef.current('assault');
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
    return () => { window.clearInterval(moveTimer); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
  }, [tilesByKey, saveProgress, setAbilitySlots, setCollisionMessage, updateHeroPosition, petXPSystem.gainXPOnMove, handleItemUse]);
  // endTurn logic removed (turn system disabled)

  // Keyboard hex movement (pointy axial layout with q,r; adapt to 6 neighbors)
  // Keyboard disabled for now

  // ── Memoized tile fields ────────────────────────────────────────────────────
  // The map is ~1500 active + up to ~2000 memory tiles, each with several meshes.
  // Rebuilding that JSX on EVERY component render (vitals ticks, combat text,
  // enemy movement, 15Hz MP snapshots…) made React reconcile thousands of elements
  // per frame. Memoizing means the whole subtree bails out of reconciliation unless
  // something that actually affects tiles (movement, capture, terraform…) changed.
  const exploredMemoryField = React.useMemo(() => (
    <MemoryTileField tiles={exploredMemoryTiles} hexSize={hexSize} />
  ), [exploredMemoryTiles, hexSize]);

  const tileField = React.useMemo(() => (
    <>
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
              <group position={[0, tileTop, 0]}>
                <Suspense fallback={<TreeCluster size={hexSize} seed={t.q * 31 + t.r * 17} />}>
                  <FbxForest size={hexSize} seed={t.q * 31 + t.r * 17} />
                </Suspense>
              </group>
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
              <group position={[0, tileTop, 0]}>
                <TerrainRelief kind="water" size={hexSize} seed={t.q * 31 + t.r * 17} />
                {/* Rocks along the edges that border land (shoreline dressing) */}
                {(() => {
                  const landAngles: number[] = [];
                  axialNeighbors(t).forEach((n, i) => {
                    const nt = tilesByKey.get(`${n.q},${n.r}`);
                    if (nt && nt.type !== 'water') landAngles.push(NEIGHBOR_ANGLES[i]);
                  });
                  return landAngles.length ? (
                    <Suspense fallback={null}>
                      <ShoreRocks size={hexSize} seed={t.q * 53 + t.r * 29} landAngles={landAngles} />
                    </Suspense>
                  ) : null;
                })()}
              </group>
            )}
            {/* Gentle noise relief so open ground rolls instead of sitting flat
                (kept low-amplitude — actors still anchor to the flat tile top). */}
            {(inVision || explored) && (t.type === 'plains' || t.type === 'desert') && (
              <group position={[0, tileTop, 0]}><TerrainRelief kind={t.type} size={hexSize} seed={t.q * 31 + t.r * 17} /></group>
            )}
            {(inVision || explored) && t.type === 'plains' && !blockDeco && (
              <group position={[0, tileTop, 0]}><GrassCluster size={hexSize} seed={t.q * 37 + t.r * 13} /></group>
            )}
            {/* Cacti (military-pack models) on roughly a third of desert tiles */}
            {(inVision || explored) && t.type === 'desert' && !blockDeco && ((t.q * 31 + t.r * 17) & 7) < 3 && (
              <group position={[0, tileTop, 0]}>
                <Suspense fallback={null}><DesertCacti size={hexSize} seed={t.q * 41 + t.r * 19} /></Suspense>
              </group>
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
              <mesh rotation={[0, Math.PI / 6, 0]} position={[0, tileTop + 0.02, 0]} renderOrder={15}
                geometry={sharedHexGeo(hexSize, 0.04)} material={sharedOverlayMat('#000', 0.88)} />
            )}
            {/* FoW: dim overlay on explored-but-not-currently-visible tiles */}
            {!inVision && explored && (
              <mesh rotation={[0, Math.PI / 6, 0]} position={[0, tileTop + 0.016, 0]} renderOrder={14}
                geometry={sharedHexGeo(hexSize, 0.03)} material={sharedOverlayMat('#000', 0.38)} />
            )}
            {/* Territory ownership — each tile tinted by its controlling outpost's
                owner (faction colour if captured, grey if neutral). Owned ground is
                always shown faintly so the map reads as claimed territory; the 'O'
                overlay reveals the FULL partition (incl. neutral) with bright borders. */}
            {(inVision || explored) && outpostTerritory.has(key) && (() => {
              const owner = outposts.get(outpostTerritory.get(key)!)?.owner ?? 'neutral';
              const owned = owner === 'player';
              const rival = owner !== 'player' && owner !== 'neutral';
              // Without the overlay, owned AND rival ground tints (threat must be visible).
              if (!showOutpostZones && !owned && !rival) return null;
              const onBorder = zoneBoundary.has(key);
              const col = owned ? heroColors.primary : rival ? (FACTION_COLORS[owner]?.primary ?? '#8a8f96') : '#8a8f96';
              const op = showOutpostZones
                ? ((owned || rival) ? (onBorder ? 0.42 : 0.16) : (onBorder ? 0.24 : 0.06))
                : (onBorder ? 0.30 : 0.10); // always-on claimed-ground tint
              return (
                <mesh rotation={[0, Math.PI / 6, 0]} position={[0, tileTop + 0.05, 0]} renderOrder={13}
                  geometry={sharedHexGeo(hexSize * (onBorder ? 1 : 0.9), 0.02)} material={sharedOverlayMat(col, op)} />
              );
            })()}
          </group>
        );
      })}
    </>
  // exploredCount proxies the exploredRef set (it grows on movement).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [culledTiles, terraformedTiles, heroVisible, petVisible, decoBlockedKeys,
      collectibleFlowers, collectibleMushrooms, collectibleResources,
      outpostTerritory, zoneBoundary, showOutpostZones, outposts,
      heroColors.primary, hexSize, exploredCount, tilesByKey]);

  // ── Memoized entity fields (same rationale as the tile fields above) ─────────
  // Combat re-renders this component many times a second (vitals per hit, XP awards,
  // status effects…). Each of these maps walks hundreds-to-thousands of entities and
  // every visible one is a multi-mesh subtree with a troika Text label — memoizing
  // lets those renders skip the lot unless the entities themselves changed.
  const creepField = React.useMemo(() => (
    <>
      {Array.from(creepCamps.values()).map(camp => {
        // Cleared FORTIFY camps leave a machine-gun emplacement behind (the ground the
        // player secured); cleared raid camps still vanish outright.
        if (camp.cleared && camp.kind !== 'fortify') return null;
        const ckey = `${camp.q},${camp.r}`;
        if (!exploredRef.current.has(ckey) && !heroVisible.has(ckey)) return null; // fog of war
        if (axialDistance({ q: camp.q, r: camp.r }, hero.pos) > RENDER_RADIUS) return null;
        const cw = axialToWorld({ q: camp.q, r: camp.r }, hexSize);
        return (
          <group key={`camp-${camp.key}`} position={[cw.x, tileTopAt(camp.q, camp.r), cw.z]} frustumCulled={false}>
            {camp.cleared
              ? <FortifiedCampRemnant campKey={camp.key} size={hexSize} />
              : <CreepCampMesh camp={camp} size={hexSize} terrain={tilesByKey.get(ckey)?.type} />}
          </group>
        );
      })}
    </>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [creepCamps, heroVisible, hero.pos.q, hero.pos.r, hexSize, tileTopAt, tilesByKey, exploredCount]);

  const enemyField = React.useMemo(() => (
    <>
      {factionEnemies.map(en => {
        if (en.hp <= 0) return null;
        const ekey = `${en.q},${en.r}`;
        if (!exploredRef.current.has(ekey) && !heroVisible.has(ekey)) return null; // fog of war
        if (axialDistance({ q: en.q, r: en.r }, hero.pos) > RENDER_RADIUS) return null;
        const ew = axialToWorld({ q: en.q, r: en.r }, hexSize);
        const y = tileTopAt(en.q, en.r);
        // Far-LOD: distant units render as a cheap faction-coloured marker instead
        // of the full animated chibi rig (bosses keep the rig — they're landmarks).
        if (en.role !== 'boss' && axialDistance({ q: en.q, r: en.r }, hero.pos) > FAR_ENEMY_DIST) {
          return (
            <mesh key={en.id} position={[ew.x, y + hexSize * 0.35, ew.z]}
              geometry={sharedFarConeGeo(hexSize)} material={sharedTileMat(DOCTRINE[en.faction].color)} />
          );
        }
        return <EnemyUnitMesh key={en.id} enemy={en} size={hexSize} target={[ew.x, y, ew.z]} />;
      })}
    </>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [factionEnemies, heroVisible, hero.pos.q, hero.pos.r, hexSize, tileTopAt, exploredCount]);

  const outpostField = React.useMemo(() => (
    <>
      {Array.from(outposts.values()).map(o => {
        const okey = `${o.q},${o.r}`;
        if (!exploredRef.current.has(okey) && !heroVisible.has(okey)) return null;
        if (axialDistance({ q: o.q, r: o.r }, hero.pos) > RENDER_RADIUS) return null;
        const ow = axialToWorld({ q: o.q, r: o.r }, hexSize);
        const isDesert = tilesByKey.get(okey)?.type === 'desert';
        return (
          <group key={`outpost-${o.key}`} position={[ow.x, tileTopAt(o.q, o.r), ow.z]} frustumCulled={false}>
            {(() => {
              // In a MOBA, colour the banner by the authoritative owning faction;
              // otherwise fall back to the single-player owned/neutral flag.
              const mobaOwner = mobaActive ? mobaOutpostOwner.get(o.key) : undefined;
              if (mobaActive) {
                const owned = !!mobaOwner && mobaOwner !== 'neutral';
                const color = owned ? (FACTION_COLORS[mobaOwner as string]?.primary ?? heroColors.primary) : heroColors.primary;
                return <OutpostMarker size={hexSize} owned={owned} color={color} desert={isDesert} />;
              }
              // Solo: a rival empire's outpost flies THEIR colours — visible threat.
              const rivalOwner = o.owner !== 'player' && o.owner !== 'neutral' ? o.owner : null;
              return <OutpostMarker size={hexSize} owned={o.owner === 'player' || !!rivalOwner}
                color={rivalOwner ? (FACTION_COLORS[rivalOwner]?.primary ?? '#8a8f96') : heroColors.primary} desert={isDesert} />;
            })()}
          </group>
        );
      })}
    </>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [outposts, mobaActive, mobaOutpostOwner, heroColors.primary, heroVisible, hero.pos.q, hero.pos.r, hexSize, tileTopAt, tilesByKey, exploredCount]);

  const regionLabelField = React.useMemo(() => (
    <>
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
    </>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [showOutpostZones, outpostRegions, minimapVisibleKeys, heroColors.primary, hexSize, exploredCount]);

  const refugeeField = React.useMemo(() => (
    <>
      {Array.from(refugeeCamps.values()).map(c => {
        const rkey = `${c.q},${c.r}`;
        if (!exploredRef.current.has(rkey) && !heroVisible.has(rkey)) return null;
        if (axialDistance({ q: c.q, r: c.r }, hero.pos) > RENDER_RADIUS) return null;
        const rw = axialToWorld({ q: c.q, r: c.r }, hexSize);
        return (
          <group key={`refugee-${c.key}`} position={[rw.x, tileTopAt(c.q, c.r), rw.z]} frustumCulled={false}>
            <RefugeeCampMarker
              size={hexSize}
              done={c.completed}
              label={c.mission.title}
              icon={c.mission.icon}
              mode={c.mode}
              subtitle={c.mode === 'aid' ? `${c.delivered}/${c.required.amount} ${RESOURCE_DEFS[c.required.resource].label}` : undefined}
              showWcNpc={playerFactionKey === 'WC'}
            />
          </group>
        );
      })}
    </>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [refugeeCamps, heroVisible, hero.pos.q, hero.pos.r, hexSize, tileTopAt, playerFactionKey, exploredCount]);

  return (
  <div className="relative w-screen h-screen bg-[#111827] overflow-hidden">
      {/* Helper overlay removed for production */}
      <div className="absolute inset-0 select-none">
    {/* Camera elevation ≈ 33.3° above the ground plane (height/horizontal = tan(33.3°)). */}
    {/* Perf: dpr capped at 1.5 (high-DPI screens otherwise render 2x+ the pixels),
        plain PCF shadows (soft PCF costs extra taps per fragment), no stencil. */}
    <Canvas shadows="percentage" frameloop="demand" dpr={[1, 1.5]} camera={{ position: [0, 14.47, 22], fov: 45 }} gl={{ alpha: false, powerPreference: 'high-performance', stencil: false }} style={{ background: '#111827' }} onCreated={({ gl, scene }) => { gl.setClearColor('#111827', 1); scene.background = new THREE.Color('#111827'); gl.toneMappingExposure = 1.12; }}>
  {/* The limiter drives demand-mode rendering at the player's chosen cap (🎞 button,
      30/60/120). No auto-tuning: quality changes only via the ✨ Hi/Lo button. */}
  <FrameLimiter maxFps={fpsCap} />
  <WaterWaveClock />
  {import.meta.env.DEV && <FpsProbe counter={fpsCounterRef} />}
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
              <SceneBridge outerRadius={hexSize} onReady={(caps) => { setRefMountains(!!caps.mountain); setRefTrees(!!caps.tree); setRefWater(!!caps.water); setRefHills(!!caps.hills); setRefDesert(!!caps.desert); }} />
              {/* Distance haze — adds depth and dissolves the render-radius edge into
                  atmosphere instead of a hard cutoff. Colour sits between sky and dusk. */}
              <fog attach="fog" args={['#2f4258', 34, 95]} />
              {/* Sky sun aligned with the SunLight direction so highlights, shadows and
                  the sky's bright spot all agree. */}
              <Sky inclination={0.6} azimuth={0.25} sunPosition={[26, 38, 14]} turbidity={2.4} rayleigh={0.9} mieCoefficient={0.005} mieDirectionalG={0.8} />
              {/* Golden-hour grade: warm key light (SunLight) vs cool blue sky fill with an
                  earthy ground bounce — replaces the old flat near-white ambient wash. */}
              <hemisphereLight args={["#b8d0ff", "#414a40", 0.55]} />
              <SunLight heroWorld={heroWorld} quality={gfxHigh ? 'high' : 'low'} />
              {gfxHigh && (
                <EffectComposer multisampling={4}>
                  <Bloom intensity={0.45} luminanceThreshold={0.72} luminanceSmoothing={0.2} mipmapBlur />
                  <Vignette eskil={false} offset={0.22} darkness={0.5} />
                </EffectComposer>
              )}
              <group position={[0, 0, 0]}>
                {/* Dark ground plane: prevents white canvas showing at RENDER_RADIUS edge */}
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}>
                  <planeGeometry args={[2000, 2000]} />
                  <meshBasicMaterial color="#111827" />
                </mesh>

                {/* ── Explored-memory tiles outside RENDER_RADIUS — dim overlay, no decorations ── */}
                {exploredMemoryField}

                {/* ── Active render radius tiles ── */}
                {tileField}
                {/* Actor markers */}
                {/* Hero avatar replaced with billboard; pet retains simple sphere marker */}
                {/* Hero avatar — inlined JSX (not a sub-component) so React never
                    unmounts/remounts this group on parent re-renders.
                    Positioned at tile surface (y = 0.4), with avatar mesh foot-anchored
                    so feet sit exactly at the surface. */}
                <group ref={heroAvatarRef} position={[heroWorld.x, tileTopAt(hero.pos.q, hero.pos.r) + 0.08, heroWorld.z]} name="HeroAvatar" frustumCulled={false}>
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
                        <IsometricCharacter gender={heroGender ?? 'FEMALE'} colors={heroColors} hexSize={hexSize} faction={heroFaction} isMoving={isHeroMoving} facingAngle={heroFacingAngle} speedMult={heroAnimSpeedMult} />
                      }>
                        <GameAvatar heroModelUrl={heroModelUrl} heroParts={heroParts} heroColors={heroColors} hexSize={hexSize} gender={heroGender} isMoving={isHeroMoving} facingAngle={heroFacingAngle} speedMult={heroAnimSpeedMult} />
                      </Suspense>
                    )
                  ) : (
                    <IsometricCharacter gender={heroGender ?? 'FEMALE'} colors={heroColors} hexSize={hexSize} faction={heroFaction} isMoving={isHeroMoving} facingAngle={heroFacingAngle} speedMult={heroAnimSpeedMult} />
                  )}
                </group>
                {(() => { const world = axialToWorld(pet.pos, hexSize); const ps = hexSize * 0.32; return (
                  <group key={pet.id} position={[world.x, tileTopAt(pet.pos.q, pet.pos.r) + 0.08, world.z]} rotation={[0, petFacingAngle, 0]} frustumCulled={false}>
                    {/* Modeled cartoon dog/cat FBX (unrigged, so a simple bob conveys
                        movement) with the fully-animated procedural mesh as the
                        Suspense-loading fallback — same pattern as the hero avatar. */}
                    <Suspense fallback={isDog ? <IsometricDog ps={ps} isMoving={isPetMoving} /> : <IsometricPet ps={ps} isMoving={isPetMoving} />}>
                      <PetFbxBody url={isDog ? PET_ASSETS.dog : PET_ASSETS.cat} ps={ps} isMoving={isPetMoving} tint={isDog ? '#8a6240' : '#d99a45'} />
                    </Suspense>
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
                {creepField}
                {/* Faction enemies — mobile rival-faction AI units (active PvE). Rendered
                    at absolute world coords so they walk across tiles; fog-of-war + range
                    culled like camps. */}
                {enemyField}
                {/* Base / Command Center at spawn — build-out STATE (tier) follows player
                    level (1 every 10 levels), sprawl grows 1 building/level with a
                    district pad every 5th, all inside a stroked home-zone border */}
                {(() => { const bw = axialToWorld(baseAxial, hexSize); return (
                  <group key="base" position={[bw.x, tileTopAt(baseAxial.q, baseAxial.r), bw.z]} frustumCulled={false}>
                    {/* Fixed HQ model at every tier (user directive 2026-07-19: "keep the
                        same fixed base, only make it bigger") — CommandCenter's own
                        tier/stage scale coefficients carry all the growth now; the
                        sprawl/districts around it are what grows with more buildings
                        per level. Falls back to the general house pool only if the
                        dedicated base model hasn't loaded/isn't in the manifest yet. */}
                    <CommandCenter size={hexSize} color={heroColors.primary} tier={baseTier} stage={baseCityStage} playstyle={dominantStyle} hqUrl={baseHqUrl ?? houseVariants[0] ?? null} />
                    {/* Faction mask, once claimed — additional to the base (GDD "collect and
                        defend your mask"); also a rival raid target while it's here. */}
                    {maskHeld && (
                      <group position={[hexSize * 1.35, 0, hexSize * 0.75]}>
                        <MaskPedestal faction={playerFactionKey} size={hexSize} />
                      </group>
                    )}
                  </group>
                ); })()}
                <CityBuildingsMesh spots={cityBuildingSpots} size={hexSize} tier={baseTier} color={heroColors.primary} houses={houseVariants} />
                <BaseZoneRing positions={baseZoneRingPositions} color={heroColors.primary} />
                {/* Terraformer objective */}
                {(() => { const tw = axialToWorld(terraformAxial, hexSize); return (
                  <group key="terraformer" position={[tw.x, tileTopAt(terraformAxial.q, terraformAxial.r), tw.z]} frustumCulled={false}>
                    <Terraformer size={hexSize} progress={terraformProgress} done={terraformDone} />
                    {terraformDone && <GrassCluster size={hexSize} seed={terraformAxial.q * 7 + terraformAxial.r} />}
                  </group>
                ); })()}
                {/* Faction mask field shrines — one per faction. My own disappears once
                    claimed (see the mask pedestal in the base group); rival shrines stay
                    up until the campaign resolves (capturing one is an instant win, so
                    there's no need to hide it after — the campaign is over by then). */}
                {(['PAA', 'ASF', 'WC'] as const).filter(f => f !== playerFactionKey || !maskHeld).map(f => {
                  const ax = maskAxialFor(f);
                  const mw = axialToWorld(ax, hexSize);
                  return (
                    <group key={`mask-shrine-${f}`} position={[mw.x, tileTopAt(ax.q, ax.r), mw.z]} frustumCulled={false}>
                      <MaskShrine faction={f} size={hexSize} />
                    </group>
                  );
                })}
                {/* Outposts (fog-gated) */}
                {outpostField}
                {/* Region name + control labels (revealed with the 'O' territory overlay). */}
                {regionLabelField}
                {/* Refugee camps (fog-gated) — faction side missions */}
                {refugeeField}
                {/* Floating combat numbers (damage counters) — self-contained layer */}
                <CombatTextField spawnRef={combatTextSpawnRef} />
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
              {import.meta.env.DEV && <DevFpsMeter counter={fpsCounterRef} />}
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
              {/* Exploration objective + territory-control readouts now live inline in the
                  top HUD bar (see left cluster below) instead of floating over the map. */}

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
                  <div className="fixed top-24 sm:top-20 left-1/2 -translate-x-1/2 z-40 max-w-[94vw]">
                    <div className={`px-3 sm:px-4 py-2 rounded-xl bg-rose-900/85 border-2 text-xs sm:text-sm font-bold text-rose-100 backdrop-blur-sm shadow-lg flex items-center gap-2 flex-wrap justify-center ${isBoss ? 'border-amber-400/80' : 'border-rose-400/70'}`}>
                      <span style={{ color: isBoss ? '#ffd24a' : DOCTRINE[en.faction].color }}>{isBoss ? '👑' : '⚔️'} {label}</span>
                      <span className="opacity-80">Lv {en.level} · {Math.ceil(en.hp)}/{en.maxHp} HP</span>
                      <span className="ml-1 px-1.5 py-0.5 rounded bg-rose-700 font-bold">F</span> {verb}
                    </div>
                  </div>
                );
              })()}
              {/* Nearby creep camp — attacking is a deliberate choice (press F) */}
              {!nearbyFactionEnemy && nearbyCreepCamp && (
                <div className="fixed top-24 sm:top-20 left-1/2 -translate-x-1/2 z-40 max-w-[94vw]">
                  <div className="px-3 sm:px-4 py-2 rounded-xl bg-rose-900/80 border border-rose-400/60 text-xs sm:text-sm font-bold text-rose-100 backdrop-blur-sm shadow-lg flex items-center gap-2 flex-wrap justify-center">
                    ⚔️ {nearbyCreepCamp.kind === 'fortify' ? 'Fortify' : 'Raid'} Camp, Lv {nearbyCreepCamp.level} · {nearbyCreepCamp.creeps.filter(c => c.hp > 0).length} left
                    <span className="ml-1 px-1.5 py-0.5 rounded bg-rose-700 font-bold">F</span> to attack
                  </div>
                </div>
              )}
              {/* Faction threat indicator — flags rival units actively hunting the hero.
                  Sits below the victory-tracks bar (top-14) to avoid overlap. */}
              {enemyThreat.hunting > 0 && (
                <div className="fixed top-[8.75rem] sm:top-[6.25rem] left-1/2 -translate-x-1/2 z-40">
                  <div className="px-3 py-1 rounded-full bg-red-950/85 border border-red-500/60 text-xs font-bold text-red-200 backdrop-blur-sm shadow animate-pulse flex items-center gap-1.5">
                    🚨 {enemyThreat.hunting} enemy {enemyThreat.hunting === 1 ? 'unit' : 'units'} hunting you
                  </div>
                </div>
              )}

              {/* Terraformer / outpost prompts */}
              {(nearTerraformer && !terraformDone) && (
                <div className="fixed top-32 sm:top-28 left-1/2 -translate-x-1/2 z-40 max-w-[94vw]">
                  <div className="px-3 sm:px-4 py-2 rounded-xl bg-amber-900/80 border border-amber-400/60 text-xs sm:text-sm font-bold text-amber-100 backdrop-blur-sm shadow-lg flex items-center gap-2 flex-wrap justify-center">
                    🌱 Terraformer {terraformProgress}%, press <span className="px-1.5 py-0.5 rounded bg-amber-700 font-bold">Y</span> to invest a resource
                  </div>
                </div>
              )}
              {nearbyOutpost && (
                <div className="fixed top-32 sm:top-28 left-1/2 -translate-x-1/2 z-40 max-w-[94vw] pointer-events-auto">
                  {nearbyOutpost.owner === 'player' ? (
                    <UpgradePanelContent title="Your Outpost" icon="🚩"
                      current={outpostUpgrades.get(nearbyOutpost.key) ?? { tier: 0, spec: null }}
                      heroInventory={localHeroInventory} petInventory={localPetInventory}
                      onUpgrade={(spec) => upgradeLocationRef.current('outpost', nearbyOutpost.key, nearbyOutpost.q, nearbyOutpost.r, spec)} />
                  ) : (
                    <div className="px-4 py-2.5 rounded-xl bg-[#0c1219]/90 border border-white/15 text-xs sm:text-sm backdrop-blur-sm shadow-lg text-center space-y-2">
                      <div className="font-bold">🚩 Neutral Outpost, choose your approach</div>
                      {/* GDD: outposts are taken via stealth, combat, or tactical diplomacy */}
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button onClick={() => captureOutpostWithRef.current('assault')} title="Take it by force, fast, but rival defenders respond."
                          className="px-3 py-1.5 rounded-lg font-bold bg-rose-700/80 hover:bg-rose-600 ring-1 ring-rose-400/40">⚔️ Assault</button>
                        <button onClick={() => captureOutpostWithRef.current('infiltrate')} disabled={!canInfiltrate}
                          title={canInfiltrate ? 'Slip in quietly, no reprisal (best with a Stealth build).' : `Locked, unlock ${APPROACH_SKILL.infiltrate.label} in the skill tree.`}
                          className={`px-3 py-1.5 rounded-lg font-bold ring-1 ${canInfiltrate ? 'bg-violet-700/80 hover:bg-violet-600 ring-violet-400/40' : 'bg-gray-800/70 ring-white/10 opacity-50 cursor-not-allowed'}`}>{canInfiltrate ? '🥷' : '🔒'} Infiltrate</button>
                        <button onClick={() => captureOutpostWithRef.current('negotiate')} disabled={!canNegotiate}
                          title={canNegotiate ? 'Tactical diplomacy, peaceful, earns extra faction standing.' : `Locked, unlock ${APPROACH_SKILL.negotiate.label} in the skill tree.`}
                          className={`px-3 py-1.5 rounded-lg font-bold ring-1 ${canNegotiate ? 'bg-sky-700/80 hover:bg-sky-600 ring-sky-400/40' : 'bg-gray-800/70 ring-white/10 opacity-50 cursor-not-allowed'}`}>{canNegotiate ? '🕊️' : '🔒'} Negotiate</button>
                      </div>
                      <div className="text-[10px] opacity-50"><span className="px-1 rounded bg-white/10 font-bold">G</span> = quick assault</div>
                    </div>
                  )}
                </div>
              )}
              {/* Cleared fortify camp — same 5-tier upgrade panel as owned outposts. */}
              {!nearbyOutpost && nearbyFortifiedCamp && (
                <div className="fixed top-32 sm:top-28 left-1/2 -translate-x-1/2 z-40 max-w-[94vw] pointer-events-auto">
                  <UpgradePanelContent title="Fortified Camp" icon="🏰"
                    current={campUpgrades.get(nearbyFortifiedCamp.key) ?? { tier: 0, spec: null }}
                    heroInventory={localHeroInventory} petInventory={localPetInventory}
                    onUpgrade={(spec) => upgradeLocationRef.current('camp', nearbyFortifiedCamp.key, nearbyFortifiedCamp.q, nearbyFortifiedCamp.r, spec)} />
                </div>
              )}
              {nearbyRefugeeCamp && (() => {
                const c = nearbyRefugeeCamp;
                const loot = c.mode === 'loot';
                const held = localHeroInventory.filter(i => i.type === c.required.resource).reduce((s, i) => s + (i.quantity || 0), 0);
                const resLbl = RESOURCE_DEFS[c.required.resource]?.label ?? '';
                return (
                  <div className="fixed top-44 sm:top-40 left-1/2 -translate-x-1/2 z-40 max-w-[94vw] pointer-events-auto">
                    <div className="px-3 sm:px-4 py-2.5 rounded-xl border bg-[#0c1219]/90 border-white/15 text-xs sm:text-sm backdrop-blur-sm shadow-lg text-center space-y-2">
                      <div className="font-bold flex flex-wrap items-center justify-center gap-x-2">
                        <span>{c.mission.icon} {c.mission.title}</span>
                        <span className="opacity-70 font-normal">
                          {loot ? `, ${FACTION_LABEL[c.campFaction]} camp` : `, ${c.delivered}/${c.required.amount} ${resLbl} · holding ${held}`}
                        </span>
                      </div>
                      {/* Player DECIDES the approach (GDD strategy layer) */}
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {loot ? (
                          <>
                            <button onClick={() => resolveRefugeeRef.current('negotiate')} disabled={!canNegotiate}
                              title={canNegotiate ? PLAYSTYLES.negotiate.desc : `Locked, unlock ${APPROACH_SKILL.negotiate.label} in the skill tree.`}
                              className={`px-3 py-1.5 rounded-lg font-bold ring-1 ${canNegotiate ? 'bg-sky-700/80 hover:bg-sky-600 ring-sky-400/40' : 'bg-gray-800/70 ring-white/10 opacity-50 cursor-not-allowed'}`}>{canNegotiate ? '🕊️' : '🔒'} Negotiate</button>
                            <button onClick={() => resolveRefugeeRef.current('loot')} title={PLAYSTYLES.loot.desc}
                              className="px-3 py-1.5 rounded-lg font-bold bg-orange-700/80 hover:bg-orange-600 ring-1 ring-orange-400/40">🔥 Loot</button>
                          </>
                        ) : (
                          <button onClick={() => resolveRefugeeRef.current('help')} title={PLAYSTYLES.help.desc}
                            className="px-3 py-1.5 rounded-lg font-bold bg-emerald-700/80 hover:bg-emerald-600 ring-1 ring-emerald-400/40">✚ Help, deliver {resLbl}</button>
                        )}
                      </div>
                      <div className="text-[10px] opacity-50"><span className="px-1 rounded bg-white/10 font-bold">H</span> = {loot ? (canNegotiate ? 'negotiate' : 'negotiate (🔒 needs Diplomacy)') : 'help'} (peaceful default)</div>
                    </div>
                  </div>
                );
              })()}
              {/* Nearby mask shrine — press-to-collect (G). Own mask = main objective;
                  a rival's = instant Domination victory. */}
              {nearbyMask && (
                <div className="fixed top-56 sm:top-52 left-1/2 -translate-x-1/2 z-40 max-w-[94vw] pointer-events-auto">
                  <div className={`px-4 py-2.5 rounded-xl border text-xs sm:text-sm backdrop-blur-sm shadow-lg text-center space-y-1.5 ${nearbyMask === playerFactionKey ? 'bg-[#0c1219]/90 border-white/15' : 'bg-amber-950/85 border-amber-400/50'}`}>
                    <div className="font-bold">
                      {nearbyMask === playerFactionKey
                        ? `🎭 ${MASK_LORE[nearbyMask].title}, reclaim it`
                        : `🎭 ${MASK_LORE[nearbyMask].title}, an enemy relic!`}
                    </div>
                    {nearbyMask !== playerFactionKey && <div className="text-[11px] text-amber-200">Capturing it wins the campaign by Domination.</div>}
                    <button onClick={() => claimMaskRef.current()}
                      className={`px-4 py-1.5 rounded-lg font-bold ring-1 ${nearbyMask === playerFactionKey ? 'bg-emerald-700/80 hover:bg-emerald-600 ring-emerald-400/40' : 'bg-amber-600 hover:bg-amber-500 ring-amber-300/60 text-black'}`}>
                      {nearbyMask === playerFactionKey ? '🎭 Claim' : '⚔️ Capture'}
                    </button>
                    <div className="text-[10px] opacity-50"><span className="px-1 rounded bg-white/10 font-bold">G</span> = claim</div>
                  </div>
                </div>
              )}

              {/* ── Civ-style top yield bar — full width, yields left, identity right ────── */}
              <div className="fixed top-0 left-0 right-0 z-30 pointer-events-none">
                {/* Mobile: chips wrap onto extra rows at a smaller size (nothing gets cut
                    off or needs an unscrollable overflow); desktop keeps the single row. */}
                <div className="flex flex-wrap md:flex-nowrap items-center justify-between gap-x-2 gap-y-1 px-2 sm:px-3 py-1.5 sm:py-2.5 min-h-[2.75rem] sm:min-h-[3rem] bg-gradient-to-b from-[#0a0f16]/95 to-[#0a0f16]/75 border-b border-white/10 shadow-lg text-[11px] sm:text-[13px] text-gray-100 md:overflow-x-auto no-scrollbar">
                  {/* Left cluster: yields */}
                  <div className="flex items-center gap-x-2 sm:gap-x-3 gap-y-0.5 flex-wrap sm:flex-nowrap">
                    <div className="flex items-center gap-1.5" title="4X campaign score, outposts, regions, terraforming & refugee camps">
                      <span>🏆</span><span className="opacity-50 hidden md:inline">Score</span><span className="font-extrabold tabular-nums text-amber-300">{fourXScore}</span>
                    </div>
                    <div className="flex items-center gap-1.5" title="Faction Points earned in-game">
                      <span className="text-amber-300">✦</span><span className="opacity-50 hidden md:inline">FP</span>
                      <span className="font-extrabold tabular-nums">{(profile?.progress as any)?.factionPoints ?? 0}</span>
                    </div>
                    <span className="w-px h-4 bg-white/15" />
                    <div className="flex items-center gap-1" title="Tiles explored"><span>🧭</span><span className="opacity-50 hidden md:inline">Explore</span><span className={`font-semibold tabular-nums ${explorationComplete ? 'text-emerald-300' : ''}`}>{exploredCount}/{explorationGoal}{explorationComplete ? ' ✓' : ''}</span></div>
                    <div className="flex items-center gap-1" title="Terraform progress"><span>🌱</span><span className="font-semibold tabular-nums">{terraformDone ? '✓' : `${terraformProgress}%`}</span></div>
                    <div className="flex items-center gap-1" title="Outposts owned"><span>🚩</span><span className="font-semibold tabular-nums">{outpostControl.owned}/{outpostControl.total}</span></div>
                    <div className="hidden sm:flex items-center gap-1" title="Regions controlled"><span>🗺️</span><span className="font-semibold tabular-nums">{outpostControl.regionsControlled}/{outpostControl.regionCount}</span></div>
                    <div className="hidden sm:flex items-center gap-1" title="Territory held"><span>🟩</span><span className="font-semibold tabular-nums">{outpostControl.tilePct}%</span></div>
                    <div className="hidden sm:flex items-center gap-1" title="Refugee camps completed"><span>⛺</span><span className="font-semibold tabular-nums">{refugeeProgress.done}/{refugeeProgress.total}</span></div>
                    <div className="flex items-center gap-1" title={maskHeld ? 'Your faction mask is held at the base — defend it from raiders' : 'Your faction mask awaits at the old shrine — go claim it'}>
                      <span>🎭</span><span className={`font-semibold ${maskHeld ? 'text-emerald-300' : 'text-amber-300'}`}>{maskHeld ? 'Held' : 'Field'}</span>
                    </div>
                    {localPetInventory.length > 0 && (
                      <div className="hidden sm:flex items-center gap-1" title="Pet pack supplies (hotkeys 1–8)"><span>🐾</span><span className="font-semibold tabular-nums">{localPetInventory.reduce((s, i) => s + (i.quantity || 0), 0)}</span></div>
                    )}
                    {duelActive && (
                      <><span className="w-px h-4 bg-white/15" /><div className="flex items-center gap-1" title="Duel score"><span>⚔️</span><span className="font-semibold tabular-nums">{duel.status === 'connected' ? `${duel.myScore}–${duel.oppScore}` : duel.status}</span></div></>
                    )}
                  </div>

                  {/* Center cluster: the four VICTORY TRACKS — the "how to win right now" readout,
                      Civ-6-style inline in the bar, each clickable to expand a per-faction breakdown. */}
                  {(soloEnabled || (mobaMode && mobaActive)) && (
                    <div className="flex items-center shrink-0">
                      <span className="w-px h-5 bg-white/15 mr-1.5 hidden lg:block" />
                      <VictoryTrackChips
                        victory={mobaMode ? moba.victory : soloVictory}
                        myFaction={mobaMode ? moba.myFaction : playerFactionKey}
                        expanded={expandedTrack}
                        onToggle={(t) => setExpandedTrack(prev => prev === t ? null : t)}
                      />
                      <span className="w-px h-5 bg-white/15 ml-1.5 hidden lg:block" />
                    </div>
                  )}

                  {/* Right cluster: emergent playstyle identity + faction */}
                  <div className="flex items-center gap-2 sm:gap-3 flex-nowrap">
                    {dominantStyle && (
                      <div className="flex items-center gap-1.5" title={`Your emergent playstyle, ${PLAYSTYLES[dominantStyle].desc}`} style={{ color: PLAYSTYLES[dominantStyle].color }}>
                        <span>{PLAYSTYLES[dominantStyle].icon}</span><span className="font-bold whitespace-nowrap hidden sm:inline">{PLAYSTYLES[dominantStyle].title}</span>
                      </div>
                    )}
                    <span className="w-px h-4 bg-white/15" />
                    <div className="flex items-center gap-1.5" title={FACTION_LABEL[heroFaction as string] ?? String(heroFaction)}>
                      <span className="w-2 h-2 rounded-full" style={{ background: FACTION_COLORS[heroFaction as string]?.primary ?? '#8a8f96' }} />
                      <span className="font-bold" style={{ color: FACTION_COLORS[heroFaction as string]?.label ?? '#e5e7eb' }}>{String(heroFaction)}</span>
                    </div>
                    {/* ── Top-bar controls: Skills · Duel/MOBA · Menu (inline so they never
                        overlap the bar). `pointer-events-auto` re-enables clicks inside the
                        otherwise click-through bar. ─────────────────────────────────────── */}
                    <span className="w-px h-4 bg-white/15" />
                    <div className="flex items-center gap-1.5 pointer-events-auto">
                      <button
                        onClick={openSkillTree}
                        title="Skill tree, spend points on combat & utility perks"
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-bold ring-1 shadow transition ${
                          (skillPoints ?? 0) > 0
                            ? 'bg-emerald-800/80 ring-emerald-400/70 text-emerald-50 hover:bg-emerald-700/80'
                            : 'bg-[#141b26]/90 ring-white/15 text-gray-200 hover:ring-emerald-400/60'
                        }`}
                      >
                        <span>⭐</span><span className="hidden sm:inline">Skills</span>
                        {(skillPoints ?? 0) > 0 && <span className="px-1 rounded-full bg-black/30 tabular-nums">{skillPoints}</span>}
                      </button>
                      {!mobaMode && (
                        <button
                          onClick={() => setDuelLobbyOpen(o => !o)}
                          title="1v1 PvP duel"
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-bold ring-1 shadow transition ${
                            duelActive ? 'bg-rose-800/90 ring-rose-400 text-rose-50' : 'bg-[#141b26]/90 ring-white/15 text-gray-200 hover:ring-rose-400/60'
                          }`}
                        ><span>⚔️</span><span className="hidden sm:inline">Duel</span>{duelActive && duel.status === 'connected' ? ' •' : ''}</button>
                      )}
                      {mobaMode && (
                        <button
                          onClick={() => setMobaLobbyOpen(o => !o)}
                          title="1v1v1 MOBA"
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-bold ring-1 shadow transition ${
                            mobaActive ? 'bg-emerald-800/90 ring-emerald-400 text-emerald-50' : 'bg-[#141b26]/90 ring-white/15 text-gray-200 hover:ring-emerald-400/60'
                          }`}
                        ><span>🌍</span><span className="hidden sm:inline">MOBA</span>{mobaActive ? ' •' : ''}</button>
                      )}
                      <button
                        onClick={toggleGfx}
                        title={gfxHigh ? 'Graphics: High (bloom + sharp shadows), click for Low' : 'Graphics: Low (max FPS), click for High'}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-bold ring-1 shadow transition ${
                          gfxHigh ? 'bg-[#141b26]/90 ring-amber-400/50 text-amber-200 hover:ring-amber-300' : 'bg-[#141b26]/90 ring-white/15 text-gray-400 hover:ring-white/40'
                        }`}
                      ><span>✨</span><span className="hidden sm:inline">{gfxHigh ? 'Hi' : 'Lo'}</span></button>
                      <button
                        onClick={cycleFpsCap}
                        title={`Framerate cap: ${fpsCap}fps, click to cycle 30 / 60 / 120`}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-bold ring-1 shadow transition ${
                          fpsCap >= 120 ? 'bg-[#141b26]/90 ring-emerald-400/50 text-emerald-200 hover:ring-emerald-300' : 'bg-[#141b26]/90 ring-white/15 text-gray-300 hover:ring-white/40'
                        }`}
                      ><span>🎞</span><span className="hidden sm:inline tabular-nums">{fpsCap}</span></button>
                      {soloEnabled && (
                        <button
                          onClick={() => setMissionsOpen(o => !o)}
                          title="Main missions, the four winning paths"
                          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-bold ring-1 ring-white/15 bg-[#141b26]/90 text-gray-300 hover:ring-amber-400/60 shadow transition"
                        ><span>🎖️</span><span className="hidden sm:inline">Missions</span></button>
                      )}
                      <button
                        onClick={openTutorial}
                        title="How to play + current objective"
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-bold ring-1 ring-white/15 bg-[#141b26]/90 text-gray-300 hover:ring-white/40 shadow transition"
                      ><span>❓</span></button>
                      <button
                        onClick={() => setHudMenuOpen(o => !o)}
                        title="Menu (Esc)"
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-bold ring-1 ring-white/15 bg-[#141b26]/90 text-gray-200 hover:bg-[#1b2636]/90 shadow transition"
                      ><span>☰</span><span className="hidden sm:inline">Menu</span></button>
                    </div>
                  </div>
                </div>
                {/* Expanded victory-track detail — drops beneath the bar, Civ-6 style. */}
                {expandedTrack && (soloEnabled || (mobaMode && mobaActive)) && (
                  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-40 pointer-events-auto">
                    <VictoryTrackDetail
                      track={expandedTrack}
                      victory={mobaMode ? moba.victory : soloVictory}
                      myFaction={mobaMode ? moba.myFaction : playerFactionKey}
                      onClose={() => setExpandedTrack(null)}
                    />
                  </div>
                )}
              </div>

              {/* ── Tutorial card: centered, pageable, closable (❓ reopens) ─────────── */}
              {soloEnabled && tutorialOpen && (
                <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
                  <div className="pointer-events-auto w-[min(24rem,92vw)] rounded-2xl bg-[#0c1219]/95 ring-1 ring-white/15 shadow-2xl text-gray-100 p-5 relative">
                    <button onClick={closeTutorial} title="Close" aria-label="Close tutorial"
                      className="absolute top-2.5 right-2.5 h-7 w-7 rounded-md bg-white/5 hover:bg-white/15 ring-1 ring-white/10 text-gray-300 text-sm font-bold">✕</button>
                    <div className="flex items-center gap-2.5 mb-2">
                      <span className="text-2xl">{tutorialPages[tutorialPage].icon}</span>
                      <div className="font-bold text-base">{tutorialPages[tutorialPage].title}</div>
                    </div>
                    <div className="text-[13px] leading-relaxed text-gray-300 min-h-[4.5rem]">{tutorialPages[tutorialPage].body}</div>
                    <div className="flex items-center justify-between mt-4">
                      <button onClick={() => setTutorialPage(p => Math.max(0, p - 1))} disabled={tutorialPage === 0}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-bold ring-1 ring-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-default">‹ Prev</button>
                      <div className="flex items-center gap-1.5">
                        {tutorialPages.map((_, i) => (
                          <button key={i} onClick={() => setTutorialPage(i)} aria-label={`Page ${i + 1}`}
                            className={`h-2 w-2 rounded-full transition ${i === tutorialPage ? 'bg-amber-300' : 'bg-white/20 hover:bg-white/40'}`} />
                        ))}
                      </div>
                      {tutorialPage < tutorialPages.length - 1 ? (
                        <button onClick={() => setTutorialPage(p => Math.min(tutorialPages.length - 1, p + 1))}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-bold ring-1 ring-amber-400/40 bg-amber-600/70 hover:bg-amber-500/70">Next ›</button>
                      ) : (
                        <button onClick={closeTutorial}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-bold ring-1 ring-emerald-400/40 bg-emerald-700/80 hover:bg-emerald-600/80">Got it ✓</button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Main Missions panel — the four winning paths (🎖️ button reopens). Purely
                  a presentation layer over the live victory-track race: no separate
                  completion logic, so it can never desync from the real win condition. */}
              {soloEnabled && missionsOpen && (
                <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
                  <div className="pointer-events-auto w-[min(30rem,92vw)] max-h-[80vh] overflow-y-auto rounded-2xl bg-[#0c1219]/95 ring-1 ring-white/15 shadow-2xl text-gray-100 p-5 relative">
                    <button onClick={() => setMissionsOpen(false)} title="Close" aria-label="Close main missions"
                      className="absolute top-2.5 right-2.5 h-7 w-7 rounded-md bg-white/5 hover:bg-white/15 ring-1 ring-white/10 text-gray-300 text-sm font-bold">✕</button>
                    <div className="font-bold text-base mb-3">🎖️ Main Missions, the Four Winning Paths</div>
                    <div className="space-y-3">
                      {MAIN_MISSIONS.map(m => {
                        const def = VICTORY_TRACK_DEFS[m.track];
                        const value = soloVictory[playerFactionKey]?.[m.track] ?? 0;
                        const pct = Math.max(0, Math.min(100, Math.round((value / def.threshold) * 100)));
                        const won = soloVictoryResult?.track === m.track;
                        return (
                          <div key={m.track} className={`rounded-lg ring-1 p-3 ${won ? 'ring-amber-400/50 bg-amber-950/30' : 'ring-white/10 bg-white/5'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span>{def.icon}</span>
                              <span className="font-bold text-sm">{m.title}</span>
                              {won ? (
                                <span className="ml-auto text-[11px] font-bold text-amber-300">WON ✓</span>
                              ) : def.natural === playerFactionKey ? (
                                <span className="ml-auto text-[10px] opacity-60">Your faction's lean</span>
                              ) : null}
                            </div>
                            <div className="text-[12px] opacity-70 mb-2">{m.description}</div>
                            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                            </div>
                            <div className="text-[11px] opacity-60 mt-1 tabular-nums">{Math.round(value)}/{def.threshold}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Faction mask lore — one-time intro dialog (GDD "collect and defend your
                  mask"), fires once after story beat 1. Single acknowledgement, no choices. */}
              {soloEnabled && maskDialogOpen && (
                <div className="fixed inset-0 z-50 flex items-end justify-center pb-64 sm:pb-24 bg-black/45 backdrop-blur-[2px] pointer-events-auto">
                  <div className="relative w-[min(34rem,94vw)] p-5 rounded-2xl bg-[#0c1219]/97 ring-1 ring-white/15 shadow-2xl text-gray-100">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: FACTION_COLORS[playerFactionKey]?.primary ?? '#8a8f96' }} />
                      <span className="text-[11px] uppercase tracking-wider opacity-60">🎭 {MASK_LORE[playerFactionKey].title}</span>
                    </div>
                    <div className="font-bold mb-2" style={{ color: FACTION_COLORS[playerFactionKey]?.label ?? '#e5e7eb' }}>
                      {storyNpc(playerFactionKey, heroGender ?? 'FEMALE')}
                    </div>
                    <div className="text-sm leading-relaxed opacity-90 mb-2 bg-black/30 rounded-lg px-3 py-2">“{storyText(MASK_LORE[playerFactionKey].lines[0], playerFactionKey, heroGender ?? 'FEMALE')}”</div>
                    <div className="text-sm leading-relaxed opacity-90 mb-4 bg-black/30 rounded-lg px-3 py-2">“{storyText(MASK_LORE[playerFactionKey].lines[1], playerFactionKey, heroGender ?? 'FEMALE')}”</div>
                    <button onClick={closeMaskDialog} className="w-full py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 font-bold">Understood</button>
                  </div>
                </div>
              )}

              {/* ── Mask claim/capture/loss storyline beat — fires the moment a mask
                  changes hands (press-G collect, or a rival raid stealing your own). */}
              {soloEnabled && maskClaimEvent && (() => {
                const ev = maskClaimEvent;
                const npc = storyNpc(playerFactionKey, heroGender ?? 'FEMALE');
                if (ev.kind === 'own') {
                  return (
                    <div className="fixed inset-0 z-50 flex items-end justify-center pb-64 sm:pb-24 bg-black/45 backdrop-blur-[2px] pointer-events-auto">
                      <div className="relative w-[min(34rem,94vw)] p-5 rounded-2xl bg-[#0c1219]/97 ring-1 ring-white/15 shadow-2xl text-gray-100">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: FACTION_COLORS[playerFactionKey]?.primary ?? '#8a8f96' }} />
                          <span className="text-[11px] uppercase tracking-wider opacity-60">🎭 {MASK_LORE[playerFactionKey].title}, Reclaimed</span>
                        </div>
                        <div className="font-bold mb-2" style={{ color: FACTION_COLORS[playerFactionKey]?.label ?? '#e5e7eb' }}>{npc}</div>
                        <div className="text-sm leading-relaxed opacity-90 mb-4 bg-black/30 rounded-lg px-3 py-2">“{storyText(MASK_LORE[playerFactionKey].lines[1], playerFactionKey, heroGender ?? 'FEMALE')} It is home now, but not safe, they will come for it. Defend the base.”</div>
                        <button onClick={closeMaskClaimEvent} className="w-full py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 font-bold">Continue</button>
                      </div>
                    </div>
                  );
                }
                if (ev.kind === 'rival') {
                  return (
                    <div className="fixed inset-0 z-50 flex items-end justify-center pb-64 sm:pb-24 bg-black/55 backdrop-blur-[2px] pointer-events-auto">
                      <div className="relative w-[min(34rem,94vw)] p-5 rounded-2xl bg-[#160e05]/97 ring-1 ring-amber-400/40 shadow-2xl text-gray-100">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-amber-400" />
                          <span className="text-[11px] uppercase tracking-wider text-amber-300">🎭 {MASK_LORE[ev.faction].title}, Captured</span>
                        </div>
                        <div className="font-bold mb-2 text-amber-300 text-lg">Domination Victory</div>
                        <div className="text-sm leading-relaxed opacity-90 mb-2 bg-black/30 rounded-lg px-3 py-2">You have taken the {FACTION_LABEL[ev.faction] ?? ev.faction} mask from its shrine, a blow against their sovereignty no combat could deliver.</div>
                        <div className="text-sm leading-relaxed opacity-90 mb-4 bg-black/30 rounded-lg px-3 py-2 italic">“{npc}: Let them feel it.”</div>
                        <button onClick={closeMaskClaimEvent} className="w-full py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-black font-bold">Continue</button>
                      </div>
                    </div>
                  );
                }
                // 'lost' — a rival stole the player's own mask: Domination LOSS.
                return (
                  <div className="fixed inset-0 z-50 flex items-end justify-center pb-64 sm:pb-24 bg-black/55 backdrop-blur-[2px] pointer-events-auto">
                    <div className="relative w-[min(34rem,94vw)] p-5 rounded-2xl bg-[#1a0a0a]/97 ring-1 ring-rose-500/40 shadow-2xl text-gray-100">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-rose-500" />
                        <span className="text-[11px] uppercase tracking-wider text-rose-300">🎭 {MASK_LORE[playerFactionKey].title}, Stolen</span>
                      </div>
                      <div className="font-bold mb-2 text-rose-400 text-lg">Domination Loss</div>
                      <div className="text-sm leading-relaxed opacity-90 mb-4 bg-black/30 rounded-lg px-3 py-2">{FACTION_LABEL[ev.faction] ?? ev.faction} raiders broke the vault and carried the mask off before the defense could form. Domination is theirs.</div>
                      <button onClick={closeMaskClaimEvent} className="w-full py-2 rounded-lg bg-rose-700 hover:bg-rose-600 font-bold">Continue</button>
                    </div>
                  </div>
                );
              })()}

              {/* ── 1v1 PvP Duel: lobby + result (launcher lives in the top HUD bar) ─── */}
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
                      <div className="text-[11px] opacity-50 text-center">or play a friend: host, share the code, they paste & join</div>
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
                      {duel.status === 'error' && <div className="text-[11px] text-rose-400">Couldn't connect, try again or check the code.</div>}
                    </>
                  )}

                  {duel.status === 'searching' && (
                    <div className="space-y-2 text-center">
                      <div className="text-[12px] text-emerald-400 font-bold animate-pulse py-1">🎯 Searching for an opponent…</div>
                      {duel.code && <div className="text-[11px] opacity-60">You're in the queue{duel.role === 'host' ? ' as host' : ''}, hang tight.</div>}
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
                      <div className="text-center text-emerald-400 font-bold">Connected, Fight!</div>
                      <div className="text-center text-lg font-extrabold tabular-nums">
                        <span className="text-amber-300">You {duel.myScore}</span>
                        <span className="opacity-50"> · </span>
                        <span className="text-rose-300">{duel.oppScore} Rival</span>
                      </div>
                      <div className="text-[11px] opacity-70 text-center">First to {duel.winTarget} · get adjacent & press <span className="px-1 rounded bg-white/10 font-bold">F</span> to strike.</div>
                      <button onClick={() => duel.leave()} className="w-full py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs">Leave duel</button>
                    </div>
                  )}

                  {duel.status === 'reconnecting' && (
                    <div className="space-y-2 text-center">
                      <div className="text-[12px] text-amber-300 font-bold animate-pulse">Connection dropped, reconnecting…</div>
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

              {/* ── Story beat dialog — bottom-center, one line at a time via "Next", 'x' to close anytime. */}
              {soloEnabled && activeStoryBeat && (
                <div className="fixed inset-0 z-50 flex items-end justify-center pb-64 sm:pb-24 bg-black/45 backdrop-blur-[2px] pointer-events-auto">
                  <div className="relative w-[min(34rem,94vw)] p-5 rounded-2xl bg-[#0c1219]/97 ring-1 ring-white/15 shadow-2xl text-gray-100">
                    <button
                      onClick={closeStoryBeat}
                      aria-label="Close"
                      title="Close"
                      className="absolute top-3 right-3 w-7 h-7 rounded-lg bg-white/5 hover:bg-white/15 flex items-center justify-center text-sm font-bold transition"
                    >✕</button>
                    <div className="flex items-center gap-2 mb-1 pr-8">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: FACTION_COLORS[playerFactionKey]?.primary ?? '#8a8f96' }} />
                      <span className="text-[11px] uppercase tracking-wider opacity-60">
                        Chapter {activeStoryBeat.index} · {activeStoryBeat.title}
                      </span>
                    </div>
                    <div className="font-bold mb-2 pr-8" style={{ color: FACTION_COLORS[playerFactionKey]?.label ?? '#e5e7eb' }}>
                      {storyNpc(playerFactionKey, heroGender ?? 'FEMALE')}
                    </div>
                    {storyOutcome ? (
                      <>
                        <div className="text-sm leading-relaxed opacity-90 italic mb-4 bg-black/30 rounded-lg px-3 py-2">{storyText(storyOutcome, playerFactionKey, heroGender ?? 'FEMALE')}</div>
                        <button
                          onClick={closeStoryBeat}
                          className="w-full py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 font-bold"
                        >Continue</button>
                      </>
                    ) : storyLineIdx < activeStoryBeat.lines.length - 1 ? (
                      <>
                        <div className="text-sm leading-relaxed opacity-90 mb-4 bg-black/30 rounded-lg px-3 py-2">“{storyText(activeStoryBeat.lines[storyLineIdx], playerFactionKey, heroGender ?? 'FEMALE')}”</div>
                        <button
                          onClick={() => setStoryLineIdx(i => i + 1)}
                          className="w-full py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 font-bold"
                        >Next</button>
                      </>
                    ) : (
                      <>
                        <div className="text-sm leading-relaxed opacity-90 mb-4 bg-black/30 rounded-lg px-3 py-2">“{storyText(activeStoryBeat.lines[storyLineIdx], playerFactionKey, heroGender ?? 'FEMALE')}”</div>
                        <div className="grid gap-2">
                          {activeStoryBeat.choices.map(c => (
                            <button
                              key={c.id}
                              onClick={() => chooseStory(activeStoryBeat, c)}
                              className="w-full text-left px-4 py-2.5 rounded-lg bg-[#1c2838] hover:bg-[#243448] ring-1 ring-white/15 text-sm font-semibold transition"
                            >{c.label}</button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Rival raid alert — a faction AI retook one of your outposts (go defend/recapture). */}
              {raidBanner && (
                <div className="fixed top-32 sm:top-24 left-1/2 -translate-x-1/2 z-40 pointer-events-none max-w-[94vw]">
                  <div className="px-4 py-2 rounded-xl bg-rose-950/90 ring-1 ring-rose-500/60 text-center shadow-xl flex items-center gap-2">
                    <span className="text-lg">⚑</span>
                    <span className="text-sm font-bold text-rose-200" style={{ color: FACTION_COLORS[raidBanner.faction]?.label ?? '#fecaca' }}>
                      {FACTION_LABEL[raidBanner.faction] ?? raidBanner.faction}
                    </span>
                    <span className="text-sm font-semibold text-rose-100">{raidBanner.text ?? 'raided your outpost, recapture it!'}</span>
                  </div>
                </div>
              )}

              {/* Level-up flash — XP crossed a threshold → new skill points available */}
              {levelUpBanner !== null && (
                <div className="fixed top-1/3 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
                  <div className="px-6 py-3 rounded-2xl bg-emerald-900/85 ring-1 ring-emerald-400/60 text-center shadow-2xl animate-bounce">
                    <div className="text-2xl font-extrabold text-emerald-300">⭐ Level {levelUpBanner}!</div>
                    <div className="text-xs opacity-80 mt-0.5">New skill points available, open the skill tree</div>
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
                    <div className="text-lg font-bold tabular-nums mb-1"><span className="text-amber-300">{duel.myScore}</span> <span className="opacity-50">:</span> <span className="text-rose-300">{duel.oppScore}</span></div>
                    <div className="opacity-70 text-sm mb-4">{duel.result === 'win' ? `Best of ${duel.winTarget * 2 - 1}, you won the match.` : 'Your rival won the match.'}</div>
                    <button onClick={() => { duel.leave(); setDuelLobbyOpen(false); }} className="px-6 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 font-bold">Close</button>
                  </div>
                </div>
              )}

              {/* Solo victory-track result — a faction filled a track first. Win (you) or loss (AI).
                  The campaign stays decided (tracks frozen) until the player starts a new one. */}
              {soloEnabled && soloVictoryResult && !soloResultDismissed && !maskClaimEvent && (() => {
                const won = soloVictoryResult.faction === playerFactionKey;
                const def = VICTORY_TRACK_DEFS[soloVictoryResult.track];
                return (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="px-10 py-8 rounded-2xl bg-[#0c1219]/95 ring-1 ring-white/15 text-center shadow-2xl max-w-[92vw]">
                      <div className={`text-4xl font-extrabold mb-2 ${won ? 'text-amber-300' : 'text-rose-400'}`}>
                        {won ? '🏆 Victory' : '☠️ Defeat'}
                      </div>
                      <div className="text-sm mb-1">
                        <span className="font-bold" style={{ color: FACTION_COLORS[soloVictoryResult.faction]?.label }}>{FACTION_LABEL[soloVictoryResult.faction]}</span>
                        <span className="opacity-70"> won by </span>
                        <span className="font-bold">{def.icon} {def.label}</span>
                      </div>
                      <div className="opacity-70 text-sm mb-4">{won ? `You reached the ${def.label} threshold first. +60 shards.` : `${soloVictoryResult.faction} filled the ${def.label} track before you.`}</div>
                      {newCampaignChoice ? (
                        <div>
                          <div className="text-sm font-semibold mb-3">Start the new campaign at Level 1 too?</div>
                          <div className="flex items-center justify-center gap-3">
                            <button disabled={campaignResetting} onClick={() => resetCampaign(true)} title="Wipe hero level, XP, skill tree and pet bond back to the start — shards and items are untouched."
                              className="px-5 py-2 rounded-lg font-bold bg-rose-700 hover:bg-rose-600 disabled:opacity-60">
                              {campaignResetting ? 'Resetting…' : '🔄 Reset to Lv 1'}
                            </button>
                            <button disabled={campaignResetting} onClick={() => resetCampaign(false)} title="Reset the world, territory, terraforming and camps — your hero, skills, pet, shards and items carry over."
                              className="px-5 py-2 rounded-lg font-bold bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60">
                              {campaignResetting ? 'Resetting…' : '📈 Keep My Hero'}
                            </button>
                          </div>
                          {!campaignResetting && (
                            <button onClick={() => setNewCampaignChoice(false)} className="mt-3 text-xs opacity-60 hover:opacity-90 underline">‹ Back</button>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-3">
                          <button onClick={() => setNewCampaignChoice(true)} title="Start a new campaign"
                            className="px-6 py-2 rounded-lg font-bold bg-emerald-700 hover:bg-emerald-600">
                            🔁 New Campaign
                          </button>
                          <button disabled={campaignResetting} onClick={() => { victorySeenRef.current = true; setSoloResultDismissed(true); }}
                            className="px-6 py-2 rounded-lg font-bold bg-white/10 hover:bg-white/20 ring-1 ring-white/20">
                            Keep Playing
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── 1v1v1 MOBA: lobby + scoreboard + result (launcher lives in the top HUD bar) ─── */}
              {/* Shared 3-faction scoreboard (top-center) while a match is live. */}
              {mobaMode && mobaActive && (
                <div className="fixed top-14 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#0c1219]/90 ring-1 ring-white/12 shadow-lg">
                    {(['PAA','ASF','WC'] as Faction[]).map(f => (
                      <div key={f} className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg ${moba.myFaction === f ? 'bg-white/10 ring-1 ring-white/25' : ''}`}>
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: FACTION_COLORS[f].primary }} />
                        <span className="text-[11px] font-bold" style={{ color: FACTION_COLORS[f].label }}>{f}</span>
                        <span className="text-sm font-extrabold tabular-nums text-white">{moba.scores[f] ?? 0}</span>
                      </div>
                    ))}
                    <span className="text-[10px] opacity-50 ml-1">score</span>
                  </div>
                </div>
              )}

              {/* (Victory tracks now live inline in the Civ-6-style top HUD bar — see above.) */}

              {mobaMode && mobaLobbyOpen && (
                <div className="fixed top-28 right-3 z-40 w-[min(20rem,92vw)] p-4 rounded-xl bg-[#0c1219]/95 ring-1 ring-white/12 shadow-2xl text-sm text-gray-100 space-y-3 pointer-events-auto">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">🌍 1v1v1 MOBA</span>
                    <button onClick={() => setMobaLobbyOpen(false)} className="opacity-60 hover:opacity-100">✕</button>
                  </div>

                  {(moba.status === 'idle' || moba.status === 'error') && (
                    <>
                      <div className="text-[11px] opacity-60">Pick your faction, the 3rd is played by AI.</div>
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
                      <button onClick={() => moba.findMatch(mobaFactionPick)} className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold flex items-center justify-center gap-2">
                        🎯 Quick Match
                        {mobaWaiting > 0 && <span className="px-1.5 py-0.5 rounded-full bg-black/30 text-[10px] font-bold">{mobaWaiting} waiting</span>}
                      </button>
                      <div className="text-[11px] opacity-50 text-center">or host / join by code</div>
                      <button onClick={() => moba.host(mobaFactionPick)} className="w-full py-2 rounded-lg bg-[#1c2838] hover:bg-[#243448] ring-1 ring-white/15 font-bold">Host with a code</button>
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
                      {moba.status === 'error' && <div className="text-[11px] text-rose-400">Couldn't connect, try again or check the code.</div>}
                    </>
                  )}

                  {moba.status === 'searching' && (
                    <div className="space-y-2 text-center">
                      <div className="text-[12px] text-emerald-400 font-bold animate-pulse py-1">🎯 Searching for a match…</div>
                      <div className="text-[11px] opacity-60">Joining the next open lobby, or opening one for others, AI fills any empty faction.</div>
                      <button onClick={() => moba.leave()} className="w-full py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs">Cancel search</button>
                    </div>
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
                            {dupFactions && <div className="text-[11px] text-amber-400 text-center">Two players share a faction, pick distinct factions to start.</div>}
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
                      <div className="text-center text-emerald-400 font-bold text-[13px]">Match live, {FACTION_LABEL[moba.myFaction ?? 'PAA']}</div>
                      <div className="text-[11px] opacity-70 text-center">Get adjacent to an outpost & press <span className="px-1 rounded bg-white/10 font-bold">G</span> to capture. Fill a victory track to win.</div>
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
                    <div className="opacity-80 text-sm mb-1">
                      {moba.winner ? `${FACTION_LABEL[moba.winner]} wins` : ''}
                      {moba.winningTrack ? ` by ${VICTORY_TRACK_DEFS[moba.winningTrack].icon} ${VICTORY_TRACK_DEFS[moba.winningTrack].label}.` : moba.winner ? ' the match.' : ''}
                    </div>
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
                <div className="fixed bottom-[19rem] sm:bottom-56 left-1/2 -translate-x-1/2 animate-bounce max-w-[94vw]">
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
                petBond={petBondDisplay}
                petAbilities={petAbilitiesDisplay}
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
                resources={[{ id: 'factionPoints', label: 'Faction Points', value: (profile?.progress as any)?.factionPoints ?? 0, icon: '✦' }, ...(resources || [])]}
                skillTokens={skillTokens || 0}
                petTokens={0}
                minimapData={minimapData}
                onMenu={onExit}
                onSave={autoMultiplayer ? undefined : async () => {
                  // Explicit "Save Game" (solo only): flush a full live snapshot so the
                  // player can quit and resume exactly where they left off. Reuses the
                  // same buildSoloSnapshotRef as the auto-save/tab-close flush, so the
                  // fields never drift out of sync. { immediate: true } bypasses the
                  // network throttle and is awaited so "Save & Exit to Dashboard" can't
                  // race the next screen's profile fetch (that race made a real save
                  // look like it "didn't take" — landing back in a fresh campaign).
                  // Disabled in multiplayer duels where the arena position isn't
                  // meaningful to save.
                  try {
                    const s = useSkillStore.getState();
                    const lvl = Math.max(1, getLevelFromXp(Math.floor(heroXpLive)), s.level);
                    s.setLevel(lvl);
                    await saveProgress({
                      heroPosition: { q: heroPosRef.current.q, r: heroPosRef.current.r },
                      hero: { xp: Math.floor(heroXpLive), level: lvl, unlockedSkillIds: s.unlocked, unlockOrder: s.unlockOrder },
                      heroInventory: localHeroInventory as any,
                      petInventory: localPetInventory as any,
                      explored: Array.from(exploredRef.current),
                      // Solo world state — captured territory, terraforming, resolved camps,
                      // rival outposts, story progress, victory tracks, resource counter.
                      solo: buildSoloSnapshotRef.current(),
                    } as any, { immediate: true });
                  } catch {}
                }}
                skillPoints={skillPoints}
                totalPlayTime={totalPlayTime}
                heroInventory={localHeroInventory}
                petInventory={localPetInventory}
                playerProfile={playerProfile}
                onTalents={openSkillTree}
                menuOpen={hudMenuOpen}
                onMenuOpenChange={setHudMenuOpen}
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
