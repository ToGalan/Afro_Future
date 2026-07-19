/**
 * campUpgrades — the 5-tier specialization system for player-secured ground: captured
 * OUTPOSTS and cleared FORTIFY creep camps (per user directive, 2026-07-19: "5 tiers
 * for the fortified only camps and outposts... player can upgrade them with a certain
 * combination of resource for each level").
 *
 * Each location, once player-held, can be developed along ONE of three specializations
 * (locked in on the first upgrade), paid for with ore/energy/bio from the hero's
 * inventory:
 *   - Military (weapons)  → reinforces the faction: a chance to fully repel a rival
 *                            raid outright, scaling with tier.
 *   - Food (animals/plants) → a resource trickle, but the abundance attracts looters:
 *                            rivals weight it as a MORE attractive raid target.
 *   - Medicine             → a Faction Point trickle, and rivals weight it as a LESS
 *                            attractive target (reads as "not worth the fight" — the
 *                            "invite trade negotiations" lean per the user's ask).
 *
 * Pure data + math here; SoloMissionMap3D owns the state (Map<string, CampUpgradeState>,
 * persisted per-key), the passive-income tick, and wires raidWeight/raidDefendChance
 * into useFactionEnemies' strategic targets + the onRaidOutpost handler.
 */

export type CampSpecialization = 'military' | 'food' | 'medicine';

export interface CampUpgradeState {
  tier: number; // 0 = unupgraded (no spec chosen yet), 1..5
  spec: CampSpecialization | null;
}

export const CAMP_UPGRADE_MAX_TIER = 5;

export interface ResourceCost { ore: number; energy: number; bio: number }

/** Cost to advance a location currently at `state.tier` up to `state.tier + 1`. Costs
 *  scale with the tier being PAID FOR (tier 1 is cheapest); the specialization shifts
 *  the resource MIX to match its flavor (military ~ weapons ~ ore+energy heavy, food ~
 *  animals/plants ~ bio heavy, medicine ~ a balanced mix). */
export function nextUpgradeCost(state: CampUpgradeState, spec: CampSpecialization): ResourceCost {
  const targetTier = state.tier + 1;
  const base = 12 * targetTier; // 12,24,36,48,60 — total resource "weight" per tier
  switch (spec) {
    case 'military': return { ore: Math.round(base * 1.3), energy: Math.round(base * 0.9), bio: Math.round(base * 0.2) };
    case 'food':     return { ore: Math.round(base * 0.2), energy: Math.round(base * 0.3), bio: Math.round(base * 1.5) };
    case 'medicine': return { ore: Math.round(base * 0.5), energy: Math.round(base * 0.8), bio: Math.round(base * 0.9) };
  }
}

export const SPEC_INFO: Record<CampSpecialization, { icon: string; label: string; desc: string }> = {
  military: { icon: '⚔️', label: 'Military', desc: 'Weapons and drilled defenders. Reinforces the faction: a growing chance to fully repel any rival raid.' },
  food:     { icon: '🌾', label: 'Food', desc: 'Livestock and crops. A steady resource trickle, but the abundance attracts looters, rivals target it more.' },
  medicine: { icon: '💊', label: 'Medicine', desc: 'Clinics and supplies. A steady Faction Point trickle, and rivals read it as not worth the fight, less likely to raid.' },
};

/** Chance [0..1] a military-tier location fully negates an incoming raid attempt. */
export function militaryDefendChance(state: CampUpgradeState): number {
  if (state.spec !== 'military' || state.tier <= 0) return 0;
  return Math.min(0.6, state.tier * 0.12); // 12/24/36/48/60%
}

/** Raid-targeting weight multiplier a rival AI applies to this location's effective
 *  distance (see useFactionEnemies' strategic-target selection) — >1 makes it feel
 *  CLOSER (more attractive), <1 makes it feel FARTHER (less attractive). Unspecialized
 *  or non-food/medicine locations are neutral (1). */
export function raidWeight(state: CampUpgradeState): number {
  if (state.spec === 'food' && state.tier > 0) return 1 + state.tier * 0.5;      // up to 3.5x more attractive
  if (state.spec === 'medicine' && state.tier > 0) return 1 / (1 + state.tier * 0.3); // down to ~40% as attractive
  return 1;
}

/** Passive income granted per tick (see the interval in SoloMissionMap3D) for a
 *  food/medicine location — food grants resources (bio), medicine grants Faction Points.
 *  Military grants neither (its payoff is defensive, not economic). */
export function passiveIncome(state: CampUpgradeState): { bio: number; fp: number } {
  if (state.spec === 'food' && state.tier > 0) return { bio: state.tier * 2, fp: 0 };
  if (state.spec === 'medicine' && state.tier > 0) return { bio: 0, fp: state.tier * 2 };
  return { bio: 0, fp: 0 };
}
