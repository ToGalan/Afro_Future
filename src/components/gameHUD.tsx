// Renamed from AfroHud.tsx to gameHUD.tsx
import React from 'react';
import { Faction } from '../types/loadout';

export type Ability = { id: string; icon?: string; cooldown?: number; maxCooldown?: number; disabled?: boolean; key?: string };
export type Item = { id: string; icon?: string; qty?: number; key?: string; cooldown?: number; maxCooldown?: number };
export type Resource = { id: string; label: string; value: number; icon?: string };

export interface GameHUDProps {
  team: Faction | string;
  clock: string;
  fps?: number;
  network?: string;
  score: { radiant: number; dire: number };
  hero: {
    name: string; level: number;
    hp: { current: number; max: number };
    ep: { current: number; max: number };
    xp: { current: number; max: number };
    portraitUrl?: string;
    buffs?: string[]; debuffs?: string[];
  };
  pet?: { name: string; hp: { current: number; max: number }; ep: { current: number; max: number }; level: number; icon?: string };
  abilities: Ability[];
  items: Item[];
  resources: Resource[];
  skillTokens: number;
  petTokens: number;
  subtitles?: string;
  onMenu?: () => void; onSettings?: () => void; onScoreboard?: () => void; onScan?: () => void; onStats?: () => void; onTalents?: () => void; onGlyph?: () => void; onShop?: () => void;
  onAbility?: (id: string) => void; onItem?: (id: string) => void; onMinimapClick?: (x: number, y: number) => void;
}

const pct = (v:number, m:number) => m>0 ? Math.min(1, Math.max(0, v/m)) : 0;
const Bar = React.memo(function Bar({ value, max, color, bg = 'bg-black/50' }: { value: number; max: number; color: string; bg?: string }) { const p = pct(value, max) * 100; return <div className={`w-full h-3 rounded ${bg} overflow-hidden`}><div className={`h-full ${color}`} style={{ width: `${p}%` }} /></div>; });
const CooldownOverlay = React.memo(function CooldownOverlay({ value, max }: { value?: number; max?: number }) { if (!value || !max || value <= 0) return null; const p = Math.min(1, value / max); return (<div className="absolute inset-0 flex items-center justify-center"><div className="absolute inset-0 rounded-lg bg-black/60" /><div className="absolute inset-0" style={{ background: `conic-gradient(rgba(0,0,0,0.65) ${p * 360}deg, transparent 0)`, mask: 'radial-gradient(circle at center, transparent 55%, black 56%)' }} /><div className="relative z-10 text-[10px] font-semibold text-white">{Math.ceil(value)}s</div></div>); });
interface SlotProps { icon?: string; hotkey?: string; qty?: number; cooldown?: number; maxCooldown?: number; disabled?: boolean; onClick?: () => void; }
const Slot = React.memo(function Slot({ icon='⬢', hotkey, qty, cooldown, maxCooldown, disabled, onClick }: SlotProps) { return (<button aria-label={hotkey ? `Slot ${hotkey}` : 'Slot'} disabled={disabled} onClick={onClick} className={`relative w-14 h-14 rounded-lg overflow-hidden ring-1 ring-white/10 bg-gradient-to-b from-slate-800/60 to-slate-900/60 focus:outline-none focus:ring-emerald-400/40 ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:ring-white/30 active:scale-[0.97] transition'} `}><div className="absolute inset-0 flex items-center justify-center text-lg select-none">{icon}</div>{hotkey && <div className="absolute top-0 left-0 px-1 py-0.5 text-[10px] text-white/70">{hotkey}</div>}{typeof qty === 'number' && <div className="absolute bottom-0 right-0 px-1 py-0.5 text-[10px] font-semibold text-white">{qty}</div>}<CooldownOverlay value={cooldown} max={maxCooldown} /></button>); });
const StatPill = React.memo(function StatPill({ label, value }: { label: string; value: string | number }) { return <div className="px-2 py-1 rounded bg-white/5 ring-1 ring-white/10 text-xs flex items-center gap-1"><span className="opacity-70">{label}</span><span className="font-semibold tabular-nums">{value}</span></div>; });

export const GameHUD: React.FC<GameHUDProps> = ({ team, clock, fps=60, network='OK', score, hero, pet, abilities, items, resources, skillTokens, petTokens, subtitles, onShop, onAbility, onItem, onMinimapClick, onMenu, onSettings, onScoreboard, onScan, onStats, onTalents, onGlyph }) => {
  const filteredResources = resources.filter(r => r.id.toLowerCase() !== 'shards' && r.label.toLowerCase() !== 'shards');
  const abilitySlots = abilities.slice(0,8);
  const itemSlots = items.slice(0,8);

  return (
    <div className="pointer-events-none text-white select-none">
      {/* Restored top bar */}
      <div className="fixed top-0 left-0 right-0 flex items-start justify-center pt-2 z-40">
        <div className="flex items-center gap-3 bg-black/40 backdrop-blur rounded-xl px-4 py-1.5 ring-1 ring-white/10 text-xs">
          <div className="opacity-80 font-semibold tracking-wide">{team}</div>
          <div className="font-bold text-emerald-300">{score.radiant}</div>
          <div className="opacity-70">vs</div>
            <div className="font-bold text-rose-300">{score.dire}</div>
          <div className="opacity-80 tabular-nums">{clock}</div>
          <div className="opacity-70">FPS {fps}</div>
          <div className="opacity-70">NET {network}</div>
          <div className="ml-2 flex items-center gap-2 pl-2 border-l border-white/10">
            <StatPill label="Skill" value={skillTokens} />
            <StatPill label="Pet" value={petTokens} />
          </div>
        </div>
        {/* Side vertical menu buttons */}
        <div className="absolute left-4 top-16 flex flex-col gap-2 pointer-events-auto">
          <button onClick={onMenu} className="px-3 py-2 rounded bg-black/40 hover:bg-black/60 ring-1 ring-white/10 text-xs">Main Menu</button>
          <button onClick={onSettings} className="px-3 py-2 rounded bg-black/40 hover:bg-black/60 ring-1 ring-white/10 text-xs">Settings</button>
          <button onClick={onScoreboard} className="px-3 py-2 rounded bg-black/40 hover:bg-black/60 ring-1 ring-white/10 text-xs">Scoreboard</button>
          <button onClick={onScan} className="px-3 py-2 rounded bg-black/40 hover:bg-black/60 ring-1 ring-white/10 text-xs">Scan</button>
          <button onClick={onGlyph} className="px-3 py-2 rounded bg-black/40 hover:bg-black/60 ring-1 ring-white/10 text-xs">Fortify</button>
          <button onClick={onStats} className="px-3 py-2 rounded bg-black/40 hover:bg-black/60 ring-1 ring-white/10 text-xs">Hero Stats</button>
          <button onClick={onTalents} className="px-3 py-2 rounded bg-black/40 hover:bg-black/60 ring-1 ring-white/10 text-xs">Talents</button>
        </div>
        {/* Resources panel top-right */}
        {!!filteredResources.length && <div className="absolute right-4 top-2 bg-black/40 backdrop-blur rounded-xl px-3 py-2 ring-1 ring-white/10 pointer-events-auto flex items-center gap-2">{filteredResources.map(r=> (<div key={r.id} className="px-2 py-1 rounded bg-white/5 ring-1 ring-white/10 text-[11px] flex items-center gap-1"><span>{r.icon || '◈'}</span><span className="opacity-70">{r.label}</span><span className="font-semibold tabular-nums">{r.value}</span></div>))}</div>}
      </div>

      {/* Abilities bar below top bar */}
      <div className="fixed top-20 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
        <div className="flex items-center gap-2 bg-black/40 backdrop-blur px-4 py-2 rounded-2xl ring-1 ring-white/10">
          {abilitySlots.map((a,i)=>(
            <Slot key={a.id} icon={a.icon || ['❄️','🔥','⚡','🌪️','🛡️','🌿','💥','🛰️'][i%8]} hotkey={a.key || String(i+1)} cooldown={a.cooldown} maxCooldown={a.maxCooldown} disabled={a.disabled} onClick={()=> onAbility && onAbility(a.id)} />
          ))}
        </div>
      </div>

      {/* Bottom bar reduced height (25%) */}
      <div className="fixed bottom-2 left-1/2 -translate-x-1/2 z-30 w-[1100px] pointer-events-none">
        <div className="flex items-end justify-center gap-4">
          {/* Minimap */}
          <div className="pointer-events-auto relative w-56 h-[7.5rem] rounded-xl overflow-hidden ring-2 ring-white/10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-emerald-700 via-emerald-800 to-emerald-900" onClick={(e)=>{ const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const x = (e.clientX - rect.left)/rect.width; const y = (e.clientY - rect.top)/rect.height; onMinimapClick && onMinimapClick(x,y); }} />

          {/* Hero + Pet */}
          <div className="flex pointer-events-auto gap-3 bg-black/40 ring-1 ring-white/10 rounded-2xl p-2 h-[7.5rem]">
            {/* Hero Card */}
            <div className="flex flex-col w-56 justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl overflow-hidden ring-2 ring-white/10 bg-slate-900">{hero.portraitUrl ? <img src={hero.portraitUrl} alt={hero.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-lg">👤</div>}</div>
                <div className="flex-1">
                  <div className="flex items-center justify-between"><div className="font-semibold text-xs">{hero.name}</div><div className="text-[10px] opacity-70">Lv {hero.level}</div></div>
                  <div className="mt-0.5">
                    <Bar value={hero.hp.current} max={hero.hp.max} color="bg-rose-500" />
                    <div className="text-[9px] mt-0.5 opacity-80 tabular-nums">{hero.hp.current}/{hero.hp.max} HP</div>
                  </div>
                  <div className="mt-0.5">
                    <Bar value={hero.ep.current} max={hero.ep.max} color="bg-sky-500" />
                    <div className="text-[9px] mt-0.5 opacity-80 tabular-nums">{hero.ep.current}/{hero.ep.max} EP</div>
                  </div>
                </div>
              </div>
              <div className="mt-1">
                <Bar value={hero.xp.current} max={hero.xp.max} color="bg-amber-400" bg="bg-black/40" />
                <div className="text-[9px] mt-0.5 opacity-80 tabular-nums">XP {hero.xp.current}/{hero.xp.max}</div>
              </div>
            </div>
            {/* Pet Card */}
            {pet && (
              <div className="flex flex-col w-44 justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-11 h-11 rounded-lg flex items-center justify-center bg-slate-900 ring-1 ring-white/10">{pet.icon || '🐾'}</div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between"><div className="text-[11px] font-semibold">{pet.name}</div><div className="text-[9px] opacity-70">Lv {pet.level}</div></div>
                    <Bar value={pet.hp.current} max={pet.hp.max} color="bg-lime-400" />
                    <div className="text-[9px] mt-0.5 opacity-80 tabular-nums">{pet.hp.current}/{pet.hp.max} HP</div>
                    <Bar value={pet.ep.current} max={pet.ep.max} color="bg-cyan-400" />
                    <div className="text-[9px] mt-0.5 opacity-80 tabular-nums">{pet.ep.current}/{pet.ep.max} EP</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Inventory */}
          <div className="w-72 bg-black/40 rounded-2xl p-2 ring-1 ring-white/10 h-[7.5rem] pointer-events-auto flex flex-col">
            <div className="flex items-center justify-between mb-1"><div className="font-semibold text-xs">Inventory</div><button onClick={onShop} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-[10px]">Shop</button></div>
            <div className="grid grid-cols-4 gap-1.5 flex-1 content-start">{itemSlots.map((it,i)=>(<Slot key={it.id} icon={it.icon || '📦'} hotkey={it.key || ['Q','W','E','R','T','Y','U','I'][i] || ''} qty={it.qty} cooldown={it.cooldown} maxCooldown={it.maxCooldown} onClick={()=> onItem && onItem(it.id)} />))}</div>
          </div>
        </div>
      </div>

      {subtitles && <div className="fixed right-6 bottom-40 max-w-sm bg-black/40 rounded-lg px-3 py-2 ring-1 ring-white/10 text-sm">{subtitles}</div>}
    </div>
  );
};
export default GameHUD;
