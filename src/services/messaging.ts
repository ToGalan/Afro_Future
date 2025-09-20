import { getMessaging, getToken, Messaging } from 'firebase/messaging';
import { auth } from './firebase';

let messaging: Messaging | null = null;

export async function ensureMessaging(): Promise<Messaging | null> {
  if (messaging) return messaging;
  try {
    // Dynamic import to prevent SSR/bundle size issues if not needed
    messaging = getMessaging();
    return messaging;
  } catch (e) {
    console.warn('[messaging] init failed', e);
    return null;
  }
}

export async function fetchFcmToken(vapidPublicKey: string): Promise<string | null> {
  try {
    const m = await ensureMessaging();
    if (!m) return null;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;
    const token = await getToken(m, { vapidKey: vapidPublicKey });
    return token || null;
  } catch (e) {
    console.warn('[messaging] token fetch failed', e);
    return null;
  }
}

export async function registerPushTokenToServer(token: string, idToken: string) {
  try {
    await fetch('/push/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken }, body: JSON.stringify({ token }) });
  } catch (e) { console.warn('[messaging] register failed', e); }
}

export async function collectAndRegisterPush(idToken: string) {
  const vapid = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
  if (!vapid) return;
  const token = await fetchFcmToken(vapid);
  if (token) {
    await registerPushTokenToServer(token, idToken);
  }
}
