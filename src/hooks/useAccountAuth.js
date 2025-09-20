import { useCallback, useEffect, useState } from 'react';
import { auth, ensureAnonAuth } from '../services/firebase';
import { GoogleAuthProvider, signInWithPopup, linkWithPopup, signOut, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, linkWithCredential, EmailAuthProvider } from 'firebase/auth';
export function useAccountAuth() {
    const [user, setUser] = useState(auth.currentUser);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, u => { setUser(u); setLoading(false); });
        // Do not force anonymous sign-in on mount; some environments disable it.
        // The flow will proceed when user clicks Google sign-in or another provider.
        return () => unsub();
    }, []);
    const linkWithGoogle = useCallback(async () => {
        // If no user, Firebase will create one as part of link flow, but we avoid forcing anonymous sign-in.
        try {
            setError(null);
            const provider = new GoogleAuthProvider();
            await linkWithPopup(auth.currentUser, provider);
        }
        catch (e) {
            if (e.code === 'auth/credential-already-in-use') {
                // Fallback: sign in instead (merging not automatic without backend)
                await signInWithPopup(auth, new GoogleAuthProvider());
            }
            else {
                setError(e.message || 'Google link failed');
            }
        }
    }, []);
    const signInGoogle = useCallback(async () => {
        try {
            setError(null);
            await signInWithPopup(auth, new GoogleAuthProvider());
        }
        catch (e) {
            setError(e.message || 'Google sign-in failed');
        }
    }, []);
    const signOutUser = useCallback(async () => {
        try {
            await signOut(auth);
        }
        catch (e) {
            setError(e.message);
        }
    }, []);
    const signInEmail = useCallback(async (email, password) => {
        try {
            setError(null);
            await signInWithEmailAndPassword(auth, email, password);
        }
        catch (e) {
            setError(e.message || 'Email sign-in failed');
        }
    }, []);
    const registerEmail = useCallback(async (email, password) => {
        try {
            setError(null);
            await createUserWithEmailAndPassword(auth, email, password);
        }
        catch (e) {
            setError(e.message || 'Email registration failed');
        }
    }, []);
    const linkEmail = useCallback(async (email, password) => {
        try {
            if (!auth.currentUser)
                await ensureAnonAuth();
            const cred = EmailAuthProvider.credential(email, password);
            await linkWithCredential(auth.currentUser, cred);
        }
        catch (e) {
            setError(e.message || 'Email link failed');
        }
    }, []);
    return {
        user,
        loading,
        error,
        linkWithGoogle,
        signInGoogle,
        signOutUser,
        signInEmail,
        registerEmail,
        linkEmail,
        isAnonymous: !!user?.isAnonymous,
    };
}
