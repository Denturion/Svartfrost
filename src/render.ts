import {
  EXPLORED_BRIGHTNESS,
  FONT_GOTHIC,
  LIGHT_RADIUS,
  PALETTE,
  TILE_H,
  TILE_W,
  WALL_H,
  roman,
  shade,
  tileHash,
} from './config';
import { Tile } from './dungeon';
import type { Dungeon } from './dungeon';
import type { Game } from './game';
import { describeItem } from './items';
import type { Loot } from './items';
import { isoX, isoY, screenToTile } from './iso';
import { INV, invPanelRect, titleMenu } from './ui';
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

let flickNow = 1;
let torchFlickNow = 1;
/** Warmth (0 = cold player light, 1 = pure torchlight) of the last lightAt call. */
let outWarm = 0;

function brightnessAt(game: Game, x: number, y: number): number {
  const d = Math.hypot(x - game.player.x, y - game.player.y);
  const b = (1.25 - d / LIGHT_RADIUS) * flickNow;
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
    const fall = (1 - Math.hypot(dx, dy) / TORCH_RADIUS) * TORCH_POWER;
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
  const base = (x + y) % 2 === 0 ? PALETTE.floorA : PALETTE.floorB;
  ctx.fillStyle = shade(base, b * j, warm);
  diamond(ctx, px, py);
  ctx.fill();

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
  // Rough-hewn stone: grid-corner jitter (shared corners match between
  // neighbors) so wall banks read as rock, not perfect boxes.
  const jit: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const gx = x + (i === 1 || i === 2 ? 1 : 0);
    const gy = y + (i === 2 || i === 3 ? 1 : 0);
    const m = ruined ? 2.2 : 1;
    jit.push([
      (tileHash(gx * 5 + 1, gy * 7 + 2) - 0.5) * 4.5 * m,
      (tileHash(gx * 11 + 4, gy * 3 + 8) - 0.5) * 3.5 * m,
    ]);
  }
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
    px,
    py,
    hgt: ruined ? WALL_H * (0.5 + h1 * 0.9) : WALL_H * (0.92 + h1 * 0.16),
    bj: b * (0.85 + h1 * 0.3),
    warm,
    cut,
    pillar,
    ruined,
    frost: !pillar && h1 > 0.78,
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

function drawWallBlock(ctx: CanvasRenderingContext2D, ws: WallStyle): void {
  const { px, py, bj, warm, h1, hgt } = ws;
  // Occluding walls turn translucent instead of sinking. The dim explored
  // cache already blitted beneath keeps them reading as stone, not holes,
  // while the player (drawn earlier) shows through.
  if (ws.cut > 0) ctx.globalAlpha = 1 - 0.76 * ws.cut;

  if (ws.pillar) {
    drawPillar(ctx, ws);
    ctx.globalAlpha = 1;
    return;
  }

  // Jittered top corners (N, E, S, W).
  const [jN, jE, jS, jW] = ws.jit;
  const nX = px + jN[0];
  const nY = py - hgt + jN[1];
  const eX = px + HW + jE[0];
  const eY = py + HH - hgt + jE[1];
  const sX = px + jS[0];
  const sY = py + TILE_H - hgt + jS[1];
  const wX = px - HW + jW[0];
  const wY = py + HH - hgt + jW[1];

  // South-west face.
  ctx.fillStyle = shade(PALETTE.wallLeft, bj, warm);
  ctx.beginPath();
  ctx.moveTo(px - HW, py + HH);
  ctx.lineTo(px, py + TILE_H);
  ctx.lineTo(sX, sY);
  ctx.lineTo(wX, wY);
  ctx.closePath();
  ctx.fill();
  // South-east face.
  ctx.fillStyle = shade(PALETTE.wallRight, bj, warm);
  ctx.beginPath();
  ctx.moveTo(px + HW, py + HH);
  ctx.lineTo(px, py + TILE_H);
  ctx.lineTo(sX, sY);
  ctx.lineTo(eX, eY);
  ctx.closePath();
  ctx.fill();

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

  // Top slab, jittered.
  ctx.fillStyle = shade(PALETTE.wallTop, bj, warm);
  ctx.beginPath();
  ctx.moveTo(nX, nY);
  ctx.lineTo(eX, eY);
  ctx.lineTo(sX, sY);
  ctx.lineTo(wX, wY);
  ctx.closePath();
  ctx.fill();
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
  // Moon-pale rim on the upper edges.
  ctx.strokeStyle = `rgba(180,195,210,${0.08 + bj * 0.14})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(wX, wY);
  ctx.lineTo(nX, nY);
  ctx.lineTo(eX, eY);
  ctx.stroke();

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

  if (ws.torch) drawSconce(ctx, ws, hgt);
  ctx.globalAlpha = 1;
}

/** A wall-mounted torch: bracket, flame, and warm glow. */
function drawSconce(ctx: CanvasRenderingContext2D, ws: WallStyle, hgt: number): void {
  const { px, py, time } = ws;
  const fx = ws.torch === 'sw' ? px - HW * 0.5 : px + HW * 0.5;
  const fy = py + HH + HH * 0.5 - hgt * 0.45;
  const flh = time === null ? 1 : 1 + 0.22 * Math.sin(time * 9 + px * 0.7) + 0.12 * Math.sin(time * 23 + py);

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
  ctx.strokeStyle = `rgba(180,195,210,${0.08 + bj * 0.14})`;
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

function rebuildStatic(d: Dungeon): void {
  const c = staticCanvas!.getContext('2d')!;
  c.clearRect(0, 0, staticCanvas!.width, staticCanvas!.height);

  for (let y = 0; y < d.h; y++) {
    for (let x = 0; x < d.w; x++) {
      const idx = y * d.w + x;
      if (!d.explored[idx]) continue;
      const tile = d.tiles[idx];
      if (tile === Tile.Wall) continue;
      const sb = staticLightAt(d, x, y);
      drawFloorTile(c, staticOX + isoX(x, y), STATIC_OY + isoY(x, y), x, y, sb, outWarm, tile, null, aoMask(d, x, y));
    }
  }

  const walls: { x: number; y: number }[] = [];
  for (let y = 0; y < d.h; y++) {
    for (let x = 0; x < d.w; x++) {
      const idx = y * d.w + x;
      if (d.explored[idx] && d.tiles[idx] === Tile.Wall && d.facing[idx]) walls.push({ x, y });
    }
  }
  walls.sort((a, b) => a.x + a.y - (b.x + b.y));
  for (const { x, y } of walls) {
    const px = staticOX + isoX(x, y);
    const py = STATIC_OY + isoY(x, y);
    const sb = staticLightAt(d, x, y);
    drawWallBlock(c, computeWallStyle(d, x, y, px, py, sb, outWarm, 0, null));
  }
}

function ensureStatic(d: Dungeon): void {
  if (!staticCanvas) staticCanvas = document.createElement('canvas');
  if (staticFor !== d) {
    staticCanvas.width = (d.w + d.h) * HW;
    staticCanvas.height = (d.w + d.h) * HH + STATIC_OY + TILE_H;
    staticOX = d.h * HW;
    staticFor = d;
    staticCount = -1;
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
    vg.addColorStop(1, 'rgba(0,0,0,0.62)');
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
      img.data[i + 3] = 28;
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

/** A soft radial gleam behind glowing eyes. */
function eyeGlow(ctx: CanvasRenderingContext2D, x: number, y: number, rgb: string, r = 2.8): void {
  const g = ctx.createRadialGradient(x, y, 0.2, x, y, r);
  g.addColorStop(0, `rgba(${rgb},0.55)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function drawPlayer(ctx: CanvasRenderingContext2D, fx: number, fy: number, p: Player, time: number): void {
  const moving = p.path.length > 0;
  const bob = moving ? Math.sin(p.walkPhase) * 1.6 : Math.sin(time * 2) * 0.7;
  const sway = moving ? Math.sin(p.walkPhase * 0.5) * 1.4 : Math.sin(time * 1.3) * 0.5;
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
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.moveTo(x - 10.5 + sway, y);
  const hem = [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5];
  for (let i = 0; i < hem.length; i++) {
    const lift = (i % 2 === 0 ? -2.4 : 0.5) + Math.sin(p.walkPhase * 0.5 + i * 1.7) * 0.7;
    ctx.lineTo(x + hem[i] + sway * (0.4 + 0.1 * i), y + lift);
  }
  ctx.lineTo(x + 10.5 + sway, y);
  ctx.quadraticCurveTo(x + 10, y - 12, x + 7.5, y - 20);
  ctx.quadraticCurveTo(x + 5.5, y - 24.5, x, y - 25.5);
  ctx.quadraticCurveTo(x - 5.5, y - 24.5, x - 7.5, y - 20);
  ctx.quadraticCurveTo(x - 10, y - 12, x - 10.5 + sway, y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#07070a';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120,128,138,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // The cloak parts over a darker inner robe.
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.moveTo(x - 1.5, y - 22);
  ctx.lineTo(x + 2 + sway * 0.5, y - 2);
  ctx.lineTo(x - 3.5 + sway * 0.5, y - 2);
  ctx.closePath();
  ctx.fill();
  // Belt with a bone toggle.
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x - 8.7, y - 12);
  ctx.quadraticCurveTo(x, y - 10, x + 8.7, y - 12);
  ctx.stroke();
  ctx.fillStyle = '#9aa1a9';
  ctx.beginPath();
  ctx.ellipse(x - 0.5, y - 10.8, 1.8, 1.1, 0.2, 0, Math.PI * 2);
  ctx.fill();
  // Cold rim light down the left edge.
  ctx.strokeStyle = 'rgba(185,196,210,0.26)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - 10 + sway, y - 2);
  ctx.quadraticCurveTo(x - 9, y - 16, x - 3, y - 24.5);
  ctx.stroke();

  drawArmorDecor(ctx, x, y, p.armor?.tier ?? 0);

  // Sword arm: a sleeve falling to a pale hand on the grip.
  ctx.strokeStyle = '#0d0e12';
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(x + 4.5, y - 19);
  ctx.quadraticCurveTo(x + 8, y - 15, x + 7, y - 9.5);
  ctx.stroke();
  ctx.fillStyle = '#cfd3d8';
  ctx.beginPath();
  ctx.arc(x + 7, y - 9, 1.6, 0, Math.PI * 2);
  ctx.fill();
  drawWeaponIdle(ctx, x, y, p.weapon.tier);

  // Peaked hood, its tip nodding with the walk.
  ctx.fillStyle = '#14161b';
  ctx.beginPath();
  ctx.moveTo(x - 6.8, y - 23.5);
  ctx.quadraticCurveTo(x - 7.2, y - 30, x - 4, y - 33.5);
  ctx.quadraticCurveTo(x - 1.5, y - 37.5, x + 0.8 + sway * 0.4, y - 36);
  ctx.quadraticCurveTo(x + 6, y - 31.5, x + 6.6, y - 23.5);
  ctx.quadraticCurveTo(x, y - 27, x - 6.8, y - 23.5);
  ctx.closePath();
  ctx.fill();
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
  ctx.fillStyle = '#cfd3d8';
  ctx.beginPath();
  ctx.ellipse(x + 0.3, y - 27.2, 3.6, 3.7, 0, 0, Math.PI * 2);
  ctx.fill();
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
    default: // Rusted Blade
      ctx.strokeStyle = '#8f959d';
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
  ctx.fillStyle = fill;
  ctx.fill();
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
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.arc(0, -28, 4.5, 0, Math.PI * 2);
    ctx.fill();
    // Muzzle with parted jaws.
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
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.arc(0, -28.6, 4.6, Math.PI * 0.86, Math.PI * 0.14);
    ctx.lineTo(3.9, -26);
    ctx.quadraticCurveTo(3, -24.2, 1.8, -24);
    ctx.lineTo(-1.8, -24);
    ctx.quadraticCurveTo(-3, -24.2, -3.9, -26);
    ctx.closePath();
    ctx.fill();
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
  const scale = e.kind === 'boss' ? 1.6 : 1;
  drawShadow(ctx, fx, fy, (e.kind === 'wretch' ? 9 : 12) * scale);

  if (e.kind === 'boss') {
    // Aura seething at his feet, tinted per boss.
    ctx.strokeStyle = `rgba(${bossLook(e).aura},${0.16 + 0.1 * Math.sin(time * 3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(fx, fy, 22 + Math.sin(time * 3) * 2, 10, 0, 0, Math.PI * 2);
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
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(-9, -2);
    ctx.quadraticCurveTo(-11.5, -8.5, -6.5, -12.5);
    ctx.quadraticCurveTo(-1.5, -15.5, 3.5, -12.5);
    ctx.quadraticCurveTo(7.5, -10.5, 8.5, -6.5);
    ctx.quadraticCurveTo(8, -2.5, 4, -1);
    ctx.quadraticCurveTo(-3, 1.2, -9, -2);
    ctx.closePath();
    ctx.fill();
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
    ctx.fillStyle = '#787f89';
    ctx.beginPath();
    ctx.ellipse(6.5, -9.5, 3.6, 3, 0.35, 0, Math.PI * 2);
    ctx.fill();
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

  // Frost-slow sheathes them in ice.
  if (e.slowT > 0) {
    ctx.fillStyle = `rgba(150,200,225,${Math.min(0.35, e.slowT * 0.18)})`;
    ctx.beginPath();
    ctx.ellipse(0, -12, 10, 14, 0, 0, Math.PI * 2);
    ctx.fill();
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

// --- main render ----------------------------------------------------------

export function render(ctx: CanvasRenderingContext2D, game: Game, view: View, dt: number): void {
  const { w, h } = view;
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

  // Cached dim world, then live torchlit region on top.
  ensureStatic(d);
  ctx.drawImage(staticCanvas!, offX - staticOX, offY - STATIC_OY);

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
  const tp = screenToTile(view.mouseX - offX, view.mouseY - offY);
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
  interface Drawable {
    depth: number;
    draw: () => void;
  }
  const drawables: Drawable[] = [];

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
      drawables.push({ depth: x + y, draw: () => drawWallBlock(ctx, ws) });
    }
  }

  for (const e of game.enemies) {
    const b = lightAt(game, e.x, e.y);
    if (b <= 0.03) continue;
    const fx = offX + isoX(e.x, e.y);
    const fy = offY + isoY(e.x, e.y) + HH;
    drawables.push({ depth: e.x + e.y, draw: () => drawEnemy(ctx, fx, fy, e, b, game.time) });
  }

  {
    const p = game.player;
    drawables.push({ depth: p.x + p.y, draw: () => drawPlayer(ctx, pfx, pfy, p, game.time) });
  }

  drawables.sort((a, b) => a.depth - b.depth);
  for (const item of drawables) item.draw();

  // Fireballs in flight.
  for (const pr of game.projectiles) {
    const cx = offX + isoX(pr.x, pr.y);
    const cy = offY + isoY(pr.x, pr.y) + HH - 14;
    const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, 10);
    glow.addColorStop(0, 'rgba(255,220,170,0.9)');
    glow.addColorStop(0.4, 'rgba(255,140,50,0.5)');
    glow.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 11, cy - 11, 22, 22);
    ctx.fillStyle = '#ffb864';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Spell and level-up effects ring outward in world space.
  for (const ef of game.effects) {
    const cx = offX + isoX(ef.x, ef.y);
    const cy = offY + isoY(ef.x, ef.y) + HH;
    const fade = 1 - ef.t;
    if (ef.kind === 'nova') {
      const col = ef.color ?? '190,222,238';
      for (const f of [1, 0.72]) {
        const r = ef.t * ef.r * f * Math.SQRT2;
        ctx.strokeStyle = `rgba(${col},${fade * 0.8 * f})`;
        ctx.lineWidth = f === 1 ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * HW, r * HH, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (ef.kind === 'boom') {
      const col = ef.color ?? '255,150,60';
      const r = ef.t * ef.r * Math.SQRT2;
      ctx.fillStyle = `rgba(${col},${fade * 0.4})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * HW, r * HH, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,200,120,${fade * 0.9})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * HW, r * HH, 0, 0, Math.PI * 2);
      ctx.stroke();
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
    } else {
      const r = ef.t * ef.r * Math.SQRT2;
      ctx.strokeStyle = `rgba(235,228,200,${fade * 0.75})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy - ef.t * 18, r * HW, r * HH, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Floating damage numbers.
  ctx.textAlign = 'center';
  for (const n of game.dmgNums) {
    const nx = offX + isoX(n.x, n.y);
    const ny = offY + isoY(n.x, n.y) - 30 - (1 - n.t) * 28;
    ctx.globalAlpha = Math.min(1, n.t * 1.6);
    ctx.font = `bold 15px ${FONT_GOTHIC}`;
    ctx.fillStyle = n.color;
    ctx.fillText(n.value, nx, ny);
  }
  ctx.globalAlpha = 1;

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
    ctx.font = `28px ${FONT_GOTHIC}`;
    ctx.fillStyle = hovered ? 'rgba(230,236,244,0.95)' : 'rgba(185,192,202,0.75)';
    ctx.fillText(hovered ? `✠ ${item.label} ✠` : item.label, w / 2, item.y + 27);
    ctx.font = '12px Georgia, serif';
    ctx.fillStyle = 'rgba(150,156,166,0.45)';
    ctx.fillText(`[${item.hint}]`, w / 2, item.y + 44);
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
  ctx.fillText('Esc — return to the dark', w / 2, h * 0.42 + 46);
  ctx.fillText('T — abandon to the title (run kept at last depth)', w / 2, h * 0.42 + 74);
  ctx.fillText('M — mute', w / 2, h * 0.42 + 102);
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
  shine.addColorStop(0, 'rgba(255,255,255,0.12)');
  shine.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = shine;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
  ctx.strokeStyle = '#8b9099';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = `bold 16px ${FONT_GOTHIC}`;
  ctx.fillStyle = 'rgba(225,228,234,0.9)';
  ctx.fillText(label, cx, cy + 5);
}

function drawHud(ctx: CanvasRenderingContext2D, game: Game, view: View): void {
  const { w, h } = view;
  const p = game.player;

  drawOrb(ctx, 62, h - 62, 36, p.hp / p.maxHp, '#4d1016', game.time, String(Math.ceil(p.hp)));
  drawOrb(ctx, w - 62, h - 62, 36, p.mana / p.maxMana, '#173a52', game.time + 3, String(Math.floor(p.mana)));

  // Active spell above the mana orb.
  ctx.textAlign = 'center';
  ctx.font = `15px ${FONT_GOTHIC}`;
  ctx.fillStyle = 'rgba(200,206,214,0.75)';
  ctx.fillText(SPELLS[p.spell.spell ?? 'frostnova'].name, w - 62, h - 108);

  // Potion belt beside the health orb.
  const bx = 122;
  const by = h - 66;
  ctx.fillStyle = '#5e1218';
  ctx.beginPath();
  ctx.ellipse(bx, by + 3, 5, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#22252a';
  ctx.fillRect(bx - 2, by - 9, 4, 6);
  ctx.textAlign = 'left';
  ctx.font = `bold 17px ${FONT_GOTHIC}`;
  ctx.fillStyle = 'rgba(210,215,222,0.85)';
  ctx.fillText(`× ${p.potions}`, bx + 11, by + 6);
  ctx.font = '11px Georgia, serif';
  ctx.fillStyle = 'rgba(170,176,184,0.5)';
  ctx.fillText('Q', bx - 3, by + 24);

  // Depth marker.
  ctx.textAlign = 'center';
  ctx.font = `26px ${FONT_GOTHIC}`;
  ctx.fillStyle = 'rgba(200,206,214,0.75)';
  ctx.fillText(`✠ Depth ${roman(game.depth)} ✠`, w / 2, 42);

  // Boss health bar.
  const boss = game.boss;
  if (boss && boss.aggro) {
    const bw = w * 0.36;
    ctx.font = `18px ${FONT_GOTHIC}`;
    ctx.fillStyle = 'rgba(210,216,224,0.85)';
    ctx.fillText(boss.name, w / 2, 68);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(w / 2 - bw / 2, 76, bw, 7);
    ctx.fillStyle = '#6d1a20';
    ctx.fillRect(w / 2 - bw / 2, 76, (bw * Math.max(0, boss.hp)) / boss.maxHp, 7);
    ctx.strokeStyle = 'rgba(139,144,153,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(w / 2 - bw / 2, 76, bw, 7);
  }

  // XP bar.
  const xw = Math.min(420, w * 0.42);
  const xx = w / 2 - xw / 2;
  const xy = h - 40;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(xx, xy, xw, 5);
  ctx.fillStyle = 'rgba(170,179,189,0.8)';
  ctx.fillRect(xx, xy, (xw * p.xp) / xpNext(p.level), 5);
  ctx.strokeStyle = 'rgba(139,144,153,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(xx, xy, xw, 5);
  ctx.font = `13px ${FONT_GOTHIC}`;
  ctx.fillStyle = 'rgba(190,196,204,0.7)';
  ctx.fillText(`Level ${roman(p.level)}`, w / 2, xy - 6);

  // Kill count.
  ctx.textAlign = 'right';
  ctx.font = `17px ${FONT_GOTHIC}`;
  ctx.fillStyle = 'rgba(180,186,194,0.6)';
  ctx.fillText(`souls reaped  ${game.kills}`, w - 24, h - 24);

  // FPS meter (toggle with P).
  if (game.showFps && view.fps !== undefined) {
    ctx.textAlign = 'left';
    ctx.font = '13px Georgia, serif';
    ctx.fillStyle = 'rgba(170,176,184,0.7)';
    ctx.fillText(`${view.fps} fps`, 16, 24);
  }

  // Hint.
  ctx.textAlign = 'center';
  ctx.font = '12px Georgia, serif';
  ctx.fillStyle = 'rgba(170,176,184,0.32)';
  ctx.fillText('hold click to move · right-click casts your spell · Q quaff · I satchel · M mute', w / 2, h - 16);

  // Enemy nameplate under the cursor.
  if (game.hoverEnemy) {
    const e = game.hoverEnemy;
    ctx.font = `16px ${FONT_GOTHIC}`;
    ctx.fillStyle = 'rgba(215,220,228,0.9)';
    ctx.fillText(`${e.name} — ${Math.max(0, Math.ceil(e.hp))}/${e.maxHp}`, view.mouseX, view.mouseY - 18);
  }

  if (game.invOpen) drawInventory(ctx, game, view);

  // Banner.
  if (game.banner.t > 0) {
    const alpha = Math.min(1, game.banner.t * 0.8);
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(215,221,229,${alpha})`;
    ctx.font = `64px ${FONT_GOTHIC}`;
    ctx.fillText(game.banner.text, w / 2, h * 0.34);
    if (game.banner.sub) {
      ctx.font = `22px ${FONT_GOTHIC}`;
      ctx.fillStyle = `rgba(160,168,178,${alpha * 0.8})`;
      ctx.fillText(game.banner.sub, w / 2, h * 0.34 + 40);
    }
  }
}

function drawInventory(ctx: CanvasRenderingContext2D, game: Game, view: View): void {
  const p = game.player;
  const rect = invPanelRect(view.w, p.inventory.length);

  ctx.fillStyle = 'rgba(8,8,11,0.93)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = 'rgba(139,144,153,0.55)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  ctx.textAlign = 'left';
  ctx.font = `22px ${FONT_GOTHIC}`;
  ctx.fillStyle = 'rgba(215,220,228,0.9)';
  ctx.fillText('Satchel', rect.x + INV.pad, rect.y + 30);

  ctx.font = '13px Georgia, serif';
  ctx.fillStyle = 'rgba(185,191,199,0.85)';
  ctx.fillText(`Blade   ${describeItem(p.weapon)}`, rect.x + INV.pad, rect.y + 56);
  ctx.fillText(`Armor  ${p.armor ? describeItem(p.armor) : '—'}`, rect.x + INV.pad, rect.y + 74);
  ctx.fillText(`Charm  ${p.trinket ? describeItem(p.trinket) : '—'}`, rect.x + INV.pad, rect.y + 92);
  ctx.fillText(`Spell   ${describeItem(p.spell)}`, rect.x + INV.pad, rect.y + 110);

  ctx.strokeStyle = 'rgba(139,144,153,0.3)';
  ctx.beginPath();
  ctx.moveTo(rect.x + INV.pad, rect.y + INV.headerH - 8);
  ctx.lineTo(rect.x + rect.w - INV.pad, rect.y + INV.headerH - 8);
  ctx.stroke();

  if (p.inventory.length === 0) {
    ctx.font = 'italic 13px Georgia, serif';
    ctx.fillStyle = 'rgba(150,156,164,0.5)';
    ctx.fillText('nothing but dust', rect.x + INV.pad, rect.y + INV.headerH + 19);
    return;
  }

  for (let i = 0; i < p.inventory.length; i++) {
    const ry = rect.y + INV.headerH + i * INV.rowH;
    const hovered =
      view.mouseX >= rect.x &&
      view.mouseX <= rect.x + rect.w &&
      view.mouseY >= ry &&
      view.mouseY < ry + INV.rowH;
    if (hovered) {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(rect.x + 2, ry, rect.w - 4, INV.rowH);
    }
    ctx.font = '14px Georgia, serif';
    ctx.fillStyle = 'rgba(205,211,219,0.9)';
    ctx.fillText(describeItem(p.inventory[i]), rect.x + INV.pad, ry + 20);
    if (hovered) {
      ctx.textAlign = 'right';
      ctx.font = 'italic 12px Georgia, serif';
      ctx.fillStyle = 'rgba(170,176,184,0.6)';
      ctx.fillText('equip / drop', rect.x + rect.w - INV.pad, ry + 20);
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
