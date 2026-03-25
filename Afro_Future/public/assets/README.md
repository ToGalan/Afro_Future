# Assets Directory

Static game UI assets served by Vite from `/assets/*`.

## Structure
```
public/
  assets/
    factions/        # Faction emblems (SVG)
      paa.svg
      asf.svg
      wc.svg
    characters/      # Character base silhouettes or portraits
      male_default.svg
      female_default.svg
    pets/            # Pet silhouettes / icons
      cyber_dog.svg
      cyber_cat.svg
    ui/              # Generic UI decorations (empty for now)
```

## Naming Conventions
- Lowercase with underscores for multiword items: `cyber_dog.svg`.
- Faction codes use their canonical uppercase code as filename (lowercase on disk for portability): `paa.svg`.
- Character gender defaults: `male_default.svg`, `female_default.svg`.

## Referencing in Code
Because these live under `public/`, they are available at runtime via:
```ts
<img src="/assets/factions/paa.svg" />
```
No import needed (Vite copies as-is). Use an asset path map for type‑safety.

## Next Steps
- Replace placeholders with final art.
- Add resolution variants if raster images are introduced (`@2x` suffix).
- Introduce a build script to validate broken links.
