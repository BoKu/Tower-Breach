import type { FloorLayout, StairSpec } from '../gen/floor';

export const STAIR_RISE = 2.6;

/**
 * Which flight (if any) a point stands on, and how far along it: t = 0 at the foot (the bottom landing, south row)
 * to 1 on the top landing (north row). Up flights rise toward the north; down flights descend toward the north.
 */
export function stairAt(L: FloorLayout, x: number, y: number): { s: StairSpec; dir: 1 | -1; t: number } | null {
  for (const s of L.stairs) {
    if (y < s.y0 || y > s.y1 + 1) continue;
    const t = Math.min(1, Math.max(0, (s.y1 - y) / (s.y1 - s.y0 - 1)));
    if (x >= s.x0 && x < s.x0 + 2) return { s, dir: 1, t };
    if (x >= s.x1 - 1 && x < s.x1 + 1) return { s, dir: -1, t };
  }
  return null;
}

/** Visual ground height (m) on a stair flight, 0 elsewhere. */
export function stairElevation(L: FloorLayout, x: number, y: number): number {
  if (L.floor === 0) return 0;
  const st = stairAt(L, x, y);
  return st ? st.dir * st.t * STAIR_RISE : 0;
}
