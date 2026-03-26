/**
 * IsometricCharacter — Standalone procedural Pokémon/chibi-style 3D player character.
 *
 * Built entirely from Three.js primitives (no GLTF dependency).
 * Drop-in replacement for the placeholder pink wireframe box in GameAvatarMesh.
 *
 * Features:
 *  • Male / Female variants (different hair geometry)
 *  • Fully colour-customisable (skin, primary outfit, secondary trim)
 *  • Smooth idle bob animation via useFrame
 *  • Faction-aware skin tones via `skinColor` prop
 *  • Accepts optional `modelUrl` — if provided, defers rendering to the GLTF branch;
 *    this file's geometry is the fallback until real assets are supplied.
 *
 * Usage:
 *   <IsometricCharacter gender="FEMALE" colors={heroColors} hexSize={hexSize} />
 */

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { AvatarColors } from '../services/avatarConfig';
import type { Archetype } from '../types/loadout';
import { PROPORTIONS, SCALE_FACTOR, MATERIAL_PROPS } from '../assets/isometricCharacter';

/** Alias of Archetype — CharacterGender kept for legacy import compatibility. */
export type CharacterGender = Archetype;

interface IsometricCharacterProps {
  gender?: CharacterGender;
  colors: AvatarColors;
  hexSize: number;
  /** When true, plays an idle bobbing animation. Default true. */
  animated?: boolean;
  /** Y-axis rotation (radians) for the direction the character faces. Smoothly interpolated. */
  facingAngle?: number;
  /** When true plays a walk cycle; when false returns to idle bob. */
  isMoving?: boolean;
}

// ── Shared material cache — avoids creating new materials every render ─────
function useMat(color: string, roughness = 0.6, metalness = 0.1) {
  return React.useMemo(
    () => new THREE.MeshStandardMaterial({ color, roughness, metalness }),
    [color, roughness, metalness],
  );
}

// ── Male hair: short natural — cap base + volume dome + side pieces ───────
function MaleHair({ r, primaryColor }: { r: number; primaryColor: string }) {
  const mat = useMat(primaryColor, 0.75, 0.0);
  return (
    <>
      {/* Hair cap: top & back of head — raised + shifted back so eyes are clear */}
      <mesh position={[0, r * 0.26, -r * 0.18]} scale={[1.1, 0.92, 0.9]} material={mat}>
        <sphereGeometry args={[r, 14, 10]} />
      </mesh>
      {/* Top volume dome — raised mass on crown */}
      <mesh position={[0, r * 0.88, -r * 0.06]} scale={[0.86, 0.68, 0.76]} material={mat}>
        <sphereGeometry args={[r * 0.76, 10, 8]} />
      </mesh>
      {/* Left side piece */}
      <mesh position={[-r * 0.92, r * 0.1, r * 0.14]} scale={[0.44, 0.86, 0.62]} material={mat}>
        <sphereGeometry args={[r * 0.38, 8, 6]} />
      </mesh>
      {/* Right side piece */}
      <mesh position={[r * 0.92, r * 0.1, r * 0.14]} scale={[0.44, 0.86, 0.62]} material={mat}>
        <sphereGeometry args={[r * 0.38, 8, 6]} />
      </mesh>
    </>
  );
}

// ── Female hair: twin afro-puffs (Afro Future style) ─────────────────────
function FemaleHair({ r, primaryColor }: { r: number; primaryColor: string }) {
  const mat = useMat(primaryColor, 0.7, 0.0);
  return (
    <>
      {/* Hair cap: top & back only — shifted up and back so eyes stay clear */}
      <mesh position={[0, r * 0.26, -r * 0.18]} scale={[1.1, 0.92, 0.9]} material={mat}>
        <sphereGeometry args={[r, 14, 10]} />
      </mesh>
      {/* Left afro puff */}
      <mesh position={[-r * 0.82, r * 0.7, -r * 0.08]} material={mat}>
        <sphereGeometry args={[r * 0.44, 10, 8]} />
      </mesh>
      {/* Right afro puff */}
      <mesh position={[r * 0.82, r * 0.7, -r * 0.08]} material={mat}>
        <sphereGeometry args={[r * 0.44, 10, 8]} />
      </mesh>
    </>
  );
}

// ── Eye pair — two dark spheres on the front hemisphere of the head ────────
function Eyes({ headR, skinColor }: { headR: number; skinColor: string }) {
  const eyeMat = React.useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#0d0d1f', roughness: 0.3, metalness: 0.2 }),
    [],
  );
  const highlightMat = React.useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.1, metalness: 0.0 }),
    [],
  );
  // Blush marks for more Pokémon-style charm
  const blushMat = React.useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffb3b3',
        roughness: 0.9,
        metalness: 0.0,
        transparent: true,
        opacity: 0.55,
      }),
    [],
  );
  void skinColor; // may use for blush tint in future
  const er = headR * 0.13;
  const ex = headR * 0.38;
  const ey = headR * 0.08;
  const ez = headR * 0.87;
  // Eyebrow dimensions
  const ebW = er * 1.7;  // width
  const ebH = er * 0.28; // height
  const ebD = er * 0.18; // depth
  const ebY = ey + er * 1.6; // just above the eye
  const ebZ = ez * 0.97;
  const browMat = React.useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#150a00', roughness: 0.9, metalness: 0.0 }),
    [],
  );
  return (
    <>
      {/* Left eyebrow */}
      <mesh position={[-ex, ebY, ebZ]} rotation={[0, 0, 0.18]} material={browMat}>
        <boxGeometry args={[ebW, ebH, ebD]} />
      </mesh>
      {/* Right eyebrow */}
      <mesh position={[ex, ebY, ebZ]} rotation={[0, 0, -0.18]} material={browMat}>
        <boxGeometry args={[ebW, ebH, ebD]} />
      </mesh>
      {/* Left eye */}
      <mesh position={[-ex, ey, ez]} material={eyeMat}>
        <sphereGeometry args={[er, 8, 6]} />
      </mesh>
      {/* Right eye */}
      <mesh position={[ex, ey, ez]} material={eyeMat}>
        <sphereGeometry args={[er, 8, 6]} />
      </mesh>
      {/* Eye highlights */}
      <mesh position={[-ex + er * 0.3, ey + er * 0.35, ez + er * 0.7]} material={highlightMat}>
        <sphereGeometry args={[er * 0.32, 6, 5]} />
      </mesh>
      <mesh position={[ex + er * 0.3, ey + er * 0.35, ez + er * 0.7]} material={highlightMat}>
        <sphereGeometry args={[er * 0.32, 6, 5]} />
      </mesh>
      {/* Blush spots */}
      <mesh position={[-ex * 1.55, ey - er * 0.8, ez * 0.88]} rotation={[-0.15, 0, 0]} material={blushMat}>
        <sphereGeometry args={[er * 0.72, 6, 5]} />
      </mesh>
      <mesh position={[ex * 1.55, ey - er * 0.8, ez * 0.88]} rotation={[-0.15, 0, 0]} material={blushMat}>
        <sphereGeometry args={[er * 0.72, 6, 5]} />
      </mesh>
    </>
  );
}

// ── Main character component ───────────────────────────────────────────────
export function IsometricCharacter({
  gender = 'FEMALE',
  colors,
  hexSize,
  animated = true,
  facingAngle = 0,
  isMoving = false,
}: IsometricCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  // Animated limb refs
  const leftArmRef  = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef  = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);

  // Scale everything relative to hexSize so the character fits different tile sizes
  const s = hexSize * SCALE_FACTOR;

  // Geometry measurements — all ratios come from the assets config
  const headR    = s * PROPORTIONS.headR;
  const bodyH    = s * PROPORTIONS.bodyH;
  const bodyTopR = s * PROPORTIONS.bodyTopR;
  const bodyBotR = s * PROPORTIONS.bodyBotR;
  const armR     = s * PROPORTIONS.armR;
  const armH     = s * PROPORTIONS.armH;
  const legR     = s * PROPORTIONS.legR;
  const legH     = s * PROPORTIONS.legH;
  const footR    = s * PROPORTIONS.footR;

  // Vertical stacking: footY = footR so that the BOTTOM of each foot sphere is exactly at y=0.
  const footY = footR;
  const legY = footY + footR * 0.4 + legH / 2;
  const bodyY = legY + legH / 2 + bodyH / 2 - s * 0.05;
  const headY = bodyY + bodyH / 2 + headR * 0.72;

  // Shoulder pivot sits at the body-top outer edge; the arm HANGS DOWN from that pivot.
  // Placing the pivot at bodyTopR means the arm overlaps the body edge slightly — no gap.
  const shoulderY = bodyY + bodyH * 0.42;
  const armX = bodyTopR;

  // Color-reactive materials
  const { skinMat, primaryMat, secondaryMat } = React.useMemo(() => ({
    skinMat:      new THREE.MeshStandardMaterial({ color: colors?.skin      || '#c58b66', ...MATERIAL_PROPS.skin }),
    primaryMat:   new THREE.MeshStandardMaterial({ color: colors?.primary   || '#00A37A', ...MATERIAL_PROPS.primary }),
    secondaryMat: new THREE.MeshStandardMaterial({ color: colors?.secondary || '#F5F5F5', ...MATERIAL_PROPS.secondary }),
  }), [colors?.skin, colors?.primary, colors?.secondary]);
  React.useEffect(() => () => { skinMat.dispose(); primaryMat.dispose(); secondaryMat.dispose(); }, [skinMat, primaryMat, secondaryMat]);

  const darkMat = React.useMemo(() => new THREE.MeshStandardMaterial({ ...MATERIAL_PROPS.dark }), []);
  React.useEffect(() => () => darkMat.dispose(), [darkMat]);

  // Refs so useFrame always sees the latest prop values without needing re-subscription
  const facingAngleRef = useRef(facingAngle);
  facingAngleRef.current = facingAngle;
  const isMovingRef = useRef(isMoving);
  isMovingRef.current = isMoving;

  const timeRef     = useRef(0);
  const walkTimeRef = useRef(0);
  const currentAngleRef = useRef(facingAngle);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    // 1. Smooth facing rotation (shortest-path interpolation on Y axis)
    const target = facingAngleRef.current;
    let diff = target - currentAngleRef.current;
    while (diff >  Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    currentAngleRef.current += diff * Math.min(1, delta * 10);
    groupRef.current.rotation.y = currentAngleRef.current;

    if (!animated) return;

    if (isMovingRef.current) {
      // Walk cycle: arms and legs swing in opposition
      walkTimeRef.current += delta * 7;
      const swing = Math.sin(walkTimeRef.current) * 0.6;
      if (leftArmRef.current)  { leftArmRef.current.rotation.x  =  swing; leftArmRef.current.rotation.z  = -0.15; }
      if (rightArmRef.current) { rightArmRef.current.rotation.x = -swing; rightArmRef.current.rotation.z =  0.15; }
      if (leftLegRef.current)  leftLegRef.current.rotation.x  = -swing * 0.7;
      if (rightLegRef.current) rightLegRef.current.rotation.x =  swing * 0.7;
      // Subtle vertical bounce while walking
      groupRef.current.position.y = Math.abs(Math.sin(walkTimeRef.current * 2)) * s * 0.05;
      groupRef.current.rotation.z = 0;
    } else {
      // Exponential decay back to rest pose
      if (leftArmRef.current)  { leftArmRef.current.rotation.x  *= 0.82; leftArmRef.current.rotation.z  = -0.22; }
      if (rightArmRef.current) { rightArmRef.current.rotation.x *= 0.82; rightArmRef.current.rotation.z =  0.22; }
      if (leftLegRef.current)  leftLegRef.current.rotation.x  *= 0.82;
      if (rightLegRef.current) rightLegRef.current.rotation.x *= 0.82;
      // Idle bob + sway
      timeRef.current += delta;
      const bob  = Math.sin(timeRef.current * PROPORTIONS.bobSpeed)  * s * PROPORTIONS.bobAmp;
      const sway = Math.sin(timeRef.current * PROPORTIONS.swaySpeed) * PROPORTIONS.swayAmp;
      groupRef.current.position.y = bob;
      groupRef.current.rotation.z = sway;
    }
  });

  return (
    <group ref={groupRef} frustumCulled={false}>

      {/* ── Left Leg + Foot (animated as one group) ── */}
      <group ref={leftLegRef} frustumCulled={false} position={[-legR * 1.05, legY, 0]}>
        <mesh frustumCulled={false} material={secondaryMat}>
          <cylinderGeometry args={[legR, legR * 1.1, legH, 8]} />
        </mesh>
        {/* Foot — offset below leg center */}
        <mesh frustumCulled={false} position={[0, -(legH / 2 + footR * 0.4), 0]} material={darkMat}>
          <sphereGeometry args={[footR, 8, 6]} />
        </mesh>
      </group>

      {/* ── Right Leg + Foot ── */}
      <group ref={rightLegRef} frustumCulled={false} position={[legR * 1.05, legY, 0]}>
        <mesh frustumCulled={false} material={secondaryMat}>
          <cylinderGeometry args={[legR, legR * 1.1, legH, 8]} />
        </mesh>
        <mesh frustumCulled={false} position={[0, -(legH / 2 + footR * 0.4), 0]} material={darkMat}>
          <sphereGeometry args={[footR, 8, 6]} />
        </mesh>
      </group>

      {/* ── Torso / Body ── */}
      <mesh frustumCulled={false} position={[0, bodyY, 0]} material={primaryMat}>
        <cylinderGeometry args={[bodyTopR, bodyBotR, bodyH, 10]} />
      </mesh>

      {/* Belt / trim stripe */}
      <mesh frustumCulled={false} position={[0, bodyY - bodyH * 0.28, 0]} material={secondaryMat}>
        <cylinderGeometry args={[bodyBotR + s * 0.02, bodyBotR + s * 0.02, s * 0.18, 10]} />
      </mesh>

      {/* ── Left Arm — pivot IS the shoulder joint; arm hangs down from it ── */}
      <group ref={leftArmRef} frustumCulled={false} position={[-armX, shoulderY, 0]}>
        {/* Shoulder cap — skin-coloured sphere fills junction with body */}
        <mesh frustumCulled={false} material={skinMat}>
          <sphereGeometry args={[armR * 1.35, 8, 6]} />
        </mesh>
        {/* Sleeve — hangs down from shoulder pivot */}
        <mesh frustumCulled={false} position={[0, -armH / 2, 0]} material={primaryMat}>
          <cylinderGeometry args={[armR, armR * 0.9, armH, 8]} />
        </mesh>
        {/* Hand */}
        <mesh frustumCulled={false} position={[0, -armH - armR * 0.55, 0]} material={skinMat}>
          <sphereGeometry args={[armR * 1.15, 8, 6]} />
        </mesh>
      </group>

      {/* ── Right Arm ── */}
      <group ref={rightArmRef} frustumCulled={false} position={[armX, shoulderY, 0]}>
        <mesh frustumCulled={false} material={skinMat}>
          <sphereGeometry args={[armR * 1.35, 8, 6]} />
        </mesh>
        <mesh frustumCulled={false} position={[0, -armH / 2, 0]} material={primaryMat}>
          <cylinderGeometry args={[armR, armR * 0.9, armH, 8]} />
        </mesh>
        <mesh frustumCulled={false} position={[0, -armH - armR * 0.55, 0]} material={skinMat}>
          <sphereGeometry args={[armR * 1.15, 8, 6]} />
        </mesh>
      </group>

      {/* ── Neck ── */}
      <mesh frustumCulled={false} position={[0, bodyY + bodyH / 2 + s * 0.12, 0]} material={skinMat}>
        <cylinderGeometry args={[s * 0.28, s * 0.32, s * 0.3, 8]} />
      </mesh>

      {/* ── Head ── */}
      <group frustumCulled={false} position={[0, headY, 0]}>
        <mesh frustumCulled={false} material={skinMat}>
          <sphereGeometry args={[headR, 16, 12]} />
        </mesh>

        {gender === 'MALE' ? (
          <MaleHair r={headR} primaryColor={colors?.primary || '#00A37A'} />
        ) : (
          <FemaleHair r={headR} primaryColor={colors?.primary || '#00A37A'} />
        )}

        <Eyes headR={headR} skinColor={colors?.skin || '#c58b66'} />

        {/* Smile — upward-facing arc (torus rotated so open end faces down) */}
        <mesh frustumCulled={false} position={[0, -headR * 0.2, headR * 0.92]} rotation={[0.2, 0, Math.PI]} material={darkMat}>
          <torusGeometry args={[headR * 0.14, headR * 0.038, 6, 10, Math.PI]} />
        </mesh>
      </group>

    </group>
  );
}
