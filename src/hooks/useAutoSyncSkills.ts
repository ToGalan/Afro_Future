import { useEffect, useRef } from 'react';
import { usePlayerProfile } from './usePlayerProfile';
import { useSkillStore } from '../store/skillStore';
import { totalSkillPointsForLevel } from '../services/balance';

// Throttled skill progress auto-sync: watches unlocked, unlockOrder, level, spent
export function useAutoSyncSkills(enabled: boolean = true) {
  const { saveProgress, profile } = usePlayerProfile();
  const lastSerialized = useRef<string>('');
  const timeoutRef = useRef<number | null>(null);
  const hydratedRef = useRef(false);

  // Hydrate the (client-only, in-memory) skill store from the persisted profile the
  // first time it loads — without this, `useSkillStore`'s level/unlocked/unlockOrder
  // (and therefore primaryBranch/primaryType/traitTags derived from them) always start
  // at their fresh-session defaults on every reload, so anything reading them directly
  // from the store (e.g. the Dashboard's Hero XP/Primary Path/Primary Type cards) shows
  // stale/empty values even though real progress is saved in Firestore.
  useEffect(() => {
    if (hydratedRef.current || !profile) return;
    hydratedRef.current = true;
    const hero = profile.progress?.hero;
    if (!hero) return;
    useSkillStore.getState().hydrate({
      level: hero.level,
      unlocked: hero.unlockedSkillIds,
      unlockOrder: hero.unlockOrder,
    });
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