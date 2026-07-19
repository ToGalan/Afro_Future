# SFX drop-in folder

Drop MP3 files here with these exact names and they activate automatically — no code
changes needed. Backed by `src/services/sound.ts` (Howler). Missing files are silently
ignored (no crash, no console spam beyond the browser's own one-time 404).

| Filename              | Fires when |
|------------------------|------------|
| `ability_cast.mp3`     | Player casts an ability (Q/W/E/R or Z/X/C/V) |
| `hero_hurt.mp3`        | Hero takes damage |
| `enemy_defeated.mp3`   | A creep or rival unit is killed |
| `level_up.mp3`         | Hero levels up |
| `collect.mp3`          | Flower/mushroom/resource node collected |
| `outpost_capture.mp3`  | Player captures an outpost |
| `outpost_lost.mp3`     | A player outpost is raided/lost |
| `mask_claim.mp3`       | A faction mask is claimed (own or rival) |
| `victory.mp3`          | Campaign victory overlay appears |
| `defeat.mp3`           | Campaign defeat overlay appears |
| `ui_deny.mp3`          | An action is blocked (not enough resources/energy, on cooldown) |

Keep files short (<2s for one-shots) and normalized to a similar loudness so nothing
spikes above the rest. See the in-conversation SFX-source recommendations (Kenney.nl,
Sonniss GDC bundles, Freesound.org) for free packs that fit this list.
