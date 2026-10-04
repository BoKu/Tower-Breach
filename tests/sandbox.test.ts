import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { emptyLoadout } from '../src/ui/shop';
import { SANDBOX_FLOOR } from '../src/config/difficulty';
import { T_FLOOR, idx, generateFloor, PLANT_KINDS, PLANTER_KINDS, COUCH_KINDS } from '../src/gen/floor';
import { BuildingPlan } from '../src/gen/building';
import { PIPE_SERVICES } from '../src/render/models';

describe('dev sandbox + infinite torch', () => {
  it('sandbox floor: every model laid out, no enemies, no stair travel', () => {
    const sim = new Sim({ seed: 7, difficulty: 'insane', mode: 'single' });
    const p = sim.addPlayer(1, 'Dev', emptyLoadout());
    sim.travel(p, SANDBOX_FLOOR, 'start', 'debug');
    const fs = sim.floorState(SANDBOX_FLOOR);
    expect(fs.L.theme).toBe('sandbox');
    expect(fs.enemies.length).toBe(0);
    expect(fs.L.darkness).toBe(0);
    expect(fs.L.props.length).toBeGreaterThan(100);
    const kinds = new Set(fs.L.props.map((q) => q.kind));
    for (const k of ['desk', 'mainframe', 'policecar', 'swatvan', 'tent', 'cone', 'safe', 'vending']) expect(kinds.has(k)).toBe(true);
    expect(fs.L.tiles[idx(Math.floor(p.x), Math.floor(p.y))]).toBe(T_FLOOR);
    // walk into the up flight of stairwell 0: never leaves the sandbox
    const s = fs.L.stairs[0];
    p.x = s.upX; p.y = s.y0 + 0.3;
    for (let i = 0; i < 120; i++) sim.tick(1 / 60);
    expect(p.floor).toBe(SANDBOX_FLOOR);
    expect(fs.enemies.length).toBe(0);
  });

  it('torch cheat never drains the battery', () => {
    const sim = new Sim({ seed: 3, difficulty: 'normal', mode: 'single' });
    const p = sim.addPlayer(1, 'Dev', emptyLoadout());
    p.torchOn = true; p.cheats = { torch: true };
    const b0 = p.battery;
    for (let i = 0; i < 600; i++) sim.tick(1 / 60);
    expect(p.battery).toBe(b0);
    p.cheats = {};
    for (let i = 0; i < 600; i++) sim.tick(1 / 60);
    expect(p.battery).toBeLessThan(b0);
  });

  it('every plant variety and barrels appear in real tower floors and in the sandbox', () => {
    const plan = new BuildingPlan(11, 'normal');
    const seen = new Set<string>();
    for (let f = 1; f < 200; f += 9) for (const q of generateFloor(plan, f).props) seen.add(q.kind);
    for (const k of [...PLANT_KINDS, ...PLANTER_KINDS, ...COUCH_KINDS, 'barrel', 'stall', 'shower', 'urinal', 'sink', 'kitchensink']) expect(seen.has(k)).toBe(true);
    const sb = new Set(generateFloor(plan, SANDBOX_FLOOR).props.map((q) => q.kind));
    for (const k of [...PLANT_KINDS, ...PLANTER_KINDS, ...COUCH_KINDS, 'barrel', 'vending', 'mainframe', 'toilet', 'stall', 'shower', 'urinal', 'sink', 'kitchensink', 'fridge', 'counter', 'generator', 'boiler', 'barricade', 'sandbags']) expect(sb.has(k)).toBe(true);
  }, 30000);

  it('pipe banks use only colour-coded services; sandbox shows every service', () => {
    const plan = new BuildingPlan(5, 'normal');
    const banks: string[] = [];
    for (let f = 1; f < 200; f += 17) for (const q of generateFloor(plan, f).props) if (q.kind.startsWith('pipes.')) banks.push(q.kind);
    expect(banks.length).toBeGreaterThan(10);
    for (const k of banks) for (const svc of k.slice(6).split('#')[0].split('.')) expect(PIPE_SERVICES[svc]).toBeTruthy();
    const sb = generateFloor(plan, SANDBOX_FLOOR).props.filter((q) => q.kind.startsWith('pipes.')).map((q) => q.kind.slice(6).split('#')[0]);
    for (const svc of Object.keys(PIPE_SERVICES)) expect(sb).toContain(svc);
  }, 30000);
});
