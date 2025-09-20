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
  // Single in-game menu popup state
  const [menuOpen, setMenuOpen] = React.useState(false);
  React.useEffect(()=>{
    function onKey(e:KeyboardEvent){ if(e.key==='Escape') setMenuOpen(false); }
    window.addEventListener('keydown', onKey);
    return ()=> window.removeEventListener('keydown', onKey);
  },[]);
  // Extract shards & filter out duplicates from the resources cluster (avoid showing there)
  let shardsValue: number | undefined; 
  const filteredResources = resources.filter(r => {
    const id = (r.id||'').toString().trim().toLowerCase();
    const label = (r.label||'').toString().trim().toLowerCase();
    if (!label) return false;
    if (id === 'shards' || label === 'shards') { shardsValue = r.value; return false; }
    if (id.includes('skill') || id.includes('token') || label.includes('skill') || label.includes('token')) return false; // skill tokens handled separately
    return true;
  });
  const abilitySlots = abilities.slice(0,8);
  const itemSlots = items.slice(0,8);

  return (
    <div className="pointer-events-none text-white select-none">
      {/* Standalone Menu Button (top-left) */}
      <div className="fixed top-2 left-2 z-50 pointer-events-auto">
        <button onClick={()=> setMenuOpen(o=>!o)} className="px-3 py-2 rounded-lg bg-black/40 hover:bg-black/60 ring-1 ring-white/10 text-xs font-semibold">Menu</button>
      </div>

      {/* Top Bar (no menu; includes shards + skill tokens) */}
      <div className="fixed top-0 left-0 right-0 flex items-center justify-center pt-2 z-40 pointer-events-none">
        <div className="flex items-center gap-3 bg-black/30 backdrop-blur rounded-xl px-3 py-1 ring-1 ring-white/10 text-xs pointer-events-auto">
          <div className="opacity-80 font-semibold tracking-wide">{team}</div>
          <div className="font-bold text-emerald-300">{score.radiant}</div>
          <div className="opacity-70">vs</div>
          <div className="font-bold text-rose-300">{score.dire}</div>
          <div className="opacity-80">{clock}</div>
          {/* Tokens */}
          <div className="flex items-center gap-2 ml-2">
            <StatPill label="Shards" value={typeof shardsValue === 'number' ? shardsValue : 0} />
            <StatPill label="Skill" value={skillTokens} />
          </div>
        </div>
      </div>

      {/* Resources cluster (filtered, no shards/skill tokens) */}
      {!!filteredResources.length && <div className="fixed top-4 right-4 bg-black/40 backdrop-blur rounded-xl px-3 py-2 ring-1 ring-white/10 pointer-events-auto z-40">
        <div className="flex items-center gap-2 flex-wrap max-w-[460px] justify-end">{filteredResources.map(r=> (
          <div key={r.id} className="px-2 py-1 rounded bg-white/5 ring-1 ring-white/10 text-[11px] flex items-center gap-1">
            <span>{r.icon || '◈'}</span><span className="opacity-70">{r.label}</span><span className="font-semibold tabular-nums">{r.value}</span>
          </div>
        ))}</div>
      </div>}

      {/* In-game popup menu */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 pointer-events-auto flex">
          {/* backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={()=> setMenuOpen(false)} />
          {/* Aligned menu directly under top bar near left margin (beneath menu button) */}
          <div className="relative mt-16 ml-4 w-64 bg-[#0b1218]/95 rounded-xl ring-1 ring-white/10 p-4 flex flex-col gap-2 shadow-2xl">
            <div className="flex items-center mb-1">
              <div className="text-sm font-semibold tracking-wide">Game Menu</div>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <button onClick={()=>{ onSettings && onSettings(); setMenuOpen(false); }} className="px-3 py-2 rounded bg-white/5 hover:bg-white/10 text-left">Settings</button>
              <button onClick={()=>{ onScoreboard && onScoreboard(); setMenuOpen(false); }} className="px-3 py-2 rounded bg-white/5 hover:bg-white/10 text-left">Scoreboard</button>
              <button onClick={()=>{ onShop && onShop(); setMenuOpen(false); }} className="px-3 py-2 rounded bg-white/5 hover:bg-white/10 text-left">Store</button>
              <div className="h-px bg-white/10 my-1" />
              <button onClick={()=> setMenuOpen(false)} className="px-3 py-2 rounded bg-emerald-600/60 hover:bg-emerald-600/80 text-left font-semibold">Back to Game</button>
              <button onClick={()=>{ onMenu && onMenu(); setMenuOpen(false); }} className="px-3 py-2 rounded bg-rose-600/60 hover:bg-rose-600/80 text-left font-semibold">Back to Menu</button>
            </div>
            <div className="mt-2 text-[10px] opacity-60">Press Esc or Back to Game to close.</div>
          </div>
        </div>
      )}

      {/* Ability bar removed per request */}

      {/* Bottom bar reduced height (25%) */}
      <div className="fixed bottom-2 left-1/2 -translate-x-1/2 z-30 w-[1100px] pointer-events-none">
        <div className="flex items-end justify-center gap-4">
          {/* Minimap */}
          <div className="pointer-events-auto relative w-56 h-[7.5rem] rounded-xl overflow-hidden ring-2 ring-white/10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-emerald-700 via-emerald-800 to-emerald-900" onClick={(e)=>{ const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const x = (e.clientX - rect.left)/rect.width; const y = (e.clientY - rect.top)/rect.height; onMinimapClick && onMinimapClick(x,y); }} />
          {/* Scan & Fortify buttons (moved to bottom HUD) */}
          <div className="pointer-events-auto flex flex-col justify-between h-[7.5rem] py-1">
            <button onClick={()=> onScan && onScan()} className="w-12 h-12 rounded-lg bg-black/40 hover:bg-black/60 ring-1 ring-white/10 flex items-center justify-center text-lg" aria-label="Scan" title="Scan">🛰️</button>
            <button onClick={()=> onGlyph && onGlyph()} className="w-12 h-12 rounded-lg bg-black/40 hover:bg-black/60 ring-1 ring-white/10 flex items-center justify-center text-lg" aria-label="Fortify" title="Fortify">🛡️</button>
          </div>

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
                  <div className="w-11 h-11 rounded-lg overflow-hidden flex items-center justify-center bg-slate-900 ring-1 ring-white/10">
                    {(pet as any).portraitUrl ? <img src={(pet as any).portraitUrl} alt={pet.name} className="w-full h-full object-cover" /> : (pet.icon || '🐾')}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between"><div className="text-[11px] font-semibold">{pet.name}</div><div className="text-[9px] opacity-70">Lv {pet.level}</div></div>
                    <Bar value={pet.hp.current} max={pet.hp.max} color="bg-lime-400" />
                    <div className="text-[9px] mt-0.5 opacity-80 tabular-nums">{pet.hp.current}/{pet.hp.max} HP</div>
                    <Bar value={pet.ep.current} max={pet.ep.max} color="bg-cyan-400" />
                    <div className="text-[9px] mt-0.5 opacity-80 tabular-nums">{pet.ep.current}/{pet.ep.max} EP</div>
                    {/* Pet XP bar (mirrors hero XP styling but smaller) */}
                    <div className="mt-1">
                      <Bar value={pet.level /* placeholder progress value if real XP not provided */} max={pet.level || 1} color="bg-amber-300" bg="bg-black/40" />
                      <div className="text-[9px] mt-0.5 opacity-70 tabular-nums">Pet XP</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Inventory */}
          <div className="w-72 bg-black/40 rounded-2xl p-2 ring-1 ring-white/10 h-[7.5rem] pointer-events-auto flex flex-col">
            <div className="flex items-center justify-between mb-1"><div className="font-semibold text-xs">Inventory</div></div>
            <div className="grid grid-cols-4 gap-1.5 flex-1 content-start">{itemSlots.map((it,i)=>(<Slot key={it.id} icon={it.icon || '📦'} hotkey={it.key || ['Q','W','E','R','T','Y','U','I'][i] || ''} qty={it.qty} cooldown={it.cooldown} maxCooldown={it.maxCooldown} onClick={()=> onItem && onItem(it.id)} />))}</div>
          </div>
        </div>
      </div>

      {subtitles && <div className="fixed right-6 bottom-40 max-w-sm bg-black/40 rounded-lg px-3 py-2 ring-1 ring-white/10 text-sm">{subtitles}</div>}
    </div>
  );
};
export default GameHUD;
