import type { EnemyType } from './types';
import type { ContainerKind } from '../gen/loot';

/**
 * Per-player run score. The host awards everything; clients only display it.
 * pts holds the points earned so far; the accuracy and win bonuses are added when the run ends (finalScore).
 */
export interface RunScore {
  pts: number;
  kills: number; knife: number;
  /** trigger pulls (a shotgun blast is one shot) and shots that hit at least one enemy */
  shots: number; hits: number;
  hacks: number; searches: number;
  /** points by source (all already inside pts) */
  speed: number; killPts: number; searchPts: number;
  /** highest floor this player reached, and the sim time they reached it */
  best: number; bestT: number;
}

export const newScore = (): RunScore => ({ pts: 0, kills: 0, knife: 0, shots: 0, hits: 0, hacks: 0, searches: 0, speed: 0, killPts: 0, searchPts: 0, best: 0, bestT: 0 });

export const SCORE = {
  floor: 100,
  /** par seconds per floor; each second under par is worth speedPerS */
  par: 90, speedPerS: 5,
  kill: { loyalist: 50, dog: 40, drone: 60, dogcyborg: 80, cyborg: 100, warden: 500 } as Record<EnemyType, number>,
  elite: 1.5, knifeMul: 2,
  hack: 250,
  search: 10, safe: 50,
  accuracy: 5000, accuracyFullAt: 25,
  win: 10000,
};

export function scoreKill(s: RunScore, type: EnemyType, elite: boolean, knife: boolean) {
  s.kills++;
  if (knife) s.knife++;
  const v = Math.round(SCORE.kill[type] * (elite ? SCORE.elite : 1) * (knife ? SCORE.knifeMul : 1));
  s.pts += v; s.killPts += v;
}

/** New highest floor: floor points, plus a speed bonus for beating par since the last best (none from the street). */
export function scoreFloor(s: RunScore, to: number, t: number) {
  if (to <= s.best) return;
  const gained = to - s.best;
  s.pts += gained * SCORE.floor;
  if (s.best >= 1) {
    const bonus = Math.round(Math.max(0, SCORE.par * gained - (t - s.bestT)) * SCORE.speedPerS);
    s.speed += bonus;
    s.pts += bonus;
  }
  s.best = to; s.bestT = t;
}

export function scoreShot(s: RunScore, hit: boolean) { s.shots++; if (hit) s.hits++; }
export function scoreHack(s: RunScore) { s.hacks++; s.pts += SCORE.hack; }
export function scoreSearch(s: RunScore, kind: ContainerKind) {
  if (kind === 'corpse' || kind === 'drop') return;
  s.searches++;
  const v = kind === 'safe' ? SCORE.safe : SCORE.search;
  s.pts += v; s.searchPts += v;
}

/** 0..1; a run with kills but no shots (knife only) counts as perfect. */
export const accuracyOf = (s: RunScore) => (s.shots ? s.hits / s.shots : s.kills ? 1 : 0);

/** Score breakdown rows [label, value] for the end screens. */
export function scoreRows(s: RunScore, won: boolean): [string, string][] {
  const f = finalScore(s, won), n = (v: number) => v.toLocaleString('en-US');
  return [
    [`Highest floor ${s.best}`, `+${n(s.best * SCORE.floor)}`],
    ['Speed', `+${n(s.speed)}`],
    [`Kills ${s.kills}${s.knife ? ` (${s.knife} knife)` : ''}`, `+${n(s.killPts)}`],
    [`Hacks ${s.hacks}`, `+${n(s.hacks * SCORE.hack)}`],
    [`Searched ${s.searches}`, `+${n(s.searchPts)}`],
    [`Accuracy ${Math.round(f.accuracy * 100)}% (${s.hits}/${s.shots})`, `+${n(f.accBonus)}`],
    ['Virus uploaded', won ? `+${n(f.winBonus)}` : '—'],
  ];
}

/** End of run. The accuracy bonus scales up to full over the first 25 kills, so one lucky shot is not worth 5,000. */
export function finalScore(s: RunScore, won: boolean) {
  const accuracy = accuracyOf(s);
  const accBonus = Math.round(accuracy * SCORE.accuracy * Math.min(1, s.kills / SCORE.accuracyFullAt));
  const winBonus = won ? SCORE.win : 0;
  return { accuracy, accBonus, winBonus, total: s.pts + accBonus + winBonus };
}

/** Run clock: starts when the first player enters the building (startT < 0 until then), stops at the end. */
export function runTime(st: { startT: number; endT: number }, now: number) {
  if (st.startT < 0) return 0;
  return Math.max(0, (st.endT > 0 ? st.endT : now) - st.startT);
}

/** hh:mm:ss.ssss */
export function fmtRunTime(sec: number) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.floor((s % 60) * 1e4) / 1e4; // floor: never shows 60.0000
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${r.toFixed(4).padStart(7, '0')}`;
}
