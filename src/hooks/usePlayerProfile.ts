import { useEffect, useState, useCallback, useReducer } from 'react';
import { useSkillStore } from '../store/skillStore';
import { auth, db, ensureAnonAuth, rtdb, rtdbHelpers } from '../services/firebase';
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
  const merged: any = { ...base, ...partial };
  // Nested objects merge field-by-field rather than being replaced wholesale — but only
  // when there's an actual value on either side. Firestore's setDoc() rejects `undefined`
  // outright, so an optional field (abilityLoadout/solo aren't part of the default new-
  // profile shape) must never end up as an explicit `key: undefined` in the merged object.
  if (partial.hero || base.hero) merged.hero = partial.hero ? { ...(base.hero as any), ...partial.hero } : base.hero;
  if (partial.pet || base.pet) merged.pet = partial.pet ? { ...(base.pet as any), ...partial.pet } : base.pet;
  if (partial.skillTokens || base.skillTokens) merged.skillTokens = partial.skillTokens ? { ...(base.skillTokens as any), ...partial.skillTokens } : base.skillTokens;
  if (partial.avatar || base.avatar) merged.avatar = partial.avatar ? { ...(base.avatar as any), ...partial.avatar, parts: { ...(base.avatar?.parts||{}), ...((partial.avatar as any)?.parts||{}) }, colors: { ...(base.avatar?.colors||{}), ...((partial.avatar as any)?.colors||{}) } } : base.avatar;
  if (partial.abilityLoadout || base.abilityLoadout) merged.abilityLoadout = partial.abilityLoadout ? { ...(base.abilityLoadout as any), ...partial.abilityLoadout } : base.abilityLoadout;
  if (partial.solo || base.solo) merged.solo = partial.solo ? { ...(base.solo as any), ...partial.solo } : base.solo;
  return merged as PlayerProgress;
}

// Recursively strips keys whose value is `undefined` (Firestore's setDoc() rejects them
// outright, crashing the write — and in this app's case, the whole 3D scene since the
// save is awaited during boot). Arrays are walked but not compacted (nulls are fine).
function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep) as unknown as T;
  }
  if (value && typeof value === 'object' && !(value as any).toDate /* skip Firestore sentinels */) {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) {
      if (v === undefined) continue;
      out[k] = stripUndefinedDeep(v);
    }
    return out;
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL SINGLETON STORE.
//
// This hook is mounted by MANY components at once (App shell, TopNav, MissionScreen,
// SoloMissionMap3D, PetPanel, useAutoSyncSkills, …). It used to give each instance its
// OWN `profile` state + `progressRef`, so every instance saved patches merged onto a
// snapshot from whenever IT mounted — and because the write sends the whole `progress`
// object, any save from a stale instance (e.g. the skill auto-sync firing on a mid-game
// level-up) overwrote hero XP / solo world / position with app-boot values. That was
// the "autosave doesn't stick" bug. Now every instance shares ONE profile, ONE
// progressRef and ONE write pipeline, so saves always merge onto the freshest state.
// ─────────────────────────────────────────────────────────────────────────────
let sharedProfile: PlayerProfile | null = null;
let sharedLoading = true;
let sharedError: string | null = null;
let loadStarted = false;
const listeners = new Set<() => void>();

const progressRef: { current: PlayerProgress | null } = { current: null };
const uidRef: { current: string | null } = { current: null };
let saveThrottleAt = 0;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let flushListenersInstalled = false;
let skillStoreHydrated = false;
const migrationHandled = new Set<string>();

function emit() { listeners.forEach(l => l()); }

function setSharedProfile(next: PlayerProfile | null) {
  sharedProfile = next;
  if (next) { progressRef.current = next.progress; uidRef.current = next.uid; }
  emit();
}

/** Persist the latest accumulated progress (bypasses throttle). Resolves once the
 *  write lands. Failures are logged — a silently-swallowed save error looks exactly
 *  like "autosave is broken", so make it visible in the console. */
function writeProgress(): Promise<void> {
  const uid = uidRef.current;
  const merged = progressRef.current;
  if (!uid || !merged) return Promise.resolve();
  saveThrottleAt = Date.now();
  return setDoc(doc(db, 'players', uid), { progress: stripUndefinedDeep(merged), updatedAt: serverTimestamp() }, { merge: true })
    .catch((e: any) => {
      // eslint-disable-next-line no-console
      console.warn('[profile] save failed:', e?.code || e?.message || e);
    });
}

function flushPendingWrite() {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
    writeProgress();
  }
}

function installFlushListeners() {
  if (flushListenersInstalled || typeof document === 'undefined') return;
  flushListenersInstalled = true;
  // Flush the throttled write when the tab hides or the page closes — otherwise up to
  // 1.5s (stacked with callers' own debounces, several seconds) of progress is lost.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPendingWrite(); });
  window.addEventListener('pagehide', flushPendingWrite);
}

function saveProgressShared(partial: ProgressPatch, opts?: { immediate?: boolean }): Promise<void> {
  if (!sharedProfile) return Promise.resolve();
  const now = Date.now();
  // Merge onto the freshest progress (progressRef is updated synchronously so rapid
  // successive saves in the same tick accumulate instead of clobbering).
  const base = progressRef.current ?? sharedProfile.progress;
  const merged = mergeProgress({ ...base }, { ...partial, lastLogin: now });
  progressRef.current = merged;
  sharedProfile = { ...sharedProfile, progress: merged };
  emit();
  // An explicit immediate save (the manual "Save Game" button, a campaign reset, a
  // tab-hide flush) always bypasses the throttle and returns the real write promise.
  if (opts?.immediate) {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    return writeProgress();
  }
  // Rate-limit the network write, but never DROP it: schedule a trailing flush
  // so the last value within a throttle window is still persisted.
  const elapsed = now - saveThrottleAt;
  if (elapsed >= 1500) {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    return writeProgress();
  }
  if (!pendingTimer) {
    return new Promise<void>((resolve) => {
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        writeProgress().then(resolve);
      }, 1500 - elapsed);
    });
  }
  return Promise.resolve();
}

function updateProfileShared(fields: Partial<Omit<PlayerProfile, 'progress' | 'uid' | 'createdAt'>>) {
  if (!sharedProfile) return;
  const ref = doc(db, 'players', sharedProfile.uid);
  setSharedProfile({ ...sharedProfile, ...fields });
  setDoc(ref, { ...fields, updatedAt: serverTimestamp() }, { merge: true })
    .catch((e: any) => { console.warn('[profile] update failed:', e?.code || e?.message || e); });
}

async function loadProfileOnce(autoCreate: boolean) {
  if (loadStarted) return;
  loadStarted = true;
  installFlushListeners();
  try {
    // Attempt anonymous auth; if disabled, wait for a non-anonymous user (Google/email)
    const user = await ensureAnonAuth();
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
      setSharedProfile({
        uid: user.uid,
        displayName: data.displayName,
        email: data.email,
        avatarUrl: data.avatarUrl,
        faction: data.faction,
        createdAt: data.createdAt || Date.now(),
        progress,
      });
    } else if (autoCreate) {
      // Only include identity fields that exist — Firestore rejects `undefined`
      // values outright (anon users have neither email nor displayName).
      const initial: PlayerProfile = {
        uid: user.uid,
        ...(user.email ? { email: user.email } : {}),
        ...(user.displayName ? { displayName: user.displayName } : {}),
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
      setSharedProfile(initial);
    } else {
      setSharedProfile(null);
    }
  } catch (e: any) {
    sharedError = e.message || 'Failed to load profile';
  } finally {
    sharedLoading = false;
    emit();
  }
}

export function usePlayerProfile(opts: UsePlayerProfileOptions = {}) {
  const { autoCreate = true } = opts;
  const [, force] = useReducer((x: number) => x + 1, 0);
  // Local mirrors so React re-renders this instance when the shared store changes.
  const [profile, setProfileLocal] = useState<PlayerProfile | null>(sharedProfile);

  useEffect(() => {
    const listener = () => { setProfileLocal(sharedProfile); force(); };
    listeners.add(listener);
    // Keep in sync in case the store changed between render and effect.
    listener();
    loadProfileOnce(autoCreate);
    return () => { listeners.delete(listener); };
  }, [autoCreate]);

  // Migration: if user later signs in with Google/email (non-anon) and we have an anon
  // profile loaded, copy progress over. Module-guarded so only one instance migrates.
  useEffect(() => {
    if (!profile) return;
    if (!auth.currentUser) return;
    if (auth.currentUser.isAnonymous) return;
    const key = `${profile.uid}->${auth.currentUser.uid}`;
    if (migrationHandled.has(key)) return;
    migrationHandled.add(key);
    if (profile.uid !== auth.currentUser.uid) {
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
        setSharedProfile(sharedProfile ? { ...sharedProfile, uid: newUid, email: auth.currentUser!.email || sharedProfile.email, displayName: auth.currentUser!.displayName || sharedProfile.displayName } : sharedProfile);
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
        setSharedProfile(sharedProfile ? { ...sharedProfile, ...updates } as PlayerProfile : sharedProfile);
      }
    }
  }, [profile]);

  // One-time skill store hydration from profile hero progress (module-guarded — with
  // many hook instances mounted, only the first successful hydration should run).
  useEffect(() => {
    if (!profile || skillStoreHydrated) return;
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
        skillStoreHydrated = true;
      } catch {
        // ignore hydration errors
      }
    }
  }, [profile]);

  const saveProgress = useCallback((partial: ProgressPatch, opts2?: { immediate?: boolean }): Promise<void> => {
    return saveProgressShared(partial, opts2);
  }, []);

  const updateProfile = useCallback((fields: Partial<Omit<PlayerProfile, 'progress' | 'uid' | 'createdAt'>>) => {
    updateProfileShared(fields);
  }, []);

  return { profile, loading: sharedLoading, error: sharedError, saveProgress, updateProfile };
}
