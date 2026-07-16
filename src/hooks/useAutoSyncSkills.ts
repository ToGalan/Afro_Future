import { useEffect, useRef } from 'react';
import { usePlayerProfile } from './usePlayerProfile';
import { useSkillStore } from '../store/skillStore';
import { totalSkillPointsForLevel } from '../services/balance';

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
          // Same balance.ts curve availablePoints() uses — never a hand-copied formula
          // again (a previous copy here dropped the per-level multiplier and understated
          // the persisted totals versus what the player could actually spend).
          const earned = totalSkillPointsForLevel(Math.max(1, state.level));
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