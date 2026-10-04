import { describe, it, expect } from 'vitest';
import { setup, addEnemy, run } from './helpers';
import { idx, T_WALL } from '../src/gen/floor';
import { canSee } from '../src/sim/combat';
import type { GrenadeType } from '../src/config/items';
import type { Sim } from '../src/sim/sim';
import type { PlayerState } from '../src/sim/state';

function throwAt(sim: Sim, p: PlayerState, g: GrenadeType, x: number, y: number) {
  p.grenades[g] = Math.max(1, p.grenades[g]);
  p.grenadeSel = g;
  p.input.ax = x; p.input.ay = y;
  p.input.grenade++;
  sim.tick(1 / 60);
}

describe('grenades', () => {
  it('throwing consumes the grenade, lands near the aim point and auto-cycles when empty', () => {
    const { sim, fs, p } = setup();
    p.grenades.frag = 1; p.grenades.smoke = 1; p.grenades.flash = 0;
    throwAt(sim, p, 'frag', p.x + 8, p.y);
    expect(p.grenades.frag).toBe(0);
    expect(p.grenadeSel).toBe('smoke');
    expect(fs.grenades.length).toBe(1);
    const g = fs.grenades[0];
    run(sim, 1.2);
    expect(g.x).toBeGreaterThan(p.x + 4);
    expect(g.x).toBeLessThan(p.x + 13);
    // nothing left of any type -> refused
    p.grenades.smoke = 0;
    p.input.grenade++; sim.tick(1 / 60);
    expect(fs.grenades.filter((x) => x.fuse > 0).length).toBeLessThanOrEqual(1);
  });

  it('bounces off walls instead of passing through', () => {
    const { sim, fs, p } = setup();
    for (let y = 1; y < 47; y++) fs.L.tiles[idx(14, y)] = T_WALL;
    throwAt(sim, p, 'smoke', p.x + 12, p.y); // wall at x=14 between
    const g = fs.grenades[0];
    let maxX = 0;
    for (let i = 0; i < 80; i++) { sim.tick(1 / 60); maxX = Math.max(maxX, g.x); }
    expect(maxX).toBeLessThan(14);
  });

  it('frag: kills an enemy in the blast, walls shield, thrower takes self-damage', () => {
    const { sim, fs, p } = setup();
    const near = addEnemy(sim, fs, 'loyalist', p.x + 7, p.y, Math.PI / 2);
    const shielded = addEnemy(sim, fs, 'loyalist', p.x + 7, p.y + 4, Math.PI / 2);
    for (let x = 1; x < 62; x++) fs.L.tiles[idx(x, Math.floor(p.y) + 2)] = T_WALL; // wall between blast and 2nd enemy
    throwAt(sim, p, 'frag', near.x, near.y);
    run(sim, 2.2);
    expect(near.state).toBe('dead');
    expect(shielded.state).not.toBe('dead');
    expect(shielded.hp).toBe(shielded.maxHp);
    // self damage when standing in own blast
    const s2 = setup();
    s2.p.armor = 0;
    throwAt(s2.sim, s2.p, 'frag', s2.p.x + 2, s2.p.y);
    run(s2.sim, 2.2);
    expect(s2.p.hp).toBeLessThan(100);
  });

  it('frag noise alerts distant enemies', () => {
    const { sim, fs, p } = setup();
    const far = addEnemy(sim, fs, 'loyalist', p.x + 25, p.y + 20, 0);
    throwAt(sim, p, 'frag', p.x + 8, p.y);
    run(sim, 2.2);
    expect(['search', 'investigate', 'suspicious', 'alert']).toContain(far.state);
  });

  it('smoke: blocks line of sight, prevents detection and CCTV spotting, then clears', () => {
    const { sim, fs, p } = setup();
    throwAt(sim, p, 'smoke', p.x + 5, p.y);
    run(sim, 2);
    const z = fs.zones.find((z) => z.kind === 'smoke')!;
    expect(z).toBeTruthy();
    expect(canSee(fs, p.x, p.y, z.x + 6, z.y)).toBe(false);
    // enemy on the far side of the smoke never spots the player
    const e = addEnemy(sim, fs, 'loyalist', z.x + 4, p.y, Math.PI);
    fs.cameras.push({ id: 7, x: z.x + 4.5, y: p.y + 0.01, baseAngle: Math.PI, sweep: 0, speed: 0, phase: 0, range: 12, fov: 0.3, angle: Math.PI, alive: true, detect: 0, alarmT: 0, hp: 1 });
    run(sim, 4);
    expect(e.state).not.toBe('alert');
    expect(fs.cameras[0].alarmT).toBeLessThanOrEqual(0);
    run(sim, 10);
    expect(fs.zones.some((z) => z.kind === 'smoke')).toBe(false);
    expect(canSee(fs, p.x, p.y, z.x + 6, z.y)).toBe(true);
  });

  it('incendiary: ignites on landing, burns enemies and players inside, expires', () => {
    const { sim, fs, p } = setup();
    const e = addEnemy(sim, fs, 'loyalist', p.x + 6, p.y, Math.PI / 2);
    throwAt(sim, p, 'incendiary', e.x, e.y);
    run(sim, 1.5);
    const fire = fs.zones.find((z) => z.kind === 'fire');
    expect(fire).toBeTruthy();
    const hp0 = e.hp;
    e.x = fire!.x; e.y = fire!.y; e.state = 'sleep';
    run(sim, 1);
    expect(e.hp).toBeLessThan(hp0);
    // player walking through fire burns (armour doesn't help)
    p.armor = 100;
    const php = p.hp;
    p.x = fire!.x; p.y = fire!.y;
    run(sim, 0.5);
    expect(p.hp).toBeLessThan(php);
    expect(p.armor).toBe(100);
    run(sim, 7);
    expect(fs.zones.some((z) => z.kind === 'fire')).toBe(false);
  });

  it('incendiary: AI paths route around active fire', () => {
    const { sim, fs, p } = setup();
    fs.zones.push({ id: 1, kind: 'fire', x: 30.5, y: 20.5, r: 2.8, t: 60, tick: 0 });
    const e = addEnemy(sim, fs, 'loyalist', 24.5, 20.5, 0);
    e.state = 'investigate'; e.interestX = 36.5; e.interestY = 20.5;
    p.x = 5; p.y = 40;
    let minD = 99;
    for (let i = 0; i < 300; i++) { sim.tick(1 / 60); minD = Math.min(minD, Math.hypot(e.x - 30.5, e.y - 20.5)); }
    expect(e.x).toBeGreaterThan(32);
    expect(minD).toBeGreaterThan(2.3);
  });

  it('decoy: fake gunfire draws enemies to the decoy, not the thrower', () => {
    const { sim, fs, p } = setup('single', 1, 150, 0.9); // thrower crouched in the dark
    p.input.crouch = true;
    const e = addEnemy(sim, fs, 'loyalist', p.x + 18, p.y + 16, Math.PI / 2);
    throwAt(sim, p, 'decoy', p.x + 14, p.y + 10);
    let shots = 0;
    for (let i = 0; i < 60 * 4; i++) { sim.tick(1 / 60); shots += sim.drainEvents().filter((ev) => ev.e === 'shot' && ev.id === -1).length; }
    expect(shots).toBeGreaterThan(3);
    const z = fs.zones.find((z) => z.kind === 'decoy')!;
    expect(['search', 'investigate', 'suspicious']).toContain(e.state);
    expect(Math.hypot(e.interestX - z.x, e.interestY - z.y)).toBeLessThan(1.5);
    expect(e.target === -1 || e.state !== 'alert').toBe(true);
    run(sim, 6);
    expect(fs.zones.some((z) => z.kind === 'decoy')).toBe(false);
  });
});

describe('regression QA-13: noise alone never completes detection', () => {
  it('repeated loud noise raises suspicion but a barely-visible player is not instantly acquired', () => {
    const { sim, fs, p } = setup('single', 1, 150, 0.9);
    p.input.crouch = true;
    const e = addEnemy(sim, fs, 'loyalist', p.x + 12, p.y, Math.PI); // facing the player, in the dark
    for (let i = 0; i < 10; i++) sim.noise(fs, p.x + 11, p.y + 1, 22, null);
    expect(e.aware).toBeLessThanOrEqual(0.6);
    sim.tick(1 / 30);
    sim.tick(1 / 30);
    expect(e.state).not.toBe('alert');
  });
});
