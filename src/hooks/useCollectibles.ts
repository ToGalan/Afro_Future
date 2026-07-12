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
import type { ProgressPatch } from './usePlayerProfile';
import { getLevelFromXp } from '../services/playerExpEconomy';

// ── Shared tile shape (subset of SoloMissionMap3D's Tile) ───────────────────
type TileType = 'water' | 'desert' | 'plains' | 'forest' | 'jungle' | 'hills' | 'mountain';
export type ResourceType = 'ore' | 'energy' | 'bio';
interface MinTile { q: number; r: number; type: TileType; resource?: ResourceType | null; }

// Gatherable resource nodes behave like mushrooms/flowers: collect on 'C', add to
// inventory, apply a stat effect, award XP. Tunable per-type. hp → onHealHP,
// ep → onRestoreEP, xp → XP granted on collect.
export const RESOURCE_DEFS: Record<ResourceType, { icon: string; effect: string; hp: number; ep: number; xp: number; label: string }> = {
  ore:    { icon: '⬢', effect: 'ore',    hp: 0,  ep: 12, xp: 15, label: 'Ore' },     // valuable mineral — big XP + energy
  energy: { icon: '⚡', effect: 'energy', hp: 0,  ep: 20, xp: 6,  label: 'Energy' },  // restores EP
  bio:    { icon: '🌿', effect: 'heal',   hp: 50, ep: 0,  xp: 6,  label: 'Bio' },     // heals HP
};

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
  /** Item type (for effect lookup on use). */
  type?: string;
  /** Which inventory this slot draws from — number-key use consumes from here. */
  source?: 'hero' | 'pet';
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
  saveProgress: (progress: ProgressPatch) => void;
  onHealHP?: (amount: number) => void;
  onRestoreEP?: (amount: number) => void;
  /** Notified when the hero gains XP from a collect (for instant HUD/popup feedback). */
  onHeroXp?: (amount: number) => void;
}

const ITEM_ICON_MAP: Record<string, string> = {
  flower: '🌸',
  herb: '🍄',
  ore: '⬢',
  energy: '⚡',
  bio: '🌿',
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
  onHeroXp,
}: UseCollectiblesOptions) {
  // ── Map collectibles ──────────────────────────────────────────────────────
  const [collectibleFlowers, setCollectibleFlowers] = useState<Set<string>>(new Set());
  const [collectibleMushrooms, setCollectibleMushrooms] = useState<Set<string>>(new Set());
  // Resource nodes (ore/energy/bio): key "q,r" → type. Built from the tiles' assigned resources.
  const [collectibleResources, setCollectibleResources] = useState<Map<string, ResourceType>>(new Map());

  // ── Nearby / collecting state ─────────────────────────────────────────────
  const [nearbyFlower, setNearbyFlower] = useState<string | null>(null);
  const [nearbyMushroom, setNearbyMushroom] = useState<string | null>(null);
  const [nearbyResource, setNearbyResource] = useState<{ key: string; type: ResourceType } | null>(null);
  const [collectingFlower, setCollectingFlower] = useState<string | null>(null);
  const [collectingMushroom, setCollectingMushroom] = useState<string | null>(null);
  const [collectingResource, setCollectingResource] = useState<string | null>(null);
  const [collectingProgress, setCollectingProgress] = useState(0);

  // ── Stable refs (used by animation callbacks and MapCameraController) ─────
  const nearbyFlowerRef = useRef<string | null>(null);
  const nearbyMushroomRef = useRef<string | null>(null);
  const nearbyResourceRef = useRef<{ key: string; type: ResourceType } | null>(null);
  const collectingFlowerRef = useRef<string | null>(null);
  const collectingMushroomRef = useRef<string | null>(null);
  const collectingResourceRef = useRef<string | null>(null);
  const collectTimerRef = useRef<number | null>(null);

  // ── Inventory state ───────────────────────────────────────────────────────
  const [localHeroInventory, setLocalHeroInventory] = useState<InventoryItem[]>(() =>
    heroInventoryProp || profile?.progress?.heroInventory || [],
  );
  const [localPetInventory, setLocalPetInventory] = useState<InventoryItem[]>(() =>
    petInventoryProp || profile?.progress?.petInventory || [],
  );

  // ── Late inventory hydration ──────────────────────────────────────────────
  // The useState initializers above run once at mount. Because the map usually
  // mounts BEFORE the player profile finishes loading (async auth + Firestore read),
  // that first read is empty and the saved inventory would otherwise be lost on
  // resume. Seed the local inventory once the saved data arrives — but only while
  // it's still empty, so anything collected before the profile loaded is preserved.
  const invHydratedRef = useRef(false);
  useEffect(() => {
    if (invHydratedRef.current) return;
    const heroInv = heroInventoryProp || profile?.progress?.heroInventory;
    const petInv = petInventoryProp || profile?.progress?.petInventory;
    if (!heroInv && !petInv) return; // nothing to hydrate from yet
    invHydratedRef.current = true;
    if (heroInv?.length) setLocalHeroInventory(prev => (prev.length === 0 ? heroInv : prev));
    if (petInv?.length) setLocalPetInventory(prev => (prev.length === 0 ? petInv : prev));
  }, [profile, heroInventoryProp, petInventoryProp]);

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
    nearbyResourceRef.current = nearbyResource;
    collectingFlowerRef.current = collectingFlower;
    collectingMushroomRef.current = collectingMushroom;
    collectingResourceRef.current = collectingResource;
  }, [nearbyFlower, nearbyMushroom, nearbyResource, collectingFlower, collectingMushroom, collectingResource]);

  // ── Generate collectibles when tiles load ─────────────────────────────────
  useEffect(() => {
    if (tiles.length === 0) return;
    const flowers = new Set<string>();
    const mushrooms = new Set<string>();
    const resources = new Map<string, ResourceType>();
    for (const t of tiles) {
      if (t.type === 'plains' && Math.random() < 0.08) flowers.add(`${t.q},${t.r}`);
      if (t.type === 'forest' && Math.random() < 0.20) mushrooms.add(`${t.q},${t.r}`);
      // Resource nodes come pre-assigned on the tiles (assignResources) — mirror them
      // into a collectible map so they gather exactly like mushrooms.
      if (t.resource) resources.set(`${t.q},${t.r}`, t.resource);
    }
    setCollectibleFlowers(flowers);
    setCollectibleMushrooms(mushrooms);
    setCollectibleResources(resources);
    console.log('[collectibles] Generated', flowers.size, 'flowers,', mushrooms.size, 'mushrooms,', resources.size, 'resources');
  }, [tiles]);

  // ── Collision detection: which tile has the hero? ─────────────────────────
  useEffect(() => {
    const key = `${heroQ},${heroR}`;
    setNearbyFlower(collectibleFlowers.has(key) ? key : null);
    setNearbyMushroom(collectibleMushrooms.has(key) ? key : null);
    const rType = collectibleResources.get(key);
    setNearbyResource(rType ? { key, type: rType } : null);
  }, [collectibleFlowers, collectibleMushrooms, collectibleResources, heroQ, heroR]);

  // ── Sync hero + pet inventories → itemSlots for HUD ───────────────────────
  // Each unique item (hero items first, then pet items) gets its own number key
  // (1–8). Using a key consumes from that item's own inventory (hero or pet).
  useEffect(() => {
    const slots: ItemSlot[] = [];
    let i = 0;
    const push = (item: InventoryItem, source: 'hero' | 'pet') => {
      if (i >= 8 || item.quantity <= 0) return;
      slots[i] = {
        id: item.id,
        type: item.type,
        source,
        // Canonical type icon wins so a previously-saved item with an out-of-date
        // glyph (e.g. an old 🍃 mushroom) still renders the correct icon.
        icon: ITEM_ICON_MAP[item.type] || (item as any).icon || '🎒',
        qty: item.quantity,
        key: String(i + 1),
      };
      i++;
    };
    for (const item of localHeroInventory) push(item, 'hero');
    for (const item of localPetInventory) push(item, 'pet');
    for (; i < 8; i++) {
      slots[i] = { id: `item-empty-${i + 1}`, icon: '', qty: 0, key: String(i + 1) };
    }
    setItemSlots(slots);
  }, [localHeroInventory, localPetInventory]);

  // ── handleCollect: start a 1200 ms collection animation ──────────────────
  /**
   * Called from MapCameraController on 'C' key.
   * Accepts whichever of flowerKey / mushroomKey is non-null (first wins).
   */
  // Add (or increment) an inventory item.
  const addInventoryItem = useCallback((type: string, effect: string, value: number, icon: string, key: string) => {
    setLocalHeroInventory(prev => {
      const existing = prev.find(i => i.type === type);
      return existing
        ? prev.map(i => (i.type === type ? { ...i, quantity: i.quantity + 1 } : i))
        : [...prev, { id: `${type}-${key}`, type, quantity: 1, effect, value, icon }];
    });
  }, []);

  // Award XP and persist. Patch ONLY xp/level so mergeProgress preserves the existing
  // hero (skills/traits) — a pickup must never wipe skill progression.
  const onHeroXpRef = useRef(onHeroXp);
  onHeroXpRef.current = onHeroXp;
  const awardXpAndSave = useCallback((xpGain: number) => {
    onHeroXpRef.current?.(xpGain); // instant HUD/popup feedback
    const prof = profileRef.current;
    const heroXp = prof?.progress?.hero?.xp ?? 0;
    const heroLevel = prof?.progress?.hero?.level ?? 1;
    const newXp = heroXp + xpGain;
    const newLevel = Math.max(heroLevel, getLevelFromXp(newXp));
    saveProgressRef.current({ hero: { xp: newXp, level: newLevel } });
  }, []);

  /**
   * Starts a 1200 ms collection animation for whichever collectible is nearby.
   * Handles flowers, mushrooms, and resource nodes (ore/energy/bio) identically:
   * remove from the map, add to inventory, apply the stat effect, award XP.
   */
  const handleCollect = useCallback(
    (flowerKey: string | null, mushroomKey: string | null, resource?: { key: string; type: ResourceType } | null) => {
      if (collectingFlowerRef.current || collectingMushroomRef.current || collectingResourceRef.current) return;

      // Resolve which kind is being collected (flower > mushroom > resource).
      let kind: 'flower' | 'mushroom' | ResourceType;
      let targetKey: string;
      if (flowerKey)        { kind = 'flower';   targetKey = flowerKey; }
      else if (mushroomKey) { kind = 'mushroom'; targetKey = mushroomKey; }
      else if (resource)    { kind = resource.type; targetKey = resource.key; }
      else return;

      if (kind === 'flower')        { collectingFlowerRef.current = targetKey; setCollectingFlower(targetKey); }
      else if (kind === 'mushroom') { collectingMushroomRef.current = targetKey; setCollectingMushroom(targetKey); }
      else                          { collectingResourceRef.current = targetKey; setCollectingResource(targetKey); }
      setCollectingProgress(0);

      const startTime = performance.now();
      const DURATION = 1200;

      const animate = (now: number) => {
        const progress = Math.min(1, (now - startTime) / DURATION);
        setCollectingProgress(progress);
        if (progress < 1) { collectTimerRef.current = requestAnimationFrame(animate); return; }

        // ── Collection complete ──────────────────────────────────────────
        let xpGain = 5;
        if (kind === 'flower') {
          setCollectibleFlowers(prev => { const n = new Set(prev); n.delete(targetKey); return n; });
          addInventoryItem('flower', 'heal', 20, '🌸', targetKey);
          onHealHPRef.current?.(20);
          collectingFlowerRef.current = null; setCollectingFlower(null); setNearbyFlower(null);
        } else if (kind === 'mushroom') {
          setCollectibleMushrooms(prev => { const n = new Set(prev); n.delete(targetKey); return n; });
          addInventoryItem('herb', 'buff', 5, '🍄', targetKey);
          onRestoreEPRef.current?.(5);
          collectingMushroomRef.current = null; setCollectingMushroom(null); setNearbyMushroom(null);
        } else {
          const def = RESOURCE_DEFS[kind];
          setCollectibleResources(prev => { const n = new Map(prev); n.delete(targetKey); return n; });
          addInventoryItem(kind, def.effect, def.hp || def.ep, def.icon, targetKey);
          if (def.hp) onHealHPRef.current?.(def.hp);
          if (def.ep) onRestoreEPRef.current?.(def.ep);
          xpGain = def.xp;
          collectingResourceRef.current = null; setCollectingResource(null); setNearbyResource(null);
        }

        awardXpAndSave(xpGain);
        setCollectingProgress(0);
      };

      collectTimerRef.current = requestAnimationFrame(animate);
    },
    // All volatile state is accessed through refs — callback is intentionally stable
    [addInventoryItem, awardXpAndSave],
  );

  // ── handleItemUse: called on '1'–'8' key press ────────────────────────────
  const itemSlotsRef = useRef(itemSlots);
  itemSlotsRef.current = itemSlots;

  const handleItemUse = useCallback((slotIndex: number) => {
    const slot = itemSlotsRef.current[slotIndex];
    if (!slot || (slot.qty ?? 0) <= 0 || !slot.icon) return;

    const itemType = slot.type || slot.id.split('-')[0];
    // Consume from whichever inventory owns this slot (hero or pet pack).
    const consume = slot.source === 'pet' ? setLocalPetInventory : setLocalHeroInventory;
    consume(prev =>
      prev
        .map(inv => (inv.id === slot.id && inv.quantity > 0 ? { ...inv, quantity: inv.quantity - 1 } : inv))
        .filter(inv => inv.quantity > 0),
    );
    if (itemType === 'flower') onHealHPRef.current?.(20);
    else if (itemType === 'herb') onRestoreEPRef.current?.(5);
    else if (itemType === 'ore' || itemType === 'energy' || itemType === 'bio') {
      const def = RESOURCE_DEFS[itemType as ResourceType];
      if (def.hp) onHealHPRef.current?.(def.hp);
      if (def.ep) onRestoreEPRef.current?.(def.ep);
    }
  }, []);

  // ── Return ────────────────────────────────────────────────────────────────
  return {
    // Map collectibles
    collectibleFlowers,
    collectibleMushrooms,
    collectibleResources,
    // Nearby / animation state
    nearbyFlower,
    nearbyMushroom,
    nearbyResource,
    collectingFlower,
    collectingMushroom,
    collectingResource,
    collectingProgress,
    // Refs (for MapCameraController / animation timers)
    nearbyFlowerRef,
    nearbyMushroomRef,
    nearbyResourceRef,
    collectingFlowerRef,
    collectingMushroomRef,
    collectingResourceRef,
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
