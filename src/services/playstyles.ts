/**
 * playstyles — the strategy layer's "how do you want to play?" axis, grounded in the GDD.
 *
 * The GDD frames the world as a choice of approach: outposts are taken by "stealth
 * operations, combat engagements, OR tactical diplomacy", and each faction embodies an
 * ethos — PAA "Heal and Unite" (diplomacy + healing), WC "Survival at Any Cost" (resource
 * exploitation + raiding), ASF "Africa First" (combat + guerrilla tactics). The player
 * doesn't just pick a faction; at every dynamic interaction they DECIDE how to resolve it —
 * help, negotiate, scavenge, loot, or dominate — and those choices accrete into an emergent
 * reputation (the GDD's "branching paths based on player choices" / the climax decision to
 * remain isolated or extend help).
 */
export type Playstyle = 'help' | 'negotiate' | 'scavenge' | 'loot' | 'dominate';

export type EthosFaction = 'PAA' | 'ASF' | 'WC';

export interface PlaystyleDef {
  id: Playstyle;
  label: string;
  icon: string;
  /** The GDD faction ethos this approach echoes. */
  affinity: EthosFaction;
  ethos: string;
  color: string;
  /** One-line description shown at decision points. */
  desc: string;
  /** The reputation title earned by favouring this approach. */
  title: string;
}

export const PLAYSTYLES: Record<Playstyle, PlaystyleDef> = {
  help: {
    id: 'help', label: 'Help', icon: '✚', affinity: 'PAA', ethos: 'Heal and Unite',
    color: '#34d399', title: 'The Healer',
    desc: 'Aid refugees and heal the wounded — build standing without bloodshed.',
  },
  negotiate: {
    id: 'negotiate', label: 'Negotiate', icon: '🕊️', affinity: 'PAA', ethos: 'Heal and Unite',
    color: '#7dd3fc', title: 'The Diplomat',
    desc: 'Resolve encounters with tactical diplomacy — win ground and calm camps peacefully.',
  },
  scavenge: {
    id: 'scavenge', label: 'Scavenge', icon: '♻️', affinity: 'WC', ethos: 'Survival',
    color: '#fbbf24', title: 'The Scavenger',
    desc: 'Gather unclaimed resources from the ruins — fuel your effort quietly.',
  },
  loot: {
    id: 'loot', label: 'Loot', icon: '🔥', affinity: 'WC', ethos: 'Survival at Any Cost',
    color: '#fb923c', title: 'The Raider',
    desc: 'Seize rival caches by force — rich rewards, but it enrages their defenders.',
  },
  dominate: {
    id: 'dominate', label: 'Dominate', icon: '⚔️', affinity: 'ASF', ethos: 'Africa First',
    color: '#fb7185', title: 'The Conqueror',
    desc: 'Crush opposition through combat and guerrilla strikes — take and hold by strength.',
  },
};

export const PLAYSTYLE_ORDER: Playstyle[] = ['help', 'negotiate', 'scavenge', 'loot', 'dominate'];

export type PlaystyleReputation = Record<Playstyle, number>;
export const emptyReputation = (): PlaystyleReputation => ({ help: 0, negotiate: 0, scavenge: 0, loot: 0, dominate: 0 });

/** The player's currently dominant approach (null if they've done nothing yet). */
export function dominantPlaystyle(rep: PlaystyleReputation): Playstyle | null {
  let best: Playstyle | null = null, max = 0;
  for (const p of PLAYSTYLE_ORDER) if (rep[p] > max) { max = rep[p]; best = p; }
  return best;
}

/** Map a playstyle to the MOBA objective bucket it scores under (competitive mode). */
export function playstyleToObjective(p: Playstyle): 'terraform' | 'refugee' | 'resource' | null {
  switch (p) {
    case 'help':
    case 'negotiate': return 'refugee';   // diplomacy/aid objectives
    case 'scavenge':
    case 'loot': return 'resource';        // economy objectives
    case 'dominate': return null;          // scored via captures/eliminations already
  }
}
