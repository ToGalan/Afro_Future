import { create } from 'zustand';
import { makeTree, deriveTraits, sumSkillStats } from './skillData';

export interface AbilityLoadout {
  offensive: (string | null)[];  // 4 slots for Q/W/E/R
  defensive: (string | null)[];  // 4 slots for defensive abilities
}

export interface SkillState {
  level: number;
  unlocked: string[]; // grid skill ids
  spent: number;
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
  // Ability slot assignments
  abilityLoadout: AbilityLoadout;
  setAbilitySlot: (category: 'offensive' | 'defensive', slot: number, skillId: string | null) => void;
}

const TREE = makeTree();
// Stats come from each node's explicit `stats` (defined in skillData).
function deriveStats(unlocked: string[]): { attack: number; defense: number; utility: number } {
  return sumSkillStats(unlocked, TREE);
}

const INIT_UNLOCKED = ['root'];
const INIT_STATS = deriveStats(INIT_UNLOCKED);
const INIT_TRAITS = deriveTraits(INIT_UNLOCKED, TREE);

export const useSkillStore = create<SkillState>((set) => ({
  level: 1,
  unlocked: INIT_UNLOCKED,
  spent: 0,
  basePoints: 3,   // starting points at level 1
  bonusPer5: 2,    // extra points every 5th level (on top of 1/level)
  unlockOrder: [],
  attack: INIT_STATS.attack,
  defense: INIT_STATS.defense,
  utility: INIT_STATS.utility,
  traitTags: INIT_TRAITS.tags,
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
    const nextLevel = typeof data.level === 'number' ? Math.max(1, data.level) : state.level;
    const stats = deriveStats(nextUnlocked);
    const traits = deriveTraits(nextUnlocked, TREE);
    const spent = Math.max(0, nextUnlocked.length - 1); // exclude root
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
      abilityLoadout: nextLoadout,
    } as Partial<SkillState> as SkillState;
  }),
  unlock: (id: string) => set(state => {
    if (state.unlocked.includes(id)) return state;
    if (availablePoints(state) <= 0) { console.debug('[skillStore.unlock] no points', { id }); return state; }
    const nextUnlocked = [...state.unlocked, id];
    const nextOrder = [...state.unlockOrder, id];
    const stats = deriveStats(nextUnlocked);
    const traits = deriveTraits(nextUnlocked, TREE);
    return { unlocked: nextUnlocked, unlockOrder: nextOrder, spent: state.spent + 1, ...stats, primaryBranch: traits.topBranch, primaryType: traits.topType, traitTags: traits.tags } as Partial<SkillState> as SkillState;
  }),
  respec: () => set(state => {
    if (!state.unlockOrder.length) return state;
    const resetUnlocked = ['root'];
    const stats = deriveStats(resetUnlocked);
    const traits = deriveTraits(resetUnlocked, TREE);
    return { unlocked: resetUnlocked, unlockOrder: [], spent: 0, ...stats, primaryBranch: traits.topBranch, primaryType: traits.topType, traitTags: traits.tags, abilityLoadout: { offensive: [null, null, null, null], defensive: [null, null, null, null] } } as Partial<SkillState> as SkillState;
  }),
  setLevel: (lvl: number) => set(() => ({ level: Math.max(1, lvl) })),
  reset: () => set({ level: 1, unlocked: ['root'], unlockOrder: [], spent: 0, attack: 0, defense: 0, utility: 0, traitTags: [], primaryBranch: undefined, primaryType: undefined, abilityLoadout: { offensive: [null, null, null, null], defensive: [null, null, null, null] } }),
}));

// Scaling economy: 3 base + 1 per level + a bonus every 5th level. Ties directly to
// the XP economy — gaining XP levels you up, which grants points to spend here.
export function availablePoints(state: SkillState) {
  const lvl = Math.max(1, state.level);
  const bonusBlocks = Math.floor((lvl - 1) / 5);
  return state.basePoints + (lvl - 1) + bonusBlocks * state.bonusPer5 - state.spent;
}
