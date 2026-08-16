import type { Item, Loot } from './items';
import type { SpellId } from './spells';

export interface Point {
  x: number;
  y: number;
}

export type EnemyKind = 'wretch' | 'draugr' | 'boss' | 'volva' | 'ratling' | 'brute';

export interface Entity {
  x: number; // float tile coords
  y: number;
  path: Point[];
  hp: number;
  maxHp: number;
  dmgMin: number;
  dmgMax: number;
  speed: number; // tiles per second
  attackCd: number; // seconds between swings
  attackTimer: number;
  walkPhase: number;
  lunge: number; // 0..1 attack animation
  lungeDX: number;
  lungeDY: number;
  flash: number; // hit flash timer
}

export interface Enemy extends Entity {
  kind: EnemyKind;
  name: string;
  sight: number;
  aggro: boolean;
  repathTimer: number;
  slowT: number; // frost-slow seconds remaining
  bleedT: number; // blood-magic bleed seconds remaining
  bleedTick: number; // seconds until the next bleed tick
  windupT: number; // brute: seconds left before its telegraphed slam lands
  hazardCd: number; // boss: seconds until it can cast another ground hazard
  xpValue: number;
  bossId?: number; // index into the boss roster, for name and look
  // A stronger "unique" variant of a normal wretch/draugr — Diablo 1 style.
  // tint colors the whole body; seed keeps its spike layout stable frame to
  // frame instead of jittering.
  rare?: { tint: string; seed: number };
}

export interface Player extends Entity {
  castT: number; // 1 -> 0, brief hold after casting a spell (drives the cast animation)
  regen: number; // hp per second
  mana: number;
  maxMana: number;
  manaRegen: number;
  xp: number;
  level: number;
  potions: number; // belt
  inventory: Item[];
  weapon: Item;
  armor: Item | null;
  trinket: Item | null;
  knownSpells: SpellId[]; // learned by picking up a tome; resets each run
  activeSpell: SpellId; // which known spell casts — chosen from the HUD dropdown
}

export interface DamageNumber {
  x: number;
  y: number;
  value: string;
  t: number; // 1 -> 0
  color: string;
}

export interface Corpse {
  x: number;
  y: number;
  kind: EnemyKind;
  seed: number;
}

export interface GroundItem {
  x: number;
  y: number;
  loot: Loot;
  cd?: number; // pickup lockout (so dropped items aren't instantly re-grabbed)
}

export interface Effect {
  kind: 'nova' | 'levelup' | 'boom' | 'bolt' | 'drain';
  x: number;
  y: number;
  r: number; // world radius in tiles at t = 1
  t: number; // 0 -> 1
  color?: string; // 'r,g,b'
  x2?: number; // bolt endpoint
  y2?: number;
}

// A lingering ground hazard (Plague Bloom, or a boss's answer to it) — ticks
// damage to anyone standing in it every `tickEvery` seconds until `ttl`
// runs out. `hostile` flips who it hurts: unset/false damages enemies
// (the player's own spell), true damages the player (a boss's).
export interface Hazard {
  x: number;
  y: number;
  r: number;
  ttl: number;
  maxTtl: number;
  tickT: number;
  tickEvery: number;
  hostile?: boolean;
}

export interface Projectile {
  x: number;
  y: number;
  vx: number; // tiles per second
  vy: number;
  ttl: number;
  hostile?: boolean; // a Völva's bolt: hits the player, not enemies
  dmg?: number;
}
