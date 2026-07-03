import { TILE_W, TILE_H } from './config';

// iso(x, y) is the TOP corner of the tile's diamond.
// The visual center of tile (x, y) is at continuous coords (x + 0.5, y + 0.5).
export function isoX(x: number, y: number): number {
  return (x - y) * (TILE_W / 2);
}

export function isoY(x: number, y: number): number {
  return (x + y) * (TILE_H / 2);
}

export function screenToTile(sx: number, sy: number): { x: number; y: number } {
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  return {
    x: (sx / hw + sy / hh) / 2,
    y: (sy / hh - sx / hw) / 2,
  };
}
