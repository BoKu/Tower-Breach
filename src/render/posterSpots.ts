import { Rng } from '../core/rng';
import { FW, FH, T_WALL, T_FLOOR, idx, type FloorLayout } from '../gen/floor';

type Spot = { tx: number; ty: number };

/** South faces of walls (they face the camera) looking into a real room, clear of wall props. */
function wallFaces(L: FloorLayout): Spot[] {
  const out: Spot[] = [];
  for (let ty = 1; ty < FH - 2; ty++) for (let tx = 1; tx < FW - 1; tx++) {
    if (L.tiles[idx(tx, ty)] !== T_WALL || L.tiles[idx(tx, ty + 1)] !== T_FLOOR) continue;
    const room = L.rooms[L.roomAt[idx(tx, ty + 1)]];
    if (!room || room.type === 'stair' || room.type === 'elevator' || room.type === 'corridor') continue;
    if (L.props.some((p) => Math.hypot(p.x - (tx + 0.5), p.y - (ty + 1)) < 1)) continue;
    out.push({ tx, ty });
  }
  return out;
}

/** Easter egg: floor 4's dartboard (tile tx) and high-score board (tx + 1), always the same wall for a building. */
export function dartSpot(L: FloorLayout): Spot | null {
  if (L.floor !== 4) return null;
  const faces = wallFaces(L);
  const pairs = faces.filter((f) => faces.some((g) => g.tx === f.tx + 1 && g.ty === f.ty));
  if (!pairs.length) return null;
  return pairs[new Rng((L.seed ^ 0xda27) >>> 0 || 1).int(0, pairs.length - 1)];
}

/**
 * Where wall posters hang on a floor: camera-facing room walls, at least 3 tiles apart and clear of the dartboard.
 * Up to 10 per floor, chosen by seed.
 */
export function posterSpots(L: FloorLayout, seed: number): Spot[] {
  if (L.floor <= 0) return [];
  const dart = dartSpot(L);
  const cand = wallFaces(L).filter((c) => !dart || c.ty !== dart.ty || Math.abs(c.tx - dart.tx - 0.5) > 2.5);
  const r = new Rng(seed >>> 0 || 1);
  r.shuffle(cand);
  const n = Math.max(3, Math.min(10, Math.round(L.rooms.length / 2)));
  const out: Spot[] = [];
  for (const c of cand) {
    if (out.length >= n) break;
    if (out.every((o) => Math.hypot(o.tx - c.tx, o.ty - c.ty) >= 3)) out.push(c);
  }
  return out;
}
