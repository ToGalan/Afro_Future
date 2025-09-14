import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

/** Lightweight 3D thumbnail preview for a single variant GLB.
 * Performance considerations:
 * - frameloop='demand' so it only renders on load.
 * - Low DPR (0.8) to keep it cheap.
 * - No shadows / post effects.
 * - Single ambient + directional for subtle depth.
 */
export function VariantPreview({ file }: { file: string }) {
  const path = `/assets/3d/${file}`;
  return (
    <div className="absolute inset-0">
      <Canvas shadows={false} dpr={0.8} frameloop="demand" camera={{ position: [0.8, 0.8, 0.8], fov: 35 }}>
        <ambientLight intensity={0.9} />
        <directionalLight position={[1,2,2]} intensity={0.6} />
        <Suspense fallback={null}>
          <FitModel url={path} />
        </Suspense>
      </Canvas>
    </div>
  );
}

function FitModel({ url }: { url: string }) {
  const group = useRef<THREE.Group>(null);
  const { scene } = useGLTF(url) as any;
  const clone = useMemo(()=>scene.clone(true), [scene]);
  const { invalidate } = useThree();

  // Fit & center once
  useEffect(() => {
    if (!group.current) return;
    // Compute bounding box
    const bbox = new THREE.Box3().setFromObject(group.current);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    group.current.position.sub(center); // center it
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0 ? 1.2 / maxDim : 1;
    group.current.scale.setScalar(scale);
    invalidate();
  }, [clone, invalidate]);

  return <group ref={group}>{<primitive object={clone} />}</group>;
}

useGLTF.preload('/assets/3d/Hair.001.glb');
// (Optional) Could add more preloads dynamically if needed.

export default VariantPreview;