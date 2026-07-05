/**
 * Player stats: faction/character base stats + skill-tree modifiers.
 *
 * Effective stat = faction base + archetype bonus + level growth + skill-tree modifier.
 * Kept in one place so the dashboard, in-game HUD, and vitals all agree.
 */

export type StatKey = 'hp' | 'ep' | 'atk' | 'def' | 'spd';
export interface StatBlock { hp: number; ep: number; atk: number; def: number; spd: number; }

export const STAT_META: { key: StatKey; label: string; icon: string }[] = [
  { key: 'hp',  label: 'Health',  icon: '❤️' },
  { key: 'ep',  label: 'Energy',  icon: '⚡' },
  { key: 'atk', label: 'Attack',  icon: '⚔️' },
  { key: 'def', label: 'Defense', icon: '🛡️' },
  { key: 'spd', label: 'Speed',   icon: '🦶' },
];

// Per-faction base stats — distinct playstyles.
export const FACTION_BASE_STATS: Record<string, StatBlock> = {
  PAA: { hp: 120, ep: 55, atk: 8,  def: 12, spd: 5 }, // resilient defenders
  ASF: { hp: 95,  ep: 85, atk: 10, def: 7,  spd: 6 }, // tech / energy casters
  WC:  { hp: 100, ep: 60, atk: 13, def: 8,  spd: 9 }, // agile strikers
};

// Character build within a faction (male = sturdier bruiser, female = faster caster).
function archetypeBonus(archetype?: string): Partial<StatBlock> {
  return (archetype || '').toUpperCase() === 'MALE'
    ? { hp: 10, atk: 1 }
    : { ep: 10, spd: 1 };
}

export interface SkillStatInput { level: number; attack: number; defense: number; utility: number; }

/**
 * Break stats into base (faction + archetype + level growth), skill (skill-tree
 * modifiers), and total. HP/EP totals double as the vitals caps (hpMax/epMax).
 */
export function computeEffectiveStats(
  faction: string | undefined,
  archetype: string | undefined,
  skills: SkillStatInput,
): { base: StatBlock; skill: StatBlock; total: StatBlock } {
  const b = FACTION_BASE_STATS[(faction || '').toUpperCase()] ?? FACTION_BASE_STATS.PAA;
  const ab = archetypeBonus(archetype);
  const lvl = Math.max(1, skills.level || 1);

  const base: StatBlock = {
    hp:  b.hp  + (ab.hp  || 0) + (lvl - 1) * 12,
    ep:  b.ep  + (ab.ep  || 0) + (lvl - 1) * 6,
    atk: b.atk + (ab.atk || 0) + Math.floor((lvl - 1) * 1.5),
    def: b.def + (ab.def || 0) + (lvl - 1),
    spd: b.spd + (ab.spd || 0),
  };

  // Skill-tree modifiers (from skillStore.deriveStats: attack/defense/utility).
  const skill: StatBlock = {
    hp:  (skills.defense || 0) * 10,
    ep:  (skills.utility || 0) * 6,
    atk: (skills.attack  || 0),
    def: (skills.defense || 0),
    spd: Math.floor((skills.utility || 0) / 2),
  };

  const total: StatBlock = {
    hp:  base.hp  + skill.hp,
    ep:  base.ep  + skill.ep,
    atk: base.atk + skill.atk,
    def: base.def + skill.def,
    spd: base.spd + skill.spd,
  };
  return { base, skill, total };
}
