import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { emptyLoadout } from '../src/ui/shop';
import { BuildingPlan } from '../src/gen/building';
import { generateFloor, HACK_MAX_FLOOR } from '../src/gen/floor';
import { HackGame, GUESS_PENALTY, likeness } from '../src/ui/hackgame';
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
      const g = new HackGame(floor, 'security', seed);
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
    const g = new HackGame(1, 'lights', 5);
    for (let i = 0; i < 130; i++) g.tick(1 / 60);
    const before = g.trace, wrong = g.words.find((w) => w !== g.password)!;
    expect(g.guess(wrong)).toBe(false);
    expect(g.trace).toBeCloseTo(before + GUESS_PENALTY, 5);
    expect(g.tried[0]).toEqual({ word: wrong, like: likeness(wrong, g.password) });
    expect(g.guess(wrong)).toBe(false); // same word twice is ignored
    expect(g.trace).toBeCloseTo(before + GUESS_PENALTY, 5);
    // idle: the trace still gets you
    const idle = new HackGame(1, 'lights', 3);
    for (let i = 0; i < 60 * 60; i++) idle.tick(1 / 60);
    expect(idle.stage).toBe('traced');
  });
});
