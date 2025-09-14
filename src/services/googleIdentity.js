// Centralized Google Identity Services loader & initializer.
// This wraps loading the GIS script on demand so we keep index.html clean and control timing.
// Netlify / Vite env: ensure VITE_GOOGLE_CLIENT_ID is defined at build (or runtime with Netlify inject).
// Fallback resolution chain for client id (build env -> inline window.__AF_ENV -> meta tag -> /config.json)
import { getRuntimeGoogleClientId } from '../config/runtimeConfig';
export async function getGoogleClientId() {
    const build = import.meta.env?.VITE_GOOGLE_CLIENT_ID;
    if (build)
        return build;
    const inline = window.__AF_ENV?.googleClientId;
    if (inline)
        return inline;
    const meta = document.querySelector('meta[name="google-client-id"]')?.content;
    if (meta)
        return meta || undefined;
    return await getRuntimeGoogleClientId();
}
let _loadPromise = null;
export function loadGoogleIdentity() {
    if (_loadPromise)
        return _loadPromise;
    _loadPromise = new Promise((resolve, reject) => {
        if (typeof window === 'undefined') {
            reject(new Error('No window'));
            return;
        }
        // If already present
        if (window.google?.accounts?.id) {
            resolve(window.google);
            return;
        }
        const existing = document.getElementById('gis-sdk');
        if (existing) {
            existing.addEventListener('load', () => resolve(window.google));
            existing.addEventListener('error', () => reject(new Error('Google script failed')));
            return;
        }
        const s = document.createElement('script');
        s.id = 'gis-sdk';
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.defer = true;
        s.onload = () => resolve(window.google);
        s.onerror = () => reject(new Error('Failed to load Google Identity script'));
        document.head.appendChild(s);
    });
    return _loadPromise;
}
export async function initGoogleIdentity(clientId, callback) {
    if (!clientId)
        throw new Error('Missing google client id');
    const g = await loadGoogleIdentity();
    // @ts-ignore
    g.accounts.id.initialize({ client_id: clientId, callback });
    return g;
}
export async function renderGoogleButton(target, options = {}) {
    if (!target)
        return;
    const g = await loadGoogleIdentity();
    // @ts-ignore
    g.accounts.id.renderButton(target, { theme: 'outline', size: 'large', width: 280, text: 'signin_with', ...options });
}
export function promptOneTap() {
    const g = window.google;
    if (g?.accounts?.id) {
        try {
            g.accounts.id.prompt();
        }
        catch { }
    }
}
