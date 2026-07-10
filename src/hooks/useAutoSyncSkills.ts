import { useEffect, useRef } from 'react';
import { usePlayerProfile } from './usePlayerProfile';
import { useSkillStore } from '../store/skillStore';

// Throttled skill progress auto-sync: watches unlocked, unlockOrder, level, spent
export function useAutoSyncSkills(enabled: boolean = true) {
  const { saveProgress, profile } = usePlayerProfile();
  const lastSerialized = useRef<string>('');
  const timeoutRef = useRef<number | null>(null);

  // Hydrate store if profile already has hero + skillTokens data (future extension)
  useEffect(() => {
    // For now we only push from client to profile; hydration step can be added here.
  }, [profile]);

  useEffect(() => {
    if (!enabled) return; // skip syncing if disabled
    const unsub = useSkillStore.subscribe((state) => {
      // Build progress subset we persist. IMPORTANT: only the skill-derived hero
      // fields — NOT level or xp. Those are owned by the XP/leveling system; sending
      // them here (previously xp:0) shallow-merged over and wiped the player's XP.
      const payload = {
        hero: {
          traits: state.traitTags,
          unlockedSkillIds: state.unlocked,
          unlockOrder: state.unlockOrder,
        },
        skillTokens: (() => {
          // Must mirror availablePoints() in skillStore: base + 1/level + a bonus every
          // 5th level. The per-level term (level-1) was previously missing, understating
          // the persisted token totals versus what the player can actually spend.
          const earned = state.basePoints + (state.level - 1) + Math.floor((state.level - 1) / 5) * state.bonusPer5;
          return { earned, spent: state.spent, remaining: earned - state.spent };
        })(),
        abilityLoadout: {
          offensive: state.abilityLoadout.offensive,
          defensive: state.abilityLoadout.defensive,
        }
      };
      const ser = JSON.stringify(payload);
      if (ser === lastSerialized.current) return;
      lastSerialized.current = ser;
      // throttle: delay 750ms after last change
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        saveProgress(payload);
      }, 750);
    });
    return () => { unsub(); if (timeoutRef.current) window.clearTimeout(timeoutRef.current); };
  }, [enabled, saveProgress]);
}

export default useAutoSyncSkills;