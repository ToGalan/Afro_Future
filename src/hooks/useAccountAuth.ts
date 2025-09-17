import { useCallback, useEffect, useState } from 'react';
import { auth, ensureAnonAuth } from '../services/firebase';
import { GoogleAuthProvider, signInWithPopup, linkWithPopup, signOut, onAuthStateChanged, User, signInWithEmailAndPassword, createUserWithEmailAndPassword, linkWithCredential, EmailAuthProvider } from 'firebase/auth';

interface AccountAuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  linkWithGoogle: () => Promise<void>;
  signInGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  registerEmail: (email: string, password: string) => Promise<void>;
  linkEmail: (email: string, password: string) => Promise<void>;
  isAnonymous: boolean;
}

export function useAccountAuth(): AccountAuthState {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => { setUser(u); setLoading(false); });
    // Ensure at least anonymous user exists
    ensureAnonAuth().catch(e => setError(e.message));
    return () => unsub();
  }, []);

  const linkWithGoogle = useCallback(async () => {
    if (!auth.currentUser) await ensureAnonAuth();
    try {
      setError(null);
      const provider = new GoogleAuthProvider();
      await linkWithPopup(auth.currentUser!, provider);
    } catch (e: any) {
      if (e.code === 'auth/credential-already-in-use') {
        // Fallback: sign in instead (merging not automatic without backend)
        await signInWithPopup(auth, new GoogleAuthProvider());
      } else {
        setError(e.message || 'Google link failed');
      }
    }
  }, []);

  const signInGoogle = useCallback(async () => {
    try {
      setError(null);
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e: any) {
      setError(e.message || 'Google sign-in failed');
    }
  }, []);

  const signOutUser = useCallback(async () => {
    try { await signOut(auth); } catch (e:any) { setError(e.message); }
  }, []);

  const signInEmail = useCallback(async (email: string, password: string) => {
    try {
      setError(null);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e:any) { setError(e.message || 'Email sign-in failed'); }
  }, []);

  const registerEmail = useCallback(async (email: string, password: string) => {
    try { setError(null); await createUserWithEmailAndPassword(auth, email, password); } catch (e:any) { setError(e.message || 'Email registration failed'); }
  }, []);

  const linkEmail = useCallback(async (email: string, password: string) => {
    try {
      if (!auth.currentUser) await ensureAnonAuth();
      const cred = EmailAuthProvider.credential(email, password);
      await linkWithCredential(auth.currentUser!, cred);
    } catch (e:any) { setError(e.message || 'Email link failed'); }
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
