/* Firebase Messaging Service Worker */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Dynamic import of Firebase scripts (modular SDK not directly usable in SW via importScripts absent bundling)
importScripts('https://www.gstatic.com/firebasejs/10.13.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.1/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: self?.location?.origin ? undefined : undefined, // not needed for receiving (placeholder)
};

// We cannot access import.meta.env in service worker static file; expect initialization from messagingSenderId injection via postMessage if needed.
// Initialize with only messagingSenderId (rest not required for receiving background messages)
try { firebase.initializeApp({ messagingSenderId: '245168504248' }); } catch(e) {}
try { firebase.messaging(); } catch(e) {}

// Background messages (compat) handler placeholder
self.addEventListener('push', (event) => {
  // If Firebase handles this, it won't reach here. This is fallback.
});
