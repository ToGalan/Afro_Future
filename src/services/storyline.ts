/**
 * storyline.ts — the lightweight narrative arc that gives the campaign a WHY.
 *
 * Five story beats per faction (GDD: PAA "Heal and Unite" · ASF "Africa First" ·
 * WC "Survival at Any Cost"), each with a named speaker from the GDD cast, two lines
 * of dialogue, ONE meaningful choice, and a "current objective" pointer that doubles
 * as the new-player compass. Beats trigger off things the campaign already tracks —
 * first steps, first capture, rival pressure, victory-track progress — so the arc
 * paces itself to how you actually play.
 *
 * This module is pure data + trigger evaluation; SoloMissionMap3D renders the dialog,
 * applies choice effects through existing systems (reputation, FP, shards, XP), and
 * persists progress in `progress.solo.storyBeat` / `storyChoices`.
 */

export type StoryFaction = 'PAA' | 'ASF' | 'WC';

/**
 * The GDD cast, keyed by the archetype chosen at sign-up. The story is told TO the
 * player by their faction counterpart: pick Nia and Kwame briefs you; pick Kwame and
 * Nia does. Beat lines/outcomes use `{player}` / `{npc}` tokens resolved at render.
 */
export const STORY_CAST: Record<StoryFaction, Record<'MALE' | 'FEMALE', string>> = {
  PAA: { MALE: 'Kwame', FEMALE: 'Nia' },
  ASF: { MALE: 'Zuberi', FEMALE: 'Makena' },
  WC:  { MALE: 'Jonathan', FEMALE: 'Emily' },
};

function castFaction(faction: string): StoryFaction {
  return (faction === 'ASF' || faction === 'WC' ? faction : 'PAA') as StoryFaction;
}

/** The counterpart NPC who narrates the arc to the player's chosen character. */
export function storyNpc(faction: string, playerGender: 'MALE' | 'FEMALE'): string {
  const f = castFaction(faction);
  return STORY_CAST[f][playerGender === 'MALE' ? 'FEMALE' : 'MALE'];
}

/** Resolve `{player}`/`{npc}` tokens in a beat line or outcome. */
export function storyText(text: string, faction: string, playerGender: 'MALE' | 'FEMALE'): string {
  const f = castFaction(faction);
  return text
    .replace(/\{player\}/g, STORY_CAST[f][playerGender])
    .replace(/\{npc\}/g, storyNpc(faction, playerGender));
}

export interface StoryEffect {
  /** Routed through recordPlaystyle — shapes reputation AND its victory track. */
  playstyle?: 'help' | 'negotiate' | 'scavenge' | 'loot' | 'dominate';
  fp?: number;
  shards?: number;
  xp?: number;
}

export interface StoryChoice {
  id: string;
  label: string;        // button text (imperative, short)
  effect: StoryEffect;
  outcome: string;      // one-line consequence shown after choosing
}

/** What the world must look like for a beat to fire. */
export type StoryTrigger =
  | { kind: 'start' }                       // campaign begin (after hydration)
  | { kind: 'outposts'; count: number }     // player owns ≥ count outposts
  | { kind: 'rivalPressure' }               // a rival has claimed/raided on the map
  | { kind: 'trackValue'; value: number };  // player's best victory track ≥ value

export interface StoryBeat {
  id: string;
  index: number;          // 1..5 within the arc
  title: string;
  /** Default narrator — the UI overrides this with storyNpc() so the counterpart of the
      player's CHOSEN character always delivers the lines. */
  speaker: string;
  lines: [string, string]; // may contain {player}/{npc} tokens — render via storyText()
  objective: string;      // "current objective" HUD pointer while this beat is next/active
  trigger: StoryTrigger;
  choices: [StoryChoice, StoryChoice];
}

/** Snapshot of campaign state the trigger evaluator reads. */
export interface StoryWorldState {
  started: boolean;        // solo save hydrated, map live
  outpostsOwned: number;
  rivalPressureSeen: boolean;
  bestTrackValue: number;  // max of the player's four victory-track values
}

export function beatReady(beat: StoryBeat, w: StoryWorldState): boolean {
  if (!w.started) return false;
  switch (beat.trigger.kind) {
    case 'start':         return true;
    case 'outposts':      return w.outpostsOwned >= beat.trigger.count;
    case 'rivalPressure': return w.rivalPressureSeen;
    case 'trackValue':    return w.bestTrackValue >= beat.trigger.value;
  }
}

// ─── The arcs ─────────────────────────────────────────────────────────────────

export const STORY_ARCS: Record<StoryFaction, StoryBeat[]> = {
  PAA: [
    {
      id: 'paa_1', index: 1, title: 'The Green Mandate', speaker: 'Kwame',
      lines: [
        '{player}, the Alliance didn’t send us here to plant a flag. This valley fed ten thousand people before the collapse.',
        'The land remembers. Reach the old outposts, and it will remember us kindly.',
      ],
      objective: 'Reach an outpost and capture it: walk adjacent and press G, or negotiate.',
      trigger: { kind: 'start' },
      choices: [
        { id: 'heal', label: 'We heal first, hold second.', effect: { playstyle: 'help', fp: 4 }, outcome: '{npc} nods. "Then every camp we pass is a promise." (+FP, Prosperity)' },
        { id: 'secure', label: 'Secure ground, then heal.', effect: { playstyle: 'negotiate', fp: 2, xp: 15 }, outcome: '"Pragmatic. The elders would argue, but they aren’t here." (+XP)' },
      ],
    },
    {
      id: 'paa_2', index: 2, title: 'First Light', speaker: 'Nia',
      lines: [
        'The banner flies. Refugees will see it from the ridgelines by morning. So will the Sovereignty Front.',
        'Whatever we take, we must be worthy of keeping.',
      ],
      objective: 'Aid or negotiate with a refugee camp. Approach one and press H.',
      trigger: { kind: 'outposts', count: 1 },
      choices: [
        { id: 'open', label: 'Open the outpost stores to refugees.', effect: { playstyle: 'help', shards: 5 }, outcome: 'Word spreads: the Alliance keeps its word. (+shards, Prosperity)' },
        { id: 'ration', label: 'Ration carefully. Winter is long.', effect: { playstyle: 'scavenge', fp: 3 }, outcome: 'Stores hold. Some walk on hungry. (+FP, Exploitation)' },
      ],
    },
    {
      id: 'paa_3', index: 3, title: 'Rival Banners', speaker: 'Kwame',
      lines: [
        'Scouts confirm it: rival colors over the far outposts. They expand while we deliberate.',
        'Ubuntu is not surrender, {player}. Even healers hold a line.',
      ],
      objective: 'Rivals are expanding. Capture or reconquer an outpost to answer them.',
      trigger: { kind: 'rivalPressure' },
      choices: [
        { id: 'parley', label: 'Send envoys before soldiers.', effect: { playstyle: 'negotiate', fp: 6 }, outcome: 'A cold truce buys time along one border. (+FP, Prosperity)' },
        { id: 'answer', label: 'Answer banner with banner.', effect: { playstyle: 'dominate', xp: 25 }, outcome: 'The Alliance marches. Healers, yes, but not prey. (+XP, Domination)' },
      ],
    },
    {
      id: 'paa_4', index: 4, title: 'The Land Breathes', speaker: 'Nia',
      lines: [
        'Half the valley is green again. Children who were born in dust have seen rain gather in living soil.',
        'This is what we are FOR, {player}. Let the others race for thrones.',
      ],
      objective: 'Push a victory track past 50: terraform, aid camps, hold your regions.',
      trigger: { kind: 'trackValue', value: 50 },
      choices: [
        { id: 'festival', label: 'Hold a festival of first harvest.', effect: { playstyle: 'help', shards: 8, fp: 4 }, outcome: 'Songs in six languages under one sky. (+shards +FP)' },
        { id: 'fortify', label: 'Quietly fortify while they celebrate.', effect: { playstyle: 'scavenge', xp: 30 }, outcome: 'Joy above, steel below. Both are shelter. (+XP)' },
      ],
    },
    {
      id: 'paa_5', index: 5, title: 'What We Leave', speaker: 'Kwame',
      lines: [
        'The council will name this era after what you do next. Conqueror. Gardener. Peacemaker.',
        'Finish it, {player}, whichever finishing is truly ours.',
      ],
      objective: 'Fill any victory track to end the campaign your way.',
      trigger: { kind: 'trackValue', value: 75 },
      choices: [
        { id: 'legacy', label: 'The land outlives every flag.', effect: { playstyle: 'help', shards: 10 }, outcome: 'A vow recorded in the Alliance annals. (+shards, Prosperity)' },
        { id: 'union', label: 'A union strong enough to defend itself.', effect: { playstyle: 'negotiate', fp: 8, xp: 25 }, outcome: 'Strength in openness, the Pan-African way. (+FP +XP)' },
      ],
    },
  ],

  ASF: [
    {
      id: 'asf_1', index: 1, title: 'Never Again', speaker: 'Zuberi',
      lines: [
        '{player}, every outpost out there was built on our backs, then pointed at us. Look at the map and remember it.',
        'Sovereignty is not requested. It is taken, held, and defended.',
      ],
      objective: 'Take your first outpost: walk adjacent and press G. Assault is our way.',
      trigger: { kind: 'start' },
      choices: [
        { id: 'storm', label: 'We take it by storm, visibly.', effect: { playstyle: 'dominate', xp: 20 }, outcome: '"Let the horizon learn our silhouette." (+XP, Domination)' },
        { id: 'quiet', label: 'Quietly. Strength wastes nothing.', effect: { playstyle: 'scavenge', fp: 4 }, outcome: '"A blade unseen cuts twice." (+FP, Exploitation)' },
      ],
    },
    {
      id: 'asf_2', index: 2, title: 'The First Banner', speaker: 'Makena',
      lines: [
        'Our colors over reclaimed ground. My grandmother crossed this valley in chains of debt.',
        'The Front does not stop at one banner, {player}. It stops at the sea.',
      ],
      objective: 'Expand. Hold 3 outposts to anchor the Front’s claim.',
      trigger: { kind: 'outposts', count: 1 },
      choices: [
        { id: 'press', label: 'Press outward now, rest later.', effect: { playstyle: 'dominate', xp: 20 }, outcome: 'Momentum is a weapon. (+XP, Domination)' },
        { id: 'root', label: 'Root deep first, supply lines win wars.', effect: { playstyle: 'scavenge', fp: 5 }, outcome: 'Caches buried, routes mapped. (+FP, Exploitation)' },
      ],
    },
    {
      id: 'asf_3', index: 3, title: 'Contested Ground', speaker: 'Zuberi',
      lines: [
        'Rival banners rise: the Coalition’s scavengers, the Alliance’s gardeners, all of them on OUR soil.',
        'History only repeats for those who let it, {player}.',
      ],
      objective: 'A rival holds ground. Ride out and reconquer what is ours.',
      trigger: { kind: 'rivalPressure' },
      choices: [
        { id: 'strike', label: 'Strike their newest claim tonight.', effect: { playstyle: 'dominate', xp: 30 }, outcome: 'By dawn, their banner feeds a cookfire. (+XP, Domination)' },
        { id: 'siege', label: 'Choke their routes, let hunger fight.', effect: { playstyle: 'loot', fp: 6 }, outcome: 'Their outposts wither on the vine. (+FP, Exploitation)' },
      ],
    },
    {
      id: 'asf_4', index: 4, title: 'The Weight of Banners', speaker: 'Makena',
      lines: [
        'Half the map answers to the Front. Villages fly our colors, some from pride, some from fear.',
        'Which do you want, {player}? Be careful. The answer builds the nation.',
      ],
      objective: 'Push a victory track past 50. Dominate, or prove the Front can build.',
      trigger: { kind: 'trackValue', value: 50 },
      choices: [
        { id: 'feared', label: 'Fear keeps borders honest.', effect: { playstyle: 'dominate', xp: 30 }, outcome: 'No raider tests the Front twice. (+XP, Domination)' },
        { id: 'proud', label: 'Pride. Open the granaries.', effect: { playstyle: 'help', fp: 6, shards: 5 }, outcome: 'Sovereignty that feeds is sovereignty that lasts. (+FP +shards)' },
      ],
    },
    {
      id: 'asf_5', index: 5, title: 'Africa First', speaker: 'Zuberi',
      lines: [
        'One push remains. After this, no foreign hand draws borders here, ever again.',
        'Finish it, {player}. For everyone who was never asked.',
      ],
      objective: 'Fill any victory track and seal our sovereignty.',
      trigger: { kind: 'trackValue', value: 75 },
      choices: [
        { id: 'iron', label: 'Total control. No exceptions.', effect: { playstyle: 'dominate', xp: 40 }, outcome: 'The Front’s peace, absolute. (+XP, Domination)' },
        { id: 'guard', label: 'Guarded gates, open markets.', effect: { playstyle: 'negotiate', fp: 8, shards: 5 }, outcome: 'Strong walls, working doors. (+FP +shards)' },
      ],
    },
  ],

  WC: [
    {
      id: 'wc_1', index: 1, title: 'Inventory of Ashes', speaker: 'Jonathan',
      lines: [
        '{player}, the Coalition’s last directive was one word: persist. Everything in this valley is now an asset or an obstacle.',
        'Catalogue it. Secure it. Survive it.',
      ],
      objective: 'Gather resources, then take your first outpost: walk adjacent and press G.',
      trigger: { kind: 'start' },
      choices: [
        { id: 'salvage', label: 'Strip everything not nailed down.', effect: { playstyle: 'scavenge', fp: 4 }, outcome: 'Stockpiles rise. So do local grudges. (+FP, Exploitation)' },
        { id: 'trade', label: 'Trade, don’t take. For now.', effect: { playstyle: 'negotiate', fp: 3, xp: 10 }, outcome: 'Markets remember fair dealers. (+FP +XP)' },
      ],
    },
    {
      id: 'wc_2', index: 2, title: 'The Ledger Grows', speaker: 'Emily',
      lines: [
        'First outpost secured and self-sustaining. My models say we survive winter, barely.',
        'Barely is a number, {player}. I intend to improve it.',
      ],
      objective: 'Grow the ledger: loot a rival cache or resolve a refugee camp.',
      trigger: { kind: 'outposts', count: 1 },
      choices: [
        { id: 'exploit', label: 'Efficiency: work every claim.', effect: { playstyle: 'loot', fp: 5 }, outcome: 'The ledger fattens; the neighbors mutter. (+FP, Exploitation)' },
        { id: 'invest', label: 'Invest in the locals, assets appreciate.', effect: { playstyle: 'help', shards: 5 }, outcome: 'A strange line item: goodwill. It compounds. (+shards, Prosperity)' },
      ],
    },
    {
      id: 'wc_3', index: 3, title: 'Competitors', speaker: 'Jonathan',
      lines: [
        'Rival flags on the resource belt. The Front takes by force, the Alliance by charm. Either way it is our lost revenue.',
        'The Coalition did not crawl from the collapse to lose a bidding war.',
      ],
      objective: 'Rivals hold ground. Take back an outpost before the routes close.',
      trigger: { kind: 'rivalPressure' },
      choices: [
        { id: 'undercut', label: 'Undercut them, buy their allies.', effect: { playstyle: 'negotiate', fp: 6 }, outcome: 'Two border camps quietly switch suppliers. (+FP, Prosperity)' },
        { id: 'repossess', label: 'Repossess. With interest.', effect: { playstyle: 'dominate', xp: 25 }, outcome: 'Asset recovered; message delivered. (+XP, Domination)' },
      ],
    },
    {
      id: 'wc_4', index: 4, title: 'Solvent', speaker: 'Emily',
      lines: [
        'We’re past survival, {player}. Surplus, trade routes, even a school in the depot. My ledger has a future tense now.',
        'The question nobody in the old Coalition ever asked: surplus for WHAT?',
      ],
      objective: 'Push a victory track past 50. The ledger must show a path to victory.',
      trigger: { kind: 'trackValue', value: 50 },
      choices: [
        { id: 'hoard', label: 'Reserves. The next collapse is coming.', effect: { playstyle: 'scavenge', fp: 6 }, outcome: 'Vaults sealed against a darker winter. (+FP, Exploitation)' },
        { id: 'build', label: 'Spend it, build something worth keeping.', effect: { playstyle: 'help', shards: 8 }, outcome: 'The depot school gets a roof and a name. (+shards, Prosperity)' },
      ],
    },
    {
      id: 'wc_5', index: 5, title: 'Persist', speaker: 'Jonathan',
      lines: [
        'One directive, {player}: persist. We did. What the Coalition becomes next is written by whoever finishes this campaign.',
        'So finish it. And this time, sign it with your own name.',
      ],
      objective: 'Fill any victory track. The ledger closes in your favor.',
      trigger: { kind: 'trackValue', value: 75 },
      choices: [
        { id: 'empire', label: 'A trade empire, coast to coast.', effect: { playstyle: 'loot', fp: 8, xp: 25 }, outcome: 'Every road tithes the Coalition. (+FP +XP)' },
        { id: 'partner', label: 'A partner, not a power.', effect: { playstyle: 'negotiate', shards: 8 }, outcome: 'The old flag retired; a new contract signed. (+shards)' },
      ],
    },
  ],
};

/** The arc for a faction key (defaults to PAA for anything unrecognised). */
export function arcFor(faction: string): StoryBeat[] {
  return STORY_ARCS[(faction === 'ASF' || faction === 'WC' ? faction : 'PAA') as StoryFaction];
}
