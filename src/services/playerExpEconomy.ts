/**
 * Player Experience (XP) Economy System
 * 
 * Defines progression curves, leveling thresholds, and rewards for the player character.
 * Scalable system for future difficulty/balance adjustments.
 * 
 * Economy Design:
 * - Linear XP requirements to start (100 base)
 * - Exponential curve as levels progress for long-term play
 * - Soft scaling to prevent grind fatigue
 */

export interface PlayerExpConfig {
  baseXpPerLevel: number;      // Starting XP requirement (level 1→2)
  scalingFactor: number;        // Multiplier for exp growth per level
  softCapLevel: number;         // Level where scaling smooths out
  softCapMultiplier: number;    // Scaling factor at soft cap
  maxLevel: number;             // Hard cap on player level
}

export interface LevelReward {
  skillTokens: number;
  traits?: string[];
  unlockedAbilities?: string[];
}

/**
 * Default player XP economy configuration
 * 
 * Progression examples:
 * Level 1→2: 100 XP
 * Level 2→3: 115 XP
 * Level 3→4: 132 XP (15% growth)
 * ...scales until soft cap at level 30, then smooths
 */
export const PLAYER_EXP_CONFIG: PlayerExpConfig = {
  baseXpPerLevel: 100,           // Starts at 100 XP per level
  scalingFactor: 1.15,            // 15% increase per level
  softCapLevel: 25,              // Curve softens at level 25
  softCapMultiplier: 1.05,       // Only 5% growth after soft cap
  maxLevel: 50,                  // Hard cap at level 50 (per GDD: levels 1–50)
};

/**
 * Calculate XP required to reach target level from level 0
 * Uses exponential growth with soft cap falloff
 */
export function getTotalXpForLevel(targetLevel: number, config: PlayerExpConfig = PLAYER_EXP_CONFIG): number {
  if (targetLevel <= 0) return 0;
  if (targetLevel > config.maxLevel) return getTotalXpForLevel(config.maxLevel, config);

  let totalXp = 0;
  let currentXpRequirement = config.baseXpPerLevel;

  for (let level = 1; level < targetLevel; level++) {
    totalXp += currentXpRequirement;

    // Scale for next level
    if (level < config.softCapLevel) {
      // Aggressive exponential growth before soft cap
      currentXpRequirement *= config.scalingFactor;
    } else {
      // Gentle growth after soft cap
      currentXpRequirement *= config.softCapMultiplier;
    }
  }

  return Math.floor(totalXp);
}

/**
 * Calculate XP required to reach next level from current level
 */
export function getXpForNextLevel(currentLevel: number, config: PlayerExpConfig = PLAYER_EXP_CONFIG): number {
  if (currentLevel >= config.maxLevel) return 0;

  let xpRequirement = config.baseXpPerLevel;

  if (currentLevel > 0) {
    // Simulate growth to current level
    for (let level = 1; level < currentLevel; level++) {
      if (level < config.softCapLevel) {
        xpRequirement *= config.scalingFactor;
      } else {
        xpRequirement *= config.softCapMultiplier;
      }
    }
  }

  return Math.floor(xpRequirement);
}

/**
 * Determine player level from total accumulated XP
 */
export function getLevelFromXp(totalXp: number, config: PlayerExpConfig = PLAYER_EXP_CONFIG): number {
  if (totalXp <= 0) return 1;

  for (let level = config.maxLevel; level >= 1; level--) {
    if (totalXp >= getTotalXpForLevel(level, config)) {
      return level;
    }
  }

  return 1;
}

/**
 * Get progress toward next level (0.0 to 1.0)
 */
export function getLevelProgress(currentXp: number, currentLevel: number, config: PlayerExpConfig = PLAYER_EXP_CONFIG): number {
  if (currentLevel >= config.maxLevel) return 1.0;

  const currentLevelTotal = getTotalXpForLevel(currentLevel, config);
  const nextLevelTotal = getTotalXpForLevel(currentLevel + 1, config);
  const xpInCurrentLevel = currentXp - currentLevelTotal;
  const xpNeededForLevel = nextLevelTotal - currentLevelTotal;

  if (xpNeededForLevel <= 0) return 0;
  return Math.min(1.0, Math.max(0, xpInCurrentLevel / xpNeededForLevel));
}

/**
 * Level-up reward distribution
 */
export function getLevelReward(newLevel: number): LevelReward {
  // Grant 1 skill token per 5 levels, plus 1 at level 1
  const skillTokens = newLevel === 1 ? 1 : Math.floor(newLevel / 5);

  // Major milestones unlock traits
  const traits: string[] = [];
  if (newLevel === 10) traits.push('veteran');
  if (newLevel === 25) traits.push('master');
  if (newLevel === 50) traits.push('legend');

  return {
    skillTokens,
    traits: traits.length > 0 ? traits : undefined,
  };
}

/**
 * XP rewards for player actions (activity-based progression)
 */
export const PLAYER_XP_REWARDS = {
  exploration: {
    tileMilestone: 10,      // Every 10 new tiles explored
    areaComplete: 50,       // Discovered a major region
  },
  combat: {
    enemyDefeated: 25,
    bossDefeated: 100,
    survivalBonus: 5,       // Per difficulty survived
  },
  collection: {
    itemCollected: 3,
    flowerCollected: 5,
    herbCollected: 5,
  },
  social: {
    questComplete: 50,
    interactionBonus: 2,
  },
};

/**
 * Multipliers based on game mode/difficulty (for future scaling)
 */
export const DIFFICULTY_MULTIPLIERS = {
  casual: 1.0,
  normal: 1.0,
  hard: 1.25,
  heroic: 1.5,
};
