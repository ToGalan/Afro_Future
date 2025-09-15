import React, { useEffect, useState } from 'react';
import { useSkillStore, availablePoints } from './store/skillStore';
import { GROUP_ORDER, getVariantsByGroup } from './assets/threeParts';
import AvatarScene from './components/AvatarScene';
import SnowflakeSkillTree from './components/SnowflakeSkillTree';
import { fetchProducts, type ShopifyProduct } from './services/shopify';
import VariantPreview from './components/VariantPreview';
import { Archetype, CharacterLoadout, Faction, PetType, uid, now } from './types/loadout';
import { CharacterPortrait, FactionIcon, ImageAssets, getCharacterPortrait, PetIcon } from './assets/assetPaths';
import { joinRoom } from './services/realtimeClient';
import { initCRDT, attachCRDTChannel, disposeCRDT } from './services/crdt';
import { useCreatorStore } from './store/creatorStore';
import { initGoogleIdentity, renderGoogleButton, getGoogleClientId } from './services/googleIdentity';
import GoogleSignInButton from './components/auth/GoogleSignInButton';

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
  createdAt: now(),
  updatedAt: now(),
};

export default function App() {
  // Authentication gating: require Google sign-in before proceeding to normal boot sequence.
  const [idToken, setIdToken] = useState<string | null>(() => localStorage.getItem('afrofuture.idToken'));
  const [phase, setPhase] = useState<'auth' | 'boot' | 'onboard' | 'creating' | 'main'>(!localStorage.getItem('afrofuture.idToken') ? 'auth' : 'boot');
  const [rtc, setRtc] = useState<{ ws: WebSocket; pc: RTCPeerConnection; dc: RTCDataChannel } | null>(null);
  const [roomId, setRoomId] = useState<string>(() => localStorage.getItem('afrofuture.room') || 'lobby');
  const [recentRooms, setRecentRooms] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('afrofuture.recentRooms')||'[]'); } catch { return []; }
  });
  const [profile, setProfile] = useState<{ sub: string; name?: string; email?: string; picture?: string } | null>(() => {
    try {
      const raw = localStorage.getItem('afrofuture.profile');
      if(raw) return JSON.parse(raw);
    } catch {}
    return null;
  });
  const [mainView, setMainView] = useState<'dashboard' | 'skills' | 'store' | 'help'>('dashboard');
  const [progress, setProgress] = useState(0);
  const [playerName] = useState('PlayerOne');
  const [accountLevel] = useState(1);
  const [activeLoadout, setActiveLoadout] = useState<CharacterLoadout | null>(null);

  // Hydrate saved avatar (loadout) from localStorage once on mount
  useEffect(()=>{
    try {
      const raw = localStorage.getItem('afrofuture.activeLoadout');
      if(raw){
        const parsed = JSON.parse(raw) as CharacterLoadout;
        if(parsed && parsed.id){
          setActiveLoadout(parsed);
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
    let pct = 0;
    const id = setInterval(() => {
      pct += Math.random() * 18 + 3;
      setProgress(Math.min(100, Math.floor(pct)));
      if (pct >= 100) {
        clearInterval(id);
        if (!activeLoadout) setPhase('onboard'); else setPhase('main');
      }
    }, 300);
    return () => clearInterval(id);
  }, [phase, activeLoadout]);

  async function fetchServerProfile(idToken: string){
    try {
      const res = await fetch('/profile', { headers: { 'Authorization': 'Bearer '+idToken } });
      if(!res.ok) return null;
      const json = await res.json();
      return json.profile || null;
    } catch { return null; }
  }

  async function persistServerProfile(idToken: string, profilePatch: any){
    try {
      await fetch('/profile', { method:'PUT', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+idToken }, body: JSON.stringify(profilePatch) });
    } catch(e){ console.warn('[profile] save failed', e); }
  }

  async function handleSignedIn(token: string){
    setIdToken(token);
    localStorage.setItem('afrofuture.idToken', token);
    setPhase('boot');
    try {
      const payload = JSON.parse(atob(token.split('.')[1] || 'e30='));
      const prof = { sub: payload.sub, name: payload.name || payload.given_name || payload.family_name, email: payload.email, picture: payload.picture };
      setProfile(prof);
      try { localStorage.setItem('afrofuture.profile', JSON.stringify(prof)); } catch {}
      // Fetch existing server profile (may include loadout)
      const serverProf = await fetchServerProfile(token);
      if(serverProf){
        // Merge name/email/picture preference: prefer fresh token payload over stored values
        const mergedProf = { ...serverProf, ...prof };
        setProfile(mergedProf);
        if(serverProf.loadout){ setActiveLoadout(serverProf.loadout); }
        try { localStorage.setItem('afrofuture.profile', JSON.stringify(mergedProf)); } catch {}
        if(serverProf.loadout){ try { localStorage.setItem('afrofuture.activeLoadout', JSON.stringify(serverProf.loadout)); } catch {} }
      } else {
        // Create initial profile server-side
        persistServerProfile(token, { ...prof });
      }
    } catch {}
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
    setIdToken(null);
    setPhase('auth');
    setProfile(null);
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
        const payload = JSON.parse(atob(idToken.split('.')[1]||'e30='));
        const prof = { sub: payload.sub, name: payload.name || payload.given_name || payload.family_name, email: payload.email, picture: payload.picture };
        setProfile(prof);
        try { localStorage.setItem('afrofuture.profile', JSON.stringify(prof)); } catch {}
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
      setActiveLoadout(merged);
      try { localStorage.setItem('afrofuture.activeLoadout', JSON.stringify(merged)); } catch(e){ console.warn('[avatar-persist] save failed', e); }
      if(idToken) persistServerProfile(idToken, { loadout: merged });
      // Broadcast to peers via WebRTC (if data channel open)
      if(rtc?.dc?.readyState === 'open') {
        try { rtc.dc.send(JSON.stringify({ type: 'loadoutUpdate', loadout: merged })); } catch(err){ console.warn('[rtc] broadcast failed', err); }
      }
    } else {
      setActiveLoadout(newLoadout);
      try { localStorage.setItem('afrofuture.activeLoadout', JSON.stringify(newLoadout)); } catch(e){ console.warn('[avatar-persist] save failed', e); }
      if(idToken) persistServerProfile(idToken, { loadout: newLoadout });
      if(rtc?.dc?.readyState === 'open') {
        try { rtc.dc.send(JSON.stringify({ type: 'loadoutUpdate', loadout: newLoadout })); } catch(err){ console.warn('[rtc] broadcast failed', err); }
      }
    }
    setPhase('main');
  }

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
  if (phase === 'boot') return <GameViewport mode="fit"><WelcomeScreen progress={progress} build="v0.2.3 demo • UE5" onSignOut={handleSignOut} /></GameViewport>;

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
              PAA: { MALE: 'Kwame', FEMALE: 'Makena' },
              ASF: { MALE: 'Zuberi', FEMALE: 'Nia' },
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
    <GameViewport mode="fit">
      <MainMenu
        playerName={playerName}
        accountLevel={accountLevel}
        loadout={activeLoadout ?? defaultLoadout}
        onCustomize={() => setPhase('creating')}
        heroLocked={heroLocked}
        view={mainView}
        onChangeView={setMainView}
        profile={profile}
        onSignOut={handleSignOut}
      />
    </GameViewport>
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
    <div className="fixed inset-0 bg-[#06080c] flex items-center justify-center overflow-hidden select-none">
      <div className="relative" style={stageStyle}>
        <div className="absolute inset-0 pointer-events-none shadow-[0_0_0_1px_rgba(255,255,255,0.04)]" />
        {children}
        <div className="absolute bottom-1 right-2 text-[10px] font-mono bg-black/40 backdrop-blur-sm px-2 py-1 rounded border border-white/10 text-white/80">
          {mode === 'fit'
            ? <>fit mode • win {viewport.w}×{viewport.h}</>
            : <>fixed {DESIGN_W}×{DESIGN_H} • win {viewport.w}×{viewport.h} • scale {scale.toFixed(3)}</>
          }
        </div>
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
      await initGoogleIdentity(cid, (resp:any)=>{ 
        console.log('[auth] credential callback fired', resp?.select_by);
        if(resp.credential) onSignedIn(resp.credential); 
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
        await renderGoogleButton(buttonContainerRef.current, {});
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
      name: 'WC – World Confederates',
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
        <div className="mt-4 flex-1 min-h-0 overflow-auto">
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
                    <img src={ImageAssets.faction[f]} alt={f} className="absolute inset-0 w-full h-full object-cover drop-shadow" />
                  </div>
                  <span className="font-medium tracking-wide">{f}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col">
              {chosenFaction ? (
                <div className="flex flex-col text-base md:text-lg leading-relaxed">
                  <div className="text-base font-semibold flex items-center gap-2 mb-1">
                    <img src={FactionIcon[chosenFaction]} className="w-5 h-5" />
                    {factionDetails[chosenFaction].name}
                  </div>
                  <div className="mt-1"><span className="text-emerald-300 font-medium">Mission:</span> {factionDetails[chosenFaction].mission}</div>
                  <div className="mt-2"><span className="text-emerald-300 font-medium">Objectives:</span> {factionDetails[chosenFaction].objectives}</div>
                  <div className="mt-2 space-y-1">
                    <div className="text-emerald-300 font-medium">Lore:</div>
                    <div className="opacity-80 text-[17px] leading-snug whitespace-pre-line">{factionDetails[chosenFaction].lore}</div>
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
                  PAA: { MALE: 'Kwame', FEMALE: 'Makena' },
                  ASF: { MALE: 'Zuberi', FEMALE: 'Nia' },
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
                      <img src={img} alt={label} className="absolute inset-0 w-full h-full object-cover drop-shadow" />
                    </div>
                    <span className="font-medium tracking-wide">{label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-base md:text-lg flex flex-col">
              {arch ? (
                <div className="flex flex-col">
                  <div className="font-semibold text-base mb-2">{arch.title}</div>
                  <div><span className="text-emerald-300 font-medium">Objective:</span> {arch.objective}</div>
                  <div className="mt-2 space-y-1">
                    <div className="text-emerald-300 font-medium">Lore:</div>
                    <div className="opacity-80 text-[17px] leading-snug whitespace-pre-line">{arch.lore}</div>
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
                      <img src={img} alt={p} className="absolute inset-0 w-full h-full object-cover drop-shadow" />
                    </div>
                    <span className="font-medium tracking-wide">{p === 'CYBER_DOG' ? 'Cyber‑Dog' : 'Cyber‑Cat'}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-base md:text-lg flex flex-col">
              {petInfo ? (
                <div className="flex flex-col">
                  <div className="font-semibold text-sm md:text-base mb-2">Cyber Companion</div>
                  <div><span className="text-emerald-300 font-medium">Role:</span> {petInfo.role}</div>
                  <div className="mt-2"><span className="text-emerald-300 font-medium">Abilities:</span> {petInfo.abilities.join(', ')}</div>
                  <div className="mt-2 space-y-1">
                    <div className="text-emerald-300 font-medium">Lore:</div>
                    <div className="opacity-80 text-[15px] md:text-[17px] leading-snug whitespace-pre-line">{petInfo.lore}</div>
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

function MainMenu({ playerName, accountLevel, loadout, onCustomize, heroLocked, view, onChangeView, profile, onSignOut }: { playerName: string; accountLevel: number; loadout: CharacterLoadout; onCustomize: () => void; heroLocked: boolean; view: 'dashboard' | 'skills' | 'store' | 'help'; onChangeView: (v: 'dashboard' | 'skills' | 'store' | 'help') => void; profile?: { sub: string; name?: string; email?: string; picture?: string } | null; onSignOut?: () => void; }) {
  return (
    <div className="h-full w-full bg-[#0f1218] text-gray-100">
      <TopNav view={view} onChangeView={onChangeView} profile={profile} onSignOut={onSignOut} />
      <div className="h-[calc(100%-64px)]">
        <div className="h-full grid grid-rows-[1fr]" style={{gridTemplateColumns:'minmax(260px,20%) 1fr minmax(260px,20%)'}}>
          <LeftPlayerPanel className="row-start-1" playerName={playerName} accountLevel={accountLevel} loadout={loadout} heroLocked={heroLocked} />
          <CenterHub className="row-start-1" loadout={loadout} view={view} />
          <RightPlayerPanel className="row-start-1" loadout={loadout} onCustomize={onCustomize} />
        </div>
      </div>
    </div>
  );
}

function TopNav({ view, onChangeView, profile, onSignOut }: { view: 'dashboard' | 'skills' | 'store' | 'help'; onChangeView: (v: 'dashboard' | 'skills' | 'store' | 'help') => void; profile?: { sub: string; name?: string; email?: string; picture?: string } | null; onSignOut?: () => void; }) {
  const [open, setOpen] = React.useState(false);
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
    <div className="col-span-3 grid grid-cols-3 items-center px-6 bg-[#141924] border-b border-white/10 h-16 relative">
      <div className="flex items-center">
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
      <div className="flex items-center justify-center gap-6">
        <button className={`opacity-80 hover:opacity-100 transition ${view==='dashboard' ? 'text-emerald-400' : ''}`} onClick={()=>onChangeView('dashboard')}>Dashboard</button>
        <button className={`opacity-80 hover:opacity-100 transition ${view==='skills' ? 'text-emerald-400' : ''}`} onClick={()=>onChangeView('skills')}>Skills</button>
        <button className={`opacity-80 hover:opacity-100 transition ${view==='store' ? 'text-emerald-400' : ''}`} onClick={()=>onChangeView('store')}>Store</button>
        <button className={`opacity-80 hover:opacity-100 transition ${view==='help' ? 'text-emerald-400' : ''}`} onClick={()=>onChangeView('help')}>Help</button>
        {/* Room selector removed per request */}
      </div>
      <div className="ml-auto flex items-center justify-end gap-4">
        <Chip>1,458 <span className="opacity-70">shards</span></Chip>
        <IconButton label="Notifications">🔔</IconButton>
        <IconButton label="Mail">✉️</IconButton>
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
                <button className="text-left text-xs px-3 py-2 rounded-lg hover:bg-white/10 transition" onClick={()=>{ setOpen(false); onChangeView('help'); }}>Settings</button>
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
  // Removed Attack/Defense/Utility stat cards per UI cleanup request.
  const primaryBranch = useSkillStore(s=>s.primaryBranch);
  const primaryType = useSkillStore(s=>s.primaryType);
  const traitTags = useSkillStore(s=>s.traitTags);
  const respec = useSkillStore(s=>s.respec);
  const unlockOrder = useSkillStore(s=>s.unlockOrder);
  const pointsLeft = availablePoints(useSkillStore.getState());
  // Simplified HP / EP formulas now decoupled from removed defense/utility stats.
  const baseHP = 100; const hpPerLevel = 12;
  const baseEP = 60; const epPerLevel = 6;
  const HP = baseHP + (skillLevel-1)*hpPerLevel;
  const EP = baseEP + (skillLevel-1)*epPerLevel;
  return (
    <aside className={`col-start-1 h-full min-h-0 ${className} bg-[#0f1218] border-r border-black/40 shadow-inner flex flex-col overflow-hidden`}>      
      <div className="px-4 py-4 border-b border-white/10 flex flex-col items-center shrink-0">
        {/* Character Portrait and Info */}
        <div className="w-full max-w-[260px] aspect-[4/3] rounded-3xl border border-white/10 bg-[#12171f] overflow-hidden relative flex flex-col items-center justify-center">
          {/* Portrait image responsive */}
          <img className="w-[52%] h-[52%] object-cover rounded-2xl border border-white/10 shadow-lg" src={loadout.portraitUrl} alt="portrait" />
          <div className="mt-2 flex flex-col items-center text-center">
            <div className="flex items-center gap-2">
              <img src={FactionIcon[loadout.faction]} alt={loadout.faction} className="w-5 h-5 drop-shadow" />
              <span className="font-semibold text-white text-sm leading-tight tracking-wide">{loadout.name}</span>
            </div>
            <div className="mt-1 text-[10px] text-gray-300 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 tracking-wide">Lv {loadout.level}</span>
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
        {/* Traits summary */}
        <div className="mt-4 w-full rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-3 text-[10px] flex flex-col gap-1">
          <div className="flex justify-between"><span className="opacity-70">Primary Path</span><span className="font-semibold text-emerald-300">{primaryBranch || '—'}</span></div>
          <div className="flex justify-between"><span className="opacity-70">Primary Type</span><span className="font-semibold text-sky-300">{primaryType || '—'}</span></div>
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
      {/* Pet image card */}
      <div className="px-4 py-4 flex flex-col items-center gap-4">
        <div className="w-full max-w-[260px] aspect-[4/3] rounded-3xl border border-white/10 bg-white/5 overflow-hidden relative flex flex-col items-center justify-center p-4">
          <div className="absolute inset-0 bg-gradient-to-tr from-[#0b0e13]/80 via-transparent to-[#0b0e13]/50" />
          <img className="relative z-10 w-[52%] h-[52%] object-contain drop-shadow" src={PetIcon[loadout.pet.type]} alt="pet" />
          <div className="relative z-10 mt-3 flex flex-col items-center text-center">
            <div className="font-semibold text-white text-sm leading-tight tracking-wide">{loadout.pet.type === 'CYBER_DOG' ? 'Cyber-Dog' : 'Cyber-Cat'}</div>
            <div className="mt-1 text-[10px] text-gray-300 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 tracking-wide">Lv {loadout.pet.level}</span>
              <span>{loadout.pet.role}</span>
            </div>
          </div>
        </div>
      </div>
      {/* Pet stat chips removed per request */}
    </aside>
  );
}

function RightPlayerPanel({ className = '', loadout, onCustomize }: { className?: string; loadout: CharacterLoadout; onCustomize: () => void }) {
  const [mode, setMode] = useState<'single' | 'multi'>('single');
  const [queue, setQueue] = useState<string | null>(null);
  
  function startMatch() {
    if (mode !== 'single') return; // only single-player active right now
    setQueue('~ Est. 0:25');
    setTimeout(()=> setQueue('Searching…'), 1200);
  }
  
  const modes: { key: 'single' | 'multi'; label: string; enabled: boolean }[] = [
    { key: 'single', label: 'Single Player', enabled: true },
    { key: 'multi', label: 'Multiplayer (Coming Soon)', enabled: false },
  ];
  
  return (
    <aside className={`col-start-3 h-full min-h-0 ${className} bg-[#0f1218] border-l border-black/40 shadow-inner flex flex-col pr-3`}>
        {/* 3D Avatar Section – match left character card size */}
        <div className="p-4 border-b border-white/10">
          <div className="w-full flex items-center justify-center">
            <div className="relative w-full max-w-[260px] aspect-[4/3] rounded-3xl border border-white/10 bg-gradient-to-br from-[#0b0e13] to-[#1a1e29] overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-tr from-[#0b0e13]/80 via-transparent to-[#0b0e13]/50" />
              <div className="absolute inset-x-0 bottom-0 top-[20%]">
                <AvatarScene
                  parts={(loadout as any).threeConfig?.parts}
                  colors={(loadout as any).threeConfig?.colors}
                  debugTint={false}
                  animPaused={false}
                  animSpeed={1}
                  rotateSpeed={0.08}
                  disableControls
                  cameraPosition={[1.6,1.0,2.4]}
                  cameraFov={30}
                  target={[0,0.55,0]}
                  modelOffset={[0,-0.75,0]}
                  autoFrame
                  frameMargin={0.12}
                />
              </div>
            </div>
          </div>
          <div className="mt-2 flex justify-center">
            <Button size="sm" className="w-full max-w-[260px] text-xs" onClick={onCustomize}>Customize</Button>
          </div>
        </div>
  {/* Game Modes Section */}
  <div className="px-4 py-4 border-b border-white/10">
        <div className="text-lg font-semibold mb-4">Game Modes</div>
        <div className="grid gap-3">
          {modes.map(m => (
            <button
              key={m.key}
              disabled={!m.enabled}
              onClick={() => m.enabled && setMode(m.key)}
              className={`rounded-2xl px-4 py-4 text-left relative overflow-hidden border transition group
                h-14 flex items-start
                ${mode === m.key ? 'bg-emerald-600/30 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10'}
                ${!m.enabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <div className="flex flex-col items-center justify-center w-full text-center">
                <span className="font-medium text-sm tracking-wide mb-1">{m.label}</span>
                <span className="text-[11px] opacity-60">{m.enabled ? (m.key === 'single' ? 'Solo mission queue' : 'Feature in development') : 'Unavailable'}</span>
              </div>
              {mode === m.key && <div className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-200">Active</div>}
            </button>
          ))}
          </div>
        </div>
  {/* Future sections for Gifts/Battle Pass */}
  <div className="px-4 py-4 border-b border-white/10">
        <div className="text-lg font-semibold mb-3">Rewards</div>
        <div className="grid grid-cols-2 gap-3 place-items-center">
          {[
            { title: 'Gifts', subtitle: 'Coming Soon' },
            { title: 'Battle Pass', subtitle: 'Coming Soon' },
          ].map(card => (
            <div key={card.title} className="aspect-square rounded-2xl border border-white/10 bg-white/5 overflow-hidden relative flex items-center justify-center" style={{ width: '70%' }}>
              <div className="flex flex-col items-center text-center p-3 w-full">
                <span className="font-medium text-[13px] tracking-wide mb-0.5">{card.title}</span>
                <span className="text-[10px] opacity-60">{card.subtitle}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
  {/* Play footer */}
  <div className="p-4 mt-auto">
          <Button className="w-full h-12 text-lg" onClick={startMatch} disabled={mode !== 'single'}>Play</Button>
          <div className="mt-1 text-[11px] text-gray-300 h-4">{queue ?? (mode === 'single' ? 'Ready' : 'Disabled')}</div>
        </div>
    </aside>
  );
}

function CenterHub({ className = '', loadout, view }: { className?: string; loadout: CharacterLoadout; view: 'dashboard' | 'skills' | 'store' | 'help' }) {
  if (view === 'skills') {
    return (
      <main className={`col-start-2 px-6 py-5 min-h-0 flex flex-col ${className}`}>
        <div className="flex-1 rounded-3xl border border-white/10 bg-[#12171f] overflow-hidden">
          <SnowflakeSkillTree initialLevel={loadout.level} />
        </div>
      </main>
    );
  }
  if (view === 'store') {
    return <StoreView className={className} />;
  }
  if (view === 'help') {
    return <SettingsView className={className} />;
  }
  return (
    <main className={`col-start-2 px-6 py-5 min-h-0 flex flex-col gap-5 ${className}`}>
      <div className="relative" style={{flex:'0 0 30%'}}>
        <HeroBanner loadout={loadout} />
      </div>
      <div className="flex-1 grid grid-cols-3 gap-5 min-h-0">
        <NewsCard title="Season 1: Terraformers" />
        <NewsCard title="Patch 0.2.3 Notes" />
        <NewsCard title="Community Spotlight" />
      </div>
    </main>
  );
}

// --- Store (Shopify) View ---
function StoreView({ className='' }: { className?: string }) {
  const [products, setProducts] = React.useState<ShopifyProduct[]|null>(null);
  const [error, setError] = React.useState<string|null>(null);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(()=>{
    let active = true;
    async function load(){
      if(!import.meta.env.VITE_SHOPIFY_STORE_DOMAIN || !import.meta.env.VITE_SHOPIFY_STOREFRONT_TOKEN){
        setError('Shop not configured');
        return;
      }
      setLoading(true);
      try {
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
          <span className="text-xs opacity-60">Shopify</span>
        </div>
        <div className="flex-1 overflow-auto p-6 custom-scrollbar">
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
        <div className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded bg-black/50 backdrop-blur border border-white/10">{variant ? `${variant.price.amount} ${variant.price.currencyCode}` : '—'}</div>
      </div>
      <div className="p-3 flex flex-col gap-1">
        <div className="text-xs font-semibold tracking-wide line-clamp-2 leading-snug min-h-[2rem]">{product.title}</div>
        <button disabled className="mt-1 text-[11px] px-2 py-1 rounded bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 cursor-not-allowed uppercase tracking-wide">Preview</button>
      </div>
    </div>
  );
}

// --- Settings (repurposed Help) View ---
function SettingsView({ className='' }: { className?: string }) {
  return (
    <main className={`col-start-2 px-6 py-5 min-h-0 flex flex-col ${className}`}>
      <div className="flex-1 rounded-3xl border border-white/10 bg-[#12171f] overflow-auto p-6 space-y-8 custom-scrollbar">
        <section>
          <h2 className="text-xl font-semibold mb-2">Settings</h2>
          <p className="text-sm opacity-80 leading-relaxed">Configure your experience. (Prototype – values not persisted yet.)</p>
        </section>
        <section className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
            <div className="text-sm font-semibold tracking-wide">Audio</div>
            <div className="flex items-center justify-between text-xs">
              <span className="opacity-70">Master Volume</span>
              <input type="range" min={0} max={100} defaultValue={70} className="w-40" />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="opacity-70">Music Volume</span>
              <input type="range" min={0} max={100} defaultValue={55} className="w-40" />
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
            <div className="text-sm font-semibold tracking-wide">Graphics</div>
            <div className="flex items-center justify-between text-xs">
              <span className="opacity-70">Quality</span>
              <select className="bg-[#1b222c] border border-white/10 rounded px-2 py-1 text-xs"><option>Auto</option><option>Low</option><option>Medium</option><option>High</option></select>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="opacity-70">Show FPS</span>
              <input type="checkbox" />
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
            <div className="text-sm font-semibold tracking-wide">Account</div>
            <div className="text-xs opacity-70">More account controls coming soon.</div>
          </div>
        </section>
      </div>
    </main>
  );
}

function RightStartPanel({ className = '' }: { className?: string }) {
  const [mode, setMode] = useState<'single' | 'multi'>('single');
  const [queue, setQueue] = useState<string | null>(null);
  function startMatch() {
    if (mode !== 'single') return; // only single-player active right now
    setQueue('~ Est. 0:25');
    setTimeout(()=> setQueue('Searching…'), 1200);
  }
  const modes: { key: 'single' | 'multi'; label: string; enabled: boolean }[] = [
    { key: 'single', label: 'Single Player', enabled: true },
    { key: 'multi', label: 'Multiplayer (Coming Soon)', enabled: false },
  ];
  return (
    <aside className={`col-start-3 h-full ${className} bg-[#0f1218] border-l border-black/40 shadow-inner flex flex-col`}>
      <div className="px-4 py-4 border-b border-white/10">
        <div className="text-lg font-semibold">Game Modes</div>
        <div className="mt-4 grid gap-3">
          {modes.map(m => (
            <button
              key={m.key}
              disabled={!m.enabled}
              onClick={() => m.enabled && setMode(m.key)}
              className={`rounded-2xl px-4 py-4 text-left relative overflow-hidden border transition group
                h-24 flex items-start
                ${mode === m.key ? 'bg-emerald-600/30 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10'}
                ${!m.enabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <div className="flex flex-col">
                <span className="font-medium text-sm tracking-wide mb-1">{m.label}</span>
                <span className="text-[11px] opacity-60">{m.enabled ? (m.key === 'single' ? 'Solo mission queue' : 'Feature in development') : 'Unavailable'}</span>
              </div>
              {mode === m.key && <div className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-200">Active</div>}
            </button>
          ))}
        </div>
        {/* Region & Map selectors removed per request */}
      </div>
      <div className="mt-auto p-4">
        <Button className="w-full h-14 text-xl" onClick={startMatch} disabled={mode !== 'single'}>Play</Button>
        <div className="mt-2 text-xs text-gray-300 h-4">{queue ?? (mode === 'single' ? 'Ready' : 'Disabled')}</div>
      </div>
    </aside>
  );
}

// RightStartPanel removed – functionality merged into LeftPlayerPanel

function CharacterCreator({ onSave, onBack, initial, locked }: { onSave: (payload: CharacterLoadout) => void; onBack: () => void; initial?: CharacterLoadout; locked?: boolean; }) {
  // Dynamic tabs derived from 3D asset mapping
  const [tab, setTab] = useState<string>(GROUP_ORDER[0]);
  const tabs: string[] = [...GROUP_ORDER, 'Colors'];
  // Store picked variant id per group locally (could be moved to zustand later)
  const [picked, setPicked] = useState<Record<string,string|undefined>>({});
  const [colorState, setColorState] = useState<{primary:string;secondary:string;skin:string}>(
    { primary: '#00A37A', secondary: '#F5F5F5', skin: '#c58b66' }
  );
  // Link skin picker to central creator store so shared skin material updates live in preview
  const setSkinColor = useCreatorStore(s => s.setSkinColor);
  useEffect(()=>{ setSkinColor(colorState.skin); },[colorState.skin,setSkinColor]);
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
    const threeConfig = { parts: { ...picked }, colors: { ...colorState } } as any; // extended config
    const payload: CharacterLoadout = locked ?
      { ...base, threeConfig, updatedAt: now() } :
      { ...base, threeConfig, id: uid('char'), createdAt: base.createdAt, updatedAt: now() };
    onSave(payload);
  }
  return (
    <div className="w-full h-full bg-[#0b0e13] text-gray-100 relative flex flex-col">
      <div className="absolute top-4 left-6 flex items-center gap-2 z-10">
        <Button variant="ghost" onClick={onBack}>Back</Button>
      </div>
      {/* Top preview now spans full width */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center px-8 py-8">
          <div className="relative w-full h-full max-h-[55vh] rounded-[32px] bg-[#12171f] border border-white/10 shadow-2xl overflow-hidden flex items-center justify-center">
            <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/5 via-transparent to-sky-500/5 pointer-events-none" />
            <div className="absolute inset-0">
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
          <div className="px-8 pt-4 flex flex-wrap justify-center gap-2">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-xl text-sm border transition
                  ${tab === t ? 'bg-emerald-600/30 text-emerald-200 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10 text-gray-300'}`}
              >{t}</button>
            ))}
          </div>
          {/* Single centered row of limited items (no scroll) */}
          <div className="flex-1 px-8 pt-6 pb-20 flex items-start justify-center w-full">
            {tab === 'Colors' ? (
              <div className="w-full max-w-5xl grid gap-6" style={{gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))'}}>
                {([
                  { key: 'primary', label: 'Primary' },
                  { key: 'secondary', label: 'Secondary' },
                  { key: 'skin', label: 'Skin Tone' },
                ] as const).map(c => (
                  <div key={c.key} className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-5 flex flex-col items-center gap-4 relative overflow-hidden">
                    <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_30%_30%,rgba(16,185,129,0.08),transparent_60%)]" />
                    <div className="text-sm font-medium tracking-wide relative z-10">{c.label}</div>
                    <div className="relative z-10 flex flex-col items-center gap-3">
                      <input
                        aria-label={c.label}
                        type="color"
                        value={colorState[c.key]}
                        onChange={e => setColorState(s => ({ ...s, [c.key]: e.target.value }))}
                        className="w-20 h-20 md:w-24 md:h-24 rounded-2xl cursor-pointer border border-white/20 bg-[#0f141a] p-1 shadow-inner shadow-black/40"
                      />
                      <div className="text-[11px] opacity-70 font-mono tracking-wide select-all">{colorState[c.key]}</div>
                    </div>
                  </div>
                ))}
                {/* Quick palettes fits into grid as its own card */}
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
                  <div className="text-xs uppercase tracking-wider opacity-60">Quick Palettes</div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { primary:'#00A37A', secondary:'#F5F5F5', skin:'#c58b66' },
                      { primary:'#d97706', secondary:'#111827', skin:'#b0734e' },
                      { primary:'#3b82f6', secondary:'#1e293b', skin:'#c58b66' },
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
                </div>
              </div>
            ) : (
              <div className="relative flex gap-4 overflow-x-auto no-scrollbar py-2 px-1 items-stretch scroll-smooth snap-x snap-mandatory group" id="variant-row">
                <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[#12171f] to-transparent opacity-70 group-hover:opacity-90" />
                <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#12171f] to-transparent opacity-70 group-hover:opacity-90" />
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
function VariantCard({ v, active, onSelect, eager }: VariantCardProps) {
  const [hover, setHover] = React.useState(false);
  // Only mount 3D when eager (first few) or hovered/active to reduce WebGL contexts.
  const show3D = eager || hover || active;
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
    <div className="aspect-[21/9] w-full rounded-3xl overflow-hidden relative border border-white/10 bg-gradient-to-br from-emerald-500/10 via-[#141b24] to-sky-500/10">
      <img src={loadout.portraitUrl} alt="hero" className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-lighten" />
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

function NewsCard({ title }: { title: string }) {
  return (
    <div className="rounded-2xl p-4 bg-[#12171f] border border-white/10 min-h-[42px] grid">
      <div>
        <div className="text-[11px] uppercase tracking-wide opacity-60">News</div>
        <div className="text-lg font-semibold mt-1">{title}</div>
      </div>
      <div className="self-end">
        <button className="h-8 px-3 rounded bg-white/10 hover:bg-white/15 text-sm">View</button>
      </div>
    </div>
  );
}
