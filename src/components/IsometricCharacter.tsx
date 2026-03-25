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

/** Alias of Archetype — CharacterGender kept for legacy import compatibility. */
export type CharacterGender = Archetype;

interface IsometricCharacterProps {
  gender?: CharacterGender;
  colors: AvatarColors;
  hexSize: number;
  /** When true, plays an idle bobbing animation. Default true. */
  animated?: boolean;
}

// ── Shared material cache — avoids creating new materials every render ─────
function useMat(color: string, roughness = 0.6, metalness = 0.1) {
  return React.useMemo(
    () => new THREE.MeshStandardMaterial({ color, roughness, metalness }),
    [color, roughness, metalness],
  );
}

// ── Male hair: three spiky wedges on top of the head ──────────────────────
function MaleHair({ r, primaryColor }: { r: number; primaryColor: string }) {
  const mat = useMat(primaryColor, 0.8, 0.0);
  const spikeH = r * 0.55;
  const spikeR = r * 0.22;
  const offsets: [number, number, number][] = [
    [0, r * 0.92, 0],
    [-r * 0.42, r * 0.74, 0],
    [r * 0.42, r * 0.74, 0],
  ];
  const rotations: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, 0.45],
    [0, 0, -0.45],
  ];
  return (
    <>
      {offsets.map((pos, i) => (
        <mesh key={i} position={pos} rotation={rotations[i]} material={mat}>
          <coneGeometry args={[spikeR, spikeH, 5]} />
        </mesh>
      ))}
    </>
  );
}

// ── Female hair: rounded buns on either side + larger top sphere ──────────
function FemaleHair({ r, primaryColor }: { r: number; primaryColor: string }) {
  const mat = useMat(primaryColor, 0.7, 0.0);
  const bunR = r * 0.38;
  return (
    <>
      {/* Top bun */}
      <mesh position={[0, r * 0.9, 0]} material={mat}>
        <sphereGeometry args={[bunR, 10, 8]} />
      </mesh>
      {/* Left bun */}
      <mesh position={[-r * 0.82, r * 0.45, 0]} material={mat}>
        <sphereGeometry args={[bunR * 0.78, 10, 8]} />
      </mesh>
      {/* Right bun */}
      <mesh position={[r * 0.82, r * 0.45, 0]} material={mat}>
        <sphereGeometry args={[bunR * 0.78, 10, 8]} />
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
  return (
    <>
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
}: IsometricCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Scale everything relative to hexSize so the character fits different tile sizes
  const s = hexSize * 0.32; // base scale — slightly larger for better visibility

  // Geometry measurements
  const headR = s * 1.18;      // big Pokémon head
  const bodyH = s * 1.0;
  const bodyTopR = s * 0.72;
  const bodyBotR = s * 0.82;
  const armR = s * 0.22;
  const armH = s * 0.72;
  const legR = s * 0.26;
  const legH = s * 0.7;
  const footR = s * 0.3;

  // Vertical stacking: footY = footR so that the BOTTOM of each foot sphere is exactly at y=0.
  // This means no negative-Y geometry → GameAvatarFootAnchor never needs to compensate,
  // and the character stands cleanly on the tile surface.
  const footY = footR;
  const legY = footY + footR * 0.4 + legH / 2;
  const bodyY = legY + legH / 2 + bodyH / 2 - s * 0.05;
  const headY = bodyY + bodyH / 2 + headR * 0.72;

  // Materials — all four in one useMemo so only one memo entry is tracked
  const { skinMat, primaryMat, secondaryMat, darkMat } = React.useMemo(() => ({
    skinMat:      new THREE.MeshStandardMaterial({ color: colors?.skin      || '#c58b66', roughness: 0.65, metalness: 0.05 }),
    primaryMat:   new THREE.MeshStandardMaterial({ color: colors?.primary   || '#00A37A', roughness: 0.55, metalness: 0.15 }),
    secondaryMat: new THREE.MeshStandardMaterial({ color: colors?.secondary || '#F5F5F5', roughness: 0.5,  metalness: 0.2  }),
    darkMat:      new THREE.MeshStandardMaterial({ color: '#1a1a2e',                      roughness: 0.8,  metalness: 0.1  }),
  }), [colors?.skin, colors?.primary, colors?.secondary]);

  // Idle animation: gentle vertical bob + subtle sway
  const timeRef = useRef(0);
  useFrame((_, delta) => {
    if (!animated || !groupRef.current) return;
    timeRef.current += delta;
    const bob = Math.sin(timeRef.current * 2.2) * s * 0.08;
    const sway = Math.sin(timeRef.current * 1.1) * 0.015;
    groupRef.current.position.y = bob;
    groupRef.current.rotation.z = sway;
  });

  return (
    // frustumCulled={false} on the root group AND on each mesh guarantees the character
    // is always rendered even before the camera has centered on the hero (first frame).
    <group ref={groupRef} frustumCulled={false}>

      {/* ── Feet / Boots ── */}
      <mesh frustumCulled={false} position={[-legR * 1.05, footY, 0]} material={darkMat}>
        <sphereGeometry args={[footR, 8, 6]} />
      </mesh>
      <mesh frustumCulled={false} position={[legR * 1.05, footY, 0]} material={darkMat}>
        <sphereGeometry args={[footR, 8, 6]} />
      </mesh>

      {/* ── Legs ── */}
      <mesh frustumCulled={false} position={[-legR * 1.05, legY, 0]} material={secondaryMat}>
        <cylinderGeometry args={[legR, legR * 1.1, legH, 8]} />
      </mesh>
      <mesh frustumCulled={false} position={[legR * 1.05, legY, 0]} material={secondaryMat}>
        <cylinderGeometry args={[legR, legR * 1.1, legH, 8]} />
      </mesh>

      {/* ── Torso / Body ── */}
      <mesh frustumCulled={false} position={[0, bodyY, 0]} material={primaryMat}>
        <cylinderGeometry args={[bodyTopR, bodyBotR, bodyH, 10]} />
      </mesh>

      {/* Belt / trim stripe */}
      <mesh frustumCulled={false} position={[0, bodyY - bodyH * 0.28, 0]} material={secondaryMat}>
        <cylinderGeometry args={[bodyBotR + s * 0.02, bodyBotR + s * 0.02, s * 0.18, 10]} />
      </mesh>

      {/* ── Arms ── */}
      <group frustumCulled={false} position={[-bodyTopR * 1.1, bodyY + bodyH * 0.2, 0]} rotation={[0, 0, 0.3]}>
        <mesh frustumCulled={false} material={primaryMat}>
          <cylinderGeometry args={[armR, armR * 0.9, armH, 8]} />
        </mesh>
        <mesh frustumCulled={false} position={[0, -armH / 2 - armR * 0.6, 0]} material={skinMat}>
          <sphereGeometry args={[armR * 1.1, 8, 6]} />
        </mesh>
      </group>
      <group frustumCulled={false} position={[bodyTopR * 1.1, bodyY + bodyH * 0.2, 0]} rotation={[0, 0, -0.3]}>
        <mesh frustumCulled={false} material={primaryMat}>
          <cylinderGeometry args={[armR, armR * 0.9, armH, 8]} />
        </mesh>
        <mesh frustumCulled={false} position={[0, -armH / 2 - armR * 0.6, 0]} material={skinMat}>
          <sphereGeometry args={[armR * 1.1, 8, 6]} />
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

        {/* Mouth */}
        <mesh frustumCulled={false} position={[0, -headR * 0.18, headR * 0.91]} rotation={[0.2, 0, 0]} material={darkMat}>
          <torusGeometry args={[headR * 0.18, headR * 0.045, 6, 10, Math.PI]} />
        </mesh>
      </group>

    </group>
  );
}
