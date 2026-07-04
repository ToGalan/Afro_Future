import React, { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PART_VARIANTS } from '../assets/threeParts';

interface AvatarPartsLoaderProps {
  parts: Record<string, string | undefined> | undefined;
}

// Returns variant record indexed by id for quick lookup
const variantById = PART_VARIANTS.reduce<Record<string, typeof PART_VARIANTS[number]>>((acc,v)=>{acc[v.id]=v;return acc;},{});

function PartMesh({ file, group }: { file: string; group: string }) {
  const publicPath = `/assets/3d/${file}`;
  const { scene } = useGLTF(publicPath) as any;
  // Memoize clone so the object reference is stable across parent re-renders.
  // Without this, every parent re-render creates a new clone, causing R3F to
  // dispose+remount the mesh every frame — making it invisible continuously.
  const inst = useMemo(() => {
    // SkeletonUtils.clone (NOT scene.clone()) — these parts are skinned meshes.
    // A plain clone keeps referencing the ORIGINAL cached skeleton, so the clone
    // ignores its parent group's transform (renders at the source scale/position).
    // Guarded: a clone failure must not throw and crash the whole avatar Canvas.
    let clone: any;
    try { clone = skeletonClone(scene); }
    catch (e) { console.warn('[AvatarPartsLoader] skeletonClone failed, falling back', e); clone = scene.clone(true); }
    // Clear any baked root transform so the clone renders at parent-relative origin.
    // Also re-enable matrixAutoUpdate on every node — Three.js's GLTFLoader sets it
    // to false for nodes exported with a baked matrix, which prevents world-matrix
    // propagation when the parent group moves (avatar won't follow the player).
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.set(1, 1, 1);
    clone.traverse((obj: any) => {
      obj.matrixAutoUpdate = true;
      obj.matrixWorldAutoUpdate = true;
      obj.updateMatrix();
      if (!obj.userData) obj.userData = {};
      obj.userData.partGroup = group;
    });
    return clone;
  }, [scene, group]);
  // Wrap in a group so R3F controls parenting; primitive only carries mesh geometry
  return (
    <group position={[0, 0, 0]} frustumCulled={false}>
      <primitive object={inst} frustumCulled={false} />
    </group>
  );
}

export function AvatarPartsLoader({ parts }: AvatarPartsLoaderProps) {
  const activeVariants = useMemo(() => {
    if (!parts) {
      console.log('[AvatarPartsLoader] No parts provided, only base body will show');
      return [] as string[];
    }
    const variants = Object.values(parts).filter(Boolean) as string[];
    console.log('[AvatarPartsLoader] Loading parts:', variants);
    return variants;
  }, [parts]);

  return (
    <group>
      <Suspense fallback={null}>
        {activeVariants.map(id => {
          const v = variantById[id];
          if (!v) {
            console.warn('[AvatarPartsLoader] Variant ID not found:', id);
            return null;
          }
          return <PartMesh key={id} file={v.file} group={v.group} />;
        })}
      </Suspense>
    </group>
  );
}

export function BaseBody() {
  const { scene } = useGLTF('/assets/3d/NakedFullBody.glb') as any;
  // Memoize so the cloned object is stable — prevents per-frame dispose/remount
  // when the parent component (AssembledAvatarMesh) re-renders in the game loop.
  const inst = useMemo(() => {
    // SkeletonUtils.clone — BaseBody is a skinned mesh (see PartMesh note above).
    let clone: any;
    try { clone = skeletonClone(scene); }
    catch (e) { console.warn('[BaseBody] skeletonClone failed, falling back', e); clone = scene.clone(true); }
    // Clear baked root transform and re-enable matrixAutoUpdate on entire hierarchy.
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.set(1, 1, 1);
    clone.traverse((obj: any) => {
      obj.matrixAutoUpdate = true;
      obj.matrixWorldAutoUpdate = true;
      obj.updateMatrix();
    });
    return clone;
  }, [scene]);
  return (
    <group position={[0, 0, 0]} frustumCulled={false}>
      <primitive object={inst} frustumCulled={false} />
    </group>
  );
}
