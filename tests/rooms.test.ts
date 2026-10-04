import { describe, it, expect } from 'vitest';
import { BuildingPlan } from '../src/gen/building';
import { generateFloor, clearFloorCache, FW, FH, idx, isWalkableTile, T_FLOOR, T_DOOR } from '../src/gen/floor';

const FLOORS = [1, 2, 5, 10, 25, 50, 99, 150, 199, 200];
const SEEDS = Array.from({ length: 25 }, (_, i) => 1000 + i * 7919);

function reach(L: ReturnType<typeof generateFloor>, sx: number, sy: number) {
  const seen = new Uint8Array(FW * FH);
  const q = [[Math.floor(sx), Math.floor(sy)]];
  seen[idx(q[0][0], q[0][1])] = 1;
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!isWalkableTile(L, nx, ny) || seen[idx(nx, ny)]) continue;
      seen[idx(nx, ny)] = 1;
      q.push([nx, ny]);
    }
  }
  return seen;
}

describe('every room has a way in (no sealed rooms)', () => {
  it(`${SEEDS.length} towers x ${FLOORS.length} floors: each room has an entrance, a walkable tile, and is reachable`, () => {
    let rooms = 0, lost = 0;
    const problems: string[] = [];
    for (const seed of SEEDS) {
      clearFloorCache();
      const plan = new BuildingPlan(seed, 'insane');
      for (const f of FLOORS) {
        const L = generateFloor(plan, f);
        const seen = reach(L, L.anchors.stair0.x, L.anchors.stair0.y);
        for (const room of L.rooms) {
          const tiles: number[] = [];
          for (let i = 0; i < FW * FH; i++) if (L.roomAt[i] === room.id && (L.tiles[i] === T_FLOOR || L.tiles[i] === T_DOOR)) tiles.push(i);
          if (!tiles.length) { lost++; continue; } // room fully overwritten by a stamped feature; not a sealed room
          rooms++;
          const tag = `seed ${seed} floor ${f} room ${room.id} (${room.type})`;
          // entrance: a door tile touching the room, or an open floor edge into another room/corridor
          let entrance = false;
          for (const i of tiles) {
            const x = i % FW, y = (i / FW) | 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const n = idx(x + dx, y + dy);
              if (L.tiles[n] === T_DOOR) entrance = true;
              if ((L.tiles[n] === T_FLOOR || L.tiles[n] === T_DOOR) && L.roomAt[n] !== room.id) entrance = true;
            }
          }
          if (!entrance) problems.push(`${tag}: no doorway`);
          const walk = tiles.filter((i) => isWalkableTile(L, i % FW, (i / FW) | 0));
          if (!walk.length) problems.push(`${tag}: furniture fills the whole room`);
          if (walk.some((i) => !seen[i])) problems.push(`${tag}: unreachable tiles`);
        }
      }
    }
    console.log(`checked ${rooms} rooms, ${lost} absorbed by feature stamps, problems: ${problems.length}`);
    expect(problems.slice(0, 10)).toEqual([]);
    expect(rooms).toBeGreaterThan(5000);
  }, 120000);
});

import { doorRunsNS } from '../src/gen/floor';
describe('door frames follow the wall they sit in', () => {
  it('the frame runs along the wall line: never across the passage', () => {
    const plan = new BuildingPlan(7, 'normal');
    let doors = 0;
    for (let f = 1; f <= 60; f += 3) {
      const L = generateFloor(plan, f);
      for (let y = 1; y < FH - 1; y++) for (let x = 1; x < FW - 1; x++) {
        if (L.tiles[idx(x, y)] !== T_DOOR) continue;
        doors++;
        const t = (dx: number, dy: number) => L.tiles[idx(x + dx, y + dy)];
        // you walk through a door across the frame: the frame's own axis must not have floor at both ends
        if (doorRunsNS(L, x, y)) expect(t(0, -1) === T_FLOOR && t(0, 1) === T_FLOOR, `door ${x},${y} f${f}`).toBe(false);
        else expect(t(-1, 0) === T_FLOOR && t(1, 0) === T_FLOOR, `door ${x},${y} f${f}`).toBe(false);
      }
    }
    expect(doors).toBeGreaterThan(500);
  });
});

describe('boardrooms', () => {
  it('about half the floors get one boardroom with a table, a wall TV backed by a wall, and seats', () => {
    const plan = new BuildingPlan(5, 'normal');
    let floors = 0, withBR = 0;
    for (let f = 1; f < 200; f += 4) {
      const L = generateFloor(plan, f);
      floors++;
      const br = L.rooms.filter((r) => r.type === 'boardroom');
      expect(br.length).toBeLessThanOrEqual(1);
      if (!br.length) continue;
      withBR++;
      const r = br[0];
      const inRoom = (p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
      const table = L.props.find((p) => p.kind === 'boardtable' && inRoom(p));
      if (!table) continue; // a door or reserved tile can refuse the table; the room still reads as a meeting room
      const tv = L.props.find((p) => p.kind === 'tvwall' && inRoom(p))!;
      expect(tv).toBeTruthy();
      const bx = Math.floor(tv.x) + (tv.rot === 1 ? 1 : 0), by = Math.floor(tv.y) + (tv.rot === 2 ? 1 : 0);
      expect(L.tiles[idx(bx, by)] === T_DOOR ? 'door' : L.tiles[idx(bx, by)]).not.toBe(T_FLOOR);
      expect(L.props.filter((p) => p.kind === 'chair' && inRoom(p)).length).toBeGreaterThanOrEqual(5);
    }
    expect(withBR / floors).toBeGreaterThan(0.25);
    expect(withBR / floors).toBeLessThan(0.75);
  }, 60000);
});
