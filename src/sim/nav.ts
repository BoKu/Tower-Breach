import { FloorLayout, FW, FH, idx, isWalkableTile, blocksSight, inBounds, S_LOW, S_DOOR, T_FLOOR, T_DOOR } from '../gen/floor';

/** Grid DDA line-of-sight. Returns true when nothing blocks sight between the points. */
export function lineOfSight(L: FloorLayout, x0: number, y0: number, x1: number, y1: number): boolean {
  return raycastWalls(L, x0, y0, x1, y1) < 0;
}

/**
 * Walk the grid from (x0,y0) toward (x1,y1). Returns the distance at which a sight-blocking tile is
 * first hit, or -1 if the segment is clear. `lowCb` is called for low-cover tiles crossed (dist).
 */
export function raycastWalls(L: FloorLayout, x0: number, y0: number, x1: number, y1: number, lowCb?: (d: number, tx: number, ty: number) => void): number {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return -1;
  const ux = dx / len, uy = dy / len;
  let tx = Math.floor(x0), ty = Math.floor(y0);
  const stepX = ux > 0 ? 1 : -1, stepY = uy > 0 ? 1 : -1;
  const tDeltaX = ux !== 0 ? Math.abs(1 / ux) : Infinity;
  const tDeltaY = uy !== 0 ? Math.abs(1 / uy) : Infinity;
  let tMaxX = ux !== 0 ? (ux > 0 ? tx + 1 - x0 : x0 - tx) * tDeltaX : Infinity;
  let tMaxY = uy !== 0 ? (uy > 0 ? ty + 1 - y0 : y0 - ty) * tDeltaY : Infinity;
  let t = 0;
  for (let guard = 0; guard < 400; guard++) {
    if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDeltaX; tx += stepX; }
    else { t = tMaxY; tMaxY += tDeltaY; ty += stepY; }
    if (t > len) return -1;
    if (blocksSight(L, tx, ty)) return t;
    if (lowCb && L.solid[idx(tx, ty)] === S_LOW) lowCb(t, tx, ty);
  }
  return -1;
}

export const BODY_R = 0.3;

/**
 * Circle vs grid collision mover. Moves (x,y) by (dx,dy) sliding along walls.
 * `allowLow` lets jumping entities pass over low cover.
 */
export function moveCircle(L: FloorLayout, x: number, y: number, dx: number, dy: number, r: number, allowLow: boolean): { x: number; y: number; hit: boolean } {
  let hit = false;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.25));
  const sx = dx / steps, sy = dy / steps;
  for (let s = 0; s < steps; s++) {
    let nx = x + sx;
    if (collides(L, nx, y, r, allowLow)) { nx = x; hit = true; }
    let ny = y + sy;
    if (collides(L, nx, ny, r, allowLow)) { ny = y; hit = true; }
    x = nx; y = ny;
  }
  return { x, y, hit };
}

export function collides(L: FloorLayout, x: number, y: number, r: number, allowLow: boolean): boolean {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      if (isWalkableTile(L, tx, ty, allowLow)) continue;
      // circle vs tile AABB
      const cx = Math.max(tx, Math.min(x, tx + 1)), cy = Math.max(ty, Math.min(y, ty + 1));
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
    }
  return false;
}

// ------------------------------------------------------------------ A*
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
const gScore = new Float32Array(FW * FH);
const fScore = new Float32Array(FW * FH);
const came = new Int32Array(FW * FH);
const stamp = new Int32Array(FW * FH);
let curStamp = 1;

/** Binary heap keyed by fScore. */
class Heap {
  a: number[] = [];
  push(v: number) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (fScore[a[p]] <= fScore[a[i]]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && fScore[a[l]] < fScore[a[m]]) m = l;
        if (r < a.length && fScore[a[r]] < fScore[a[m]]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

export type CostFn = (tx: number, ty: number) => number;

/**
 * A* over walkable tiles (8-way, no corner cutting). Returns world-space waypoints (tile centres)
 * excluding the start, or null if unreachable within the expansion budget. `doors`: shut (unlocked) doors are passable
 * (the walker opens them on the way); locked ones never are.
 */
export function findPath(L: FloorLayout, sx: number, sy: number, gx: number, gy: number, extraCost?: CostFn, budget = 3000, doors = false): { x: number; y: number }[] | null {
  const ok = (x: number, y: number) => isWalkableTile(L, x, y) || (doors && inBounds(x, y) && L.solid[idx(x, y)] === S_DOOR);
  let stx = Math.floor(sx), sty = Math.floor(sy);
  let gtx = Math.floor(gx), gty = Math.floor(gy);
  if (!isWalkableTile(L, gtx, gty)) {
    const alt = nearestWalkable(L, gx, gy, 3);
    if (!alt) return null;
    gtx = alt.tx; gty = alt.ty;
  }
  if (!isWalkableTile(L, stx, sty)) {
    const alt = nearestWalkable(L, sx, sy, 2);
    if (!alt) return null;
    stx = alt.tx; sty = alt.ty;
  }
  if (stx === gtx && sty === gty) return [{ x: gx, y: gy }];
  curStamp++;
  const s = idx(stx, sty), g = idx(gtx, gty);
  const h = (i: number) => {
    const x = i % FW, y = (i / FW) | 0;
    const dx = Math.abs(x - gtx), dy = Math.abs(y - gty);
    return dx + dy + (1.414 - 2) * Math.min(dx, dy);
  };
  const heap = new Heap();
  stamp[s] = curStamp; gScore[s] = 0; fScore[s] = h(s); came[s] = -1;
  heap.push(s);
  const closed = new Set<number>();
  let n = 0;
  while (heap.size && n++ < budget) {
    const c = heap.pop();
    if (c === g) break;
    if (closed.has(c)) continue;
    closed.add(c);
    const cx = c % FW, cy = (c / FW) | 0;
    for (const [ox, oy, w] of DIRS) {
      const nx = cx + ox, ny = cy + oy;
      if (!ok(nx, ny)) continue;
      if (ox && oy && (!ok(cx + ox, cy) || !ok(cx, cy + oy))) continue;
      const ni = idx(nx, ny);
      const cost = gScore[c] + w + (extraCost ? extraCost(nx, ny) : 0);
      if (stamp[ni] !== curStamp || cost < gScore[ni]) {
        stamp[ni] = curStamp;
        gScore[ni] = cost;
        fScore[ni] = cost + h(ni);
        came[ni] = c;
        heap.push(ni);
      }
    }
  }
  if (stamp[g] !== curStamp) return null;
  const out: { x: number; y: number }[] = [];
  for (let c = g; c !== s && c >= 0; c = came[c]) out.push({ x: (c % FW) + 0.5, y: ((c / FW) | 0) + 0.5 });
  out.reverse();
  return smoothPath(L, sx, sy, out, extraCost);
}

/** Drop intermediate waypoints that are directly reachable (string pulling with LOS + clearance). */
function smoothPath(L: FloorLayout, sx: number, sy: number, pts: { x: number; y: number }[], extraCost?: CostFn) {
  if (pts.length < 3) return pts;
  const out: { x: number; y: number }[] = [];
  let ax = sx, ay = sy;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    for (; j > i; j--) if (clearWalk(L, ax, ay, pts[j].x, pts[j].y, extraCost)) break;
    out.push(pts[j]);
    ax = pts[j].x; ay = pts[j].y;
    i = j + 1;
  }
  return out;
}

/** Straight segment is walkable and (when costs are given) never enters a penalised tile the A* route avoided. */
function clearWalk(L: FloorLayout, x0: number, y0: number, x1: number, y1: number, extraCost?: CostFn): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / 0.3);
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    if (collides(L, x, y, 0.34, false)) return false;
    if (extraCost && extraCost(Math.floor(x), Math.floor(y)) > 0) return false;
  }
  return true;
}

export function nearestWalkable(L: FloorLayout, x: number, y: number, maxR: number): { tx: number; ty: number } | null {
  const cx = Math.floor(x), cy = Math.floor(y);
  for (let r = 0; r <= maxR; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isWalkableTile(L, cx + dx, cy + dy)) return { tx: cx + dx, ty: cy + dy };
      }
  return null;
}

export function isFloorTile(L: FloorLayout, tx: number, ty: number) {
  const t = L.tiles[idx(tx, ty)];
  return t === T_FLOOR || t === T_DOOR;
}
