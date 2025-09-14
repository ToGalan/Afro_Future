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

## Tailwind Notes
The `@tailwind` directives in `src/styles.css` are processed by Vite + PostCSS. Editor warnings about `@tailwind` / `@apply` disappear once dependencies are installed.

---
MIT License (placeholder)
