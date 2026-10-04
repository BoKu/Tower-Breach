import { describe, it, expect } from 'vitest';
import { setup } from './helpers';

describe('container weapon swap', () => {
  it('regression: uncarriable leftovers in a safe never block hold-to-swap', () => {
    const { sim, fs, p } = setup();
    p.items.medkit = 3; p.items.plate = 3; // already carrying the maximum
    fs.containers.push({ id: 900, kind: 'safe', x: p.x + 0.9, y: p.y, opened: false, label: 'Executive Safe',
      items: [{ k: 'weapon', id: 'aro', mag: 30, reserve: 0 }, { k: 'item', item: 'medkit', n: 1 }, { k: 'item', item: 'plate', n: 1 }] });
    p.input.ax = p.x + 3; p.input.ay = p.y;
    const tap = () => { p.input.interact = true; sim.tick(1 / 60); p.input.interact = false; sim.tick(1 / 60); };
    const hold = (s: number) => { p.input.interact = true; for (let t = 0; t < s; t += 1 / 60) sim.tick(1 / 60); p.input.interact = false; sim.tick(1 / 60); };
    // prompt offers both actions
    sim.tick(1 / 60);
    expect(p.prompt).toContain('Search');
    expect(p.prompt).toContain('Hold');
    tap(); // search: nothing fits, leftovers stay
    const safe = fs.containers.find((c) => c.id === 900)!;
    expect(safe.items.some((i) => i.k === 'item')).toBe(true);
    expect(p.weapons.primary!.id).toBe('sr4');
    hold(0.9); // swap works despite the leftovers
    expect(p.weapons.primary!.id).toBe('aro');
    expect(safe.items.some((i) => i.k === 'weapon' && i.id === 'sr4')).toBe(true);
    // a tap after swapping does not swap back
    tap();
    expect(p.weapons.primary!.id).toBe('aro');
  });
  it('holding to swap does not also trigger the tap search on release', () => {
    const { sim, fs, p } = setup();
    fs.containers.push({ id: 901, kind: 'safe', x: p.x + 0.9, y: p.y, opened: false, label: 'Executive Safe',
      items: [{ k: 'weapon', id: 'aro', mag: 30, reserve: 0 }, { k: 'item', item: 'battery', n: 1 }] });
    p.items.battery = 0;
    p.input.ax = p.x + 3; p.input.ay = p.y;
    p.input.interact = true; for (let i = 0; i < 50; i++) sim.tick(1 / 60); p.input.interact = false; sim.tick(1 / 60);
    expect(p.weapons.primary!.id).toBe('aro');
    expect(p.items.battery).toBe(0); // release after a completed hold didn't loot
  });
});
