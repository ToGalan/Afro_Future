/**
 * useRefugeeCamps — friendly/rival settlements that drive faction-specific side
 * missions + resource logistics (GDD: "healing affected areas", "faction-specific
 * missions", "resource management", inter-faction conflict).
 *
 * Each camp is aligned to one of the three factions. Your relationship to it depends
 * on your own faction:
 *   - Your OWN faction's camp  → AID  : collect + DELIVER a stockpile of your
 *                                       faction's resource (go gather, then return).
 *   - A RIVAL faction's camp   → LOOT : take the rival's resources by force
 *                                       (e.g. WC "Survival at Any Cost" loots the PAA).
 *
 * Aid builds standing (XP + Faction Points); loot nets resources + XP but is a
 * hostile act against the rival faction.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ResourceType } from './useCollectibles';

type TileType = 'water' | 'desert' | 'plains' | 'forest' | 'jungle' | 'hills' | 'mountain';
interface MinTile { q: number; r: number; type: TileType }

export type FactionKey = 'PAA' | 'ASF' | 'WC';

export interface RefugeeMission { title: string; desc: string; verb: string; icon: string; }

export interface RefugeeCamp {
  key: string; q: number; r: number;
  campFaction: FactionKey;
  mode: 'aid' | 'loot';
  mission: RefugeeMission;
  /** AID: what the player must deliver. */
  required: { resource: ResourceType; amount: number };
  /** AID: how much has been delivered so far. */
  delivered: number;
  /** LOOT: what the player seizes on completion. */
  loot: { resource: ResourceType; amount: number };
  reward: { xp: number; fp: number };
  completed: boolean;
}

// What each faction stockpiles / values as its strategic resource.
const FACTION_RESOURCE: Record<FactionKey, ResourceType> = { PAA: 'bio', ASF: 'ore', WC: 'energy' };
const FACTION_NAME: Record<FactionKey, string> = {
  PAA: 'Pan-African Alliance', ASF: 'African Sovereign Front', WC: 'World Coalition',
};
// Aid mission flavour + required delivery (your own faction's camp).
const AID_MISSION: Record<FactionKey, RefugeeMission & { amount: number }> = {
  PAA: { title: 'Heal the Camp', desc: 'Deliver medical supplies to the wounded', verb: 'Deliver', icon: '✚', amount: 5 },
  ASF: { title: 'Fortify the Camp', desc: 'Deliver fortification materials', verb: 'Deliver', icon: '🛡️', amount: 5 },
  WC:  { title: 'Resupply the Camp', desc: 'Deliver power cells to the survivors', verb: 'Deliver', icon: '📦', amount: 6 },
};
// How each player faction treats a RIVAL faction's camp.
const LOOT_STANCE: Record<FactionKey, { verb: string; icon: string }> = {
  PAA: { verb: 'Pacify', icon: '🕊️' },   // non-lethal: disperse & requisition
  ASF: { verb: 'Raid', icon: '💥' },      // guerrilla strike
  WC:  { verb: 'Loot', icon: '🔥' },      // survival at any cost
};

function axialDist(aq: number, ar: number, bq: number, br: number): number {
  return (Math.abs(aq - bq) + Math.abs(ar - br) + Math.abs(aq + ar - bq - br)) / 2;
}
function hash(q: number, r: number): number {
  return Math.abs(Math.sin(q * 57.13 + r * 19.71) * 51237.19) % 1;
}
export function factionKey(f?: string): FactionKey {
  const k = (f || '').toUpperCase();
  if (k.includes('SOVEREIGN') || k === 'ASF') return 'ASF';
  if (k.includes('COALITION') || k === 'WC') return 'WC';
  return 'PAA';
}

interface UseRefugeeCampsOptions {
  tiles: MinTile[];
  heroQ: number;
  heroR: number;
  centerQ: number;
  centerR: number;
  faction?: string;
  /** Fired when a camp mission is resolved. `approach` is HOW the player chose to resolve
   *  it — aid (help), negotiate (diplomacy), or loot (force) — so the caller can apply the
   *  right reward, reputation, and consequences. */
  onComplete?: (camp: RefugeeCamp, approach: 'aid' | 'negotiate' | 'loot') => void;
}

export function useRefugeeCamps({ tiles, heroQ, heroR, centerQ, centerR, faction, onComplete }: UseRefugeeCampsOptions) {
  const [camps, setCamps] = useState<Map<string, RefugeeCamp>>(new Map());
  const [nearbyCamp, setNearbyCamp] = useState<RefugeeCamp | null>(null);

  const campsRef = useRef(camps); campsRef.current = camps;
  const heroRef = useRef({ q: heroQ, r: heroR }); heroRef.current = { q: heroQ, r: heroR };
  const onCompleteRef = useRef(onComplete); onCompleteRef.current = onComplete;

  const me = factionKey(faction);

  // Generate camps once tiles load — a small set, spread out, away from spawn. Each is
  // aligned to a faction (deterministic), which decides aid vs loot for this player.
  useEffect(() => {
    if (!tiles.length) return;
    const m = new Map<string, RefugeeCamp>();
    const FKS: FactionKey[] = ['PAA', 'ASF', 'WC'];
    for (const t of tiles) {
      if (t.type === 'water' || t.type === 'mountain') continue;
      const dist = axialDist(t.q, t.r, centerQ, centerR);
      if (dist < 4) continue;
      const h = hash(t.q, t.r);
      if (h >= 0.014) continue;                          // ~1.4% of eligible tiles
      const campFaction = FKS[Math.floor(hash(t.q * 3 + 1, t.r * 7 + 2) * 3) % 3];
      const mode: 'aid' | 'loot' = campFaction === me ? 'aid' : 'loot';
      let mission: RefugeeMission;
      let required: { resource: ResourceType; amount: number };
      let loot: { resource: ResourceType; amount: number };
      let reward: { xp: number; fp: number };
      if (mode === 'aid') {
        const a = AID_MISSION[me];
        mission = { title: a.title, desc: a.desc, verb: a.verb, icon: a.icon };
        required = { resource: FACTION_RESOURCE[me], amount: a.amount };
        loot = { resource: FACTION_RESOURCE[me], amount: 0 };
        reward = { xp: 40, fp: 6 };
      } else {
        const s = LOOT_STANCE[me];
        mission = { title: `${s.verb} ${FACTION_NAME[campFaction]} Camp`, desc: `Seize the ${FACTION_NAME[campFaction]}'s cache`, verb: s.verb, icon: s.icon };
        required = { resource: FACTION_RESOURCE[campFaction], amount: 0 };
        loot = { resource: FACTION_RESOURCE[campFaction], amount: 3 };
        reward = { xp: 28, fp: 3 };
      }
      m.set(`${t.q},${t.r}`, { key: `${t.q},${t.r}`, q: t.q, r: t.r, campFaction, mode, mission, required, delivered: 0, loot, reward, completed: false });
    }
    setCamps(m);
    console.log('[refugee] Generated', m.size, `camps (player ${me})`);
  }, [tiles, centerQ, centerR, me]);

  const engagedKey = useCallback((): string | null => {
    const { q, r } = heroRef.current;
    for (const c of campsRef.current.values()) {
      if (c.completed) continue;
      if (axialDist(q, r, c.q, c.r) <= 1) return c.key;
    }
    return null;
  }, []);

  useEffect(() => {
    const key = engagedKey();
    setNearbyCamp(key ? (campsRef.current.get(key) ?? null) : null);
  }, [camps, heroQ, heroR, engagedKey]);

  // AID: deliver up to `available` units toward the requirement. Returns how many were
  // accepted (the caller consumes exactly that many from inventory) and whether the
  // mission is now complete.
  const deliverToNearby = useCallback((available: number): { accepted: number; completed: boolean } | null => {
    const key = engagedKey();
    if (!key) return null;
    const c = campsRef.current.get(key);
    if (!c || c.completed || c.mode !== 'aid') return null;
    const need = Math.max(0, c.required.amount - c.delivered);
    const accepted = Math.max(0, Math.min(available, need));
    if (accepted <= 0) return { accepted: 0, completed: false };
    const delivered = c.delivered + accepted;
    const completed = delivered >= c.required.amount;
    const done: RefugeeCamp = { ...c, delivered, completed };
    const next = new Map(campsRef.current); next.set(key, done);
    setCamps(next);
    if (completed) { onCompleteRef.current?.(done, 'aid'); console.log(`[refugee] Aid complete at ${key}`); }
    return { accepted, completed };
  }, [engagedKey]);

  // LOOT: seize the rival camp by force in one action (rich reward, provokes defenders).
  const lootNearby = useCallback((): RefugeeCamp | null => {
    const key = engagedKey();
    if (!key) return null;
    const c = campsRef.current.get(key);
    if (!c || c.completed || c.mode !== 'loot') return null;
    const done: RefugeeCamp = { ...c, completed: true };
    const next = new Map(campsRef.current); next.set(key, done);
    setCamps(next);
    onCompleteRef.current?.(done, 'loot');
    console.log(`[refugee] Looted ${c.campFaction} camp at ${key}`);
    return done;
  }, [engagedKey]);

  // NEGOTIATE: resolve a rival camp peacefully (tactical diplomacy) — a modest, safe reward
  // and NO provoked defenders. The GDD-canon alternative to looting.
  const negotiateNearby = useCallback((): RefugeeCamp | null => {
    const key = engagedKey();
    if (!key) return null;
    const c = campsRef.current.get(key);
    if (!c || c.completed || c.mode !== 'loot') return null;
    const done: RefugeeCamp = { ...c, completed: true };
    const next = new Map(campsRef.current); next.set(key, done);
    setCamps(next);
    onCompleteRef.current?.(done, 'negotiate');
    console.log(`[refugee] Negotiated peace with ${c.campFaction} camp at ${key}`);
    return done;
  }, [engagedKey]);

  const progress = useMemo(() => {
    const all = Array.from(camps.values());
    return { done: all.filter(c => c.completed).length, total: all.length };
  }, [camps]);

  return { camps, nearbyCamp, deliverToNearby, lootNearby, negotiateNearby, progress };
}
