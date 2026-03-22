// Renamed from AfroHud.tsx to gameHUD.tsx — Dota 2-style layout, 2x scale
import React from 'react';
import { Faction } from '../types/loadout';

export type Ability = { id: string; icon?: string; cooldown?: number; maxCooldown?: number; disabled?: boolean; key?: string };
export type Item = { id: string; icon?: string; qty?: number; key?: string; cooldown?: number; maxCooldown?: number };
export type Resource = { id: string; label: string; value: number; icon?: string };

export type MinimapData = {
  exploredKeys: Set<string>;      // "q,r" strings of discovered tiles
  exploredRevision: number;       // increments when explored set grows
  visibleKeys: Set<string>;       // tiles currently in view (hero + pet FoV)
  tileTypes: Map<string, string>; // "q,r" -> terrain type string
  heroPos: { q: number; r: number };
  petPos?: { q: number; r: number };
  hexSize: number;
  mapBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
};

const TERRAIN_DIM: Record<string, string> = {
  water: '#1a5a9a', desert: '#8a6a28', plains: '#2d5b1e',
  forest: '#0e3a14', jungle: '#065020', hills: '#5a4218', mountain: '#4a4a58',
};
const TERRAIN_LIT: Record<string, string> = {
  water: '#3aa0d8', desert: '#d8a840', plains: '#60a040',
  forest: '#267830', jungle: '#10904a', hills: '#907030', mountain: '#8888a0',
};

const MinimapCanvas = React.memo(
  function MinimapCanvas({ data }: { data: MinimapData }) {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    React.useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const cw = canvas.offsetWidth || 448;
      const ch = canvas.offsetHeight || 264;
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const { exploredKeys, visibleKeys, tileTypes, heroPos, petPos, hexSize, mapBounds } = data;
      const { minX, maxX, minZ, maxZ } = mapBounds;
      const rx = (maxX - minX) || 1;
      const rz = (maxZ - minZ) || 1;
      const toCanvas = (q: number, r: number): [number, number] => {
        const wx = hexSize * 1.5 * q;
        const wz = hexSize * Math.sqrt(3) * (r + q / 2);
        return [(wx - minX) / rx * cw, (wz - minZ) / rz * ch];
      };
      // Background
      ctx.fillStyle = '#0a140e';
      ctx.fillRect(0, 0, cw, ch);
      // Explored tiles — dim baseline first, then re-paint visible tiles bright
      for (const key of exploredKeys) {
        const ci = key.indexOf(',');
        const q = parseInt(key.slice(0, ci));
        const r = parseInt(key.slice(ci + 1));
        const type = tileTypes.get(key) ?? 'plains';
        ctx.fillStyle = visibleKeys.has(key)
          ? (TERRAIN_LIT[type] ?? '#60a040')
          : (TERRAIN_DIM[type] ?? '#2d5b1e');
        const [px, py] = toCanvas(q, r);
        ctx.fillRect(Math.round(px), Math.round(py), 2, 2);
      }
      // Pet marker
      if (petPos) {
        const [px, py] = toCanvas(petPos.q, petPos.r);
        ctx.fillStyle = '#4ade80';
        ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
      }
      // Hero marker
      const [hx, hy] = toCanvas(heroPos.q, heroPos.r);
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fffaed';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Compass
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('N', cw - 14, 13);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.exploredRevision, data.visibleKeys, data.heroPos.q, data.heroPos.r, data.petPos?.q, data.petPos?.r]);
    return (
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ imageRendering: 'pixelated' }}
      />
    );
  },
  (prev, next) =>
    prev.data.exploredRevision === next.data.exploredRevision &&
    prev.data.visibleKeys === next.data.visibleKeys &&
    prev.data.heroPos.q === next.data.heroPos.q &&
    prev.data.heroPos.r === next.data.heroPos.r &&
    prev.data.petPos?.q === next.data.petPos?.q &&
    prev.data.petPos?.r === next.data.petPos?.r,
);

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
  pet?: { name: string; hp: { current: number; max: number }; ep: { current: number; max: number }; xp?: { current: number; max: number }; level: number; icon?: string; portraitUrl?: string };
  abilities: Ability[];
  items: Item[];
  resources: Resource[];
  skillTokens: number;
  petTokens: number;
  subtitles?: string;
  onMenu?: () => void; onSettings?: () => void; onScoreboard?: () => void; onScan?: () => void; onStats?: () => void; onTalents?: () => void; onGlyph?: () => void; onShop?: () => void;
  onAbility?: (id: string) => void; onItem?: (id: string) => void; onMinimapClick?: (x: number, y: number) => void;
  minimapData?: MinimapData;
}

const pct = (v: number, m: number) => m > 0 ? Math.min(1, Math.max(0, v / m)) : 0;

const Bar = React.memo(function Bar({
  value, max, color, bg = 'bg-black/50', h = 'h-4', label,
}: { value: number; max: number; color: string; bg?: string; h?: string; label?: string }) {
  const p = pct(value, max) * 100;
  return (
    <div className={`relative w-full ${h} rounded-sm ${bg} overflow-hidden`}>
      <div className={`h-full ${color} transition-[width] duration-150`} style={{ width: `${p}%` }} />
      {label && (
        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-semibold text-white/85 tabular-nums leading-none drop-shadow pointer-events-none">
          {label}
        </span>
      )}
    </div>
  );
});

const CooldownOverlay = React.memo(function CooldownOverlay({ value, max }: { value?: number; max?: number }) {
  if (!value || !max || value <= 0) return null;
  const p = Math.min(1, value / max);
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="absolute inset-0 rounded-lg bg-black/55" />
      <div className="absolute inset-0" style={{
        background: `conic-gradient(rgba(0,0,0,0.7) ${p * 360}deg, transparent 0)`,
        mask: 'radial-gradient(circle at center, transparent 52%, black 53%)',
      }} />
      <div className="relative z-10 text-sm font-bold text-white drop-shadow">{Math.ceil(value)}s</div>
    </div>
  );
});

interface SlotProps { icon?: string; hotkey?: string; qty?: number; cooldown?: number; maxCooldown?: number; disabled?: boolean; onClick?: () => void; sizeCls?: string; }
const Slot = React.memo(function Slot({ icon = '', hotkey, qty, cooldown, maxCooldown, disabled, onClick, sizeCls = 'w-14 h-14' }: SlotProps) {
  return (
    <button
      aria-label={hotkey ? `Slot ${hotkey}` : 'Slot'}
      disabled={disabled}
      onClick={onClick}
      className={`relative ${sizeCls} rounded-lg overflow-hidden ring-1 ring-white/10 bg-gradient-to-b from-[#1c2535] to-[#0f1720] focus:outline-none ${
        disabled ? 'opacity-30 cursor-default' : 'hover:ring-white/35 hover:from-[#232f42] active:scale-[0.95] transition-all cursor-pointer'
      }`}
    >
      {icon && <div className="absolute inset-0 flex items-center justify-center text-2xl select-none">{icon}</div>}
      {hotkey && <div className="absolute top-0.5 left-1 text-[11px] text-white/50 font-semibold leading-none">{hotkey}</div>}
      {typeof qty === 'number' && qty > 0 && <div className="absolute bottom-0.5 right-1 text-xs font-bold text-white/90">{qty}</div>}
      <CooldownOverlay value={cooldown} max={maxCooldown} />
    </button>
  );
});

const StatPill = React.memo(function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-3 py-1.5 rounded-lg bg-white/5 ring-1 ring-white/10 text-sm flex items-center gap-2">
      <span className="opacity-55 text-xs uppercase tracking-wide">{label}</span>
      <span className="font-bold tabular-nums text-sm">{value}</span>
    </div>
  );
});

const AB_KEYS = ['Q', 'W', 'E', 'R'];
const IT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8'];

export const GameHUD: React.FC<GameHUDProps> = ({
  team, clock, score, hero, pet, abilities, items, resources, skillTokens,
  subtitles, onShop, onAbility, onItem, onMinimapClick, onMenu, onSettings,
  onScoreboard, onScan, onGlyph, minimapData,
}) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [abilityMode, setAbilityMode] = React.useState<'offense' | 'defense'>('offense');
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMenuOpen(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  let shardsValue: number | undefined;
  const filteredResources = resources.filter(r => {
    const id = (r.id || '').toLowerCase();
    const label = (r.label || '').toLowerCase();
    if (!label) return false;
    if (id === 'shards' || label === 'shards') { shardsValue = r.value; return false; }
    if (id.includes('skill') || id.includes('token') || label.includes('skill') || label.includes('token')) return false;
    return true;
  });

  const abilitySlots = abilities.slice(0, 4);
  const itemSlots = items.slice(0, 8);

  // ─── Panel background style shared across sections ─────────────────────────
  const panelCls = 'bg-[#0c1219]/88 backdrop-blur-sm ring-1 ring-white/8';

  return (
    <div className="pointer-events-none text-white select-none font-sans">

      {/* ══════════════════ TOP BAR ══════════════════════════════════════════ */}
      <div className="fixed top-0 left-0 right-0 flex items-center justify-center pt-3 z-40 pointer-events-none">
        <div className={`flex items-center gap-5 ${panelCls} rounded-xl px-5 py-2.5 shadow-xl pointer-events-auto`}>
          <span className="font-semibold text-sm tracking-wide opacity-75">{team}</span>

          {/* Scoreline */}
          <div className="flex items-center gap-3">
            <span className="font-extrabold text-emerald-300 text-lg tabular-nums">{score.radiant}</span>
            <span className="text-white/30 text-xs">vs</span>
            <span className="font-extrabold text-rose-300 text-lg tabular-nums">{score.dire}</span>
          </div>

          {/* Clock */}
          <div className="font-mono font-bold text-base tracking-widest px-3 py-1 bg-black/30 rounded-lg tabular-nums">{clock}</div>

          {/* Tokens */}
          <div className="flex items-center gap-2">
            <StatPill label="Shards" value={typeof shardsValue === 'number' ? shardsValue : 0} />
            <StatPill label="Skill" value={skillTokens} />
          </div>

          {/* Menu trigger */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="ml-1 px-4 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-sm font-semibold transition pointer-events-auto"
          >≡ Menu</button>
        </div>
      </div>

      {/* Resources — top right */}
      {!!filteredResources.length && (
        <div className={`fixed top-4 right-4 ${panelCls} rounded-xl px-3 py-2 pointer-events-auto z-40`}>
          <div className="flex items-center gap-2 flex-wrap max-w-[500px] justify-end">
            {filteredResources.map(r => (
              <div key={r.id} className="px-2.5 py-1.5 rounded-lg bg-white/5 ring-1 ring-white/8 text-sm flex items-center gap-1.5">
                <span>{r.icon || '◈'}</span>
                <span className="opacity-55 text-xs">{r.label}</span>
                <span className="font-bold tabular-nums">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════ BOTTOM HUD BAR — full width, Dota 2 style ════════ */}
      {/*
        Layout (left → right):
          [MINIMAP]  [scan/glyph]  [HERO + ABILITIES — player]  │  [PET + INVENTORY — pet]
      */}
      <div className={`fixed bottom-0 left-0 right-0 z-30 ${panelCls} border-t border-white/5 shadow-2xl pointer-events-auto`}>
        <div className="flex items-stretch h-[14.25rem]"> {/* portraits 117px + abilities/inventory rows */}

          {/* ── MINIMAP (replaces DatabaseTestPanel area — bottom-left) ─── */}
          <div
            className="w-[24rem] h-full shrink-0 cursor-crosshair relative overflow-hidden border-r border-white/5"
            style={{ background: 'radial-gradient(ellipse at center, #1a5c33 0%, #0e3a20 55%, #081f11 100%)' }}
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              onMinimapClick && onMinimapClick(
                (e.clientX - rect.left) / rect.width,
                (e.clientY - rect.top) / rect.height,
              );
            }}
          >
            {minimapData ? (
              <MinimapCanvas data={minimapData} />
            ) : (
              <>
                {/* Decorative grid fallback until map data is ready */}
                <div className="absolute inset-0 opacity-10" style={{
                  backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
                  backgroundSize: '28px 28px',
                }} />
                <div className="absolute top-2 right-2 text-[10px] font-bold opacity-40 tracking-widest">N</div>
                <div className="absolute bottom-2 left-2 text-[10px] text-white/40 font-semibold uppercase tracking-wider">Map</div>
              </>
            )}
          </div>

          {/* ── Action buttons ──────────────────────────────────────────── */}
          <div className="flex flex-col items-center justify-center gap-2 px-2 border-r border-white/5 shrink-0">
            <button
              onClick={() => setAbilityMode('offense')}
              className={`w-12 h-12 rounded-xl ring-2 flex items-center justify-center text-xl transition active:scale-90 ${
                abilityMode === 'offense'
                  ? 'bg-rose-900/70 ring-rose-500'
                  : 'bg-[#1c2838] ring-white/10 hover:ring-rose-500/50 opacity-50 hover:opacity-80'
              }`}
              title="Offensive abilities"
            >⚔️</button>
            <button
              onClick={() => setAbilityMode('defense')}
              className={`w-12 h-12 rounded-xl ring-2 flex items-center justify-center text-xl transition active:scale-90 ${
                abilityMode === 'defense'
                  ? 'bg-sky-900/70 ring-sky-400'
                  : 'bg-[#1c2838] ring-white/10 hover:ring-sky-400/50 opacity-50 hover:opacity-80'
              }`}
              title="Defensive abilities"
            >🛡️</button>
          </div>

          {/* ── HERO + ABILITIES (player section — flex-[1]) ─────────────── */}
          <div className="flex flex-col justify-center gap-1 px-2 flex-[1] min-w-0 border-r border-white/5 pt-2 pb-1">
            {/* Hero row: XP-ring portrait + hp/ep bars */}
            <div className="flex gap-2 items-center">
              {/* Portrait with XP progressive frame (conic-gradient ring) */}
              <div
                className="relative shrink-0"
                style={{
                  width: 117, height: 117,
                  background: `conic-gradient(#f59e0b ${pct(hero.xp.current, hero.xp.max) * 360}deg, rgba(255,255,255,0.10) 0deg)`,
                  borderRadius: 15,
                  padding: 4,
                }}
              >
                <div className="w-full h-full rounded-[12px] overflow-hidden bg-slate-900">
                  {hero.portraitUrl
                    ? <img src={hero.portraitUrl} alt={hero.name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-4xl">👤</div>
                  }
                </div>
                {/* XP label above portrait */}
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[10px] text-amber-400/70 whitespace-nowrap pointer-events-none tabular-nums">
                  XP {hero.xp.current}/{hero.xp.max}
                </div>
                {/* Level badge below portrait */}
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-amber-500 text-black text-[10px] font-bold px-1.5 py-px rounded-full z-20 whitespace-nowrap leading-none">
                  Lv {hero.level}
                </div>
              </div>
              {/* HP / EP bars + abilities stacked */}
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="font-bold text-sm truncate leading-none mb-0.5">{hero.name}</span>
                <Bar value={hero.hp.current} max={hero.hp.max} color="bg-rose-500" h="h-[17px]" label={`${hero.hp.current}/${hero.hp.max} HP`} />
                <Bar value={hero.ep.current} max={hero.ep.max} color="bg-sky-400" h="h-[17px]" label={`${hero.ep.current}/${hero.ep.max} EP`} />
                {/* Abilities — centered below bars */}
                <div className={`flex justify-center gap-1.5 mt-0.5 p-1.5 rounded-lg ring-1 transition-all ${
                  abilityMode === 'offense' ? 'ring-rose-500/60' : 'ring-sky-400/60'
                }`}>
                  {Array.from({ length: 4 }, (_, i) => {
                    const a = abilitySlots[i];
                    return a
                      ? <Slot key={a.id} icon={a.icon || '✦'} hotkey={AB_KEYS[i]} cooldown={a.cooldown} maxCooldown={a.maxCooldown} disabled={a.disabled} onClick={() => onAbility && onAbility(a.id)} sizeCls="w-[57px] h-[57px]" />
                      : <Slot key={`ab-e-${i}`} hotkey={AB_KEYS[i]} disabled sizeCls="w-[57px] h-[57px]" />;
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ── PET + INVENTORY (pet section — flex-[1]) ──────────────────── */}
          <div className="flex flex-col justify-center gap-1 px-2 flex-[1] min-w-0 pt-2 pb-1">
            {/* Pet row — same layout as hero */}
            {pet && (
              <div className="flex gap-2 items-center">
                {/* Pet portrait with XP ring */}
                <div
                  className="relative shrink-0"
                  style={{
                    width: 117, height: 117,
                    background: `conic-gradient(#f59e0b ${pct(pet.xp?.current ?? 0, pet.xp?.max ?? 100) * 360}deg, rgba(255,255,255,0.10) 0deg)`,
                    borderRadius: 15,
                    padding: 4,
                  }}
                >
                  <div className="w-full h-full rounded-[12px] overflow-hidden bg-slate-900">
                    {pet.portraitUrl
                      ? <img src={pet.portraitUrl} alt={pet.name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-4xl">{pet.icon || '🐾'}</div>
                    }
                  </div>
                  {/* XP label above portrait */}
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[10px] text-amber-400/70 whitespace-nowrap pointer-events-none tabular-nums">
                    XP {pet.xp?.current ?? 0}/{pet.xp?.max ?? 100}
                  </div>
                  {/* Level badge below portrait */}
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-emerald-500 text-black text-[10px] font-bold px-1.5 py-px rounded-full z-20 whitespace-nowrap leading-none">
                    Lv {pet.level}
                  </div>
                </div>
                {/* Pet HP / EP bars + inventory */}
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="font-bold text-sm truncate leading-none mb-0.5">{pet.name}</span>
                  <Bar value={pet.hp.current} max={pet.hp.max} color="bg-lime-400" h="h-[17px]" label={`${pet.hp.current}/${pet.hp.max} HP`} />
                  <Bar value={pet.ep.current} max={pet.ep.max} color="bg-cyan-400" h="h-[17px]" label={`${pet.ep.current}/${pet.ep.max} EP`} />
                  {/* Inventory — centered below bars */}
                  <div className="flex flex-row justify-center gap-1.5 mt-0.5 flex-wrap">
                    {Array.from({ length: 8 }, (_, i) => {
                      const it = itemSlots[i];
                      return it
                        ? <Slot key={it.id} icon={it.icon || '📦'} hotkey={IT_KEYS[i]} qty={it.qty} cooldown={it.cooldown} maxCooldown={it.maxCooldown} onClick={() => onItem && onItem(it.id)} sizeCls="w-[57px] h-[57px]" />
                        : <Slot key={`it-e-${i}`} hotkey={IT_KEYS[i]} disabled sizeCls="w-[57px] h-[57px]" />;
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>{/* end flex row */}
      </div>

      {/* ══════════════════ IN-GAME MENU ══════════════════════════════════════ */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 pointer-events-auto flex">
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
          <div className={`relative mt-16 ml-4 w-72 ${panelCls} rounded-xl p-5 flex flex-col gap-2 shadow-2xl`}>
            <div className="text-base font-bold tracking-wide mb-1">Game Menu</div>
            <div className="flex flex-col gap-2 text-sm">
              <button onClick={() => { onSettings && onSettings(); setMenuOpen(false); }} className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-left transition">Settings</button>
              <button onClick={() => { onScoreboard && onScoreboard(); setMenuOpen(false); }} className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-left transition">Scoreboard</button>
              <button onClick={() => { onShop && onShop(); setMenuOpen(false); }} className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-left transition">Store</button>
              <div className="h-px bg-white/10 my-1" />
              <button onClick={() => setMenuOpen(false)} className="px-4 py-2.5 rounded-lg bg-emerald-600/60 hover:bg-emerald-600/80 text-left font-semibold transition">Back to Game</button>
              <button onClick={() => { onMenu && onMenu(); setMenuOpen(false); }} className="px-4 py-2.5 rounded-lg bg-rose-600/60 hover:bg-rose-600/80 text-left font-semibold transition">Back to Menu</button>
            </div>
            <div className="mt-2 text-xs opacity-45">Press Esc or Back to Game to close.</div>
          </div>
        </div>
      )}

      {subtitles && (
        <div className={`fixed right-6 bottom-[15rem] max-w-sm ${panelCls} rounded-xl px-4 py-3 text-sm shadow-xl`}>
          {subtitles}
        </div>
      )}
    </div>
  );
};

export default GameHUD;
