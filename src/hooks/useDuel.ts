/**
 * useDuel — 1v1 PvP session over a Firestore-signaled WebRTC data channel.
 *
 * Transport: `duelSignaling` (serverless — Firestore only). Once the peer connection
 * is up, all traffic is P2P JSON over the data channel:
 *   { t:'state', ... }  local hero snapshot (position/hp/identity), sent frequently
 *   { t:'hit', dmg }    attacker → defender; the defender applies it to its OWN hp
 *   { t:'dead' }        defender broadcasts when it dies → the other peer WINS
 *
 * Damage authority is DEFENDER-side: your hp only changes when the opponent sends you
 * a 'hit', and your death is announced by you. This keeps the two peers from fighting
 * over authority on the same value (no server to arbitrate).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { hostDuel, joinDuel, findOpponent, type DuelConnection } from '../services/duelSignaling';

export type DuelStatus = 'idle' | 'hosting' | 'connecting' | 'searching' | 'connected' | 'closed' | 'error';

export interface RemoteHero {
  pos: { q: number; r: number };
  hp: number; maxHp: number;
  faction?: string; gender?: string; name?: string;
  moving?: boolean; facing?: number;
  lastSeen: number;
}

export interface LocalHeroSnapshot {
  pos: { q: number; r: number };
  hp: number; maxHp: number;
  faction?: string; gender?: string; name?: string;
  moving?: boolean; facing?: number;
}

export function useDuel(opts: { onHit?: (dmg: number) => void } = {}) {
  const [status, setStatus] = useState<DuelStatus>('idle');
  const [code, setCode] = useState<string | null>(null);
  const [role, setRole] = useState<'host' | 'guest' | null>(null);
  const [remote, setRemote] = useState<RemoteHero | null>(null);
  const [result, setResult] = useState<'win' | 'lose' | null>(null);

  const connRef = useRef<DuelConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const optsRef = useRef(opts); optsRef.current = opts;

  const wireChannel = useCallback((dc: RTCDataChannel) => {
    dcRef.current = dc;
    if (dc.readyState === 'open') setStatus('connected');
    dc.onopen = () => setStatus('connected');
    dc.onclose = () => setStatus('closed');
    dc.onmessage = (e) => {
      let m: any; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'state') {
        setRemote({ pos: m.pos, hp: m.hp, maxHp: m.maxHp, faction: m.faction, gender: m.gender, name: m.name, moving: m.moving, facing: m.facing, lastSeen: Date.now() });
      } else if (m.t === 'hit') {
        optsRef.current.onHit?.(Number(m.dmg) || 0);
      } else if (m.t === 'dead') {
        setResult('win');
      }
    };
  }, []);

  const monitorPc = useCallback((pc: RTCPeerConnection) => {
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') setStatus('connected');
      else if (s === 'failed' || s === 'disconnected' || s === 'closed') setStatus('closed');
    };
  }, []);

  const host = useCallback(async () => {
    try {
      connRef.current?.close();
      setStatus('hosting'); setResult(null); setRemote(null);
      const conn = await hostDuel();
      connRef.current = conn; setCode(conn.code); setRole('host');
      monitorPc(conn.pc);
      wireChannel(await conn.channel);
      return conn.code;
    } catch (e) { console.warn('[duel] host failed', e); setStatus('error'); return null; }
  }, [monitorPc, wireChannel]);

  const join = useCallback(async (c: string) => {
    try {
      connRef.current?.close();
      setStatus('connecting'); setResult(null); setRemote(null);
      const conn = await joinDuel(c);
      if (!conn) { setStatus('error'); return false; }
      connRef.current = conn; setCode(conn.code); setRole('guest');
      monitorPc(conn.pc);
      wireChannel(await conn.channel);
      return true;
    } catch (e) { console.warn('[duel] join failed', e); setStatus('error'); return false; }
  }, [monitorPc, wireChannel]);

  const findMatch = useCallback(async () => {
    try {
      connRef.current?.close();
      setStatus('searching'); setResult(null); setRemote(null);
      const conn = await findOpponent();
      connRef.current = conn; setCode(conn.code); setRole(conn.role);
      monitorPc(conn.pc);
      wireChannel(await conn.channel);
      return conn.code;
    } catch (e) { console.warn('[duel] matchmaking failed', e); setStatus('error'); return null; }
  }, [monitorPc, wireChannel]);

  const leave = useCallback(() => {
    try { connRef.current?.close(); } catch {}
    connRef.current = null; dcRef.current = null;
    setStatus('idle'); setCode(null); setRole(null); setRemote(null); setResult(null);
  }, []);

  const rawSend = useCallback((obj: any) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === 'open') { try { dc.send(JSON.stringify(obj)); } catch {} }
  }, []);

  const sendState = useCallback((s: LocalHeroSnapshot) => rawSend({ t: 'state', ...s }), [rawSend]);
  const attackRemote = useCallback((dmg: number) => rawSend({ t: 'hit', dmg }), [rawSend]);
  const reportLocalDeath = useCallback(() => { rawSend({ t: 'dead' }); setResult('lose'); }, [rawSend]);

  // Tear down on unmount.
  useEffect(() => () => { try { connRef.current?.close(); } catch {} }, []);

  const active = status === 'hosting' || status === 'connecting' || status === 'searching' || status === 'connected';
  return { status, code, role, remote, result, active, host, join, findMatch, leave, sendState, attackRemote, reportLocalDeath };
}
