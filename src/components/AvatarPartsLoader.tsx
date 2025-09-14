import React, { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { PART_VARIANTS } from '../assets/threeParts';

interface AvatarPartsLoaderProps {
  parts: Record<string, string | undefined> | undefined;
}

// Returns variant record indexed by id for quick lookup
const variantById = PART_VARIANTS.reduce<Record<string, typeof PART_VARIANTS[number]>>((acc,v)=>{acc[v.id]=v;return acc;},{});

function PartMesh({ file }: { file: string }) {
  // Attempt both src-relative and public served path conventions
  const publicPath = `/assets/3d/${file}`;
  // Load via public path (ensure files served from public/assets/3d/*)
  const { scene } = useGLTF(publicPath) as any;
  return <primitive object={scene.clone()} />;
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
            return <PartMesh key={id} file={v.file} />;
        })}
      </Suspense>
    </group>
  );
}

useGLTF.preload('/assets/3d/NakedFullBody.glb');

export function BaseBody() {
  const { scene } = useGLTF('/assets/3d/NakedFullBody.glb') as any;
  return <primitive object={scene.clone()} position={[0,-1,0]} />;
}
