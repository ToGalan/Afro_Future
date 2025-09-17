export interface PlayerProgress {
  heroPosition: { q: number; r: number };
  lastLogin: number;
  explored?: string[]; // future: discovered tile keys
  faction?: string;
  archetype?: string;
  level?: number;
  hero?: {
    level: number;
    traits: string[];         // derived trait tags
    unlockedSkillIds: string[]; // skill node ids
    unlockOrder: string[];    // chronological order
  };
  pet?: {
    type?: string;            // pet archetype key
    level: number;
  };
  skillTokens?: {
    earned: number;
    spent: number;
    remaining: number;
  };
  avatar?: {
    parts: Record<string,string|undefined>;
    colors: { primary:string; secondary:string; skin:string };
    updatedAt: number;
  };
}

export interface PlayerProfile {
  uid: string;
  displayName?: string;
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
