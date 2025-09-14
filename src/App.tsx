import React, { useEffect, useState } from 'react';
import { Archetype, CharacterLoadout, Faction, PetType, uid, now } from './types/loadout';
import { CharacterPortrait, FactionIcon, ImageAssets, getCharacterPortrait, PetIcon } from './assets/assetPaths';

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
  const [phase, setPhase] = useState<'boot' | 'onboard' | 'creating' | 'main'>('boot');
  const [progress, setProgress] = useState(0);
  const [playerName] = useState('PlayerOne');
  const [accountLevel] = useState(1);
  const [activeLoadout, setActiveLoadout] = useState<CharacterLoadout | null>(null);
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

  function startCreator() {
    if (heroLocked) return; // cannot create a new hero once locked
    setPhase('creating');
  }

  function handleCreatorSave(newLoadout: CharacterLoadout) {
    // Preserve original id if already existed (no new hero creation after lock)
    if (activeLoadout) {
      setActiveLoadout({ ...activeLoadout, ...newLoadout, id: activeLoadout.id, createdAt: activeLoadout.createdAt, updatedAt: now() });
    } else {
      setActiveLoadout(newLoadout);
    }
    setPhase('main');
  }

  if (phase === 'boot') return <GameViewport mode="fit"><WelcomeScreen progress={progress} build="v0.2.3 demo • UE5" /></GameViewport>;

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

function WelcomeScreen({ progress, build }: { progress: number; build: string }) {
  return (
    <div className="w-screen h-screen bg-[#0b0e13] relative text-gray-100 overflow-hidden">
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

function FirstTimeFlow({ faction, archetype, pet, onFaction, onArchetype, onPet, onContinue }: { faction: Faction | null; archetype: Archetype | null; pet: PetType | null; onFaction: (f: Faction) => void; onArchetype: (a: Archetype) => void; onPet: (p: PetType) => void; onContinue: () => void; }) {
  const [step, setStep] = useState(0);
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
      <div className="w-full max-w-5xl bg-[#12171f] rounded-2xl p-6 border border-white/10 shadow-2xl flex flex-col" style={{height:'100%'}}>
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold tracking-wide">Create Your Character</h2>
          <div className="text-sm opacity-70">Step {step + 1} / {steps.length}</div>
        </div>
        {step === 0 && (
          <div className="mt-6">
            <div className="text-sm opacity-80 mb-2">Choose Faction</div>
            <div className="grid grid-cols-3 gap-4">
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
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 h-72 flex flex-col overflow-hidden">
              {chosenFaction ? (
                <div className="flex flex-col text-lg leading-relaxed overflow-auto pr-1 custom-scrollbar">
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
            <div className="grid grid-cols-2 gap-4 max-w-[640px]">
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
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-lg h-60 flex flex-col overflow-hidden">
              {arch ? (
                <div className="flex flex-col overflow-auto pr-1 custom-scrollbar">
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
            <div className="grid grid-cols-2 gap-4 max-w-[640px]">
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
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-lg h-60 flex flex-col overflow-hidden">
              {petInfo ? (
                <div className="flex flex-col overflow-auto pr-1 custom-scrollbar">
                  <div className="font-semibold text-base mb-2">Cyber Companion</div>
                  <div><span className="text-emerald-300 font-medium">Role:</span> {petInfo.role}</div>
                  <div className="mt-2"><span className="text-emerald-300 font-medium">Abilities:</span> {petInfo.abilities.join(', ')}</div>
                  <div className="mt-2 space-y-1">
                    <div className="text-emerald-300 font-medium">Lore:</div>
                    <div className="opacity-80 text-[17px] leading-snug whitespace-pre-line">{petInfo.lore}</div>
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
  );
}

function MainMenu({ playerName, accountLevel, loadout, onCustomize, heroLocked }: { playerName: string; accountLevel: number; loadout: CharacterLoadout; onCustomize: () => void; heroLocked: boolean; }) {
  return (
    <div className="h-full w-full bg-[#0f1218] text-gray-100 grid grid-rows-[64px_1fr]" style={{gridTemplateColumns:'minmax(260px,20%) 1fr minmax(260px,20%)'}}>
      <TopNav />
      <LeftPlayerPanel className="row-start-2" playerName={playerName} accountLevel={accountLevel} loadout={loadout} onCustomize={onCustomize} heroLocked={heroLocked} />
      <CenterHub className="row-start-2" loadout={loadout} />
      <RightStartPanel className="row-start-2" />
    </div>
  );
}

function TopNav() {
  return (
    <div className="col-span-3 grid grid-cols-3 items-center px-6 bg-[#141924] border-b border-white/10 h-16">
      <div />
      <div className="flex items-center justify-center gap-8">
        <button className="opacity-80 hover:opacity-100">Skills</button>
        <button className="opacity-80 hover:opacity-100">Progress</button>
        <button className="opacity-80 hover:opacity-100">Store</button>
        <button className="opacity-80 hover:opacity-100">Help</button>
      </div>
      <div className="ml-auto flex items-center justify-end gap-4">
        <Chip>1,458 <span className="opacity-70">shards</span></Chip>
        <IconButton label="Notifications">🔔</IconButton>
        <IconButton label="Mail">✉️</IconButton>
        <img className="w-9 h-9 rounded object-cover border border-white/10" src="https://images.unsplash.com/photo-1546527868-ccb7ee7dfa6a?q=80&w=200&auto=format&fit=crop" alt="avatar" />
        <Button size="sm">Profile</Button>
      </div>
    </div>
  );
}

function LeftPlayerPanel({ className = '', playerName, accountLevel, loadout, onCustomize, heroLocked }: { className?: string; playerName: string; accountLevel: number; loadout: CharacterLoadout; onCustomize: () => void; heroLocked: boolean; }) {
  return (
    <aside className={`col-start-1 h-full ${className} bg-[#0f1218] border-r border-black/40 shadow-inner flex flex-col`}>      
      <div className="px-4 py-4 border-b border-white/10 flex flex-col items-center">
        {/* 240x240 Character Card */}
        <div className="w-[240px] h-[240px] rounded-3xl border border-white/10 bg-white/5 overflow-hidden relative flex flex-col items-center justify-center p-4">
          <div className="absolute inset-0 bg-gradient-to-br from-[#0b0e13]/80 via-transparent to-[#0b0e13]/50" />
          <img className="relative z-10 w-32 h-32 object-contain drop-shadow-lg" src={loadout.portraitUrl} alt="character" />
          <div className="relative z-10 mt-3 flex flex-col items-center text-center">
            <div className="flex items-center gap-2">
              <img src={FactionIcon[loadout.faction]} alt={loadout.faction} className="w-6 h-6 drop-shadow" />
              <span className="font-semibold text-white text-lg leading-tight">{loadout.name}</span>
            </div>
            <div className="mt-1 text-[11px] text-gray-300 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 tracking-wide">Lv {loadout.level}</span>
              <span>{loadout.archetype === 'MALE' ? 'Male' : 'Female'}</span>
            </div>
          </div>
        </div>
        {/* Stat row under card */}
        <div className="mt-4 grid grid-cols-3 gap-3 w-full">
          {[
            { label: 'Attack', value: '●●●○○' },
            { label: 'Defense', value: '●●○○○' },
            { label: 'Utility', value: '●●●●○' },
          ].map(s => (
            <div key={s.label} className="rounded-2xl border border-white/10 bg-white/5 p-3 h-24 flex flex-col items-center justify-center text-[11px] text-center">
              <div className="opacity-70 mb-1">{s.label}</div>
              <div className="font-semibold tracking-wider">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 w-full flex items-center justify-center">
          <Button className="w-[160px]" onClick={onCustomize}>Customize</Button>
        </div>
      </div>
      <div className="px-4 py-6 flex flex-col items-center gap-4">
        {/* 240x240 Pet Card matching character */}
        <div className="w-[240px] h-[240px] rounded-3xl border border-white/10 bg-white/5 overflow-hidden relative flex flex-col items-center justify-center p-4">
          <div className="absolute inset-0 bg-gradient-to-tr from-[#0b0e13]/80 via-transparent to-[#0b0e13]/50" />
          <img className="relative z-10 w-28 h-28 object-contain drop-shadow" src={PetIcon[loadout.pet.type]} alt="pet" />
          <div className="relative z-10 mt-3 flex flex-col items-center text-center">
            <div className="font-semibold text-white text-base leading-tight">{loadout.pet.type === 'CYBER_DOG' ? 'Cyber-Dog' : 'Cyber-Cat'}</div>
            <div className="mt-1 text-[11px] text-gray-300 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 tracking-wide">Lv {loadout.pet.level}</span>
              <span>{loadout.pet.role}</span>
            </div>
          </div>
        </div>
        {/* Pet stats below */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {[
            { label: 'Attack', value: '●●○○○' },
            { label: 'Support', value: '●●●○○' },
            { label: 'Agility', value: '●●●●○' },
          ].map(s => (
            <div key={s.label} className="rounded-2xl border border-white/10 bg-white/5 p-3 h-24 flex flex-col items-center justify-center text-[10px] text-center">
              <div className="opacity-60 mb-1">{s.label}</div>
              <div className="font-semibold text-[11px] tracking-wider">{s.value}</div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function CenterHub({ className = '', loadout }: { className?: string; loadout: CharacterLoadout }) {
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
  const [tab, setTab] = useState('Head');
  const tabs = ['Head', 'Hair', 'Face', 'Eyes', 'Eyebrows', 'Nose', 'Facial Hair', 'Glasses', 'Hat', 'Top', 'Bottom', 'Shoes', 'Accessories'];
  function exportPayload() {
    const base = (initial ?? defaultLoadout);
    const payload: CharacterLoadout = locked ?
      { ...base, updatedAt: now() } :
      { ...base, id: uid('char'), createdAt: base.createdAt, updatedAt: now() };
    onSave(payload);
  }
  return (
    <div className="w-screen h-screen bg-[#0b0e13] text-gray-100 relative flex flex-col">
      <div className="absolute top-4 left-6 flex items-center gap-2 z-10">
        <Button variant="ghost" onClick={onBack}>Back</Button>
      </div>
      {/* Top preview now spans full width */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center px-8 py-8">
          <div className="relative w-full h-full max-h-[55vh] rounded-[32px] bg-[#12171f] border border-white/10 shadow-2xl overflow-hidden flex items-center justify-center">
            <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/5 via-transparent to-sky-500/5" />
            <img className="h-[60%] object-contain relative z-10 drop-shadow-xl" src={initial?.portraitUrl || '/assets/chibi-default.png'} alt="preview" />
            <div className="absolute bottom-4 right-4 text-[11px] px-2 py-1 rounded bg-white/5 border border-white/10 uppercase tracking-wide">Preview</div>
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
          <div className="flex-1 px-8 pt-6 pb-20 flex items-start justify-center">
            <div className="flex gap-4 flex-wrap justify-center max-w-6xl">
              {Array.from({ length: 14 }).map((_, i) => (
                <button
                  key={i}
                  className="w-20 h-20 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition grid place-items-center text-[11px] text-gray-300"
                >{i === 0 ? '×' : ''}</button>
              ))}
            </div>
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

function IconButton({ children, label }: { children: React.ReactNode; label: string }) {
  return <button aria-label={label} className="h-9 w-9 grid place-items-center rounded-xl bg-white/10 border border-white/10 hover:bg-white/15">{children}</button>;
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
    <div className="rounded-2xl p-4 bg-[#12171f] border border-white/10 min-h-[140px] grid">
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
