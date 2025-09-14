import React, { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { AvatarPartsLoader, BaseBody } from './AvatarPartsLoader';
import { AvatarAnimator } from './AvatarAnimator';
import * as THREE from 'three';
import { useCreatorStore } from '../store/creatorStore';
import { useWebGLStore } from '../store/webglStore';

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
  rotateSpeed?: number;          // optional override rotation speed (default 0.15)
  disableControls?: boolean;     // hide / disable orbit controls (for tiny embeds)
  cameraPosition?: [number, number, number]; // override camera position
  cameraFov?: number;            // override camera fov
  target?: [number, number, number]; // orbit target override
  modelOffset?: [number, number, number]; // offset applied to root group (for framing in small cards)
  modelScale?: number;           // uniform scale override
  autoFrame?: boolean;           // dynamically fit avatar within camera frustum (ignores manual scale/offset if true)
  frameMargin?: number;          // fraction (0-0.5) vertical margin when autoFrame (default 0.12)
}

function IdlePivot({ children, speed = 0.15 }: { children: React.ReactNode; speed?: number }) {
  const ref = useRef<any>();
  useFrame((_s, dt) => {
    if (ref.current) ref.current.rotation.y += dt * speed;
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

function AutoFrameHelper({ rootRef, enabled, margin, deps, manualOffset }: { rootRef: React.RefObject<THREE.Group>; enabled: boolean; margin: number; deps: any[]; manualOffset: [number,number,number]; }) {
  const { camera } = useThree();
  const [computed, setComputed] = useState<{ scale: number; offset: [number,number,number]; ready: boolean }>({ scale: 1, offset: manualOffset, ready: false });
  useEffect(() => {
    if (!enabled) return;
    if (!rootRef.current) return;
    const attempt = () => {
      const root = rootRef.current!;
      // Compute bounds
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty() || !isFinite(box.min.y) || !isFinite(box.max.y)) {
        // try again shortly (assets may still be streaming)
        requestAnimationFrame(attempt);
        return;
      }
      const size = new THREE.Vector3();
      box.getSize(size);
      const height = size.y || 1;
      // Distance from camera to origin (assumes target near origin); more robust would use provided target
      const dist = camera.position.length();
      const vFov = (camera as any).fov * Math.PI / 180;
      const totalVisibleHeight = 2 * Math.tan(vFov / 2) * dist;
      const allowed = totalVisibleHeight * (1 - margin);
      const scale = allowed / height;
      // Center horizontally, lift so feet sit slightly above bottom (keep small positive to avoid clip)
      const minY = box.min.y;
      const maxY = box.max.y;
      const centerX = (box.min.x + box.max.x) / 2;
      const centerZ = (box.min.z + box.max.z) / 2;
      // We want feet ~ at y = - (allowed/2) + smallPadding after scale because camera looks at mid torso.
      // Simpler: shift so minY becomes -height*scale*0.02 (tiny padding) then apply manualOffset additive.
      const footPad = height * scale * 0.02;
      const yOffset = (-minY * scale) - footPad;
      const offset: [number,number,number] = [(-centerX) * scale + manualOffset[0], yOffset + manualOffset[1], (-centerZ) * scale + manualOffset[2]];
      setComputed({ scale, offset, ready: true });
    };
    // Delay one rAF to ensure suspense content present
    requestAnimationFrame(attempt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, camera, margin, rootRef, ...deps]);
  return <group visible={false} userData={computed} />; // marker; parent AvatarScene will read this state
}

export function AvatarScene({ parts, colors, debugTint, animPaused, animSpeed, rotateSpeed, disableControls, cameraPosition, cameraFov, target, modelOffset, modelScale, autoFrame, frameMargin }: AvatarSceneProps) {
  const rootRef = useRef<THREE.Group>(null);
  const groupColors = useCreatorStore(s => s.groupColors);
  const skinMaterial = useCreatorStore(s => s.skinMaterial);
  const markLost = useWebGLStore(s => s.markLost);
  const markRestored = useWebGLStore(s => s.markRestored);
  // Re-apply tint when parts mount, group colors change, or skin color changes
  useEffect(() => {
    if (rootRef.current) {
      TINT_DEBUG = !!debugTint;
      applyStoreTint(rootRef.current, { groupColors, skinMaterial }, colors);
    }
  }, [parts, groupColors, skinMaterial, colors, debugTint]);

  const camPos = cameraPosition ?? [2.1, 1.5, 2.6];
  const fov = cameraFov ?? 35;
  const tgt = target ?? [0,0.9,0];
  const offset = modelOffset ?? [0,0,0];
  const scale = modelScale ?? 1;
  const margin = frameMargin ?? 0.12;
  // We'll read auto-frame result through ref to hidden helper group to avoid extra renders
  const autoDataRef = useRef<{ scale:number; offset:[number,number,number]; ready:boolean }|null>(null);

  return (
    <Canvas shadows camera={{ position: camPos as any, fov }} dpr={[1, 1.75]} onCreated={({ gl }) => {
      const canvas = gl.domElement;
      const handleLost = (e: Event) => {
        e.preventDefault();
        markLost();
      };
      const handleRestored = () => {
        markRestored();
      };
      canvas.addEventListener('webglcontextlost', handleLost as any, false);
      canvas.addEventListener('webglcontextrestored', handleRestored as any, false);
      // Cleanup on unmount
      (gl as any).__afCleanup = () => {
        canvas.removeEventListener('webglcontextlost', handleLost as any);
        canvas.removeEventListener('webglcontextrestored', handleRestored as any);
      };
    }}>
      <color attach="background" args={["#12171f"]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5,5,5]} intensity={1.1} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <Suspense fallback={null}>
        {autoFrame && (
          <AutoFrameHelper
            rootRef={rootRef}
            enabled={!!autoFrame}
            margin={margin}
            manualOffset={offset as any}
            deps={[parts]}
          />
        )}
        <IdlePivot speed={rotateSpeed ?? 0.15}>
          <group
            ref={rootRef}
            // Dynamically apply auto frame data if available; fallback to manual
            position={(autoFrame && autoDataRef.current?.ready ? autoDataRef.current.offset : offset) as any}
            scale={((autoFrame && autoDataRef.current?.ready ? autoDataRef.current.scale : scale) as number) || 1}
            onUpdate={grp => {
              // pull latest auto frame data from hidden helper (stored in userData of its group)
              if (!autoFrame) return;
              const helper = (grp.parent as any)?.children?.find((c: any) => c.userData && c.userData.ready !== undefined);
              if (helper && helper.userData.ready) {
                autoDataRef.current = helper.userData;
                // force update transform
                grp.scale.setScalar(helper.userData.scale);
                const off = helper.userData.offset as [number,number,number];
                grp.position.set(off[0], off[1], off[2]);
              }
            }}
          >
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
      {!disableControls && <OrbitControls enablePan={false} minDistance={2} maxDistance={4} target={tgt as any} />}
    </Canvas>
  );
}

export default AvatarScene;
