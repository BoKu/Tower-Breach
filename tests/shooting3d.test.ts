import { describe, it, expect } from 'vitest';
import { setup, addEnemy } from './helpers';
import { idx, S_LOW } from '../src/gen/floor';
import type { Sim } from '../src/sim/sim';
import type { PlayerState } from '../src/sim/state';

/** Fire exactly one aimed round at (x, y, z) and return its shot event. */
function shootAt(sim: Sim, p: PlayerState, x: number, y: number, z: number) {
  p.input.ax = x; p.input.ay = y; p.input.az = z; p.input.aim = true;
  sim.tick(1 / 60); // turn to face
  p.bloom = 0; p.fireCd = 0;
  sim.drainEvents();
  p.input.fire = true; sim.tick(1 / 60); p.input.fire = false; sim.tick(1 / 60);
  return sim.drainEvents().filter((e: any) => e.e === 'shot' && e.src === 'p') as any[];
}

describe('3D aimed shooting (bullets go where the crosshair is)', () => {
  it('aiming at the floor in front of your feet hits the floor there, not something far behind it', () => {
    const { sim, fs, p } = setup();
    const far = addEnemy(sim, fs, 'loyalist', p.x + 8, p.y, Math.PI / 2);
    far.state = 'sleep';
    const [s] = shootAt(sim, p, p.x + 1.6, p.y, 0);
    expect(s.hit).toBe('floor');
    expect(s.z2).toBe(0);
    expect(Math.hypot(s.x2 - (p.x + 1.6), s.y2 - p.y)).toBeLessThan(0.25);
    expect(far.hp).toBe(far.maxHp);
  });

  it('tracer starts at gun height and ends at the aim height', () => {
    const { sim, p } = setup();
    const [s] = shootAt(sim, p, p.x + 3, p.y + 1, 0);
    expect(s.z).toBeCloseTo(1.25, 2);
    expect(s.z2).toBe(0);
    p.input.crouch = true; sim.tick(1 / 60);
    const [c] = shootAt(sim, p, p.x + 3, p.y + 1, 0);
    expect(c.z).toBeCloseTo(0.9, 2); // crouched: gun is lower
  });

  it('aiming at an enemy body hits it; a descending shot hits dogs and legs but passes under a hovering drone', () => {
    const a = setup();
    const e = addEnemy(a.sim, a.fs, 'loyalist', a.p.x + 6, a.p.y, Math.PI / 2); e.state = 'sleep';
    shootAt(a.sim, a.p, e.x, e.y, 1.15);
    expect(e.hp).toBeLessThan(e.maxHp);
    const b = setup();
    const dog = addEnemy(b.sim, b.fs, 'dog', b.p.x + 5, b.p.y, 0); dog.state = 'sleep';
    shootAt(b.sim, b.p, b.p.x + 5.8, b.p.y, 0); // floor just beyond the dog: the round is at ~0.2 m when it reaches the dog
    expect(dog.hp).toBeLessThan(dog.maxHp);
    const c = setup();
    const drone = addEnemy(c.sim, c.fs, 'drone', c.p.x + 5, c.p.y, 0); drone.state = 'sleep';
    shootAt(c.sim, c.p, c.p.x + 5.8, c.p.y, 0);
    expect(drone.hp).toBe(drone.maxHp);
    shootAt(c.sim, c.p, drone.x, drone.y, 1.45); // aim at the drone itself
    expect(drone.hp).toBeLessThan(drone.maxHp);
  });

  it('low cover blocks low shots but not shots over its top', () => {
    const { sim, fs, p } = setup();
    for (let y = 1; y < 47; y++) fs.L.solid[idx(Math.floor(p.x) + 3, y)] = S_LOW; // desk row 3 m ahead
    const e = addEnemy(sim, fs, 'loyalist', p.x + 7, p.y, Math.PI / 2); e.state = 'sleep';
    const [low] = shootAt(sim, p, p.x + 4.2, p.y, 0); // aimed at floor behind the desk
    expect(low.hit).toBe('wall');
    expect(low.x2).toBeLessThan(p.x + 4.1);
    shootAt(sim, p, e.x, e.y, 1.15); // aimed at the enemy's chest: clears the desk
    expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('flat shots (gamepad / no aim height) behave as before and reach full range', () => {
    const { sim, p } = setup();
    const [s] = shootAt(sim, p, p.x + 2, p.y, NaN);
    expect(s.hit).not.toBe('floor');
    expect(Math.hypot(s.x2 - s.x, s.y2 - s.y)).toBeGreaterThan(20);
  });

  it('point blank: a dog biting at your feet is hittable whether you aim at its body or the floor beside it', () => {
    for (const [d, az, side] of [[0.7, 0.5, 0], [0.75, 0, 0.25], [1.0, 0.3, -0.2], [0.55, 0, 0]] as [number, number, number][]) {
      const { sim, fs, p } = setup();
      p.cheats = { god: true };
      const dog = addEnemy(sim, fs, 'dog', p.x + d, p.y, Math.PI); dog.state = 'sleep';
      shootAt(sim, p, p.x + d + 0.05, p.y + side, az);
      expect(dog.hp, `dog at ${d} m, aim z ${az}`).toBeLessThan(dog.maxHp);
    }
  });
});
