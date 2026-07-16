/**
 * balance.ts — central, tunable gameplay-balance curves.
 *
 * One place to shape how rewards, missions, and rival faction goals SCALE, so the game
 * stays progressive from L1 to L50 (the GDD skill grid) without a mid-game grind wall.
 *
 * Design principle: the XP-to-next curve steepens with level, so rewards must scale too —
 * either with the LEVEL of the content you beat (deeper = more) or with YOUR level (missions
 * stay relevant). Combat rewards scale with content depth; missions scale gently with player
 * level; rival faction income is paced by the player's own mission completions.
 *
 * All knobs live here — tune the game from this file.
 */

// ── Content reward scaling (combat) ─────────────────────────────────────────────
/** Reward multiplier for content of a given level/tier — deeper content pays more. */
export function contentScale(level: number, perLevel = 0.18): number {
  return 1 + Math.max(0, level - 1) * perLevel;
}
/** Scale a base XP reward by the level of the enemy/objective beaten. */
export function scaledXp(base: number, level: number, perLevel = 0.18): number {
  return Math.max(1, Math.round(base * contentScale(level, perLevel)));
}
/** Scale a base Faction-Point reward by content level (a touch steeper than XP). */
export function scaledFp(base: number, level: number, perLevel = 0.25): number {
  return Math.max(1, Math.round(base * contentScale(level, perLevel)));
}

// ── Mission scaling (keeps objectives relevant as you out-level early content) ──
/** Gentle multiplier on mission rewards by the player's level. */
export function missionScale(playerLevel: number, perLevel = 0.10): number {
  return 1 + Math.max(0, playerLevel - 1) * perLevel;
}
/** Scale a base mission reward (terraform / capture / refugee) by player level. */
export function scaledMissionXp(base: number, playerLevel: number): number {
  return Math.max(1, Math.round(base * missionScale(playerLevel)));
}
export function scaledMissionFp(base: number, playerLevel: number): number {
  return Math.max(1, Math.round(base * missionScale(playerLevel, 0.08)));
}

// ── Difficulty ramp (enemies keep pace with the player) ─────────────────────────
/** World difficulty multiplier by player level — enemies stay a threat as you grow. */
export function difficultyScale(playerLevel: number, perLevel = 0.05): number {
  return 1 + Math.max(0, playerLevel - 1) * perLevel;
}
/** Content tier from distance-from-spawn — deeper map = higher tier. */
export function tierFromDistance(dist: number): number {
  return 1 + Math.floor(Math.max(0, dist) / 8);
}

// ── Faction goals: progressive rival competition ────────────────────────────────
/**
 * Rival empires advance ONLY when the player completes missions (capture, terraform,
 * refugee aid, exploration…), never on wall-clock time — a perpetual campaign can't be
 * lost to idle/offline time. Each player victory-track gain hands every rival this
 * fraction of it on the rival's natural track, so the race always paces the player.
 */
export const RIVAL_MISSION_PACE = 0.5;
/** Victory points a rival earns when the player earns `playerBase` from a mission. */
export function rivalMissionGain(playerBase: number): number {
  return playerBase * RIVAL_MISSION_PACE;
}
