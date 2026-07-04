/**
 * useCollectibles — Collectible items, inventory, and item-slot system.
 *
 * Standalone hook connected through player identity (uid, email, displayName).
 * Manages:
 *   - Collectible flower/mushroom generation on map tiles
 *   - Collision detection (hero on same tile as collectible)
 *   - Collection animation (1200 ms rAF tween)
 *   - Hero and pet inventory state
 *   - Item-slot sync (inventory → 8 HUD slots)
 *   - handleCollect — triggered by 'C' key in MapCameraController
 *   - handleItemUse — triggered by '1'–'8' keys in the keydown handler
 *
 * Used in: SoloMissionMap3D (owner), MapCameraController (collect action).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { PlayerProfile } from '../types/player';
import { getLevelFromXp } from '../services/playerExpEconomy';

// ── Shared tile shape (subset of SoloMissionMap3D's Tile) ───────────────────
type TileType = 'water' | 'desert' | 'plains' | 'forest' | 'jungle' | 'hills' | 'mountain';
interface MinTile { q: number; r: number; type: TileType; }

// ── Inventory item matches PlayerProgress.heroInventory / petInventory ───────
export interface InventoryItem {
  id: string;
  type: string;
  quantity: number;
  effect?: string;
  value?: number;
  icon?: string;
}

// ── ItemSlot matches gameHUD's Item type ─────────────────────────────────────
export interface ItemSlot {
  id: string;
  icon?: string;
  qty?: number;
  key?: string;
}

// ── Hook options ─────────────────────────────────────────────────────────────
interface UseCollectiblesOptions {
  uid: string;
  email?: string;
  displayName?: string;
  tiles: MinTile[];
  heroQ: number;
  heroR: number;
  profile: PlayerProfile | null;
  /** Override initial hero inventory (prop > profile > []). */
  heroInventoryProp?: InventoryItem[];
  /** Override initial pet inventory (prop > profile > []). */
  petInventoryProp?: InventoryItem[];
  saveProgress: (progress: Partial<PlayerProfile['progress']>) => void;
  onHealHP?: (amount: number) => void;
  onRestoreEP?: (amount: number) => void;
}

const ITEM_ICON_MAP: Record<string, string> = {
  flower: '🌸',
  herb: '🍃',
  potion: '🧪',
  consumable: '📦',
};

function makeEmptySlots(): ItemSlot[] {
  return Array.from({ length: 8 }, (_, i) => ({
    id: `item-empty-${i + 1}`,
    icon: '',
    qty: 0,
    key: String(i + 1),
  }));
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useCollectibles({
  uid: _uid,
  email: _email,
  displayName: _displayName,
  tiles,
  heroQ,
  heroR,
  profile,
  heroInventoryProp,
  petInventoryProp,
  saveProgress,
  onHealHP,
  onRestoreEP,
}: UseCollectiblesOptions) {
  // ── Map collectibles ──────────────────────────────────────────────────────
  const [collectibleFlowers, setCollectibleFlowers] = useState<Set<string>>(new Set());
  const [collectibleMushrooms, setCollectibleMushrooms] = useState<Set<string>>(new Set());

  // ── Nearby / collecting state ─────────────────────────────────────────────
  const [nearbyFlower, setNearbyFlower] = useState<string | null>(null);
  const [nearbyMushroom, setNearbyMushroom] = useState<string | null>(null);
  const [collectingFlower, setCollectingFlower] = useState<string | null>(null);
  const [collectingMushroom, setCollectingMushroom] = useState<string | null>(null);
  const [collectingProgress, setCollectingProgress] = useState(0);

  // ── Stable refs (used by animation callbacks and MapCameraController) ─────
  const nearbyFlowerRef = useRef<string | null>(null);
  const nearbyMushroomRef = useRef<string | null>(null);
  const collectingFlowerRef = useRef<string | null>(null);
  const collectingMushroomRef = useRef<string | null>(null);
  const collectTimerRef = useRef<number | null>(null);

  // ── Inventory state ───────────────────────────────────────────────────────
  const [localHeroInventory, setLocalHeroInventory] = useState<InventoryItem[]>(() =>
    heroInventoryProp || profile?.progress?.heroInventory || [],
  );
  const [localPetInventory, setLocalPetInventory] = useState<InventoryItem[]>(() =>
    petInventoryProp || profile?.progress?.petInventory || [],
  );

  // ── Item slots (HUD display) ──────────────────────────────────────────────
  const [itemSlots, setItemSlots] = useState<ItemSlot[]>(makeEmptySlots);

  // ── Keep callback refs fresh without restarting effects ──────────────────
  const onHealHPRef = useRef(onHealHP);
  onHealHPRef.current = onHealHP;
  const onRestoreEPRef = useRef(onRestoreEP);
  onRestoreEPRef.current = onRestoreEP;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;

  // ── Sync "nearby" refs whenever state changes ─────────────────────────────
  useEffect(() => {
    nearbyFlowerRef.current = nearbyFlower;
    nearbyMushroomRef.current = nearbyMushroom;
    collectingFlowerRef.current = collectingFlower;
    collectingMushroomRef.current = collectingMushroom;
  }, [nearbyFlower, nearbyMushroom, collectingFlower, collectingMushroom]);

  // ── Generate collectibles when tiles load ─────────────────────────────────
  useEffect(() => {
    if (tiles.length === 0) return;
    const flowers = new Set<string>();
    const mushrooms = new Set<string>();
    for (const t of tiles) {
      if (t.type === 'plains' && Math.random() < 0.08) flowers.add(`${t.q},${t.r}`);
      if (t.type === 'forest' && Math.random() < 0.20) mushrooms.add(`${t.q},${t.r}`);
    }
    setCollectibleFlowers(flowers);
    setCollectibleMushrooms(mushrooms);
    console.log('[collectibles] Generated', flowers.size, 'flowers,', mushrooms.size, 'mushrooms');
  }, [tiles]);

  // ── Collision detection: which tile has the hero? ─────────────────────────
  useEffect(() => {
    const key = `${heroQ},${heroR}`;
    setNearbyFlower(collectibleFlowers.has(key) ? key : null);
    setNearbyMushroom(collectibleMushrooms.has(key) ? key : null);
  }, [collectibleFlowers, collectibleMushrooms, heroQ, heroR]);

  // ── Sync heroInventory → itemSlots for HUD ────────────────────────────────
  useEffect(() => {
    const slots: ItemSlot[] = [];
    let i = 0;
    for (const item of localHeroInventory) {
      if (i >= 8 || item.quantity <= 0) continue;
      slots[i] = {
        id: item.id,
        icon: (item as any).icon || ITEM_ICON_MAP[item.type] || '🎒',
        qty: item.quantity,
        key: String(i + 1),
      };
      i++;
    }
    for (; i < 8; i++) {
      slots[i] = { id: `item-empty-${i + 1}`, icon: '', qty: 0, key: String(i + 1) };
    }
    setItemSlots(slots);
  }, [localHeroInventory]);

  // ── handleCollect: start a 1200 ms collection animation ──────────────────
  /**
   * Called from MapCameraController on 'C' key.
   * Accepts whichever of flowerKey / mushroomKey is non-null (first wins).
   */
  const handleCollect = useCallback(
    (flowerKey: string | null, mushroomKey: string | null) => {
      if (collectingFlowerRef.current || collectingMushroomRef.current) return;

      const isFlower = !!flowerKey;
      const targetKey = flowerKey || mushroomKey;
      if (!targetKey) return;

      if (isFlower) {
        collectingFlowerRef.current = targetKey;
        setCollectingFlower(targetKey);
      } else {
        collectingMushroomRef.current = targetKey;
        setCollectingMushroom(targetKey);
      }
      setCollectingProgress(0);

      const startTime = performance.now();
      const DURATION = 1200;

      const animate = (now: number) => {
        const progress = Math.min(1, (now - startTime) / DURATION);
        setCollectingProgress(progress);

        if (progress < 1) {
          collectTimerRef.current = requestAnimationFrame(animate);
          return;
        }

        // ── Collection complete ──────────────────────────────────────────
        const prof = profileRef.current;
        const heroXp = prof?.progress?.hero?.xp ?? 0;
        const heroLevel = prof?.progress?.hero?.level ?? 1;

        if (isFlower) {
          setCollectibleFlowers(prev => {
            const next = new Set(prev);
            next.delete(targetKey);
            return next;
          });
          setLocalHeroInventory(prev => {
            const existing = prev.find(i => i.type === 'flower');
            return existing
              ? prev.map(i => (i.type === 'flower' ? { ...i, quantity: i.quantity + 1 } : i))
              : [...prev, { id: 'flower-' + targetKey, type: 'flower', quantity: 1, effect: 'heal', value: 20, icon: '🌸' }];
          });
          onHealHPRef.current?.(20);
          collectingFlowerRef.current = null;
          setCollectingFlower(null);
          setNearbyFlower(null);
        } else {
          setCollectibleMushrooms(prev => {
            const next = new Set(prev);
            next.delete(targetKey);
            return next;
          });
          setLocalHeroInventory(prev => {
            const existing = prev.find(i => i.type === 'herb');
            return existing
              ? prev.map(i => (i.type === 'herb' ? { ...i, quantity: i.quantity + 1 } : i))
              : [...prev, { id: 'herb-' + targetKey, type: 'herb', quantity: 1, effect: 'buff', value: 5, icon: '🍃' }];
          });
          onRestoreEPRef.current?.(5);
          collectingMushroomRef.current = null;
          setCollectingMushroom(null);
          setNearbyMushroom(null);
        }

        // Advance level from the new XP total, and carry forward the EXISTING skill
        // data (traits/unlockedSkillIds/unlockOrder). Previously these were sent as
        // empty arrays, which mergeProgress shallow-merged over the real values —
        // wiping the player's skill progression on every pickup.
        const newXp = heroXp + 5;
        const newLevel = Math.max(heroLevel, getLevelFromXp(newXp));
        saveProgressRef.current({
          hero: {
            traits: prof?.progress?.hero?.traits ?? [],
            unlockedSkillIds: prof?.progress?.hero?.unlockedSkillIds ?? [],
            unlockOrder: prof?.progress?.hero?.unlockOrder ?? [],
            ...prof?.progress?.hero,
            xp: newXp,
            level: newLevel,
          },
        });
        setCollectingProgress(0);
      };

      collectTimerRef.current = requestAnimationFrame(animate);
    },
    // All volatile state is accessed through refs — callback is intentionally stable
    [],
  );

  // ── handleItemUse: called on '1'–'8' key press ────────────────────────────
  const itemSlotsRef = useRef(itemSlots);
  itemSlotsRef.current = itemSlots;

  const handleItemUse = useCallback((slotIndex: number) => {
    const slot = itemSlotsRef.current[slotIndex];
    if (!slot || (slot.qty ?? 0) <= 0 || !slot.icon) return;

    const itemType = slot.id.split('-')[0];
    setLocalHeroInventory(prev =>
      prev
        .map(inv => (inv.type === itemType && inv.quantity > 0 ? { ...inv, quantity: inv.quantity - 1 } : inv))
        .filter(inv => inv.quantity > 0),
    );
    if (itemType === 'flower') onHealHPRef.current?.(20);
    else if (itemType === 'herb') onRestoreEPRef.current?.(5);
  }, []);

  // ── Return ────────────────────────────────────────────────────────────────
  return {
    // Map collectibles
    collectibleFlowers,
    collectibleMushrooms,
    // Nearby / animation state
    nearbyFlower,
    nearbyMushroom,
    collectingFlower,
    collectingMushroom,
    collectingProgress,
    // Refs (for MapCameraController / animation timers)
    nearbyFlowerRef,
    nearbyMushroomRef,
    collectingFlowerRef,
    collectingMushroomRef,
    collectTimerRef,
    // Inventory
    localHeroInventory,
    setLocalHeroInventory,
    localPetInventory,
    setLocalPetInventory,
    // HUD item slots
    itemSlots,
    setItemSlots,
    // Actions
    handleCollect,
    handleItemUse,
  };
}
