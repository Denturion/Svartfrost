import type { Dungeon } from './dungeon';
import { isWalkable } from './dungeon';
import type { Point } from './types';

const DIRS = [
  { dx: 1, dy: 0, cost: 1 },
  { dx: -1, dy: 0, cost: 1 },
  { dx: 0, dy: 1, cost: 1 },
  { dx: 0, dy: -1, cost: 1 },
  { dx: 1, dy: 1, cost: Math.SQRT2 },
  { dx: 1, dy: -1, cost: Math.SQRT2 },
  { dx: -1, dy: 1, cost: Math.SQRT2 },
  { dx: -1, dy: -1, cost: Math.SQRT2 },
];

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

/**
 * A* over the dungeon grid, 8-directional with no corner cutting.
 * `blocked` holds tile indices (y * w + x) that may not be entered —
 * the goal tile itself is always allowed so chasers can path "to" a target.
 * Returns the path excluding the start tile, or null if unreachable.
 */
export function findPath(
  d: Dungeon,
  start: Point,
  goal: Point,
  blocked?: Set<number>,
): Point[] | null {
  const w = d.w;
  const startIdx = start.y * w + start.x;
  const goalIdx = goal.y * w + goal.x;
  if (startIdx === goalIdx) return [];
  if (!isWalkable(d, goal.x, goal.y)) return null;

  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const open: { idx: number; f: number }[] = [{ idx: startIdx, f: 0 }];
  gScore.set(startIdx, 0);
  const closed = new Set<number>();
  let expansions = 0;

  while (open.length > 0 && expansions < 2500) {
    expansions++;
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[best].f) best = i;
    }
    const { idx } = open.splice(best, 1)[0];
    if (idx === goalIdx) {
      const path: Point[] = [];
      let cur = idx;
      while (cur !== startIdx) {
        path.push({ x: cur % w, y: (cur / w) | 0 });
        cur = cameFrom.get(cur)!;
      }
      path.reverse();
      return path;
    }
    if (closed.has(idx)) continue;
    closed.add(idx);

    const cx = idx % w;
    const cy = (idx / w) | 0;
    for (const { dx, dy, cost } of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(d, nx, ny)) continue;
      // No cutting corners: diagonal steps need both orthogonal neighbors open.
      if (dx !== 0 && dy !== 0) {
        if (!isWalkable(d, cx + dx, cy) || !isWalkable(d, cx, cy + dy)) continue;
      }
      const nIdx = ny * w + nx;
      if (nIdx !== goalIdx && blocked?.has(nIdx)) continue;
      const g = gScore.get(idx)! + cost;
      if (g < (gScore.get(nIdx) ?? Infinity)) {
        gScore.set(nIdx, g);
        cameFrom.set(nIdx, idx);
        open.push({ idx: nIdx, f: g + heuristic(nx, ny, goal.x, goal.y) });
      }
    }
  }
  return null;
}
