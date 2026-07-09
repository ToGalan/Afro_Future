/**
 * duelSignaling — serverless WebRTC signaling over Firestore (no signaling server).
 *
 * A duel "room" is a Firestore doc under `duels/{code}` holding the host's SDP offer
 * and the guest's SDP answer, with ICE candidates in two subcollections
 * (`hostCandidates`, `guestCandidates`). Both peers listen via onSnapshot, so the
 * offer/answer/ICE handshake completes with only Firebase — nothing to host.
 *
 * Host creates the room + the data channel; guest joins by code and receives the
 * channel via `pc.ondatachannel`. Once connected, all game traffic flows P2P over the
 * data channel and Firestore is no longer touched.
 */
import {
  doc, collection, setDoc, updateDoc, getDoc, onSnapshot, addDoc, deleteDoc, getDocs,
  query, where, limit, runTransaction,
} from 'firebase/firestore';
import { db } from './firebase';

// Open matchmaking rooms older than this are treated as abandoned and skipped.
const STALE_MS = 60_000;

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export interface DuelConnection {
  code: string;
  pc: RTCPeerConnection;
  /** Resolves with the data channel once it is available (created or received). */
  channel: Promise<RTCDataChannel>;
  role: 'host' | 'guest';
  close: () => void;
}

// Short, human-shareable room code (avoids ambiguous chars).
function makeCode(len = 5): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/**
 * Host a duel — creates the room doc and returns the code to share.
 * `open: true` publishes it to the matchmaking queue (Find Opponent); the default
 * (false) keeps it a private, code-only room.
 */
export async function hostDuel(open = false): Promise<DuelConnection> {
  const code = makeCode();
  const roomRef = doc(db, 'duels', code);
  const pc = new RTCPeerConnection(ICE_SERVERS);
  const dc = pc.createDataChannel('duel', { ordered: true });

  const unsubs: Array<() => void> = [];
  const hostCandidates = collection(roomRef, 'hostCandidates');
  const guestCandidates = collection(roomRef, 'guestCandidates');

  pc.onicecandidate = (e) => {
    if (e.candidate) addDoc(hostCandidates, e.candidate.toJSON()).catch(() => {});
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await setDoc(roomRef, {
    offer: { type: offer.type, sdp: offer.sdp },
    createdAt: Date.now(),
    open,
  });

  // ICE candidates that arrive before the remote description (answer) is applied must be
  // buffered — addIceCandidate() throws otherwise and the connection can silently fail.
  let remoteSet = false;
  const pending: RTCIceCandidateInit[] = [];
  const addOrQueue = (cand: RTCIceCandidateInit) => {
    if (remoteSet) pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
    else pending.push(cand);
  };

  // Listen for the guest's answer.
  unsubs.push(onSnapshot(roomRef, (snap) => {
    const data = snap.data();
    if (data?.answer && !pc.currentRemoteDescription) {
      pc.setRemoteDescription(new RTCSessionDescription(data.answer))
        .then(() => {
          remoteSet = true;
          pending.splice(0).forEach((c) => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
        })
        .catch(() => {});
      // Opponent found — drop out of the matchmaking queue.
      if (open) updateDoc(roomRef, { open: false }).catch(() => {});
    }
  }));
  // Listen for the guest's ICE candidates (buffered until the answer is set).
  unsubs.push(onSnapshot(guestCandidates, (snap) => {
    snap.docChanges().forEach((ch) => {
      if (ch.type === 'added') addOrQueue(ch.doc.data() as RTCIceCandidateInit);
    });
  }));

  const channel = Promise.resolve(dc);

  const close = () => {
    unsubs.forEach((u) => { try { u(); } catch {} });
    try { dc.close(); } catch {}
    try { pc.close(); } catch {}
    // Best-effort room cleanup.
    (async () => {
      try {
        for (const sub of ['hostCandidates', 'guestCandidates']) {
          const qs = await getDocs(collection(roomRef, sub));
          await Promise.all(qs.docs.map((d) => deleteDoc(d.ref)));
        }
        await deleteDoc(roomRef);
      } catch {}
    })();
  };

  return { code, pc, channel, role: 'host', close };
}

/** Join a duel by its code. Returns null if the room doesn't exist. */
export async function joinDuel(code: string): Promise<DuelConnection | null> {
  const roomRef = doc(db, 'duels', code.toUpperCase().trim());
  const snap = await getDoc(roomRef);
  if (!snap.exists() || !snap.data()?.offer) return null;

  const pc = new RTCPeerConnection(ICE_SERVERS);
  const unsubs: Array<() => void> = [];
  const hostCandidates = collection(roomRef, 'hostCandidates');
  const guestCandidates = collection(roomRef, 'guestCandidates');

  pc.onicecandidate = (e) => {
    if (e.candidate) addDoc(guestCandidates, e.candidate.toJSON()).catch(() => {});
  };

  // Guest receives the channel the host created.
  const channel = new Promise<RTCDataChannel>((resolve) => {
    pc.ondatachannel = (e) => resolve(e.channel);
  });

  await pc.setRemoteDescription(new RTCSessionDescription(snap.data()!.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await updateDoc(roomRef, { answer: { type: answer.type, sdp: answer.sdp } });

  // Listen for the host's ICE candidates.
  unsubs.push(onSnapshot(hostCandidates, (s) => {
    s.docChanges().forEach((ch) => {
      if (ch.type === 'added') pc.addIceCandidate(new RTCIceCandidate(ch.doc.data() as any)).catch(() => {});
    });
  }));

  const close = () => {
    unsubs.forEach((u) => { try { u(); } catch {} });
    try { pc.close(); } catch {}
  };

  return { code: code.toUpperCase().trim(), pc, channel, role: 'guest', close };
}

/**
 * Try to atomically claim a fresh open room from the matchmaking queue. Uses a
 * transaction so two searchers can't both grab the same host. Returns the room code
 * to join, or null if none is available.
 */
async function claimOpenRoom(): Promise<string | null> {
  const q = query(collection(db, 'duels'), where('open', '==', true), limit(10));
  const qs = await getDocs(q);
  const now = Date.now();
  const candidates = qs.docs.filter((d) => {
    const data = d.data() as any;
    return data.open === true && !data.answer && now - (data.createdAt || 0) < STALE_MS;
  });
  for (const cand of candidates) {
    try {
      const ok = await runTransaction(db, async (tx) => {
        const fresh = await tx.get(cand.ref);
        const data = fresh.data() as any;
        if (!fresh.exists() || !data?.open || data?.answer) return false; // taken since we read it
        tx.update(cand.ref, { open: false }); // claim it
        return true;
      });
      if (ok) return cand.id;
    } catch { /* contested — try the next candidate */ }
  }
  return null;
}

/**
 * Quick-match: pair with any waiting player. Claims an open room if one exists (join
 * as guest); otherwise publishes your own open room and waits for someone to claim it.
 */
export async function findOpponent(): Promise<DuelConnection> {
  const code = await claimOpenRoom();
  if (code) {
    const conn = await joinDuel(code);
    if (conn) return conn;
    // The host vanished between claim and join — fall through to hosting our own.
  }
  return hostDuel(true);
}

/** Live count of players currently waiting in the matchmaking queue. */
export function watchOpenRooms(cb: (count: number) => void): () => void {
  const q = query(collection(db, 'duels'), where('open', '==', true), limit(25));
  return onSnapshot(q, (qs) => {
    const now = Date.now();
    const n = qs.docs.filter((d) => {
      const data = d.data() as any;
      return data.open === true && !data.answer && now - (data.createdAt || 0) < STALE_MS;
    }).length;
    cb(n);
  }, () => cb(0));
}
