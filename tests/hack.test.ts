import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { emptyLoadout } from '../src/ui/shop';
import { BuildingPlan } from '../src/gen/building';
import { generateFloor, HACK_MAX_FLOOR } from '../src/gen/floor';
import { HackGame, GUESS_PENALTY, WRONG_PENALTY, KEY_PENALTY, LOCKOUT_PENALTY, POOLS, Circuit, Keypad, likeness, type PuzzleId } from '../src/ui/hackgame';
import { lightLevel } from '../src/sim/lights';

function sim() {
  const s = new Sim({ seed: 21, difficulty: 'normal', mode: 'single' });
  const p = s.addPlayer(1, 'Dev', emptyLoadout());
  p.cheats = { god: true };
  return { s, p };
}
/** Stand at a hack terminal, open it, report a result through the input. */
function doHack(s: Sim, p: any, floor: number, kind: 'security' | 'lights', ok: 0 | 1) {
  const fs = s.floorState(floor);
  const h = fs.hacks.find((h) => h.kind === kind)!;
  for (const e of fs.enemies) e.state = 'sleep';
  p.x = h.x; p.y = h.y + 0.9;
  s.tick(1 / 60);
  p.input.interact = true; s.tick(1 / 60); p.input.interact = false; s.tick(1 / 60);
  expect(p.panel?.kind).toBe('hack');
  p.input.hackId = h.id; p.input.hackOk = ok; p.input.hackSeq++;
  s.tick(1 / 60);
  return { fs, h };
}
function floorWith(kind: 'security' | 'lights') {
  const plan = new BuildingPlan(21, 'normal');
  for (let f = 21; f < 190; f++) if (generateFloor(plan, f).hacks.some((h) => h.kind === kind)) return f;
  throw new Error('no floor with a ' + kind + ' terminal');
}

describe('hackable computers', () => {
  it('appear on a share of floors 1..190 only, at most one of each kind', () => {
    const plan = new BuildingPlan(4, 'normal');
    let sec = 0, lit = 0, n = 0;
    for (let f = 1; f <= 200; f++) {
      const L = generateFloor(plan, f);
      if (f > HACK_MAX_FLOOR) { expect(L.hacks.length).toBe(0); continue; }
      n++;
      sec += L.hacks.filter((h) => h.kind === 'security').length;
      lit += L.hacks.filter((h) => h.kind === 'lights').length;
      expect(L.hacks.filter((h) => h.kind === 'security').length).toBeLessThanOrEqual(1);
    }
    expect(sec / n).toBeGreaterThan(0.25); expect(sec / n).toBeLessThan(0.65);
    expect(lit / n).toBeGreaterThan(0.25); expect(lit / n).toBeLessThan(0.65);
  }, 60000);

  it('security hack takes every camera and trap on the floor offline', () => {
    const { s, p } = sim();
    const f = floorWith('security');
    s.travel(p, f, 'stair0', 'test');
    const { fs, h } = doHack(s, p, f, 'security', 1);
    expect(h.state).toBe('done');
    expect(fs.cameras.every((c) => !c.alive)).toBe(true);
    expect(fs.traps.every((t) => !t.armed)).toBe(true);
  });

  it('lighting hack stops flicker, relights dead bulbs and lifts darkness', () => {
    const { s, p } = sim();
    const f = floorWith('lights');
    s.travel(p, f, 'stair0', 'test');
    const { fs, h } = doHack(s, p, f, 'lights', 1);
    expect(h.state).toBe('done');
    expect(fs.lightsFixed).toBe(true);
    expect(fs.L.darkness).toBe(0);
    expect(fs.lights.every((l) => !l.broken)).toBe(true);
    for (const l of fs.L.lights) if (l.kind === 'ceiling') for (let t = 0; t < 20; t += 0.37) expect(lightLevel(l, false, t)).toBe(1);
    // the generation cache is untouched (a new run on the same seed is still dark/flickery)
    expect(generateFloor(new BuildingPlan(21, 'normal'), f)).not.toBe(fs.L);
  });

  it('a traced hack locks the terminal and raises the alarm', () => {
    const { s, p } = sim();
    const f = floorWith('security');
    s.travel(p, f, 'stair0', 'test');
    const { fs, h } = doHack(s, p, f, 'security', 0);
    expect(h.state).toBe('locked');
    expect(fs.networkAlertT).toBeGreaterThan(0);
    expect(fs.cameras.some((c) => c.alive) || fs.cameras.length === 0).toBe(true);
  });

  it('password breaker: deduction by likeness cracks it in a few picks; wrong picks cost trace', () => {
    for (const [floor, seed] of [[1, 3], [60, 9], [120, 7], [190, 11]]) {
      const g = new HackGame(floor, 'security', seed, ['password', 'decrypt']);
      let t = 0, picks = 0;
      while (!g.done && t < 60) {
        g.tick(1 / 60); t += 1 / 60;
        if (g.stage === 'password') {
          // pick any word consistent with every likeness report so far
          const w = g.words.find((w) => !g.tried.some((x) => x.word === w) && g.tried.every((x) => likeness(w, x.word) === x.like))!;
          g.guess(w); picks++;
        }
        if (g.stage === 'decrypt') g.pick(g.grid.indexOf(g.target[g.seqI]));
      }
      expect(g.stage, `floor ${floor}`).toBe('granted');
      expect(picks).toBeLessThanOrEqual(5);
      expect(g.trace).toBeLessThan(0.75);
    }
    const g = new HackGame(1, 'lights', 5, ['password']);
    for (let i = 0; i < 130; i++) g.tick(1 / 60);
    const before = g.trace, wrong = g.words.find((w) => w !== g.password)!;
    expect(g.guess(wrong)).toBe(false);
    expect(g.trace).toBeCloseTo(before + GUESS_PENALTY, 5);
    expect(g.tried[0]).toEqual({ word: wrong, like: likeness(wrong, g.password) });
    expect(g.guess(wrong)).toBe(false); // same word twice is ignored
    expect(g.trace).toBeCloseTo(before + GUESS_PENALTY, 5);
    // idle: the trace still gets you
    const idle = new HackGame(1, 'lights', 3, ['wires']);
    for (let i = 0; i < 80 * 60; i++) idle.tick(1 / 60);
    expect(idle.stage).toBe('traced');
  });

  it('each terminal draws three different puzzles from its own pool of five, fixed by the seed', () => {
    for (const kind of ['security', 'lights'] as const) {
      expect(POOLS[kind].length).toBe(5);
      const seen = new Set<PuzzleId>();
      for (let seed = 1; seed < 60; seed++) {
        const g = new HackGame(50, kind, seed);
        expect(g.stages.length).toBe(3);
        expect(new Set(g.stages).size).toBe(3);
        for (const id of g.stages) { expect(POOLS[kind]).toContain(id); seen.add(id); }
        expect(new HackGame(50, kind, seed).stages).toEqual(g.stages);
      }
      expect(seen.size).toBe(5);
    }
  });

  it('every puzzle is solvable at floor 1 and 190, and a full 3-puzzle hack ends granted with trace to spare', () => {
    const sets = [['wires', 'breakers', 'circuit'], ['voltage', 'load', 'wires'], ['cameras', 'signal', 'keypad'], ['password', 'decrypt', 'keypad']] as PuzzleId[][];
    for (const floor of [1, 190]) for (const seed of [2, 17, 44, 91]) {
      const runs: [HackGame, string][] = sets.map((s) => [new HackGame(floor, POOLS.security.includes(s[0]) ? 'security' : 'lights', seed, s), String(s)]);
      for (const kind of ['security', 'lights'] as const) runs.push([new HackGame(floor, kind, seed), kind]);
      for (const [g, name] of runs) {
        let t = 0;
        while (!g.done && t < 90) { g.tick(1 / 60); t += 1 / 60; solveStep(g); }
        expect(g.stage, `${name} floor ${floor} seed ${seed}`).toBe('granted');
        expect(g.trace, `${name} floor ${floor} seed ${seed}`).toBeLessThan(0.75);
      }
    }
  }, 30000);

  it('puzzle mistakes cost trace', () => {
    const at = (id: PuzzleId) => { const g = new HackGame(1, 'lights', 9, [id]); while (g.stage !== id) g.tick(1 / 60); return g; };
    const w = at('wires'), wp = w.p.wires!;
    const bad = wp.right.findIndex((c) => c !== wp.left[0]);
    w.act('wires', (p) => p.pick('L', 0));
    expect(w.act('wires', (p) => p.pick('R', bad))).toBe(false);
    expect(w.trace).toBeCloseTo(WRONG_PENALTY, 1);
    const v = at('voltage'), vp = v.p.voltage!;
    vp.center = vp.x > 0.5 ? 0.1 : 0.9;
    expect(v.act('voltage', (p) => p.lock())).toBe(false);
    expect(v.trace).toBeGreaterThanOrEqual(WRONG_PENALTY);
    const c = at('cameras'), cp = c.p.cameras!;
    while (cp.showT !== null) c.tick(1 / 60);
    expect(c.act('cameras', (p) => p.pick((cp.seq[0] + 1) % 9))).toBe(false);
    expect(cp.showT).not.toBeNull(); // replays the sequence
    const s = at('signal');
    expect(s.act('signal', (p) => p.loop())).toBe(false);
    expect(s.stage).toBe('signal');
    const k = at('keypad'), kp = k.p.keypad!, code = kp.code;
    const enter = (c: string) => { for (const d of c) k.act('keypad', (p) => p.press(+d)); return k.act('keypad', (p) => p.enter()); };
    const wrong = [...Array(10000).keys()].map((i) => String(i).padStart(4, '0')).filter((c) => c !== code);
    let tr = k.trace;
    expect(enter(wrong[0])).toBe(false);
    expect(k.trace - tr).toBeCloseTo(KEY_PENALTY, 5);
    expect(kp.log[0]).toEqual({ g: wrong[0], ...Keypad.score(wrong[0], code) });
    for (let i = 1; i < Keypad.MAX - 1; i++) enter(wrong[i]);
    tr = k.trace;
    expect(enter(wrong[Keypad.MAX - 1])).toBe(false); // out of attempts: big penalty, fresh code
    expect(k.trace - tr).toBeCloseTo(LOCKOUT_PENALTY, 5);
    expect(kp.log.length).toBe(0);
    expect(kp.resets).toBe(1);
    expect(Keypad.score('1123', '3111')).toMatchObject({ hit: 1, near: 2 });
    const l = at('load'), lp = l.p.load!;
    l.act('load', (p) => p.toggle(0)); // toggling is free
    expect(l.trace).toBeLessThan(0.05);
    if (lp.total === lp.target) l.act('load', (p) => p.toggle(1));
    tr = l.trace;
    expect(l.act('load', (p) => p.commit())).toBe(false);
    expect(l.trace - tr).toBeCloseTo(WRONG_PENALTY, 5);
    expect(l.stage).toBe('load');
    // neutral moves are free
    const b = at('breakers'), before = b.trace;
    b.act('breakers', (p) => p.flip(0));
    expect(b.trace).toBe(before);
  });
});

/** One move of a perfect player in whichever puzzle is up. */
function solveStep(g: HackGame) {
  const p = g.p;
  switch (g.stage) {
    case 'password': g.guess(g.words.find((w) => !g.tried.some((x) => x.word === w) && g.tried.every((x) => likeness(w, x.word) === x.like))!); break;
    case 'decrypt': g.pick(g.grid.indexOf(g.target[g.seqI])); break;
    case 'keypad': {
      // Mastermind by elimination: of the codes consistent with every report so far, enter one that splits the rest
      // into the most feedback groups (sampled, so it stays quick)
      const k = p.keypad!;
      const cand = [...Array(10000).keys()].map((i) => String(i).padStart(4, '0'))
        .filter((c) => (k.repeats || new Set(c).size === 4) && k.log.every((l) => { const s = Keypad.score(l.g, c); return s.hit === l.hit && s.near === l.near; }));
      const sample = (n: number) => cand.filter((_, i) => i % Math.ceil(cand.length / n) === 0), rest = sample(300);
      const parts = (g: string) => new Set(rest.map((c) => { const s = Keypad.score(g, c); return s.hit * 5 + s.near; })).size;
      const c = k.log.length ? sample(30).map((g) => [parts(g), g] as const).reduce((a, b) => (b[0] > a[0] ? b : a))[1] : '0123';
      for (const d of c) g.act('keypad', (x) => x.press(+d));
      g.act('keypad', (x) => x.enter());
      break;
    }
    case 'load': {
      // brute-force the subset (at most 2^7)
      const l = p.load!, n = l.watts.length;
      for (let mask = 0; mask < 1 << n; mask++) if (l.watts.reduce((s, w, i) => s + (mask & (1 << i) ? w : 0), 0) === l.target) {
        for (let i = 0; i < n; i++) if (l.on[i] !== !!(mask & (1 << i))) g.act('load', (x) => x.toggle(i));
        break;
      }
      g.act('load', (x) => x.commit());
      break;
    }
    case 'wires': { const w = p.wires!, i = w.left.findIndex((c) => !w.done.has(c)); g.act('wires', (x) => x.pick('L', i)); g.act('wires', (x) => x.pick('R', w.right.indexOf(w.left[i]))); break; }
    case 'breakers': {
      // brute-force the set of flips (at most 2^7)
      const on = p.breakers!.on, n = on.length;
      for (let mask = 1; mask < 1 << n; mask++) {
        const t = on.slice();
        for (let i = 0; i < n; i++) if (mask & (1 << i)) for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < n) t[j] = !t[j];
        if (t.every(Boolean)) { for (let i = 0; i < n; i++) if (mask & (1 << i)) g.act('breakers', (x) => x.flip(i)); break; }
      }
      break;
    }
    case 'circuit': {
      const c = p.circuit!, want = solveCircuit(c);
      want.forEach((m, i) => { for (let k = 0; k < 4 && c.tiles[i] !== m; k++) g.act('circuit', (x) => x.rotate(i)); });
      break;
    }
    case 'voltage': { const v = p.voltage!; if (Math.abs(v.x - v.center) < v.width / 2 - 0.01) g.act('voltage', (x) => x.lock()); break; }
    case 'cameras': { const c = p.cameras!; if (c.showT === null) g.act('cameras', (x) => x.pick(c.seq[c.idx])); break; }
    case 'signal': {
      const s = p.signal!;
      for (const k of s.params) while (s.val[k] !== s.target[k]) g.act('signal', (x) => x.tune(k, Math.sign(s.target[k] - s.val[k])));
      g.act('signal', (x) => x.loop());
      break;
    }
  }
}

/** Tile masks that power the bulb: depth-first along the route, trying each rotation of each tile. */
function solveCircuit(c: Circuit): number[] {
  const n = c.n, tiles = c.tiles.slice(), used = new Set<number>(), bulb = c.bulbRow * n + n - 1;
  const go = (cell: number, from: number): boolean => {
    used.add(cell);
    let m = tiles[cell];
    for (let r = 0; r < 4; r++, m = Circuit.rot(m)) {
      if (!(m & (1 << from))) continue;
      tiles[cell] = m;
      for (let d = 0; d < 4; d++) {
        if (d === from || !(m & (1 << d))) continue;
        if (cell === bulb && d === 1) return true;
        const x = (cell % n) + Circuit.DIRS[d][0], y = Math.floor(cell / n) + Circuit.DIRS[d][1], nc = y * n + x;
        if (x >= 0 && y >= 0 && x < n && y < n && !used.has(nc) && go(nc, (d + 2) % 4)) return true;
      }
    }
    used.delete(cell);
    return false;
  };
  expect(go(c.srcRow * n, 3)).toBe(true);
  return tiles;
}
