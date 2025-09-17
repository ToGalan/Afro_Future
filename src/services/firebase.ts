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
  await signInAnonymously(auth);
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
