import { describe, it, expect } from 'vitest';
import { newScore, scoreKill, scoreFloor, scoreShot, scoreHack, scoreSearch, finalScore, runTime, fmtRunTime, SCORE } from '../src/sim/score';
import { Sim } from '../src/sim/sim';
import { emptyLoadout } from '../src/ui/shop';

describe('run score', () => {
  it('kills: elite and knife multipliers', () => {
    const s = newScore();
    scoreKill(s, 'loyalist', false, false);
    scoreKill(s, 'cyborg', true, true);
    expect(s.pts).toBe(50 + 100 * 1.5 * 2);
    expect(s.kills).toBe(2); expect(s.knife).toBe(1);
  });
  it('floors: only new highest floors count; speed bonus for beating par, none from the street', () => {
    const s = newScore();
    scoreFloor(s, 1, 100); // from the street: floor points only
    expect(s.pts).toBe(100); expect(s.speed).toBe(0);
    scoreFloor(s, 2, 130); // 30 s on a 90 s par: 60 s under
    expect(s.speed).toBe(60 * SCORE.speedPerS);
    const before = s.pts;
    scoreFloor(s, 1, 140); scoreFloor(s, 2, 150); // back down and up again: nothing
    expect(s.pts).toBe(before);
    scoreFloor(s, 5, 1000); // lift skipping floors, slower than par: floor points only
    expect(s.pts).toBe(before + 3 * SCORE.floor);
  });
  it('hacks, searches (bodies and drops do not count), accuracy and win bonus', () => {
    const s = newScore();
    scoreHack(s); scoreSearch(s, 'desk'); scoreSearch(s, 'safe'); scoreSearch(s, 'corpse');
    expect(s.pts).toBe(SCORE.hack + SCORE.search + SCORE.safe);
    expect(s.searches).toBe(2);
    for (let i = 0; i < 25; i++) scoreKill(s, 'dog', false, false);
    for (let i = 0; i < 50; i++) scoreShot(s, i % 2 === 0);
    const f = finalScore(s, true);
    expect(f.accuracy).toBe(0.5);
    expect(f.accBonus).toBe(2500);
    expect(f.total).toBe(s.pts + 2500 + SCORE.win);
  });
  it('accuracy bonus needs kills: one lucky shot is not worth the full bonus', () => {
    const s = newScore();
    scoreKill(s, 'loyalist', false, false); scoreShot(s, true);
    expect(finalScore(s, false).accBonus).toBe(Math.round(SCORE.accuracy / SCORE.accuracyFullAt));
  });
  it('run clock starts at the tower entrance and formats as hh:mm:ss.ssss', () => {
    expect(runTime({ startT: -1, endT: 0 }, 50)).toBe(0);
    expect(runTime({ startT: 10, endT: 0 }, 50)).toBe(40);
    expect(runTime({ startT: 10, endT: 30 }, 50)).toBe(20);
    expect(fmtRunTime(3723.45678)).toBe('01:02:03.4567');
    expect(fmtRunTime(59.99999)).toBe('00:00:59.9999');
  });
  it('the sim starts the clock and awards floor points when a player enters the building', () => {
    const sim = new Sim({ seed: 3, difficulty: 'normal', mode: 'single' });
    const p = sim.addPlayer(1, 'Op', emptyLoadout());
    expect(sim.stats.startT).toBe(-1);
    sim.t = 12;
    sim.travel(p, 1, 'start', 'stairs');
    expect(sim.stats.startT).toBe(12);
    expect(p.score.pts).toBe(SCORE.floor);
    const back = Sim.fromSave(sim.exportSave(p), 1).players[0];
    expect(back.score.pts).toBe(SCORE.floor);
  });
});
