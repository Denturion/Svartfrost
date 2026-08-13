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

const PLAYER_BASE = { speed: 4.5, regen: 0.6, manaRegen: 1.4, attackCd: 0.45 };

export function recalcStats(p: Player): void {
  const dmgPct = 1 + (p.weapon.dmgPct ?? 0);
  p.dmgMin = Math.round((p.weapon.dmgMin + (p.level - 1)) * dmgPct);
  p.dmgMax = Math.round((p.weapon.dmgMax + (p.level - 1)) * dmgPct);
  p.attackCd = PLAYER_BASE.attackCd / (1 + (p.weapon.atkSpeedPct ?? 0));
  p.speed = PLAYER_BASE.speed + (p.trinket?.speed ?? 0) + (p.armor?.speed ?? 0);
  p.regen = PLAYER_BASE.regen + (p.trinket?.regen ?? 0) + (p.armor?.regen ?? 0);
  p.manaRegen = PLAYER_BASE.manaRegen + (p.trinket?.manaRegen ?? 0) + (p.armor?.manaRegen ?? 0);
}

export function xpNext(level: number): number {
  return Math.round(28 * level * (1 + 0.35 * level));
}

const BASE_STATS = {
  wretch: { name: 'Wretch', hp: 8, dmgMin: 1, dmgMax: 3, speed: 3.2, attackCd: 0.9, sight: 8, xp: 6 },
  draugr: { name: 'Draugr', hp: 26, dmgMin: 4, dmgMax: 8, speed: 1.9, attackCd: 1.2, sight: 7, xp: 15 },
  boss: { name: 'Boss', hp: 90, dmgMin: 8, dmgMax: 14, speed: 2.3, attackCd: 1.4, sight: 10, xp: 120 },
  // A seer that keeps its distance and lobs frost bolts instead of closing in.
  volva: { name: 'Völva', hp: 15, dmgMin: 3, dmgMax: 6, speed: 2.0, attackCd: 1.7, sight: 9, xp: 14 },
  // A cluster monster: weak alone, dangerous in the pack it always spawns in.
  ratling: { name: 'Ratling', hp: 3, dmgMin: 1, dmgMax: 2, speed: 4.2, attackCd: 0.7, sight: 7, xp: 3 },
  // Slow and tanky, with a telegraphed slam instead of a normal swing.
  brute: { name: 'Barrow Brute', hp: 46, dmgMin: 9, dmgMax: 15, speed: 1.5, attackCd: 1.9, sight: 7, xp: 26 },
} as const;

// A rare's stat bump over its base kind — meaningfully tougher, like a
// Diablo 1 unique, without being a second boss fight.
const RARE_MULT = { hp: 3.4, dmg: 1.7, xp: 3.2 };

export function createEnemy(
  kind: EnemyKind,
  x: number,
  y: number,
  depth: number,
  name?: string,
  bossId?: number,
  rareAffix?: { name: string; tint: string },
): Enemy {
  const scale = 1 + 0.3 * (depth - 1);
  const base = BASE_STATS[kind];
  const rm = rareAffix ? RARE_MULT : null;
  const hp = Math.round(base.hp * scale * (rm?.hp ?? 1));
  return {
    kind,
    name: rareAffix ? `${rareAffix.name} the ${base.name}` : (name ?? base.name),
    x,
    y,
    path: [],
    hp,
    maxHp: hp,
    dmgMin: Math.round(base.dmgMin * scale * (rm?.dmg ?? 1)),
    dmgMax: Math.round(base.dmgMax * scale * (rm?.dmg ?? 1)),
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
    bleedT: 0,
    bleedTick: 0,
    windupT: 0,
    hazardCd: kind === 'boss' ? 3 + Math.random() * 2 : 0,
    xpValue: Math.round(base.xp * (1 + 0.25 * (depth - 1)) * (rm?.xp ?? 1)),
    bossId,
    rare: rareAffix ? { tint: rareAffix.tint, seed: Math.random() } : undefined,
  };
}

export function rollDamage(e: { dmgMin: number; dmgMax: number }): number {
  return e.dmgMin + ((Math.random() * (e.dmgMax - e.dmgMin + 1)) | 0);
}
