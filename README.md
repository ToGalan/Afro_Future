# Afro‑Future Rising Prototype

A Vite + React + TypeScript + Tailwind prototype implementing the boot → onboarding → character creator → main menu flow.

## Features
- Boot loading screen with simulated progress
- First-time flow: choose Faction, Archetype, Pet
- Character creator (placeholder grid UI)
- Main menu layout with panels (Player, Character, Pet, Progress, Play panel)
- Modular domain types (`src/types/loadout.ts`)
- Tailwind utility styling

## Getting Started

### 1. Install Dependencies
```powershell
npm install
```

### 2. Start Dev Server
```powershell
npm run dev
```
Then open the printed local URL (usually http://localhost:5173).

### 3. Type Check
```powershell
npm run typecheck
```

### 4. Production Build
```powershell
npm run build
```

### 5. Preview Build
```powershell
npm run preview
```

## Next Ideas
- Persist loadout & onboarding selections to localStorage
- Extract UI components to separate files
- Add state machine for phases
- Implement real customization options & live stat derivation
- Add tests (Vitest + RTL)

## 3D Asset Preloading
The app now performs tiered background preloading for GLTF / FBX customization assets via `schedulePreloads()` in `src/assets/preloadAssets.ts`.

Tiers:
1. Tier 1 (immediate): Base body + a couple of core variants (Heads/Faces/Eyes) + Idle animation.
2. Tier 2 (idle soon): Broader early customization groups (Head/Face/Eyes/Eyebrows/Nose/Hair subset).
3. Tier 3 (idle later): Long‑tail cosmetics (Hats, Glasses, Facial Hair, Earrings, Clothing, Accessories).

Implementation details:
- Uses `useGLTF.preload` / `useFBX.preload` which leverage three.js caching.
- Batches are chunked (4–6 files) and scheduled with `requestIdleCallback` (fallback to `setTimeout`).
- Safe to add/remove files; just edit tiers or source PART_VARIANTS in `threeParts.ts`.
- Legacy single preloads remain in a few components (harmless) but the centralized scheduler covers them.

Disable or tweak:
- Comment out the `schedulePreloads()` call wrapper in `src/main.tsx` if needed.
- Adjust batch sizes or timeouts in `preloadAssets.ts` for different network constraints.

Debug:
- In dev tools: `window.__AF_PRELOAD_INFO__` exposes tier arrays and the scheduler.

## Tailwind Notes
The `@tailwind` directives in `src/styles.css` are processed by Vite + PostCSS. Editor warnings about `@tailwind` / `@apply` disappear once dependencies are installed.

---
MIT License (placeholder)

## Realtime / Snapshot Server

A minimal Express + WebSocket signaling + snapshot server is included (`server.js`). It provides:

Endpoints:
- `POST /snapshots/:world` (auth required) – store a gzipped CRDT snapshot (`latest.txt` pointer updated)
- `GET /snapshots/:world/latest` – fetch latest gzipped snapshot
- WebSocket upgrade `/signal` – simple room-based relay for SDP / ICE messages (WebRTC data channel signaling)

Run backend alone:
```powershell
node server.js
```

Run frontend + backend together:
```powershell
npm run dev:full
```

Snapshots stored under: `./snapshots/<world>/<timestamp>.yjs.gz`.

### Auth (Google Identity Services)

Environment variables (add to `.env` or export in shell):
```
VITE_GOOGLE_CLIENT_ID=YOUR_GOOGLE_OAUTH_WEB_CLIENT_ID
VITE_SHOPIFY_STORE_DOMAIN=yourshop.myshopify.com
VITE_SHOPIFY_STOREFRONT_TOKEN=your_public_storefront_access_token
```
The dev server (Vite) only exposes `VITE_` prefixed variables to the client bundle. The backend reuses the same `VITE_GOOGLE_CLIENT_ID` (no duplicate `GOOGLE_CLIENT_ID` needed).

Flow:
1. `AuthGate` renders a reusable `GoogleSignInButton` (in `src/components/auth/GoogleSignInButton.tsx`).
2. On credential, ID token stored at `localStorage.afrofuture.idToken` and the app transitions to boot.
3. The token payload (JWT) is decoded client‑side (no trust decisions) to populate a lightweight profile (name/email/picture/sub).
4. Server performs REAL verification with `google-auth-library` (`verifyIdToken`) for snapshot endpoints and WebSocket join.

WebSocket join now requires `{ type:'join', roomId, idToken }`. Invalid or missing tokens result in an error and forced close.

Room auto‑rejoin: The last joined room + lightweight RTC state are persisted to:
```
localStorage.afrofuture.room
localStorage.afrofuture.rtcState
```
On refresh, if a valid `idToken` exists the app will decode profile and attempt a single auto rejoin.

Security Notes:
* Do NOT trust decoded client JWT claims—always rely on server verification.
* Add rate limiting and TURN (coturn) in production.
* Consider exp claim enforcement + token refresh if sessions lengthen.
* For multi‑tenant or per‑resource ACLs, map `sub` to internal user id & permissions.

### Client Helpers

`src/services/realtimeClient.ts` exports:
- `loadSnapshot(world, idToken?)`
- `saveSnapshot(world, update, idToken?, alreadyGzip=false)`
- `joinRoom(roomId, { onMessage })` returning `{ ws, pc, dc }`
- `getStoredIdToken()` / `setStoredIdToken()`

Wire CRDT (e.g. Yjs):
```ts
doc.on('update', u => dc?.readyState === 'open' && dc.send(u));
// incoming: onMessage -> Y.applyUpdate(doc, updateBytes)
```

### Hardening TODO
- ~~Real Google ID token verification~~ (implemented)
- Rate limiting & per‑world authorization
- Replace disk snapshots with S3 / R2
- TURN servers for tougher NATs
- Room presence / heartbeats
- Chunked large snapshot uploads (if needed)

## Store (Shopify Integration)

The embedded iframe store was replaced with a direct Shopify Storefront API product grid.

Implementation:
* Query defined in `src/services/shopify.ts` (`fetchProducts`) using the public Storefront API.
* Environment variables required:
	* `VITE_SHOPIFY_STORE_DOMAIN` (e.g. `yourshop.myshopify.com`)
	* `VITE_SHOPIFY_STOREFRONT_TOKEN` (Storefront public token, NOT Admin key)
* If variables are missing a friendly "Shop not configured" message is shown instead of failing.
* Products (first 12) show image, title, primary variant price, and a disabled "Preview" button (placeholder for future purchase / details flow).

Security Notes:
* Do NOT embed private Admin API keys client-side.
* For secure checkout / mutations, proxy through a backend or use Shopify's Checkout / Hydrogen approach.

Future Enhancements:
* Pagination / infinite scroll
* Product detail modal (query by handle)
* Client-side caching (e.g., SWR/Zustand)
* Skeleton loading states & image optimization
* Filtering & categories

## Settings View

The former Help view now acts as a Settings prototype, including placeholder controls (audio sliders, graphics quality, FPS toggle). Values are not persisted yet; future work could store them in localStorage or a profile document.
