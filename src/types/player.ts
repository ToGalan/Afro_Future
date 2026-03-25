export interface PlayerProgress {
  heroPosition: { q: number; r: number };
  lastLogin: number;
  totalPlayTime?: number;      // total seconds played (tracked across all sessions)
  explored?: string[]; // future: discovered tile keys
  faction?: string;
  archetype?: string;
  level?: number;
  hero?: {
    level: number;
    xp: number;               // accumulated XP for leveling (starts at 0)
    traits: string[];         // derived trait tags
    unlockedSkillIds: string[]; // skill node ids
    unlockOrder: string[];    // chronological order
  };
  pet?: {
    type?: string;            // pet archetype key
    level: number;
    xp: number;               // accumulated XP for leveling (starts at 0)
  };
  skillTokens?: {
    earned: number;
    spent: number;
    remaining: number;
  };
  heroInventory?: Array<{
    id: string;
    type: 'herb' | 'flower' | 'potion' | 'consumable';
    quantity: number;
    effect?: 'heal' | 'damage' | 'buff';
    value?: number;
    icon?: string;
  }>;
  petInventory?: Array<{
    id: string;
    type: 'herb' | 'flower';  // collectible type
    quantity: number;
    effect?: 'heal';          // effect on pet
    value?: number;           // HP restored or other numeric effect
    icon?: string;
  }>;  
  abilityLoadout?: {
    offensive: (string | null)[];
    defensive: (string | null)[];
  };
  abilitySlots?: Array<{
    key: 'q' | 'w' | 'e' | 'r';
    abilityId: string;
  }>;
  itemSlots?: Array<{
    key: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
    itemId: string;
  }>;
  avatar?: {
    parts: Record<string,string|undefined>;
    colors: { primary:string; secondary:string; skin:string };
    updatedAt: number;
  };
}

export interface PlayerProfile {
  uid: string;
  displayName?: string;
  email?: string;              // User email address
  avatarUrl?: string;
  faction?: string;
  createdAt: number;
  progress: PlayerProgress;
}

export interface PlayerSession {
  sessionId: string;
  uid: string;
  heroPosition: { q: number; r: number };
  lastActive: number; // ms epoch
  connected: boolean;
  startedAt: number; // session creation time
}
