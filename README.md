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
