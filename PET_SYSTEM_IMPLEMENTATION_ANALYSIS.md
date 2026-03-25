# Afro Future Pet System Implementation Analysis

## Executive Summary

The Afro Future codebase has **partial pet system infrastructure** with several key gaps:

- ✅ XP tracking **already exists** but is NOT persisted to database
- ❌ Pet position tracking is **completely missing**
- ❌ 3D collectibles rendering is **not implemented**
- ✅ Inventory UI placeholder exists but needs backend
- ✅ Hero positioning system is **robust and production-ready**

---

## 1. CURRENT PET TRACKING MECHANISM

### Pet Data Structure

Pet is defined in [src/types/player.ts](src/types/player.ts):

```typescript
// ❌ CURRENT: Minimal pet object
pet?: {
  type?: string;      // Pet type: 'CYBER_DOG', 'CYBER_CAT'
  level: number;      // Pet level (1-based)
}
```

**Storage Location**: Firestore `players/{uid}/progress/pet`

**Who loads it**: [usePlayerProfile.ts](src/hooks/usePlayerProfile.ts#L14) hydrates on app startup

**Where it's managed**:
- Loaded: `usePlayerProfile()` hook
- Displayed: `GameHUD` component
- Modified: `PetPanel` (test component for manual level increment)

### Pet Data Flow

```
Firestore (players/{uid}/progress/pet)
    ↓
usePlayerProfile.saveProgress() 
    ↓
App state → MissionScreen
    ↓
GameHUD (renders pet portrait, stats, inventory UI)
```

---

## 2. CURRENT PET XP TRACKING IMPLEMENTATION

### ⭐ IMPORTANT: XP Tracking Already Exists!

**Location**: [SoloMissionMap3D.tsx (line 1434)](src/components/SoloMissionMap3D.tsx#L1434)

```typescript
// Track tiles moved for pet XP (every 40 tiles = 1 XP)
tilesMoveRef.current++;
if (tilesMoveRef.current >= 40) {
  setPet(p => ({ ...p, xp: (p.xp || 0) + 1 }));
  tilesMoveRef.current = 0;
  console.log('[Pet XP] Pet gained 1 XP! Total XP:', (pet.xp || 0) + 1);
}
```

### How It Works

1. **Tile Movement Tracking**: Every hero movement increments `tilesMoveRef`
2. **XP Gain Rate**: 1 XP per 40 tiles moved
3. **Storage**: Currently in local React state ONLY (`setPet`)
4. **Problem**: ❌ **NOT persisted to Firestore** - lost on page refresh

### What's Missing for Persistence

```typescript
// After gaining XP:
const nextPet = { 
  ...pet, 
  xp: (pet.xp || 0) + 1,
  type: pet.type 
};
// ❌ MISSING: saveProgress({ pet: nextPet });
```

### XP Data Interface (Non-standard)

Pet doesn't have formal interface - XP is duck-typed:
```typescript
interface Pet {
  type?: string;
  level: number;
  xp?: number;  // ❌ Not in official PlayerProgress.pet interface
}
```

---

## 3. ITEM/COLLECTIBLE SYSTEM

### Current Status: **Placeholder Only**

#### In GameHUD
[gameHUD.tsx (line 407)](src/components/gameHUD.tsx#L407):

```typescript
{Array.from({ length: 8 }, (_, i) => {
  const it = itemSlots[i];
  return it
    ? <Slot key={it.id} icon={it.icon || '📦'} hotkey={IT_KEYS[i]} qty={it.qty} ... />
    : <Slot key={`it-e-${i}`} hotkey={IT_KEYS[i]} disabled ... />;
})}
```

**Result**: 8 empty slots with "📦" placeholder icon - no real items

#### In Legacy Code
[src/assets/ref_legacy/js/pet.js (line 307)](src/assets/ref_legacy/js/pet.js#L307):

```javascript
pet.inventory = Array(MAX_PET_INVENTORY_SLOTS).fill(null); // 8 slots

// Items added by defeated enemies:
if (!pet.inventory[i]) { 
  pet.inventory[i] = lootItem;  // { name: 'Scrap', icon: 'img/spells/item.png' }
}
```

### What Doesn't Exist

- ❌ Item types or interfaces in TypeScript
- ❌ Item spawning on the 3D map
- ❌ Collision detection for pickup
- ❌ Inventory persistence to database
- ❌ Item equipment/effects system

---

## 4. INVENTORY SYSTEM STRUCTURE

### Current Architecture

**Location**: Only in UI expectation, not in data layer

```typescript
// In App.tsx (line 623)
const items = React.useMemo(()=> 
  Array.from({length:4}).map((_,i)=>({ 
    id: 'item'+i, 
    icon: '📦', 
    qty: 1, 
    key: ['Q','W','E','R'][i] 
  }))
,[]);
```

**Problem**: These are hardcoded 4 placeholder items, not actual inventory

### Missing Components

1. **Item Type Definition** (needed):
```typescript
interface Item {
  id: string;
  name: string;
  type: 'consumable' | 'equipment' | 'resource' | 'collectible';
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  icon: string;
  effect?: { type: string; value: number };
  qty?: number;
}
```

2. **Inventory in PlayerProgress** (needed):
```typescript
export interface PlayerProgress {
  // ... existing fields
  inventory?: Item[];
  pet?: {
    type?: string;
    level: number;
    xp?: number;
    inventory?: Item[];  // Pet's own inventory
  };
}
```

3. **Collection Mechanics** (needed):
```typescript
// In SoloMissionMap3D hero movement:
const collectiblesAtTile = tiles[heroPos.q][heroPos.r].collectibles;
collectiblesAtTile?.forEach(item => {
  inventory.push(item);
  saveProgress({ inventory });
});
```

---

## 5. HERO/AVATAR POSITIONING IN 3D SCENE

### Hero Position Data Structure

```typescript
// Hex axial coordinates (cube coordinate system)
interface Axial { 
  q: number; 
  r: number; 
}

// Stored in both session and profile
heroPosition: { q: number; r: number }
```

### Position Tracking Architecture

#### Session Tracking (Real-time)
**File**: [usePlayerSession.ts](src/hooks/usePlayerSession.ts)

- **Path**: Firestore RTDB `sessions/{uid}/{sessionId}/heroPosition`
- **Update rate**: Throttled via `POSITION_INTERVAL_*` constants
  - `POSITION_INTERVAL_FAST = 120ms` (during active movement)
  - `POSITION_INTERVAL_SLOW = 500ms` (idle)
  - `POSITION_INTERVAL_HIDDEN = 1500ms` (tab hidden)
- **Force refresh**: Every 5 seconds minimum

```typescript
const updateHeroPosition = useCallback((pos: { q: number; r: number }) => {
  // Checks if position changed
  // Decides interval based on movement recency
  // Throttles update to RTDB
  rtdbHelpers.update(sessionRef, { heroPosition: pos, lastActive: now, connected: true });
}, [session]);
```

#### Profile Tracking (Persistent)
**File**: [SoloMissionMap3D.tsx](src/components/SoloMissionMap3D.tsx#L1500)

```typescript
// Clamped to valid tiles, then saved
saveProgress({ heroPosition: clamped });
```

- Stores player's last-known position to Firestore
- Allows resuming from same location after reload

### 3D World Coordinate Conversion

**File**: [SoloMissionMap3D.tsx](src/components/SoloMissionMap3D.tsx#L57-68)

```typescript
function axialToWorld(a: Axial, R_outer: number) {
  // Flat-top hex layout (default)
  const x = R_outer * (1.5 * a.q);
  const z = R_outer * (Math.sqrt(3) * (a.r + a.q / 2));
  return { x, z };
}

// Usage in hero rendering:
const { x: worldX, z: worldZ } = axialToWorld(heroPos, hexSize);
```

**Constants**:
- `hexSize = 1.0 * MAP_SCALE` (currently 3.0)
- Apothem (edge distance): `hexApothem(R) = R * cos(π/6)`

### Avatar 3D Rendering

**File**: [GameAvatarMesh.tsx](src/components/GameAvatarMesh.tsx)

```typescript
export function GameAvatar({ 
  heroModelUrl, 
  heroParts, 
  heroColors, 
  hexSize 
}: { ... }) {
  return (
    <group 
      ref={containerRef} 
      position={[0, hexSize * 0.45 * 64, 0]}  // Y = 86.4 (visual height)
      renderOrder={100}  // Render on top
      frustumCulled={false}
    >
      {/* Avatar mesh (GLB or assembled parts) */}
      {heroModelUrl ? <GLBAvatarMesh /> : <AssembledAvatarMesh />}
    </group>
  );
}
```

**Key Details**:
- **Height offset**: `hexSize * 0.45` lifts avatar center ~28.8 units above tile
- **Render order**: 100 ensures avatar stays visible
- **Frustum culling**: Disabled to prevent accidental culling
- **Y-position**: Avatar feet anchored to y=0 during load

### Movement Validation

**File**: [SoloMissionMap3D.tsx](src/components/SoloMissionMap3D.tsx#L1500)

```typescript
function onKey(e: KeyboardEvent) {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key.toLowerCase())) 
    return;

  const next = { ...heroPos };
  // Move hero in hex direction (adjust q/r based on key)
  // Clamp to valid tiles (non-mountain, non-water)
  
  // 1. Save to profile
  saveProgress({ heroPosition: clamped });
  
  // 2. Update session in real-time
  updateHeroPosition(clamped);
  
  // 3. Track tiles for pet XP
  tilesMoveRef.current++;
  if (tilesMoveRef.current >= 40) {
    setPet(p => ({ ...p, xp: (p.xp || 0) + 1 }));
    tilesMoveRef.current = 0;
  }
}
```

---

## 6. MISSION MAP RENDERING OF COLLECTIBLE ITEMS/ACTORS

### Current Map Structure

**File**: [SoloMissionMap3D.tsx](src/components/SoloMissionMap3D.tsx)

```typescript
// Tile definition
interface Tile extends Axial {
  type: TileType;        // 'water', 'desert', 'plains', 'forest', 'jungle', 'hills', 'mountain'
  resource: ResourceType; // ❌ Currently always null (disabled)
  char: TerrainChar;     // Terrain character ('P', 'L', 'F', 'J', etc.)
}
```

### Where Rendering Happens

#### Tile Components (Geographic Features)

```typescript
<HexTile t={tile} size={hexSize} onClick={...} />
  ├─ HexTileGeometry (base hex mesh)
  └─ {tile.type === 'plains' && <GrassCluster />}
  └─ {tile.type === 'water' && <WaterWaves />}
  └─ {tile.type === 'mountain' && <RefMountain />}
  └─ {tile.type === 'forest' && <RefTree />}
  └─ {tile.type === 'desert' && <DesertDunes />}
```

#### What's Currently Rendered

**Grass/Plains Tiles**:
```typescript
function GrassCluster({ size, seed }: { size: number; seed?: number }) {
  // 4-7 grass tufts + occasional 30% flowers per tile
  // Flowers: stem + leaves + 4-petal flower head + yellow center
  // Leaf tufts: 3 pointy cones (Pokemon-style)
}
```

**Result**: Cute procedurally-generated plants, perfect base for collectibles!

### Where to Add Collectibles

**Integration Point**: Inside `<HexTile>` component

```typescript
function HexTile({ t, size, onClick, onHover }: { t: Tile; ... }) {
  return (
    <group position={[0, heightFor(t) / 2, 0]}>
      {/* Base hex geometry */}
      <mesh ... >
        <cylinderGeometry args={[size, size, heightFor(t), 6]} />
      </mesh>
      
      {/* Terrain overlay */}
      {t.type === 'plains' && <GrassCluster size={size} seed={hash2(t.q, t.r)} />}
      
      {/* ✨ ADD COLLECTIBLES HERE */}
      {t.collectibles?.map(c => (
        <Collectible 
          key={c.id}
          type={c.type}
          position={c.position}
          size={size}
          seed={c.seed}
        />
      ))}
    </group>
  );
}
```

### Recommended Collectible Rendering Approach

**Strategy**: Extend existing GrassCluster flower rendering

```typescript
interface Collectible {
  id: string;
  type: 'flower' | 'crystal' | 'resource';
  position: [number, number, number];  // Local offset within hex
  seed: number;
}

function PlantFlower({ 
  position, 
  size, 
  seed,
  variant?: 'yellow' | 'pink' | 'purple' | 'red'
}: { ... }) {
  // Render enhanced flower (taller, glowing, interactive)
  // Similar to GrassCluster flower but with:
  // - Distinctive glow/shimmer
  // - Hover feedback
  // - Bounding box for collision
}
```

### Easy Addition: Flower Collection Points

Since `GrassCluster` already renders flowers, you could:

1. **Mark flowers from cluster as collectible**:
```typescript
// In tile generation:
tile.collectibles = [
  { id: 'flower-1', type: 'flower', position: [...flower_from_cluster...], seed: 42 },
];
```

2. **Add glow effect to collectible flowers**:
```typescript
<mesh>
  <sphereGeometry args={[S * 0.065 * p.s, 4, 3]} />
  <meshStandardMaterial 
    color={p.petalColor} 
    emissive={p.petalColor}  // Makes it glow!
    emissiveIntensity={0.5}
  />
</mesh>
```

---

## 7. PET VISUAL COMPONENTS AND POSITIONING

### Current Pet Visual in HUD

**File**: [gameHUD.tsx (line 390-410)](src/components/gameHUD.tsx#L390-410)

```typescript
{pet && (
  <div className="flex gap-2 items-center">
    {/* Pet portrait with XP ring */}
    <div style={{
      width: 117, height: 117,
      background: `conic-gradient(#f59e0b ${pct(pet.xp?.current ?? 0, pet.xp?.max ?? 100) * 360}deg, rgba(255,255,255,0.10) 0deg)`,
      borderRadius: 15,
      padding: 4,
    }}>
      <img src={pet.portraitUrl} alt={pet.name} />
    </div>
    
    {/* HP bar */}
    <Bar value={pet.hp.current} max={pet.hp.max} color="bg-lime-400" />
    
    {/* EP bar */}
    <Bar value={pet.ep.current} max={pet.ep.max} color="bg-cyan-400" />
    
    {/* Level badge */}
    <div>Lv {pet.level}</div>
    
    {/* Inventory: 8 slots */}
    {Array.from({ length: 8 }, (_, i) => <Slot ... />)}
  </div>
)}
```

### ❌ Critical Missing: Pet 3D Positioning

**Current Problem**: 
- Hero rendered on map at hex position
- Pet has NO 3D position (only HUD display)
- Pet should follow hero or be positioned separately

### Where Pet Should be Rendered

**File**: [SoloMissionMap3D.tsx](src/components/SoloMissionMap3D.tsx) (need to add)

```typescript
// ❌ MISSING: Pet position tracking
const petPos = session?.petPosition || heroPos;  // Default to hero

// ❌ MISSING: Pet 3D rendering
if (petPos) {
  const { x: petWorldX, z: petWorldZ } = axialToWorld(petPos, hexSize);
  return (
    <group position={[petWorldX, hexSize * 0.35, petWorldZ]}>
      <GameAvatar 
        heroParts={petParts}  // Pet-specific parts
        heroColors={petColors}
        hexSize={hexSize * 0.7}  // Smaller than hero
      />
    </group>
  );
}
```

### Pet Position Data (Need to Add)

**Add to PlayerSession** ([usePlayerSession.ts](src/hooks/usePlayerSession.ts)):

```typescript
export interface PlayerSession {
  sessionId: string;
  uid: string;
  heroPosition: { q: number; r: number };
  petPosition?: { q: number; r: number };  // ❌ ADD THIS
  lastActive: number;
  connected: boolean;
  startedAt: number;
}
```

**Add to PlayerProgress** ([types/player.ts](src/types/player.ts)):

```typescript
export interface PlayerProgress {
  heroPosition: { q: number; r: number };
  pet?: {
    type?: string;
    level: number;
    xp?: number;
    position?: { q: number; r: number };  // ❌ ADD THIS
  };
  // ... rest
}
```

---

## QUICK IMPLEMENTATION PATH FOR XP TRACKING TIED TO TILE MOVEMENT

### Step 1: Save XP to Profile (30 minutes)

**File**: [SoloMissionMap3D.tsx](src/components/SoloMissionMap3D.tsx#L1434)

```typescript
// Replace local setPet with profile save:
tilesMoveRef.current++;
if (tilesMoveRef.current >= 40) {
  const nextXp = (pet.xp || 0) + 1;
  setPet(p => ({ ...p, xp: nextXp, type: pet.type }));
  
  // ✅ SAVE TO PROFILE
  saveProgress({ 
    pet: { 
      ...pet, 
      xp: nextXp,
      level: pet.level  // Keep level
    } 
  });
  
  tilesMoveRef.current = 0;
  console.log('[Pet XP] Pet gained 1 XP! Total XP:', nextXp);
}
```

### Step 2: Add XP to Pet Interface (10 minutes)

**File**: [src/types/player.ts](src/types/player.ts#L14)

```typescript
export interface PlayerProgress {
  // ... existing fields
  pet?: {
    type?: string;
    level: number;
    xp?: number;  // ✅ ADD THIS
  };
}
```

### Step 3: Display XP Progress (20 minutes)

**Already exists in GameHUD!** [gameHUD.tsx (line 396)](src/components/gameHUD.tsx#L396)

```typescript
<div className="text-[10px] text-amber-400/70">
  XP {pet.xp?.current ?? 0}/{pet.xp?.max ?? 100}
</div>
```

Just ensure pet object passed to GameHUD includes xp field.

### Step 4: Enable XP Leveling (1 hour)

```typescript
// In SoloMissionMap3D after XP gain:
const XP_PER_LEVEL = 100;
if (nextXp >= XP_PER_LEVEL) {
  const newLevel = pet.level + 1;
  saveProgress({
    pet: {
      type: pet.type,
      level: newLevel,
      xp: 0  // Reset XP for next level
    }
  });
  setPet(p => ({ ...p, level: newLevel, xp: 0 }));
}
```

---

## WHERE TO ADD COLLECTIBLE PLANT/FLOWER RENDERING

### Option 1: Extend GrassCluster (Recommended)

**Current Code**: [SoloMissionMap3D.tsx (line 1100-1250)](src/components/SoloMissionMap3D.tsx#L1100-L1250)

The `GrassCluster` component already renders flowers with this code:

```typescript
// 30% of plants are flowers
const isFlower = rng() < 0.30;

if (isFlower) {
  // Render stem, leaves, petals, yellow center
  // ✨ These are already collectible-quality!
}
```

**To make them collectible**:

1. **Create wrapper component**:
```typescript
function CollectibleFlower({ 
  position, 
  size, 
  seed,
  onCollect
}: { ... }) {
  const ref = React.useRef<THREE.Mesh>(null);
  
  // Add glow
  const petalColor = flowerColors[Math.floor(rng() * flowerColors.length)];
  
  return (
    <mesh position={position} ref={ref}>
      <sphereGeometry args={[size * 0.065, 4, 3]} />
      <meshStandardMaterial 
        color={petalColor} 
        emissive={petalColor}
        emissiveIntensity={0.7}  // ✨ GLOW
      />
    </mesh>
  );
}
```

2. **Mark flowers for collection**:
```typescript
// In tile generation:
const hasCollectibleFlower = rng() < 0.15;  // 15% flowers collectible
if (hasCollectibleFlower) {
  tile.collectibles = [{
    id: `flower-${seed}`,
    type: 'flower',
    value: 10,  // XP or resource value
    position: [flower_x, flower_y, flower_z]
  }];
}
```

### Option 2: Dedicated Collectible Component

```typescript
function CollectiblePlant({ 
  type, 
  size, 
  seed 
}: { 
  type: 'flower' | 'herb' | 'crystal';
  size: number; 
  seed: number;
}) {
  const rng = seededRand(seed);
  const colors = {
    flower: ['#f9d84a', '#ff8ecb', '#ff6b6b', '#c87dff', '#ffa940'],
    herb: ['#5ecf6a', '#48b856', '#6dda78'],
    crystal: ['#4ab8e8', '#a8dff7', '#c4edfb']
  };
  
  return (
    <group>
      {/* Render collectible with glow + shimmer */}
      <mesh>
        <sphereGeometry args={[size * 0.1, 8, 6]} />
        <meshStandardMaterial
          color={colors[type][Math.floor(rng() * colors[type].length)]}
          emissive={colors[type][0]}
          emissiveIntensity={0.6}
          metalness={type === 'crystal' ? 0.8 : 0.1}
        />
      </mesh>
      
      {/* Animated rotation for visual appeal */}
      {/* Add useFrame for spinning effect */}
    </group>
  );
}
```

### Option 3: Spawn Collectibles Dynamically

```typescript
// After terrain generation, add collectibles to random tiles
function addCollectibles(tiles: Tile[], spawnRate: number = 0.05) {
  for (const tile of tiles) {
    if (rng() < spawnRate && tile.type !== 'mountain' && tile.type !== 'water') {
      tile.collectibles = [{
        id: `item-${tile.q}-${tile.r}`,
        type: 'flower',
        position: [
          (rng() - 0.5) * hexSize,
          0.5,
          (rng() - 0.5) * hexSize
        ]
      }];
    }
  }
}
```

---

## RECOMMENDED IMPLEMENTATION CHECKLIST

### Phase 1: Fix XP Persistence (⏱️ 1 hour)
- [ ] Add `xp?: number` to Pet interface in player.ts
- [ ] Call `saveProgress()` after XP gain in SoloMissionMap3D
- [ ] Test that XP persists after page reload
- [ ] Add XP display to GameHUD (already has UI)

### Phase 2: Pet 3D Rendering (⏱️ 2 hours)
- [ ] Add `petPosition` to PlayerSession interface
- [ ] Update usePlayerSession to sync pet position
- [ ] Add pet rendering to SoloMissionMap3D canvas
- [ ] Position pet near hero (offset or follow)

### Phase 3: Collectible Items (⏱️ 3 hours)
- [ ] Define Item and Collectible types
- [ ] Add collectibles array to Tile type
- [ ] Generate collectibles during map creation (seeded)
- [ ] Create CollectibleFlower/Plant component
- [ ] Render collectibles on tiles with glow effects
- [ ] Add pick-up detection on hero movement
- [ ] Save collected items to pet/player inventory

### Phase 4: XP Leveling (⏱️ 2 hours)
- [ ] Define XP-to-level curve (e.g., 50 + level*25)
- [ ] Auto-level pet when XP threshold reached
- [ ] Increase stats on level (HP, EP, damage)
- [ ] Add level-up notification
- [ ] Persist level changes to profile

### Phase 5: Polish (⏱️ 2 hours)
- [ ] Add visual feedback for XP gain (float text)
- [ ] Add collection animation for items
- [ ] Implement pet ability buffs/scaling with level
- [ ] Add pet movement with hero (lead/lag)

---

## FILE CHANGE SUMMARY

### Files to Create
- `src/types/collectible.ts` - Item and Collectible types
- `src/components/CollectibleFlower.tsx` - Flower rendering
- `src/utils/collectibleGeneration.ts` - Spawn logic

### Files to Modify

1. **src/types/player.ts**
   - Add `xp?: number` to Pet interface
   - Add `petPosition?: { q: number; r: number }` to Player
   - Add `inventory?: Item[]` to PlayerProgress

2. **src/components/SoloMissionMap3D.tsx**
   - Add `collectibles` array to Tile interface
   - Call `saveProgress()` after pet XP gain
   - Generate collectibles during map creation
   - Render pet avatar at petPos
   - Detect collisions for item pickup

3. **src/hooks/usePlayerSession.ts**
   - Add `petPosition` to PlayerSession interface
   - Sync pet position to RTDB

4. **src/components/gameHUD.tsx**
   - Display XP in ring format (already has code)
   - Show pet level
   - Display inventory (skeleton exists)

5. **src/components/GameAvatarMesh.tsx**
   - (No changes needed - already supports pet variant)

---

## CONCLUSION

**Current Implementation Status**:
- ✅ Heroes positioned and tracked perfectly
- ✅ XP calculation already happening (just not saved)
- ❌ Pet positioning completely missing
- ❌ Collectibles not implemented
- ⚠️ Inventory system placeholder only

**Quick Win**: Persist XP in 1 hour = immediate gameplay progression
**Next Priority**: Pet 3D rendering = visual feedback
**Final Goal**: Collectible items = exploration rewards system

