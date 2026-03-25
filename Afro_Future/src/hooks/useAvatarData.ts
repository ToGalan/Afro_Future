import { useState, useMemo, useEffect } from 'react';
import { FACTION_PALETTES } from '../assets/isometricCharacter';
import type { AvatarColors } from '../services/avatarConfig';
import type { Archetype, CharacterLoadout } from '../types/loadout';
import type { PlayerProfile } from '../types/player';

interface UseAvatarDataOptions {
  /** Live loadout from App — stays in sync when configurator changes */
  heroAvatar?: CharacterLoadout | null;
  /** Firestore profile for fallback faction / avatar colours */
  profile: PlayerProfile | null;
}

interface UseAvatarDataReturn {
  heroModelUrl: string | undefined;
  heroGender: Archetype;
  heroParts: Record<string, string | undefined>;
  heroColors: AvatarColors;
  /** False for one frame after modelUrl changes to prevent stale-model flash */
  avatarReady: boolean;
}

// Faction-specific default colours — derived once at module level (stable)
const FACTION_DEFAULTS: Record<string, AvatarColors> = FACTION_PALETTES;

export function useAvatarData({ heroAvatar, profile }: UseAvatarDataOptions): UseAvatarDataReturn {
  // Resolve the avatar loadout: live prop → localStorage → profile → faction defaults
  const avatarData = useMemo(() => {
    const src = heroAvatar ?? (() => {
      try {
        const raw = localStorage.getItem('afrofuture.activeLoadout');
        if (raw) return JSON.parse(raw) as CharacterLoadout;
      } catch {
        // ignore malformed data
      }
      return null;
    })();

    if (src) {
      const faction: string = src.faction || 'PAA';
      const archetype: Archetype = src.archetype === 'MALE' ? 'MALE' : 'FEMALE';
      const fd: AvatarColors = FACTION_DEFAULTS[faction] ?? FACTION_DEFAULTS.PAA;
      const tc = src.threeConfig;
      return {
        parts: (tc?.parts || {}) as Record<string, string | undefined>,
        colors: {
          primary:   tc?.colors?.primary   || fd.primary,
          secondary: tc?.colors?.secondary || fd.secondary,
          skin:      (tc?.colors as any)?.skin || fd.skin,
        } as AvatarColors,
        archetype,
        faction,
        modelUrl: (tc as any)?.modelUrl as string | undefined,
      };
    }

    // Firestore / faction-default fallback
    const fpFaction: string = (profile as any)?.progress?.faction || 'PAA';
    const fd: AvatarColors = FACTION_DEFAULTS[fpFaction] ?? FACTION_DEFAULTS.PAA;
    const fpAvatar = (profile as any)?.progress?.avatar;
    return {
      parts: (fpAvatar?.parts || {}) as Record<string, string | undefined>,
      colors: {
        primary:   fpAvatar?.colors?.primary   || fd.primary,
        secondary: fpAvatar?.colors?.secondary || fd.secondary,
        skin:      fpAvatar?.colors?.skin      || fd.skin,
      } as AvatarColors,
      archetype: 'FEMALE' as Archetype,
      faction: fpFaction,
      modelUrl: undefined as string | undefined,
    };
  }, [heroAvatar, profile]);

  // Gate rendering for one frame when a custom GLB changes to avoid stale-model flash.
  // IsometricCharacter is procedural and needs no gate.
  const [avatarReady, setAvatarReady] = useState(true);
  useEffect(() => {
    if (!avatarData.modelUrl) return;
    setAvatarReady(false);
    const raf = requestAnimationFrame(() => setAvatarReady(true));
    return () => cancelAnimationFrame(raf);
  }, [avatarData.modelUrl]);

  return {
    heroModelUrl: avatarData.modelUrl,
    heroGender: avatarData.archetype,
    heroParts: avatarData.parts,
    heroColors: avatarData.colors,
    avatarReady,
  };
}
