import React from 'react';
import { usePlayerProfile } from '../hooks/usePlayerProfile';
import { getPetLevelProgress } from '../services/petExpEconomy';
import {
  getPetSpecies,
  derivePetStats,
  petAbilitiesWithState,
  bondTierIndex,
  bondTierProgress,
  BOND_TIERS,
} from '../services/petSpecies';
import { PetIcon } from '../assets/assetPaths';

/** What the pet should auto-gather (petFetch in useCollectibles) — 'auto' (default)
 *  picks whatever's nearest of any kind; the others restrict to one resource type. */
export type PetFetchFocus = 'auto' | 'flower' | 'mushroom' | 'ore' | 'energy' | 'bio';
const FETCH_FOCUS_OPTIONS: Array<{ key: PetFetchFocus; icon: string; label: string }> = [
  { key: 'auto',     icon: '🎯', label: 'Auto (whatever\'s around)' },
  { key: 'ore',      icon: '⬢', label: 'Ore' },
  { key: 'energy',   icon: '⚡', label: 'Energy' },
  { key: 'bio',      icon: '🌿', label: 'Bio' },
  { key: 'flower',   icon: '🌸', label: 'Flowers' },
  { key: 'mushroom', icon: '🍄', label: 'Mushrooms' },
];

/**
 * Pet companion management panel (GDD "Pet Companion Feature").
 *
 * Surfaces the full companion state from the persisted profile + petSpecies:
 * species identity, level & XP, bonding tier, derived (species-differentiated) stats,
 * and the three bonding-gated abilities with lock state.
 */
export const PetPanel: React.FC<{ petType?: string; petName?: string }> = ({ petType, petName }) => {
  const { profile, saveProgress } = usePlayerProfile();
  // Minimized = header strip only (portrait + name + level). Persisted per browser.
  const [minimized, setMinimized] = React.useState<boolean>(() => {
    try { return localStorage.getItem('afrofuture.petCardMin') === '1'; } catch { return false; }
  });
  const toggleMinimized = () => setMinimized(m => {
    const next = !m;
    try { localStorage.setItem('afrofuture.petCardMin', next ? '1' : '0'); } catch {}
    return next;
  });
  const pet = profile?.progress?.pet;
  if (!pet) return null;

  // Species comes from the SELECTED loadout pet (what the HUD shows), not from
  // progress.pet — fresh profiles never store a type there, which made this card
  // always show the Cyber-Dog even for Cyber-Cat players. Level/XP/bond stay on
  // the persisted progress (the live values the HUD tracks). Normalize the type
  // since loadouts may store 'CAT'/'DOG' while petSpecies keys are CYBER_*.
  const rawType = petType ?? pet.type;
  const type = rawType && String(rawType).toUpperCase().includes('CAT') ? 'CYBER_CAT' : 'CYBER_DOG';
  const species = getPetSpecies(type);
  const level = pet.level ?? 1;
  const xp = pet.xp ?? 0;
  const bond = pet.bond ?? 0;
  const stats = derivePetStats(type, level);
  const xpPct = Math.round(getPetLevelProgress(xp, level) * 100);
  const tierIdx = bondTierIndex(bond);
  const bondPct = Math.round(bondTierProgress(bond) * 100);
  const abilities = petAbilitiesWithState(type, level, bond);
  const fetchFocus: PetFetchFocus = (pet.fetchFocus as PetFetchFocus) || 'auto';
  const setFetchFocus = (f: PetFetchFocus) => saveProgress({ pet: { fetchFocus: f } } as any);

  return (
    <div
      // top: 64 clears the full-width fixed top HUD bar (it previously overlapped it);
      // hidden below md — on phones the bottom HUD's pet section covers the essentials.
      className="hidden md:block"
      style={{
        position: 'absolute', top: 64, right: 8, width: 244,
        background: 'rgba(15,18,26,0.92)', color: '#fff',
        padding: 12, borderRadius: 12, fontFamily: 'sans-serif',
        border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}
    >
      {/* Header: portrait + identity + minimize toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: minimized ? 0 : 8 }}>
        <img
          src={PetIcon[species.type]}
          alt={species.name}
          style={{ width: minimized ? 30 : 44, height: minimized ? 30 : 44, objectFit: 'contain', borderRadius: 8, background: 'rgba(255,255,255,0.06)' }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1 }}>{petName || species.name}</div>
          {!minimized && <div style={{ fontSize: 11, opacity: 0.7 }}>{petName ? `${species.name} · ${species.tagline}` : species.tagline}</div>}
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 10, opacity: 0.6 }}>LVL</div>
          <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}>{level}</div>
        </div>
        <button
          onClick={toggleMinimized}
          title={minimized ? 'Expand pet card' : 'Minimize pet card'}
          aria-label={minimized ? 'Expand pet card' : 'Minimize pet card'}
          style={{
            width: 22, height: 22, borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.08)', color: '#fff', cursor: 'pointer',
            fontSize: 12, fontWeight: 700, lineHeight: 1, padding: 0, flexShrink: 0,
          }}
        >{minimized ? '+' : '–'}</button>
      </div>

      {minimized ? null : (<>
      {/* XP bar */}
      <Meter label={`XP ${xpPct}%`} pct={xpPct} color="#38bdf8" />

      {/* Bond bar */}
      <div style={{ marginTop: 6 }}>
        <Meter label={`Bond, ${BOND_TIERS[tierIdx].name}`} pct={bondPct} color="#f472b6" />
      </div>

      {/* Passive */}
      <div style={{ marginTop: 8, fontSize: 11, background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '6px 8px' }}>
        <span style={{ marginRight: 4 }}>{species.passive.icon}</span>
        <strong>{species.passive.name}</strong>
        <div style={{ opacity: 0.75, marginTop: 2 }}>{species.passive.description}</div>
      </div>

      {/* Derived stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 8, fontSize: 11 }}>
        <Stat label="HP" value={Math.round(stats.health)} />
        <Stat label="DEF" value={stats.defense.toFixed(1)} />
        <Stat label="SPD" value={stats.speed.toFixed(1)} />
        <Stat label="ATK" value={stats.attack.toFixed(1)} />
      </div>

      {/* Abilities */}
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 10, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>Abilities</div>
        {abilities.map(a => (
          <div
            key={a.id}
            title={a.unlocked ? a.description : `Unlocks at Lv ${a.reqLevel}, ${BOND_TIERS[a.reqBondTier].name} bond`}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
              padding: '3px 4px', borderRadius: 6, opacity: a.unlocked ? 1 : 0.4,
            }}
          >
            <span>{a.unlocked ? a.icon : '🔒'}</span>
            <span style={{ fontWeight: 600 }}>{a.name}</span>
            {!a.unlocked && (
              <span style={{ marginLeft: 'auto', fontSize: 9, opacity: 0.7 }}>
                Lv{a.reqLevel}·{BOND_TIERS[a.reqBondTier].name}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Auto-gather focus — what the pet should range out and fetch while exploring
          (default: whatever's nearest, of any kind). Cyber-Cat fetches often but one at
          a time (speed); Cyber-Dog fetches less often but grabs more per trip (quantity) —
          see petFetch/pet-fetch effects in SoloMissionMap3D. */}
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 10, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>Auto-Gather Focus</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
          {FETCH_FOCUS_OPTIONS.map(o => (
            <button
              key={o.key}
              onClick={() => setFetchFocus(o.key)}
              title={o.label}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                fontSize: 11, padding: '4px 2px', borderRadius: 6, cursor: 'pointer',
                border: fetchFocus === o.key ? '1px solid rgba(56,189,248,0.7)' : '1px solid rgba(255,255,255,0.1)',
                background: fetchFocus === o.key ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.05)',
                color: '#fff',
              }}
            >{o.icon}</button>
          ))}
        </div>
      </div>
      </>)}
    </div>
  );
};

const Meter: React.FC<{ label: string; pct: number; color: string }> = ({ label, pct, color }) => (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, opacity: 0.75, marginBottom: 2 }}>
      <span>{label}</span>
    </div>
    <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, background: color, transition: 'width 0.3s' }} />
    </div>
  </div>
);

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.05)', borderRadius: 6, padding: '3px 6px' }}>
    <span style={{ opacity: 0.65 }}>{label}</span>
    <span style={{ fontWeight: 700 }}>{value}</span>
  </div>
);

export default PetPanel;
