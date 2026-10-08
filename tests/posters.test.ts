import { describe, it, expect } from 'vitest';
import { BuildingPlan } from '../src/gen/building';
import { generateFloor, T_WALL, T_FLOOR, idx } from '../src/gen/floor';
import { posterSpots } from '../src/render/posterSpots';

describe('poster spots', () => {
  it('posters hang on wall faces that look into a room, clear of props, spread apart', () => {
    const plan = new BuildingPlan(42, 'normal');
    for (const f of [1, 7, 33, 120]) {
      const L = generateFloor(plan, f);
      const spots = posterSpots(L, f * 7919);
      expect(spots.length, `floor ${f}`).toBeGreaterThan(0);
      expect(spots.length).toBeLessThanOrEqual(10);
      for (const s of spots) {
        expect(L.tiles[idx(s.tx, s.ty)]).toBe(T_WALL);
        expect(L.tiles[idx(s.tx, s.ty + 1)]).toBe(T_FLOOR);
        expect(L.props.some((p) => Math.hypot(p.x - (s.tx + 0.5), p.y - (s.ty + 1)) < 1)).toBe(false);
      }
      for (const a of spots) for (const b of spots) if (a !== b) expect(Math.hypot(a.tx - b.tx, a.ty - b.ty)).toBeGreaterThanOrEqual(3);
      expect(posterSpots(L, f * 7919)).toEqual(spots); // same floor, same seed: same spots
    }
  });
});
