import { Rng } from '../core/rng';
import { FW, FH, T_WALL, T_FLOOR, idx, type FloorLayout } from '../gen/floor';

/**
 * Where wall posters hang on a floor: south faces of walls (they face the camera) looking into a real room,
 * clear of wall props and at least 3 tiles apart. Up to 10 per floor, chosen by seed.
 */
export function posterSpots(L: FloorLayout, seed: number): { tx: number; ty: number }[] {
  if (L.floor <= 0) return [];
  const cand: { tx: number; ty: number }[] = [];
  for (let ty = 1; ty < FH - 2; ty++) for (let tx = 1; tx < FW - 1; tx++) {
    if (L.tiles[idx(tx, ty)] !== T_WALL || L.tiles[idx(tx, ty + 1)] !== T_FLOOR) continue;
    const room = L.rooms[L.roomAt[idx(tx, ty + 1)]];
    if (!room || room.type === 'stair' || room.type === 'elevator' || room.type === 'corridor') continue;
    if (L.props.some((p) => Math.hypot(p.x - (tx + 0.5), p.y - (ty + 1)) < 1)) continue;
    cand.push({ tx, ty });
  }
  const r = new Rng(seed >>> 0 || 1);
  r.shuffle(cand);
  const n = Math.max(3, Math.min(10, Math.round(L.rooms.length / 2)));
  const out: { tx: number; ty: number }[] = [];
  for (const c of cand) {
    if (out.length >= n) break;
    if (out.every((o) => Math.hypot(o.tx - c.tx, o.ty - c.ty) >= 3)) out.push(c);
  }
  return out;
}
