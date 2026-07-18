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
import { useLoader, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

// Plain Object3D.clone() does NOT correctly clone rigged/skinned meshes — a
// SkinnedMesh's skeleton.bones array keeps pointing at the ORIGINAL (un-cloned) bone
// objects, which collapses the mesh to nothing visible. SkeletonUtils clone() fixes up
// bone references for skinned models and works fine for plain static meshes too, so use
// it everywhere instead of .clone(true).
function cloneFbx<T extends THREE.Object3D>(obj: T): T { return cloneSkeleton(obj) as T; }

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

// Single-prop packs exported with a full PBR map set (diffuse/normal/roughness/metallic)
// instead of a shared atlas — one prop per folder, see FbxPbrProp below.
export const PBR_PROP_ASSETS = {
  carpet: '/assets/props/carpet/base.fbx',
  tentYellow: '/assets/props/tent_yellow/base.fbx',
  campfire: '/assets/props/campfire/base.fbx',
  crateXBrace: '/assets/props/crate_xbrace/base.fbx',
} as const;
function pbrTex(folder: 'carpet' | 'tent_yellow' | 'campfire' | 'crate_xbrace') {
  const base = `/assets/props/${folder}`;
  return {
    diffuse: `${base}/texture_diffuse.png`,
    normal: `${base}/texture_normal.png`,
    roughness: `${base}/texture_roughness.png`,
    metallic: `${base}/texture_metallic.png`,
  };
}
export const PBR_PROP_TEX = {
  carpet: pbrTex('carpet'),
  tentYellow: pbrTex('tent_yellow'),
  campfire: pbrTex('campfire'),
  crateXBrace: pbrTex('crate_xbrace'),
} as const;

// Single-mesh props with their own small atlas (mushroom) — same shape as NATURE/MILITARY
// but one-offs, so kept separate.
export const MUSHROOM_TEX = '/assets/props/mushroom/PP_Texture_256.png';
export const MUSHROOM_ASSET = '/assets/props/mushroom/PP_fly_agaric.fbx';

// PP_FreeMiningPack — vertex-colored FBX props (no texture atlas at all), rendered with
// their OWN embedded materials via FbxRawProp below.
export const MINING_ASSETS = {
  rockMoss: '/assets/props/mining/PP_Rock_Moss_04.fbx',
  crystalRed: '/assets/props/mining/PP_Crystal_Cluster_02_Red.fbx',
  gemGreen: '/assets/props/mining/PP_Gemstone_05_Green.fbx',
  gemGold: '/assets/props/mining/PP_Gemstone_07_Gold.fbx',
  gemCopper: '/assets/props/mining/PP_Gemstone_07_Copper.fbx',
  gemRed: '/assets/props/mining/PP_Gemstone_11_Red.fbx',
  gemBlue: '/assets/props/mining/PP_Gemstone_13_Blue.fbx',
  crateWooden: '/assets/props/mining/PP_Crate_Wooden_03.fbx',
  barrel: '/assets/props/mining/PP_Barrel_03.fbx',
  pickaxe: '/assets/props/mining/PP_Pickaxe_Used_04_Iron.fbx',
  lantern: '/assets/props/mining/PP_Lantern_02_Yellow_Light_Iron.fbx',
} as const;

// Cartoon pet models (also vertex-colored / own-material, rendered via FbxRawProp).
export const PET_ASSETS = {
  dog: '/assets/pets/fbx/SM_CartoonAnimal_Dog.fbx',
  cat: '/assets/pets/fbx/SM_CartoonAnimal_Cat.fbx',
} as const;

// WC-faction civilian NPC ("Peasant Nolant") — rigged with a baked idle/walk
// AnimStack clip (confirmed via binary FBX inspection: Deformer/SkinCluster +
// AnimationCurveNode present) and a single diffuse texture — rendered via
// FbxAnimatedTexturedProp so it actually plays its walk cycle instead of sliding.
export const WC_NPC_ASSET = '/assets/characters/wc_npc/peasant_nolant.fbx';
export const WC_NPC_TEX = '/assets/characters/wc_npc/peasant_nolant_brown.png';

// Creep-camp critters — low-poly wildlife pack, one shared atlas for every animal
// (like NATURE/MILITARY). Each is rigged with its own baked AnimStack clip (confirmed
// via binary FBX inspection). NOTE: the source pack's "Elephant" is only a raw
// `Elephant.blend` (Blender project file, not an exported .fbx) — there's nothing to
// load here until it's exported, so it's omitted; bear is still omitted (not
// Africa-plausible). boar/deer_1/deer_2/fox/hedgehog/owl/rabbit/squirrel/wolf all have
// real .fbx exports and are used.
export const CREEP_TEX = '/assets/creeps/textures/wild_animals_map.png';
export const CREEP_ASSETS = {
  boar: '/assets/creeps/fbx/boar.fbx',
  deer1: '/assets/creeps/fbx/deer_1.fbx',
  deer2: '/assets/creeps/fbx/deer_2.fbx',
  fox: '/assets/creeps/fbx/fox.fbx',
  hedgehog: '/assets/creeps/fbx/hedhog.fbx',
  owl: '/assets/creeps/fbx/owl.fbx',
  rabbit: '/assets/creeps/fbx/rabbit.fbx',
  squirrel: '/assets/creeps/fbx/squirrel.fbx',
  wolf: '/assets/creeps/fbx/wolf.fbx',
} as const;

// Elephant — static (non-rigged, no animations) low-poly glTF (Sketchfab "Low poly
// elephant" by MrEliptik, CC-BY-4.0). Ships as .gltf+.bin with two flat baseColorFactor
// materials, no external texture — loaded via GltfRawProp (drei's useGLTF), not the
// FBX animated/textured pipeline the other creep species use.
export const ELEPHANT_ASSET = '/assets/creeps/gltf/elephant/scene.gltf';

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
    const clone = cloneFbx(fbx);
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

// One material per (diffuse-map uuid) — clones share it.
const pbrMatCache = new Map<string, THREE.MeshStandardMaterial>();

/** Single-mesh prop exported with a full PBR map set (diffuse/normal/roughness/metallic)
 *  instead of a shared atlas — e.g. the rolled carpet, camping tent, campfire, crate. */
export function FbxPbrProp({ url, tex, size = 1, y = 0, rotation = 0 }: {
  url: string;
  tex: { diffuse: string; normal: string; roughness: string; metallic: string };
  size?: number;
  y?: number;
  rotation?: number;
}) {
  const fbx = useLoader(FBXLoader, url);
  const [diffuse, normal, roughness, metallic] = useLoader(THREE.TextureLoader, [tex.diffuse, tex.normal, tex.roughness, tex.metallic]);
  const model = useMemo(() => {
    diffuse.colorSpace = THREE.SRGBColorSpace;
    const key = diffuse.uuid;
    let mat = pbrMatCache.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ map: diffuse, normalMap: normal, roughnessMap: roughness, metalnessMap: metallic, roughness: 1, metalness: 1 });
      pbrMatCache.set(key, mat);
    }
    const clone = cloneFbx(fbx);
    clone.traverse(o => {
      const m = o as THREE.Mesh;
      if ((m as any).isMesh) { m.material = mat!; m.castShadow = true; m.receiveShadow = true; }
    });
    const box = new THREE.Box3().setFromObject(clone);
    const sz = new THREE.Vector3(); box.getSize(sz);
    const s = 1 / (Math.max(sz.x, sz.y, sz.z) || 1);
    clone.scale.setScalar(s);
    clone.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
    return clone;
  }, [fbx, diffuse, normal, roughness, metallic]);
  return (
    <group position={[0, y, 0]} rotation={[0, rotation, 0]} scale={size}>
      <primitive object={model} />
    </group>
  );
}

/** Single-mesh prop with NO external texture — its embedded FBX material (solid
 *  colors/vertex colors baked at export time, common for the low-poly PP_* mining pack
 *  and the cartoon pet models) is kept as-is instead of being overridden. */
/** Single-mesh prop with NO external texture — its embedded FBX material (solid
 *  per-part diffuse colors baked at export time, common for the low-poly PP_* mining
 *  pack and the cartoon pet models) is kept as-is instead of being overridden. Some
 *  packs (e.g. the mining pack) reference a source texture file that isn't bundled
 *  with the project — pass `tint` to strip any such broken map and fall back to a
 *  clean flat color instead of a black/missing-texture look. */
export function FbxRawProp({ url, size = 1, y = 0, rotation = 0, tint }: {
  url: string;
  size?: number;
  y?: number;
  rotation?: number;
  tint?: string;
}) {
  const fbx = useLoader(FBXLoader, url);
  const model = useMemo(() => {
    const clone = cloneFbx(fbx);
    clone.traverse(o => {
      const m = o as THREE.Mesh;
      if ((m as any).isMesh) {
        m.castShadow = true; m.receiveShadow = true;
        if (tint) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mm: any) => { if (mm?.color) { mm.map = null; mm.color.set(tint); } });
        }
      }
    });
    const box = new THREE.Box3().setFromObject(clone);
    const sz = new THREE.Vector3(); box.getSize(sz);
    const s = 1 / (Math.max(sz.x, sz.y, sz.z) || 1);
    clone.scale.setScalar(s);
    clone.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
    return clone;
  }, [fbx, tint]);
  return (
    <group position={[0, y, 0]} rotation={[0, rotation, 0]} scale={size}>
      <primitive object={model} />
    </group>
  );
}

/** Static glTF/glb prop (no rigging/animation) that keeps its own embedded materials —
 *  for packs exported as .gltf+.bin instead of .fbx (e.g. the elephant, which ships
 *  with two flat baseColorFactor materials and no external texture at all). Same
 *  bounding-box-normalize + optional `tint` convention as FbxRawProp, just loaded via
 *  drei's `useGLTF` instead of `useLoader(FBXLoader, ...)`. */
export function GltfRawProp({ url, size = 1, y = 0, rotation = 0, tint }: {
  url: string;
  size?: number;
  y?: number;
  rotation?: number;
  tint?: string;
}) {
  const { scene } = useGLTF(url) as { scene: THREE.Object3D };
  const model = useMemo(() => {
    const clone = cloneFbx(scene);
    clone.traverse(o => {
      const m = o as THREE.Mesh;
      if ((m as any).isMesh) {
        m.castShadow = true; m.receiveShadow = true;
        if (tint) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mm: any) => { if (mm?.color) { mm.map = null; mm.color.set(tint); } });
        }
      }
    });
    const box = new THREE.Box3().setFromObject(clone);
    const sz = new THREE.Vector3(); box.getSize(sz);
    const s = 1 / (Math.max(sz.x, sz.y, sz.z) || 1);
    clone.scale.setScalar(s);
    clone.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
    return clone;
  }, [scene, tint]);
  return (
    <group position={[0, y, 0]} rotation={[0, rotation, 0]} scale={size}>
      <primitive object={model} />
    </group>
  );
}

/** Rigged single-mesh prop that plays its own embedded animation clip (e.g. the
 *  cartoon pet packs, which bake a walk-cycle "Take 001" clip) via an AnimationMixer.
 *  `playing=false` freezes the clip on its current frame (idle pose) instead of
 *  looping — used so pets only "walk" while actually moving. */
export function FbxAnimatedProp({ url, size = 1, y = 0, rotation = 0, playing = true, tint }: {
  url: string;
  size?: number;
  y?: number;
  rotation?: number;
  playing?: boolean;
  /** Fallback flat color — some rigged packs mix Lambert materials with a shading
   *  model FBXLoader can't resolve a diffuse color for, which renders solid black;
   *  pass this to clear any map and force a visible flat color on every submesh. */
  tint?: string;
}) {
  const fbx = useLoader(FBXLoader, url);
  const mixerRef = React.useRef<THREE.AnimationMixer | null>(null);
  const model = useMemo(() => {
    const clone = cloneFbx(fbx);
    clone.traverse(o => {
      const m = o as THREE.Mesh;
      if ((m as any).isMesh) {
        m.castShadow = true; m.receiveShadow = true;
        if (tint) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mm: any) => { if (mm?.color) { mm.map = null; mm.color.set(tint); } });
        }
      }
    });
    const box = new THREE.Box3().setFromObject(clone);
    const sz = new THREE.Vector3(); box.getSize(sz);
    const s = 1 / (Math.max(sz.x, sz.y, sz.z) || 1);
    clone.scale.setScalar(s);
    clone.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
    return clone;
  }, [fbx, tint]);
  React.useEffect(() => {
    if (!fbx.animations?.length) return;
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(fbx.animations[0]).play();
    mixerRef.current = mixer;
    return () => { mixer.stopAllAction(); mixerRef.current = null; };
  }, [model, fbx]);
  useFrame((_, delta) => { mixerRef.current?.update(playing ? delta : 0); });
  return (
    <group position={[0, y, 0]} rotation={[0, rotation, 0]} scale={size}>
      <primitive object={model} />
    </group>
  );
}

/** Rigged single-mesh prop that ALSO needs an external shared-atlas texture (e.g. the
 *  wc_npc peasant and the creeps wildlife pack) — same idea as FbxAnimatedProp, plus
 *  the FbxProp-style atlasMat() texture application instead of embedded materials. */
export function FbxAnimatedTexturedProp({ url, tex, size = 1, y = 0, rotation = 0, playing = true, tint }: {
  url: string;
  tex: string;
  size?: number;
  y?: number;
  rotation?: number;
  playing?: boolean;
  tint?: string;
}) {
  const fbx = useLoader(FBXLoader, url);
  const map = useLoader(THREE.TextureLoader, tex);
  const mixerRef = React.useRef<THREE.AnimationMixer | null>(null);
  const model = useMemo(() => {
    map.colorSpace = THREE.SRGBColorSpace;
    const clone = cloneFbx(fbx);
    const mat = atlasMat(map, tint);
    clone.traverse(o => {
      const m = o as THREE.Mesh;
      if ((m as any).isMesh) { m.material = mat; m.castShadow = true; m.receiveShadow = true; }
    });
    const box = new THREE.Box3().setFromObject(clone);
    const sz = new THREE.Vector3(); box.getSize(sz);
    const s = 1 / (Math.max(sz.x, sz.y, sz.z) || 1);
    clone.scale.setScalar(s);
    clone.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
    return clone;
  }, [fbx, map, tint]);
  React.useEffect(() => {
    if (!fbx.animations?.length) return;
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(fbx.animations[0]).play();
    mixerRef.current = mixer;
    return () => { mixer.stopAllAction(); mixerRef.current = null; };
  }, [model, fbx]);
  useFrame((_, delta) => { mixerRef.current?.update(playing ? delta : 0); });
  return (
    <group position={[0, y, 0]} rotation={[0, rotation, 0]} scale={size}>
      <primitive object={model} />
    </group>
  );
}
