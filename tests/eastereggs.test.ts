import { describe, it, expect } from 'vitest';
import { BuildingPlan } from '../src/gen/building';
import { generateFloor, T_WALL, T_FLOOR, idx } from '../src/gen/floor';
import { dartSpot, posterSpots } from '../src/render/posterSpots';

describe('easter eggs', () => {
  it('floor 8 always has the poker room: an oval table with three seats; no other floor does', () => {
    for (const seed of [1, 42, 777, 31337]) for (const diff of ['normal', 'insane'] as const) {
      const plan = new BuildingPlan(seed, diff);
      const L = generateFloor(plan, 8);
      const rooms = L.rooms.filter((r) => r.type === 'poker');
      expect(rooms, `seed ${seed} ${diff}`).toHaveLength(1);
      const inRoom = L.props.filter((p) => p.room === rooms[0].id);
      expect(inRoom.filter((p) => p.kind === 'pokertable')).toHaveLength(1);
      expect(inRoom.filter((p) => p.kind === 'pokerchair')).toHaveLength(3);
      for (const f of [7, 9]) expect(generateFloor(plan, f).rooms.some((r) => r.type === 'poker')).toBe(false);
    }
  });
  it('floor 4 always has a dartboard spot: two wall tiles side by side facing the camera, clear of props and posters', () => {
    for (const seed of [1, 42, 777, 31337]) {
      const L = generateFloor(new BuildingPlan(seed, 'normal'), 4);
      const d = dartSpot(L);
      expect(d, `seed ${seed}`).not.toBeNull();
      for (const tx of [d!.tx, d!.tx + 1]) {
        expect(L.tiles[idx(tx, d!.ty)]).toBe(T_WALL);
        expect(L.tiles[idx(tx, d!.ty + 1)]).toBe(T_FLOOR);
      }
      for (const s of posterSpots(L, 99)) expect(Math.abs(s.ty - d!.ty) + Math.abs(s.tx - d!.tx - 0.5)).toBeGreaterThan(2);
      expect(dartSpot(generateFloor(new BuildingPlan(seed, 'normal'), 5))).toBeNull();
    }
  });
});
