import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Group, AnimationMixer, type AnimationAction, type AnimationClip } from 'three';
import { useFBX, useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { ATTACK_DURATION, attackSwingCurve } from './IsometricCharacter';

/**
 * AvatarAnimator
 * Loads a base full body rig (if present) and an idle animation FBX, exposes animation controls.
 * If the rig file is missing falls back to a simple group wrapper (no skeletal animation).
 */

export interface AvatarAnimatorProps {
  children: React.ReactNode; // skinned meshes / parts
  speed?: number;            // playback speed
  paused?: boolean;          // externally paused
  clip?: string;             // current clip name
  moving?: boolean;          // when true, play the walk clip instead of idle
  /** Increment to fire a one-shot attack swing on the RightArm bone(s) — mirrors
   *  IsometricCharacter's attackTrigger. Only the delta between renders matters. */
  attackTrigger?: number;
  onState?:(state:{current?:string;paused:boolean;speed:number})=>void; // callback when state changes
}

interface AnimatorAPI {
  play: (clipName?: string) => void;
  pause: () => void;
  setSpeed: (s: number) => void;
  speed: number;
  current?: string;
  available: string[];
  paused: boolean;
  root: React.MutableRefObject<Group | null>;
}

const AvatarAnimationContext = createContext<AnimatorAPI | null>(null);
export function useAvatarAnimation() {
  const ctx = useContext(AvatarAnimationContext);
  if (!ctx) throw new Error('useAvatarAnimation must be used inside <AvatarAnimator/>');
  return ctx;
}

// Paths (public). Adjust naming if actual files differ.
// To add additional animations (e.g. Run.fbx, Wave.fbx):
// 1. Place the FBX in /assets/3d.
// 2. Load with useFBX inside this component (or a higher-level loader) and merge animations arrays.
// 3. Expose clip names via `available` and create UI to select them.
const RIG_PATH = '/assets/3d/FullBody.fbx';
const IDLE_PATH = '/assets/3d/Idle.fbx';
const WALK_PATH = '/assets/3d/Armature.glb'; // contains a full-body Mixamo locomotion clip

export const AvatarAnimator: React.FC<AvatarAnimatorProps> = React.memo(({ children, speed = 1, paused = false, clip, moving = false, attackTrigger, onState }) => {
  // Attempt to load rig & idle; if fail, Drei will error to console. We keep try/catch nuance by conditional flags.
  // (Optional) If a separate rig FBX is needed later, load it similarly to Idle and parent children appropriately.
  const groupRef = useRef<Group | null>(null);

  // Load idle (FBX) + walk (GLB) clips. Clone + rename to stable 'idle'/'walk'.
  const idleFbx = useFBX(IDLE_PATH);
  const walkGlb = useGLTF(WALK_PATH) as any;
  const idleClip = useMemo<AnimationClip | null>(() => {
    const a = idleFbx?.animations?.[0]; if (!a) return null; const c = a.clone(); c.name = 'idle'; return c;
  }, [idleFbx]);
  const walkClip = useMemo<AnimationClip | null>(() => {
    const a = walkGlb?.animations?.[0]; if (!a) return null; const c = a.clone(); c.name = 'walk'; return c;
  }, [walkGlb]);

  const [playSpeed, setPlaySpeed] = useState(speed);
  const [isPaused, setIsPaused] = useState(paused);
  const current = clip || (moving ? 'walk' : 'idle');

  useEffect(()=>{ setPlaySpeed(speed); },[speed]);
  useEffect(()=>{ setIsPaused(paused); },[paused]);

  // ── Per-part mixers ────────────────────────────────────────────────────────
  // The avatar is assembled from SEPARATE skinned meshes, each with its OWN skeleton
  // (e.g. BaseBody AND the Outfit are both full bodies). A single shared mixer only
  // animates the first skeleton, leaving the others in T-pose — which is why the
  // T-pose and the running animation showed at the same time. So we give EVERY
  // skinned mesh its own mixer playing the same clips, in sync.
  const rigsRef = useRef<Array<{ mixer: AnimationMixer; idle?: AnimationAction; walk?: AnimationAction }>>([]);
  const setupRef = useRef(false);
  // 0 = fully idle, 1 = fully walk — eased toward the target each frame so switching
  // gaits cross-fades instead of popping the clip weights instantly.
  const blendRef = useRef(0);
  const movingRef = useRef(moving); movingRef.current = moving;
  const pausedRef = useRef(isPaused); pausedRef.current = isPaused;
  const speedRef = useRef(playSpeed); speedRef.current = playSpeed;
  const clipRef = useRef(clip); clipRef.current = clip;

  // One-shot attack swing — RightArm bone(s) across every rig's skeleton, posed
  // directly (AFTER mixer.update below) with the SAME curve IsometricCharacter uses,
  // so the procedural and assembled-GLB avatars read as the same attack. There's no
  // "attack" clip asset for this rig (Idle.fbx / Armature.glb are the only clips
  // loaded), so this overrides the bone imperatively instead of blending a 3rd action.
  const rightArmBonesRef = useRef<any[]>([]);
  const attackClockRef = useRef(0);
  const lastAttackTriggerRef = useRef(attackTrigger);
  const attackStartRef = useRef<number | null>(null);

  // Rebuild mixers if the clips change (rare) — clear the setup flag.
  useEffect(() => { setupRef.current = false; rigsRef.current.forEach(r => r.mixer.stopAllAction()); rigsRef.current = []; }, [idleClip, walkClip]);

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    if (!setupRef.current) {
      if (!idleClip && !walkClip) return;
      const meshes: any[] = [];
      g.traverse((o: any) => { if (o.isSkinnedMesh && o.skeleton?.bones?.length) meshes.push(o); });
      if (!meshes.length) return; // parts still loading
      meshes.forEach((mesh) => {
        // Root the mixer at this mesh's own armature so its clip binds to ITS bones.
        const root = mesh.skeleton.bones[0]?.parent || mesh.parent || mesh;
        const mixer = new AnimationMixer(root);
        const idle = idleClip ? mixer.clipAction(idleClip) : undefined;
        const walk = walkClip ? mixer.clipAction(walkClip) : undefined;
        idle?.play();
        walk?.play();
        rigsRef.current.push({ mixer, idle, walk });
        // Same naming convention as the Mixamo rig's other bones (colon-prefixed on
        // some exports, bare on others) — cache each skeleton's OWN RightArm bone and
        // its bind-pose rotation so the swing below has a stable base to offset from.
        const rightArm = mesh.skeleton.bones.find((b: any) => /(^|:)RightArm$/i.test(b.name || ''));
        if (rightArm) {
          if (!rightArm.userData.__baseRot) rightArm.userData.__baseRot = rightArm.rotation.clone();
          rightArmBonesRef.current.push(rightArm);
        }
      });
      setupRef.current = true;
    }
    const desired = clipRef.current || (movingRef.current ? 'walk' : 'idle');
    const ts = pausedRef.current ? 0 : speedRef.current;
    const targetBlend = desired === 'walk' ? 1 : 0;
    const blendK = 1 - Math.exp(-10 * Math.min(0.05, dt));
    blendRef.current += (targetBlend - blendRef.current) * blendK;
    const walkWeight = blendRef.current;
    rigsRef.current.forEach(({ mixer, idle, walk }) => {
      if (idle) { idle.setEffectiveWeight(walk ? 1 - walkWeight : 1); idle.setEffectiveTimeScale(ts); }
      if (walk) { walk.setEffectiveWeight(walkWeight); walk.setEffectiveTimeScale(ts); }
      mixer.update(dt);
    });

    // Attack swing — runs AFTER mixer.update above so it overrides whatever the idle/
    // walk clips just wrote to the RightArm bone(s) for this frame only.
    attackClockRef.current += dt;
    if (attackTrigger !== undefined && attackTrigger !== lastAttackTriggerRef.current) {
      lastAttackTriggerRef.current = attackTrigger;
      attackStartRef.current = attackClockRef.current;
    }
    if (attackStartRef.current !== null) {
      const ap = (attackClockRef.current - attackStartRef.current) / ATTACK_DURATION;
      if (ap < 1) {
        const swing = attackSwingCurve(ap);
        rightArmBonesRef.current.forEach((bone) => {
          const base = bone.userData.__baseRot;
          if (base) bone.rotation.set(base.x + swing, base.y, base.z);
        });
      } else {
        attackStartRef.current = null;
      }
    }
  });

  useEffect(() => () => { rigsRef.current.forEach(r => r.mixer.stopAllAction()); rigsRef.current = []; }, []);

  const api: AnimatorAPI = useMemo(() => ({
    play: () => { setIsPaused(false); },
    pause: () => setIsPaused(true),
    setSpeed: (s: number) => setPlaySpeed(s),
    speed: playSpeed,
    current,
    available: ['idle', 'walk'],
    paused: isPaused,
    root: groupRef,
  }), [current, playSpeed, isPaused]);

  // Emit state up
  useEffect(()=>{ onState?.({current, paused:isPaused, speed:playSpeed}); },[current,isPaused,playSpeed,onState]);

  return (
    <AvatarAnimationContext.Provider value={api}>
      <group ref={groupRef}>        
        {/* We rely on child skinned meshes having matching bone names to animation skeleton */}
        {children}
      </group>
    </AvatarAnimationContext.Provider>
  );
});

// Preload helper (optional call from app root)
export function preloadAvatarAnimation() {
  // Retained for any callers; main tiered scheduler already preloads these.
  useFBX.preload(IDLE_PATH);
  useFBX.preload(RIG_PATH);
}
