import type { CharacterGender } from '../components/IsometricCharacter';

/**
 * Per-faction / per-gender hero GLB models shown on the game map.
 *
 * To use: export your hero .glb files, drop them in `public/assets/3d/heroes/`,
 * and fill in the paths below. Any faction/gender left blank falls back to the
 * procedural IsometricCharacter automatically (GameAvatarMesh's error boundary
 * catches a missing/oversized file), so it's safe to fill these in one at a time.
 *
 * Suggested filenames mirror the reference renders in public/assets/img:
 *   Kwame_Male_PAA, Nia_Female_PAA, Zuberi_Male_ASF, Makena_Female_ASF,
 *   Jonathan_Male_WC, Emily_Female_WC
 */
export const HERO_MODELS: Record<string, Partial<Record<CharacterGender, string>>> = {
  // PAA: { MALE: '/assets/3d/heroes/Kwame_Male_PAA.glb',  FEMALE: '/assets/3d/heroes/Nia_Female_PAA.glb' },
  // ASF: { MALE: '/assets/3d/heroes/Zuberi_Male_ASF.glb', FEMALE: '/assets/3d/heroes/Makena_Female_ASF.glb' },
  // WC:  { MALE: '/assets/3d/heroes/Jonathan_Male_WC.glb', FEMALE: '/assets/3d/heroes/Emily_Female_WC.glb' },
};

/** Resolve the hero GLB url for a faction+gender, or undefined to use the procedural avatar. */
export function resolveHeroModel(faction?: string, gender?: CharacterGender): string | undefined {
  if (!faction) return undefined;
  return HERO_MODELS[faction.toUpperCase()]?.[gender ?? 'FEMALE'];
}
