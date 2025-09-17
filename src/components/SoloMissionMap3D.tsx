import React, { useMemo, useState, useEffect } from 'react';
import type { Mesh } from 'three';
import * as THREE from 'three';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Sky, ContactShadows } from '@react-three/drei';
// Side-effect imports: reference systems attach to window.* and expect global THREE
import '../assets/ref_3d_map/mountain-system.js';
import '../assets/ref_3d_map/integration-helper.js';
import '../assets/ref_3d_map/tree-system.js';
import '../assets/ref_3d_map/water-isometric.js';
import '../assets/ref_3d_map/hills-system.js';
import '../assets/ref_3d_map/desert-system.js';

// Types
type TileType = 'water' | 'desert' | 'plains' | 'forest' | 'jungle' | 'hills' | 'mountain';
type ResourceType = 'ore' | 'energy' | 'bio' | null;
interface Axial { q: number; r: number; }
type TerrainChar = 'P' | 'F' | 'J' | 'H' | 'D' | 'O' | 'R' | 'M' | 'L' | 'N' | 'V';
interface Tile extends Axial { type: TileType; resource: ResourceType; char: TerrainChar; }
interface Actor { id: string; pos: Axial; vision: number; kind: 'actor' | 'pet'; }
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
  { key: 'water',    ratio: 0.09, minSeeds: 8,  maxSeeds: 18, chars: ['L','N','V'], growthProb: 0.55 },
  { key: 'desert',   ratio: 0.11, minSeeds: 10, maxSeeds: 20, chars: ['D'],        growthProb: 0.60 },
  { key: 'forest',   ratio: 0.14, minSeeds: 12, maxSeeds: 24, chars: ['F'],        growthProb: 0.62 },
  { key: 'jungle',   ratio: 0.07, minSeeds: 6,  maxSeeds: 14, chars: ['J'],        growthProb: 0.58 },
  { key: 'hills',    ratio: 0.11, minSeeds: 10, maxSeeds: 22, chars: ['H'],        growthProb: 0.57 },
  { key: 'mountain', ratio: 0.08, minSeeds: 8,  maxSeeds: 16, chars: ['O','R','M'],growthProb: 0.50 },
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
  for (const cfg of biomeConfigs) {
    const target = Math.max(1, Math.floor(total * cfg.ratio));
    targetByBiome.set(cfg.key, target);
    claimedByBiome.set(cfg.key, 0);
    frontierByBiome.set(cfg.key, []);
    // Number of seeds scaled loosely to sqrt of target for reasonable region sizes
    const seedCount = Math.min(cfg.maxSeeds, Math.max(cfg.minSeeds, Math.floor(Math.sqrt(target) * 0.9)));
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

  return tiles;
}

// Assign resources based on terrain
// Placeholder: resources disabled for flat prototype
function assignResources(tiles: Tile[]) { for (const t of tiles) t.resource = null; }

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
    // Mountains block line-of-sight
    if (curTile.type === 'mountain') continue;
    // Mark visible
    visible.add(posKey);
    if (rem <= 0) continue;
    for (const n of axialNeighbors(pos)) {
      const nKey = keyOf(n);
      const nTile = byKey.get(nKey);
      if (!nTile) continue;
      if (nTile.type === 'mountain') continue; // cannot see through
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

function tileColor(t: Tile) {
  if (t.type === 'water') return '#87d5ff';
  if (t.type === 'desert') return '#f7d08a';
  if (t.type === 'plains') return '#a7e39b';
  if (t.type === 'forest') return '#59b96b';
  if (t.type === 'jungle') return '#2a7f49';
  if (t.type === 'hills') return '#c9c6c0';
  if (t.type === 'mountain') return '#9aa3a7';
  return '#c9c6c0';
}

// All tiles same low height for flat prototype
function heightFor(_t: Tile) { return 0.4; }

function ResourceIcon({ t, size }: { t: Tile; size: number }) {
  const label = t.resource === 'ore' ? '⬢' : t.resource === 'energy' ? '⚡' : t.resource === 'bio' ? '🍃' : '';
  if (!label) return null;
  // Local positioning: parent tile group already placed in world space
  return (
    <Text position={[0, heightFor(t) + 2.2, 0]} fontSize={1.2} color="#374151" anchorX="center" anchorY="middle">{label}</Text>
  );
}

function TreeCluster({ size, seed = 1 }: { size: number; seed?: number }) {
  const rng = useMemo(() => seededRand(seed), [seed]);
  const trees = useMemo(() => {
    const count = 3 + Math.floor(rng() * 5); // 3-7 trees
    const arr: Array<{ x: number; z: number; s: number; h: number }> = [];
    for (let i = 0; i < count; i++) {
      const ang = rng() * Math.PI * 2;
      const rad = (0.2 + rng() * 0.6) * size * 0.9; // stay inside hex footprint
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      const s = 0.7 + rng() * 0.6;
      const h = 1.2 + rng() * 0.7;
      arr.push({ x, z, s, h });
    }
    return arr;
  }, [rng, size]);
  return (
    <group>
      {trees.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]}>
          <mesh position={[0, 0.3 * t.s, 0]} castShadow>
            <cylinderGeometry args={[size * 0.08 * t.s, size * 0.1 * t.s, 0.5 * t.s, 6]} />
            <meshStandardMaterial color="#8b5a3c" roughness={0.9} metalness={0.0} />
          </mesh>
          <mesh position={[0, 0.7 * t.h, 0]} castShadow>
            <coneGeometry args={[size * 0.35 * t.s, t.h, 7]} />
            <meshStandardMaterial color="#4aa05c" roughness={0.7} metalness={0.0} />
          </mesh>
        </group>
      ))}
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
      {rocks.map((r,i)=> (
        <mesh key={i} position={[r.x, 0.4*r.s, r.z]} castShadow>
          <icosahedronGeometry args={[size * 0.18 * r.s, 0]} />
          <meshStandardMaterial color="#bfbcb6" roughness={0.9} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}

function MountainDeco({ size, seed=1 }: { size: number; seed?: number }) {
  const rng = useMemo(()=>seededRand(seed),[seed]);
  const peakScale = 0.6 + rng()*0.5;
  return (
    <group>
      <mesh position={[0, 1.2*peakScale, 0]} castShadow>
        <coneGeometry args={[size * (0.55), 2.4*peakScale, 6]} />
        <meshStandardMaterial color="#9aa3a7" roughness={0.85} metalness={0.03} />
      </mesh>
      <mesh position={[-size*0.35, 0.7, size*0.2]} castShadow>
        <coneGeometry args={[size * 0.3, 1.2, 6]} />
        <meshStandardMaterial color="#8f989c" roughness={0.85} metalness={0.03} />
      </mesh>
      <mesh position={[size*0.4, 0.6, -size*0.25]} castShadow>
        <coneGeometry args={[size * 0.28, 1.0, 6]} />
        <meshStandardMaterial color="#8f989c" roughness={0.85} metalness={0.03} />
      </mesh>
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
    onReady?.({ mountain: hasMountain, tree: hasTree, water: hasWater, hills: hasHills, desert: hasDesert });
    return () => {
      if ((window as any).threeScene === scene) {
        (window as any).threeScene = undefined;
      }
    };
  }, [scene, onReady]);
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

export default function SoloMissionMap3D() {
  // Reduced temporary size: 96 x 144 rectangle (performance tuning phase)
  const GRID_W = 96;
  const GRID_H = 144;
  const hexSize = 1.0; // smaller size to fit large grid visually
  const tiles = useMemo(() => {
    const t = generateTerrainMapRect(GRID_W, GRID_H, 1337);
    assignResources(t);
    return t;
  }, []);
  // Demo actors (player + pet) with different vision ranges
  const [hero, setHero] = useState<Actor>({ id: 'hero', pos: { q: 0, r: 0 }, vision: 6, kind: 'actor' });
  const [pet, setPet] = useState<Actor>({ id: 'pet', pos: { q: 4, r: -1 }, vision: 3, kind: 'pet' });
  // FOV always on now; removed toggle state

  // Hero will be moved via keyboard commands now (auto path removed)

  // Pet patrol path (independent of hero). Simple loop.
  const petPath = useMemo<Axial[]>(() => {
    return [
      { q: 4, r: -1 }, { q: 6, r: -1 }, { q: 6, r: -3 }, { q: 5, r: -4 }, { q: 3, r: -4 }, { q: 2, r: -2 }
    ];
  }, []);
  const [petPathIdx, setPetPathIdx] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setPetPathIdx(i => (i + 1) % petPath.length);
    }, 2600);
    return () => clearInterval(interval);
  }, [petPath.length]);
  useEffect(() => {
    setPet(p => ({ ...p, pos: petPath[petPathIdx] }));
  }, [petPathIdx, petPath]);

  const heroVisible = useMemo(() => computeVisibleSet(tiles, hero.pos, hero.vision), [tiles, hero]);
  const petVisible = useMemo(() => computeVisibleSet(tiles, pet.pos, pet.vision), [tiles, pet]);
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
    return { minX: minX - m, maxX: maxX + m, minZ: minZ - m, maxZ: maxZ + m };
  }, [tiles, hexSize]);
  // Precompute indices for quick adjacency/zones
  const tilesByKey = useMemo(() => {
    const m = new Map<string, Tile>();
    for (const t of tiles) m.set(`${t.q},${t.r}`, t);
    return m;
  }, [tiles]);
  // FoV visibility with attenuation; always include spawn tile and its ring for initial context
  // discovered set & objectives removed for simplified prototype
  const [hover, setHover] = useState<Tile | null>(null);
  const [refMountains, setRefMountains] = useState(false);
  const [refTrees, setRefTrees] = useState(false);
  const [refWater, setRefWater] = useState(false);
  const [refHills, setRefHills] = useState(false);
  const [refDesert, setRefDesert] = useState(false);

  // Enemy spawn zones: near deserts or mountain passes (tiles adjacent to >=2 mountains) and on open ground
  // enemy spawn / patrol hints removed pending gameplay implementation

  function tileKey(t: Axial) { return `${t.q},${t.r}`; }
  // Char-based rules closer to legacy
  function passable(t: Tile | undefined) {
    // Movement limit removed: any existing tile is passable
    return !!t;
  }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      const dirMap: Record<string, Axial> = {
        // Using common WASD+QE for 6 hex directions (flat-top axial q,r)
        w: { q: 0, r: -1 },
        s: { q: 0, r: 1 },
        q: { q: -1, r: 0 },
        e: { q: 1, r: 0 },
        a: { q: -1, r: 1 },
        d: { q: 1, r: -1 },
      };
      const delta = dirMap[k];
      if (!delta) return;
      e.preventDefault();
      setHero(h => {
        const target = { q: h.pos.q + delta.q, r: h.pos.r + delta.r };
        const tile = tilesByKey.get(`${target.q},${target.r}`);
        if (!passable(tile)) return h;
        return { ...h, pos: target };
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tilesByKey]);
  // endTurn logic removed (turn system disabled)

  // Keyboard hex movement (pointy axial layout with q,r; adapt to 6 neighbors)
  // Keyboard disabled for now

  return (
    <div className="relative w-screen h-screen bg-[#c9efff] text-gray-900 overflow-hidden">
      {/* Hover HUD overlay */}
      <div className="absolute top-2 left-2 z-10 text-xs grid grid-cols-4 gap-2 max-w-[90vw]">
        <div className="rounded border border-white/60 bg-white/70 px-2 py-1 text-gray-800">Hover Tile: {hover ? `${hover.q},${hover.r}` : '---'}</div>
        <div className="rounded border border-white/60 bg-white/70 px-2 py-1 text-gray-800">Tile: {hover ? hover.type : '--'} | Resource: {hover?.resource ?? 'None'}</div>
  <div className="rounded border border-white/60 bg-white/70 px-2 py-1 text-gray-800">Moves: disabled</div>
  <div className="rounded border border-white/60 bg-white/70 px-2 py-1 text-gray-800 text-right">Map: 96x144</div>
  {/* FOV toggle removed (always on) */}
  <div className="rounded border border-white/60 bg-white/70 px-2 py-1 text-gray-800 col-span-4 flex gap-2">
    <span className="inline-flex items-center gap-1"><span className="w-3 h-3 inline-block bg-yellow-300/70" /> Hero FOV</span>
    <span className="inline-flex items-center gap-1"><span className="w-3 h-3 inline-block bg-sky-400/70" /> Pet FOV</span>
    <span className="inline-flex items-center gap-1"><span className="w-3 h-3 inline-block bg-fuchsia-400/70" /> Both</span>
  </div>
      </div>
      <div className="absolute inset-0 select-none">
        <Canvas shadows camera={{ position: [14, 16, 14], fov: 45 }}>
  <MapCameraController bounds={mapBounds} gameMode={true} />
              <SceneBridge outerRadius={hexSize} onReady={(caps) => { setRefMountains(!!caps.mountain); setRefTrees(!!caps.tree); setRefWater(!!caps.water); setRefHills(!!caps.hills); setRefDesert(!!caps.desert); }} />
              <Sky inclination={0.6} azimuth={0.25} sunPosition={[50, 50, 10]} turbidity={2} rayleigh={0.7} mieCoefficient={0.005} mieDirectionalG={0.8} />
              <hemisphereLight args={["#bde0fe", "#e6f3ff", 0.8]} />
              <directionalLight position={[30, 40, 15]} intensity={0.7} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
              <group position={[0, 0, 0]}>
                {tiles.map((t) => {
                  const { x, z } = axialToWorld(t, hexSize);
                  const key = `${t.q},${t.r}`;
                  const inHero = heroVisible.has(key);
                  const inPet = petVisible.has(key);
                  let overlayColor: string | null = null;
                  // Always show FOV overlays
                  if (inHero && inPet) overlayColor = '#d946efAA'; // both -> fuchsia
                  else if (inHero) overlayColor = '#fde047AA'; // hero -> yellow
                  else if (inPet) overlayColor = '#38bdf8AA'; // pet -> sky
                  return (
                    <group key={key} position={[x, 0, z]}>
                      <HexTile t={t} size={hexSize} onClick={()=>{}} onHover={setHover} />
                      {overlayColor && (
                        <mesh rotation={[0, Math.PI/6, 0]} position={[0, heightFor(t)+0.01, 0]}
                          renderOrder={10}>
                          <cylinderGeometry args={[hexSize*0.98, hexSize*0.98, 0.02, 6]} />
                          <meshBasicMaterial color={overlayColor} transparent opacity={0.6} depthWrite={false} />
                        </mesh>
                      )}
                    </group>
                  );
                })}
                {/* Actor markers */}
                {[hero, pet].map(a => {
                  const world = axialToWorld(a.pos, hexSize);
                  return (
                    <group key={a.id} position={[world.x, 0, world.z]}>
                      <mesh position={[0, 0.5, 0]} castShadow>
                        <sphereGeometry args={[0.4, 12, 12]} />
                        <meshStandardMaterial color={a.kind === 'actor' ? '#facc15' : '#0ea5e9'} emissive={a.kind === 'actor' ? '#ca8a04' : '#0369a1'} emissiveIntensity={0.6} />
                      </mesh>
                      <Text position={[0, 1.2, 0]} fontSize={0.6} color="#111" anchorX="center" anchorY="middle">{a.kind === 'actor' ? 'Hero' : 'Pet'}</Text>
                    </group>
                  );
                })}
              </group>
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
                <planeGeometry args={[220, 220]} />
                <meshStandardMaterial color="#bff0ff" />
              </mesh>
              <ContactShadows position={[0, 0, 0]} opacity={0.15} blur={1.5} far={15} />
              {/* OrbitControls removed in favor of custom edge + drag panning controller */}
            </Canvas>
      </div>
    </div>
  );
}

// Custom camera controller: edge pan & drag (game mode) with optional follow axial coord
function MapCameraController({ bounds, gameMode }: { bounds: { minX: number; maxX: number; minZ: number; maxZ: number }; gameMode: boolean }) {
  const { camera, gl } = useThree();
  const targetRef = React.useRef(new THREE.Vector3(0, 0, 0));
  const offsetRef = React.useRef<THREE.Vector3 | null>(null); // camera.position - target
  const edgeRef = React.useRef({ dx: 0, dy: 0 });
  const dragging = React.useRef(false);
  const altDragging = React.useRef(false); // middle/right
  const lastMouse = React.useRef({ x: 0, y: 0 });
  const threshold = 24; // px edge region
  const baseSpeed = 70; // reduced speed (50%) for gentler edge pan
  // Keyboard panning disabled (camera fixed except mouse drag / edge)
  const velocity = React.useRef(new THREE.Vector3()); // world-space velocity applied to target
  const lastMoveFrame = React.useRef(0);
  const frameCount = React.useRef(0);
  // Dynamic zoom limits: prevent zooming out beyond map canvas
  const mapWidth = bounds.maxX - bounds.minX;
  const mapHeight = bounds.maxZ - bounds.minZ;
  const mapDiag = Math.sqrt(mapWidth * mapWidth + mapHeight * mapHeight);
  // Allow at most a fraction of diagonal to keep scene framed; keep previous hard cap as safety
  const dynamicMax = Math.min(mapDiag * 0.55, 110);
  const zoomConfig = { min: 12, max: dynamicMax, zoomSpeed: 0.12 };

  // Initialize offset
  React.useEffect(() => {
    if (!offsetRef.current) {
      offsetRef.current = camera.position.clone().sub(targetRef.current);
    }
  }, [camera]);

  // Event handlers
  React.useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!gameMode) return;
      if (dragging.current || altDragging.current) {
        // Drag pan
        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        if (offsetRef.current) {
          // Compute forward/right on XZ plane from offset
          const off = offsetRef.current;
          const forward = new THREE.Vector3(-off.x, 0, -off.z).normalize();
          const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0,1,0)).normalize();
          const pixelScale = 0.04 * off.length() / 45; // faster drag scaling
          const move = new THREE.Vector3();
          // Mouse drag: moving mouse right should move camera right (so world target left)
          move.addScaledVector(right, -dx * pixelScale);
          // Mouse moving down should move camera forward (so target backward)
          move.addScaledVector(forward, dy * pixelScale);
          targetRef.current.add(move);
          clampTarget();
        }
        return; // ignore edge pan while dragging
      }
      // Edge pan detection
      const w = window.innerWidth;
      const h = window.innerHeight;
      let dxEdge = 0, dyEdge = 0;
      if (e.clientX < threshold) dxEdge = - (1 - e.clientX / threshold);
      else if (e.clientX > w - threshold) dxEdge = (1 - (w - e.clientX) / threshold);
      if (e.clientY < threshold) dyEdge = 1 - e.clientY / threshold; // move forward (upwards on screen)
      else if (e.clientY > h - threshold) dyEdge = - (1 - (h - e.clientY) / threshold);
      edgeRef.current.dx = dxEdge;
      edgeRef.current.dy = dyEdge;
    }
    function onMouseDown(e: MouseEvent) {
      if (!gameMode) return;
      if (e.button === 0) dragging.current = true; // left
      else if (e.button === 1 || e.button === 2) altDragging.current = true; // mid/right
      lastMouse.current = { x: e.clientX, y: e.clientY };
      // Suspend edge motion while dragging
      edgeRef.current.dx = 0; edgeRef.current.dy = 0;
    }
    function onMouseUp(e: MouseEvent) { if (e.button === 0) dragging.current = false; if (e.button === 1 || e.button === 2) altDragging.current = false; }
    function onLeave() { if (!dragging.current && !altDragging.current) { edgeRef.current.dx = 0; edgeRef.current.dy = 0; } }
    function onWheel(e: WheelEvent) {
      if (!gameMode) return;
      if (!offsetRef.current) return;
      e.preventDefault();
      const off = offsetRef.current;
      const len = off.length();
      const delta = e.deltaY * zoomConfig.zoomSpeed * (len/60);
  const next = THREE.MathUtils.clamp(len + delta, zoomConfig.min, zoomConfig.max);
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
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mouseleave', onLeave);
    window.addEventListener('wheel', onWheel, { passive: false });
  // Keyboard listeners removed (fixed camera)
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('wheel', onWheel as any);
    };
  }, [gameMode]);

  function clampTarget() {
    const t = targetRef.current;
    t.x = Math.min(bounds.maxX, Math.max(bounds.minX, t.x));
    t.z = Math.min(bounds.maxZ, Math.max(bounds.minZ, t.z));
  }

  useFrame((_, delta) => {
    if (!gameMode) return;
    if (!offsetRef.current) return;
    const off = offsetRef.current;
    // Follow mode removed; camera target only changes via edge/drag inertia
    // Edge panning
    const { dx, dy } = edgeRef.current;
    let appliedAny = false;
  if (!dragging.current && (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001)) {
      const forward = new THREE.Vector3(-off.x, 0, -off.z).normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0,1,0)).normalize();
      const move = new THREE.Vector3();
      move.addScaledVector(right, dx * baseSpeed * delta);
      move.addScaledVector(forward, dy * baseSpeed * delta);
      targetRef.current.add(move);
      velocity.current.copy(move.clone().divideScalar(delta)); // record instantaneous velocity
      appliedAny = true;
      clampTarget();
    }
    // Keyboard panning
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
