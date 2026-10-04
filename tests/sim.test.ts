import { describe, it, expect } from 'vitest';
import { setup, addEnemy, run } from './helpers';
import { Sim } from '../src/sim/sim';
import { weapon } from '../src/config/weapons';
import { idx, S_LOW, S_TALL } from '../src/gen/floor';
import { FINAL_FLOOR } from '../src/config/difficulty';
import { enemyDrops, damagePlayer } from '../src/sim/combat';
import { Rng } from '../src/core/rng';
import { WALK_SPEED, SPRINT_SPEED, CROUCH_SPEED } from '../src/sim/player';

describe('player movement', () => {
  it('walk / sprint / crouch speeds and wall collision', () => {
    const { sim, p } = setup();
    p.input.mx = 1;
    run(sim, 1);
    const x1 = p.x;
    run(sim, 1);
    const walk = p.x - x1;
    expect(walk).toBeGreaterThan(WALK_SPEED * 0.85);
    expect(walk).toBeLessThan(WALK_SPEED * 1.05 * 0.95 + 0.4);
    p.input.sprint = true;
    run(sim, 0.5);
    const x2 = p.x; run(sim, 1);
    expect(p.x - x2).toBeGreaterThan(SPRINT_SPEED * 0.8);
    p.input.sprint = false; p.input.crouch = true;
    run(sim, 0.5);
    const x3 = p.x; run(sim, 1);
    expect(p.x - x3).toBeLessThan(CROUCH_SPEED * 1.1);
    // runs into east wall and stops
    p.input.crouch = false; p.input.sprint = true;
    run(sim, 20);
    expect(p.x).toBeLessThan(63 - 0.29);
  });
  it('injury slows by 25% until a health kit is used', () => {
    const { sim, p } = setup();
    damagePlayer(sim, p, 200, 1, 'fire'); // fire ignores armour -> but kills? use smaller
    expect(p.life === 'out' || p.hp <= 0).toBe(true);
    const s2 = setup();
    damagePlayer(s2.sim, s2.p, 40, 1, 'fire');
    expect(s2.p.injured).toBe(true);
    s2.p.input.mx = 1;
    run(s2.sim, 1); const a = s2.p.x; run(s2.sim, 1);
    const injured = s2.p.x - a;
    expect(injured).toBeLessThan(WALK_SPEED * 0.8);
    const kits = s2.p.items.medkit;
    s2.p.input.medkit++;
    run(s2.sim, 0.1);
    expect(s2.p.injured).toBe(false);
    expect(s2.p.hp).toBe(100);
    expect(s2.p.items.medkit).toBe(kits - 1);
  });
  it('jumping vaults low cover but not tall cover', () => {
    const { sim, fs, p } = setup();
    for (let y = 1; y < 47; y++) fs.L.solid[idx(12, y)] = S_LOW;
    p.input.mx = 1;
    run(sim, 2);
    expect(p.x).toBeLessThan(12); // blocked
    p.input.jump++;
    run(sim, 1.2);
    expect(p.x).toBeGreaterThan(13);
    for (let y = 1; y < 47; y++) fs.L.solid[idx(18, y)] = S_TALL;
    p.input.jump++;
    run(sim, 3);
    expect(p.x).toBeLessThan(18);
  });
});

describe('weapons', () => {
  it('an emptied mag auto-reloads in 0.33s; a manual reload keeps the weapon reload time', () => {
    const { sim, p } = setup();
    const w = weapon('sr4');
    p.weapons.primary!.mag = 0;
    run(sim, 0.4);
    expect(p.weapons.primary!.mag).toBe(w.mag);
    p.weapons.primary!.mag = 5;
    p.input.reload++;
    run(sim, 0.4);
    expect(p.weapons.primary!.mag).toBe(5);
    run(sim, w.reload);
    expect(p.weapons.primary!.mag).toBe(w.mag);
  });

  it('fires, spends ammo, reloads from reserve, dry-fires, knife fallback', () => {
    const { sim, p } = setup();
    const w = weapon('sr4');
    p.input.ax = p.x + 5; p.input.ay = p.y;
    p.input.fire = true;
    run(sim, 0.5);
    const mag = p.weapons.primary!.mag;
    expect(mag).toBeLessThan(w.mag);
    expect(mag).toBeGreaterThan(w.mag - 8);
    p.input.fire = false;
    const reserve = p.ammo.rifle;
    p.input.reload++;
    run(sim, w.reload + 0.2);
    expect(p.weapons.primary!.mag).toBe(w.mag);
    expect(p.ammo.rifle).toBe(reserve - (w.mag - mag));
    // empty everything
    p.ammo.rifle = 0; p.weapons.primary!.mag = 0;
    const evs: string[] = [];
    p.input.fire = true;
    for (let i = 0; i < 10; i++) { sim.tick(1 / 30); evs.push(...sim.drainEvents().map((e) => e.e)); }
    expect(evs).toContain('dry');
    p.input.fire = false; sim.tick(1 / 30);
    // knife always available
    const e = addEnemy(sim, sim.floorState(5), 'loyalist', p.x + 1.2, p.y, 0);
    p.input.slot = 2; p.input.slotSeq++;
    run(sim, 0.5);
    expect(p.sel).toBe('knife');
    p.input.fire = true; sim.tick(1 / 30); p.input.fire = false;
    run(sim, 0.1);
    // backstab: enemy faces away (+x) and is unaware -> instant kill
    expect(e.state).toBe('dead');
  });
  it('armour absorbs and degrades', () => {
    const { sim, p } = setup();
    expect(p.armor).toBe(100);
    damagePlayer(sim, p, 30, 0.5, 'bullet');
    expect(p.armor).toBeLessThan(100);
    expect(p.hp).toBeGreaterThan(100 - 30);
    const a1 = p.armor;
    for (let i = 0; i < 6; i++) damagePlayer(sim, p, 10, 0.5, 'bullet');
    expect(p.armor).toBeLessThan(a1);
    // no armour -> full damage
    const s = setup(); s.p.armor = 0;
    damagePlayer(s.sim, s.p, 30, 0.5, 'bullet');
    expect(s.p.hp).toBe(70);
  });
  it('player bullets kill enemies and bodies are lootable with weapon swap', () => {
    const { sim, fs, p } = setup();
    const e = addEnemy(sim, fs, 'loyalist', p.x + 6, p.y, Math.PI, 'k45');
    e.state = 'idle';
    p.input.ax = e.x; p.input.ay = e.y; p.input.aim = true; p.input.fire = true;
    run(sim, 2);
    p.input.fire = false;
    expect(e.state).toBe('dead');
    const body = fs.containers.find((c) => c.kind === 'corpse')!;
    expect(body).toBeTruthy();
    expect(body.items.some((i) => i.k === 'weapon' && i.id === 'k45')).toBe(true);
    // walk to body and search, then hold to swap
    p.x = body.x - 0.8; p.y = body.y; p.input.ax = body.x + 1; p.input.ay = body.y;
    p.input.interact = true; sim.tick(1 / 30); p.input.interact = false; sim.tick(1 / 30);
    p.input.interact = true; run(sim, 1); p.input.interact = false; sim.tick(1 / 30);
    expect(p.weapons.primary!.id).toBe('k45');
    expect(body.items.some((i) => i.k === 'weapon' && i.id === 'sr4')).toBe(true);
  });
  it('cyborgs drop a battery ~5% of the time', () => {
    const rng = new Rng(7);
    const { sim, fs } = setup();
    let n = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const e = addEnemy(sim, fs, 'cyborg', 5, 5);
      fs.enemies.pop();
      if (enemyDrops(rng, e, 1).some((d) => d.k === 'item' && d.item === 'battery')) n++;
    }
    expect(n / N).toBeGreaterThan(0.04);
    expect(n / N).toBeLessThan(0.06);
  });
});

describe('stealth and AI', () => {
  it('lit player is detected faster than dark; crouch slows detection', () => {
    const t = (dark: number, crouch: boolean) => {
      const { sim, fs, p } = setup('single', 1, 5, dark);
      const e = addEnemy(sim, fs, 'loyalist', p.x + 8, p.y, Math.PI);
      p.input.crouch = crouch; p.input.ax = p.x - 3; p.input.ay = p.y;
      let time = 0;
      while (e.state !== 'alert' && time < 30) { sim.tick(1 / 30); time += 1 / 30; }
      return time;
    };
    const lit = t(0, false), dark = t(0.9, false), crouchLit = t(0, true);
    expect(lit).toBeLessThan(dark);
    expect(crouchLit).toBeGreaterThan(lit);
  });
  it('torch makes you visible in the dark', () => {
    const tt = (torch: boolean) => {
      const { sim, fs, p } = setup('single', 1, 150, 0.9);
      const e = addEnemy(sim, fs, 'loyalist', p.x + 9, p.y, Math.PI);
      p.torchOn = torch; p.input.ax = e.x; p.input.ay = e.y;
      let time = 0;
      while (e.state !== 'alert' && time < 30) { sim.tick(1 / 30); time += 1 / 30; }
      return time;
    };
    expect(tt(true)).toBeLessThan(tt(false));
  });
  it('sprint noise draws investigation; crouch walking does not', () => {
    const go = (sprint: boolean, crouch: boolean) => {
      const { sim, fs, p } = setup();
      const e = addEnemy(sim, fs, 'loyalist', p.x + 8, p.y + 6, Math.PI / 2); // facing away (south)
      p.input.mx = 0; p.input.my = -1; p.input.sprint = sprint; p.input.crouch = crouch;
      p.y = 30; e.y = 36; e.x = p.x + 3; e.facing = Math.PI / 2;
      p.input.my = 1; p.input.mx = 0.01;
      // move back and forth near enemy without entering its view
      let reacted = false;
      for (let i = 0; i < 90; i++) {
        p.input.my = i % 30 < 15 ? 1 : -1;
        sim.tick(1 / 30);
        if (e.state !== 'guard') reacted = true;
      }
      return reacted;
    };
    expect(go(true, false)).toBe(true);
    expect(go(false, true)).toBe(false);
  });
  it('gunfire alerts nearby enemies to search', () => {
    const { sim, fs, p } = setup();
    const e = addEnemy(sim, fs, 'loyalist', p.x + 10, p.y + 10, Math.PI / 2);
    p.input.ax = p.x - 5; p.input.ay = p.y; p.input.fire = true;
    run(sim, 0.3);
    expect(['search', 'investigate', 'alert', 'suspicious']).toContain(e.state);
  });
  it('CCTV spot -> networked enemies converge, human loyalists do not', () => {
    const { sim, fs, p } = setup();
    fs.cameras.push({ id: 9, x: p.x + 5, y: p.y, baseAngle: Math.PI, sweep: 0, speed: 0, phase: 0, range: 10, fov: 0.3, angle: Math.PI, alive: true, detect: 0, alarmT: 0, hp: 1 });
    const cy = addEnemy(sim, fs, 'cyborg', 50, 40, 0);
    const hu = addEnemy(sim, fs, 'loyalist', 50, 30, 0);
    run(sim, 2);
    expect(cy.state).toBe('alert');
    expect(hu.state).toBe('guard');
    const d0 = Math.hypot(cy.x - p.x, cy.y - p.y);
    run(sim, 3);
    expect(Math.hypot(cy.x - p.x, cy.y - p.y)).toBeLessThan(d0 - 3);
  });
  it('shooting a camera disables it and alerts the AI network to the shooter', () => {
    const { sim, fs, p } = setup();
    fs.cameras.push({ id: 9, x: p.x + 6, y: p.y - 4, baseAngle: -Math.PI / 2, sweep: 0, speed: 0, phase: 0, range: 3, fov: 0.2, angle: -Math.PI / 2, alive: true, detect: 0, alarmT: 0, hp: 1 });
    const cy = addEnemy(sim, fs, 'dogcyborg', 55, 40, 0);
    const hu = addEnemy(sim, fs, 'loyalist', 55, 30, 0);
    const dog = addEnemy(sim, fs, 'dog', 55, 20, 0);
    p.input.ax = p.x + 6; p.input.ay = p.y - 4; p.input.aim = true; p.input.fire = true;
    sim.tick(1 / 30); p.input.fire = false;
    run(sim, 0.5);
    expect(fs.cameras[0].alive).toBe(false);
    expect(['search', 'alert']).toContain(cy.state);
    expect(cy.interestX).toBeCloseTo(10, 0);
    // humans and plain dogs aren't on the network (too far to hear the shot)
    expect(hu.state).toBe('guard');
    expect(dog.state).toBe('guard');
  });
  it('alerted enemies shoot the player and flashbang blinds them', () => {
    const { sim, fs, p } = setup();
    const e = addEnemy(sim, fs, 'loyalist', p.x + 7, p.y, Math.PI);
    run(sim, 4);
    expect(e.state).toBe('alert');
    expect(p.hp + p.armor).toBeLessThan(200);
    expect(p.life).toBe('alive');
    p.hp = 1e6;
    p.grenadeSel = 'flash';
    p.input.ax = e.x - 1; p.input.ay = e.y; p.input.grenade++;
    run(sim, 1.6);
    expect(e.flashT).toBeGreaterThan(0.5);
  });
  it('dogs close distance fast and bite', () => {
    const { sim, fs, p } = setup();
    const d = addEnemy(sim, fs, 'dog', p.x + 9, p.y, Math.PI);
    run(sim, 6);
    expect(Math.hypot(d.x - p.x, d.y - p.y)).toBeLessThan(2.5);
    expect(p.hp + p.armor).toBeLessThan(200);
  });
});

describe('items, torch, vending', () => {
  it('torch drains battery and battery refills', () => {
    const { sim, p } = setup();
    p.input.torch++;
    run(sim, 60);
    expect(p.torchOn).toBe(true);
    expect(p.battery).toBeLessThan(0.8);
    expect(p.battery).toBeGreaterThan(0.7);
    p.battery = 0.001;
    run(sim, 1);
    expect(p.torchOn).toBe(false);
    p.input.battery++;
    run(sim, 0.1);
    expect(p.battery).toBe(1);
    expect(p.items.battery).toBe(0);
  });
  it('vending machine breaks into drinks/snacks; drink boosts speed 60s; food heals', () => {
    const { sim, fs, p } = setup();
    fs.vendings.push({ id: 77, x: p.x + 1.2, y: p.y, rot: 1, hp: 45, broken: false, drops: [{ k: 'item', item: 'drink', n: 1 }, { k: 'item', item: 'food', n: 1 }] });
    fs.L.solid[idx(11, 10)] = S_TALL;
    p.input.ax = p.x + 3; p.input.ay = p.y;
    p.input.interact = true; run(sim, 2.2); p.input.interact = false; sim.tick(1 / 30);
    expect(fs.vendings[0].broken).toBe(true);
    const spill = fs.containers.find((c) => c.kind === 'drop')!;
    p.x = spill.x - 0.5; p.y = spill.y;
    p.input.interact = true; sim.tick(1 / 30); p.input.interact = false; sim.tick(1 / 30);
    expect(p.items.drink).toBe(1);
    expect(p.items.food).toBe(1);
    p.itemSel = 'drink'; p.input.use++; sim.tick(1 / 30);
    expect(p.boostT).toBeGreaterThan(59);
    p.input.mx = -1; run(sim, 1); const a = p.x; run(sim, 1);
    expect(a - p.x).toBeGreaterThan(3.3 * 1.2);
    run(sim, 60);
    expect(p.boostT).toBeLessThanOrEqual(0);
    p.hp = 50; p.itemSel = 'food'; p.input.use++; sim.tick(1 / 30);
    expect(p.hp).toBe(75);
  });
  it('tripwires trigger when walked through and are cleared by jumping', () => {
    const mk = (jump: boolean) => {
      const { sim, fs, p } = setup();
      fs.traps.push({ id: 5, kind: 'tripwire', x: 13.5, y: 5, x2: 13.5, y2: 15, armed: true, revealed: false, fuse: 0 });
      p.x = 12.4; p.vx = 3.3; p.input.mx = 1;
      if (jump) p.input.jump++;
      run(sim, 0.8);
      return fs.traps[0].armed;
    };
    expect(mk(false)).toBe(false);
    expect(mk(true)).toBe(true);
  });
});

describe('traversal, life rules, objective', () => {
  it('stairs respect blocked flights; elevators travel at most 5 floors', () => {
    const sim = new Sim({ seed: 3, difficulty: 'normal', mode: 'single' });
    const p = sim.addPlayer(1, 'A', { primary: null, secondary: 'p9', armor: 'none', grenades: {}, items: {}, mods: { bypass: false, torchmod: false, pouch: false } });
    sim.travel(p, 10, 'stair0', 'test');
    expect(p.floor).toBe(10);
    let ok = false;
    for (let i = 0; i < 3; i++) {
      const c = sim.flightCondition(10, i);
      if (c === 'clear' || c === 'damaged') { sim.takeStairs(p, i, 1); ok = true; break; }
    }
    if (ok) expect(p.floor).toBe(11);
    // elevator
    for (let f = 1; f < 199; f++) {
      const st = sim.plan.elevator(f, 0);
      if (!st.working) continue;
      sim.travel(p, f, 'elev0', 'test');
      const to = st.destinations[st.destinations.length - 1];
      sim.startRide(p, 0, to);
      for (let i = 0; i < 100; i++) sim.tick(1 / 30);
      expect(p.floor).toBe(to);
      expect(Math.abs(to - f)).toBeLessThanOrEqual(5);
      break;
    }
  });
  it('single player death ends the run', () => {
    const { sim, p } = setup('single');
    p.armor = 0;
    damagePlayer(sim, p, 150, 1, 'bullet');
    sim.tick(1 / 30);
    expect(p.life).toBe('out');
    expect(sim.phase).toBe('lost');
  });
  it('coop: downed player revivable for 60s with a health kit (consumed); expiry eliminates', () => {
    const { sim, ps } = setup('coop', 3);
    const [a, b, c] = ps;
    a.armor = 0;
    damagePlayer(sim, a, 200, 1, 'bullet');
    expect(a.life).toBe('down');
    run(sim, 10);
    expect(a.downT).toBeLessThan(51);
    b.x = a.x + 0.8; b.y = a.y; b.input.ax = a.x; b.input.ay = a.y;
    const kits = b.items.medkit;
    b.input.interact = true; run(sim, 3.3); b.input.interact = false;
    expect(a.life).toBe('alive');
    expect(b.items.medkit).toBe(kits - 1);
    // without kit -> cannot revive
    c.armor = 0; damagePlayer(sim, c, 200, 1, 'bullet');
    b.items.medkit = 0; b.x = c.x + 0.8; b.y = c.y; b.input.ax = c.x; b.input.ay = c.y;
    b.input.interact = true; run(sim, 4); b.input.interact = false;
    expect(c.life).toBe('down');
    run(sim, 57);
    expect(c.life).toBe('out');
    expect(sim.phase).toBe('playing');
    // squad wipe
    a.armor = 0; b.armor = 0;
    damagePlayer(sim, a, 200, 1, 'bullet'); damagePlayer(sim, b, 200, 1, 'bullet');
    sim.tick(1 / 30);
    expect(sim.phase).toBe('lost');
  });
  it('floor 200 upload -> 60s wave -> victory if someone lives', () => {
    const sim = new Sim({ seed: 8, difficulty: 'normal', mode: 'coop' });
    const lo = { primary: 'sr4', secondary: 'p9', armor: 'vesthelm' as const, grenades: {}, items: {}, mods: { bypass: false, torchmod: false, pouch: false } };
    const a = sim.addPlayer(1, 'A', lo);
    sim.travel(a, FINAL_FLOOR, 'stair0', 'test');
    const fs = sim.floorState(FINAL_FLOOR);
    for (const e of fs.enemies) e.state = 'dead';
    const m = fs.L.mainframe!;
    a.x = m.termX; a.y = m.termY + 0.9;
    a.input.ax = m.termX; a.input.ay = m.termY;
    a.input.interact = true; run(sim, 3.3); a.input.interact = false;
    expect(sim.objective.uploadStarted).toBe(true);
    // god mode to observe the timer
    let spawned = 0;
    run(sim, 62, () => { a.hp = 1e6; a.armor = 100; spawned = Math.max(spawned, fs.wave?.spawned ?? 0); });
    expect(spawned).toBeGreaterThan(5);
    expect(sim.phase).toBe('won');
  });
  it('save/resume round-trips the single-player run', () => {
    const { sim, p } = setup();
    p.items.medkit = 3; p.kills = 4;
    const s = sim.exportSave(p);
    const r = Sim.fromSave(JSON.parse(JSON.stringify(s)), 1);
    expect(r.players[0].items.medkit).toBe(3);
    expect(r.players[0].floor).toBe(s.floor);
    expect(r.cfg.seed).toBe(sim.cfg.seed);
  });
});

describe('performance', () => {
  it('simulates a dense high floor with 5 players under budget', () => {
    const sim = new Sim({ seed: 99, difficulty: 'insane', mode: 'coop' });
    const lo = { primary: 'sr4', secondary: 'p9', armor: 'vesthelm' as const, grenades: {}, items: {}, mods: { bypass: false, torchmod: false, pouch: false } };
    for (let i = 0; i < 5; i++) { const p = sim.addPlayer(i + 1, 'P' + i, lo); sim.travel(p, 160, 'stair' + (i % 3), 't'); }
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) {
      for (const p of sim.players) { p.input.mx = Math.sin(i / 20 + p.id); p.input.my = Math.cos(i / 25); p.hp = 100; }
      sim.tick(1 / 30);
    }
    const per = (performance.now() - t0) / 300;
    console.log('ms per tick', per.toFixed(3), 'enemies', sim.floorState(160).enemies.length);
    expect(per).toBeLessThan(6);
  });
});
