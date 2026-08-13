import { roman } from './config';
import { generateDungeon, isWalkable, Tile } from './dungeon';
import type { Dungeon } from './dungeon';
import { createEnemy, createPlayer, recalcStats, rollDamage, xpNext } from './entities';
import { rollDrops } from './items';
import { findPath } from './pathfinding';
import { mulberry32 } from './rng';
import { clearRun, loadRecords, loadRun, saveRecords, saveRun } from './save';
import type { Records, RunSave } from './save';
import { sfx, setMusicDepth } from './sound';
import { SPELLS } from './spells';
import type { SpellId } from './spells';
import { hudLayout, invMetrics, invPanelRect, titleMenu } from './ui';
import { isTouchDevice } from './device';
import type {
  Corpse,
  DamageNumber,
  Effect,
  Enemy,
  EnemyKind,
  Entity,
  GroundItem,
  Hazard,
  Player,
  Point,
  Projectile,
} from './types';

const ATTACK_RANGE = 1.5;
const NOVA_RADIUS = 3.5;
export const POTION_HEAL = 30;
const BELT_SIZE = 8;

const BOSS_NAMES = [
  'Euronymous, the Dead Hand',
  'Bathory, the Blood-Countess',
  'Abbath, the Frostbitten',
  'Fenriz, the Grey Wolf',
  'Burzum, the Hollow Dark',
  'Gorgoroth, Warden of the Gate',
  'Marduk, the Plague-Bringer',
  'Immortal, the Blizzard King',
  'Emperor, Wreathed in Storm',
  'Dissection, the Star-Reaper',
];

// Rare "unique" wretches and draugr — Diablo 1-style elite packs. Tint is an
// 'r,g,b' triplet the renderer multiplies over the body.
const RARE_AFFIXES: { name: string; tint: string }[] = [
  { name: 'Bloodfang', tint: '200,40,45' },
  { name: 'Frostmarrow', tint: '140,210,235' },
  { name: 'Ashenclaw', tint: '235,140,60' },
  { name: 'Nightgaunt', tint: '160,90,210' },
  { name: 'Wormrot', tint: '130,190,90' },
  { name: 'Graveheld', tint: '215,210,195' },
];
const RARE_CHANCE = 0.08;

// Weighted per-spawn roll, gated by depth so newer runs meet the melee
// staples first before ranged/heavy threats start showing up.
function pickEnemyKind(rand: () => number, depth: number): EnemyKind {
  const roll = rand();
  if (depth >= 4 && roll < 0.1) return 'brute';
  if (depth >= 2 && roll < 0.28) return 'volva';
  return roll < 0.75 ? 'wretch' : 'draugr';
}

export class Game {
  dungeon!: Dungeon;
  player!: Player;
  enemies: Enemy[] = [];
  corpses: Corpse[] = [];
  groundItems: GroundItem[] = [];
  effects: Effect[] = [];
  projectiles: Projectile[] = [];
  hazards: Hazard[] = [];
  dmgNums: DamageNumber[] = [];
  depth = 1;
  kills = 0;
  time = 0;
  screen: 'title' | 'playing' | 'paused' | 'dead' = 'title';
  seed = 0;
  records: Records;
  savedRun: RunSave | null;
  invOpen = false;
  // Touch has no right-click to cast with, so tapping the mana orb "arms"
  // the spell — the next tap on the field casts there instead of moving.
  spellArmed = false;
  showFps = false;
  hurtFlash = 0;
  banner = { text: '', sub: '', t: 0 };
  camX = 0;
  camY = 0;
  targetEnemy: Enemy | null = null;
  hoverEnemy: Enemy | null = null;
  private playerRepath = 0;
  private novaCd = 0;

  constructor() {
    this.records = loadRecords();
    this.savedRun = loadRun();
    this.seed = (Math.random() * 0x7fffffff) | 0;
    this.newRun();
  }

  newRun(): void {
    this.depth = 1;
    this.kills = 0;
    this.invOpen = false;
    this.enterDepth(1, true);
    this.banner = { text: 'SVARTFROST', sub: 'the frost takes all', t: 4 };
  }

  // --- screens & persistence ---------------------------------------------

  startNewRun(): void {
    this.seed = (Math.random() * 0x7fffffff) | 0;
    this.newRun();
    this.records.runs++;
    saveRecords(this.records);
    this.checkpoint();
    this.screen = 'playing';
  }

  continueRun(): void {
    const s = this.savedRun;
    if (!s) return;
    this.seed = s.seed;
    const p = createPlayer(0, 0);
    Object.assign(p, s.player);
    recalcStats(p);
    this.player = p;
    this.enterDepth(s.depth, false);
    // enterDepth grants its descent heal; restore the exact checkpoint values.
    this.player.hp = s.player.hp;
    this.player.mana = s.player.mana;
    this.kills = s.kills;
    this.banner = { text: `DEPTH ${roman(s.depth)}`, sub: '', t: 3 };
    this.screen = 'playing';
  }

  toTitle(): void {
    this.screen = 'title';
    this.savedRun = loadRun();
  }

  togglePause(): void {
    if (this.screen === 'playing') this.screen = 'paused';
    else if (this.screen === 'paused') this.screen = 'playing';
  }

  titleClick(mx: number, my: number, viewW: number, viewH: number): void {
    const continueLabel = this.savedRun ? `Continue — Depth ${roman(this.savedRun.depth)}` : null;
    for (const item of titleMenu(viewW, viewH, continueLabel)) {
      if (mx >= item.x && mx <= item.x + item.w && my >= item.y && my <= item.y + item.h) {
        if (item.id === 'new') this.startNewRun();
        else this.continueRun();
        return;
      }
    }
  }

  private checkpoint(): void {
    const p = this.player;
    this.savedRun = {
      v: 1,
      seed: this.seed,
      depth: this.depth,
      kills: this.kills,
      player: {
        level: p.level,
        xp: p.xp,
        maxHp: p.maxHp,
        hp: p.hp,
        maxMana: p.maxMana,
        mana: p.mana,
        potions: p.potions,
        weapon: p.weapon,
        armor: p.armor,
        trinket: p.trinket,
        spell: p.spell,
        inventory: p.inventory,
      },
    };
    saveRun(this.savedRun);
  }

  private depthRng(depth: number): () => number {
    return mulberry32((this.seed ^ Math.imul(depth, 2654435761)) >>> 0);
  }

  private enterDepth(depth: number, fresh: boolean): void {
    this.depth = depth;
    setMusicDepth(depth);
    const rand = this.depthRng(depth);
    this.dungeon = generateDungeon(rand, depth);
    const { start } = this.dungeon;
    if (fresh) {
      this.player = createPlayer(start.x, start.y);
    } else {
      const p = this.player;
      p.x = start.x;
      p.y = start.y;
      p.path = [];
      p.lunge = 0;
      // Descending grants a sliver of respite, not a full heal.
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.25);
    }
    this.camX = start.x;
    this.camY = start.y;
    this.targetEnemy = null;
    this.hoverEnemy = null;
    this.corpses = [];
    this.groundItems = [];
    this.effects = [];
    this.projectiles = [];
    this.hazards = [];
    this.dmgNums = [];
    this.spawnEnemies(depth, rand);
  }

  private spawnEnemies(depth: number, rand: () => number): void {
    this.enemies = [];
    const count = Math.min(24, 6 + depth * 3);
    const rooms = this.dungeon.rooms.slice(1); // never in the starting room
    let guard = 0;
    while (this.enemies.length < count && guard++ < 500) {
      const room = rooms[(rand() * rooms.length) | 0];
      const x = room.x + ((rand() * room.w) | 0);
      const y = room.y + ((rand() * room.h) | 0);
      if (!isWalkable(this.dungeon, x, y)) continue;
      if (x === this.dungeon.stairs.x && y === this.dungeon.stairs.y) continue;
      if (this.enemies.some((e) => Math.round(e.x) === x && Math.round(e.y) === y)) continue;

      // A ratling pack, spawned together in place of a lone monster.
      if (depth >= 2 && rand() < 0.1) {
        const packSize = 3 + ((rand() * 3) | 0);
        for (let i = 0; i < packSize && this.enemies.length < count; i++) {
          const ox = x + (((rand() * 3) | 0) - 1);
          const oy = y + (((rand() * 3) | 0) - 1);
          if (!isWalkable(this.dungeon, ox, oy)) continue;
          if (this.enemies.some((e) => Math.round(e.x) === ox && Math.round(e.y) === oy)) continue;
          this.enemies.push(createEnemy('ratling', ox, oy, depth));
        }
        continue;
      }

      const kind = pickEnemyKind(rand, depth);
      // Rares stay out of the first couple of depths — let a new run learn
      // the basics before an elite can ambush it — and only ever roll on
      // the two base kinds the affix/stat table was tuned around.
      const rareAffix =
        depth >= 3 && (kind === 'wretch' || kind === 'draugr') && rand() < RARE_CHANCE
          ? RARE_AFFIXES[(rand() * RARE_AFFIXES.length) | 0]
          : undefined;
      this.enemies.push(createEnemy(kind, x, y, depth, undefined, undefined, rareAffix));
    }

    // Every fifth depth, a named horror guards the stairs.
    if (depth % 5 === 0) {
      const room = this.dungeon.rooms[this.dungeon.rooms.length - 1];
      let bossGuard = 0;
      while (bossGuard++ < 100) {
        const x = room.x + ((rand() * room.w) | 0);
        const y = room.y + ((rand() * room.h) | 0);
        if (!isWalkable(this.dungeon, x, y)) continue;
        if (x === this.dungeon.stairs.x && y === this.dungeon.stairs.y) continue;
        const bossId = (depth / 5 - 1) % BOSS_NAMES.length;
        this.enemies.push(createEnemy('boss', x, y, depth, BOSS_NAMES[bossId], bossId));
        break;
      }
    }
  }

  get boss(): Enemy | null {
    return this.enemies.find((e) => e.kind === 'boss') ?? null;
  }

  // --- input intents ---------------------------------------------------

  /** Returns true if the click/tap landed on UI and should not reach the world. */
  uiClick(mx: number, my: number, viewW: number, viewH: number): boolean {
    if (this.invOpen) {
      const rect = invPanelRect(viewW, viewH, this.player.inventory.length);
      if (mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h) {
        const m = invMetrics(viewW, viewH);
        const row = Math.floor((my - rect.y - m.headerH) / m.rowH);
        if (row >= 0 && row < this.player.inventory.length) this.equipFromInventory(row);
        return true;
      }
    }
    if (this.screen === 'playing') {
      const layout = hudLayout(viewW, viewH);
      // Satchel / pause icon buttons — touch only, desktop already has I/Esc.
      if (isTouchDevice) {
        if (Math.hypot(mx - layout.satchelBtn.x, my - layout.satchelBtn.y) < layout.satchelBtn.r) {
          this.invOpen = !this.invOpen;
          return true;
        }
        if (Math.hypot(mx - layout.pauseBtn.x, my - layout.pauseBtn.y) < layout.pauseBtn.r) {
          this.togglePause();
          return true;
        }
      }
      // Tap the potion belt to drink; tap the mana orb to arm the spell for
      // the next tap on the field — both work for mouse too, not just touch.
      if (!this.invOpen) {
        if (Math.hypot(mx - layout.potion.x, my - layout.potion.y) < layout.potion.r) {
          this.drinkPotion();
          return true;
        }
        if (Math.hypot(mx - layout.manaCx, my - layout.orbY) < layout.bezelR) {
          this.spellArmed = !this.spellArmed;
          return true;
        }
      }
    }
    return false;
  }

  /** Right-clicks on the satchel drop the row's item; returns true if consumed. */
  uiRightClick(mx: number, my: number, viewW: number, viewH: number): boolean {
    if (!this.invOpen) return false;
    const rect = invPanelRect(viewW, viewH, this.player.inventory.length);
    if (mx < rect.x || mx > rect.x + rect.w || my < rect.y || my > rect.y + rect.h) return false;
    const m = invMetrics(viewW, viewH);
    const row = Math.floor((my - rect.y - m.headerH) / m.rowH);
    if (row >= 0 && row < this.player.inventory.length) this.dropFromInventory(row);
    return true;
  }

  equipFromInventory(index: number): void {
    const p = this.player;
    const item = p.inventory[index];
    if (!item) return;
    if (item.kind === 'weapon') {
      p.inventory[index] = p.weapon;
      p.weapon = item;
    } else if (item.kind === 'tome') {
      p.inventory[index] = p.spell;
      p.spell = item;
    } else {
      const prev = item.kind === 'armor' ? p.armor : p.trinket;
      if (prev) p.inventory[index] = prev;
      else p.inventory.splice(index, 1);
      if (item.kind === 'armor') p.armor = item;
      else p.trinket = item;
    }
    recalcStats(p);
    sfx.pickup();
  }

  dropFromInventory(index: number): void {
    const p = this.player;
    const item = p.inventory[index];
    if (!item) return;
    p.inventory.splice(index, 1);
    const t = this.playerTile();
    const dirs: Point[] = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
      { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
    ].sort(() => Math.random() - 0.5);
    let gx = t.x;
    let gy = t.y;
    for (const dir of dirs) {
      if (isWalkable(this.dungeon, t.x + dir.x, t.y + dir.y)) {
        gx = t.x + dir.x;
        gy = t.y + dir.y;
        break;
      }
    }
    this.groundItems.push({
      x: gx + (Math.random() - 0.5) * 0.4,
      y: gy + (Math.random() - 0.5) * 0.4,
      loot: item,
      cd: 1.5,
    });
    sfx.drop();
  }

  clickAt(tileX: number, tileY: number): void {
    if (this.screen !== 'playing') return;
    const enemy = this.enemyAt(tileX, tileY);
    if (enemy) {
      this.targetEnemy = enemy;
      return;
    }
    this.targetEnemy = null;
    const tx = Math.floor(tileX);
    const ty = Math.floor(tileY);
    if (!isWalkable(this.dungeon, tx, ty)) return;
    const path = findPath(this.dungeon, this.playerTile(), { x: tx, y: ty });
    if (path) this.player.path = path;
  }

  /**
   * Held-button movement: repath toward the cursor, or sidle toward it
   * when it hovers a wall or unreachable spot. Called on a throttle while
   * the left button is down.
   */
  holdMove(tileX: number, tileY: number): void {
    if (this.screen !== 'playing') return;
    const enemy = this.enemyAt(tileX, tileY);
    if (enemy) {
      this.targetEnemy = enemy;
      return;
    }
    this.targetEnemy = null;
    const from = this.playerTile();
    const tx = Math.floor(tileX);
    const ty = Math.floor(tileY);
    if (isWalkable(this.dungeon, tx, ty)) {
      if (tx === from.x && ty === from.y) return;
      const path = findPath(this.dungeon, from, { x: tx, y: ty });
      if (path) {
        this.player.path = path;
        return;
      }
    }
    // Step to whichever neighbor best matches the cursor direction.
    const vx = tileX - (from.x + 0.5);
    const vy = tileY - (from.y + 0.5);
    const vlen = Math.hypot(vx, vy);
    if (vlen < 0.4) return;
    let bestDot = 0.1;
    let best: Point | null = null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (!isWalkable(this.dungeon, from.x + dx, from.y + dy)) continue;
        if (dx !== 0 && dy !== 0) {
          if (!isWalkable(this.dungeon, from.x + dx, from.y) || !isWalkable(this.dungeon, from.x, from.y + dy)) {
            continue;
          }
        }
        const dot = (dx * vx + dy * vy) / (Math.hypot(dx, dy) * vlen);
        if (dot > bestDot) {
          bestDot = dot;
          best = { x: from.x + dx, y: from.y + dy };
        }
      }
    }
    if (best) this.player.path = [best];
  }

  enemyAt(tileX: number, tileY: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = 0.75;
    for (const e of this.enemies) {
      const d = Math.hypot(tileX - (e.x + 0.5), tileY - (e.y + 0.5));
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  keyMove(dx: number, dy: number): void {
    if (this.screen !== 'playing') return;
    this.targetEnemy = null;
    const t = this.playerTile();
    const nx = t.x + dx;
    const ny = t.y + dy;
    if (!isWalkable(this.dungeon, nx, ny)) return;
    if (dx !== 0 && dy !== 0) {
      if (!isWalkable(this.dungeon, t.x + dx, t.y) || !isWalkable(this.dungeon, t.x, t.y + dy)) return;
    }
    this.player.path = [{ x: nx, y: ny }];
  }

  /** Cast the equipped spell; novas ignore the target, aimed spells use it. */
  castSpell(tileX: number, tileY: number): void {
    if (this.screen !== 'playing') return;
    const p = this.player;
    const id: SpellId = p.spell.spell ?? 'frostnova';
    if (this.novaCd > 0 || p.mana < SPELLS[id].cost) return;
    p.mana -= SPELLS[id].cost;
    this.novaCd = 0.6;

    // Aim direction for targeted spells.
    let dx = tileX - p.x;
    let dy = tileY - p.y;
    const dlen = Math.hypot(dx, dy);
    if (dlen < 0.01) {
      dx = p.lungeDX;
      dy = p.lungeDY;
    } else {
      dx /= dlen;
      dy /= dlen;
    }

    switch (id) {
      case 'frostnova':
        this.effects.push({ kind: 'nova', x: p.x, y: p.y, r: NOVA_RADIUS, t: 0, color: '190,222,238' });
        sfx.nova();
        for (const e of [...this.enemies]) {
          if (Math.hypot(e.x - p.x, e.y - p.y) <= NOVA_RADIUS) {
            e.slowT = 3;
            this.damageEnemy(e, 6 + ((Math.random() * 7) | 0) + p.level, '#9fc4d8', true);
          }
        }
        break;
      case 'firenova':
        this.effects.push({ kind: 'nova', x: p.x, y: p.y, r: NOVA_RADIUS, t: 0, color: '255,150,60' });
        sfx.firenova();
        for (const e of [...this.enemies]) {
          if (Math.hypot(e.x - p.x, e.y - p.y) <= NOVA_RADIUS) {
            this.damageEnemy(e, 11 + ((Math.random() * 9) | 0) + p.level, '#e8a25a', true);
          }
        }
        break;
      case 'fireball':
        this.projectiles.push({ x: p.x, y: p.y, vx: dx * 9, vy: dy * 9, ttl: 1.0 });
        sfx.fireball();
        break;
      case 'lightning': {
        // The bolt runs until it hits a wall, up to 8 tiles.
        let ex = p.x;
        let ey = p.y;
        for (let s = 0; s < 32; s++) {
          const nx = ex + dx * 0.25;
          const ny = ey + dy * 0.25;
          if (!isWalkable(this.dungeon, Math.round(nx), Math.round(ny))) break;
          ex = nx;
          ey = ny;
        }
        this.effects.push({ kind: 'bolt', x: p.x, y: p.y, x2: ex, y2: ey, r: 0, t: 0 });
        sfx.lightning();
        for (const e of [...this.enemies]) {
          if (segmentDist(p.x, p.y, ex, ey, e.x, e.y) <= 0.8) {
            this.damageEnemy(e, 9 + ((Math.random() * 8) | 0) + p.level, '#e8e6ff', true);
          }
        }
        break;
      }
      case 'blight':
        this.hazards.push({ x: tileX, y: tileY, r: 2.2, ttl: 4.5, maxTtl: 4.5, tickT: 0, tickEvery: 0.5 });
        sfx.blight();
        break;
      case 'blood': {
        // Rides the aim ray to the first enemy it crosses, same reach as
        // Lightning, but single-target: a burst hit, a life-drain heal, and
        // a few seconds of bleed ticks after.
        let ex = p.x;
        let ey = p.y;
        for (let s = 0; s < 24; s++) {
          const nx = ex + dx * 0.25;
          const ny = ey + dy * 0.25;
          if (!isWalkable(this.dungeon, Math.round(nx), Math.round(ny))) break;
          ex = nx;
          ey = ny;
        }
        let target: Enemy | null = null;
        let bestT = Infinity;
        for (const e of this.enemies) {
          if (segmentDist(p.x, p.y, ex, ey, e.x, e.y) > 0.8) continue;
          const t = (e.x - p.x) * dx + (e.y - p.y) * dy;
          if (t >= 0 && t < bestT) {
            bestT = t;
            target = e;
          }
        }
        this.effects.push({ kind: 'drain', x: p.x, y: p.y, x2: target?.x ?? ex, y2: target?.y ?? ey, r: 0, t: 0 });
        sfx.bloodrite();
        if (target) {
          const dmg = 10 + ((Math.random() * 8) | 0) + p.level;
          this.damageEnemy(target, dmg, '#e8555f', true);
          const heal = Math.round(dmg * 0.45);
          p.hp = Math.min(p.maxHp, p.hp + heal);
          this.dmgNums.push({ x: p.x, y: p.y, value: `+${heal}`, t: 1, color: '#e8555f' });
          target.bleedT = 3.5;
          target.bleedTick = 0.5;
        }
        break;
      }
    }
  }

  private explodeFireball(x: number, y: number): void {
    this.effects.push({ kind: 'boom', x, y, r: 1.7, t: 0, color: '255,150,60' });
    sfx.fireboom();
    for (const e of [...this.enemies]) {
      if (Math.hypot(e.x - x, e.y - y) <= 1.7) {
        this.damageEnemy(e, 14 + ((Math.random() * 11) | 0) + this.player.level, '#e8a25a', true);
      }
    }
  }

  drinkPotion(): void {
    if (this.screen !== 'playing') return;
    const p = this.player;
    if (p.potions <= 0 || p.hp >= p.maxHp) return;
    p.potions--;
    p.hp = Math.min(p.maxHp, p.hp + POTION_HEAL);
    this.dmgNums.push({ x: p.x, y: p.y, value: `+${POTION_HEAL}`, t: 1, color: '#7a9c7a' });
    sfx.potion();
  }

  restart(): void {
    if (this.screen === 'dead') this.startNewRun();
  }

  // --- simulation -------------------------------------------------------

  update(dt: number): void {
    if (this.screen === 'title' || this.screen === 'paused') return;
    this.time += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.novaCd = Math.max(0, this.novaCd - dt);
    if (this.banner.t > 0) this.banner.t -= dt;

    for (const n of this.dmgNums) n.t -= dt / 0.9;
    this.dmgNums = this.dmgNums.filter((n) => n.t > 0);
    for (const ef of this.effects) ef.t += dt / 0.55;
    this.effects = this.effects.filter((ef) => ef.t < 1);

    // Camera eases toward the player.
    const ease = Math.min(1, dt * 3.5);
    this.camX += (this.player.x - this.camX) * ease;
    this.camY += (this.player.y - this.camY) * ease;

    if (this.screen !== 'playing') return;

    // Fireballs in flight.
    this.projectiles = this.projectiles.filter((pr) => {
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.ttl -= dt;
      const hitWall = !isWalkable(this.dungeon, Math.round(pr.x), Math.round(pr.y));
      if (pr.hostile) {
        const hitPlayer = Math.hypot(this.player.x - pr.x, this.player.y - pr.y) <= 0.6;
        if (hitWall || hitPlayer || pr.ttl <= 0) {
          if (hitPlayer) this.damagePlayer(pr.dmg ?? 4);
          this.effects.push({ kind: 'boom', x: pr.x, y: pr.y, r: 1.1, t: 0, color: '110,180,220' });
          return false;
        }
        return true;
      }
      const hitEnemy = this.enemies.some((e) => e.hp > 0 && Math.hypot(e.x - pr.x, e.y - pr.y) <= 0.7);
      if (hitWall || hitEnemy || pr.ttl <= 0) {
        this.explodeFireball(pr.x, pr.y);
        return false;
      }
      return true;
    });

    // Plague Bloom hazards — tick damage (and a slow) to anyone standing
    // inside, until they expire. A boss's hazard is `hostile`: it hurts the
    // player instead of enemies.
    this.hazards = this.hazards.filter((hz) => {
      hz.ttl -= dt;
      if (hz.ttl <= 0) return false;
      hz.tickT -= dt;
      if (hz.tickT <= 0) {
        hz.tickT = hz.tickEvery;
        if (hz.hostile) {
          if (Math.hypot(this.player.x - hz.x, this.player.y - hz.y) <= hz.r) {
            this.damagePlayer(3 + ((Math.random() * 3) | 0));
            sfx.blightTick();
          }
        } else {
          let hitSomething = false;
          for (const e of [...this.enemies]) {
            if (Math.hypot(e.x - hz.x, e.y - hz.y) <= hz.r) {
              e.slowT = Math.max(e.slowT, 0.6);
              this.damageEnemy(e, 3 + ((Math.random() * 3) | 0) + Math.floor(this.player.level / 2), '#a8c97a', true);
              hitSomething = true;
            }
          }
          if (hitSomething) sfx.blightTick();
        }
      }
      return true;
    });

    this.updatePlayer(dt);
    for (const e of this.enemies) this.updateEnemy(e, dt);
    this.enemies = this.enemies.filter((e) => e.hp > 0);

    // Mark torchlit tiles as explored.
    const d = this.dungeon;
    const px = this.player.x;
    const py = this.player.y;
    const r = 8;
    for (let y = Math.max(0, Math.floor(py - r)); y <= Math.min(d.h - 1, Math.ceil(py + r)); y++) {
      for (let x = Math.max(0, Math.floor(px - r)); x <= Math.min(d.w - 1, Math.ceil(px + r)); x++) {
        if (Math.hypot(x - px, y - py) < r) d.explored[y * d.w + x] = true;
      }
    }
  }

  private playerTile(): Point {
    return { x: Math.round(this.player.x), y: Math.round(this.player.y) };
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    p.attackTimer = Math.max(0, p.attackTimer - dt);
    p.lunge = Math.max(0, p.lunge - dt * 4);
    p.flash = Math.max(0, p.flash - dt);
    p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);
    p.mana = Math.min(p.maxMana, p.mana + p.manaRegen * dt);
    this.playerRepath -= dt;

    const target = this.targetEnemy;
    if (target && target.hp > 0) {
      const dist = Math.hypot(target.x - p.x, target.y - p.y);
      if (dist <= ATTACK_RANGE) {
        p.path = [];
        if (p.attackTimer <= 0) {
          p.attackTimer = p.attackCd;
          p.lunge = 1;
          const len = Math.max(0.001, dist);
          p.lungeDX = (target.x - p.x) / len;
          p.lungeDY = (target.y - p.y) / len;
          sfx.swing();
          this.damageEnemy(target, rollDamage(p));
          if (p.weapon.lifeOnHit) {
            p.hp = Math.min(p.maxHp, p.hp + p.weapon.lifeOnHit);
          }
          if (p.weapon.bleedChance && Math.random() < p.weapon.bleedChance && target.hp > 0) {
            target.bleedT = 3;
            target.bleedTick = Math.min(target.bleedTick || 0.5, 0.5);
          }
        }
      } else if (this.playerRepath <= 0) {
        this.playerRepath = 0.35;
        const path = findPath(this.dungeon, this.playerTile(), {
          x: Math.round(target.x),
          y: Math.round(target.y),
        });
        if (path) p.path = path;
      }
    } else if (target) {
      this.targetEnemy = null;
    }

    if (this.followPath(p, dt)) {
      p.walkPhase += dt * p.speed * 2.5;
    }

    // Loot underfoot is scooped up (freshly dropped items are locked out).
    for (const g of this.groundItems) {
      if (g.cd !== undefined && g.cd > 0) g.cd -= dt;
    }
    this.groundItems = this.groundItems.filter((g) => {
      if (g.cd !== undefined && g.cd > 0) return true;
      if (Math.hypot(g.x - p.x, g.y - p.y) > 0.6) return true;
      if (g.loot === 'potion') {
        if (p.potions >= BELT_SIZE) return true;
        p.potions++;
        this.dmgNums.push({ x: p.x, y: p.y, value: 'potion', t: 1, color: '#7a9c7a' });
      } else {
        p.inventory.push(g.loot);
        this.dmgNums.push({ x: p.x, y: p.y, value: g.loot.name, t: 1, color: '#d8dce2' });
      }
      sfx.pickup();
      return false;
    });

    // Standing on the stairs sends you down.
    const t = this.playerTile();
    if (
      p.path.length === 0 &&
      this.dungeon.tiles[t.y * this.dungeon.w + t.x] === Tile.Stairs &&
      Math.hypot(p.x - t.x, p.y - t.y) < 0.2
    ) {
      sfx.stairs();
      this.enterDepth(this.depth + 1, false);
      const sub = this.depth % 5 === 0 ? 'something stirs in the dark' : '';
      this.banner = { text: `DEPTH ${roman(this.depth)}`, sub, t: 3 };
      this.records.bestDepth = Math.max(this.records.bestDepth, this.depth);
      saveRecords(this.records);
      this.checkpoint();
    }
  }

  private updateEnemy(e: Enemy, dt: number): void {
    const p = this.player;
    e.attackTimer = Math.max(0, e.attackTimer - dt);
    e.lunge = Math.max(0, e.lunge - dt * 4);
    e.flash = Math.max(0, e.flash - dt);
    e.slowT = Math.max(0, e.slowT - dt);
    if (e.bleedT > 0) {
      e.bleedT -= dt;
      e.bleedTick -= dt;
      if (e.bleedTick <= 0) {
        e.bleedTick = 0.5;
        this.damageEnemy(e, 2 + ((Math.random() * 3) | 0), '#e8555f', true);
      }
    }
    e.repathTimer -= dt;
    const slowMul = e.slowT > 0 ? 0.35 : 1;

    const dist = Math.hypot(p.x - e.x, p.y - e.y);
    if (!e.aggro && dist < e.sight) {
      e.aggro = true;
      if (e.kind === 'boss') sfx.bossRoar();
    }
    if (!e.aggro) return;

    if (e.kind === 'boss') this.updateBossPowers(e, dt, dist);
    if (e.kind === 'volva') {
      this.updateVolva(e, dt, dist, slowMul);
      return;
    }
    if (e.kind === 'brute') {
      this.updateBrute(e, dt, dist, slowMul);
      return;
    }

    // Enrage: below 30% hp a boss hits faster and harder, with a visual
    // tell (see drawEnemy) instead of a silent stat bump.
    const enraged = e.kind === 'boss' && e.hp / e.maxHp <= 0.3;
    if (dist <= ATTACK_RANGE * 0.93) {
      e.path = [];
      if (e.attackTimer <= 0) {
        e.attackTimer = (e.attackCd / slowMul) * (enraged ? 0.7 : 1);
        e.lunge = 1;
        const len = Math.max(0.001, dist);
        e.lungeDX = (p.x - e.x) / len;
        e.lungeDY = (p.y - e.y) / len;
        this.damagePlayer(Math.round(rollDamage(e) * (enraged ? 1.3 : 1)));
      }
    } else {
      this.chaseTowardPlayer(e);
    }

    const moveMul = slowMul * (enraged ? 1.3 : 1);
    if (this.followPath(e, dt * moveMul)) {
      e.walkPhase += dt * moveMul * e.speed * 2.5;
    }
  }

  /** Recomputes a path to the player if the repath cooldown allows —
   * shared by every enemy kind that ends up chasing on foot. */
  private chaseTowardPlayer(e: Enemy): void {
    if (e.repathTimer > 0) return;
    e.repathTimer = 0.5 + Math.random() * 0.3;
    const p = this.player;
    const blocked = new Set<number>();
    for (const other of this.enemies) {
      if (other !== e && other.hp > 0) {
        blocked.add(Math.round(other.y) * this.dungeon.w + Math.round(other.x));
      }
    }
    const path = findPath(
      this.dungeon,
      { x: Math.round(e.x), y: Math.round(e.y) },
      { x: Math.round(p.x), y: Math.round(p.y) },
      blocked,
    );
    if (path) e.path = path;
  }

  /** Völva: keeps its distance and lobs a hostile frost bolt when the
   * player sits in its comfortable cast range. */
  private updateVolva(e: Enemy, dt: number, dist: number, slowMul: number): void {
    const p = this.player;
    const KEEP_DIST = 3.5;
    const CAST_RANGE = 6.5;
    if (dist < KEEP_DIST) {
      e.path = [];
      if (e.repathTimer <= 0) {
        e.repathTimer = 0.4;
        const len = Math.max(0.001, dist);
        const awayX = e.x + ((e.x - p.x) / len) * 3;
        const awayY = e.y + ((e.y - p.y) / len) * 3;
        const path = findPath(
          this.dungeon,
          { x: Math.round(e.x), y: Math.round(e.y) },
          { x: Math.round(awayX), y: Math.round(awayY) },
        );
        if (path) e.path = path;
      }
    } else if (dist > CAST_RANGE) {
      this.chaseTowardPlayer(e);
    } else {
      e.path = [];
      if (e.attackTimer <= 0) {
        e.attackTimer = e.attackCd / slowMul;
        e.lunge = 1;
        const len = Math.max(0.001, dist);
        e.lungeDX = (p.x - e.x) / len;
        e.lungeDY = (p.y - e.y) / len;
        this.projectiles.push({
          x: e.x,
          y: e.y,
          vx: e.lungeDX * 6,
          vy: e.lungeDY * 6,
          ttl: 2,
          hostile: true,
          dmg: rollDamage(e),
        });
        sfx.lightning();
      }
    }
    if (this.followPath(e, dt * slowMul)) {
      e.walkPhase += dt * slowMul * e.speed * 2.5;
    }
  }

  /** Brute: telegraphs its slam with a windup the player can dodge out of,
   * instead of an instant hit — the reward for spotting the tell. */
  private updateBrute(e: Enemy, dt: number, dist: number, slowMul: number): void {
    const p = this.player;
    const SLAM_RANGE = 1.7;
    if (e.windupT > 0) {
      e.windupT -= dt;
      e.path = [];
      if (e.windupT <= 0) {
        if (Math.hypot(p.x - e.x, p.y - e.y) <= SLAM_RANGE) {
          this.damagePlayer(rollDamage(e));
        }
        this.effects.push({ kind: 'boom', x: e.x, y: e.y, r: SLAM_RANGE, t: 0, color: '190,60,50' });
        sfx.fireboom();
        e.attackTimer = e.attackCd / slowMul;
      }
      return;
    }
    if (dist <= SLAM_RANGE * 1.05) {
      e.path = [];
      if (e.attackTimer <= 0) {
        e.windupT = 0.7;
        e.lunge = 0.5;
        const len = Math.max(0.001, dist);
        e.lungeDX = (p.x - e.x) / len;
        e.lungeDY = (p.y - e.y) / len;
      }
    } else {
      this.chaseTowardPlayer(e);
    }
    if (this.followPath(e, dt * slowMul)) {
      e.walkPhase += dt * slowMul * e.speed * 2.5;
    }
  }

  /** Boss-only: an occasional hostile Plague-Bloom-style pool at the
   * player's feet, on top of its normal melee behavior. */
  private updateBossPowers(e: Enemy, dt: number, dist: number): void {
    e.hazardCd = Math.max(0, e.hazardCd - dt);
    if (e.hazardCd <= 0 && dist < 9) {
      e.hazardCd = 5 + Math.random() * 2.5;
      const p = this.player;
      this.hazards.push({
        x: Math.round(p.x),
        y: Math.round(p.y),
        r: 1.7,
        ttl: 3.5,
        maxTtl: 3.5,
        tickT: 0,
        tickEvery: 0.5,
        hostile: true,
      });
      sfx.blight();
    }
  }

  private followPath(e: Entity, dt: number): boolean {
    if (e.path.length === 0) return false;
    const n = e.path[0];
    const dx = n.x - e.x;
    const dy = n.y - e.y;
    const d = Math.hypot(dx, dy);
    const step = e.speed * dt;
    if (d <= step) {
      e.x = n.x;
      e.y = n.y;
      e.path.shift();
    } else {
      e.x += (dx / d) * step;
      e.y += (dy / d) * step;
    }
    return true;
  }

  private damageEnemy(e: Enemy, dmg: number, color = '#d8dce2', silent = false): void {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    e.flash = 0.15;
    e.aggro = true;
    this.dmgNums.push({ x: e.x, y: e.y, value: String(dmg), t: 1, color });
    if (!silent) sfx.hit();
    if (e.hp <= 0) {
      this.kills++;
      this.corpses.push({ x: Math.round(e.x), y: Math.round(e.y), kind: e.kind, seed: Math.random() });
      if (this.targetEnemy === e) this.targetEnemy = null;
      if (this.hoverEnemy === e) this.hoverEnemy = null;
      for (const loot of rollDrops(this.depth, e.kind === 'boss' || !!e.rare)) {
        this.groundItems.push({
          x: Math.round(e.x) + (Math.random() - 0.5) * 0.7,
          y: Math.round(e.y) + (Math.random() - 0.5) * 0.7,
          loot,
        });
      }
      this.gainXp(e.xpValue);
      sfx.enemyDie();
      if (e.rare) this.banner = { text: e.name, sub: 'a rare foe falls', t: 2.4 };
    }
  }

  private gainXp(v: number): void {
    const p = this.player;
    p.xp += v;
    while (p.xp >= xpNext(p.level)) {
      p.xp -= xpNext(p.level);
      p.level++;
      p.maxHp += 12;
      p.hp = p.maxHp;
      p.maxMana += 6;
      p.mana = p.maxMana;
      recalcStats(p);
      this.effects.push({ kind: 'levelup', x: p.x, y: p.y, r: 1.6, t: 0 });
      this.dmgNums.push({ x: p.x, y: p.y, value: 'LEVEL UP', t: 1, color: '#e8e2c8' });
      sfx.levelup();
    }
  }

  private damagePlayer(dmg: number): void {
    const p = this.player;
    const dealt = Math.max(1, dmg - (p.armor?.armor ?? 0) - (p.trinket?.armor ?? 0));
    p.hp -= dealt;
    p.flash = 0.15;
    this.hurtFlash = 0.35;
    this.dmgNums.push({ x: p.x, y: p.y, value: String(dealt), t: 1, color: '#8c2a2a' });
    sfx.playerHurt();
    if (p.hp <= 0) {
      p.hp = 0;
      this.screen = 'dead';
      this.records.deaths++;
      this.records.bestDepth = Math.max(this.records.bestDepth, this.depth);
      this.records.bestKills = Math.max(this.records.bestKills, this.kills);
      saveRecords(this.records);
      clearRun();
      this.savedRun = null;
      sfx.playerDie();
    }
  }
}

/** Distance from point (px, py) to the segment (x1, y1)-(x2, y2). */
function segmentDist(x1: number, y1: number, x2: number, y2: number, px: number, py: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
