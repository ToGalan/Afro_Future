/**
 * matchSignaling — host-authoritative WebRTC transport for the 1v1v1 MOBA, signaled
 * over Firestore (no signaling server, same serverless model as duelSignaling).
 *
 * Topology: a STAR. One player is the host (authority): every guest opens a single
 * WebRTC data channel to the host, and the host relays / simulates. Guests never talk
 * to each other directly — all authoritative match state (scores, outpost ownership,
 * the AI faction) is computed on the host and broadcast to guests, while guests send
 * their input/intents up to the host.
 *
 * Firestore layout (matches/{code}):
 *   .                              room doc: { mode, seed, host, phase, winner, createdAt, open }
 *   players/{uid}                  per-player slot: { uid, faction, displayName, isHost, joinedAt }
 *   connections/{guestUid}         per-guest signaling: { offer, answer, guest, createdAt }
 *   connections/{guestUid}/guestCandidates/*   guest ICE
 *   connections/{guestUid}/hostCandidates/*    host ICE
 *
 * Handshake (per guest): the GUEST is the offerer — it creates the data channel, writes
 * its offer, and the host answers. This lets the host accept guests that join at any time
 * without knowing them in advance.
 */
import {
  doc, collection, setDoc, updateDoc, getDoc, onSnapshot, addDoc, deleteDoc, getDocs,
} from 'firebase/firestore';
import { db, ensureAnonAuth } from './firebase';
import type { Faction, MobaMode } from './mobaMatch';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// Short, human-shareable room code (avoids ambiguous chars).
function makeCode(len = 5): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/** A random positive 31-bit seed shared by all clients so every peer generates the
 *  identical map (terrain + outpost placement). */
export function makeSeed(): number {
  return (Math.floor(Math.random() * 0x7fffffff) >>> 0) || 42;
}

export interface MatchPlayerInfo {
  uid: string;
  faction: Faction;
  displayName?: string;
  isHost: boolean;
  joinedAt: number;
}

export interface MatchRoom {
  code: string;
  mode: MobaMode;
  seed: number;
  host: string;
  phase: 'lobby' | 'active' | 'ended';
  winner: Faction | null;
  createdAt: number;
  open?: boolean;
}

// ── Host ────────────────────────────────────────────────────────────────────
export interface HostHandlers {
  /** A guest's data channel opened (they are now reachable). */
  onGuestOpen?: (guestUid: string) => void;
  /** A guest's data channel closed / dropped. */
  onGuestClose?: (guestUid: string) => void;
  /** A message arrived from a guest (already JSON-parsed). */
  onMessage?: (from: string, data: any) => void;
  /** The player roster changed (faction picks / joins / leaves). */
  onPlayers?: (players: MatchPlayerInfo[]) => void;
  /** The room doc changed (phase / winner). */
  onRoom?: (room: MatchRoom) => void;
}

export interface MatchHostController {
  code: string;
  role: 'host';
  uid: string;
  seed: number;
  mode: MobaMode;
  /** Send to every connected guest. */
  broadcast: (obj: any) => void;
  /** Send to one guest by uid. */
  sendTo: (guestUid: string, obj: any) => void;
  /** Patch the room doc (phase, winner, open…). */
  updateRoom: (patch: Partial<MatchRoom>) => Promise<void>;
  /** Change the host's own faction slot. */
  setFaction: (faction: Faction) => Promise<void>;
  /** Currently-connected guest uids. */
  peers: () => string[];
  close: () => void;
}

interface HostPeer {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  unsubs: Array<() => void>;
  remoteSet: boolean;
  pending: RTCIceCandidateInit[];
}

/**
 * Host a MOBA match. Creates the room, seats the host in its faction, and accepts guest
 * connections as they arrive. Returns a controller for broadcasting/relaying.
 */
export async function hostMatch(opts: {
  mode: MobaMode;
  faction: Faction;
  displayName?: string;
  seed?: number;
  open?: boolean;
  handlers?: HostHandlers;
}): Promise<MatchHostController> {
  const user = await ensureAnonAuth();
  const uid = user.uid;
  const code = makeCode();
  const seed = opts.seed ?? makeSeed();
  const handlers = opts.handlers ?? {};
  const roomRef = doc(db, 'matches', code);
  const playersRef = collection(roomRef, 'players');
  const connectionsRef = collection(roomRef, 'connections');

  await setDoc(roomRef, {
    mode: opts.mode,
    seed,
    host: uid,
    phase: 'lobby',
    winner: null,
    createdAt: Date.now(),
    open: !!opts.open,
  });
  await setDoc(doc(playersRef, uid), {
    uid, faction: opts.faction, displayName: opts.displayName ?? null, isHost: true, joinedAt: Date.now(),
  });

  const peers = new Map<string, HostPeer>();
  const topUnsubs: Array<() => void> = [];

  // Roster + room subscriptions.
  topUnsubs.push(onSnapshot(playersRef, (qs) => {
    const list: MatchPlayerInfo[] = qs.docs.map((d) => {
      const v = d.data() as any;
      return { uid: v.uid, faction: v.faction, displayName: v.displayName ?? undefined, isHost: !!v.isHost, joinedAt: v.joinedAt ?? 0 };
    }).sort((a, b) => a.joinedAt - b.joinedAt);
    handlers.onPlayers?.(list);
  }));
  topUnsubs.push(onSnapshot(roomRef, (snap) => {
    const v = snap.data() as any;
    if (v) handlers.onRoom?.({ code, mode: v.mode, seed: v.seed, host: v.host, phase: v.phase, winner: v.winner ?? null, createdAt: v.createdAt, open: v.open });
  }));

  // Accept guests: each new connections/{guestUid} doc with an offer gets a peer.
  const setupPeer = async (guestUid: string, offer: RTCSessionDescriptionInit) => {
    if (peers.has(guestUid)) return; // already handling
    const connRef = doc(connectionsRef, guestUid);
    const hostCandidates = collection(connRef, 'hostCandidates');
    const guestCandidates = collection(connRef, 'guestCandidates');
    const pc = new RTCPeerConnection(ICE_SERVERS);
    const peer: HostPeer = { pc, dc: null, unsubs: [], remoteSet: false, pending: [] };
    peers.set(guestUid, peer);

    pc.onicecandidate = (e) => { if (e.candidate) addDoc(hostCandidates, e.candidate.toJSON()).catch(() => {}); };
    pc.ondatachannel = (e) => {
      const dc = e.channel;
      peer.dc = dc;
      dc.onopen = () => handlers.onGuestOpen?.(guestUid);
      dc.onclose = () => handlers.onGuestClose?.(guestUid);
      dc.onmessage = (ev) => { let m: any; try { m = JSON.parse(ev.data); } catch { return; } handlers.onMessage?.(guestUid, m); };
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') handlers.onGuestClose?.(guestUid);
    };

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    peer.remoteSet = true;
    peer.pending.splice(0).forEach((c) => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await updateDoc(connRef, { answer: { type: answer.type, sdp: answer.sdp } }).catch(() => {});

    peer.unsubs.push(onSnapshot(guestCandidates, (s) => {
      s.docChanges().forEach((ch) => {
        if (ch.type !== 'added') return;
        const cand = ch.doc.data() as RTCIceCandidateInit;
        if (peer.remoteSet) pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        else peer.pending.push(cand);
      });
    }));
  };

  topUnsubs.push(onSnapshot(connectionsRef, (qs) => {
    qs.docChanges().forEach((ch) => {
      if (ch.type === 'removed') return;
      const data = ch.doc.data() as any;
      if (data?.offer && !peers.has(ch.doc.id)) setupPeer(ch.doc.id, data.offer).catch(() => {});
    });
  }));

  const broadcast = (obj: any) => {
    const s = JSON.stringify(obj);
    for (const p of peers.values()) { if (p.dc && p.dc.readyState === 'open') { try { p.dc.send(s); } catch {} } }
  };
  const sendTo = (guestUid: string, obj: any) => {
    const p = peers.get(guestUid);
    if (p?.dc && p.dc.readyState === 'open') { try { p.dc.send(JSON.stringify(obj)); } catch {} }
  };

  const close = () => {
    topUnsubs.forEach((u) => { try { u(); } catch {} });
    for (const p of peers.values()) { p.unsubs.forEach((u) => { try { u(); } catch {} }); try { p.dc?.close(); } catch {} try { p.pc.close(); } catch {} }
    peers.clear();
    // Best-effort room teardown.
    (async () => {
      try {
        const conns = await getDocs(connectionsRef);
        for (const c of conns.docs) {
          for (const sub of ['hostCandidates', 'guestCandidates']) {
            const cs = await getDocs(collection(c.ref, sub));
            await Promise.all(cs.docs.map((d) => deleteDoc(d.ref)));
          }
          await deleteDoc(c.ref);
        }
        const ps = await getDocs(playersRef);
        await Promise.all(ps.docs.map((d) => deleteDoc(d.ref)));
        await deleteDoc(roomRef);
      } catch {}
    })();
  };

  return {
    code, role: 'host', uid, seed, mode: opts.mode,
    broadcast, sendTo,
    updateRoom: (patch) => updateDoc(roomRef, patch as any).catch(() => {}) as Promise<void>,
    setFaction: (faction) => setDoc(doc(playersRef, uid), { faction }, { merge: true }) as Promise<void>,
    peers: () => [...peers.keys()],
    close,
  };
}

// ── Guest ───────────────────────────────────────────────────────────────────
export interface GuestHandlers {
  onOpen?: () => void;
  onClose?: () => void;
  /** A message arrived from the host (already JSON-parsed). */
  onMessage?: (data: any) => void;
  onPlayers?: (players: MatchPlayerInfo[]) => void;
  onRoom?: (room: MatchRoom) => void;
}

export interface MatchGuestController {
  code: string;
  role: 'guest';
  uid: string;
  seed: number;
  mode: MobaMode;
  host: string;
  /** Send to the host. */
  send: (obj: any) => void;
  setFaction: (faction: Faction) => Promise<void>;
  close: () => void;
}

/** Join a MOBA match by code. Returns null if the room doesn't exist. */
export async function joinMatch(rawCode: string, opts: {
  faction: Faction;
  displayName?: string;
  handlers?: GuestHandlers;
}): Promise<MatchGuestController | null> {
  const code = rawCode.toUpperCase().trim();
  const user = await ensureAnonAuth();
  const uid = user.uid;
  const roomRef = doc(db, 'matches', code);
  const snap = await getDoc(roomRef);
  if (!snap.exists()) return null;
  const room = snap.data() as any;
  const handlers = opts.handlers ?? {};

  const playersRef = collection(roomRef, 'players');
  const connRef = doc(collection(roomRef, 'connections'), uid);
  const hostCandidates = collection(connRef, 'hostCandidates');
  const guestCandidates = collection(connRef, 'guestCandidates');

  await setDoc(doc(playersRef, uid), {
    uid, faction: opts.faction, displayName: opts.displayName ?? null, isHost: false, joinedAt: Date.now(),
  });

  const unsubs: Array<() => void> = [];
  unsubs.push(onSnapshot(playersRef, (qs) => {
    const list: MatchPlayerInfo[] = qs.docs.map((d) => {
      const v = d.data() as any;
      return { uid: v.uid, faction: v.faction, displayName: v.displayName ?? undefined, isHost: !!v.isHost, joinedAt: v.joinedAt ?? 0 };
    }).sort((a, b) => a.joinedAt - b.joinedAt);
    handlers.onPlayers?.(list);
  }));
  unsubs.push(onSnapshot(roomRef, (s) => {
    const v = s.data() as any;
    if (v) handlers.onRoom?.({ code, mode: v.mode, seed: v.seed, host: v.host, phase: v.phase, winner: v.winner ?? null, createdAt: v.createdAt, open: v.open });
  }));

  const pc = new RTCPeerConnection(ICE_SERVERS);
  const dc = pc.createDataChannel('match', { ordered: true });
  dc.onopen = () => handlers.onOpen?.();
  dc.onclose = () => handlers.onClose?.();
  dc.onmessage = (ev) => { let m: any; try { m = JSON.parse(ev.data); } catch { return; } handlers.onMessage?.(m); };

  let remoteSet = false;
  const pending: RTCIceCandidateInit[] = [];
  pc.onicecandidate = (e) => { if (e.candidate) addDoc(guestCandidates, e.candidate.toJSON()).catch(() => {}); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') handlers.onClose?.();
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await setDoc(connRef, { offer: { type: offer.type, sdp: offer.sdp }, guest: uid, createdAt: Date.now() });

  // Host's answer.
  unsubs.push(onSnapshot(connRef, (s) => {
    const data = s.data() as any;
    if (data?.answer && !pc.currentRemoteDescription) {
      pc.setRemoteDescription(new RTCSessionDescription(data.answer)).then(() => {
        remoteSet = true;
        pending.splice(0).forEach((c) => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
      }).catch(() => {});
    }
  }));
  // Host ICE.
  unsubs.push(onSnapshot(hostCandidates, (s) => {
    s.docChanges().forEach((ch) => {
      if (ch.type !== 'added') return;
      const cand = ch.doc.data() as RTCIceCandidateInit;
      if (remoteSet) pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
      else pending.push(cand);
    });
  }));

  const send = (obj: any) => { if (dc.readyState === 'open') { try { dc.send(JSON.stringify(obj)); } catch {} } };
  const close = () => {
    unsubs.forEach((u) => { try { u(); } catch {} });
    try { dc.close(); } catch {}
    try { pc.close(); } catch {}
    // Best-effort: remove our slot + signaling doc so the room stays clean.
    (async () => {
      try {
        for (const sub of ['hostCandidates', 'guestCandidates']) {
          const cs = await getDocs(collection(connRef, sub));
          await Promise.all(cs.docs.map((d) => deleteDoc(d.ref)));
        }
        await deleteDoc(connRef);
        await deleteDoc(doc(playersRef, uid));
      } catch {}
    })();
  };

  return {
    code, role: 'guest', uid, seed: room.seed, mode: room.mode, host: room.host,
    send,
    setFaction: (faction) => setDoc(doc(playersRef, uid), { faction }, { merge: true }) as Promise<void>,
    close,
  };
}
