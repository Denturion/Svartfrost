import { SPELLS } from './spells';
import type { SpellId } from './spells';

export interface Item {
  kind: 'weapon' | 'armor' | 'trinket' | 'tome';
  name: string;
  tier: number;
  dmgMin: number;
  dmgMax: number;
  armor: number;
  regen: number; // hp per second
  manaRegen: number;
  speed: number; // tiles per second
  spell?: SpellId;
}

function base(kind: Item['kind'], name: string, tier: number): Item {
  return { kind, name, tier, dmgMin: 0, dmgMax: 0, armor: 0, regen: 0, manaRegen: 0, speed: 0 };
}

function weapon(name: string, tier: number, dmgMin: number, dmgMax: number): Item {
  return { ...base('weapon', name, tier), dmgMin, dmgMax };
}

function armorItem(name: string, tier: number, armor: number): Item {
  return { ...base('armor', name, tier), armor };
}

function trinket(name: string, tier: number, fx: Partial<Item>): Item {
  return { ...base('trinket', name, tier), ...fx };
}

const WEAPONS: Item[] = [
  weapon('Rusted Blade', 1, 4, 8),
  weapon('Grave Axe', 2, 6, 11),
  weapon("Wolf's Claw", 3, 8, 14),
  weapon('Frostbrand', 4, 11, 18),
  weapon('Bloodmoon Scythe', 5, 14, 23),
  weapon('Transilvanian Hunger', 6, 18, 29),
];

const ARMORS: Item[] = [
  armorItem('Tattered Shroud', 1, 1),
  armorItem('Studded Hauberk', 2, 2),
  armorItem('Blackened Mail', 3, 3),
  armorItem('Frost-Iron Plate', 4, 5),
  armorItem('Funeral Plate', 5, 7),
  armorItem('Nightside Aegis', 6, 9),
];

const TRINKETS: Item[] = [
  trinket('Bone Talisman', 1, { regen: 0.5 }),
  trinket('Frozen Tear', 2, { manaRegen: 1.2 }),
  trinket('Wolf Charm', 3, { speed: 0.9 }),
  trinket('Corpsepaint Locket', 4, { armor: 2, regen: 0.5 }),
];

function tome(name: string, tier: number, spell: SpellId): Item {
  return { ...base('tome', name, tier), spell };
}

const TOMES: Item[] = [
  tome('Tome of the Frost Nova', 1, 'frostnova'),
  tome('Tome of the Fireball', 2, 'fireball'),
  tome('Tome of the Lightning', 3, 'lightning'),
  tome('Tome of the Fire Nova', 4, 'firenova'),
];

function poolOf(kind: Item['kind']): Item[] {
  return kind === 'weapon' ? WEAPONS : kind === 'armor' ? ARMORS : kind === 'tome' ? TOMES : TRINKETS;
}

export function startingWeapon(): Item {
  return { ...WEAPONS[0] };
}

export function startingTome(): Item {
  return { ...TOMES[0] };
}

function clampTier(t: number, kind: Item['kind']): number {
  return Math.max(1, Math.min(poolOf(kind).length, t));
}

function rollTier(depth: number, kind: Item['kind']): number {
  let tier = clampTier(Math.ceil(depth / 2), kind);
  if (Math.random() < 0.2) tier = clampTier(tier + 1, kind);
  if (Math.random() < 0.25) tier = clampTier(tier - 1, kind);
  return tier;
}

function itemOfTier(kind: Item['kind'], tier: number): Item {
  return { ...poolOf(kind)[clampTier(tier, kind) - 1] };
}

export type Loot = Item | 'potion';

export function rollDrops(depth: number, boss: boolean): Loot[] {
  if (boss) {
    const drops: Loot[] = ['potion', 'potion'];
    const kind = Math.random() < 0.5 ? 'weapon' : 'armor';
    drops.push(itemOfTier(kind, clampTier(Math.ceil(depth / 2) + 1, kind)));
    if (Math.random() < 0.4) drops.push(itemOfTier('trinket', rollTier(depth, 'trinket')));
    return drops;
  }
  const r = Math.random();
  if (r < 0.2) return ['potion'];
  if (r < 0.27) return [itemOfTier('weapon', rollTier(depth, 'weapon'))];
  if (r < 0.34) return [itemOfTier('armor', rollTier(depth, 'armor'))];
  if (r < 0.385) return [itemOfTier('trinket', rollTier(depth, 'trinket'))];
  if (r < 0.425) return [itemOfTier('tome', rollTier(depth, 'tome'))];
  return [];
}

export function describeItem(i: Item): string {
  const parts: string[] = [];
  if (i.kind === 'weapon') parts.push(`${i.dmgMin}–${i.dmgMax}`);
  if (i.spell) parts.push(`${SPELLS[i.spell].cost} mana`);
  if (i.armor) parts.push(`+${i.armor} armor`);
  if (i.regen) parts.push(`+${i.regen} hp/s`);
  if (i.manaRegen) parts.push(`+${i.manaRegen} mana/s`);
  if (i.speed) parts.push(`+${i.speed} stride`);
  return `${i.name}  ${parts.join(', ')}`;
}
