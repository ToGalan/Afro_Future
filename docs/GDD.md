# Generation AI: Afro-Future Rising — Game Design Document

> Repo copy of the authoritative GDD (source: `docs/Afro-Future Rising GDD.pdf`, 40 pp.).
> This markdown is the in-repo source of truth for implementation. Where the PDF gives an
> *example* (e.g. the skill grid) rather than a fixed spec, it is flagged as such.

## Game Concept

A semi-3D **action-adventure platformer** set in a post-apocalyptic world where Africa
survived WWIII and rose as the most technologically advanced continent. Themes: African
empowerment, futuristic cybernetics, body enhancement. Blends **action + adventure +
strategy** with a single-player campaign and **MOBA-style competitive multiplayer**.

- **Genre:** action / adventure / strategy platformer with MOBA multiplayer.
- **Perspective:** semi-3D **top-down** view (gameplay); realistic 3D for story cinematics.
- **Platform:** PC (GDD names Unreal Engine 5 — aspirational; this build is Vite + React + Three.js).
- **Audience:** 18–35, narrative-driven action fans, Afro-futurism fans, competitive/esports players.
- **Revenue:** cosmetic-only store + seasonal battle pass. **No pay-to-win.**

## Factions & Characters

Three factions, each with a male + female playable character:

| Faction | Ethos | Playstyle | Male | Female |
|---|---|---|---|---|
| **PAA** — Pan-African Alliance | "Heal and Unite" | Diplomacy & healing; **non-lethal** combat; tech-advanced | Dr. Kwame Nkrumah II | **Nia Sankara** |
| **ASF** — African Sovereign Front | "Africa First" | Strong defense, **guerrilla warfare**, offensive cybernetics | Zuberi Okonjo | **Makena Azikiwe** |
| **WC** — World Coalition | "Survival at Any Cost" | Resource exploitation, aggressive/traditional warfare; mixed old-world + improvised tech | Capt. Johnathan Blake | Dr. Emily Stalvern |

**Storyline goals:** PAA → aid the WC, mediate peace, defeat the militant African faction (ASF).
ASF → defend Africa, defeat both WC and PAA (seen as traitors). WC → secure Africa's resources
to rebuild; African-faction players negotiate with or defeat the WC while managing the rival
African faction.

## Pet Companion

Choose one cybernetically-enhanced pet:

- **Cyber-Dog** — strong & loyal; enhanced strength, speed, recon sensors (tanky/recon).
- **Cyber-Cat** — agile & stealthy; excels at stealth, reaches hidden places, gathers intel undetected.

Pets: carry items base→field (medkits, ammo, gadgets), assist in combat (attack / distract / recon),
find hidden paths & items, run mission tasks (fetch, scout, activate mechanisms), and heal/support.
Bonding unlocks new abilities/skills as the player progresses; the pet evolves into a formidable
ally at high levels.

## Character Levels and Abilities

### General Structure (progression bands, L1–50)

- **L1–10:** Basic skills and abilities.
- **L11–20:** Intermediate skills and enhanced basic abilities.
- **L21–30:** Advanced skills and Faction Abilities.
- **L31–40:** Elite skills and improved Faction Abilities.
- **L41–50:** Master skills and unique Faction Abilities.

### Skill Grid — Example for a single character (PAA shown as the worked example)

> The GDD labels this an **example** grid. Faction-specific entries (marked "for PAA") vary
> per faction per the ethos table above.

**L1–5 — Basic Skills**
- L1: Basic Attack
- L2: Basic Defense
- L3: Speed Increase
- L4: Basic Pet Command
- L5: **Faction Passive Skill I** (e.g. Resource Gathering Efficiency for PAA)

**L6–10 — Enhanced Basic Skills**
- L6: Improved Basic Attack
- L7: Health Increase
- L8: Enhanced Speed
- L9: Advanced Pet Command
- L10: **Special Attack** (e.g. Non-lethal Takedown for PAA)

**L11–15 — Intermediate Skills**
- L11: Stealth Mode
- L12: Intermediate Defense
- L13: Pet Stealth Skill
- L14: Hacking Ability (for PAA: diplomacy skill)
- L15: **Faction Passive Skill II** (e.g. Improved Diplomacy for PAA)

**L16–20 — Advanced Basic Skills**
- L16: Advanced Attack
- L17: Shield Activation
- L18: Improved Health Regeneration
- L19: Pet Attack Upgrade
- L20: **Faction Ability I** (e.g. Peacekeeper Drone for PAA)

**L21–25 — Faction-Specific Skills**
- L21: **Faction Passive Skill III** (e.g. Cyber Defense for PAA)
- L22: Enhanced Stealth Mode
- L23: Advanced Hacking / Diplomacy
- L24: Pet Scouting Upgrade
- L25: **Faction Ability II** (e.g. Resource Redistribution for PAA)

**L26–30 — Elite Skills**
- L26: Elite Attack Mode
- L27: Full Shield Mode
- L28: Pet Combat Upgrade
- L29: **Faction Passive Skill IV** (e.g. Negotiation Mastery for PAA)
- L30: **Faction Ability III** (e.g. Ceasefire Negotiator for PAA)

**L31–40 — Master Level Skills**
- Further enhancements to attack, defense, stealth, and faction abilities (more powerful,
  sophisticated versions). Pet gains more advanced combat and support capabilities.

**L41–50 — Ultimate Skills and Faction Abilities**
- Most powerful abilities: ultimate attacks, near-indestructible defenses, unmatched stealth,
  pinnacle faction-specific powers. Pet evolves into a formidable ally with unique abilities.

### Progression currencies

- **Experience Points (XP):** earned from missions, combat, completing objectives → levels.
- **Skill Points:** earned each level-up → unlock / enhance skills.
- **Faction Points:** earned from faction-related activities → unlock **Faction Abilities**.

### Faction Abilities Variation

Each faction has unique abilities matching its ethos:
- **PAA** → diplomacy & healing.
- **ASF** → combat & guerrilla tactics.
- **WC** → resource exploitation & traditional warfare.

## Implied Buff / Debuff Effects (derived from the skill grid)

The GDD does not give a formal status-effect table; these are the effects the listed skills imply:

- **Self-buffs:** Shield Activation / Full Shield Mode (damage mitigation), Stealth Mode /
  Enhanced Stealth Mode (undetectable / reduced aggro), Improved Health Regeneration (regen),
  Speed Increase / Enhanced Speed, faction passives (flat stat bonuses).
- **Enemy debuffs:** Non-lethal Takedown (PAA — disable/stun), Ceasefire Negotiator (PAA —
  pacify/de-aggro), Hacking (disable tech), ASF guerrilla strikes (ambush burst).

## Regions, Outposts & World

- World map = Africa + Europe post-WWIII, divided into **regions** (distinct terrain/aesthetic).
- Each region has multiple **outposts**; every faction has the same total outpost count.
- **Capture** outposts via stealth / combat / diplomacy missions → resources, spawn points, new missions.
- **Defend** captured outposts (rival African faction reclaims; WC loots).
- Control **all** outposts in a region → **regional control** → new story arcs, resources, special abilities.
- Dynamic world: outposts/regions change hands, creating a living, evolving battlefield.
- Strategic resource management: balance offense vs. defending held territory.

## Game Modes

1. **Single-Player Campaign** — core narrative; expansive Africa/Europe map, branching paths,
   character/pet progression, missions mixing combat / diplomacy / resource management / exploration.
2. **Multiplayer (MOBA-style)** — **1v1v1** or **2v2v2**; each player/team represents one faction,
   starts with a base in a random region; objectives = resource gathering, outpost/region control,
   faction-specific missions; scaled/faster map. Uses the player's customized character + pet.
3. **Ranked** — competitive 1v1v1 / 2v2v2 with ranking, leaderboards, seasonal rankings, rotating
   challenges; contributes to stats/achievements/rewards.

### MOBA detail

- **Three-player matches:** 3 players, one per faction, each with a base in a random region.
- **Six-player matches:** 3 teams of 2, one faction per team.
- Objectives: resource gathering, capturing/holding outposts, faction-specific dynamic missions
  (sabotage, espionage, rescue, reinforcement). Regional control grants game-changing bonuses.
- Balanced competition with faction strengths/weaknesses; dynamically generated map/resources.

## Demo Level (vertical slice)

Post-apocalyptic African region (urban ruins + nature). Objective: **terraform** a faction-specific
area. Loop: mission briefing → explore → gather resources (guarded by enemies) → enemy skirmishes →
terraform via a command center → success cinematic + full-game teaser. Enemy AI actively hinders
terraforming, requiring strategic defense and resource allocation.

## Monetization (fair, cosmetic-only)

- **Skin & Customization Store** — cosmetic skins for characters/pets/outposts/vehicles; no gameplay
  impact; regular + limited-edition drops; game currency purchasable with real money or earned in-game.
- **Battle Pass** — seasonal, themed; free + premium tracks; tiered cosmetic rewards; challenges/missions
  to progress; premium track and tier-skips are purchasable.
- **Principles:** no pay-to-win (cosmetics only), community engagement, transparency on odds.
