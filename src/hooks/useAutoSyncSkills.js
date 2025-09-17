import { useEffect, useRef } from 'react';
import { usePlayerProfile } from './usePlayerProfile';
import { useSkillStore } from '../store/skillStore';
// Throttled skill progress auto-sync: watches unlocked, unlockOrder, level, spent
export function useAutoSyncSkills(enabled = true) {
    const { saveProgress, profile } = usePlayerProfile();
    const lastSerialized = useRef('');
    const timeoutRef = useRef(null);
    // Hydrate store if profile already has hero + skillTokens data (future extension)
    useEffect(() => {
        // For now we only push from client to profile; hydration step can be added here.
    }, [profile]);
    useEffect(() => {
        if (!enabled)
            return; // skip syncing if disabled
        const unsub = useSkillStore.subscribe((state) => {
            // Build progress subset we persist
            const payload = {
                hero: {
                    level: state.level,
                    traits: state.traitTags,
                    unlockedSkillIds: state.unlocked,
                    unlockOrder: state.unlockOrder,
                },
                skillTokens: {
                    earned: state.basePoints + Math.floor((state.level - 1) / 5) * state.bonusPer5,
                    spent: state.spent,
                    remaining: (state.basePoints + Math.floor((state.level - 1) / 5) * state.bonusPer5) - state.spent,
                }
            };
            const ser = JSON.stringify(payload);
            if (ser === lastSerialized.current)
                return;
            lastSerialized.current = ser;
            // throttle: delay 750ms after last change
            if (timeoutRef.current)
                window.clearTimeout(timeoutRef.current);
            timeoutRef.current = window.setTimeout(() => {
                saveProgress(payload);
            }, 750);
        });
        return () => { unsub(); if (timeoutRef.current)
            window.clearTimeout(timeoutRef.current); };
    }, [enabled, saveProgress]);
}
export default useAutoSyncSkills;
