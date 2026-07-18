import React, { useEffect, useState, Suspense, lazy } from 'react';
import { usePlayerProfile } from './hooks/usePlayerProfile';
import { useSkillStore, availablePoints } from './store/skillStore';
import { computeEffectiveStats, STAT_META } from './services/playerStats';
import { getTotalXpForLevel, getXpForNextLevel, getLevelFromXp } from './services/playerExpEconomy';
import { abilitiesForFaction, factionAbilityBonus, type FactionAbility } from './services/factionAbilities';
import { getPetSpecies, derivePetStats, bondTierIndex, bondTierProgress, petAbilitiesWithState, BOND_TIERS } from './services/petSpecies';
import { makeTree, skillIconFor } from './store/skillData';
import { GROUP_ORDER, getVariantsByGroup } from './assets/threeParts';
import { buildAvatarConfig } from './services/avatarConfig';
import AvatarScene from './components/AvatarScene';
import { fetchProducts, type ShopifyProduct } from './services/shopify';
import VariantPreview from './components/VariantPreview';
import { Archetype, CharacterLoadout, Faction, PetType, uid, now } from './types/loadout';
import { CharacterPortrait, FactionIcon, ImageAssets, getCharacterPortrait, PetIcon } from './assets/assetPaths';
import { joinRoom } from './services/realtimeClient';
import { initCRDT, attachCRDTChannel, disposeCRDT } from './services/crdt';
import { useCreatorStore } from './store/creatorStore';
import { initGoogleIdentity, renderGoogleButton, getGoogleClientId } from './services/googleIdentity';
import { signInWithGoogleCredential } from './services/firebase';
import { chromeSyncGet, chromeSyncSet, chromeSyncClear } from './services/chromeSync';
import GoogleSignInButton from './components/auth/GoogleSignInButton';
import SoloMissionMap3D from './components/SoloMissionMap3D';
import GameHUD from './components/gameHUD';
import type { MinimapData } from './components/gameHUD';
import { FACTION_MOTIVATION } from './services/storyline';
import PetPanel from './components/PetPanel';
import { useAutoSyncSkills } from './hooks/useAutoSyncSkills';
import { useSkillsProgress } from './hooks/useSkillsProgress';
import { collectAndRegisterPush } from './services/messaging';

// Lazy-load heavy view components (only loaded when accessed)
const SnowflakeSkillTree = lazy(() => import('./components/SnowflakeSkillTree'));

// Runtime config shape
interface RuntimeConfig { storeDomain: string | null; apiVersion: string; debug: boolean; buildHash?: string | null; }
const APP_VERSION_FALLBACK = 'v0.2.3';

// Default avatar parts so the 3D character renders even before the creator is used.
const DEFAULT_THREE_PARTS: Record<string, string> = {
  Head: 'head_head_001',
  Face: 'face_face_001',
  Eyes: 'eyes_eyes_001',
  Eyebrows: 'eyebrows_eyebrow_001',
  Nose: 'nose_nose_001',
  Hair: 'hair_hair_001',
  Outfit: 'outfit_outfit_001',
  Shoes: 'shoes_shoes_001',
};
const DEFAULT_THREE_COLORS = { primary: '#00A37A', secondary: '#F5F5F5', skin: '#c58b66' };

const defaultLoadout: CharacterLoadout = {
  id: uid('char'),
  name: 'Nia',
  faction: 'PAA',
  level: 1,
  archetype: 'FEMALE',
  body: { height: 'std', build: 'athletic' },
  outfit: { set: 'starter' },
  colors: { primary: '#00A37A', secondary: '#F5F5F5' },
  portraitUrl: CharacterPortrait.FEMALE,
  pet: {
    id: uid('pet'),
    type: 'CYBER_DOG',
    level: 1,
    role: 'SCOUT',
    cosmetics: { pattern: 'grid' },
  },
  threeConfig: { parts: DEFAULT_THREE_PARTS, colors: DEFAULT_THREE_COLORS, summary: {}, updatedAt: Date.now() },
  createdAt: now(),
  updatedAt: now(),
} as any;

export default function App() {
  const { saveProgress: saveProfileProgress } = usePlayerProfile();
  // Auto-sync skill progress to persistent profile
  useAutoSyncSkills(true);
  // Authentication gating: require Google sign-in before proceeding to normal boot sequence.
  const [idToken, setIdToken] = useState<string | null>(() => localStorage.getItem('afrofuture.idToken'));
  const [phase, setPhase] = useState<'auth' | 'boot' | 'onboard' | 'creating' | 'main'>(!localStorage.getItem('afrofuture.idToken') ? 'auth' : 'boot');
  const [rtc, setRtc] = useState<{ ws: WebSocket; pc: RTCPeerConnection; dc: RTCDataChannel } | null>(null);
  const [roomId, setRoomId] = useState<string>(() => localStorage.getItem('afrofuture.room') || 'lobby');
  const [recentRooms, setRecentRooms] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('afrofuture.recentRooms')||'[]'); } catch { return []; }
  });
  const [profile, setProfile] = useState<{ sub: string; name?: string; email?: string; picture?: string; accountLevel?: number } | null>(() => {
    try {
      const raw = localStorage.getItem('afrofuture.profile');
      if(raw) return JSON.parse(raw);
    } catch {}
    return null;
  });
  const [mainView, setMainView] = useState<'dashboard' | 'skills' | 'store' | 'help' | 'settings' | 'mission'>('dashboard');
  // When the player launches from the dashboard's Multiplayer mode, auto-open the duel
  // lobby + quick-match on entering the mission.
  const [launchMultiplayer, setLaunchMultiplayer] = useState(false);
  // Launched from the dashboard's 1v1v1 MOBA mode — auto-open the MOBA lobby.
  const [launchMoba, setLaunchMoba] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playerName] = useState('PlayerOne');
  // Account level is linked to profile; default to 1 if not persisted yet
  const accountLevel = profile?.accountLevel ?? 1;
  const [activeLoadout, setActiveLoadout] = useState<CharacterLoadout | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(()=>{
    function onOpen(){ setInviteOpen(true); }
    window.addEventListener('af:openInviteDialog', onOpen as any);
    return ()=> window.removeEventListener('af:openInviteDialog', onOpen as any);
  },[]);

  // Hydrate saved avatar (loadout) from localStorage once on mount, normalizing portrait URL
  useEffect(()=>{
    // Optional Chrome Sync hydration (if extension installed and Chrome account signed in)
    (async () => {
      try {
        const synced = await chromeSyncGet();
        if (synced) {
          const { ['afrofuture.profile']: prof, ['afrofuture.loadout']: loadout, ['afrofuture.skills']: skills } = synced as any;
          if (prof && typeof prof === 'object' && !profile) {
            setProfile(prof);
            try { localStorage.setItem('afrofuture.profile', JSON.stringify(prof)); } catch {}
          }
          if (loadout && loadout.id && !activeLoadout) {
            const normalized: CharacterLoadout = {
              ...loadout,
              portraitUrl: getCharacterPortrait(loadout.faction as Faction, loadout.archetype as Archetype),
            };
            setActiveLoadout(normalized);
            try { localStorage.setItem('afrofuture.activeLoadout', JSON.stringify(normalized)); } catch {}
          }
          if (skills && typeof skills === 'object') {
            try {
              const { hydrate } = useSkillStore.getState() as any;
              hydrate?.({ level: skills.level, unlocked: skills.unlocked, unlockOrder: skills.unlockOrder });
            } catch {}
          }
        }
      } catch {}
    })();
    try {
      const raw = localStorage.getItem('afrofuture.activeLoadout');
      if(raw){
        const parsed = JSON.parse(raw) as CharacterLoadout;
        if(parsed && parsed.id){
          const normalized: CharacterLoadout = {
            ...parsed,
            // Avoid stale /src/assets/* paths by deriving from faction+archetype
            portraitUrl: getCharacterPortrait(parsed.faction as Faction, parsed.archetype as Archetype),
          };
          setActiveLoadout(normalized);
        }
      }
    } catch(e){
      console.warn('[avatar-persist] failed to load', e);
    }
  },[]);
  // Once a hero is created and saved, it's locked; user can only customize/grow, not replace.
  const heroLocked = !!activeLoadout;
  const [setupFaction, setSetupFaction] = useState<Faction | null>(null);
  const [setupArchetype, setSetupArchetype] = useState<Archetype | null>(null);
  const [setupPet, setSetupPet] = useState<PetType | null>(null);

  useEffect(() => {
    if (phase !== 'boot') return;
    // Kick off runtime-config fetch once when entering boot phase
    if(!configLoaded){
      (async () => {
        try {
          const r = await fetch('/runtime-config', { headers: { 'Accept': 'application/json' } });
          if(r.ok){
            const json = await r.json();
            if(json?.ok){
              const cfg: RuntimeConfig = {
                storeDomain: json.storeDomain || null,
                apiVersion: json.apiVersion || 'unknown',
                debug: !!json.debug,
                buildHash: json.buildHash || null,
              };
              setRuntimeConfig(cfg);
              if(cfg.debug) console.log('[runtime-config] loaded', cfg);
            }
          } else {
            console.warn('[runtime-config] non-ok status', r.status);
          }
        } catch(e){ console.warn('[runtime-config] fetch failed', e); }
        finally { setConfigLoaded(true); }
      })();
    }
    let pct = 0;
    const id = setInterval(() => {
      pct += Math.random() * 18 + 3;
      setProgress(Math.min(100, Math.floor(pct)));
      // Delay finishing boot until runtime config loaded (max ~2s simulated via progress loop)
      if (pct >= 100 && configLoaded) {
        clearInterval(id);
        if (!activeLoadout) setPhase('onboard'); else setPhase('main');
      }
    }, 300);
    return () => clearInterval(id);
  }, [phase, activeLoadout, configLoaded]);

  async function fetchServerProfile(idToken: string){
    try {
      const res = await fetch('/profile', { headers: { 'Authorization': 'Bearer '+idToken } });
      if(!res.ok) {
        if (res.status === 404) {
          console.log('[profile] Server not running - using local-only mode');
        }
        return null;
      }
      const json = await res.json();
      return json.profile || null;
    } catch { 
      console.log('[profile] Server unavailable - using local-only mode');
      return null; 
    }
  }

  async function persistServerProfile(idToken: string, profilePatch: any){
    try {
      await fetch('/profile', { method:'PUT', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+idToken }, body: JSON.stringify(profilePatch) });
    } catch(e){ console.warn('[profile] save failed', e); }
  }

  async function handleSignedIn(token: string){
    setIdToken(token);
    localStorage.setItem('afrofuture.idToken', token);
    // Sign Firebase in with the Google credential so auth.currentUser is set.
    // This prevents usePlayerProfile / usePlayerSession from falling back to
    // disabled anonymous sign-in (which spams 400s on identitytoolkit).
    signInWithGoogleCredential(token);
    setPhase('boot');
    // Attempt to enter fullscreen immediately after auth (user gesture context often preserved from click)
    try {
      if(!document.fullscreenElement){
        document.documentElement.requestFullscreen?.();
      }
    } catch(e){ console.warn('[fullscreen] request failed', e); }
    try {
      const _b64a = (token.split('.')[1] || 'e30').replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(_b64a.padEnd(Math.ceil(_b64a.length / 4) * 4, '=')));
  const prof = { sub: payload.sub, name: payload.name || payload.given_name || payload.family_name, email: payload.email, picture: payload.picture };
      // The saved hero belongs to ONE Google account. If a different account signs in on
      // this browser, drop the cached loadout + skills instead of inheriting them — the
      // new account either restores its own hero from its profile or goes to onboarding.
      try {
        const owner = localStorage.getItem('afrofuture.loadoutOwner');
        if (owner && owner !== payload.sub) {
          localStorage.removeItem('afrofuture.activeLoadout');
          localStorage.removeItem('afrofuture.loadoutOwner');
          setActiveLoadout(null);
          (useSkillStore.getState() as any).reset?.();
        } else if (!owner && localStorage.getItem('afrofuture.activeLoadout')) {
          // Legacy save from before owner-tagging — claim it for this account.
          localStorage.setItem('afrofuture.loadoutOwner', payload.sub);
        }
      } catch {}
      setProfile(prof);
      try { localStorage.setItem('afrofuture.profile', JSON.stringify(prof)); } catch {}
      // Mirror base profile to Chrome Sync (best-effort)
      chromeSyncSet({ 'afrofuture.profile': prof }).catch(()=>{});
      // Fetch existing server profile (may include loadout)
  const serverProf = await fetchServerProfile(token);
      if(serverProf){
        // Merge name/email/picture preference: prefer fresh token payload over stored values
  const mergedProf = { ...serverProf, ...prof };
        setProfile(mergedProf);
        chromeSyncSet({ 'afrofuture.profile': mergedProf }).catch(()=>{});
        if(serverProf.loadout){
          const l = serverProf.loadout as CharacterLoadout;
          const normalized: CharacterLoadout = {
            ...l,
            portraitUrl: getCharacterPortrait(l.faction as Faction, l.archetype as Archetype),
          };
          setActiveLoadout(normalized);
          chromeSyncSet({ 'afrofuture.loadout': normalized }).catch(()=>{});
        }
        try { localStorage.setItem('afrofuture.profile', JSON.stringify(mergedProf)); } catch {}
        if(serverProf.loadout){ try { localStorage.setItem('afrofuture.activeLoadout', JSON.stringify(serverProf.loadout)); localStorage.setItem('afrofuture.loadoutOwner', payload.sub); } catch {} }
        // Hydrate skills from server if present
        if (serverProf.skills && typeof serverProf.skills === 'object') {
          try {
            const { hydrate } = useSkillStore.getState() as any;
            if (hydrate) {
              hydrate({
                level: typeof serverProf.skills.level === 'number' ? serverProf.skills.level : undefined,
                unlocked: Array.isArray(serverProf.skills.unlocked) ? serverProf.skills.unlocked : undefined,
                unlockOrder: Array.isArray(serverProf.skills.unlockOrder) ? serverProf.skills.unlockOrder : undefined,
              });
              chromeSyncSet({ 'afrofuture.skills': {
                level: serverProf.skills.level,
                unlocked: serverProf.skills.unlocked,
                unlockOrder: serverProf.skills.unlockOrder,
              }}).catch(()=>{});
            }
          } catch (e) { console.warn('[skills] hydrate failed', e); }
        }
      } else {
        // Create initial profile server-side
        persistServerProfile(token, { ...prof });
      }
  } catch {}
  // Non-blocking push registration attempt
  collectAndRegisterPush(token).catch(()=>{});
    // Initialize collaborative CRDT state then join a default room (e.g., 'lobby')
    try {
      await initCRDT({ idToken: token, world: 'global' });
      const room = joinRoom(roomId, {}, token);
      setRtc(room);
      const maybeAttach = () => {
        if(room.dc.readyState === 'open'){
          try { attachCRDTChannel({ dc: room.dc }); } catch(e){ console.warn('[crdt] attach failed', e); }
        } else {
          room.dc.addEventListener('open', ()=>{
            try { attachCRDTChannel({ dc: room.dc }); } catch(e){ console.warn('[crdt] attach failed (late)', e); }
          }, { once:true });
        }
      };
      maybeAttach();
      try {
        localStorage.setItem('afrofuture.rtcState', JSON.stringify({ roomId, joinedAt: Date.now(), pcState: room.pc.connectionState, iceState: room.pc.iceConnectionState }));
      } catch {}
    } catch (e) { console.warn('[rtc] join failed', e); }
  }
  function handleSignOut(){
    localStorage.removeItem('afrofuture.idToken');
    // Drop the cached identity + connection state; the hero loadout stays (owner-tagged),
    // so the SAME account re-signing in keeps it while a different one gets a clean slate.
    localStorage.removeItem('afrofuture.profile');
    localStorage.removeItem('afrofuture.rtcState');
    setIdToken(null);
    setPhase('auth');
    setProfile(null);
    // Clear Chrome Sync copies to avoid cross-account confusion
    chromeSyncClear().catch(()=>{});
    if(rtc){
      try { rtc.dc.close(); } catch {}
      try { rtc.pc.close(); } catch {}
      try { rtc.ws.close(); } catch {}
      setRtc(null);
    }
    try { disposeCRDT(); } catch {}
  }
  function switchRoom(newRoom: string){
    if(newRoom === roomId) return;
    setRoomId(newRoom);
    localStorage.setItem('afrofuture.room', newRoom);
    setRecentRooms(rs => {
      const next = [newRoom, ...rs.filter(r=>r!==newRoom)].slice(0,5);
      localStorage.setItem('afrofuture.recentRooms', JSON.stringify(next));
      return next;
    });
    // Reconnect
    if(rtc){
      try { rtc.dc.close(); } catch {}
      try { rtc.pc.close(); } catch {}
      try { rtc.ws.close(); } catch {}
      setRtc(null);
    }
    if(idToken){
      try {
        const room = joinRoom(newRoom, {}, idToken);
        setRtc(room);
        try { localStorage.setItem('afrofuture.rtcState', JSON.stringify({ roomId: newRoom, joinedAt: Date.now(), pcState: room.pc.connectionState, iceState: room.pc.iceConnectionState })); } catch {}
      } catch(e){ console.warn('[rtc] room switch failed', e); }
    }
  }

  // On mount (or auth resume) auto-decode token & attempt RTC rejoin if prior state exists
  useEffect(()=>{
    if(!idToken) return;
    // If profile not yet set (e.g., hydration path) attempt decode
    if(!profile){
      try {
        const _b64b = (idToken.split('.')[1] || 'e30').replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(_b64b.padEnd(Math.ceil(_b64b.length / 4) * 4, '=')));
        const prof = { sub: payload.sub, name: payload.name || payload.given_name || payload.family_name, email: payload.email, picture: payload.picture };
        setProfile(prof);
        try { localStorage.setItem('afrofuture.profile', JSON.stringify(prof)); } catch {}
        chromeSyncSet({ 'afrofuture.profile': prof }).catch(()=>{});
      } catch {}
    }
    // Auto-rejoin logic
    const raw = localStorage.getItem('afrofuture.rtcState');
    if(!raw) return;
    try {
      const saved = JSON.parse(raw);
      if(saved && saved.roomId && typeof saved.roomId === 'string'){
        // If current room differs, adopt saved room first
        if(saved.roomId !== roomId){
          setRoomId(saved.roomId);
          localStorage.setItem('afrofuture.room', saved.roomId);
        }
        // Only join if not already connected
        if(!rtc){
          const room = joinRoom(saved.roomId, {}, idToken);
          setRtc(room);
          try { localStorage.setItem('afrofuture.rtcState', JSON.stringify({ roomId: saved.roomId, joinedAt: Date.now(), pcState: room.pc.connectionState, iceState: room.pc.iceConnectionState })); } catch {}
        }
      }
    } catch {}
  // run once after idToken available
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken]);

  // Persist WebRTC connection state (lightweight) whenever it changes
  useEffect(()=>{
  if(!rtc) return;
    function save(){
      try {
        if(!rtc) return;
        localStorage.setItem('afrofuture.rtcState', JSON.stringify({ roomId, updatedAt: Date.now(), pcState: rtc.pc.connectionState, iceState: rtc.pc.iceConnectionState, dcState: rtc.dc.readyState }));
      } catch {}
    }
    // Attach listeners
    const pc = rtc.pc as any;
    const dc = rtc.dc as any;
    pc.addEventListener('connectionstatechange', save);
    pc.addEventListener('iceconnectionstatechange', save);
    if(dc) dc.addEventListener('open', save);
    if(dc) dc.addEventListener('close', save);
    save();
    return () => {
      pc.removeEventListener('connectionstatechange', save);
      pc.removeEventListener('iceconnectionstatechange', save);
      if(dc) dc.removeEventListener('open', save);
      if(dc) dc.removeEventListener('close', save);
    };
  }, [rtc, roomId]);

  function startCreator() {
    if (heroLocked) return; // cannot create a new hero once locked
    setPhase('creating');
  }

  function handleCreatorSave(newLoadout: CharacterLoadout) {
    // Preserve original id if already existed (no new hero creation after lock)
    if (activeLoadout) {
      const merged = { ...activeLoadout, ...newLoadout, id: activeLoadout.id, createdAt: activeLoadout.createdAt, updatedAt: now() } as CharacterLoadout;
      // Always derive portraitUrl from canonical mapping (avoids stale /src paths)
      merged.portraitUrl = getCharacterPortrait(merged.faction as Faction, merged.archetype as Archetype);
      setActiveLoadout(merged);
  try { localStorage.setItem('afrofuture.activeLoadout', JSON.stringify(merged)); } catch(e){ console.warn('[avatar-persist] save failed', e); }
  // Mirror to Chrome Sync (best-effort)
  chromeSyncSet({ 'afrofuture.loadout': merged }).catch(()=>{});
      if(idToken) persistServerProfile(idToken, { loadout: merged });
      // Persist core selections to Firestore profile as well
      try {
        saveProfileProgress({
          faction: merged.faction,
          archetype: merged.archetype,
          avatar: {
            parts: (merged as any)?.threeConfig?.parts || {},
            colors: {
              primary: merged.colors?.primary || '#00A37A',
              secondary: merged.colors?.secondary || '#F5F5F5',
              skin: (merged as any)?.threeConfig?.colors?.skin || '#c58b66',
            },
            updatedAt: Date.now(),
          },
          pet: {
            type: merged.pet?.type,
            level: merged.pet?.level ?? 1,
            xp: 0,
          },
        });
      } catch {}
      // Broadcast to peers via WebRTC (if data channel open)
      if(rtc?.dc?.readyState === 'open') {
        try { rtc.dc.send(JSON.stringify({ type: 'loadoutUpdate', loadout: merged })); } catch(err){ console.warn('[rtc] broadcast failed', err); }
      }
    } else {
      const normalized: CharacterLoadout = {
        ...newLoadout,
        portraitUrl: getCharacterPortrait(newLoadout.faction as Faction, newLoadout.archetype as Archetype),
      };
      setActiveLoadout(normalized);
  try { localStorage.setItem('afrofuture.activeLoadout', JSON.stringify(normalized)); } catch(e){ console.warn('[avatar-persist] save failed', e); }
  chromeSyncSet({ 'afrofuture.loadout': normalized }).catch(()=>{});
      if(idToken) persistServerProfile(idToken, { loadout: normalized });
      try {
        saveProfileProgress({
          faction: normalized.faction,
          archetype: normalized.archetype,
          avatar: {
            parts: (normalized as any)?.threeConfig?.parts || {},
            colors: {
              primary: normalized.colors?.primary || '#00A37A',
              secondary: normalized.colors?.secondary || '#F5F5F5',
              skin: (normalized as any)?.threeConfig?.colors?.skin || '#c58b66',
            },
            updatedAt: Date.now(),
          },
          pet: {
            type: normalized.pet?.type,
            level: normalized.pet?.level ?? 1,
            xp: 0,
          },
        });
      } catch {}
      if(rtc?.dc?.readyState === 'open') {
        try { rtc.dc.send(JSON.stringify({ type: 'loadoutUpdate', loadout: newLoadout })); } catch(err){ console.warn('[rtc] broadcast failed', err); }
      }
    }
    // Tag the saved hero with the signed-in account so another account on this browser
    // can't inherit it (checked in handleSignedIn).
    try { if (profile?.sub) localStorage.setItem('afrofuture.loadoutOwner', profile.sub); } catch {}
    setPhase('main');
  }

  // Persist skills + ability loadout whenever they change (after auth). Saved to the
  // Firestore player profile (the durable account store, hydrated on next login) plus
  // Chrome Sync and the optional REST endpoint as best-effort mirrors.
  const skillState = useSkillStore();
  useEffect(() => {
    if (!idToken) return;
    const handle = setTimeout(() => {
      try {
        // Don't clobber saved skills with the pristine default before the store has been
        // hydrated from the profile. A brand-new player is already default in Firestore,
        // so skipping this exact state never loses data; a leveled player is level > 1.
        const pristine = skillState.unlocked.length <= 1
          && skillState.unlockOrder.length === 0
          && skillState.level <= 1
          && skillState.abilityLoadout.offensive.every(x => !x)
          && skillState.abilityLoadout.defensive.every(x => !x);
        if (pristine) return;
        // ── Durable: write to the account profile in Firestore ──
        saveProfileProgress({
          hero: {
            level: skillState.level,
            unlockedSkillIds: skillState.unlocked,
            unlockOrder: skillState.unlockOrder,
          },
          abilityLoadout: skillState.abilityLoadout,
        });
        // ── Best-effort mirrors ──
        const payload = {
          skills: {
            level: skillState.level,
            unlocked: skillState.unlocked,
            unlockOrder: skillState.unlockOrder,
            abilityLoadout: skillState.abilityLoadout,
          }
        };
        chromeSyncSet({ 'afrofuture.skills': payload.skills }).catch(()=>{});
        persistServerProfile(idToken, payload);
      } catch (e) {
        console.warn('[skills] persist failed', e);
      }
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken, skillState.level, skillState.unlocked, skillState.unlockOrder, skillState.abilityLoadout]);

  // Listen for remote loadout updates over WebRTC to keep sessions in sync ("chrome sync webrtc" requirement)
  useEffect(()=>{
    if(!rtc?.dc) return;
    function onMessage(ev: MessageEvent){
      try {
        const data = JSON.parse(ev.data);
        if(data?.type === 'loadoutUpdate' && data.loadout){
          setActiveLoadout(prev => {
            const incoming: CharacterLoadout = data.loadout;
            // If we already have a loadout id, prefer keeping its id/timestamps for local authority
            const merged = prev ? { ...prev, ...incoming, id: prev.id, createdAt: prev.createdAt, updatedAt: now() } : incoming;
            try { localStorage.setItem('afrofuture.activeLoadout', JSON.stringify(merged)); } catch{}
            return merged;
          });
        }
      } catch {}
    }
    rtc.dc.addEventListener('message', onMessage);
    return () => { rtc.dc.removeEventListener('message', onMessage); };
  }, [rtc]);

  if (phase === 'auth') return <GameViewport mode="fit"><AuthGate onSignedIn={handleSignedIn} /></GameViewport>;
  if (phase === 'boot') return <GameViewport mode="fit"><WelcomeScreen progress={progress} build="v0.2.3" onSignOut={handleSignOut} /></GameViewport>;

  if (phase === 'onboard') return (
    <GameViewport mode="fit">
      <FirstTimeFlow
        faction={setupFaction}
        archetype={setupArchetype}
        pet={setupPet}
        onFaction={setSetupFaction}
        onArchetype={setSetupArchetype}
        onPet={setSetupPet}
        onContinue={startCreator}
      />
    </GameViewport>
  );

  if (phase === 'creating') return (
    <GameViewport mode="fit">
      <CharacterCreator
        initial={activeLoadout ?? {
          ...defaultLoadout,
          faction: setupFaction ?? 'PAA',
          archetype: setupArchetype ?? 'FEMALE',
          pet: { ...defaultLoadout.pet, type: setupPet ?? 'CYBER_DOG' },
          name: (() => {
            const f = setupFaction ?? 'PAA';
            const a = setupArchetype ?? 'FEMALE';
            const names: Record<Faction, Record<Archetype, string>> = {
              PAA: { MALE: 'Kwame', FEMALE: 'Nia' },
              ASF: { MALE: 'Zuberi', FEMALE: 'Makena' },
              WC: { MALE: 'Jonathan', FEMALE: 'Emily' },
            };
              return names[f][a];
          })(),
          portraitUrl: (() => {
            const f = setupFaction ?? 'PAA';
            const a = setupArchetype ?? 'FEMALE';
            return getCharacterPortrait(f, a as Archetype);
          })(),
        }}
        locked={heroLocked}
        onBack={() => heroLocked ? setPhase('main') : setPhase('onboard')}
        onSave={handleCreatorSave}
      />
    </GameViewport>
  );

  return (
    mainView === 'mission' ? (
      <MissionErrorBoundary onExit={() => setMainView('dashboard')}>
        <MissionScreen
          onExit={() => { setLaunchMultiplayer(false); setLaunchMoba(false); setMainView('dashboard'); }}
          onOpenSkillTree={() => setMainView('skills')}
          activeLoadout={activeLoadout}
          autoMultiplayer={launchMultiplayer}
          mobaMode={launchMoba}
        />
      </MissionErrorBoundary>
    ) : (
      <GameViewport mode="fit">
        <MainMenu
          playerName={playerName}
          accountLevel={accountLevel}
          loadout={activeLoadout ?? defaultLoadout}
          onCustomize={() => setPhase('creating')}
          heroLocked={heroLocked}
          view={mainView}
          onChangeView={setMainView}
          onLaunch={(mode) => { setLaunchMultiplayer(mode === 'multi'); setLaunchMoba(mode === 'moba'); setMainView('mission'); }}
          profile={profile}
          onSignOut={handleSignOut}
        />
        {inviteOpen && (
          <InviteDialog onClose={()=>setInviteOpen(false)} />
        )}
      </GameViewport>
    )
  );
}

// Module-level skill icon helper (used by MissionScreen and SkillsModal).
// Delegates to the GDD grid's category → icon map (ids are now `lvlN`).
function skillIconFn(id: string): string { return skillIconFor(id); }

// Full-screen skills modal with SnowflakeSkillTree + ability assignment loadout
function SkillsModal({ loadout, onClose }: { loadout: CharacterLoadout; onClose: () => void }) {
  const unlocked = useSkillStore(s => s.unlocked);
  const abilityLoadout = useSkillStore(s => s.abilityLoadout);
  const setAbilitySlot = useSkillStore(s => s.setAbilitySlot);
  const [selectedSkill, setSelectedSkill] = React.useState<string | null>(null);

  const tree = React.useMemo(() => makeTree(), []);

  const assignableSkills = React.useMemo(() => {
    return unlocked
      .filter(id => id !== 'root')
      .map(id => {
        const node = tree.find(n => n.id === id);
        return node ? { ...node, icon: skillIconFn(id) } : null;
      })
      .filter(Boolean) as { id: string; label: string; description: string; icon: string; type: string }[];
  }, [unlocked, tree]);

  function findSlotFor(skillId: string): { category: 'offensive' | 'defensive'; slot: number } | null {
    const offIdx = abilityLoadout.offensive.indexOf(skillId);
    if (offIdx >= 0) return { category: 'offensive', slot: offIdx };
    const defIdx = abilityLoadout.defensive.indexOf(skillId);
    if (defIdx >= 0) return { category: 'defensive', slot: defIdx };
    return null;
  }

  function handleSlotClick(category: 'offensive' | 'defensive', slot: number) {
    if (selectedSkill) {
      const prev = findSlotFor(selectedSkill);
      if (prev) setAbilitySlot(prev.category, prev.slot, null);
      setAbilitySlot(category, slot, selectedSkill);
      setSelectedSkill(null);
    } else {
      const current = abilityLoadout[category][slot];
      if (current) setAbilitySlot(category, slot, null);
    }
  }

  // Close on Escape
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const OFFENSIVE_KEYS = ['Q', 'W', 'E', 'R'];
  const DEFENSIVE_KEYS = ['Z', 'X', 'C', 'V'];

  function SlotGrid({ category, keys, accent }: { category: 'offensive' | 'defensive'; keys: string[]; accent: string }) {
    return (
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }, (_, i) => {
          const assignedId = abilityLoadout[category][i];
          const skill = assignedId ? assignableSkills.find(s => s.id === assignedId) : null;
          return (
            <button
              key={i}
              onClick={() => handleSlotClick(category, i)}
              title={skill ? skill.label : (selectedSkill ? 'Assign here' : 'Empty slot')}
              className={`aspect-square w-full rounded-xl border-2 flex flex-col items-center justify-center gap-1 transition-all ${
                selectedSkill
                  ? `border-${accent}-400/70 bg-${accent}-900/30 hover:bg-${accent}-900/50 cursor-pointer ring-1 ring-${accent}-400/30`
                  : assignedId
                  ? `border-${accent}-500/50 bg-[#1c2535] hover:border-${accent}-400/70 cursor-pointer`
                  : 'border-white/10 bg-[#1c2535]/40 opacity-60'
              }`}
            >
              {skill ? (
                <>
                  <span className="text-2xl leading-none">{skill.icon}</span>
                  <span className="text-[8px] opacity-60 leading-none px-0.5 truncate w-full text-center">{skill.label.split(' ').slice(-1)[0]}</span>
                </>
              ) : (
                <span className="text-sm opacity-20">{selectedSkill ? '＋' : '·'}</span>
              )}
              <span className={`text-[9px] font-bold leading-none ${category === 'offensive' ? 'text-rose-300/80' : 'text-sky-300/80'}`}>{keys[i]}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[99] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[97vw] h-[95vh] bg-[#0f1218] rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex text-gray-100">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-50 w-8 h-8 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 flex items-center justify-center text-sm leading-none transition"
          title="Close (Esc)"
        >✕</button>

        {/* Left: Skill Tree (circular web) */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">Loading skill tree…</div>}>
            <SnowflakeSkillTree initialLevel={loadout.level} />
          </Suspense>
        </div>

        {/* Right: Ability Assignment Panel */}
        <div className="w-72 shrink-0 border-l border-white/10 bg-[#0b0f16] flex flex-col overflow-hidden">
          <header className="px-4 pt-4 pb-3 border-b border-white/10 shrink-0">
            <h2 className="text-sm font-semibold tracking-wide">Ability Loadout</h2>
            <p className="text-[10px] opacity-50 mt-0.5">Select a skill below, then click a slot to assign it</p>
          </header>

          <div className="flex-1 overflow-y-auto p-4 space-y-5 overscroll-contain">
            {/* Offensive Slots */}
            <section>
              <div className="flex items-center gap-2 mb-2.5">
                <span>⚔️</span>
                <span className="text-[11px] font-semibold tracking-wide text-rose-300 uppercase">Offensive  Q / W / E / R</span>
              </div>
              <SlotGrid category="offensive" keys={OFFENSIVE_KEYS} accent="rose" />
            </section>

            {/* Defensive Slots */}
            <section>
              <div className="flex items-center gap-2 mb-2.5">
                <span>🛡️</span>
                <span className="text-[11px] font-semibold tracking-wide text-sky-300 uppercase">Defensive  Z / X / C / V</span>
              </div>
              <SlotGrid category="defensive" keys={DEFENSIVE_KEYS} accent="sky" />
            </section>

            {/* Unlocked Skills List */}
            <section>
              <div className="text-[10px] font-semibold tracking-widest opacity-50 uppercase mb-2">
                Unlocked Skills ({assignableSkills.length})
              </div>
              {assignableSkills.length === 0 ? (
                <p className="text-[11px] opacity-40 text-center py-6">Unlock skills in the tree<br />to assign them here</p>
              ) : (
                <div className="space-y-1.5">
                  {assignableSkills.map(skill => {
                    const isSelected = selectedSkill === skill.id;
                    const assignment = findSlotFor(skill.id);
                    return (
                      <button
                        key={skill.id}
                        onClick={() => setSelectedSkill(s => s === skill.id ? null : skill.id)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border text-left transition-all ${
                          isSelected
                            ? 'border-emerald-400/70 bg-emerald-900/25 ring-1 ring-emerald-400/30'
                            : assignment
                            ? 'border-white/15 bg-white/[0.04] opacity-75'
                            : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/15'
                        }`}
                      >
                        <span className="text-lg shrink-0">{skill.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{skill.label}</div>
                          <div className="text-[10px] opacity-45 truncate">{skill.description}</div>
                        </div>
                        {assignment && (
                          <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                            assignment.category === 'offensive'
                              ? 'bg-rose-900/60 text-rose-300'
                              : 'bg-sky-900/60 text-sky-300'
                          }`}>
                            {assignment.category === 'offensive' ? OFFENSIVE_KEYS[assignment.slot] : DEFENSIVE_KEYS[assignment.slot]}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Status bar */}
          {selectedSkill ? (
            <div className="px-4 py-2.5 border-t border-emerald-500/20 bg-emerald-900/15 text-[11px] text-emerald-300 flex items-center gap-2 shrink-0">
              <span className="opacity-70">✦</span>
              <span className="flex-1 truncate">
                {(() => { const sk = assignableSkills.find(s => s.id === selectedSkill); return sk ? `"${sk.label}", click a slot` : 'Skill selected'; })()}
              </span>
              <button onClick={() => setSelectedSkill(null)} className="shrink-0 opacity-50 hover:opacity-90 text-xs">✕</button>
            </div>
          ) : (
            <div className="px-4 py-2.5 border-t border-white/5 text-[10px] opacity-40 text-center shrink-0">
              Click a skill to select it, then a slot to assign
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ErrorBoundary to prevent blank screen if SoloMissionMap3D or its Canvas throws
class MissionErrorBoundary extends React.Component<
  { onExit: () => void; children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { onExit: () => void; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(err: unknown) {
    const message = err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : 'Unknown render error';
    return { hasError: true, message };
  }
  componentDidCatch(err: unknown, info: React.ErrorInfo) {
    console.error('[MissionScreen] Fatal render error:', err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-[#0b0e13] text-gray-100 flex flex-col items-center justify-center gap-4">
          <p className="text-red-400 text-lg font-semibold">3D scene failed to load</p>
          <p className="text-gray-500 text-sm max-w-sm text-center">{this.state.message}</p>
          <button
            className="mt-4 px-6 py-2 bg-[#00A37A] rounded text-white"
            onClick={this.props.onExit}
          >
            Return to Menu
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Isolates a 3D <AvatarScene> canvas so a WebGL/render error inside it can't crash
// the surrounding React UI (creator tabs, sidepanel, buttons).
class CanvasErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: unknown) { console.error('[AvatarScene] canvas render error:', err); }
  render() { return this.state.hasError ? (this.props.fallback ?? null) : this.props.children; }
}

function MissionScreen({ onExit, onOpenSkillTree, activeLoadout, autoMultiplayer, mobaMode }: { onExit: () => void; onOpenSkillTree?: () => void; activeLoadout?: CharacterLoadout | null; autoMultiplayer?: boolean; mobaMode?: boolean }){
  // Access active loadout & skill state for HUD
  // Prefer the live prop from App (stays in sync with configurator changes),
  // fall back to localStorage only when the prop is not available.
  const activeLoadoutRaw = React.useMemo(() => {
    if (activeLoadout) return activeLoadout;
    try { const raw = localStorage.getItem('afrofuture.activeLoadout'); if(raw) return JSON.parse(raw); } catch {}
    return null;
  }, [activeLoadout]);

  // Playtime tracking
  const { profile, saveProgress } = usePlayerProfile();

  // ── Skills progress: vitals, cooldowns, derived abilities, persistence ──
  const idToken = localStorage.getItem('afrofuture.idToken');
  const skillsProgress = useSkillsProgress({
    uid: profile?.uid ?? '',
    email: profile?.email,
    displayName: profile?.displayName,
    idToken,
    faction: (activeLoadoutRaw as any)?.faction ?? (profile as any)?.progress?.faction,
    archetype: (activeLoadoutRaw as any)?.archetype,
    factionAbilities: (profile as any)?.progress?.factionAbilities,
  });
  const {
    skillState,
    heroVitals, setHeroVitals, hpMaxRef, epMaxRef,
    HP_MAX, EP_MAX, XP_MAX, XP_CUR, stats: heroStats,
    abilities, defensiveAbilities, onActivateAbility,
  } = skillsProgress;

  const available = availablePoints(skillState);
  const heroBuffs = skillState.traitTags;

  // Resources: shards + skill tokens. Shards live in the Firestore profile (the old
  // /profile server endpoint isn't deployed on static hosting), so read them from there.
  const shards = (profile?.progress as any)?.shards ?? 0;
  const resources = React.useMemo(()=>[
    { id:'shards', label:'Shards', value: shards, icon:'◈' },
    { id:'tokens', label:'Skill Tokens', value: available, icon:'⬢' },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ],[shards, available]);

  const loadout = activeLoadoutRaw || { name:'Hero', faction:'PAA', level: skillState.level, portraitUrl: undefined, pet:{ type:'CYBER_DOG', level:1, role:'SCOUT' } } as any;
  const pet = loadout.pet ? (() => {
    const species = getPetSpecies(loadout.pet.type);
    const lvl = loadout.pet.level || 1;
    const stats = derivePetStats(loadout.pet.type, lvl);
    const maxHp = Math.round(stats.health);
    return { name: species.name, level: lvl, hp: { current: maxHp, max: maxHp }, ep: { current: 30, max: 30 }, icon: '🐾', portraitUrl: PetIcon[loadout.pet.type] };
  })() : undefined;

  const [sessionStartTime] = React.useState(() => Date.now());
  // Skill tree opens as an OVERLAY on top of the live mission (not a navigation), so the
  // game state — map, hero position, camps, progress — is preserved. Closing returns to
  // exactly where you were, and newly-unlocked abilities apply live.
  const [skillsOpen, setSkillsOpen] = React.useState(false);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  
  // Update elapsed time every second
  React.useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - sessionStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionStartTime]);
  
  // Save playtime to profile every 30 seconds
  React.useEffect(() => {
    const interval = setInterval(() => {
      if (profile && elapsedSeconds > 0) {
        const currentTotal = profile.progress.totalPlayTime || 0;
        saveProgress({ totalPlayTime: currentTotal + elapsedSeconds });
      }
    }, 30000); // 30 seconds
    return () => clearInterval(interval);
  }, [profile, elapsedSeconds, saveProgress]);
  
  // Save playtime on exit
  React.useEffect(() => {
    return () => {
      if (profile && elapsedSeconds > 0) {
        const currentTotal = profile.progress.totalPlayTime || 0;
        saveProgress({ totalPlayTime: currentTotal + elapsedSeconds });
      }
    };
  }, [profile, elapsedSeconds, saveProgress]);
  
  // Format elapsed time as HH:MM:SS
  const formatElapsedTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const [minimapData, setMinimapData] = React.useState<MinimapData | undefined>(undefined);
  const onMapUpdate = React.useCallback((data: MinimapData) => setMinimapData(data), []);

  // Faction name mapping for HUD display
  const factionNames: Record<string, string> = {
    PAA: 'PAA – Pan-African Alliance',
    ASF: 'ASF – African Sovereignty Front',
    WC: 'WC – World Coalition'
  };
  const factionName = factionNames[loadout.faction] || loadout.faction;

  return (
    <div className="fixed inset-0 bg-[#0b0e13] text-gray-100">
      <div className="absolute inset-0">
        <SoloMissionMap3D
          onExit={onExit}
          autoMultiplayer={autoMultiplayer}
          mobaMode={mobaMode}
          sharedProfile={profile}
          sharedSaveProgress={saveProgress}
          onMapUpdate={onMapUpdate}
          abilitySlots={abilities} 
          defenseSlots={defensiveAbilities}
          heroVitals={(() => {
            // XP shown around the player card is progress WITHIN the current level, not
            // the lifetime total (which would overflow the ring/bar).
            const totalXp = Math.floor(profile?.progress?.hero?.xp ?? 0);
            // Derive level from XP so the level + XP bar always agree, even when the
            // stored hero.level lags (e.g. movement XP saves xp without recomputing level).
            const heroLvl = Math.max(1, getLevelFromXp(totalXp));
            const xpIntoLevel = Math.max(0, totalXp - getTotalXpForLevel(heroLvl));
            const xpForLevel = Math.max(1, getXpForNextLevel(heroLvl));
            return {
              hp: { current: Math.floor(heroVitals.hp), max: HP_MAX },
              ep: { current: Math.floor(heroVitals.ep), max: EP_MAX },
              xp: { current: Math.min(xpIntoLevel, xpForLevel), max: xpForLevel },
              level: heroLvl,
              name: loadout.name,
              portraitUrl: loadout.portraitUrl,
              buffs: heroBuffs,
            };
          })()}
          petData={pet}
          resources={resources}
          skillTokens={available}
          factionName={factionName}
          elapsedTime={formatElapsedTime(elapsedSeconds)}
          skillPoints={available}
          totalPlayTime={profile?.progress?.totalPlayTime}
          heroInventory={profile?.progress?.heroInventory}
          petInventory={profile?.progress?.petInventory}
          playerProfile={profile ? { 
            uid: profile.uid, 
            displayName: profile.displayName, 
            email: profile.email, 
            faction: loadout.faction 
          } : undefined}
          onOpenSkillTree={() => setSkillsOpen(true)}
          inputPaused={skillsOpen}
          onHealHP={(amount) => setHeroVitals(v => ({ ...v, hp: Math.min(hpMaxRef.current, v.hp + amount) }))}
          onRestoreEP={(amount) => setHeroVitals(v => ({ ...v, ep: Math.min(epMaxRef.current, v.ep + amount) }))}
          onDamageHP={(amount) => setHeroVitals(v => ({ ...v, hp: Math.max(0, v.hp - amount) }))}
          onDrainEP={(amount) => setHeroVitals(v => ({ ...v, ep: Math.max(0, v.ep - amount) }))}
          heroAttack={heroStats.total.atk}
          combatStats={{ atk: heroStats.total.atk, def: heroStats.total.def, spd: heroStats.total.spd }}
          heroAvatar={activeLoadout}
        />
        <PetPanel petType={(loadout as any)?.pet?.type} petName={(loadout as any)?.pet?.name} />
      </div>
      {/* Skill tree as an in-mission overlay — the game keeps running underneath, so
          spending points after a level-up continues the session instead of restarting. */}
      {skillsOpen && (
        <SkillsModal loadout={loadout} onClose={() => setSkillsOpen(false)} />
      )}
    </div>
  );
}

// Invite dialog modal
function InviteDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = React.useState('');
  const [message, setMessage] = React.useState('Join me in Afro-Future Rising!');
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; code?: string; error?: string; emailed?: boolean }|null>(null);
  const valid = /[^@\s]+@[^@\s]+\.[^@\s]+/.test(email);
  async function submit(e: React.FormEvent){
    e.preventDefault();
    if(!valid || submitting) return;
    setSubmitting(true); setResult(null);
    try {
      const idToken = localStorage.getItem('afrofuture.idToken');
      const r = await fetch('/invites', { method:'POST', headers: { 'Content-Type':'application/json', ...(idToken? { 'Authorization':'Bearer '+idToken } : {}) }, body: JSON.stringify({ email, message }) });
      const json = await r.json().catch(()=>({ ok:false, error:'bad_json' }));
      if(json.ok){ setResult({ ok:true, code: json.code, emailed: json.emailed }); }
      else setResult({ ok:false, error: json.error || 'invite_failed' });
    } catch(e:any){ setResult({ ok:false, error: e?.message || 'net_failed' }); }
    finally { setSubmitting(false); }
  }
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-md mx-auto rounded-2xl border border-white/10 bg-[#1b222c]/95 p-6 flex flex-col gap-4 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-wide">Invite a Friend</h2>
            <p className="text-[11px] opacity-70 mt-1 leading-relaxed">Send an invitation link. They'll receive a unique code and future rewards logic can hook into this.</p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 -m-2 rounded-lg flex items-center justify-center text-xs bg-white/5 hover:bg-white/10 border border-white/10">✕</button>
        </div>
        <label className="flex flex-col gap-1 text-xs">
          <span className="opacity-70">Friend's Email</span>
          <input value={email} onChange={e=>setEmail(e.target.value)} type="email" required placeholder="friend@example.com" className="h-10 px-3 rounded-lg bg-black/40 border border-white/10 focus:outline-none focus:border-emerald-400/60 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="opacity-70">Message (optional)</span>
          <textarea value={message} onChange={e=>setMessage(e.target.value)} rows={3} maxLength={500} className="resize-none px-3 py-2 rounded-lg bg-black/40 border border-white/10 focus:outline-none focus:border-emerald-400/60 text-[13px]" />
        </label>
        <div className="flex items-center justify-between text-[11px]">
          <span className="opacity-60">The invite creates a share URL + attempts email send.</span>
          <span className={"font-mono " + (valid? 'text-emerald-300' : 'text-rose-300')}>{valid? 'valid' : 'invalid'}</span>
        </div>
        {result && (
          <div className={"text-[11px] rounded-lg border px-3 py-2 " + (result.ok? 'border-emerald-500/30 bg-emerald-900/20 text-emerald-200' : 'border-rose-500/30 bg-rose-900/20 text-rose-200')}>
            {result.ok ? (
              <div>
                Invite created. Code: <span className="font-mono">{result.code}</span>{' '}· {result.emailed ? 'Email sent.' : 'Email not sent (transport not configured).'}
              </div>
            ) : (
              <div>Invite failed: {result.error}</div>
            )}
          </div>
        )}
        <div className="flex items-center gap-3 pt-1">
          <button type="submit" disabled={!valid||submitting} className="h-10 px-5 rounded-lg bg-gradient-to-r from-emerald-600 to-sky-600 disabled:opacity-40 text-sm font-medium tracking-wide border border-white/10 hover:from-emerald-500 hover:to-sky-500 flex items-center gap-2">
            {submitting && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>}
            <span>{submitting? 'Sending…' : 'Send Invite'}</span>
          </button>
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-sm">Cancel</button>
        </div>
      </form>
    </div>
  );
}

// Fixed 1920x1080 stage with responsive scale preserving 16:9. Provides letterboxing & optional upscale.
interface GameViewportProps { children: React.ReactNode; mode?: 'fixed' | 'fit'; allowUpscale?: boolean; minScale?: number; maxScale?: number; designWidth?: number; designHeight?: number; }
function GameViewport({ children, mode = 'fixed', allowUpscale = true, minScale = 0.5, maxScale = 2, designWidth = 1920, designHeight = 1080 }: GameViewportProps) {
  const DESIGN_W = designWidth;
  const DESIGN_H = designHeight;
  const [scale, setScale] = React.useState(1);
  const [viewport, setViewport] = React.useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    function handle() {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    }
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  useEffect(() => {
    if (mode === 'fit') {
      setScale(1); // we'll stretch the stage container to viewport
      return;
    }
    const scaleW = viewport.w / DESIGN_W;
    const scaleH = viewport.h / DESIGN_H;
    let s = Math.min(scaleW, scaleH);
    if (!allowUpscale) {
      s = Math.min(s, 1);
    } else {
      s = Math.min(Math.max(s, minScale), maxScale);
    }
    setScale(s);
  }, [viewport, allowUpscale, minScale, mode]);

  const stageStyle: React.CSSProperties = mode === 'fit'
    ? { width: viewport.w, height: viewport.h }
    : { width: DESIGN_W, height: DESIGN_H, transform: `scale(${scale})` };

  return (
    <div className="fixed inset-0 bg-white flex items-center justify-center overflow-hidden select-none">
      <div className="relative" style={stageStyle}>
        <div className="absolute inset-0 pointer-events-none shadow-[0_0_0_1px_rgba(255,255,255,0.04)]" />
        {children}
      </div>
    </div>
  );
}

function WelcomeScreen({ progress, build, onSignOut }: { progress: number; build: string; onSignOut?: () => void }) {
  const idToken = localStorage.getItem('afrofuture.idToken');
  function signOut(){
    localStorage.removeItem('afrofuture.idToken');
    onSignOut?.();
  }

  return (
    <div className="w-full h-full bg-[#0b0e13] relative text-gray-100 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(16,185,129,0.15),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_70%,rgba(56,189,248,0.12),transparent_65%)]" />
      <div className="relative h-full grid place-items-center p-6">
        <div className="w-full max-w-4xl rounded-2xl bg-[#12171f]/90 backdrop-blur border border-white/10 p-10 shadow-2xl">
          <h1 className="text-5xl font-bold tracking-wide text-center bg-gradient-to-r from-emerald-300 via-teal-200 to-sky-300 bg-clip-text text-transparent">Afro‑Future Rising</h1>
          <p className="mt-2 opacity-70 text-center text-sm tracking-wide">Preparing Outposts…</p>
          <div className="mt-8 h-2 w-full rounded-full bg-white/5 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-2 text-xs opacity-60 text-center">{progress}%</div>
          <div className="mt-6 flex flex-col items-center gap-3">
            {idToken ? (
              <>
                <div className="text-xs text-emerald-300">Signed in</div>
                <button onClick={signOut} className="text-[11px] px-3 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/10">Sign Out</button>
              </>
            ) : (
              <GoogleSignInButton onCredential={() => window.location.reload()} />
            )}
          </div>
        </div>
        <div className="absolute bottom-4 right-6 text-[10px] opacity-60">{build}</div>
        <div className="absolute bottom-4 left-6 text-[10px] flex gap-4 opacity-60">
          <a className="hover:opacity-90 transition" href="#">EULA</a>
          <a className="hover:opacity-90 transition" href="#">Privacy</a>
          <button className="hover:opacity-90 transition">Accessibility</button>
        </div>
      </div>
    </div>
  );
}

// AuthGate: first step – requires Google sign-in then notifies parent.
function AuthGate({ onSignedIn }: { onSignedIn: (token:string)=>void }) {
  const idToken = localStorage.getItem('afrofuture.idToken');
  const [mode, setMode] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const buttonContainerRef = React.useRef<HTMLDivElement | null>(null);
  const [clientId, setClientId] = React.useState<string|undefined>(() => import.meta.env.VITE_GOOGLE_CLIENT_ID);
  React.useEffect(()=>{ (async ()=>{ if(!clientId){ const cid = await getGoogleClientId(); if(cid) setClientId(cid);} })(); },[clientId]);

  React.useEffect(()=>{ if(idToken) onSignedIn(idToken); },[idToken,onSignedIn]);
  async function startGoogle(){
    console.log('[auth] user clicked primary Sign in with Google button');
    const cid = clientId || await getGoogleClientId();
    if(!cid){ console.warn('[auth] no client id resolved'); setMode('error'); return; }
    setMode('loading');
    try {
      console.log('[auth] initializing GIS with client id', cid);
      // Ensure GIS is initialized once before rendering the button to avoid race warnings
      await initGoogleIdentity(cid, (resp:any)=>{
        try {
          const token = resp?.credential;
          if (token) {
            console.log('[auth] GIS credential received, proceeding');
            onSignedIn(token);
          }
        } catch (e) { console.warn('[auth] credential handling failed', e); }
      });
      // Wait for container to exist (retry up to ~500ms)
      let attempts = 0;
      while(!buttonContainerRef.current && attempts < 10){
        attempts++;
        await new Promise(r=>setTimeout(r,50));
      }
      if(!buttonContainerRef.current){
        console.warn('[auth] button container missing after retries');
      } else {
        console.log('[auth] button container ready after attempts', attempts);
        buttonContainerRef.current.innerHTML='';
        await renderGoogleButton(buttonContainerRef.current, { });
        console.log('[auth] GIS button rendered into container');
      }
      setMode('ready');
      // Removed synthetic auto-click to avoid race conditions with container mounting in production.
    } catch(e){
      console.warn('[gis] init failed', e);
      setMode('error');
    }
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-[#0b0e13] text-gray-100">
      <div className="w-full max-w-md p-8 rounded-2xl bg-[#12171f]/90 border border-white/10 shadow-xl flex flex-col items-center">
        <h1 className="text-3xl font-semibold tracking-wide mb-4">Afro‑Future Rising</h1>
        {mode==='idle' && (
          <button onClick={startGoogle} className="w-full text-sm font-medium tracking-wide flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-emerald-600 to-sky-600 hover:from-emerald-500 hover:to-sky-500 transition shadow-lg shadow-emerald-900/30 border border-white/10">
            <span>Sign in with Google</span>
          </button>
        )}
        {clientId && (
          <>
            {mode==='loading' && (
              <div className="flex flex-col items-center gap-3 py-6">
                <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                <div className="text-[11px] opacity-70">Loading Google Sign-In…</div>
              </div>
            )}
            <div className="w-full flex flex-col items-center">
              <div ref={(el)=>{ if(!buttonContainerRef.current && el){ console.log('[auth] button container ref attached'); } buttonContainerRef.current = el; }} className="mt-2" />
              {mode==='ready' && !buttonContainerRef.current && (
                <div className="text-[10px] text-amber-400 mt-2">Button container not mounted</div>
              )}
            </div>
          </>
        )}
        {clientId && mode==='error' && (
          <div className="mt-4 text-[11px] text-rose-300">Failed to load Google Sign-In. Retry?
            <div className="mt-2">
              <button onClick={startGoogle} className="px-3 py-1 rounded bg-rose-600/30 border border-rose-500/40 text-rose-200 text-xs">Retry</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FirstTimeFlow({ faction, archetype, pet, onFaction, onArchetype, onPet, onContinue }: { faction: Faction | null; archetype: Archetype | null; pet: PetType | null; onFaction: (f: Faction) => void; onArchetype: (a: Archetype) => void; onPet: (p: PetType) => void; onContinue: () => void; }) {
  const [step, setStep] = useState(0);
  // Full Screen support for the setup container
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    function onChange() {
      setIsFs(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        containerRef.current?.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    } catch (err) {
      console.warn('Fullscreen toggle failed', err);
    }
  }
  const factionDetails: Record<Faction, { name: string; mission: string; objectives: string; lore: string; }> = {
    PAA: {
      name: 'PAA – Pan-African Alliance',
      mission: 'Unite fractured societies under peacekeeping and healing technologies; prioritize diplomacy and reconstruction over war.',
      objectives: 'Secure and rebuild territories with non-lethal tech, protect civilians, and stabilize regions torn by conflict.',
      lore: 'Emerging from Africa’s continental unity movements, the PAA represents hope and healing in a world scarred by collapse. They carry the legacy of ancestral cooperation, combining cultural wisdom with advanced technology to show survival without domination is possible.'
    },
    ASF: {
      name: 'ASF – African Sovereignty Front',
      mission: 'Guard Africa’s independence and resources from external exploitation; ensure no foreign domination returns.',
      objectives: 'Defend borders, strike against intruders, and expand African influence through technological warfare and guerrilla tactics.',
      lore: 'Forged from centuries of resistance, the ASF is relentless in its pursuit of autonomy. They remember colonization’s scars and vow never to repeat them, embodying the warrior spirit of sovereignty at all costs.'
    },
    WC: {
      name: 'WC – World Coalition',
      mission: 'Survival through opportunism; gather resources wherever possible to ensure continuity of fragmented global powers.',
      objectives: 'Secure supplies, dominate weaker groups, and re-establish their authority over contested zones.',
      lore: 'The remnants of old world governments and corporations, the WC cling to power with desperation. Their past mistakes haunt them, but they push forward, scavenging tech and enforcing control to survive in the Afro-Future age.'
    },
  };
  const archetypeDetails: Record<Faction, Record<Archetype, { title: string; objective: string; lore: string }>> = {
    PAA: {
      MALE: { title: 'Male (Engineer-Diplomat)', objective: 'Protect allies using shield technology, drones, and peacekeeping gear.', lore: 'A descendant of healers and negotiators, he turns battlefields into sanctuaries with tech that embodies unity.' },
      FEMALE: { title: 'Female (Peace Ambassador)', objective: 'Disarm and disable threats, inspire cooperation, and rally civilians to the cause.', lore: 'Embodying the spirit of ubuntu, she bridges divides through grace and martial discipline, reminding enemies of shared humanity.' },
    },
    ASF: {
      MALE: { title: 'Male (Cyber Tactician)', objective: 'Lead assaults, disrupt enemy infrastructure, and command tactical overlays for squad dominance.', lore: 'A strategist born from insurgent traditions, his every move echoes the resistance of his ancestors.' },
      FEMALE: { title: 'Female (Warfare Strategist)', objective: 'Control zones, disrupt enemy communications, and turn terrain into traps.', lore: 'Channeling the legacy of warrior queens, she redefines the battlefield, weaving resilience and cunning into every strike.' },
    },
    WC: {
      MALE: { title: 'Male (Frontline Commander)', objective: 'Dominate frontlines with brute force and survival tactics, rally scattered survivors under command.', lore: 'Once an officer of a fallen regime, he now wages war with whatever scraps remain, haunted but unyielding.' },
      FEMALE: { title: 'Female (Resource Scientist)', objective: 'Innovate with makeshift tools, weaponize chemistry, and adapt technology for survival.', lore: 'A survivor-scientist, she transforms scarcity into strength, embodying humanity’s adaptability in collapse.' },
    },
  };
  const petDetails: Record<PetType, { role: string; abilities: string[]; lore: string }> = {
    CYBER_DOG: { role: 'Scout & Protector', abilities: ['Track', 'Bark Stun', 'Guard'], lore: 'Engineered as loyal guardians, Cyber-Dogs blend military robotics with canine instinct. They embody loyalty and resilience, never abandoning their human partner.' },
    CYBER_CAT: { role: 'Stealth & Support', abilities: ['Sneak', 'Distract', 'Hack Scratch'], lore: 'Agile, silent, and mischievous, Cyber-Cats are the unseen eyes in contested zones. Descendants of cultural reverence for felines, they represent mystery and independence, thriving in chaos.' },
  };
  const steps = ['Faction', 'Archetype', 'Pet'];
  const chosenFaction = faction ?? null;
  const arch = chosenFaction && archetype ? archetypeDetails[chosenFaction][archetype] : null;
  const petInfo = pet ? petDetails[pet] : null;
  return (
    <div className="w-full h-full bg-[#0b0e13] text-gray-100 flex flex-col items-center p-6">
      <div ref={containerRef} className="w-full max-w-5xl bg-[#12171f] rounded-2xl p-6 border border-white/10 shadow-2xl flex flex-col min-h-0" style={{height:'100%'}}>
        <div className="flex items-center justify-between shrink-0">
          <h2 className="text-2xl font-semibold tracking-wide">Create Your Character</h2>
          <div className="flex items-center gap-3">
            <div className="text-sm opacity-70">Step {step + 1} / {steps.length}</div>
            {step === 0 && (
              <button
                onClick={toggleFullscreen}
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition"
                aria-label={isFs ? 'Exit Full Screen' : 'Full Screen'}
                title={isFs ? 'Exit Full Screen' : 'Full Screen'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 9V5h4"/>
                  <path d="M20 9V5h-4"/>
                  <path d="M4 15v4h4"/>
                  <path d="M20 15v4h-4"/>
                </svg>
              </button>
            )}
          </div>
        </div>
  {/* Scrollable content region (was overflow-hidden) */}
  <div className="mt-4 flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1">
        {step === 0 && (
          <div className="mt-6">
            <div className="text-sm opacity-80 mb-2">Choose Faction</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {(['PAA', 'ASF', 'WC'] as Faction[]).map((f) => (
                <button
                  key={f}
                  onClick={() => onFaction(f)}
                  className={`group px-3 pt-4 pb-4 rounded-2xl border transition text-base flex flex-col items-center gap-3 relative overflow-hidden
                    ${faction === f ? 'bg-emerald-600/30 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                >
                  <div className="w-full aspect-square rounded-xl bg-white/5 flex items-center justify-center overflow-hidden ring-1 ring-white/5 relative">
                    <img src={ImageAssets.faction[f]} alt={f} className="absolute inset-0 w-full h-full object-cover drop-shadow transform scale-[0.75]" />
                  </div>
                  <span className="font-medium tracking-wide">{f}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col max-h-[32vh] md:max-h-none overflow-y-auto">
              {chosenFaction ? (
                <div className="flex flex-col text-sm sm:text-base md:text-lg leading-relaxed">
                  <div className="text-base font-semibold flex items-center gap-2 mb-1">
                    <img src={FactionIcon[chosenFaction]} className="w-5 h-5" />
                    {factionDetails[chosenFaction].name}
                  </div>
                  <div className="mt-1"><span className="text-emerald-300 font-medium">Mission:</span> {factionDetails[chosenFaction].mission}</div>
                  <div className="mt-2"><span className="text-emerald-300 font-medium">Objectives:</span> {factionDetails[chosenFaction].objectives}</div>
                  <div className="mt-2 space-y-1">
                    <div className="text-emerald-300 font-medium">Lore:</div>
                    <div className="opacity-80 text-xs sm:text-sm md:text-[17px] leading-snug whitespace-pre-line">{factionDetails[chosenFaction].lore}</div>
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="text-emerald-300 font-medium">Why We Fight:</div>
                    <div className="opacity-80 text-xs sm:text-sm md:text-[17px] leading-snug whitespace-pre-line">{FACTION_MOTIVATION[chosenFaction].why}</div>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    <div className="text-emerald-300 font-medium">Rivals:</div>
                    {(Object.entries(FACTION_MOTIVATION[chosenFaction].stance) as [Faction, string][]).map(([rival, text]) => (
                      <div key={rival} className="opacity-80 text-xs sm:text-sm md:text-[16px] leading-snug">
                        <span className="font-semibold" style={{ color: rival === 'ASF' ? '#f59e0b' : rival === 'WC' ? '#60a5fa' : '#34d399' }}>{factionDetails[rival].name.split(' – ')[0]}: </span>
                        {text}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-sm opacity-60">Select a faction to see details.</div>
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <Button onClick={() => setStep(1)} disabled={!faction}>Next</Button>
            </div>
          </div>
        )}
        {step === 1 && (
          <div className="mt-6">
            <div className="text-sm opacity-80 mb-2">Choose Archetype</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-[640px]">
              {(['MALE','FEMALE'] as Archetype[]).map(g => {
                const img = chosenFaction ? getCharacterPortrait(chosenFaction, g) : (g === 'MALE' ? CharacterPortrait.MALE : CharacterPortrait.FEMALE);
                const active = archetype === g;
                const nameMap: Record<Faction, Record<Archetype, string>> = {
                  PAA: { MALE: 'Kwame', FEMALE: 'Nia' },
                  ASF: { MALE: 'Zuberi', FEMALE: 'Makena' },
                  WC: { MALE: 'Jonathan', FEMALE: 'Emily' },
                };
                const label = chosenFaction ? nameMap[chosenFaction][g] : (g === 'MALE' ? 'Male' : 'Female');
                return (
                  <button
                    key={g}
                    onClick={() => onArchetype(g)}
                    title={label}
                    className={`group px-3 pt-4 pb-4 rounded-2xl border transition text-base flex flex-col items-center gap-3 relative overflow-hidden
                      ${active ? 'bg-emerald-600/30 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                  >
                    <div className="w-full aspect-square rounded-xl bg-white/5 overflow-hidden flex items-center justify-center ring-1 ring-white/5 relative">
                      <img src={img} alt={label} className="absolute inset-0 w-full h-full object-cover drop-shadow transform scale-[0.75]" />
                    </div>
                    <span className="font-medium tracking-wide">{label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm sm:text-base md:text-lg flex flex-col max-h-[30vh] md:max-h-none overflow-y-auto">
              {arch ? (
                <div className="flex flex-col">
                  <div className="font-semibold text-base mb-2">{arch.title}</div>
                  <div><span className="text-emerald-300 font-medium">Objective:</span> {arch.objective}</div>
                  <div className="mt-2 space-y-1">
                    <div className="text-emerald-300 font-medium">Lore:</div>
                    <div className="opacity-80 text-xs sm:text-sm md:text-[17px] leading-snug whitespace-pre-line">{arch.lore}</div>
                  </div>
                </div>
              ) : (
                <div className="opacity-60">Select a character to see details.</div>
              )}
            </div>
            <div className="mt-6 flex justify-between">
              <Button variant="ghost" onClick={() => setStep(0)}>Previous</Button>
              <Button onClick={() => setStep(2)} disabled={!archetype}>Next</Button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="mt-6">
            <div className="text-sm opacity-80 mb-2">Choose Pet</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-[640px]">
              {(['CYBER_DOG', 'CYBER_CAT'] as PetType[]).map(p => {
                const img = ImageAssets.pets[p];
                const active = pet === p;
                return (
                  <button
                    key={p}
                    onClick={() => onPet(p)}
                    className={`group px-3 pt-4 pb-4 rounded-2xl border transition text-base flex flex-col items-center gap-3 relative overflow-hidden
                        ${active ? 'bg-emerald-600/30 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                  >
                    <div className="w-full aspect-square rounded-xl bg-white/5 flex items-center justify-center overflow-hidden ring-1 ring-white/5 relative">
                      <img src={img} alt={p} className="absolute inset-0 w-full h-full object-cover drop-shadow transform scale-[0.75]" />
                    </div>
                    <span className="font-medium tracking-wide">{p === 'CYBER_DOG' ? 'Cyber‑Dog' : 'Cyber‑Cat'}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm sm:text-base md:text-lg flex flex-col max-h-[30vh] md:max-h-none overflow-y-auto">
              {petInfo ? (
                <div className="flex flex-col">
                  <div className="font-semibold text-sm md:text-base mb-2">Cyber Companion</div>
                  <div><span className="text-emerald-300 font-medium">Role:</span> {petInfo.role}</div>
                  <div className="mt-2"><span className="text-emerald-300 font-medium">Abilities:</span> {petInfo.abilities.join(', ')}</div>
                  <div className="mt-2 space-y-1">
                    <div className="text-emerald-300 font-medium">Lore:</div>
                    <div className="opacity-80 text-xs sm:text-sm md:text-[17px] leading-snug whitespace-pre-line">{petInfo.lore}</div>
                  </div>
                </div>
              ) : (
                <div className="opacity-60">Select a pet to see details.</div>
              )}
            </div>
            <div className="mt-6 flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>Previous</Button>
              <Button onClick={onContinue} disabled={!pet}>Continue</Button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

function MainMenu({ playerName, accountLevel, loadout, onCustomize, heroLocked, view, onChangeView, onLaunch, profile, onSignOut }: { playerName: string; accountLevel: number; loadout: CharacterLoadout; onCustomize: () => void; heroLocked: boolean; view: 'dashboard' | 'skills' | 'store' | 'help' | 'settings' | 'mission'; onChangeView: (v: 'dashboard' | 'skills' | 'store' | 'help' | 'settings' | 'mission') => void; onLaunch?: (mode: 'single' | 'multi' | 'moba') => void; profile?: { sub: string; name?: string; email?: string; picture?: string } | null; onSignOut?: () => void; }) {
  // Keep the skill store level in sync with progression: the higher of the loadout
  // level, the XP-driven hero level, AND the level already in the store. Including the
  // store level is critical — otherwise opening the skill tree right after leveling up
  // in-game (before this dashboard instance's profile has reloaded) would RESET the level
  // back down, zeroing available points and clobbering the saved progression.
  const setSkillLevel = useSkillStore(s=>s.setLevel);
  const { profile: gameProfile } = usePlayerProfile();
  const heroLvl = gameProfile?.progress?.hero?.level ?? 1;
  useEffect(()=>{
    const storeLvl = useSkillStore.getState().level;
    setSkillLevel(Math.max(loadout.level ?? 1, heroLvl, storeLvl));
  }, [loadout.level, heroLvl, setSkillLevel]);
  // On phones the 3-column layout can't fit — show ONE panel at a time via a tab bar.
  const [mobilePanel, setMobilePanel] = React.useState<'left' | 'center' | 'right'>('center');
  const showCls = (k: 'left' | 'center' | 'right') => `${mobilePanel === k ? 'block' : 'hidden'} md:block h-full min-h-0`;
  return (
    <div className="h-full w-full bg-[#0f1218] text-gray-100 relative flex flex-col">
      <TopNav view={view} onChangeView={onChangeView} profile={profile} onSignOut={onSignOut} />
      {/* Mobile panel switcher (hidden on md+) */}
      <div className="md:hidden flex shrink-0 border-b border-white/10 bg-[#141924]">
        {([['left', '👤', 'Character'], ['center', '🏠', 'Home'], ['right', '▶️', 'Play']] as const).map(([k, icon, label]) => (
          <button
            key={k}
            onClick={() => setMobilePanel(k)}
            className={`flex-1 py-2 text-[11px] font-semibold flex items-center justify-center gap-1 transition ${mobilePanel === k ? 'text-emerald-300 border-b-2 border-emerald-400' : 'text-white/55 hover:text-white/80'}`}
          >
            <span>{icon}</span>{label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        <div className="h-full block md:grid md:grid-rows-[1fr]" style={{ gridTemplateColumns: 'minmax(240px,20%) 1fr minmax(240px,20%)' }}>
          <div className={showCls('left')}>
            <LeftPlayerPanel className="h-full" playerName={playerName} accountLevel={accountLevel} loadout={loadout} heroLocked={heroLocked} />
          </div>
          <div className={showCls('center')}>
            <CenterHub className="h-full overflow-y-auto no-scrollbar" loadout={loadout} view={view === 'skills' ? 'dashboard' : view} onOpenHelp={() => onChangeView('help')} />
          </div>
          <div className={showCls('right')}>
            <RightPlayerPanel className="h-full overflow-y-auto no-scrollbar" loadout={loadout} onCustomize={onCustomize} onPlay={(mode)=> onLaunch ? onLaunch(mode) : onChangeView('mission')} />
          </div>
        </div>
      </div>
      {view === 'skills' && (
        <SkillsModal loadout={loadout} onClose={() => onChangeView('dashboard')} />
      )}
    </div>
  );
}

function TopNav({ view, onChangeView, profile, onSignOut }: { view: 'dashboard' | 'skills' | 'store' | 'help' | 'settings' | 'mission'; onChangeView: (v: 'dashboard' | 'skills' | 'store' | 'help' | 'settings' | 'mission') => void; profile?: { sub: string; name?: string; email?: string; picture?: string } | null; onSignOut?: () => void; }) {
  const [open, setOpen] = React.useState(false);
  const { profile: gameProfile } = usePlayerProfile(); // for the live shards balance
  const menuRef = React.useRef<HTMLDivElement|null>(null);
  const [isFs, setIsFs] = React.useState<boolean>(!!document.fullscreenElement);
  React.useEffect(()=>{
    function onChange(){ setIsFs(!!document.fullscreenElement); }
    document.addEventListener('fullscreenchange', onChange);
    return ()=> document.removeEventListener('fullscreenchange', onChange);
  },[]);
  function toggleFullscreen(){
    try {
      if(!document.fullscreenElement){
        // Prefer the root element; the viewport container is fixed to it
        document.documentElement.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    } catch(err){ console.warn('Fullscreen toggle failed', err); }
  }
  React.useEffect(()=>{
    if(!open) return;
    function handle(e:MouseEvent){
      if(menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e:KeyboardEvent){ if(e.key==='Escape') setOpen(false); }
    window.addEventListener('mousedown', handle);
    window.addEventListener('keydown', handleKey);
    return ()=>{ window.removeEventListener('mousedown', handle); window.removeEventListener('keydown', handleKey); };
  },[open]);
  return (
    <div className="shrink-0 flex sm:grid sm:grid-cols-3 items-center gap-2 px-3 sm:px-6 bg-[#141924] border-b border-white/10 h-16 relative">
      <div className="flex items-center shrink-0">
        <button
          onClick={() => onChangeView('dashboard')}
          className="flex items-center gap-2 group"
          title="Home"
        >
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500/30 to-sky-500/30 border border-white/10 flex items-center justify-center font-bold text-sm tracking-wide text-emerald-200 group-hover:from-emerald-500/50 group-hover:to-sky-500/50 transition">
            AF
          </div>
          <span className="text-sm font-semibold tracking-wide bg-gradient-to-r from-emerald-300 to-sky-300 bg-clip-text text-transparent hidden xl:inline-block">Afro‑Future</span>
        </button>
      </div>
  <div className="flex items-center justify-start sm:justify-center gap-3 sm:gap-6 flex-1 min-w-0 overflow-x-auto no-scrollbar text-xs sm:text-base">
        <button className={`shrink-0 opacity-80 hover:opacity-100 transition ${view==='dashboard' ? 'text-emerald-400' : ''}`} onClick={()=>onChangeView('dashboard')}>Dashboard</button>
        <button className={`shrink-0 opacity-80 hover:opacity-100 transition ${view==='skills' ? 'text-emerald-400' : ''}`} onClick={()=>onChangeView('skills')}>Skills</button>
  <button className={`shrink-0 opacity-80 hover:opacity-100 transition ${view==='store' ? 'text-emerald-400' : ''}`} onClick={()=>onChangeView('store')}>Store</button>
  <button className={`shrink-0 opacity-80 hover:opacity-100 transition ${view==='help' ? 'text-emerald-400' : ''}`} onClick={()=>onChangeView('help')}>Help</button>
        {/* Room selector removed per request */}
      </div>
      <div className="ml-auto flex items-center justify-end gap-2 sm:gap-4 shrink-0">
        <div className="hidden sm:flex"><Chip>{(gameProfile?.progress?.shards ?? 0).toLocaleString()} <span className="opacity-70">shards</span></Chip></div>
        {/* (Dead notifications bell removed — there is no notifications center yet.) */}
        <IconButton label={isFs ? 'Exit Fullscreen' : 'Enter Fullscreen'} onClick={toggleFullscreen}>
          {/* Expand arrows icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {isFs ? (
              <>
                <path d="M9 9H5V5"/>
                <path d="M15 9h4V5"/>
                <path d="M9 15H5v4"/>
                <path d="M15 15h4v4"/>
              </>
            ) : (
              <>
                <path d="M4 9V5h4"/>
                <path d="M20 9V5h-4"/>
                <path d="M4 15v4h4"/>
                <path d="M20 15v4h-4"/>
              </>
            )}
          </svg>
        </IconButton>
        {profile ? (
          <div className="relative" ref={menuRef}>
            <button onClick={()=>setOpen(o=>!o)} className="flex items-center gap-2 group">
              {profile.picture ? <img className="w-9 h-9 rounded object-cover border border-white/10" src={profile.picture} alt={profile.name || 'avatar'} /> : (
                <div className="w-9 h-9 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center text-xs font-semibold">{(profile.name||profile.email||'U').slice(0,1).toUpperCase()}</div>
              )}
              <div className="hidden md:flex flex-col leading-tight text-left">
                <span className="text-xs font-medium truncate max-w-[120px]" title={profile.name||profile.email}>{profile.name || 'User'}</span>
              </div>
              <svg className={`w-3 h-3 transition ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.51a.75.75 0 01-1.08 0l-4.25-4.51a.75.75 0 01.02-1.06z"/></svg>
            </button>
            {open && (
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-white/10 bg-[#1b222c] shadow-xl shadow-black/40 p-3 flex flex-col gap-2 z-50">
                <div className="flex items-center gap-3 pb-3 border-b border-white/10">
                  {profile.picture ? <img className="w-10 h-10 rounded object-cover border border-white/10" src={profile.picture} alt={profile.name || 'avatar'} /> : (
                    <div className="w-10 h-10 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center text-sm font-semibold">{(profile.name||profile.email||'U').slice(0,1).toUpperCase()}</div>
                  )}
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs font-semibold">{profile.name || 'User'}</span>
                    {profile.email && <span className="text-[10px] opacity-60">{profile.email}</span>}
                  </div>
                </div>
                <button className="text-left text-xs px-3 py-2 rounded-lg hover:bg-white/10 transition" onClick={()=>{ setOpen(false); onChangeView('dashboard'); }}>Account</button>
                <button className="text-left text-xs px-3 py-2 rounded-lg hover:bg-white/10 transition" onClick={()=>{ setOpen(false); onChangeView('settings'); }}>Settings</button>
                <button className="text-left text-xs px-3 py-2 rounded-lg hover:bg-emerald-600/30 hover:text-emerald-200 transition border border-transparent hover:border-emerald-500/40" onClick={()=>{ setOpen(false); window.dispatchEvent(new CustomEvent('af:openInviteDialog')); }}>Invite Friend</button>
                <button className="text-left text-xs px-3 py-2 rounded-lg hover:bg-rose-600/30 hover:text-rose-200 transition border border-transparent hover:border-rose-500/40" onClick={()=>{ setOpen(false); onSignOut?.(); }}>Log out</button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-[11px] opacity-60">Not signed in</div>
        )}
      </div>
    </div>
  );
}

function LeftPlayerPanel({ className = '', playerName, accountLevel, loadout, heroLocked }: { className?: string; playerName: string; accountLevel: number; loadout: CharacterLoadout; heroLocked: boolean; }) {
  // Skill / stat integration
  const skillUnlocked = useSkillStore(s=>s.unlocked);
  const skillSpent = useSkillStore(s=>s.spent);
  const skillLevel = useSkillStore(s=>s.level);
  const defense = useSkillStore(s=>s.defense);
  const utility = useSkillStore(s=>s.utility);
  // Hero XP from Firestore profile
  const { profile: playerProfile, saveProgress: savePlayerProgress } = usePlayerProfile();
  // Removed Attack/Defense/Utility stat cards per UI cleanup request.
  const primaryBranchRaw = useSkillStore(s=>s.primaryBranch);
  const primaryTypeRaw = useSkillStore(s=>s.primaryType);
  const traitTags = useSkillStore(s=>s.traitTags);
  const respec = useSkillStore(s=>s.respec);
  const unlockOrder = useSkillStore(s=>s.unlockOrder);
  const basePoints = useSkillStore(s=>s.basePoints);
  const bonusPer5 = useSkillStore(s=>s.bonusPer5);
  const bonusBlocks = Math.floor((Math.max(1,skillLevel)-1)/5);
  const pointsLeft = basePoints + (Math.max(1,skillLevel)-1) + bonusBlocks * bonusPer5 - skillSpent;
  const primaryBranch = primaryBranchRaw && primaryBranchRaw.toLowerCase() === 'root' ? undefined : primaryBranchRaw;
  const primaryType = primaryTypeRaw && primaryTypeRaw.toLowerCase() === 'root' ? undefined : primaryTypeRaw;
  // Effective stats: faction/character base + level growth + skill-tree modifiers.
  const attack = useSkillStore(s=>s.attack);
  const unlockedFactionAbilities: string[] = (playerProfile as any)?.progress?.factionAbilities ?? [];
  const factionPoints: number = (playerProfile as any)?.progress?.factionPoints ?? 0;
  const effectiveLevel = Math.max(loadout.level ?? 1, playerProfile?.progress?.hero?.level ?? 1);
  const stats = React.useMemo(
    () => computeEffectiveStats((loadout as any)?.faction, (loadout as any)?.archetype, { level: skillLevel, attack, defense, utility }, factionAbilityBonus(unlockedFactionAbilities)),
    [(loadout as any)?.faction, (loadout as any)?.archetype, skillLevel, attack, defense, utility, unlockedFactionAbilities.join(',')],
  );
  const unlockFactionAbility = (a: FactionAbility) => {
    if (unlockedFactionAbilities.includes(a.id)) return;
    if (effectiveLevel < a.reqLevel || factionPoints < a.cost) return;
    savePlayerProgress({ factionPoints: factionPoints - a.cost, factionAbilities: [...unlockedFactionAbilities, a.id] } as any);
  };
  const HP = stats.total.hp;
  const EP = stats.total.ep;
  const [shareOpen, setShareOpen] = React.useState(false);
  const shareRef = React.useRef<HTMLDivElement|null>(null);
  React.useEffect(()=>{
    if(!shareOpen) return;
    function onDown(e:MouseEvent){ if(shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false); }
    function onKey(e:KeyboardEvent){ if(e.key==='Escape') setShareOpen(false); }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return ()=>{ window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  },[shareOpen]);
  function characterShareUrl(){
    const base = location.origin.replace(/\/$/, '');
    const params = new URLSearchParams();
    params.set('char', encodeURIComponent(loadout.id));
    // Carry faction + portrait so landing page (or future server-side OG rendering) can hydrate context
    params.set('faction', loadout.faction);
    if(loadout.portraitUrl) {
      try { params.set('portrait', new URL(loadout.portraitUrl, location.origin).toString()); } catch {}
    }
    // Include hero name for /og/card endpoint usage by social scrapers
    if(loadout.name) params.set('name', encodeURIComponent(loadout.name));
    return `${base}/?share=${params.toString()}`;
  }
  function copyShare(){
    try { navigator.clipboard.writeText(characterShareUrl()); } catch {}
  }
  async function doShare(target: string){
    const url = characterShareUrl();
    if(target==='copy'){ copyShare(); setShareOpen(false); return; }
    // Removed direct image URL from share copy to avoid exposing raw PNG link in social posts.
    const baseText = `Check out my Afro-Future hero ${loadout.name} of faction ${loadout.faction}!`;
    // Previously appended portraitAbs; now intentionally omitted for cleaner post & to rely on OG metadata.
    const textEnc = encodeURIComponent(baseText);
    const longTextEnc = textEnc; // no longer a longer variant with image URL
    // Optional: use Web Share API (system share sheet) when available and a future 'system' target is passed
    if(target==='system' && (navigator as any).share){
      try {
        // Attempt including image if CORS-permitted
        // We still attempt image attachment for system share if permissible; reconstruct portraitAbs on-demand
        let files: File[] | undefined;
        try {
          const portraitAbs = new URL(loadout.portraitUrl, location.origin).toString();
          if((navigator as any).canShare){
            try {
              const resp = await fetch(portraitAbs, { mode:'cors' });
              const blob = await resp.blob();
              const f = new File([blob], 'hero.png', { type: blob.type || 'image/png' });
              if((navigator as any).canShare({ files:[f] })) files = [f];
            } catch {}
          }
        } catch {}
        await (navigator as any).share({ title: 'Afro-Future Hero', text: baseText, url, files });
        setShareOpen(false);
        return;
      } catch {}
    }
    // Append UTM parameters for attribution
    function withUtm(base: string, source: string){
      const sep = base.includes('?') ? '&' : '?';
      return `${base}${sep}utm_source=${encodeURIComponent(source)}&utm_medium=social&utm_campaign=character_share`;
    }
    const trackedUrl = withUtm(url, 'generic');
    const shareLinks: Record<string,string> = {
      twitter: `https://twitter.com/intent/tweet?text=${longTextEnc}&url=${encodeURIComponent(withUtm(url,'twitter'))}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(withUtm(url,'facebook'))}`,
      reddit: `https://www.reddit.com/submit?url=${encodeURIComponent(withUtm(url,'reddit'))}&title=${textEnc}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(withUtm(url,'linkedin'))}`,
    };
    const href = shareLinks[target];
    if(href) window.open(href, '_blank','noopener,noreferrer');
  }
  return (
    <aside className={`col-start-1 h-full min-h-0 ${className} bg-[#0f1218] border-r border-black/40 shadow-inner flex flex-col overflow-y-auto overflow-x-hidden no-scrollbar`}>
      <div className="px-4 py-4 border-b border-white/10 flex flex-col items-center shrink-0 relative">
        {/* Character Portrait and Info */}
        <div className="w-full max-w-[260px] aspect-[4/3] rounded-3xl border border-white/10 bg-[#12171f] overflow-hidden relative flex flex-col items-center justify-center">
          {/* Portrait image responsive */}
          <img className="w-[52%] h-[52%] object-cover rounded-2xl border border-white/10 shadow-lg" src={loadout.portraitUrl} alt="portrait" onError={(e)=>{ const t=e.currentTarget; if(!t.dataset.fb){ t.dataset.fb='1'; t.src='/assets/characters/female_default.svg'; }}} />
          {/* Share button */}
          <button onClick={()=>setShareOpen(o=>!o)} title="Share Character" className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/50 border border-white/10 flex items-center justify-center text-[13px] hover:bg-black/60 group">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-80 group-hover:opacity-100">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <path d="M8.59 13.51l6.83 3.98" />
              <path d="M15.41 6.51l-6.82 3.98" />
            </svg>
          </button>
          {shareOpen && (
            <div ref={shareRef} className="absolute z-20 top-12 right-2 w-56 rounded-xl border border-white/10 bg-[#1b222c] shadow-xl p-3 flex flex-col gap-2 animate-fade-in">
              <div className="text-xs font-semibold tracking-wide">Share Character</div>
              <div className="text-[10px] opacity-70 -mt-1">Invite friends and show off your build</div>
              <div className="grid grid-cols-4 gap-1 mt-2">
                <button onClick={()=>doShare('twitter')} className="h-5 rounded-md bg-white/5 border border-white/10 text-[9px] leading-none hover:bg-[#1d9bf0]/30 hover:text-[#1d9bf0] px-1">X</button>
                <button onClick={()=>doShare('facebook')} className="h-5 rounded-md bg-white/5 border border-white/10 text-[9px] leading-none hover:bg-blue-600/40 hover:text-blue-300 px-1">Fb</button>
                <button onClick={()=>doShare('reddit')} className="h-5 rounded-md bg-white/5 border border-white/10 text-[9px] leading-none hover:bg-orange-600/40 hover:text-orange-300 px-1">Rdt</button>
                <button onClick={()=>doShare('linkedin')} className="h-5 rounded-md bg-white/5 border border-white/10 text-[9px] leading-none hover:bg-sky-600/40 hover:text-sky-300 px-1">In</button>
              </div>
              {/* URL + copy removed per request */}
            </div>
          )}
          <div className="mt-2 flex flex-col items-center text-center">
            <div className="flex items-center gap-2">
              <img src={FactionIcon[loadout.faction]} alt={loadout.faction} className="w-5 h-5 drop-shadow" />
              <span className="font-semibold text-white text-sm leading-tight tracking-wide">{loadout.name}</span>
            </div>
            <div className="mt-1 text-[10px] text-gray-300 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 tracking-wide">Lv {Math.max(loadout.level ?? 1, playerProfile?.progress?.hero?.level ?? 1)}</span>
              <span>{loadout.archetype === 'MALE' ? 'Male' : 'Female'}</span>
            </div>
          </div>
          <span className="absolute top-2 left-2 px-2 py-1 rounded-lg bg-black/50 border border-white/10 text-[10px] tracking-wide flex items-center gap-1">
            <img src={FactionIcon[loadout.faction]} alt="faction" className="w-3.5 h-3.5" />
            {loadout.faction}
          </span>
        </div>
        {/* Removed Attack / Defense / Utility stat cards */}
        {/* HP / EP & Skill Tokens */}
        <div className="mt-4 w-full grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-500/10 to-sky-500/10 p-3 flex flex-col text-[10px]">
            <div className="flex justify-between"><span className="opacity-70">HP</span><span className="font-semibold">{HP}</span></div>
            <div className="flex justify-between mt-1"><span className="opacity-70">EP</span><span className="font-semibold">{EP}</span></div>
            <div className="flex justify-between mt-1"><span className="opacity-70">Skill Lv</span><span className="font-semibold">{skillLevel}</span></div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 flex flex-col text-[10px]">
            <div className="flex justify-between"><span className="opacity-70">Tokens Spent</span><span className="font-semibold">{skillSpent}</span></div>
            <div className="flex justify-between mt-1"><span className="opacity-70">Tokens Left</span><span className="font-semibold text-emerald-300">{pointsLeft}</span></div>
            <div className="flex justify-between mt-1"><span className="opacity-70">Unlocked</span><span className="font-semibold">{skillUnlocked.length}</span></div>
          </div>
        </div>
        {/* Combat stats — faction/character base + skill-tree modifiers (green = from skills) */}
        <div className="mt-3 w-full rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-3 text-[10px]">
          <div className="flex justify-between mb-1.5">
            <span className="opacity-70 uppercase tracking-wide">Stats</span>
            <span className="opacity-50">{((loadout as any)?.faction) || 'PAA'} · {(loadout as any)?.archetype === 'MALE' ? '♂' : '♀'}</span>
          </div>
          <div className="grid grid-cols-5 gap-1">
            {STAT_META.map(m => {
              const total = (stats.total as any)[m.key] as number;
              const bonus = (stats.skill as any)[m.key] as number;
              return (
                <div key={m.key} className="flex flex-col items-center rounded-lg bg-white/5 border border-white/10 py-1.5">
                  <span className="text-xs leading-none" title={m.label}>{m.icon}</span>
                  <span className="font-bold tabular-nums mt-0.5">{total}</span>
                  {bonus > 0 && <span className="text-emerald-300 text-[8px] leading-none">+{bonus}</span>}
                </div>
              );
            })}
          </div>
        </div>
        {/* Faction abilities — unlock with Faction Points at the required level (GDD) */}
        <div className="mt-3 w-full rounded-2xl border border-white/10 bg-gradient-to-br from-fuchsia-500/10 to-indigo-500/10 p-3 text-[10px]">
          <div className="flex justify-between mb-2">
            <span className="opacity-70 uppercase tracking-wide">Faction Abilities</span>
            <span className="font-semibold text-fuchsia-300">◈ {factionPoints} FP</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {abilitiesForFaction(loadout.faction).map(a => {
              const owned = unlockedFactionAbilities.includes(a.id);
              const canUnlock = !owned && effectiveLevel >= a.reqLevel && factionPoints >= a.cost;
              return (
                <div key={a.id} className={`flex items-center gap-2 rounded-lg border p-1.5 ${owned ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-white/10 bg-white/5'}`}>
                  <span className="text-sm leading-none">{a.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{a.name}</div>
                    <div className="opacity-60 leading-tight">{a.description}</div>
                  </div>
                  {owned ? (
                    <span className="text-emerald-300 font-semibold shrink-0">Owned</span>
                  ) : (
                    <button
                      disabled={!canUnlock}
                      onClick={() => unlockFactionAbility(a)}
                      className={`shrink-0 px-2 py-1 rounded text-[10px] font-semibold transition ${canUnlock ? 'bg-fuchsia-600/40 hover:bg-fuchsia-600/60 border border-fuchsia-400/40' : 'bg-white/5 border border-white/10 opacity-50 cursor-not-allowed'}`}
                      title={effectiveLevel < a.reqLevel ? `Requires level ${a.reqLevel}` : factionPoints < a.cost ? `Costs ${a.cost} FP` : 'Unlock'}
                    >{effectiveLevel < a.reqLevel ? `Lv ${a.reqLevel}` : `${a.cost} FP`}</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* Hero XP progress bar */}
        {(() => {
          // Mirror the in-mission HUD calc exactly (App.tsx heroVitals): hero.xp is a
          // LIFETIME cumulative total, not "progress within the current level" — the
          // previous version compared the raw lifetime total against a per-level cap,
          // which pinned the bar at 100% almost immediately. Derive level FROM xp (not
          // the possibly-lagging stored hero.level) so the level + bar always agree.
          const totalXp = Math.floor(playerProfile?.progress?.hero?.xp ?? 0);
          const heroLevel = Math.max(1, getLevelFromXp(totalXp));
          const heroXp = Math.max(0, totalXp - getTotalXpForLevel(heroLevel));
          const xpMax = Math.max(1, getXpForNextLevel(heroLevel));
          const xpPct = Math.min(100, Math.round((heroXp / xpMax) * 100));
          return (
            <div className="mt-3 w-full rounded-2xl border border-white/10 bg-gradient-to-br from-amber-500/10 to-orange-500/10 p-3 text-[10px]">
              <div className="flex justify-between mb-1.5">
                <span className="opacity-70">Hero XP · Lv {heroLevel}</span>
                <span className="font-semibold text-amber-300">{heroXp} / {xpMax}</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-500 to-orange-400 transition-all" style={{ width: `${xpPct}%` }} />
              </div>
            </div>
          );
        })()}
        {/* Traits summary */}
        <div className="mt-4 w-full rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-3 text-[10px] flex flex-col gap-1">
          <div className="flex justify-between"><span className="opacity-70">Primary Path</span><span className="font-semibold text-emerald-300">{primaryBranch || ', '}</span></div>
          <div className="flex justify-between"><span className="opacity-70">Primary Type</span><span className="font-semibold text-sky-300">{primaryType || ', '}</span></div>
          <div className="mt-1 flex flex-wrap gap-1">
            {traitTags.length ? traitTags.map(t => <TraitTag key={t} tag={t} />) : (
              <span className="opacity-50">Earn traits by investing tokens</span>
            )}
          </div>
          <div className="mt-2 flex justify-end">
            <button
              disabled={!unlockOrder.length}
              onClick={()=>{ if(!unlockOrder.length) return; if(confirm('Respec will refund all spent tokens. Proceed?')) respec(); }}
              className="px-2.5 py-1 rounded-lg border text-[10px] tracking-wide disabled:opacity-40 disabled:cursor-not-allowed bg-white/5 border-white/10 hover:bg-white/10"
            >Respec</button>
          </div>
        </div>
      </div>
      {/* Pet image card — level/xp/bond/abilities come from the LIVE persisted profile
          (profile.progress.pet), not the static avatar-configurator loadout, so this
          reflects actual in-mission pet progress instead of always showing the pet's
          creation-time level. */}
      <div className="px-4 py-4 flex flex-col items-center gap-4">
        {(() => {
          const petType = (playerProfile?.progress?.pet?.type as typeof loadout.pet.type) ?? loadout.pet.type;
          const petLevel = playerProfile?.progress?.pet?.level ?? loadout.pet.level ?? 1;
          const petBond = playerProfile?.progress?.pet?.bond ?? 0;
          const species = getPetSpecies(petType);
          const tierIdx = bondTierIndex(petBond);
          const bondPct = Math.round(bondTierProgress(petBond) * 100);
          const petAbilities = petAbilitiesWithState(petType, petLevel, petBond);
          return (
            <div className="w-full max-w-[260px] rounded-3xl border border-white/10 bg-white/5 overflow-hidden relative flex flex-col items-center p-4">
              <div className="absolute inset-0 bg-gradient-to-tr from-[#0b0e13]/80 via-transparent to-[#0b0e13]/50" />
              <img className="relative z-10 w-[42%] object-contain drop-shadow" src={PetIcon[petType]} alt="pet" />
              <div className="relative z-10 mt-2 flex flex-col items-center text-center w-full">
                <div className="font-semibold text-white text-sm leading-tight tracking-wide">{species.name}</div>
                <div className="mt-1 text-[10px] text-gray-300 flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 tracking-wide">Lv {petLevel}</span>
                  <span>{BOND_TIERS[tierIdx].name}</span>
                </div>
                <div className="mt-2 w-full">
                  <div className="flex justify-between text-[9px] opacity-70 mb-0.5">
                    <span>Bond</span><span>{bondPct}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-pink-500 to-fuchsia-400" style={{ width: `${bondPct}%` }} />
                  </div>
                </div>
                <div className="mt-2 w-full flex flex-wrap justify-center gap-1.5">
                  {petAbilities.map(a => (
                    <span
                      key={a.id}
                      title={a.unlocked ? `${a.name}, ${a.description}` : `${a.name}, Unlocks at Lv ${a.reqLevel}, ${BOND_TIERS[a.reqBondTier].name} bond`}
                      className={`text-sm ${a.unlocked ? '' : 'opacity-30 grayscale'}`}
                    >{a.unlocked ? a.icon : '🔒'}</span>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
      {/* Pet stat chips removed per request */}
    </aside>
  );
}

function RightPlayerPanel({ className = '', loadout, onCustomize, onPlay }: { className?: string; loadout: CharacterLoadout; onCustomize: () => void; onPlay?: (mode: 'single' | 'multi' | 'moba')=>void }) {
  const [mode, setMode] = useState<'single' | 'multi' | 'moba'>('single');
  const [queue] = useState<string | null>(null);

  function startMatch() {
    // Both modes launch the mission; multiplayer additionally auto-opens the duel
    // lobby + quick-match (handled in SoloMissionMap3D via autoMultiplayer).
    onPlay?.(mode);
  }

  const modes: { key: 'single' | 'multi' | 'moba'; label: string; enabled: boolean }[] = [
    { key: 'single', label: 'Single Player', enabled: true },
    { key: 'multi', label: 'Multiplayer, 1v1 Duel', enabled: true },
    { key: 'moba', label: 'Multiplayer, 1v1v1 MOBA', enabled: true },
  ];
  
  return (
  <aside className={`col-start-3 h-full min-h-0 ${className} bg-[#0f1218] border-l border-black/40 shadow-inner flex flex-col pr-3`}>
        {/* 3D Avatar Section – match left character card size */}
        <div className="p-3 border-b border-white/10">
          <div className="w-full flex items-center justify-center">
            <div className="relative w-full max-w-[240px] aspect-[4/3] rounded-3xl border border-white/10 bg-gradient-to-br from-[#0b0e13] to-[#1a1e29] overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-tr from-[#0b0e13]/80 via-transparent to-[#0b0e13]/50" />
              <div className="absolute inset-x-0 bottom-0 top-[20%]">
                <CanvasErrorBoundary fallback={<div className="w-full h-full flex items-center justify-center text-xs opacity-40">avatar preview unavailable</div>}>
                <AvatarScene
                  parts={(loadout as any).threeConfig?.parts ?? DEFAULT_THREE_PARTS}
                  colors={(loadout as any).threeConfig?.colors ?? DEFAULT_THREE_COLORS}
                  debugTint={false}
                  animPaused={false}
                  animSpeed={1}
                  rotateSpeed={0.08}
                  disableControls
                  cameraPosition={[1.6,1.0,2.4]}
                  cameraFov={30}
                  target={[0,0.55,0]}
                  modelOffset={[0,-0.7,0]}
                  autoFrame
                  frameMargin={0.12}
                />
                </CanvasErrorBoundary>
              </div>
            </div>
          </div>
          <div className="mt-2 flex justify-center">
            <Button size="sm" className="w-full max-w-[240px] text-xs" onClick={onCustomize}>Customize</Button>
          </div>
        </div>
  {/* Game Modes Section */}
  <div className="px-4 py-3 border-b border-white/10">
        <div className="text-lg font-semibold mb-4">Game Modes</div>
        <div className="grid gap-3">
          {modes.map(m => (
            <button
              key={m.key}
              disabled={!m.enabled}
              onClick={() => m.enabled && setMode(m.key)}
              className={`rounded-2xl px-5 py-4 text-center relative overflow-hidden border transition group
                min-h-[45px] flex items-center justify-center
                ${mode === m.key ? 'bg-emerald-600/30 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10'}
                ${!m.enabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <div className="flex flex-col items-center justify-center w-full text-center">
                <span className="font-medium text-sm tracking-wide mb-0.5">{m.label}</span>
                <span className="text-[11px] opacity-60">{m.enabled
                  ? (m.key === 'single' ? 'Story campaign, race two rival empires'
                    : m.key === 'multi' ? '1v1 duel, first to 3 takedowns'
                    : 'Fill a victory track before your rivals')
                  : 'Unavailable'}</span>
              </div>
              {/* Removed 'Active' badge per request */}
            </button>
          ))}
          </div>
        </div>
  {/* Play footer pinned to bottom */}
  <div className="p-4 mt-auto bg-[#0f1218]">
          <Button className="w-full h-12 text-lg" onClick={startMatch}>{mode === 'multi' ? 'Play, Find Duel' : mode === 'moba' ? 'Play, 1v1v1 MOBA' : 'Play'}</Button>
          <div className="mt-1 text-[11px] text-gray-300 h-4">{queue ?? (mode === 'multi' ? 'Opens the duel lobby on entry' : mode === 'moba' ? 'Opens the MOBA lobby, pick a faction, host or join' : 'Continue your campaign, defeat, capture or negotiate to victory')}</div>
        </div>
    </aside>
  );
}

function CenterHub({ className = '', loadout, view, onOpenHelp }: { className?: string; loadout: CharacterLoadout; view: 'dashboard' | 'skills' | 'store' | 'help' | 'settings' | 'mission'; onOpenHelp?: () => void }) {
  // (The 'skills' view never reaches CenterHub — MainMenu remaps it to 'dashboard'
  // and renders the full-screen SkillsModal instead; the old duplicate branch that
  // rendered a second skill tree here was removed.)
  if (view === 'store') {
    return <StoreView className={className} />;
  }
  if (view === 'mission') {
    // Redundant mission map render path removed; the dedicated MissionScreen handles live mission gameplay.
    return (
      <main className={`col-start-2 px-6 py-5 min-h-0 flex flex-col ${className}`}>
        <div className="flex-1 rounded-3xl border border-white/10 bg-[#12171f] overflow-hidden flex items-center justify-center text-[11px] opacity-60">
          Mission launching... (map handled in full-screen mission view)
        </div>
      </main>
    );
  }
  if (view === 'help') {
    return <HelpView className={className} />;
  }
  if (view === 'settings') {
    return <SettingsView className={className} />;
  }
  return (
    <main className={`col-start-2 px-4 sm:px-6 py-4 sm:py-5 min-h-0 flex flex-col gap-4 sm:gap-5 ${className}`}>
      <div className="relative shrink-0 h-44 sm:h-auto sm:flex-[0_0_50%]">
        <HeroBanner loadout={loadout} />
      </div>
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-5 min-h-0">
        <NewsCard title="Campaign: Race the Victory Tracks" blurb="Domination, Control, Prosperity or Exploitation — first faction to fill one wins." onView={onOpenHelp} />
        <NewsCard title="Your Base Grows With You" blurb="Every level adds a building; borders expand and districts unlock as you climb." onView={onOpenHelp} />
        <NewsCard title="Multiplayer: Duels & 1v1v1 MOBA" blurb="Quick-match a 1v1 duel or a three-faction MOBA; AI fills empty factions." onView={onOpenHelp} />
      </div>
    </main>
  );
}

// --- Store (Shopify) View ---
function StoreView({ className='' }: { className?: string }) {
  const [products, setProducts] = React.useState<ShopifyProduct[]|null>(null);
  const [error, setError] = React.useState<string|null>(null);
  const [loading, setLoading] = React.useState(false);
  const [ping, setPing] = React.useState<{ ok: boolean; shopName?: string|null; ms?: number; error?: string; status?: number; snippet?: string; attemptedVersions?: string[] }|null>(null);
  function authHeaderMaybe(){
    const token = localStorage.getItem('afrofuture.idToken');
    return token ? { Authorization: 'Bearer '+token } : {} as Record<string,string>;
  }
  React.useEffect(()=>{
    let active = true;
    async function load(){
      setLoading(true);
      try {
        // Perform storefront ping first to validate token/domain configuration
        try {
          const pr = await fetch('/storefront/ping');
          const txt = await pr.text();
          let pj:any = null; try { pj = JSON.parse(txt); } catch {}
          if(active){
            if(pr.ok && pj?.ok){
              setPing({ ok:true, shopName: pj.shopName, ms: pj.ms });
            } else {
              setPing({ ok:false, error: pj?.error || 'ping_failed', status: pr.status, snippet: (pj?.snippet || txt || '').slice(0,160), attemptedVersions: pj?.attemptedVersions });
              // Abort product load if ping failed for any reason to avoid redundant failures
              if(pj?.error === 'storefront_not_configured' || pj?.error === 'invalid_token_type'){
                setError('Storefront not configured');
              } else {
                setError('Storefront unavailable (ping failed)');
              }
              return;
            }
          }
        } catch (e:any) {
          if(active) setPing({ ok:false, error: e?.message || 'ping_exception' });
        }
        // Prefer Admin REST proxy if available and we are running behind the Node server (not pure file:// or static-only)
        // Only attempt Admin proxy if explicitly enabled via env. Defaults to off in static-only serving.
        const allowAdminProxy = ((import.meta as any)?.env?.VITE_ENABLE_ADMIN_PROXY === 'true');
        if (allowAdminProxy) {
          try {
            const r = await fetch('/admin/products?limit=12', { headers: authHeaderMaybe() });
            if (r.ok) {
              const json = await r.json();
              if (json && json.products) {
                if(active) setProducts(json.products);
                return;
              }
            }
          } catch {}
        }
        // Fallback to Storefront GraphQL (public)
        if(!import.meta.env.VITE_SHOPIFY_STORE_DOMAIN || !import.meta.env.VITE_SHOPIFY_STOREFRONT_TOKEN){
          setError('Shop not configured');
          return;
        }
        const list = await fetchProducts(12);
        if(active) setProducts(list);
      } catch(e:any){ if(active) setError(e.message||'Failed to load'); }
      finally { if(active) setLoading(false); }
    }
    load();
    return ()=>{ active=false; };
  },[]);
  return (
    <main className={`col-start-2 px-6 py-5 min-h-0 flex flex-col ${className}`}>
      <div className="flex-1 rounded-3xl border border-white/10 bg-[#12171f] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div className="text-lg font-semibold">Store</div>
          <span className="text-xs opacity-60">Shopify {ping?.shopName ? `· ${ping.shopName}` : ''}</span>
        </div>
  <div className="flex-1 overflow-hidden p-6">
          {ping && !ping.ok && (
            <div className="mb-4 text-[11px] leading-relaxed rounded-lg border border-amber-400/30 bg-amber-900/20 px-4 py-2 text-amber-200">
              <div className="font-semibold mb-1">Storefront Ping Issue</div>
              <div><span className="opacity-70">Error:</span> {ping.error || 'unknown'}</div>
              {ping.status && <div><span className="opacity-70">Status:</span> {ping.status}</div>}
              {ping.snippet && <div className="mt-1 opacity-70 font-mono break-all max-h-24 overflow-auto">{ping.snippet}</div>}
              {ping.attemptedVersions && ping.attemptedVersions.length>0 && (
                <div className="mt-1 opacity-70">Tried API versions: {ping.attemptedVersions.join(', ')}</div>
              )}
            </div>
          )}
          {error && (
            <div className="text-sm text-rose-300 bg-rose-900/30 border border-rose-500/30 px-4 py-3 rounded-lg">
              {error === 'Shop not configured' ? (
                <>
                  Storefront not configured. Add <code className="font-mono">VITE_SHOPIFY_STORE_DOMAIN</code> & <code className="font-mono">VITE_SHOPIFY_STOREFRONT_TOKEN</code> to .env.
                </>
              ) : error}
            </div>
          )}
          {loading && !products && (
            <div className="flex items-center gap-3 text-sm opacity-70"><div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"/> Loading products…</div>
          )}
          {!loading && products && products.length === 0 && !error && <div className="text-sm opacity-60">No products found.</div>}
          {products && products.length>0 && (
            <div className="grid gap-5" style={{gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))'}}>
              {products.map(p => <ProductCard key={p.id} product={p} />)}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function ProductCard({ product }: { product: ShopifyProduct }) {
  const img = product.images[0];
  const variant = product.variants[0];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden flex flex-col group hover:bg-white/10 transition">
      <div className="aspect-square w-full relative overflow-hidden bg-[#0f141a]">
        {img ? <img src={img.url} alt={img.altText||product.title} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition"/> : (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] opacity-40">No Image</div>
        )}
        <div className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded bg-black/50 backdrop-blur border border-white/10">{variant && variant.price ? `${variant.price.amount}${variant.price.currencyCode? ' '+variant.price.currencyCode : ''}` : ', '}</div>
      </div>
      <div className="p-3 flex flex-col gap-1">
        <div className="text-xs font-semibold tracking-wide line-clamp-2 leading-snug min-h-[2rem]">{product.title}</div>
        <button disabled className="mt-1 text-[11px] px-2 py-1 rounded bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 cursor-not-allowed uppercase tracking-wide">Preview</button>
      </div>
    </div>
  );
}

// --- Settings View ---
function SettingsView({ className='' }: { className?: string }) {
  const version = (typeof window !== 'undefined' && (window as any).__AF_ENV?.buildHash)
    ? (window as any).__AF_ENV.buildHash
    : APP_VERSION_FALLBACK;
  return (
    <main className={`col-start-2 px-6 py-5 min-h-0 flex flex-col ${className}`}>
      <div className="flex-1 rounded-3xl border border-white/10 bg-[#12171f] overflow-hidden p-6 space-y-8">
        <section>
          <h2 className="text-xl font-semibold mb-2">Settings</h2>
          <p className="text-sm opacity-80 leading-relaxed">Configure your experience. (Prototype – values may not persist yet.)</p>
        </section>
        <section className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
            <div className="text-sm font-semibold tracking-wide">Audio</div>
            <div className="flex items-center justify-between text-xs"><span>Master Volume</span><input aria-label="Master Volume" type="range" min={0} max={100} defaultValue={80} /></div>
            <div className="flex items-center justify-between text-xs"><span>Music</span><input aria-label="Music Volume" type="range" min={0} max={100} defaultValue={60} /></div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
            <div className="text-sm font-semibold tracking-wide">Graphics</div>
            <div className="flex items-center justify-between text-xs">
              <span>Quality</span>
              <select className="bg-transparent border border-white/20 rounded px-2 py-1 text-xs">
                <option>Auto</option>
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
              </select>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
            <div className="text-sm font-semibold tracking-wide">Account</div>
            <div className="text-xs opacity-70">More account controls coming soon.</div>
          </div>
        </section>
        <div className="mt-8 text-[4pt] leading-none opacity-60 select-text">{version}</div>
      </div>
    </main>
  );
}

// --- Help View ---
function HelpView({ className='' }: { className?: string }) {
  const items = [
    { title: 'Choose Your Faction', desc: 'PAA, ASF or WC. Your faction tilts one victory track (Prosperity, Domination or Exploitation) but never locks you in: any faction can win any way.', icon: '🏳️' },
    { title: 'Create Your Hero', desc: 'Pick an archetype, then customize parts and colors in the creator. Your hero, skills, pet and shards persist across campaigns.', icon: '🎨' },
    { title: 'The Skill Snowflake', desc: 'Twelve branches around a core. Branch cores are castable abilities (Q/E/R/T offense, Z/X/C/V defense, Tab swaps); deep investment earns trait bonuses to your real stats.', icon: '❄️' },
    { title: 'Win the Campaign', desc: 'Race two rival empires on four victory tracks: Domination, Control, Prosperity, Exploitation. First faction to fill any track wins. Watch the meters in the top bar.', icon: '🏆' },
    { title: 'Capture & Choose', desc: 'Take outposts with G, by assault, or infiltrate 🥷 / negotiate 🕊️ when skilled. Aid or loot refugee camps with H. Your choices build your reputation: Healer to Conqueror.', icon: '🚩' },
    { title: 'Grow Your Base', desc: 'Every level adds a building to your city, the border stroke pushes outward, and districts unlock. Terraform (T at the terraformer) to green the wasteland.', icon: '🏘️' },
    { title: 'Your Pet Companion', desc: 'Cyber-Dog fights beside you; Cyber-Cat scouts. It levels, bonds and unlocks abilities, and fetches supplies from base. Use pack items with 1-8.', icon: '🐾' },
    { title: 'Multiplayer', desc: 'From Game Modes: a 1v1 duel (first to 3 takedowns) or the 1v1v1 MOBA where three factions race the same victory tracks; AI fills empty seats.', icon: '⚔️' },
    { title: 'Controls Recap', desc: 'WASD move · F attack · G capture · H aid · T/Y terraform · C collect · Tab swap ability sets · 1-8 items · ❓ in-mission opens the guided tutorial.', icon: '🕹️' },
    { title: 'Performance', desc: 'The ✨ button toggles high graphics (bloom + sharp shadows), and 🎞 caps the framerate at 30 / 60 / 120. Both live in the mission top bar.', icon: '⚡' },
  ];
  // Two-card pager
  const [page, setPage] = React.useState(0);
  const pages = Math.ceil(items.length / 2);
  const chunks = React.useMemo(() => {
    const out: typeof items[] = [] as any;
    for (let i = 0; i < pages; i++) out.push(items.slice(i * 2, i * 2 + 2));
    return out;
  }, [pages, items.length]);
  const go = (d: number) => setPage(p => Math.max(0, Math.min(p + d, pages - 1)));
  return (
    <main className={`col-start-2 px-6 py-5 min-h-0 flex flex-col ${className}`}>
      <div className="flex-1 rounded-3xl border border-white/10 bg-[#12171f] overflow-hidden p-0">
        <div className="relative h-48 sm:h-56 md:h-64 bg-gradient-to-r from-emerald-600/30 via-sky-600/20 to-indigo-600/20 border-b border-white/10">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.25),transparent_60%)]" />
          <div className="absolute bottom-4 left-6">
            <h2 className="text-2xl md:text-3xl font-semibold">How to Play</h2>
            <div className="text-xs opacity-80">A quick visual guide to get you started</div>
          </div>
        </div>
        <div className="relative p-6">
          {/* Arrow controls */}
          <button
            aria-label="Prev"
            onClick={()=>go(-1)}
            disabled={page===0}
            className="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/40 border border-white/10 hover:bg-black/50 disabled:opacity-40 disabled:cursor-not-allowed grid place-items-center z-10"
          >‹</button>
          <button
            aria-label="Next"
            onClick={()=>go(1)}
            disabled={page>=pages-1}
            className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/40 border border-white/10 hover:bg-black/50 disabled:opacity-40 disabled:cursor-not-allowed grid place-items-center z-10"
          >›</button>
          {/* Two-card paged slider */}
          <div className="overflow-hidden">
            <div className="flex transition-transform duration-300"
              style={{ transform: `translateX(-${page * 100}%)` }}>
              {chunks.map((group, idx) => (
                <div key={idx} className="w-full shrink-0 px-1">
                  <div className="grid grid-cols-2 gap-4">
                    {group.map((s, i) => (
                      <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 flex flex-col gap-3">
                        <div className="text-2xl select-none">{s.icon}</div>
                        <div className="text-sm font-semibold tracking-wide">{s.title}</div>
                        <div className="text-xs opacity-75 leading-relaxed">{s.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Optional: tiny pager dots */}
          <div className="mt-4 flex items-center justify-center gap-2">
            {Array.from({ length: pages }).map((_, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full ${i===page ? 'bg-white/80' : 'bg-white/30'}`} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

// (The old RightStartPanel duplicate was fully removed — RightPlayerPanel owns the
// Game Modes + Play flow.)

function CharacterCreator({ onSave, onBack, initial, locked }: { onSave: (payload: CharacterLoadout) => void; onBack: () => void; initial?: CharacterLoadout; locked?: boolean; }) {
  const { saveProgress } = usePlayerProfile();
  // Dynamic tabs derived from 3D asset mapping
  const [tab, setTab] = useState<string>(GROUP_ORDER[0]);
  const tabs: string[] = [...GROUP_ORDER, 'Colors'];
  // Store picked variant id per group locally (could be moved to zustand later)
  const [picked, setPicked] = useState<Record<string,string|undefined>>(() => {
    const parts = (initial as any)?.threeConfig?.parts;
    return (parts && typeof parts === 'object') ? { ...parts } : {};
  });
  const [colorState, setColorState] = useState<{primary:string;secondary:string;skin:string}>(() => {
    const colors = (initial as any)?.threeConfig?.colors;
    return {
      primary: (colors?.primary as string) || '#00A37A',
      secondary: (colors?.secondary as string) || '#F5F5F5',
      skin: (colors?.skin as string) || '#c58b66',
    };
  });
  // Link skin picker to central creator store so shared skin material updates live in preview
  const setSkinColor = useCreatorStore(s => s.setSkinColor);
  useEffect(()=>{ setSkinColor(colorState.skin); },[colorState.skin,setSkinColor]);
  // Keep local state in sync if parent provides a different initial loadout
  useEffect(() => {
    const parts = (initial as any)?.threeConfig?.parts;
    const colors = (initial as any)?.threeConfig?.colors;
    if (parts && typeof parts === 'object') setPicked({ ...parts });
    if (colors && typeof colors === 'object') setColorState(prev => ({
      primary: (colors.primary as string) || prev.primary,
      secondary: (colors.secondary as string) || prev.secondary,
      skin: (colors.skin as string) || prev.skin,
    }));
  }, [initial]);

  // Animation preview controls
  const [animPaused, setAnimPaused] = useState(false);
  const [animSpeed, setAnimSpeed] = useState(1);

  function selectVariant(group: string, id: string) {
    setPicked(p => {
      const currentlyActive = p[group] === id;
      let next = { ...p, [group]: currentlyActive ? undefined : id };
      // Outfit mutual exclusion logic: selecting an Outfit clears Top & Bottom, selecting Top/Bottom clears Outfit
      if (!currentlyActive) {
        if (group === 'Outfit') {
          next.Top = undefined;
          next.Bottom = undefined;
        } else if (group === 'Top' || group === 'Bottom') {
          next.Outfit = undefined;
        }
      }
      return next;
    });
  }
  function exportPayload() {
    const base = (initial ?? defaultLoadout);
    const threeConfig = buildAvatarConfig(picked, colorState) as any; // extended config with summary
    const payload: CharacterLoadout = locked ?
      { ...base, threeConfig, updatedAt: now() } :
      { ...base, threeConfig, id: uid('char'), createdAt: base.createdAt, updatedAt: now() };
    // Persist avatar config to profile progress
    saveProgress({ avatar: { parts: { ...picked }, colors: { ...colorState }, updatedAt: Date.now() } });
    onSave(payload);
  }
  return (
    <div className="w-full h-full bg-[#0b0e13] text-gray-100 relative flex flex-col">
      <div className="absolute top-4 left-6 flex items-center gap-2 z-10">
        <Button variant="ghost" onClick={onBack}>Back</Button>
      </div>
      {/* Top preview now spans full width */}
        <div className="flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center px-6 py-8">
          <div className="relative w-full h-full max-h-[55vh] rounded-[32px] bg-[#12171f] border border-white/10 shadow-2xl overflow-hidden flex items-center justify-center mx-auto max-w-5xl">
            <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/5 via-transparent to-sky-500/5 pointer-events-none" />
            <div className="absolute inset-0">
              <CanvasErrorBoundary fallback={<div className="w-full h-full flex items-center justify-center text-sm opacity-40">avatar preview unavailable</div>}>
              <AvatarScene
                parts={picked}
                colors={colorState}
                debugTint={false}
                animPaused={animPaused}
                animSpeed={animSpeed}
                // Reduce overall avatar size by 20%
                modelScale={0.8}
                modelOffset={[0,-0.25,0]}
              />
              </CanvasErrorBoundary>
              <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/40 backdrop-blur-sm px-3 py-2 rounded-xl border border-white/10 text-[11px]">
                <button
                  onClick={() => setAnimPaused(p=>!p)}
                  className="px-2 py-1 rounded bg-white/10 hover:bg-white/15 border border-white/10"
                >{animPaused ? 'Play' : 'Pause'}</button>
                <div className="flex items-center gap-1">
                  <span className="opacity-60">Speed</span>
                  <input
                    type="range"
                    min={0.25}
                    max={1.5}
                    step={0.05}
                    value={animSpeed}
                    onChange={e => setAnimSpeed(parseFloat(e.target.value))}
                    className="w-24"
                  />
                  <span className="tabular-nums w-8 text-right">{animSpeed.toFixed(2)}x</span>
                </div>
              </div>
            </div>
            <div className="absolute bottom-4 right-4 text-[11px] px-2 py-1 rounded bg-white/5 border border-white/10 uppercase tracking-wide">Preview 3D</div>
          </div>
        </div>
        {/* Items/config panel full width */}
        <div className="w-full bg-[#12171f]/95 backdrop-blur-sm border-t border-white/10 flex flex-col max-h-[45vh]">
          <div className="px-6 pt-4 flex flex-wrap justify-center gap-2 max-w-5xl mx-auto">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-xl text-sm border transition
                  ${tab === t ? 'bg-emerald-600/30 text-emerald-200 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10 text-gray-300'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="px-6 pb-4 max-w-5xl mx-auto w-full">
            {tab === 'Colors' ? (
              <div className="flex gap-3 justify-center items-center flex-wrap">
                {[
                  { primary:'#00A37A', secondary:'#F5F5F5', skin:'#c58b66' },
                  { primary:'#a855f7', secondary:'#0f172a', skin:'#d19d74' },
                  { primary:'#ef4444', secondary:'#111827', skin:'#c58b66' },
                  { primary:'#10b981', secondary:'#0f172a', skin:'#c58b66' },
                ].map((p,i) => (
                  <button
                    key={i}
                    onClick={()=>setColorState(p)}
                    className="group w-14 h-14 rounded-lg border border-white/10 overflow-hidden relative flex"
                    title="Apply palette"
                  >
                    <div className="flex-1 h-full" style={{background:p.primary}} />
                    <div className="flex-1 h-full" style={{background:p.secondary}} />
                    <div className="flex-1 h-full" style={{background:p.skin}} />
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition text-[9px] font-semibold tracking-wide flex items-center justify-center bg-black/50 text-white">Use</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="relative flex gap-4 overflow-x-auto no-scrollbar py-2 px-1 items-stretch scroll-smooth snap-x snap-mandatory group justify-center" id="variant-row">
                <div className="pointer-events-none sticky left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[#12171f] to-transparent opacity-70 group-hover:opacity-90" />
                <div className="pointer-events-none sticky right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#12171f] to-transparent opacity-70 group-hover:opacity-90" />
                {getVariantsByGroup(tab as any).map((v, idx) => {
                  const active = picked[tab] === v.id;
                  return (
                    <VariantCard
                      key={v.id}
                      v={v}
                      active={active}
                      onSelect={() => selectVariant(tab, v.id)}
                      eager={idx < 6}
                    />
                  );
                })}
                {getVariantsByGroup(tab as any).length === 0 && (
                  <div className="text-xs opacity-50 px-4 py-6">No variants for {tab}</div>
                )}
              </div>
            )}
          </div>
          {/* Sticky action bar */}
          <div className="px-8 py-5 flex justify-end gap-3 border-t border-white/10 bg-[#12171f]/95 sticky bottom-0">
            <Button variant="ghost" onClick={onBack}>Previous</Button>
            <Button onClick={exportPayload}>Save & Continue</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl p-4 bg-white/5 border border-white/10 shadow">{children}</div>;
}

interface VariantCardProps { v: { id:string; file:string; label:string }; active: boolean; onSelect: () => void; eager?: boolean; }
function VariantCard({ v, active, onSelect }: VariantCardProps) {
  const [hover, setHover] = React.useState(false);
  // Mount the live 3D thumbnail ONLY when hovered or active. Each VariantPreview is
  // its own WebGL context; rendering one per card (there can be a dozen per tab)
  // exhausts the browser's ~16-context limit, which blanks the thumbnails AND the
  // main avatar preview (shared limit) and can cascade into a frozen creator UI.
  const show3D = hover || active;
  return (
    <button
      onClick={onSelect}
      title={v.label}
      onMouseEnter={()=>setHover(true)}
      onMouseLeave={()=>setHover(false)}
      className={`w-24 h-24 rounded-xl border transition flex flex-col items-center justify-center gap-1 px-1 text-[11px] snap-start
        ${active ? 'bg-emerald-600/30 border-emerald-500/60 text-emerald-200 shadow-inner ring-2 ring-emerald-400/50' : 'bg-white/5 border-white/10 hover:bg-white/10 text-gray-300'}`}
    >
      <div className="relative w-full h-full flex items-center justify-center">
        {show3D ? <VariantPreview file={v.file} /> : (
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center text-[10px] opacity-60">GLB</div>
        )}
        <div className="absolute bottom-0 left-0 right-0 text-[9px] leading-tight px-1 py-0.5 bg-black/40 backdrop-blur-sm">
          <span className="truncate block max-w-full">{v.label}</span>
          {active && <span className="uppercase tracking-wide text-emerald-300">Selected</span>}
        </div>
      </div>
    </button>
  );
}

function Button({ children, onClick, variant = 'solid', size = 'md', className = '', disabled }: { children: React.ReactNode; onClick?: () => void; variant?: 'solid' | 'ghost'; size?: 'sm' | 'md' | 'lg'; className?: string; disabled?: boolean; }) {
  const base = 'rounded-xl inline-flex items-center justify-center border transition focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = variant === 'ghost'
    ? 'bg-transparent border-white/15 hover:border-white/30 text-gray-100'
    : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-700';
  const sizes = size === 'sm' ? 'h-8 px-3 text-sm' : size === 'lg' ? 'h-12 px-5 text-lg' : 'h-10 px-4';
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${variants} ${sizes} ${className}`}>{children}</button>
  );
}

function IconButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick?: () => void }) {
  return <button aria-label={label} onClick={onClick} className="h-9 w-9 grid place-items-center rounded-xl bg-white/10 border border-white/10 hover:bg-white/15">{children}</button>;
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="px-2.5 py-1 rounded-full bg-white/10 border border-white/10 text-xs">{children}</span>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="px-2 py-1 rounded-lg bg-gray-200 border border-gray-300">{children}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <div className="opacity-80 mb-1">{label}</div>
      {children}
    </label>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-100 border border-gray-300 rounded-lg p-2">
      <div className="text-[10px] opacity-70">{label}</div>
      <div className="font-semibold">{Array.from({ length: 5 }).map((_, i) => (
        <span key={i}>{i < value ? '●' : '○'}</span>
      ))}</div>
    </div>
  );
}

function FactionPill({ faction }: { faction: Faction }) {
  const color: Record<Faction, string> = {
    PAA: 'text-emerald-300',
    ASF: 'text-rose-300',
    WC: 'text-sky-300',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] ${color[faction]}`}>
      <img src={FactionIcon[faction]} alt={faction} className="w-3.5 h-3.5" />
      {faction}
    </span>
  );
}

// TraitTag with icon/color mapping
const TRAIT_META: Record<string,{ icon: string; colors: string }>= {
  'Commander': { icon: '🛡️', colors: 'from-amber-500/30 to-amber-700/30 text-amber-200 border-amber-400/30' },
  'Terraformer': { icon: '🌍', colors: 'from-green-500/30 to-emerald-700/30 text-emerald-200 border-emerald-400/30' },
  'Technocrat': { icon: '🧪', colors: 'from-fuchsia-500/30 to-purple-700/30 text-fuchsia-200 border-fuchsia-400/30' },
  'Trader': { icon: '💱', colors: 'from-cyan-500/30 to-sky-700/30 text-cyan-200 border-cyan-400/30' },
  'Raider': { icon: '⚔️', colors: 'from-rose-500/30 to-red-700/30 text-rose-200 border-rose-400/30' },
  'Aggressor': { icon: '🔥', colors: 'from-orange-500/30 to-red-700/30 text-orange-200 border-orange-400/30' },
  'Support Specialist': { icon: '✚', colors: 'from-emerald-500/30 to-teal-700/30 text-emerald-200 border-emerald-400/30' },
  'Skirmisher': { icon: '🏹', colors: 'from-indigo-500/30 to-blue-700/30 text-indigo-200 border-indigo-400/30' },
};
function TraitTag({ tag }: { tag: string }) {
  const meta = TRAIT_META[tag] || { icon: '✦', colors: 'from-white/10 to-white/5 text-gray-200 border-white/10' };
  return (
    <span className={`px-2 py-0.5 rounded-md border text-[9px] tracking-wide bg-gradient-to-br ${meta.colors} flex items-center gap-1`}>{meta.icon}<span>{tag}</span></span>
  );
}

function HeroBanner({ loadout }: { loadout: CharacterLoadout }) {
  return (
    <div className="w-full h-full rounded-3xl overflow-hidden relative border border-white/10 bg-gradient-to-br from-emerald-500/10 via-[#141b24] to-sky-500/10">
      <img src={loadout.portraitUrl} alt="hero" className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-lighten" onError={(e)=>{ const t=e.currentTarget; if(!t.dataset.fb){ t.dataset.fb='1'; t.src='/assets/characters/female_default.svg'; }}} />
      <div className="absolute inset-0 bg-gradient-to-tr from-[#0b0e13]/60 to-transparent" />
      <div className="absolute left-6 bottom-6">
        <div className="text-xs uppercase tracking-wide opacity-70">Active Character</div>
        <div className="text-3xl font-semibold">{loadout.name}</div>
        <div className="mt-1 flex items-center gap-2 text-sm opacity-90">
          <FactionPill faction={loadout.faction} /> <span>Lv {loadout.level}</span>
        </div>
      </div>
    </div>
  );
}

function NewsCard({ title, blurb, onView }: { title: string; blurb?: string; onView?: () => void }) {
  return (
    <div className="rounded-2xl p-4 bg-[#12171f] border border-white/10 min-h-[42px] grid">
      <div>
        <div className="text-[11px] uppercase tracking-wide opacity-60">News</div>
        <div className="text-lg font-semibold mt-1">{title}</div>
        {blurb && <div className="text-xs opacity-70 mt-1 leading-relaxed">{blurb}</div>}
      </div>
      {onView && (
        <div className="self-end">
          <button onClick={onView} className="h-8 px-3 rounded bg-white/10 hover:bg-white/15 text-sm">Learn more</button>
        </div>
      )}
    </div>
  );
}
