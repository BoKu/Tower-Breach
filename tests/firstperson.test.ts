import { describe, it, expect } from 'vitest';
import { BuildingPlan } from '../src/gen/building';
import { generateFloor, isWalkableTile } from '../src/gen/floor';
import { raycastWalls } from '../src/sim/nav';
import { fpAim, fpMove } from '../src/render/firstPerson';

describe('first person (spike)', () => {
  const L = generateFloor(new BuildingPlan(3, 'normal'), 5);
  // a walkable spot with at least 4 m of open floor to the east
  let at = { x: 0, y: 0 };
  for (let y = 5; y < 40 && !at.x; y++) for (let x = 5; x < 55 && !at.x; x++) {
    const w = raycastWalls(L, x + 0.5, y + 0.5, x + 4.5, y + 0.5);
    if (isWalkableTile(L, x, y) && w < 0) at = { x: x + 0.5, y: y + 0.5 };
  }
  it('aims at the wall straight ahead, at the height you look', () => {
    const a = fpAim(L, [], at.x, at.y, 2.0, 0, 0);
    expect(a.y).toBeCloseTo(at.y, 3);
    expect(a.x).toBeGreaterThan(at.x);
    expect(a.h).toBeCloseTo(2.0, 1);
    const down = fpAim(L, [], at.x, at.y, 2.0, 0, -0.4);
    expect(down.h).toBeLessThan(2.0);
  });
  it('snaps to an enemy standing on the line of sight', () => {
    const e = { x: at.x + 1.5, y: at.y + 0.1 };
    const a = fpAim(L, [e], at.x, at.y, 2.0, 0, 0);
    expect(a.x).toBeCloseTo(e.x, 1);
  });
  it('snaps to a wall camera you look up at (the muzzle sits lower than your eye, so the far wall would miss it)', () => {
    const cam = { x: at.x + 2, y: at.y, lo: 2.05, hi: 2.75 };
    const a = fpAim(L, [], at.x, at.y, 2.0, 0, Math.atan2(0.4, 2), [cam]);
    expect(a.x).toBeCloseTo(cam.x, 1);
    expect(a.h).toBeCloseTo(2.4, 1);
    const level = fpAim(L, [], at.x, at.y, 2.0, 0, -1.0, [cam]); // looking at the floor: not the camera
    expect(level.x).toBeLessThan(cam.x - 0.3);
  });
  it('W/A/S/D move relative to where you look (yaw 0 = east, the sim\'s +x; +y is south)', () => {
    expect(fpMove(0, 1, 0)).toEqual({ x: 1, y: 0 }); // W facing east: east
    const r = fpMove(1, 0, 0); expect(r.x).toBeCloseTo(0); expect(r.y).toBeCloseTo(1); // D facing east: south (your right)
    const b = fpMove(0, 1, Math.PI / 2); expect(b.x).toBeCloseTo(0); expect(b.y).toBeCloseTo(1); // W facing south: south
  });
});
