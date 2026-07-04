import React, { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AvatarPartsLoader, BaseBody } from './AvatarPartsLoader';
import type { AvatarColors } from '../services/avatarConfig';
import { IsometricCharacter, type CharacterGender } from './IsometricCharacter';

export type { AvatarColors };

/**
 * Unified game avatar rendering — handles both assembled parts and full GLB imports.
 * MUST be module-level so React maintains hook stability across re-renders.
 * Used by SoloMissionMap3D for rendering the player avatar on the game map.
 */

// How tall the avatar should be in world units, relative to the hex size.
// The procedural IsometricCharacter is ~1.45×hexSize tall, so this keeps GLB
// avatars visually consistent with it. Tunable once real hero GLBs are dropped in.
const TARGET_HEIGHT_FACTOR = 1.4;

// Base yaw applied to the model so it faces the movement direction correctly.
// The avatar's authored forward was 180° off, so this is 0 (was Math.PI). If a
// future hero GLB faces backwards, set this to Math.PI.
const MODEL_YAW = 0;

// The avatar GLBs are Mixamo-rigged; their BIND POSE is a T-pose (arms straight
// out → ~2 units wide, wider than a tile). The game doesn't run an FBX animation,
// so a procedural walk/idle cycle poses the skeleton directly (below).
const ARM_DROP  = 1.15;  // upper-arm lower angle at rest (radians). Flip sign if arms raise.
const WALK_FREQ = 8.5;   // stride cadence
const LEG_SWING = 0.5;   // thigh swing amplitude while moving (radians)
const ARM_SWING = 0.35;  // arm counter-swing amplitude while moving (radians)

/**
 * Procedural walk/idle animator driven directly on the Mixamo bones. The assembled
 * avatar has a SEPARATE skeleton per part, so a single shared AnimationMixer can't
 * drive them all — instead we pose every matching bone across all skeletons each
 * frame: arms lowered to rest, plus alternating leg/arm swing while moving. Base
 * rotations are cached so the offsets never drift.
 */
function AvatarWalkAnimator({ groupRef, isMoving }: { groupRef: React.RefObject<THREE.Group>; isMoving: boolean }) {
  const bones = useRef<{ leftArm: any[]; rightArm: any[]; leftLeg: any[]; rightLeg: any[]; ready: boolean }>(
    { leftArm: [], rightArm: [], leftLeg: [], rightLeg: [], ready: false }
  );
  const phase = useRef(0);

  useFrame((_s, dt) => {
    const g = groupRef.current;
    if (!g) return;
    const b = bones.current;
    if (!b.ready) {
      g.traverse((o: any) => {
        if (!o.isBone) return;
        const n = String(o.name || '');
        const push = (arr: any[]) => { if (!o.userData.__baseRot) o.userData.__baseRot = o.rotation.clone(); arr.push(o); };
        if (/(^|:)LeftArm$/i.test(n)) push(b.leftArm);
        else if (/(^|:)RightArm$/i.test(n)) push(b.rightArm);
        else if (/(^|:)LeftUpLeg$/i.test(n)) push(b.leftLeg);
        else if (/(^|:)RightUpLeg$/i.test(n)) push(b.rightLeg);
      });
      b.ready = b.leftArm.length > 0 || b.leftLeg.length > 0;
      if (!b.ready) return;
    }

    if (isMoving) phase.current += dt * WALK_FREQ;
    const s = isMoving ? Math.sin(phase.current) : 0;
    const set = (bone: any, dx: number, dz: number) => {
      const base = bone.userData.__baseRot; if (!base) return;
      bone.rotation.set(base.x + dx, base.y, base.z + dz);
    };
    b.leftArm.forEach(bo => set(bo, -s * ARM_SWING, -ARM_DROP));
    b.rightArm.forEach(bo => set(bo,  s * ARM_SWING,  ARM_DROP));
    b.leftLeg.forEach(bo => set(bo,  s * LEG_SWING, 0));
    b.rightLeg.forEach(bo => set(bo, -s * LEG_SWING, 0));
  });
  return null;
}

/**
 * Recolour a loaded model's materials from the faction palette.
 * Matches on material name tokens. Kept consistent with AvatarScene.applyStoreTint:
 *  - "skin"                              → skin colour
 *  - "color_" (generic tintable pieces)  → primary
 *  - primary/armor/fabric/cloth          → primary
 *  - secondary/trim/detail/accent        → secondary
 */
function applyGameTint(root: THREE.Object3D, colors: AvatarColors) {
  root.traverse((obj: any) => {
    const mats: any = obj.material;
    if (!mats) return;
    const apply = (mat: any) => {
      if (!mat?.color) return;
      const n = (mat.name || '').toLowerCase();
      if (n.includes('skin')) mat.color.set(colors.skin);
      else if (n.includes('color_')) mat.color.set(colors.primary);
      else if (n.includes('primary') || n.includes('armor') || n.includes('fabric') || n.includes('cloth')) mat.color.set(colors.primary);
      else if (n.includes('secondary') || n.includes('trim') || n.includes('detail') || n.includes('accent')) mat.color.set(colors.secondary);
      mat.depthTest = true;
      mat.depthWrite = true;
    };
    if (Array.isArray(mats)) mats.forEach(apply); else apply(mats);
  });
}

/**
 * Scales the avatar group so its bounding-box height matches TARGET_HEIGHT_FACTOR×hexSize,
 * then shifts it up so its feet (box.min.y) sit exactly at y=0. Runs each frame until the
 * geometry has loaded and produced a valid box, then locks (doneRef). This is what makes
 * arbitrary GLBs — authored at any native scale — render correctly on the game map.
 */
function GameAvatarFitAnchor({
  groupRef, hexSize, colors,
}: { groupRef: React.RefObject<THREE.Group>; hexSize: number; colors: AvatarColors }) {
  const doneRef = useRef(false);
  const attemptRef = useRef(0);

  // Recompute when hexSize or colours change.
  useEffect(() => { doneRef.current = false; attemptRef.current = 0; }, [hexSize, colors]);

  useFrame(() => {
    const g = groupRef.current;
    if (doneRef.current || !g) return;
    if (attemptRef.current++ > 300) return; // give up after ~5s of no valid geometry

    const box0 = new THREE.Box3().setFromObject(g);
    if (box0.isEmpty() || !isFinite(box0.min.y) || box0.max.y - box0.min.y < 1e-3) return; // not loaded

    doneRef.current = true;
    // Geometry is present — one-time setup: tint (reliable timing now that parts
    // have loaded), then scale to target height and foot-anchor. Bone posing/walk
    // is handled per-frame by AvatarWalkAnimator.
    applyGameTint(g, colors);
    g.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(g);
    const h = box.max.y - box.min.y;
    if (h > 1e-3) g.scale.multiplyScalar((hexSize * TARGET_HEIGHT_FACTOR) / h);
    const box2 = new THREE.Box3().setFromObject(g);
    g.position.y -= box2.min.y;
  });
  return null;
}

/**
 * Game-map avatar wrapper. Placed as a child of the HeroAvatar group in
 * SoloMissionMap3D; that parent group carries the world position (hero tile).
 * This wrapper carries local scale/foot-anchor and the facing rotation, so both
 * the GLB and the procedural fallback turn to face the movement direction.
 */
export function GameAvatar({
  heroModelUrl, heroParts, heroColors, hexSize, gender, isMoving = false, facingAngle,
}: {
  heroModelUrl?: string;
  heroParts: Record<string, string | undefined>;
  heroColors: AvatarColors;
  hexSize: number;
  gender?: CharacterGender;
  isMoving?: boolean;
  facingAngle?: number;
}) {
  const avatarGroupRef = React.useRef<THREE.Group>(null);

  // Keep local matrix fresh (GLTFLoader may disable matrixAutoUpdate) and apply
  // facing rotation. We do NOT call updateMatrixWorld here — let R3F cascade.
  useFrame(() => {
    const g = avatarGroupRef.current;
    if (!g) return;
    g.matrixAutoUpdate = true;
    if (facingAngle !== undefined) g.rotation.y = facingAngle + MODEL_YAW;
  });

  return (
    <group frustumCulled={false}>
      <group ref={avatarGroupRef} name={heroModelUrl ? 'glb-avatar' : 'assembled-avatar'} position={[0, 0, 0]} frustumCulled={false}>
        {heroModelUrl ? (
          <GLBAvatarMesh url={heroModelUrl} parts={heroParts} colors={heroColors} gender={gender} hexSize={hexSize} isMoving={isMoving} />
        ) : (
          <AssembledAvatarMesh parts={heroParts} colors={heroColors} gender={gender} hexSize={hexSize} isMoving={isMoving} />
        )}
      </group>
      <GameAvatarFitAnchor groupRef={avatarGroupRef} hexSize={hexSize} colors={heroColors} />
      <AvatarWalkAnimator groupRef={avatarGroupRef} isMoving={isMoving} />
    </group>
  );
}

/**
 * Assembled avatar from individual GLB part files — game-map version.
 * MUST be module-level (not nested inside SoloMissionMap3D) so React never treats
 * it as a different component type between renders, which would cause hook resets.
 *
 * Renders BaseBody (the naked full body the parts are authored to sit on) plus the
 * selected parts — mirroring the creator's AvatarScene. Without BaseBody the parts
 * float with no torso/limbs.
 *
 * NOTE: AvatarAnimator (which calls useFBX internally) is intentionally NOT used here.
 * useFBX can throw an actual Error (not a Promise) if the FBX fails to parse/load.
 * <Suspense> only catches thrown Promises — an Error propagates silently upward through
 * the Canvas, killing the entire avatar subtree. Static bind-pose is correct for game mode.
 */
function AssembledAvatarMesh({
  parts, colors, gender, hexSize, isMoving,
}: {
  parts: Record<string, string | undefined>;
  colors: AvatarColors;
  gender?: CharacterGender;
  hexSize?: number;
  isMoving?: boolean;
}) {
  const rootRef = React.useRef<THREE.Group>(null);
  const hasCustomParts = Object.values(parts).some(p => p);

  // Apply colour tinting after parts mount. Depends on the parts key so it re-runs
  // when the loaded set changes (materials are only present after Suspense resolves).
  const partsKey = React.useMemo(() => JSON.stringify(parts), [parts]);
  useEffect(() => {
    if (!hasCustomParts) return; // IsometricCharacter applies its own colours
    const root = rootRef.current;
    if (!root) return;
    applyGameTint(root, colors);
  }, [partsKey, colors, hasCustomParts]);

  // Procedural fallback gets isMoving for the walk cycle; facing is handled by the
  // parent GameAvatar group so it isn't applied twice.
  const procFallback = (
    <IsometricCharacter gender={gender ?? 'FEMALE'} colors={colors} hexSize={hexSize ?? 3} isMoving={isMoving} />
  );

  if (!hasCustomParts) return procFallback;

  // Suspense fallback is null (not the procedural character): the procedural figure
  // must NOT render inside the group that GameAvatarFitAnchor measures, or the anchor
  // locks onto its size and the GLB then renders at the wrong scale. The procedural
  // avatar remains the error fallback (load failure) and the outer Suspense in
  // SoloMissionMap3D covers the loading frames.
  return (
    <GLBErrorBoundary resetKey={partsKey} fallback={procFallback}>
      <React.Suspense fallback={null}>
        <group ref={rootRef} position={[0, 0, 0]}>
          <BaseBody />
          <AvatarPartsLoader parts={parts} />
        </group>
      </React.Suspense>
    </GLBErrorBoundary>
  );
}

/**
 * Error boundary that catches errors thrown by useGLTF (e.g. bad URL / 404).
 * React Suspense only catches thrown Promises — actual Errors need a boundary.
 * Resets when the child key (url/parts) changes so a later valid model can mount.
 */
class GLBErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode; resetKey?: string },
  { errored: boolean }
> {
  constructor(props: any) { super(props); this.state = { errored: false }; }
  static getDerivedStateFromError() { return { errored: true }; }
  componentDidUpdate(prev: any) { if (prev.resetKey !== this.props.resetKey && this.state.errored) this.setState({ errored: false }); }
  render() { return this.state.errored ? this.props.fallback : this.props.children; }
}

/**
 * Inner component: useGLTF MUST be called here unconditionally (no try/catch).
 * Wrapping useGLTF in try/catch intercepts the Suspense Promise throw, so the
 * Suspense boundary never receives it and the model never loads.
 * GLBErrorBoundary above handles actual JS errors (bad URL, decode failure).
 */
function GLBAvatarInner({ url, colors }: { url: string; colors: AvatarColors }) {
  const { scene } = useGLTF(url); // unconditional — do NOT wrap in try/catch
  const inst = useMemo(() => {
    // SkeletonUtils.clone — hero GLBs are skinned; a plain clone would ignore this
    // group's fit/scale transform and render at the model's native size.
    const cloned = skeletonClone(scene) as THREE.Object3D;
    cloned.position.set(0, 0, 0);
    cloned.rotation.set(0, 0, 0);
    cloned.scale.set(1, 1, 1);
    cloned.frustumCulled = false;
    cloned.traverse((child: any) => {
      child.matrixAutoUpdate = true;
      child.matrixWorldAutoUpdate = true;
      child.updateMatrix();
      child.frustumCulled = false;
    });
    return cloned;
  }, [scene]);

  useEffect(() => {
    if (inst) applyGameTint(inst, colors);
  }, [inst, colors]);

  // Wrap in a group so R3F owns scene-graph parenting; primitive carries mesh data.
  return (
    <group position={[0, 0, 0]} frustumCulled={false}>
      <primitive object={inst} frustumCulled={false} />
    </group>
  );
}

/**
 * Full-GLB avatar with per-material colour tinting.
 * MUST be module-level for the same hook-stability reason as AssembledAvatarMesh.
 * Falls back to the assembled/procedural avatar if the GLB fails to load.
 */
function GLBAvatarMesh({ url, parts, colors, gender, hexSize, isMoving }: { url: string; parts: Record<string, string | undefined>; colors: AvatarColors; gender?: CharacterGender; hexSize?: number; isMoving?: boolean }) {
  return (
    <GLBErrorBoundary resetKey={url} fallback={<AssembledAvatarMesh parts={parts} colors={colors} gender={gender} hexSize={hexSize} isMoving={isMoving} />}>
      <React.Suspense fallback={null}>
        <GLBAvatarInner url={url} colors={colors} />
      </React.Suspense>
    </GLBErrorBoundary>
  );
}
