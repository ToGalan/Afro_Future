import React, { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
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
    const clone = scene.clone();
    clone.traverse((obj: any) => {
      if (!obj.userData) obj.userData = {};
      obj.userData.partGroup = group; // tag for downstream tint logic
    });
    return clone;
  }, [scene, group]);
  return <primitive object={inst} frustumCulled={false} />;
}

export function AvatarPartsLoader({ parts }: AvatarPartsLoaderProps) {
  const activeVariants = useMemo(() => {
    if (!parts) return [] as string[];
    return Object.values(parts).filter(Boolean) as string[];
  }, [parts]);

  return (
    <group>
      <Suspense fallback={null}>
        {activeVariants.map(id => {
          const v = variantById[id];
          if (!v) return null;
          return <PartMesh key={id} file={v.file} group={v.group} />;
        })}
      </Suspense>
    </group>
  );
}

// Legacy direct preload kept (harmless). Centralized tiered preloads now in assets/preloadAssets.ts
useGLTF.preload('/assets/3d/NakedFullBody.glb');

export function BaseBody() {
  const { scene } = useGLTF('/assets/3d/NakedFullBody.glb') as any;
  // Memoize so the cloned object is stable — prevents per-frame dispose/remount
  // when the parent component (AssembledAvatarMesh) re-renders in the game loop.
  const inst = useMemo(() => scene.clone(), [scene]);
  return <primitive object={inst} position={[0, 0, 0]} frustumCulled={false} />;
}
