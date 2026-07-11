/**
 * MOBA Match Core — shared, pure data-model & rules for the GDD competitive mode.
 *
 * The GDD ("Multiplayer Online Battle Arena (MOBA) Feature") specifies:
 *   • 1v1v1  — three players, one per faction (PAA / ASF / WC), free-for-all.
 *   • 2v2v2  — three teams of two, one faction per team.
 *   • Objectives: resource gathering, capturing/holding outposts, controlling regions.
 *   • Win by accumulating enough score from those objectives (+ eliminations).
 *
 * This module is deliberately network-agnostic and side-effect free so the SAME rules
 * run on the authoritative server (server.js match loop) and on the client (prediction/UI).
 * The single source of truth for match config, faction assignment, control tallies,
 * scoring, and win evaluation lives here.
 */

export type Faction = 'PAA' | 'ASF' | 'WC';
export const FACTIONS: Faction[] = ['PAA', 'ASF', 'WC'];

export type OutpostOwner = Faction | 'neutral';

/** The two GDD-defined competitive formats. */
export type MobaMode = 'FFA_1v1v1' | 'TEAMS_2v2v2';

export interface MobaModeConfig {
  mode: MobaMode;
  label: string;
  /** Number of competing sides — always 3 (one per faction) in this game. */
  sideCount: number;
  /** Players per side. */
  teamSize: number;
  /** Total human players in a full lobby. */
  players: number;
  description: string;
}

export const MOBA_MODES: Record<MobaMode, MobaModeConfig> = {
  FFA_1v1v1: {
    mode: 'FFA_1v1v1',
    label: '1v1v1 — Free-for-All',
    sideCount: 3,
    teamSize: 1,
    players: 3,
    description: 'Three players, one per faction, fight for outpost & region control.',
  },
  TEAMS_2v2v2: {
    mode: 'TEAMS_2v2v2',
    label: '2v2v2 — Team Battle',
    sideCount: 3,
    teamSize: 2,
    players: 6,
    description: 'Three faction teams of two compete for objectives across the map.',
  },
};

// ── Scoring (GDD "Progress and Rewards" / objective-driven victory) ─────────────
export const MOBA_SCORING = {
  /** Score granted per owned outpost, per scoring tick. */
  outpostTickScore: 1,
  /** One-off score for capturing an outpost from neutral/an enemy. */
  captureBonus: 10,
  /** Score for fully controlling a region (all its outposts). */
  regionControlBonus: 25,
  /** Score for eliminating an enemy hero. */
  eliminationScore: 5,
  /** Seconds between scoring ticks. */
  tickSeconds: 5,
  /** First faction to reach this total score wins the match. */
  targetScore: 300,
};

// ── Match state ────────────────────────────────────────────────────────────────
export interface MatchOutpost {
  key: string;
  q: number;
  r: number;
  region: number;
  owner: OutpostOwner;
}

export interface MatchPlayerSlot {
  playerId: string;
  faction: Faction;
  team: number;        // team index (0..sideCount-1); equals faction slot
  displayName?: string;
  alive: boolean;
}

export type MatchPhase = 'lobby' | 'active' | 'ended';

export interface MatchState {
  id: string;
  mode: MobaMode;
  phase: MatchPhase;
  players: MatchPlayerSlot[];
  outposts: Record<string, MatchOutpost>;
  /** Accumulated score per faction. */
  score: Record<Faction, number>;
  startedAt: number | null;
  winner: Faction | null;
}

// ── Faction assignment ───────────────────────────────────────────────────────
/**
 * Assign the joined players to the three factions.
 * FFA: one player per faction. Teams: `teamSize` players per faction (in join order).
 * Players beyond capacity are dropped (caller should gate lobby size).
 */
export function assignFactions(mode: MobaMode, playerIds: string[]): MatchPlayerSlot[] {
  const cfg = MOBA_MODES[mode];
  const slots: MatchPlayerSlot[] = [];
  const capacity = cfg.players;
  playerIds.slice(0, capacity).forEach((playerId, i) => {
    const team = Math.floor(i / cfg.teamSize) % cfg.sideCount;
    slots.push({ playerId, faction: FACTIONS[team], team, alive: true });
  });
  return slots;
}

export function emptyScore(): Record<Faction, number> {
  return { PAA: 0, ASF: 0, WC: 0 };
}

/** Build a fresh match state in the lobby phase. */
export function createMatch(id: string, mode: MobaMode, outposts: MatchOutpost[], playerIds: string[] = []): MatchState {
  const outpostMap: Record<string, MatchOutpost> = {};
  for (const o of outposts) outpostMap[o.key] = { ...o };
  return {
    id,
    mode,
    phase: 'lobby',
    players: assignFactions(mode, playerIds),
    outposts: outpostMap,
    score: emptyScore(),
    startedAt: null,
    winner: null,
  };
}

// ── Control tallies ──────────────────────────────────────────────────────────
export interface FactionControl {
  outposts: number;
  regionsControlled: number;
}

/** Per-faction outpost counts + fully-controlled region counts. */
export function computeControl(outposts: Record<string, MatchOutpost>): Record<Faction, FactionControl> {
  const out: Record<Faction, FactionControl> = {
    PAA: { outposts: 0, regionsControlled: 0 },
    ASF: { outposts: 0, regionsControlled: 0 },
    WC: { outposts: 0, regionsControlled: 0 },
  };
  // region -> owner -> count, and region -> total
  const regionOwners = new Map<number, { total: number; byFaction: Record<Faction, number> }>();
  for (const o of Object.values(outposts)) {
    if (o.owner !== 'neutral') out[o.owner].outposts++;
    const r = regionOwners.get(o.region) || { total: 0, byFaction: emptyScore() as Record<Faction, number> };
    r.total++;
    if (o.owner !== 'neutral') r.byFaction[o.owner]++;
    regionOwners.set(o.region, r);
  }
  for (const { total, byFaction } of regionOwners.values()) {
    for (const f of FACTIONS) {
      if (total > 0 && byFaction[f] === total) out[f].regionsControlled++;
    }
  }
  return out;
}

/**
 * Capture an outpost for a faction. Returns the score delta earned by the capture
 * (capture bonus + region-control bonus if this completes a region), or null if the
 * capture is a no-op (already owned by that faction, or key unknown).
 */
export function applyCapture(state: MatchState, key: string, faction: Faction): number | null {
  const o = state.outposts[key];
  if (!o || o.owner === faction) return null;
  o.owner = faction;
  let delta = MOBA_SCORING.captureBonus;
  // Region newly completed?
  const regionOutposts = Object.values(state.outposts).filter(x => x.region === o.region);
  if (regionOutposts.length > 0 && regionOutposts.every(x => x.owner === faction)) {
    delta += MOBA_SCORING.regionControlBonus;
  }
  state.score[faction] += delta;
  return delta;
}

/** Advance one scoring tick: every owned outpost yields income to its faction. */
export function applyScoreTick(state: MatchState): void {
  const control = computeControl(state.outposts);
  for (const f of FACTIONS) {
    state.score[f] += control[f].outposts * MOBA_SCORING.outpostTickScore;
  }
}

/** Record an elimination: award score to the killer's faction. */
export function applyElimination(state: MatchState, killerFaction: Faction): void {
  state.score[killerFaction] += MOBA_SCORING.eliminationScore;
}

/**
 * Evaluate the match winner, or null if none yet.
 * Win conditions (GDD): reach the target score, OR be the only faction with any
 * living players (last faction standing).
 */
export function evaluateWinner(state: MatchState): Faction | null {
  // Target score reached → highest score wins (ties broken by outpost control).
  const reached = FACTIONS.filter(f => state.score[f] >= MOBA_SCORING.targetScore);
  if (reached.length > 0) {
    const control = computeControl(state.outposts);
    return reached.sort((a, b) =>
      (state.score[b] - state.score[a]) || (control[b].outposts - control[a].outposts),
    )[0];
  }
  // Last faction standing (only meaningful once the match is active with players).
  if (state.players.length > 0) {
    const factionsAlive = new Set(state.players.filter(p => p.alive).map(p => p.faction));
    if (factionsAlive.size === 1) return [...factionsAlive][0];
  }
  return null;
}
