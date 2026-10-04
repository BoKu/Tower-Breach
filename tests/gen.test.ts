import { describe, it, expect } from 'vitest';
import { BuildingPlan, stairPassable, STAIR_COUNT, ELEVATOR_COUNT, ELEVATOR_MAX_TRAVEL } from '../src/gen/building';
import { generateFloor, clearFloorCache, FW, FH, idx, isWalkableTile, T_FLOOR, T_DOOR } from '../src/gen/floor';
import { darknessOf, TOTAL_FLOORS } from '../src/config/difficulty';
import { dump } from '../scripts/dumpFloor';

function reachableAll(L: ReturnType<typeof generateFloor>, sx: number, sy: number) {
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

describe('building plan', () => {
  it('has exactly 200 floors and regenerates per seed', () => {
    const a = new BuildingPlan(1, 'normal');
    const b = new BuildingPlan(2, 'normal');
    expect(a.flights.length).toBe(TOTAL_FLOORS + 1);
    expect(JSON.stringify(a.flights)).not.toBe(JSON.stringify(b.flights));
    expect(JSON.stringify(new BuildingPlan(1, 'normal').flights)).toBe(JSON.stringify(a.flights));
  });
  it('elevators ~20% functional and travel max 5 floors', () => {
    let working = 0, total = 0;
    for (let s = 0; s < 20; s++) {
      const p = new BuildingPlan(1000 + s, 'hard');
      for (let f = 1; f < TOTAL_FLOORS; f++)
        for (let j = 0; j < ELEVATOR_COUNT; j++) {
          const e = p.elevator(f, j);
          total++;
          if (e.working) {
            working++;
            for (const d of e.destinations) expect(Math.abs(d - f)).toBeLessThanOrEqual(ELEVATOR_MAX_TRAVEL);
            expect(e.destinations.length).toBeGreaterThan(0);
          } else expect(e.destinations.length).toBe(0);
        }
    }
    const ratio = working / total;
    expect(ratio).toBeGreaterThan(0.17);
    expect(ratio).toBeLessThan(0.23);
  });
  it('every floor below 200 has a route up; some stairs are blocked', () => {
    for (const d of ['normal', 'hard', 'insane'] as const) {
      const p = new BuildingPlan(77, d);
      let blocked = 0;
      for (let f = 1; f < TOTAL_FLOORS; f++) {
        let ok = false;
        for (let i = 0; i < STAIR_COUNT; i++) {
          const c = p.up(f, i);
          if (stairPassable(c) || c === 'debris') ok = true;
          if (!stairPassable(c)) blocked++;
        }
        for (let j = 0; j < ELEVATOR_COUNT; j++) if (p.elevator(f, j).destinations.some((x) => x > f)) ok = true;
        expect(ok).toBe(true);
      }
      expect(blocked).toBeGreaterThan(50);
      for (let i = 0; i < STAIR_COUNT; i++) expect(stairPassable(p.up(TOTAL_FLOORS, i))).toBe(false);
    }
  });
});

describe('darkness', () => {
  it('starts at floor 20, scales per floor, caps at 50%', () => {
    expect(darknessOf(1)).toBe(0);
    expect(darknessOf(19)).toBe(0);
    expect(darknessOf(20)).toBeGreaterThan(0);
    expect(darknessOf(60)).toBeGreaterThan(darknessOf(40));
    expect(darknessOf(199)).toBeCloseTo(0.5, 5);
    expect(darknessOf(200)).toBe(0.5);
    for (let f = 0; f <= 200; f++) expect(darknessOf(f)).toBeLessThanOrEqual(0.5);
  });
});

describe('floor generation', () => {
  const floors = [0, 1, 2, 5, 13, 27, 55, 99, 120, 160, 199, 200];
  for (const seed of [11, 4242, 987654]) {
    it(`seed ${seed}: all walkable tiles connected, features reachable`, () => {
      clearFloorCache();
      const plan = new BuildingPlan(seed, 'insane');
      for (const f of floors) {
        const L = generateFloor(plan, f);
        const start = f === 0 ? L.anchors.start : L.anchors.stair0;
        const seen = reachableAll(L, start.x, start.y);
        for (let y = 0; y < FH; y++)
          for (let x = 0; x < FW; x++)
            if (isWalkableTile(L, x, y)) expect(seen[idx(x, y)], `floor ${f} tile ${x},${y} unreachable`).toBe(1);
        for (const a of Object.values(L.anchors)) expect(isWalkableTile(L, Math.floor(a.x), Math.floor(a.y)), `anchor on floor ${f}`).toBe(true);
        if (f > 0) {
          expect(L.stairs.length).toBe(STAIR_COUNT);
          expect(L.elevators.length).toBe(ELEVATOR_COUNT);
        }
        for (const s of L.spawns) expect(isWalkableTile(L, Math.floor(s.x), Math.floor(s.y)), `spawn ${s.type} floor ${f}`).toBe(true);
        // containers must be reachable from an adjacent tile
        for (const c of L.containers) {
          const cx = Math.floor(c.x - 0.01), cy = Math.floor(c.y - 0.01);
          let adj = false;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isWalkableTile(L, cx + dx, cy + dy) && seen[idx(cx + dx, cy + dy)]) adj = true;
          // multi-tile props: check around footprint loosely
          if (!adj) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (isWalkableTile(L, cx + dx, cy + dy) && seen[idx(cx + dx, cy + dy)]) adj = true;
          expect(adj, `container ${c.kind} floor ${f}`).toBe(true);
        }
      }
    });
  }
  it('is deterministic and differs across runs', () => {
    clearFloorCache();
    const a = generateFloor(new BuildingPlan(5, 'normal'), 30);
    clearFloorCache();
    const b = generateFloor(new BuildingPlan(5, 'normal'), 30);
    clearFloorCache();
    const c = generateFloor(new BuildingPlan(6, 'normal'), 30);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(Array.from(a.tiles)).not.toEqual(Array.from(c.tiles));
  });
  it('final floor has the mainframe and higher floors have more pressure', () => {
    const plan = new BuildingPlan(9, 'normal');
    expect(generateFloor(plan, 200).mainframe).not.toBeNull();
    let lo = 0, hi = 0;
    for (let f = 2; f < 10; f++) lo += generateFloor(plan, f).spawns.length;
    for (let f = 150; f < 158; f++) hi += generateFloor(plan, f).spawns.length;
    expect(hi).toBeGreaterThan(lo);
  });
  it('street level is a daylight safe zone: police cordon, no hostiles/CCTV/traps/hazards', () => {
    for (const seed of [1, 2, 3, 4242]) {
      clearFloorCache();
      const L = generateFloor(new BuildingPlan(seed, 'insane'), 0);
      expect(L.spawns.length).toBe(0);
      expect(L.cameras.length).toBe(0);
      expect(L.traps.length).toBe(0);
      expect(L.hazards.length).toBe(0);
      expect(L.darkness).toBe(0);
      const kinds = new Set(L.props.map((p) => p.kind));
      for (const k of ['swatvan', 'policecar', 'tape', 'sawhorse', 'tent']) expect(kinds.has(k), k).toBe(true);
      expect(L.lights.some((l) => l.kind === 'police')).toBe(true);
      expect(L.portals.some((p) => p.target === 1)).toBe(true);
    }
  });
  it('generates quickly', () => {
    clearFloorCache();
    const plan = new BuildingPlan(31337, 'hard');
    const t = performance.now();
    for (let f = 1; f <= 20; f++) generateFloor(plan, f);
    const per = (performance.now() - t) / 20;
    expect(per).toBeLessThan(400); // generous: other suites run in parallel and share the CPU
  });
  it('prints sample floors', () => {
    console.log(dump(4242, 0));
    console.log(dump(4242, 7));
    console.log(dump(4242, 200));
  });
});

import { FOYER, FOYER_DESK } from '../src/gen/floor';
describe('floor 1 reception foyer', () => {
  it('is always the first room inside the entrance, with the reception desk facing the doors', () => {
    for (const seed of [1, 2, 3, 99, 4242]) {
      clearFloorCache();
      const L = generateFloor(new BuildingPlan(seed, 'normal'), 1);
      const room = L.rooms[L.roomAt[idx(32, FH - 3)]];
      expect(room.type).toBe('lobby');
      expect(room.w * room.h).toBeGreaterThanOrEqual(300);
      expect(room.x).toBe(FOYER.x0);
      const desk = L.props.find((p) => p.kind === 'reception');
      expect(desk).toBeTruthy();
      expect([desk!.x, desk!.y, desk!.w, desk!.rot]).toEqual([32, FOYER_DESK.y + 0.5, FOYER_DESK.w, 0]); // centred on the doors, front faces +y
      expect(L.props.filter((p) => p.kind === 'reception').length).toBe(1);
      // walkable from the doors to the front of the desk and on to the spine
      const r = new Uint8Array(FW * FH), q = [[32, FH - 3]];
      r[idx(32, FH - 3)] = 1;
      while (q.length) { const [x, y] = q.pop()!; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (isWalkableTile(L, nx, ny) && !r[idx(nx, ny)]) { r[idx(nx, ny)] = 1; q.push([nx, ny]); } } }
      expect(r[idx(32, FOYER_DESK.y + 1)]).toBe(1);
      expect(r[idx(32, 24)]).toBe(1);
    }
  });
});
