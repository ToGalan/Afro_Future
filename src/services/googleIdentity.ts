// Centralized Google Identity Services loader & initializer.
// This wraps loading the GIS script on demand so we keep index.html clean and control timing.
// Netlify / Vite env: ensure VITE_GOOGLE_CLIENT_ID is defined at build (or runtime with Netlify inject).

export interface RenderButtonOptions { [key: string]: any }
export interface GoogleCredentialResponse { credential: string; select_by?: string }

// Minimal ambient type for window.google.accounts.id usage
interface GoogleAccountsId {
  initialize(config: { client_id: string; callback: (resp: GoogleCredentialResponse) => void }): void;
  renderButton(el: HTMLElement, options: any): void;
  prompt(): void;
}
interface GoogleGlobal {
  accounts: { id: GoogleAccountsId };
}

// Fallback resolution chain for client id (build env -> inline window.__AF_ENV -> meta tag -> /config.json)
import { getRuntimeGoogleClientId } from '../config/runtimeConfig';

export async function getGoogleClientId(): Promise<string | undefined> {
  const build = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (build) return build;
  const inline = (window as any).__AF_ENV?.googleClientId as string | undefined;
  if (inline) return inline;
  const meta = (document.querySelector('meta[name="google-client-id"]') as HTMLMetaElement)?.content;
  if (meta) return meta || undefined;
  return await getRuntimeGoogleClientId();
}

let _loadPromise: Promise<GoogleGlobal> | null = null;

export function loadGoogleIdentity(): Promise<GoogleGlobal> {
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { reject(new Error('No window')); return; }
    // If already present
    if ((window as any).google?.accounts?.id) {
      console.log('[gis] google.accounts.id already present – skipping script injection');
      resolve((window as any).google as GoogleGlobal);
      return;
    }
    const existing = document.getElementById('gis-sdk');
    if (existing) {
      console.log('[gis] existing script tag found, waiting for load event');
      existing.addEventListener('load', () => resolve((window as any).google));
      existing.addEventListener('error', () => reject(new Error('Google script failed')));
      return;
    }
    console.log('[gis] injecting google identity script');
    const s = document.createElement('script');
    s.id = 'gis-sdk';
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = () => { console.log('[gis] script loaded'); resolve((window as any).google as GoogleGlobal); };
    s.onerror = () => { console.warn('[gis] script load error'); reject(new Error('Failed to load Google Identity script')); };
    document.head.appendChild(s);
  });
  return _loadPromise;
}

export async function initGoogleIdentity(clientId: string, callback: (resp: GoogleCredentialResponse) => void) {
  if (!clientId) throw new Error('Missing google client id');
  console.log('[gis] initGoogleIdentity start', clientId);
  const g = await loadGoogleIdentity();
  // @ts-ignore
  g.accounts.id.initialize({ client_id: clientId, callback: (resp: GoogleCredentialResponse) => { 
    console.log('[gis] credential callback received', resp?.select_by);
    callback(resp);
  }});
  console.log('[gis] initialize call completed');
  return g;
}

export async function renderGoogleButton(target: HTMLElement | null, options: RenderButtonOptions = {}) {
  if (!target) return;
  console.log('[gis] renderGoogleButton target present', target.id || target.className);
  const g = await loadGoogleIdentity();
  // @ts-ignore
  g.accounts.id.renderButton(target, { theme: 'outline', size: 'large', width: 280, text: 'signin_with', ...options });
  console.log('[gis] renderButton call issued');
}

export function promptOneTap() {
  const g: any = (window as any).google;
  if (g?.accounts?.id) {
    try { console.log('[gis] promptOneTap'); g.accounts.id.prompt(); } catch { console.warn('[gis] promptOneTap failed'); }
  }
}
