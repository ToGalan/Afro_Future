/**
 * useDuel — 1v1 PvP session over a Firestore-signaled WebRTC data channel.
 *
 * Transport: `duelSignaling` (serverless — Firestore only). Once connected, all traffic
 * is P2P JSON over the data channel:
 *   { t:'state', ... }  local snapshot (hero + pet), sent at a FIXED TICK (15 Hz)
 *   { t:'hit', dmg, at } attacker → defender; `at` = attacker position for validation
 *   { t:'cast', icon, at } ability cast (for opponent-side VFX)
 *   { t:'dead' }         a round death → the OTHER peer scores
 *
 * Smoothness: the local snapshot is throttled to a fixed tick; the remote position is
 * kept in a ref buffer (`remoteBufRef`) so the renderer can interpolate between updates
 * instead of snapping. HP/name/pet changes drive `remote` state for the UI.
 *
 * Resilience: a transient ICE 'disconnected' enters a GRACE window (auto-recovers) and
 * only ends the match on 'failed' or grace timeout.
 *
 * Format: first to `WIN_TARGET` round kills wins the match (respawn between rounds).
 *
 * Authority stays defender-side (your HP changes only from an incoming, VALIDATED hit).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { hostDuel, joinDuel, findOpponent, type DuelConnection } from '../services/duelSignaling';

export type DuelStatus = 'idle' | 'hosting' | 'connecting' | 'searching' | 'connected' | 'reconnecting' | 'closed' | 'error';

const TICK_HZ = 15;
const TICK_MS = 1000 / TICK_HZ;
const GRACE_MS = 9000;   // transient-drop grace window before ending the match
const WIN_TARGET = 3;    // first to 3 round kills wins

export interface RemotePet { q: number; r: number; type?: string; moving?: boolean }
export interface RemoteHero {
  pos: { q: number; r: number };
  hp: number; maxHp: number;
  faction?: string; gender?: string; name?: string;
  moving?: boolean; facing?: number;
  pet?: RemotePet | null;
  lastSeen: number;
}
export interface LocalHeroSnapshot {
  pos: { q: number; r: number };
  hp: number; maxHp: number;
  faction?: string; gender?: string; name?: string;
  moving?: boolean; facing?: number;
  pet?: RemotePet | null;
}

interface DuelOpts {
  /** Fired on an incoming hit after the hook's consistency check (consumer does the
   *  range check against its own hero, then applies damage). */
  onHit?: (dmg: number, at?: { q: number; r: number }) => void;
  /** Fired when the opponent casts an ability (for VFX). */
  onCast?: (icon: string, at?: { q: number; r: number }) => void;
  /** Fired when the opponent dies (for death VFX), with their last-known position. */
  onRemoteDead?: (at?: { q: number; r: number }) => void;
}

function axialDist(a: { q: number; r: number }, b: { q: number; r: number }): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}

export function useDuel(opts: DuelOpts = {}) {
  const [status, setStatus] = useState<DuelStatus>('idle');
  const [code, setCode] = useState<string | null>(null);
  const [role, setRole] = useState<'host' | 'guest' | null>(null);
  const [remote, setRemote] = useState<RemoteHero | null>(null);
  const [result, setResult] = useState<'win' | 'lose' | null>(null);
  const [myScore, setMyScore] = useState(0);   // opponent round-deaths I caused
  const [oppScore, setOppScore] = useState(0); // my round-deaths

  const connRef = useRef<DuelConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const optsRef = useRef(opts); optsRef.current = opts;

  // Smooth-interpolation buffer for the remote hero (position/facing/pet) — updated on
  // every tick WITHOUT a React re-render so the renderer can lerp in useFrame.
  const remoteBufRef = useRef<RemoteHero | null>(null);
  // Latest local snapshot to broadcast; the fixed-tick interval reads this ref.
  const localSnapRef = useRef<LocalHeroSnapshot | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const graceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rawSend = useCallback((obj: any) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === 'open') { try { dc.send(JSON.stringify(obj)); } catch {} }
  }, []);

  // Start/stop the fixed-rate broadcast loop.
  const startTick = useCallback(() => {
    if (tickRef.current) return;
    tickRef.current = setInterval(() => {
      const s = localSnapRef.current;
      if (s) rawSend({ t: 'state', ...s });
    }, TICK_MS);
  }, [rawSend]);
  const stopTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  const wireChannel = useCallback((dc: RTCDataChannel) => {
    dcRef.current = dc;
    if (dc.readyState === 'open') { setStatus('connected'); startTick(); }
    dc.onopen = () => { setStatus('connected'); startTick(); };
    dc.onclose = () => { stopTick(); setStatus(s => (s === 'closed' ? s : 'reconnecting')); };
    dc.onmessage = (e) => {
      let m: any; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'state') {
        const snap: RemoteHero = {
          pos: m.pos, hp: m.hp, maxHp: m.maxHp, faction: m.faction, gender: m.gender,
          name: m.name, moving: m.moving, facing: m.facing, pet: m.pet ?? null, lastSeen: Date.now(),
        };
        remoteBufRef.current = snap; // smooth-interp source (no re-render)
        // Re-render the UI bits only when HP / identity / pet change (not every tick).
        setRemote(prev => {
          if (prev && prev.hp === snap.hp && prev.maxHp === snap.maxHp && prev.name === snap.name
            && prev.pet?.type === snap.pet?.type && !!prev.pet === !!snap.pet) {
            // keep prev object identity to avoid a re-render, but keep lastSeen fresh via ref
            return prev;
          }
          return snap;
        });
      } else if (m.t === 'hit') {
        // Consistency check: the attacker's claimed position must be near where they've
        // been broadcasting themselves. Rejects "hit from across the map" spoofing.
        const rb = remoteBufRef.current;
        if (m.at && rb && axialDist(m.at, rb.pos) > 3) { return; }
        optsRef.current.onHit?.(Number(m.dmg) || 0, m.at);
      } else if (m.t === 'cast') {
        optsRef.current.onCast?.(String(m.icon || '✨'), m.at);
      } else if (m.t === 'dead') {
        optsRef.current.onRemoteDead?.(remoteBufRef.current?.pos);
        setMyScore(s => { const n = s + 1; if (n >= WIN_TARGET) setResult('win'); return n; });
      }
    };
  }, [startTick, stopTick]);

  const monitorPc = useCallback((pc: RTCPeerConnection) => {
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        if (graceRef.current) { clearTimeout(graceRef.current); graceRef.current = null; }
        setStatus('connected');
      } else if (s === 'disconnected') {
        // Transient — WebRTC often auto-recovers. Enter grace, end only if it times out.
        setStatus('reconnecting');
        if (!graceRef.current) {
          graceRef.current = setTimeout(() => { graceRef.current = null; setStatus('closed'); }, GRACE_MS);
        }
      } else if (s === 'failed' || s === 'closed') {
        setStatus('closed');
      }
    };
  }, []);

  const beginSession = useCallback((conn: DuelConnection) => {
    connRef.current = conn; setCode(conn.code); setRole(conn.role);
    setResult(null); setRemote(null); setMyScore(0); setOppScore(0);
    remoteBufRef.current = null;
    monitorPc(conn.pc);
  }, [monitorPc]);

  const host = useCallback(async () => {
    try {
      connRef.current?.close();
      setStatus('hosting');
      const conn = await hostDuel();
      beginSession(conn);
      wireChannel(await conn.channel);
      return conn.code;
    } catch (e) { console.warn('[duel] host failed', e); setStatus('error'); return null; }
  }, [beginSession, wireChannel]);

  const join = useCallback(async (c: string) => {
    try {
      connRef.current?.close();
      setStatus('connecting');
      const conn = await joinDuel(c);
      if (!conn) { setStatus('error'); return false; }
      beginSession(conn);
      wireChannel(await conn.channel);
      return true;
    } catch (e) { console.warn('[duel] join failed', e); setStatus('error'); return false; }
  }, [beginSession, wireChannel]);

  const findMatch = useCallback(async () => {
    try {
      connRef.current?.close();
      setStatus('searching');
      const conn = await findOpponent();
      beginSession(conn);
      wireChannel(await conn.channel);
      return conn.code;
    } catch (e) { console.warn('[duel] matchmaking failed', e); setStatus('error'); return null; }
  }, [beginSession, wireChannel]);

  const leave = useCallback(() => {
    stopTick();
    if (graceRef.current) { clearTimeout(graceRef.current); graceRef.current = null; }
    try { connRef.current?.close(); } catch {}
    connRef.current = null; dcRef.current = null; remoteBufRef.current = null; localSnapRef.current = null;
    setStatus('idle'); setCode(null); setRole(null); setRemote(null); setResult(null); setMyScore(0); setOppScore(0);
  }, [stopTick]);

  // Consumer pushes its latest snapshot here (cheap ref write); the tick broadcasts it.
  const setLocalSnapshot = useCallback((s: LocalHeroSnapshot) => { localSnapRef.current = s; }, []);
  const attackRemote = useCallback((dmg: number, at?: { q: number; r: number }) => rawSend({ t: 'hit', dmg, at }), [rawSend]);
  const castAbility = useCallback((icon: string, at?: { q: number; r: number }) => rawSend({ t: 'cast', icon, at }), [rawSend]);
  const reportLocalDeath = useCallback(() => {
    rawSend({ t: 'dead' });
    setOppScore(s => { const n = s + 1; if (n >= WIN_TARGET) setResult('lose'); return n; });
  }, [rawSend]);

  useEffect(() => () => { stopTick(); if (graceRef.current) clearTimeout(graceRef.current); try { connRef.current?.close(); } catch {} }, [stopTick]);

  const active = status === 'hosting' || status === 'connecting' || status === 'searching' || status === 'connected' || status === 'reconnecting';
  return {
    status, code, role, remote, remoteBufRef, result, myScore, oppScore, winTarget: WIN_TARGET, active,
    host, join, findMatch, leave,
    setLocalSnapshot, attackRemote, castAbility, reportLocalDeath,
  };
}
