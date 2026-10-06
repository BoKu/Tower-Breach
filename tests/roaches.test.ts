import { describe, it, expect } from 'vitest';
import { BuildingPlan } from '../src/gen/building';
import { generateFloor, isWalkableTile } from '../src/gen/floor';
import { Roaches } from '../src/render/roaches';

describe('roaches', () => {
  it('are deterministic per floor, absent on the street, and stay on walkable tiles hugging walls', () => {
    let infested = 0, running = 0, bad = 0;
    for (const seed of [11, 4242, 99991]) for (const floor of [0, 1, 6, 15, 40, 120]) {
      const plan = new BuildingPlan(seed, 'normal');
      const L = generateFloor(plan, floor);
      const a = new Roaches(L) as any, b = new Roaches(L) as any;
      expect(a.roaches.map((r: any) => r.spawns[0])).toEqual(b.roaches.map((r: any) => r.spawns[0]));
      if (floor === 0) { expect(a.roaches.length).toBe(0); continue; }
      if (a.roaches.length) infested++;
      const people = [{ x: -50, y: -50 }];
      for (let f = 0; f < 3000; f++) {
        const r0 = a.roaches[f % Math.max(1, a.roaches.length)];
        a.update(f / 60, 1 / 60, r0 ? { x: r0.spawns[0][0], y: r0.spawns[0][1] } : { x: 0, y: 0 }, f === 1500 && r0 ? [{ x: r0.x, y: r0.y }] : people, []);
        for (const r of a.roaches) if (r.state !== 'hidden') { running++; if (!isWalkableTile(L, Math.floor(r.x), Math.floor(r.y)) || r.w < 2) bad++; }
      }
    }
    expect(bad).toBe(0);
    expect(infested).toBeGreaterThan(3);
    expect(running).toBeGreaterThan(1000);
  }, 30000);

  it('are common enough to notice: most floors have some, several per floor, back out within seconds', () => {
    let infested = 0, total = 0, n = 0;
    const plan = new BuildingPlan(77, 'normal');
    for (let floor = 1; floor <= 40; floor++) {
      const r = new Roaches(generateFloor(plan, floor)) as any;
      n++; total += r.roaches.length;
      if (r.roaches.length) infested++;
    }
    expect(infested / n).toBeGreaterThan(0.6);
    expect(total / infested).toBeGreaterThanOrEqual(4);
  });
});

