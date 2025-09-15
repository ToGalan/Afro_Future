import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useState } from 'react';
import { useSkillStore } from './store/skillStore';
import { GROUP_ORDER, getVariantsByGroup } from './assets/threeParts';
import AvatarScene from './components/AvatarScene';
import SnowflakeSkillTree from './components/SnowflakeSkillTree';
import { fetchProducts } from './services/shopify';
import VariantPreview from './components/VariantPreview';
import { uid, now } from './types/loadout';
import { CharacterPortrait, FactionIcon, ImageAssets, getCharacterPortrait, PetIcon } from './assets/assetPaths';
import { joinRoom } from './services/realtimeClient';
import { initCRDT, attachCRDTChannel, disposeCRDT } from './services/crdt';
import { useCreatorStore } from './store/creatorStore';
import { initGoogleIdentity, renderGoogleButton, getGoogleClientId } from './services/googleIdentity';
import GoogleSignInButton from './components/auth/GoogleSignInButton';
const defaultLoadout = {
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
    const [idToken, setIdToken] = useState(() => localStorage.getItem('afrofuture.idToken'));
    const [phase, setPhase] = useState(!localStorage.getItem('afrofuture.idToken') ? 'auth' : 'boot');
    const [rtc, setRtc] = useState(null);
    const [roomId, setRoomId] = useState(() => localStorage.getItem('afrofuture.room') || 'lobby');
    const [recentRooms, setRecentRooms] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('afrofuture.recentRooms') || '[]');
        }
        catch {
            return [];
        }
    });
    const [profile, setProfile] = useState(() => {
        try {
            const raw = localStorage.getItem('afrofuture.profile');
            if (raw)
                return JSON.parse(raw);
        }
        catch { }
        return null;
    });
    const [mainView, setMainView] = useState('store');
    const [progress, setProgress] = useState(0);
    const [playerName] = useState('PlayerOne');
    // Account level is linked to profile; default to 1 if not persisted yet
    const accountLevel = profile?.accountLevel ?? 1;
    const [activeLoadout, setActiveLoadout] = useState(null);
    // Hydrate saved avatar (loadout) from localStorage once on mount, normalizing portrait URL
    useEffect(() => {
        try {
            const raw = localStorage.getItem('afrofuture.activeLoadout');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.id) {
                    const normalized = {
                        ...parsed,
                        // Avoid stale /src/assets/* paths by deriving from faction+archetype
                        portraitUrl: getCharacterPortrait(parsed.faction, parsed.archetype),
                    };
                    setActiveLoadout(normalized);
                }
            }
        }
        catch (e) {
            console.warn('[avatar-persist] failed to load', e);
        }
    }, []);
    // Once a hero is created and saved, it's locked; user can only customize/grow, not replace.
    const heroLocked = !!activeLoadout;
    const [setupFaction, setSetupFaction] = useState(null);
    const [setupArchetype, setSetupArchetype] = useState(null);
    const [setupPet, setSetupPet] = useState(null);
    useEffect(() => {
        if (phase !== 'boot')
            return;
        let pct = 0;
        const id = setInterval(() => {
            pct += Math.random() * 18 + 3;
            setProgress(Math.min(100, Math.floor(pct)));
            if (pct >= 100) {
                clearInterval(id);
                if (!activeLoadout)
                    setPhase('onboard');
                else
                    setPhase('main');
            }
        }, 300);
        return () => clearInterval(id);
    }, [phase, activeLoadout]);
    async function fetchServerProfile(idToken) {
        try {
            const res = await fetch('/profile', { headers: { 'Authorization': 'Bearer ' + idToken } });
            if (!res.ok)
                return null;
            const json = await res.json();
            return json.profile || null;
        }
        catch {
            return null;
        }
    }
    async function persistServerProfile(idToken, profilePatch) {
        try {
            await fetch('/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken }, body: JSON.stringify(profilePatch) });
        }
        catch (e) {
            console.warn('[profile] save failed', e);
        }
    }
    async function handleSignedIn(token) {
        setIdToken(token);
        localStorage.setItem('afrofuture.idToken', token);
        setPhase('boot');
        try {
            const payload = JSON.parse(atob(token.split('.')[1] || 'e30='));
            const prof = { sub: payload.sub, name: payload.name || payload.given_name || payload.family_name, email: payload.email, picture: payload.picture };
            setProfile(prof);
            try {
                localStorage.setItem('afrofuture.profile', JSON.stringify(prof));
            }
            catch { }
            // Fetch existing server profile (may include loadout)
            const serverProf = await fetchServerProfile(token);
            if (serverProf) {
                // Merge name/email/picture preference: prefer fresh token payload over stored values
                const mergedProf = { ...serverProf, ...prof };
                setProfile(mergedProf);
                if (serverProf.loadout) {
                    const l = serverProf.loadout;
                    const normalized = {
                        ...l,
                        portraitUrl: getCharacterPortrait(l.faction, l.archetype),
                    };
                    setActiveLoadout(normalized);
                }
                try {
                    localStorage.setItem('afrofuture.profile', JSON.stringify(mergedProf));
                }
                catch { }
                if (serverProf.loadout) {
                    try {
                        localStorage.setItem('afrofuture.activeLoadout', JSON.stringify(serverProf.loadout));
                    }
                    catch { }
                }
                // Hydrate skills from server if present
                if (serverProf.skills && typeof serverProf.skills === 'object') {
                    try {
                        const { hydrate } = useSkillStore.getState();
                        if (hydrate) {
                            hydrate({
                                level: typeof serverProf.skills.level === 'number' ? serverProf.skills.level : undefined,
                                unlocked: Array.isArray(serverProf.skills.unlocked) ? serverProf.skills.unlocked : undefined,
                                unlockOrder: Array.isArray(serverProf.skills.unlockOrder) ? serverProf.skills.unlockOrder : undefined,
                            });
                        }
                    }
                    catch (e) {
                        console.warn('[skills] hydrate failed', e);
                    }
                }
            }
            else {
                // Create initial profile server-side
                persistServerProfile(token, { ...prof });
            }
        }
        catch { }
        // Initialize collaborative CRDT state then join a default room (e.g., 'lobby')
        try {
            await initCRDT({ idToken: token, world: 'global' });
            const room = joinRoom(roomId, {}, token);
            setRtc(room);
            const maybeAttach = () => {
                if (room.dc.readyState === 'open') {
                    try {
                        attachCRDTChannel({ dc: room.dc });
                    }
                    catch (e) {
                        console.warn('[crdt] attach failed', e);
                    }
                }
                else {
                    room.dc.addEventListener('open', () => {
                        try {
                            attachCRDTChannel({ dc: room.dc });
                        }
                        catch (e) {
                            console.warn('[crdt] attach failed (late)', e);
                        }
                    }, { once: true });
                }
            };
            maybeAttach();
            try {
                localStorage.setItem('afrofuture.rtcState', JSON.stringify({ roomId, joinedAt: Date.now(), pcState: room.pc.connectionState, iceState: room.pc.iceConnectionState }));
            }
            catch { }
        }
        catch (e) {
            console.warn('[rtc] join failed', e);
        }
    }
    function handleSignOut() {
        localStorage.removeItem('afrofuture.idToken');
        setIdToken(null);
        setPhase('auth');
        setProfile(null);
        if (rtc) {
            try {
                rtc.dc.close();
            }
            catch { }
            try {
                rtc.pc.close();
            }
            catch { }
            try {
                rtc.ws.close();
            }
            catch { }
            setRtc(null);
        }
        try {
            disposeCRDT();
        }
        catch { }
    }
    function switchRoom(newRoom) {
        if (newRoom === roomId)
            return;
        setRoomId(newRoom);
        localStorage.setItem('afrofuture.room', newRoom);
        setRecentRooms(rs => {
            const next = [newRoom, ...rs.filter(r => r !== newRoom)].slice(0, 5);
            localStorage.setItem('afrofuture.recentRooms', JSON.stringify(next));
            return next;
        });
        // Reconnect
        if (rtc) {
            try {
                rtc.dc.close();
            }
            catch { }
            try {
                rtc.pc.close();
            }
            catch { }
            try {
                rtc.ws.close();
            }
            catch { }
            setRtc(null);
        }
        if (idToken) {
            try {
                const room = joinRoom(newRoom, {}, idToken);
                setRtc(room);
                try {
                    localStorage.setItem('afrofuture.rtcState', JSON.stringify({ roomId: newRoom, joinedAt: Date.now(), pcState: room.pc.connectionState, iceState: room.pc.iceConnectionState }));
                }
                catch { }
            }
            catch (e) {
                console.warn('[rtc] room switch failed', e);
            }
        }
    }
    // On mount (or auth resume) auto-decode token & attempt RTC rejoin if prior state exists
    useEffect(() => {
        if (!idToken)
            return;
        // If profile not yet set (e.g., hydration path) attempt decode
        if (!profile) {
            try {
                const payload = JSON.parse(atob(idToken.split('.')[1] || 'e30='));
                const prof = { sub: payload.sub, name: payload.name || payload.given_name || payload.family_name, email: payload.email, picture: payload.picture };
                setProfile(prof);
                try {
                    localStorage.setItem('afrofuture.profile', JSON.stringify(prof));
                }
                catch { }
            }
            catch { }
        }
        // Auto-rejoin logic
        const raw = localStorage.getItem('afrofuture.rtcState');
        if (!raw)
            return;
        try {
            const saved = JSON.parse(raw);
            if (saved && saved.roomId && typeof saved.roomId === 'string') {
                // If current room differs, adopt saved room first
                if (saved.roomId !== roomId) {
                    setRoomId(saved.roomId);
                    localStorage.setItem('afrofuture.room', saved.roomId);
                }
                // Only join if not already connected
                if (!rtc) {
                    const room = joinRoom(saved.roomId, {}, idToken);
                    setRtc(room);
                    try {
                        localStorage.setItem('afrofuture.rtcState', JSON.stringify({ roomId: saved.roomId, joinedAt: Date.now(), pcState: room.pc.connectionState, iceState: room.pc.iceConnectionState }));
                    }
                    catch { }
                }
            }
        }
        catch { }
        // run once after idToken available
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idToken]);
    // Persist WebRTC connection state (lightweight) whenever it changes
    useEffect(() => {
        if (!rtc)
            return;
        function save() {
            try {
                if (!rtc)
                    return;
                localStorage.setItem('afrofuture.rtcState', JSON.stringify({ roomId, updatedAt: Date.now(), pcState: rtc.pc.connectionState, iceState: rtc.pc.iceConnectionState, dcState: rtc.dc.readyState }));
            }
            catch { }
        }
        // Attach listeners
        const pc = rtc.pc;
        const dc = rtc.dc;
        pc.addEventListener('connectionstatechange', save);
        pc.addEventListener('iceconnectionstatechange', save);
        if (dc)
            dc.addEventListener('open', save);
        if (dc)
            dc.addEventListener('close', save);
        save();
        return () => {
            pc.removeEventListener('connectionstatechange', save);
            pc.removeEventListener('iceconnectionstatechange', save);
            if (dc)
                dc.removeEventListener('open', save);
            if (dc)
                dc.removeEventListener('close', save);
        };
    }, [rtc, roomId]);
    function startCreator() {
        if (heroLocked)
            return; // cannot create a new hero once locked
        setPhase('creating');
    }
    function handleCreatorSave(newLoadout) {
        // Preserve original id if already existed (no new hero creation after lock)
        if (activeLoadout) {
            const merged = { ...activeLoadout, ...newLoadout, id: activeLoadout.id, createdAt: activeLoadout.createdAt, updatedAt: now() };
            // Always derive portraitUrl from canonical mapping (avoids stale /src paths)
            merged.portraitUrl = getCharacterPortrait(merged.faction, merged.archetype);
            setActiveLoadout(merged);
            try {
                localStorage.setItem('afrofuture.activeLoadout', JSON.stringify(merged));
            }
            catch (e) {
                console.warn('[avatar-persist] save failed', e);
            }
            if (idToken)
                persistServerProfile(idToken, { loadout: merged });
            // Broadcast to peers via WebRTC (if data channel open)
            if (rtc?.dc?.readyState === 'open') {
                try {
                    rtc.dc.send(JSON.stringify({ type: 'loadoutUpdate', loadout: merged }));
                }
                catch (err) {
                    console.warn('[rtc] broadcast failed', err);
                }
            }
        }
        else {
            const normalized = {
                ...newLoadout,
                portraitUrl: getCharacterPortrait(newLoadout.faction, newLoadout.archetype),
            };
            setActiveLoadout(normalized);
            try {
                localStorage.setItem('afrofuture.activeLoadout', JSON.stringify(normalized));
            }
            catch (e) {
                console.warn('[avatar-persist] save failed', e);
            }
            if (idToken)
                persistServerProfile(idToken, { loadout: normalized });
            if (rtc?.dc?.readyState === 'open') {
                try {
                    rtc.dc.send(JSON.stringify({ type: 'loadoutUpdate', loadout: newLoadout }));
                }
                catch (err) {
                    console.warn('[rtc] broadcast failed', err);
                }
            }
        }
        setPhase('main');
    }
    // Persist skills to server whenever they change (after auth)
    const skillState = useSkillStore();
    useEffect(() => {
        if (!idToken)
            return;
        const handle = setTimeout(() => {
            try {
                const payload = {
                    skills: {
                        level: skillState.level,
                        unlocked: skillState.unlocked,
                        unlockOrder: skillState.unlockOrder,
                    }
                };
                persistServerProfile(idToken, payload);
            }
            catch (e) {
                console.warn('[skills] persist failed', e);
            }
        }, 500);
        return () => clearTimeout(handle);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idToken, skillState.level, skillState.unlocked, skillState.unlockOrder]);
    // Listen for remote loadout updates over WebRTC to keep sessions in sync ("chrome sync webrtc" requirement)
    useEffect(() => {
        if (!rtc?.dc)
            return;
        function onMessage(ev) {
            try {
                const data = JSON.parse(ev.data);
                if (data?.type === 'loadoutUpdate' && data.loadout) {
                    setActiveLoadout(prev => {
                        const incoming = data.loadout;
                        // If we already have a loadout id, prefer keeping its id/timestamps for local authority
                        const merged = prev ? { ...prev, ...incoming, id: prev.id, createdAt: prev.createdAt, updatedAt: now() } : incoming;
                        try {
                            localStorage.setItem('afrofuture.activeLoadout', JSON.stringify(merged));
                        }
                        catch { }
                        return merged;
                    });
                }
            }
            catch { }
        }
        rtc.dc.addEventListener('message', onMessage);
        return () => { rtc.dc.removeEventListener('message', onMessage); };
    }, [rtc]);
    if (phase === 'auth')
        return _jsx(GameViewport, { mode: "fit", children: _jsx(AuthGate, { onSignedIn: handleSignedIn }) });
    if (phase === 'boot')
        return _jsx(GameViewport, { mode: "fit", children: _jsx(WelcomeScreen, { progress: progress, build: "v0.2.3 demo \u2022 UE5", onSignOut: handleSignOut }) });
    if (phase === 'onboard')
        return (_jsx(GameViewport, { mode: "fit", children: _jsx(FirstTimeFlow, { faction: setupFaction, archetype: setupArchetype, pet: setupPet, onFaction: setSetupFaction, onArchetype: setSetupArchetype, onPet: setSetupPet, onContinue: startCreator }) }));
    if (phase === 'creating')
        return (_jsx(GameViewport, { mode: "fit", children: _jsx(CharacterCreator, { initial: activeLoadout ?? {
                    ...defaultLoadout,
                    faction: setupFaction ?? 'PAA',
                    archetype: setupArchetype ?? 'FEMALE',
                    pet: { ...defaultLoadout.pet, type: setupPet ?? 'CYBER_DOG' },
                    name: (() => {
                        const f = setupFaction ?? 'PAA';
                        const a = setupArchetype ?? 'FEMALE';
                        const names = {
                            PAA: { MALE: 'Kwame', FEMALE: 'Makena' },
                            ASF: { MALE: 'Zuberi', FEMALE: 'Nia' },
                            WC: { MALE: 'Jonathan', FEMALE: 'Emily' },
                        };
                        return names[f][a];
                    })(),
                    portraitUrl: (() => {
                        const f = setupFaction ?? 'PAA';
                        const a = setupArchetype ?? 'FEMALE';
                        return getCharacterPortrait(f, a);
                    })(),
                }, locked: heroLocked, onBack: () => heroLocked ? setPhase('main') : setPhase('onboard'), onSave: handleCreatorSave }) }));
    return (_jsx(GameViewport, { mode: "fit", children: _jsx(MainMenu, { playerName: playerName, accountLevel: accountLevel, loadout: activeLoadout ?? defaultLoadout, onCustomize: () => setPhase('creating'), heroLocked: heroLocked, view: mainView, onChangeView: setMainView, profile: profile, onSignOut: handleSignOut }) }));
}
function GameViewport({ children, mode = 'fixed', allowUpscale = true, minScale = 0.5, maxScale = 2, designWidth = 1920, designHeight = 1080 }) {
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
        }
        else {
            s = Math.min(Math.max(s, minScale), maxScale);
        }
        setScale(s);
    }, [viewport, allowUpscale, minScale, mode]);
    const stageStyle = mode === 'fit'
        ? { width: viewport.w, height: viewport.h }
        : { width: DESIGN_W, height: DESIGN_H, transform: `scale(${scale})` };
    return (_jsx("div", { className: "fixed inset-0 bg-[#06080c] flex items-center justify-center overflow-hidden select-none", children: _jsxs("div", { className: "relative", style: stageStyle, children: [_jsx("div", { className: "absolute inset-0 pointer-events-none shadow-[0_0_0_1px_rgba(255,255,255,0.04)]" }), children, _jsx("div", { className: "absolute bottom-1 left-2 text-[10px] font-mono bg-black/40 backdrop-blur-sm px-2 py-1 rounded border border-white/10 text-white/80", children: mode === 'fit'
                        ? _jsxs(_Fragment, { children: ["fit mode \u2022 win ", viewport.w, "\u00D7", viewport.h] })
                        : _jsxs(_Fragment, { children: ["fixed ", DESIGN_W, "\u00D7", DESIGN_H, " \u2022 win ", viewport.w, "\u00D7", viewport.h, " \u2022 scale ", scale.toFixed(3)] }) })] }) }));
}
function WelcomeScreen({ progress, build, onSignOut }) {
    const idToken = localStorage.getItem('afrofuture.idToken');
    function signOut() {
        localStorage.removeItem('afrofuture.idToken');
        onSignOut?.();
    }
    return (_jsxs("div", { className: "w-full h-full bg-[#0b0e13] relative text-gray-100 overflow-hidden", children: [_jsx("div", { className: "absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(16,185,129,0.15),transparent_60%)]" }), _jsx("div", { className: "absolute inset-0 bg-[radial-gradient(circle_at_70%_70%,rgba(56,189,248,0.12),transparent_65%)]" }), _jsxs("div", { className: "relative h-full grid place-items-center p-6", children: [_jsxs("div", { className: "w-full max-w-4xl rounded-2xl bg-[#12171f]/90 backdrop-blur border border-white/10 p-10 shadow-2xl", children: [_jsx("h1", { className: "text-5xl font-bold tracking-wide text-center bg-gradient-to-r from-emerald-300 via-teal-200 to-sky-300 bg-clip-text text-transparent", children: "Afro\u2011Future Rising" }), _jsx("p", { className: "mt-2 opacity-70 text-center text-sm tracking-wide", children: "Preparing Outposts\u2026" }), _jsx("div", { className: "mt-8 h-2 w-full rounded-full bg-white/5 overflow-hidden", children: _jsx("div", { className: "h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500 transition-all", style: { width: `${progress}%` } }) }), _jsxs("div", { className: "mt-2 text-xs opacity-60 text-center", children: [progress, "%"] }), _jsx("div", { className: "mt-6 flex flex-col items-center gap-3", children: idToken ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "text-xs text-emerald-300", children: "Signed in" }), _jsx("button", { onClick: signOut, className: "text-[11px] px-3 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/10", children: "Sign Out" })] })) : (_jsx(GoogleSignInButton, { onCredential: () => window.location.reload() })) })] }), _jsx("div", { className: "absolute bottom-4 right-6 text-[10px] opacity-60", children: build }), _jsxs("div", { className: "absolute bottom-4 left-6 text-[10px] flex gap-4 opacity-60", children: [_jsx("a", { className: "hover:opacity-90 transition", href: "#", children: "EULA" }), _jsx("a", { className: "hover:opacity-90 transition", href: "#", children: "Privacy" }), _jsx("button", { className: "hover:opacity-90 transition", children: "Accessibility" })] })] })] }));
}
// AuthGate: first step – requires Google sign-in then notifies parent.
function AuthGate({ onSignedIn }) {
    const idToken = localStorage.getItem('afrofuture.idToken');
    const [mode, setMode] = React.useState('idle');
    const buttonContainerRef = React.useRef(null);
    const [clientId, setClientId] = React.useState(() => import.meta.env.VITE_GOOGLE_CLIENT_ID);
    React.useEffect(() => { (async () => { if (!clientId) {
        const cid = await getGoogleClientId();
        if (cid)
            setClientId(cid);
    } })(); }, [clientId]);
    React.useEffect(() => { if (idToken)
        onSignedIn(idToken); }, [idToken, onSignedIn]);
    async function startGoogle() {
        console.log('[auth] user clicked primary Sign in with Google button');
        const cid = clientId || await getGoogleClientId();
        if (!cid) {
            console.warn('[auth] no client id resolved');
            setMode('error');
            return;
        }
        setMode('loading');
        try {
            console.log('[auth] initializing GIS with client id', cid);
            await initGoogleIdentity(cid, (resp) => {
                console.log('[auth] credential callback fired', resp?.select_by);
                if (resp.credential)
                    onSignedIn(resp.credential);
            });
            // Wait for container to exist (retry up to ~500ms)
            let attempts = 0;
            while (!buttonContainerRef.current && attempts < 10) {
                attempts++;
                await new Promise(r => setTimeout(r, 50));
            }
            if (!buttonContainerRef.current) {
                console.warn('[auth] button container missing after retries');
            }
            else {
                console.log('[auth] button container ready after attempts', attempts);
                buttonContainerRef.current.innerHTML = '';
                await renderGoogleButton(buttonContainerRef.current, {});
                console.log('[auth] GIS button rendered into container');
            }
            setMode('ready');
            // Removed synthetic auto-click to avoid race conditions with container mounting in production.
        }
        catch (e) {
            console.warn('[gis] init failed', e);
            setMode('error');
        }
    }
    return (_jsx("div", { className: "w-full h-full flex items-center justify-center bg-[#0b0e13] text-gray-100", children: _jsxs("div", { className: "w-full max-w-md p-8 rounded-2xl bg-[#12171f]/90 border border-white/10 shadow-xl flex flex-col items-center", children: [_jsx("h1", { className: "text-3xl font-semibold tracking-wide mb-4", children: "Afro\u2011Future Rising" }), mode === 'idle' && (_jsx("button", { onClick: startGoogle, className: "w-full text-sm font-medium tracking-wide flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-emerald-600 to-sky-600 hover:from-emerald-500 hover:to-sky-500 transition shadow-lg shadow-emerald-900/30 border border-white/10", children: _jsx("span", { children: "Sign in with Google" }) })), clientId && (_jsxs(_Fragment, { children: [mode === 'loading' && (_jsxs("div", { className: "flex flex-col items-center gap-3 py-6", children: [_jsx("div", { className: "w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" }), _jsx("div", { className: "text-[11px] opacity-70", children: "Loading Google Sign-In\u2026" })] })), _jsxs("div", { className: "w-full flex flex-col items-center", children: [_jsx("div", { ref: (el) => { if (!buttonContainerRef.current && el) {
                                        console.log('[auth] button container ref attached');
                                    } buttonContainerRef.current = el; }, className: "mt-2" }), mode === 'ready' && !buttonContainerRef.current && (_jsx("div", { className: "text-[10px] text-amber-400 mt-2", children: "Button container not mounted" }))] })] })), clientId && mode === 'error' && (_jsxs("div", { className: "mt-4 text-[11px] text-rose-300", children: ["Failed to load Google Sign-In. Retry?", _jsx("div", { className: "mt-2", children: _jsx("button", { onClick: startGoogle, className: "px-3 py-1 rounded bg-rose-600/30 border border-rose-500/40 text-rose-200 text-xs", children: "Retry" }) })] }))] }) }));
}
function FirstTimeFlow({ faction, archetype, pet, onFaction, onArchetype, onPet, onContinue }) {
    const [step, setStep] = useState(0);
    // Full Screen support for the setup container
    const containerRef = React.useRef(null);
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
            }
            else {
                document.exitFullscreen?.();
            }
        }
        catch (err) {
            console.warn('Fullscreen toggle failed', err);
        }
    }
    const factionDetails = {
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
    const archetypeDetails = {
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
    const petDetails = {
        CYBER_DOG: { role: 'Scout & Protector', abilities: ['Track', 'Bark Stun', 'Guard'], lore: 'Engineered as loyal guardians, Cyber-Dogs blend military robotics with canine instinct. They embody loyalty and resilience, never abandoning their human partner.' },
        CYBER_CAT: { role: 'Stealth & Support', abilities: ['Sneak', 'Distract', 'Hack Scratch'], lore: 'Agile, silent, and mischievous, Cyber-Cats are the unseen eyes in contested zones. Descendants of cultural reverence for felines, they represent mystery and independence, thriving in chaos.' },
    };
    const steps = ['Faction', 'Archetype', 'Pet'];
    const chosenFaction = faction ?? null;
    const arch = chosenFaction && archetype ? archetypeDetails[chosenFaction][archetype] : null;
    const petInfo = pet ? petDetails[pet] : null;
    return (_jsx("div", { className: "w-full h-full bg-[#0b0e13] text-gray-100 flex flex-col items-center p-6", children: _jsxs("div", { ref: containerRef, className: "w-full max-w-5xl bg-[#12171f] rounded-2xl p-6 border border-white/10 shadow-2xl flex flex-col min-h-0", style: { height: '100%' }, children: [_jsxs("div", { className: "flex items-center justify-between shrink-0", children: [_jsx("h2", { className: "text-2xl font-semibold tracking-wide", children: "Create Your Character" }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("div", { className: "text-sm opacity-70", children: ["Step ", step + 1, " / ", steps.length] }), step === 0 && (_jsx("button", { onClick: toggleFullscreen, className: "w-8 h-8 inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition", "aria-label": isFs ? 'Exit Full Screen' : 'Full Screen', title: isFs ? 'Exit Full Screen' : 'Full Screen', children: _jsxs("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("path", { d: "M4 9V5h4" }), _jsx("path", { d: "M20 9V5h-4" }), _jsx("path", { d: "M4 15v4h4" }), _jsx("path", { d: "M20 15v4h-4" })] }) }))] })] }), _jsxs("div", { className: "mt-4 flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1", children: [step === 0 && (_jsxs("div", { className: "mt-6", children: [_jsx("div", { className: "text-sm opacity-80 mb-2", children: "Choose Faction" }), _jsx("div", { className: "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4", children: ['PAA', 'ASF', 'WC'].map((f) => (_jsxs("button", { onClick: () => onFaction(f), className: `group px-3 pt-4 pb-4 rounded-2xl border transition text-base flex flex-col items-center gap-3 relative overflow-hidden
                    ${faction === f ? 'bg-emerald-600/30 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10'}`, children: [_jsx("div", { className: "w-full aspect-square rounded-xl bg-white/5 flex items-center justify-center overflow-hidden ring-1 ring-white/5 relative", children: _jsx("img", { src: ImageAssets.faction[f], alt: f, className: "absolute inset-0 w-full h-full object-cover drop-shadow transform scale-[0.75]" }) }), _jsx("span", { className: "font-medium tracking-wide", children: f })] }, f))) }), _jsx("div", { className: "mt-4 rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col max-h-[32vh] md:max-h-none overflow-y-auto", children: chosenFaction ? (_jsxs("div", { className: "flex flex-col text-sm sm:text-base md:text-lg leading-relaxed", children: [_jsxs("div", { className: "text-base font-semibold flex items-center gap-2 mb-1", children: [_jsx("img", { src: FactionIcon[chosenFaction], className: "w-5 h-5" }), factionDetails[chosenFaction].name] }), _jsxs("div", { className: "mt-1", children: [_jsx("span", { className: "text-emerald-300 font-medium", children: "Mission:" }), " ", factionDetails[chosenFaction].mission] }), _jsxs("div", { className: "mt-2", children: [_jsx("span", { className: "text-emerald-300 font-medium", children: "Objectives:" }), " ", factionDetails[chosenFaction].objectives] }), _jsxs("div", { className: "mt-2 space-y-1", children: [_jsx("div", { className: "text-emerald-300 font-medium", children: "Lore:" }), _jsx("div", { className: "opacity-80 text-xs sm:text-sm md:text-[17px] leading-snug whitespace-pre-line", children: factionDetails[chosenFaction].lore })] })] })) : (_jsx("div", { className: "text-sm opacity-60", children: "Select a faction to see details." })) }), _jsx("div", { className: "mt-6 flex justify-end", children: _jsx(Button, { onClick: () => setStep(1), disabled: !faction, children: "Next" }) })] })), step === 1 && (_jsxs("div", { className: "mt-6", children: [_jsx("div", { className: "text-sm opacity-80 mb-2", children: "Choose Archetype" }), _jsx("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-[640px]", children: ['MALE', 'FEMALE'].map(g => {
                                        const img = chosenFaction ? getCharacterPortrait(chosenFaction, g) : (g === 'MALE' ? CharacterPortrait.MALE : CharacterPortrait.FEMALE);
                                        const active = archetype === g;
                                        const nameMap = {
                                            PAA: { MALE: 'Kwame', FEMALE: 'Makena' },
                                            ASF: { MALE: 'Zuberi', FEMALE: 'Nia' },
                                            WC: { MALE: 'Jonathan', FEMALE: 'Emily' },
                                        };
                                        const label = chosenFaction ? nameMap[chosenFaction][g] : (g === 'MALE' ? 'Male' : 'Female');
                                        return (_jsxs("button", { onClick: () => onArchetype(g), title: label, className: `group px-3 pt-4 pb-4 rounded-2xl border transition text-base flex flex-col items-center gap-3 relative overflow-hidden
                      ${active ? 'bg-emerald-600/30 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10'}`, children: [_jsx("div", { className: "w-full aspect-square rounded-xl bg-white/5 overflow-hidden flex items-center justify-center ring-1 ring-white/5 relative", children: _jsx("img", { src: img, alt: label, className: "absolute inset-0 w-full h-full object-cover drop-shadow transform scale-[0.75]" }) }), _jsx("span", { className: "font-medium tracking-wide", children: label })] }, g));
                                    }) }), _jsx("div", { className: "mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm sm:text-base md:text-lg flex flex-col max-h-[30vh] md:max-h-none overflow-y-auto", children: arch ? (_jsxs("div", { className: "flex flex-col", children: [_jsx("div", { className: "font-semibold text-base mb-2", children: arch.title }), _jsxs("div", { children: [_jsx("span", { className: "text-emerald-300 font-medium", children: "Objective:" }), " ", arch.objective] }), _jsxs("div", { className: "mt-2 space-y-1", children: [_jsx("div", { className: "text-emerald-300 font-medium", children: "Lore:" }), _jsx("div", { className: "opacity-80 text-xs sm:text-sm md:text-[17px] leading-snug whitespace-pre-line", children: arch.lore })] })] })) : (_jsx("div", { className: "opacity-60", children: "Select a character to see details." })) }), _jsxs("div", { className: "mt-6 flex justify-between", children: [_jsx(Button, { variant: "ghost", onClick: () => setStep(0), children: "Previous" }), _jsx(Button, { onClick: () => setStep(2), disabled: !archetype, children: "Next" })] })] })), step === 2 && (_jsxs("div", { className: "mt-6", children: [_jsx("div", { className: "text-sm opacity-80 mb-2", children: "Choose Pet" }), _jsx("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-[640px]", children: ['CYBER_DOG', 'CYBER_CAT'].map(p => {
                                        const img = ImageAssets.pets[p];
                                        const active = pet === p;
                                        return (_jsxs("button", { onClick: () => onPet(p), className: `group px-3 pt-4 pb-4 rounded-2xl border transition text-base flex flex-col items-center gap-3 relative overflow-hidden
                        ${active ? 'bg-emerald-600/30 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10'}`, children: [_jsx("div", { className: "w-full aspect-square rounded-xl bg-white/5 flex items-center justify-center overflow-hidden ring-1 ring-white/5 relative", children: _jsx("img", { src: img, alt: p, className: "absolute inset-0 w-full h-full object-cover drop-shadow transform scale-[0.75]" }) }), _jsx("span", { className: "font-medium tracking-wide", children: p === 'CYBER_DOG' ? 'Cyber‑Dog' : 'Cyber‑Cat' })] }, p));
                                    }) }), _jsx("div", { className: "mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm sm:text-base md:text-lg flex flex-col max-h-[30vh] md:max-h-none overflow-y-auto", children: petInfo ? (_jsxs("div", { className: "flex flex-col", children: [_jsx("div", { className: "font-semibold text-sm md:text-base mb-2", children: "Cyber Companion" }), _jsxs("div", { children: [_jsx("span", { className: "text-emerald-300 font-medium", children: "Role:" }), " ", petInfo.role] }), _jsxs("div", { className: "mt-2", children: [_jsx("span", { className: "text-emerald-300 font-medium", children: "Abilities:" }), " ", petInfo.abilities.join(', ')] }), _jsxs("div", { className: "mt-2 space-y-1", children: [_jsx("div", { className: "text-emerald-300 font-medium", children: "Lore:" }), _jsx("div", { className: "opacity-80 text-xs sm:text-sm md:text-[17px] leading-snug whitespace-pre-line", children: petInfo.lore })] })] })) : (_jsx("div", { className: "opacity-60", children: "Select a pet to see details." })) }), _jsxs("div", { className: "mt-6 flex justify-between", children: [_jsx(Button, { variant: "ghost", onClick: () => setStep(1), children: "Previous" }), _jsx(Button, { onClick: onContinue, disabled: !pet, children: "Continue" })] })] }))] })] }) }));
}
function MainMenu({ playerName, accountLevel, loadout, onCustomize, heroLocked, view, onChangeView, profile, onSignOut }) {
    // Ensure skill store level matches active loadout level even when Skills view isn't open
    const setSkillLevel = useSkillStore(s => s.setLevel);
    useEffect(() => { setSkillLevel(loadout.level); }, [loadout.level, setSkillLevel]);
    return (_jsxs("div", { className: "h-full w-full bg-[#0f1218] text-gray-100", children: [_jsx(TopNav, { view: view, onChangeView: onChangeView, profile: profile, onSignOut: onSignOut }), _jsx("div", { className: "h-[calc(100%-64px)]", children: _jsxs("div", { className: "h-full grid grid-rows-[1fr]", style: { gridTemplateColumns: 'minmax(260px,20%) 1fr minmax(260px,20%)' }, children: [_jsx(LeftPlayerPanel, { className: "row-start-1", playerName: playerName, accountLevel: accountLevel, loadout: loadout, heroLocked: heroLocked }), _jsx(CenterHub, { className: "row-start-1", loadout: loadout, view: view }), _jsx(RightPlayerPanel, { className: "row-start-1", loadout: loadout, onCustomize: onCustomize })] }) })] }));
}
function TopNav({ view, onChangeView, profile, onSignOut }) {
    const [open, setOpen] = React.useState(false);
    const menuRef = React.useRef(null);
    const [isFs, setIsFs] = React.useState(!!document.fullscreenElement);
    React.useEffect(() => {
        function onChange() { setIsFs(!!document.fullscreenElement); }
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);
    function toggleFullscreen() {
        try {
            if (!document.fullscreenElement) {
                // Prefer the root element; the viewport container is fixed to it
                document.documentElement.requestFullscreen?.();
            }
            else {
                document.exitFullscreen?.();
            }
        }
        catch (err) {
            console.warn('Fullscreen toggle failed', err);
        }
    }
    React.useEffect(() => {
        if (!open)
            return;
        function handle(e) {
            if (menuRef.current && !menuRef.current.contains(e.target))
                setOpen(false);
        }
        function handleKey(e) { if (e.key === 'Escape')
            setOpen(false); }
        window.addEventListener('mousedown', handle);
        window.addEventListener('keydown', handleKey);
        return () => { window.removeEventListener('mousedown', handle); window.removeEventListener('keydown', handleKey); };
    }, [open]);
    return (_jsxs("div", { className: "col-span-3 grid grid-cols-3 items-center px-6 bg-[#141924] border-b border-white/10 h-16 relative", children: [_jsx("div", { className: "flex items-center", children: _jsxs("button", { onClick: () => onChangeView('dashboard'), className: "flex items-center gap-2 group", title: "Home", children: [_jsx("div", { className: "w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500/30 to-sky-500/30 border border-white/10 flex items-center justify-center font-bold text-sm tracking-wide text-emerald-200 group-hover:from-emerald-500/50 group-hover:to-sky-500/50 transition", children: "AF" }), _jsx("span", { className: "text-sm font-semibold tracking-wide bg-gradient-to-r from-emerald-300 to-sky-300 bg-clip-text text-transparent hidden xl:inline-block", children: "Afro\u2011Future" })] }) }), _jsxs("div", { className: "flex items-center justify-center gap-6", children: [_jsx("button", { className: `opacity-80 hover:opacity-100 transition ${view === 'dashboard' ? 'text-emerald-400' : ''}`, onClick: () => onChangeView('dashboard'), children: "Dashboard" }), _jsx("button", { className: `opacity-80 hover:opacity-100 transition ${view === 'skills' ? 'text-emerald-400' : ''}`, onClick: () => onChangeView('skills'), children: "Skills" }), _jsx("button", { className: `opacity-80 hover:opacity-100 transition ${view === 'store' ? 'text-emerald-400' : ''}`, onClick: () => onChangeView('store'), children: "Store" }), _jsx("button", { className: `opacity-80 hover:opacity-100 transition ${view === 'help' ? 'text-emerald-400' : ''}`, onClick: () => onChangeView('help'), children: "Help" })] }), _jsxs("div", { className: "ml-auto flex items-center justify-end gap-4", children: [_jsxs(Chip, { children: ["1,458 ", _jsx("span", { className: "opacity-70", children: "shards" })] }), _jsx(IconButton, { label: "Notifications", children: "\uD83D\uDD14" }), _jsx(IconButton, { label: isFs ? 'Exit Fullscreen' : 'Enter Fullscreen', onClick: toggleFullscreen, children: _jsx("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: isFs ? (_jsxs(_Fragment, { children: [_jsx("path", { d: "M9 9H5V5" }), _jsx("path", { d: "M15 9h4V5" }), _jsx("path", { d: "M9 15H5v4" }), _jsx("path", { d: "M15 15h4v4" })] })) : (_jsxs(_Fragment, { children: [_jsx("path", { d: "M4 9V5h4" }), _jsx("path", { d: "M20 9V5h-4" }), _jsx("path", { d: "M4 15v4h4" }), _jsx("path", { d: "M20 15v4h-4" })] })) }) }), profile ? (_jsxs("div", { className: "relative", ref: menuRef, children: [_jsxs("button", { onClick: () => setOpen(o => !o), className: "flex items-center gap-2 group", children: [profile.picture ? _jsx("img", { className: "w-9 h-9 rounded object-cover border border-white/10", src: profile.picture, alt: profile.name || 'avatar' }) : (_jsx("div", { className: "w-9 h-9 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center text-xs font-semibold", children: (profile.name || profile.email || 'U').slice(0, 1).toUpperCase() })), _jsx("div", { className: "hidden md:flex flex-col leading-tight text-left", children: _jsx("span", { className: "text-xs font-medium truncate max-w-[120px]", title: profile.name || profile.email, children: profile.name || 'User' }) }), _jsx("svg", { className: `w-3 h-3 transition ${open ? 'rotate-180' : ''}`, viewBox: "0 0 20 20", fill: "currentColor", children: _jsx("path", { d: "M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.51a.75.75 0 01-1.08 0l-4.25-4.51a.75.75 0 01.02-1.06z" }) })] }), open && (_jsxs("div", { className: "absolute right-0 mt-2 w-64 rounded-xl border border-white/10 bg-[#1b222c] shadow-xl shadow-black/40 p-3 flex flex-col gap-2 z-50", children: [_jsxs("div", { className: "flex items-center gap-3 pb-3 border-b border-white/10", children: [profile.picture ? _jsx("img", { className: "w-10 h-10 rounded object-cover border border-white/10", src: profile.picture, alt: profile.name || 'avatar' }) : (_jsx("div", { className: "w-10 h-10 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center text-sm font-semibold", children: (profile.name || profile.email || 'U').slice(0, 1).toUpperCase() })), _jsxs("div", { className: "flex flex-col leading-tight", children: [_jsx("span", { className: "text-xs font-semibold", children: profile.name || 'User' }), profile.email && _jsx("span", { className: "text-[10px] opacity-60", children: profile.email })] })] }), _jsx("button", { className: "text-left text-xs px-3 py-2 rounded-lg hover:bg-white/10 transition", onClick: () => { setOpen(false); onChangeView('dashboard'); }, children: "Account" }), _jsx("button", { className: "text-left text-xs px-3 py-2 rounded-lg hover:bg-white/10 transition", onClick: () => { setOpen(false); onChangeView('help'); }, children: "Settings" }), _jsx("button", { className: "text-left text-xs px-3 py-2 rounded-lg hover:bg-rose-600/30 hover:text-rose-200 transition border border-transparent hover:border-rose-500/40", onClick: () => { setOpen(false); onSignOut?.(); }, children: "Log out" })] }))] })) : (_jsx("div", { className: "text-[11px] opacity-60", children: "Not signed in" }))] })] }));
}
function LeftPlayerPanel({ className = '', playerName, accountLevel, loadout, heroLocked }) {
    // Skill / stat integration
    const skillUnlocked = useSkillStore(s => s.unlocked);
    const skillSpent = useSkillStore(s => s.spent);
    const skillLevel = useSkillStore(s => s.level);
    const defense = useSkillStore(s => s.defense);
    const utility = useSkillStore(s => s.utility);
    // Removed Attack/Defense/Utility stat cards per UI cleanup request.
    const primaryBranchRaw = useSkillStore(s => s.primaryBranch);
    const primaryTypeRaw = useSkillStore(s => s.primaryType);
    const traitTags = useSkillStore(s => s.traitTags);
    const respec = useSkillStore(s => s.respec);
    const unlockOrder = useSkillStore(s => s.unlockOrder);
    const basePoints = useSkillStore(s => s.basePoints);
    const bonusPer5 = useSkillStore(s => s.bonusPer5);
    const bonusBlocks = Math.floor((Math.max(1, skillLevel) - 1) / 5);
    const pointsLeft = basePoints + bonusBlocks * bonusPer5 - skillSpent;
    const primaryBranch = primaryBranchRaw && primaryBranchRaw.toLowerCase() === 'root' ? undefined : primaryBranchRaw;
    const primaryType = primaryTypeRaw && primaryTypeRaw.toLowerCase() === 'root' ? undefined : primaryTypeRaw;
    // HP/EP derived from level plus skill-derived stats (defense/utility)
    const baseHP = 100;
    const hpPerLevel = 12;
    const hpPerDefense = 10;
    const baseEP = 60;
    const epPerLevel = 6;
    const epPerUtility = 6;
    const HP = baseHP + (skillLevel - 1) * hpPerLevel + defense * hpPerDefense;
    const EP = baseEP + (skillLevel - 1) * epPerLevel + utility * epPerUtility;
    return (_jsxs("aside", { className: `col-start-1 h-full min-h-0 ${className} bg-[#0f1218] border-r border-black/40 shadow-inner flex flex-col overflow-hidden`, children: [_jsxs("div", { className: "px-4 py-4 border-b border-white/10 flex flex-col items-center shrink-0", children: [_jsxs("div", { className: "w-full max-w-[260px] aspect-[4/3] rounded-3xl border border-white/10 bg-[#12171f] overflow-hidden relative flex flex-col items-center justify-center", children: [_jsx("img", { className: "w-[52%] h-[52%] object-cover rounded-2xl border border-white/10 shadow-lg", src: loadout.portraitUrl, alt: "portrait" }), _jsxs("div", { className: "mt-2 flex flex-col items-center text-center", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("img", { src: FactionIcon[loadout.faction], alt: loadout.faction, className: "w-5 h-5 drop-shadow" }), _jsx("span", { className: "font-semibold text-white text-sm leading-tight tracking-wide", children: loadout.name })] }), _jsxs("div", { className: "mt-1 text-[10px] text-gray-300 flex items-center gap-2", children: [_jsxs("span", { className: "px-2 py-0.5 rounded-full bg-white/5 border border-white/10 tracking-wide", children: ["Lv ", loadout.level] }), _jsx("span", { children: loadout.archetype === 'MALE' ? 'Male' : 'Female' })] })] }), _jsxs("span", { className: "absolute top-2 left-2 px-2 py-1 rounded-lg bg-black/50 border border-white/10 text-[10px] tracking-wide flex items-center gap-1", children: [_jsx("img", { src: FactionIcon[loadout.faction], alt: "faction", className: "w-3.5 h-3.5" }), loadout.faction] })] }), _jsxs("div", { className: "mt-4 w-full grid grid-cols-2 gap-3", children: [_jsxs("div", { className: "rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-500/10 to-sky-500/10 p-3 flex flex-col text-[10px]", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "opacity-70", children: "HP" }), _jsx("span", { className: "font-semibold", children: HP })] }), _jsxs("div", { className: "flex justify-between mt-1", children: [_jsx("span", { className: "opacity-70", children: "EP" }), _jsx("span", { className: "font-semibold", children: EP })] }), _jsxs("div", { className: "flex justify-between mt-1", children: [_jsx("span", { className: "opacity-70", children: "Skill Lv" }), _jsx("span", { className: "font-semibold", children: skillLevel })] })] }), _jsxs("div", { className: "rounded-2xl border border-white/10 bg-white/5 p-3 flex flex-col text-[10px]", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "opacity-70", children: "Tokens Spent" }), _jsx("span", { className: "font-semibold", children: skillSpent })] }), _jsxs("div", { className: "flex justify-between mt-1", children: [_jsx("span", { className: "opacity-70", children: "Tokens Left" }), _jsx("span", { className: "font-semibold text-emerald-300", children: pointsLeft })] }), _jsxs("div", { className: "flex justify-between mt-1", children: [_jsx("span", { className: "opacity-70", children: "Unlocked" }), _jsx("span", { className: "font-semibold", children: skillUnlocked.length })] })] })] }), _jsxs("div", { className: "mt-4 w-full rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-3 text-[10px] flex flex-col gap-1", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "opacity-70", children: "Primary Path" }), _jsx("span", { className: "font-semibold text-emerald-300", children: primaryBranch || '—' })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "opacity-70", children: "Primary Type" }), _jsx("span", { className: "font-semibold text-sky-300", children: primaryType || '—' })] }), _jsx("div", { className: "mt-1 flex flex-wrap gap-1", children: traitTags.length ? traitTags.map(t => _jsx(TraitTag, { tag: t }, t)) : (_jsx("span", { className: "opacity-50", children: "Earn traits by investing tokens" })) }), _jsx("div", { className: "mt-2 flex justify-end", children: _jsx("button", { disabled: !unlockOrder.length, onClick: () => { if (!unlockOrder.length)
                                        return; if (confirm('Respec will refund all spent tokens. Proceed?'))
                                        respec(); }, className: "px-2.5 py-1 rounded-lg border text-[10px] tracking-wide disabled:opacity-40 disabled:cursor-not-allowed bg-white/5 border-white/10 hover:bg-white/10", children: "Respec" }) })] })] }), _jsx("div", { className: "px-4 py-4 flex flex-col items-center gap-4", children: _jsxs("div", { className: "w-full max-w-[260px] aspect-[4/3] rounded-3xl border border-white/10 bg-white/5 overflow-hidden relative flex flex-col items-center justify-center p-4", children: [_jsx("div", { className: "absolute inset-0 bg-gradient-to-tr from-[#0b0e13]/80 via-transparent to-[#0b0e13]/50" }), _jsx("img", { className: "relative z-10 w-[52%] h-[52%] object-contain drop-shadow", src: PetIcon[loadout.pet.type], alt: "pet" }), _jsxs("div", { className: "relative z-10 mt-3 flex flex-col items-center text-center", children: [_jsx("div", { className: "font-semibold text-white text-sm leading-tight tracking-wide", children: loadout.pet.type === 'CYBER_DOG' ? 'Cyber-Dog' : 'Cyber-Cat' }), _jsxs("div", { className: "mt-1 text-[10px] text-gray-300 flex items-center gap-2", children: [_jsxs("span", { className: "px-2 py-0.5 rounded-full bg-white/5 border border-white/10 tracking-wide", children: ["Lv ", loadout.pet.level] }), _jsx("span", { children: loadout.pet.role })] })] })] }) })] }));
}
function RightPlayerPanel({ className = '', loadout, onCustomize }) {
    const [mode, setMode] = useState('single');
    const [queue, setQueue] = useState(null);
    function startMatch() {
        if (mode !== 'single')
            return; // only single-player active right now
        setQueue('~ Est. 0:25');
        setTimeout(() => setQueue('Searching…'), 1200);
    }
    const modes = [
        { key: 'single', label: 'Single Player', enabled: true },
        { key: 'multi', label: 'Multiplayer (Coming Soon)', enabled: false },
    ];
    return (_jsxs("aside", { className: `col-start-3 h-full min-h-0 ${className} bg-[#0f1218] border-l border-black/40 shadow-inner flex flex-col pr-3`, children: [_jsxs("div", { className: "p-3 border-b border-white/10", children: [_jsx("div", { className: "w-full flex items-center justify-center", children: _jsxs("div", { className: "relative w-full max-w-[240px] aspect-[4/3] rounded-3xl border border-white/10 bg-gradient-to-br from-[#0b0e13] to-[#1a1e29] overflow-hidden", children: [_jsx("div", { className: "absolute inset-0 bg-gradient-to-tr from-[#0b0e13]/80 via-transparent to-[#0b0e13]/50" }), _jsx("div", { className: "absolute inset-x-0 bottom-0 top-[20%]", children: _jsx(AvatarScene, { parts: loadout.threeConfig?.parts, colors: loadout.threeConfig?.colors, debugTint: false, animPaused: false, animSpeed: 1, rotateSpeed: 0.08, disableControls: true, cameraPosition: [1.6, 1.0, 2.4], cameraFov: 30, target: [0, 0.55, 0], modelOffset: [0, -0.7, 0], autoFrame: true, frameMargin: 0.12 }) })] }) }), _jsx("div", { className: "mt-2 flex justify-center", children: _jsx(Button, { size: "sm", className: "w-full max-w-[240px] text-xs", onClick: onCustomize, children: "Customize" }) })] }), _jsxs("div", { className: "px-4 py-3 border-b border-white/10", children: [_jsx("div", { className: "text-lg font-semibold mb-4", children: "Game Modes" }), _jsx("div", { className: "grid gap-3", children: modes.map(m => (_jsx("button", { disabled: !m.enabled, onClick: () => m.enabled && setMode(m.key), className: `rounded-2xl px-5 py-4 text-center relative overflow-hidden border transition group
                min-h-[45px] flex items-center justify-center
                ${mode === m.key ? 'bg-emerald-600/30 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10'}
                ${!m.enabled ? 'opacity-40 cursor-not-allowed' : ''}`, children: _jsxs("div", { className: "flex flex-col items-center justify-center w-full text-center", children: [_jsx("span", { className: "font-medium text-sm tracking-wide mb-0.5", children: m.label }), _jsx("span", { className: "text-[11px] opacity-60", children: m.enabled ? (m.key === 'single' ? 'Solo mission queue' : 'Feature in development') : 'Unavailable' })] }) }, m.key))) })] }), _jsxs("div", { className: "p-4 mt-auto bg-[#0f1218]", children: [_jsx(Button, { className: "w-full h-12 text-lg", onClick: startMatch, disabled: mode !== 'single', children: "Play" }), _jsx("div", { className: "mt-1 text-[11px] text-gray-300 h-4", children: queue ?? (mode === 'single' ? '' : 'Disabled') })] })] }));
}
function CenterHub({ className = '', loadout, view }) {
    if (view === 'skills') {
        return (_jsx("main", { className: `col-start-2 px-6 py-5 min-h-0 flex flex-col ${className}`, children: _jsx("div", { className: "flex-1 rounded-3xl border border-white/10 bg-[#12171f] overflow-hidden", children: _jsx(SnowflakeSkillTree, { initialLevel: loadout.level }) }) }));
    }
    if (view === 'store') {
        return _jsx(StoreView, { className: className });
    }
    if (view === 'help') {
        return _jsx(SettingsView, { className: className });
    }
    return (_jsxs("main", { className: `col-start-2 px-6 py-5 min-h-0 flex flex-col gap-5 ${className}`, children: [_jsx("div", { className: "relative", style: { flex: '0 0 50%' }, children: _jsx(HeroBanner, { loadout: loadout }) }), _jsxs("div", { className: "flex-1 grid grid-cols-3 gap-5 min-h-0", children: [_jsx(NewsCard, { title: "Season 1: Terraformers" }), _jsx(NewsCard, { title: "Patch 0.2.3 Notes" }), _jsx(NewsCard, { title: "Community Spotlight" })] })] }));
}
// --- Store (Shopify) View ---
function StoreView({ className = '' }) {
    const [products, setProducts] = React.useState(null);
    const [error, setError] = React.useState(null);
    const [loading, setLoading] = React.useState(false);
    function authHeaderMaybe() {
        const token = localStorage.getItem('afrofuture.idToken');
        return token ? { Authorization: 'Bearer ' + token } : {};
    }
    React.useEffect(() => {
        let active = true;
        async function load() {
            setLoading(true);
            try {
                // Prefer Admin REST proxy if available and we are running behind the Node server (not pure file:// or static-only)
                // Only attempt Admin proxy if explicitly enabled via env. Defaults to off in static-only serving.
                const allowAdminProxy = (import.meta?.env?.VITE_ENABLE_ADMIN_PROXY === 'true');
                if (allowAdminProxy) {
                    try {
                        const r = await fetch('/admin/products?limit=12', { headers: authHeaderMaybe() });
                        if (r.ok) {
                            const json = await r.json();
                            if (json && json.products) {
                                if (active)
                                    setProducts(json.products);
                                return;
                            }
                        }
                    }
                    catch { }
                }
                // Fallback to Storefront GraphQL (public)
                if (!import.meta.env.VITE_SHOPIFY_STORE_DOMAIN || !import.meta.env.VITE_SHOPIFY_STOREFRONT_TOKEN) {
                    setError('Shop not configured');
                    return;
                }
                const list = await fetchProducts(12);
                if (active)
                    setProducts(list);
            }
            catch (e) {
                if (active)
                    setError(e.message || 'Failed to load');
            }
            finally {
                if (active)
                    setLoading(false);
            }
        }
        load();
        return () => { active = false; };
    }, []);
    return (_jsx("main", { className: `col-start-2 px-6 py-5 min-h-0 flex flex-col ${className}`, children: _jsxs("div", { className: "flex-1 rounded-3xl border border-white/10 bg-[#12171f] overflow-hidden flex flex-col", children: [_jsxs("div", { className: "p-4 border-b border-white/10 flex items-center justify-between", children: [_jsx("div", { className: "text-lg font-semibold", children: "Store" }), _jsx("span", { className: "text-xs opacity-60", children: "Shopify" })] }), _jsxs("div", { className: "flex-1 overflow-hidden p-6", children: [error && (_jsx("div", { className: "text-sm text-rose-300 bg-rose-900/30 border border-rose-500/30 px-4 py-3 rounded-lg", children: error === 'Shop not configured' ? (_jsxs(_Fragment, { children: ["Storefront not configured. Add ", _jsx("code", { className: "font-mono", children: "VITE_SHOPIFY_STORE_DOMAIN" }), " & ", _jsx("code", { className: "font-mono", children: "VITE_SHOPIFY_STOREFRONT_TOKEN" }), " to .env."] })) : error })), loading && !products && (_jsxs("div", { className: "flex items-center gap-3 text-sm opacity-70", children: [_jsx("div", { className: "w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" }), " Loading products\u2026"] })), !loading && products && products.length === 0 && !error && _jsx("div", { className: "text-sm opacity-60", children: "No products found." }), products && products.length > 0 && (_jsx("div", { className: "grid gap-5", style: { gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))' }, children: products.map(p => _jsx(ProductCard, { product: p }, p.id)) }))] })] }) }));
}
function ProductCard({ product }) {
    const img = product.images[0];
    const variant = product.variants[0];
    return (_jsxs("div", { className: "rounded-2xl border border-white/10 bg-white/5 overflow-hidden flex flex-col group hover:bg-white/10 transition", children: [_jsxs("div", { className: "aspect-square w-full relative overflow-hidden bg-[#0f141a]", children: [img ? _jsx("img", { src: img.url, alt: img.altText || product.title, className: "absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition" }) : (_jsx("div", { className: "absolute inset-0 flex items-center justify-center text-[11px] opacity-40", children: "No Image" })), _jsx("div", { className: "absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded bg-black/50 backdrop-blur border border-white/10", children: variant && variant.price ? `${variant.price.amount}${variant.price.currencyCode ? ' ' + variant.price.currencyCode : ''}` : '—' })] }), _jsxs("div", { className: "p-3 flex flex-col gap-1", children: [_jsx("div", { className: "text-xs font-semibold tracking-wide line-clamp-2 leading-snug min-h-[2rem]", children: product.title }), _jsx("button", { disabled: true, className: "mt-1 text-[11px] px-2 py-1 rounded bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 cursor-not-allowed uppercase tracking-wide", children: "Preview" })] })] }));
}
// --- Settings (repurposed Help) View ---
function SettingsView({ className = '' }) {
    return (_jsx("main", { className: `col-start-2 px-6 py-5 min-h-0 flex flex-col ${className}`, children: _jsxs("div", { className: "flex-1 rounded-3xl border border-white/10 bg-[#12171f] overflow-hidden p-6 space-y-8", children: [_jsxs("section", { children: [_jsx("h2", { className: "text-xl font-semibold mb-2", children: "Settings" }), _jsx("p", { className: "text-sm opacity-80 leading-relaxed", children: "Configure your experience. (Prototype \u2013 values not persisted yet.)" })] }), _jsxs("section", { className: "space-y-4", children: [_jsxs("div", { className: "rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3", children: [_jsx("div", { className: "text-sm font-semibold tracking-wide", children: "Audio" }), _jsxs("div", { className: "flex items-center justify-between text-xs", children: [_jsx("span", { className: "opacity-70", children: "Master Volume" }), _jsx("input", { type: "range", min: 0, max: 100, defaultValue: 70, className: "w-40" })] }), _jsxs("div", { className: "flex items-center justify-between text-xs", children: [_jsx("span", { className: "opacity-70", children: "Music Volume" }), _jsx("input", { type: "range", min: 0, max: 100, defaultValue: 55, className: "w-40" })] })] }), _jsxs("div", { className: "rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3", children: [_jsx("div", { className: "text-sm font-semibold tracking-wide", children: "Graphics" }), _jsxs("div", { className: "flex items-center justify-between text-xs", children: [_jsx("span", { className: "opacity-70", children: "Quality" }), _jsxs("select", { className: "bg-[#1b222c] border border-white/10 rounded px-2 py-1 text-xs", children: [_jsx("option", { children: "Auto" }), _jsx("option", { children: "Low" }), _jsx("option", { children: "Medium" }), _jsx("option", { children: "High" })] })] }), _jsxs("div", { className: "flex items-center justify-between text-xs", children: [_jsx("span", { className: "opacity-70", children: "Show FPS" }), _jsx("input", { type: "checkbox" })] })] }), _jsxs("div", { className: "rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3", children: [_jsx("div", { className: "text-sm font-semibold tracking-wide", children: "Account" }), _jsx("div", { className: "text-xs opacity-70", children: "More account controls coming soon." })] })] })] }) }));
}
function RightStartPanel({ className = '' }) {
    const [mode, setMode] = useState('single');
    const [queue, setQueue] = useState(null);
    function startMatch() {
        if (mode !== 'single')
            return; // only single-player active right now
        setQueue('~ Est. 0:25');
        setTimeout(() => setQueue('Searching…'), 1200);
    }
    const modes = [
        { key: 'single', label: 'Single Player', enabled: true },
        { key: 'multi', label: 'Multiplayer (Coming Soon)', enabled: false },
    ];
    return (_jsxs("aside", { className: `col-start-3 h-full ${className} bg-[#0f1218] border-l border-black/40 shadow-inner flex flex-col`, children: [_jsxs("div", { className: "px-4 py-4 border-b border-white/10", children: [_jsx("div", { className: "text-lg font-semibold", children: "Game Modes" }), _jsx("div", { className: "mt-4 grid gap-3", children: modes.map(m => (_jsxs("button", { disabled: !m.enabled, onClick: () => m.enabled && setMode(m.key), className: `rounded-2xl px-4 py-4 text-left relative overflow-hidden border transition group
                h-24 flex items-start
                ${mode === m.key ? 'bg-emerald-600/30 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10'}
                ${!m.enabled ? 'opacity-40 cursor-not-allowed' : ''}`, children: [_jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-medium text-sm tracking-wide mb-1", children: m.label }), _jsx("span", { className: "text-[11px] opacity-60", children: m.enabled ? (m.key === 'single' ? 'Solo mission queue' : 'Feature in development') : 'Unavailable' })] }), mode === m.key && _jsx("div", { className: "absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-200", children: "Active" })] }, m.key))) })] }), _jsxs("div", { className: "mt-auto p-4", children: [_jsx(Button, { className: "w-full h-14 text-xl", onClick: startMatch, disabled: mode !== 'single', children: "Play" }), _jsx("div", { className: "mt-2 text-xs text-gray-300 h-4", children: queue ?? (mode === 'single' ? 'Ready' : 'Disabled') })] })] }));
}
// RightStartPanel removed – functionality merged into LeftPlayerPanel
function CharacterCreator({ onSave, onBack, initial, locked }) {
    // Dynamic tabs derived from 3D asset mapping
    const [tab, setTab] = useState(GROUP_ORDER[0]);
    const tabs = [...GROUP_ORDER, 'Colors'];
    // Store picked variant id per group locally (could be moved to zustand later)
    const [picked, setPicked] = useState({});
    const [colorState, setColorState] = useState({ primary: '#00A37A', secondary: '#F5F5F5', skin: '#c58b66' });
    // Link skin picker to central creator store so shared skin material updates live in preview
    const setSkinColor = useCreatorStore(s => s.setSkinColor);
    useEffect(() => { setSkinColor(colorState.skin); }, [colorState.skin, setSkinColor]);
    // Animation preview controls
    const [animPaused, setAnimPaused] = useState(false);
    const [animSpeed, setAnimSpeed] = useState(1);
    function selectVariant(group, id) {
        setPicked(p => {
            const currentlyActive = p[group] === id;
            let next = { ...p, [group]: currentlyActive ? undefined : id };
            // Outfit mutual exclusion logic: selecting an Outfit clears Top & Bottom, selecting Top/Bottom clears Outfit
            if (!currentlyActive) {
                if (group === 'Outfit') {
                    next.Top = undefined;
                    next.Bottom = undefined;
                }
                else if (group === 'Top' || group === 'Bottom') {
                    next.Outfit = undefined;
                }
            }
            return next;
        });
    }
    function exportPayload() {
        const base = (initial ?? defaultLoadout);
        const threeConfig = { parts: { ...picked }, colors: { ...colorState } }; // extended config
        const payload = locked ?
            { ...base, threeConfig, updatedAt: now() } :
            { ...base, threeConfig, id: uid('char'), createdAt: base.createdAt, updatedAt: now() };
        onSave(payload);
    }
    return (_jsxs("div", { className: "w-full h-full bg-[#0b0e13] text-gray-100 relative flex flex-col", children: [_jsx("div", { className: "absolute top-4 left-6 flex items-center gap-2 z-10", children: _jsx(Button, { variant: "ghost", onClick: onBack, children: "Back" }) }), _jsxs("div", { className: "flex-1 flex flex-col", children: [_jsx("div", { className: "flex-1 flex items-center justify-center px-8 py-8", children: _jsxs("div", { className: "relative w-full h-full max-h-[55vh] rounded-[32px] bg-[#12171f] border border-white/10 shadow-2xl overflow-hidden flex items-center justify-center", children: [_jsx("div", { className: "absolute inset-0 bg-gradient-to-tr from-emerald-500/5 via-transparent to-sky-500/5 pointer-events-none" }), _jsxs("div", { className: "absolute inset-0", children: [_jsx(AvatarScene, { parts: picked, colors: colorState, debugTint: false, animPaused: animPaused, animSpeed: animSpeed, 
                                            // Reduce overall avatar size by 20%
                                            modelScale: 0.8, modelOffset: [0, -0.25, 0] }), _jsxs("div", { className: "absolute top-3 left-3 flex items-center gap-2 bg-black/40 backdrop-blur-sm px-3 py-2 rounded-xl border border-white/10 text-[11px]", children: [_jsx("button", { onClick: () => setAnimPaused(p => !p), className: "px-2 py-1 rounded bg-white/10 hover:bg-white/15 border border-white/10", children: animPaused ? 'Play' : 'Pause' }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsx("span", { className: "opacity-60", children: "Speed" }), _jsx("input", { type: "range", min: 0.25, max: 1.5, step: 0.05, value: animSpeed, onChange: e => setAnimSpeed(parseFloat(e.target.value)), className: "w-24" }), _jsxs("span", { className: "tabular-nums w-8 text-right", children: [animSpeed.toFixed(2), "x"] })] })] })] }), _jsx("div", { className: "absolute bottom-4 right-4 text-[11px] px-2 py-1 rounded bg-white/5 border border-white/10 uppercase tracking-wide", children: "Preview 3D" })] }) }), _jsxs("div", { className: "w-full bg-[#12171f]/95 backdrop-blur-sm border-t border-white/10 flex flex-col max-h-[45vh]", children: [_jsx("div", { className: "px-8 pt-4 flex flex-wrap justify-center gap-2", children: tabs.map((t) => (_jsx("button", { onClick: () => setTab(t), className: `px-4 py-2 rounded-xl text-sm border transition
                  ${tab === t ? 'bg-emerald-600/30 text-emerald-200 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10 text-gray-300'}`, children: t }, t))) }), _jsx("div", { className: "flex-1 px-8 pt-6 pb-20 flex items-start justify-center w-full", children: tab === 'Colors' ? (_jsxs("div", { className: "w-full max-w-5xl grid gap-6", style: { gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }, children: [[
                                            { key: 'primary', label: 'Primary' },
                                            { key: 'secondary', label: 'Secondary' },
                                            { key: 'skin', label: 'Skin Tone' },
                                        ].map(c => (_jsxs("div", { className: "rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-5 flex flex-col items-center gap-4 relative overflow-hidden", children: [_jsx("div", { className: "absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_30%_30%,rgba(16,185,129,0.08),transparent_60%)]" }), _jsx("div", { className: "text-sm font-medium tracking-wide relative z-10", children: c.label }), _jsxs("div", { className: "relative z-10 flex flex-col items-center gap-3", children: [_jsx("input", { "aria-label": c.label, type: "color", value: colorState[c.key], onChange: e => setColorState(s => ({ ...s, [c.key]: e.target.value })), className: "w-20 h-20 md:w-24 md:h-24 rounded-2xl cursor-pointer border border-white/20 bg-[#0f141a] p-1 shadow-inner shadow-black/40" }), _jsx("div", { className: "text-[11px] opacity-70 font-mono tracking-wide select-all", children: colorState[c.key] })] })] }, c.key))), _jsxs("div", { className: "rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3", children: [_jsx("div", { className: "text-xs uppercase tracking-wider opacity-60", children: "Quick Palettes" }), _jsx("div", { className: "flex flex-wrap gap-2", children: [
                                                        { primary: '#00A37A', secondary: '#F5F5F5', skin: '#c58b66' },
                                                        { primary: '#d97706', secondary: '#111827', skin: '#b0734e' },
                                                        { primary: '#3b82f6', secondary: '#1e293b', skin: '#c58b66' },
                                                        { primary: '#a855f7', secondary: '#0f172a', skin: '#d19d74' },
                                                        { primary: '#ef4444', secondary: '#111827', skin: '#c58b66' },
                                                        { primary: '#10b981', secondary: '#0f172a', skin: '#c58b66' },
                                                    ].map((p, i) => (_jsxs("button", { onClick: () => setColorState(p), className: "group w-14 h-14 rounded-lg border border-white/10 overflow-hidden relative flex", title: "Apply palette", children: [_jsx("div", { className: "flex-1 h-full", style: { background: p.primary } }), _jsx("div", { className: "flex-1 h-full", style: { background: p.secondary } }), _jsx("div", { className: "flex-1 h-full", style: { background: p.skin } }), _jsx("div", { className: "absolute inset-0 opacity-0 group-hover:opacity-100 transition text-[9px] font-semibold tracking-wide flex items-center justify-center bg-black/50 text-white", children: "Use" })] }, i))) })] })] })) : (_jsxs("div", { className: "relative flex gap-4 overflow-x-auto no-scrollbar py-2 px-1 items-stretch scroll-smooth snap-x snap-mandatory group", id: "variant-row", children: [_jsx("div", { className: "pointer-events-none absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[#12171f] to-transparent opacity-70 group-hover:opacity-90" }), _jsx("div", { className: "pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#12171f] to-transparent opacity-70 group-hover:opacity-90" }), getVariantsByGroup(tab).map((v, idx) => {
                                            const active = picked[tab] === v.id;
                                            return (_jsx(VariantCard, { v: v, active: active, onSelect: () => selectVariant(tab, v.id), eager: idx < 6 }, v.id));
                                        }), getVariantsByGroup(tab).length === 0 && (_jsxs("div", { className: "text-xs opacity-50 px-4 py-6", children: ["No variants for ", tab] }))] })) }), _jsxs("div", { className: "px-8 py-5 flex justify-end gap-3 border-t border-white/10 bg-[#12171f]/95 sticky bottom-0", children: [_jsx(Button, { variant: "ghost", onClick: onBack, children: "Previous" }), _jsx(Button, { onClick: exportPayload, children: "Save & Continue" })] })] })] })] }));
}
function Card({ children }) {
    return _jsx("div", { className: "rounded-2xl p-4 bg-white/5 border border-white/10 shadow", children: children });
}
function VariantCard({ v, active, onSelect, eager }) {
    const [hover, setHover] = React.useState(false);
    // Only mount 3D when eager (first few) or hovered/active to reduce WebGL contexts.
    const show3D = eager || hover || active;
    return (_jsx("button", { onClick: onSelect, title: v.label, onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false), className: `w-24 h-24 rounded-xl border transition flex flex-col items-center justify-center gap-1 px-1 text-[11px] snap-start
        ${active ? 'bg-emerald-600/30 border-emerald-500/60 text-emerald-200 shadow-inner ring-2 ring-emerald-400/50' : 'bg-white/5 border-white/10 hover:bg-white/10 text-gray-300'}`, children: _jsxs("div", { className: "relative w-full h-full flex items-center justify-center", children: [show3D ? _jsx(VariantPreview, { file: v.file }) : (_jsx("div", { className: "w-10 h-10 rounded-lg bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center text-[10px] opacity-60", children: "GLB" })), _jsxs("div", { className: "absolute bottom-0 left-0 right-0 text-[9px] leading-tight px-1 py-0.5 bg-black/40 backdrop-blur-sm", children: [_jsx("span", { className: "truncate block max-w-full", children: v.label }), active && _jsx("span", { className: "uppercase tracking-wide text-emerald-300", children: "Selected" })] })] }) }));
}
function Button({ children, onClick, variant = 'solid', size = 'md', className = '', disabled }) {
    const base = 'rounded-xl inline-flex items-center justify-center border transition focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed';
    const variants = variant === 'ghost'
        ? 'bg-transparent border-white/15 hover:border-white/30 text-gray-100'
        : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-700';
    const sizes = size === 'sm' ? 'h-8 px-3 text-sm' : size === 'lg' ? 'h-12 px-5 text-lg' : 'h-10 px-4';
    return (_jsx("button", { onClick: onClick, disabled: disabled, className: `${base} ${variants} ${sizes} ${className}`, children: children }));
}
function IconButton({ children, label, onClick }) {
    return _jsx("button", { "aria-label": label, onClick: onClick, className: "h-9 w-9 grid place-items-center rounded-xl bg-white/10 border border-white/10 hover:bg-white/15", children: children });
}
function Chip({ children }) {
    return _jsx("span", { className: "px-2.5 py-1 rounded-full bg-white/10 border border-white/10 text-xs", children: children });
}
function Badge({ children }) {
    return _jsx("span", { className: "px-2 py-1 rounded-lg bg-gray-200 border border-gray-300", children: children });
}
function Field({ label, children }) {
    return (_jsxs("label", { className: "block text-sm", children: [_jsx("div", { className: "opacity-80 mb-1", children: label }), children] }));
}
function StatChip({ label, value }) {
    return (_jsxs("div", { className: "bg-gray-100 border border-gray-300 rounded-lg p-2", children: [_jsx("div", { className: "text-[10px] opacity-70", children: label }), _jsx("div", { className: "font-semibold", children: Array.from({ length: 5 }).map((_, i) => (_jsx("span", { children: i < value ? '●' : '○' }, i))) })] }));
}
function FactionPill({ faction }) {
    const color = {
        PAA: 'text-emerald-300',
        ASF: 'text-rose-300',
        WC: 'text-sky-300',
    };
    return (_jsxs("span", { className: `inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] ${color[faction]}`, children: [_jsx("img", { src: FactionIcon[faction], alt: faction, className: "w-3.5 h-3.5" }), faction] }));
}
// TraitTag with icon/color mapping
const TRAIT_META = {
    'Commander': { icon: '🛡️', colors: 'from-amber-500/30 to-amber-700/30 text-amber-200 border-amber-400/30' },
    'Terraformer': { icon: '🌍', colors: 'from-green-500/30 to-emerald-700/30 text-emerald-200 border-emerald-400/30' },
    'Technocrat': { icon: '🧪', colors: 'from-fuchsia-500/30 to-purple-700/30 text-fuchsia-200 border-fuchsia-400/30' },
    'Trader': { icon: '💱', colors: 'from-cyan-500/30 to-sky-700/30 text-cyan-200 border-cyan-400/30' },
    'Raider': { icon: '⚔️', colors: 'from-rose-500/30 to-red-700/30 text-rose-200 border-rose-400/30' },
    'Aggressor': { icon: '🔥', colors: 'from-orange-500/30 to-red-700/30 text-orange-200 border-orange-400/30' },
    'Support Specialist': { icon: '✚', colors: 'from-emerald-500/30 to-teal-700/30 text-emerald-200 border-emerald-400/30' },
    'Skirmisher': { icon: '🏹', colors: 'from-indigo-500/30 to-blue-700/30 text-indigo-200 border-indigo-400/30' },
};
function TraitTag({ tag }) {
    const meta = TRAIT_META[tag] || { icon: '✦', colors: 'from-white/10 to-white/5 text-gray-200 border-white/10' };
    return (_jsxs("span", { className: `px-2 py-0.5 rounded-md border text-[9px] tracking-wide bg-gradient-to-br ${meta.colors} flex items-center gap-1`, children: [meta.icon, _jsx("span", { children: tag })] }));
}
function HeroBanner({ loadout }) {
    return (_jsxs("div", { className: "w-full h-full rounded-3xl overflow-hidden relative border border-white/10 bg-gradient-to-br from-emerald-500/10 via-[#141b24] to-sky-500/10", children: [_jsx("img", { src: loadout.portraitUrl, alt: "hero", className: "absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-lighten" }), _jsx("div", { className: "absolute inset-0 bg-gradient-to-tr from-[#0b0e13]/60 to-transparent" }), _jsxs("div", { className: "absolute left-6 bottom-6", children: [_jsx("div", { className: "text-xs uppercase tracking-wide opacity-70", children: "Active Character" }), _jsx("div", { className: "text-3xl font-semibold", children: loadout.name }), _jsxs("div", { className: "mt-1 flex items-center gap-2 text-sm opacity-90", children: [_jsx(FactionPill, { faction: loadout.faction }), " ", _jsxs("span", { children: ["Lv ", loadout.level] })] })] })] }));
}
function NewsCard({ title }) {
    return (_jsxs("div", { className: "rounded-2xl p-4 bg-[#12171f] border border-white/10 min-h-[42px] grid", children: [_jsxs("div", { children: [_jsx("div", { className: "text-[11px] uppercase tracking-wide opacity-60", children: "News" }), _jsx("div", { className: "text-lg font-semibold mt-1", children: title })] }), _jsx("div", { className: "self-end", children: _jsx("button", { className: "h-8 px-3 rounded bg-white/10 hover:bg-white/15 text-sm", children: "View" }) })] }));
}
