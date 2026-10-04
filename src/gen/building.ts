import { Rng, hash } from '../core/rng';
import { Difficulty, pressure, TOTAL_FLOORS } from '../config/difficulty';

export type StairCondition = 'clear' | 'damaged' | 'fire' | 'debris' | 'collapsed';
export const STAIR_COUNT = 3;
export const ELEVATOR_COUNT = 2;
export const ELEVATOR_WORKING_P = 0.2;
export const ELEVATOR_MAX_TRAVEL = 5;

/** Is a stair flight traversable (possibly with a cost)? */
export function stairPassable(c: StairCondition): boolean {
  return c === 'clear' || c === 'damaged' || c === 'fire';
}

export const STAIR_LABEL: Record<StairCondition, string> = {
  clear: 'Clear',
  damaged: 'Damaged (noisy)',
  fire: 'On fire (burns)',
  debris: 'Blocked by debris (clearable)',
  collapsed: 'Collapsed (impassable)',
};

export interface ElevatorState {
  working: boolean;
  /** floors reachable when working, excluding the current floor. */
  destinations: number[];
}

/**
 * Whole-run vertical traversal plan. Regenerates each run from the run seed.
 * flights[f][i] describes stairwell i between floor f and floor f+1 (f = 1..199).
 */
export class BuildingPlan {
  readonly seed: number;
  readonly difficulty: Difficulty;
  readonly flights: StairCondition[][] = [];
  readonly elevators: ElevatorState[][] = [];

  constructor(seed: number, difficulty: Difficulty) {
    this.seed = seed;
    this.difficulty = difficulty;
    const rng = new Rng(hash(seed, 0xb111d));
    for (let f = 0; f <= TOTAL_FLOORS; f++) {
      const p = pressure(difficulty, f);
      const row: StairCondition[] = [];
      for (let i = 0; i < STAIR_COUNT; i++) {
        if (f < 1 || f >= TOTAL_FLOORS) {
          row.push('collapsed'); // no flights from street or above the crown
          continue;
        }
        const bad = Math.min(0.5, (f < 3 ? 0.06 : 0.16) + 0.015 * p.bracket * p.hazard);
        if (rng.chance(bad)) {
          row.push(rng.weighted<StairCondition>([['debris', 4], ['collapsed', 3], ['fire', f > 15 ? 3 : 1]]));
        } else {
          row.push(rng.chance(0.18 + 0.01 * p.bracket) ? 'damaged' : 'clear');
        }
      }
      this.flights.push(row);
      const erow: ElevatorState[] = [];
      for (let j = 0; j < ELEVATOR_COUNT; j++) {
        const working = f >= 1 && f < TOTAL_FLOORS && rng.chance(ELEVATOR_WORKING_P);
        const destinations: number[] = [];
        if (working) {
          const maxUp = rng.int(2, ELEVATOR_MAX_TRAVEL);
          const maxDown = rng.int(1, ELEVATOR_MAX_TRAVEL);
          for (let d = -maxDown; d <= maxUp; d++) {
            const t = f + d;
            if (d !== 0 && t >= 1 && t <= TOTAL_FLOORS) destinations.push(t);
          }
        }
        erow.push({ working, destinations });
      }
      this.elevators.push(erow);
      // Guarantee at least one way up from every floor 1..199.
      if (f >= 1 && f < TOTAL_FLOORS) {
        const anyStair = row.some(stairPassable);
        const anyLift = erow.some((e) => e.working && e.destinations.some((d) => d > f));
        // every floor keeps at least one walkable stairwell (lifts are a bonus, not the only way up)
        if (!anyStair) row[rng.int(0, STAIR_COUNT - 1)] = rng.chance(0.75) ? 'clear' : 'damaged';
        void anyLift;
      }
    }
  }

  /** Condition of the flight going up from floor f via stairwell i. */
  up(f: number, i: number): StairCondition {
    if (f === -1) return (['clear', 'debris', 'fire'] as StairCondition[])[i] ?? 'clear'; // sandbox showcase
    if (f === -2) return (['damaged', 'collapsed', 'clear'] as StairCondition[])[i] ?? 'clear';
    return this.flights[f]?.[i] ?? 'collapsed';
  }
  /** Condition of the flight going down from floor f via stairwell i (= flight from f-1). */
  down(f: number, i: number): StairCondition {
    if (f === -1) return this.up(-2, i);
    return f <= 1 ? 'collapsed' : this.up(f - 1, i);
  }
  elevator(f: number, j: number): ElevatorState {
    return this.elevators[f]?.[j] ?? { working: false, destinations: [] };
  }
}
