import { useEffect, useState, useCallback, useRef } from 'react';
import { useSkillStore } from '../store/skillStore';
import { auth, db, ensureAnonAuth, rtdb, rtdbHelpers } from '../services/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
function mergeProgress(base, partial) {
    return {
        ...base,
        ...partial,
        hero: partial.hero ? { ...base.hero, ...partial.hero } : base.hero,
        pet: partial.pet ? { ...base.pet, ...partial.pet } : base.pet,
        skillTokens: partial.skillTokens ? { ...base.skillTokens, ...partial.skillTokens } : base.skillTokens,
        avatar: partial.avatar ? { ...base.avatar, ...partial.avatar, parts: { ...(base.avatar?.parts || {}), ...(partial.avatar?.parts || {}) }, colors: { ...(base.avatar?.colors || {}), ...(partial.avatar?.colors || {}) } } : base.avatar,
    };
}
export function usePlayerProfile(opts = {}) {
    const { autoCreate = true } = opts;
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const saveThrottle = useRef(0);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                // Attempt anonymous auth; if disabled, wait for a non-anonymous user (Google/email)
                const user = await ensureAnonAuth();
                if (cancelled)
                    return;
                const ref = doc(db, 'players', user.uid);
                const snap = await getDoc(ref);
                if (snap.exists()) {
                    const data = snap.data();
                    const progress = {
                        heroPosition: { q: 0, r: 0 },
                        lastLogin: Date.now(),
                        hero: { level: 1, traits: [], unlockedSkillIds: [], unlockOrder: [] },
                        pet: { level: 1 },
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
                }
                else if (autoCreate) {
                    const initial = {
                        uid: user.uid,
                        email: user.email || undefined, // Save email from auth
                        displayName: user.displayName || undefined, // Save display name from auth
                        createdAt: Date.now(),
                        progress: {
                            heroPosition: { q: 0, r: 0 },
                            lastLogin: Date.now(),
                            hero: { level: 1, traits: [], unlockedSkillIds: [], unlockOrder: [] },
                            pet: { level: 1 },
                            skillTokens: { earned: 0, spent: 0, remaining: 0 },
                            avatar: { parts: {}, colors: { primary: '#00A37A', secondary: '#F5F5F5', skin: '#c58b66' }, updatedAt: Date.now() }
                        }
                    };
                    await setDoc(ref, { ...initial, createdAt: serverTimestamp() });
                    if (!cancelled)
                        setProfile(initial);
                }
                else {
                    setProfile(null);
                }
            }
            catch (e) {
                if (!cancelled)
                    setError(e.message || 'Failed to load profile');
            }
            finally {
                if (!cancelled)
                    setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [autoCreate]);
    // Migration: if user later signs in with Google/email (non-anon) and we have an anon profile loaded, copy progress over
    useEffect(() => {
        if (!profile)
            return;
        if (!auth.currentUser)
            return;
        if (!auth.currentUser.isAnonymous) {
            // Already non-anonymous; ensure profile uid matches
            if (profile.uid !== auth.currentUser.uid) {
                // Need to load new profile document (might not exist yet) and migrate old data
                (async () => {
                    const newUid = auth.currentUser.uid;
                    const newRef = doc(db, 'players', newUid);
                    const existing = await getDoc(newRef);
                    const oldData = profile.progress;
                    if (!existing.exists()) {
                        await setDoc(newRef, {
                            progress: oldData,
                            migratedFrom: profile.uid,
                            email: auth.currentUser.email,
                            displayName: auth.currentUser.displayName,
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp()
                        }, { merge: true });
                    }
                    // Remove old anonymous sessions tree
                    try {
                        await rtdbHelpers.remove(rtdbHelpers.ref(rtdb, `sessions/${profile.uid}`));
                    }
                    catch { }
                    setProfile(p => p ? { ...p, uid: newUid, email: auth.currentUser.email || p.email, displayName: auth.currentUser.displayName || p.displayName } : p);
                })();
            }
            else {
                // Update email/displayName if they've changed
                if ((auth.currentUser.email && auth.currentUser.email !== profile.email) ||
                    (auth.currentUser.displayName && auth.currentUser.displayName !== profile.displayName)) {
                    const ref = doc(db, 'players', profile.uid);
                    const updates = {
                        ...(auth.currentUser.email && { email: auth.currentUser.email }),
                        ...(auth.currentUser.displayName && { displayName: auth.currentUser.displayName }),
                        updatedAt: serverTimestamp()
                    };
                    setDoc(ref, updates, { merge: true }).catch(() => { });
                    setProfile(p => p ? { ...p, ...updates } : p);
                }
            }
        }
    }, [profile]);
    // One-time skill store hydration from profile hero progress
    const hydratedRef = useRef(false);
    useEffect(() => {
        if (!profile || hydratedRef.current)
            return;
        const hero = profile.progress.hero;
        if (hero && (hero.unlockedSkillIds?.length || hero.unlockOrder?.length || hero.level > 1)) {
            try {
                const { hydrate } = useSkillStore.getState();
                hydrate?.({
                    level: hero.level,
                    unlocked: hero.unlockedSkillIds,
                    unlockOrder: hero.unlockOrder,
                });
                hydratedRef.current = true;
            }
            catch {
                // ignore hydration errors
            }
        }
    }, [profile]);
    const saveProgress = useCallback((partial) => {
        if (!profile)
            return;
        const now = Date.now();
        if (saveThrottle.current && now - saveThrottle.current < 1500)
            return;
        saveThrottle.current = now;
        const ref = doc(db, 'players', profile.uid);
        const merged = mergeProgress({ ...profile.progress }, { ...partial, lastLogin: now });
        const next = { ...profile, progress: merged };
        setProfile(next);
        setDoc(ref, { progress: merged, updatedAt: serverTimestamp() }, { merge: true }).catch(() => { });
    }, [profile]);
    const updateProfile = useCallback((fields) => {
        if (!profile)
            return;
        const ref = doc(db, 'players', profile.uid);
        const next = { ...profile, ...fields };
        setProfile(next);
        setDoc(ref, { ...fields, updatedAt: serverTimestamp() }, { merge: true }).catch(() => { });
    }, [profile]);
    return { profile, loading, error, saveProgress, updateProfile };
}
