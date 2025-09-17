import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase, ref as rtdbRef, onDisconnect, update as rtdbUpdate, set as rtdbSet } from 'firebase/database';
// Environment-driven config (Vite exposes import.meta.env)
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
};
let app;
if (!getApps().length) {
    app = initializeApp(firebaseConfig);
}
else {
    app = getApps()[0];
}
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export const rtdbHelpers = {
    ref: rtdbRef,
    onDisconnect,
    update: rtdbUpdate,
    set: rtdbSet,
};
export async function ensureAnonAuth() {
    if (auth.currentUser)
        return auth.currentUser;
    await signInAnonymously(auth);
    return new Promise((resolve, reject) => {
        const unsub = onAuthStateChanged(auth, (u) => {
            if (u) {
                unsub();
                resolve(u);
            }
        }, reject);
    });
}
// Ensure a non-anonymous (Google/email) user. Resolves once a non-anonymous user exists.
export async function ensureUserAuth() {
    if (auth.currentUser && !auth.currentUser.isAnonymous)
        return auth.currentUser;
    // Wait until auth state changes to a non-anonymous user (UI should trigger sign-in popup).
    return new Promise((resolve, reject) => {
        const unsub = onAuthStateChanged(auth, (u) => {
            if (u && !u.isAnonymous) {
                unsub();
                resolve(u);
            }
        }, reject);
    });
}
