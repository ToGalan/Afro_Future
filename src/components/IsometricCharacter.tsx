/**
 * IsometricCharacter — Faction-aware Pokémon/chibi-style 3D player character.
 * Six distinct designs: PAA / ASF / WC × MALE / FEMALE.
 *
 * All meshes use inline <meshStandardMaterial> children (NOT material={} prop) for
 * reliable R3F 8.x rendering. Pre-created materials via the material prop are silently
 * ignored in some R3F versions; inline children are always attached correctly.
 *
 * Limbs use hip/shoulder pivot groups for walk-cycle animation.
 */

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { AvatarColors } from '../services/avatarConfig';
import type { Archetype } from '../types/loadout';

export type CharacterGender = Archetype;

interface IsometricCharacterProps {
  gender?:      CharacterGender;
  colors:       AvatarColors;
  hexSize:      number;
  faction?:     string;
  /** Set true while the hero is moving — drives the walk cycle. */
  isMoving?:    boolean;
  /** Y-axis rotation (radians) toward movement direction. */
  facingAngle?: number;
  animated?:    boolean;
  /** Walk-cycle playback-rate multiplier — driven by the SPD stat so faster heroes
   *  visibly move their legs/arms quicker (1 = baseline cadence). */
  speedMult?:   number;
  /** Increment to fire a one-shot attack swing (right-arm wind-up → strike → recovery).
   *  Only the delta between renders matters — the actual number is meaningless. */
  attackTrigger?: number;
  /** Increment to fire a one-shot hit-reaction flinch (brief backward recoil). */
  hitTrigger?:    number;
}

// ── One-shot attack swing (right arm) — normalized progress p ∈ [0,1] over ATTACK_DURATION.
// Wind-up (pull back) → fast strike snap → eased recovery to rest. Exported so the GLB/
// assembled-parts avatar paths (GameAvatarMesh.tsx) can reuse the identical shape.
export const ATTACK_DURATION = 0.42;
export function attackSwingCurve(p: number): number {
  if (p < 0.3) { const w = p / 0.3; return -0.5 * (1 - Math.cos(w * Math.PI / 2)); }
  if (p < 0.55) { const s = (p - 0.3) / 0.25; return -0.5 + 1.9 * (1 - Math.pow(1 - s, 3)); }
  const r = Math.min(1, (p - 0.55) / 0.45);
  return 1.4 * (1 - (1 - Math.pow(1 - r, 2)));
}

// ── One-shot hit-reaction flinch (whole body) — quick recoil in, slower settle out.
export const HIT_DURATION = 0.24;
export function hitFlinchCurve(p: number): number {
  return p < 0.35 ? p / 0.35 : 1 - (p - 0.35) / 0.65;
}

function darken(hex: string, amount: number): string {
  try {
    const c = new THREE.Color(hex);
    c.r = Math.max(0, c.r - amount);
    c.g = Math.max(0, c.g - amount);
    c.b = Math.max(0, c.b - amount);
    return '#' + c.getHexString();
  } catch { return hex; }
}

// ─── Eyes — no spectacles, eyebrows instead ────────────────────────────────
function Eyes({ headR }: { headR: number }) {
  const sr = headR * 0.21;
  const ex = headR * 0.34;
  const ey = headR * 0.10;
  // Center inside the head so the sphere naturally pokes through the surface
  const ez = headR * 0.80;

  return (
    <>
      {([-1, 1] as const).map(side => (
        <group key={side} position={[side * ex, ey, ez]} frustumCulled={false}>
          {/* Kawaii iris — large dark sphere embedded in face */}
          <mesh frustumCulled={false}>
            <sphereGeometry args={[sr * 0.82, 12, 10]} />
            <meshStandardMaterial color="#1a1a2e" roughness={0.25} metalness={0.05} />
          </mesh>
          {/* Pupil */}
          <mesh position={[0, 0, sr * 0.58]} frustumCulled={false}>
            <sphereGeometry args={[sr * 0.44, 10, 8]} />
            <meshStandardMaterial color="#06060c" roughness={0.2} metalness={0} />
          </mesh>
          {/* Shine highlight */}
          <mesh position={[side * -sr * 0.24, sr * 0.28, sr * 0.72]} frustumCulled={false}>
            <sphereGeometry args={[sr * 0.17, 6, 6]} />
            <meshBasicMaterial color="white" />
          </mesh>
          {/* Eyebrow */}
          <mesh position={[0, sr * 1.08, sr * 0.55]} rotation={[0.28, 0, side * 0.12]} frustumCulled={false}>
            <boxGeometry args={[sr * 1.1, sr * 0.17, sr * 0.1]} />
            <meshStandardMaterial color="#151520" roughness={0.9} metalness={0} />
          </mesh>
        </group>
      ))}
    </>
  );
}

// ─── PAA Male Hair: Flat top + gold headband ───────────────────────────────
function PAAMaleHair({ headR, primary }: { headR: number; primary: string }) {
  const hair = darken(primary, 0.14);
  return (
    <>
      {/* Close-cropped sides */}
      <mesh position={[0, headR * 0.1, 0]} frustumCulled={false}>
        <sphereGeometry args={[headR * 1.03, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.44]} />
        <meshStandardMaterial color={hair} roughness={0.95} metalness={0} />
      </mesh>
      {/* Flat top platform */}
      <mesh position={[0, headR * 0.49, 0]} frustumCulled={false}>
        <cylinderGeometry args={[headR * 0.82, headR * 0.9, headR * 0.1, 12]} />
        <meshStandardMaterial color={hair} roughness={0.92} metalness={0} />
      </mesh>
    </>
  );
}

// ─── PAA Female Hair: Ponytail + plaits + gold adornments ──────────────────
function PAAFemaleHair({ headR, primary }: { headR: number; primary: string }) {
  const hair = darken(primary, 0.14);
  return (
    <>
      {/* Base hair cap */}
      <mesh position={[0, headR * 0.14, 0]} frustumCulled={false}>
        <sphereGeometry args={[headR * 1.04, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshStandardMaterial color={hair} roughness={0.95} metalness={0} />
      </mesh>
      {/* Ponytail gather */}
      <mesh position={[0, headR * 0.66, -headR * 0.64]} rotation={[0.5, 0, 0]} frustumCulled={false}>
        <sphereGeometry args={[headR * 0.28, 8, 6]} />
        <meshStandardMaterial color={hair} roughness={0.95} metalness={0} />
      </mesh>
      {/* Ponytail shaft */}
      <mesh position={[0, headR * 0.28, -headR * 1.1]} rotation={[0.6, 0, 0]} frustumCulled={false}>
        <cylinderGeometry args={[headR * 0.18, headR * 0.1, headR * 0.9, 8]} />
        <meshStandardMaterial color={hair} roughness={0.95} metalness={0} />
      </mesh>
      {/* Ponytail tip */}
      <mesh position={[0, headR * 0.0, -headR * 1.6]} frustumCulled={false}>
        <sphereGeometry args={[headR * 0.12, 6, 5]} />
        <meshStandardMaterial color={hair} roughness={0.95} metalness={0} />
      </mesh>
      {/* Left plaits */}
      {([0, 1, 2] as const).map(i => (
        <mesh key={i} position={[-headR * 0.78, headR * (-0.08 - i * 0.32), headR * (0.34 - i * 0.1)]} rotation={[0.15, 0, 0.12]} frustumCulled={false}>
          <cylinderGeometry args={[headR * 0.1, headR * 0.08, headR * 0.35, 5]} />
          <meshStandardMaterial color={hair} roughness={0.9} metalness={0} />
        </mesh>
      ))}
      {/* Right plaits */}
      {([0, 1, 2] as const).map(i => (
        <mesh key={i} position={[headR * 0.78, headR * (-0.08 - i * 0.32), headR * (0.34 - i * 0.1)]} rotation={[0.15, 0, -0.12]} frustumCulled={false}>
          <cylinderGeometry args={[headR * 0.1, headR * 0.08, headR * 0.35, 5]} />
          <meshStandardMaterial color={hair} roughness={0.9} metalness={0} />
        </mesh>
      ))}
    </>
  );
}

// ─── ASF Male Hair: Flat top + beret + insignia ────────────────────────────
function ASFMaleHair({ headR, primary, secondary }: { headR: number; primary: string; secondary: string }) {
  return (
    <>
      {/* Flat cropped sides */}
      <mesh position={[0, headR * 0.12, 0]} frustumCulled={false}>
        <sphereGeometry args={[headR * 1.04, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.46]} />
        <meshStandardMaterial color="#1a0c04" roughness={0.9} metalness={0} />
      </mesh>
      {/* Flat top */}
      <mesh position={[0, headR * 0.52, 0]} frustumCulled={false}>
        <cylinderGeometry args={[headR * 0.82, headR * 0.9, headR * 0.1, 12]} />
        <meshStandardMaterial color="#1a0c04" roughness={0.9} metalness={0} />
      </mesh>
      {/* Beret tilted to right */}
      <mesh position={[headR * 0.16, headR * 0.6, 0]} rotation={[0, 0, -0.2]} frustumCulled={false}>
        <cylinderGeometry args={[headR * 0.9, headR * 0.93, headR * 0.15, 12]} />
        <meshStandardMaterial color={secondary} roughness={0.8} metalness={0.05} />
      </mesh>
      {/* Beret dome */}
      <mesh position={[headR * 0.3, headR * 0.74, 0]} rotation={[0, 0, -0.18]} frustumCulled={false}>
        <sphereGeometry args={[headR * 0.62, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshStandardMaterial color={secondary} roughness={0.8} metalness={0.05} />
      </mesh>
      {/* Faction badge */}
      <mesh position={[-headR * 0.44, headR * 0.72, headR * 0.52]} frustumCulled={false}>
        <cylinderGeometry args={[headR * 0.13, headR * 0.13, headR * 0.06, 8]} />
        <meshStandardMaterial color={primary} roughness={0.3} metalness={0.5} />
      </mesh>
      <mesh position={[-headR * 0.44, headR * 0.76, headR * 0.56]} frustumCulled={false}>
        <cylinderGeometry args={[headR * 0.065, headR * 0.065, headR * 0.04, 5]} />
        <meshStandardMaterial color="#f5c518" roughness={0.2} metalness={0.6} />
      </mesh>
    </>
  );
}

// ─── ASF Female Hair: Ponytail + plaits + tactical headband ────────────────
function ASFFemaleHair({ headR }: { headR: number }) {
  const hair = '#1a0c04';
  return (
    <>
      {/* Base hair cap */}
      <mesh position={[0, headR * 0.14, -headR * 0.06]} frustumCulled={false}>
        <sphereGeometry args={[headR * 1.03, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshStandardMaterial color={hair} roughness={0.88} metalness={0} />
      </mesh>
      {/* Ponytail gather */}
      <mesh position={[0, headR * 0.6, -headR * 0.62]} rotation={[0.5, 0, 0]} frustumCulled={false}>
        <sphereGeometry args={[headR * 0.26, 8, 6]} />
        <meshStandardMaterial color={hair} roughness={0.88} metalness={0} />
      </mesh>
      {/* Ponytail shaft */}
      <mesh position={[0, headR * 0.24, -headR * 1.08]} rotation={[0.6, 0, 0]} frustumCulled={false}>
        <cylinderGeometry args={[headR * 0.17, headR * 0.09, headR * 0.86, 8]} />
        <meshStandardMaterial color={hair} roughness={0.88} metalness={0} />
      </mesh>
      {/* Ponytail tip */}
      <mesh position={[0, headR * 0.0, -headR * 1.55]} frustumCulled={false}>
        <sphereGeometry args={[headR * 0.11, 6, 5]} />
        <meshStandardMaterial color={hair} roughness={0.88} metalness={0} />
      </mesh>
      {/* Left plaits */}
      {([0, 1, 2] as const).map(i => (
        <mesh key={i} position={[-headR * 0.76, headR * (-0.06 - i * 0.3), headR * (0.3 - i * 0.1)]} rotation={[0.15, 0, 0.1]} frustumCulled={false}>
          <cylinderGeometry args={[headR * 0.09, headR * 0.07, headR * 0.33, 5]} />
          <meshStandardMaterial color={hair} roughness={0.88} metalness={0} />
        </mesh>
      ))}
      {/* Right plaits */}
      {([0, 1, 2] as const).map(i => (
        <mesh key={i} position={[headR * 0.76, headR * (-0.06 - i * 0.3), headR * (0.3 - i * 0.1)]} rotation={[0.15, 0, -0.1]} frustumCulled={false}>
          <cylinderGeometry args={[headR * 0.09, headR * 0.07, headR * 0.33, 5]} />
          <meshStandardMaterial color={hair} roughness={0.88} metalness={0} />
        </mesh>
      ))}
    </>
  );
}

// ─── WC Male Hair: Flat top + tech implant ─────────────────────────────────
function WCMaleHair({ headR, primary }: { headR: number; primary: string }) {
  return (
    <>
      {/* Flat cropped sides */}
      <mesh position={[0, headR * 0.12, 0]} frustumCulled={false}>
        <sphereGeometry args={[headR * 1.03, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.44]} />
        <meshStandardMaterial color="#12121e" roughness={0.75} metalness={0.05} />
      </mesh>
      {/* Flat top */}
      <mesh position={[0, headR * 0.5, 0]} frustumCulled={false}>
        <cylinderGeometry args={[headR * 0.82, headR * 0.88, headR * 0.1, 12]} />
        <meshStandardMaterial color="#12121e" roughness={0.72} metalness={0.05} />
      </mesh>
      {/* Tech temple implant */}
      <mesh position={[headR * 1.1, headR * 0.04, headR * 0.28]} frustumCulled={false}>
        <boxGeometry args={[headR * 0.11, headR * 0.22, headR * 0.1]} />
        <meshStandardMaterial color={primary} roughness={0.2} metalness={0.7} />
      </mesh>
      {/* Implant antenna */}
      <mesh position={[headR * 1.15, headR * 0.24, headR * 0.26]} rotation={[0, 0, 0.1]} frustumCulled={false}>
        <cylinderGeometry args={[headR * 0.03, headR * 0.02, headR * 0.3, 5]} />
        <meshStandardMaterial color={primary} roughness={0.2} metalness={0.7} />
      </mesh>
      {/* Glowing implant tip */}
      <mesh position={[headR * 1.16, headR * 0.41, headR * 0.26]} frustumCulled={false}>
        <sphereGeometry args={[headR * 0.05, 5, 4]} />
        <meshStandardMaterial color="#00ffff" roughness={0} metalness={0} emissive="#00ffff" emissiveIntensity={0.9} />
      </mesh>
    </>
  );
}

// ─── WC Female Hair: Ponytail + plaits + glowing ring ──────────────────────
function WCFemaleHair({ headR, secondary }: { headR: number; secondary: string }) {
  const hair = '#12121e';
  return (
    <>
      {/* Base smooth hair cap */}
      <mesh position={[0, headR * 0.16, 0]} frustumCulled={false}>
        <sphereGeometry args={[headR * 1.04, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshStandardMaterial color={hair} roughness={0.75} metalness={0.05} />
      </mesh>
      {/* Ponytail gather */}
      <mesh position={[0, headR * 0.7, -headR * 0.66]} rotation={[0.5, 0, 0]} frustumCulled={false}>
        <sphereGeometry args={[headR * 0.28, 8, 6]} />
        <meshStandardMaterial color={hair} roughness={0.75} metalness={0.05} />
      </mesh>
      {/* Ponytail shaft */}
      <mesh position={[0, headR * 0.3, -headR * 1.12]} rotation={[0.6, 0, 0]} frustumCulled={false}>
        <cylinderGeometry args={[headR * 0.18, headR * 0.1, headR * 0.92, 8]} />
        <meshStandardMaterial color={hair} roughness={0.75} metalness={0.05} />
      </mesh>
      {/* Ponytail tip */}
      <mesh position={[0, headR * 0.02, -headR * 1.62]} frustumCulled={false}>
        <sphereGeometry args={[headR * 0.12, 6, 5]} />
        <meshStandardMaterial color={hair} roughness={0.75} metalness={0.05} />
      </mesh>
      {/* Left plaits */}
      {([0, 1, 2] as const).map(i => (
        <mesh key={i} position={[-headR * 0.78, headR * (-0.08 - i * 0.3), headR * (0.32 - i * 0.1)]} rotation={[0.15, 0, 0.12]} frustumCulled={false}>
          <cylinderGeometry args={[headR * 0.1, headR * 0.08, headR * 0.33, 5]} />
          <meshStandardMaterial color={hair} roughness={0.75} metalness={0.05} />
        </mesh>
      ))}
      {/* Right plaits */}
      {([0, 1, 2] as const).map(i => (
        <mesh key={i} position={[headR * 0.78, headR * (-0.08 - i * 0.3), headR * (0.32 - i * 0.1)]} rotation={[0.15, 0, -0.12]} frustumCulled={false}>
          <cylinderGeometry args={[headR * 0.1, headR * 0.08, headR * 0.33, 5]} />
          <meshStandardMaterial color={hair} roughness={0.75} metalness={0.05} />
        </mesh>
      ))}
      {/* Side tech strips */}
      {([-1, 1] as const).map(side => (
        <mesh key={side} position={[side * headR * 1.01, headR * 0.04, headR * 0.3]} frustumCulled={false}>
          <boxGeometry args={[headR * 0.068, headR * 0.18, headR * 0.12]} />
          <meshStandardMaterial color={secondary} roughness={0.2} metalness={0.6} />
        </mesh>
      ))}
    </>
  );
}

// ─── Faction outfit overlays ────────────────────────────────────────────────
function PAAOutfit({ s, bodyY, bodyH, secondary }: { s: number; bodyY: number; bodyH: number; secondary: string }) {
  return (
    <>
      {/* Sash/diagonal band */}
      <mesh position={[0, bodyY + bodyH * 0.08, 0]} rotation={[0, 0, 0.48]} frustumCulled={false}>
        <cylinderGeometry args={[s * 0.86, s * 0.86, s * 0.11, 8, 1, true]} />
        <meshStandardMaterial color={secondary} roughness={0.24} metalness={0.65} side={THREE.DoubleSide} />
      </mesh>
      {/* Chest amulet */}
      <mesh position={[0, bodyY + bodyH * 0.24, s * 0.74]} frustumCulled={false}>
        <octahedronGeometry args={[s * 0.11, 0]} />
        <meshStandardMaterial color={secondary} roughness={0.24} metalness={0.65} />
      </mesh>
      {/* Shoulder pads */}
      {([-1, 1] as const).map(side => (
        <mesh key={side} position={[side * s * 0.8, bodyY + bodyH * 0.4, 0]} frustumCulled={false}>
          <sphereGeometry args={[s * 0.21, 8, 6]} />
          <meshStandardMaterial color="#0d3d24" roughness={0.65} metalness={0.1} />
        </mesh>
      ))}
    </>
  );
}

function ASFOutfit({ s, bodyY, bodyH, primary, secondary }: { s: number; bodyY: number; bodyH: number; primary: string; secondary: string }) {
  return (
    <>
      {/* Chest armor plate */}
      <mesh position={[0, bodyY + bodyH * 0.26, s * 0.7]} frustumCulled={false}>
        <boxGeometry args={[s * 0.88, s * 0.44, s * 0.13]} />
        <meshStandardMaterial color={primary} roughness={0.38} metalness={0.42} />
      </mesh>
      {/* Center ridge */}
      <mesh position={[0, bodyY + bodyH * 0.28, s * 0.77]} frustumCulled={false}>
        <boxGeometry args={[s * 0.12, s * 0.38, s * 0.06]} />
        <meshStandardMaterial color={darken(primary, 0.1)} roughness={0.3} metalness={0.55} />
      </mesh>
      {/* Shoulder armor */}
      {([-1, 1] as const).map(side => (
        <group key={side} position={[side * s * 0.8, bodyY + bodyH * 0.4, 0]} frustumCulled={false}>
          <mesh frustumCulled={false}>
            <boxGeometry args={[s * 0.3, s * 0.17, s * 0.3]} />
            <meshStandardMaterial color={primary} roughness={0.38} metalness={0.42} />
          </mesh>
          <mesh position={[0, s * 0.13, 0]} frustumCulled={false}>
            <boxGeometry args={[s * 0.24, s * 0.09, s * 0.25]} />
            <meshStandardMaterial color={secondary} roughness={0.72} metalness={0.18} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function WCOutfit({ s, bodyY, bodyH, primary }: { s: number; bodyY: number; bodyH: number; primary: string }) {
  return (
    <>
      {/* Collar */}
      <mesh position={[0, bodyY + bodyH * 0.42, s * 0.6]} frustumCulled={false}>
        <boxGeometry args={[s * 0.4, s * 0.26, s * 0.1]} />
        <meshStandardMaterial color="#f0f4ff" roughness={0.72} metalness={0.04} />
      </mesh>
      {/* Left lapel */}
      <mesh position={[-s * 0.22, bodyY + bodyH * 0.22, s * 0.66]} rotation={[0, 0, 0.38]} frustumCulled={false}>
        <boxGeometry args={[s * 0.17, s * 0.34, s * 0.09]} />
        <meshStandardMaterial color="#f0f4ff" roughness={0.72} metalness={0.04} />
      </mesh>
      {/* Right lapel */}
      <mesh position={[s * 0.22, bodyY + bodyH * 0.22, s * 0.66]} rotation={[0, 0, -0.38]} frustumCulled={false}>
        <boxGeometry args={[s * 0.17, s * 0.34, s * 0.09]} />
        <meshStandardMaterial color="#f0f4ff" roughness={0.72} metalness={0.04} />
      </mesh>
      {/* Tech badge */}
      <mesh position={[-s * 0.44, bodyY + bodyH * 0.28, s * 0.7]} frustumCulled={false}>
        <boxGeometry args={[s * 0.13, s * 0.11, s * 0.07]} />
        <meshStandardMaterial color={primary} roughness={0.22} metalness={0.65} />
      </mesh>
      {/* Wrist device */}
      <mesh position={[s * 0.9, bodyY - bodyH * 0.2, s * 0.18]} rotation={[0, 0, 0.28]} frustumCulled={false}>
        <boxGeometry args={[s * 0.18, s * 0.1, s * 0.18]} />
        <meshStandardMaterial color={primary} roughness={0.22} metalness={0.65} />
      </mesh>
    </>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────
export function IsometricCharacter({
  gender      = 'FEMALE',
  colors,
  hexSize,
  faction,
  isMoving    = false,
  facingAngle,
  animated    = true,
  speedMult   = 1,
  attackTrigger,
  hitTrigger,
}: IsometricCharacterProps) {
  const groupRef    = useRef<THREE.Group>(null);
  const leftLegRef  = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const leftArmRef  = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);

  // One-shot triggers: only the DELTA matters, so a ref remembers the last seen value
  // and a fresh "start time" (timeRef.current at the moment it changed) drives the curve.
  const lastAttackTriggerRef = useRef(attackTrigger);
  const attackStartRef = useRef<number | null>(null);
  const lastHitTriggerRef = useRef(hitTrigger);
  const hitStartRef = useRef<number | null>(null);

  // ── Proportions ───────────────────────────────────────────────────────
  const s         = hexSize * 0.38;   // slightly larger than 0.32 for visibility
  const footR     = s * 0.30;
  const footY     = footR;
  const legR      = s * 0.24;
  const legH      = s * 0.58;
  const legSep    = legR * 1.30;
  const ankleY    = footY + footR * 0.28;
  const bodyBotY  = ankleY + legH;
  const bodyH     = s * 0.90;
  const bodyTopR  = s * 0.70;
  const bodyBotR  = s * 0.82;
  const bodyY     = bodyBotY + bodyH / 2;
  const bodyTopY  = bodyBotY + bodyH;
  const armR      = s * 0.20;
  const armH      = s * 0.68;
  const armX      = bodyTopR + armR * 0.85;
  const handR     = armR * 1.15;
  const neckH     = s * 0.16;
  const neckY     = bodyTopY + neckH / 2;
  const headR     = s * 1.28;
  const headY     = bodyTopY + neckH + headR * 0.70;

  // Leg geometry in group-local space (pivot = bodyBotY)
  const legCylY  = -legH / 2;
  const kneeLY   = -legH * 0.20;
  const footGrpY = -(legH + footR * 0.28);
  const toeGrpY  = -legH;

  // ── Faction detection ─────────────────────────────────────────────────
  const fac = (faction ?? '').toUpperCase();
  const det: 'PAA' | 'ASF' | 'WC' =
    fac === 'PAA' ? 'PAA' :
    fac === 'ASF' ? 'ASF' :
    fac === 'WC'  ? 'WC'  :
    (colors.primary || '').toLowerCase().includes('a3') ? 'PAA' :
    (colors.primary || '').toLowerCase().includes('c7') ? 'ASF' : 'WC';


  const skinC     = colors?.skin      || '#c58b66';
  const primaryC  = colors?.primary   || '#00A37A';
  const secC      = colors?.secondary || '#D4AF37';
  const darkSkinC = darken(skinC, 0.18);
  const armTilt   = gender === 'FEMALE' ? 0.10 : 0.12;

  // ── Animation ─────────────────────────────────────────────────────────
  const timeRef = useRef(0);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    timeRef.current += delta;
    const t = timeRef.current;

    // Turn toward the movement direction via shortest-path angle easing instead of
    // snapping instantly, so direction changes read as a turn rather than a hard flip.
    if (facingAngle !== undefined) {
      const g = groupRef.current;
      let d = ((facingAngle - g.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      const rotK = 1 - Math.exp(-18 * Math.min(0.05, delta));
      g.rotation.y += d * rotK;
    }

    // Frame-rate-independent easing for limb transitions (walk↔idle) — same decay
    // curve used for position/rotation smoothing elsewhere, so stopping/starting
    // reads as a blend rather than a pop.
    const limbK = 1 - Math.exp(-14 * Math.min(0.05, delta));

    if (isMoving && animated) {
      // Fluid walk cycle — arms and legs swing naturally; cadence scales with SPD.
      const freq  = 9.0 * speedMult;
      const phase = t * freq;
      const leg   =  Math.sin(phase) * 0.55;
      const arm   = -Math.sin(phase) * 0.42;

      if (leftLegRef.current)  leftLegRef.current.rotation.x  += (leg - leftLegRef.current.rotation.x) * limbK;
      if (rightLegRef.current) rightLegRef.current.rotation.x += (-leg - rightLegRef.current.rotation.x) * limbK;
      if (leftArmRef.current)  { leftArmRef.current.rotation.x += (arm - leftArmRef.current.rotation.x) * limbK; leftArmRef.current.rotation.z = armTilt; }
      if (rightArmRef.current) { rightArmRef.current.rotation.x += (-arm - rightArmRef.current.rotation.x) * limbK; rightArmRef.current.rotation.z = -armTilt; }

      // No Y bounce or Z sway — clean movement
      groupRef.current.position.y = 0;
      groupRef.current.rotation.z = 0;
    } else {
      // Idle: ease limbs back to rest instead of popping instantly.
      if (leftLegRef.current)  leftLegRef.current.rotation.x  *= (1 - limbK);
      if (rightLegRef.current) rightLegRef.current.rotation.x *= (1 - limbK);
      if (leftArmRef.current)  { leftArmRef.current.rotation.x *= (1 - limbK); leftArmRef.current.rotation.z = armTilt; }
      if (rightArmRef.current) { rightArmRef.current.rotation.x *= (1 - limbK); rightArmRef.current.rotation.z = -armTilt; }
      groupRef.current.position.y = 0;
      groupRef.current.rotation.z = 0;
    }

    // ── One-shot attack swing — overrides the right arm + adds a torso twist while
    // active; once it ends, the walk/idle easing above naturally blends the arm back
    // to rest from wherever the swing left it (no pop, no explicit reset needed).
    if (attackTrigger !== undefined && attackTrigger !== lastAttackTriggerRef.current) {
      lastAttackTriggerRef.current = attackTrigger;
      attackStartRef.current = t;
    }
    if (attackStartRef.current !== null) {
      const ap = (t - attackStartRef.current) / ATTACK_DURATION;
      if (ap < 1) {
        const swing = attackSwingCurve(ap);
        if (rightArmRef.current) rightArmRef.current.rotation.set(swing, 0, -armTilt * 0.4);
        groupRef.current.rotation.z = Math.sin(Math.min(1, ap) * Math.PI) * 0.1;
      } else {
        attackStartRef.current = null;
      }
    }

    // ── One-shot hit-reaction flinch — brief whole-body recoil (rotation.x is otherwise
    // untouched by walk/idle/facing, so it's free to use here without conflicts).
    if (hitTrigger !== undefined && hitTrigger !== lastHitTriggerRef.current) {
      lastHitTriggerRef.current = hitTrigger;
      hitStartRef.current = t;
    }
    if (hitStartRef.current !== null) {
      const hp = (t - hitStartRef.current) / HIT_DURATION;
      if (hp < 1) {
        groupRef.current.rotation.x = -hitFlinchCurve(hp) * 0.22;
      } else {
        groupRef.current.rotation.x = 0;
        hitStartRef.current = null;
      }
    }
  });

  return (
    <group ref={groupRef} name="IsometricCharacter-avatar" frustumCulled={false}>

      {/* ── LEGS — pivot groups at hip (bodyBotY) ── */}
      <group ref={leftLegRef} position={[-legSep, bodyBotY, 0]} frustumCulled={false}>
        <mesh position={[0, legCylY, 0]} castShadow frustumCulled={false}>
          <cylinderGeometry args={[legR * 0.85, legR, legH, 8]} />
          <meshStandardMaterial color={secC} roughness={0.55} metalness={0.12} />
        </mesh>
        <mesh position={[0, kneeLY, s * 0.05]} frustumCulled={false}>
          <sphereGeometry args={[legR * 0.58, 7, 5]} />
          <meshStandardMaterial color={primaryC} roughness={0.55} metalness={0.12} />
        </mesh>
        <mesh position={[0, footGrpY, s * 0.06]} castShadow frustumCulled={false}>
          <sphereGeometry args={[footR, 9, 7]} />
          <meshStandardMaterial color="#16161e" roughness={0.82} metalness={0.08} />
        </mesh>
        <mesh position={[0, toeGrpY, footR + s * 0.1]} frustumCulled={false}>
          <sphereGeometry args={[footR * 0.38, 6, 5]} />
          <meshStandardMaterial color={secC} roughness={0.45} metalness={0.35} />
        </mesh>
      </group>

      <group ref={rightLegRef} position={[legSep, bodyBotY, 0]} frustumCulled={false}>
        <mesh position={[0, legCylY, 0]} castShadow frustumCulled={false}>
          <cylinderGeometry args={[legR * 0.85, legR, legH, 8]} />
          <meshStandardMaterial color={secC} roughness={0.55} metalness={0.12} />
        </mesh>
        <mesh position={[0, kneeLY, s * 0.05]} frustumCulled={false}>
          <sphereGeometry args={[legR * 0.58, 7, 5]} />
          <meshStandardMaterial color={primaryC} roughness={0.55} metalness={0.12} />
        </mesh>
        <mesh position={[0, footGrpY, s * 0.06]} castShadow frustumCulled={false}>
          <sphereGeometry args={[footR, 9, 7]} />
          <meshStandardMaterial color="#16161e" roughness={0.82} metalness={0.08} />
        </mesh>
        <mesh position={[0, toeGrpY, footR + s * 0.1]} frustumCulled={false}>
          <sphereGeometry args={[footR * 0.38, 6, 5]} />
          <meshStandardMaterial color={secC} roughness={0.45} metalness={0.35} />
        </mesh>
      </group>

      {/* ── TORSO ── */}
      <mesh position={[0, bodyY, 0]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[bodyTopR, bodyBotR, bodyH, 10]} />
        <meshStandardMaterial color={primaryC} roughness={0.55} metalness={0.12} />
      </mesh>
      {/* Belt */}
      <mesh position={[0, bodyBotY + bodyH * 0.17, 0]} frustumCulled={false}>
        <cylinderGeometry args={[bodyBotR + s * 0.014, bodyBotR + s * 0.014, s * 0.13, 10]} />
        <meshStandardMaterial color="#16161e" roughness={0.82} metalness={0.08} />
      </mesh>
      <mesh position={[0, bodyBotY + bodyH * 0.17, bodyBotR + s * 0.04]} frustumCulled={false}>
        <boxGeometry args={[s * 0.2, s * 0.14, s * 0.08]} />
        <meshStandardMaterial color={secC} roughness={0.45} metalness={0.35} />
      </mesh>

      {/* Faction outfit details */}
      {det === 'PAA' && <PAAOutfit s={s} bodyY={bodyY} bodyH={bodyH} secondary={secC} />}
      {det === 'ASF' && <ASFOutfit s={s} bodyY={bodyY} bodyH={bodyH} primary={primaryC} secondary={secC} />}
      {det === 'WC'  && <WCOutfit  s={s} bodyY={bodyY} bodyH={bodyH} primary={primaryC} />}

      {/* ── ARMS — pivot groups at shoulder (bodyTopY) ── */}
      <group ref={leftArmRef} position={[-armX, bodyTopY, 0]} rotation={[0, 0, armTilt]} frustumCulled={false}>
        <mesh position={[0, -armH / 2, 0]} castShadow frustumCulled={false}>
          <cylinderGeometry args={[armR, armR * 0.82, armH, 8]} />
          <meshStandardMaterial color={primaryC} roughness={0.55} metalness={0.12} />
        </mesh>
        <mesh position={[0, -armH - handR * 0.48, 0]} castShadow frustumCulled={false}>
          <sphereGeometry args={[handR, 9, 7]} />
          <meshStandardMaterial color={skinC} roughness={0.68} metalness={0} />
        </mesh>
      </group>

      <group ref={rightArmRef} position={[armX, bodyTopY, 0]} rotation={[0, 0, -armTilt]} frustumCulled={false}>
        <mesh position={[0, -armH / 2, 0]} castShadow frustumCulled={false}>
          <cylinderGeometry args={[armR, armR * 0.82, armH, 8]} />
          <meshStandardMaterial color={primaryC} roughness={0.55} metalness={0.12} />
        </mesh>
        <mesh position={[0, -armH - handR * 0.48, 0]} castShadow frustumCulled={false}>
          <sphereGeometry args={[handR, 9, 7]} />
          <meshStandardMaterial color={skinC} roughness={0.68} metalness={0} />
        </mesh>
      </group>

      {/* ── NECK ── */}
      <mesh position={[0, neckY, 0]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[s * 0.22, s * 0.26, neckH, 8]} />
        <meshStandardMaterial color={skinC} roughness={0.68} metalness={0} />
      </mesh>

      {/* ── HEAD ── */}
      <group position={[0, headY, 0]} frustumCulled={false}>
        <mesh castShadow frustumCulled={false}>
          <sphereGeometry args={[headR, 16, 13]} />
          <meshStandardMaterial color={skinC} roughness={0.68} metalness={0} />
        </mesh>
        {/* Ears */}
        {([-1, 1] as const).map(side => (
          <mesh key={side} position={[side * headR * 1.02, 0, 0]} frustumCulled={false}>
            <sphereGeometry args={[headR * 0.18, 7, 5]} />
            <meshStandardMaterial color={skinC} roughness={0.68} metalness={0} />
          </mesh>
        ))}

        <Eyes headR={headR} />

        {/* Nose */}
        <mesh position={[0, -headR * 0.06, headR * 0.96]} frustumCulled={false}>
          <sphereGeometry args={[headR * 0.072, 6, 5]} />
          <meshStandardMaterial color={darkSkinC} roughness={0.72} metalness={0} />
        </mesh>
        {/* Mouth — kawaii smile, 3 box segments like eyebrows */}
        <mesh position={[-headR * 0.13, -headR * 0.26, headR * 0.97]} rotation={[0, 0, -0.52]} frustumCulled={false}>
          <boxGeometry args={[headR * 0.13, headR * 0.055, headR * 0.05]} />
          <meshStandardMaterial color="#1a0808" roughness={0.9} metalness={0} />
        </mesh>
        <mesh position={[0, -headR * 0.32, headR * 0.97]} rotation={[0, 0, 0]} frustumCulled={false}>
          <boxGeometry args={[headR * 0.16, headR * 0.055, headR * 0.05]} />
          <meshStandardMaterial color="#1a0808" roughness={0.9} metalness={0} />
        </mesh>
        <mesh position={[headR * 0.13, -headR * 0.26, headR * 0.97]} rotation={[0, 0, 0.52]} frustumCulled={false}>
          <boxGeometry args={[headR * 0.13, headR * 0.055, headR * 0.05]} />
          <meshStandardMaterial color="#1a0808" roughness={0.9} metalness={0} />
        </mesh>

{/* Hair / headwear — faction × gender */}
        {det === 'PAA' && gender === 'MALE'   && <PAAMaleHair   headR={headR} primary={primaryC} />}
        {det === 'PAA' && gender === 'FEMALE' && <PAAFemaleHair headR={headR} primary={primaryC} />}
        {det === 'ASF' && gender === 'MALE'   && <ASFMaleHair   headR={headR} primary={primaryC} secondary={secC} />}
        {det === 'ASF' && gender === 'FEMALE' && <ASFFemaleHair headR={headR} />}
        {det === 'WC'  && gender === 'MALE'   && <WCMaleHair    headR={headR} primary={primaryC} />}
        {det === 'WC'  && gender === 'FEMALE' && <WCFemaleHair  headR={headR} secondary={secC} />}
      </group>

    </group>
  );
}
