// SpriteRenderer for the layered isometric_hero pack (public/isometric_hero/)
// plus two matching monster packs (public/isometric_draugr/,
// public/isometric_wretch/). All three ship with no in-repo docs, but all
// three are confirmed (via OpenGameArt.org) to be Clint Bellanger's Flare
// character art, CC-BY 3.0 — same 128x128px frame, same 8-direction grid,
// same render pipeline, so the same direction-row order applies to all of
// them. Column layouts differ per pack (monsters weren't built with the
// same animation set as the hero) and were read off the sheets themselves
// via debug/spritesheet-viewer.html, not assumed from the hero's layout.
//
// Strictly additive: render.ts's existing procedural drawPlayer()/
// drawEnemy() are left completely untouched and are still what draws any
// entity kind not covered here — currently every enemy kind except
// draugr/wretch (the monster packs on hand only cover those two). The call
// site picks sprite vs. vector per entity, per frame, based on
// playerSpritesReady()/enemySpritesReady() below.

import { TILE_H, TILE_W } from './config';
import type { Enemy, Player } from './types';

const FRAME = 128;

// Feet sit this far down the 128px frame. Measured directly for all three
// packs (getImageData alpha-bounds scan on each Stance frame): hero lands
// at 0.78-0.81, skeleton 0.77-0.81, zombie 0.77-0.78 — close enough to
// share one constant. Hero's raw measurement got a further 6px nudge down
// after an in-game visual check; carried over here on the assumption the
// same correction applies (same render pipeline) — revisit per-pack if a
// monster's feet don't land on its tile once it's actually on screen.
const ANCHOR_Y_FRAC = 0.8 - 6 / FRAME;

// Column ranges from the pack creator's own description (see memory);
// grid alignment against the actual sheets was confirmed in the viewer.
interface Segment {
  start: number;
  len: number;
}
const SEGMENTS = {
  stance: { start: 0, len: 4 },
  running: { start: 4, len: 8 },
  swing: { start: 12, len: 4 },
  block: { start: 16, len: 2 },
  hitDie: { start: 18, len: 6 },
  cast: { start: 24, len: 4 },
  shoot: { start: 28, len: 4 },
} satisfies Record<string, Segment>;

// Skeleton Warrior (draugr): same 32-column budget as the hero, but a
// different internal order — confirmed by hand (filmstrip screenshots of
// every column) rather than assumed, since the two packs turned out to
// disagree here. Verified segments: Stance/Walk/Attack (unambiguous from
// the animation itself); Cast/Block split within cols 16-21 is lower
// confidence (no visible cast effect to confirm against) but doesn't
// matter today — nothing here ever puts a draugr in those states.
const DRAUGR_SEGMENTS = {
  stance: { start: 0, len: 4 },
  running: { start: 4, len: 8 }, // "Walk"
  attack: { start: 12, len: 4 },
  cast: { start: 16, len: 4 },
  block: { start: 20, len: 2 },
  hitDie: { start: 22, len: 6 }, // confirmed: fully collapsed by col 27
  shoot: { start: 28, len: 4 }, // "Aim Crossbow"
} satisfies Record<string, Segment>;

// Zombie Sprites (wretch): 36 columns, its own segment set — confirmed by
// hand the same way (Slam's arms-up windup at 12-13 is unmistakable).
const WRETCH_SEGMENTS = {
  stance: { start: 0, len: 4 },
  running: { start: 4, len: 8 }, // "Lurch"
  attack: { start: 12, len: 4 }, // "Slam" — the overhand double-arm strike
  bite: { start: 16, len: 4 },
  block: { start: 20, len: 2 },
  hitDie: { start: 22, len: 6 },
  critDeath: { start: 28, len: 8 },
} satisfies Record<string, Segment>;

// --- atlas: every sheet the pack ships, loaded once at module init -------

function load(src: string): HTMLImageElement {
  const img = new Image();
  img.src = src;
  return img;
}
function ready(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

const ATLAS = {
  clothes: load('/isometric_hero/clothes.png'),
  leatherArmor: load('/isometric_hero/leather_armor.png'),
  steelArmor: load('/isometric_hero/steel_armor.png'),
  dagger: load('/isometric_hero/dagger.png'),
  shortsword: load('/isometric_hero/shortsword.png'),
  longsword: load('/isometric_hero/longsword.png'),
  greatsword: load('/isometric_hero/greatsword.png'),
  head: load('/isometric_hero/male_head1.png'),
  skeleton: load('/isometric_draugr/skeleton_0.png'),
  zombie: load('/isometric_wretch/zombie_0.png'),
};

// Only 3 armor sheets and 4 blade sheets exist for the game's 6 armor tiers
// and 7 weapon tiers, so tiers bucket down to the nearest sheet. No sprite
// sheet exists for shields/bows/staves — the game has no such equipped
// item slot (every weapon is a melee blade), so those layers aren't drawn.
function armorSheetFor(tier: number): HTMLImageElement {
  return tier <= 2 ? ATLAS.clothes : tier <= 4 ? ATLAS.leatherArmor : ATLAS.steelArmor;
}
function weaponSheetFor(tier: number): HTMLImageElement {
  return tier <= 2 ? ATLAS.dagger : tier <= 4 ? ATLAS.shortsword : tier <= 6 ? ATLAS.longsword : ATLAS.greatsword;
}

export function playerSpritesReady(p: Player): boolean {
  return ready(armorSheetFor(p.armor?.tier ?? 0)) && ready(weaponSheetFor(p.weapon.tier)) && ready(ATLAS.head);
}

// --- enemy packs: one flat (unlayered) sheet per kind, unlike the hero's
// armor/weapon/head composite — a monster's equipment is baked into its
// single render. Only kinds present here ever take the sprite path; every
// other EnemyKind keeps using the vector drawEnemy() fallback. -----------

interface EnemyPack {
  sheet: HTMLImageElement;
  segments: { stance: Segment; running: Segment; attack: Segment; hitDie: Segment };
  anchorYFrac: number;
}

// No drawShadow() call for either — like the hero, both sheets already
// bake in their own drop shadow (visible directly in the source frames).
const ENEMY_PACKS: Partial<Record<Enemy['kind'], EnemyPack>> = {
  draugr: { sheet: ATLAS.skeleton, segments: DRAUGR_SEGMENTS, anchorYFrac: ANCHOR_Y_FRAC },
  wretch: { sheet: ATLAS.zombie, segments: WRETCH_SEGMENTS, anchorYFrac: ANCHOR_Y_FRAC },
};

export function enemySpritesReady(e: Enemy): boolean {
  const pack = ENEMY_PACKS[e.kind];
  return !!pack && ready(pack.sheet);
}

// --- movement vector -> nearest of 8 screen-space directions --------------

const HW = TILE_W / 2;
const HH = TILE_H / 2;

// Row 0=West, 1=NW, 2=North, 3=NE, 4=East, 5=SE, 6=South, 7=SW — confirmed
// by hand in the viewer (see memory isometric-hero-spritesheet-layout).
function directionRow(dx: number, dy: number): number {
  const sdx = (dx - dy) * HW;
  const sdy = (dx + dy) * HH;
  let bearingDeg = (Math.atan2(sdx, -sdy) * 180) / Math.PI; // 0=screen-up, clockwise
  if (bearingDeg < 0) bearingDeg += 360;
  const bearingIdx = Math.round(bearingDeg / 45) % 8; // 0=N,1=NE,2=E,3=SE,4=S,5=SW,6=W,7=NW
  return (bearingIdx + 2) % 8;
}

// Facing vector: mid-step, the next waypoint; mid-swing/cast, the attack's
// aim (lungeDX/lungeDY, which game.ts only updates on those two events —
// it does NOT track plain walking). Fully idle, neither of those is fresh,
// so the last real direction is kept here and reused instead of falling
// back to whatever lungeDX/lungeDY happened to be left at.
let lastFacing = { dx: 1, dy: 0 };

function playerFacing(p: Player): { dx: number; dy: number } {
  if (p.path.length > 0) {
    const wp = p.path[0];
    const dx = wp.x - p.x;
    const dy = wp.y - p.y;
    if (dx !== 0 || dy !== 0) lastFacing = { dx, dy };
  } else if (p.lunge > 0 || p.castT > 0) {
    lastFacing = { dx: p.lungeDX, dy: p.lungeDY };
  }
  return lastFacing;
}

// Same idea as playerFacing, but keyed per-entity via a WeakMap since there
// can be many enemies at once (a single module-level variable only works
// for the singular player). Entries fall out on their own once an enemy
// is removed from game.enemies and nothing else references it.
const enemyFacingCache = new WeakMap<Enemy, { dx: number; dy: number }>();

function enemyFacing(e: Enemy): { dx: number; dy: number } {
  if (e.path.length > 0) {
    const wp = e.path[0];
    const dx = wp.x - e.x;
    const dy = wp.y - e.y;
    if (dx !== 0 || dy !== 0) {
      const f = { dx, dy };
      enemyFacingCache.set(e, f);
      return f;
    }
  } else if (e.lunge > 0) {
    const f = { dx: e.lungeDX, dy: e.lungeDY };
    enemyFacingCache.set(e, f);
    return f;
  }
  return enemyFacingCache.get(e) ?? { dx: e.lungeDX, dy: e.lungeDY };
}

// --- animation state: frame index derives purely from game time, never a
// per-render counter, so playback speed can't drift with the frame rate. ---

function pickPlayerSegment(p: Player): { seg: Segment; fps: number } {
  if (p.lunge > 0) return { seg: SEGMENTS.swing, fps: 16 };
  if (p.castT > 0) return { seg: SEGMENTS.cast, fps: 16 };
  if (p.flash > 0) return { seg: SEGMENTS.hitDie, fps: 12 };
  if (p.path.length > 0) return { seg: SEGMENTS.running, fps: 10 };
  return { seg: SEGMENTS.stance, fps: 4 };
}

function pickEnemySegment(e: Enemy, pack: EnemyPack): { seg: Segment; fps: number } {
  if (e.lunge > 0) return { seg: pack.segments.attack, fps: 16 };
  if (e.flash > 0) return { seg: pack.segments.hitDie, fps: 12 };
  if (e.path.length > 0) return { seg: pack.segments.running, fps: 10 };
  return { seg: pack.segments.stance, fps: 4 };
}

function frameColumn(seg: Segment, time: number, fps: number): number {
  return seg.start + (Math.floor(time * fps) % seg.len);
}

// --- tint: darken/warm each pixel's own RGB in place via getImageData,
// alpha untouched. The earlier version used tiles' multiply+destination-in
// masked-tint trick (fill the whole frame, then clip back with
// destination-in) — reported as leaving a faint ghost of the sprite's own
// silhouette to the north/northeast, which points at a composite-mode edge
// case in that two-pass bleed-then-clip approach (this project's own
// tintPath comment already flags that technique as edge-seam-prone). A
// direct per-pixel multiply can't bleed into transparent margin by
// construction — a pixel at alpha=0 is written back at alpha=0, always —
// so there's no edge case left to hit regardless of GPU/browser. Cheap
// enough live for a single 128x128 frame (16384 pixels, once per drawn
// frame, for at most one player).

const BRIGHTNESS_BOOST = 1.7; // matches tintPath in render.ts
// The sprite sheet's own colors run lighter/more saturated than the
// deliberately dark vector art, so even capping at tiles' full white (1.0)
// read as too bright standing in the player's own light. Capped a bit lower
// here — nudge if it still looks off.
const MAX_BRIGHTNESS = 0.85;

const rawCanvas = document.createElement('canvas');
rawCanvas.width = FRAME;
rawCanvas.height = FRAME;
const rawCtx = rawCanvas.getContext('2d')!;

function tintedFrame(
  layers: HTMLImageElement[],
  col: number,
  row: number,
  b: number,
  warm: number,
  rareTint?: string, // "r,g,b" — same field render.ts's vector rare tint already uses
): HTMLCanvasElement {
  const sx = col * FRAME;
  const sy = row * FRAME;
  rawCtx.clearRect(0, 0, FRAME, FRAME);
  for (const img of layers) rawCtx.drawImage(img, sx, sy, FRAME, FRAME, 0, 0, FRAME, FRAME);

  const eff = Math.min(MAX_BRIGHTNESS, b * BRIGHTNESS_BOOST);
  // Same curve as shade() in config.ts, applied per-channel directly to the
  // pixel buffer instead of via a CSS color string + blend mode.
  const bc = eff <= 0 ? 0 : Math.pow(eff, 1.35);
  let rf = bc * (1 + 0.5 * warm);
  let gf = bc * (1 + 0.2 * warm);
  let bf = bc * (1 - 0.18 * warm);

  // Rare mobs: the vector renderer multiply-tints the body at 50% opacity
  // with the roll's color (see render.ts's `if (e.rare)` block) — same math
  // here, folded into the per-channel factor instead of a second pass.
  if (rareTint) {
    const [tr, tg, tb] = rareTint.split(',').map(Number);
    rf *= 0.5 + 0.5 * (tr / 255);
    gf *= 0.5 + 0.5 * (tg / 255);
    bf *= 0.5 + 0.5 * (tb / 255);
  }

  const imgData = rawCtx.getImageData(0, 0, FRAME, FRAME);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    data[i] = data[i] * rf;
    data[i + 1] = data[i + 1] * gf;
    data[i + 2] = data[i + 2] * bf;
  }
  rawCtx.putImageData(imgData, 0, 0);
  return rawCanvas;
}

export function drawPlayerSprite(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  p: Player,
  time: number,
  brightness: number,
  warm: number,
): void {
  // No drawShadow() call here: the sheet already reads as casting a shadow
  // of its own onto the ground, so a second drawn ellipse just doubled up.
  // If that turns out to be a rendering artifact rather than actually baked
  // into the sheet, revisit — but per the user, it belongs to the sprite.
  const { seg, fps } = pickPlayerSegment(p);
  const col = frameColumn(seg, time, fps);
  const { dx, dy } = playerFacing(p);
  const row = directionRow(dx, dy);
  const layers = [armorSheetFor(p.armor?.tier ?? 0), weaponSheetFor(p.weapon.tier), ATLAS.head];
  const frame = tintedFrame(layers, col, row, brightness, warm);
  ctx.drawImage(frame, fx - FRAME / 2, fy - FRAME * ANCHOR_Y_FRAC, FRAME, FRAME);
}

// Jagged spikes ringing a rare enemy's silhouette — duplicated from
// render.ts's drawRareSpikes (not imported, same reasoning as drawShadow
// there: importing from render.ts would create a render.ts <-> sprites.ts
// cycle, since render.ts already imports from this module). Draws around
// the local origin, so the caller must translate to (fx, fy) first.
function drawRareSpikesLocal(ctx: CanvasRenderingContext2D, seed: number): void {
  const n = 6;
  ctx.fillStyle = '#14151a';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed * Math.PI * 2;
    const nx = Math.cos(a);
    const ny = Math.sin(a) * 0.55;
    const rx = nx * 9;
    const ry = ny * 16 - 11;
    const len = 5 + ((Math.sin(seed * 91 + i * 17) + 1) / 2) * 3.5;
    const tx = -ny;
    const ty = nx;
    ctx.beginPath();
    ctx.moveTo(rx - tx * 1.8, ry - ty * 1.8);
    ctx.lineTo(rx + nx * len, ry + ny * len);
    ctx.lineTo(rx + tx * 1.8, ry + ty * 1.8);
    ctx.closePath();
    ctx.fill();
  }
}

export function drawEnemySprite(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  e: Enemy,
  time: number,
  brightness: number,
  warm: number,
): void {
  const pack = ENEMY_PACKS[e.kind]!;
  const { seg, fps } = pickEnemySegment(e, pack);
  const col = frameColumn(seg, time, fps);
  const { dx, dy } = enemyFacing(e);
  const row = directionRow(dx, dy);
  const frame = tintedFrame([pack.sheet], col, row, brightness, warm, e.rare?.tint);

  // Same rare-mob size bump the vector renderer uses (see drawEnemy's
  // `scale` local) — no boss/brute sprites yet, so only the rare case
  // actually applies here today.
  const scale = e.rare ? 1.2 : 1;
  const dw = FRAME * scale;
  const dh = FRAME * scale;
  ctx.drawImage(frame, fx - dw / 2, fy - dh * pack.anchorYFrac, dw, dh);

  // Status overlays — ported straight from drawEnemy's vector path, which
  // draws these at a local (0,-12)-ish origin inside a translate(fx,fy) +
  // scale(scale,scale) block; reproduced the same way here so a rare's
  // spikes/tint ellipse and a slowed/bleeding/just-hit glow all line up
  // with the sprite exactly like they do with the vector body.
  if (e.rare || e.slowT > 0 || e.bleedT > 0 || e.flash > 0) {
    ctx.save();
    ctx.translate(fx, fy);
    ctx.scale(scale, scale);
    if (e.rare) drawRareSpikesLocal(ctx, e.rare.seed);
    if (e.slowT > 0) {
      ctx.fillStyle = `rgba(150,200,225,${Math.min(0.35, e.slowT * 0.18)})`;
      ctx.beginPath();
      ctx.ellipse(0, -12, 10, 14, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (e.bleedT > 0) {
      for (let i = 0; i < 3; i++) {
        const dropSeed = i * 47 + Math.floor(e.bleedT * 3);
        const fall = (time * 1.8 + dropSeed) % 1;
        const bx = (Math.sin(dropSeed) - 0.5) * 8;
        ctx.fillStyle = `rgba(190,20,30,${(1 - fall) * 0.75})`;
        ctx.beginPath();
        ctx.arc(bx, -10 + fall * 12, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (e.flash > 0) {
      ctx.fillStyle = `rgba(230,235,242,${Math.min(0.6, e.flash * 4)})`;
      ctx.beginPath();
      ctx.ellipse(0, -12, 10, 13, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (e.hp < e.maxHp) {
    const bw = 18 * scale;
    const by = fy - 40 * scale;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(fx - bw / 2, by, bw, 3);
    ctx.fillStyle = '#8c2a2a';
    ctx.fillRect(fx - bw / 2, by, (bw * e.hp) / e.maxHp, 3);
  }
}
