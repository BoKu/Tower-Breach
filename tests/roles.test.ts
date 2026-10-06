import { describe, it, expect } from 'vitest';
import { setup, addEnemy, run, LOADOUT } from './helpers';
import { Sim } from '../src/sim/sim';
import { weapon } from '../src/config/weapons';
import { setDoor } from '../src/sim/combat';
import { playerSpeed, WALK_SPEED, SWAP_TIME, PIERCE_DAMAGE, PIN } from '../src/sim/player';
import { sanitizeLoadout, validLoadout, emptyLoadout } from '../src/sim/loadout';
import { idx, T_WALL, FW, S_NONE } from '../src/gen/floor';
import type { PlayerState, Enemy } from '../src/sim/state';

/** Hold weapon `id` in the right slot and fire one aimed shot at (x, y, z). */
function fire(sim: Sim, p: PlayerState, id: string, x: number, y: number, z = 1.1) {
  const w = weapon(id);
  p.weapons[w.slot] = { id, mag: w.mag }; p.sel = w.slot;
  p.input.ax = x; p.input.ay = y; p.input.az = z; p.input.aim = true;
  sim.tick(1 / 60);
  p.bloom = 0; p.fireCd = 0; p.reloadT = 0; sim.drainEvents();
  p.input.fire = true; sim.tick(1 / 60); p.input.fire = false; sim.tick(1 / 60);
  return sim.drainEvents();
}
/** Noise radii raised while firing one shot. */
function shotNoise(id: string, suppressor: boolean) {
  const { sim, p } = setup();
  p.mods.suppressor = suppressor;
  const rs: number[] = [];
  const orig = sim.noise.bind(sim);
  sim.noise = (fs, x, y, r, src, fe) => { rs.push(r); orig(fs, x, y, r, src, fe); };
  fire(sim, p, id, p.x + 5, p.y);
  return Math.max(...rs);
}
const tough = (e: Enemy, alert = false) => { e.hp = e.maxHp = 1000; e.armor = 0; if (alert) { e.state = 'alert'; e.aware = 1; } return e; };

describe('suppressor (mission gear mod)', () => {
  it('pistols drop to ~4 m, SMGs to ~6 m; rifles and heavy pistols are unaffected', () => {
    expect(shotNoise('p9', false)).toBe(16);
    expect(shotNoise('p9', true)).toBe(4);
    expect(shotNoise('ap18', true)).toBe(4);
    expect(shotNoise('mpx9', false)).toBe(11); // subsonic .45 baseline
    expect(shotNoise('mpx9', true)).toBe(6);
    expect(shotNoise('sr4', true)).toBe(24);
    expect(shotNoise('hc50', true)).toBe(24);
    expect(shotNoise('sr4s', false)).toBe(10);
  });
  it('costs a little damage on the guns it fits', () => {
    const hit = (sup: boolean) => { const { sim, fs, p } = setup(); p.mods.suppressor = sup; const e = tough(addEnemy(sim, fs, 'loyalist', p.x + 3, p.y, Math.PI), true); fire(sim, p, 'p9', e.x, e.y); return 1000 - e.hp; };
    expect(hit(false)).toBeCloseTo(26);
    expect(hit(true)).toBeCloseTo(26 * 0.92);
  });
  it('survives save/load and is validated in co-op loadouts', () => {
    const { sim, p } = setup();
    p.mods.suppressor = true;
    expect(Sim.fromSave(JSON.parse(JSON.stringify(sim.exportSave(p))), 1).player(1)!.mods.suppressor).toBe(true);
    const lo = sanitizeLoadout({ ...emptyLoadout(), mods: { suppressor: true } })!;
    expect(lo.mods.suppressor).toBe(true);
    expect(validLoadout(lo, 'normal')).toBe(true);
    expect(sanitizeLoadout({ ...emptyLoadout(), mods: { suppressor: 'yes' } })!.mods.suppressor).toBe(false);
    expect(sanitizeLoadout({ ...emptyLoadout(), mods: { suppressor: 1 } })!.mods.suppressor).toBe(false);
    expect(validLoadout({ ...lo, primary: 'lmg249', secondary: 'hc50', armor: 'vesthelm', items: { medkit: 3 }, mods: { bypass: true, torchmod: true, pouch: true, suppressor: true } }, 'insane')).toBe(false); // over budget
  });
});

describe('sneak shots (pistols, snipers)', () => {
  for (const [id, base] of [['p9', 26], ['scout8', 88]] as const) {
    it(`${id}: double damage on an unaware enemy, normal on an alert one`, () => {
      for (const alert of [false, true]) {
        const { sim, fs, p } = setup();
        const e = tough(addEnemy(sim, fs, 'loyalist', p.x + 3, p.y, 0), alert); // facing away
        fire(sim, p, id, e.x, e.y);
        expect(1000 - e.hp, alert ? 'alert' : 'unaware').toBeCloseTo(base * (alert ? 1 : 2));
      }
    });
  }
});

describe('pistol and SMG handling', () => {
  it('pistols swap in and out twice as fast', () => {
    const { sim, p } = setup(); // sr4 + p9, rifle selected
    const to = (slot: number) => { p.fireCd = 0; p.input.slot = slot; p.input.slotSeq++; sim.tick(1 / 60); return p.fireCd; };
    expect(to(2)).toBeCloseTo(SWAP_TIME); // rifle -> knife
    expect(to(1)).toBeCloseTo(SWAP_TIME / 2); // knife -> pistol
    expect(to(0)).toBeCloseTo(SWAP_TIME / 2); // pistol -> rifle
    expect(to(2)).toBeCloseTo(SWAP_TIME);
  });
  it('pistols and SMGs keep full walking speed while aiming; rifles slow down', () => {
    const { p } = setup();
    p.aiming = true;
    for (const id of ['p9', 'ap18', 'k45', 'pdw50']) { const w = weapon(id); p.weapons[w.slot] = { id, mag: w.mag }; p.sel = w.slot; expect(playerSpeed(p), id).toBeCloseTo(WALK_SPEED); }
    p.weapons.primary = { id: 'sr4', mag: 30 }; p.sel = 'primary';
    expect(playerSpeed(p)).toBeLessThan(WALK_SPEED * 0.75);
  });
});

describe('armour penetration', () => {
  for (const [id, base] of [['hc50', 58], ['r357', 66], ['vg338', 160]] as const) {
    it(`${id} ignores armour`, () => {
      const { sim, fs, p } = setup();
      const e = tough(addEnemy(sim, fs, 'loyalist', p.x + 4, p.y, Math.PI), true);
      e.armor = 100;
      fire(sim, p, id, e.x, e.y);
      expect(1000 - e.hp).toBeCloseTo(base);
    });
  }
});

describe('shotguns', () => {
  const alertShooter = () => {
    const s = setup();
    s.p.cheats = { god: true };
    const e = tough(addEnemy(s.sim, s.fs, 'loyalist', s.p.x + 3, s.p.y, Math.PI), true);
    e.target = s.p.id; e.lastSeenT = 0; e.fireCd = 0;
    return { ...s, e };
  };
  const enemyShots = (sim: Sim, secs: number) => { let n = 0; run(sim, secs, () => { n += sim.drainEvents().filter((v: any) => v.e === 'shot' && v.src === 'e').length; }); return n; };
  it('a close blast staggers: the target cannot fire for ~0.6 s', () => {
    const control = alertShooter();
    expect(enemyShots(control.sim, 0.5)).toBeGreaterThan(0);
    const { sim, p, e } = alertShooter();
    fire(sim, p, 'br12', e.x, e.y);
    expect(e.stunT).toBeGreaterThan(0.5);
    e.fireCd = 0;
    expect(enemyShots(sim, 0.45)).toBe(0);
    expect(enemyShots(sim, 1.5)).toBeGreaterThan(0); // recovers
  });
  it('one-shots a dog and a camera at close range', () => {
    for (const dog of ['dog', 'dogcyborg'] as const) {
      const { sim, fs, p } = setup();
      const e = addEnemy(sim, fs, dog, p.x + 5, p.y, Math.PI);
      fire(sim, p, 'br12', e.x, e.y, 0.5);
      expect(e.state, dog).toBe('dead');
    }
    const { sim, fs, p } = setup();
    fs.cameras.push({ id: 1, x: p.x + 6, y: p.y, baseAngle: 0, sweep: 0, speed: 0, phase: 0, range: 8, fov: 0.6, angle: 0, alive: true, detect: 0, alarmT: 0, hp: 30 });
    fire(sim, p, 'br12', p.x + 6, p.y, 2.4);
    expect(fs.cameras[0].alive).toBe(false);
  });
  it('does not breach a locked door', () => {
    const sim = new Sim({ seed: 42, difficulty: 'normal', mode: 'single' });
    const p = sim.addPlayer(1, 'P1', JSON.parse(JSON.stringify(LOADOUT)));
    for (let f = 2; f < 40; f++) {
      const fs = sim.floorState(f);
      const i = fs.L.doors.findIndex((d) => d.tiles.length === 1 && d.vertical && [-1, 1].every((s) => fs.L.solid[d.tiles[0] + s] === S_NONE));
      if (i < 0) continue;
      fs.enemies = []; fs.cameras = []; fs.traps = []; fs.scareT = 1e9;
      const t = fs.L.doors[i].tiles[0], dx = (t % FW) + 0.5, dy = Math.floor(t / FW) + 0.5;
      setDoor(sim, fs, i, 'locked', 0, null);
      p.floor = f; p.x = dx - 2; p.y = dy;
      for (let k = 0; k < 4; k++) fire(sim, p, 'br12', dx, dy);
      expect(fs.doors[i].state).toBe('locked');
      return;
    }
    throw new Error('no door');
  });
});

describe('sniper rounds pierce', () => {
  it('carry through into a second enemy behind the first (reduced), stopped by a wall', () => {
    for (const wall of [false, true]) {
      const { sim, fs, p } = setup();
      const a = tough(addEnemy(sim, fs, 'loyalist', p.x + 5, p.y, Math.PI), true);
      const b = tough(addEnemy(sim, fs, 'loyalist', p.x + 9, p.y, Math.PI), true);
      if (wall) fs.L.tiles[idx(Math.floor(p.x + 7), Math.floor(p.y))] = T_WALL;
      fire(sim, p, 'scout8', b.x, b.y);
      expect(1000 - a.hp).toBeCloseTo(88);
      expect(1000 - b.hp, wall ? 'wall' : 'open').toBeCloseTo(wall ? 0 : 88 * PIERCE_DAMAGE);
    }
  });
  it('a rifle round stops in the first enemy', () => {
    const { sim, fs, p } = setup();
    const a = tough(addEnemy(sim, fs, 'loyalist', p.x + 5, p.y, Math.PI), true), b = tough(addEnemy(sim, fs, 'loyalist', p.x + 9, p.y, Math.PI), true);
    fire(sim, p, 'sr4', b.x, b.y);
    expect(a.hp).toBeLessThan(1000);
    expect(b.hp).toBe(1000);
  });
});

describe('machine-gun suppression', () => {
  it('near misses pin an enemy; the pin wears off after ~1.5 s', () => {
    const { sim, fs, p } = setup();
    const e = tough(addEnemy(sim, fs, 'loyalist', p.x + 8, p.y + 1.2, Math.PI), true);
    for (let k = 0; k < 4; k++) fire(sim, p, 'lmg249', p.x + 8, p.y);
    expect(e.hp).toBe(1000); // never hit
    expect(e.pinT).toBeGreaterThan(PIN.max - 0.2);
    run(sim, PIN.max + 0.1);
    expect(e.pinT).toBeLessThanOrEqual(0);
    // a rifle doing the same pins nothing
    const s2 = setup(), e2 = tough(addEnemy(s2.sim, s2.fs, 'loyalist', s2.p.x + 8, s2.p.y + 1.2, Math.PI), true);
    fire(s2.sim, s2.p, 'sr4', s2.p.x + 8, s2.p.y);
    expect(e2.pinT).toBe(0);
  });
  it('pinned enemies shoot slower and miss more', () => {
    const duel = (pinned: boolean) => {
      const { sim, fs, p } = setup();
      p.cheats = { god: true };
      const e = tough(addEnemy(sim, fs, 'loyalist', p.x + 12, p.y, Math.PI), true);
      e.target = p.id; e.lastSeenT = 0;
      let shots = 0, hits = 0;
      run(sim, 20, () => {
        if (pinned) e.pinT = 1.5;
        e.x = p.x + 12; e.y = p.y; // hold position so only the pin differs
        for (const v of sim.drainEvents() as any[]) if (v.e === 'shot' && v.src === 'e') { shots++; if (v.hit === 'flesh') hits++; }
      });
      return { shots, rate: hits / shots };
    };
    const free = duel(false), pin = duel(true);
    expect(pin.shots).toBeLessThan(free.shots * 0.8);
    expect(pin.rate).toBeLessThan(free.rate * 0.75);
  });
});
