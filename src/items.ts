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
  spellDmgPct?: number; // trinket affix: bonus % damage on cast spells
  spellCdPct?: number; // trinket affix: % reduction to spell cooldown
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

// Hand-authored uniques — fixed name and base stats, but their affix-like
// bonus stats (`rollKeys`) roll fresh on every drop instead of sitting at
// one baked number. `tier` here only borrows an existing weapon/armor
// silhouette for the renderer (see SLASH_TINT / drawWeaponIdle /
// drawArmorDecor); it doesn't feed the tier-scaling drop tables the way a
// normal item's tier does.
interface LegendaryTemplate {
  base: Omit<Item, 'rarity'>;
  rollKeys: (keyof Item)[];
}

const LEGENDARY_TEMPLATES: LegendaryTemplate[] = [
  { base: weapon("Hrímfaxi's Bite", 4, 22, 36), rollKeys: ['slowChance'] },
  { base: weapon("The Widow's Kiss", 7, 18, 30), rollKeys: ['bleedChance', 'lifeOnHit'] },
  { base: weapon('Skull-Splitter, Doom of Kings', 6, 28, 44), rollKeys: ['dmgPct'] },
  { base: armorItem("Draugr-King's Ribcage", 6, 14), rollKeys: ['regen'] },
  { base: armorItem('Cloak of the Hollow Moon', 5, 8), rollKeys: ['manaRegen', 'speed'] },
  {
    base: trinket('Eye of Hollow Yule', 4, {}),
    rollKeys: ['armor', 'regen', 'manaRegen', 'speed', 'spellDmgPct', 'spellCdPct'],
  },
];

// Every stat a Legendary can roll picks up exactly where a Rare's own
// affix range for that same stat tops out, and runs for the same span —
// a Rare can never roll as high as a Legendary's floor. Mirrors the
// min/max baked into WEAPON_AFFIXES / ARMOR_AFFIXES above; keep them in
// sync if those ever change.
const LEGENDARY_RANGES: Partial<Record<keyof Item, { min: number; max: number; int?: boolean }>> = {
  dmgPct: { min: 0.3, max: 0.48 }, // rare: 0.12-0.30
  atkSpeedPct: { min: 0.25, max: 0.4 }, // rare: 0.10-0.25
  bleedChance: { min: 0.3, max: 0.45 }, // rare: 0.15-0.30
  slowChance: { min: 0.3, max: 0.45 }, // rare: 0.15-0.30
  lifeOnHit: { min: 3, max: 5, int: true }, // rare: 1-3
  armor: { min: 3, max: 5, int: true }, // rare: 1-3
  regen: { min: 0.8, max: 1.3 }, // rare: 0.3-0.8
  manaRegen: { min: 0.9, max: 1.5 }, // rare: 0.3-0.9
  speed: { min: 0.8, max: 1.3 }, // rare: 0.3-0.8
  spellDmgPct: { min: 0.35, max: 0.55 }, // rare: 0.15-0.35
  spellCdPct: { min: 0.25, max: 0.38 }, // rare: 0.12-0.25
};

function rollLegendaryStat(key: keyof Item): number {
  const r = LEGENDARY_RANGES[key];
  if (!r) return 0;
  const v = r.min + Math.random() * (r.max - r.min);
  return r.int ? Math.round(v) : v;
}

function rollLegendaryItem(): Item {
  const t = pick(LEGENDARY_TEMPLATES);
  const item = { ...t.base, rarity: 'legendary' as const };
  for (const key of t.rollKeys) {
    (item[key] as number) = rollLegendaryStat(key);
  }
  return item;
}

function poolOf(kind: Item['kind']): Item[] {
  return kind === 'weapon' ? WEAPONS : kind === 'armor' ? ARMORS : kind === 'tome' ? TOMES : TRINKETS;
}

export function startingWeapon(): Item {
  return { ...WEAPONS[0] };
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

// Trinkets get everything armor can roll (they already carry the same
// stat surface) plus two spellcasting-only affixes — since spells stopped
// being physical gear (see maybeEnchant below), trinkets are now the only
// place a build can lean into spell damage/cooldown.
const TRINKET_AFFIXES: Affix[] = [
  ...ARMOR_AFFIXES,
  { apply: (i) => { i.spellDmgPct = (i.spellDmgPct ?? 0) + 0.15 + Math.random() * 0.2; }, tags: ['of the Magus', 'of Power'] },
  { apply: (i) => { i.spellCdPct = Math.min(0.5, (i.spellCdPct ?? 0) + 0.12 + Math.random() * 0.13); }, tags: ['of Alacrity', 'of the Adept'] },
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

// Rolls a chance for a drop to come out magic (1 affix) or rare (2-3
// affixes) on top of its base tier stats — Diablo 1-style loot variance
// instead of every tier-N item being identical. `boosted` widens the odds
// for boss/rare-mob drops. `forceEnchant` (past floor 10) turns what
// would've been a plain gray drop into a magic one instead of discarding
// the rarity roll entirely — gray items stop existing outright. Called on
// every equippable kind (weapon/armor/trinket) so the floor-10 ban covers
// all of them. Tomes never come through here — picking one up teaches the
// spell and consumes it outright, so there's no gear/rarity concept left
// to apply (see game.ts's pickup loop and rollDrops below).
function maybeEnchant(item: Item, boosted: boolean, forceEnchant: boolean): Item {
  const pool = item.kind === 'weapon' ? WEAPON_AFFIXES : item.kind === 'trinket' ? TRINKET_AFFIXES : ARMOR_AFFIXES;
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
  return rollLegendaryItem();
}

// 'mana' is the same kind of instant pickup as 'potion' — no belt slot,
// consumed on touch (see game.ts's ground-loot pickup loop) — just topping
// up mana instead of hp.
export type Loot = Item | 'potion' | 'mana';

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
    if (Math.random() < 0.4) drops.push(maybeEnchant(itemOfTier('trinket', rollTier(depth, 'trinket')), true, pastGrayFloor));
    return drops;
  }
  const r = Math.random();
  if (r < 0.2) return ['potion'];
  if (r < 0.32) return ['mana'];
  if (r < 0.39) return [maybeEnchant(itemOfTier('weapon', rollTier(depth, 'weapon')), false, pastGrayFloor)];
  if (r < 0.46) return [maybeEnchant(itemOfTier('armor', rollTier(depth, 'armor')), false, pastGrayFloor)];
  if (r < 0.515) return [maybeEnchant(itemOfTier('trinket', rollTier(depth, 'trinket')), false, pastGrayFloor)];
  if (r < 0.555) return [itemOfTier('tome', rollTier(depth, 'tome'))];
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
  if (i.spellDmgPct) parts.push(`+${Math.round(i.spellDmgPct * 100)}% spell damage`);
  if (i.spellCdPct) parts.push(`-${Math.round(i.spellCdPct * 100)}% spell cooldown`);
  return parts.join(', ');
}

export function describeItem(i: Item): string {
  return `${i.name}  ${itemStatLine(i)}`;
}
