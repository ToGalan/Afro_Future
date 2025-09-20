import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureAnonAuth, rtdb, rtdbHelpers, auth } from '../services/firebase';
import { PlayerSession } from '../types/player';
import { onValue } from 'firebase/database';

// Session update throttling base intervals (ms)
const POSITION_INTERVAL_FAST = 120;   // ~8 updates/sec during active movement
const POSITION_INTERVAL_SLOW = 500;   // Idle but visible
const POSITION_INTERVAL_HIDDEN = 1500; // Tab hidden / unfocused
const MAX_STALE_POSITION_AGE = 5000;  // Force a refresh at least every 5s
const RECENT_MOVEMENT_WINDOW = 2000;  // Time window to consider player as actively moving
const HEARTBEAT_INTERVAL = 25000;     // 25s heartbeat

function generateSessionId() {
  return Math.random().toString(36).slice(2, 12);
}

export interface UsePlayerSession {
  session: PlayerSession | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
  syncing: boolean;
  lastSync: number | null;
  updateHeroPosition: (pos: { q: number; r: number }) => void;
}

export function usePlayerSession(): UsePlayerSession {
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const lastPosWrite = useRef(0);
  const lastMovementTime = useRef(0);
  const lastSentPos = useRef<{q:number; r:number}|null>(null);
  const heartbeatTimer = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await ensureAnonAuth();
        if (cancelled) return;
        const sessionId = generateSessionId();
        sessionIdRef.current = sessionId;
        const basePath = `sessions/${user.uid}/${sessionId}`;
        const sessionRef = rtdbHelpers.ref(rtdb, basePath);

        const providerData = (auth.currentUser?.providerData||[]).map(p=>({ providerId: p.providerId, uid: p.uid, email: p.email, displayName: p.displayName }));
        const initial: PlayerSession = {
          sessionId,
          uid: user.uid,
          heroPosition: { q: 0, r: 0 },
          lastActive: Date.now(),
          connected: true,
          startedAt: Date.now(),
        };
        try {
          await rtdbHelpers.set(sessionRef, {
            ...initial,
            // Enhanced metadata if non-anonymous
            isAnonymous: !!user.isAnonymous,
            displayName: user.displayName || user.email || null,
            email: user.email || null,
            providerData,
          });
        } catch(err:any) {
          // eslint-disable-next-line no-console
          console.error('[session:init] RTDB set failed', err?.code, err?.message, err);
          throw err;
        }

        // Presence teardown using onDisconnect
        const connRef = rtdbHelpers.ref(rtdb, `${basePath}/connected`);
        const lastActiveRef = rtdbHelpers.ref(rtdb, `${basePath}/lastActive`);
        rtdbHelpers.onDisconnect(connRef).set(false);
        rtdbHelpers.onDisconnect(lastActiveRef).set(Date.now());

        // Listen for our own session (round-trip)
        onValue(sessionRef, snap => {
          if (!snap.exists()) return; // might have been cleaned up
          const data = snap.val() as PlayerSession;
            setSession(data);
        });

        // Heartbeat updater
        const hb = () => {
          const u = auth.currentUser;
          rtdbHelpers.update(sessionRef, { lastActive: Date.now(), connected: true, isAnonymous: !!u?.isAnonymous }).catch(()=>{});
          heartbeatTimer.current = window.setTimeout(hb, HEARTBEAT_INTERVAL);
        };
        heartbeatTimer.current = window.setTimeout(hb, HEARTBEAT_INTERVAL);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to init session');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      if (heartbeatTimer.current) window.clearTimeout(heartbeatTimer.current);
    };
  }, []);

  // Upgrade metadata if user transitions from anonymous to non-anonymous during session
  useEffect(() => {
    if (!session) return;
    const u = auth.currentUser;
    if (!u || u.isAnonymous) return;
    if ((session as any).providerData && Array.isArray((session as any).providerData) && (session as any).providerData.length > 0) return; // already enriched
    // Push provider enriched data once
    const providerData = (u.providerData||[]).map(p=>({ providerId: p.providerId, uid: p.uid, email: p.email, displayName: p.displayName }));
    const sessionRef = rtdbHelpers.ref(rtdb, `sessions/${session.uid}/${session.sessionId}`);
    rtdbHelpers.update(sessionRef, {
      displayName: u.displayName || u.email || null,
      email: u.email || null,
      isAnonymous: false,
      providerData,
      upgradedAt: Date.now(),
    }).catch(err => {
      // eslint-disable-next-line no-console
      console.error('[session:upgrade] update failed', err?.code, err?.message);
    });
  }, [session?.uid, session?.sessionId]);

  const updateHeroPosition = useCallback((pos: { q: number; r: number }) => {
    if (!session || !sessionIdRef.current) return;
    const now = Date.now();

    // Determine if position actually changed
    const prev = lastSentPos.current;
    const changed = !prev || prev.q !== pos.q || prev.r !== pos.r;

    // Track movement time only if changed
    if (changed) {
      lastMovementTime.current = now;
    }

    // Decide dynamic interval
    let interval = POSITION_INTERVAL_SLOW;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (hidden) {
      interval = POSITION_INTERVAL_HIDDEN;
    } else if (now - lastMovementTime.current < RECENT_MOVEMENT_WINDOW) {
      interval = POSITION_INTERVAL_FAST; // active movement
    }

    // Force refresh if stale even without movement
    const stale = now - lastPosWrite.current > MAX_STALE_POSITION_AGE;

    // Skip if interval not elapsed AND not stale
    if (!stale && (now - lastPosWrite.current) < interval) return;

    // If no change and not stale, skip
    if (!changed && !stale) return;

    lastPosWrite.current = now;
    lastSentPos.current = pos;
    setSyncing(true);
    const sessionRef = rtdbHelpers.ref(rtdb, `sessions/${session.uid}/${session.sessionId}`);
    rtdbHelpers.update(sessionRef, { heroPosition: pos, lastActive: now, connected: true })
      .then(() => { setLastSync(Date.now()); })
      .catch(err => {
        // eslint-disable-next-line no-console
        console.error('[session:position] update failed', err?.code, err?.message);
        setError(err.message || 'position update failed');
      })
      .finally(() => setSyncing(false));
  }, [session]);

  return {
    session,
    loading,
    error,
    connected: !!session?.connected,
    syncing,
    lastSync,
    updateHeroPosition,
  };
}
