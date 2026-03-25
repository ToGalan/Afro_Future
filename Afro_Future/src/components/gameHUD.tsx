// Renamed from AfroHud.tsx to gameHUD.tsx — Dota 2-style layout, 2x scale
import React, { useEffect } from 'react';
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

    const draw = React.useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const cw = canvas.offsetWidth || 200;
      const ch = canvas.offsetHeight || 200;
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
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
    }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

    // Redraw when data changes
    React.useEffect(() => { draw(); },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [data.exploredRevision, data.visibleKeys, data.heroPos.q, data.heroPos.r, data.petPos?.q, data.petPos?.r]);

    // Also redraw when container resizes (e.g. window resize changes 20vw width)
    React.useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ro = new ResizeObserver(() => draw());
      ro.observe(canvas);
      return () => ro.disconnect();
    }, [draw]);

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
  defensiveAbilities?: Ability[];
  items: Item[];
  resources: Resource[];
  skillTokens: number;
  petTokens: number;
  subtitles?: string;
  onMenu?: () => void; onSettings?: () => void; onScoreboard?: () => void; onScan?: () => void; onStats?: () => void; onTalents?: () => void; onGlyph?: () => void; onShop?: () => void;
  onAbility?: (id: string) => void; onItem?: (id: string) => void; onMinimapClick?: (x: number, y: number) => void;
  minimapData?: MinimapData;
  // Extended menu data
  skillPoints?: number;
  totalPlayTime?: number;
  heroInventory?: Array<{ id: string; type: string; quantity: number; value?: number }>;
  petInventory?: Array<{ id: string; type: string; quantity: number; value?: number }>;
  playerProfile?: { uid: string; displayName?: string; email?: string; faction?: string };
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

interface SlotProps { icon?: string; hotkey?: string; qty?: number; cooldown?: number; maxCooldown?: number; disabled?: boolean; onClick?: () => void; sizeCls?: string; tooltip?: string; }
const Slot = React.memo(function Slot({ icon = '', hotkey, qty, cooldown, maxCooldown, disabled, onClick, sizeCls = 'hud-slot', tooltip }: SlotProps) {
  const [showTooltip, setShowTooltip] = React.useState(false);
  const iconSize = 'text-xl sm:text-2xl';
  return (
    <div className="relative">
      <button
        aria-label={hotkey ? `Slot ${hotkey}` : 'Slot'}
        disabled={disabled}
        onClick={onClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`relative ${sizeCls} rounded-lg overflow-hidden ring-1 ring-white/10 bg-gradient-to-b from-[#1c2535] to-[#0f1720] focus:outline-none ${
          disabled ? 'opacity-30 cursor-default' : 'hover:ring-white/35 hover:from-[#232f42] active:scale-[0.95] transition-all cursor-pointer'
        }`}
      >
        {icon && <div className={`absolute inset-0 flex items-center justify-center ${iconSize} select-none`}>{icon}</div>}
        {hotkey && <div className="absolute top-0.5 left-1 text-[9px] sm:text-[11px] text-white/50 font-semibold leading-none">{hotkey}</div>}
        {typeof qty === 'number' && qty > 0 && <div className="absolute bottom-0.5 right-1 text-[10px] sm:text-xs font-bold text-white/90">{qty}</div>}
        <CooldownOverlay value={cooldown} max={maxCooldown} />
      </button>
      {tooltip && showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 rounded-lg bg-black/90 text-white text-xs whitespace-nowrap pointer-events-none z-50 ring-1 ring-white/20">
          {tooltip}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-black/90" />
        </div>
      )}
    </div>
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

// Consolidated icon mapping for all inventory displays
const ITEM_ICONS: Record<string, string> = {
  'flower': '🌸',
  'herb': '🍃',
  'potion': '🧪',
  'consumable': '📦'
};

const ITEM_TOOLTIPS: Record<string, string> = {
  '🌸': 'Flower - Heal 20 HP',
  '🍃': 'Mushroom - Restore 5 EP',
  '🧪': 'Potion - Restore 50 HP',
  '📦': 'Consumable Item'
};

export const GameHUD: React.FC<GameHUDProps> = ({
  team, clock, score, hero, pet, abilities, defensiveAbilities, items, resources, skillTokens,
  subtitles, onShop, onAbility, onItem, onMinimapClick, onMenu, onSettings, onTalents,
  onScoreboard, onScan, onGlyph, minimapData,
  skillPoints, totalPlayTime, heroInventory, petInventory, playerProfile,
}) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [menuTab, setMenuTab] = React.useState<'overview' | 'skills' | 'pet' | 'inventory' | 'settings'>('overview');
  const [abilityMode, setAbilityMode] = React.useState<'offense' | 'defense'>('offense');
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMenuOpen(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Level-up flash: briefly highlight badge when level increases ──────────
  const heroLevelRef = React.useRef(hero.level);
  const [heroLvlFlash, setHeroLvlFlash] = React.useState(false);
  React.useEffect(() => {
    if (hero.level > heroLevelRef.current) {
      setHeroLvlFlash(true);
      const t = setTimeout(() => setHeroLvlFlash(false), 1600);
      heroLevelRef.current = hero.level;
      return () => clearTimeout(t);
    }
    heroLevelRef.current = hero.level;
  }, [hero.level]);

  const petLevelRef = React.useRef(pet?.level ?? 1);
  const [petLvlFlash, setPetLvlFlash] = React.useState(false);
  React.useEffect(() => {
    if (pet && pet.level > petLevelRef.current) {
      setPetLvlFlash(true);
      const t = setTimeout(() => setPetLvlFlash(false), 1600);
      petLevelRef.current = pet.level;
      return () => clearTimeout(t);
    }
    petLevelRef.current = pet?.level ?? 1;
  }, [pet?.level]);

  let shardsValue: number | undefined;
  const filteredResources = resources.filter(r => {
    const id = (r.id || '').toLowerCase();
    const label = (r.label || '').toLowerCase();
    if (!label) return false;
    if (id === 'shards' || label === 'shards') { shardsValue = r.value; return false; }
    if (id.includes('skill') || id.includes('token') || label.includes('skill') || label.includes('token')) return false;
    return true;
  });

  const offensiveSlots = abilities.slice(0, 4);
  const defensiveSlots = (defensiveAbilities || []).slice(0, 4);
  const abilitySlots = abilityMode === 'defense' ? defensiveSlots : offensiveSlots;
  const itemSlots = items.slice(0, 8);

  // ─── Panel background style shared across sections ─────────────────────────
  const panelCls = 'bg-[#0c1219]/88 backdrop-blur-sm ring-1 ring-white/8';

  return (
    <div className="pointer-events-none text-white select-none font-sans">

      {/* ══════════════════ TOP BAR ══════════════════════════════════════════ */}
      <div className="fixed top-0 left-0 right-0 flex items-center justify-center pt-2 sm:pt-3 z-40 pointer-events-none">
        <div className={`flex items-center gap-2 sm:gap-5 ${panelCls} rounded-xl px-2 sm:px-5 py-1.5 sm:py-2.5 shadow-xl pointer-events-auto max-w-[calc(100vw-1rem)] overflow-x-auto`}>
          <span className="font-semibold text-xs sm:text-sm tracking-wide opacity-75 shrink-0">{team}</span>

          {/* Scoreline */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <span className="font-extrabold text-emerald-300 text-sm sm:text-lg tabular-nums">{score.radiant}</span>
            <span className="text-white/30 text-xs">vs</span>
            <span className="font-extrabold text-rose-300 text-sm sm:text-lg tabular-nums">{score.dire}</span>
          </div>

          {/* Clock */}
          <div className="font-mono font-bold text-sm sm:text-base tracking-widest px-2 sm:px-3 py-0.5 sm:py-1 bg-black/30 rounded-lg tabular-nums shrink-0">{clock}</div>

          {/* Tokens */}
          <div className="hidden sm:flex items-center gap-2">
            <StatPill label="Shards" value={typeof shardsValue === 'number' ? shardsValue : 0} />
            <StatPill label="Skill" value={skillTokens} />
          </div>

          {/* Menu trigger */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="ml-1 px-2 sm:px-4 py-1 sm:py-1.5 rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-xs sm:text-sm font-semibold transition pointer-events-auto shrink-0"
          >≡ Menu</button>
        </div>
      </div>

      {/* Resources — top right, offset below the top bar so they don't overlap */}
      {!!filteredResources.length && (
        <div className={`fixed top-12 sm:top-14 right-4 ${panelCls} rounded-xl px-3 py-2 pointer-events-auto z-40`}>
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
        <div className="hud-bar flex items-stretch overflow-visible"> {/* portraits + abilities/inventory rows — extra height gives room for XP labels above portraits */}

          {/* ── MINIMAP (replaces DatabaseTestPanel area — bottom-left) ─── */}
          <div
            className="w-1/5 h-full shrink-0 cursor-crosshair relative overflow-hidden border-r border-white/5"
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
          <div className="flex flex-col items-center justify-center gap-1 px-1 border-r border-white/5 shrink-0">
            <button
              onClick={() => setAbilityMode('offense')}
              className={`hud-action-btn rounded-lg ring-2 flex items-center justify-center transition active:scale-90 text-base sm:text-xl ${
                abilityMode === 'offense'
                  ? 'bg-rose-900/70 ring-rose-500'
                  : 'bg-[#1c2838] ring-white/10 hover:ring-rose-500/50 opacity-50 hover:opacity-80'
              }`}
              title="Offensive abilities"
            >⚔️</button>
            <button
              onClick={() => setAbilityMode('defense')}
              className={`hud-action-btn rounded-lg ring-2 flex items-center justify-center transition active:scale-90 text-base sm:text-xl ${
                abilityMode === 'defense'
                  ? 'bg-sky-900/70 ring-sky-400'
                  : 'bg-[#1c2838] ring-white/10 hover:ring-sky-400/50 opacity-50 hover:opacity-80'
              }`}
              title="Defensive abilities"
            >🛡️</button>
          </div>

          {/* ── HERO + ABILITIES (player section — flex-[1]) ───────────── */}
          <div className="flex flex-col justify-center px-2 flex-[1] min-w-0 border-r border-white/5 h-full">
            {/* Hero row: XP-ring portrait + hp/ep bars */}
            <div className="flex gap-2 items-center h-full pt-5 pb-2">
              {/* Portrait with XP progressive frame (conic-gradient ring) */}
              <div
                className="hud-portrait relative rounded-xl p-[3px]"
                style={{
                  background: `conic-gradient(#f59e0b ${pct(hero.xp.current, hero.xp.max) * 360}deg, rgba(255,255,255,0.10) 0deg)`,
                }}
              >
                <div className="w-full h-full rounded-[10px] overflow-hidden bg-slate-900">
                  {hero.portraitUrl
                    ? <img src={hero.portraitUrl} alt={hero.name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-2xl sm:text-4xl">👤</div>
                  }
                </div>
                {/* XP label above portrait */}
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[9px] text-amber-400/70 whitespace-nowrap pointer-events-none tabular-nums hidden sm:block">
                  XP {hero.xp.current}/{hero.xp.max}
                </div>
                {/* Level badge — flashes white on level-up */}
                <div className={`absolute -bottom-2 left-1/2 -translate-x-1/2 text-[9px] font-bold px-1.5 py-px rounded-full z-20 whitespace-nowrap leading-none hidden sm:block transition-all duration-300 ${
                  heroLvlFlash
                    ? 'bg-white text-amber-600 scale-125 ring-2 ring-amber-400'
                    : 'bg-amber-500 text-black'
                }`}>
                  Lv {hero.level}
                </div>
              </div>
              {/* HP / EP bars + abilities stacked */}
              <div className="flex-1 min-w-0 flex flex-col gap-0.5 h-full justify-center">
                <span className="hud-name font-bold truncate leading-none mb-0.5">{hero.name}</span>
                <Bar value={hero.hp.current} max={hero.hp.max} color="bg-rose-500" h="hud-bar-row" label={`${hero.hp.current}/${hero.hp.max} HP`} />
                <Bar value={hero.ep.current} max={hero.ep.max} color="bg-sky-400" h="hud-bar-row" label={`${hero.ep.current}/${hero.ep.max} EP`} />
                {/* Abilities — centered below bars */}
                <div className={`flex justify-center gap-1 mt-0.5 p-1 rounded-lg ring-1 transition-all ${
                  abilityMode === 'offense' ? 'ring-rose-500/60' : 'ring-sky-400/60'
                }`}>
                  {Array.from({ length: 4 }, (_, i) => {
                    const a = abilitySlots[i];
                    return a
                      ? <Slot key={a.id} icon={a.icon || '✦'} hotkey={AB_KEYS[i]} cooldown={a.cooldown} maxCooldown={a.maxCooldown} disabled={a.disabled} onClick={() => onAbility && onAbility(a.id)} />
                      : <Slot key={`ab-e-${i}`} hotkey={AB_KEYS[i]} disabled />;
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ── PET + INVENTORY (pet section — flex-[1]) ──────────────────── */}
          <div className="flex flex-col justify-center px-1.5 sm:px-2 flex-[1] min-w-0 h-full">
            {/* Pet row — same layout as hero */}
            {pet && (
              <div className="flex gap-2 items-center min-w-0 h-full pt-5 pb-2">
                {/* Pet portrait with XP ring */}
                <div
                  className="hud-portrait relative rounded-xl p-[3px]"
                  style={{
                    background: `conic-gradient(#f59e0b ${pct(pet.xp?.current ?? 0, pet.xp?.max ?? 100) * 360}deg, rgba(255,255,255,0.10) 0deg)`,
                  }}
                >
                  <div className="w-full h-full rounded-[10px] overflow-hidden bg-slate-900">
                    {pet.portraitUrl
                      ? <img src={pet.portraitUrl} alt={pet.name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-2xl sm:text-4xl">{pet.icon || '🐾'}</div>
                    }
                  </div>
                  {/* XP label above portrait */}
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[9px] text-amber-400/70 whitespace-nowrap pointer-events-none tabular-nums hidden sm:block">
                    XP {pet.xp?.current ?? 0}/{pet.xp?.max ?? 100}
                  </div>
                  {/* Level badge — flashes white on level-up */}
                  <div className={`absolute -bottom-2 left-1/2 -translate-x-1/2 text-[9px] font-bold px-1.5 py-px rounded-full z-20 whitespace-nowrap leading-none hidden sm:block transition-all duration-300 ${
                    petLvlFlash
                      ? 'bg-white text-emerald-600 scale-125 ring-2 ring-emerald-400'
                      : 'bg-emerald-500 text-black'
                  }`}>
                    Lv {pet.level}
                  </div>
                </div>
                {/* Pet HP / EP bars + inventory */}
                <div className="flex-1 min-w-0 flex flex-col gap-0.5 overflow-hidden h-full justify-center">
                  <span className="hud-name font-bold truncate leading-none mb-0.5">{pet.name}</span>
                  <Bar value={pet.hp.current} max={pet.hp.max} color="bg-lime-400" h="hud-bar-row" label={`${pet.hp.current}/${pet.hp.max} HP`} />
                  <Bar value={pet.ep.current} max={pet.ep.max} color="bg-cyan-400" h="hud-bar-row" label={`${pet.ep.current}/${pet.ep.max} EP`} />
                  {/* Inventory — centered below bars */}
                  <div className="flex flex-row flex-nowrap justify-center items-center gap-0.5 sm:gap-1 mt-0.5">
                    {Array.from({ length: 8 }, (_, i) => {
                      const it = itemSlots[i];
                      return it && it.icon
                        ? <Slot key={it.id} icon={it.icon} hotkey={IT_KEYS[i]} qty={it.qty} tooltip={ITEM_TOOLTIPS[it.icon] || ''} cooldown={it.cooldown} maxCooldown={it.maxCooldown} onClick={() => onItem && onItem(it.id)} />
                        : <div
                            key={`it-e-${i}`}
                            className="hud-slot relative rounded-lg ring-1 ring-white/10 bg-gradient-to-b from-[#1c2535] to-[#0f1720]"
                          >
                            <span className="absolute top-0.5 left-1 text-[9px] text-white/40 font-semibold leading-none">{IT_KEYS[i]}</span>
                          </div>;
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
        <div className="fixed inset-0 z-50 pointer-events-auto flex items-center justify-center p-2 sm:p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={() => setMenuOpen(false)} />
          
          {/* Modal */}
          <div className={`relative w-full max-w-4xl h-[85vh] sm:h-[80vh] ${panelCls} rounded-xl sm:rounded-2xl shadow-2xl border border-white/10 flex flex-col overflow-hidden`}>
            {/* Header */}
            <div className="flex items-center justify-between px-3 sm:px-6 py-2 sm:py-4 border-b border-white/10 bg-gradient-to-r from-emerald-900/20 to-sky-900/20">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-emerald-500/30 to-sky-500/30 border border-white/10 flex items-center justify-center">
                  <span className="text-lg sm:text-xl">⚙️</span>
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold tracking-wide">Game Menu</h2>
                  <p className="hidden sm:block text-xs opacity-60">Manage your character and settings</p>
                </div>
              </div>
              <button 
                onClick={() => setMenuOpen(false)} 
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition flex-shrink-0"
                title="Close (ESC)"
              >
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 sm:gap-2 px-2 sm:px-6 pt-2 sm:pt-4 border-b border-white/10 overflow-x-auto scrollbar-hide">
              {(['overview', 'skills', 'pet', 'inventory', 'settings'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setMenuTab(tab)}
                  className={`px-2 sm:px-4 py-1.5 sm:py-2 rounded-t-lg font-medium text-xs sm:text-sm transition whitespace-nowrap flex-shrink-0 ${
                    menuTab === tab 
                      ? 'bg-emerald-600/20 text-emerald-300 border-b-2 border-emerald-400' 
                      : 'bg-white/5 hover:bg-white/10 text-white/70'
                  }`}
                >
                  {tab === 'overview' && <span className="sm:hidden">📊</span>}
                  {tab === 'skills' && <span className="sm:hidden">⚡</span>}
                  {tab === 'pet' && <span className="sm:hidden">🐾</span>}
                  {tab === 'inventory' && <span className="sm:hidden">🎒</span>}
                  {tab === 'settings' && <span className="sm:hidden">⚙️</span>}
                  <span className="hidden sm:inline">{tab === 'overview' && '📊 Overview'}</span>
                  <span className="hidden sm:inline">{tab === 'skills' && '⚡ Skills'}</span>
                  <span className="hidden sm:inline">{tab === 'pet' && '🐾 Pet'}</span>
                  <span className="hidden sm:inline">{tab === 'inventory' && '🎒 Inventory'}</span>
                  <span className="hidden sm:inline">{tab === 'settings' && '⚙️ Settings'}</span>
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-4">
              {/* Overview Tab */}
              {menuTab === 'overview' && (
                <div className="space-y-4">
                  {/* Hero Stats */}
                  <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                    <div className="flex items-center gap-4 mb-4">
                      {hero.portraitUrl && (
                        <img src={hero.portraitUrl} alt={hero.name} className="w-16 h-16 rounded-lg border-2 border-emerald-500/50" />
                      )}
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-emerald-300">{hero.name}</h3>
                        <div className="text-sm opacity-70">Level {hero.level} • {team}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3 text-sm">
                      <div className="bg-black/30 rounded-lg p-2 sm:p-3">
                        <div className="text-xs opacity-60 mb-1">Health</div>
                        <div className="font-bold text-rose-300">{hero.hp.current}/{hero.hp.max}</div>
                      </div>
                      <div className="bg-black/30 rounded-lg p-2 sm:p-3">
                        <div className="text-xs opacity-60 mb-1">Energy</div>
                        <div className="font-bold text-sky-300">{hero.ep.current}/{hero.ep.max}</div>
                      </div>
                      <div className="bg-black/30 rounded-lg p-2 sm:p-3">
                        <div className="text-xs opacity-60 mb-1">XP Progress</div>
                        <div className="font-bold text-amber-300">{hero.xp.current}/{hero.xp.max}</div>
                      </div>
                    </div>
                    {hero.buffs && hero.buffs.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {hero.buffs.map((buff, i) => (
                          <span key={i} className="px-2 py-1 bg-emerald-500/20 text-emerald-300 text-xs rounded-full border border-emerald-500/30">
                            {buff}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Pet Stats */}
                  {pet && (
                    <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-3xl">{pet.icon || '🐾'}</span>
                        <div>
                          <h3 className="font-bold text-sky-300">{pet.name}</h3>
                          <div className="text-xs opacity-70">Level {pet.level}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 text-sm">
                        <div className="bg-black/30 rounded-lg p-2">
                          <div className="text-xs opacity-60">HP</div>
                          <div className="font-bold text-rose-300">{pet.hp.current}/{pet.hp.max}</div>
                        </div>
                        <div className="bg-black/30 rounded-lg p-2">
                          <div className="text-xs opacity-60">EP</div>
                          <div className="font-bold text-sky-300">{pet.ep.current}/{pet.ep.max}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Progress & Resources */}
                  <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                    <h3 className="font-bold mb-3">Resources</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 text-sm">
                      <div className="bg-black/30 rounded-lg p-2 sm:p-3">
                        <div className="text-xs opacity-60 mb-1">Skill Points</div>
                        <div className="font-bold text-amber-300">{skillPoints || skillTokens || 0}</div>
                      </div>
                      <div className="bg-black/30 rounded-lg p-2 sm:p-3">
                        <div className="text-xs opacity-60 mb-1">Playtime</div>
                        <div className="font-bold text-emerald-300">{clock}</div>
                      </div>
                      {resources.slice(0, 4).map((r, i) => (
                        <div key={i} className="bg-black/30 rounded-lg p-2 sm:p-3">
                          <div className="text-xs opacity-60 mb-1">{r.icon} {r.label}</div>
                          <div className="font-bold">{r.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Skills Tab */}
              {menuTab === 'skills' && (
                <div className="space-y-4">
                  <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                    <h3 className="font-bold mb-3">📚 Skills & Abilities</h3>
                    <div className="text-sm opacity-70 mb-4">
                      Available Skill Points: <span className="text-amber-300 font-bold">{skillPoints || skillTokens || 0}</span>
                    </div>
                    
                    {/* Offensive Abilities */}
                    <div className="mb-4">
                      <div className="text-xs font-semibold opacity-60 mb-2">⚔️ OFFENSIVE (Q/W/E/R)</div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        {abilities.slice(0, 4).map((ab, i) => (
                          <div key={i} className="bg-black/30 rounded-lg p-2 sm:p-3 text-center">
                            <div className="text-xl sm:text-2xl mb-1">{ab.icon}</div>
                            <div className="text-xs font-bold text-rose-300">{ab.key?.toUpperCase()}</div>
                            {ab.cooldown !== undefined && ab.cooldown > 0 && (
                              <div className="text-xs text-amber-300 mt-1">{Math.ceil(ab.cooldown)}s</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Defensive Abilities */}
                    {defensiveAbilities && defensiveAbilities.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold opacity-60 mb-2">🛡️ DEFENSIVE (Z/X/C/V)</div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                          {defensiveAbilities.slice(0, 4).map((ab, i) => (
                            <div key={i} className="bg-black/30 rounded-lg p-2 sm:p-3 text-center">
                              <div className="text-xl sm:text-2xl mb-1">{ab.icon}</div>
                              <div className="text-xs font-bold text-sky-300">{ab.key?.toUpperCase()}</div>
                              {ab.cooldown !== undefined && ab.cooldown > 0 && (
                                <div className="text-xs text-amber-300 mt-1">{Math.ceil(ab.cooldown)}s</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <button 
                      onClick={() => { 
                        setMenuOpen(false); 
                        if (onTalents) onTalents();
                      }}
                      className="mt-4 w-full px-4 py-2 bg-emerald-600/60 hover:bg-emerald-600/80 rounded-lg font-semibold transition"
                    >
                      Open Skill Tree
                    </button>
                  </div>
                </div>
              )}

              {/* Pet Tab */}
              {menuTab === 'pet' && pet && (
                <div className="space-y-4">
                  <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                    <div className="flex items-center gap-4 mb-4">
                      {pet.portraitUrl && (
                        <img src={pet.portraitUrl} alt={pet.name} className="w-20 h-20 rounded-lg border-2 border-sky-500/50" />
                      )}
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-sky-300">{pet.name}</h3>
                        <div className="text-sm opacity-70">Level {pet.level} Companion</div>
                      </div>
                    </div>

                    {/* Pet Stats */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 mb-4">
                      <div className="bg-black/30 rounded-lg p-2 sm:p-3">
                        <div className="text-xs opacity-60 mb-1">Health</div>
                        <div className="font-bold text-rose-300">{pet.hp.current}/{pet.hp.max}</div>
                        <div className="w-full bg-black/50 rounded-full h-1.5 mt-2">
                          <div className="bg-rose-500 h-1.5 rounded-full" style={{ width: `${(pet.hp.current / pet.hp.max) * 100}%` }} />
                        </div>
                      </div>
                      <div className="bg-black/30 rounded-lg p-2 sm:p-3">
                        <div className="text-xs opacity-60 mb-1">Energy</div>
                        <div className="font-bold text-sky-300">{pet.ep.current}/{pet.ep.max}</div>
                        <div className="w-full bg-black/50 rounded-full h-1.5 mt-2">
                          <div className="bg-sky-500 h-1.5 rounded-full" style={{ width: `${(pet.ep.current / pet.ep.max) * 100}%` }} />
                        </div>
                      </div>
                    </div>

                    {/* Pet XP */}
                    {pet.xp && (
                      <div className="bg-black/30 rounded-lg p-3 mb-4">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="opacity-60">Experience</span>
                          <span className="font-bold text-amber-300">{pet.xp.current}/{pet.xp.max}</span>
                        </div>
                        <div className="w-full bg-black/50 rounded-full h-2">
                          <div className="bg-amber-500 h-2 rounded-full" style={{ width: `${(pet.xp.current / pet.xp.max) * 100}%` }} />
                        </div>
                      </div>
                    )}

                    {/* Pet Inventory */}
                    {petInventory && petInventory.length > 0 && (
                      <div className="mt-4">
                        <h4 className="text-sm font-bold mb-2 opacity-70">Pet Inventory</h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                          {petInventory.map((item, i) => {
                            const displayIcon = (item as any).icon || ITEM_ICONS[item.type] || '🐾';
                            return (
                              <div key={i} className="bg-black/30 rounded-lg p-2 sm:p-3 text-center">
                                <div className="text-2xl mb-1">{displayIcon}</div>
                                <div className="text-xs font-semibold capitalize mb-1">{item.type}</div>
                                <div className="font-bold text-emerald-300">×{item.quantity}</div>
                                {item.value && <div className="text-xs opacity-60">+{item.value} {item.type === 'herb' ? 'EP' : 'HP'}</div>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Inventory Tab */}
              {menuTab === 'inventory' && (
                <div className="space-y-4">
                  <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                    <h3 className="font-bold mb-3">🎒 Your Inventory</h3>
                    
                    {/* Equipped Items */}
                    <div className="mb-4">
                      <div className="text-xs font-semibold opacity-60 mb-2">EQUIPPED ITEMS (1-8)</div>
                      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                        {items.slice(0, 8).map((item, i) => (
                          <div 
                            key={i} 
                            className={`aspect-square rounded-lg border-2 flex flex-col items-center justify-center cursor-pointer transition ${
                              item ? 'bg-black/40 border-amber-500/50 hover:border-amber-500' : 'bg-black/20 border-white/10'
                            }`}
                          >
                            {item ? (
                              <>
                                <div className="text-xl mb-1">{item.icon}</div>
                                {item.qty && <div className="text-xs font-bold">{item.qty}</div>}
                              </>
                            ) : (
                              <div className="text-white/20 text-xs">{i + 1}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Hero Inventory */}
                    {heroInventory && heroInventory.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold opacity-60 mb-2">STORED ITEMS</div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                          {heroInventory.map((item, i) => {
                            const displayIcon = (item as any).icon || ITEM_ICONS[item.type] || '🎒';
                            return (
                              <div key={i} className="bg-black/30 rounded-lg p-2 sm:p-3 text-center">
                                <div className="text-2xl mb-1">{displayIcon}</div>
                                <div className="text-xs font-semibold capitalize mb-1">{item.type}</div>
                                <div className="font-bold text-emerald-300">×{item.quantity}</div>
                                {item.value && <div className="text-xs opacity-60">+{item.value} {item.type === 'herb' ? 'EP' : 'HP'}</div>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {(!heroInventory || heroInventory.length === 0) && (
                      <div className="text-center py-8 opacity-40">
                        <div className="text-4xl mb-2">📦</div>
                        <div className="text-sm">No items in storage</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Settings Tab */}
              {menuTab === 'settings' && (
                <div className="space-y-4">
                  {/* Account Info */}
                  {playerProfile && (
                    <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                      <h3 className="font-bold mb-3">👤 Account</h3>
                      <div className="space-y-2 text-sm">
                        {playerProfile.displayName && (
                          <div className="flex justify-between py-2 border-b border-white/5">
                            <span className="opacity-60">Display Name</span>
                            <span className="font-semibold">{playerProfile.displayName}</span>
                          </div>
                        )}
                        {playerProfile.email && (
                          <div className="flex justify-between py-2 border-b border-white/5">
                            <span className="opacity-60">Email</span>
                            <span className="font-semibold">{playerProfile.email}</span>
                          </div>
                        )}
                        {playerProfile.faction && (
                          <div className="flex justify-between py-2 border-b border-white/5">
                            <span className="opacity-60">Faction</span>
                            <span className="font-semibold">{playerProfile.faction}</span>
                          </div>
                        )}
                        {totalPlayTime !== undefined && (
                          <div className="flex justify-between py-2">
                            <span className="opacity-60">Total Playtime</span>
                            <span className="font-semibold">
                              {Math.floor(totalPlayTime / 3600)}h {Math.floor((totalPlayTime % 3600) / 60)}m
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Game Settings */}
                  <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                    <h3 className="font-bold mb-3">⚙️ Game Settings</h3>
                    <div className="space-y-2">
                      <button 
                        onClick={() => { onSettings && onSettings(); setMenuOpen(false); }}
                        className="w-full px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-left transition"
                      >
                        Audio & Graphics
                      </button>
                      <button 
                        onClick={() => { onScoreboard && onScoreboard(); setMenuOpen(false); }}
                        className="w-full px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-left transition"
                      >
                        Scoreboard
                      </button>
                      <button 
                        onClick={() => { onShop && onShop(); setMenuOpen(false); }}
                        className="w-full px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-left transition"
                      >
                        Store
                      </button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                    <h3 className="font-bold mb-3 text-rose-300">🚪 Exit Options</h3>
                    <div className="space-y-2">
                      <button 
                        onClick={() => setMenuOpen(false)}
                        className="w-full px-4 py-2.5 rounded-lg bg-emerald-600/60 hover:bg-emerald-600/80 text-left font-semibold transition"
                      >
                        Resume Game
                      </button>
                      <button 
                        onClick={() => { onMenu && onMenu(); setMenuOpen(false); }}
                        className="w-full px-4 py-2.5 rounded-lg bg-rose-600/60 hover:bg-rose-600/80 text-left font-semibold transition"
                      >
                        Exit to Dashboard
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-white/10 bg-black/20">
              <div className="text-xs opacity-50">Press ESC to close</div>
              <div className="text-xs opacity-50">Session: {clock}</div>
            </div>
          </div>
        </div>
      )}

      {subtitles && (
        <div className={`fixed right-6 bottom-[9rem] sm:bottom-[12rem] md:bottom-[15rem] max-w-sm ${panelCls} rounded-xl px-4 py-3 text-sm shadow-xl`}>
          {subtitles}
        </div>
      )}
    </div>
  );
};

export default GameHUD;
