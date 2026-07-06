/**
 * Faction abilities (GDD): each faction unlocks 3 signature abilities gated by
 * character level (L20 / L25 / L30) and paid for with Faction Points. Once unlocked
 * they grant a passive combat bonus (atk/def/util) reflecting the faction ethos:
 *   PAA "Heal & Unite" → defense/utility, ASF "Africa First" → attack, WC "Survival" → mixed.
 */
import type { StatBlock } from './playerStats';

export interface FactionAbility {
  id: string;
  name: string;
  description: string;
  faction: string;      // 'PAA' | 'ASF' | 'WC'
  reqLevel: number;     // character level required
  cost: number;         // faction points
  bonus: Partial<StatBlock>;
  icon: string;
}

export const FACTION_ABILITIES: FactionAbility[] = [
  // Pan-African Alliance — Heal & Unite
  { id: 'paa_peacekeeper',  name: 'Peacekeeper Drone',   faction: 'PAA', reqLevel: 20, cost: 3, icon: '🛰️', bonus: { def: 6, hp: 40 },  description: 'Deploys a support drone. +40 HP, +6 DEF.' },
  { id: 'paa_redistribute', name: 'Resource Redistribution', faction: 'PAA', reqLevel: 25, cost: 4, icon: '♻️', bonus: { def: 4, spd: 3 }, description: 'Share resources with allies. +4 DEF, +3 SPD.' },
  { id: 'paa_ceasefire',    name: 'Ceasefire Negotiator', faction: 'PAA', reqLevel: 30, cost: 6, icon: '🕊️', bonus: { def: 10, hp: 60 }, description: 'Force a ceasefire. +60 HP, +10 DEF.' },
  // African Sovereign Front — Africa First
  { id: 'asf_warcry',   name: 'Guerrilla War Cry',   faction: 'ASF', reqLevel: 20, cost: 3, icon: '📣', bonus: { atk: 6 },          description: 'Rally strike. +6 ATK.' },
  { id: 'asf_ambush',   name: 'Ambush Protocol',     faction: 'ASF', reqLevel: 25, cost: 4, icon: '🗡️', bonus: { atk: 5, spd: 4 },  description: 'Strike from stealth. +5 ATK, +4 SPD.' },
  { id: 'asf_overload', name: 'Cybernetic Overload',  faction: 'ASF', reqLevel: 30, cost: 6, icon: '⚡', bonus: { atk: 12 },         description: 'Push cybernetics past limits. +12 ATK.' },
  // World Coalition — Survival at Any Cost
  { id: 'wc_salvage',   name: 'Salvage Rig',        faction: 'WC', reqLevel: 20, cost: 3, icon: '🔧', bonus: { hp: 30, atk: 3 },  description: 'Improvised armor + weapons. +30 HP, +3 ATK.' },
  { id: 'wc_scavenger', name: 'Scavenger Instinct', faction: 'WC', reqLevel: 25, cost: 4, icon: '🎯', bonus: { atk: 5, def: 3 },  description: 'Make do with anything. +5 ATK, +3 DEF.' },
  { id: 'wc_laststand', name: 'Last Stand',         faction: 'WC', reqLevel: 30, cost: 6, icon: '🛡️', bonus: { hp: 50, def: 8 },  description: 'Refuse to fall. +50 HP, +8 DEF.' },
];

export function abilitiesForFaction(faction?: string): FactionAbility[] {
  const f = (faction || 'PAA').toUpperCase();
  return FACTION_ABILITIES.filter(a => a.faction === f);
}

/** Sum the stat bonuses of the unlocked faction abilities. */
export function factionAbilityBonus(unlockedIds: string[] | undefined): Partial<StatBlock> {
  const out: Partial<StatBlock> = {};
  if (!unlockedIds) return out;
  const byId = new Map(FACTION_ABILITIES.map(a => [a.id, a]));
  for (const id of unlockedIds) {
    const b = byId.get(id)?.bonus;
    if (!b) continue;
    (Object.keys(b) as (keyof StatBlock)[]).forEach(k => { out[k] = (out[k] || 0) + (b[k] || 0); });
  }
  return out;
}
