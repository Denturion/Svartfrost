import {
  EXPLORED_BRIGHTNESS,
  FONT_GOTHIC,
  LIGHT_RADIUS,
  PALETTE,
  TILE_H,
  TILE_W,
  WALL_H,
  ZOOM,
  roman,
  shade,
  tileHash,
} from './config';
import { Tile } from './dungeon';
import type { Dungeon } from './dungeon';
import type { Game } from './game';
import { POTION_HEAL } from './game';
import {
  floorImg,
  playerClothImg,
  playerSkinImg,
  playerSteelImg,
  playerTexturesReady,
  texturesReady,
  wallFrostImg,
  wallStoneImg,
} from './textures';
import { describeItem, itemStatLine } from './items';
import type { Item, Loot } from './items';
import { isoX, isoY, screenToTile } from './iso';
import { hudLayout, hudScale, invMetrics, invPanelRect, pauseVolumeLayout, titleMenu } from './ui';
import { isTouchDevice } from './device';
import { getVolume } from './sound';
import { SPELLS } from './spells';
import { xpNext } from './entities';
import type { Enemy, Player } from './types';

const HW = TILE_W / 2;
const HH = TILE_H / 2;

// Tiles this far (chebyshev) from the player are redrawn live each frame;
// everything else comes from the cached explored-world canvas.
const DYNAMIC_RANGE = 13;

export interface View {
  w: number;
  h: number;
  mouseX: number;
  mouseY: number;
  fps?: number;
}

export function getCamOffset(game: Game, w: number, h: number): { offX: number; offY: number } {
  return {
    offX: w / 2 - isoX(game.camX, game.camY),
    offY: h / 2 - isoY(game.camX, game.camY) - 30,
  };
}

// Touch play happens on much smaller viewports, where the desktop zoom
// level shows too little of the surrounding room to see enemies coming —
// pull back slightly so mobile isn't as claustrophobic.
const VIEW_ZOOM = isTouchDevice ? 1.15 : ZOOM;

/** Inverts the render loop's zoom-about-center transform, so screen-space
 * mouse coordinates land on the same tile the player sees under the cursor. */
export function screenToWorldTile(
  mouseX: number,
  mouseY: number,
  offX: number,
  offY: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const wx = w / 2 + (mouseX - w / 2) / VIEW_ZOOM;
  const wy = h / 2 + (mouseY - h / 2) / VIEW_ZOOM;
  return screenToTile(wx - offX, wy - offY);
}

let flickNow = 1;
let torchFlickNow = 1;
/** Warmth (0 = cold player light, 1 = pure torchlight) of the last lightAt call. */
let outWarm = 0;

function brightnessAt(game: Game, x: number, y: number): number {
  const d = Math.hypot(x - game.player.x, y - game.player.y);
  const t = Math.max(0, 1.25 - d / LIGHT_RADIUS);
  // Squared falloff: a harder pool edge instead of a smooth linear fade.
  const b = t * t * flickNow;
  return Math.max(0, Math.min(1, b));
}

const TORCH_RADIUS = 4;
const TORCH_POWER = 0.85;

function torchLight(d: Dungeon, x: number, y: number): number {
  let tb = 0;
  for (const t of d.torches) {
    const dx = x - t.lx;
    if (dx > TORCH_RADIUS || dx < -TORCH_RADIUS) continue;
    const dy = y - t.ly;
    if (dy > TORCH_RADIUS || dy < -TORCH_RADIUS) continue;
    const raw = Math.max(0, 1 - Math.hypot(dx, dy) / TORCH_RADIUS);
    const fall = raw * raw * TORCH_POWER;
    if (fall > tb) tb = fall;
  }
  return Math.max(0, tb);
}

/** Combined player + torch light; sets `outWarm` as a side channel. */
function lightAt(game: Game, x: number, y: number): number {
  const pb = brightnessAt(game, x, y);
  const tb = torchLight(game.dungeon, x, y) * torchFlickNow;
  outWarm = tb > 0.01 ? Math.min(1, tb / (tb + pb + 0.001)) : 0;
  return Math.min(1, Math.max(pb, tb));
}

/** Light for the cached explored-world canvas: dim ambient + steady torches. */
function staticLightAt(d: Dungeon, x: number, y: number): number {
  const tb = torchLight(d, x, y) * 0.92;
  outWarm = tb > 0.01 ? Math.min(1, tb / (tb + EXPLORED_BRIGHTNESS + 0.001)) : 0;
  return Math.max(EXPLORED_BRIGHTNESS, tb);
}

function diamond(ctx: CanvasRenderingContext2D, px: number, py: number, s = 1): void {
  ctx.beginPath();
  ctx.moveTo(px, py + HH - HH * s);
  ctx.lineTo(px + HW * s, py + HH);
  ctx.lineTo(px, py + HH + HH * s);
  ctx.lineTo(px - HW * s, py + HH);
  ctx.closePath();
}

// --- photo textures ---------------------------------------------------
// AI-generated stone photography, affine-warped onto the current path's
// destination triangle (p0 = source top-left, p1 = source top-right,
// p2 = source bottom-left; the fourth corner is implied since the
// destination is a true parallelogram). Caller clips to the real shape
// first so a non-parallelogram quad still can't bleed past its edges.
function drawWarpedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
): void {
  ctx.save();
  ctx.transform((p1[0] - p0[0]) / sw, (p1[1] - p0[1]) / sw, (p2[0] - p0[0]) / sh, (p2[1] - p0[1]) / sh, p0[0], p0[1]);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.restore();
}

/** Multiply-tints whatever the current path covers to match torch/player light. */
function tintPath(ctx: CanvasRenderingContext2D, b: number, warm: number): void {
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = shade([255, 255, 255], Math.min(1, b * 1.7), warm);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

// The masked tint (drawing through a bitmap's own alpha with
// destination-in — see the old tintedBlit) is the only way that's been
// found so far to tint a baked tile without a bright seam at its edge,
// but doing it live, every frame, per tile, is what made the frame budget
// explode: each call switches globalCompositeOperation multiple times on
// a small canvas, and that switch is expensive in Canvas2D. The fix is to
// stop doing it live at all — pre-bake a handful of already-tinted copies
// of each tile, once, at bake time (when the extra cost is a one-time,
// off-the-hot-path expense), and have the per-frame path be a plain
// drawImage that just picks the nearest one. No compositing switches, no
// getImageData, nothing but a blit, in the render loop.
//
// Each tile is flat-shaded at one bucket for its whole area, so simply
// picking the nearest bucket made torch flicker (which nudges brightness
// a little every frame) visibly snap a tile between two levels, and made
// faint seams appear wherever two neighboring tiles landed in different
// buckets. Rather than push the bucket count up further to shrink those
// steps, drawWallBlock/drawFloorTile cross-fade the two buckets straddling
// the live brightness with globalAlpha (see brightnessBlend) — cheap
// (one extra plain drawImage, no compositing-mode switch) and exact,
// since both bitmaps share the identical shape/alpha mask, so there's no
// edge-bleed risk in blending them. That lets the bucket count stay small.
const BRIGHTNESS_LEVELS = 8;

/** Effective (post-curve) brightness a bucket index represents, 0..1. */
function levelBrightness(i: number): number {
  return i / (BRIGHTNESS_LEVELS - 1);
}

/** The two bucket indices straddling a live brightness value, and how far
 * between them it sits (0 = fully lo, 1 = fully hi). */
function brightnessBlend(b: number): { lo: number; hi: number; frac: number } {
  const eff = Math.min(1, b * 1.7);
  const t = Math.min(BRIGHTNESS_LEVELS - 1, Math.max(0, eff * (BRIGHTNESS_LEVELS - 1)));
  const lo = Math.floor(t);
  const hi = Math.min(BRIGHTNESS_LEVELS - 1, lo + 1);
  return { lo, hi, frac: t - lo };
}

/** Bakes BRIGHTNESS_LEVELS pre-tinted copies of a reference-brightness
 * tile canvas, using the masked (no-bleed) technique — safe to afford
 * here since it's one-time bake work, not per-frame.
 *
 * Warmth (torch orange vs player's cool light) isn't bucketed alongside
 * brightness — every level bakes at warm=0. Brightness is the dominant
 * visual signal and the one actually driving the frame cost, so this
 * trades away some of the torch/player color distinction for the win;
 * flag if that's noticeable and it can be revisited (e.g. a second warm
 * bucket) rather than doubling the bucket count pre-emptively.
 */
function bakeBrightnessLevels(ref: HTMLCanvasElement): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let i = 0; i < BRIGHTNESS_LEVELS; i++) {
    const c = document.createElement('canvas');
    c.width = ref.width;
    c.height = ref.height;
    const cctx = c.getContext('2d')!;
    cctx.drawImage(ref, 0, 0);
    cctx.globalCompositeOperation = 'multiply';
    cctx.fillStyle = shade([255, 255, 255], levelBrightness(i), 0);
    cctx.fillRect(0, 0, ref.width, ref.height);
    cctx.globalCompositeOperation = 'destination-in';
    cctx.drawImage(ref, 0, 0);
    cctx.globalCompositeOperation = 'source-over';
    out.push(c);
  }
  return out;
}


/** A random sub-crop of `img`, avoiding the top/bottom ~10% (ornate border bands). */
function pickWallCrop(img: HTMLImageElement, x: number, y: number, fi: number): [number, number, number, number] {
  const sw = img.width * 0.22;
  const sh = img.height * 0.32;
  const bodyTop = img.height * 0.1;
  const bodyH = img.height * 0.8 - sh;
  const sx = tileHash(x * 13 + fi * 5 + 2, y * 7 + 9) * (img.width - sw);
  const sy = bodyTop + tileHash(x * 5 + 3, y * 11 + fi * 7 + 4) * bodyH;
  return [sx, sy, sw, sh];
}

function pickFloorCrop(img: HTMLImageElement, x: number, y: number): [number, number, number, number] {
  const sw = img.width * 0.46;
  const sh = img.height * 0.46;
  const sx = tileHash(x * 9 + 2, y * 13 + 5) * (img.width - sw);
  const sy = tileHash(x * 13 + 7, y * 9 + 3) * (img.height - sh);
  return [sx, sy, sw, sh];
}

// --- baked per-tile texture cache -------------------------------------
// The affine warp (clip + transform + drawImage) is the expensive part of
// texturing a tile, but its result never changes for a given tile — only
// the brightness tint on top does, every frame, as torches flicker. So the
// warp (and everything else about the tile's static look) is baked once
// into a small set of offscreen canvases per tile — one per brightness
// bucket, see bakeBrightnessLevels — and the hot per-frame path is just a
// plain drawImage blit of whichever bucket is closest to the current
// light level. No live tinting at all.
const TEX_PAD = 16;
let floorTexCache = new Map<string, HTMLCanvasElement[]>();
let wallTexCache = new Map<string, HTMLCanvasElement[]>();

function getFloorTexLevels(x: number, y: number, ao: number): HTMLCanvasElement[] {
  const key = `${x},${y}`;
  let levels = floorTexCache.get(key);
  if (levels) return levels;
  const c = document.createElement('canvas');
  c.width = TILE_W + TEX_PAD * 2;
  c.height = TILE_H + TEX_PAD * 2;
  const cctx = c.getContext('2d')!;
  const rpx = HW + TEX_PAD;
  const rpy = TEX_PAD;
  const [sx, sy, sw, sh] = pickFloorCrop(floorImg, x, y);
  diamond(cctx, rpx, rpy);
  cctx.save();
  cctx.clip();
  drawWarpedImage(cctx, floorImg, sx, sy, sw, sh, [rpx - HW, rpy + HH], [rpx, rpy], [rpx, rpy + TILE_H]);
  cctx.restore();
  // Decoration baked at reference brightness (b=1) alongside the texture —
  // this only runs once per tile instead of redrawing bones/rubble/AO/
  // runes every frame it's on screen; the brightness buckets below apply
  // to texture and decoration together.
  drawFloorDecor(cctx, rpx, rpy, x, y, 1, 0, ao);
  // Every fill/stroke above was rasterized independently, so even where
  // shapes look fully solid, antialiasing can leave microscopic partial-
  // alpha seams between them. Flattening the whole tile to fully opaque as
  // a last step — destination-over only fills gaps, it never overwrites
  // already-opaque pixels — removes them.
  cctx.globalCompositeOperation = 'destination-over';
  cctx.fillStyle = (x + y) % 2 === 0 ? shade(PALETTE.floorA, 1, 0) : shade(PALETTE.floorB, 1, 0);
  diamond(cctx, rpx, rpy);
  cctx.fill();
  cctx.globalCompositeOperation = 'source-over';
  levels = bakeBrightnessLevels(c);
  floorTexCache.set(key, levels);
  return levels;
}

// Everything about a wall tile's look that's a pure function of its (x, y)
// — masonry variant, mortar, runes, bone niches, stains, top-slab cracks,
// rubble, frost rime — is baked once at a reference brightness (bj=1,
// warm=0) alongside the photo warp, instead of redrawn with fresh
// beginPath/fill/stroke calls for every visible wall, every frame. That
// reference bake then becomes BRIGHTNESS_LEVELS pre-tinted copies (see
// bakeBrightnessLevels); drawWallBlock just blits whichever is closest to
// the current torch/player light. Torch sconce glow is baked in too, so
// it rides along with the tinting; only the flame flickers live.
function getWallTexLevels(ws: WallStyle): HTMLCanvasElement[] {
  const key = `${ws.x},${ws.y}`;
  let levels = wallTexCache.get(key);
  if (levels) return levels;
  const { hgt, jit } = ws;
  const c = document.createElement('canvas');
  c.width = TILE_W + TEX_PAD * 2;
  c.height = hgt + TILE_H + TEX_PAD * 2;
  const cctx = c.getContext('2d')!;
  const img = ws.frost ? wallFrostImg : wallStoneImg;
  const rpx = HW + TEX_PAD;
  const rpy = hgt + TEX_PAD;
  const refWs: WallStyle = { ...ws, px: rpx, py: rpy, bj: 1, warm: 0, cut: 0 };

  drawWallFaceBase(cctx, refWs);

  // The texture warp's clip has to land on the exact same jittered top
  // corners drawWallFaceBase just used underneath it — facePt() alone
  // (hgt offset only, no jitter) traces a clean parallelogram that isn't
  // where the jittered face quad's top edge actually is, leaving a thin
  // triangular sliver of the flat base color exposed at whichever corner
  // jitter pulled furthest. It went unnoticed pre-bake because the old
  // live code tinted that sliver with the same per-frame brightness as
  // the texture, so the two colors happened to track each other; baked
  // once and tinted together afterward, they don't anymore.
  const { eX, eY, sX, sY, wX, wY } = wallCorners(refWs);
  const faceTop: [[number, number], [number, number]][] = [
    [[wX, wY], [sX, sY]], // SW: top-left, top-right
    [[sX, sY], [eX, eY]], // SE
  ];
  const facesLocal: [number, number, number, number][] = [
    [rpx - HW, rpy + HH, rpx, rpy + TILE_H],
    [rpx, rpy + TILE_H, rpx + HW, rpy + HH],
  ];
  for (let fi = 0; fi < 2; fi++) {
    const [b0x, b0y, b1x, b1y] = facesLocal[fi];
    const [topLeft, topRight] = faceTop[fi];
    const bottomLeft: [number, number] = [b0x, b0y];
    const [sx, sy, sw, sh] = pickWallCrop(img, ws.x, ws.y, fi);
    cctx.beginPath();
    cctx.moveTo(b0x, b0y);
    cctx.lineTo(b1x, b1y);
    cctx.lineTo(topRight[0], topRight[1]);
    cctx.lineTo(topLeft[0], topLeft[1]);
    cctx.closePath();
    cctx.save();
    cctx.clip();
    drawWarpedImage(cctx, img, sx, sy, sw, sh, topLeft, topRight, bottomLeft);
    cctx.restore();
  }

  // Top slab, using the same jitter the live draw uses.
  const [jN, jE, jS, jW] = jit;
  const nXl = rpx + jN[0];
  const nYl = rpy - hgt + jN[1];
  const eXl = rpx + HW + jE[0];
  const eYl = rpy + HH - hgt + jE[1];
  const sXl = rpx + jS[0];
  const sYl = rpy + TILE_H - hgt + jS[1];
  const wXl = rpx - HW + jW[0];
  const wYl = rpy + HH - hgt + jW[1];
  const [tsx, tsy, tsw, tsh] = pickWallCrop(img, ws.x, ws.y, 2);
  cctx.beginPath();
  cctx.moveTo(nXl, nYl);
  cctx.lineTo(eXl, eYl);
  cctx.lineTo(sXl, sYl);
  cctx.lineTo(wXl, wYl);
  cctx.closePath();
  cctx.save();
  cctx.clip();
  drawWarpedImage(cctx, img, tsx, tsy, tsw, tsh, [wXl, wYl], [nXl, nYl], [sXl, sYl]);
  cctx.restore();

  drawWallDecor(cctx, refWs);
  // Every fill/stroke above was rasterized independently, so even where
  // shapes look fully solid, antialiasing can leave microscopic partial-
  // alpha seams between them — invisible here, but the live multiply-tint
  // pass in drawWallBlock forces any partial-alpha pixel toward the tint
  // color itself, turning every one of those seams into a bright halo
  // tracing every edge of every wall. Flattening the silhouette to fully
  // opaque as a last step — destination-over only fills gaps, it never
  // overwrites already-opaque pixels — removes them; only the true outer
  // edge against the transparent background stays (harmlessly)
  // antialiased. Done before the sconce glow so its own intentional soft
  // falloff isn't flattened away.
  //
  // The SW/SE/top-slab regions are filled as three separate calls, each
  // with its own matching tone, rather than one combined path: two
  // adjacent subpaths that trace their shared edge as part of a single
  // fill() can leave a rasterization seam exactly on that shared line
  // (a nonzero-winding-rule quirk when two boundaries coincide), which
  // defeats the whole point of this pass. Independent fills have no
  // shared edge to go wrong on.
  cctx.globalCompositeOperation = 'destination-over';
  drawWallFaceBase(cctx, refWs);
  {
    const { nX, nY, eX, eY, sX, sY, wX, wY } = wallCorners(refWs);
    cctx.fillStyle = shade(PALETTE.wallTop, 1, 0);
    cctx.beginPath();
    cctx.moveTo(nX, nY);
    cctx.lineTo(eX, eY);
    cctx.lineTo(sX, sY);
    cctx.lineTo(wX, wY);
    cctx.closePath();
    cctx.fill();
  }
  cctx.globalCompositeOperation = 'source-over';

  // The sconce's glow + bracket never change frame to frame (fixed
  // position, fixed color stops) — baked in here. Only the flame itself
  // flickers, so that stays live (see drawSconceFlame in drawWallBlock).
  if (refWs.torch) drawSconceBase(cctx, refWs, hgt);

  levels = bakeBrightnessLevels(c);
  wallTexCache.set(key, levels);
  return levels;
}

// --- floors ----------------------------------------------------------------

/** Bitmask of diamond edges bordered by walls: 1 NE, 2 SE, 4 SW, 8 NW. */
function aoMask(d: Dungeon, x: number, y: number): number {
  const wall = (nx: number, ny: number) =>
    nx < 0 || ny < 0 || nx >= d.w || ny >= d.h || d.tiles[ny * d.w + nx] === Tile.Wall;
  return (wall(x, y - 1) ? 1 : 0) | (wall(x + 1, y) ? 2 : 0) | (wall(x, y + 1) ? 4 : 0) | (wall(x - 1, y) ? 8 : 0);
}

// Diamond corners, clockwise from north: used for the AO edge wedges.
const AO_EDGES: [number, number][][] = [
  [[0, -HH], [HW, 0]], // NE: N -> E (offsets from tile center)
  [[HW, 0], [0, HH]], // SE
  [[0, HH], [-HW, 0]], // SW
  [[-HW, 0], [0, -HH]], // NW
];

// Surface dressing (bones/flagstone-cracks/rubble/ice, ambient occlusion,
// runes) is a pure function of tile position + a reference brightness — it
// never actually needs to react to the live torch flicker frame to frame,
// so it's baked once into the per-tile texture cache (see
// getFloorTexLevels) instead of redrawn with fresh beginPath/fill/stroke
// calls for every tile, every frame. Still called live from the
// pre-texture-load fallback below, where nothing is cached yet anyway.
function drawFloorDecor(ctx: CanvasRenderingContext2D, px: number, py: number, x: number, y: number, b: number, warm: number, ao: number): void {
  const cx = px;
  const cy = py + HH;

  // Surface variety, hash-picked per tile.
  const h2 = tileHash(x * 7 + 3, y * 11 + 5);
  if (h2 > 0.985 && b > 0.08) {
    // Old bones.
    ctx.strokeStyle = `rgba(200,205,212,${b * 0.5})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy + 1);
    ctx.lineTo(cx + 2, cy - 2);
    ctx.moveTo(cx - 3, cy + 3);
    ctx.lineTo(cx + 3, cy);
    ctx.stroke();
    ctx.fillStyle = `rgba(200,205,212,${b * 0.55})`;
    ctx.beginPath();
    ctx.arc(cx + 4, cy - 3, 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (h2 > 0.92 && b > 0.06) {
    // Cracked flagstone.
    ctx.strokeStyle = `rgba(0,0,0,${0.25 + b * 0.2})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 8 + h2 * 4, cy - 3);
    ctx.lineTo(cx - 2, cy + 1);
    ctx.lineTo(cx + 3, cy - 1);
    ctx.lineTo(cx + 8, cy + 3);
    ctx.stroke();
  } else if (h2 > 0.87 && b > 0.06) {
    // Rubble.
    ctx.fillStyle = shade(PALETTE.wallTop, b * 1.1, warm);
    for (let i = 0; i < 3; i++) {
      const rx = cx + (tileHash(x + i * 17, y + i * 5) - 0.5) * 20;
      const ry = cy + (tileHash(x + i * 3, y + i * 13) - 0.5) * 9;
      ctx.beginPath();
      ctx.moveTo(rx, ry - 1.6);
      ctx.lineTo(rx + 2.4, ry);
      ctx.lineTo(rx, ry + 1.6);
      ctx.lineTo(rx - 2.4, ry);
      ctx.closePath();
      ctx.fill();
    }
  } else if (h2 > 0.8 && b > 0.05) {
    // A skin of ice.
    ctx.fillStyle = `rgba(159,196,216,${0.05 + b * 0.07})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 13, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(210,232,244,${b * 0.25})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - 2);
    ctx.lineTo(cx + 2, cy + 1);
    ctx.moveTo(cx + 1, cy - 3);
    ctx.lineTo(cx + 6, cy);
    ctx.stroke();
  }

  // Ambient occlusion: floors darken along wall-adjacent edges.
  if (ao !== 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    for (let e = 0; e < 4; e++) {
      if (!(ao & (1 << e))) continue;
      const [[ax, ay], [bx2, by2]] = AO_EDGES[e];
      ctx.beginPath();
      ctx.moveTo(cx + ax, cy + ay);
      ctx.lineTo(cx + bx2, cy + by2);
      ctx.lineTo(cx + bx2 * 0.62, cy + by2 * 0.62);
      ctx.lineTo(cx + ax * 0.62, cy + ay * 0.62);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Occasional faint rune scratched into the stone.
  if (tileHash(x * 3 + 1, y * 7 + 2) > 0.96 && b > 0.1) {
    const r = tileHash(x + 13, y + 29);
    const cx = px;
    const cy = py + HH;
    ctx.strokeStyle = `rgba(190,200,210,${b * 0.16})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - 3);
    ctx.lineTo(cx + 6, cy + 3);
    ctx.moveTo(cx + 4, cy - 4);
    ctx.lineTo(cx - 4, cy + 4);
    if (r > 0.5) {
      ctx.moveTo(cx, cy - 5);
      ctx.lineTo(cx, cy + 5);
    }
    ctx.stroke();
  }
}

/** `time` null = static rendering (no animation). */
function drawFloorTile(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  x: number,
  y: number,
  b: number,
  warm: number,
  tile: Tile,
  time: number | null,
  ao: number,
): void {
  const j = 0.82 + tileHash(x, y) * 0.36;
  if (texturesReady()) {
    const levels = getFloorTexLevels(x, y, ao);
    const bx = Math.round(px - HW - TEX_PAD);
    const by = Math.round(py - TEX_PAD);
    const { lo, hi, frac } = brightnessBlend(b * j);
    ctx.drawImage(levels[lo], bx, by);
    if (frac > 0.02 && hi !== lo) {
      ctx.globalAlpha = frac;
      ctx.drawImage(levels[hi], bx, by);
      ctx.globalAlpha = 1;
    }
  } else {
    const base = (x + y) % 2 === 0 ? PALETTE.floorA : PALETTE.floorB;
    ctx.fillStyle = shade(base, b * j, warm);
    diamond(ctx, px, py);
    ctx.fill();
    drawFloorDecor(ctx, px, py, x, y, b, warm, ao);
  }

  // The stairwell glow pulses with live time, so it stays outside the bake
  // and is the one piece of "decoration" still drawn every frame — but
  // there's at most one stairs tile in view at once, so the cost is noise.
  if (tile === Tile.Stairs) {
    const pulse = time === null ? 0.3 : 0.5 + 0.5 * Math.sin(time * 2.2);
    for (let i = 1; i <= 3; i++) {
      const s = 1 - i * 0.24;
      ctx.fillStyle = `rgba(0,0,0,${0.35 + i * 0.2})`;
      ctx.beginPath();
      ctx.moveTo(px, py + HH - HH * s + i * 2);
      ctx.lineTo(px + HW * s, py + HH + i * 2);
      ctx.lineTo(px, py + HH + HH * s + i * 2);
      ctx.lineTo(px - HW * s, py + HH + i * 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = `rgba(190,200,215,${(0.25 + pulse * 0.3) * Math.max(b, 0.25)})`;
    ctx.lineWidth = 1.5;
    diamond(ctx, px, py);
    ctx.stroke();
  }
}

// --- walls ----------------------------------------------------------------

interface WallStyle {
  x: number;
  y: number;
  px: number;
  py: number;
  hgt: number;
  bj: number;
  warm: number;
  cut: number; // 0..1 — how faded this wall is to keep the player visible
  pillar: boolean;
  ruined: boolean;
  frost: boolean;
  h1: number;
  torch: 'sw' | 'se' | null;
  time: number | null;
  jit: [number, number][]; // per-corner offsets: N, E, S, W
  variant: 'brick' | 'strata' | 'rune' | 'bones';
  stain: boolean;
  accFace: 0 | 1; // which face (0 SW, 1 SE) carries rune/bone accents
}

function computeWallStyle(
  d: Dungeon,
  x: number,
  y: number,
  px: number,
  py: number,
  b: number,
  warm: number,
  cut: number,
  time: number | null,
): WallStyle {
  const h1 = tileHash(x, y);
  const orthFloor = (dx: number, dy: number) => {
    const nx = x + dx;
    const ny = y + dy;
    return nx >= 0 && ny >= 0 && nx < d.w && ny < d.h && d.tiles[ny * d.w + nx] !== Tile.Wall;
  };
  const pillar = orthFloor(1, 0) && orthFloor(-1, 0) && orthFloor(0, 1) && orthFloor(0, -1);
  const ruined = !pillar && h1 < 0.15;
  // Corner jitter disabled: it offset each wall tile's top corners
  // (rough-hewn stone look), but the baked tile cache builds a wall's flat
  // base fill and its texture-warp clip from separately-computed corner
  // math, and jitter was the one thing that could make those two disagree
  // — a real per-tile mismatch, not a rendering-precision artifact. Every
  // corner is fixed at (0, 0) instead of hashed, so there's no jitter left
  // for any two pieces of a wall to disagree about.
  const jit: [number, number][] = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  const torch = d.torches.find((t) => t.x === x && t.y === y)?.side ?? null;
  // Masonry variants: strata bands come from a coarse regional hash so whole
  // stretches read as older rock; runes and bone niches are rare accents.
  const v2 = tileHash(x * 3 + 11, y * 5 + 7);
  const region = tileHash((x >> 2) * 9 + 1, (y >> 2) * 13 + 6);
  let variant: WallStyle['variant'] = 'brick';
  if (!pillar && !ruined) {
    if (v2 < 0.05) variant = 'bones';
    else if (v2 < 0.11) variant = 'rune';
    else if (region < 0.3) variant = 'strata';
  }
  // Accents belong on a face with open floor before it, or they'd be buried.
  const swOpen = orthFloor(0, 1);
  const seOpen = orthFloor(1, 0);
  const accFace: 0 | 1 = swOpen && seOpen ? (h1 < 0.5 ? 0 : 1) : swOpen ? 0 : 1;
  return {
    x,
    y,
    px,
    py,
    hgt: ruined ? WALL_H * (0.5 + h1 * 0.9) : WALL_H * (0.92 + h1 * 0.16),
    bj: b * (0.85 + h1 * 0.3),
    warm,
    cut,
    pillar,
    ruined,
    frost: !pillar && d.frostLevel,
    h1,
    torch,
    time,
    jit,
    variant,
    stain: !pillar && tileHash(x * 17 + 2, y * 19 + 3) > 0.84,
    accFace,
  };
}

// Carved sigils for rune walls, as [u0, f0, u1, f1] segments in face coords.
const WALL_SIGILS: [number, number, number, number][][] = [
  // Algiz — the warding rune.
  [
    [0.5, 0.25, 0.5, 0.75],
    [0.5, 0.55, 0.34, 0.72],
    [0.5, 0.55, 0.66, 0.72],
  ],
  // Thurs — the thorn.
  [
    [0.5, 0.25, 0.5, 0.78],
    [0.5, 0.62, 0.66, 0.52],
    [0.66, 0.52, 0.5, 0.42],
  ],
  // Hagall — hail.
  [
    [0.36, 0.28, 0.36, 0.75],
    [0.64, 0.28, 0.64, 0.75],
    [0.36, 0.45, 0.64, 0.58],
  ],
  // Kaunan — the torch.
  [
    [0.45, 0.25, 0.45, 0.75],
    [0.45, 0.55, 0.62, 0.68],
  ],
];

/** Point on a face parallelogram: u along the bottom edge, f up the height. */
function facePt(
  b0x: number,
  b0y: number,
  b1x: number,
  b1y: number,
  u: number,
  f: number,
  hgt: number,
): [number, number] {
  return [b0x + (b1x - b0x) * u, b0y + (b1y - b0y) * u - hgt * f];
}

/** Jittered top-slab corners (N, E, S, W), shared by the base fill, the
 * decoration bake, and the live combined-tint shape. */
function wallCorners(
  ws: WallStyle,
): { nX: number; nY: number; eX: number; eY: number; sX: number; sY: number; wX: number; wY: number } {
  const { px, py, hgt } = ws;
  const [jN, jE, jS, jW] = ws.jit;
  return {
    nX: px + jN[0],
    nY: py - hgt + jN[1],
    eX: px + HW + jE[0],
    eY: py + HH - hgt + jE[1],
    sX: px + jS[0],
    sY: py + TILE_H - hgt + jS[1],
    wX: px - HW + jW[0],
    wY: py + HH - hgt + jW[1],
  };
}

/** Flat base fills behind the SW/SE faces — visible at the warped photo
 * texture's antialiased edges, fully covered everywhere else once it
 * blits on top. */
function drawWallFaceBase(ctx: CanvasRenderingContext2D, ws: WallStyle): void {
  const { px, py, bj, warm } = ws;
  const { sX, sY, wX, wY, eX, eY } = wallCorners(ws);
  ctx.fillStyle = shade(PALETTE.wallLeft, bj, warm);
  ctx.beginPath();
  ctx.moveTo(px - HW, py + HH);
  ctx.lineTo(px, py + TILE_H);
  ctx.lineTo(sX, sY);
  ctx.lineTo(wX, wY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(PALETTE.wallRight, bj, warm);
  ctx.beginPath();
  ctx.moveTo(px + HW, py + HH);
  ctx.lineTo(px, py + TILE_H);
  ctx.lineTo(sX, sY);
  ctx.lineTo(eX, eY);
  ctx.closePath();
  ctx.fill();
}

// Everything about a wall tile that isn't the photo warp itself: masonry
// variant, rare accents, stains, top-slab decoration, ruined rubble, frost
// rime. A pure function of (x, y) plus a brightness/warmth the caller
// supplies — getWallTexLevels calls this once at bj=1/warm=0 to bake it
// into the per-tile cache; the (rare, pre-texture-load) live fallback in
// drawWallBlock calls it directly with the real live brightness.
function drawWallDecor(ctx: CanvasRenderingContext2D, ws: WallStyle): void {
  const { px, py, bj, warm, h1, hgt } = ws;

  const faces: [number, number, number, number][] = [
    [px - HW, py + HH, px, py + TILE_H], // SW: W corner -> S corner
    [px, py + TILE_H, px + HW, py + HH], // SE
  ];
  const faceQuad = (fi: number, u0: number, f0: number, u1: number, f1: number) => {
    const [b0x, b0y, b1x, b1y] = faces[fi];
    const p0 = facePt(b0x, b0y, b1x, b1y, u0, f0, hgt);
    const p1 = facePt(b0x, b0y, b1x, b1y, u1, f0, hgt);
    const p2 = facePt(b0x, b0y, b1x, b1y, u1, f1, hgt);
    const p3 = facePt(b0x, b0y, b1x, b1y, u0, f1, hgt);
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.lineTo(p3[0], p3[1]);
    ctx.closePath();
  };

  if (ws.variant === 'strata') {
    // Sedimentary rock: full-width uneven layers instead of bricks.
    const s0 = 0.24 + h1 * 0.1;
    const s1 = 0.52 - h1 * 0.06;
    const s2 = 0.76 + h1 * 0.08;
    for (let fi = 0; fi < 2; fi++) {
      const tones: [number, number, string][] = [
        [0, s0, 'rgba(0,0,0,0.12)'],
        [s1, s2, 'rgba(255,255,255,0.04)'],
        [s2, 1, 'rgba(0,0,0,0.05)'],
      ];
      for (const [f0, f1, color] of tones) {
        ctx.fillStyle = color;
        faceQuad(fi, 0, f0, 1, f1);
        ctx.fill();
      }
      // Wavy seams between layers.
      const [b0x, b0y, b1x, b1y] = faces[fi];
      ctx.strokeStyle = `rgba(0,0,0,${0.3 * Math.min(1, bj * 4)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const f of [s0, s1, s2]) {
        for (let k = 0; k <= 4; k++) {
          const u = k / 4;
          const wob = (tileHash((px + k * 31) | 0, (f * 97) | 0) - 0.5) * 0.06;
          const pt = facePt(b0x, b0y, b1x, b1y, u, f + (k === 0 || k === 4 ? 0 : wob), hgt);
          if (k === 0) ctx.moveTo(pt[0], pt[1]);
          else ctx.lineTo(pt[0], pt[1]);
        }
      }
      ctx.stroke();
    }
  } else if (texturesReady()) {
    // Photographed masonry, baked once per tile (see getWallTexCanvas — the
    // blit itself happens once below, shared with the top slab) and
    // multiply-tinted per frame by the same torch/player light the
    // procedural fallback uses.
    for (let fi = 0; fi < 2; fi++) {
      faceQuad(fi, 0, 0, 1, 1);
      tintPath(ctx, bj, warm);
    }
  } else {
    // Brick tones: alternate half-course quads catch different light.
    for (let fi = 0; fi < 2; fi++) {
      const bands: [number, number, number, number, string][] = [
        [0, 0.35, 0.06 + h1 * 0.4, 0.56, 'rgba(0,0,0,0.10)'],
        [0.35, 0.68, 0.44 - h1 * 0.3, 0.94, 'rgba(255,255,255,0.045)'],
        [0.68, 1, 0.12 + h1 * 0.3, 0.5, 'rgba(0,0,0,0.08)'],
      ];
      for (const [f0, f1, u0, u1, color] of bands) {
        ctx.fillStyle = color;
        faceQuad(fi, u0, f0, u1, f1);
        ctx.fill();
      }
    }

    // Mortar courses: horizontal lines with staggered vertical joints.
    ctx.strokeStyle = `rgba(0,0,0,${0.32 * Math.min(1, bj * 4)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const rows = [0.35, 0.68];
    for (let r = 0; r < rows.length; r++) {
      const dy = hgt * rows[r];
      ctx.moveTo(px - HW, py + HH - dy);
      ctx.lineTo(px, py + TILE_H - dy);
      ctx.lineTo(px + HW, py + HH - dy);
      const u = 0.25 + (((h1 * 13 + r * 0.47) * 7) % 1) * 0.5;
      const bandTop = r === 0 ? 0 : hgt * rows[r - 1];
      for (const side of [-1, 1]) {
        const jx = px + side * HW * u;
        const jyBase = py + HH + (TILE_H - HH) * (1 - u);
        ctx.moveTo(jx, jyBase - bandTop);
        ctx.lineTo(jx, jyBase - dy);
      }
    }
    ctx.stroke();
  }

  // Rare accents, drawn on a face with floor before it.
  const accFace = ws.accFace;
  const [ab0x, ab0y, ab1x, ab1y] = faces[accFace];
  const accPt = (u: number, f: number) => facePt(ab0x, ab0y, ab1x, ab1y, u, f, hgt);
  if (ws.variant === 'rune') {
    // A carved sigil, catching the pale light along its grooves.
    const sigil = WALL_SIGILS[((h1 * 41) | 0) % WALL_SIGILS.length];
    for (const pass of [0, 1]) {
      ctx.strokeStyle =
        pass === 0
          ? `rgba(0,0,0,${0.35 * Math.min(1, bj * 3)})`
          : `rgba(196,208,220,${0.06 + Math.min(0.32, bj * 0.4)})`;
      ctx.lineWidth = pass === 0 ? 2.6 : 1.2;
      ctx.beginPath();
      for (const [u0, f0, u1, f1] of sigil) {
        const a = accPt(u0, f0);
        const b2 = accPt(u1, f1);
        ctx.moveTo(a[0], a[1] + (pass === 0 ? 1 : 0));
        ctx.lineTo(b2[0], b2[1] + (pass === 0 ? 1 : 0));
      }
      ctx.stroke();
    }
  } else if (ws.variant === 'bones') {
    // A niche stacked with the dead.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    faceQuad(accFace, 0.24, 0.22, 0.76, 0.66);
    ctx.fill();
    const [cxp, cyp] = accPt(0.5, 0.5);
    const pale = `rgba(188,192,198,${Math.min(0.85, 0.25 + bj * 0.8)})`;
    // Crossed long bones behind the skull.
    ctx.strokeStyle = pale;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cxp - 6, cyp + 4);
    ctx.lineTo(cxp + 6, cyp - 3);
    ctx.moveTo(cxp + 6, cyp + 4);
    ctx.lineTo(cxp - 6, cyp - 3);
    ctx.stroke();
    // The skull.
    ctx.fillStyle = pale;
    ctx.beginPath();
    ctx.arc(cxp, cyp - 1, 3.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cxp - 1.8, cyp + 1.4, 3.6, 1.6);
    ctx.fillStyle = 'rgba(10,10,14,0.9)';
    ctx.beginPath();
    ctx.arc(cxp - 1.2, cyp - 1.4, 0.9, 0, Math.PI * 2);
    ctx.arc(cxp + 1.2, cyp - 1.4, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }

  if (ws.stain) {
    // Water stains bleeding down from the slab.
    ctx.strokeStyle = 'rgba(6,9,11,0.3)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let s = 0; s < 2; s++) {
      const u = 0.25 + tileHash((px + s * 57) | 0, s * 23 + 4) * 0.5;
      const len = 0.35 + tileHash(s * 13 + 1, (px * 3) | 0) * 0.3;
      const fi2 = (accFace + s) % 2;
      const [sb0x, sb0y, sb1x, sb1y] = faces[fi2];
      const top = facePt(sb0x, sb0y, sb1x, sb1y, u, 0.98, hgt);
      const bot = facePt(sb0x, sb0y, sb1x, sb1y, u + 0.03, 0.98 - len, hgt);
      ctx.moveTo(top[0], top[1]);
      ctx.lineTo(bot[0], bot[1]);
    }
    ctx.stroke();
  }

  // Top slab, jittered — textured (blitted with the faces above) instead
  // of a flat fill, when ready.
  const { nX, nY, eX, eY, sX, sY, wX, wY } = wallCorners(ws);
  ctx.beginPath();
  ctx.moveTo(nX, nY);
  ctx.lineTo(eX, eY);
  ctx.lineTo(sX, sY);
  ctx.lineTo(wX, wY);
  ctx.closePath();
  if (texturesReady()) {
    tintPath(ctx, bj, warm);
  } else {
    ctx.fillStyle = shade(PALETTE.wallTop, bj, warm);
    ctx.fill();
  }
  // Split tone across the slab.
  ctx.fillStyle = 'rgba(0,0,0,0.07)';
  ctx.beginPath();
  ctx.moveTo(nX, nY);
  ctx.lineTo(eX, eY);
  ctx.lineTo(sX, sY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.moveTo(nX, nY);
  ctx.lineTo(eX, eY);
  ctx.lineTo(sX, sY);
  ctx.lineTo(wX, wY);
  ctx.closePath();
  ctx.stroke();
  // A crack across the slab on some stones.
  if (h1 > 0.55 && h1 < 0.7) {
    ctx.strokeStyle = `rgba(0,0,0,${0.2 + bj * 0.2})`;
    ctx.beginPath();
    ctx.moveTo((nX + wX) / 2, (nY + wY) / 2);
    ctx.lineTo(px + (h1 - 0.6) * 30, py + HH - hgt + 2);
    ctx.lineTo((eX + sX) / 2, (eY + sY) / 2);
    ctx.stroke();
  }

  if (ws.ruined) {
    // Rubble strewn on the broken top.
    ctx.fillStyle = shade(PALETTE.wallTop, bj * 1.15, warm);
    for (let i = 0; i < 3; i++) {
      const rx = px + (tileHash((i * 31 + h1 * 100) | 0, i * 17) - 0.5) * HW;
      const ry = py + HH - hgt + (tileHash(i * 7, (i * 23 + h1 * 50) | 0) - 0.5) * 6;
      ctx.beginPath();
      ctx.moveTo(rx, ry - 3);
      ctx.lineTo(rx + 4, ry);
      ctx.lineTo(rx, ry + 3);
      ctx.lineTo(rx - 4, ry);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (ws.frost) {
    // Rime creeping up the base of the wall.
    ctx.fillStyle = `rgba(159,196,216,${0.02 + bj * 0.05})`;
    ctx.beginPath();
    ctx.ellipse(px - HW * 0.4, py + HH + 2, 9, 5, -0.5, 0, Math.PI * 2);
    ctx.ellipse(px + HW * 0.35, py + HH + 1, 8, 4.5, 0.5, 0, Math.PI * 2);
    ctx.fill();
    // Icicles under the top slab's edge.
    ctx.fillStyle = `rgba(170,205,225,${0.2 + bj * 0.3})`;
    for (let i = 0; i < 3; i++) {
      const u = 0.2 + i * 0.3 + h1 * 0.1;
      const ix = px - HW + HW * u;
      const iy = py + HH - hgt + (TILE_H - HH) * u;
      const len = 4 + tileHash((h1 * 90) | 0, i * 11) * 5;
      ctx.beginPath();
      ctx.moveTo(ix - 1.5, iy);
      ctx.lineTo(ix + 1.5, iy);
      ctx.lineTo(ix, iy + len);
      ctx.closePath();
      ctx.fill();
    }
  }

}

function drawWallBlock(ctx: CanvasRenderingContext2D, ws: WallStyle): void {
  const { px, py, hgt } = ws;
  // Occluding walls turn translucent instead of sinking. The dim explored
  // cache already blitted beneath keeps them reading as stone, not holes,
  // while the player (drawn earlier) shows through.
  const baseAlpha = ws.cut > 0 ? 1 - 0.76 * ws.cut : 1;
  ctx.globalAlpha = baseAlpha;

  if (ws.pillar) {
    drawPillar(ctx, ws);
    ctx.globalAlpha = 1;
    return;
  }

  if (texturesReady()) {
    // The whole tile — masonry, accents, top-slab decor, rubble, rime,
    // sconce glow — is pre-baked into BRIGHTNESS_LEVELS pre-tinted copies
    // (see getWallTexLevels); live work per frame is a plain drawImage of
    // whichever one is closest to the current torch/player light, cross-
    // faded with the next one up via globalAlpha (see brightnessBlend),
    // instead of redrawing ~15-20 shapes or doing any live compositing.
    const levels = getWallTexLevels(ws);
    const bx = Math.round(px - HW - TEX_PAD);
    const by = Math.round(py - hgt - TEX_PAD);
    const { lo, hi, frac } = brightnessBlend(ws.bj);
    ctx.drawImage(levels[lo], bx, by);
    if (frac > 0.02 && hi !== lo) {
      ctx.globalAlpha = baseAlpha * frac;
      ctx.drawImage(levels[hi], bx, by);
      ctx.globalAlpha = baseAlpha;
    }
  } else {
    // Textures still loading — same procedural look as before, drawn live
    // since there's nothing to blit yet (this only lasts a moment at
    // startup, so it isn't worth caching).
    drawWallFaceBase(ctx, ws);
    drawWallDecor(ctx, ws);
  }

  if (ws.torch) {
    // The glow + bracket are already part of the cached blit above; only
    // the flickering flame still needs to be live. The fallback branch has
    // nothing baked yet, so it draws the whole sconce.
    if (texturesReady()) drawSconceFlame(ctx, ws, hgt);
    else drawSconce(ctx, ws, hgt);
  }
  ctx.globalAlpha = 1;
}

/** The torch's bracket + warm glow — fixed position, fixed color stops,
 * nothing about it changes frame to frame, so it's baked into the wall
 * tile cache (see getWallTexCanvas) instead of rebuilding the radial
 * gradient live every frame. */
function drawSconceBase(ctx: CanvasRenderingContext2D, ws: WallStyle, hgt: number): void {
  const { px, py } = ws;
  const fx = ws.torch === 'sw' ? px - HW * 0.5 : px + HW * 0.5;
  const fy = py + HH + HH * 0.5 - hgt * 0.45;

  const glow = ctx.createRadialGradient(fx, fy - 4, 1, fx, fy - 4, 24);
  glow.addColorStop(0, 'rgba(255,165,60,0.22)');
  glow.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(fx - 25, fy - 29, 50, 50);

  ctx.strokeStyle = '#191b20';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(fx, fy + 2);
  ctx.lineTo(fx, fy + 7);
  ctx.stroke();
}

/** The flame itself — flickers with live time, so it's the one piece of a
 * sconce still drawn every frame. Cheap: two path fills, no gradient. */
function drawSconceFlame(ctx: CanvasRenderingContext2D, ws: WallStyle, hgt: number): void {
  const { px, py, time } = ws;
  const fx = ws.torch === 'sw' ? px - HW * 0.5 : px + HW * 0.5;
  const fy = py + HH + HH * 0.5 - hgt * 0.45;
  const flh = time === null ? 1 : 1 + 0.22 * Math.sin(time * 9 + px * 0.7) + 0.12 * Math.sin(time * 23 + py);

  ctx.fillStyle = 'rgba(255,140,45,0.88)';
  ctx.beginPath();
  ctx.moveTo(fx - 2.8, fy + 1);
  ctx.quadraticCurveTo(fx - 1.8, fy - 4 * flh, fx, fy - 9 * flh);
  ctx.quadraticCurveTo(fx + 1.8, fy - 4 * flh, fx + 2.8, fy + 1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,222,140,0.9)';
  ctx.beginPath();
  ctx.moveTo(fx - 1.4, fy + 0.5);
  ctx.quadraticCurveTo(fx, fy - 4.5 * flh, fx, fy - 5 * flh);
  ctx.quadraticCurveTo(fx + 0.4, fy - 2 * flh, fx + 1.4, fy + 0.5);
  ctx.closePath();
  ctx.fill();
}

/** A wall-mounted torch, drawn fully live — used only by the (rare,
 * transient) pre-texture-load fallback in drawWallBlock, where nothing is
 * cached yet anyway. */
function drawSconce(ctx: CanvasRenderingContext2D, ws: WallStyle, hgt: number): void {
  drawSconceBase(ctx, ws, hgt);
  drawSconceFlame(ctx, ws, hgt);
}

function drawPillar(ctx: CanvasRenderingContext2D, ws: WallStyle): void {
  const { px, py, bj, warm } = ws;
  const cy = py; // diamond() centers vertically at py + HH
  const s = 0.42;
  const ph = WALL_H * 1.12;

  // Plinth.
  ctx.fillStyle = shade(PALETTE.wallLeft, bj * 1.1, warm);
  diamond(ctx, px, cy, s * 1.4);
  ctx.fill();

  // Shaft faces.
  ctx.fillStyle = shade(PALETTE.wallLeft, bj, warm);
  ctx.beginPath();
  ctx.moveTo(px - HW * s, cy + HH);
  ctx.lineTo(px, cy + HH + HH * s);
  ctx.lineTo(px, cy + HH + HH * s - ph);
  ctx.lineTo(px - HW * s, cy + HH - ph);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(PALETTE.wallRight, bj, warm);
  ctx.beginPath();
  ctx.moveTo(px + HW * s, cy + HH);
  ctx.lineTo(px, cy + HH + HH * s);
  ctx.lineTo(px, cy + HH + HH * s - ph);
  ctx.lineTo(px + HW * s, cy + HH - ph);
  ctx.closePath();
  ctx.fill();

  // Cracks ringing the shaft.
  ctx.strokeStyle = `rgba(0,0,0,${0.3 * Math.min(1, bj * 4)})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const f of [0.3, 0.62]) {
    const dy = ph * f;
    ctx.moveTo(px - HW * s, cy + HH - dy);
    ctx.lineTo(px, cy + HH + HH * s - dy);
    ctx.lineTo(px + HW * s, cy + HH - dy);
  }
  ctx.stroke();

  // Capital and cap.
  ctx.fillStyle = shade(PALETTE.wallTop, bj * 0.85, warm);
  diamond(ctx, px, cy - ph + 3, s * 1.3);
  ctx.fill();
  ctx.fillStyle = shade(PALETTE.wallTop, bj, warm);
  diamond(ctx, px, cy - ph, s);
  ctx.fill();
  ctx.strokeStyle = `rgba(190,205,222,${0.13 + bj * 0.12})`;
  ctx.lineWidth = 1;
  diamond(ctx, px, cy - ph, s);
  ctx.stroke();
}

// --- cached explored-world canvas ------------------------------------------
// Explored-but-unlit tiles never change (fixed dim brightness), so they are
// painted once onto an offscreen canvas and blitted each frame. Only tiles
// near the player (the torchlight) are redrawn live.

const STATIC_OY = 70;
let staticCanvas: HTMLCanvasElement | null = null;
let staticFor: Dungeon | null = null;
let staticOX = 0;
let staticCount = -1;
let staticBuiltAt = 0;
// Tracks what's already painted onto staticCanvas, so newly explored tiles
// are the only work each call — redrawing the whole explored map from
// scratch every ~500ms was a multi-hundred-ms main-thread stall once a
// level was mostly explored.
let staticBaked: Uint8Array | null = null;

function rebuildStatic(d: Dungeon): void {
  const c = staticCanvas!.getContext('2d')!;
  const baked = staticBaked!;

  for (let y = 0; y < d.h; y++) {
    for (let x = 0; x < d.w; x++) {
      const idx = y * d.w + x;
      if (!d.explored[idx] || baked[idx] || d.tiles[idx] === Tile.Wall) continue;
      const sb = staticLightAt(d, x, y);
      drawFloorTile(
        c,
        staticOX + isoX(x, y),
        STATIC_OY + isoY(x, y),
        x,
        y,
        sb,
        outWarm,
        d.tiles[idx],
        null,
        aoMask(d, x, y),
      );
    }
  }

  const newWalls: { x: number; y: number }[] = [];
  for (let y = 0; y < d.h; y++) {
    for (let x = 0; x < d.w; x++) {
      const idx = y * d.w + x;
      if (d.explored[idx] && !baked[idx] && d.tiles[idx] === Tile.Wall && d.facing[idx]) newWalls.push({ x, y });
    }
  }
  // Sorted so newly revealed walls still layer correctly among themselves;
  // they paint on top of whatever's already baked, which holds up in
  // practice since overlap only ever happens between screen-adjacent tiles.
  newWalls.sort((a, b) => a.x + a.y - (b.x + b.y));
  for (const { x, y } of newWalls) {
    const px = staticOX + isoX(x, y);
    const py = STATIC_OY + isoY(x, y);
    const sb = staticLightAt(d, x, y);
    drawWallBlock(c, computeWallStyle(d, x, y, px, py, sb, outWarm, 0, null));
  }

  for (let i = 0; i < d.explored.length; i++) if (d.explored[i]) baked[i] = 1;
}

function ensureStatic(d: Dungeon): void {
  if (!staticCanvas) staticCanvas = document.createElement('canvas');
  if (staticFor !== d) {
    staticCanvas.width = (d.w + d.h) * HW;
    staticCanvas.height = (d.w + d.h) * HH + STATIC_OY + TILE_H;
    staticOX = d.h * HW;
    staticFor = d;
    staticCount = -1;
    staticBaked = new Uint8Array(d.w * d.h);
    // A new dungeon means new tile crops/frost-vs-stone choices at every
    // (x, y) — last level's baked textures no longer apply.
    floorTexCache = new Map();
    wallTexCache = new Map();
  }
  let count = 0;
  const ex = d.explored;
  for (let i = 0; i < ex.length; i++) if (ex[i]) count++;
  const now = performance.now();
  // Newly explored tiles sit inside the live-drawn light radius anyway, so
  // the cache only needs to catch up every so often.
  if (count !== staticCount && (staticCount === -1 || now - staticBuiltAt > 500)) {
    rebuildStatic(d);
    staticCount = count;
    staticBuiltAt = now;
  }
}

// --- ash-snow ---------------------------------------------------------

interface Flake {
  x: number;
  y: number;
  vy: number;
  sway: number;
  size: number;
  alpha: number;
}

const flakes: Flake[] = [];

function updateSnow(dt: number, w: number, h: number, time: number): void {
  while (flakes.length < 90) {
    flakes.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vy: 14 + Math.random() * 26,
      sway: Math.random() * Math.PI * 2,
      size: 0.7 + Math.random() * 1.6,
      alpha: 0.1 + Math.random() * 0.22,
    });
  }
  for (const f of flakes) {
    f.y += f.vy * dt;
    f.x += Math.sin(time * 0.7 + f.sway) * 10 * dt - 4 * dt;
    if (f.y > h + 4) {
      f.y = -4;
      f.x = Math.random() * w;
    }
    if (f.x < -4) f.x = w + 4;
  }
}

// --- cached full-screen overlays -------------------------------------------

let vigCanvas: HTMLCanvasElement | null = null;

function getVignette(w: number, h: number): HTMLCanvasElement {
  if (!vigCanvas || vigCanvas.width !== w || vigCanvas.height !== h) {
    vigCanvas = document.createElement('canvas');
    vigCanvas.width = w;
    vigCanvas.height = h;
    const c = vigCanvas.getContext('2d')!;
    const vg = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(0.7, 'rgba(3,5,9,0.32)');
    vg.addColorStop(1, 'rgba(2,4,10,0.68)');
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
  }
  return vigCanvas;
}

let grainTile: HTMLCanvasElement | null = null;
let grainScreen: HTMLCanvasElement | null = null;
let grainLast = 0;

function getGrainScreen(w: number, h: number): HTMLCanvasElement {
  const now = performance.now();
  const resized = !grainScreen || grainScreen.width !== w || grainScreen.height !== h;
  if (resized) {
    grainScreen = document.createElement('canvas');
    grainScreen.width = w;
    grainScreen.height = h;
  }
  if (!grainTile) {
    grainTile = document.createElement('canvas');
    grainTile.width = 140;
    grainTile.height = 140;
  }
  if (now - grainLast > 90 || resized) {
    grainLast = now;
    const tctx = grainTile.getContext('2d')!;
    const img = tctx.createImageData(140, 140);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 36;
    }
    tctx.putImageData(img, 0, 0);
    const gctx = grainScreen!.getContext('2d')!;
    gctx.clearRect(0, 0, w, h);
    const pattern = gctx.createPattern(grainTile, 'repeat');
    if (pattern) {
      gctx.fillStyle = pattern;
      gctx.fillRect(0, 0, w, h);
    }
  }
  return grainScreen!;
}

// --- loot on the ground ---------------------------------------------------

function drawGroundItem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  loot: Loot,
  time: number,
  alpha: number,
): void {
  ctx.globalAlpha = alpha;
  const pulse = 0.6 + 0.4 * Math.sin(time * 3 + cx * 0.13);
  const glowColor = loot === 'potion' ? '160,40,45' : '200,215,230';
  const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, 15);
  glow.addColorStop(0, `rgba(${glowColor},${0.22 * pulse})`);
  glow.addColorStop(1, `rgba(${glowColor},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 16, cy - 16, 32, 32);

  if (loot === 'potion') {
    ctx.fillStyle = '#5e1218';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 3, 4, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#22252a';
    ctx.fillRect(cx - 1.5, cy - 12, 3, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.ellipse(cx - 1.5, cy - 4.5, 1.2, 2, -0.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (loot.kind === 'weapon') {
    ctx.strokeStyle = '#c3c9d1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy + 3);
    ctx.lineTo(cx + 6, cy - 8);
    ctx.stroke();
    ctx.strokeStyle = '#6f757e';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(cx - 5.5, cy - 3);
    ctx.lineTo(cx - 0.5, cy + 2);
    ctx.moveTo(cx - 6.5, cy + 4.5);
    ctx.lineTo(cx - 4, cy + 7);
    ctx.stroke();
  } else if (loot.kind === 'tome') {
    // A grimoire, closed.
    ctx.fillStyle = '#1f232a';
    ctx.strokeStyle = '#8f959d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 7);
    ctx.lineTo(cx + 5, cy - 5);
    ctx.lineTo(cx + 5, cy + 3);
    ctx.lineTo(cx - 5, cy + 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Pale sigil on the cover.
    ctx.strokeStyle = '#c3c9d1';
    ctx.beginPath();
    ctx.moveTo(cx - 2, cy - 4);
    ctx.lineTo(cx + 2, cy);
    ctx.moveTo(cx + 2, cy - 4);
    ctx.lineTo(cx - 2, cy);
    ctx.stroke();
  } else if (loot.kind === 'trinket') {
    // Amulet on a chain.
    ctx.strokeStyle = '#8f959d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 7, 4, 3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#c3c9d1';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx + 3, cy - 1);
    ctx.lineTo(cx, cy + 3);
    ctx.lineTo(cx - 3, cy - 1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#16171b';
    ctx.beginPath();
    ctx.arc(cx, cy - 1, 1, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#3a4046';
    ctx.strokeStyle = '#9aa1a9';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 8);
    ctx.lineTo(cx + 5, cy - 8);
    ctx.lineTo(cx + 5, cy - 2);
    ctx.quadraticCurveTo(cx + 4, cy + 3, cx, cy + 5);
    ctx.quadraticCurveTo(cx - 4, cy + 3, cx - 5, cy - 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// --- entities -----------------------------------------------------------

function lungeOffset(e: { lunge: number; lungeDX: number; lungeDY: number }): { ox: number; oy: number } {
  if (e.lunge <= 0) return { ox: 0, oy: 0 };
  const m = Math.sin(e.lunge * Math.PI) * 12;
  let sdx = e.lungeDX - e.lungeDY;
  let sdy = (e.lungeDX + e.lungeDY) * 0.5;
  const len = Math.hypot(sdx, sdy) || 1;
  sdx /= len;
  sdy /= len;
  return { ox: sdx * m, oy: sdy * m };
}

function drawShadow(ctx: CanvasRenderingContext2D, fx: number, fy: number, rx: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(fx, fy, rx, rx * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Jagged spikes ringing a rare enemy's silhouette — `seed` (0..1, fixed
 * per instance) keeps the layout stable frame to frame instead of jittering. */
function drawRareSpikes(ctx: CanvasRenderingContext2D, seed: number): void {
  const n = 6;
  ctx.fillStyle = '#14151a';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed * Math.PI * 2;
    const nx = Math.cos(a);
    const ny = Math.sin(a) * 0.55; // squashed to roughly match the body's iso oval
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

/** A soft radial gleam behind glowing eyes. */
function eyeGlow(ctx: CanvasRenderingContext2D, x: number, y: number, rgb: string, r = 2.8): void {
  const g = ctx.createRadialGradient(x, y, 0.2, x, y, r);
  g.addColorStop(0, `rgba(${rgb},0.55)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** An inverted Latin cross — the crossbar sits low, not high — used in
 * place of a neutral iron-cross glyph wherever the UI wants a menacing
 * flourish (title menu, depth marker, satchel trim). */
function drawInvertedCross(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, alpha: number): void {
  const barW = Math.max(1.5, s * 0.26);
  const armLen = s * 0.62;
  const armY = cy + s * 0.32;
  ctx.fillStyle = `rgba(200,206,214,${alpha})`;
  ctx.fillRect(cx - barW / 2, cy - s, barW, s * 2);
  ctx.fillRect(cx - armLen, armY - barW / 2, armLen * 2, barW);
}

// --- player materials -------------------------------------------------
// Small photo swatches (cloth, skin, steel) reused as repeating fill/stroke
// patterns on the existing hand-animated silhouette below, instead of a
// sprite — keeps the walk/lunge animation and sidesteps AI sprite-sheet
// consistency problems entirely. A zoomed-in transform picks a detailed,
// consistent crop rather than the whole photo shrunk to nothing.
let clothPattern: CanvasPattern | null = null;
let skinPattern: CanvasPattern | null = null;
let steelPattern: CanvasPattern | null = null;
let uiLeatherPattern: CanvasPattern | null = null;

function makePattern(ctx: CanvasRenderingContext2D, img: HTMLImageElement, scale = 0.4): CanvasPattern | null {
  const p = ctx.createPattern(img, 'repeat');
  p?.setTransform(new DOMMatrix().scale(scale));
  return p;
}

// Pattern-fill + multiply-tint (paintMaterial) is the single most expensive
// thing drawn per entity, and it's redone every frame for every visible
// body — cheap enough on desktop even with 20+ enemies on screen, but
// costly enough on mobile GPUs to be the dominant cause of "laggy on
// mobile" once several enemies are in view at once. Rather than touching
// every draw call site, the three per-entity getters return null on touch
// devices so every caller's existing flat-fill fallback (written for the
// "texture not loaded yet" case) takes over automatically — same
// silhouettes, no pattern sampling or multiply blending per shape.
function getClothPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (isTouchDevice) return null;
  if (!clothPattern && playerTexturesReady()) clothPattern = makePattern(ctx, playerClothImg);
  return clothPattern;
}
function getSkinPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (isTouchDevice) return null;
  if (!skinPattern && playerTexturesReady()) skinPattern = makePattern(ctx, playerSkinImg);
  return skinPattern;
}
function getSteelPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (isTouchDevice) return null;
  if (!steelPattern && playerTexturesReady()) steelPattern = makePattern(ctx, playerSteelImg);
  return steelPattern;
}
/** The same skin photo at a much larger apparent grain, for UI panels —
 * tinted dark by the caller to read as cured leather or old parchment. */
function getUiLeatherPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (!uiLeatherPattern && playerTexturesReady()) uiLeatherPattern = makePattern(ctx, playerSkinImg, 1.6);
  return uiLeatherPattern;
}
/** The tarnished-steel photo at UI scale, for metal fittings (orb bezels,
 * plate rims) — glass and steel read as vessel + fitting, not a hide. */
let uiSteelPattern: CanvasPattern | null = null;
function getUiSteelPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (!uiSteelPattern && playerTexturesReady()) uiSteelPattern = makePattern(ctx, playerSteelImg, 1.3);
  return uiSteelPattern;
}

/** A #rrggbb color as a partial-alpha rgba() string, for tinting a texture
 * without fully crushing its own tonal variation under a flat color. */
function hexTint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Fills (or strokes, if `stroke`) the current path with a material pattern,
 * then multiply-tints it to match the look the solid-color fallback had. */
function paintMaterial(
  ctx: CanvasRenderingContext2D,
  pattern: CanvasPattern,
  tint: string | CanvasGradient,
  stroke: boolean,
): void {
  if (stroke) {
    ctx.strokeStyle = pattern;
    ctx.stroke();
  } else {
    ctx.fillStyle = pattern;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = tint;
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, fx: number, fy: number, p: Player, time: number): void {
  const moving = p.path.length > 0;
  const bob = moving ? Math.sin(p.walkPhase) * 1.6 : Math.sin(time * 2) * 0.7;
  const sway = moving ? Math.sin(p.walkPhase * 0.5) * 1.4 : Math.sin(time * 1.3) * 0.5;
  // Directional lean: the sword arm drifts toward screen-left/-right while
  // walking that way, so the model reads as heading somewhere, not just
  // shuffling in place.
  let dirBias = 0;
  if (moving) {
    const wp = p.path[0];
    const screenDx = wp.x - p.x - (wp.y - p.y);
    dirBias = screenDx > 0.02 ? 1 : screenDx < -0.02 ? -1 : 0;
  }
  const { ox, oy } = lungeOffset(p);
  drawShadow(ctx, fx, fy, 13);
  const x = fx + ox;
  const y = fy + oy + bob;

  // Boots stepping out from under the hem.
  if (moving) {
    const step = Math.sin(p.walkPhase) * 3;
    ctx.fillStyle = '#15161a';
    ctx.beginPath();
    ctx.ellipse(x - 3.5 + step, fy - 0.5, 3, 1.7, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 3.5 - step, fy - 0.5, 3, 1.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cloak — layered black wool, gradient-lit from above, ragged hem
  // stirring with the stride.
  const cg = ctx.createLinearGradient(x, y - 30, x, y);
  cg.addColorStop(0, '#1b1d24');
  cg.addColorStop(0.5, '#101116');
  cg.addColorStop(1, '#07080b');
  // A body, not a cone: hem -> waist pinch -> shoulder bulge -> neck, so
  // the silhouette reads as a man in a robe rather than a draped triangle.
  ctx.beginPath();
  ctx.moveTo(x - 8.5 + sway, y);
  const hem = [-6, -3.6, -1.2, 1.2, 3.6, 6];
  for (let i = 0; i < hem.length; i++) {
    const lift = (i % 2 === 0 ? -2.4 : 0.5) + Math.sin(p.walkPhase * 0.5 + i * 1.7) * 0.7;
    ctx.lineTo(x + hem[i] + sway * (0.4 + 0.1 * i), y + lift);
  }
  ctx.lineTo(x + 8.5 + sway, y);
  ctx.quadraticCurveTo(x + 8.8, y - 6, x + 6, y - 9.5);
  ctx.quadraticCurveTo(x + 9.6, y - 14.5, x + 9.3, y - 19.5);
  ctx.quadraticCurveTo(x + 7.5, y - 23, x + 3.2, y - 24);
  ctx.quadraticCurveTo(x - 1, y - 25.2, x - 3.2, y - 24);
  ctx.quadraticCurveTo(x - 7.5, y - 23, x - 9.3, y - 19.5);
  ctx.quadraticCurveTo(x - 9.6, y - 14.5, x - 6, y - 9.5);
  ctx.quadraticCurveTo(x - 8.8, y - 6, x - 8.5 + sway, y);
  ctx.closePath();
  const cloth = getClothPattern(ctx);
  if (cloth) {
    const cgTint = ctx.createLinearGradient(x, y - 30, x, y);
    cgTint.addColorStop(0, 'rgba(255,255,255,0.7)');
    cgTint.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    cgTint.addColorStop(1, 'rgba(255,255,255,0.18)');
    paintMaterial(ctx, cloth, cgTint, false);
  } else {
    ctx.fillStyle = cg;
    ctx.fill();
  }
  ctx.strokeStyle = '#07070a';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120,128,138,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // The cloak parts over a darker inner robe.
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.moveTo(x - 1.5, y - 22.5);
  ctx.lineTo(x + 2 + sway * 0.5, y - 2);
  ctx.lineTo(x - 3.5 + sway * 0.5, y - 2);
  ctx.closePath();
  ctx.fill();
  // Belt with a bone toggle, cinched at the waist pinch.
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x - 6.5, y - 10);
  ctx.quadraticCurveTo(x, y - 8, x + 6.5, y - 10);
  ctx.stroke();
  ctx.fillStyle = '#9aa1a9';
  ctx.beginPath();
  ctx.ellipse(x - 0.5, y - 8.8, 1.8, 1.1, 0.2, 0, Math.PI * 2);
  ctx.fill();
  // Cold rim light tracing shoulder to hem, down the left edge.
  ctx.strokeStyle = 'rgba(185,196,210,0.26)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - 8.5 + sway, y - 2);
  ctx.quadraticCurveTo(x - 9.6, y - 14.5, x - 9.3, y - 19.5);
  ctx.quadraticCurveTo(x - 7.5, y - 23, x - 3.2, y - 24);
  ctx.stroke();

  drawArmorDecor(ctx, x, y, p.armor?.tier ?? 0);

  // Sword arm: a sleeve falling from the shoulder to a pale hand on the
  // grip, drifting with dirBias toward the direction of travel.
  const armX = x + dirBias * 3.2;
  ctx.strokeStyle = '#0d0e12';
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(armX + 6.5, y - 19);
  ctx.quadraticCurveTo(armX + 9, y - 15, armX + 7, y - 9.5);
  ctx.stroke();
  ctx.fillStyle = '#cfd3d8';
  ctx.beginPath();
  ctx.arc(armX + 7, y - 9, 1.6, 0, Math.PI * 2);
  ctx.fill();
  drawWeaponIdle(ctx, armX, y, p.weapon.tier);

  // Off-hand: a small round shield at the hip, drifting with dirBias the
  // same way the sword arm does, so both arms lean together.
  const shieldX = x - 7.5 + dirBias * 3.2;
  const shieldY = y - 13;
  ctx.beginPath();
  ctx.arc(shieldX, shieldY, 4.4, 0, Math.PI * 2);
  const steelShield = getSteelPattern(ctx);
  if (steelShield) {
    paintMaterial(ctx, steelShield, 'rgba(14,14,17,0.6)', false);
  } else {
    ctx.fillStyle = '#2a2d33';
    ctx.fill();
  }
  ctx.strokeStyle = '#0a0a0c';
  ctx.lineWidth = 1.3;
  ctx.stroke();
  drawInvertedCross(ctx, shieldX, shieldY, 2.6, 0.65);

  // Peaked hood, its tip nodding with the walk.
  ctx.beginPath();
  ctx.moveTo(x - 6.8, y - 23.5);
  ctx.quadraticCurveTo(x - 7.2, y - 30, x - 4, y - 33.5);
  ctx.quadraticCurveTo(x - 1.5, y - 37.5, x + 0.8 + sway * 0.4, y - 36);
  ctx.quadraticCurveTo(x + 6, y - 31.5, x + 6.6, y - 23.5);
  ctx.quadraticCurveTo(x, y - 27, x - 6.8, y - 23.5);
  ctx.closePath();
  if (cloth) {
    paintMaterial(ctx, cloth, 'rgba(255,255,255,0.5)', false);
  } else {
    ctx.fillStyle = '#14161b';
    ctx.fill();
  }
  ctx.strokeStyle = '#07070a';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // Pale trim along the hood's brim.
  ctx.strokeStyle = 'rgba(190,198,210,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 5.9, y - 24.5);
  ctx.quadraticCurveTo(x - 5.2, y - 29.5, x - 2.5, y - 32);
  ctx.stroke();

  // The face in the hood's shadow, corpse-painted.
  ctx.fillStyle = '#0a0a0d';
  ctx.beginPath();
  ctx.ellipse(x + 0.2, y - 27.6, 4.6, 4.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + 0.3, y - 27.2, 3.6, 3.7, 0, 0, Math.PI * 2);
  const skin = getSkinPattern(ctx);
  if (skin) {
    paintMaterial(ctx, skin, 'rgba(225,225,230,0.85)', false);
  } else {
    ctx.fillStyle = '#cfd3d8';
    ctx.fill();
  }
  // Blackened sockets and the streaks beneath them.
  ctx.fillStyle = '#0a0a0c';
  ctx.beginPath();
  ctx.ellipse(x - 1.5, y - 28.2, 1.1, 1.3, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 2, y - 28.2, 1.1, 1.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0a0a0c';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 1.5, y - 27);
  ctx.lineTo(x - 1.6, y - 24.6);
  ctx.moveTo(x + 2, y - 27);
  ctx.lineTo(x + 2.1, y - 24.6);
  ctx.stroke();
  // A grim slit of a mouth.
  ctx.beginPath();
  ctx.moveTo(x - 0.8, y - 24.6);
  ctx.lineTo(x + 1.4, y - 24.5);
  ctx.stroke();

  // Weapon slash while lunging, tinted by what's equipped.
  if (p.lunge > 0.25) {
    const ang = Math.atan2((p.lungeDX + p.lungeDY) * 0.5, p.lungeDX - p.lungeDY);
    const a = Math.PI / 2 - ang;
    ctx.strokeStyle = `rgba(${SLASH_TINT[p.weapon.tier] ?? '225,230,238'},${p.lunge * 0.9})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(x, y - 14, 20, a - 0.8, a + 0.8);
    ctx.stroke();
  }

  if (p.flash > 0) {
    ctx.fillStyle = `rgba(180,30,30,${Math.min(0.55, p.flash * 3.5)})`;
    ctx.beginPath();
    ctx.ellipse(x, y - 15, 11, 15, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

const SLASH_TINT: Record<number, string> = {
  4: '191,227,245', // Frostbrand — cold light
  5: '225,170,170', // Bloodmoon Scythe — a red gleam
  6: '238,238,248', // Transilvanian Hunger — stark white
  7: '210,20,35', // Bloodletter — a wet crimson arc
};

/** The equipped weapon, resting against the shoulder. */
function drawWeaponIdle(ctx: CanvasRenderingContext2D, x: number, y: number, tier: number): void {
  switch (tier) {
    case 2: // Grave Axe
      ctx.strokeStyle = '#6f757e';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x + 6, y - 6);
      ctx.lineTo(x + 13, y - 22);
      ctx.stroke();
      ctx.fillStyle = '#9aa1a9';
      ctx.beginPath();
      ctx.moveTo(x + 10, y - 22);
      ctx.quadraticCurveTo(x + 17, y - 20, x + 13, y - 15);
      ctx.lineTo(x + 11.5, y - 18);
      ctx.closePath();
      ctx.fill();
      break;
    case 3: // Wolf's Claw — a curved talon
      ctx.strokeStyle = '#c3c9d1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 7, y - 9);
      ctx.quadraticCurveTo(x + 15, y - 14, x + 10, y - 23);
      ctx.stroke();
      ctx.strokeStyle = '#565b63';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 5.5, y - 8);
      ctx.lineTo(x + 8.5, y - 10);
      ctx.stroke();
      break;
    case 4: // Frostbrand — glows with cold
      ctx.strokeStyle = 'rgba(159,213,235,0.3)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x + 7, y - 9);
      ctx.lineTo(x + 15, y - 25);
      ctx.stroke();
      ctx.strokeStyle = '#bfe3f5';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 7, y - 9);
      ctx.lineTo(x + 15, y - 25);
      ctx.stroke();
      ctx.strokeStyle = '#8f959d';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 5, y - 11);
      ctx.lineTo(x + 10, y - 9);
      ctx.stroke();
      break;
    case 5: // Bloodmoon Scythe
      ctx.strokeStyle = '#6f757e';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x + 5, y - 2);
      ctx.lineTo(x + 14, y - 26);
      ctx.stroke();
      ctx.strokeStyle = '#c3c9d1';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x + 14, y - 26);
      ctx.quadraticCurveTo(x + 7, y - 32, x + 1, y - 27);
      ctx.stroke();
      break;
    case 6: // Transilvanian Hunger — a black blade with a white edge
      ctx.strokeStyle = 'rgba(220,225,240,0.25)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x + 7, y - 9);
      ctx.lineTo(x + 16, y - 27);
      ctx.stroke();
      ctx.strokeStyle = '#16171b';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(x + 7, y - 9);
      ctx.lineTo(x + 16, y - 27);
      ctx.stroke();
      ctx.strokeStyle = '#e8ecf2';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + 7.8, y - 9.4);
      ctx.lineTo(x + 16.8, y - 27.4);
      ctx.stroke();
      break;
    case 7: // Bloodletter — a barbed edge, wet and dark
      ctx.strokeStyle = '#26181a';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(x + 7, y - 9);
      ctx.lineTo(x + 16, y - 27);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(190,20,30,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 7.6, y - 10);
      ctx.lineTo(x + 15.6, y - 26);
      ctx.stroke();
      // Serrations.
      ctx.strokeStyle = '#1a1113';
      ctx.lineWidth = 1;
      for (const t of [0.3, 0.55, 0.8]) {
        const bx = x + 7 + (16 - 7) * t;
        const by = y - 9 + (-27 + 9) * t;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + 2.2, by + 0.8);
        ctx.stroke();
      }
      // A bead of blood at the tip.
      ctx.fillStyle = 'rgba(200,20,30,0.85)';
      ctx.beginPath();
      ctx.arc(x + 16, y - 27, 1.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    default: // Rusted Blade
      ctx.strokeStyle = getSteelPattern(ctx) ?? '#8f959d';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x + 7, y - 9);
      ctx.lineTo(x + 12, y - 19);
      ctx.stroke();
      ctx.strokeStyle = '#565b63';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 5.5, y - 11);
      ctx.lineTo(x + 9.5, y - 9.5);
      ctx.stroke();
  }
}

/** Armor shows on the cloak: trim, studs, mail, pauldrons, spikes, aura. */
function drawArmorDecor(ctx: CanvasRenderingContext2D, x: number, y: number, tier: number): void {
  if (tier <= 0) return;
  if (tier === 1) {
    // Ragged pale trim along the hem.
    ctx.strokeStyle = 'rgba(150,156,166,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 9, y - 1);
    ctx.lineTo(x - 5, y - 3);
    ctx.lineTo(x - 1, y - 1);
    ctx.lineTo(x + 3, y - 3);
    ctx.lineTo(x + 7, y - 1);
    ctx.stroke();
  }
  if (tier === 2) {
    ctx.fillStyle = '#8f959d';
    for (const [sx, sy] of [[-4, -12], [0, -13], [4, -12], [-3, -16], [3, -16]]) {
      ctx.beginPath();
      ctx.arc(x + sx, y + sy, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (tier === 3) {
    ctx.strokeStyle = 'rgba(140,148,158,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const yy of [-9, -13, -17]) {
      ctx.moveTo(x - 7, y + yy);
      ctx.quadraticCurveTo(x, y + yy + 2, x + 7, y + yy);
    }
    ctx.stroke();
  }
  if (tier >= 4) {
    // Pauldrons.
    ctx.fillStyle = '#7f8994';
    ctx.beginPath();
    ctx.ellipse(x - 7, y - 19, 3.5, 2.5, -0.4, 0, Math.PI * 2);
    ctx.ellipse(x + 7, y - 19, 3.5, 2.5, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,210,225,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 20);
    ctx.lineTo(x - 4, y - 21);
    ctx.moveTo(x + 4, y - 21);
    ctx.lineTo(x + 10, y - 20);
    ctx.stroke();
  }
  if (tier >= 5) {
    // Shoulder spikes.
    ctx.strokeStyle = '#aab3bd';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 20);
    ctx.lineTo(x - 12, y - 25);
    ctx.moveTo(x + 8, y - 20);
    ctx.lineTo(x + 12, y - 25);
    ctx.stroke();
  }
  if (tier >= 6) {
    // A cold nimbus clings to the aegis.
    ctx.strokeStyle = 'rgba(190,222,238,0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y - 13, 13, 17, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// --- boss looks -------------------------------------------------------------
// Indexed in step with BOSS_NAMES in game.ts. Quirks draw in local coords:
// origin at the feet, torso spanning y 0..-24, head centered at (0, -28).

interface BossLook {
  aura: string; // 'r,g,b' for the ring at the feet
  body: string;
  trim: string;
  skin: string;
  eyes: string;
  head: 'skull' | 'wolf' | 'hood';
  horns: boolean;
  crown: boolean;
  quirk: (ctx: CanvasRenderingContext2D, t: number) => void;
}

const BOSS_LOOKS: BossLook[] = [
  {
    // Euronymous — dead pale, black-streaked; bony hands rise at his feet.
    aura: '170,180,195',
    body: '#26292f',
    trim: 'rgba(160,170,182,0.35)',
    skin: '#cfd3d8',
    eyes: '#0a0a0c',
    head: 'skull',
    horns: false,
    crown: false,
    quirk: (ctx) => {
      ctx.strokeStyle = '#0a0a0c';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-2, -27.8);
      ctx.lineTo(-2, -24.8);
      ctx.moveTo(2, -27.8);
      ctx.lineTo(2, -24.8);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(207,211,216,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [hx, dir] of [[-10, 1], [9, -1]]) {
        for (let f = 0; f < 4; f++) {
          const fx = hx + f * 1.6 * dir;
          ctx.moveTo(fx, 1);
          ctx.lineTo(fx + dir * 0.5, -3.5 - (f % 2) * 1.5);
        }
      }
      ctx.stroke();
    },
  },
  {
    // Bathory — the only red thing in the dark; her hem drips.
    aura: '190,60,70',
    body: '#4a1016',
    trim: 'rgba(220,120,130,0.4)',
    skin: '#d9ced2',
    eyes: '#c0303a',
    head: 'skull',
    horns: false,
    crown: true,
    quirk: (ctx, t) => {
      ctx.strokeStyle = 'rgba(160,25,35,0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const dx = -5 + i * 5;
        const fall = (t * 10 + i * 3.1) % 7;
        ctx.moveTo(dx, -1);
        ctx.lineTo(dx, -1 + 2 + fall * 0.5);
      }
      ctx.stroke();
    },
  },
  {
    // Abbath — the iconic corpsepaint eye-patches, ice on his pauldrons.
    aura: '159,213,235',
    body: '#2f3d47',
    trim: 'rgba(159,213,235,0.5)',
    skin: '#e6eaee',
    eyes: '#e6eaee',
    head: 'skull',
    horns: false,
    crown: false,
    quirk: (ctx) => {
      ctx.fillStyle = '#0a0a0c';
      ctx.beginPath();
      ctx.ellipse(-1.9, -28.4, 2, 2.6, 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(1.9, -28.4, 2, 2.6, -0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-1.8, -28.2, 0.7, 0, Math.PI * 2);
      ctx.arc(1.8, -28.2, 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0a0a0c';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-1.5, -25.4);
      ctx.lineTo(1.5, -25.4);
      ctx.stroke();
      ctx.fillStyle = 'rgba(191,227,245,0.85)';
      for (const sx of [-8, 8]) {
        ctx.beginPath();
        ctx.moveTo(sx - 1, -19);
        ctx.lineTo(sx + 1, -19);
        ctx.lineTo(sx, -13.5);
        ctx.closePath();
        ctx.fill();
      }
    },
  },
  {
    // Fenriz — the grey wolf; shaggy fur tufts.
    aura: '150,160,170',
    body: '#3c4046',
    trim: 'rgba(150,158,168,0.4)',
    skin: '#8a9099',
    eyes: '#e8ecf2',
    head: 'wolf',
    horns: false,
    crown: false,
    quirk: (ctx) => {
      ctx.strokeStyle = 'rgba(138,144,153,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [sx, sy] of [[-9.5, -18], [-9, -12], [-9.5, -6], [9.5, -17], [9, -10], [9.5, -5]]) {
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + (sx < 0 ? -2.5 : 2.5), sy - 1.5);
      }
      ctx.stroke();
    },
  },
  {
    // Burzum — a hooded void with a hole where the heart was.
    aura: '100,110,130',
    body: '#0b0c10',
    trim: 'rgba(120,130,148,0.3)',
    skin: '#101217',
    eyes: '#e8ecf2',
    head: 'hood',
    horns: false,
    crown: false,
    quirk: (ctx, t) => {
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(0, -13, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(160,175,195,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, -13, 3.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(130,140,160,0.35)';
      ctx.beginPath();
      ctx.moveTo(-6, -20);
      ctx.quadraticCurveTo(-9 + Math.sin(t * 2) * 2, -27, -7, -32);
      ctx.moveTo(6, -19);
      ctx.quadraticCurveTo(9 + Math.cos(t * 1.7) * 2, -26, 7, -31);
      ctx.stroke();
    },
  },
  {
    // Gorgoroth — great curved horns and a barred gate for a shield.
    aura: '150,200,230',
    body: '#22262c',
    trim: 'rgba(143,179,201,0.35)',
    skin: '#b8bfc7',
    eyes: '#0a0a0c',
    head: 'skull',
    horns: false,
    crown: false,
    quirk: (ctx) => {
      ctx.strokeStyle = '#9aa1a9';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-3.5, -30.5);
      ctx.quadraticCurveTo(-9, -34, -8, -40);
      ctx.moveTo(3.5, -30.5);
      ctx.quadraticCurveTo(9, -34, 8, -40);
      ctx.stroke();
      ctx.fillStyle = '#14171c';
      ctx.fillRect(-16.5, -22, 7, 16);
      ctx.strokeStyle = 'rgba(160,170,185,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-16.5, -22, 7, 16);
      ctx.beginPath();
      for (const bx of [-14.6, -12.9, -11.2]) {
        ctx.moveTo(bx, -21);
        ctx.lineTo(bx, -7);
      }
      ctx.stroke();
    },
  },
  {
    // Marduk — sickly and plague-ridden, wreathed in miasma.
    aura: '120,140,90',
    body: '#39402f',
    trim: 'rgba(150,170,120,0.35)',
    skin: '#bcc2ae',
    eyes: '#0a0a0c',
    head: 'skull',
    horns: true,
    crown: false,
    quirk: (ctx, t) => {
      ctx.fillStyle = 'rgba(90,105,60,0.8)';
      for (let i = 0; i < 5; i++) {
        const a = t * 1.8 + i * 1.256;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * (9 + (i % 2) * 3), -13 + Math.sin(a) * 5 - i, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(120,140,80,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(3, -24);
      ctx.lineTo(3, -19);
      ctx.stroke();
    },
  },
  {
    // Immortal — crowned in ice, snow whirling about him.
    aura: '191,227,245',
    body: '#33414d',
    trim: 'rgba(191,227,245,0.45)',
    skin: '#e6eaee',
    eyes: '#bfe3f5',
    head: 'skull',
    horns: false,
    crown: false,
    quirk: (ctx, t) => {
      ctx.fillStyle = 'rgba(200,230,245,0.9)';
      for (const [x1, tip, x2] of [[-3.6, -2.3, -1], [-0.8, 0, 0.8], [1, 2.3, 3.6]]) {
        ctx.beginPath();
        ctx.moveTo(x1, -31);
        ctx.lineTo(tip, tip === 0 ? -38.5 : -37);
        ctx.lineTo(x2, -31);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(230,240,248,0.8)';
      for (let i = 0; i < 6; i++) {
        const a = t * 2.5 + i * 1.05;
        ctx.fillRect(Math.cos(a) * 13, -14 + Math.sin(a) * 6, 1.2, 1.2);
      }
    },
  },
  {
    // Emperor — storm-violet, lightning crackling at his shoulders.
    aura: '170,160,210',
    body: '#2e2b38',
    trim: 'rgba(175,165,205,0.4)',
    skin: '#cac5d4',
    eyes: '#efeaff',
    head: 'skull',
    horns: false,
    crown: true,
    quirk: (ctx, t) => {
      ctx.strokeStyle = 'rgba(232,228,255,0.85)';
      ctx.lineWidth = 1;
      if (Math.sin(t * 9) > 0.3) {
        ctx.beginPath();
        ctx.moveTo(-12, -27);
        ctx.lineTo(-9.5, -23);
        ctx.lineTo(-11.5, -20);
        ctx.lineTo(-9, -15);
        ctx.stroke();
      }
      if (Math.sin(t * 7 + 2) > 0.45) {
        ctx.beginPath();
        ctx.moveTo(12, -25);
        ctx.lineTo(9.5, -21);
        ctx.lineTo(11.5, -18);
        ctx.lineTo(9, -14);
        ctx.stroke();
      }
    },
  },
  {
    // Dissection — a reaper under cold stars.
    aura: '190,200,225',
    body: '#22262e',
    trim: 'rgba(180,190,210,0.35)',
    skin: '#b8bfc7',
    eyes: '#e8ecf2',
    head: 'skull',
    horns: true,
    crown: false,
    quirk: (ctx, t) => {
      ctx.strokeStyle = '#6f757e';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-11, 2);
      ctx.lineTo(7, -36);
      ctx.stroke();
      ctx.strokeStyle = '#c3c9d1';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(7, -36);
      ctx.quadraticCurveTo(-1, -42, -7, -37);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const sx = [-13, 12, 9][i];
        const sy = [-8, -30, -4][i];
        const a = 0.3 + 0.6 * Math.abs(Math.sin(t * 3 + i * 2));
        ctx.strokeStyle = `rgba(225,232,245,${a})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx - 2, sy);
        ctx.lineTo(sx + 2, sy);
        ctx.moveTo(sx, sy - 2);
        ctx.lineTo(sx, sy + 2);
        ctx.stroke();
      }
    },
  },
];

function bossLook(e: Enemy): BossLook {
  return BOSS_LOOKS[(e.bossId ?? 0) % BOSS_LOOKS.length];
}

function torsoPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-9.5, 0);
  // Ragged hem.
  ctx.lineTo(-7.5, -2.2);
  ctx.lineTo(-5.5, 0.4);
  ctx.lineTo(-3, -1.6);
  ctx.lineTo(-0.5, 0.6);
  ctx.lineTo(2.5, -1.8);
  ctx.lineTo(5.5, 0.3);
  ctx.lineTo(7.5, -2);
  ctx.lineTo(9.5, 0);
  // Flanks and shoulders.
  ctx.lineTo(10.3, -13);
  ctx.lineTo(10, -20);
  ctx.lineTo(4, -24);
  ctx.lineTo(-4, -24);
  ctx.lineTo(-10, -20);
  ctx.lineTo(-10.3, -13);
  ctx.closePath();
}

function drawTorso(ctx: CanvasRenderingContext2D, fill: string, trim: string): void {
  torsoPath(ctx);
  // Mail/hide, tinted per body color — shared by the draugr and every boss,
  // so the whole enemy roster gets the same material treatment the wretch
  // and boss heads already have.
  const steel = getSteelPattern(ctx);
  if (steel) {
    paintMaterial(ctx, steel, hexTint(fill, 0.62), false);
  } else {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  // Volume: shadow pooling toward the hem and the right flank.
  const g = ctx.createLinearGradient(0, -24, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.08)');
  g.addColorStop(0.4, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = g;
  ctx.fill();
  const side = ctx.createLinearGradient(-10, 0, 10, 0);
  side.addColorStop(0, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = side;
  ctx.fill();
  // Dark silhouette edge so the figure pops from the stone.
  ctx.strokeStyle = '#07070a';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.strokeStyle = trim;
  ctx.lineWidth = 1;
  ctx.stroke();
  // A rope belt cinching the waist.
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-9.8, -11.5);
  ctx.quadraticCurveTo(0, -9.5, 9.8, -11.5);
  ctx.stroke();
  ctx.strokeStyle = trim;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-9.8, -11.2);
  ctx.quadraticCurveTo(0, -9.2, 9.8, -11.2);
  ctx.stroke();
  // Cold rim light on the left shoulder.
  ctx.strokeStyle = 'rgba(185,200,215,0.28)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-10, -16);
  ctx.lineTo(-9.2, -19.5);
  ctx.lineTo(-4, -23.5);
  ctx.stroke();
}

function drawBossBody(ctx: CanvasRenderingContext2D, e: Enemy, time: number): void {
  const look = bossLook(e);
  drawTorso(ctx, look.body, look.trim);

  if (look.head === 'wolf') {
    // Shaggy neck fur.
    ctx.strokeStyle = look.skin;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const [fx2, fy2] of [[-4.5, -24], [-2.5, -24.8], [2.5, -24.8], [4.5, -24]]) {
      ctx.moveTo(fx2, fy2);
      ctx.lineTo(fx2 * 1.3, fy2 - 2.4);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -28, 4.5, 0, Math.PI * 2);
    const bossSkin = getSkinPattern(ctx);
    if (bossSkin) {
      paintMaterial(ctx, bossSkin, hexTint(look.skin, 0.65), false);
    } else {
      ctx.fillStyle = look.skin;
      ctx.fill();
    }
    // Muzzle with parted jaws.
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.moveTo(1, -29.5);
    ctx.lineTo(7.5, -27.5);
    ctx.lineTo(2, -26.4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(1.5, -25.8);
    ctx.lineTo(6.5, -25.2);
    ctx.lineTo(1.5, -24.2);
    ctx.closePath();
    ctx.fill();
    // Teeth glinting in the gap.
    ctx.strokeStyle = '#e8ecf2';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(2.5, -26.3);
    ctx.lineTo(6, -25.9);
    ctx.stroke();
    // Ears.
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.moveTo(-3.5, -31);
    ctx.lineTo(-4.5, -36.5);
    ctx.lineTo(-1.5, -32);
    ctx.closePath();
    ctx.moveTo(1.5, -32);
    ctx.lineTo(2.8, -36.5);
    ctx.lineTo(4.2, -31);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0a0a0c';
    ctx.beginPath();
    ctx.arc(7, -27.4, 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = look.eyes;
    ctx.beginPath();
    ctx.arc(-1.2, -28.8, 0.9, 0, Math.PI * 2);
    ctx.arc(2, -28.4, 0.9, 0, Math.PI * 2);
    ctx.fill();
  } else if (look.head === 'hood') {
    // A peaked cowl, the face lost in it.
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.moveTo(-6, -23.5);
    ctx.quadraticCurveTo(-6.5, -30, -3.5, -33);
    ctx.quadraticCurveTo(-1, -36.5, 0.8, -35.2);
    ctx.quadraticCurveTo(5.8, -31, 6, -23.5);
    ctx.quadraticCurveTo(0, -26.5, -6, -23.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#07070a';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = '#050507';
    ctx.beginPath();
    ctx.ellipse(0.2, -27.3, 3.4, 3.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = look.eyes;
    ctx.beginPath();
    ctx.arc(-1.5, -27.5, 0.8, 0, Math.PI * 2);
    ctx.arc(1.7, -27.5, 0.8, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // A bared skull: cranium, hollow sockets, nasal cleft, gritted teeth.
    ctx.beginPath();
    ctx.arc(0, -28.6, 4.6, Math.PI * 0.86, Math.PI * 0.14);
    ctx.lineTo(3.9, -26);
    ctx.quadraticCurveTo(3, -24.2, 1.8, -24);
    ctx.lineTo(-1.8, -24);
    ctx.quadraticCurveTo(-3, -24.2, -3.9, -26);
    ctx.closePath();
    const skullSkin = getSkinPattern(ctx);
    if (skullSkin) {
      paintMaterial(ctx, skullSkin, hexTint(look.skin, 0.65), false);
    } else {
      ctx.fillStyle = look.skin;
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(7,7,10,0.7)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    if (look.horns) {
      ctx.strokeStyle = '#9aa1a9';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(-3.5, -31);
      ctx.quadraticCurveTo(-6.5, -33, -7, -36.5);
      ctx.moveTo(3.5, -31);
      ctx.quadraticCurveTo(6.5, -33, 7, -36.5);
      ctx.stroke();
    }
    // Sockets, then whatever burns inside them.
    ctx.fillStyle = '#0a0a0c';
    ctx.beginPath();
    ctx.ellipse(-1.9, -28.4, 1.5, 1.7, 0, 0, Math.PI * 2);
    ctx.ellipse(1.9, -28.4, 1.5, 1.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = look.eyes;
    ctx.beginPath();
    ctx.arc(-1.9, -28.3, 0.8, 0, Math.PI * 2);
    ctx.arc(1.9, -28.3, 0.8, 0, Math.PI * 2);
    ctx.fill();
    // Nasal cleft and teeth.
    ctx.fillStyle = '#0a0a0c';
    ctx.beginPath();
    ctx.moveTo(0, -26.8);
    ctx.lineTo(-0.8, -25.6);
    ctx.lineTo(0.8, -25.6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,10,12,0.8)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (const tx of [-1.6, -0.5, 0.6, 1.7]) {
      ctx.moveTo(tx, -24.9);
      ctx.lineTo(tx, -24.1);
    }
    ctx.stroke();
  }

  if (look.crown) {
    ctx.strokeStyle = '#7d838c';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-3, -31.5);
    ctx.lineTo(-2.5, -35.5);
    ctx.moveTo(0, -32.5);
    ctx.lineTo(0, -37);
    ctx.moveTo(3, -31.5);
    ctx.lineTo(2.5, -35.5);
    ctx.stroke();
  }

  look.quirk(ctx, time);
}

function drawEnemy(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  e: Enemy,
  b: number,
  time: number,
): void {
  ctx.globalAlpha = Math.min(1, b * 1.4);
  const bob = e.path.length > 0 ? Math.sin(e.walkPhase) * 1.4 : 0;
  const { ox, oy } = lungeOffset(e);
  const scale = e.kind === 'boss' ? 1.6 : e.kind === 'brute' ? 1.3 : e.rare ? 1.2 : 1;
  drawShadow(ctx, fx, fy, (e.kind === 'wretch' ? 9 : 12) * scale);

  if (e.kind === 'boss') {
    const enraged = e.hp / e.maxHp <= 0.3;
    // Aura seething at his feet, tinted per boss — flares faster and redder
    // once enraged, the only warning before its cadence spikes.
    const auraRgb = enraged ? '210,50,40' : bossLook(e).aura;
    const pulseHz = enraged ? 8 : 3;
    ctx.strokeStyle = `rgba(${auraRgb},${(enraged ? 0.24 : 0.16) + 0.1 * Math.sin(time * pulseHz)})`;
    ctx.lineWidth = enraged ? 2.2 : 1.5;
    ctx.beginPath();
    ctx.ellipse(fx, fy, 22 + Math.sin(time * pulseHz) * 2, 10, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (e.kind === 'brute' && e.windupT > 0) {
    // Ground tell for the slam — the radius it's about to hit, filling in
    // as the windup completes so the player can read the deadline.
    const fill = 1 - e.windupT / 0.7;
    ctx.strokeStyle = `rgba(210,60,50,${0.35 + 0.35 * Math.sin(time * 16)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(fx, fy, 34 * fill, 15 * fill, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(fx + ox, fy + oy + bob);
  ctx.scale(scale, scale);

  if (e.kind === 'wretch') {
    const crawl = e.path.length > 0 ? Math.sin(e.walkPhase) : Math.sin(time * 1.6) * 0.3;
    // Far arm, knuckle-dragging.
    ctx.strokeStyle = '#3d4147';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-2, -7);
    ctx.quadraticCurveTo(-6, -4, -7.5 - crawl * 1.5, -0.5);
    ctx.stroke();
    // Hunched body, lit along the spine.
    const wg = ctx.createLinearGradient(0, -14, 0, 0);
    wg.addColorStop(0, '#6a707a');
    wg.addColorStop(0.55, '#4d525a');
    wg.addColorStop(1, '#33373d');
    ctx.beginPath();
    ctx.moveTo(-9, -2);
    ctx.quadraticCurveTo(-11.5, -8.5, -6.5, -12.5);
    ctx.quadraticCurveTo(-1.5, -15.5, 3.5, -12.5);
    ctx.quadraticCurveTo(7.5, -10.5, 8.5, -6.5);
    ctx.quadraticCurveTo(8, -2.5, 4, -1);
    ctx.quadraticCurveTo(-3, 1.2, -9, -2);
    ctx.closePath();
    const wretchSkin = getSkinPattern(ctx);
    if (wretchSkin) {
      paintMaterial(ctx, wretchSkin, 'rgba(150,168,148,0.55)', false);
    } else {
      ctx.fillStyle = wg;
      ctx.fill();
    }
    ctx.strokeStyle = '#07070a';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // Ribs pressing through the flank.
    ctx.strokeStyle = 'rgba(18,20,24,0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const rx of [-5.5, -3, -0.5]) {
      ctx.moveTo(rx, -9.5);
      ctx.quadraticCurveTo(rx + 1.5, -6, rx + 0.5, -3);
    }
    ctx.stroke();
    // Vertebrae spikes along the hump.
    ctx.strokeStyle = '#767d87';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (const [sx, sy] of [[-6.5, -10.5], [-4, -12.2], [-1, -13.2], [2, -12.6]]) {
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + 0.6, sy - 2.6);
    }
    ctx.stroke();
    // Near arm reaching ahead, ending in claws.
    ctx.strokeStyle = '#4a4f57';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(3.5, -6.5);
    ctx.quadraticCurveTo(7.5, -4.5, 8.5 + crawl * 2, -0.5);
    ctx.stroke();
    ctx.strokeStyle = '#767d87';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const c of [-1.2, 0, 1.2]) {
      ctx.moveTo(8.5 + crawl * 2, -0.5);
      ctx.lineTo(9.6 + crawl * 2 + c, 1.2);
    }
    ctx.stroke();
    // Head slung low ahead of the shoulders, jaw hanging.
    ctx.beginPath();
    ctx.ellipse(6.5, -9.5, 3.6, 3, 0.35, 0, Math.PI * 2);
    if (wretchSkin) {
      paintMaterial(ctx, wretchSkin, 'rgba(155,172,152,0.55)', false);
    } else {
      ctx.fillStyle = '#787f89';
      ctx.fill();
    }
    ctx.strokeStyle = '#07070a';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#4d525a';
    ctx.beginPath();
    ctx.moveTo(7.5, -7.5);
    ctx.lineTo(10, -6);
    ctx.lineTo(7, -5.5);
    ctx.closePath();
    ctx.fill();
    // Sunken eyes with a sickly gleam.
    eyeGlow(ctx, 6, -10.2, '210,225,235');
    eyeGlow(ctx, 8.4, -9.6, '210,225,235');
    ctx.fillStyle = '#e8ecf2';
    ctx.beginPath();
    ctx.arc(6, -10.2, 0.9, 0, Math.PI * 2);
    ctx.arc(8.4, -9.6, 0.9, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.kind === 'boss') {
    drawBossBody(ctx, e, time);
  } else if (e.kind === 'volva') {
    // A hooded seer — thin, robed, staff-borne, never swings a blade.
    const sway = e.path.length > 0 ? Math.sin(e.walkPhase) * 1.2 : Math.sin(time * 1.4) * 0.6;
    drawTorso(ctx, '#2c2438', 'rgba(160,120,210,0.35)');
    // Staff planted at her side, topped with a pulsing frost orb.
    ctx.strokeStyle = '#241d2c';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(9 + sway, -2);
    ctx.lineTo(11 + sway * 1.5, -27);
    ctx.stroke();
    const orbPulse = 2 + Math.sin(time * 4) * 0.5;
    eyeGlow(ctx, 11 + sway * 1.5, -28, '140,205,235', 5 + orbPulse);
    ctx.fillStyle = '#cfe8f5';
    ctx.beginPath();
    ctx.arc(11 + sway * 1.5, -28, 1.6, 0, Math.PI * 2);
    ctx.fill();
    // Deep hood, face lost to shadow but for two cold eyes.
    ctx.fillStyle = '#1c1722';
    ctx.beginPath();
    ctx.ellipse(0, -27, 5, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#07070a';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    eyeGlow(ctx, -1.6, -26.5, '175,140,225');
    eyeGlow(ctx, 1.6, -26.5, '175,140,225');
    ctx.fillStyle = '#d9c8f0';
    ctx.beginPath();
    ctx.arc(-1.6, -26.5, 0.7, 0, Math.PI * 2);
    ctx.arc(1.6, -26.5, 0.7, 0, Math.PI * 2);
    ctx.fill();
    // A tattered veil trailing off the hood's point.
    ctx.strokeStyle = 'rgba(160,120,210,0.4)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -32.5);
    ctx.quadraticCurveTo(-1.5 + sway, -34.5, -0.5 + sway * 1.6, -36.5);
    ctx.stroke();
  } else if (e.kind === 'ratling') {
    // A skittering vermin, always found in a pack — low, quick, disposable.
    const scurry = e.path.length > 0 ? Math.sin(e.walkPhase * 1.6) * 1.6 : 0;
    // Whip tail.
    ctx.strokeStyle = '#4a4144';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-5, -3);
    ctx.quadraticCurveTo(-9, -1 + scurry * 0.4, -11, -3.5 - scurry * 0.4);
    ctx.stroke();
    // Legs, blurred with motion.
    ctx.strokeStyle = '#26211f';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-2, -1);
    ctx.lineTo(-2.5 + scurry, 1);
    ctx.moveTo(2, -1);
    ctx.lineTo(2.5 - scurry, 1);
    ctx.stroke();
    // Hunched, mangy body.
    const rg = ctx.createLinearGradient(0, -8, 0, 0);
    rg.addColorStop(0, '#5c4f47');
    rg.addColorStop(1, '#332a25');
    ctx.beginPath();
    ctx.ellipse(-1, -4, 5.5, 3.6, 0.15, 0, Math.PI * 2);
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.strokeStyle = '#07070a';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Ragged ears atop a narrow skull.
    ctx.fillStyle = '#332a25';
    ctx.beginPath();
    ctx.moveTo(4, -8);
    ctx.lineTo(6, -10.5);
    ctx.lineTo(5.5, -7.5);
    ctx.closePath();
    ctx.moveTo(6.5, -6.5);
    ctx.lineTo(8.5, -8.5);
    ctx.lineTo(7.5, -6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(6.5, -6, 2.6, 2.1, 0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#4a3d35';
    ctx.fill();
    ctx.strokeStyle = '#07070a';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // Beady red eyes and bared teeth.
    eyeGlow(ctx, 7.5, -6.3, '210,60,50', 2);
    ctx.fillStyle = '#e8555f';
    ctx.beginPath();
    ctx.arc(7.5, -6.3, 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8e4dc';
    ctx.beginPath();
    ctx.moveTo(8.5, -5.2);
    ctx.lineTo(9.3, -4.6);
    ctx.lineTo(8.4, -4.5);
    ctx.closePath();
    ctx.fill();
  } else if (e.kind === 'brute') {
    // A slab of a corpse in rusted plate — slow, and telegraphs its slam
    // with a windup the player can see (and dodge) coming.
    const winding = e.windupT > 0;
    const stride = !winding && e.path.length > 0 ? Math.sin(e.walkPhase) * 1.6 : 0;
    ctx.strokeStyle = '#1c1f24';
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.moveTo(-4 + stride, -3);
    ctx.lineTo(-4.5 + stride, 0.5);
    ctx.moveTo(4 - stride, -3);
    ctx.lineTo(4.5 - stride, 0.5);
    ctx.stroke();
    drawTorso(ctx, '#3a3230', 'rgba(201,150,120,0.3)');
    // Studded, riveted bands across the chest.
    ctx.strokeStyle = 'rgba(15,13,12,0.65)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const my of [-19, -15.5]) {
      ctx.moveTo(-9, my);
      ctx.quadraticCurveTo(0, my + 1.8, 9, my);
    }
    ctx.stroke();
    ctx.fillStyle = '#8a7c6c';
    for (const [rx, ry] of [[-6, -18.4], [0, -16.5], [6, -18.4]]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // A raised maul, wound up over the shoulder while telegraphing.
    const raise = winding ? Math.min(1, 1 - e.windupT / 0.7) : 0.15;
    ctx.strokeStyle = '#2a2622';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(8, -20);
    ctx.quadraticCurveTo(12 + raise * 3, -22 - raise * 10, 13 + raise * 4, -30 - raise * 10);
    ctx.stroke();
    ctx.fillStyle = winding ? `rgba(180,60,50,${0.6 + 0.3 * Math.sin(time * 14)})` : '#565048';
    ctx.beginPath();
    ctx.arc(13 + raise * 4, -30 - raise * 10, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#07070a';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Squat, brutal head, jaw set low.
    ctx.fillStyle = '#4a423c';
    ctx.beginPath();
    ctx.ellipse(0, -26.5, 5.4, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#07070a';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    eyeGlow(ctx, -2, -27, '220,140,60');
    eyeGlow(ctx, 2, -27, '220,140,60');
    ctx.fillStyle = '#f0c890';
    ctx.beginPath();
    ctx.arc(-2, -27, 0.8, 0, Math.PI * 2);
    ctx.arc(2, -27, 0.8, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Draugr — a frost-bound revenant in grave-mail.
    const stride = e.path.length > 0 ? Math.sin(e.walkPhase) * 2 : 0;
    // Legs under the hem.
    ctx.strokeStyle = '#1c1f24';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-3 + stride, -3);
    ctx.lineTo(-3.5 + stride, 0.5);
    ctx.moveTo(3 - stride, -3);
    ctx.lineTo(3.5 - stride, 0.5);
    ctx.stroke();
    drawTorso(ctx, '#343a42', 'rgba(143,179,201,0.35)');
    // Mail rows across the chest.
    ctx.strokeStyle = 'rgba(20,24,30,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const my of [-20, -17.5, -15]) {
      ctx.moveTo(-8.5, my);
      ctx.quadraticCurveTo(0, my + 1.5, 8.5, my);
    }
    ctx.stroke();
    // Fur mantle bristling over the shoulders.
    ctx.strokeStyle = '#23262c';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const mx = -9 + i * 3;
      ctx.moveTo(mx, -20.5);
      ctx.lineTo(mx - 1 + (i % 2), -24 - (i % 3));
    }
    ctx.stroke();
    // Sword arm and a notched, rusted blade.
    ctx.strokeStyle = '#2a2e35';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(7, -18);
    ctx.quadraticCurveTo(10.5, -14, 10, -8.5);
    ctx.stroke();
    ctx.fillStyle = '#8a9099';
    ctx.beginPath();
    ctx.arc(10, -8, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7d838c';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(10.5, -9);
    ctx.lineTo(16.5, -20);
    ctx.stroke();
    // Notches bitten from the edge.
    ctx.strokeStyle = '#4a4f57';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12.6, -13.4);
    ctx.lineTo(13.6, -12.8);
    ctx.moveTo(14.4, -16.6);
    ctx.lineTo(15.4, -16);
    ctx.stroke();
    // Crossguard.
    ctx.strokeStyle = '#565b63';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(9.2, -10.8);
    ctx.lineTo(12.4, -9.2);
    ctx.stroke();
    // Horned helm with a black eye-slit.
    const hg = ctx.createLinearGradient(0, -33, 0, -24);
    hg.addColorStop(0, '#4d545e');
    hg.addColorStop(1, '#31363e');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(0, -28.2, 4.7, Math.PI, 0);
    ctx.lineTo(4.4, -25);
    ctx.lineTo(-4.4, -25);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#07070a';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Nasal bar.
    ctx.strokeStyle = '#565b63';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -28.5);
    ctx.lineTo(0, -25);
    ctx.stroke();
    // Horns sweeping out and up.
    ctx.strokeStyle = '#aab3bd';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(-4, -30);
    ctx.quadraticCurveTo(-7.5, -31.5, -8.5, -36);
    ctx.moveTo(4, -30);
    ctx.quadraticCurveTo(7.5, -31.5, 8.5, -36);
    ctx.stroke();
    // Cold eyes burning in the slit.
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(-3.6, -28.4, 7.2, 1.9);
    eyeGlow(ctx, -1.8, -27.5, '140,205,230');
    eyeGlow(ctx, 1.8, -27.5, '140,205,230');
    ctx.fillStyle = '#9fd4ea';
    ctx.beginPath();
    ctx.arc(-1.8, -27.5, 0.8, 0, Math.PI * 2);
    ctx.arc(1.8, -27.5, 0.8, 0, Math.PI * 2);
    ctx.fill();
    // Rime crusting one shoulder.
    ctx.fillStyle = 'rgba(159,196,216,0.22)';
    ctx.beginPath();
    ctx.ellipse(-7, -20.5, 3, 1.8, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Rare: a meaner silhouette (extra spikes) and a color tint, so a unique
  // reads as dangerous before you're close enough to see its name.
  if (e.rare) {
    drawRareSpikes(ctx, e.rare.seed);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgba(${e.rare.tint},0.5)`;
    ctx.beginPath();
    ctx.ellipse(0, -12, 11, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Frost-slow sheathes them in ice.
  if (e.slowT > 0) {
    ctx.fillStyle = `rgba(150,200,225,${Math.min(0.35, e.slowT * 0.18)})`;
    ctx.beginPath();
    ctx.ellipse(0, -12, 10, 14, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bleeding: droplets welling up and falling while the bleed ticks.
  if (e.bleedT > 0) {
    const drops = 3;
    for (let i = 0; i < drops; i++) {
      const seed = i * 47 + Math.floor(e.bleedT * 3);
      const fall = (time * 1.8 + seed) % 1;
      const dx = (Math.sin(seed) - 0.5) * 8;
      ctx.fillStyle = `rgba(190,20,30,${(1 - fall) * 0.75})`;
      ctx.beginPath();
      ctx.arc(dx, -10 + fall * 12, 1.3, 0, Math.PI * 2);
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

  if (e.hp < e.maxHp) {
    const bw = 18 * scale;
    const by = fy - 40 * scale;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(fx - bw / 2, by, bw, 3);
    ctx.fillStyle = '#8c2a2a';
    ctx.fillRect(fx - bw / 2, by, (bw * e.hp) / e.maxHp, 3);
  }
  ctx.globalAlpha = 1;
}

// --- depth-sorted draw pool -------------------------------------------
// render()'s painter's-algorithm pass (walls + enemies + player, sorted by
// tile-sum depth) used to allocate a fresh array and ~100-200 fresh arrow
// closures every frame just to defer drawing until after the sort. This
// pool is reused across frames — plain tagged slots instead of closures —
// and only ever grows; drawCount marks how many slots are "live" this
// frame, so a busier previous frame's leftover slots are simply never
// reached by the draw loop rather than being reallocated away.

type DrawKind = 0 | 1 | 2; // wall, enemy, player

interface DrawSlot {
  depth: number;
  kind: DrawKind;
  ws: WallStyle | null;
  e: Enemy | null;
  fx: number;
  fy: number;
  b: number;
  p: Player | null;
  pfx: number;
  pfy: number;
}

const drawPool: DrawSlot[] = [];
let drawCount = 0;

function nextDrawSlot(): DrawSlot {
  if (drawCount === drawPool.length) {
    drawPool.push({ depth: 0, kind: 0, ws: null, e: null, fx: 0, fy: 0, b: 0, p: null, pfx: 0, pfy: 0 });
  }
  return drawPool[drawCount++];
}

/** Insertion sort over drawPool[0, drawCount) instead of Array#sort. The
 * list is already close to depth order — walls are pushed in roughly that
 * order from the tile scan, so only the handful of enemies/player appended
 * after typically need to move — which is insertion sort's best case, and
 * it sorts a bounded prefix of a reused array in place without slicing a
 * fresh one the way Array#sort would require. */
function sortDrawPool(): void {
  for (let i = 1; i < drawCount; i++) {
    const cur = drawPool[i];
    let j = i - 1;
    while (j >= 0 && drawPool[j].depth > cur.depth) {
      drawPool[j + 1] = drawPool[j];
      j--;
    }
    drawPool[j + 1] = cur;
  }
}

function drawSlot(ctx: CanvasRenderingContext2D, game: Game, s: DrawSlot): void {
  switch (s.kind) {
    case 0:
      drawWallBlock(ctx, s.ws!);
      break;
    case 1:
      drawEnemy(ctx, s.fx, s.fy, s.e!, s.b, game.time);
      break;
    case 2:
      drawPlayer(ctx, s.pfx, s.pfy, s.p!, game.time);
      break;
  }
}

// --- main render ----------------------------------------------------------

export function render(ctx: CanvasRenderingContext2D, game: Game, view: View, dt: number): void {
  const { w, h } = view;
  // Low-res source photos + nearest-neighbor scaling = chunky 90s pixels
  // instead of a smooth blur, for every drawImage/pattern this frame.
  ctx.imageSmoothingEnabled = false;
  if (game.screen === 'title') {
    drawTitle(ctx, game, view, dt);
    return;
  }
  flickNow = 0.93 + 0.07 * Math.sin(game.time * 9 + Math.sin(game.time * 13.7) * 2);
  torchFlickNow = 0.88 + 0.12 * Math.sin(game.time * 7.3 + Math.sin(game.time * 11.1) * 1.5);
  ctx.fillStyle = '#050507';
  ctx.fillRect(0, 0, w, h);

  const { offX, offY } = getCamOffset(game, w, h);
  const d = game.dungeon;

  // Zoom the whole world view about screen center; screenToWorldTile()
  // mirrors this so mouse targeting still lines up.
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(VIEW_ZOOM, VIEW_ZOOM);
  ctx.translate(-w / 2, -h / 2);

  // Cached dim world, then live torchlit region on top.
  ensureStatic(d);
  ctx.drawImage(staticCanvas!, Math.round(offX - staticOX), Math.round(offY - STATIC_OY));

  const pcx = Math.round(game.player.x);
  const pcy = Math.round(game.player.y);
  const x0 = Math.max(0, pcx - DYNAMIC_RANGE);
  const x1 = Math.min(d.w - 1, pcx + DYNAMIC_RANGE);
  const y0 = Math.max(0, pcy - DYNAMIC_RANGE);
  const y1 = Math.min(d.h - 1, pcy + DYNAMIC_RANGE);

  // Torchlit floors.
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = y * d.w + x;
      const tile = d.tiles[idx];
      if (tile === Tile.Wall) continue;
      const b = lightAt(game, x, y);
      if (b <= 0.02) continue;
      const px = offX + isoX(x, y);
      const py = offY + isoY(x, y);
      if (px < -TILE_W || px > w + TILE_W || py < -TILE_H * 2 || py > h + TILE_H * 2) continue;
      drawFloorTile(ctx, px, py, x, y, b, outWarm, tile, game.time, aoMask(d, x, y));
    }
  }

  // Corpses lie flat on the floor.
  for (const c of game.corpses) {
    const b = Math.max(lightAt(game, c.x, c.y), d.explored[c.y * d.w + c.x] ? EXPLORED_BRIGHTNESS : 0);
    if (b <= 0.02) continue;
    const cx = offX + isoX(c.x, c.y);
    const cy = offY + isoY(c.x, c.y) + HH;
    ctx.globalAlpha = Math.min(1, b * 1.2);
    ctx.fillStyle = 'rgba(10,10,12,0.7)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 12, 5, c.seed * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(170,176,184,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const a = c.seed * Math.PI * 2;
    ctx.moveTo(cx - Math.cos(a) * 6, cy - Math.sin(a) * 3);
    ctx.lineTo(cx + Math.cos(a) * 6, cy + Math.sin(a) * 3);
    ctx.moveTo(cx - 3, cy + 2);
    ctx.lineTo(cx + 4, cy - 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Loot glimmers on the ground, even in the gloom.
  for (const g of game.groundItems) {
    const gx = Math.round(g.x);
    const gy = Math.round(g.y);
    const b = lightAt(game, g.x, g.y);
    const alpha = Math.max(b, d.explored[gy * d.w + gx] ? 0.3 : 0);
    if (alpha <= 0.02) continue;
    drawGroundItem(
      ctx,
      offX + isoX(g.x, g.y),
      offY + isoY(g.x, g.y) + HH,
      g.loot,
      game.time,
      Math.min(1, alpha * 1.3),
    );
  }

  // Hover tile highlight.
  const tp = screenToWorldTile(view.mouseX, view.mouseY, offX, offY, w, h);
  const htx = Math.floor(tp.x);
  const hty = Math.floor(tp.y);
  if (game.screen === 'playing' && !game.hoverEnemy && htx >= 0 && hty >= 0 && htx < d.w && hty < d.h) {
    const idx = hty * d.w + htx;
    if (d.tiles[idx] !== Tile.Wall && d.explored[idx]) {
      ctx.strokeStyle = 'rgba(220,226,234,0.18)';
      ctx.lineWidth = 1.5;
      diamond(ctx, offX + isoX(htx, hty), offY + isoY(htx, hty));
      ctx.stroke();
    }
  }

  // Torchlit walls and entities, painter-sorted by tile-sum depth.
  drawCount = 0;

  // The player's screen rect, for the Diablo-style fade on occluding walls.
  const pfx = offX + isoX(game.player.x, game.player.y);
  const pfy = offY + isoY(game.player.x, game.player.y) + HH;
  const psum = game.player.x + game.player.y;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = y * d.w + x;
      if (d.tiles[idx] !== Tile.Wall || !d.facing[idx]) continue;
      let b = lightAt(game, x, y);
      let warm = outWarm;
      if (b < 0.02) {
        if (!d.explored[idx]) continue;
        b = EXPLORED_BRIGHTNESS;
        warm = 0;
      }
      const px = offX + isoX(x, y);
      const py = offY + isoY(x, y);
      if (px < -TILE_W || px > w + TILE_W || py < -TILE_H - WALL_H * 1.2 || py > h + TILE_H * 2 + WALL_H) continue;

      // Fade oval: walls in front of the player go translucent inside a
      // soft ellipse around them, easing with distance so nothing pops.
      let cut = 0;
      if (x + y > psum + 0.01) {
        const dxs = px - pfx;
        const dys = py + TILE_H / 2 - WALL_H / 2 - (pfy - 20);
        const t = Math.hypot(dxs / 66, dys / 60);
        cut = Math.max(0, Math.min(1, (1.3 - t) / 0.55));
      }
      const ws = computeWallStyle(d, x, y, px, py, b, warm, cut, game.time);
      const s = nextDrawSlot();
      s.kind = 0;
      s.depth = x + y;
      s.ws = ws;
    }
  }

  for (const e of game.enemies) {
    const b = lightAt(game, e.x, e.y);
    if (b <= 0.03) continue;
    const fx = offX + isoX(e.x, e.y);
    const fy = offY + isoY(e.x, e.y) + HH;
    const s = nextDrawSlot();
    s.kind = 1;
    s.depth = e.x + e.y;
    s.e = e;
    s.fx = fx;
    s.fy = fy;
    s.b = b;
  }

  {
    const p = game.player;
    const s = nextDrawSlot();
    s.kind = 2;
    s.depth = p.x + p.y;
    s.p = p;
    s.pfx = pfx;
    s.pfy = pfy;
  }

  sortDrawPool();
  for (let i = 0; i < drawCount; i++) drawSlot(ctx, game, drawPool[i]);

  // Fireballs in flight.
  for (const pr of game.projectiles) {
    const cx = offX + isoX(pr.x, pr.y);
    const cy = offY + isoY(pr.x, pr.y) + HH - 14;
    // A Völva's bolt reads cold (icy blue) instead of the player's warm
    // fireball, so the player can tell at a glance who threw it.
    const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, 10);
    if (pr.hostile) {
      glow.addColorStop(0, 'rgba(200,235,255,0.9)');
      glow.addColorStop(0.4, 'rgba(110,190,230,0.5)');
      glow.addColorStop(1, 'rgba(90,170,220,0)');
    } else {
      glow.addColorStop(0, 'rgba(255,220,170,0.9)');
      glow.addColorStop(0.4, 'rgba(255,140,50,0.5)');
      glow.addColorStop(1, 'rgba(255,120,30,0)');
    }
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 11, cy - 11, 22, 22);
    ctx.fillStyle = pr.hostile ? '#a8dcf5' : '#ffb864';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Plague Bloom: a lingering sickly cloud, ground-level so spell rings
  // above still read clearly over it. A boss's hostile version washes
  // blood-red instead of the player's sickly green, so it never reads as
  // a safe zone.
  for (const hz of game.hazards) {
    const cx = offX + isoX(hz.x, hz.y);
    const cy = offY + isoY(hz.x, hz.y) + HH;
    const lifeT = 1 - hz.ttl / hz.maxTtl;
    const envelope = Math.min(1, lifeT * 6) * Math.min(1, (1 - lifeT) * 4);
    const rx = hz.r * HW;
    const ry = hz.r * HH;
    const pulse = 0.85 + 0.15 * Math.sin(game.time * 3 + hz.x * 3);
    const core = hz.hostile ? '190,60,50' : '120,190,90';
    const edge = hz.hostile ? '150,45,45' : '90,150,70';
    const mote = hz.hostile ? '225,100,90' : '170,225,140';
    const wash = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx * pulse);
    wash.addColorStop(0, `rgba(${core},${0.28 * envelope})`);
    wash.addColorStop(0.7, `rgba(${edge},${0.16 * envelope})`);
    wash.addColorStop(1, `rgba(${edge},0)`);
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * pulse, ry * pulse, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hz.hostile ? `rgba(220,90,80,${0.35 * envelope})` : `rgba(150,210,120,${0.35 * envelope})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * pulse, ry * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Motes bubbling up out of the rot.
    const motes = 5;
    for (let i = 0; i < motes; i++) {
      const seed = hz.x * 13 + hz.y * 7 + i * 31;
      const a = (i / motes) * Math.PI * 2 + seed;
      const dist = ((Math.sin(seed) + 1) / 2) * 0.75;
      const mx = cx + Math.cos(a) * rx * dist;
      const rise = ((game.time * 0.6 + seed) % 1) * 14;
      const my = cy + Math.sin(a) * ry * dist - rise;
      ctx.fillStyle = `rgba(${mote},${envelope * 0.6 * (1 - rise / 14)})`;
      ctx.beginPath();
      ctx.arc(mx, my, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Spell and level-up effects ring outward in world space.
  for (const ef of game.effects) {
    const cx = offX + isoX(ef.x, ef.y);
    const cy = offY + isoY(ef.x, ef.y) + HH;
    const fade = 1 - ef.t;
    if (ef.kind === 'nova') {
      const col = ef.color ?? '190,222,238';
      // Soft inner wash, so the ring reads as a shockwave, not a wire outline.
      const rMax = ef.t * ef.r * Math.SQRT2;
      const wash = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, rMax * HW));
      wash.addColorStop(0, `rgba(${col},0)`);
      wash.addColorStop(0.75, `rgba(${col},${fade * 0.05})`);
      wash.addColorStop(1, `rgba(${col},${fade * 0.16})`);
      ctx.fillStyle = wash;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rMax * HW, rMax * HH, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const f of [1, 0.72]) {
        const r = ef.t * ef.r * f * Math.SQRT2;
        ctx.strokeStyle = `rgba(${col},${fade * 0.8 * f})`;
        ctx.lineWidth = f === 1 ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * HW, r * HH, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Shards flung outward along the leading ring.
      const shards = 10;
      for (let i = 0; i < shards; i++) {
        const a = (i / shards) * Math.PI * 2 + ef.x * 0.7;
        const sx = cx + Math.cos(a) * rMax * HW;
        const sy = cy + Math.sin(a) * rMax * HH;
        ctx.strokeStyle = `rgba(${col},${fade * 0.85})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(sx - Math.cos(a) * 4, sy - Math.sin(a) * 4);
        ctx.lineTo(sx + Math.cos(a) * 3, sy + Math.sin(a) * 3);
        ctx.stroke();
      }
    } else if (ef.kind === 'boom') {
      const col = ef.color ?? '255,150,60';
      const r = ef.t * ef.r * Math.SQRT2;
      // Hot flash at the core, fiercest the instant it goes off.
      if (ef.t < 0.4) {
        const flashA = (1 - ef.t / 0.4) * 0.8;
        const flash = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, r * HW * 1.3));
        flash.addColorStop(0, `rgba(255,235,190,${flashA})`);
        flash.addColorStop(1, 'rgba(255,235,190,0)');
        ctx.fillStyle = flash;
        ctx.fillRect(cx - r * HW * 1.3, cy - r * HH * 1.3, r * HW * 2.6, r * HH * 2.6);
      }
      ctx.fillStyle = `rgba(${col},${fade * 0.4})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * HW, r * HH, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,200,120,${fade * 0.9})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * HW, r * HH, 0, 0, Math.PI * 2);
      ctx.stroke();
      // Embers spat outward and guttering as they cool.
      const embers = 8;
      for (let i = 0; i < embers; i++) {
        const a = (i / embers) * Math.PI * 2 + ef.y * 0.9;
        const dist = ef.t * (0.55 + (i % 3) * 0.18);
        const ex2 = cx + Math.cos(a) * dist * ef.r * HW * Math.SQRT2;
        const ey2 = cy + Math.sin(a) * dist * ef.r * HH * Math.SQRT2 - ef.t * 10;
        ctx.fillStyle = `rgba(255,${170 + (i % 3) * 20},90,${fade})`;
        ctx.beginPath();
        ctx.arc(ex2, ey2, 1.6 - ef.t * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (ef.kind === 'bolt') {
      // Jagged bolt, re-jittered every frame so it crackles.
      const ex = offX + isoX(ef.x2 ?? ef.x, ef.y2 ?? ef.y);
      const ey = offY + isoY(ef.x2 ?? ef.x, ef.y2 ?? ef.y) + HH - 16;
      const sy = cy - 16;
      const segs = 7;
      const pts: [number, number][] = [[cx, sy]];
      for (let i = 1; i < segs; i++) {
        const u = i / segs;
        pts.push([
          cx + (ex - cx) * u + (Math.random() - 0.5) * 9,
          sy + (ey - sy) * u + (Math.random() - 0.5) * 9,
        ]);
      }
      pts.push([ex, ey]);
      for (const [lw, col] of [
        [3.5, `rgba(180,170,255,${fade * 0.4})`],
        [1.4, `rgba(240,238,255,${fade * 0.95})`],
      ] as [number, string][]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const [px2, py2] of pts.slice(1)) ctx.lineTo(px2, py2);
        ctx.stroke();
      }
      // A short branching fork, and a flash where the bolt strikes home.
      const midI = Math.floor(segs / 2);
      const [mx, my] = pts[midI];
      ctx.strokeStyle = `rgba(210,205,255,${fade * 0.7})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + (Math.random() - 0.5) * 14, my + (Math.random() - 0.5) * 14 + 6);
      ctx.stroke();
      const strike = ctx.createRadialGradient(ex, ey, 0, ex, ey, 12);
      strike.addColorStop(0, `rgba(225,220,255,${fade * 0.8})`);
      strike.addColorStop(1, 'rgba(225,220,255,0)');
      ctx.fillStyle = strike;
      ctx.fillRect(ex - 12, ey - 12, 24, 24);
    } else if (ef.kind === 'drain') {
      // A crimson tendril linking caster and target, with droplets flowing
      // back toward the caster — blood spent to buy blood.
      const ex = offX + isoX(ef.x2 ?? ef.x, ef.y2 ?? ef.y);
      const ey = offY + isoY(ef.x2 ?? ef.x, ef.y2 ?? ef.y) + HH - 12;
      const sy = cy - 16;
      const mx = (cx + ex) / 2 + Math.sin(ef.t * 9) * 6;
      const my = (sy + ey) / 2 + Math.cos(ef.t * 7) * 4;
      ctx.strokeStyle = `rgba(180,20,30,${fade * 0.75})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, sy);
      ctx.quadraticCurveTo(mx, my, ex, ey);
      ctx.stroke();
      ctx.strokeStyle = `rgba(230,90,95,${fade * 0.5})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const u = 1 - ((ef.t * 2.5 + i * 0.25) % 1);
        const dx0 = (1 - u) * (1 - u) * cx + 2 * (1 - u) * u * mx + u * u * ex;
        const dy0 = (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * my + u * u * ey;
        ctx.fillStyle = `rgba(200,30,40,${fade * 0.8})`;
        ctx.beginPath();
        ctx.arc(dx0, dy0, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const r = ef.t * ef.r * Math.SQRT2;
      ctx.strokeStyle = `rgba(235,228,200,${fade * 0.75})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy - ef.t * 18, r * HW, r * HH, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Floating damage numbers — a quick pop on spawn, settling as they drift.
  ctx.textAlign = 'center';
  for (const n of game.dmgNums) {
    const nx = offX + isoX(n.x, n.y);
    const ny = offY + isoY(n.x, n.y) - 30 - (1 - n.t) * 28;
    ctx.globalAlpha = Math.min(1, n.t * 1.6);
    const pop = n.t > 0.82 ? 1 + (n.t - 0.82) * 3.4 : 1;
    ctx.save();
    ctx.translate(nx, ny);
    ctx.scale(pop, pop);
    ctx.font = `bold 17px ${FONT_GOTHIC}`;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeText(n.value, 0, 0);
    ctx.fillStyle = n.color;
    ctx.fillText(n.value, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  ctx.restore(); // end zoom transform — HUD/snow/vignette/grain stay screen-space

  // Ash-snow drifting over everything.
  updateSnow(dt, w, h, game.time);
  for (const f of flakes) {
    ctx.fillStyle = `rgba(196,205,214,${f.alpha})`;
    ctx.fillRect(f.x, f.y, f.size, f.size);
  }

  drawHud(ctx, game, view);

  // Vignette (cached — rebuilt only on resize).
  ctx.drawImage(getVignette(w, h), 0, 0);

  // Pain flash.
  if (game.hurtFlash > 0) {
    const hg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.7);
    hg.addColorStop(0, 'rgba(120,10,10,0)');
    hg.addColorStop(1, `rgba(120,10,10,${game.hurtFlash * 1.4})`);
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, w, h);
  }

  // Film grain (cached — re-stamped every ~90ms, blitted per frame).
  ctx.globalAlpha = 0.05;
  ctx.drawImage(getGrainScreen(w, h), 0, 0);
  ctx.globalAlpha = 1;

  if (game.screen === 'paused') drawPause(ctx, view);
  if (game.screen === 'dead') drawDeath(ctx, game, view);
}

// --- title & pause -----------------------------------------------------

function drawTitle(ctx: CanvasRenderingContext2D, game: Game, view: View, dt: number): void {
  const { w, h } = view;
  const t = performance.now() / 1000;
  ctx.fillStyle = '#050507';
  ctx.fillRect(0, 0, w, h);

  updateSnow(dt, w, h, t);
  for (const f of flakes) {
    ctx.fillStyle = `rgba(196,205,214,${f.alpha})`;
    ctx.fillRect(f.x, f.y, f.size, f.size);
  }

  ctx.textAlign = 'center';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '10px';
  ctx.font = `bold 76px ${FONT_GOTHIC}`;
  ctx.fillStyle = `rgba(215,221,229,${0.85 + 0.1 * Math.sin(t * 1.2)})`;
  ctx.fillText('SVARTFROST', w / 2, h * 0.32);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.font = `22px ${FONT_GOTHIC}`;
  ctx.fillStyle = 'rgba(160,168,178,0.75)';
  ctx.fillText('the frost takes all', w / 2, h * 0.32 + 46);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  const continueLabel = game.savedRun ? `Continue — Depth ${roman(game.savedRun.depth)}` : null;
  for (const item of titleMenu(w, h, continueLabel)) {
    const hovered =
      view.mouseX >= item.x &&
      view.mouseX <= item.x + item.w &&
      view.mouseY >= item.y &&
      view.mouseY <= item.y + item.h;
    ctx.font = `bold 32px ${FONT_GOTHIC}`;
    const labelW = ctx.measureText(item.label).width;
    ctx.fillStyle = hovered ? 'rgba(235,240,246,0.98)' : 'rgba(195,201,210,0.82)';
    ctx.fillText(item.label, w / 2, item.y + 30);
    if (hovered) {
      drawInvertedCross(ctx, w / 2 - labelW / 2 - 30, item.y + 22, 12, 0.85);
      drawInvertedCross(ctx, w / 2 + labelW / 2 + 30, item.y + 22, 12, 0.85);
    }
    ctx.font = `13px ${FONT_GOTHIC}`;
    ctx.fillStyle = 'rgba(170,176,186,0.6)';
    ctx.fillText(`[${item.hint}]`, w / 2, item.y + 48);
  }

  const r = game.records;
  if (r.runs > 0) {
    ctx.font = `16px ${FONT_GOTHIC}`;
    ctx.fillStyle = 'rgba(170,176,186,0.55)';
    ctx.fillText(
      `deepest — depth ${roman(Math.max(1, r.bestDepth))} · most souls — ${r.bestKills} · deaths — ${r.deaths}`,
      w / 2,
      h * 0.82,
    );
  }

  ctx.textAlign = 'right';
  ctx.font = '11px Georgia, serif';
  ctx.fillStyle = 'rgba(150,156,166,0.3)';
  ctx.fillText(`seed ${game.seed.toString(16)}`, w - 14, h - 12);

  ctx.drawImage(getVignette(w, h), 0, 0);
  ctx.globalAlpha = 0.05;
  ctx.drawImage(getGrainScreen(w, h), 0, 0);
  ctx.globalAlpha = 1;
}

function drawPause(ctx: CanvasRenderingContext2D, view: View): void {
  const { w, h } = view;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.font = `52px ${FONT_GOTHIC}`;
  ctx.fillStyle = '#c9ced6';
  ctx.fillText('Paused', w / 2, h * 0.42);
  ctx.font = `18px ${FONT_GOTHIC}`;
  ctx.fillStyle = 'rgba(180,186,196,0.8)';
  ctx.fillText(
    isTouchDevice ? 'Tap anywhere — return to the dark' : 'Esc — return to the dark',
    w / 2,
    h * 0.42 + 46,
  );
  if (!isTouchDevice) {
    ctx.fillText('T — abandon to the title (run kept at last depth)', w / 2, h * 0.42 + 74);
    ctx.fillText('M — mute', w / 2, h * 0.42 + 102);
  }

  // Volume control.
  const vol = getVolume();
  const layout = pauseVolumeLayout(w, h);
  ctx.font = `bold 15px ${FONT_GOTHIC}`;
  fillTextPop(ctx, `Volume  ${Math.round(vol * 100)}%`, w / 2, layout.cy - 22);
  const barW = 100;
  const barX = w / 2 - barW / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(barX, layout.cy - 4, barW, 8);
  ctx.fillStyle = 'rgba(190,198,210,0.9)';
  ctx.fillRect(barX, layout.cy - 4, barW * vol, 8);
  ctx.strokeStyle = 'rgba(210,216,224,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, layout.cy - 4, barW, 8);
  for (const [btn, label] of [
    [layout.minus, '−'],
    [layout.plus, '+'],
  ] as const) {
    ctx.beginPath();
    ctx.arc(btn.x, btn.y, btn.r, 0, Math.PI * 2);
    const steel = getUiSteelPattern(ctx);
    if (steel) {
      paintMaterial(ctx, steel, 'rgba(10,10,12,0.75)', false);
    } else {
      ctx.fillStyle = '#1c1d21';
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(200,205,212,0.4)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.font = `bold 18px ${FONT_GOTHIC}`;
    ctx.fillStyle = '#e8ebf0';
    ctx.fillText(label, btn.x, btn.y + 6);
  }
}

// --- HUD --------------------------------------------------------------

function drawOrb(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  frac: number,
  liquid: string,
  time: number,
  label: string,
): void {
  // Iron bezel — a tarnished-steel ring the glass sits in.
  const bezelR = r + 9;
  ctx.beginPath();
  ctx.arc(cx, cy, bezelR, 0, Math.PI * 2);
  const steel = getUiSteelPattern(ctx);
  if (steel) {
    paintMaterial(ctx, steel, 'rgba(18,18,20,0.72)', false);
  } else {
    ctx.fillStyle = '#1c1d21';
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(200,205,212,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, bezelR - 2, 0, Math.PI * 2);
  ctx.stroke();
  drawInvertedCross(ctx, cx, cy - bezelR + 7, 5, 0.55);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#0b0a0d';
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  const level = Math.max(0, Math.min(1, frac));
  const top = cy + r - level * r * 2;
  ctx.fillStyle = liquid;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy + r);
  ctx.lineTo(cx - r, top + Math.sin(time * 2) * 2);
  for (let i = -r; i <= r; i += 6) {
    ctx.lineTo(cx + i, top + Math.sin(time * 2 + i * 0.2) * 2);
  }
  ctx.lineTo(cx + r, cy + r);
  ctx.closePath();
  ctx.fill();
  const shine = ctx.createRadialGradient(cx - 10, cy - 14, 2, cx, cy, r);
  shine.addColorStop(0, 'rgba(255,255,255,0.16)');
  shine.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = shine;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
  ctx.strokeStyle = '#c9ced6';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 2.5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.font = `bold ${Math.round(r * 0.52)}px ${FONT_GOTHIC}`;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillText(label, cx + 1, cy + r * 0.16 + 1);
  ctx.fillStyle = '#f4f5f8';
  ctx.fillText(label, cx, cy + r * 0.16);
}

/** A riveted-iron plate — HUD readouts sit on these instead of bare
 * gameplay pixels, since a translucent stone/fire background is what made
 * the old grey text hard to read. */
function drawPlate(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2 + r, cy - h / 2);
  ctx.lineTo(cx + w / 2 - r, cy - h / 2);
  ctx.arc(cx + w / 2 - r, cy, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(cx - w / 2 + r, cy + h / 2);
  ctx.arc(cx - w / 2 + r, cy, r, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  const steel = getUiSteelPattern(ctx);
  if (steel) {
    paintMaterial(ctx, steel, 'rgba(8,8,10,0.8)', false);
  } else {
    ctx.fillStyle = 'rgba(8,7,9,0.82)';
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(150,156,166,0.4)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

/** High-contrast text: a dark offset pass under the pale fill, so it reads
 * over any background instead of blending into it. */
function fillTextPop(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill = '#f2f3f6'): void {
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillText(text, x + 1.2, y + 1.4);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** Truncates `text` with an ellipsis so it fits `maxWidth` at the context's
 * current font — used to keep long rolled item names off the satchel's
 * edge instead of overflowing the panel. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

/** Greedy word-wrap at the context's current font, for tooltip bodies. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(test).width > maxWidth) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** A small plate anchored above a point (e.g. hovering the potion belt),
 * for the same reason drawPlate exists on the HUD proper: bare text over
 * moving gameplay pixels is hard to read. */
function drawTooltipAbove(ctx: CanvasRenderingContext2D, cx: number, bottomY: number, lines: string[]): void {
  ctx.textAlign = 'center';
  let maxW = 0;
  for (const l of lines) {
    ctx.font = `bold 13px ${FONT_GOTHIC}`;
    maxW = Math.max(maxW, ctx.measureText(l).width);
  }
  const lineH = 18;
  const boxW = maxW + 26;
  const boxH = lines.length * lineH + 12;
  const cy = bottomY - boxH / 2 - 8;
  drawPlate(ctx, cx, cy, boxW, boxH);
  const top = cy - boxH / 2 + 16;
  lines.forEach((l, i) => {
    ctx.font = i === 0 ? `bold 13px ${FONT_GOTHIC}` : `12px ${FONT_GOTHIC}`;
    ctx.fillStyle = i === 0 ? '#f0f1f4' : 'rgba(205,211,219,0.8)';
    ctx.fillText(l, cx, top + i * lineH);
  });
}

/** A pill-shaped key hint, e.g. [Q] Potion — returns its width so callers
 * can lay a row of these out left to right. */
function drawKeyChip(ctx: CanvasRenderingContext2D, x: number, y: number, key: string, label: string): number {
  ctx.font = `bold 12px ${FONT_GOTHIC}`;
  const keyW = ctx.measureText(key).width;
  ctx.font = `12px ${FONT_GOTHIC}`;
  const labelW = ctx.measureText(label).width;
  const padX = 9;
  const gap = 7;
  const chipW = padX * 2 + keyW + gap + labelW;
  const chipH = 23;
  const r = chipH / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + chipW, y, x + chipW, y + chipH, r);
  ctx.arcTo(x + chipW, y + chipH, x, y + chipH, r);
  ctx.arcTo(x, y + chipH, x, y, r);
  ctx.arcTo(x, y, x + chipW, y, r);
  ctx.closePath();
  ctx.fillStyle = 'rgba(4,4,6,0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(170,176,186,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.font = `bold 12px ${FONT_GOTHIC}`;
  ctx.fillStyle = '#e8ebf0';
  ctx.fillText(key, x + padX, y + chipH / 2 + 4);
  ctx.font = `12px ${FONT_GOTHIC}`;
  ctx.fillStyle = 'rgba(190,196,204,0.78)';
  ctx.fillText(label, x + padX + keyW + gap, y + chipH / 2 + 4);
  return chipW;
}

/** A round steel touch button (satchel/pause) — `active` lights its rim,
 * for the satchel button while the panel is open. `drawIcon` runs with the
 * button's fill/stroke already set to a pale steel tone. */
function drawIconButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  active: boolean,
  drawIcon: () => void,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  const steel = getUiSteelPattern(ctx);
  if (steel) {
    paintMaterial(ctx, steel, active ? 'rgba(40,70,85,0.6)' : 'rgba(10,10,12,0.78)', false);
  } else {
    ctx.fillStyle = active ? '#284252' : '#1c1d21';
    ctx.fill();
  }
  ctx.strokeStyle = active ? 'rgba(159,213,235,0.7)' : 'rgba(200,205,212,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawIcon();
}

function drawHud(ctx: CanvasRenderingContext2D, game: Game, view: View): void {
  const { w, h } = view;
  const p = game.player;

  // Sized to use the corner room a 1080p+ window actually has; hudLayout()
  // shrinks everything on short (phone-landscape) viewports via its scale.
  const layout = hudLayout(w, h);
  const { orbR, bezelR, healthCx, manaCx, orbY, scale: s } = layout;
  drawOrb(ctx, healthCx, orbY, orbR, p.hp / p.maxHp, '#4d1016', game.time, String(Math.ceil(p.hp)));
  drawOrb(ctx, manaCx, orbY, orbR, p.mana / p.maxMana, '#173a52', game.time + 3, String(Math.floor(p.mana)));
  if (game.spellArmed) {
    // A cold pulse around the mana orb while a spell is armed for the next
    // tap/click on the field — the touch equivalent of right-click-to-cast.
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 6);
    ctx.strokeStyle = `rgba(159,213,235,${0.5 + pulse * 0.4})`;
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.arc(manaCx, orbY, bezelR + 5 * s, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Active spell above the mana orb — hover (or tap the orb) to see its cost.
  ctx.textAlign = 'center';
  ctx.font = `bold ${17 * s}px ${FONT_GOTHIC}`;
  const spell = SPELLS[p.spell.spell ?? 'frostnova'];
  const spellY = orbY - bezelR - 15 * s;
  fillTextPop(ctx, spell.name, manaCx, spellY);
  if (Math.hypot(view.mouseX - manaCx, view.mouseY - orbY) < bezelR + 4) {
    const how = isTouchDevice ? 'tap the orb, then the field' : 'right-click';
    drawTooltipAbove(ctx, manaCx, spellY - 14 * s, [spell.name, `${spell.cost} mana · ${how} to cast`]);
  }

  // Potion belt beside the health orb.
  const { x: bx, y: by, r: potionR } = layout.potion;
  ctx.fillStyle = '#6a161c';
  ctx.beginPath();
  ctx.ellipse(bx, by + 4 * s, 7 * s, 9 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#2a2d33';
  ctx.fillRect(bx - 2.5 * s, by - 12 * s, 5 * s, 8 * s);
  ctx.textAlign = 'left';
  ctx.font = `bold ${23 * s}px ${FONT_GOTHIC}`;
  fillTextPop(ctx, `× ${p.potions}`, bx + 15 * s, by + 8 * s);
  ctx.font = `bold ${14 * s}px ${FONT_GOTHIC}`;
  ctx.fillStyle = 'rgba(200,206,214,0.8)';
  ctx.fillText('Q', bx - 4 * s, by + 30 * s);
  if (Math.hypot(view.mouseX - bx, view.mouseY - by) < potionR + 4) {
    drawTooltipAbove(ctx, bx, by - 16 * s, ['Potion', `restores ${POTION_HEAL} HP · Q to quaff`]);
  }

  // Depth marker, on an iron plate so it reads over any floor beneath it.
  ctx.textAlign = 'center';
  const dmText = `Depth ${roman(game.depth)}`;
  ctx.font = `bold ${30 * s}px ${FONT_GOTHIC}`;
  const dmW = ctx.measureText(dmText).width;
  drawPlate(ctx, w / 2, 40 * s, dmW + 116 * s, 50 * s);
  drawInvertedCross(ctx, w / 2 - dmW / 2 - 36 * s, 40 * s, 13 * s, 0.85);
  drawInvertedCross(ctx, w / 2 + dmW / 2 + 36 * s, 40 * s, 13 * s, 0.85);
  fillTextPop(ctx, dmText, w / 2, 50 * s);

  // Boss health bar.
  const boss = game.boss;
  if (boss && boss.aggro) {
    const bw = w * 0.4;
    const by2 = 108 * s;
    ctx.font = `bold ${22 * s}px ${FONT_GOTHIC}`;
    fillTextPop(ctx, boss.name, w / 2, by2 - 12 * s);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(w / 2 - bw / 2, by2, bw, 13 * s);
    ctx.fillStyle = '#7a1f26';
    ctx.fillRect(w / 2 - bw / 2, by2, (bw * Math.max(0, boss.hp)) / boss.maxHp, 13 * s);
    ctx.strokeStyle = 'rgba(210,216,224,0.7)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(w / 2 - bw / 2, by2, bw, 13 * s);
  }

  // XP bar.
  const xw = Math.min(520, w * 0.46);
  const xx = w / 2 - xw / 2;
  const xy = h - 46 * s;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(xx, xy, xw, 9 * s);
  ctx.fillStyle = 'rgba(190,198,210,0.9)';
  ctx.fillRect(xx, xy, (xw * p.xp) / xpNext(p.level), 9 * s);
  ctx.strokeStyle = 'rgba(210,216,224,0.55)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(xx, xy, xw, 9 * s);
  ctx.font = `bold ${15 * s}px ${FONT_GOTHIC}`;
  fillTextPop(ctx, `Level ${roman(p.level)}`, w / 2, xy - 8 * s);

  // Kill count — a small sword badge left of the mana orb (mirrors the
  // potion belt beside the health orb), instead of text that used to run
  // into the orb.
  const kx = layout.killBadge.x;
  const ky = layout.killBadge.y;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#d8dce2';
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.moveTo(kx - 7 * s, ky + 11 * s);
  ctx.lineTo(kx + 8 * s, ky - 12 * s);
  ctx.stroke();
  ctx.strokeStyle = '#9aa1a9';
  ctx.lineWidth = 2.6 * s;
  ctx.beginPath();
  ctx.moveTo(kx - 10 * s, ky + 1 * s);
  ctx.lineTo(kx - 2 * s, ky + 8 * s);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = '#9aa1a9';
  ctx.beginPath();
  ctx.arc(kx - 8 * s, ky + 12 * s, 1.8 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.font = `bold ${22 * s}px ${FONT_GOTHIC}`;
  fillTextPop(ctx, `${game.kills}`, kx + 13 * s, ky + 9 * s);

  // Satchel / pause icon buttons — touch only, desktop already has I/Esc.
  if (isTouchDevice && game.screen === 'playing') {
    const sb = layout.satchelBtn;
    drawIconButton(ctx, sb.x, sb.y, sb.r, game.invOpen, () => {
      const rs = sb.r / 24;
      ctx.fillStyle = '#c9ced6';
      ctx.beginPath();
      ctx.moveTo(sb.x - 7 * rs, sb.y - 3 * rs);
      ctx.lineTo(sb.x - 6 * rs, sb.y + 7 * rs);
      ctx.quadraticCurveTo(sb.x, sb.y + 9 * rs, sb.x + 6 * rs, sb.y + 7 * rs);
      ctx.lineTo(sb.x + 7 * rs, sb.y - 3 * rs);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#3a3d43';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sb.x - 4 * rs, sb.y - 3 * rs);
      ctx.quadraticCurveTo(sb.x, sb.y - 7 * rs, sb.x + 4 * rs, sb.y - 3 * rs);
      ctx.stroke();
    });
    const pb = layout.pauseBtn;
    drawIconButton(ctx, pb.x, pb.y, pb.r, false, () => {
      const rs = pb.r / 24;
      ctx.fillStyle = '#c9ced6';
      ctx.fillRect(pb.x - 6 * rs, pb.y - 8 * rs, 4 * rs, 16 * rs);
      ctx.fillRect(pb.x + 2 * rs, pb.y - 8 * rs, 4 * rs, 16 * rs);
    });
  }

  // FPS meter (toggle with P).
  if (game.showFps && view.fps !== undefined) {
    ctx.textAlign = 'left';
    ctx.font = '13px Georgia, serif';
    ctx.fillStyle = 'rgba(170,176,184,0.7)';
    ctx.fillText(`${view.fps} fps`, 16, 24);
  }

  // Hint chips instead of one dense sentence.
  const chips: [string, string][] = isTouchDevice
    ? [
        ['Hold', 'Move'],
        ['Tap orb', 'Cast'],
        ['Belt', 'Potion'],
      ]
    : [
        ['Hold click', 'Move'],
        ['Right-click', 'Cast'],
        ['Q', 'Quaff'],
        ['I', 'Satchel'],
        ['M', 'Mute'],
      ];
  const chipGap = 8;
  ctx.font = `bold 12px ${FONT_GOTHIC}`;
  let chipsW = 0;
  for (const [key, label] of chips) {
    ctx.font = `bold 12px ${FONT_GOTHIC}`;
    const kw = ctx.measureText(key).width;
    ctx.font = `12px ${FONT_GOTHIC}`;
    chipsW += 9 * 2 + kw + 7 + ctx.measureText(label).width + chipGap;
  }
  chipsW -= chipGap;
  let chipX = w / 2 - chipsW / 2;
  const chipY = h - 34 * s;
  for (const [key, label] of chips) {
    chipX += drawKeyChip(ctx, chipX, chipY, key, label) + chipGap;
  }
  ctx.textAlign = 'center'; // drawKeyChip leaves it 'left' — restore the ambient default

  // Enemy nameplate under the cursor, on its own small plate for contrast —
  // clamped inside the viewport so it can't clip off-screen near an edge.
  if (game.hoverEnemy) {
    const e = game.hoverEnemy;
    const label = `${e.name} — ${Math.max(0, Math.ceil(e.hp))}/${e.maxHp}`;
    ctx.textAlign = 'center';
    ctx.font = `bold 17px ${FONT_GOTHIC}`;
    const lw = ctx.measureText(label).width;
    const boxW = lw + 20;
    const boxH = 26;
    const bx2 = Math.max(8, Math.min(w - 8 - boxW, view.mouseX - boxW / 2));
    const by2 = Math.max(8, Math.min(h - 8 - boxH, view.mouseY - 38));
    ctx.fillStyle = 'rgba(6,6,8,0.72)';
    ctx.fillRect(bx2, by2, boxW, boxH);
    fillTextPop(ctx, label, bx2 + boxW / 2, by2 + 19);
  }

  if (game.invOpen) drawInventory(ctx, game, view);

  // Banner.
  if (game.banner.t > 0) {
    const alpha = Math.min(1, game.banner.t * 0.8);
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(0,0,0,${alpha * 0.8})`;
    ctx.font = `bold 66px ${FONT_GOTHIC}`;
    ctx.fillText(game.banner.text, w / 2 + 2, h * 0.34 + 2);
    ctx.fillStyle = `rgba(225,229,236,${alpha})`;
    ctx.fillText(game.banner.text, w / 2, h * 0.34);
    if (game.banner.sub) {
      ctx.font = `22px ${FONT_GOTHIC}`;
      ctx.fillStyle = `rgba(160,168,178,${alpha * 0.8})`;
      ctx.fillText(game.banner.sub, w / 2, h * 0.34 + 40);
    }
  }
}

// Item-type accent colors, so a satchel row reads at a glance before the
// text does — reused from the tones already on the player/HUD elsewhere.
// Diablo-style rarity coloring: undecorated white/gray for a plain drop,
// blue for a single-affix magic item, gold for a 2-3 affix rare — so the
// player can tell a good drop apart from junk without reading the tooltip.
function rarityColor(loot: { rarity?: 'magic' | 'rare' } | 'potion'): string | null {
  if (loot === 'potion') return null;
  if (loot.rarity === 'rare') return '#e0b64a';
  if (loot.rarity === 'magic') return '#6fa8dc';
  return null;
}

function itemAccent(loot: { kind: string }): string {
  switch (loot.kind) {
    case 'weapon':
      return '#aab3bd';
    case 'armor':
      return '#8f959d';
    case 'trinket':
      return '#b98fd9';
    case 'tome':
      return '#7fb8dd';
    default:
      return '#8b9099';
  }
}

function drawInventory(ctx: CanvasRenderingContext2D, game: Game, view: View): void {
  const p = game.player;
  const s = hudScale(view.w, view.h);
  const m = invMetrics(view.w, view.h);
  const rect = invPanelRect(view.w, view.h, p.inventory.length);

  // A hide stretched over the frame: leather fill, ragged top edge, jagged
  // stitched border, inverted-cross corner studs.
  const ragged = 6 * s;
  ctx.beginPath();
  ctx.moveTo(rect.x, rect.y + ragged);
  const teeth = 10;
  for (let i = 0; i <= teeth; i++) {
    const tx = rect.x + (rect.w * i) / teeth;
    ctx.lineTo(tx, rect.y + (i % 2 === 0 ? 0 : ragged));
  }
  ctx.lineTo(rect.x + rect.w, rect.y + rect.h);
  ctx.lineTo(rect.x, rect.y + rect.h);
  ctx.closePath();
  const leather = getUiLeatherPattern(ctx);
  if (leather) {
    paintMaterial(ctx, leather, 'rgba(28,10,10,0.82)', false);
  } else {
    ctx.fillStyle = 'rgba(14,7,8,0.93)';
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(150,60,60,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  drawInvertedCross(ctx, rect.x + 16 * s, rect.y + rect.h - 16 * s, 8 * s, 0.4);
  drawInvertedCross(ctx, rect.x + rect.w - 16 * s, rect.y + rect.h - 16 * s, 8 * s, 0.4);

  ctx.textAlign = 'left';
  ctx.font = `bold ${28 * s}px ${FONT_GOTHIC}`;
  fillTextPop(ctx, 'Satchel', rect.x + m.pad, rect.y + 40 * s);
  drawInvertedCross(ctx, rect.x + rect.w - 30 * s, rect.y + 32 * s, 11 * s, 0.75);

  ctx.font = `${15 * s}px ${FONT_GOTHIC}`;
  const stats: [string, string][] = [
    ['Blade', describeItem(p.weapon)],
    ['Armor', p.armor ? describeItem(p.armor) : '—'],
    ['Charm', p.trinket ? describeItem(p.trinket) : '—'],
    ['Spell', describeItem(p.spell)],
  ];
  const equipped: (Item | null)[] = [p.weapon, p.armor, p.trinket, p.spell];
  const statValueMaxW = rect.w - m.pad * 2 - 62 * s;
  stats.forEach(([label, value], i) => {
    const ry = rect.y + 70 * s + i * 22 * s;
    ctx.fillStyle = 'rgba(220,190,190,0.55)';
    ctx.fillText(label, rect.x + m.pad, ry);
    fillTextPop(ctx, fitText(ctx, value, statValueMaxW), rect.x + m.pad + 62 * s, ry, rarityColor(equipped[i] ?? {}) ?? '#eceef2');
  });

  // A stitched seam instead of a plain divider.
  ctx.strokeStyle = 'rgba(210,180,180,0.28)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(rect.x + m.pad, rect.y + m.headerH - 10 * s);
  ctx.lineTo(rect.x + rect.w - m.pad, rect.y + m.headerH - 10 * s);
  ctx.stroke();
  ctx.setLineDash([]);

  if (p.inventory.length === 0) {
    ctx.font = `italic ${15 * s}px ${FONT_GOTHIC}`;
    ctx.fillStyle = 'rgba(190,160,160,0.55)';
    ctx.fillText('nothing but dust', rect.x + m.pad, rect.y + m.headerH + 22 * s);
    return;
  }

  for (let i = 0; i < p.inventory.length; i++) {
    const ry = rect.y + m.headerH + i * m.rowH;
    const hovered =
      view.mouseX >= rect.x &&
      view.mouseX <= rect.x + rect.w &&
      view.mouseY >= ry &&
      view.mouseY < ry + m.rowH;
    if (hovered) {
      ctx.fillStyle = 'rgba(140,20,25,0.28)';
      ctx.fillRect(rect.x + 3, ry, rect.w - 6, m.rowH);
    }
    const loot = p.inventory[i];
    ctx.fillStyle = rarityColor(loot) ?? itemAccent(loot);
    ctx.beginPath();
    ctx.arc(rect.x + m.pad + 3 * s, ry + m.rowH / 2 + 1 * s, 3.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `${16 * s}px ${FONT_GOTHIC}`;
    // Name only, truncated to fit — the full stat line lives in the hover
    // tooltip instead of overflowing the panel.
    const name = loot.name;
    const nameMaxW = rect.w - m.pad - 16 * s - m.pad - (hovered ? 92 * s : 0);
    fillTextPop(ctx, fitText(ctx, name, nameMaxW), rect.x + m.pad + 16 * s, ry + 24 * s, rarityColor(loot) ?? '#e4e7ec');
    if (hovered) {
      ctx.textAlign = 'right';
      ctx.font = `italic bold ${13 * s}px ${FONT_GOTHIC}`;
      ctx.fillStyle = 'rgba(230,190,190,0.85)';
      ctx.fillText('equip / drop', rect.x + rect.w - m.pad, ry + 24 * s);
      ctx.textAlign = 'left';

      const stat = itemStatLine(loot);
      const tipLines = [name, ...(stat ? wrapText(ctx, stat, 190 * s) : [])];
      drawTooltipAbove(ctx, rect.x + rect.w / 2, ry, tipLines);
      ctx.textAlign = 'left';
    }
  }
}

function drawDeath(ctx: CanvasRenderingContext2D, game: Game, view: View): void {
  const { w, h } = view;
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.font = `56px ${FONT_GOTHIC}`;
  ctx.fillStyle = '#c9ced6';
  ctx.fillText('You Have Been Slain', w / 2, h * 0.42);
  ctx.font = `20px ${FONT_GOTHIC}`;
  ctx.fillStyle = 'rgba(170,176,186,0.8)';
  ctx.fillText(
    `souls reaped: ${game.kills} · depth ${roman(game.depth)} · level ${roman(game.player.level)}`,
    w / 2,
    h * 0.42 + 44,
  );
  ctx.fillStyle = `rgba(200,206,214,${0.5 + 0.3 * Math.sin(game.time * 3)})`;
  ctx.fillText('press R to rise from the frost', w / 2, h * 0.42 + 84);
  ctx.fillStyle = 'rgba(170,176,186,0.6)';
  ctx.fillText('Esc — return to the title', w / 2, h * 0.42 + 116);
}
