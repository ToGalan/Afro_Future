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
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import type { PlayerProfile } from '../types/player';

// ── Shared tile shape (subset of SoloMissionMap3D's Tile) ───────────────────
type TileType = 'water' | 'desert' | 'plains' | 'forest' | 'jungle' | 'hills' | 'mountain';
interface MinTile { q: number; r: number; type: TileType; }

// ── Inventory item matches PlayerProgress.heroInventory / petInventory ───────
export interface InventoryItem {
  id: string;
  type: 'herb' | 'flower' | 'wood' | 'iron' | 'glass' | 'potion' | 'consumable';
  quantity: number;
  effect?: 'heal' | 'damage' | 'buff';
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
  /** Called with amount=1 every time the player successfully collects an item. */
  onPlayerXpGain?: (amount: number) => void;
}

const ITEM_ICON_MAP: Record<string, string> = {
  flower: '🌸',
  herb: '�',
  wood: '🪵',
  iron: '⚙️',
  glass: '💎',
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
  uid,
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
  onPlayerXpGain,
}: UseCollectiblesOptions) {
  // ── Map collectibles ──────────────────────────────────────────────────────
  const [collectibleFlowers, setCollectibleFlowers] = useState<Set<string>>(new Set());
  const [collectibleMushrooms, setCollectibleMushrooms] = useState<Set<string>>(new Set());
  const [collectibleLogs, setCollectibleLogs] = useState<Set<string>>(new Set());
  const [collectibleIrons, setCollectibleIrons] = useState<Set<string>>(new Set());
  const [collectibleGlasses, setCollectibleGlasses] = useState<Set<string>>(new Set());

  // ── Nearby / collecting state ─────────────────────────────────────────────
  const [nearbyFlower, setNearbyFlower] = useState<string | null>(null);
  const [nearbyMushroom, setNearbyMushroom] = useState<string | null>(null);
  const [nearbyLog, setNearbyLog] = useState<string | null>(null);
  const [nearbyIron, setNearbyIron] = useState<string | null>(null);
  const [nearbyGlass, setNearbyGlass] = useState<string | null>(null);
  const [collectingFlower, setCollectingFlower] = useState<string | null>(null);
  const [collectingMushroom, setCollectingMushroom] = useState<string | null>(null);
  const [collectingLog, setCollectingLog] = useState<string | null>(null);
  const [collectingIron, setCollectingIron] = useState<string | null>(null);
  const [collectingGlass, setCollectingGlass] = useState<string | null>(null);
  const [collectingProgress, setCollectingProgress] = useState(0);

  // ── Stable refs (used by animation callbacks and MapCameraController) ─────
  const nearbyFlowerRef = useRef<string | null>(null);
  const nearbyMushroomRef = useRef<string | null>(null);
  const nearbyLogRef = useRef<string | null>(null);
  const nearbyIronRef = useRef<string | null>(null);
  const nearbyGlassRef = useRef<string | null>(null);
  const collectingFlowerRef = useRef<string | null>(null);
  const collectingMushroomRef = useRef<string | null>(null);
  const collectingLogRef = useRef<string | null>(null);
  const collectingIronRef = useRef<string | null>(null);
  const collectingGlassRef = useRef<string | null>(null);
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
  const onPlayerXpGainRef = useRef(onPlayerXpGain);
  onPlayerXpGainRef.current = onPlayerXpGain;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;
  const localHeroInventoryRef = useRef(localHeroInventory);
  localHeroInventoryRef.current = localHeroInventory;
  // Keep uid in a ref so the unmount cleanup can read it without a stale closure.
  const uidRef = useRef(uid);
  uidRef.current = uid;

  // ── Cancel any in-flight collection animation on unmount ───────────────────
  useEffect(() => {
    return () => {
      if (collectTimerRef.current !== null) cancelAnimationFrame(collectTimerRef.current);
    };
  }, []);

  // ── Force-save inventory on unmount (bypasses saveProgress throttle) ────────
  useEffect(() => {
    return () => {
      const uid = uidRef.current;
      // Always flush — even an empty inventory (all items used) should be persisted.
      if (!uid) return;
      updateDoc(doc(db, 'players', uid), {
        'progress.heroInventory': localHeroInventoryRef.current,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    };
  }, []);

  // ── Re-sync inventory from Firestore if profile loads after mount ──────────
  // (guards against the case where profile was null when component mounted)
  // Keep pet inventory in a ref so the re-sync effect uses the latest value (no stale closure).
  const localPetInventoryRef = useRef(localPetInventory);
  localPetInventoryRef.current = localPetInventory;

  const profileSyncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!profile?.uid || profileSyncedRef.current === profile.uid) return;
    profileSyncedRef.current = profile.uid;
    if (localHeroInventoryRef.current.length === 0 && profile.progress?.heroInventory?.length) {
      const saved = profile.progress.heroInventory as InventoryItem[];
      localHeroInventoryRef.current = saved;
      setLocalHeroInventory(saved);
    }
    if (localPetInventoryRef.current.length === 0 && profile.progress?.petInventory?.length) {
      setLocalPetInventory(profile.progress.petInventory as InventoryItem[]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid]);

  // ── Sync "nearby" refs whenever state changes ─────────────────────────────
  useEffect(() => {
    nearbyFlowerRef.current = nearbyFlower;
    nearbyMushroomRef.current = nearbyMushroom;
    nearbyLogRef.current = nearbyLog;
    nearbyIronRef.current = nearbyIron;
    nearbyGlassRef.current = nearbyGlass;
    collectingFlowerRef.current = collectingFlower;
    collectingMushroomRef.current = collectingMushroom;
    collectingLogRef.current = collectingLog;
    collectingIronRef.current = collectingIron;
    collectingGlassRef.current = collectingGlass;
  }, [nearbyFlower, nearbyMushroom, nearbyLog, nearbyIron, nearbyGlass, collectingFlower, collectingMushroom, collectingLog, collectingIron, collectingGlass]);

  // ── Generate collectibles when tiles load ─────────────────────────────────
  useEffect(() => {
    if (tiles.length === 0) return;
    const flowers = new Set<string>();
    const mushrooms = new Set<string>();
    const logs = new Set<string>();
    const irons = new Set<string>();
    const glasses = new Set<string>();
    for (const t of tiles) {
      const k = `${t.q},${t.r}`;
      if (t.type === 'plains'  && Math.random() < 0.08) flowers.add(k);
      if (t.type === 'forest'  && Math.random() < 0.20) mushrooms.add(k);
      if (t.type === 'forest'  && Math.random() < 0.15) logs.add(k);
      if (t.type === 'hills'   && Math.random() < 0.18) irons.add(k);
      if (t.type === 'desert'  && Math.random() < 0.15) glasses.add(k);
    }
    setCollectibleFlowers(flowers);
    setCollectibleMushrooms(mushrooms);
    setCollectibleLogs(logs);
    setCollectibleIrons(irons);
    setCollectibleGlasses(glasses);
    console.log('[collectibles] Generated', flowers.size, 'flowers,', mushrooms.size, 'mushrooms,', logs.size, 'logs,', irons.size, 'iron,', glasses.size, 'glass');
  }, [tiles]);

  // ── Collision detection: which tile has the hero? ─────────────────────────
  useEffect(() => {
    const key = `${heroQ},${heroR}`;
    setNearbyFlower(collectibleFlowers.has(key) ? key : null);
    setNearbyMushroom(collectibleMushrooms.has(key) ? key : null);
    setNearbyLog(collectibleLogs.has(key) ? key : null);
    setNearbyIron(collectibleIrons.has(key) ? key : null);
    setNearbyGlass(collectibleGlasses.has(key) ? key : null);
  }, [collectibleFlowers, collectibleMushrooms, collectibleLogs, collectibleIrons, collectibleGlasses, heroQ, heroR]);

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
    (flowerKey: string | null, mushroomKey: string | null, logKey: string | null = null, ironKey: string | null = null, glassKey: string | null = null) => {
      if (collectingFlowerRef.current || collectingMushroomRef.current || collectingLogRef.current || collectingIronRef.current || collectingGlassRef.current) return;

      const isFlower   = !!flowerKey;
      const isMushroom = !flowerKey && !!mushroomKey;
      const isLog      = !flowerKey && !mushroomKey && !!logKey;
      const isIron     = !flowerKey && !mushroomKey && !logKey && !!ironKey;
      const isGlass    = !flowerKey && !mushroomKey && !logKey && !ironKey && !!glassKey;
      const targetKey  = flowerKey || mushroomKey || logKey || ironKey || glassKey;
      if (!targetKey) return;

      if (isFlower)        { collectingFlowerRef.current   = targetKey; setCollectingFlower(targetKey); }
      else if (isMushroom) { collectingMushroomRef.current = targetKey; setCollectingMushroom(targetKey); }
      else if (isLog)      { collectingLogRef.current      = targetKey; setCollectingLog(targetKey); }
      else if (isIron)     { collectingIronRef.current     = targetKey; setCollectingIron(targetKey); }
      else if (isGlass)    { collectingGlassRef.current    = targetKey; setCollectingGlass(targetKey); }
      setCollectingProgress(0);

      const startTime = performance.now();
      const DURATION = 1200;

      const animate = (now: number) => {
        const progress = Math.min(1, (now - startTime) / DURATION);
        setCollectingProgress(progress);
        if (progress < 1) { collectTimerRef.current = requestAnimationFrame(animate); return; }

        // ── Collection complete ──────────────────────────────────────────
        const addItem = (type: InventoryItem['type'], icon: string, effect: InventoryItem['effect'], value: number) => {
          const prev = localHeroInventoryRef.current;
          const existing = prev.find(i => i.type === type);
          const updated: InventoryItem[] = existing
            ? prev.map(i => (i.type === type ? { ...i, quantity: i.quantity + 1 } : i))
            : [...prev, { id: `${type}-${targetKey}`, type, quantity: 1, effect, value, icon }];
          localHeroInventoryRef.current = updated;
          setLocalHeroInventory(updated);
          saveProgressRef.current({ heroInventory: updated });
        };

        if (isFlower) {
          setCollectibleFlowers(prev => { const n = new Set(prev); n.delete(targetKey); return n; });
          addItem('flower', '🌸', 'heal', 20);
          onHealHPRef.current?.(20);
          collectingFlowerRef.current = null; setCollectingFlower(null); setNearbyFlower(null);
          onPlayerXpGainRef.current?.(1);
        } else if (isMushroom) {
          setCollectibleMushrooms(prev => { const n = new Set(prev); n.delete(targetKey); return n; });
          addItem('herb', '🍄', 'buff', 5);
          onRestoreEPRef.current?.(5);
          collectingMushroomRef.current = null; setCollectingMushroom(null); setNearbyMushroom(null);
          onPlayerXpGainRef.current?.(1);
        } else if (isLog) {
          setCollectibleLogs(prev => { const n = new Set(prev); n.delete(targetKey); return n; });
          addItem('wood', '🪵', undefined, 1);
          collectingLogRef.current = null; setCollectingLog(null); setNearbyLog(null);
          onPlayerXpGainRef.current?.(3);
        } else if (isIron) {
          setCollectibleIrons(prev => { const n = new Set(prev); n.delete(targetKey); return n; });
          addItem('iron', '⚙️', undefined, 1);
          collectingIronRef.current = null; setCollectingIron(null); setNearbyIron(null);
          onPlayerXpGainRef.current?.(3);
        } else if (isGlass) {
          setCollectibleGlasses(prev => { const n = new Set(prev); n.delete(targetKey); return n; });
          addItem('glass', '💎', undefined, 1);
          collectingGlassRef.current = null; setCollectingGlass(null); setNearbyGlass(null);
          onPlayerXpGainRef.current?.(3);
        }
        setCollectingProgress(0);
      };

      collectTimerRef.current = requestAnimationFrame(animate);
    },
    [],
  );

  // ── handleItemUse: called on '1'–'8' key press ────────────────────────────
  const itemSlotsRef = useRef(itemSlots);
  itemSlotsRef.current = itemSlots;

  const handleItemUse = useCallback((slotIndex: number) => {
    const slot = itemSlotsRef.current[slotIndex];
    if (!slot || (slot.qty ?? 0) <= 0 || !slot.icon) return;

    const itemType = slot.id.split('-')[0];
    const updated = localHeroInventoryRef.current
      .map(inv => (inv.type === itemType && inv.quantity > 0 ? { ...inv, quantity: inv.quantity - 1 } : inv))
      .filter(inv => inv.quantity > 0);
    localHeroInventoryRef.current = updated;
    setLocalHeroInventory(updated);
    saveProgressRef.current({ heroInventory: updated });
    if (itemType === 'flower') onHealHPRef.current?.(20);
    else if (itemType === 'herb') onRestoreEPRef.current?.(5);
  }, []);

  // ── Return ────────────────────────────────────────────────────────────────
  return {
    collectibleFlowers, collectibleMushrooms, collectibleLogs, collectibleIrons, collectibleGlasses,
    nearbyFlower, nearbyMushroom, nearbyLog, nearbyIron, nearbyGlass,
    collectingFlower, collectingMushroom, collectingLog, collectingIron, collectingGlass,
    collectingProgress,
    nearbyFlowerRef, nearbyMushroomRef, nearbyLogRef, nearbyIronRef, nearbyGlassRef,
    collectingFlowerRef, collectingMushroomRef, collectingLogRef, collectingIronRef, collectingGlassRef,
    collectTimerRef,
    localHeroInventory, setLocalHeroInventory,
    localHeroInventoryRef,
    localPetInventory, setLocalPetInventory,
    itemSlots, setItemSlots,
    handleCollect,
    handleItemUse,
  };
}
