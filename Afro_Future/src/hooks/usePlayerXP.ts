/**
 * usePlayerXP — Player XP & level progression hook.
 *
 * Gathering economy: every collected item awards 1 XP.
 * Level-up logic uses the curves defined in playerExpEconomy.ts.
 * Progress is persisted to Firestore via saveProgress (same path as the rest
 * of the player profile: players/{uid}.progress.hero).
 *
 * Used in: SoloMissionMap3D — wired to useCollectibles.onPlayerXpGain.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  getLevelFromXp,
  getTotalXpForLevel,
  getXpForNextLevel,
} from '../services/playerExpEconomy';
import type { PlayerProfile } from '../types/player';

export interface UsePlayerXPReturn {
  /** Total accumulated XP since account creation. */
  playerXp: number;
  /** Current player level (1-based, 1–100). */
  playerLevel: number;
  /**
   * XP accumulated within the current level (0 → xpForLevel).
   * Use this as the progress-bar `current` value.
   */
  xpInLevel: number;
  /**
   * XP required to complete the current level (i.e. advance to next level).
   * Use this as the progress-bar `max` value.
   */
  xpForLevel: number;
  /**
   * Award `amount` XP, handle any resulting level-ups, and persist to Firestore.
   * Stable reference — safe to pass as a callback prop without re-render churn.
   */
  gainXP: (amount: number) => void;
}

export function usePlayerXP({
  uid: _uid,
  profile,
  saveProgress,
}: {
  uid: string;
  profile: PlayerProfile | null;
  saveProgress: (progress: Partial<PlayerProfile['progress']>) => void;
}): UsePlayerXPReturn {
  // Total accumulated XP (NOT in-level XP — the full lifetime total).
  const [totalXp, setTotalXp] = useState<number>(() => profile?.progress?.hero?.xp ?? 0);
  const [playerLevel, setPlayerLevel] = useState<number>(() => profile?.progress?.hero?.level ?? 1);

  // Stable ref so gainXP never closes over a stale level value.
  const playerLevelRef = useRef(playerLevel);

  // ── Sync from Firestore on first load / uid change ──────────────────────
  const syncedUidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!profile || syncedUidRef.current === profile.uid) return;
    syncedUidRef.current = profile.uid;
    const xp    = profile.progress?.hero?.xp    ?? 0;
    const level = profile.progress?.hero?.level ?? 1;
    setTotalXp(xp);
    setPlayerLevel(level);
    playerLevelRef.current = level;
  }, [profile]);

  // Keep ref in sync when state changes externally (e.g. direct Firestore writes).
  useEffect(() => { playerLevelRef.current = playerLevel; }, [playerLevel]);

  // ── XP award ─────────────────────────────────────────────────────────────
  const gainXP = useCallback(
    (amount: number) => {
      setTotalXp(prev => {
        const newTotal = prev + amount;
        const newLevel = getLevelFromXp(newTotal);
        if (newLevel !== playerLevelRef.current) {
          playerLevelRef.current = newLevel;
          setPlayerLevel(newLevel);
          console.log(`[PlayerXP] Level up → ${newLevel}`);
        }
        // Persist hero XP + level to players/{uid} in Firestore.
        saveProgress({
          hero: {
            xp: newTotal,
            level: newLevel,
            traits: [],
            unlockedSkillIds: [],
            unlockOrder: [],
          },
        });
        return newTotal;
      });
    },
    [saveProgress],
  );

  // ── Derived in-level progress (no extra state needed) ────────────────────
  // getLevelFromXp may lag one render behind totalXp, so derive directly:
  const levelStartXp = getTotalXpForLevel(playerLevel);
  const xpForLevel   = Math.max(1, getXpForNextLevel(playerLevel));
  const xpInLevel    = Math.max(0, totalXp - levelStartXp);

  return { playerXp: totalXp, playerLevel, xpInLevel, xpForLevel, gainXP };
}
