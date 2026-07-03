import { startingTome, startingWeapon } from './items';
import type { Enemy, EnemyKind, Player } from './types';

export function createPlayer(x: number, y: number): Player {
  const p: Player = {
    x,
    y,
    path: [],
    hp: 60,
    maxHp: 60,
    dmgMin: 0,
    dmgMax: 0,
    speed: 4.5,
    attackCd: 0.45,
    attackTimer: 0,
    walkPhase: 0,
    lunge: 0,
    lungeDX: 1,
    lungeDY: 0,
    flash: 0,
    regen: 0.6,
    mana: 40,
    maxMana: 40,
    manaRegen: 1.4,
    xp: 0,
    level: 1,
    potions: 1,
    inventory: [],
    weapon: startingWeapon(),
    armor: null,
    trinket: null,
    spell: startingTome(),
  };
  recalcStats(p);
  return p;
}

const PLAYER_BASE = { speed: 4.5, regen: 0.6, manaRegen: 1.4 };

export function recalcStats(p: Player): void {
  p.dmgMin = p.weapon.dmgMin + (p.level - 1);
  p.dmgMax = p.weapon.dmgMax + (p.level - 1);
  p.speed = PLAYER_BASE.speed + (p.trinket?.speed ?? 0);
  p.regen = PLAYER_BASE.regen + (p.trinket?.regen ?? 0);
  p.manaRegen = PLAYER_BASE.manaRegen + (p.trinket?.manaRegen ?? 0);
}

export function xpNext(level: number): number {
  return Math.round(28 * level * (1 + 0.35 * level));
}

const BASE_STATS = {
  wretch: { name: 'Wretch', hp: 8, dmgMin: 1, dmgMax: 3, speed: 3.2, attackCd: 0.9, sight: 8, xp: 6 },
  draugr: { name: 'Draugr', hp: 26, dmgMin: 4, dmgMax: 8, speed: 1.9, attackCd: 1.2, sight: 7, xp: 15 },
  boss: { name: 'Boss', hp: 90, dmgMin: 8, dmgMax: 14, speed: 2.3, attackCd: 1.4, sight: 10, xp: 120 },
} as const;

export function createEnemy(
  kind: EnemyKind,
  x: number,
  y: number,
  depth: number,
  name?: string,
  bossId?: number,
): Enemy {
  const scale = 1 + 0.3 * (depth - 1);
  const base = BASE_STATS[kind];
  const hp = Math.round(base.hp * scale);
  return {
    kind,
    name: name ?? base.name,
    x,
    y,
    path: [],
    hp,
    maxHp: hp,
    dmgMin: Math.round(base.dmgMin * scale),
    dmgMax: Math.round(base.dmgMax * scale),
    speed: base.speed,
    attackCd: base.attackCd,
    attackTimer: Math.random() * base.attackCd,
    walkPhase: Math.random() * Math.PI * 2,
    lunge: 0,
    lungeDX: 1,
    lungeDY: 0,
    flash: 0,
    sight: base.sight,
    aggro: false,
    repathTimer: Math.random() * 0.5,
    slowT: 0,
    xpValue: Math.round(base.xp * (1 + 0.25 * (depth - 1))),
    bossId,
  };
}

export function rollDamage(e: { dmgMin: number; dmgMax: number }): number {
  return e.dmgMin + ((Math.random() * (e.dmgMax - e.dmgMin + 1)) | 0);
}
