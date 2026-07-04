import React, { Suspense, useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { AvatarPartsLoader, BaseBody } from './AvatarPartsLoader';
import { AvatarAnimator } from './AvatarAnimator';
import * as THREE from 'three';
import { useCreatorStore } from '../store/creatorStore';

// Central token mapping: each color channel -> array of material name substrings to match
// To extend: add new channel key (e.g. "emissive") and update AvatarSceneProps.colors + tintHierarchy logic.
const MATERIAL_TOKENS: Record<string,string[]> = {
  skin: ['skin'],
  // 'color' catches the generic `Color_` material the GLB parts use for their main
  // tintable surface (hair, tops, bottoms, shoes) — without it those parts never recolor.
  primary: ['primary','fabric','cloth','armor','color'],
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

/**
 * FrameAdjuster — inside Canvas (has access to useFrame/useThree).
 * Runs every frame until geometry loads, then:
 *   1. If autoFrame: scales outerRef to fit the viewport height.
 *   2. Always: shifts innerRef.position.y so the model is foot-anchored (feet at y=0).
 * Resets when partsKey changes (user swaps a part) so it recomputes.
 */
function FrameAdjuster({
  outerRef, innerRef, autoFrame, margin, baseScale, partsKey,
}: {
  outerRef: React.RefObject<THREE.Group>;
  innerRef: React.RefObject<THREE.Group>;
  autoFrame: boolean;
  margin: number;
  baseScale: number;
  partsKey: string;
}) {
  const { camera } = useThree();
  const doneRef = useRef(false);

  useEffect(() => {
    // Reset every time parts change so we recompute with fresh geometry.
    if (innerRef.current) innerRef.current.position.y = 0;
    if (autoFrame && outerRef.current) outerRef.current.scale.setScalar(baseScale);
    doneRef.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partsKey]);

  useFrame(() => {
    if (doneRef.current || !outerRef.current || !innerRef.current) return;
    const box = new THREE.Box3().setFromObject(innerRef.current);
    if (box.isEmpty() || !isFinite(box.min.y) || !isFinite(box.max.y)) return; // not loaded yet
    const height = box.max.y - box.min.y;
    if (height < 0.01) return;
    doneRef.current = true;

    if (autoFrame) {
      const dist = camera.position.length();
      const vFov = (camera as THREE.PerspectiveCamera).fov * Math.PI / 180;
      const visH = 2 * Math.tan(vFov / 2) * dist;
      const allowed = visH * (1 - margin * 2);
      outerRef.current.scale.setScalar((allowed / height) * outerRef.current.scale.x);
    }

    // Re-read bounding box after potential scale change, then foot-anchor.
    // box.min.y is the world-space Y of the feet. Subtracting it from position.y
    // shifts the group up so feet land exactly at y = 0 inside the parent group.
    const finalBox = new THREE.Box3().setFromObject(innerRef.current);
    innerRef.current.position.y -= finalBox.min.y;
  });

  return null;
}

export function AvatarScene({ parts, colors, debugTint, animPaused, animSpeed, rotateSpeed, disableControls, cameraPosition, cameraFov, target, modelOffset, modelScale, autoFrame, frameMargin }: AvatarSceneProps) {
  // outerRef: receives scale/position from props (manual offset + autoFrame scale)
  const rootRef = useRef<THREE.Group>(null);
  // contentRef: inner group whose Y is mutated by FrameAdjuster to foot-anchor the model
  const contentRef = useRef<THREE.Group>(null);
  const groupColors = useCreatorStore(s => s.groupColors);
  const skinMaterial = useCreatorStore(s => s.skinMaterial);
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
  // Stable key so FrameAdjuster recomputes when the loaded parts set changes
  const partsKey = JSON.stringify(parts ?? {});

  return (
    <Canvas shadows camera={{ position: camPos as any, fov }} dpr={[1, 1.75]}>
      <color attach="background" args={["#12171f"]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5,5,5]} intensity={1.1} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <Suspense fallback={null}>
        <IdlePivot speed={rotateSpeed ?? 0.15}>
          {/* outerRef: manual offset + autoFrame scale applied here */}
          <group ref={rootRef} position={offset as any} scale={scale}>
            {/* contentRef: Y is shifted by FrameAdjuster to foot-anchor the model */}
            <group ref={contentRef}>
              <AvatarAnimator paused={animPaused} speed={animSpeed}>
                <group>
                  <BaseBody />
                  <AvatarPartsLoader parts={parts} />
                </group>
              </AvatarAnimator>
            </group>
          </group>
        </IdlePivot>
        {/* Environment removed to prevent HDR loading errors - using basic lights instead */}
      </Suspense>
      {/* FrameAdjuster lives outside Suspense so it's always mounted;
          it retries every frame until geometry is loaded, then runs once. */}
      <FrameAdjuster
        outerRef={rootRef}
        innerRef={contentRef}
        autoFrame={!!autoFrame}
        margin={margin}
        baseScale={scale}
        partsKey={partsKey}
      />
      {!disableControls && <OrbitControls enablePan={false} minDistance={2} maxDistance={4} target={tgt as any} />}
    </Canvas>
  );
}

export default React.memo(AvatarScene);
