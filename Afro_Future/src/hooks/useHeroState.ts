import { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Actor, Axial, Tile } from '../types/map';
import type { PlayerProfile, PlayerProgress } from '../types/player';

interface UseHeroStateOptions {
  /** True when chunk streaming is active (avoids full map gen) */
  useChunks: boolean;
  /** Map-centre axial coordinate used when chunks mode is on */
  chunkCenterAxial: Axial;
  /** All loaded tiles — used to know when map generation is done */
  tiles: Tile[];
  /** Best walkable spawn position near the map centre */
  spawnPos: Axial;
  /** Firestore player profile (null while loading) */
  profile: PlayerProfile | null;
  /** Persists partial progress to Firestore */
  saveProgress: (data: Partial<PlayerProgress>) => void;
}

interface UseHeroStateReturn {
  hero: Actor;
  setHero: React.Dispatch<React.SetStateAction<Actor>>;
  /** THREE.Group ref attached to the hero avatar JSX element (for collision) */
  heroAvatarRef: React.MutableRefObject<THREE.Group | null>;
  /** Incremented to trigger camera recentre */
  recenterSignal: number;
  setRecenterSignal: React.Dispatch<React.SetStateAction<number>>;
}

export function useHeroState({
  useChunks,
  chunkCenterAxial,
  tiles,
  spawnPos,
  profile,
  saveProgress,
}: UseHeroStateOptions): UseHeroStateReturn {
  const initialPos: Axial = useChunks ? chunkCenterAxial : { q: 0, r: 0 };

  const [hero, setHero] = useState<Actor>(() => ({
    id: 'hero',
    // Use Firestore saved position immediately if available, to avoid a first-frame flash
    pos: profile?.progress?.heroPosition ?? initialPos,
    vision: 8,
    kind: 'actor',
  }));

  const heroAvatarRef = useRef<THREE.Group | null>(null);
  const [recenterSignal, setRecenterSignal] = useState(0);
  const lastSpaceRef = useRef(0);
  const heroMovedToSpawn = useRef(false);

  // Always rehydrate hero position from profile on every profile change
  useEffect(() => {
    if (!profile?.progress?.heroPosition) return;
    setHero(h => ({ ...h, pos: profile.progress.heroPosition }));
    setRecenterSignal(s => s + 1);
  }, [profile?.progress?.heroPosition]);

  // Once tiles are ready, move hero to the real map spawn position.
  // Skip if profile already has a saved position (restored above).
  useEffect(() => {
    if (tiles.length === 0 || heroMovedToSpawn.current) return;
    if (profile?.progress?.heroPosition) return;
    heroMovedToSpawn.current = true;
    setHero(h => ({ ...h, pos: spawnPos }));
    setRecenterSignal(s => s + 1);
  // spawnPos is stable after tiles generate — including it prevents the effect
  // from running on every render while tiles.length === 0.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles.length, spawnPos]);

  // Double-tap spacebar → recentre camera
  useEffect(() => {
    function onSpace(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      const now = performance.now();
      if (now - lastSpaceRef.current < 320) setRecenterSignal(s => s + 1);
      lastSpaceRef.current = now;
    }
    window.addEventListener('keydown', onSpace);
    return () => window.removeEventListener('keydown', onSpace);
  }, []);

  return { hero, setHero, heroAvatarRef, recenterSignal, setRecenterSignal };
}
