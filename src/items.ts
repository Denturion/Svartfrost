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
  bleedChance?: number; // weapon: chance per hit to inflict bleed
  slowChance?: number; // weapon affix: chance per hit to chill (reuses the Frost Nova slow)
  dmgPct?: number; // weapon affix: bonus % damage
  atkSpeedPct?: number; // weapon affix: bonus % attack speed
  lifeOnHit?: number; // weapon affix: flat hp healed per successful hit
  // Set only when an affix roll hits — undefined items are the plain base
  // drop. Drives both the name decoration and the satchel's color coding.
  rarity?: 'magic' | 'rare' | 'legendary';
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
  { ...weapon('Bloodletter', 7, 20, 33), bleedChance: 0.35 },
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
  tome('Tome of the Plague Bloom', 5, 'blight'),
  tome('Tome of the Blood Rite', 6, 'blood'),
];

// Hand-authored uniques — fixed name, fixed rolls, no procedural affixes.
// `tier` here only borrows an existing weapon/armor silhouette for the
// renderer (see SLASH_TINT / drawWeaponIdle / drawArmorDecor); it doesn't
// feed the tier-scaling drop tables the way a normal item's tier does.
function legendary(item: Omit<Item, 'rarity'>): Item {
  return { ...item, rarity: 'legendary' };
}

const LEGENDARY_ITEMS: Item[] = [
  legendary({ ...weapon("Hrímfaxi's Bite", 4, 22, 36), slowChance: 0.55 }),
  legendary({ ...weapon("The Widow's Kiss", 7, 18, 30), bleedChance: 0.6, lifeOnHit: 3 }),
  legendary({ ...weapon('Skull-Splitter, Doom of Kings', 6, 28, 44), dmgPct: 0.35 }),
  legendary({ ...armorItem("Draugr-King's Ribcage", 6, 14), regen: 1.5 }),
  legendary({ ...armorItem('Cloak of the Hollow Moon', 5, 8), manaRegen: 1.8, speed: 1.2 }),
  legendary({ ...trinket('Eye of Hollow Yule', 4, {}), armor: 2, regen: 0.8, manaRegen: 0.8, speed: 0.6 }),
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

// --- affixes ---------------------------------------------------------------

// `tags` names the affix itself — magic items take one at random, rare
// items take the tag off the first affix they rolled. Keeps a suffix like
// "of Frost" honest: it's only ever on an item that actually chills.
interface Affix {
  apply: (item: Item) => void;
  tags: string[];
}

const WEAPON_AFFIXES: Affix[] = [
  { apply: (i) => { i.dmgPct = (i.dmgPct ?? 0) + 0.12 + Math.random() * 0.18; }, tags: ['of Might', 'of Fury'] },
  { apply: (i) => { i.atkSpeedPct = (i.atkSpeedPct ?? 0) + 0.1 + Math.random() * 0.15; }, tags: ['of Haste', 'of the Viper'] },
  { apply: (i) => { i.bleedChance = Math.min(0.6, (i.bleedChance ?? 0) + 0.15 + Math.random() * 0.15); }, tags: ['of Blood', 'of the Reaver'] },
  { apply: (i) => { i.lifeOnHit = (i.lifeOnHit ?? 0) + 1 + Math.floor(Math.random() * 3); }, tags: ['of the Leech', 'of Hunger'] },
  // Reuses the same slowT the Frost Nova spell already ticks down in game.ts.
  { apply: (i) => { i.slowChance = Math.min(0.5, (i.slowChance ?? 0) + 0.15 + Math.random() * 0.15); }, tags: ['of Frost', 'of Rime'] },
];

const ARMOR_AFFIXES: Affix[] = [
  { apply: (i) => { i.armor += 1 + Math.floor(Math.random() * 3); }, tags: ['of Warding', 'of the Bastion'] },
  { apply: (i) => { i.regen += 0.3 + Math.random() * 0.5; }, tags: ['of Vigor', 'of the Wolf'] },
  { apply: (i) => { i.manaRegen += 0.3 + Math.random() * 0.6; }, tags: ['of the Mind', 'of the Void'] },
  { apply: (i) => { i.speed += 0.3 + Math.random() * 0.5; }, tags: ['of the Crow', 'of Swiftness'] },
];

const RARE_PREFIXES = ['Runed', 'Bloodforged', 'Grim', 'Cursed', 'Baleful', 'Wraithbound'];

function pick<T>(arr: T[]): T {
  return arr[(Math.random() * arr.length) | 0];
}

function pickN<T>(arr: T[], n: number): T[] {
  const pool = [...arr];
  const picked: T[] = [];
  for (let i = 0; i < n && pool.length; i++) {
    picked.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
  }
  return picked;
}

// Rolls a chance for a weapon/armor drop to come out magic (1 affix) or
// rare (2-3 affixes) on top of its base tier stats — Diablo 1-style loot
// variance instead of every tier-N item being identical. `boosted` widens
// the odds for boss/rare-mob drops. `forceEnchant` (past floor 10) turns
// what would've been a plain gray drop into a magic one instead of
// discarding the rarity roll entirely — gray items stop existing outright.
function maybeEnchant(item: Item, boosted: boolean, forceEnchant: boolean): Item {
  const pool = item.kind === 'weapon' ? WEAPON_AFFIXES : ARMOR_AFFIXES;
  const roll = Math.random();
  const rareChance = boosted ? 0.22 : 0.08;
  const magicChance = boosted ? 0.5 : 0.28;
  if (roll < rareChance) {
    item.rarity = 'rare';
    const affixes = pickN(pool, 2 + (Math.random() < 0.4 ? 1 : 0));
    for (const affix of affixes) affix.apply(item);
    item.name = `${pick(RARE_PREFIXES)} ${item.name} ${pick(affixes[0].tags)}`;
  } else if (roll < rareChance + magicChance || forceEnchant) {
    item.rarity = 'magic';
    const affix = pick(pool);
    affix.apply(item);
    item.name = `${item.name} ${pick(affix.tags)}`;
  }
  return item;
}

// Legendaries only fall from bosses and rare mobs, only once the dungeon
// has some teeth (depth 10+, same floor where gray loot stops entirely),
// and even then only rarely — they're meant to be a story, not a build.
const LEGENDARY_CHANCE = 0.015;

function maybeLegendary(depth: number, boosted: boolean): Item | null {
  if (!boosted || depth < 10) return null;
  if (Math.random() >= LEGENDARY_CHANCE) return null;
  return { ...pick(LEGENDARY_ITEMS) };
}

export type Loot = Item | 'potion';

export function rollDrops(depth: number, boss: boolean): Loot[] {
  const pastGrayFloor = depth > 10;
  if (boss) {
    const drops: Loot[] = ['potion', 'potion'];
    const legendaryDrop = maybeLegendary(depth, true);
    if (legendaryDrop) {
      drops.push(legendaryDrop);
    } else {
      const kind = Math.random() < 0.5 ? 'weapon' : 'armor';
      drops.push(maybeEnchant(itemOfTier(kind, clampTier(Math.ceil(depth / 2) + 1, kind)), true, pastGrayFloor));
    }
    if (Math.random() < 0.4) drops.push(itemOfTier('trinket', rollTier(depth, 'trinket')));
    return drops;
  }
  const r = Math.random();
  if (r < 0.2) return ['potion'];
  if (r < 0.27) return [maybeEnchant(itemOfTier('weapon', rollTier(depth, 'weapon')), false, pastGrayFloor)];
  if (r < 0.34) return [maybeEnchant(itemOfTier('armor', rollTier(depth, 'armor')), false, pastGrayFloor)];
  if (r < 0.385) return [itemOfTier('trinket', rollTier(depth, 'trinket'))];
  if (r < 0.425) return [itemOfTier('tome', rollTier(depth, 'tome'))];
  return [];
}

// Just the stat line, no name — used for the satchel tooltip where the
// name is already shown (and truncated) on the row itself.
export function itemStatLine(i: Item): string {
  const parts: string[] = [];
  if (i.kind === 'weapon') parts.push(`${i.dmgMin}–${i.dmgMax}`);
  if (i.spell) parts.push(`${SPELLS[i.spell].cost} mana`);
  if (i.armor) parts.push(`+${i.armor} armor`);
  if (i.regen) parts.push(`+${i.regen.toFixed(1)} hp/s`);
  if (i.manaRegen) parts.push(`+${i.manaRegen.toFixed(1)} mana/s`);
  if (i.speed) parts.push(`+${i.speed.toFixed(1)} stride`);
  if (i.bleedChance) parts.push(`${Math.round(i.bleedChance * 100)}% bleed`);
  if (i.slowChance) parts.push(`${Math.round(i.slowChance * 100)}% chill`);
  if (i.dmgPct) parts.push(`+${Math.round(i.dmgPct * 100)}% damage`);
  if (i.atkSpeedPct) parts.push(`+${Math.round(i.atkSpeedPct * 100)}% atk speed`);
  if (i.lifeOnHit) parts.push(`+${i.lifeOnHit} life/hit`);
  return parts.join(', ');
}

export function describeItem(i: Item): string {
  return `${i.name}  ${itemStatLine(i)}`;
}
