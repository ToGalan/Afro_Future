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
export const useSkillStore = create((set, get) => ({
    level: 1,
    unlocked: ['root'],
    spent: 0,
    basePoints: 12,
    bonusPer5: 3,
    attack: 0,
    defense: 0,
    utility: 0,
    traitTags: [],
    unlock: (id) => set(state => {
        if (state.unlocked.includes(id))
            return state;
        // guard: must have available points
        const avail = availablePoints(state);
        if (avail <= 0)
            return state;
        const nextUnlocked = [...state.unlocked, id];
        const stats = deriveStats(nextUnlocked);
        const traits = deriveTraits(nextUnlocked, TREE);
        return { unlocked: nextUnlocked, spent: state.spent + 1, ...stats, primaryBranch: traits.topBranch, primaryType: traits.topType, traitTags: traits.tags };
    }),
    setLevel: (lvl) => set(state => ({ level: Math.max(1, lvl) })),
    reset: () => set({ level: 1, unlocked: ['root'], spent: 0, attack: 0, defense: 0, utility: 0, traitTags: [], primaryBranch: undefined, primaryType: undefined }),
}));
export function availablePoints(state) {
    const bonusBlocks = Math.floor((Math.max(1, state.level) - 1) / 5);
    return state.basePoints + bonusBlocks * state.bonusPer5 - state.spent;
}
