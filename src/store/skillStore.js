import { create } from 'zustand';
import { makeTree, deriveTraits } from './skillData';
function deriveStats(unlocked) {
    // Simple mapping heuristics by substring (can refine later)
    let attack = 0, defense = 0, utility = 0;
    unlocked.forEach(id => {
        if (id.includes('combat') || id.includes('weapon'))
            attack += 2;
        if (id.includes('defense') || id.includes('shield'))
            defense += 2;
        if (id.includes('support') || id.includes('leadership') || id.includes('mobility'))
            utility += 2;
        if (id.includes('terraform') || id.includes('technologist'))
            utility += 1;
    });
    return { attack, defense, utility };
}
const TREE = makeTree();
const INIT_UNLOCKED = ['root'];
const INIT_STATS = (function () {
    // mirror deriveStats for initial unlocked state
    let attack = 0, defense = 0, utility = 0;
    INIT_UNLOCKED.forEach(id => {
        if (id.includes('combat') || id.includes('weapon'))
            attack += 2;
        if (id.includes('defense') || id.includes('shield'))
            defense += 2;
        if (id.includes('support') || id.includes('leadership') || id.includes('mobility'))
            utility += 2;
        if (id.includes('terraform') || id.includes('technologist'))
            utility += 1;
    });
    return { attack, defense, utility };
})();
const INIT_TRAITS = deriveTraits(INIT_UNLOCKED, TREE);
export const useSkillStore = create((set, get) => ({
    level: 1,
    unlocked: INIT_UNLOCKED,
    spent: 0,
    basePoints: 12,
    bonusPer5: 3,
    unlockOrder: [],
    attack: INIT_STATS.attack,
    defense: INIT_STATS.defense,
    utility: INIT_STATS.utility,
    traitTags: INIT_TRAITS.tags,
    primaryBranch: INIT_TRAITS.topBranch,
    primaryType: INIT_TRAITS.topType,
    hydrate: (data) => set((state) => {
        const nextUnlocked = Array.isArray(data.unlocked) && data.unlocked.length ? data.unlocked : state.unlocked;
        const nextOrder = Array.isArray(data.unlockOrder) ? data.unlockOrder : state.unlockOrder;
        const nextLevel = typeof data.level === 'number' ? Math.max(1, data.level) : state.level;
        const stats = deriveStats(nextUnlocked);
        const traits = deriveTraits(nextUnlocked, TREE);
        const spent = Math.max(0, nextUnlocked.length - 1); // exclude root
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
        };
    }),
    unlock: (id) => set(state => {
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
        const newState = { unlocked: nextUnlocked, unlockOrder: nextOrder, spent: state.spent + 1, ...stats, primaryBranch: traits.topBranch, primaryType: traits.topType, traitTags: traits.tags };
        console.debug('[skillStore.unlock] success', { id, afterUnlockedCount: newState.unlocked.length, spent: newState.spent });
        return newState;
    }),
    respec: () => set(state => {
        if (!state.unlockOrder.length)
            return state;
        // Keep root only; optionally keep level and basePoints untouched.
        const resetUnlocked = ['root'];
        const stats = deriveStats(resetUnlocked);
        const traits = deriveTraits(resetUnlocked, TREE);
        return { unlocked: resetUnlocked, unlockOrder: [], spent: 0, ...stats, primaryBranch: traits.topBranch, primaryType: traits.topType, traitTags: traits.tags };
    }),
    setLevel: (lvl) => set(state => ({ level: Math.max(1, lvl) })),
    reset: () => set({ level: 1, unlocked: ['root'], unlockOrder: [], spent: 0, attack: 0, defense: 0, utility: 0, traitTags: [], primaryBranch: undefined, primaryType: undefined }),
}));
export function availablePoints(state) {
    const bonusBlocks = Math.floor((Math.max(1, state.level) - 1) / 5);
    return state.basePoints + bonusBlocks * state.bonusPer5 - state.spent;
}
