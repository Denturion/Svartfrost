import type { Item, Loot } from './items';

export interface Point {
  x: number;
  y: number;
}

export type EnemyKind = 'wretch' | 'draugr' | 'boss';

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
  xpValue: number;
  bossId?: number; // index into the boss roster, for name and look
}

export interface Player extends Entity {
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
  spell: Item; // equipped tome, always present
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
  kind: 'nova' | 'levelup' | 'boom' | 'bolt';
  x: number;
  y: number;
  r: number; // world radius in tiles at t = 1
  t: number; // 0 -> 1
  color?: string; // 'r,g,b'
  x2?: number; // bolt endpoint
  y2?: number;
}

export interface Projectile {
  x: number;
  y: number;
  vx: number; // tiles per second
  vy: number;
  ttl: number;
}
