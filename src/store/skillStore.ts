import { create } from 'zustand';
import {
  makeTree, deriveTraits, deriveTraitBonus, sumSkillStats, sumSkillCost,
  SKILL_POINTS_BASE, SKILL_POINTS_BONUS_PER_5, totalSkillPointsForLevel, PLAYER_LEVEL_CAP,
  type SkillNode,
} from './skillData';
import type { StatBlock } from '../services/playerStats';

export interface AbilityLoadout {
  offensive: (string | null)[];  // 4 slots for Q/E/R/T
  defensive: (string | null)[];  // 4 slots for Z/X/C/V
}

export interface SkillState {
  level: number;
  unlocked: string[]; // grid skill ids
  spent: number;      // total skill-POINT cost of unlocked nodes (not node count)
  basePoints: number; // starting pool
  bonusPer5: number;  // bonus every 5 levels
  unlock: (id: string) => void;
  respec: () => void;
  unlockOrder: string[]; // chronological order
  setLevel: (lvl: number) => void;
  reset: () => void;
  // Server sync: replace core fields and recompute derived
  hydrate: (data: { level?: number; unlocked?: string[]; unlockOrder?: string[]; abilityLoadout?: Partial<AbilityLoadout> }) => void;
  // Derived combat-style stats
  attack: number;
  defense: number;
  utility: number;
  primaryBranch?: string;
  primaryType?: string;
  traitTags: string[];
  // Aggregate StatBlock bonus from active traits (fed into computeEffectiveStats).
  traitBonus: Partial<StatBlock>;
  // Ability slot assignments
  abilityLoadout: AbilityLoadout;
  setAbilitySlot: (category: 'offensive' | 'defensive', slot: number, skillId: string | null) => void;
}

const TREE = makeTree();
const TREE_BY_ID = new Map(TREE.map(n => [n.id, n]));
// Stats come from each node's explicit `stats` (defined in skillData).
function deriveStats(unlocked: string[]): { attack: number; defense: number; utility: number } {
  return sumSkillStats(unlocked, TREE);
}
// Which ability bar an unlocked skill auto-slots into (only ACTIVE/castable skills).
function abilityBar(node: SkillNode | undefined): 'offensive' | 'defensive' | null {
  if (!node || !node.active) return null;
  return node.bar ?? null;
}

const INIT_UNLOCKED = ['root'];
const INIT_STATS = deriveStats(INIT_UNLOCKED);
const INIT_TRAITS = deriveTraits(INIT_UNLOCKED, TREE);
const INIT_TRAIT_BONUS = deriveTraitBonus(INIT_UNLOCKED, TREE);

export const useSkillStore = create<SkillState>((set) => ({
  level: 1,
  unlocked: INIT_UNLOCKED,
  spent: 0,
  basePoints: SKILL_POINTS_BASE,
  bonusPer5: SKILL_POINTS_BONUS_PER_5,
  unlockOrder: [],
  attack: INIT_STATS.attack,
  defense: INIT_STATS.defense,
  utility: INIT_STATS.utility,
  traitTags: INIT_TRAITS.tags,
  traitBonus: INIT_TRAIT_BONUS,
  primaryBranch: INIT_TRAITS.topBranch,
  primaryType: INIT_TRAITS.topType,
  abilityLoadout: { offensive: [null, null, null, null], defensive: [null, null, null, null] },
  setAbilitySlot: (category, slot, skillId) => set(state => {
    const next = [...state.abilityLoadout[category]] as (string | null)[];
    if (slot >= 0 && slot < 4) next[slot] = skillId;
    return { abilityLoadout: { ...state.abilityLoadout, [category]: next } };
  }),
  hydrate: (data) => set((state) => {
    const nextUnlocked = Array.isArray(data.unlocked) && data.unlocked.length ? data.unlocked : state.unlocked;
    const nextOrder = Array.isArray(data.unlockOrder) ? data.unlockOrder : state.unlockOrder;
    const nextLevel = typeof data.level === 'number' ? Math.max(1, Math.min(PLAYER_LEVEL_CAP, data.level)) : state.level;
    const stats = deriveStats(nextUnlocked);
    const traits = deriveTraits(nextUnlocked, TREE);
    const traitBonus = deriveTraitBonus(nextUnlocked, TREE);
    const spent = sumSkillCost(nextUnlocked, TREE);
    const nextLoadout: AbilityLoadout = data.abilityLoadout ? {
      offensive: Array.isArray(data.abilityLoadout.offensive) && data.abilityLoadout.offensive.length === 4 ? data.abilityLoadout.offensive : state.abilityLoadout.offensive,
      defensive: Array.isArray(data.abilityLoadout.defensive) && data.abilityLoadout.defensive.length === 4 ? data.abilityLoadout.defensive : state.abilityLoadout.defensive,
    } : state.abilityLoadout;
    return {
      level: nextLevel,
      unlocked: nextUnlocked,
      unlockOrder: nextOrder,
      spent,
      attack: stats.attack,
      defense: stats.defense,
      utility: stats.utility,
      primaryBranch: traits.topBranch,
      primaryType: traits.topType,
      traitTags: traits.tags,
      traitBonus,
      abilityLoadout: nextLoadout,
    } as Partial<SkillState> as SkillState;
  }),
  unlock: (id: string) => set(state => {
    if (state.unlocked.includes(id)) return state;
    const node = TREE_BY_ID.get(id);
    if (!node) return state;
    const cost = node.cost || 0;
    if (availablePoints(state) < cost) { console.debug('[skillStore.unlock] not enough points', { id, cost }); return state; }
    const nextUnlocked = [...state.unlocked, id];
    const nextOrder = [...state.unlockOrder, id];
    const stats = deriveStats(nextUnlocked);
    const traits = deriveTraits(nextUnlocked, TREE);
    const traitBonus = deriveTraitBonus(nextUnlocked, TREE);
    // Auto-slot a newly unlocked ACTIVE skill into a free bar slot so it shows in the HUD.
    let abilityLoadout = state.abilityLoadout;
    const bar = abilityBar(node);
    if (bar) {
      const slots = [...state.abilityLoadout[bar]] as (string | null)[];
      const free = slots.indexOf(null);
      if (free >= 0 && !slots.includes(id)) { slots[free] = id; abilityLoadout = { ...state.abilityLoadout, [bar]: slots }; }
    }
    return { unlocked: nextUnlocked, unlockOrder: nextOrder, spent: state.spent + cost, abilityLoadout, ...stats, primaryBranch: traits.topBranch, primaryType: traits.topType, traitTags: traits.tags, traitBonus } as Partial<SkillState> as SkillState;
  }),
  respec: () => set(state => {
    if (!state.unlockOrder.length) return state;
    const resetUnlocked = ['root'];
    const stats = deriveStats(resetUnlocked);
    const traits = deriveTraits(resetUnlocked, TREE);
    return { unlocked: resetUnlocked, unlockOrder: [], spent: 0, ...stats, primaryBranch: traits.topBranch, primaryType: traits.topType, traitTags: traits.tags, traitBonus: {}, abilityLoadout: { offensive: [null, null, null, null], defensive: [null, null, null, null] } } as Partial<SkillState> as SkillState;
  }),
  setLevel: (lvl: number) => set(() => ({ level: Math.max(1, Math.min(PLAYER_LEVEL_CAP, lvl)) })),
  reset: () => set({ level: 1, unlocked: ['root'], unlockOrder: [], spent: 0, attack: 0, defense: 0, utility: 0, traitTags: [], traitBonus: {}, primaryBranch: undefined, primaryType: undefined, abilityLoadout: { offensive: [null, null, null, null], defensive: [null, null, null, null] } }),
}));

// Scaling economy: income comes from balance.ts's level-scaled curve (2/level early,
// rising to 5/level late, + a milestone bonus every 5th level) so skill points keep
// pace with the steepening XP curve. `spent` is the total skill-POINT cost of unlocked
// nodes, so rising per-node tier costs pace how deep a player can go at a given level.
export function availablePoints(state: SkillState) {
  return totalSkillPointsForLevel(Math.max(1, state.level)) - state.spent;
}
