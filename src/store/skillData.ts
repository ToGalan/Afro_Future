import { SkillType } from '../components/SnowflakeSkillTree';

/** Per-node stat contribution. Summed across unlocked nodes into attack/defense/utility. */
export interface SkillStats { atk?: number; def?: number; util?: number; }
export interface SkillNode { id: string; label: string; description: string; type: SkillType; tier: number; branch: number; requires?: string[]; counters?: string[]; faction?: 'PAA' | 'ASF' | 'WC'; stats?: SkillStats; }
export interface BranchDef { id: number; name: string; type: SkillType; stat: 'atk' | 'def' | 'util'; }

export const BRANCHES: BranchDef[] = [
  { id: 0,  name: 'Combat',       type: 'stat',    stat: 'atk' },
  { id: 1,  name: 'Support',      type: 'buff',    stat: 'util' },
  { id: 2,  name: 'Pet Bond',     type: 'ability', stat: 'util' },
  { id: 3,  name: 'Weapons',      type: 'weapon',  stat: 'atk' },
  { id: 4,  name: 'Spellcraft',   type: 'spell',   stat: 'atk' },
  { id: 5,  name: 'Defense',      type: 'buff',    stat: 'def' },
  { id: 6,  name: 'Mobility',     type: 'ability', stat: 'util' },
  { id: 7,  name: 'Leadership',   type: 'zone',    stat: 'util' },
  { id: 8,  name: 'Terraform',    type: 'ability', stat: 'util' },
  { id: 9,  name: 'Technologist', type: 'ability', stat: 'util' },
  { id: 10, name: 'Merchant',     type: 'trade',   stat: 'util' },
  { id: 11, name: 'Looting',      type: 'ability', stat: 'util' },
];

// Human-readable skill names per branch (index 0 = core, 1..8 = tier skills).
const SKILL_NAMES: Record<string, string[]> = {
  Combat:       ['Combat Training', 'Power Strike', 'Cleave', 'Adrenaline', 'Berserk', 'Executioner', 'Battle Fury', 'Rampage', 'Warlord'],
  Support:      ['Field Medic', 'Mend', 'Rally Cry', 'Regeneration', 'Sanctuary', 'Second Wind', 'Guardian Aura', 'Renewal', 'Benediction'],
  'Pet Bond':   ['Companion Link', 'Fetch', 'Pack Tactics', 'Beast Ward', 'Feral Bond', 'Alpha Call', 'Symbiosis', 'Primal Fury', 'Soul Tether'],
  Weapons:      ['Weapon Mastery', 'Sharpen', 'Rapid Reload', 'Piercing Rounds', 'Twin Blades', 'Overdraw', 'Arsenal', 'Deadeye', 'Armament'],
  Spellcraft:   ['Arcane Focus', 'Firebolt', 'Frost Nova', 'Chain Spark', 'Mana Surge', 'Runic Ward', 'Meteor', 'Elemental Mastery', 'Archmage'],
  Defense:      ['Iron Skin', 'Bulwark', 'Deflect', 'Fortify', 'Bastion', 'Stone Form', 'Aegis', 'Unbreakable', 'Colossus'],
  Mobility:     ['Fleet Foot', 'Dash', 'Evasion', 'Sprint', 'Blink Step', 'Windrunner', 'Phantom Stride', 'Slipstream', 'Untouchable'],
  Leadership:   ['Command', 'Inspire', 'Banner', 'War Drums', 'Tactician', 'Vanguard', 'Warchief', 'Sovereign', 'Legend'],
  Terraform:    ['Groundwork', 'Cultivate', 'Reshape', 'Verdant Growth', 'Seismic Shift', 'Bloom', 'Gaia Touch', 'World Shaper', 'Genesis'],
  Technologist: ['Tinker', 'Overclock', 'Deploy Turret', 'Nanobots', 'Shield Matrix', 'EMP', 'Drone Swarm', 'Singularity', 'Ascendant Tech'],
  Merchant:     ['Bargain', 'Appraise', 'Stockpile', 'Trade Route', 'Market Insight', 'Investor', 'Monopoly', 'Tycoon', 'Magnate'],
  Looting:      ['Scavenge', 'Quick Hands', 'Treasure Sense', 'Lockpick', 'Plunder', 'Greed', 'Ransack', 'Fortune', 'Grand Heist'],
};

export function makeTree(): SkillNode[] {
  const nodes: SkillNode[] = [];
  nodes.push({ id: 'root', label: 'Origin', description: 'Your starting potential — the source of all paths.', type: 'root' as SkillType, tier: 0, branch: -1 });
  BRANCHES.forEach(b => {
    const baseId = b.name.toLowerCase().replace(/\s+/g,'');
    const names = SKILL_NAMES[b.name] || [];
    const statLabel = b.stat === 'atk' ? 'ATK' : b.stat === 'def' ? 'DEF' : 'UTIL';
    // Core node (tier 1)
    nodes.push({
      id: `${baseId}_core`, label: names[0] || `${b.name} Core`,
      description: `${b.name} fundamentals. +1 ${statLabel}.`,
      type: b.type, tier: 1, branch: b.id, requires: ['root'], stats: { [b.stat]: 1 },
    });
    for (let i=0;i<8;i++) {
      const t = 2 + Math.floor(i / 3);            // tier 2..4
      const amount = t;                           // higher tier → bigger bonus (2..4)
      const id = `${baseId}_${i+1}`;
      const req = i < 3 ? [`${baseId}_core`] : [`${baseId}_${i-2}`];
      nodes.push({
        id,
        label: names[i+1] || `${b.name} ${i+1}`,
        description: `+${amount} ${statLabel}.`,
        type: b.type,
        tier: t,
        branch: b.id,
        requires: req,
        faction: b.id % 3 === 0 ? 'PAA' : b.id % 3 === 1 ? 'ASF' : 'WC',
        counters: i % 2 === 0 ? ['combat_core'] : ['support_core'],
        stats: { [b.stat]: amount },
      });
    }
  });
  return nodes;
}

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

export function deriveTraits(unlocked: string[], nodes: SkillNode[]) {
  const byBranch: Record<string, number> = {}; const byType: Record<string, number> = {};
  unlocked.forEach(id => { const n = nodes.find(x=>x.id===id); if (!n) return; const b = BRANCHES.find(br=>br.id===n.branch)?.name || 'root'; byBranch[b]=(byBranch[b]||0)+1; byType[n.type]=(byType[n.type]||0)+1; });
  const topBranch = Object.entries(byBranch).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const topType = Object.entries(byType).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const tags: string[] = [];
  if ((byBranch['Leadership']||0) >= 4) tags.push('Commander');
  if ((byBranch['Terraform']||0) >= 4) tags.push('Terraformer');
  if ((byBranch['Technologist']||0) >= 4) tags.push('Technocrat');
  if ((byBranch['Merchant']||0) >= 4) tags.push('Trader');
  if ((byBranch['Looting']||0) >= 4) tags.push('Raider');
  if ((byBranch['Combat']||0) >= 4) tags.push('Aggressor');
  if ((byBranch['Support']||0) >= 4) tags.push('Support Specialist');
  if ((byBranch['Mobility']||0) >= 4) tags.push('Skirmisher');
  return { topBranch, topType, tags };
}
