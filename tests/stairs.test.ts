import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { stairPassable, STAIR_COUNT } from '../src/gen/building';
import { isWalkableTile, flightTiles } from '../src/gen/floor';
import { stairElevation } from '../src/sim/stairs';

const LO = { primary: null, secondary: 'p9', armor: 'none' as const, grenades: {}, items: {}, mods: { bypass: false, torchmod: false, pouch: false } };
function sim() { const s = new Sim({ seed: 12345, difficulty: 'normal', mode: 'single' }); const p = s.addPlayer(1, 'A', LO); return { s, p }; }
function walkNorth(s: Sim, p: ReturnType<Sim['addPlayer']>, sec: number) {
  const f0 = p.floor;
  for (let t = 0; t < sec && p.floor === f0; t += 1 / 60) { p.input.mx = 0; p.input.my = -1; p.input.ax = p.x; p.input.ay = p.y - 5; s.tick(1 / 60); }
  p.input.my = 0;
}

describe('stairwells you can walk', () => {
  it('walking up a clear flight climbs to the next floor; walking down the pit descends', () => {
    const { s, p } = sim();
    let checked = 0;
    for (let f = 2; f < 60 && checked < 3; f++) {
      for (let i = 0; i < STAIR_COUNT; i++) {
        if (s.flightCondition(f, i) !== 'clear') continue;
        s.travel(p, f, 'stair' + i, 't');
        (p as any).stairCd = 0;
        for (const e of s.floorState(f).enemies) e.state = 'dead';
        const st = s.floorState(f).L.stairs[i];
        p.x = st.x0 + 1; p.y = st.y1 + 0.7; // bottom of the up flight
        expect(stairElevation(s.floorState(f).L, p.x, p.y)).toBeLessThan(0.5);
        walkNorth(s, p, 6);
        expect(p.floor).toBe(f + 1);
        checked++;
        break;
      }
    }
    expect(checked).toBe(3);
    // descend: pick a floor whose flight down is clear
    for (let f = 5; f < 80; f++) {
      const i = [0, 1, 2].find((k) => s.flightCondition(f - 1, k) === 'clear');
      if (i === undefined) continue;
      s.travel(p, f, 'stair' + i, 't'); (p as any).stairCd = 0;
      for (const e of s.floorState(f).enemies) e.state = 'dead';
      const st = s.floorState(f).L.stairs[i];
      p.x = st.x1; p.y = st.y1 + 0.7;
      expect(stairElevation(s.floorState(f).L, p.x, st.y0 + 0.2)).toBeLessThan(-2);
      walkNorth(s, p, 6);
      expect(p.floor).toBe(f - 1);
      break;
    }
  });
  it('co-op: a player whose client moves them (server only receives positions) also climbs by walking up', () => {
    // on a dedicated server or browser host, a client's position arrives before the sim tick (applyInput), so the
    // sim never sees this tick's movement itself: walking up the flight must still take the player up
    const { s, p } = sim();
    s.external.add(p.id);
    const f = [...Array(40).keys()].map((k) => k + 2).find((ff) => s.flightCondition(ff, 0) === 'clear')!;
    s.travel(p, f, 'stair0', 't'); (p as any).stairCd = 0;
    for (const e of s.floorState(f).enemies) e.state = 'dead';
    const st = s.floorState(f).L.stairs[0];
    p.x = st.x0 + 1; p.y = st.y1 + 0.7;
    for (let t = 0; t < 6 && p.floor === f; t += 1 / 60) {
      p.y -= 3.3 / 60; // the client's own movement, applied by the authority before the tick
      p.input.my = -1; p.input.ax = p.x; p.input.ay = p.y - 5;
      s.tick(1 / 60);
    }
    expect(p.floor).toBe(f + 1);
  });

  it('the top of a flight is only reachable by walking the steps (no sidestep onto the top from the landing)', () => {
    // I89: the flat aisle beside the flights let you walk to the far end at ground level and sidestep onto the top
    // step, popping 2.6 m up and straight into the next floor. Drive the player up the aisle, sidestep, push on:
    // the ground height must change gradually (a tread at a time), never jump.
    const { s, p } = sim();
    let checked = 0;
    for (let f = 2; f < 60 && checked < 3; f++) {
      const i = [0, 1, 2].find((k) => s.flightCondition(f, k) === 'clear' && s.flightCondition(f - 1, k) === 'clear');
      if (i === undefined || i !== checked) continue; // one floor per stairwell
      s.travel(p, f, 'stair' + i, 't'); (p as any).stairCd = 0;
      for (const e of s.floorState(f).enemies) e.state = 'dead';
      const L = s.floorState(f).L, st = L.stairs[i];
      p.x = st.cx; p.y = st.y1 + 0.5; // bottom landing, between the flights
      let prev = stairElevation(L, p.x, p.y), jump = 0, top = 0;
      const drive = (mx: number, my: number, sec: number, until = () => false) => {
        for (let t = 0; t < sec && p.floor === f && !until(); t += 1 / 60) {
          p.input.mx = mx; p.input.my = my; p.input.ax = p.x + mx * 5; p.input.ay = p.y + my * 5;
          s.tick(1 / 60);
          if (p.floor !== f) break;
          const e = stairElevation(L, p.x, p.y);
          jump = Math.max(jump, Math.abs(e - prev)); top = Math.max(top, e); prev = e;
        }
      };
      drive(0, -1, 3); // up the middle
      drive(-1, 0, 1.5, () => p.x < st.x0 + 1); // sidestep west, onto the up flight's line
      drive(0, -1, 4); // and on
      p.input.mx = p.input.my = 0;
      expect(jump).toBeLessThan(0.25);
      expect(p.floor).toBe(f + 1); // ...and walking the flight itself does take you up
      expect(top).toBeGreaterThan(2);
      checked++;
    }
    expect(checked).toBe(3);
  });
  it('debris and collapsed flights physically block the steps; clearing debris reopens them', () => {
    const { s, p } = sim();
    for (let f = 3; f < 150; f++) {
      const i = [0, 1, 2].find((k) => s.flightCondition(f, k) === 'debris');
      if (i === undefined) continue;
      const L = s.floorState(f).L;
      for (const [x, y] of flightTiles(L.stairs[i], 1)) expect(isWalkableTile(L, x, y)).toBe(false);
      s.clearDebris(f, i);
      for (const [x, y] of flightTiles(L.stairs[i], 1)) expect(isWalkableTile(L, x, y)).toBe(true);
      // the floor above gets its down flight opened too
      const La = s.floorState(f + 1).L;
      for (const [x, y] of flightTiles(La.stairs[i], -1)) expect(isWalkableTile(La, x, y)).toBe(true);
      void p;
      return;
    }
    throw new Error('no debris flight found');
  });
  it('every floor below 200 has at least one walkable stairwell up', () => {
    const { s } = sim();
    for (let f = 1; f < 200; f++) expect([0, 1, 2].some((i) => stairPassable(s.plan.up(f, i)))).toBe(true);
  });
});
