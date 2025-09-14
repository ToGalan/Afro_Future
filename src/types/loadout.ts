export type Faction = 'PAA' | 'ASF' | 'WC';
export type PetType = 'CYBER_DOG' | 'CYBER_CAT';
export type Archetype = 'MALE' | 'FEMALE';

export interface PetLoadout {
  id: string;
  type: PetType;
  level: number;
  role: 'SCOUT' | 'SUPPORT' | 'BURST';
  cosmetics: Record<string, string>;
}

export interface CharacterLoadout {
  id: string;
  name: string;
  faction: Faction;
  level: number;
  archetype: Archetype;
  body: Record<string, string>;
  outfit: Record<string, string>;
  colors: Record<string, string>;
  portraitUrl: string;
  pet: PetLoadout;
  createdAt: number;
  updatedAt: number;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function now() {
  return Date.now();
}
