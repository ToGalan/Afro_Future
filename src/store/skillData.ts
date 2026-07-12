import { SkillType } from '../components/SnowflakeSkillTree';

/**
 * Snowflake skill tree — a 12-branch radial "snowflake" of skills, re-themed to the
 * Afro-Future Rising GDD (story + missions): cybernetics, hacking/diplomacy, stealth,
 * healing/terraforming, factions and pet bonding — no generic fantasy spells.
 *
 * Structure (unchanged from the classic snowflake): a central Origin, one CORE node per
 * branch, then 8 tier nodes fanning outward. CORE nodes of combat-relevant branches are
 * castable ABILITIES that carry a buff/debuff `effect` (consumed by services/statusEffects
 * + SoloMissionMap3D.activateAbility); the rest are passive stat nodes.
 */

// ─── Categories (also the SkillType used for colouring) ───────────────────────
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
  magnitude: number;
  durationMs?: number;
  target: 'self' | 'enemy';
}

export interface SkillNode {
  id: string;
  label: string;
  description: string;
  type: SkillType;          // = category (kept as `type` for the UI/colour code)
  tier: number;             // 1 (core) … 4 (outer)
  branch: number;           // lane index (−1 for root)
  category: SkillCategory;
  cost: number;             // skill-point cost (1 per node — classic snowflake pacing)
  active?: boolean;         // castable ability → auto-slots into an ability bar
  bar?: 'offensive' | 'defensive';
  requires?: string[];
  counters?: string[];
  faction?: 'PAA' | 'ASF' | 'WC';
  stats?: SkillStats;
  effect?: SkillEffect;
}

// Branch definition: GDD-themed name, colour category, primary stat, and (for combat
// branches) the ability bar + effect its CORE node casts.
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

// GDD-themed skill names per branch (index 0 = core, 1..8 = tier skills).
const SKILL_NAMES: Record<string, string[]> = {
  Combat:      ['Combat Training', 'Power Strike', 'Guerrilla Strike', 'Suppressing Fire', 'Overload Strike', 'Elite Assault', 'War Cry', 'Executioner', 'Onslaught'],
  Defense:     ['Shield Activation', 'Reactive Plating', 'Deflect', 'Fortify', 'Full Shield Mode', 'Bulwark', 'Bastion', 'Aegis Protocol', 'Unbreakable'],
  Stealth:     ['Stealth Mode', 'Silent Step', 'Cloaking Field', 'Ambush', 'Enhanced Stealth', 'Ghost Protocol', 'Shadowstrike', 'Phantom Cloak', 'Untraceable'],
  Cybernetics: ['Cyber Enhancement', 'Reflex Booster', 'Servo Strength', 'Neural Uplink', 'Cybernetic Overload', 'Nano-Edge', 'Combat Chassis', 'Titan Frame', 'Ascendant Cyberform'],
  Hacking:     ['Basic Hacking', 'System Breach', 'Firewall Bypass', 'Drone Hijack', 'Advanced Hacking', 'EMP Burst', 'Network Siege', 'Master Intrusion', 'Cyber Dominion'],
  Healing:     ['Field Medic', 'Bio-Regen', 'Health Increase', 'Mend', 'Nano-Heal', 'Sanctuary Field', 'Regeneration', 'Renewal', 'Life Bloom'],
  'Pet Bond':  ['Companion Link', 'Basic Pet Command', 'Pet Recon', 'Pack Tactics', 'Advanced Pet Command', 'Pet Combat Upgrade', 'Feral Bond', 'Cyber Symbiosis', 'Evolved Companion'],
  Faction:     ['Faction Passive I', 'Resource Efficiency', 'Faction Passive II', 'Peacekeeper Drone', 'Faction Passive III', 'Resource Redistribution', 'Faction Passive IV', 'Ceasefire Protocol', 'Faction Ascendancy'],
  Terraform:   ['Groundwork', 'Cultivate', 'Soil Reclamation', 'Verdant Growth', 'Terraform Pulse', 'Bloom', 'Gaia Engine', 'World Shaper', 'Genesis'],
  Mobility:    ['Speed Increase', 'Fleet Foot', 'Enhanced Speed', 'Dash', 'Evasion', 'Windrunner', 'Sprint Protocol', 'Slipstream', 'Untouchable'],
  Diplomacy:   ['Negotiation', 'Rally', 'Inspire', 'Broker Truce', 'Tactician', 'Vanguard', 'Envoy', 'Mediator', 'Sovereign Accord'],
  Scavenging:  ['Scavenge', 'Quick Hands', 'Salvage Rig', 'Resource Cache', 'Plunder', 'Stockpile', 'Ransack', 'Fortune', 'Grand Salvage'],
};

// The effect a branch's CORE node casts, scaled modestly (snowflake cores are entry-tier).
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
export const SKILL_POINTS_BASE = 3;
export const SKILL_POINTS_PER_LEVEL = 1;    // classic snowflake pacing: 1 point per level
export const SKILL_POINTS_BONUS_PER_5 = 2;

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
      description: b.effect ? `${b.name} — a castable ability. +1 ${statLabel}.` : `${b.name} fundamentals. +1 ${statLabel}.`,
      type: b.type, tier: 1, branch: b.id, category: b.category, cost: 1,
      requires: ['root'], stats: { [b.stat]: 1 },
      active: !!b.bar, bar: b.bar,
      effect: b.effect ? coreEffect(b.effect) : undefined,
    });
    for (let i = 0; i < 8; i++) {
      const t = 2 + Math.floor(i / 3);           // tier 2..4
      const amount = t;                          // higher tier → bigger bonus (2..4)
      const id = `${baseId}_${i + 1}`;
      const req = i < 3 ? [`${baseId}_core`] : [`${baseId}_${i - 2}`];
      nodes.push({
        id, label: names[i + 1] || `${b.name} ${i + 1}`,
        description: `+${amount} ${statLabel}.`,
        type: b.type, tier: t, branch: b.id, category: b.category, cost: 1,
        requires: req,
        faction: b.id % 3 === 0 ? 'PAA' : b.id % 3 === 1 ? 'ASF' : 'WC',
        counters: i % 2 === 0 ? ['combat_core'] : ['defense_core'],
        stats: { [b.stat]: amount },
      });
    }
  });
  return nodes;
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

// Category → HUD icon. Used by the ability bars and skills modal.
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
  if ((byBranch['Combat'] || 0) >= 4) tags.push('Aggressor');
  if ((byBranch['Defense'] || 0) >= 4) tags.push('Bulwark');
  if ((byBranch['Stealth'] || 0) >= 4) tags.push('Ghost');
  if ((byBranch['Cybernetics'] || 0) >= 4) tags.push('Augmented');
  if ((byBranch['Hacking'] || 0) >= 4) tags.push('Netrunner');
  if ((byBranch['Healing'] || 0) >= 4) tags.push('Medic');
  if ((byBranch['Pet Bond'] || 0) >= 4) tags.push('Beastmaster');
  if ((byBranch['Terraform'] || 0) >= 4) tags.push('Terraformer');
  if ((byBranch['Faction'] || 0) >= 4) tags.push('Faction Champion');
  if ((byBranch['Diplomacy'] || 0) >= 4) tags.push('Diplomat');
  if ((byBranch['Scavenging'] || 0) >= 4) tags.push('Scavenger');
  return { topBranch, topType, tags };
}
