import { useEffect, useState, useCallback, useRef } from 'react';
import { useSkillStore } from '../store/skillStore';
import { auth, db, ensureAnonAuth, ensureUserAuth, rtdb, rtdbHelpers } from '../services/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import type { PlayerProfile, PlayerProgress } from '../types/player';

interface UsePlayerProfileOptions {
  autoCreate?: boolean;
}

function mergeProgress(base: PlayerProgress, partial: Partial<PlayerProgress>): PlayerProgress {
  return {
    ...base,
    ...partial,
    hero: partial.hero ? { ...base.hero, ...partial.hero } : base.hero,
    pet: partial.pet ? { ...base.pet, ...partial.pet } : base.pet,
    skillTokens: partial.skillTokens ? { ...base.skillTokens, ...partial.skillTokens } : base.skillTokens,
    avatar: partial.avatar ? { ...base.avatar, ...partial.avatar, parts: { ...(base.avatar?.parts||{}), ...(partial.avatar?.parts||{}) }, colors: { ...(base.avatar?.colors||{}), ...(partial.avatar?.colors||{}) } } : base.avatar,
  };
}

export function usePlayerProfile(opts: UsePlayerProfileOptions = {}) {
  const { autoCreate = true } = opts;
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveThrottle = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Wait for any auth user. If anonymous, still proceed so early gameplay works; will migrate later
        const user = await ensureAnonAuth();
        if (cancelled) return;
        const ref = doc(db, 'players', user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() as any;
          const progress: PlayerProgress = {
            heroPosition: { q: 0, r: 0 },
            lastLogin: Date.now(),
            hero: { level: 1, traits: [], unlockedSkillIds: [], unlockOrder: [] },
            pet: { level: 1 },
            skillTokens: { earned: 0, spent: 0, remaining: 0 },
            avatar: { parts: {}, colors: { primary:'#00A37A', secondary:'#F5F5F5', skin:'#c58b66' }, updatedAt: Date.now() },
            ...data.progress,
          };
          setProfile({ uid: user.uid, displayName: data.displayName, avatarUrl: data.avatarUrl, faction: data.faction, createdAt: data.createdAt || Date.now(), progress });
        } else if (autoCreate) {
          const initial: PlayerProfile = {
            uid: user.uid,
            createdAt: Date.now(),
            progress: {
              heroPosition: { q: 0, r: 0 },
              lastLogin: Date.now(),
              hero: { level:1, traits:[], unlockedSkillIds:[], unlockOrder:[] },
              pet: { level:1 },
              skillTokens: { earned:0, spent:0, remaining:0 },
              avatar: { parts:{}, colors:{ primary:'#00A37A', secondary:'#F5F5F5', skin:'#c58b66' }, updatedAt: Date.now() }
            }
          };
          await setDoc(ref, { ...initial, createdAt: serverTimestamp() });
          if (!cancelled) setProfile(initial);
        } else {
          setProfile(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [autoCreate]);

  // Migration: if user later signs in with Google/email (non-anon) and we have an anon profile loaded, copy progress over
  useEffect(() => {
    if (!profile) return;
    if (!auth.currentUser) return;
    if (!auth.currentUser.isAnonymous) {
      // Already non-anonymous; ensure profile uid matches
      if (profile.uid !== auth.currentUser.uid) {
        // Need to load new profile document (might not exist yet) and migrate old data
        (async () => {
          const newUid = auth.currentUser!.uid;
          const newRef = doc(db, 'players', newUid);
          const existing = await getDoc(newRef);
            const oldData = profile.progress;
            if (!existing.exists()) {
              await setDoc(newRef, { progress: oldData, migratedFrom: profile.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
            }
            // Remove old anonymous sessions tree
            try {
              await rtdbHelpers.remove(rtdbHelpers.ref(rtdb, `sessions/${profile.uid}`));
            } catch {}
            setProfile(p => p ? { ...p, uid: newUid } : p);
        })();
      }
    }
  }, [profile]);

  // One-time skill store hydration from profile hero progress
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!profile || hydratedRef.current) return;
    const hero = profile.progress.hero;
    if (hero && (hero.unlockedSkillIds?.length || hero.unlockOrder?.length || hero.level > 1)) {
      try {
        const { hydrate } = useSkillStore.getState() as any;
        hydrate?.({
          level: hero.level,
          unlocked: hero.unlockedSkillIds,
          unlockOrder: hero.unlockOrder,
        });
        hydratedRef.current = true;
      } catch {
        // ignore hydration errors
      }
    }
  }, [profile]);

  const saveProgress = useCallback((partial: Partial<PlayerProfile['progress']>) => {
    if (!profile) return;
    const now = Date.now();
    if (saveThrottle.current && now - saveThrottle.current < 1500) return;
    saveThrottle.current = now;
    const ref = doc(db, 'players', profile.uid);
    const merged = mergeProgress({ ...profile.progress }, { ...partial, lastLogin: now });
    const next: PlayerProfile = { ...profile, progress: merged };
    setProfile(next);
    setDoc(ref, { progress: merged, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {/* swallow */});
  }, [profile]);

  const updateProfile = useCallback((fields: Partial<Omit<PlayerProfile, 'progress' | 'uid' | 'createdAt'>>) => {
    if (!profile) return;
    const ref = doc(db, 'players', profile.uid);
    const next: PlayerProfile = { ...profile, ...fields };
    setProfile(next);
    setDoc(ref, { ...fields, updatedAt: serverTimestamp() }, { merge: true }).catch(()=>{});
  }, [profile]);

  return { profile, loading, error, saveProgress, updateProfile };
}
