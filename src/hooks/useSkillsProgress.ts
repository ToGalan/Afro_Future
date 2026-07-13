/**
 * useSkillsProgress — Runtime ability-cooldown, hero vitals, and skill persistence.
 *
 * Standalone hook connected through player identity (uid, email, displayName, idToken).
 * Manages:
 *   - Hero HP/EP vitals with rAF regen loop
 *   - Runtime ability cooldown ticking (rAF — precise sub-second decrements)
 *   - Ability activation (consumes EP, starts cooldown)
 *   - Derived Ability[] arrays for the HUD (from abilityLoadout in skillStore)
 *   - Debounced skill persistence to Chrome Sync + server profile endpoint
 *
 * Used in: App.tsx → MissionScreen (runtime HUD state + server sync).
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useSkillStore } from '../store/skillStore';
import { skillIconFor } from '../store/skillData';
import { chromeSyncSet } from '../services/chromeSync';
import { computeEffectiveStats } from '../services/playerStats';
import { factionAbilityBonus } from '../services/factionAbilities';

// ── Icon helper — delegates to the GDD grid's category → icon map ─────────────
function skillIconFn(id: string): string { return skillIconFor(id); }

const BASE_COOLDOWN = 8; // seconds
// Offensive ability hotkeys. NOTE: 'w' is intentionally avoided — it drives WASD
// movement (move North), so a W-bound ability could never fire. Q/E/R/T is a
// contiguous top-row cluster that sits clear of the movement keys.
const AB_KEYS_OFF = ['q', 'e', 'r', 't'] as const;
const AB_KEYS_DEF = ['z', 'x', 'c', 'v'] as const;

// ── Types ────────────────────────────────────────────────────────────────────
export interface RuntimeAbilitySlot {
  id: string;
  icon: string;
  cooldown: number;
  maxCooldown: number;
  disabled: boolean;
  key: string;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useSkillsProgress({
  uid: _uid,
  email: _email,
  displayName: _displayName,
  idToken,
  faction,
  archetype,
  factionAbilities,
}: {
  uid: string;
  email?: string;
  displayName?: string;
  /** Google/Firebase ID token for server profile endpoint. */
  idToken: string | null;
  /** Faction & character archetype drive base stats. */
  faction?: string;
  archetype?: string;
  /** Unlocked faction-ability ids (grant passive stat bonuses). */
  factionAbilities?: string[];
}) {
  const skillState = useSkillStore();

  // ── Effective stats: faction/character base + level growth + skill modifiers ──
  const { level, attack, defense, utility, traitBonus } = skillState;
  const faKey = (factionAbilities || []).join(',');
  // Flat bonus = unlocked faction abilities + active skill TRAITS (both Partial<StatBlock>).
  const traitKey = JSON.stringify(traitBonus || {});
  const stats = useMemo(
    () => {
      const fa = factionAbilityBonus(factionAbilities);
      const tb = traitBonus || {};
      const bonus = {
        hp: (fa.hp || 0) + (tb.hp || 0), ep: (fa.ep || 0) + (tb.ep || 0),
        atk: (fa.atk || 0) + (tb.atk || 0), def: (fa.def || 0) + (tb.def || 0),
        spd: (fa.spd || 0) + (tb.spd || 0),
      };
      return computeEffectiveStats(faction, archetype, { level, attack, defense, utility }, bonus);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [faction, archetype, level, attack, defense, utility, faKey, traitKey],
  );
  const HP_MAX = stats.total.hp;   // faction base HP + level + skill defense
  const EP_MAX = stats.total.ep;   // faction base EP + level + skill utility
  const XP_MAX = 100 + (level - 1) * 40;
  const XP_CUR = Math.min(XP_MAX - 1, (level - 1) * 40 + 10);

  // ── Hero vitals state ─────────────────────────────────────────────────────
  const [heroVitals, setHeroVitals] = useState({ hp: HP_MAX, ep: EP_MAX });

  // Clamp when max changes (level-up / skill change)
  useEffect(() => {
    setHeroVitals(v => {
      const hp = Math.min(HP_MAX, v.hp);
      const ep = Math.min(EP_MAX, v.ep);
      return hp === v.hp && ep === v.ep ? v : { hp, ep };
    });
  }, [HP_MAX, EP_MAX]);

  // Stable refs so rAF loop never needs to restart on skill changes
  const hpMaxRef = useRef(HP_MAX);
  hpMaxRef.current = HP_MAX;
  const epMaxRef = useRef(EP_MAX);
  epMaxRef.current = EP_MAX;

  // ── Runtime ability cooldowns ─────────────────────────────────────────────
  const [runtimeAbilities, setRuntimeAbilities] = useState<
    Record<string, { cooldown: number; max: number }>
  >({});

  // ── rAF loop: vitals regen + cooldown tick ────────────────────────────────
  useEffect(() => {
    let raf: number;
    let last = performance.now();

    function frame(ts: number) {
      const dt = (ts - last) / 1000;
      last = ts;

      // No passive HP/EP regen — vitals only recover from items/abilities (per design).

      // Cooldown tick
      setRuntimeAbilities(prev => {
        let changed = false;
        const next: typeof prev = {};
        for (const k in prev) {
          const c = prev[k];
          if (c.cooldown > 0) {
            const nc = Math.max(0, c.cooldown - dt);
            if (nc !== c.cooldown) changed = true;
            next[k] = { cooldown: nc, max: c.max };
          } else {
            next[k] = c;
          }
        }
        return changed ? next : prev;
      });

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // Empty deps: loop runs once for the lifetime of the hook.
    // hpMaxRef / epMaxRef always carry the latest caps without a restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Ability activation ────────────────────────────────────────────────────
  const onActivateAbility = useCallback((id: string) => {
    setRuntimeAbilities(prev => {
      const cur = prev[id];
      if (cur && cur.cooldown > 0) return prev; // still cooling
      return {
        ...prev,
        [id]: { cooldown: cur?.max ?? BASE_COOLDOWN, max: cur?.max ?? BASE_COOLDOWN },
      };
    });
    setHeroVitals(v => ({ ...v, ep: Math.max(0, v.ep - 10) }));
  }, []);

  // ── Derived ability arrays for HUD ────────────────────────────────────────
  const abilities = useMemo<RuntimeAbilitySlot[]>(
    () =>
      skillState.abilityLoadout.offensive
        .map((id, i) => {
          if (!id) return null;
          const rt = runtimeAbilities[id];
          return {
            id,
            icon: skillIconFn(id),
            cooldown: rt?.cooldown || 0,
            maxCooldown: rt?.max || BASE_COOLDOWN,
            disabled: !!(rt?.cooldown),
            key: AB_KEYS_OFF[i],
          };
        })
        .filter(Boolean) as RuntimeAbilitySlot[],
    [skillState.abilityLoadout.offensive, runtimeAbilities],
  );

  const defensiveAbilities = useMemo<RuntimeAbilitySlot[]>(
    () =>
      skillState.abilityLoadout.defensive
        .map((id, i) => {
          if (!id) return null;
          const rt = runtimeAbilities[id];
          return {
            id,
            icon: skillIconFn(id),
            cooldown: rt?.cooldown || 0,
            maxCooldown: rt?.max || BASE_COOLDOWN,
            disabled: !!(rt?.cooldown),
            key: AB_KEYS_DEF[i],
          };
        })
        .filter(Boolean) as RuntimeAbilitySlot[],
    [skillState.abilityLoadout.defensive, runtimeAbilities],
  );

  // ── Skill persistence (debounced 500 ms) ─────────────────────────────────
  // Mirrors the useEffect in App.tsx — fires when skill store changes, so skills
  // persist from any screen on which this hook is mounted.
  useEffect(() => {
    if (!idToken) return;
    const handle = setTimeout(() => {
      try {
        const payload = {
          skills: {
            level: skillState.level,
            unlocked: skillState.unlocked,
            unlockOrder: skillState.unlockOrder,
          },
        };
        chromeSyncSet({ 'afrofuture.skills': payload.skills }).catch(() => {});
        fetch('/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + idToken,
          },
          body: JSON.stringify(payload),
        }).then(r => {
          if (!r.ok && r.status !== 404) console.warn('[skills] persist failed', r.status);
        }).catch(() => {/* server not running — expected in local dev */});
      } catch (e) {
        console.warn('[skills] persist failed', e);
      }
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken, skillState.level, skillState.unlocked, skillState.unlockOrder]);

  return {
    // Skill store (pass-through for any consumer needing raw store)
    skillState,
    // Vitals
    heroVitals,
    setHeroVitals,
    hpMaxRef,
    epMaxRef,
    HP_MAX,
    EP_MAX,
    XP_MAX,
    XP_CUR,
    // Faction/character base + skill-modifier stat breakdown (hp/ep/atk/def/spd)
    stats,
    // Abilities
    runtimeAbilities,
    onActivateAbility,
    abilities,
    defensiveAbilities,
  };
}
