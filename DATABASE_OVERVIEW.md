# 🏛️ Afro Future Database Architecture Overview

## Database Setup

The game uses **Firebase** with two complementary databases:

### 1. **Firestore** (Primary Storage)
- **Collection:** `players/{uid}`  
- **Purpose:** Persistent player profiles and progress
- **Write Pattern:** Throttled (1.5s) batch writes
- **Size:** ~2-5KB per profile

### 2. **Realtime Database** (Live Data)
- **Path:** `sessions/{uid}/{sessionId}`
- **Purpose:** Live player presence and position tracking  
- **Write Pattern:** Adaptive throttling (120ms-1500ms)
- **Size:** ~200-500 bytes per session

---

## 📊 Data Schemas

### Firestore Player Profile Schema
```typescript
interface PlayerProfile {
  uid: string;                    // Firebase user ID
  displayName?: string;           // Google/email display name
  email?: string;                // User email address (saved from auth)
  avatarUrl?: string;            // Profile picture URL
  faction?: string;              // Player's chosen faction
  createdAt: number;             // Profile creation timestamp
  progress: {
    // Hero state
    heroPosition: { q: number; r: number };        // Hex coordinates
    lastLogin: number;                             // Last activity timestamp
    explored?: string[];                           // Discovered map tiles ["0,0", "1,-1"]
    
    // Character progression
    hero: {
      level: number;                               // 1-100 (AUTO-SYNCED from skill store)
      traits: string[];                           // Derived abilities (AUTO-SYNCED)
      unlockedSkillIds: string[];                 // Skill tree nodes (AUTO-SYNCED)
      unlockOrder: string[];                      // Chronological unlock sequence (AUTO-SYNCED)
    };
    
    // Pet progression
    pet: {
      type?: string;                              // Pet archetype
      level: number;                              // Pet level 1-50 (saved via PetPanel)
    };
    
    // Economy
    skillTokens: {
      earned: number;                             // Total tokens earned (AUTO-SYNCED)
      spent: number;                              // Total tokens used (AUTO-SYNCED)
      remaining: number;                          // Available to spend (AUTO-SYNCED)
    };
    
    // Customization
    avatar: {
      parts: Record<string, string>;              // 3D model parts (saved via character creator)
      colors: {                                   // Color customization (saved via character creator)
        primary: string;                          // Main outfit color
        secondary: string;                        // Accent color  
        skin: string;                            // Skin tone
      };
      updatedAt: number;                          // Last customization change
    };
  }
}
```

### RTDB Session Schema
```typescript
interface PlayerSession {
  sessionId: string;                    // Unique session identifier
  uid: string;                         // Links to Firestore profile
  heroPosition: { q: number; r: number }; // Current hex position (live)
  lastActive: number;                  // Heartbeat timestamp
  connected: boolean;                  // Online/offline status
  startedAt: number;                   // Session creation time
  
  // Enhanced metadata (optional)
  isAnonymous?: boolean;               // Auth state
  displayName?: string;                // User display name
  email?: string;                      // User email
  providerData?: Array<{               // OAuth provider info
    providerId: string;
    uid: string;
    email: string;
    displayName: string;
  }>;
}
```

---

## 🔄 Data Flow Patterns

### Profile Updates (Firestore)
```
User Action → Local State → saveProgress() → [1.5s throttle] → Firestore Write
```

**Triggers:**
- Skill unlocks
- Level progression  
- Avatar customization
- Map exploration
- Hero position (persistent)

**Frequency:** ~1-2 writes per minute during active play

### Position Updates (RTDB)
```
Hero Movement → updateHeroPosition() → [Adaptive throttle] → RTDB Write
```

**Adaptive Throttling Rules:**
- **Active movement:** 120ms (8.3 updates/sec)
- **Idle but visible:** 500ms (2 updates/sec)  
- **Tab hidden:** 1500ms (0.66 updates/sec)
- **Force refresh:** Every 5s regardless
- **Skip redundant:** No write if position unchanged

---

## 📈 Write Hotspots Analysis

Based on code analysis, frequent write operations occur in:

### High Frequency (RTDB)
1. **Hero position updates** - `updateHeroPosition()` 
   - **Location:** `usePlayerSession.ts`
   - **Frequency:** 2-8 times/sec (adaptive)
   - **Data:** `{heroPosition, lastActive, connected}`

2. **Session heartbeat** - Presence maintenance
   - **Frequency:** Every 25 seconds
   - **Data:** `{lastActive, connected, isAnonymous}`

### Medium Frequency (Firestore)  
1. **Progress saves** - `saveProgress()` in `usePlayerProfile.ts`
   - **Frequency:** ~40 times/min (throttled to 1.5s)
   - **Triggers:** Skill unlocks, exploration, avatar changes, pet level ups
   - **Data:** Partial profile progress updates

2. **Skill synchronization** - Auto-sync via `useAutoSyncSkills`
   - **Location:** Skill store subscription with 750ms throttle
   - **Frequency:** After each skill unlock/level up
   - **Data:** Hero level, unlocked skills, skill tokens, traits

3. **Avatar customization** - Character creator saves
   - **Location:** `App.tsx` CharacterCreator component
   - **Trigger:** User saves avatar changes
   - **Data:** 3D model parts, colors, updatedAt timestamp

4. **Pet progression** - Pet level updates
   - **Location:** `PetPanel.tsx` level increment
   - **Trigger:** Pet level up actions
   - **Data:** Pet level and type

### Low Frequency (Firestore)
1. **User profile metadata** - Email, display name updates
   - **Trigger:** Auth state changes, Google sign-in upgrades
   - **Data:** Email, displayName from Firebase Auth
   - **Migration:** Anonymous→authenticated profile transitions

2. **Faction & settings** - Player preferences  
   - **Trigger:** Settings changes, initial character setup
   - **Data:** Faction choice, game preferences

---

## 🧪 Database Test Results

Run the test script to verify connectivity:

```bash
node database-test.js
```

**Expected Output:**
- ✅ Firestore write/read operations
- ✅ RTDB session management  
- ✅ Position update simulation
- ✅ Real-time listener functionality
- 📊 Performance metrics and data sizes

---

## ⚡ Performance Optimizations Implemented

### 1. **Adaptive RTDB Throttling**
- Dynamic intervals based on user activity
- Skip writes when position unchanged  
- Visibility-aware background throttling
- Force refresh prevents stale data

### 2. **Firestore Batching** 
- 1.5s write throttling prevents spam
- Partial updates via merge operations
- Migration handling for auth upgrades

### 3. **Local Caching** (Planned)
- localStorage pre-hydration
- Offline-first profile loading
- Background sync reconciliation

---

## 🔍 Monitoring & Debugging

- **Firebase Console:** Real-time database usage metrics
- **Network Tab:** Write frequency analysis  
- **Console Logs:** Error tracking with codes
- **Performance:** Write latency measurements

---

## 🚀 Next Optimization Targets

1. **Local Storage Cache** - Pre-hydrate profile data
2. **Skill Write Batching** - Queue + flush skill updates  
3. **Worker Offloading** - Move heavy terrain generation
4. **Performance Instrumentation** - Add timing markers