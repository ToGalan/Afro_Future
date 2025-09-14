import React, { Suspense, useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { AvatarPartsLoader, BaseBody } from './AvatarPartsLoader';
import { AvatarAnimator } from './AvatarAnimator';
import * as THREE from 'three';
import { useCreatorStore } from '../store/creatorStore';

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
  // colors prop deprecated; kept optional for backward compatibility, but store drives actual tint now
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
function applyStoreTint(root: THREE.Object3D, store: { groupColors: Record<string,string|undefined>; skinMaterial: THREE.MeshStandardMaterial; }, fallback?: { primary:string; secondary:string; skin:string }) {
  const applied: { name:string; via:string; color?: string }[] = [];
  const { groupColors, skinMaterial } = store;
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh & { material?: any };
    if (!mesh.material) return;
    const mats: THREE.Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((orig:any, idx:number) => {
      if (!orig) return;
      // Shared skin substitution: if name includes Skin_ we replace with central skinMaterial instance
      const lowerName = (orig.name || '').toLowerCase();
      if (lowerName.includes('skin_') || lowerName === 'skin') {
        // assign shared instance
        if (Array.isArray(mesh.material)) {
          (mesh.material as any)[idx] = skinMaterial;
        } else {
          (mesh as any).material = skinMaterial;
        }
        applied.push({ name: orig.name || '(skin)', via: 'shared-skin' });
        return;
      }
      // Only proceed if material has a color field
      if (!orig.color) return;
      let m = orig;
      if (!m.userData.__tinted) {
        m = m.clone();
        m.userData.__tinted = true;
        if (Array.isArray(mesh.material)) {
          (mesh.material as any)[idx] = m;
        } else {
          (mesh as any).material = m;
        }
      }
      // Determine group from userData tag
      const partGroup = (mesh as any).userData?.partGroup || (obj as any).userData?.partGroup;
      // Color priority: explicit groupColors[group] if material name contains Color_ token; else fallback heuristic tokens
      let targetColor: string | undefined;
      if (lowerName.includes('color_') && partGroup && groupColors[partGroup]) {
        targetColor = groupColors[partGroup];
      } else {
        // heuristic existing token mapping (primary/secondary)
        for (const key of Object.keys(MATERIAL_TOKENS)) {
          if (MATERIAL_TOKENS[key].some(tok => lowerName.includes(tok))) {
            targetColor = (fallback as any)?.[key];
            break;
          }
        }
      }
      if (targetColor) {
        m.color.set(targetColor);
        applied.push({ name: m.name || '(unnamed)', via: partGroup ? `group:${partGroup}` : 'fallback-token', color: targetColor });
      }
    });
  });
  if (TINT_DEBUG && applied.length) {
    // eslint-disable-next-line no-console
    console.log('[Tint] Applied', applied.length, 'updates', applied);
  }
}

export function AvatarScene({ parts, colors, debugTint, animPaused, animSpeed }: AvatarSceneProps) {
  const rootRef = useRef<THREE.Group>(null);
  const groupColors = useCreatorStore(s => s.groupColors);
  const skinMaterial = useCreatorStore(s => s.skinMaterial);
  // Re-apply tint when parts mount, group colors change, or skin color changes
  useEffect(() => {
    if (rootRef.current) {
      TINT_DEBUG = !!debugTint;
      applyStoreTint(rootRef.current, { groupColors, skinMaterial }, colors);
    }
  }, [parts, groupColors, skinMaterial, colors, debugTint]);

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
