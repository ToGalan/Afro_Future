/**
 * Pet Experience (XP) Economy System
 * 
 * Defines progression curves, leveling thresholds, and rewards for companion pets.
 * Different from player XP - faster progression, action-based rewards.
 * 
 * Economy Design:
 * - Lower XP thresholds than player (pets level faster)
 * - Pet actions contribute directly to progression
 * - Linked to player progression for scaling
 */

export interface PetExpConfig {
  baseXpPerLevel: number;       // Starting XP requirement for pets (typically lower than player)
  scalingFactor: number;         // Multiplier for exp growth per level
  softCapLevel: number;          // Level where scaling smooths out
  softCapMultiplier: number;     // Scaling factor at soft cap
  maxLevel: number;              // Hard cap on pet level
  playerXpLinkage: number;       // % of player XP shared with pet
}

export interface PetLevelReward {
  statBoosts: {
    health: number;
    defense: number;
    speed: number;
  };
  traits?: string[];
  abilities?: string[];
}

/**
 * Default pet XP economy configuration
 * 
 * Pets level faster than players to keep them relevant
 * Progression examples:
 * Level 1→2: 50 XP (half of player base)
 * Level 2→3: 56 XP (12% growth)
 * Level 3→4: 63 XP
 * ...scales until soft cap at level 25, then smooths
 */
export const PET_EXP_CONFIG: PetExpConfig = {
  baseXpPerLevel: 50,            // Pets start at 50 XP per level (faster progression)
  scalingFactor: 1.12,            // 12% increase per level (slightly slower than player)
  softCapLevel: 25,              // Pets soft cap earlier (at level 25)
  softCapMultiplier: 1.04,       // Very gentle growth after soft cap
  maxLevel: 75,                  // Pets cap at level 75 (lower than player)
  playerXpLinkage: 0.15,         // Pets gain 15% of player XP automatically
};

/**
 * Calculate total XP required to reach target level from level 0
 * Uses exponential growth with soft cap falloff (same algorithm as player)
 */
export function getTotalXpForPetLevel(targetLevel: number, config: PetExpConfig = PET_EXP_CONFIG): number {
  if (targetLevel <= 0) return 0;
  if (targetLevel > config.maxLevel) return getTotalXpForPetLevel(config.maxLevel, config);

  let totalXp = 0;
  let currentXpRequirement = config.baseXpPerLevel;

  for (let level = 1; level < targetLevel; level++) {
    totalXp += currentXpRequirement;

    if (level < config.softCapLevel) {
      currentXpRequirement *= config.scalingFactor;
    } else {
      currentXpRequirement *= config.softCapMultiplier;
    }
  }

  return Math.floor(totalXp);
}

/**
 * Calculate XP required to reach next level from current level
 */
export function getXpForNextPetLevel(currentLevel: number, config: PetExpConfig = PET_EXP_CONFIG): number {
  if (currentLevel >= config.maxLevel) return 0;

  let xpRequirement = config.baseXpPerLevel;

  if (currentLevel > 0) {
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
 * Determine pet level from total accumulated XP
 */
export function getPetLevelFromXp(totalXp: number, config: PetExpConfig = PET_EXP_CONFIG): number {
  if (totalXp <= 0) return 1;

  for (let level = config.maxLevel; level >= 1; level--) {
    if (totalXp >= getTotalXpForPetLevel(level, config)) {
      return level;
    }
  }

  return 1;
}

/**
 * Get progress toward next pet level (0.0 to 1.0)
 */
export function getPetLevelProgress(currentXp: number, currentLevel: number, config: PetExpConfig = PET_EXP_CONFIG): number {
  if (currentLevel >= config.maxLevel) return 1.0;

  const currentLevelTotal = getTotalXpForPetLevel(currentLevel, config);
  const nextLevelTotal = getTotalXpForPetLevel(currentLevel + 1, config);
  const xpInCurrentLevel = currentXp - currentLevelTotal;
  const xpNeededForLevel = nextLevelTotal - currentLevelTotal;

  if (xpNeededForLevel <= 0) return 0;
  return Math.min(1.0, Math.max(0, xpInCurrentLevel / xpNeededForLevel));
}

/**
 * Pet level-up reward distribution
 * Grants stat boosts that compound with level
 */
export function getPetLevelReward(newLevel: number): PetLevelReward {
  // Health increases per level
  const baseHealthBoost = 10;
  const health = baseHealthBoost * Math.ceil(newLevel / 5);

  // Defense increases every 3 levels
  const defense = Math.floor(newLevel / 3) * 0.5;

  // Speed bonuses at odd levels
  const speed = (newLevel % 2) * 0.1;

  const traits: string[] = [];
  if (newLevel === 5) traits.push('hardy');
  if (newLevel === 15) traits.push('nimble');
  if (newLevel === 25) traits.push('wise');
  if (newLevel === 40) traits.push('legendary');

  return {
    statBoosts: {
      health: Math.floor(health),
      defense: parseFloat(defense.toFixed(1)),
      speed: parseFloat(speed.toFixed(2)),
    },
    traits: traits.length > 0 ? traits : undefined,
  };
}

/**
 * Pet XP rewards for various actions
 * Pets progress through doing things with their companion
 */
export const PET_XP_REWARDS = {
  // Passive progression (from walking with player)
  walking: {
    perTile: 0.5,               // XP per tile traveled
    perMinute: 0.25,            // Idle companion gainAlong with player
  },

  // Active pet actions
  collection: {
    flowerCollected: 8,         // Collecting flowers (healing)
    herbCollected: 10,          // Gathering herbs
  },

  combat: {
    enemyEncountered: 3,        // Pet present during combat
    enemyDefeated: 10,          // Pet participated in defeat
    combatBonus: 2,             // Per hit or action
  },

  interaction: {
    petFed: 15,                 // Using inventory items on pet
    petHealed: 20,              // Healing pet with items
    playSession: 30,            // Completing a full play session
  },

  // Milestone bonuses
  milestones: {
    hourPlayed: 50,             // Milestone: 1 hour played together
    areaExplored: 25,           // New area discovered while pet was present
    collectorMilestone: 40,     // Collected N items
  },

  // Linked progression from player
  playerLinked: {
    playerLevelUp: 20,          // Pet gets bonus when player levels
    playerXpLinkageBase: 0.15,  // 15% of player XP shared with pet
  },
};

/**
 * Pet stat scaling per level
 * Defines how pet stats grow over time
 */
export const PET_STAT_SCALING = {
  healthPerLevel: 8,            // +8 HP per level
  defensePerLevel: 0.3,         // +0.3 defense per level
  speedPerLevel: 0.05,          // +0.05 speed per level
  attackPerLevel: 0.4,          // +0.4 attack per level
};

/**
 * Calculate pet stats at a given level
 */
export function calculatePetStats(level: number, baseStats: { health: number; defense: number; speed: number; attack: number }) {
  const levelDelta = Math.max(0, level - 1); // Level 1 is base
  return {
    health: baseStats.health + (PET_STAT_SCALING.healthPerLevel * levelDelta),
    defense: baseStats.defense + (PET_STAT_SCALING.defensePerLevel * levelDelta),
    speed: baseStats.speed + (PET_STAT_SCALING.speedPerLevel * levelDelta),
    attack: baseStats.attack + (PET_STAT_SCALING.attackPerLevel * levelDelta),
  };
}

/**
 * Calculate bonus XP when pet levels up with player
 */
export function getPlayerLinkageBonus(playerLevel: number, petLevel: number): number {
  // Pet gets bonus XP if player is significantly higher level
  const levelGap = Math.max(0, playerLevel - petLevel);
  const bonusMultiplier = 1.0 + (levelGap * 0.05); // 5% bonus per level gap
  return Math.floor(PET_XP_REWARDS.playerLinked.playerLevelUp * bonusMultiplier);
}
