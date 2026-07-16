import { SkillType } from '../components/SnowflakeSkillTree';
import type { StatBlock } from '../services/playerStats';

/**
 * Snowflake skill tree — a 12-branch radial "snowflake" of skills, themed to the
 * Afro-Future Rising GDD (story + missions): cybernetics, hacking/diplomacy, stealth,
 * healing/terraforming, factions and pet bonding — no generic fantasy spells.
 *
 * Structure: a central Origin, one CORE node per branch, then 12 tier nodes fanning
 * outward across FIVE rings (tiers 2–5, three per ring). CORE nodes of combat branches
 * are castable ABILITIES carrying a buff/debuff `effect`; the rest are passive stats.
 *
 * Two economy features drive build choices:
 *   - **Scaling cost**: a node costs its tier in skill points (1→5), so outer rings are
 *     expensive and you cannot unlock everything (see skillStore.availablePoints).
 *   - **Traits**: investing ≥N nodes in a branch unlocks a TRAIT that grants a real
 *     StatBlock bonus (fed into computeEffectiveStats), so specialising pays off in
 *     combat/vitals — not just a cosmetic tag.
 */

// ─── Categories (also the SkillType used for colouring) ───────────────────────
export type SkillCategory =
  | 'attack' | 'defense' | 'mobility' | 'stealth'
  | 'pet' | 'faction' | 'vitality' | 'utility';

export interface SkillStats { atk?: number; def?: number; util?: number; }

/** Buff/debuff produced when an ACTIVE skill is cast. Consumed by the status-effect system. */
export type EffectKind =
  | 'shield' | 'stealth' | 'regen' | 'haste'
  | 'atkBuff' | 'defBuff'
  | 'burst' | 'stun' | 'pacify' | 'slow';
export interface SkillEffect {
  kind: EffectKind;
  magnitude: number;
  durationMs?: number;
  target: 'self' | 'enemy';
}

export interface SkillNode {
  id: string;
  label: string;
  description: string;
  type: SkillType;
  tier: number;             // 1 (core) … 5 (outer ring)
  branch: number;
  category: SkillCategory;
  cost: number;             // = tier (scaling cost)
  active?: boolean;
  bar?: 'offensive' | 'defensive';
  requires?: string[];
  counters?: string[];
  faction?: 'PAA' | 'ASF' | 'WC';
  stats?: SkillStats;
  effect?: SkillEffect;
}

export interface BranchDef {
  id: number; name: string; type: SkillType; category: SkillCategory;
  stat: 'atk' | 'def' | 'util';
  bar?: 'offensive' | 'defensive';
  effect?: EffectKind;
}

export const BRANCHES: BranchDef[] = [
  { id: 0,  name: 'Combat',      type: 'attack',   category: 'attack',   stat: 'atk', bar: 'offensive', effect: 'burst' },
  { id: 1,  name: 'Defense',     type: 'defense',  category: 'defense',  stat: 'def', bar: 'defensive', effect: 'shield' },
  { id: 2,  name: 'Stealth',     type: 'stealth',  category: 'stealth',  stat: 'util', bar: 'defensive', effect: 'stealth' },
  { id: 3,  name: 'Cybernetics', type: 'attack',   category: 'attack',   stat: 'atk', bar: 'offensive', effect: 'atkBuff' },
  { id: 4,  name: 'Hacking',     type: 'utility',  category: 'utility',  stat: 'util', bar: 'offensive', effect: 'stun' },
  { id: 5,  name: 'Healing',     type: 'vitality', category: 'vitality', stat: 'def', bar: 'defensive', effect: 'regen' },
  { id: 6,  name: 'Pet Bond',    type: 'pet',      category: 'pet',      stat: 'util' },
  { id: 7,  name: 'Faction',     type: 'faction',  category: 'faction',  stat: 'def', bar: 'defensive', effect: 'shield' },
  { id: 8,  name: 'Terraform',   type: 'utility',  category: 'utility',  stat: 'util' },
  { id: 9,  name: 'Mobility',    type: 'mobility', category: 'mobility', stat: 'util', bar: 'defensive', effect: 'haste' },
  { id: 10, name: 'Diplomacy',   type: 'faction',  category: 'faction',  stat: 'util', bar: 'offensive', effect: 'pacify' },
  { id: 11, name: 'Scavenging',  type: 'utility',  category: 'utility',  stat: 'util' },
];

// GDD-themed skill names per branch (index 0 = core, 1..12 = tier skills across 4 rings).
const SKILL_NAMES: Record<string, string[]> = {
  Combat:      ['Combat Training', 'Power Strike', 'Guerrilla Strike', 'Suppressing Fire', 'Overload Strike', 'Elite Assault', 'War Cry', 'Executioner', 'Onslaught', 'Battle Fury', 'Rampage', 'Bloodstorm', 'Warlord'],
  Defense:     ['Shield Activation', 'Reactive Plating', 'Deflect', 'Fortify', 'Full Shield Mode', 'Bulwark', 'Bastion', 'Aegis Protocol', 'Unbreakable', 'Stonewall', 'Ironhold', 'Immovable', 'Living Fortress'],
  Stealth:     ['Stealth Mode', 'Silent Step', 'Cloaking Field', 'Ambush', 'Enhanced Stealth', 'Ghost Protocol', 'Shadowstrike', 'Phantom Cloak', 'Untraceable', 'Blackout', 'Nightstalker', 'Vanish', 'Ghost in the Machine'],
  Cybernetics: ['Cyber Enhancement', 'Reflex Booster', 'Servo Strength', 'Neural Uplink', 'Cybernetic Overload', 'Nano-Edge', 'Combat Chassis', 'Titan Frame', 'Ascendant Cyberform', 'Overclock', 'Chrome Surge', 'Singularity Core', 'Transhuman'],
  Hacking:     ['Basic Hacking', 'System Breach', 'Firewall Bypass', 'Drone Hijack', 'Advanced Hacking', 'EMP Burst', 'Network Siege', 'Master Intrusion', 'Cyber Dominion', 'Blackice', 'Rootkit', 'Zero Day', 'Ghostwire'],
  Healing:     ['Field Medic', 'Bio-Regen', 'Health Increase', 'Mend', 'Nano-Heal', 'Sanctuary Field', 'Regeneration', 'Renewal', 'Life Bloom', 'Vital Surge', 'Restoration', 'Second Wind', 'Lifegiver'],
  'Pet Bond':  ['Companion Link', 'Basic Pet Command', 'Pet Recon', 'Pack Tactics', 'Advanced Pet Command', 'Pet Combat Upgrade', 'Feral Bond', 'Cyber Symbiosis', 'Evolved Companion', 'Alpha Call', 'Primal Fury', 'Warbeast', 'Soul Tether'],
  Faction:     ['Faction Passive I', 'Resource Efficiency', 'Faction Passive II', 'Peacekeeper Drone', 'Faction Passive III', 'Resource Redistribution', 'Faction Passive IV', 'Ceasefire Protocol', 'Faction Ascendancy', 'Standard Bearer', 'Rallying Banner', 'Faction Legend', 'Ascendant'],
  Terraform:   ['Groundwork', 'Cultivate', 'Soil Reclamation', 'Verdant Growth', 'Terraform Pulse', 'Bloom', 'Gaia Engine', 'World Shaper', 'Genesis', 'Reclaimer', 'Green Tide', 'Terraformer', 'Worldheart'],
  Mobility:    ['Speed Increase', 'Fleet Foot', 'Enhanced Speed', 'Dash', 'Evasion', 'Windrunner', 'Sprint Protocol', 'Slipstream', 'Untouchable', 'Blur', 'Afterimage', 'Lightstep', 'Quicksilver'],
  Diplomacy:   ['Negotiation', 'Rally', 'Inspire', 'Broker Truce', 'Tactician', 'Vanguard', 'Envoy', 'Mediator', 'Sovereign Accord', 'Statecraft', 'Unifier', 'Peacemaker', 'Concord'],
  Scavenging:  ['Scavenge', 'Quick Hands', 'Salvage Rig', 'Resource Cache', 'Plunder', 'Stockpile', 'Ransack', 'Fortune', 'Grand Salvage', 'Hoarder', 'Prospector', 'Treasure Hunter', 'Magnate'],
};

function coreEffect(kind: EffectKind): SkillEffect {
  switch (kind) {
    case 'burst':   return { kind, magnitude: 16, target: 'enemy' };
    case 'shield':  return { kind, magnitude: 45, durationMs: 6000, target: 'self' };
    case 'regen':   return { kind, magnitude: 40, durationMs: 6000, target: 'self' };
    case 'stealth': return { kind, magnitude: 1, durationMs: 6000, target: 'self' };
    case 'haste':   return { kind, magnitude: 2, durationMs: 6000, target: 'self' };
    case 'atkBuff': return { kind, magnitude: 8, durationMs: 8000, target: 'self' };
    case 'defBuff': return { kind, magnitude: 6, durationMs: 8000, target: 'self' };
    case 'stun':    return { kind, magnitude: 1500, target: 'enemy' };
    case 'pacify':  return { kind, magnitude: 4000, target: 'enemy' };
    case 'slow':    return { kind, magnitude: 3000, target: 'enemy' };
  }
}

export const PLAYER_LEVEL_CAP = 100;
// Skill-point INCOME lives in balance.ts (the central balance knobs) so it scales with
// the same curves as XP/rewards — re-exported here for consumers of the old names.
export {
  SKILL_POINTS_BASE,
  SKILL_POINT_MILESTONE_BONUS as SKILL_POINTS_BONUS_PER_5,
  skillPointsAtLevel,
  totalSkillPointsForLevel,
} from '../services/balance';

const TIER_NODES = 12; // 4 rings × 3 nodes (tiers 2–5)
// Scaling skill-point cost by tier: L1 cheap, outer rings steeply expensive.
const TIER_COST: Record<number, number> = { 1: 1, 2: 3, 3: 5, 4: 7, 5: 10 };
export function costForTier(tier: number): number { return TIER_COST[tier] ?? tier; }

export function makeTree(): SkillNode[] {
  const nodes: SkillNode[] = [];
  nodes.push({ id: 'root', label: 'Origin', description: 'Your starting potential — the source of all paths.', type: 'root' as SkillType, tier: 0, branch: -1, category: 'attack', cost: 0 });
  BRANCHES.forEach(b => {
    const baseId = b.name.toLowerCase().replace(/\s+/g, '');
    const names = SKILL_NAMES[b.name] || [];
    const statLabel = b.stat === 'atk' ? 'ATK' : b.stat === 'def' ? 'DEF' : 'UTIL';
    // Core node (tier 1) — castable ability when the branch defines a bar/effect.
    nodes.push({
      id: `${baseId}_core`, label: names[0] || `${b.name} Core`,
      description: b.effect ? `${b.name} — a castable ability. +1 ${statLabel}. (1 pt)` : `${b.name} fundamentals. +1 ${statLabel}. (1 pt)`,
      type: b.type, tier: 1, branch: b.id, category: b.category, cost: 1,
      requires: ['root'], stats: { [b.stat]: 1 },
      active: !!b.bar, bar: b.bar,
      effect: b.effect ? coreEffect(b.effect) : undefined,
    });
    for (let i = 0; i < TIER_NODES; i++) {
      const t = 2 + Math.floor(i / 3);            // tier 2..5 (three per ring)
      const amount = t;                           // higher tier → bigger bonus (2..5)
      const cost = costForTier(t);                // scaling cost: 3 / 5 / 7 / 10
      const id = `${baseId}_${i + 1}`;
      const req = i < 3 ? [`${baseId}_core`] : [`${baseId}_${i - 2}`];
      nodes.push({
        id, label: names[i + 1] || `${b.name} ${i + 1}`,
        description: `+${amount} ${statLabel}. (${cost} pts)`,
        type: b.type, tier: t, branch: b.id, category: b.category, cost,
        requires: req,
        faction: b.id % 3 === 0 ? 'PAA' : b.id % 3 === 1 ? 'ASF' : 'WC',
        counters: i % 2 === 0 ? ['combat_core'] : ['defense_core'],
        stats: { [b.stat]: amount },
      });
    }
  });
  return nodes;
}

// ─── Traits — investing in a branch grants a real gameplay bonus ──────────────
export interface TraitDef {
  id: string; name: string; branch: string; threshold: number;
  bonus: Partial<StatBlock>; desc: string;
}
// Threshold = nodes unlocked in that branch (of 13). Bonuses feed computeEffectiveStats.
export const TRAITS: TraitDef[] = [
  { id: 'aggressor',   name: 'Aggressor',        branch: 'Combat',      threshold: 5, bonus: { atk: 6 },          desc: '+6 ATK' },
  { id: 'bulwark',     name: 'Bulwark',          branch: 'Defense',     threshold: 5, bonus: { def: 6, hp: 25 },  desc: '+6 DEF, +25 HP' },
  { id: 'ghost',       name: 'Ghost',            branch: 'Stealth',     threshold: 5, bonus: { spd: 2, atk: 3 },  desc: '+2 SPD, +3 ATK' },
  { id: 'augmented',   name: 'Augmented',        branch: 'Cybernetics', threshold: 5, bonus: { atk: 5, ep: 15 },  desc: '+5 ATK, +15 EP' },
  { id: 'netrunner',   name: 'Netrunner',        branch: 'Hacking',     threshold: 5, bonus: { ep: 20, atk: 2 },  desc: '+20 EP, +2 ATK' },
  { id: 'medic',       name: 'Medic',            branch: 'Healing',     threshold: 5, bonus: { hp: 45 },          desc: '+45 HP' },
  { id: 'beastmaster', name: 'Beastmaster',      branch: 'Pet Bond',    threshold: 5, bonus: { atk: 3, def: 3 },  desc: '+3 ATK, +3 DEF' },
  { id: 'champion',    name: 'Faction Champion', branch: 'Faction',     threshold: 5, bonus: { atk: 4, def: 4 },  desc: '+4 ATK, +4 DEF' },
  { id: 'terraformer', name: 'Terraformer',      branch: 'Terraform',   threshold: 5, bonus: { hp: 20, ep: 10 },  desc: '+20 HP, +10 EP' },
  { id: 'skirmisher',  name: 'Skirmisher',       branch: 'Mobility',    threshold: 5, bonus: { spd: 4 },          desc: '+4 SPD' },
  { id: 'diplomat',    name: 'Diplomat',         branch: 'Diplomacy',   threshold: 5, bonus: { def: 4, ep: 10 },  desc: '+4 DEF, +10 EP' },
  { id: 'scavenger',   name: 'Scavenger',        branch: 'Scavenging',  threshold: 5, bonus: { hp: 15, ep: 15 },  desc: '+15 HP, +15 EP' },
  // Capstone traits — deep specialisation (≥10 of 13 nodes). One per branch so a
  // high-level hero (L50–100 point budget) is rewarded for committing to any path.
  { id: 'warlord',     name: 'Warlord',          branch: 'Combat',      threshold: 10, bonus: { atk: 10 },         desc: '+10 ATK' },
  { id: 'immortal',    name: 'Immortal',         branch: 'Defense',     threshold: 10, bonus: { hp: 60, def: 6 },  desc: '+60 HP, +6 DEF' },
  { id: 'phantom',     name: 'Phantom',          branch: 'Stealth',     threshold: 10, bonus: { spd: 4, atk: 6 },  desc: '+4 SPD, +6 ATK' },
  { id: 'transhuman',  name: 'Transhuman',       branch: 'Cybernetics', threshold: 10, bonus: { atk: 9, ep: 25 },  desc: '+9 ATK, +25 EP' },
  { id: 'ghostwire',   name: 'Ghostwire',        branch: 'Hacking',     threshold: 10, bonus: { ep: 35, atk: 4 },  desc: '+35 EP, +4 ATK' },
  { id: 'lifegiver',   name: 'Lifegiver',        branch: 'Healing',     threshold: 10, bonus: { hp: 80 },          desc: '+80 HP' },
  { id: 'soulbound',   name: 'Soulbound',        branch: 'Pet Bond',    threshold: 10, bonus: { atk: 6, def: 6 },  desc: '+6 ATK, +6 DEF' },
  { id: 'ascendant',   name: 'Ascendant',        branch: 'Faction',     threshold: 10, bonus: { atk: 7, def: 7 },  desc: '+7 ATK, +7 DEF' },
  { id: 'worldheart',  name: 'Worldheart',       branch: 'Terraform',   threshold: 10, bonus: { hp: 40, ep: 20 },  desc: '+40 HP, +20 EP' },
  { id: 'quicksilver', name: 'Quicksilver',      branch: 'Mobility',    threshold: 10, bonus: { spd: 7 },          desc: '+7 SPD' },
  { id: 'concord',     name: 'Concord',          branch: 'Diplomacy',   threshold: 10, bonus: { def: 7, ep: 20 },  desc: '+7 DEF, +20 EP' },
  { id: 'magnate',     name: 'Magnate',          branch: 'Scavenging',  threshold: 10, bonus: { hp: 30, ep: 30 },  desc: '+30 HP, +30 EP' },
];

function branchCounts(unlocked: string[], nodes: SkillNode[]): Record<string, number> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const byBranch: Record<string, number> = {};
  for (const id of unlocked) {
    const n = byId.get(id); if (!n || n.branch < 0) continue;
    const b = BRANCHES.find(br => br.id === n.branch)?.name || 'root';
    byBranch[b] = (byBranch[b] || 0) + 1;
  }
  return byBranch;
}

/** Traits currently active for a set of unlocked nodes. */
export function activeTraits(unlocked: string[], nodes: SkillNode[]): TraitDef[] {
  const counts = branchCounts(unlocked, nodes);
  return TRAITS.filter(t => (counts[t.branch] || 0) >= t.threshold);
}

/** Aggregate StatBlock bonus from all active traits — fed into computeEffectiveStats. */
export function deriveTraitBonus(unlocked: string[], nodes: SkillNode[]): Partial<StatBlock> {
  const out: Partial<StatBlock> = {};
  for (const t of activeTraits(unlocked, nodes)) {
    (Object.keys(t.bonus) as (keyof StatBlock)[]).forEach(k => { out[k] = (out[k] || 0) + (t.bonus[k] || 0); });
  }
  return out;
}

// ─── Derived helpers ─────────────────────────────────────────────────────────
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

export const CATEGORY_ICON: Record<SkillCategory, string> = {
  attack: '⚔️', defense: '🛡️', mobility: '🦶', stealth: '🥷',
  pet: '🐾', faction: '🏳️', vitality: '❤️', utility: '🧪',
};
const _ICON_TREE = makeTree();
const _ICON_BY_ID = new Map(_ICON_TREE.map(n => [n.id, n]));
export function skillIconFor(id: string): string {
  const n = _ICON_BY_ID.get(id);
  return n ? (CATEGORY_ICON[n.category] ?? '⬢') : '⬢';
}
export function skillEffectFor(id: string): SkillEffect | undefined { return _ICON_BY_ID.get(id)?.effect; }
export function skillLabelFor(id: string): string { return _ICON_BY_ID.get(id)?.label ?? id; }

export function deriveTraits(unlocked: string[], nodes: SkillNode[]) {
  const counts = branchCounts(unlocked, nodes);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const byType: Record<string, number> = {};
  unlocked.forEach(id => { const n = byId.get(id); if (n && n.branch >= 0) byType[n.category] = (byType[n.category] || 0) + 1; });
  const topBranch = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0];
  const tags = activeTraits(unlocked, nodes).map(t => t.name);
  return { topBranch, topType, tags };
}
