import React, { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { AvatarPartsLoader, BaseBody } from './AvatarPartsLoader';
import type { AvatarColors } from '../services/avatarConfig';

export type { AvatarColors };

/**
 * Unified game avatar rendering — handles both assembled parts and GLB imports.
 * MUST be module-level so React maintains hook stability across re-renders.
 * Used by SoloMissionMap3D for rendering player avatar on game map.
 */

/**
 * Foot-anchor component: measures avatar geometry and shifts local Y so feet land at y=0.
 */
function GameAvatarFootAnchor({ avatarGroupRef }: { avatarGroupRef: React.RefObject<THREE.Group> }) {
  const doneRef = useRef(false);
  const attemptRef = useRef(0);
  
  useFrame(() => {
    attemptRef.current++;
    if (doneRef.current || !avatarGroupRef.current) return;
    
    // ONLY measure the avatar group, not the debug box
    const box = new THREE.Box3().setFromObject(avatarGroupRef.current);
    const isReady = !box.isEmpty() && isFinite(box.min.y);
    if (!isReady) return;
    
    doneRef.current = true;
    // Shift avatar group so feet (box.min.y) land at y = 0
    (avatarGroupRef.current as any).position.y += -box.min.y;
  });
  return null;
}

function AvatarVisibilityDebugger(_props: { containerRef: React.RefObject<THREE.Group> }) {
  // Removed — was logging every second and not needed after useFrame position lock.
  return null;
}

/**
 * Game-map avatar wrapper.
 * Placed as a child of the HeroAvatar group in SoloMissionMap3D so React/R3F
 * handle world-matrix propagation automatically via the parent group's position prop.
 * We also force updateMatrixWorld(true) every frame to ensure all descendants
 * (including GLB primitives with baked transforms) receive fresh world matrices.
 */
export function GameAvatar({
  heroModelUrl, heroParts, heroColors, hexSize,
}: {
  heroModelUrl?: string;
  heroParts: Record<string, string | undefined>;
  heroColors: AvatarColors;
  hexSize: number;
}) {
  const avatarGroupRef = React.useRef<THREE.Group>(null);
  const ENABLE_FOOT_ANCHOR = true;

  // Force matrix cascade every frame to ensure GLB primitives with baked transforms
  // properly inherit parent world matrices, especially when the parent group moves.
  useFrame(() => {
    if (!avatarGroupRef.current) return;
    const g = avatarGroupRef.current;
    // Re-enable matrixAutoUpdate in case GLTFLoader disabled it, then update local matrix
    // from current position/rotation/scale (all 0,0,0 by design).
    g.matrixAutoUpdate = true;
    g.updateMatrix();
    // Force world matrix recalculation through entire subtree—critical for baked-transform
    // GLB nodes that won't recalculate otherwise.
    g.updateMatrixWorld(true);
  });

  return (
    <group frustumCulled={false}>
      {/* Pink wireframe box — visual confirmation that the container tracks the hero */}
      <mesh name="debug-avatar-box" frustumCulled={false} renderOrder={100}>
        <boxGeometry args={[hexSize * 0.6, hexSize * 1.2, hexSize * 0.6]} />
        <meshBasicMaterial wireframe color="#ff00ff" transparent opacity={0.8} depthWrite={false} depthTest={false} />
      </mesh>

      {heroModelUrl ? (
        <group ref={avatarGroupRef} name="glb-avatar" position={[0, 0, 0]} frustumCulled={false}>
          <GLBAvatarMesh url={heroModelUrl} parts={heroParts} colors={heroColors} />
        </group>
      ) : (
        <group ref={avatarGroupRef} name="assembled-avatar" position={[0, 0, 0]} frustumCulled={false}>
          <AssembledAvatarMesh parts={heroParts} colors={heroColors} />
        </group>
      )}

      {ENABLE_FOOT_ANCHOR && <GameAvatarFootAnchor avatarGroupRef={avatarGroupRef} />}
    </group>
  );
}

/**
 * Assembled avatar from individual GLB part files — game-map version.
 * MUST be module-level (not nested inside SoloMissionMap3D) so React never treats
 * it as a different component type between renders, which would cause hook resets.
 *
 * NOTE: AvatarAnimator (which calls useFBX internally) is intentionally NOT used here.
 * useFBX can throw an actual Error (not a Promise) if the FBX fails to parse/load.
 * <Suspense> only catches thrown Promises — an Error propagates silently upward through
 * the Canvas, killing the entire avatar subtree. Static bind-pose is correct for game mode.
 */
function AssembledAvatarMesh({ parts, colors }: { parts: Record<string, string | undefined>; colors: AvatarColors }) {
  const rootRef = React.useRef<THREE.Group>(null);
  // Apply color tinting to materials after parts mount — mirrors applyStoreTint in AvatarScene.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    console.log('[AssembledAvatarMesh] Tinting, parts:', Object.keys(parts).length);
    root.traverse((obj: any) => {
      const mats: any = (obj as any).material;
      if (!mats) return;
      const tint = (mat: any) => {
        if (!mat?.color) return;
        const n = (mat.name || '').toLowerCase();
        if (n.includes('skin')) mat.color.set(colors.skin);
        else if (n.includes('primary') || n.includes('armor') || n.includes('fabric')) mat.color.set(colors.primary);
        else if (n.includes('secondary') || n.includes('trim') || n.includes('detail') || n.includes('accent')) mat.color.set(colors.secondary);
        // Ensure materials render on top
        mat.depthTest = true;
        mat.depthWrite = true;
        mat.renderOrder = 100;
      };
      if (Array.isArray(mats)) mats.forEach(tint); else tint(mats);
    });
    console.log('[AssembledAvatarMesh] Tinting complete. Meshes in group:', root.children.length);
  }, [parts, colors]);
  return (
    <group ref={rootRef} position={[0, 0, 0]} scale={0.9} rotation={[0, Math.PI, 0]}>
      {/* Only render parts if provided; otherwise use full BaseBody */}
      {Object.values(parts).some(p => p) ? (
        <AvatarPartsLoader parts={parts} />
      ) : (
        <BaseBody />
      )}
    </group>
  );
}

/**
 * Error boundary that catches errors thrown by useGLTF (e.g. bad URL / 404).
 * React Suspense only catches thrown Promises — actual Errors need a boundary.
 */
class GLBErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { errored: boolean }
> {
  constructor(props: any) { super(props); this.state = { errored: false }; }
  static getDerivedStateFromError() { return { errored: true }; }
  render() { return this.state.errored ? this.props.fallback : this.props.children; }
}

/**
 * Inner component: useGLTF MUST be called here unconditionally (no try/catch).
 * Wrapping useGLTF in try/catch intercepts the Suspense Promise throw, so the
 * Suspense boundary never receives it and the model never loads.
 * GLBErrorBoundary above handles actual JS errors (bad URL, decode failure).
 */
function GLBAvatarInner({ url, parts, colors }: { url: string; parts: Record<string, string | undefined>; colors: AvatarColors }) {
  const { scene } = useGLTF(url); // unconditional — do NOT wrap in try/catch
  const inst = useMemo(() => {
    if (!scene) return null;
    try { 
      const cloned = scene.clone() as THREE.Object3D;
      // Re-enable matrixAutoUpdate + matrixWorldAutoUpdate on every node so both
      // local and world matrices update correctly when the ancestor group moves.
      cloned.traverse((child: any) => {
        child.matrixAutoUpdate = true;
        child.matrixWorldAutoUpdate = true;
        child.updateMatrix();
      });
      return cloned;
    } catch (e) {
      console.error('[GLBAvatarInner] Clone failed:', e);
      return null;
    }
  }, [scene, url]);
  useEffect(() => {
    if (!inst) {
      console.log('[GLBAvatarInner] No instance, falling back to AssembledAvatarMesh');
      return;
    }
    console.log('[GLBAvatarInner] Applying colors to cloned model');
    const { primary, secondary, skin } = colors;
    let coloredCount = 0;
    inst.traverse((obj: any) => {
      const mats: any = obj.material;
      if (!mats) return;
      const apply = (mat: any) => {
        const name = (mat.name || '').toLowerCase();
        if (!mat?.color) return;
        if (name.includes('skin'))                                              mat.color.set(skin);
        else if (name.includes('primary') || name.includes('armor') || name.includes('fabric')) mat.color.set(primary);
        else if (name.includes('secondary') || name.includes('trim') || name.includes('detail') || name.includes('accent')) mat.color.set(secondary);
        // Ensure materials render on top
        mat.depthTest = true;
        mat.depthWrite = true;
        mat.renderOrder = 100;
      };
      if (Array.isArray(mats)) mats.forEach(apply); else apply(mats);
      coloredCount++;
    });
    console.log('[GLBAvatarInner] Colors applied to', coloredCount, 'objects');
  }, [inst, colors, url]);
  // MUST be before any early return — Rules of Hooks
  useEffect(() => {
    if (!inst) return;
    // Reset root transform and ensure every node has matrixAutoUpdate=true so
    // world-matrix propagation works when the ancestor container group moves.
    inst.position.set(0, 0, 0);
    inst.rotation.set(0, 0, 0);
    inst.scale.set(1, 1, 1);
    inst.frustumCulled = false;
    inst.traverse((child: any) => {
      child.matrixAutoUpdate = true;
      child.matrixWorldAutoUpdate = true;
      child.updateMatrix();
      child.frustumCulled = false;
      if (child.material) {
        child.material.depthTest = true;
        child.material.depthWrite = true;
      }
    });
  }, [inst]);
  if (!inst) {
    console.log('[GLBAvatarInner] No inst, using AssembledAvatarMesh fallback');
    return <AssembledAvatarMesh parts={parts} colors={colors} />;
  }
  // Wrap in a group so R3F owns the scene-graph parenting; primitive only carries mesh data
  return (
    <group position={[0, 0, 0]} rotation={[0, Math.PI, 0]} scale={[0.9, 0.9, 0.9]} frustumCulled={false}>
      <primitive object={inst} frustumCulled={false} />
    </group>
  );
}

/**
 * Full-GLB avatar with per-material colour tinting.
 * MUST be module-level for the same hook-stability reason as AssembledAvatarMesh.
 */
function GLBAvatarMesh({ url, parts, colors }: { url: string; parts: Record<string, string | undefined>; colors: AvatarColors }) {
  return (
    <GLBErrorBoundary fallback={<AssembledAvatarMesh parts={parts} colors={colors} />}>
      <GLBAvatarInner url={url} parts={parts} colors={colors} />
    </GLBErrorBoundary>
  );
}
