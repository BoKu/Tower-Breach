import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { trace, killPanel, togglePanel } from '../src/sim/combat';
import { lightOut, panelLights } from '../src/sim/lights';
import { isWalkableTile } from '../src/gen/floor';
import { LOADOUT } from './helpers';

function floorWithPanel(sim: Sim) {
  for (let f = 1; f < 60; f++) {
    const fs = sim.floorState(f);
    const pn = fs.panels.find((q) => panelLights(fs.L, q).length > 0);
    if (pn) return { fs, pn };
  }
  throw new Error('no breaker panel with lights in floors 1-59');
}

describe('breaker panels', () => {
  it('E toggles the lights quietly; a shot kills them for good', () => {
    const sim = new Sim({ seed: 42, difficulty: 'normal', mode: 'single' });
    const p = sim.addPlayer(1, 'P1', JSON.parse(JSON.stringify(LOADOUT)));
    const { fs, pn } = floorWithPanel(sim);
    const lights = panelLights(fs.L, pn);
    expect(pn.rooms.length).toBeGreaterThan(1); // its own room plus neighbours

    togglePanel(sim, fs, pn, p);
    expect(lights.every((i) => lightOut(fs.lights[i], fs.L.lights[i]))).toBe(true);
    togglePanel(sim, fs, pn, p);
    expect(lights.some((i) => !lightOut(fs.lights[i], fs.L.lights[i]))).toBe(true);

    // a bullet from a nearby tile reaches the panel
    let shot = false;
    for (let r = 1; r <= 4 && !shot; r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      const x = Math.floor(pn.x) + dx + 0.5, y = Math.floor(pn.y) + dy + 0.5;
      if (!isWalkableTile(fs.L, Math.floor(x), Math.floor(y))) continue;
      const h = trace(sim, fs, x, y, Math.atan2(pn.y - y, pn.x - x), 20, 'p', p.id);
      if (h.kind === 'panel') { shot = true; break; }
    }
    expect(shot).toBe(true);

    killPanel(sim, fs, pn, p);
    expect(pn.dead).toBe(true);
    expect(lights.every((i) => fs.lights[i].cut)).toBe(true);
    togglePanel(sim, fs, pn, p); // a dead panel can't switch anything back on
    expect(lights.every((i) => lightOut(fs.lights[i], fs.L.lights[i]))).toBe(true);
  });
});

describe('shooting out ceiling lights', () => {
  it('an aimed shot pops the lamp; a level shot passes under it', async () => {
    const { setup } = await import('./helpers');
    const { sim, fs, p } = setup();
    fs.L = { ...fs.L, lights: [{ id: 1, x: 15, y: 10, color: 0xffffff, intensity: 1, range: 8, flicker: 0, broken: false, room: 0, kind: 'ceiling' }] };
    fs.lights = [{ broken: false, burstT: 0 }];
    const level = trace(sim, fs, 10, 10, 0, 30, 'p', p.id, { z0: 1.25, dz: 0 });
    expect(level.kind).not.toBe('light');
    const up = trace(sim, fs, 10, 10, 0, 30, 'p', p.id, { z0: 1.25, dz: (2.5 - 1.25) / 5 });
    expect(up.kind).toBe('light');
    p.input.ax = 15; p.input.ay = 10; p.input.az = 2.5; p.input.fire = true;
    for (let i = 0; i < 20 && !fs.lights[0].broken; i++) sim.tick(1 / 30);
    expect(fs.lights[0].broken).toBe(true);
  });
});

describe('disconnected co-op players', () => {
  it('leave the world: enemies cannot see or hurt them', async () => {
    const { setup, addEnemy, run } = await import('./helpers');
    const { damagePlayer } = await import('../src/sim/combat');
    const { sim, fs, p } = setup();
    const e = addEnemy(sim, fs, 'loyalist', p.x + 4, p.y, Math.PI);
    p.connected = false;
    run(sim, 2);
    expect(e.state).not.toBe('alert');
    const hp = p.hp;
    damagePlayer(sim, p, 50, 0, 'bullet');
    expect(p.hp).toBe(hp);
  });
});

describe('leaving the tower', () => {
  it('lands you outside the tower doors, not back at the start', async () => {
    const { Sim } = await import('../src/sim/sim');
    const sim = new Sim({ seed: 5, difficulty: 'normal', mode: 'single' });
    const p = sim.addPlayer(1, 'P1', JSON.parse(JSON.stringify(LOADOUT)));
    sim.travel(p, 1, 'entrance', 'test');
    sim.travel(p, 0, 'entrance', 'test');
    const L = sim.floorState(0).L;
    expect(Math.hypot(p.x - L.anchors.entrance.x, p.y - L.anchors.entrance.y)).toBeLessThan(2);
    expect(Math.hypot(p.x - L.anchors.start.x, p.y - L.anchors.start.y)).toBeGreaterThan(10);
  });
});
