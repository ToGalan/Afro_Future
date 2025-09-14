import React, { Suspense, useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { AvatarPartsLoader, BaseBody } from './AvatarPartsLoader';
import { AvatarAnimator } from './AvatarAnimator';
import * as THREE from 'three';

// Central token mapping: each color channel -> array of material name substrings to match
// To extend: add new channel key (e.g. "emissive") and update AvatarSceneProps.colors + tintHierarchy logic.
const MATERIAL_TOKENS: Record<string,string[]> = {
  skin: ['skin'],
  primary: ['primary','fabric','cloth','armor'],
  secondary: ['secondary','trim','detail','accent'],
};

// Internal debug flag (overridden by prop each render)
let TINT_DEBUG = false;

export interface AvatarSceneProps {
  parts?: Record<string,string|undefined>;
  colors?: { primary:string; secondary:string; skin:string };
  debugTint?: boolean;
  animPaused?: boolean;
  animSpeed?: number;
}

function IdlePivot({ children }: { children: React.ReactNode }) {
  const ref = useRef<any>();
  useFrame((_s, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.15;
  });
  return <group ref={ref}>{children}</group>;
}

// Walk the hierarchy and recolor materials that contain token substrings.
// Materials are cloned once (flag userData.__tinted) to avoid mutating shared references from cached GLTFs.
function tintHierarchy(root: THREE.Object3D, colors: { primary:string; secondary:string; skin:string }) {
  const applied: { name:string; channel:string }[] = [];
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh & { material?: any };
    if (!mesh.material) return;
    const mats: THREE.Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m:any) => {
      if (!m || !m.color) return;
      // Guard: clone once so we do not recolor shared materials across parts
      if (!m.userData.__tinted) {
        m = m.clone();
        m.userData.__tinted = true;
        // reassign back to mesh if single material
        if (!Array.isArray(mesh.material)) {
          (mesh as any).material = m;
        }
      }
      const name = (m.name || '').toLowerCase();
      let channel: string | null = null;
      for (const key of Object.keys(MATERIAL_TOKENS)) {
        if (MATERIAL_TOKENS[key].some(tok => name.includes(tok))) { channel = key; break; }
      }
      if (channel) {
        const value = (colors as any)[channel];
        if (value) { m.color.set(value); applied.push({ name: m.name || '(unnamed)', channel }); }
      }
    });
  });
  if (TINT_DEBUG && applied.length) {
    // eslint-disable-next-line no-console
    console.log('[Tint] Applied', applied.length, 'materials', applied);
  }
}

export function AvatarScene({ parts, colors, debugTint, animPaused, animSpeed }: AvatarSceneProps) {
  const rootRef = useRef<THREE.Group>(null);
  // Apply tint whenever colors change or new children mount
  useEffect(() => {
    if (rootRef.current && colors) {
      TINT_DEBUG = !!debugTint;
      tintHierarchy(rootRef.current, colors);
    }
  }, [colors, parts, debugTint]);

  return (
    <Canvas shadows camera={{ position: [2.1, 1.5, 2.6], fov: 35 }} dpr={[1, 1.75]}>
      <color attach="background" args={["#12171f"]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5,5,5]} intensity={1.1} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <Suspense fallback={null}>
        <IdlePivot>
          <group ref={rootRef} position={[0,0,0]}>
            <AvatarAnimator paused={animPaused} speed={animSpeed}>
              <group>
                <BaseBody />
                <AvatarPartsLoader parts={parts} />
              </group>
            </AvatarAnimator>
          </group>
        </IdlePivot>
        <Environment preset="city" />
      </Suspense>
      <OrbitControls enablePan={false} minDistance={2} maxDistance={4} target={[0,0.9,0]} />
    </Canvas>
  );
}

export default AvatarScene;
