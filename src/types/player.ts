export interface PlayerProgress {
  heroPosition: { q: number; r: number };
  lastLogin: number;
  totalPlayTime?: number;      // total seconds played (tracked across all sessions)
  explored?: string[]; // future: discovered tile keys
  faction?: string;
  archetype?: string;
  level?: number;
  factionPoints?: number;        // faction currency (GDD) — earned from faction activities
  factionAbilities?: string[];   // unlocked faction-ability ids
  shards?: number;               // soft currency
  reputation?: Record<string, number>; // playstyle reputation (help/negotiate/scavenge/loot/dominate)
  /** Solo-campaign world state — captured territory persists across sessions. */
  solo?: {
    outpostsOwned?: string[];    // "q,r" keys of captured outposts
    /** Outposts held by rival empires — "q,r" key → 'PAA'|'ASF'|'WC'. */
    rivalOutposts?: Record<string, string>;
    /** Story-arc progress: number of beats completed (0..5). */
    storyBeat?: number;
    /** Choice made at each beat — beat id → choice id. */
    storyChoices?: Record<string, string>;
    terraformProgress?: number;  // 0..100
    refugeeCampsDone?: string[]; // "q,r" keys of resolved camps
    /** Victory-track race state (faction → track → points). Mirrors FactionVictory. */
    victory?: Record<string, Record<string, number>>;
    /** Set once a faction fills a track — the campaign is decided until a reset. */
    victoryResult?: { faction: string; track: string } | null;
    /** Player dismissed the win/loss overlay (don't re-show it every session). */
    victorySeen?: boolean;
    /** One-time exploration-objective reward already granted this campaign. */
    explorationRewarded?: boolean;
    /** Running count of resources (ore/energy/bio) collected/used — every 100 grants
     *  1 pt on the Exploitation victory track (see bumpResourceCollected). */
    resourcesCollected?: number;
  };
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
    bond?: number;            // bonding progression (GDD "Bonding and Skills") — gates abilities
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
