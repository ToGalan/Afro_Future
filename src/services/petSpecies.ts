/**
 * Pet Species System — Cyber-Dog vs Cyber-Cat differentiation (GDD "Pet Companion Feature").
 *
 * The GDD gives each pet a distinct identity:
 *   • Cyber-Dog — "Strong and loyal … enhanced strength, speed, and a suite of sensors
 *                  for reconnaissance." → tanky guardian / recon.
 *   • Cyber-Cat — "Agile and stealthy … access hard-to-reach places and gather intelligence
 *                  without being detected." → stealth scout / support.
 *
 * This module is the single source of truth for that differentiation:
 *   - per-species BASE stats (fed through petExpEconomy's level scaling),
 *   - a signature passive,
 *   - three bonding-gated abilities (level + bond-tier requirements),
 *   - the "bond" progression tiers (GDD "Bonding and Skills").
 *
 * Consumed by PetPanel (UI) and — for the derived stats/passive — by the mission runtime.
 */
import type { PetType } from '../types/loadout';
import { calculatePetStats } from './petExpEconomy';

export type PetRole = 'SCOUT' | 'SUPPORT' | 'BURST';

export interface PetBaseStats {
  health: number;
  defense: number;
  speed: number;
  attack: number;
}

export interface PetAbility {
  id: string;
  name: string;
  description: string;
  /** Character-independent unlock gates (GDD: "As players progress … unlocking new abilities"). */
  reqLevel: number;
  reqBondTier: number; // index into BOND_TIERS
  icon: string;
  /** Broad gameplay category so the runtime can route the effect. */
  kind: 'recon' | 'combat' | 'support' | 'utility';
}

export interface PetSpecies {
  type: PetType;
  name: string;          // display name (Cyber-Dog / Cyber-Cat)
  tagline: string;
  /** Role this species is naturally strongest in — the default/recommended role. */
  roleAffinity: PetRole;
  base: PetBaseStats;
  passive: { name: string; description: string; icon: string };
  abilities: PetAbility[];
  lore: string;
}

/** Bonding tiers (GDD "strengthen their bond with their pet, unlocking new abilities"). */
export interface BondTier { name: string; min: number; }
export const BOND_TIERS: BondTier[] = [
  { name: 'Stranger',  min: 0 },
  { name: 'Familiar',  min: 25 },
  { name: 'Bonded',    min: 60 },
  { name: 'Soulbound', min: 120 },
];

/** Resolve the bond tier index (0..3) for a raw bond value. */
export function bondTierIndex(bond: number): number {
  let idx = 0;
  for (let i = 0; i < BOND_TIERS.length; i++) {
    if (bond >= BOND_TIERS[i].min) idx = i;
  }
  return idx;
}

/** Progress (0..1) toward the next bond tier; 1 at the final tier. */
export function bondTierProgress(bond: number): number {
  const idx = bondTierIndex(bond);
  if (idx >= BOND_TIERS.length - 1) return 1;
  const cur = BOND_TIERS[idx].min;
  const next = BOND_TIERS[idx + 1].min;
  if (next <= cur) return 1;
  return Math.min(1, Math.max(0, (bond - cur) / (next - cur)));
}

export const PET_SPECIES: Record<PetType, PetSpecies> = {
  CYBER_DOG: {
    type: 'CYBER_DOG',
    name: 'Cyber-Dog',
    tagline: 'Strength & Reconnaissance',
    roleAffinity: 'SUPPORT',
    // Tanky guardian: high HP/defense/attack, modest speed.
    base: { health: 60, defense: 8, speed: 4, attack: 6 },
    passive: {
      name: 'Sentinel Sensors',
      description: 'Recon suite reveals nearby threats and slightly widens vision around the hero.',
      icon: '📡',
    },
    abilities: [
      { id: 'dog_track',    name: 'Track',     kind: 'recon',   reqLevel: 1,  reqBondTier: 0, icon: '🐾', description: 'Sniff out the nearest objective or hidden cache and mark it.' },
      { id: 'dog_guard',    name: 'Guard',     kind: 'support', reqLevel: 5,  reqBondTier: 1, icon: '🛡️', description: 'Stand guard beside the hero, absorbing a share of incoming damage.' },
      { id: 'dog_barkstun', name: 'Bark Stun', kind: 'combat',  reqLevel: 12, reqBondTier: 2, icon: '💢', description: 'A sonic bark briefly stuns adjacent enemies, interrupting attacks.' },
    ],
    lore: 'Engineered as loyal guardians, Cyber-Dogs blend military robotics with canine instinct. They embody loyalty and resilience, never abandoning their human partner.',
  },
  CYBER_CAT: {
    type: 'CYBER_CAT',
    name: 'Cyber-Cat',
    tagline: 'Stealth & Agility',
    roleAffinity: 'SCOUT',
    // Fragile skirmisher: low HP/defense, high speed, decent attack.
    base: { health: 40, defense: 4, speed: 8, attack: 5 },
    passive: {
      name: 'Ghost Protocol',
      description: 'Moves unseen, reduces the range at which enemies detect you while the cat is nearby.',
      icon: '🌫️',
    },
    abilities: [
      { id: 'cat_sneak',   name: 'Sneak',       kind: 'utility', reqLevel: 1,  reqBondTier: 0, icon: '🐈', description: 'Scout ahead into fog and reveal terrain without triggering enemies.' },
      { id: 'cat_distract',name: 'Distract',    kind: 'support', reqLevel: 5,  reqBondTier: 1, icon: '✨', description: 'Bait an enemy into chasing the cat, pulling aggro off the hero.' },
      { id: 'cat_hack',    name: 'Hack Scratch',kind: 'combat',  reqLevel: 12, reqBondTier: 2, icon: '⚡', description: 'Claw through an enemy’s systems, dealing damage and shredding defense.' },
    ],
    lore: 'Agile, silent, and mischievous, Cyber-Cats are the unseen eyes in contested zones. Descendants of cultural reverence for felines, they represent mystery and independence, thriving in chaos.',
  },
};

/** Normalize any incoming type string to a known species (defaults to Cyber-Dog). */
export function getPetSpecies(type?: string): PetSpecies {
  return type === 'CYBER_CAT' ? PET_SPECIES.CYBER_CAT : PET_SPECIES.CYBER_DOG;
}

/**
 * Derived pet stats at a given level = species base scaled by the level curve
 * (reuses petExpEconomy's PET_STAT_SCALING so leveling stays consistent everywhere).
 */
export function derivePetStats(type: string | undefined, level: number): PetBaseStats {
  const base = getPetSpecies(type).base;
  return calculatePetStats(Math.max(1, level), base);
}

/** Abilities for a pet, each annotated with whether it is currently unlocked. */
export function petAbilitiesWithState(
  type: string | undefined,
  level: number,
  bond: number,
): Array<PetAbility & { unlocked: boolean }> {
  const tier = bondTierIndex(bond);
  return getPetSpecies(type).abilities.map(a => ({
    ...a,
    unlocked: level >= a.reqLevel && tier >= a.reqBondTier,
  }));
}

/** The currently-usable abilities for a pet (unlocked only). */
export function unlockedPetAbilities(type: string | undefined, level: number, bond: number): PetAbility[] {
  return petAbilitiesWithState(type, level, bond).filter(a => a.unlocked);
}
