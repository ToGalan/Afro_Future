import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, User, GoogleAuthProvider, signInWithCredential, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getDatabase, ref as rtdbRef, onDisconnect, update as rtdbUpdate, set as rtdbSet, remove as rtdbRemove, Database, connectDatabaseEmulator } from 'firebase/database';

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

// Optional: connect to local emulators during development.
// Activate by setting VITE_USE_FIREBASE_EMULATORS = 'true' in .env.local
if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  try {
    // Avoid double-connect (Vite HMR) by tracking on window
    // @ts-ignore
    if (!(window as any).__firebaseEmulatorsConnected) {
      // @ts-ignore
      (window as any).__firebaseEmulatorsConnected = true;
      const host = import.meta.env.VITE_FIREBASE_EMULATOR_HOST || 'localhost';
      const authPort = parseInt(import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_PORT || '9099', 10);
      const fsPort = parseInt(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || '8080', 10);
      const dbPort = parseInt(import.meta.env.VITE_RTDB_EMULATOR_PORT || '9000', 10);
      connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
      connectFirestoreEmulator(db, host, fsPort);
      connectDatabaseEmulator(rtdb, host, dbPort);
      // eslint-disable-next-line no-console
      console.warn('[firebase] Connected to local emulators', { host, authPort, fsPort, dbPort });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[firebase] emulator connect failed', e);
  }
}

export const rtdbHelpers = {
  ref: rtdbRef,
  onDisconnect,
  update: rtdbUpdate,
  set: rtdbSet,
  remove: rtdbRemove,
};

// Sign Firebase in with a Google id_token obtained from GIS / Google One Tap.
// Call this immediately after receiving the credential so auth.currentUser is set,
// which prevents ensureAnonAuth from attempting (disabled) anonymous sign-in.
export async function signInWithGoogleCredential(idToken: string): Promise<void> {
  try {
    const credential = GoogleAuthProvider.credential(idToken);
    await signInWithCredential(auth, credential);
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn('[firebase] signInWithCredential failed:', e?.code || e?.message);
  }
}

export async function ensureAnonAuth(): Promise<User> {
  if (auth.currentUser) return auth.currentUser;

  // If a Google token is present, signInWithGoogleCredential() will resolve auth.
  // Wait indefinitely — never fall through to signInAnonymously (which would 400
  // on projects where anonymous auth is disabled).
  const hasGoogleToken = !!localStorage.getItem('afrofuture.idToken');
  if (hasGoogleToken) {
    return new Promise<User>((resolve, reject) => {
      const unsub = onAuthStateChanged(auth, (u) => {
        if (u) { unsub(); resolve(u); }
      }, reject);
    });
  }

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
