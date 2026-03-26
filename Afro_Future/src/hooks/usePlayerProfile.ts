import { useEffect, useState, useCallback, useRef } from 'react';
import { useSkillStore } from '../store/skillStore';
import { auth, db, ensureAnonAuth, ensureUserAuth, rtdb, rtdbHelpers } from '../services/firebase';
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
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
    abilityLoadout: partial.abilityLoadout ? { ...base.abilityLoadout, ...partial.abilityLoadout } : base.abilityLoadout,
  };
}

export function usePlayerProfile(opts: UsePlayerProfileOptions = {}) {
  const { autoCreate = true } = opts;
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveThrottle = useRef<number>(0);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        // Attempt anonymous auth; if disabled, wait for a non-anonymous user (Google/email)
        const user = await ensureAnonAuth();
        if (cancelled) return;
        const ref = doc(db, 'players', user.uid);

        // One-time read to handle the auto-create case before subscribing.
        const snap = await getDoc(ref);
        if (cancelled) return;

        if (!snap.exists()) {
          if (!autoCreate) {
            setProfile(null);
            setLoading(false);
            return;
          }
          const initial: PlayerProfile = {
            uid: user.uid,
            email: user.email || undefined,
            displayName: user.displayName || undefined,
            createdAt: Date.now(),
            progress: {
              heroPosition: { q: 0, r: 0 },
              lastLogin: Date.now(),
              hero: { level: 1, traits: [], unlockedSkillIds: [], unlockOrder: [], xp: 0 },
              pet: { level: 1, xp: 0 },
              skillTokens: { earned: 0, spent: 0, remaining: 0 },
              avatar: { parts: {}, colors: { primary: '#00A37A', secondary: '#F5F5F5', skin: '#c58b66' }, updatedAt: Date.now() }
            }
          };
          await setDoc(ref, { ...initial, createdAt: serverTimestamp() });
          if (cancelled) return;
        }

        // Real-time listener: keeps ALL hook instances in sync whenever Firestore
        // is updated (saveProgress, updateDoc force-flushes, etc.).
        unsub = onSnapshot(ref, (docSnap) => {
          if (cancelled || !docSnap.exists()) return;
          const data = docSnap.data() as any;
          const progress: PlayerProgress = {
            heroPosition: { q: 0, r: 0 },
            lastLogin: Date.now(),
            hero: { level: 1, xp: 0, traits: [], unlockedSkillIds: [], unlockOrder: [] },
            pet: { level: 1, xp: 0 },
            skillTokens: { earned: 0, spent: 0, remaining: 0 },
            avatar: { parts: {}, colors: { primary: '#00A37A', secondary: '#F5F5F5', skin: '#c58b66' }, updatedAt: Date.now() },
            ...data.progress,
          };
          setProfile({
            uid: user.uid,
            displayName: data.displayName,
            email: data.email,
            avatarUrl: data.avatarUrl,
            faction: data.faction,
            createdAt: data.createdAt || Date.now(),
            progress
          });
          setLoading(false);
        }, (err) => {
          if (!cancelled) setError(err.message || 'Realtime listener failed');
          if (!cancelled) setLoading(false);
        });
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load profile');
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; unsub?.(); };
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
              await setDoc(newRef, { 
                progress: oldData, 
                migratedFrom: profile.uid, 
                email: auth.currentUser!.email,
                displayName: auth.currentUser!.displayName,
                createdAt: serverTimestamp(), 
                updatedAt: serverTimestamp() 
              }, { merge: true });
            }
            // Remove old anonymous sessions tree
            try {
              await rtdbHelpers.remove(rtdbHelpers.ref(rtdb, `sessions/${profile.uid}`));
            } catch {}
            setProfile(p => p ? { ...p, uid: newUid, email: auth.currentUser!.email || p.email, displayName: auth.currentUser!.displayName || p.displayName } : p);
        })();
      } else {
        // Update email/displayName if they've changed
        if ((auth.currentUser.email && auth.currentUser.email !== profile.email) || 
            (auth.currentUser.displayName && auth.currentUser.displayName !== profile.displayName)) {
          const ref = doc(db, 'players', profile.uid);
          const updates = {
            ...(auth.currentUser.email && { email: auth.currentUser.email }),
            ...(auth.currentUser.displayName && { displayName: auth.currentUser.displayName }),
            updatedAt: serverTimestamp()
          };
          setDoc(ref, updates, { merge: true }).catch(() => {});
          setProfile(p => p ? { ...p, ...updates } : p);
        }
      }
    }
  }, [profile]);

  // One-time skill store hydration from profile hero progress
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!profile || hydratedRef.current) return;
    const hero = profile.progress.hero;
    const hasSkillData = hero && (hero.unlockedSkillIds?.length || hero.unlockOrder?.length || hero.level > 1);
    const hasAbilityLoadout = profile.progress.abilityLoadout;
    if (hasSkillData || hasAbilityLoadout) {
      try {
        const { hydrate } = useSkillStore.getState() as any;
        hydrate?.({
          level: hero?.level,
          unlocked: hero?.unlockedSkillIds,
          unlockOrder: hero?.unlockOrder,
          abilityLoadout: hasAbilityLoadout ? profile.progress.abilityLoadout : undefined,
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
