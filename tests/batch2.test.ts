import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { emptyLoadout } from '../src/ui/shop';
import { stairAt } from '../src/sim/stairs';
import { makeSquad } from '../src/sim/bot';
import { stairPassable } from '../src/gen/building';
/** a stairwell whose flight from floor f up to f+1 can be used */
const openFlight = (sim: Sim, f: number) => { for (let i = 0; i < 4; i++) if (sim.floorState(f).L.stairs[i] && stairPassable(sim.flightCondition(f, i))) return i; throw new Error('no open flight'); };

const solo = (seed = 3) => {
  const sim = new Sim({ seed, difficulty: 'normal', mode: 'single' });
  const me = sim.addPlayer(1, 'Op', emptyLoadout()); me.checkedIn = true;
  return { sim, me };
};

describe('stair arrival', () => {
  it('going up: you arrive at the bottom of the down flight on the floor above (the steps you just climbed)', () => {
    const { sim, me } = solo();
    const i = openFlight(sim, 4);
    sim.travel(me, 4, 'stair' + i, 'debug');
    sim.takeStairs(me, i, 1);
    expect(me.floor).toBe(5);
    const st = stairAt(sim.floorState(5).L, me.x, me.y);
    expect(st?.dir).toBe(-1);
    expect(st!.t).toBeGreaterThan(0.6);
  });
  it('going down: you arrive at the top of the up flight on the floor below', () => {
    const { sim, me } = solo();
    const i = openFlight(sim, 5);
    sim.travel(me, 6, 'stair' + i, 'debug');
    sim.takeStairs(me, i, -1);
    expect(me.floor).toBe(5);
    const st = stairAt(sim.floorState(5).L, me.x, me.y);
    expect(st?.dir).toBe(1);
    expect(st!.t).toBeGreaterThan(0.6);
  });
  it('the squad arrives on the same stairwell, near you', () => {
    const { sim, me } = solo();
    const bots = makeSquad(3, ['rifleman', 'medic']).map((i) => sim.addBot(i));
    const i = openFlight(sim, 4);
    sim.travel(me, 4, 'stair' + i, 'debug');
    sim.takeStairs(me, i, 1);
    for (const b of bots) expect(Math.hypot(b.x - me.x, b.y - me.y)).toBeLessThan(5);
  });
});

describe('lifts', () => {
  it('when you stand in a lift car, the squad walks in after you', () => {
    const { sim, me } = solo(9);
    const bots = makeSquad(9, ['rifleman', 'medic', 'gunner']).map((i) => sim.addBot(i));
    sim.travel(me, 3, 'stair0', 'debug');
    for (const e of sim.floorState(3).enemies) { e.state = 'dead'; e.hp = 0; }
    const e = sim.floorState(3).L.elevators[0];
    me.x = e.cx; me.y = e.cy;
    for (const b of bots) { b.x = e.doorX + (e.doorX - e.cx) * 2; b.y = e.doorY + (e.doorY - e.cy) * 2; }
    for (let i = 0; i < 8 * 60; i++) { me.x = e.cx; me.y = e.cy; sim.tick(1 / 60); }
    const inCar = (x: number, y: number) => x >= e.x0 && x <= e.x1 + 1 && y >= e.y0 && y <= e.y1 + 1;
    for (const b of bots) expect(inCar(b.x, b.y), `${b.name} at ${b.x.toFixed(1)},${b.y.toFixed(1)}`).toBe(true);
  });
  it('bots riding along arrive once (one chime)', () => {
    const { sim, me } = solo(9);
    const bots = makeSquad(9, ['rifleman']).map((i) => sim.addBot(i));
    sim.travel(me, 3, 'stair0', 'debug');
    const e = sim.floorState(3).L.elevators[0];
    me.x = e.cx; me.y = e.cy; bots[0].x = e.cx + 0.4; bots[0].y = e.cy;
    sim.startRide(me, 0, 4);
    sim.drainEvents();
    let dings = 0;
    for (let i = 0; i < 4 * 60; i++) { sim.tick(1 / 60); dings += sim.drainEvents().filter((ev) => ev.e === 'elev' && (ev as any).k === 'ding').length; }
    expect(me.floor).toBe(4);
    expect(bots[0].floor).toBe(4);
    expect(dings).toBe(1);
  });
});

import { HackGame, Keypad } from '../src/ui/hackgame';
describe('keypad puzzle', () => {
  it('marks each digit like Wordle: right place, in the code elsewhere, or not in it', () => {
    expect(Keypad.score('1123', '3111').marks).toEqual(['near', 'hit', 'miss', 'near']);
    expect(Keypad.score('5555', '1235').marks).toEqual(['miss', 'miss', 'miss', 'hit']);
    expect(Keypad.score('2513', '1235').marks).toEqual(['near', 'near', 'near', 'near']);
  });
  it('the trace fills 40% slower on the keypad stage', () => {
    const g = new HackGame(60, 'security', 7, ['keypad']);
    g.tick(2.5); // the proxy bounce (no trace)
    const t0 = g.trace;
    g.tick(5);
    expect(g.trace - t0).toBeCloseTo((5 / g.traceTime) * 0.6, 5);
  });
});

import { setDoor } from '../src/sim/combat';
import { isWalkableTile } from '../src/gen/floor';
describe('bots and doors', () => {
  /** a door with open floor 1.5 m either side; returns the two sides */
  const doorSetup = (seed: number) => {
    const { sim, me } = solo(seed);
    const [info] = makeSquad(seed, ['rifleman']);
    const b = sim.addBot(info);
    for (let f = 1; f < 12; f++) {
      sim.travel(me, f, 'stair0', 'debug');
      const fs = sim.floorState(f);
      for (let i = 0; i < fs.L.doors.length; i++) {
        const d = fs.L.doors[i];
        if (d.tiles.length !== 1 || fs.doors[i].state === 'locked') continue;
        for (const [dx, dy] of [[1.6, 0], [0, 1.6]]) {
          const A = { x: d.x - dx, y: d.y - dy }, B = { x: d.x + dx, y: d.y + dy };
          if (isWalkableTile(fs.L, Math.floor(A.x), Math.floor(A.y)) && isWalkableTile(fs.L, Math.floor(B.x), Math.floor(B.y))) {
            for (const e of fs.enemies) { e.state = 'dead'; e.hp = 0; }
            return { sim, me, b, fs, i, A, B };
          }
        }
      }
    }
    throw new Error('no usable door');
  };
  it('a door you closed stays closed: bots never open it', () => {
    const { sim, me, b, fs, i, A, B } = doorSetup(5);
    setDoor(sim, fs, i, 'closed', 2, me); // you touched it
    const far = { x: B.x + (B.x - A.x) * 2, y: B.y + (B.y - A.y) * 2 };
    const goal = isWalkableTile(fs.L, Math.floor(far.x), Math.floor(far.y)) ? far : B;
    b.x = A.x; b.y = A.y;
    let opened = false;
    for (let t = 0; t < 6 * 60; t++) { me.x = goal.x; me.y = goal.y; sim.tick(1 / 60); if (fs.doors[i].state !== 'closed') opened = true; }
    expect(opened).toBe(false);
  });
  it('a door you never touched: a bot opens it to pass, then closes it behind it', () => {
    const { sim, me, b, fs, i, A, B } = doorSetup(5);
    fs.doors[i].state = 'closed';
    setDoor(sim, fs, i, 'closed', 0, null); // closed by nobody
    const far = { x: B.x + (B.x - A.x) * 2, y: B.y + (B.y - A.y) * 2 };
    const goal = isWalkableTile(fs.L, Math.floor(far.x), Math.floor(far.y)) ? far : B;
    b.x = A.x; b.y = A.y;
    let opened = false;
    for (let t = 0; t < 10 * 60; t++) { me.x = goal.x; me.y = goal.y; sim.tick(1 / 60); if ((fs.doors[i].state as string) === 'open') opened = true; }
    expect(opened).toBe(true);
    expect(fs.doors[i].state).toBe('closed');
  });
});

describe('enemies scale with squad size', () => {
  const run = (mode: 'single' | 'coop', extra: number) => {
    const sim = new Sim({ seed: 17, difficulty: 'normal', mode });
    sim.addPlayer(1, 'Op', emptyLoadout());
    if (mode === 'single') makeSquad(17, Array(extra).fill('rifleman')).forEach((i) => sim.addBot(i));
    else for (let k = 0; k < extra; k++) sim.addPlayer(2 + k, `P${k}`, emptyLoadout());
    return sim;
  };
  const alive = (sim: Sim, f: number) => sim.floorState(f).enemies.filter((e) => e.state !== 'dead');
  it('each squadmate adds 15% enemies, 20% health, 10% damage and 5% accuracy/alertness', () => {
    const base = run('single', 0), four = run('single', 4);
    const n0 = alive(base, 8).length, n4 = alive(four, 8).length;
    expect(n4).toBe(n0 + Math.round(n0 * 0.6));
    const e0 = base.floorState(8).enemies[0], e4 = four.floorState(8).enemies[0];
    expect(e4.maxHp).toBeCloseTo(e0.maxHp * 1.8, 0);
    expect(four.pressure(8).damage).toBeCloseTo(base.pressure(8).damage * 1.4, 5);
    expect(four.pressure(8).accuracy).toBeCloseTo(base.pressure(8).accuracy * 1.2, 5);
    expect(four.pressure(8).perception).toBeCloseTo(base.pressure(8).perception * 1.2, 5);
  });
  it('co-op players count the same way (this is what the dedicated server runs)', () => {
    const base = run('coop', 0), three = run('coop', 2);
    expect(alive(three, 8).length).toBe(alive(base, 8).length + Math.round(alive(base, 8).length * 0.3));
    expect(three.pressure(8).damage).toBeCloseTo(base.pressure(8).damage * 1.2, 5);
  });
  it('squad size never drops mid-run (a bot dying does not make later floors easier)', () => {
    const four = run('single', 4);
    const me = four.human()!;
    four.travel(me, 3, 'stair0', 'debug');
    const bot = four.players.find((p) => p.bot)!;
    four.playerDies(bot); four.playerOut(bot);
    expect(four.pressure(9).damage).toBeCloseTo(run('single', 4).pressure(9).damage, 5);
  });
});

import { keypadCode } from '../src/sim/hack';
import { gather } from '../src/sim/interact';
describe('keypad code note', () => {
  it("each floor has one fixed keypad code: 4 digits, no repeats below the top floors", () => {
    expect(keypadCode(5, 30)).toBe(keypadCode(5, 30));
    expect(keypadCode(5, 30)).toMatch(/^\d{4}$/);
    expect(new Set(keypadCode(5, 30)).size).toBe(4);
    expect(keypadCode(5, 30)).not.toBe(keypadCode(5, 31));
  });
  it('exactly one desk on a floor holds the note with that code; searching it reveals the code to the squad', () => {
    const { sim, me } = solo(4);
    sim.travel(me, 12, 'stair0', 'debug');
    const fs = sim.floorState(12);
    const notes = fs.containers.filter((c) => c.items.some((i) => i.k === 'note'));
    expect(notes).toHaveLength(1);
    expect(notes[0].kind).toBe('desk');
    expect(notes[0].items.find((i) => i.k === 'note')).toMatchObject({ f: 12, code: keypadCode(sim.cfg.seed, 12) });
    expect(sim.codesFound.has(12)).toBe(false);
    me.x = notes[0].x; me.y = notes[0].y;
    const act = gather(sim, me, fs).find((a) => a.key === 'c' + notes[0].id);
    act!.act();
    expect(sim.codesFound.has(12)).toBe(true);
  });
  it("the keypad puzzle uses the floor's code until a lockout rolls a new one", () => {
    const code = keypadCode(5, 40);
    const g = new HackGame(40, 'security', 3, ['keypad'], code);
    const kp = g.p.keypad!;
    expect(kp.code).toBe(code);
    for (let i = 0; i < 8; i++) { for (const d of code === '0000' ? '1111' : '0000') kp.press(+d); kp.enter(); }
    expect(kp.resets).toBe(1);
  });
});

describe('dropping a Health Kit', () => {
  const setup = () => {
    const { sim, me } = solo(6);
    const bots = makeSquad(6, ['rifleman', 'gunner']).map((i) => sim.addBot(i));
    sim.travel(me, 2, 'stair0', 'debug');
    for (const e of sim.floorState(2).enemies) { e.state = 'dead'; e.hp = 0; }
    return { sim, me, bots, fs: sim.floorState(2) };
  };
  it('drop (Q) puts one of your kits on the floor about a metre in front of you; none to drop, nothing happens', () => {
    const { sim, me, fs } = setup();
    me.items.medkit = 1;
    me.input.drop++; sim.tick(1 / 60);
    expect(me.items.medkit).toBe(0);
    expect(fs.pickups).toHaveLength(1);
    expect(Math.hypot(fs.pickups[0].x - me.x, fs.pickups[0].y - me.y)).toBeGreaterThan(0.6);
    me.input.drop++; sim.tick(1 / 60);
    expect(fs.pickups).toHaveLength(1);
  });
  it('walking onto it puts it back in your inventory', () => {
    const { sim, me, bots, fs } = setup();
    for (const b of bots) b.hp = 100;
    me.items.medkit = 1; me.input.drop++; sim.tick(1 / 60);
    const k = fs.pickups[0];
    me.x = k.x; me.y = k.y; sim.tick(1 / 60);
    expect(fs.pickups).toHaveLength(0);
    expect(me.items.medkit).toBe(1);
  });
  it('the lowest-health bot fetches it and uses it; healthy bots leave it alone', () => {
    const { sim, me, bots, fs } = setup();
    bots[0].hp = 70; bots[1].hp = 55; bots[1].items.medkit = 0; bots[0].items.medkit = 0;
    bots[0].cheats = { god: true }; bots[1].cheats = { god: true };
    me.items.medkit = 1; me.input.drop++; sim.tick(1 / 60);
    for (let i = 0; i < 8 * 60 && fs.pickups.length; i++) sim.tick(1 / 60);
    expect(fs.pickups).toHaveLength(0);
    expect(bots[1].hp).toBe(100);
    expect(bots[0].hp).toBe(70);
  });
});

import { DEFAULT_BINDINGS, BINDINGS_VERSION } from '../src/save/settings';
import { hotbarStep } from '../src/input/hotbar';
describe('Minecraft-style controls', () => {
  it('default keys', () => {
    expect(DEFAULT_BINDINGS).toMatchObject({
      sprint: 'ControlLeft', crouch: 'ShiftLeft', jump: 'Space', drop: 'KeyQ', swap: 'KeyF', use: 'KeyC', interact: 'KeyE', torch: 'KeyT',
      slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', item1: 'Digit4', item2: 'Digit5', item3: 'Digit6', item4: 'Digit7', item5: 'Digit8',
    });
    expect(BINDINGS_VERSION).toBe(3); // saved key settings reset once to the new defaults
    const codes = Object.values(DEFAULT_BINDINGS);
    expect(new Set(codes).size).toBe(codes.length); // no key does two things
  });
  it('the mouse wheel steps through hotbar 1-8, skipping empty weapon slots and wrapping', () => {
    const all = { primary: true, secondary: true };
    expect(hotbarStep(0, 1, all)).toBe(1);
    expect(hotbarStep(7, 1, all)).toBe(0);
    expect(hotbarStep(0, -1, all)).toBe(7);
    expect(hotbarStep(2, 1, all)).toBe(3); // knife -> first belt slot
    expect(hotbarStep(7, 1, { primary: false, secondary: true })).toBe(1); // no primary: skip slot 1
  });
});

import { PAD, grenadeButton } from '../src/input/hotbar';
describe('controller (Minecraft console style)', () => {
  it('button map', () => {
    expect(PAD).toEqual({ jump: 0, drop: 1, reload: 2, interact: 3, hotPrev: 4, hotNext: 5, aim: 6, fire: 7, ping: 8, pause: 9, sprint: 10, crouch: 11, torch: 12, use: 13, knife: 14, grenade: 15 });
  });
  it('D-pad right: a tap throws, a hold switches grenade type (once per 0.5 s held)', () => {
    let s = { t: 0, cycled: 0 };
    let r = grenadeButton(true, s, 0.1); s = r.s; expect(r.out).toBe(null);
    r = grenadeButton(false, s, 0.016); s = r.s; expect(r.out).toBe('throw');
    s = { t: 0, cycled: 0 };
    for (let i = 0; i < 30; i++) { r = grenadeButton(true, s, 0.02); s = r.s; if (i === 17) expect(r.out).toBe('cycle'); }
    r = grenadeButton(false, s, 0.016); expect(r.out).toBe(null); // releasing after a hold does not throw
  });
});

import { scopeClick } from '../src/input/hotbar';
describe('scope lock (Mac trackpad)', () => {
  it('a quick right-click locks the scope, the next quick one releases it; a long hold never locks', () => {
    let s = { latched: false, downAt: 0 };
    s = scopeClick(s, 'down', 1000); s = scopeClick(s, 'up', 1120); // two-finger tap
    expect(s.latched).toBe(true);
    s = scopeClick(s, 'down', 3000); s = scopeClick(s, 'up', 3100);
    expect(s.latched).toBe(false);
    s = scopeClick(s, 'down', 5000); s = scopeClick(s, 'up', 6500); // mouse: held to aim
    expect(s.latched).toBe(false);
  });
});

import { defaultBindings } from '../src/save/settings';
import { wheelIsZoom } from '../src/input/hotbar';
import { RefCache } from '../src/core/refcache';
import { doorClear } from '../src/sim/bot';
describe('review fixes', () => {
  it('browser defaults never put sprint or crouch on Ctrl (Ctrl+W closes the tab); the desktop app keeps Minecraft keys', () => {
    const web = defaultBindings(false), app = defaultBindings(true);
    expect(app.sprint).toBe('ControlLeft');
    expect([web.sprint, web.crouch]).not.toContain('ControlLeft');
    expect(web.sprint).toBe('ShiftLeft');
    for (const b of [web, app]) { const v = Object.values(b); expect(new Set(v).size).toBe(v.length); }
  });
  it('arriving on a flight never bounces you straight back: you must step off it first', () => {
    for (const seed of [3, 5, 8]) {
      const { sim, me } = solo(seed);
      const i = openFlight(sim, 4);
      sim.travel(me, 4, 'stair' + i, 'debug');
      sim.takeStairs(me, i, 1);
      me.input.crouch = true; me.input.my = -1; // keep walking north (deeper down the flight you arrived on)
      for (let t = 0; t < 4 * 60; t++) sim.tick(1 / 60);
      expect(me.floor, `seed ${seed}`).toBe(5);
    }
  });
  it('a mouse wheel step while Ctrl-sprinting steps the hotbar; a trackpad pinch still zooms', () => {
    expect(wheelIsZoom({ ctrlKey: true, metaKey: false, deltaY: 100 }, true)).toBe(false);
    expect(wheelIsZoom({ ctrlKey: true, metaKey: false, deltaY: 3.2 }, true)).toBe(true);
    expect(wheelIsZoom({ ctrlKey: true, metaKey: false, deltaY: 100 }, false)).toBe(true);
    expect(wheelIsZoom({ ctrlKey: false, metaKey: true, deltaY: 100 }, true)).toBe(true);
  });
  it('save and continue keeps the squad-size scaling even after a bot died', () => {
    const { sim, me } = solo(4);
    const bots = makeSquad(4, ['rifleman', 'medic']).map((i) => sim.addBot(i));
    sim.travel(me, 3, 'stair0', 'debug');
    sim.playerDies(bots[0]); sim.playerOut(bots[0]);
    const back = Sim.fromSave(JSON.parse(JSON.stringify(sim.exportSave(me))), 1);
    expect(back.squadPeak).toBe(3);
  });
  it('a bot closes a door only once the whole squad is through it (on its side, clear of the doorway)', () => {
    const d = { x: 10.5, y: 5.5, vertical: true }; // passage runs east-west through x = 10.5
    const bot = { x: 12.5, y: 5.5 };
    expect(doorClear(d, bot, [{ x: 13, y: 7 }, { x: 14, y: 4 }])).toBe(true);
    expect(doorClear(d, bot, [{ x: 6.5, y: 5.5 }])).toBe(false); // commander 4 m back on the other side
    expect(doorClear(d, bot, [{ x: 11.2, y: 5.5 }])).toBe(false); // someone in the doorway
    expect(doorClear(d, { x: 11.3, y: 5.5 }, [])).toBe(false); // the bot itself still in it
    const h = { x: 5.5, y: 8.5, vertical: false }; // passage runs north-south
    expect(doorClear(h, { x: 5.5, y: 6.5 }, [{ x: 5, y: 12 }])).toBe(false);
    expect(doorClear(h, { x: 5.5, y: 6.5 }, [{ x: 5, y: 5 }])).toBe(true);
  });
  it('poster textures are freed when no floor uses them any more', () => {
    const freed: string[] = [];
    const c = new RefCache<string, string>((k) => k.toUpperCase(), (_v, k) => freed.push(k));
    expect(c.take('a')).toBe('A'); c.take('a'); c.take('b');
    c.release('a'); expect(freed).toEqual([]);
    c.release('a'); c.release('b'); expect(freed).toEqual(['a', 'b']);
    expect(c.size).toBe(0);
  });
});
