import { create } from 'zustand';
import { makeTree, deriveTraits } from './skillData';

export interface SkillState {
  level: number;
  unlocked: string[]; // node ids
  spent: number;
  basePoints: number; // starting pool (e.g. 12)
  bonusPer5: number;  // bonus every 5 levels
  unlock: (id: string) => void;
  respec: () => void;
  unlockOrder: string[]; // chronological order (excluding root)
  setLevel: (lvl: number) => void;
  reset: () => void;
  // Derived combat-style stats
  attack: number;
  defense: number;
  utility: number;
  primaryBranch?: string;
  primaryType?: string;
  traitTags: string[];
}

function deriveStats(unlocked: string[]): { attack:number; defense:number; utility:number } {
  // Simple mapping heuristics by substring (can refine later)
  let attack=0, defense=0, utility=0;
  unlocked.forEach(id => {
    if (id.includes('combat') || id.includes('weapon')) attack += 2;
    if (id.includes('defense') || id.includes('shield')) defense += 2;
    if (id.includes('support') || id.includes('leadership') || id.includes('mobility')) utility += 2;
    if (id.includes('terraform') || id.includes('technologist')) utility += 1;
  });
  return { attack, defense, utility };
}

const TREE = makeTree();

export const useSkillStore = create<SkillState>((set, get) => ({
  level: 1,
  unlocked: ['root'],
  spent: 0,
  basePoints: 12,
  bonusPer5: 3,
  unlockOrder: [],
  attack: 0,
  defense: 0,
  utility: 0,
  traitTags: [],
  unlock: (id: string) => set(state => {
    if (state.unlocked.includes(id)) {
      console.debug('[skillStore.unlock] already unlocked', { id });
      return state;
    }
    // guard: must have available points
    const avail = availablePoints(state);
    if (avail <= 0) {
      console.debug('[skillStore.unlock] no available points', { id, avail, spent: state.spent, basePoints: state.basePoints, level: state.level });
      return state;
    }
    console.debug('[skillStore.unlock] unlocking', { id, beforeUnlockedCount: state.unlocked.length, availBefore: avail });
    const nextUnlocked = [...state.unlocked, id];
    const nextOrder = [...state.unlockOrder, id];
    const stats = deriveStats(nextUnlocked);
    const traits = deriveTraits(nextUnlocked, TREE);
    const newState = { unlocked: nextUnlocked, unlockOrder: nextOrder, spent: state.spent + 1, ...stats, primaryBranch: traits.topBranch, primaryType: traits.topType, traitTags: traits.tags } as const;
    console.debug('[skillStore.unlock] success', { id, afterUnlockedCount: newState.unlocked.length, spent: newState.spent });
    return newState;
  }),
  respec: () => set(state => {
    if (!state.unlockOrder.length) return state;
    // Keep root only; optionally keep level and basePoints untouched.
    const resetUnlocked = ['root'];
    const stats = deriveStats(resetUnlocked);
    const traits = deriveTraits(resetUnlocked, TREE);
    return { unlocked: resetUnlocked, unlockOrder: [], spent: 0, ...stats, primaryBranch: traits.topBranch, primaryType: traits.topType, traitTags: traits.tags };
  }),
  setLevel: (lvl: number) => set(state => ({ level: Math.max(1,lvl) })),
  reset: () => set({ level: 1, unlocked: ['root'], unlockOrder: [], spent: 0, attack:0, defense:0, utility:0, traitTags: [], primaryBranch: undefined, primaryType: undefined }),
}));

export function availablePoints(state: SkillState) {
  const bonusBlocks = Math.floor((Math.max(1,state.level)-1)/5);
  return state.basePoints + bonusBlocks * state.bonusPer5 - state.spent;
}
