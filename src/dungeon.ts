import { MAP_W, MAP_H, tileHash } from './config';
import type { Point } from './types';

export enum Tile {
  Wall = 0,
  Floor = 1,
  Stairs = 2,
}

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Torch {
  x: number; // wall tile
  y: number;
  side: 'sw' | 'se'; // which face carries the sconce
  lx: number; // light source position (into the floor in front)
  ly: number;
}

export interface Dungeon {
  w: number;
  h: number;
  tiles: Tile[];
  rooms: Room[];
  start: Point;
  stairs: Point;
  explored: boolean[];
  // Wall tiles that touch a floor tile — the only ones worth drawing.
  facing: boolean[];
  torches: Torch[];
}

function roomCenter(r: Room): Point {
  return { x: (r.x + (r.w >> 1)) | 0, y: (r.y + (r.h >> 1)) | 0 };
}

function overlaps(a: Room, b: Room): boolean {
  return (
    a.x - 1 < b.x + b.w + 1 &&
    a.x + a.w + 1 > b.x - 1 &&
    a.y - 1 < b.y + b.h + 1 &&
    a.y + a.h + 1 > b.y - 1
  );
}

export function generateDungeon(rand: () => number = Math.random): Dungeon {
  const w = MAP_W;
  const h = MAP_H;
  const tiles = new Array<Tile>(w * h).fill(Tile.Wall);

  const carve = (x: number, y: number) => {
    if (x > 0 && y > 0 && x < w - 1 && y < h - 1) tiles[y * w + x] = Tile.Floor;
  };

  const rooms: Room[] = [];
  let attempts = 0;
  while (rooms.length < 11 && attempts < 300) {
    attempts++;
    const rw = 6 + ((rand() * 7) | 0);
    const rh = 6 + ((rand() * 7) | 0);
    const rx = 1 + ((rand() * (w - rw - 2)) | 0);
    const ry = 1 + ((rand() * (h - rh - 2)) | 0);
    const room = { x: rx, y: ry, w: rw, h: rh };
    if (rooms.some((r) => overlaps(r, room))) continue;
    rooms.push(room);
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) carve(x, y);
    }
  }

  // L-shaped corridors between consecutive rooms, two tiles wide so they
  // read as passages rather than slits. The extra row/column at the corner
  // fills the joint into a clean 2x2 elbow.
  const carveH = (x1: number, x2: number, y: number) => {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      carve(x, y);
      carve(x, y + 1);
    }
  };
  const carveV = (y1: number, y2: number, x: number) => {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
      carve(x, y);
      carve(x + 1, y);
    }
  };
  for (let i = 1; i < rooms.length; i++) {
    const a = roomCenter(rooms[i - 1]);
    const b = roomCenter(rooms[i]);
    const horizontalFirst = rand() < 0.5;
    const corner = horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    carveH(a.x, corner.x, a.y);
    carveV(a.y, corner.y, a.x);
    carveH(corner.x, b.x, b.y);
    carveV(corner.y, b.y, b.x);
  }

  const start = roomCenter(rooms[0]);
  const stairsAt = roomCenter(rooms[rooms.length - 1]);
  tiles[stairsAt.y * w + stairsAt.x] = Tile.Stairs;

  // Free-standing pillars in large rooms. Corner-inset positions can never
  // disconnect a room, since the floor ring around them stays open.
  for (const room of rooms) {
    if (room.w < 6 || room.h < 6 || rand() < 0.4) continue;
    const spots = [
      { x: room.x + 2, y: room.y + 2 },
      { x: room.x + room.w - 3, y: room.y + 2 },
      { x: room.x + 2, y: room.y + room.h - 3 },
      { x: room.x + room.w - 3, y: room.y + room.h - 3 },
    ];
    for (const s of spots) {
      if (Math.abs(s.x - start.x) <= 1 && Math.abs(s.y - start.y) <= 1) continue;
      if (Math.abs(s.x - stairsAt.x) <= 1 && Math.abs(s.y - stairsAt.y) <= 1) continue;
      tiles[s.y * w + s.x] = Tile.Wall;
    }
  }

  const facing = new Array<boolean>(w * h).fill(false);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] !== Tile.Wall) continue;
      outer: for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (tiles[ny * w + nx] !== Tile.Wall) {
            facing[y * w + x] = true;
            break outer;
          }
        }
      }
    }
  }

  // Torch sconces on a few walls, hash-picked so they never disturb the
  // seeded generation stream.
  const torches: Torch[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] !== Tile.Wall || !facing[y * w + x]) continue;
      if (tileHash(x * 13 + 5, y * 17 + 9) <= 0.93) continue;
      if (y + 1 < h && tiles[(y + 1) * w + x] !== Tile.Wall) {
        torches.push({ x, y, side: 'sw', lx: x, ly: y + 0.9 });
      } else if (x + 1 < w && tiles[y * w + x + 1] !== Tile.Wall) {
        torches.push({ x, y, side: 'se', lx: x + 0.9, ly: y });
      }
    }
  }

  return {
    w,
    h,
    tiles,
    rooms,
    start,
    stairs: stairsAt,
    explored: new Array<boolean>(w * h).fill(false),
    facing,
    torches,
  };
}

export function isWalkable(d: Dungeon, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= d.w || y >= d.h) return false;
  return d.tiles[y * d.w + x] !== Tile.Wall;
}
