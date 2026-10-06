import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { BuildingPlan } from '../src/gen/building';
import { generateFloor, clearFloorCache, FW, FH, idx, T_FLOOR, T_DOOR, S_NONE, STAIR_RECTS, ELEV_RECTS, setDoorSolid, FloorLayout, DoorSpec } from '../src/gen/floor';
import { FINAL_FLOOR } from '../src/config/difficulty';
import { setDoor } from '../src/sim/combat';
import { lineOfSight, findPath } from '../src/sim/nav';
import { movePlayer } from '../src/sim/player';
import { giveLoot } from '../src/sim/inventory';
import { ClientView } from '../src/net/client';
import { encodeSnapshot } from '../src/net/protocol';
import { emptyLoadout } from '../src/ui/shop';
import type { FloorState, PlayerState } from '../src/sim/state';
import { LOADOUT, setup, addEnemy, run } from './helpers';

/** Walkable areas, locked doors counting as walls (or not): reach(from, to) = within interaction reach of `to` from `from`'s area. */
function areas(L: FloorLayout, locks = true) {
  const locked = new Set(locks ? L.doors.filter((d) => d.init === 'locked').flatMap((d) => d.tiles) : []);
  const ok = (n: number) => (L.tiles[n] === T_FLOOR || L.tiles[n] === T_DOOR) && L.solid[n] === S_NONE && !locked.has(n);
  const lab = new Int16Array(FW * FH).fill(-1);
  for (let i = 0, a = 0; i < FW * FH; i++, a++) {
    if (lab[i] >= 0 || !ok(i)) continue;
    const st = [i]; lab[i] = a;
    while (st.length) { const c = st.pop()!; for (const n of [c + 1, c - 1, c + FW, c - FW]) if (n >= 0 && n < FW * FH && lab[n] < 0 && ok(n)) { lab[n] = a; st.push(n); } }
  }
  return (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const c = lab[idx(Math.floor(from.x), Math.floor(from.y))];
    for (let ty = Math.floor(to.y) - 2; ty <= Math.floor(to.y) + 2; ty++) for (let tx = Math.floor(to.x) - 2; tx <= Math.floor(to.x) + 2; tx++) if (c >= 0 && lab[idx(tx, ty)] === c && Math.hypot(tx + 0.5 - to.x, ty + 0.5 - to.y) < 1.6) return true;
    return false;
  };
}
const keysIn = (L: FloorLayout) => L.containers.filter((c) => c.items.some((i) => i.k === 'key'));
const sideOf = (d: DoorSpec, s: -1 | 1) => { const t = d.tiles[0] + s * (d.vertical ? 1 : FW); return { x: (t % FW) + 0.5, y: ((t / FW) | 0) + 0.5 }; };

/** A sim floor with a door whose both sides are open floor; enemies, cameras and traps cleared. */
function doorScene(mode: 'single' | 'coop' = 'single', players = 1) {
  const sim = new Sim({ seed: 42, difficulty: 'normal', mode });
  const ps: PlayerState[] = [];
  for (let i = 0; i < players; i++) ps.push(sim.addPlayer(i + 1, 'P' + (i + 1), JSON.parse(JSON.stringify(LOADOUT))));
  for (let f = 2; f < 40; f++) {
    const fs = sim.floorState(f);
    const i = fs.L.doors.findIndex((d) => d.tiles.length === 1 && [-1, 1].every((s) => { const q = sideOf(d, s as 1); return fs.L.solid[idx(Math.floor(q.x), Math.floor(q.y))] === S_NONE; }));
    if (i < 0) continue;
    fs.enemies = []; fs.cameras = []; fs.traps = []; fs.containers = []; fs.vendings = []; fs.scareT = 1e9;
    for (const p of ps) { p.floor = f; const a = sideOf(fs.L.doors[i], -1); p.x = a.x; p.y = a.y; }
    return { sim, fs, ps, p: ps[0], i, d: fs.L.doors[i] };
  }
  throw new Error('no door');
}
const tap = (sim: Sim, p: PlayerState) => { p.input.interact = true; sim.tick(1 / 30); p.input.interact = false; sim.tick(1 / 30); };
const msgs = (sim: Sim) => sim.drainEvents().filter((e) => e.e === 'msg').map((e: any) => e.text as string);

describe('door generation', () => {
  it('real doorways get doors (floors 1..199 only, never stairwell / lift doors), with a seeded open / closed / locked mix', () => {
    const plan = new BuildingPlan(1234, 'normal');
    const feature = new Set([...STAIR_RECTS, ...ELEV_RECTS].map((r) => idx(r.door[0], r.door[1])));
    const count = { open: 0, closed: 0, locked: 0 };
    let withDoors = 0;
    for (let f = 1; f <= 60; f++) {
      const L = generateFloor(plan, f);
      if (L.doors.length) withDoors++;
      for (const d of L.doors) {
        count[d.init]++;
        expect(d.tiles.length).toBeLessThanOrEqual(2);
        for (const t of d.tiles) { expect(L.tiles[t]).toBe(T_DOOR); expect(feature.has(t), `f${f} feature door`).toBe(false); expect(L.solid[t]).toBe(S_NONE); } // the layout keeps doors open
      }
    }
    expect(withDoors).toBeGreaterThan(55);
    const n = count.open + count.closed + count.locked;
    expect(count.open / n).toBeGreaterThan(0.3);
    expect(count.closed / n).toBeGreaterThan(0.25);
    expect(count.locked / n).toBeGreaterThan(0.05);
    expect(generateFloor(plan, 0).doors).toEqual([]);
    expect(generateFloor(plan, FINAL_FLOOR).doors).toEqual([]);
    clearFloorCache();
  }, 30000);

  it('locked doors never cut off stairs, lifts, hack terminals, the key, the street exit or a patrol route', () => {
    for (const seed of [7, 4242]) {
      const plan = new BuildingPlan(seed, 'hard');
      for (let f = 1; f <= 40; f++) {
        const L = generateFloor(plan, f);
        const lk = areas(L), open = areas(L, false), from = L.anchors.stair0;
        const need = [...L.stairs.map((s) => ({ x: s.doorX, y: s.doorY })), ...L.elevators.map((e) => ({ x: e.doorX, y: e.doorY })), ...L.hacks, ...keysIn(L), ...L.portals];
        for (const q of need) expect(lk(from, q), `seed ${seed} f${f} (${q.x},${q.y})`).toBe(true);
        for (const s of L.spawns) for (const r of s.route) if (open(s, r)) expect(lk(s, r), `seed ${seed} f${f} patrol`).toBe(true);
      }
      clearFloorCache();
    }
  }, 60000);

  it('exactly one master key per floor with doors: in the safe if there is one, else a desk drawer', () => {
    const plan = new BuildingPlan(555, 'normal');
    let inSafe = 0, inDesk = 0;
    for (let f = 1; f < 60; f++) {
      const L = generateFloor(plan, f);
      const keys = keysIn(L);
      if (!L.doors.length) { expect(keys.length).toBe(0); continue; }
      expect(keys.length, `f${f}`).toBe(1);
      expect(keys[0].items.filter((i) => i.k === 'key')).toEqual([{ k: 'key', f }]);
      if (L.containers.some((c) => c.kind === 'safe')) { expect(keys[0].kind).toBe('safe'); inSafe++; }
      else if (L.props.some((q) => q.kind === 'desk' || q.kind === 'cubicle')) { expect(keys[0].kind).toBe('desk'); inDesk++; }
    }
    expect(inSafe + inDesk).toBeGreaterThan(50);
    clearFloorCache();
  }, 30000);

  it('desks often hold a few coins; safes always do', () => {
    const plan = new BuildingPlan(31, 'normal');
    let desks = 0, coined = 0;
    for (let f = 1; f < 50; f++)
      for (const c of generateFloor(plan, f).containers) {
        const coin = c.items.find((i) => i.k === 'coin');
        if (c.kind === 'desk') { desks++; if (coin) { coined++; expect(coin.k === 'coin' && coin.n >= 1 && coin.n <= 3).toBe(true); } }
        if (c.kind === 'safe') expect(coin?.k === 'coin' && coin.n >= 3 && coin.n <= 6).toBe(true);
      }
    expect(coined / desks).toBeGreaterThan(0.35);
    expect(coined / desks).toBeLessThan(0.65);
    clearFloorCache();
  }, 30000);
});

describe('doors in play', () => {
  it('a shut door blocks walking and sight; an open one does not', () => {
    const { fs, p, i, d } = doorScene();
    const a = sideOf(d, -1), b = sideOf(d, 1);
    const walk = () => { p.x = a.x; p.y = a.y; p.vx = p.vy = 0; p.input.mx = b.x - a.x; p.input.my = b.y - a.y; for (let k = 0; k < 60; k++) movePlayer(p, fs.L, 1 / 60); p.input.mx = p.input.my = 0; return Math.hypot(p.x - a.x, p.y - a.y) > 1.5; };
    setDoor({ ai: { hear() {} } } as any, fs, i, 'closed', 0, null);
    expect(walk()).toBe(false);
    expect(lineOfSight(fs.L, a.x, a.y, b.x, b.y)).toBe(false);
    setDoor({ ai: { hear() {} } } as any, fs, i, 'open', 0, null);
    expect(walk()).toBe(true);
    expect(lineOfSight(fs.L, a.x, a.y, b.x, b.y)).toBe(true);
  });

  it('E opens and closes; closing is refused while someone stands in the doorway', () => {
    const { sim, fs, ps, i, d } = doorScene('coop', 2);
    const [p, q] = ps;
    fs.doors[i].state = 'closed'; setDoorSolid(fs.L, d, 'closed');
    q.x = 5; q.y = 5;
    tap(sim, p);
    expect(fs.doors[i].state).toBe('open');
    tap(sim, p);
    expect(fs.doors[i].state).toBe('closed');
    tap(sim, p);
    q.x = d.x; q.y = d.y; // teammate in the doorway
    msgs(sim);
    tap(sim, p);
    expect(fs.doors[i].state).toBe('open');
    expect(msgs(sim)).toContain('Something is in the doorway.');
  });

  it('locked: refused without the key; the key unlocks, holding locks it again', () => {
    const { sim, fs, p, i, d } = doorScene();
    fs.doors[i].state = 'locked'; setDoorSolid(fs.L, d, 'locked');
    msgs(sim);
    tap(sim, p);
    expect(fs.doors[i].state).toBe('locked');
    expect(msgs(sim)).toContain("Locked. The floor's master key opens it.");
    giveLoot(p, { k: 'key', f: p.floor + 1 }); // another floor's key is no use here
    tap(sim, p);
    expect(fs.doors[i].state).toBe('locked');
    giveLoot(p, { k: 'key', f: p.floor });
    tap(sim, p);
    expect(fs.doors[i].state).toBe('closed');
    tap(sim, p); // with the key a quick tap still just opens
    expect(fs.doors[i].state).toBe('open');
    p.input.interact = true; run(sim, 1); p.input.interact = false; sim.tick(1 / 30);
    expect(fs.doors[i].state).toBe('locked');
  });

  it('enemies path through a shut door and open it (others hear it), never through a locked one', () => {
    const { sim, fs, p } = setup();
    p.x = 55; p.y = 40;
    const L = fs.L;
    for (let y = 1; y < FH - 1; y++) L.tiles[idx(20, y)] = 2; // wall at x=20 ...
    L.tiles[idx(20, 10)] = T_DOOR; // ... with one door
    L.doors = [{ id: 1, tiles: [idx(20, 10)], vertical: true, x: 20.5, y: 10.5, init: 'closed' }];
    fs.doors = [{ id: 1, state: 'closed' }];
    setDoorSolid(L, L.doors[0], 'closed');
    expect(findPath(L, 15.5, 10.5, 25.5, 10.5)).toBeNull();
    expect(findPath(L, 15.5, 10.5, 25.5, 10.5, undefined, 3000, true)).not.toBeNull();
    const e = addEnemy(sim, fs, 'loyalist', 15.5, 10.5, Math.PI);
    e.homeX = 25.5; e.homeY = 10.5;
    const ear = addEnemy(sim, fs, 'loyalist', 22.5, 12.5, Math.PI / 2);
    let heard = 0;
    run(sim, 6, () => { heard = Math.max(heard, ear.aware); });
    expect(fs.doors[0].state).toBe('open');
    expect(e.x).toBeGreaterThan(22);
    expect(heard).toBeGreaterThan(0);
    expect(e.state).toBe('guard'); // the opener doesn't alarm itself
    fs.doors[0].state = 'locked'; setDoorSolid(L, L.doors[0], 'locked');
    expect(findPath(L, 15.5, 10.5, 25.5, 10.5, undefined, 3000, true)).toBeNull();
  });
});

describe('coins and vending machines', () => {
  function vendScene() {
    const s = setup();
    s.fs.vendings.push({ id: 77, x: s.p.x + 1.2, y: s.p.y, rot: 1, hp: 45, broken: false, drops: [{ k: 'item', item: 'drink', n: 2 }], price: 3 });
    s.fs.L.solid[idx(11, 10)] = 2;
    s.p.input.ax = s.p.x + 3; s.p.input.ay = s.p.y;
    s.p.items.drink = 0;
    const e = addEnemy(s.sim, s.fs, 'loyalist', s.p.x + 3, s.p.y + 3, Math.PI / 2 * 3); // close by, looking away
    return { ...s, e };
  }
  it('tap buys the next item quietly; not enough coins and sold out are refused', () => {
    const { sim, fs, p, e } = vendScene();
    p.coins = 2;
    msgs(sim);
    tap(sim, p);
    expect(p.items.drink).toBe(0);
    expect(msgs(sim)).toContain('Not enough coins (need 3).');
    p.coins = 7;
    tap(sim, p);
    expect(p.items.drink).toBe(1);
    expect(p.coins).toBe(4);
    expect(fs.vendings[0].broken).toBe(false);
    expect(e.aware).toBe(0); // quiet
    tap(sim, p);
    expect(p.items.drink).toBe(2);
    expect(p.coins).toBe(1);
    msgs(sim);
    p.coins = 9;
    tap(sim, p);
    expect(msgs(sim)).toContain('Sold out.');
    expect(p.coins).toBe(9);
  });

  it('coins and keys stay with you across a save and reload; coins cap at 99', () => {
    const sim = new Sim({ seed: 9, difficulty: 'normal', mode: 'single' });
    const p = sim.addPlayer(1, 'P1', JSON.parse(JSON.stringify(LOADOUT)));
    giveLoot(p, { k: 'coin', n: 7 }); giveLoot(p, { k: 'key', f: 3 });
    const back = Sim.fromSave(JSON.parse(JSON.stringify(sim.exportSave(p))), 1).player(1)!;
    expect([back.coins, back.keys]).toEqual([7, [3]]);
    expect(giveLoot(back, { k: 'coin', n: 95 }).left).toEqual({ k: 'coin', n: 3 });
    expect(back.coins).toBe(99);
  });
});

it('door state replicates to a co-op client, whose own layout then blocks movement', () => {
  const { sim, fs, p, i, d } = doorScene('coop', 1);
  setDoor(sim, fs, i, fs.doors[i].state === 'open' ? 'locked' : 'open', 0, null);
  const want = fs.doors[i].state;
  clearFloorCache(); // the client builds its own layout, as on another machine
  const v = new ClientView(42, 'normal', [{ id: 1, name: 'P1', slot: 0 }]);
  const cfs: FloorState = v.floorState(p.floor);
  expect(cfs.L).not.toBe(fs.L);
  v.apply(JSON.parse(JSON.stringify(encodeSnapshot(sim, 1, [], false))), 1);
  expect(cfs.doors[i].state).toBe(want);
  expect(cfs.L.solid[d.tiles[0]]).toBe(fs.L.solid[d.tiles[0]]);
  setDoor(sim, fs, i, 'closed', 0, null);
  v.apply(JSON.parse(JSON.stringify(encodeSnapshot(sim, 1, [], false))), 1);
  const me = v.player(1)!, a = sideOf(d, -1), b = sideOf(d, 1);
  me.x = a.x; me.y = a.y; me.input.mx = b.x - a.x; me.input.my = b.y - a.y;
  for (let k = 0; k < 60; k++) movePlayer(me, cfs.L, 1 / 60);
  expect(Math.hypot(me.x - b.x, me.y - b.y)).toBeGreaterThan(1);
});
