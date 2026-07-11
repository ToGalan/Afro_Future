import { SkillType } from '../components/SnowflakeSkillTree';

/**
 * GDD Skill Grid — the linear L1→L100 progression from the Afro-Future Rising GDD
 * ("Character Levels and Abilities", docs/GDD.md), extended from the GDD's L50 cap to
 * L100. One skill per level, unlocked in order (each requires the previous), paced by a
 * rising **skill-point cost** curve. Faction Passives and Faction Abilities land on the
 * GDD-specified levels; everything else follows the GDD's attack/defense/speed/stealth/
 * pet/utility cadence.
 *
 * The presentation (SnowflakeSkillTree) lays these out as a grid keyed by `level`.
 */

// ─── Categories (lanes) — drive colour, labelling and stat contribution ───────
export type SkillCategory =
  | 'attack' | 'defense' | 'mobility' | 'stealth'
  | 'pet' | 'faction' | 'vitality' | 'utility';

export interface SkillStats { atk?: number; def?: number; util?: number; }

/** Buff/debuff produced when an ACTIVE skill is cast. Consumed by the status-effect system. */
export type EffectKind =
  | 'shield' | 'stealth' | 'regen' | 'haste'       // self-buffs
  | 'atkBuff' | 'defBuff'                            // self stat buffs
  | 'burst' | 'stun' | 'pacify' | 'slow';           // enemy-facing
export interface SkillEffect {
  kind: EffectKind;
  magnitude: number;      // effect size (flat or %, per kind)
  durationMs?: number;    // 0/undefined = instant
  target: 'self' | 'enemy';
}

export interface SkillNode {
  id: string;
  label: string;
  description: string;
  type: SkillType;          // = category (kept as `type` for the existing UI/colour code)
  level: number;            // 1..100 (grid position)
  tier: number;             // band index 1..10 (level→ceil(level/10)); drives node sizing
  branch: number;           // lane index (category) — colour grouping
  category: SkillCategory;
  cost: number;             // skill-point cost to unlock
  active?: boolean;         // castable ability → auto-slots into an ability bar
  bar?: 'offensive' | 'defensive';
  requires?: string[];      // linear prereq (previous level's node)
  counters?: string[];
  faction?: 'PAA' | 'ASF' | 'WC';
  stats?: SkillStats;
  effect?: SkillEffect;
}

// Lanes — used by the legend, trait derivation and node colouring.
export interface BranchDef { id: number; name: string; category: SkillCategory; }
export const BRANCHES: BranchDef[] = [
  { id: 0, name: 'Combat',    category: 'attack' },
  { id: 1, name: 'Defense',   category: 'defense' },
  { id: 2, name: 'Mobility',  category: 'mobility' },
  { id: 3, name: 'Stealth',   category: 'stealth' },
  { id: 4, name: 'Pet Bond',  category: 'pet' },
  { id: 5, name: 'Faction',   category: 'faction' },
  { id: 6, name: 'Vitality',  category: 'vitality' },
  { id: 7, name: 'Utility',   category: 'utility' },
];
const LANE_OF: Record<SkillCategory, number> = {
  attack: 0, defense: 1, mobility: 2, stealth: 3, pet: 4, faction: 5, vitality: 6, utility: 7,
};

export const PLAYER_LEVEL_CAP = 100;

// ─── Skill-point economy ─────────────────────────────────────────────────────
// Cost rises every 20 levels (1→5). A diligent player earns roughly enough points by
// the cap (see availablePoints in skillStore) to complete the grid.
export const SKILL_POINTS_BASE = 3;
export const SKILL_POINTS_PER_LEVEL = 3;
export const SKILL_POINTS_BONUS_PER_5 = 2;
export function skillCostForLevel(level: number, isFactionAbility: boolean): number {
  const base = 1 + Math.floor((level - 1) / 20); // 1..5 across the 100 levels
  return isFactionAbility ? base * 2 : base;     // signature faction abilities cost double
}

// ─── Naming: per-band adjective so higher tiers read as more powerful ─────────
function bandWord(level: number): string {
  const b = Math.ceil(level / 10); // 1..10
  return ['Basic', 'Improved', 'Advanced', 'Refined', 'Elite',
          'Master', 'Ascendant', 'Mythic', 'Legendary', 'Transcendent'][b - 1];
}
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// A single grid entry before it is expanded into a full SkillNode.
interface Spec {
  category: SkillCategory;
  name?: string;                  // explicit GDD name; else generated
  active?: boolean;
  bar?: 'offensive' | 'defensive';
  factionAbility?: boolean;       // GDD "Faction Ability" (signature, costs double)
  effect?: (level: number, faction: 'PAA' | 'ASF' | 'WC') => SkillEffect;
}

// GDD L1–30, verbatim from the skill grid (docs/GDD.md).
const GDD_1_30: Record<number, Spec> = {
  1:  { category: 'attack',   name: 'Basic Attack',              active: true, bar: 'offensive', effect: (l) => ({ kind: 'burst', magnitude: 6, target: 'enemy' }) },
  2:  { category: 'defense',  name: 'Basic Defense' },
  3:  { category: 'mobility', name: 'Speed Increase' },
  4:  { category: 'pet',      name: 'Basic Pet Command' },
  5:  { category: 'faction',  name: 'Faction Passive I' },
  6:  { category: 'attack',   name: 'Improved Basic Attack',     active: true, bar: 'offensive', effect: () => ({ kind: 'burst', magnitude: 10, target: 'enemy' }) },
  7:  { category: 'vitality', name: 'Health Increase' },
  8:  { category: 'mobility', name: 'Enhanced Speed' },
  9:  { category: 'pet',      name: 'Advanced Pet Command' },
  10: { category: 'attack',   name: 'Special Attack',            active: true, bar: 'offensive', effect: (_l, f) => (f === 'PAA' ? { kind: 'stun', magnitude: 1200, target: 'enemy' } : { kind: 'burst', magnitude: 18, target: 'enemy' }) },
  11: { category: 'stealth',  name: 'Stealth Mode',              active: true, bar: 'defensive', effect: () => ({ kind: 'stealth', magnitude: 1, durationMs: 5000, target: 'self' }) },
  12: { category: 'defense',  name: 'Intermediate Defense' },
  13: { category: 'pet',      name: 'Pet Stealth Skill' },
  14: { category: 'utility',  name: 'Hacking Ability',           active: true, bar: 'offensive', effect: () => ({ kind: 'stun', magnitude: 1600, target: 'enemy' }) },
  15: { category: 'faction',  name: 'Faction Passive II' },
  16: { category: 'attack',   name: 'Advanced Attack',           active: true, bar: 'offensive', effect: () => ({ kind: 'burst', magnitude: 26, target: 'enemy' }) },
  17: { category: 'defense',  name: 'Shield Activation',         active: true, bar: 'defensive', effect: () => ({ kind: 'shield', magnitude: 40, durationMs: 6000, target: 'self' }) },
  18: { category: 'vitality', name: 'Improved Health Regeneration', active: true, bar: 'defensive', effect: () => ({ kind: 'regen', magnitude: 30, durationMs: 6000, target: 'self' }) },
  19: { category: 'pet',      name: 'Pet Attack Upgrade' },
  20: { category: 'faction',  name: 'Faction Ability I',         active: true, factionAbility: true, effect: (_l, f) => factionAbilityEffect(f, 1) },
  21: { category: 'faction',  name: 'Faction Passive III' },
  22: { category: 'stealth',  name: 'Enhanced Stealth Mode',     active: true, bar: 'defensive', effect: () => ({ kind: 'stealth', magnitude: 1, durationMs: 8000, target: 'self' }) },
  23: { category: 'utility',  name: 'Advanced Hacking / Diplomacy', active: true, bar: 'offensive', effect: () => ({ kind: 'pacify', magnitude: 4000, target: 'enemy' }) },
  24: { category: 'pet',      name: 'Pet Scouting Upgrade' },
  25: { category: 'faction',  name: 'Faction Ability II',        active: true, factionAbility: true, effect: (_l, f) => factionAbilityEffect(f, 2) },
  26: { category: 'attack',   name: 'Elite Attack Mode',         active: true, bar: 'offensive', effect: () => ({ kind: 'burst', magnitude: 40, target: 'enemy' }) },
  27: { category: 'defense',  name: 'Full Shield Mode',          active: true, bar: 'defensive', effect: () => ({ kind: 'shield', magnitude: 80, durationMs: 7000, target: 'self' }) },
  28: { category: 'pet',      name: 'Pet Combat Upgrade' },
  29: { category: 'faction',  name: 'Faction Passive IV' },
  30: { category: 'faction',  name: 'Faction Ability III',       active: true, factionAbility: true, effect: (_l, f) => factionAbilityEffect(f, 3) },
};

// Faction-ability effect flavour (matches each faction's ethos / factionAbilities.ts).
function factionAbilityEffect(faction: 'PAA' | 'ASF' | 'WC', rank: number): SkillEffect {
  const m = 1 + rank; // scales with the 1st/2nd/3rd ability
  if (faction === 'PAA') return { kind: 'shield', magnitude: 40 * m, durationMs: 6000, target: 'self' };   // Heal & Unite → protection
  if (faction === 'ASF') return { kind: 'atkBuff', magnitude: 6 * m, durationMs: 8000, target: 'self' };   // Africa First → offense
  return { kind: 'burst', magnitude: 20 * m, target: 'enemy' };                                            // WC survival → raw damage
}

// Repeating 10-level template for the generated bands (L31→L100), echoing the GDD cadence.
const TEMPLATE: Spec[] = [
  { category: 'attack',   active: true, bar: 'offensive', effect: (l) => ({ kind: 'burst', magnitude: 30 + l, target: 'enemy' }) },       // +1
  { category: 'defense',  active: true, bar: 'defensive', effect: (l) => ({ kind: 'shield', magnitude: 40 + l, durationMs: 7000, target: 'self' }) }, // +2
  { category: 'stealth',  active: true, bar: 'defensive', effect: () => ({ kind: 'stealth', magnitude: 1, durationMs: 9000, target: 'self' }) },       // +3
  { category: 'pet' },                                                                                                                      // +4
  { category: 'faction',  name: 'Faction Passive' },                                                                                        // +5
  { category: 'attack',   active: true, bar: 'offensive', effect: (l) => ({ kind: 'burst', magnitude: 34 + l, target: 'enemy' }) },        // +6
  { category: 'vitality', active: true, bar: 'defensive', effect: (l) => ({ kind: 'regen', magnitude: 30 + Math.floor(l / 2), durationMs: 6000, target: 'self' }) }, // +7
  { category: 'mobility', active: true, bar: 'defensive', effect: () => ({ kind: 'haste', magnitude: 2, durationMs: 6000, target: 'self' }) },         // +8
  { category: 'pet' },                                                                                                                      // +9
  { category: 'faction',  factionAbility: true, active: true, effect: (_l, f) => factionAbilityEffect(f, 4) },                              // +10 (milestone)
];

function catLabel(cat: SkillCategory): string {
  return { attack: 'Strike', defense: 'Bulwark', mobility: 'Surge', stealth: 'Cloak',
           pet: 'Pet Bond', faction: 'Faction Power', vitality: 'Vigor', utility: 'Protocol' }[cat];
}

// Per-node stat contribution (feeds playerStats: def→HP, util→SPD/EP, atk→ATK).
function statsFor(cat: SkillCategory, tier: number, faction?: 'PAA' | 'ASF' | 'WC'): SkillStats {
  switch (cat) {
    case 'attack':   return { atk: tier };
    case 'defense':  return { def: tier };
    case 'vitality': return { def: tier };                 // → +HP
    case 'mobility': return { util: tier };                // → +SPD/EP
    case 'stealth':  return { util: Math.ceil(tier / 2) };
    case 'utility':  return { util: tier };
    case 'pet':      return { util: 1 };                   // pet skills mostly buff the pet
    case 'faction':
      if (faction === 'ASF') return { atk: tier };
      if (faction === 'WC')  return { atk: Math.ceil(tier / 2), def: Math.ceil(tier / 2) };
      return { def: tier };                                // PAA
  }
}

function specForLevel(level: number): Spec {
  if (GDD_1_30[level]) return GDD_1_30[level];
  return TEMPLATE[(level - 1) % 10];
}

export function makeTree(faction: 'PAA' | 'ASF' | 'WC' = 'PAA'): SkillNode[] {
  const nodes: SkillNode[] = [];
  nodes.push({
    id: 'root', label: 'Origin', description: 'Your starting potential — the source of all paths.',
    type: 'root' as SkillType, level: 0, tier: 0, branch: -1, category: 'attack', cost: 0,
  });
  let facPassive = 0, facAbility = 0;
  for (let level = 1; level <= PLAYER_LEVEL_CAP; level++) {
    const spec = specForLevel(level);
    const tier = Math.ceil(level / 10);
    const isFacAbility = !!spec.factionAbility;
    let label = spec.name;
    if (!label) {
      if (spec.category === 'faction') label = `Faction Passive ${ROMAN[Math.min(10, ++facPassive)]}`;
      else label = `${bandWord(level)} ${catLabel(spec.category)}`;
    }
    if (isFacAbility) { facAbility++; label = spec.name ?? `Faction Ability ${ROMAN[Math.min(10, facAbility)]}`; }

    const requires = level === 1 ? ['root'] : [`lvl${level - 1}`];
    const node: SkillNode = {
      id: `lvl${level}`,
      label: label!,
      description: buildDescription(spec, level, tier),
      type: spec.category as SkillType,
      level, tier, branch: LANE_OF[spec.category], category: spec.category,
      cost: skillCostForLevel(level, isFacAbility),
      active: spec.active,
      bar: spec.bar ?? (isFacAbility ? factionAbilityBar(faction) : undefined),
      requires,
      faction: spec.category === 'faction' ? faction : undefined,
      stats: statsFor(spec.category, tier, faction),
      effect: spec.effect ? spec.effect(level, faction) : undefined,
    };
    nodes.push(node);
  }
  return nodes;
}

function factionAbilityBar(faction: 'PAA' | 'ASF' | 'WC'): 'offensive' | 'defensive' {
  return faction === 'ASF' || faction === 'WC' ? 'offensive' : 'defensive';
}

function buildDescription(spec: Spec, level: number, tier: number): string {
  const parts: string[] = [`L${level}.`];
  const s = statsFor(spec.category, tier);
  const bits: string[] = [];
  if (s.atk) bits.push(`+${s.atk} ATK`);
  if (s.def) bits.push(`+${s.def} ${spec.category === 'vitality' ? 'HP-block' : 'DEF'}`);
  if (s.util) bits.push(`+${s.util} UTIL`);
  if (bits.length) parts.push(bits.join(', ') + '.');
  if (spec.active) parts.push('Castable ability.');
  return parts.join(' ');
}

// ─── Derived helpers (unchanged public API) ──────────────────────────────────
/** Sum the stat contributions of a set of unlocked node ids. */
export function sumSkillStats(unlocked: string[], nodes: SkillNode[]): { attack: number; defense: number; utility: number } {
  const byId = new Map(nodes.map(n => [n.id, n]));
  let attack = 0, defense = 0, utility = 0;
  for (const id of unlocked) {
    const s = byId.get(id)?.stats;
    if (!s) continue;
    attack += s.atk || 0; defense += s.def || 0; utility += s.util || 0;
  }
  return { attack, defense, utility };
}

/** Total skill-point cost of a set of unlocked node ids (root is free). */
export function sumSkillCost(unlocked: string[], nodes: SkillNode[]): number {
  const byId = new Map(nodes.map(n => [n.id, n]));
  let total = 0;
  for (const id of unlocked) total += byId.get(id)?.cost || 0;
  return total;
}

// Category → HUD icon. Used by the ability bars and skills modal.
export const CATEGORY_ICON: Record<SkillCategory, string> = {
  attack: '⚔️', defense: '🛡️', mobility: '🦶', stealth: '🥷',
  pet: '🐾', faction: '🏳️', vitality: '❤️', utility: '🧪',
};
const _ICON_TREE = makeTree();
const _ICON_BY_ID = new Map(_ICON_TREE.map(n => [n.id, n]));
/** Icon for a skill id (looks the node up in the grid; faction-agnostic). */
export function skillIconFor(id: string): string {
  const n = _ICON_BY_ID.get(id);
  return n ? (CATEGORY_ICON[n.category] ?? '⬢') : '⬢';
}
/** The buff/debuff a skill casts (undefined for passives). */
export function skillEffectFor(id: string): SkillEffect | undefined { return _ICON_BY_ID.get(id)?.effect; }
/** Display label for a skill id. */
export function skillLabelFor(id: string): string { return _ICON_BY_ID.get(id)?.label ?? id; }

export function deriveTraits(unlocked: string[], nodes: SkillNode[]) {
  const byBranch: Record<string, number> = {}; const byType: Record<string, number> = {};
  const byId = new Map(nodes.map(n => [n.id, n]));
  unlocked.forEach(id => {
    const n = byId.get(id); if (!n || n.branch < 0) return;
    const b = BRANCHES.find(br => br.id === n.branch)?.name || 'root';
    byBranch[b] = (byBranch[b] || 0) + 1; byType[n.category] = (byType[n.category] || 0) + 1;
  });
  const topBranch = Object.entries(byBranch).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0];
  const tags: string[] = [];
  if ((byBranch['Combat'] || 0) >= 6) tags.push('Aggressor');
  if ((byBranch['Defense'] || 0) >= 6) tags.push('Bulwark');
  if ((byBranch['Stealth'] || 0) >= 5) tags.push('Ghost');
  if ((byBranch['Pet Bond'] || 0) >= 5) tags.push('Beastmaster');
  if ((byBranch['Faction'] || 0) >= 5) tags.push('Faction Champion');
  if ((byBranch['Mobility'] || 0) >= 5) tags.push('Skirmisher');
  if ((byBranch['Utility'] || 0) >= 4) tags.push('Operator');
  return { topBranch, topType, tags };
}
