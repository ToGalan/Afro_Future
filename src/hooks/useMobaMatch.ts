/**
 * useMobaMatch — client hook for the 1v1v1 MOBA (GDD competitive mode), running on the
 * host-authoritative P2P transport (`matchSignaling`).
 *
 * Authority model (see matchSignaling for the transport):
 *   • The HOST owns the single source of truth: a `mobaMatch` MatchState (faction scores,
 *     outpost ownership, phase, winner) plus every hero's position/HP. It runs a fixed
 *     TICK: applies score income, simulates the AI faction(s), evaluates the winner, and
 *     BROADCASTS a world snapshot to all guests.
 *   • GUESTS are thin: they push their own hero snapshot up to the host and send intents
 *     (capture an outpost, land a hit, cast). They render whatever world snapshot the host
 *     sends — remote heroes, outpost ownership, and the shared scoreboard.
 *
 * Wire format (JSON over the data channel):
 *   guest → host : { t:'snap', ...hero }              own hero/pet state (at TICK)
 *                  { t:'cap',  key }                  request to capture an outpost
 *                  { t:'hit',  target, dmg, at }      claim a hit on another hero
 *                  { t:'cast', icon, at }             ability cast (VFX)
 *                  { t:'dead' }                       "my hero died this round"
 *   host  → guest : { t:'world', heroes:[…], outposts:{key:owner}, score, phase, winner }
 *                  { t:'hit', dmg, at }               a hit landed on YOU (relayed)
 *                  { t:'cast', icon, at }             someone cast (relayed, not yours)
 *
 * The host consumes the same events locally (no channel) so host & guest logic converge.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  hostMatch, joinMatch, findOpenMatch, pickFreeFaction,
  type MatchHostController, type MatchGuestController,
  type MatchPlayerInfo, type MatchRoom,
} from '../services/matchSignaling';
import {
  createMatch, applyCapture, applyScoreTick, applyElimination, applyObjective, evaluateWinner,
  evaluateVictory, emptyVictory, chooseAIObjective, FACTIONS, MOBA_MODES, MOBA_SCORING,
  type Faction, type MobaMode, type MatchState, type MatchOutpost, type MobaObjective, type AIThreat,
  type FactionVictory, type VictoryTrack,
} from '../services/mobaMatch';

const TICK_HZ = 15;
const TICK_MS = 1000 / TICK_HZ;
const AI_STEP_MS = 650;          // how often an AI hero advances one hex
const AI_ATTACK_MS = 1100;       // min time between an AI hero's strikes on a player
const AI_ATTACK_DMG = 8;         // damage an aggressive AI hero deals when adjacent
const HERO_STALE_MS = 6000;      // drop a remote hero not seen for this long (disconnect)

export type MobaStatus = 'idle' | 'searching' | 'hosting' | 'joining' | 'lobby' | 'active' | 'ended' | 'error';

export interface MobaPet { q: number; r: number; type?: string; moving?: boolean }
export interface MobaHero {
  uid: string;
  faction: Faction;
  pos: { q: number; r: number };
  hp: number; maxHp: number;
  name?: string; gender?: string; moving?: boolean; facing?: number;
  isAI?: boolean;
  pet?: MobaPet | null;
  lastSeen: number;
}
export interface MobaLocalSnapshot {
  pos: { q: number; r: number };
  hp: number; maxHp: number;
  gender?: string; name?: string; moving?: boolean; facing?: number;
  pet?: MobaPet | null;
}
/** An outpost with per-faction ownership, keyed `${q},${r}` like useOutposts. */
export interface MobaOutpost { key: string; q: number; r: number; region: number; owner: Faction | 'neutral' }

interface MobaOpts {
  onHit?: (dmg: number, at?: { q: number; r: number }) => void;
  onCast?: (icon: string, at?: { q: number; r: number }) => void;
  onRemoteDead?: (at?: { q: number; r: number }) => void;
}

function axialDist(a: { q: number; r: number }, b: { q: number; r: number }): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}
/** Step one hex from `from` toward `to` (greedy on the 6 axial neighbours). */
function stepToward(from: { q: number; r: number }, to: { q: number; r: number }): { q: number; r: number } {
  const dirs = [ [1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1] ];
  let best = from, bestD = axialDist(from, to);
  for (const [dq, dr] of dirs) {
    const n = { q: from.q + dq, r: from.r + dr };
    const d = axialDist(n, to);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

export function useMobaMatch(opts: MobaOpts = {}) {
  const [status, setStatus] = useState<MobaStatus>('idle');
  const [role, setRole] = useState<'host' | 'guest' | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [seed, setSeed] = useState<number | null>(null);
  const [mode, setMode] = useState<MobaMode>('FFA_1v1v1');
  const [players, setPlayers] = useState<MatchPlayerInfo[]>([]);
  const [myFaction, setMyFaction] = useState<Faction | null>(null);
  const [phase, setPhase] = useState<'lobby' | 'active' | 'ended'>('lobby');
  const [winner, setWinner] = useState<Faction | null>(null);
  const [scores, setScores] = useState<Record<Faction, number>>({ PAA: 0, ASF: 0, WC: 0 });
  const [victory, setVictory] = useState<FactionVictory>(() => emptyVictory());
  const [winningTrack, setWinningTrack] = useState<VictoryTrack | null>(null);
  const victorySigRef = useRef('');
  const [outposts, setOutposts] = useState<MobaOutpost[]>([]);
  // Authoritative outpost ownership by "q,r" key — populated on BOTH host and guest from
  // world snapshots (the geometry itself is generated identically on every client).
  const [outpostOwners, setOutpostOwners] = useState<Record<string, Faction | 'neutral'>>({});
  // True while the player reached this room via quick-match (findMatch) rather than a manual
  // host/join — the consumer uses it to auto-start the match once the lobby is ready.
  const [quickMatch, setQuickMatch] = useState(false);
  // Remote heroes (other players + AI) for the UI. The high-frequency positions live in
  // a ref buffer for smooth interpolation; `remotes` state only re-renders on identity/HP.
  const [remotes, setRemotes] = useState<MobaHero[]>([]);

  const optsRef = useRef(opts); optsRef.current = opts;
  const hostRef = useRef<MatchHostController | null>(null);
  const guestRef = useRef<MatchGuestController | null>(null);
  const myFactionRef = useRef<Faction | null>(null); myFactionRef.current = myFaction;
  const myUidRef = useRef<string | null>(null);
  // Live role for the long-lived tick interval + action callbacks. A plain `role`
  // closure goes stale: host()/join() call startTick() before the setRole() re-render
  // lands, so the interval would capture role=null and never broadcast.
  const roleRef = useRef<'host' | 'guest' | null>(null); roleRef.current = role;
  // Signatures to avoid 15 Hz re-renders when scores/ownership haven't actually changed
  // (world snapshots are parsed fresh each tick → new object refs).
  const ownersSigRef = useRef('');
  const scoreSigRef = useRef('');

  // Smooth-interp buffer: uid → hero (updated every tick, no re-render).
  const remotesBufRef = useRef<Map<string, MobaHero>>(new Map());
  // Latest local hero snapshot to broadcast.
  const localSnapRef = useRef<MobaLocalSnapshot | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Host authoritative state ────────────────────────────────────────────────
  const matchRef = useRef<MatchState | null>(null);        // mobaMatch state (host only)
  const outpostGeoRef = useRef<Map<string, MatchOutpost>>(new Map()); // key → geo (host)
  const heroesRef = useRef<Map<string, MobaHero>>(new Map()); // uid → latest hero (host)
  const aiHeroesRef = useRef<Map<Faction, MobaHero>>(new Map()); // faction → AI hero (host)
  const aiStepRef = useRef(0);
  const aiAtkReadyRef = useRef<Map<Faction, number>>(new Map()); // faction → next-strike time (host)
  const lastScoreTickRef = useRef(0);

  const isHost = () => role === 'host' && hostRef.current;

  // Publish the ref buffer → `remotes` state (identity/HP diffing to limit re-renders).
  const publishRemotes = useCallback(() => {
    const list = [...remotesBufRef.current.values()];
    setRemotes((prev) => {
      if (prev.length === list.length && prev.every((p) => {
        const n = remotesBufRef.current.get(p.uid);
        return n && n.hp === p.hp && n.maxHp === p.maxHp && n.faction === p.faction && !!n.isAI === !!p.isAI && !!n.pet === !!p.pet;
      })) return prev;
      return list;
    });
  }, []);

  // Apply an inbound world snapshot (guest side).
  const applyWorld = useCallback((w: any) => {
    const myUid = myUidRef.current;
    const buf = remotesBufRef.current;
    const seen = new Set<string>();
    for (const h of (w.heroes || []) as MobaHero[]) {
      if (h.uid === myUid) continue; // don't render myself as a remote
      seen.add(h.uid);
      buf.set(h.uid, { ...h, lastSeen: Date.now() });
    }
    for (const uid of [...buf.keys()]) if (!seen.has(uid)) buf.delete(uid);
    publishRemotes();
    // Ownership + scores come straight from the host's authoritative map. Works on the
    // host AND the guest (guest has no local `outposts` list to map over). Guard by
    // signature so we don't re-render the whole mission 15×/sec when nothing changed.
    if (w.outposts) {
      const sig = JSON.stringify(w.outposts);
      if (sig !== ownersSigRef.current) { ownersSigRef.current = sig; setOutpostOwners(w.outposts); }
    }
    if (w.score) {
      const sig = JSON.stringify(w.score);
      if (sig !== scoreSigRef.current) { scoreSigRef.current = sig; setScores(w.score); }
    }
    if (w.victory) {
      const sig = JSON.stringify(w.victory);
      if (sig !== victorySigRef.current) { victorySigRef.current = sig; setVictory(w.victory); }
    }
    if ('winningTrack' in w) setWinningTrack(w.winningTrack ?? null);
    if (w.phase) setPhase(w.phase);
    if ('winner' in w) setWinner(w.winner ?? null);
  }, [publishRemotes]);

  // ── Host: build the authoritative world snapshot and broadcast it ─────────────
  const buildWorld = useCallback(() => {
    const ms = matchRef.current;
    if (!ms) return null;
    const heroes: MobaHero[] = [...heroesRef.current.values(), ...aiHeroesRef.current.values()];
    const outMap: Record<string, Faction | 'neutral'> = {};
    for (const o of Object.values(ms.outposts)) outMap[o.key] = o.owner;
    return { t: 'world', heroes, outposts: outMap, score: ms.score, victory: ms.victory, winningTrack: ms.winningTrack, phase: ms.phase, winner: ms.winner };
  }, []);

  // ── Fixed tick ────────────────────────────────────────────────────────────────
  const startTick = useCallback(() => {
    if (tickRef.current) return;
    tickRef.current = setInterval(() => {
      // Everyone: broadcast/push own hero snapshot.
      const snap = localSnapRef.current;
      const host = hostRef.current;
      const guest = guestRef.current;
      const myUid = myUidRef.current;
      const myFac = myFactionRef.current;

      if (roleRef.current === 'host' && host && matchRef.current) {
        const ms = matchRef.current;
        // Seat the host's own hero into the sim.
        if (snap && myUid && myFac) {
          heroesRef.current.set(myUid, { uid: myUid, faction: myFac, pos: snap.pos, hp: snap.hp, maxHp: snap.maxHp, name: snap.name, gender: snap.gender, moving: snap.moving, facing: snap.facing, pet: snap.pet ?? null, lastSeen: Date.now() });
        }
        // Drop stale (disconnected) human heroes.
        const now = Date.now();
        for (const [uid, h] of [...heroesRef.current.entries()]) {
          if (uid !== myUid && now - h.lastSeen > HERO_STALE_MS) heroesRef.current.delete(uid);
        }
        if (ms.phase === 'active') {
          stepAI();
          // Score income tick.
          if (now - lastScoreTickRef.current >= MOBA_SCORING.tickSeconds * 1000) {
            lastScoreTickRef.current = now;
            applyScoreTick(ms);
          }
          // Victory tracks (~100 resolved objectives) are the win condition; the only
          // fallback is last faction standing — the score race was retired.
          const vr = evaluateVictory(ms.victory);
          const w = vr ? vr.faction : evaluateWinner(ms);
          if (w && !ms.winner) { ms.winner = w; ms.winningTrack = vr?.track ?? null; ms.phase = 'ended'; host.updateRoom({ phase: 'ended', winner: w }); }
        }
        const world = buildWorld();
        if (world) { host.broadcast(world); applyWorld(world); }
      } else if (roleRef.current === 'guest' && guest) {
        if (snap) guest.send({ t: 'snap', uid: myUid, faction: myFac, ...snap });
      }
    }, TICK_MS);
  }, [buildWorld, applyWorld]);

  const stopTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  // ── AI factions (host): any faction with no human player is bot-controlled ────
  const stepAI = useCallback(() => {
    const ms = matchRef.current;
    if (!ms) return;
    const now = Date.now();
    const humanFactions = new Set([...heroesRef.current.values()].map((h) => h.faction));
    // Ensure an AI hero exists for each unmanned faction; retire ones that got a human.
    for (const f of FACTIONS) {
      if (humanFactions.has(f)) { aiHeroesRef.current.delete(f); aiAtkReadyRef.current.delete(f); continue; }
      if (!aiHeroesRef.current.has(f)) {
        // Spread each bot's spawn across different outposts so they don't clump on one tile.
        const geo = [...outpostGeoRef.current.values()];
        const spawn = geo.length ? { q: geo[FACTIONS.indexOf(f) % geo.length].q, r: geo[FACTIONS.indexOf(f) % geo.length].r } : { q: 0, r: 0 };
        aiHeroesRef.current.set(f, { uid: `ai-${f}`, faction: f, pos: spawn, hp: 100, maxHp: 100, name: `${f} Bot`, isAI: true, moving: false, pet: null, lastSeen: now });
      }
    }
    if (now - aiStepRef.current < AI_STEP_MS) return;
    aiStepRef.current = now;

    // Rival heroes (humans + other bots) the strategy AI reacts to for hunt/defend.
    const allHeroes = [...heroesRef.current.values(), ...aiHeroesRef.current.values()];
    const threats: AIThreat[] = allHeroes.map(h => ({ faction: h.faction, q: h.pos.q, r: h.pos.r, hp: h.hp }));

    // Each bot picks a doctrine-weighted objective (expand / contest / defend / hunt)
    // and acts on it — a real 4X opponent instead of a nearest-outpost seeker.
    for (const [f, ai] of aiHeroesRef.current) {
      const obj = chooseAIObjective(f, ai.pos, ms.outposts, threats);
      if (obj.kind === 'idle') { ai.moving = false; ai.lastSeen = now; continue; }
      const dist = axialDist(ai.pos, obj.pos);

      if (obj.kind === 'capture') {
        if (dist <= 1) { applyCapture(ms, obj.target.key, f); ai.moving = false; }
        else { ai.pos = stepToward(ai.pos, obj.pos); ai.moving = true; }
      } else if (obj.kind === 'defend') {
        // Garrison the threatened outpost (its presence deters / recaptures).
        if (dist >= 1) { ai.pos = stepToward(ai.pos, obj.pos); ai.moving = true; }
        else ai.moving = false;
      } else if (obj.kind === 'hunt') {
        if (dist <= 1) {
          ai.moving = false;
          // Strike the adjacent enemy hero on cooldown (only real players take damage).
          const ready = aiAtkReadyRef.current.get(f) ?? 0;
          if (now >= ready) {
            aiAtkReadyRef.current.set(f, now + AI_ATTACK_MS);
            const victim = allHeroes.find(h => !h.isAI && h.faction !== f && axialDist(h.pos, ai.pos) <= 1);
            if (victim) {
              if (victim.uid === myUidRef.current) optsRef.current.onHit?.(AI_ATTACK_DMG, ai.pos);
              else hostRef.current?.sendTo(victim.uid, { t: 'hit', dmg: AI_ATTACK_DMG, at: ai.pos });
            }
          }
        } else { ai.pos = stepToward(ai.pos, obj.pos); ai.moving = true; }
      }
      ai.lastSeen = now;
    }
  }, []);

  // ── Host message handling (from a guest) ──────────────────────────────────────
  const onGuestMessage = useCallback((from: string, m: any) => {
    const ms = matchRef.current;
    if (m.t === 'snap') {
      heroesRef.current.set(from, {
        uid: from, faction: m.faction, pos: m.pos, hp: m.hp, maxHp: m.maxHp,
        name: m.name, gender: m.gender, moving: m.moving, facing: m.facing, pet: m.pet ?? null, lastSeen: Date.now(),
      });
    } else if (m.t === 'cap' && ms) {
      const h = heroesRef.current.get(from);
      const o = ms.outposts[m.key];
      if (h && o && axialDist(h.pos, o) <= 1) applyCapture(ms, m.key, h.faction);
    } else if (m.t === 'obj' && ms) {
      // eXploit objective completed by a guest (terraform / refugee / resource).
      const h = heroesRef.current.get(from);
      if (h) applyObjective(ms, h.faction, m.kind as MobaObjective);
    } else if (m.t === 'hit' && ms) {
      // Relay a hit to its target; validate attacker proximity.
      const attacker = heroesRef.current.get(from);
      const targetUid = m.target as string;
      if (m.at && attacker && axialDist(attacker.pos, m.at) > 3) return; // spoof guard
      if (targetUid === myUidRef.current) { optsRef.current.onHit?.(Number(m.dmg) || 0, m.at); }
      else { hostRef.current?.sendTo(targetUid, { t: 'hit', dmg: m.dmg, at: m.at }); }
    } else if (m.t === 'cast') {
      optsRef.current.onCast?.(String(m.icon || '✨'), m.at);
      // relay to everyone except caster
      for (const uid of hostRef.current?.peers() ?? []) if (uid !== from) hostRef.current?.sendTo(uid, { t: 'cast', icon: m.icon, at: m.at });
    } else if (m.t === 'dead' && ms) {
      // The dead hero's faction concedes a kill; award to nearest enemy faction (approx).
      const victim = heroesRef.current.get(from);
      if (victim) {
        // credit the nearest other-faction hero's faction
        let killer: Faction | null = null, best = Infinity;
        for (const h of [...heroesRef.current.values(), ...aiHeroesRef.current.values()]) {
          if (h.faction === victim.faction) continue;
          const d = axialDist(h.pos, victim.pos);
          if (d < best) { best = d; killer = h.faction; }
        }
        if (killer) applyElimination(ms, killer);
      }
    }
  }, []);

  // ── Guest message handling (from host) ────────────────────────────────────────
  const onHostMessage = useCallback((m: any) => {
    if (m.t === 'world') applyWorld(m);
    else if (m.t === 'hit') optsRef.current.onHit?.(Number(m.dmg) || 0, m.at);
    else if (m.t === 'cast') optsRef.current.onCast?.(String(m.icon || '✨'), m.at);
  }, [applyWorld]);

  // ── Lobby actions ─────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    stopTick();
    try { hostRef.current?.close(); } catch {}
    try { guestRef.current?.close(); } catch {}
    hostRef.current = null; guestRef.current = null;
    matchRef.current = null; heroesRef.current.clear(); aiHeroesRef.current.clear();
    remotesBufRef.current.clear();
  }, [stopTick]);

  const host = useCallback(async (faction: Faction, chosenMode: MobaMode = 'FFA_1v1v1', mapSeed?: number, displayName?: string, open = false, quick = false) => {
    cleanup();
    roleRef.current = 'host';
    setStatus('hosting'); setRole('host'); setMyFaction(faction); setMode(chosenMode); setQuickMatch(quick);
    myFactionRef.current = faction;
    try {
      const ctrl = await hostMatch({
        mode: chosenMode, faction, displayName, seed: mapSeed, open,
        handlers: {
          onGuestOpen: () => {},
          onGuestClose: (uid) => { heroesRef.current.delete(uid); },
          onMessage: onGuestMessage,
          onPlayers: (list) => setPlayers(list),
          onRoom: (r: MatchRoom) => { setPhase(r.phase); setWinner(r.winner); },
        },
      });
      hostRef.current = ctrl; myUidRef.current = ctrl.uid; setCode(ctrl.code); setSeed(ctrl.seed);
      setStatus('lobby'); startTick();
      return { code: ctrl.code, seed: ctrl.seed };
    } catch (e) { console.warn('[moba] host failed', e); setStatus('error'); return null; }
  }, [cleanup, onGuestMessage, startTick]);

  const join = useCallback(async (rawCode: string, faction: Faction, displayName?: string, quick = false) => {
    cleanup();
    roleRef.current = 'guest';
    setStatus('joining'); setRole('guest'); setMyFaction(faction); setQuickMatch(quick);
    myFactionRef.current = faction;
    try {
      const ctrl = await joinMatch(rawCode, {
        faction, displayName,
        handlers: {
          onOpen: () => setStatus('lobby'),
          onClose: () => setStatus((s) => (s === 'ended' ? s : 'idle')),
          onMessage: onHostMessage,
          onPlayers: (list) => setPlayers(list),
          onRoom: (r: MatchRoom) => { setMode(r.mode); setPhase(r.phase); setWinner(r.winner); if (r.phase === 'active') setStatus('active'); },
        },
      });
      if (!ctrl) { setStatus('error'); return false; }
      guestRef.current = ctrl; myUidRef.current = ctrl.uid; setCode(ctrl.code); setSeed(ctrl.seed); setMode(ctrl.mode);
      setStatus('lobby'); startTick();
      return true;
    } catch (e) { console.warn('[moba] join failed', e); setStatus('error'); return false; }
  }, [cleanup, onHostMessage, startTick]);

  /**
   * Quick-match: join an open lobby for this mode (claiming a free faction), or host a
   * fresh open room and wait. Mirrors the duel `findOpponent` model. Sets `quickMatch` so
   * the consumer auto-starts once the lobby is ready (full, or after a backfill timeout).
   */
  const findMatch = useCallback(async (faction: Faction, chosenMode: MobaMode = 'FFA_1v1v1', mapSeed?: number, displayName?: string) => {
    setStatus('searching'); setMode(chosenMode); setQuickMatch(true);
    try {
      const found = await findOpenMatch(chosenMode);
      if (found) {
        const fac = pickFreeFaction(faction, found.taken);
        const ok = await join(found.code, fac, displayName, true);
        if (ok) return true;
        // Host vanished between find and join — fall through to hosting our own.
      }
      const res = await host(faction, chosenMode, mapSeed, displayName, true, true);
      return !!res;
    } catch (e) { console.warn('[moba] findMatch failed', e); setStatus('error'); return false; }
  }, [join, host]);

  const setFaction = useCallback((faction: Faction) => {
    setMyFaction(faction);
    hostRef.current?.setFaction(faction);
    guestRef.current?.setFaction(faction);
  }, []);

  /** Host: seed the sim's outposts from the local (deterministic) map, then go active. */
  const startMatch = useCallback((mapOutposts: MobaOutpost[]) => {
    const ctrl = hostRef.current;
    if (!ctrl) return;
    const geo = new Map<string, MatchOutpost>();
    const list: MatchOutpost[] = mapOutposts.map((o) => {
      const mo: MatchOutpost = { key: o.key, q: o.q, r: o.r, region: o.region, owner: 'neutral' };
      geo.set(o.key, mo);
      return mo;
    });
    outpostGeoRef.current = geo;
    const playerIds = players.map((p) => p.uid);
    const ms = createMatch(ctrl.code, ctrl.mode, list, playerIds);
    // Overwrite auto faction assignment with each player's CHOSEN faction.
    ms.players = players.map((p) => ({ playerId: p.uid, faction: p.faction, team: FACTIONS.indexOf(p.faction), alive: true }));
    ms.phase = 'active'; ms.startedAt = Date.now();
    matchRef.current = ms;
    lastScoreTickRef.current = Date.now();
    setOutposts(mapOutposts.map((o) => ({ ...o, owner: 'neutral' })));
    // Close the lobby to matchmaking as it goes live.
    ctrl.updateRoom({ phase: 'active', open: false });
    setPhase('active'); setStatus('active'); setQuickMatch(false);
  }, [players]);

  const leave = useCallback(() => {
    cleanup();
    roleRef.current = null; myFactionRef.current = null; ownersSigRef.current = ''; scoreSigRef.current = '';
    setStatus('idle'); setRole(null); setCode(null); setSeed(null);
    setPlayers([]); setMyFaction(null); setWinner(null); setPhase('lobby'); setQuickMatch(false);
    setScores({ PAA: 0, ASF: 0, WC: 0 }); setOutposts([]); setOutpostOwners({}); setRemotes([]);
    setVictory(emptyVictory()); setWinningTrack(null); victorySigRef.current = '';
  }, [cleanup]);

  // ── Per-frame inputs from the consumer (SoloMissionMap3D) ─────────────────────
  const setLocalSnapshot = useCallback((s: MobaLocalSnapshot) => { localSnapRef.current = s; }, []);
  const requestCapture = useCallback((key: string) => {
    if (roleRef.current === 'host') {
      const ms = matchRef.current; const myUid = myUidRef.current; const myFac = myFactionRef.current;
      const h = myUid ? heroesRef.current.get(myUid) : null;
      if (ms && h && myFac && ms.outposts[key] && axialDist(h.pos, ms.outposts[key]) <= 1) applyCapture(ms, key, myFac);
    } else guestRef.current?.send({ t: 'cap', key });
  }, []);
  const attack = useCallback((targetUid: string, dmg: number, at?: { q: number; r: number }) => {
    if (roleRef.current === 'host') {
      if (targetUid === myUidRef.current) return;
      hostRef.current?.sendTo(targetUid, { t: 'hit', dmg, at });
    } else guestRef.current?.send({ t: 'hit', target: targetUid, dmg, at });
  }, []);
  const castAbility = useCallback((icon: string, at?: { q: number; r: number }) => {
    if (roleRef.current === 'host') hostRef.current?.broadcast({ t: 'cast', icon, at });
    else guestRef.current?.send({ t: 'cast', icon, at });
  }, []);
  const reportLocalDeath = useCallback(() => {
    if (roleRef.current === 'host') {
      const ms = matchRef.current; const myFac = myFactionRef.current;
      if (ms && myFac) {
        let killer: Faction | null = null;
        for (const f of FACTIONS) if (f !== myFac) { killer = f; break; }
        if (killer) applyElimination(ms, killer);
      }
    } else guestRef.current?.send({ t: 'dead' });
  }, []);
  /** Report an eXploit objective (terraform/refugee/resource) for MY faction. */
  const reportObjective = useCallback((kind: MobaObjective) => {
    if (roleRef.current === 'host') {
      const ms = matchRef.current; const myFac = myFactionRef.current;
      if (ms && myFac) applyObjective(ms, myFac, kind);
    } else guestRef.current?.send({ t: 'obj', kind });
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const result: 'win' | 'lose' | null = winner && myFaction ? (winner === myFaction ? 'win' : 'lose') : null;
  const active = status === 'active' || status === 'lobby' || status === 'hosting' || status === 'joining';

  return {
    status, role, code, seed, mode, players, myFaction, myUid: myUidRef.current, phase, winner, scores, outposts, outpostOwners,
    victory, winningTrack, remotes, remotesBufRef, result, active, quickMatch,
    modeConfig: MOBA_MODES[mode],
    // lobby
    host, join, findMatch, setFaction, startMatch, leave,
    // in-match
    setLocalSnapshot, requestCapture, attack, castAbility, reportLocalDeath, reportObjective,
  };
}
