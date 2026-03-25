/**
 * Tiered 3D asset preloading.
 *
 * Goals:
 * 1. Instant availability for critical base body + idle animation (already partially preloaded elsewhere).
 * 2. Warm cache for most commonly interacted customization groups (Head/Face/Eyes/Hair) shortly after boot.
 * 3. Opportunistic background prefetch for long‑tail cosmetic variants (Hats, Glasses, etc.) when the browser is idle.
 *
 * Approach:
 * - We keep an ordered set of tiers.
 * - schedulePreloads() triggers Tier 1 synchronously (fast handful of files) and then schedules Tier 2 and Tier 3 using
 *   requestIdleCallback (with a timeout fallback) so we don't block initial render or user input.
 * - Uses drei's useGLTF / useFBX .preload which leverages three.js loaders & caching.
 *
 * Extension:
 * - Add or reorder tiers below; ensure file names match those in /public/assets/3d.
 * - Avoid overloading initial network by keeping Tier 1 very small.
 */

import { useGLTF, useFBX } from '@react-three/drei';
import { PART_VARIANTS } from './threeParts';

// Explicit core files (base body & animations)
const CORE_GLTF = [
  'NakedFullBody.glb',
];
const CORE_FBX = [
  'Idle.fbx',
  // 'FullBody.fbx' // Uncomment if/when separate rig file exists
];

// Helper: pick variant filenames for groups
function filesForGroups(groups: string[], limitPerGroup?: number) {
  const out: string[] = [];
  for (const g of groups) {
    const list = PART_VARIANTS.filter(v => v.group === g).map(v => v.file);
    if (limitPerGroup && list.length > limitPerGroup) out.push(...list.slice(0, limitPerGroup)); else out.push(...list);
  }
  return out;
}

// Tier definitions
const TIER_1_GLTF = [
  ...CORE_GLTF,
  ...filesForGroups(['Head','Face','Eyes'], 2), // first 2 of each to keep small
];

const TIER_2_GLTF = [
  ...filesForGroups(['Head','Face','Eyes','Eyebrows','Nose','Hair'], 6), // deeper selection
];

const TIER_3_GLTF = [
  ...filesForGroups(['Hair','Hat','Glasses','Facial Hair','Earrings','Top','Outfit','Bottom','Shoes','Accessory']),
];

// Deduplicate while preserving order
function uniq(list: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of list) { if (!seen.has(f)) { seen.add(f); out.push(f); } }
  return out;
}

const tier1 = uniq(TIER_1_GLTF);
const tier2 = uniq(TIER_2_GLTF.filter(f => !tier1.includes(f)));
const tier3 = uniq(TIER_3_GLTF.filter(f => !tier1.includes(f) && !tier2.includes(f)));

// Preload helpers
function preloadGLTF(file: string) { useGLTF.preload(`/assets/3d/${file}`); }
function preloadFBX(file: string) { useFBX.preload(`/assets/3d/${file}`); }

// Idle callback shim for wider browser support
const ric: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number = (cb, opts) => {
  if (typeof (window as any).requestIdleCallback === 'function') return (window as any).requestIdleCallback(cb, opts);
  return window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as any), opts?.timeout ?? 1);
};

function scheduleBatch(files: string[], kind: 'gltf' | 'fbx', sliceSize = 4, delayBetween = 120) {
  let idx = 0;
  function step() {
    const chunk = files.slice(idx, idx + sliceSize);
    for (const f of chunk) {
      if (kind === 'gltf') preloadGLTF(f); else preloadFBX(f);
    }
    idx += sliceSize;
    if (idx < files.length) setTimeout(() => ric(() => step()), delayBetween);
  }
  ric(() => step());
}

export function schedulePreloads() {
  // Tier 1 immediate (core playable feel)
  for (const f of tier1) preloadGLTF(f);
  for (const f of CORE_FBX) preloadFBX(f);

  // Tier 2 (near‑term customization) after short idle
  ric(() => scheduleBatch(tier2, 'gltf', 5, 160), { timeout: 800 });

  // Tier 3 (long tail) later
  ric(() => scheduleBatch(tier3, 'gltf', 6, 180), { timeout: 2500 });
}

// Optional: expose for manual debugging in dev console
;(window as any).__AF_PRELOAD_INFO__ = { tier1, tier2, tier3, schedulePreloads };
