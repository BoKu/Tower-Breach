import { describe, it, expect } from 'vitest';
import { easterSunday, holidayOn, currentHoliday, setHolidayOverride } from '../src/config/holiday';

const ymd = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

describe('holiday calendar', () => {
  it('computes Easter Sunday', () => {
    expect(ymd(easterSunday(2024))).toEqual([2024, 3, 31]);
    expect(ymd(easterSunday(2025))).toEqual([2025, 4, 20]);
    expect(ymd(easterSunday(2026))).toEqual([2026, 4, 5]);
    expect(ymd(easterSunday(2027))).toEqual([2027, 3, 28]);
  });

  it('a holiday is live on its day and the 3 days before', () => {
    expect(holidayOn(new Date(2026, 11, 21))).toBe(null);
    expect(holidayOn(new Date(2026, 11, 22))).toBe('xmas');
    expect(holidayOn(new Date(2026, 11, 25, 23, 59))).toBe('xmas');
    expect(holidayOn(new Date(2026, 11, 26))).toBe(null);
    expect(holidayOn(new Date(2026, 3, 1))).toBe(null);
    expect(holidayOn(new Date(2026, 3, 2))).toBe('easter');
    expect(holidayOn(new Date(2026, 3, 5))).toBe('easter');
    expect(holidayOn(new Date(2026, 9, 27))).toBe(null);
    expect(holidayOn(new Date(2026, 9, 28))).toBe('halloween');
    expect(holidayOn(new Date(2026, 9, 31))).toBe('halloween');
    expect(holidayOn(new Date(2026, 10, 1))).toBe(null);
  });

  it('dev override wins over the date', () => {
    setHolidayOverride('easter');
    expect(currentHoliday()).toBe('easter');
    setHolidayOverride(null);
    expect(currentHoliday()).toBe(null);
    setHolidayOverride(undefined);
  });
});

describe('holiday sandboxes', () => {
  it('leave out the default-only models, CCTV, traps and pipes', async () => {
    const { BuildingPlan } = await import('../src/gen/building');
    const { generateFloor, clearFloorCache } = await import('../src/gen/floor');
    const { SANDBOX_FLOOR } = await import('../src/config/difficulty');
    const kinds = () => { clearFloorCache(); const L = generateFloor(new BuildingPlan(1, 'normal'), SANDBOX_FLOOR); return { L, k: new Set(L.props.map((p) => p.kind.split('.')[0])) }; };
    setHolidayOverride(null);
    const plain = kinds();
    expect(plain.k.has('chair') && plain.k.has('pipes') && plain.L.cameras.length > 0).toBe(true);
    setHolidayOverride('halloween');
    const hal = kinds();
    for (const k of ['chair', 'pipes', 'mainframe', 'couch', 'panel']) expect(hal.k.has(k)).toBe(false);
    expect(hal.k.has('reception') && hal.k.has('planter')).toBe(true);
    expect(hal.L.cameras.length + hal.L.traps.length).toBe(0);
    setHolidayOverride(undefined);
    clearFloorCache();
  });
});

describe('Halloween zombies', () => {
  it('zombies, bats and ogres spawn gunless and only melee; other days they keep their guns', async () => {
    const { Sim } = await import('../src/sim/sim');
    const humans = (holiday: 'halloween' | null) => {
      const sim = new Sim({ seed: 7, difficulty: 'normal', mode: 'single', holiday });
      const es = [1, 2, 3, 12, 13, 45, 46].flatMap((f) => sim.floorState(f).enemies).filter((e) => e.type !== 'dog' && e.type !== 'dogcyborg');
      return es;
    };
    const normal = humans(null), zombies = humans('halloween');
    expect(normal.length).toBeGreaterThan(0);
    expect(normal.every((e) => e.weapon !== 'bite')).toBe(true);
    expect(zombies.length).toBe(normal.length);
    expect(zombies.every((e) => e.weapon === 'bite')).toBe(true);
  });

  it('a zombie closes in and claws instead of shooting', async () => {
    const { setup, addEnemy, run } = await import('./helpers');
    const { sim, fs, p } = setup();
    const z = addEnemy(sim, fs, 'loyalist', p.x + 6, p.y, Math.PI, 'bite');
    const kinds: string[] = [];
    const hp = p.hp;
    p.input.ax = z.x; p.input.ay = z.y;
    run(sim, 6, () => kinds.push(...sim.drainEvents().map((e) => e.e)));
    expect(kinds).not.toContain('shot');
    expect(p.hp).toBeLessThan(hp);
  });
});
