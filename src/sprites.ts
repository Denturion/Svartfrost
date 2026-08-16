// SpriteRenderer for the layered isometric_hero pack (public/isometric_hero/).
// The pack ships with zero documentation — no README, no config, no license.
// Frame grid (128x128px, 32 timeline columns x 8 direction rows), the
// animation column layout, and the row->direction order below were all
// confirmed by hand via debug/spritesheet-viewer.html and are recorded in
// memory (isometric-hero-spritesheet-layout) so this doesn't need
// re-deriving. Do not change these numbers without re-verifying in that
// viewer.
//
// Strictly additive: render.ts's existing procedural drawPlayer() is left
// completely untouched and is still what draws every entity kind this
// module doesn't cover (which, for now, is every enemy — the pack is a
// single humanoid hero, it has nothing that fits a draugr/wretch/boss/etc).
// The call site picks sprite vs. vector per entity, per frame, based on
// spritesReady() below.

import { TILE_H, TILE_W } from './config';
import type { Player } from './types';

const FRAME = 128;

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

// --- animation state: frame index derives purely from game time, never a
// per-render counter, so playback speed can't drift with the frame rate. ---

function pickPlayerSegment(p: Player): { seg: Segment; fps: number } {
  if (p.lunge > 0) return { seg: SEGMENTS.swing, fps: 16 };
  if (p.castT > 0) return { seg: SEGMENTS.cast, fps: 16 };
  if (p.flash > 0) return { seg: SEGMENTS.hitDie, fps: 12 };
  if (p.path.length > 0) return { seg: SEGMENTS.running, fps: 10 };
  return { seg: SEGMENTS.stance, fps: 4 };
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

function tintedFrame(layers: HTMLImageElement[], col: number, row: number, b: number, warm: number): HTMLCanvasElement {
  const sx = col * FRAME;
  const sy = row * FRAME;
  rawCtx.clearRect(0, 0, FRAME, FRAME);
  for (const img of layers) rawCtx.drawImage(img, sx, sy, FRAME, FRAME, 0, 0, FRAME, FRAME);

  const eff = Math.min(MAX_BRIGHTNESS, b * BRIGHTNESS_BOOST);
  // Same curve as shade() in config.ts, applied per-channel directly to the
  // pixel buffer instead of via a CSS color string + blend mode.
  const bc = eff <= 0 ? 0 : Math.pow(eff, 1.35);
  const rf = bc * (1 + 0.5 * warm);
  const gf = bc * (1 + 0.2 * warm);
  const bf = bc * (1 - 0.18 * warm);

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

// Feet sit this far down the 128px frame — measured directly off the pack
// (canvas getImageData alpha-bounds scan on clothes.png's stance frames,
// which land at 0.78-0.81 across all 8 directions), then nudged down another
// 6px per in-game visual check (still read as slightly too high at 0.8).
const ANCHOR_Y_FRAC = 0.8 - 6 / FRAME;

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
