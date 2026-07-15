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
  // ── eXploit objectives (economy pillar) — the 4X loop now feeds the MOBA score ──
  /** Terraforming a region (healing the land). */
  terraformScore: 20,
  /** Completing a refugee-camp mission (aid delivered / rival cache raided). */
  refugeeCampScore: 15,
  /** Gathering a resource node (ore/energy/bio). */
  resourceScore: 2,
  /** Seconds between scoring ticks. */
  tickSeconds: 5,
  /** First faction to reach this total score wins the match. */
  targetScore: 300,
};

/** eXploit-pillar objectives that grant faction score outside of capture/kills. */
export type MobaObjective = 'terraform' | 'refugee' | 'resource' | 'loot';
const OBJECTIVE_SCORE: Record<MobaObjective, number> = {
  terraform: MOBA_SCORING.terraformScore,
  refugee: MOBA_SCORING.refugeeCampScore,
  resource: MOBA_SCORING.resourceScore,
  loot: MOBA_SCORING.refugeeCampScore,
};

// ═══════════════════════════════════════════════════════════════════════════════
//  VICTORY TRACKS — the shared multi-path win system (solo + multiplayer).
//
//  Four parallel tracks; the first faction to fill ANY track wins the match. Every
//  faction can chase every track (faction is a LEAN, not a lane — Civ 5/6 model), but
//  earns a bonus on its ethos-aligned "natural" track, so its easiest road to victory
//  matches its doctrine while another path stays open.
// ═══════════════════════════════════════════════════════════════════════════════
export type VictoryTrack = 'domination' | 'control' | 'prosperity' | 'exploitation';
export const VICTORY_TRACKS: VictoryTrack[] = ['domination', 'control', 'prosperity', 'exploitation'];

export interface VictoryTrackDef {
  key: VictoryTrack;
  label: string;
  icon: string;
  threshold: number;         // points needed on this track to win
  natural: Faction | null;   // faction that earns the bonus here (null = open to all equally)
  blurb: string;
}
export const VICTORY_TRACK_DEFS: Record<VictoryTrack, VictoryTrackDef> = {
  domination:   { key: 'domination',   label: 'Domination',   icon: '⚔️', threshold: 100, natural: 'ASF', blurb: 'Eliminations & taking enemy ground' },
  control:      { key: 'control',      label: 'Control',      icon: '🗺️', threshold: 100, natural: null,  blurb: 'Hold outposts & whole regions' },
  prosperity:   { key: 'prosperity',   label: 'Prosperity',   icon: '🌱', threshold: 100, natural: 'PAA', blurb: 'Terraform & aid refugees' },
  exploitation: { key: 'exploitation', label: 'Exploitation', icon: '💰', threshold: 100, natural: 'WC',  blurb: 'Gather resources & raid' },
};
/** A faction earns this multiplier on its natural track (its lean, not a hard lane). */
export const NATURAL_TRACK_BONUS = 1.5;

export type FactionVictory = Record<Faction, Record<VictoryTrack, number>>;

export function emptyVictory(): FactionVictory {
  const zero = (): Record<VictoryTrack, number> => ({ domination: 0, control: 0, prosperity: 0, exploitation: 0 });
  return { PAA: zero(), ASF: zero(), WC: zero() };
}

/** Add points to a faction's track, applying its natural-track lean bonus. Returns the gain. */
export function addVictory(v: FactionVictory, faction: Faction, track: VictoryTrack, base: number): number {
  if (base <= 0) return 0;
  const gain = base * (VICTORY_TRACK_DEFS[track].natural === faction ? NATURAL_TRACK_BONUS : 1);
  v[faction][track] += gain;
  return gain;
}

export interface VictoryResult { faction: Faction; track: VictoryTrack }
/** First faction to fill any track wins; ties broken by how far past the threshold it is. */
export function evaluateVictory(v: FactionVictory): VictoryResult | null {
  let best: VictoryResult | null = null;
  let bestExcess = -1;
  for (const f of FACTIONS) {
    for (const t of VICTORY_TRACKS) {
      const excess = v[f][t] - VICTORY_TRACK_DEFS[t].threshold;
      if (excess >= 0 && excess > bestExcess) { bestExcess = excess; best = { faction: f, track: t }; }
    }
  }
  return best;
}

/** Leading faction + its value on a track (drives the 4-meter HUD). */
export function trackLeader(v: FactionVictory, t: VictoryTrack): { faction: Faction; value: number } {
  let faction: Faction = FACTIONS[0];
  let value = -1;
  for (const f of FACTIONS) if (v[f][t] > value) { value = v[f][t]; faction = f; }
  return { faction, value };
}

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
  /** Accumulated score per faction (total — the scoreboard number). */
  score: Record<Faction, number>;
  /** Per-faction progress on each of the four victory tracks. */
  victory: FactionVictory;
  startedAt: number | null;
  winner: Faction | null;
  /** Which track the winner filled (for the result banner), if won by track. */
  winningTrack: VictoryTrack | null;
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
    victory: emptyVictory(),
    startedAt: null,
    winner: null,
    winningTrack: null,
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
  const prevOwner = o.owner; // neutral capture → Control; taking an enemy's → also Domination
  o.owner = faction;
  let delta = MOBA_SCORING.captureBonus;
  // Every capture extends your Control; wresting one from a rival also feeds Domination.
  addVictory(state.victory, faction, 'control', 8);
  if (prevOwner !== 'neutral') addVictory(state.victory, faction, 'domination', 6);
  // Region newly completed?
  const regionOutposts = Object.values(state.outposts).filter(x => x.region === o.region);
  if (regionOutposts.length > 0 && regionOutposts.every(x => x.owner === faction)) {
    delta += MOBA_SCORING.regionControlBonus;
    addVictory(state.victory, faction, 'control', 20);
  }
  state.score[faction] += delta;
  return delta;
}

/** Advance one scoring tick: every owned outpost yields income to its faction. */
export function applyScoreTick(state: MatchState): void {
  const control = computeControl(state.outposts);
  for (const f of FACTIONS) {
    const held = control[f].outposts;
    if (held <= 0) continue;
    state.score[f] += held * MOBA_SCORING.outpostTickScore;
    // Holding ground steadily builds the Control track (the eXpand/hold path).
    addVictory(state.victory, f, 'control', held * MOBA_SCORING.outpostTickScore);
  }
}

/** Record an elimination: award score to the killer's faction. */
export function applyElimination(state: MatchState, killerFaction: Faction): void {
  state.score[killerFaction] += MOBA_SCORING.eliminationScore;
  addVictory(state.victory, killerFaction, 'domination', 12);
}

/** Award an eXploit-pillar objective to a faction. Returns the score delta.
 *  Track routing: terraform/refugee aid → Prosperity; resource/loot → Exploitation. */
export function applyObjective(state: MatchState, faction: Faction, kind: MobaObjective): number {
  const delta = OBJECTIVE_SCORE[kind] ?? 0;
  state.score[faction] += delta;
  const track: VictoryTrack = (kind === 'terraform' || kind === 'refugee') ? 'prosperity' : 'exploitation';
  addVictory(state.victory, faction, track, kind === 'terraform' ? 22 : kind === 'refugee' ? 16 : 10);
  return delta;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FACTION STRATEGY AI — the "brain" that makes a bot faction play toward its GDD
//  doctrine instead of blindly walking to the nearest outpost. Pure + network-agnostic
//  so the SAME logic drives MOBA bots (host sim) and solo rival factions.
//
//  Each faction weights the 4X pillars differently (its victory lean):
//    PAA "Heal & Unite"   → eXpand peacefully + eXploit (terraform/aid) + defend; never hunts.
//    ASF "Africa First"   → eXterminate + aggressive eXpand (takes enemy ground, hunts heroes).
//    WC  "Survival"        → opportunistic eXpand + eXploit (raid), moderate hunting.
// ═══════════════════════════════════════════════════════════════════════════════

export interface FactionStrategy {
  captureNeutral: number; // desire to claim unowned ground (eXpand)
  captureEnemy: number;   // desire to take an enemy-held outpost (aggressive eXpand)
  defend: number;         // desire to protect an own outpost an enemy is contesting
  hunt: number;           // desire to chase & strike enemy heroes (eXterminate)
  huntRange: number;      // how many tiles it will divert from its objective to hunt
}

export const FACTION_STRATEGY: Record<Faction, FactionStrategy> = {
  PAA: { captureNeutral: 1.15, captureEnemy: 0.45, defend: 1.30, hunt: 0.0, huntRange: 1 },
  ASF: { captureNeutral: 0.85, captureEnemy: 1.45, defend: 0.60, hunt: 1.35, huntRange: 5 },
  WC:  { captureNeutral: 1.15, captureEnemy: 1.00, defend: 0.75, hunt: 0.65, huntRange: 3 },
};

export interface AxialPt { q: number; r: number }
export function axialDistPt(a: AxialPt, b: AxialPt): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}

/** A rival hero the AI can react to (human or another faction's bot). */
export interface AIThreat { faction: Faction; q: number; r: number; hp: number }

export type AIObjective =
  | { kind: 'capture'; target: MatchOutpost; pos: AxialPt }
  | { kind: 'defend';  target: MatchOutpost; pos: AxialPt }
  | { kind: 'hunt';    pos: AxialPt }
  | { kind: 'idle' };

/**
 * Choose the best strategic objective for `faction`'s bot at `pos`, given the current
 * outpost ownership and the rival heroes on the map. Scores every candidate by
 * (doctrine weight ÷ distance) and returns the highest — so a bot expands, contests,
 * defends, or hunts in the mix its faction's ethos dictates.
 */
export function chooseAIObjective(
  faction: Faction, pos: AxialPt,
  outposts: Record<string, MatchOutpost>, threats: AIThreat[],
): AIObjective {
  const s = FACTION_STRATEGY[faction];
  let best: AIObjective = { kind: 'idle' };
  let bestScore = 0;

  // 1) Expansion / contesting — every outpost this faction doesn't already hold.
  for (const o of Object.values(outposts)) {
    if (o.owner === faction) continue;
    const w = o.owner === 'neutral' ? s.captureNeutral : s.captureEnemy;
    if (w <= 0) continue;
    const score = w / (axialDistPt(pos, o) + 1);
    if (score > bestScore) { bestScore = score; best = { kind: 'capture', target: o, pos: { q: o.q, r: o.r } }; }
  }

  // 2) Defense — an own outpost with an enemy hero looming within 2 tiles.
  if (s.defend > 0) {
    for (const o of Object.values(outposts)) {
      if (o.owner !== faction) continue;
      const contested = threats.some(t => t.faction !== faction && axialDistPt(t, o) <= 2);
      if (!contested) continue;
      const score = s.defend / (axialDistPt(pos, o) + 1);
      if (score > bestScore) { bestScore = score; best = { kind: 'defend', target: o, pos: { q: o.q, r: o.r } }; }
    }
  }

  // 3) Hunt — a rival hero within the faction's aggression range (ASF ranges widest).
  if (s.hunt > 0) {
    for (const t of threats) {
      if (t.faction === faction) continue;
      const d = axialDistPt(pos, t);
      if (d > s.huntRange) continue;
      // Weaker heroes are juicier; being adjacent makes striking almost free.
      const score = (s.hunt * (t.hp < 40 ? 1.4 : 1)) / (d + 0.5);
      if (score > bestScore) { bestScore = score; best = { kind: 'hunt', pos: { q: t.q, r: t.r } }; }
    }
  }

  return best;
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
