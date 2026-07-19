/**
 * sound.ts — lightweight SFX manager built on Howler.
 *
 * No audio files ship yet. Drop a matching file into public/audio/sfx/<key>.mp3 (see
 * SFX_FILES below for exact filenames) and it activates automatically on next load —
 * same "drop a file, it lights up" convention as the house manifest.json. Until then,
 * playSfx() is a silent no-op: Howler's onloaderror marks the key missing on first
 * attempt so a missing file is never retried or allowed to spam the console.
 */
import { Howl } from 'howler';

export type SfxKey =
  | 'ability_cast'
  | 'hero_hurt'
  | 'enemy_defeated'
  | 'level_up'
  | 'collect'
  | 'outpost_capture'
  | 'outpost_lost'
  | 'mask_claim'
  | 'victory'
  | 'defeat'
  | 'ui_deny';

const SFX_FILES: Record<SfxKey, string> = {
  ability_cast: '/audio/sfx/ability_cast.mp3',
  hero_hurt: '/audio/sfx/hero_hurt.mp3',
  enemy_defeated: '/audio/sfx/enemy_defeated.mp3',
  level_up: '/audio/sfx/level_up.mp3',
  collect: '/audio/sfx/collect.mp3',
  outpost_capture: '/audio/sfx/outpost_capture.mp3',
  outpost_lost: '/audio/sfx/outpost_lost.mp3',
  mask_claim: '/audio/sfx/mask_claim.mp3',
  victory: '/audio/sfx/victory.mp3',
  defeat: '/audio/sfx/defeat.mp3',
  ui_deny: '/audio/sfx/ui_deny.mp3',
};

const cache = new Map<SfxKey, Howl>();
const missing = new Set<SfxKey>();

let muted = false;
let volume = 0.7;
try { muted = localStorage.getItem('afrofuture.sfxMuted') === '1'; } catch {}
try {
  const v = Number(localStorage.getItem('afrofuture.sfxVolume'));
  if (v >= 0 && v <= 1) volume = v;
} catch {}

function getHowl(key: SfxKey): Howl | null {
  if (missing.has(key)) return null;
  let howl = cache.get(key);
  if (!howl) {
    howl = new Howl({
      src: [SFX_FILES[key]],
      volume,
      onloaderror: () => { missing.add(key); cache.delete(key); },
    });
    cache.set(key, howl);
  }
  return howl;
}

/** Fire-and-forget one-shot SFX. No-ops silently if muted or the file isn't there yet. */
export function playSfx(key: SfxKey, opts?: { volume?: number }) {
  if (muted) return;
  const howl = getHowl(key);
  if (!howl) return;
  const id = howl.play();
  if (opts?.volume != null) howl.volume(opts.volume, id);
}

export function isSfxMuted() { return muted; }
export function setSfxMuted(next: boolean) {
  muted = next;
  try { localStorage.setItem('afrofuture.sfxMuted', next ? '1' : '0'); } catch {}
}

export function getSfxVolume() { return volume; }
export function setSfxVolume(next: number) {
  volume = Math.max(0, Math.min(1, next));
  try { localStorage.setItem('afrofuture.sfxVolume', String(volume)); } catch {}
  cache.forEach(h => h.volume(volume));
}
