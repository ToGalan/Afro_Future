/**
 * isometricCharacter.ts
 * Static configuration for the procedural Pokémon/chibi-style IsometricCharacter.
 *
 * All visual tuning lives here so IsometricCharacter.tsx only contains rendering logic.
 * Import what you need:
 *   import { PROPORTIONS, FACTION_PALETTES, SKIN_TONES } from '../assets/isometricCharacter';
 */

import type { AvatarColors } from '../services/avatarConfig';

// ─── Proportions ────────────────────────────────────────────────────────────
// Ratios are relative to `s = hexSize * SCALE_FACTOR`.
// Changing SCALE_FACTOR resizes the whole character proportionally.

export const SCALE_FACTOR = 0.32; // s = hexSize * SCALE_FACTOR

export interface ChibiProportions {
  headR:     number; // head sphere radius
  bodyH:     number; // torso cylinder height
  bodyTopR:  number; // torso top radius
  bodyBotR:  number; // torso bottom radius
  armR:      number; // arm cylinder radius
  armH:      number; // arm cylinder height
  legR:      number; // leg cylinder radius
  legH:      number; // leg cylinder height
  footR:     number; // foot sphere radius
  // Animation
  bobSpeed:  number; // idle bob frequency (radians/s)
  bobAmp:    number; // idle bob amplitude multiplier (×s)
  swaySpeed: number; // idle sway frequency
  swayAmp:   number; // idle sway amplitude (radians)
}

export const PROPORTIONS: ChibiProportions = {
  headR:     1.18,
  bodyH:     1.00,
  bodyTopR:  0.72,
  bodyBotR:  0.82,
  armR:      0.22,
  armH:      0.72,
  legR:      0.26,
  legH:      0.70,
  footR:     0.30,
  bobSpeed:  2.2,
  bobAmp:    0.08,
  swaySpeed: 1.1,
  swayAmp:   0.015,
};

// ─── Material defaults ───────────────────────────────────────────────────────
export const MATERIAL_PROPS = {
  skin:      { roughness: 0.65, metalness: 0.05 },
  primary:   { roughness: 0.55, metalness: 0.15 },
  secondary: { roughness: 0.50, metalness: 0.20 },
  dark:      { color: '#1a1a2e', roughness: 0.80, metalness: 0.10 },
} as const;

// ─── Skin tones ──────────────────────────────────────────────────────────────
// Named palette matching Afro-Future world lore.
export const SKIN_TONES = {
  DEEP:        '#3d1c02', // very deep warm brown
  RICH:        '#5c3317', // rich dark brown (ASF default)
  WARM:        '#8b5a2b', // warm medium brown (PAA default)
  GOLDEN:      '#b07d45', // golden brown
  CARAMEL:     '#c58b66', // caramel (procedural fallback)
  LIGHT:       '#d4a87a', // light warm (WC default)
  FAIR:        '#e8c99a', // fair / light
} as const;

export type SkinTone = keyof typeof SKIN_TONES;

// ─── Faction palettes ────────────────────────────────────────────────────────
// Mirrors FACTION_DEFAULTS in SoloMissionMap3D — single source of truth.
export const FACTION_PALETTES: Record<string, AvatarColors> = {
  PAA: { primary: '#00A37A', secondary: '#D4AF37', skin: SKIN_TONES.WARM   }, // Afrofuture green + gold
  ASF: { primary: '#C75B1E', secondary: '#4A4A5A', skin: SKIN_TONES.RICH   }, // Military amber + charcoal
  WC:  { primary: '#1E40AF', secondary: '#9CA3AF', skin: SKIN_TONES.LIGHT  }, // Corporate blue + silver
};

export const DEFAULT_COLORS: AvatarColors = FACTION_PALETTES.PAA;

// ─── Preset outfit themes ────────────────────────────────────────────────────
// Ready-made colour combos selectable in the character creator / store.
export interface OutfitPreset {
  id: string;
  label: string;
  primary: string;
  secondary: string;
}

export const OUTFIT_PRESETS: OutfitPreset[] = [
  { id: 'paa_warrior',    label: 'PAA Warrior',      primary: '#00A37A', secondary: '#D4AF37' },
  { id: 'asf_soldier',    label: 'ASF Soldier',       primary: '#C75B1E', secondary: '#4A4A5A' },
  { id: 'wc_agent',       label: 'WC Agent',          primary: '#1E40AF', secondary: '#9CA3AF' },
  { id: 'shadow',         label: 'Shadow',            primary: '#1a1a2e', secondary: '#5c5c7a' },
  { id: 'savanna',        label: 'Savanna',           primary: '#b8860b', secondary: '#6b4226' },
  { id: 'ocean',          label: 'Ocean',             primary: '#0369a1', secondary: '#7dd3fc' },
  { id: 'forest',         label: 'Forest',            primary: '#166534', secondary: '#86efac' },
  { id: 'ember',          label: 'Ember',             primary: '#9a3412', secondary: '#fdba74' },
  { id: 'void',           label: 'Void',              primary: '#4c1d95', secondary: '#c4b5fd' },
  { id: 'desert_rose',    label: 'Desert Rose',       primary: '#be185d', secondary: '#f9a8d4' },
];

// ─── Hair colour options ──────────────────────────────────────────────────────
// These are also mapped to `primary` in the hair components since hair inherits the primary colour.
// Separate list allows the UI to show hair-specific swatches independently.
export const HAIR_COLORS: Array<{ id: string; label: string; hex: string }> = [
  { id: 'black',         label: 'Black',           hex: '#1a1a1a' },
  { id: 'dark_brown',    label: 'Dark Brown',      hex: '#3d2b1f' },
  { id: 'brown',         label: 'Brown',           hex: '#6b3a2a' },
  { id: 'rich_auburn',   label: 'Auburn',          hex: '#8b3a1a' },
  { id: 'afro_gold',     label: 'Afro Gold',       hex: '#D4AF37' },
  { id: 'vibrant_green', label: 'Vibrant Green',   hex: '#00A37A' },
  { id: 'electric_blue', label: 'Electric Blue',   hex: '#1E40AF' },
  { id: 'ember_red',     label: 'Ember Red',       hex: '#C75B1E' },
  { id: 'violet',        label: 'Violet',          hex: '#7c3aed' },
  { id: 'white',         label: 'White',           hex: '#f0f0f0' },
];
