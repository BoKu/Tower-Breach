import type { EnemyType } from './types';
import type { SpawnSpec } from '../gen/floor';
import { bracketOf } from '../config/difficulty';

export interface EnemyStat {
  hp: number; armor: number; walk: number; run: number; view: number; fov: number; hearing: number;
  accuracy: number; radius: number; metal: boolean; melee: boolean; turn: number;
}
export const ENEMY_STATS: Record<EnemyType, EnemyStat> = {
  loyalist: { hp: 100, armor: 0, walk: 1.4, run: 3.1, view: 15, fov: 1.0, hearing: 1.0, accuracy: 0.55, radius: 0.32, metal: false, melee: false, turn: 5 },
  dog: { hp: 55, armor: 0, walk: 1.7, run: 4.8, view: 11, fov: 1.3, hearing: 1.6, accuracy: 0.9, radius: 0.3, metal: false, melee: true, turn: 9 },
  cyborg: { hp: 150, armor: 50, walk: 1.5, run: 3.4, view: 19, fov: 1.1, hearing: 1.2, accuracy: 0.72, radius: 0.34, metal: false, melee: false, turn: 6 },
  dogcyborg: { hp: 100, armor: 30, walk: 1.9, run: 5.3, view: 13, fov: 1.3, hearing: 1.8, accuracy: 0.9, radius: 0.3, metal: false, melee: true, turn: 10 },
  drone: { hp: 70, armor: 30, walk: 1.3, run: 2.0, view: 14, fov: 1.4, hearing: 0.8, accuracy: 0.5, radius: 0.3, metal: true, melee: false, turn: 6 },
  warden: { hp: 650, armor: 150, walk: 1.0, run: 1.4, view: 18, fov: 0.9, hearing: 1.0, accuracy: 0.6, radius: 0.62, metal: true, melee: false, turn: 2.2 },
};

export function enemyStatsFor(s: SpawnSpec, floor: number): { hp: number; armor: number } {
  const st = ENEMY_STATS[s.type];
  const k = bracketOf(floor);
  let hp = st.hp * (1 + 0.035 * k);
  let armor = st.armor * (1 + 0.04 * k);
  if (s.type === 'loyalist' && floor > 15) armor = Math.min(70, (floor - 15) * 0.6);
  if (s.elite) { hp *= 1.4; armor += 40; }
  return { hp: Math.round(hp), armor: Math.round(armor) };
}
