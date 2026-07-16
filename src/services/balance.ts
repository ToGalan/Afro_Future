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

// ── Skill-point economy (single source of truth for the skill tree's income) ────
/** Points every hero starts with at L1. */
export const SKILL_POINTS_BASE = 3;
/** Every Nth level pays a milestone bonus on top of the per-level grant. */
export const SKILL_POINT_MILESTONE_EVERY = 5;
export const SKILL_POINT_MILESTONE_BONUS = 2;
/**
 * Marginal skill points granted on REACHING `level` (0 for L1 — L1 is the base grant).
 * The grant scales with level for the same reason contentScale/missionScale exist:
 * the XP-to-next curve steepens, so a level earned late must pay more than an early one
 * or points-per-hour collapses. 2/level early → 3 from L25 → 4 from L50 → 5 from L75,
 * plus the every-5th milestone bonus.
 * Lifetime total ≈ 394 by L100 vs a ~912-point full tree (12 branches × 76): a capped
 * player affords ~43% — deep mastery of ~5 branches — so specialization stays a choice.
 */
export function skillPointsAtLevel(level: number): number {
  if (level <= 1) return 0;
  const perLevel = level >= 75 ? 5 : level >= 50 ? 4 : level >= 25 ? 3 : 2;
  const milestone = level % SKILL_POINT_MILESTONE_EVERY === 0 ? SKILL_POINT_MILESTONE_BONUS : 0;
  return perLevel + milestone;
}
/** Cumulative skill points a player of `level` has earned lifetime (spending not deducted). */
export function totalSkillPointsForLevel(level: number): number {
  let total = SKILL_POINTS_BASE;
  for (let l = 2; l <= level; l++) total += skillPointsAtLevel(l);
  return total;
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
