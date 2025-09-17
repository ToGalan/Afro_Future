import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase, ref as rtdbRef, onDisconnect, update as rtdbUpdate, set as rtdbSet, remove as rtdbRemove, Database } from 'firebase/database';

// Environment-driven config (Vite exposes import.meta.env)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL as string | undefined,
};

// Dev-time validation to surface missing/placeholder keys early
if (import.meta.env.DEV) {
  const missing: string[] = [];
  (['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId','databaseURL'] as const).forEach(k => {
    // @ts-ignore
    if (!firebaseConfig[k]) missing.push(k);
  });
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.warn('[firebase] Missing config keys:', missing.join(', '));
  }
}

// In production, log a minimal, redacted summary once to help diagnose misconfiguration without leaking secrets
if (import.meta.env.PROD) {
  try {
    const ak = (firebaseConfig.apiKey || '').slice(-4);
    // eslint-disable-next-line no-console
    console.warn('[firebase] runtime config check:', {
      apiKeyEndsWith: ak || 'none',
      projectId: firebaseConfig.projectId || 'none',
      authDomain: firebaseConfig.authDomain || 'none',
      databaseURLPresent: !!firebaseConfig.databaseURL,
    });
  } catch {
    // ignore
  }
}

let app: FirebaseApp;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb: Database = getDatabase(app);

export const rtdbHelpers = {
  ref: rtdbRef,
  onDisconnect,
  update: rtdbUpdate,
  set: rtdbSet,
  remove: rtdbRemove,
};

export async function ensureAnonAuth(): Promise<User> {
  if (auth.currentUser) return auth.currentUser;
  try {
    await signInAnonymously(auth);
  } catch (e: any) {
    const code = e?.code || e?.message || '';
    // If Anonymous is disabled on the project, avoid spamming 400s and just wait for a real sign-in (Google/email)
    if (String(code).includes('operation-not-allowed') || String(code).toUpperCase().includes('OPERATION_NOT_ALLOWED')) {
      // eslint-disable-next-line no-console
      console.warn('[auth] Anonymous sign-in disabled. Waiting for non-anonymous user...');
      return new Promise<User>((resolve, reject) => {
        const unsub = onAuthStateChanged(auth, (u) => {
          if (u) { unsub(); resolve(u); }
        }, reject);
      });
    }
    throw e;
  }
  return new Promise<User>((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) { unsub(); resolve(u); }
    }, reject);
  });
}

// Ensure a non-anonymous (Google/email) user. Resolves once a non-anonymous user exists.
export async function ensureUserAuth(): Promise<User> {
  if (auth.currentUser && !auth.currentUser.isAnonymous) return auth.currentUser;
  // Wait until auth state changes to a non-anonymous user (UI should trigger sign-in popup).
  return new Promise<User>((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u && !u.isAnonymous) { unsub(); resolve(u); }
    }, reject);
  });
}
