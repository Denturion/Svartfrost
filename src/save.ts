import type { Item } from './items';
import type { SpellId } from './spells';

export interface SavedPlayer {
  level: number;
  xp: number;
  maxHp: number;
  hp: number;
  maxMana: number;
  mana: number;
  potions: number;
  weapon: Item;
  armor: Item | null;
  trinket: Item | null;
  knownSpells: SpellId[];
  activeSpell: SpellId;
  inventory: Item[];
}

/** Checkpoint taken at the entrance of each depth. Death deletes it. */
export interface RunSave {
  v: 1;
  seed: number;
  depth: number;
  kills: number;
  player: SavedPlayer;
}

export interface Records {
  v: 1;
  bestDepth: number;
  bestKills: number;
  deaths: number;
  runs: number;
}

const RUN_KEY = 'svartfrost.run';
const REC_KEY = 'svartfrost.records';

export function saveRun(s: RunSave): void {
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — play on without saves */
  }
}

export function loadRun(): RunSave | null {
  try {
    const s = JSON.parse(localStorage.getItem(RUN_KEY) ?? 'null') as RunSave | null;
    return s && s.v === 1 ? s : null;
  } catch {
    return null;
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(RUN_KEY);
  } catch {
    /* ignore */
  }
}

export function loadRecords(): Records {
  try {
    const r = JSON.parse(localStorage.getItem(REC_KEY) ?? 'null') as Records | null;
    if (r && r.v === 1) return r;
  } catch {
    /* fall through */
  }
  return { v: 1, bestDepth: 0, bestKills: 0, deaths: 0, runs: 0 };
}

export function saveRecords(r: Records): void {
  try {
    localStorage.setItem(REC_KEY, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}
