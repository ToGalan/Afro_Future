/**
 * Shared map/world types for the hex-grid game world.
 * Used by SoloMissionMap3D and all hooks that deal with map state.
 */

export type TileType = 'water' | 'desert' | 'plains' | 'forest' | 'jungle' | 'hills' | 'mountain';
export type ResourceType = 'ore' | 'energy' | 'bio' | null;

/** Axial hex coordinate */
export interface Axial { q: number; r: number; }

/** Single-char terrain identifier — mirrors generateTerrainMapRect biome codes */
export type TerrainChar = 'P' | 'F' | 'J' | 'H' | 'D' | 'O' | 'R' | 'M' | 'L' | 'N' | 'V';

/** A single hex tile on the map */
export interface Tile extends Axial {
  type: TileType;
  resource: ResourceType;
  char: TerrainChar;
}

/** A game actor (hero or pet) tracked on the map */
export interface Actor {
  id: string;
  pos: Axial;
  vision: number;
  kind: 'actor' | 'pet';
  xp?: number;
}

/** World-space XZ position (Three.js Y-up, map lies on the XZ plane) */
export interface WorldPos { x: number; z: number; }

/** Flat-top vs pointy-top hex orientation */
export type HexOrient = 'flat' | 'pointy';

// ─── Pure helpers ────────────────────────────────────────────────────────────

export function axialDistance(a: Axial, b: Axial): number {
  const aq = a.q, ar = a.r, as_ = -aq - ar;
  const bq = b.q, br = b.r, bs_ = -bq - br;
  return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(as_ - bs_));
}

export function axialNeighbors(a: Axial): Axial[] {
  return [
    { q: a.q + 1, r: a.r },
    { q: a.q - 1, r: a.r },
    { q: a.q, r: a.r + 1 },
    { q: a.q, r: a.r - 1 },
    { q: a.q + 1, r: a.r - 1 },
    { q: a.q - 1, r: a.r + 1 },
  ];
}

export function hexApothem(R: number): number {
  return R * Math.cos(Math.PI / 6);
}

/** Flat-top axial → Three.js world XZ */
export function axialToWorldFlat(a: Axial, R_outer: number): WorldPos {
  return {
    x: R_outer * (1.5 * a.q),
    z: R_outer * (Math.sqrt(3) * (a.r + a.q / 2)),
  };
}

export function keyOf(a: Axial): string {
  return `${a.q},${a.r}`;
}
