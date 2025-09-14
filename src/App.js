import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useState } from 'react';
import { GROUP_ORDER, getVariantsByGroup } from './assets/threeParts';
import AvatarScene from './components/AvatarScene';
import { uid, now } from './types/loadout';
import { CharacterPortrait, FactionIcon, ImageAssets, getCharacterPortrait, PetIcon } from './assets/assetPaths';
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
    const [phase, setPhase] = useState('boot');
    const [progress, setProgress] = useState(0);
    const [playerName] = useState('PlayerOne');
    const [accountLevel] = useState(1);
    const [activeLoadout, setActiveLoadout] = useState(null);
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
    function startCreator() {
        if (heroLocked)
            return; // cannot create a new hero once locked
        setPhase('creating');
    }
    function handleCreatorSave(newLoadout) {
        // Preserve original id if already existed (no new hero creation after lock)
        if (activeLoadout) {
            setActiveLoadout({ ...activeLoadout, ...newLoadout, id: activeLoadout.id, createdAt: activeLoadout.createdAt, updatedAt: now() });
        }
        else {
            setActiveLoadout(newLoadout);
        }
        setPhase('main');
    }
    if (phase === 'boot')
        return _jsx(GameViewport, { mode: "fit", children: _jsx(WelcomeScreen, { progress: progress, build: "v0.2.3 demo \u2022 UE5" }) });
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
    return (_jsx(GameViewport, { mode: "fit", children: _jsx(MainMenu, { playerName: playerName, accountLevel: accountLevel, loadout: activeLoadout ?? defaultLoadout, onCustomize: () => setPhase('creating'), heroLocked: heroLocked }) }));
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
    return (_jsx("div", { className: "fixed inset-0 bg-[#06080c] flex items-center justify-center overflow-hidden select-none", children: _jsxs("div", { className: "relative", style: stageStyle, children: [_jsx("div", { className: "absolute inset-0 pointer-events-none shadow-[0_0_0_1px_rgba(255,255,255,0.04)]" }), children, _jsx("div", { className: "absolute bottom-1 right-2 text-[10px] font-mono bg-black/40 backdrop-blur-sm px-2 py-1 rounded border border-white/10 text-white/80", children: mode === 'fit'
                        ? _jsxs(_Fragment, { children: ["fit mode \u2022 win ", viewport.w, "\u00D7", viewport.h] })
                        : _jsxs(_Fragment, { children: ["fixed ", DESIGN_W, "\u00D7", DESIGN_H, " \u2022 win ", viewport.w, "\u00D7", viewport.h, " \u2022 scale ", scale.toFixed(3)] }) })] }) }));
}
function WelcomeScreen({ progress, build }) {
    return (_jsxs("div", { className: "w-screen h-screen bg-[#0b0e13] relative text-gray-100 overflow-hidden", children: [_jsx("div", { className: "absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(16,185,129,0.15),transparent_60%)]" }), _jsx("div", { className: "absolute inset-0 bg-[radial-gradient(circle_at_70%_70%,rgba(56,189,248,0.12),transparent_65%)]" }), _jsxs("div", { className: "relative h-full grid place-items-center p-6", children: [_jsxs("div", { className: "w-full max-w-4xl rounded-2xl bg-[#12171f]/90 backdrop-blur border border-white/10 p-10 shadow-2xl", children: [_jsx("h1", { className: "text-5xl font-bold tracking-wide text-center bg-gradient-to-r from-emerald-300 via-teal-200 to-sky-300 bg-clip-text text-transparent", children: "Afro\u2011Future Rising" }), _jsx("p", { className: "mt-2 opacity-70 text-center text-sm tracking-wide", children: "Preparing Outposts\u2026" }), _jsx("div", { className: "mt-8 h-2 w-full rounded-full bg-white/5 overflow-hidden", children: _jsx("div", { className: "h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500 transition-all", style: { width: `${progress}%` } }) }), _jsxs("div", { className: "mt-2 text-xs opacity-60 text-center", children: [progress, "%"] })] }), _jsx("div", { className: "absolute bottom-4 right-6 text-[10px] opacity-60", children: build }), _jsxs("div", { className: "absolute bottom-4 left-6 text-[10px] flex gap-4 opacity-60", children: [_jsx("a", { className: "hover:opacity-90 transition", href: "#", children: "EULA" }), _jsx("a", { className: "hover:opacity-90 transition", href: "#", children: "Privacy" }), _jsx("button", { className: "hover:opacity-90 transition", children: "Accessibility" })] })] })] }));
}
function FirstTimeFlow({ faction, archetype, pet, onFaction, onArchetype, onPet, onContinue }) {
    const [step, setStep] = useState(0);
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
    return (_jsx("div", { className: "w-full h-full bg-[#0b0e13] text-gray-100 flex flex-col items-center p-6", children: _jsxs("div", { className: "w-full max-w-5xl bg-[#12171f] rounded-2xl p-6 border border-white/10 shadow-2xl flex flex-col", style: { height: '100%' }, children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h2", { className: "text-2xl font-semibold tracking-wide", children: "Create Your Character" }), _jsxs("div", { className: "text-sm opacity-70", children: ["Step ", step + 1, " / ", steps.length] })] }), step === 0 && (_jsxs("div", { className: "mt-6", children: [_jsx("div", { className: "text-sm opacity-80 mb-2", children: "Choose Faction" }), _jsx("div", { className: "grid grid-cols-3 gap-4", children: ['PAA', 'ASF', 'WC'].map((f) => (_jsxs("button", { onClick: () => onFaction(f), className: `group px-3 pt-4 pb-4 rounded-2xl border transition text-base flex flex-col items-center gap-3 relative overflow-hidden
                    ${faction === f ? 'bg-emerald-600/30 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10'}`, children: [_jsx("div", { className: "w-full aspect-square rounded-xl bg-white/5 flex items-center justify-center overflow-hidden ring-1 ring-white/5 relative", children: _jsx("img", { src: ImageAssets.faction[f], alt: f, className: "absolute inset-0 w-full h-full object-cover drop-shadow" }) }), _jsx("span", { className: "font-medium tracking-wide", children: f })] }, f))) }), _jsx("div", { className: "mt-4 rounded-xl border border-white/10 bg-white/5 p-4 h-72 flex flex-col overflow-hidden", children: chosenFaction ? (_jsxs("div", { className: "flex flex-col text-lg leading-relaxed overflow-auto pr-1 custom-scrollbar", children: [_jsxs("div", { className: "text-base font-semibold flex items-center gap-2 mb-1", children: [_jsx("img", { src: FactionIcon[chosenFaction], className: "w-5 h-5" }), factionDetails[chosenFaction].name] }), _jsxs("div", { className: "mt-1", children: [_jsx("span", { className: "text-emerald-300 font-medium", children: "Mission:" }), " ", factionDetails[chosenFaction].mission] }), _jsxs("div", { className: "mt-2", children: [_jsx("span", { className: "text-emerald-300 font-medium", children: "Objectives:" }), " ", factionDetails[chosenFaction].objectives] }), _jsxs("div", { className: "mt-2 space-y-1", children: [_jsx("div", { className: "text-emerald-300 font-medium", children: "Lore:" }), _jsx("div", { className: "opacity-80 text-[17px] leading-snug whitespace-pre-line", children: factionDetails[chosenFaction].lore })] })] })) : (_jsx("div", { className: "text-sm opacity-60", children: "Select a faction to see details." })) }), _jsx("div", { className: "mt-6 flex justify-end", children: _jsx(Button, { onClick: () => setStep(1), disabled: !faction, children: "Next" }) })] })), step === 1 && (_jsxs("div", { className: "mt-6", children: [_jsx("div", { className: "text-sm opacity-80 mb-2", children: "Choose Archetype" }), _jsx("div", { className: "grid grid-cols-2 gap-4 max-w-[640px]", children: ['MALE', 'FEMALE'].map(g => {
                                const img = chosenFaction ? getCharacterPortrait(chosenFaction, g) : (g === 'MALE' ? CharacterPortrait.MALE : CharacterPortrait.FEMALE);
                                const active = archetype === g;
                                const nameMap = {
                                    PAA: { MALE: 'Kwame', FEMALE: 'Makena' },
                                    ASF: { MALE: 'Zuberi', FEMALE: 'Nia' },
                                    WC: { MALE: 'Jonathan', FEMALE: 'Emily' },
                                };
                                const label = chosenFaction ? nameMap[chosenFaction][g] : (g === 'MALE' ? 'Male' : 'Female');
                                return (_jsxs("button", { onClick: () => onArchetype(g), title: label, className: `group px-3 pt-4 pb-4 rounded-2xl border transition text-base flex flex-col items-center gap-3 relative overflow-hidden
                      ${active ? 'bg-emerald-600/30 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10'}`, children: [_jsx("div", { className: "w-full aspect-square rounded-xl bg-white/5 overflow-hidden flex items-center justify-center ring-1 ring-white/5 relative", children: _jsx("img", { src: img, alt: label, className: "absolute inset-0 w-full h-full object-cover drop-shadow" }) }), _jsx("span", { className: "font-medium tracking-wide", children: label })] }, g));
                            }) }), _jsx("div", { className: "mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-lg h-60 flex flex-col overflow-hidden", children: arch ? (_jsxs("div", { className: "flex flex-col overflow-auto pr-1 custom-scrollbar", children: [_jsx("div", { className: "font-semibold text-base mb-2", children: arch.title }), _jsxs("div", { children: [_jsx("span", { className: "text-emerald-300 font-medium", children: "Objective:" }), " ", arch.objective] }), _jsxs("div", { className: "mt-2 space-y-1", children: [_jsx("div", { className: "text-emerald-300 font-medium", children: "Lore:" }), _jsx("div", { className: "opacity-80 text-[17px] leading-snug whitespace-pre-line", children: arch.lore })] })] })) : (_jsx("div", { className: "opacity-60", children: "Select a character to see details." })) }), _jsxs("div", { className: "mt-6 flex justify-between", children: [_jsx(Button, { variant: "ghost", onClick: () => setStep(0), children: "Previous" }), _jsx(Button, { onClick: () => setStep(2), disabled: !archetype, children: "Next" })] })] })), step === 2 && (_jsxs("div", { className: "mt-6", children: [_jsx("div", { className: "text-sm opacity-80 mb-2", children: "Choose Pet" }), _jsx("div", { className: "grid grid-cols-2 gap-4 max-w-[640px]", children: ['CYBER_DOG', 'CYBER_CAT'].map(p => {
                                const img = ImageAssets.pets[p];
                                const active = pet === p;
                                return (_jsxs("button", { onClick: () => onPet(p), className: `group px-3 pt-4 pb-4 rounded-2xl border transition text-base flex flex-col items-center gap-3 relative overflow-hidden
                        ${active ? 'bg-emerald-600/30 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10'}`, children: [_jsx("div", { className: "w-full aspect-square rounded-xl bg-white/5 flex items-center justify-center overflow-hidden ring-1 ring-white/5 relative", children: _jsx("img", { src: img, alt: p, className: "absolute inset-0 w-full h-full object-cover drop-shadow" }) }), _jsx("span", { className: "font-medium tracking-wide", children: p === 'CYBER_DOG' ? 'Cyber‑Dog' : 'Cyber‑Cat' })] }, p));
                            }) }), _jsx("div", { className: "mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-lg h-60 flex flex-col overflow-hidden", children: petInfo ? (_jsxs("div", { className: "flex flex-col overflow-auto pr-1 custom-scrollbar", children: [_jsx("div", { className: "font-semibold text-base mb-2", children: "Cyber Companion" }), _jsxs("div", { children: [_jsx("span", { className: "text-emerald-300 font-medium", children: "Role:" }), " ", petInfo.role] }), _jsxs("div", { className: "mt-2", children: [_jsx("span", { className: "text-emerald-300 font-medium", children: "Abilities:" }), " ", petInfo.abilities.join(', ')] }), _jsxs("div", { className: "mt-2 space-y-1", children: [_jsx("div", { className: "text-emerald-300 font-medium", children: "Lore:" }), _jsx("div", { className: "opacity-80 text-[17px] leading-snug whitespace-pre-line", children: petInfo.lore })] })] })) : (_jsx("div", { className: "opacity-60", children: "Select a pet to see details." })) }), _jsxs("div", { className: "mt-6 flex justify-between", children: [_jsx(Button, { variant: "ghost", onClick: () => setStep(1), children: "Previous" }), _jsx(Button, { onClick: onContinue, disabled: !pet, children: "Continue" })] })] }))] }) }));
}
function MainMenu({ playerName, accountLevel, loadout, onCustomize, heroLocked }) {
    return (_jsxs("div", { className: "h-full w-full bg-[#0f1218] text-gray-100 grid grid-rows-[64px_1fr]", style: { gridTemplateColumns: 'minmax(260px,20%) 1fr minmax(260px,20%)' }, children: [_jsx(TopNav, {}), _jsx(LeftPlayerPanel, { className: "row-start-2", playerName: playerName, accountLevel: accountLevel, loadout: loadout, onCustomize: onCustomize, heroLocked: heroLocked }), _jsx(CenterHub, { className: "row-start-2", loadout: loadout }), _jsx(RightStartPanel, { className: "row-start-2" })] }));
}
function TopNav() {
    return (_jsxs("div", { className: "col-span-3 grid grid-cols-3 items-center px-6 bg-[#141924] border-b border-white/10 h-16", children: [_jsx("div", {}), _jsxs("div", { className: "flex items-center justify-center gap-8", children: [_jsx("button", { className: "opacity-80 hover:opacity-100", children: "Skills" }), _jsx("button", { className: "opacity-80 hover:opacity-100", children: "Progress" }), _jsx("button", { className: "opacity-80 hover:opacity-100", children: "Store" }), _jsx("button", { className: "opacity-80 hover:opacity-100", children: "Help" })] }), _jsxs("div", { className: "ml-auto flex items-center justify-end gap-4", children: [_jsxs(Chip, { children: ["1,458 ", _jsx("span", { className: "opacity-70", children: "shards" })] }), _jsx(IconButton, { label: "Notifications", children: "\uD83D\uDD14" }), _jsx(IconButton, { label: "Mail", children: "\u2709\uFE0F" }), _jsx("img", { className: "w-9 h-9 rounded object-cover border border-white/10", src: "https://images.unsplash.com/photo-1546527868-ccb7ee7dfa6a?q=80&w=200&auto=format&fit=crop", alt: "avatar" }), _jsx(Button, { size: "sm", children: "Profile" })] })] }));
}
function LeftPlayerPanel({ className = '', playerName, accountLevel, loadout, onCustomize, heroLocked }) {
    return (_jsxs("aside", { className: `col-start-1 h-full ${className} bg-[#0f1218] border-r border-black/40 shadow-inner flex flex-col`, children: [_jsxs("div", { className: "px-4 py-4 border-b border-white/10 flex flex-col items-center", children: [_jsxs("div", { className: "w-[240px] h-[240px] rounded-3xl border border-white/10 bg-white/5 overflow-hidden relative flex flex-col items-center justify-center p-4", children: [_jsx("div", { className: "absolute inset-0 bg-gradient-to-br from-[#0b0e13]/80 via-transparent to-[#0b0e13]/50" }), _jsx("img", { className: "relative z-10 w-32 h-32 object-contain drop-shadow-lg", src: loadout.portraitUrl, alt: "character" }), _jsxs("div", { className: "relative z-10 mt-3 flex flex-col items-center text-center", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("img", { src: FactionIcon[loadout.faction], alt: loadout.faction, className: "w-6 h-6 drop-shadow" }), _jsx("span", { className: "font-semibold text-white text-lg leading-tight", children: loadout.name })] }), _jsxs("div", { className: "mt-1 text-[11px] text-gray-300 flex items-center gap-2", children: [_jsxs("span", { className: "px-2 py-0.5 rounded-full bg-white/5 border border-white/10 tracking-wide", children: ["Lv ", loadout.level] }), _jsx("span", { children: loadout.archetype === 'MALE' ? 'Male' : 'Female' })] })] })] }), _jsx("div", { className: "mt-4 grid grid-cols-3 gap-3 w-full", children: [
                            { label: 'Attack', value: '●●●○○' },
                            { label: 'Defense', value: '●●○○○' },
                            { label: 'Utility', value: '●●●●○' },
                        ].map(s => (_jsxs("div", { className: "rounded-2xl border border-white/10 bg-white/5 p-3 h-24 flex flex-col items-center justify-center text-[11px] text-center", children: [_jsx("div", { className: "opacity-70 mb-1", children: s.label }), _jsx("div", { className: "font-semibold tracking-wider", children: s.value })] }, s.label))) }), _jsx("div", { className: "mt-4 w-full flex items-center justify-center", children: _jsx(Button, { className: "w-[160px]", onClick: onCustomize, children: "Customize" }) })] }), _jsxs("div", { className: "px-4 py-6 flex flex-col items-center gap-4", children: [_jsxs("div", { className: "w-[240px] h-[240px] rounded-3xl border border-white/10 bg-white/5 overflow-hidden relative flex flex-col items-center justify-center p-4", children: [_jsx("div", { className: "absolute inset-0 bg-gradient-to-tr from-[#0b0e13]/80 via-transparent to-[#0b0e13]/50" }), _jsx("img", { className: "relative z-10 w-28 h-28 object-contain drop-shadow", src: PetIcon[loadout.pet.type], alt: "pet" }), _jsxs("div", { className: "relative z-10 mt-3 flex flex-col items-center text-center", children: [_jsx("div", { className: "font-semibold text-white text-base leading-tight", children: loadout.pet.type === 'CYBER_DOG' ? 'Cyber-Dog' : 'Cyber-Cat' }), _jsxs("div", { className: "mt-1 text-[11px] text-gray-300 flex items-center gap-2", children: [_jsxs("span", { className: "px-2 py-0.5 rounded-full bg-white/5 border border-white/10 tracking-wide", children: ["Lv ", loadout.pet.level] }), _jsx("span", { children: loadout.pet.role })] })] })] }), _jsx("div", { className: "grid grid-cols-3 gap-3 w-full", children: [
                            { label: 'Attack', value: '●●○○○' },
                            { label: 'Support', value: '●●●○○' },
                            { label: 'Agility', value: '●●●●○' },
                        ].map(s => (_jsxs("div", { className: "rounded-2xl border border-white/10 bg-white/5 p-3 h-24 flex flex-col items-center justify-center text-[10px] text-center", children: [_jsx("div", { className: "opacity-60 mb-1", children: s.label }), _jsx("div", { className: "font-semibold text-[11px] tracking-wider", children: s.value })] }, s.label))) })] })] }));
}
function CenterHub({ className = '', loadout }) {
    return (_jsxs("main", { className: `col-start-2 px-6 py-5 min-h-0 flex flex-col gap-5 ${className}`, children: [_jsx("div", { className: "relative", style: { flex: '0 0 30%' }, children: _jsx(HeroBanner, { loadout: loadout }) }), _jsxs("div", { className: "flex-1 grid grid-cols-3 gap-5 min-h-0", children: [_jsx(NewsCard, { title: "Season 1: Terraformers" }), _jsx(NewsCard, { title: "Patch 0.2.3 Notes" }), _jsx(NewsCard, { title: "Community Spotlight" })] })] }));
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
    const tabs = GROUP_ORDER;
    // Store picked variant id per group locally (could be moved to zustand later)
    const [picked, setPicked] = useState({});
    function selectVariant(group, id) {
        setPicked(p => ({ ...p, [group]: p[group] === id ? undefined : id }));
    }
    function exportPayload() {
        const base = (initial ?? defaultLoadout);
        const threeConfig = { parts: { ...picked } }; // placeholder shape until full 3D integration
        const payload = locked ?
            { ...base, threeConfig, updatedAt: now() } :
            { ...base, threeConfig, id: uid('char'), createdAt: base.createdAt, updatedAt: now() };
        onSave(payload);
    }
    return (_jsxs("div", { className: "w-screen h-screen bg-[#0b0e13] text-gray-100 relative flex flex-col", children: [_jsx("div", { className: "absolute top-4 left-6 flex items-center gap-2 z-10", children: _jsx(Button, { variant: "ghost", onClick: onBack, children: "Back" }) }), _jsxs("div", { className: "flex-1 flex flex-col", children: [_jsx("div", { className: "flex-1 flex items-center justify-center px-8 py-8", children: _jsxs("div", { className: "relative w-full h-full max-h-[55vh] rounded-[32px] bg-[#12171f] border border-white/10 shadow-2xl overflow-hidden flex items-center justify-center", children: [_jsx("div", { className: "absolute inset-0 bg-gradient-to-tr from-emerald-500/5 via-transparent to-sky-500/5 pointer-events-none" }), _jsx("div", { className: "absolute inset-0", children: _jsx(AvatarScene, {}) }), _jsx("div", { className: "absolute bottom-4 right-4 text-[11px] px-2 py-1 rounded bg-white/5 border border-white/10 uppercase tracking-wide", children: "Preview 3D" })] }) }), _jsxs("div", { className: "w-full bg-[#12171f]/95 backdrop-blur-sm border-t border-white/10 flex flex-col max-h-[45vh]", children: [_jsx("div", { className: "px-8 pt-4 flex flex-wrap justify-center gap-2", children: tabs.map((t) => (_jsx("button", { onClick: () => setTab(t), className: `px-4 py-2 rounded-xl text-sm border transition
                  ${tab === t ? 'bg-emerald-600/30 text-emerald-200 border-emerald-500/60 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10 text-gray-300'}`, children: t }, t))) }), _jsx("div", { className: "flex-1 px-8 pt-6 pb-20 flex items-start justify-center", children: _jsxs("div", { className: "flex gap-4 flex-wrap justify-center max-w-6xl", children: [getVariantsByGroup(tab).map(v => {
                                            const active = picked[tab] === v.id;
                                            return (_jsxs("button", { onClick: () => selectVariant(tab, v.id), title: v.label, className: `w-24 h-24 rounded-xl border transition flex flex-col items-center justify-center gap-1 px-1 text-[11px]
                      ${active ? 'bg-emerald-600/30 border-emerald-500/60 text-emerald-200 shadow-inner' : 'bg-white/5 border-white/10 hover:bg-white/10 text-gray-300'}`, children: [_jsx("span", { className: "truncate max-w-[88px]", children: v.label }), active && _jsx("span", { className: "text-[9px] uppercase tracking-wide", children: "Selected" })] }, v.id));
                                        }), getVariantsByGroup(tab).length === 0 && (_jsxs("div", { className: "text-xs opacity-50 px-4 py-6", children: ["No variants for ", tab] }))] }) }), _jsxs("div", { className: "px-8 py-5 flex justify-end gap-3 border-t border-white/10 bg-[#12171f]/95 sticky bottom-0", children: [_jsx(Button, { variant: "ghost", onClick: onBack, children: "Previous" }), _jsx(Button, { onClick: exportPayload, children: "Save & Continue" })] })] })] })] }));
}
function Card({ children }) {
    return _jsx("div", { className: "rounded-2xl p-4 bg-white/5 border border-white/10 shadow", children: children });
}
function Button({ children, onClick, variant = 'solid', size = 'md', className = '', disabled }) {
    const base = 'rounded-xl inline-flex items-center justify-center border transition focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed';
    const variants = variant === 'ghost'
        ? 'bg-transparent border-white/15 hover:border-white/30 text-gray-100'
        : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-700';
    const sizes = size === 'sm' ? 'h-8 px-3 text-sm' : size === 'lg' ? 'h-12 px-5 text-lg' : 'h-10 px-4';
    return (_jsx("button", { onClick: onClick, disabled: disabled, className: `${base} ${variants} ${sizes} ${className}`, children: children }));
}
function IconButton({ children, label }) {
    return _jsx("button", { "aria-label": label, className: "h-9 w-9 grid place-items-center rounded-xl bg-white/10 border border-white/10 hover:bg-white/15", children: children });
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
function HeroBanner({ loadout }) {
    return (_jsxs("div", { className: "aspect-[21/9] w-full rounded-3xl overflow-hidden relative border border-white/10 bg-gradient-to-br from-emerald-500/10 via-[#141b24] to-sky-500/10", children: [_jsx("img", { src: loadout.portraitUrl, alt: "hero", className: "absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-lighten" }), _jsx("div", { className: "absolute inset-0 bg-gradient-to-tr from-[#0b0e13]/60 to-transparent" }), _jsxs("div", { className: "absolute left-6 bottom-6", children: [_jsx("div", { className: "text-xs uppercase tracking-wide opacity-70", children: "Active Character" }), _jsx("div", { className: "text-3xl font-semibold", children: loadout.name }), _jsxs("div", { className: "mt-1 flex items-center gap-2 text-sm opacity-90", children: [_jsx(FactionPill, { faction: loadout.faction }), " ", _jsxs("span", { children: ["Lv ", loadout.level] })] })] })] }));
}
function NewsCard({ title }) {
    return (_jsxs("div", { className: "rounded-2xl p-4 bg-[#12171f] border border-white/10 min-h-[140px] grid", children: [_jsxs("div", { children: [_jsx("div", { className: "text-[11px] uppercase tracking-wide opacity-60", children: "News" }), _jsx("div", { className: "text-lg font-semibold mt-1", children: title })] }), _jsx("div", { className: "self-end", children: _jsx("button", { className: "h-8 px-3 rounded bg-white/10 hover:bg-white/15 text-sm", children: "View" }) })] }));
}
