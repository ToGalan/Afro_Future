import { useEffect, useState, useCallback, useRef } from 'react';
import { useSkillStore } from '../store/skillStore';
import { auth, db, ensureAnonAuth, ensureUserAuth, rtdb, rtdbHelpers } from '../services/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import type { PlayerProfile, PlayerProgress } from '../types/player';

interface UsePlayerProfileOptions {
  autoCreate?: boolean;
}

// Deep-partial patch: each nested object (hero, pet, skillTokens, …) can be updated
// field-by-field. Crucial so e.g. a skill save can send hero.{traits,unlockedSkillIds}
// WITHOUT re-supplying hero.xp/level (which would clobber the XP system's values).
export type ProgressPatch =
  Partial<Omit<PlayerProgress, 'hero' | 'pet' | 'skillTokens' | 'avatar' | 'abilityLoadout' | 'solo'>> & {
    hero?: Partial<NonNullable<PlayerProgress['hero']>>;
    pet?: Partial<NonNullable<PlayerProgress['pet']>>;
    skillTokens?: Partial<NonNullable<PlayerProgress['skillTokens']>>;
    avatar?: Partial<NonNullable<PlayerProgress['avatar']>>;
    abilityLoadout?: Partial<NonNullable<PlayerProgress['abilityLoadout']>>;
    solo?: Partial<NonNullable<PlayerProgress['solo']>>;
  };

function mergeProgress(base: PlayerProgress, partial: ProgressPatch): PlayerProgress {
  return {
    ...base,
    ...partial,
    hero: partial.hero ? { ...(base.hero as any), ...partial.hero } : base.hero,
    pet: partial.pet ? { ...(base.pet as any), ...partial.pet } : base.pet,
    skillTokens: partial.skillTokens ? { ...(base.skillTokens as any), ...partial.skillTokens } : base.skillTokens,
    avatar: partial.avatar ? { ...(base.avatar as any), ...partial.avatar, parts: { ...(base.avatar?.parts||{}), ...((partial.avatar as any)?.parts||{}) }, colors: { ...(base.avatar?.colors||{}), ...((partial.avatar as any)?.colors||{}) } } : base.avatar,
    abilityLoadout: partial.abilityLoadout ? { ...(base.abilityLoadout as any), ...partial.abilityLoadout } : base.abilityLoadout,
    solo: partial.solo ? { ...(base.solo as any), ...partial.solo } : base.solo,
  } as PlayerProgress;
}

export function usePlayerProfile(opts: UsePlayerProfileOptions = {}) {
  const { autoCreate = true } = opts;
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveThrottle = useRef<number>(0);
  // Trailing-flush throttle state: the network write is rate-limited, but local
  // state is ALWAYS updated and the latest value is eventually persisted.
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRef = useRef<PlayerProgress | null>(null);
  const uidRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Attempt anonymous auth; if disabled, wait for a non-anonymous user (Google/email)
        const user = await ensureAnonAuth();
        if (cancelled) return;
        const ref = doc(db, 'players', user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() as any;
          const progress: PlayerProgress = {
            heroPosition: { q: 0, r: 0 },
            lastLogin: Date.now(),
            hero: { level: 1, xp: 0, traits: [], unlockedSkillIds: [], unlockOrder: [] },
            pet: { level: 1, xp: 0 },
            skillTokens: { earned: 0, spent: 0, remaining: 0 },
            avatar: { parts: {}, colors: { primary:'#00A37A', secondary:'#F5F5F5', skin:'#c58b66' }, updatedAt: Date.now() },
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
        } else if (autoCreate) {
          const initial: PlayerProfile = {
            uid: user.uid,
            email: user.email || undefined,  // Save email from auth
            displayName: user.displayName || undefined, // Save display name from auth
            createdAt: Date.now(),
            progress: {
              heroPosition: { q: 0, r: 0 },
              lastLogin: Date.now(),
              hero: { level:1, traits:[], unlockedSkillIds:[], unlockOrder:[], xp: 0 },
              pet: { level:1, xp: 0 },
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

  // Persist the latest accumulated progress to Firestore (bypasses throttle).
  const writeProgress = useCallback(() => {
    const uid = uidRef.current;
    const merged = progressRef.current;
    if (!uid || !merged) return;
    saveThrottle.current = Date.now();
    setDoc(doc(db, 'players', uid), { progress: merged, updatedAt: serverTimestamp() }, { merge: true })
      .catch(() => {/* swallow */});
  }, []);

  const saveProgress = useCallback((partial: ProgressPatch) => {
    if (!profile) return;
    const now = Date.now();
    // Merge onto the freshest progress (progressRef is updated synchronously so
    // rapid successive saves in the same tick accumulate instead of clobbering).
    const base = progressRef.current ?? profile.progress;
    const merged = mergeProgress({ ...base }, { ...partial, lastLogin: now });
    progressRef.current = merged;
    uidRef.current = profile.uid;
    // Always update local state immediately so the UI (and profileRef consumers
    // such as useCollectibles) reflect the new XP without waiting on the throttle.
    setProfile(prev => (prev ? { ...prev, progress: merged } : prev));
    // Rate-limit the network write, but never DROP it: schedule a trailing flush
    // so the last value within a throttle window is still persisted.
    const elapsed = now - saveThrottle.current;
    if (elapsed >= 1500) {
      if (pendingTimer.current) { clearTimeout(pendingTimer.current); pendingTimer.current = null; }
      writeProgress();
    } else if (!pendingTimer.current) {
      pendingTimer.current = setTimeout(() => {
        pendingTimer.current = null;
        writeProgress();
      }, 1500 - elapsed);
    }
  }, [profile, writeProgress]);

  // Keep progressRef aligned with externally-driven profile changes, and flush
  // any pending write on unmount so in-flight XP isn't lost.
  useEffect(() => { if (profile) { progressRef.current = profile.progress; uidRef.current = profile.uid; } }, [profile]);
  useEffect(() => () => {
    if (pendingTimer.current) {
      clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
      writeProgress();
    }
  }, [writeProgress]);

  const updateProfile = useCallback((fields: Partial<Omit<PlayerProfile, 'progress' | 'uid' | 'createdAt'>>) => {
    if (!profile) return;
    const ref = doc(db, 'players', profile.uid);
    const next: PlayerProfile = { ...profile, ...fields };
    setProfile(next);
    setDoc(ref, { ...fields, updatedAt: serverTimestamp() }, { merge: true }).catch(()=>{});
  }, [profile]);

  return { profile, loading, error, saveProgress, updateProfile };
}
