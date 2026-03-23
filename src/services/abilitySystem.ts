/**
 * Ability & Item Activation System
 * 
 * Handles keybindings for abilities (QWER) and consumable items (12345678)
 * Integrates with player inventory and skill unlocks
 */

export interface AbilitySlot {
  key: 'q' | 'w' | 'e' | 'r';
  abilityId: string;
  name: string;
  cooldown: number;
  lastActivated: number;
  isReady: boolean;
}

export interface ItemSlot {
  key: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
  itemId: string;
  itemType: string;
  quantity: number;
  lastUsed: number;
  cooldown: number;
}

export interface AbilityActivationResult {
  success: boolean;
  message: string;
  damage?: number;
  effect?: string;
  cooldownRemaining?: number;
}

/**
 * Ability definitions - baseline abilities available to player
 */
export const ABILITY_DEFINITIONS: Record<string, {
  name: string;
  description: string;
  baseCooldown: number;
  baseDamage: number;
  energyCost: number;
  range: number;
}> = {
  slash: {
    name: 'Slash',
    description: 'Basic melee attack',
    baseCooldown: 0.5,
    baseDamage: 10,
    energyCost: 0,
    range: 1,
  },
  fireball: {
    name: 'Fireball',
    description: 'Cast a fireball projectile',
    baseCooldown: 3,
    baseDamage: 25,
    energyCost: 20,
    range: 8,
  },
  shield: {
    name: 'Shield',
    description: 'Create defensive barrier',
    baseCooldown: 5,
    baseDamage: 0,
    energyCost: 15,
    range: 0,
  },
  heal: {
    name: 'Heal',
    description: 'Restore HP',
    baseCooldown: 4,
    baseDamage: 0,
    energyCost: 10,
    range: 5,
  },
};

/**
 * Check if ability is off cooldown
 */
export function isAbilityReady(lastActivated: number, cooldown: number): boolean {
  return performance.now() - lastActivated >= cooldown * 1000;
}

/**
 * Activate an ability
 */
export function activateAbility(
  abilityId: string,
  lastActivated: number,
  cooldown: number,
  playerLevel: number = 1
): AbilityActivationResult {
  const definition = ABILITY_DEFINITIONS[abilityId];
  
  if (!definition) {
    return {
      success: false,
      message: `Ability ${abilityId} not found`,
    };
  }

  if (!isAbilityReady(lastActivated, cooldown)) {
    const remaining = Math.ceil((cooldown * 1000 - (performance.now() - lastActivated)) / 1000);
    return {
      success: false,
      message: `${definition.name} is on cooldown`,
      cooldownRemaining: remaining,
    };
  }

  // Scale damage by player level
  const scaledDamage = definition.baseDamage * (1 + (playerLevel - 1) * 0.1);

  return {
    success: true,
    message: `${definition.name} activated!`,
    damage: Math.floor(scaledDamage),
    effect: definition.description,
  };
}

/**
 * Activate a consumable item
 */
export function activateItem(
  itemType: string,
  lastUsed: number,
  cooldown: number,
  quantity: number = 1
): AbilityActivationResult {
  if (quantity <= 0) {
    return {
      success: false,
      message: 'No items in slot',
    };
  }

  if (!isAbilityReady(lastUsed, cooldown)) {
    const remaining = Math.ceil((cooldown * 1000 - (performance.now() - lastUsed)) / 1000);
    return {
      success: false,
      message: `Item is on cooldown`,
      cooldownRemaining: remaining,
    };
  }

  const effects: Record<string, { name: string; effect: string; healing?: number; restore?: number }> = {
    flower: {
      name: 'Healing Flower',
      effect: 'Restore 20 HP',
      healing: 20,
    },
    herb: {
      name: 'Medicinal Herb',
      effect: 'Restore 10 EP',
      restore: 10,
    },
    potion: {
      name: 'Potion',
      effect: 'Restore 50 HP and 20 EP',
      healing: 50,
      restore: 20,
    },
  };

  const itemDef = effects[itemType];

  if (!itemDef) {
    return {
      success: false,
      message: `Unknown item type: ${itemType}`,
    };
  }

  return {
    success: true,
    message: `${itemDef.name} used!`,
    effect: itemDef.effect,
  };
}

/**
 * Get cooldown for an ability (in seconds)
 */
export function getAbilityCooldown(abilityId: string, playerLevel: number = 1): number {
  const def = ABILITY_DEFINITIONS[abilityId];
  if (!def) return 0;
  
  // Reduce cooldown with player level (10% reduction every 5 levels)
  const reductionFactor = 1 - (Math.floor(playerLevel / 5) * 0.1);
  return def.baseCooldown * reductionFactor;
}

/**
 * Map keyboard keys to ability slots
 */
export const ABILITY_KEYBINDINGS = {
  'q': { slot: 'q', type: 'ability' },
  'w': { slot: 'w', type: 'ability' },
  'e': { slot: 'e', type: 'ability' },
  'r': { slot: 'r', type: 'ability' },
  '1': { slot: '1', type: 'item' },
  '2': { slot: '2', type: 'item' },
  '3': { slot: '3', type: 'item' },
  '4': { slot: '4', type: 'item' },
  '5': { slot: '5', type: 'item' },
  '6': { slot: '6', type: 'item' },
  '7': { slot: '7', type: 'item' },
  '8': { slot: '8', type: 'item' },
};
