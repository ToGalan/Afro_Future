/**
 * usePetXP — Pet XP & level progression system.
 *
 * Standalone hook connected through player identity (uid, email, displayName).
 * Manages pet XP accumulation, level-ups, and Firestore persistence via saveProgress.
 *
 * Used in: SoloMissionMap3D (movement XP), MapCameraController (collect XP),
 *          App MissionScreen (display pet level/XP in HUD).
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { getXpForNextPetLevel } from '../services/petExpEconomy';
import type { PlayerProfile } from '../types/player';

export interface UsePetXPReturn {
  petXp: number;
  petLevel: number;
  /** XP still needed before next level-up. 0 at max level. */
  xpToNext: number;
  /**
   * Award +1 pet XP and +0.5 hero XP (called every 40 hero tile moves).
   * @param currentHeroXp  current hero.xp from profile
   * @param heroLevel      current hero.level from profile
   */
  gainXPOnMove: (currentHeroXp: number, heroLevel: number) => void;
  /**
   * Award +5 hero XP on item collect (flower / mushroom). No pet XP.
   * @param currentHeroXp  current hero.xp from profile
   * @param heroLevel      current hero.level from profile
   */
  gainXPOnCollect: (currentHeroXp: number, heroLevel: number) => void;
}

export function usePetXP({
  uid,
  email: _email,
  displayName: _displayName,
  profile,
  saveProgress,
}: {
  uid: string;
  email?: string;
  displayName?: string;
  profile: PlayerProfile | null;
  saveProgress: (progress: Partial<PlayerProfile['progress']>) => void;
}): UsePetXPReturn {
  const [petXp, setPetXp] = useState(() => profile?.progress?.pet?.xp ?? 0);
  const [petLevel, setPetLevel] = useState(() => profile?.progress?.pet?.level ?? 1);

  // Stable refs so callbacks never go stale
  const petLevelRef = useRef(petLevel);
  const petTypeRef = useRef<string | undefined>(profile?.progress?.pet?.type);

  // Sync once per uid when profile first loads
  const syncedUidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!profile || syncedUidRef.current === profile.uid) return;
    syncedUidRef.current = profile.uid;
    const savedXp = profile.progress?.pet?.xp ?? 0;
    const savedLevel = profile.progress?.pet?.level ?? 1;
    setPetXp(savedXp);
    setPetLevel(savedLevel);
    petLevelRef.current = savedLevel;
    petTypeRef.current = profile.progress?.pet?.type;
  }, [profile]);

  // Keep petLevelRef in sync when state changes externally
  useEffect(() => { petLevelRef.current = petLevel; }, [petLevel]);

  /** Compute level-ups from raw XP total and current level. */
  const applyLevelUps = (rawXp: number, level: number): { xp: number; level: number } => {
    let xp = rawXp;
    let lvl = level;
    while (lvl < 75) {
      const needed = getXpForNextPetLevel(lvl);
      if (needed <= 0 || xp < needed) break;
      xp -= needed;
      lvl++;
    }
    return { xp, level: lvl };
  };

  const gainXPOnMove = useCallback(
    (currentHeroXp: number, heroLevel: number) => {
      setPetXp(prev => {
        const { xp, level } = applyLevelUps(prev + 1, petLevelRef.current);
        if (level !== petLevelRef.current) {
          petLevelRef.current = level;
          setPetLevel(level);
          console.log(`[PetXP] Level up → ${level}`);
        }
        saveProgress({
          pet: { xp, level, type: petTypeRef.current },
          hero: {
            xp: currentHeroXp + 0.5,
            level: heroLevel,
            traits: [],
            unlockedSkillIds: [],
            unlockOrder: [],
          },
        });
        return xp;
      });
    },
    // saveProgress is stable (useCallback in usePlayerProfile); applyLevelUps is a closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saveProgress],
  );

  const gainXPOnCollect = useCallback(
    (currentHeroXp: number, heroLevel: number) => {
      saveProgress({
        hero: {
          xp: currentHeroXp + 5,
          level: heroLevel,
          traits: [],
          unlockedSkillIds: [],
          unlockOrder: [],
        },
      });
    },
    [saveProgress],
  );

  return {
    petXp,
    petLevel,
    xpToNext: getXpForNextPetLevel(petLevel),
    gainXPOnMove,
    gainXPOnCollect,
  };
}
