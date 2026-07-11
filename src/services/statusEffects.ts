/**
 * statusEffects — the hero's buff/debuff layer, driven by GDD skill effects.
 *
 * GDD skills cast SkillEffects (store/skillData). Self-targeted effects become timed
 * hero buffs collected here; the map applies their aggregate each frame/tick:
 *   - shield  → an absorb pool that soaks incoming damage before HP
 *   - regen   → heal-over-time
 *   - haste   → energy trickle (movement is per-keypress, so haste refuels casting)
 *   - atkBuff → flat bonus damage on ability strikes
 *   - defBuff → flat incoming-damage reduction
 *   - stealth → enemies stop detecting the hero for the duration
 * Enemy-targeted effects (burst/stun/pacify/slow) are dispatched straight to the enemy
 * hook and are NOT tracked here.
 */
import type { EffectKind } from '../store/skillData';

export interface ActiveEffect {
  kind: EffectKind;
  magnitude: number;
  expiresAt: number;   // performance.now() ms; Infinity for instant-consumed pools
  label: string;
  icon: string;
}

export interface EffectAggregate {
  shield: number;      // remaining absorb pool
  atkBonus: number;    // flat bonus added to ability strike power
  defBonus: number;    // flat incoming-damage reduction
  regenPerSec: number; // HP/sec from active regen buffs
  stealthed: boolean;  // enemies can't detect the hero
  active: ActiveEffect[]; // for HUD display (self-buffs only)
}

/** Drop expired effects (shield handled separately as a consumable pool). */
export function pruneEffects(list: ActiveEffect[], now: number): ActiveEffect[] {
  return list.filter(e => e.expiresAt > now);
}

/** Roll the active self-buffs up into the values the map applies. */
export function aggregateEffects(list: ActiveEffect[], shieldPool: number): EffectAggregate {
  let atkBonus = 0, defBonus = 0, regenPerSec = 0, stealthed = false;
  for (const e of list) {
    if (e.kind === 'atkBuff') atkBonus += e.magnitude;
    else if (e.kind === 'defBuff') defBonus += e.magnitude;
    else if (e.kind === 'regen') regenPerSec += e.magnitude / 6; // magnitude ≈ total over ~6s
    else if (e.kind === 'stealth') stealthed = true;
  }
  return { shield: Math.max(0, shieldPool), atkBonus, defBonus, regenPerSec, stealthed, active: list };
}

/** True for effects that live in this hero-buff layer (self-targeted, durational). */
export function isSelfBuff(kind: EffectKind): boolean {
  return kind === 'shield' || kind === 'regen' || kind === 'haste'
      || kind === 'atkBuff' || kind === 'defBuff' || kind === 'stealth';
}
