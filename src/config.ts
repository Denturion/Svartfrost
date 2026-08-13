export const TILE_W = 64;
export const TILE_H = 32;
export const WALL_H = 46;

// Camera zoom: scales the whole world view (tiles, walls, entities, effects)
// about the screen center, independent of tile geometry. Input math mirrors
// this via screenToWorldTile() so clicks still land on the right tile.
export const ZOOM = 1.4;

export const MAP_W = 52;
export const MAP_H = 52;

export const LIGHT_RADIUS = 7.5;
export const EXPLORED_BRIGHTNESS = 0.05;

// Carved Roman capitals in the spirit of Diablo's Exocet — dark but legible.
export const FONT_GOTHIC = "'Cinzel', Georgia, serif";

// Base colors as [r, g, b], shaded by torchlight at draw time.
export const PALETTE = {
  floorA: [30, 33, 39] as const,
  floorB: [24, 27, 32] as const,
  wallTop: [44, 48, 56] as const,
  wallLeft: [20, 23, 28] as const,
  wallRight: [12, 14, 18] as const,
  rune: [190, 200, 210] as const,
};

/** Scale a base color by brightness; `warm` shifts it toward torchlight amber. */
export function shade(rgb: readonly [number, number, number], b: number, warm = 0): string {
  // Crush the low end so shadow reads as near-black stone rather than a
  // smooth grey gradient — closer to Diablo 1's hard-lit, dithered look.
  const bc = b <= 0 ? 0 : Math.pow(b, 1.35);
  const r = rgb[0] * bc * (1 + 0.5 * warm);
  const g = rgb[1] * bc * (1 + 0.2 * warm);
  const bl = rgb[2] * bc * (1 - 0.18 * warm);
  return `rgb(${r | 0},${g | 0},${bl | 0})`;
}

// Deterministic per-tile jitter so the stone doesn't look uniform.
// Unsigned shifts matter: signed ones pin the top bit and halve the range.
export function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function roman(n: number): string {
  const table: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  for (const [v, s] of table) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}
