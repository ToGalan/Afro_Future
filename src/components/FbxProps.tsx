/**
 * FbxProps — loader + placement component for the low-poly FBX asset packs under
 * /public/assets (military set + SimpleNature set). Each model is fetched once
 * (useLoader cache), re-textured with its pack's atlas, normalized to a unit
 * bounding box sitting on y=0, and cloned per placement (clones share geometry).
 *
 * Every usage must sit under a <Suspense> boundary — useLoader suspends until the
 * FBX and atlas texture arrive.
 */
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export const NATURE_TEX = '/assets/nature/SimpleNature_Texture_01.png';
export const MILITARY_TEX = '/assets/military/Textures1.png';

export const NATURE_ASSETS = {
  trees: ['/assets/nature/Tree_01.fbx', '/assets/nature/Tree_02.fbx', '/assets/nature/Tree_03.fbx', '/assets/nature/Tree_04.fbx', '/assets/nature/Tree_05.fbx'],
  bushes: ['/assets/nature/Bush_01.fbx', '/assets/nature/Bush_02.fbx', '/assets/nature/Bush_03.fbx'],
  rocks: ['/assets/nature/Rock_01.fbx', '/assets/nature/Rock_02.fbx', '/assets/nature/Rock_03.fbx', '/assets/nature/Rock_04.fbx', '/assets/nature/Rock_05.fbx'],
  flowers: ['/assets/nature/Flowers_01.fbx', '/assets/nature/Flowers_02.fbx'],
  stump: '/assets/nature/Stump_01.fbx',
} as const;

export const MILITARY_ASSETS = {
  tower: '/assets/military/Tower_003.fbx',
  tents: ['/assets/military/Tent_002.fbx', '/assets/military/Tent_010.fbx'],
  barriers: ['/assets/military/Barrier_004.fbx', '/assets/military/Barrier_008.fbx'],
  hedgehog: '/assets/military/Hedgehog_001.fbx',
  barrel: '/assets/military/Barrel_005.fbx',
  boxes: ['/assets/military/Box_003.fbx', '/assets/military/Box_022.fbx'],
  generator: '/assets/military/Generator_004.fbx',
  radio: '/assets/military/Radiostation_001.fbx',
  tires: '/assets/military/Tires_001.fbx',
  cacti: ['/assets/military/Cactus_001.fbx', '/assets/military/Cactus_002.fbx'],
} as const;

// One material per (atlas, tint) — clones share it, keeping draw state minimal.
const matCache = new Map<string, THREE.MeshStandardMaterial>();
function atlasMat(map: THREE.Texture, tint?: string) {
  const key = `${map.uuid}:${tint ?? ''}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0.05 });
    if (tint) m.color.set(tint);
    matCache.set(key, m);
  }
  return m;
}

export function FbxProp({ url, tex, size = 1, y = 0, rotation = 0, tint }: {
  url: string;
  tex: string;
  /** World-units height/footprint of the normalized model (max dimension). */
  size?: number;
  y?: number;
  rotation?: number;
  /** Optional colour multiplier over the atlas (e.g. hostile-camp tents). */
  tint?: string;
}) {
  const fbx = useLoader(FBXLoader, url);
  const map = useLoader(THREE.TextureLoader, tex);
  const model = useMemo(() => {
    map.colorSpace = THREE.SRGBColorSpace;
    const clone = fbx.clone(true);
    const mat = atlasMat(map, tint);
    clone.traverse(o => {
      const m = o as THREE.Mesh;
      if ((m as any).isMesh) { m.material = mat; m.castShadow = true; m.receiveShadow = true; }
    });
    // Normalize: max dimension → 1 world unit, base resting on y=0.
    const box = new THREE.Box3().setFromObject(clone);
    const sz = new THREE.Vector3(); box.getSize(sz);
    const s = 1 / (Math.max(sz.x, sz.y, sz.z) || 1);
    clone.scale.setScalar(s);
    clone.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
    return clone;
  }, [fbx, map, tint]);
  return (
    <group position={[0, y, 0]} rotation={[0, rotation, 0]} scale={size}>
      <primitive object={model} />
    </group>
  );
}
