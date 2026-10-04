import { clamp } from '../core/math';

export type Difficulty = 'normal' | 'hard' | 'insane';
export const DIFFICULTIES: Difficulty[] = ['normal', 'hard', 'insane'];

export const TOTAL_FLOORS = 200;
/** Developer showcase floor (?dev=1&floor=sandbox): every model on a grid, no AI. */
export const SANDBOX_FLOOR = -1;
export const FINAL_FLOOR = 200;
export const SHUTDOWN_SECONDS = 60;
export const REVIVE_WINDOW = 60;
export const DARKNESS_START_FLOOR = 20;
export const DARKNESS_CAP = 0.5; // playtests: 90%, 80% and 70% were all too dark to fight in
export const DARKNESS_PER_FLOOR = DARKNESS_CAP / 180; // ~0.44% per floor, reaching the cap at floor 199

export interface PressureProfile {
  /** multiplier on enemy detection rate */
  perception: number;
  /** multiplier on damage dealt by enemies */
  damage: number;
  /** multiplier on loot quantity / chance */
  loot: number;
  /** multiplier on traps/cameras/blocked routes */
  hazard: number;
  /** 0..~2.5 AI push/aggression factor */
  aggression: number;
  /** multiplier on enemy count */
  density: number;
  /** enemy accuracy multiplier */
  accuracy: number;
  bracket: number;
}

interface Base {
  perception: number; damage: number; loot: number; hazard: number; aggression: number; density: number; accuracy: number; cash: number;
}

export const DIFF_BASE: Record<Difficulty, Base> = {
  // playtest: normal was a wall at floor 2; all tiers scaled by the same factors (dmg x0.65, acc/perception/aggression/density x0.85, hazard x0.9, loot x1.15)
  normal: { perception: 0.85, damage: 0.65, loot: 1.15, hazard: 0.9, aggression: 0.85, density: 0.85, accuracy: 0.85, cash: 9000 },
  hard: { perception: 1.06, damage: 0.88, loot: 0.9, hazard: 1.17, aggression: 1.1, density: 1.02, accuracy: 0.98, cash: 7500 },
  insane: { perception: 1.32, damage: 1.17, loot: 0.67, hazard: 1.44, aggression: 1.4, density: 1.19, accuracy: 1.1, cash: 6000 },
};

/** 10-floor bracket index. Floors 1-10 => 0, 11-20 => 1 ... 191-200 => 19. Floor 0 (street) => 0. */
export function bracketOf(floor: number): number {
  return floor <= 0 ? 0 : Math.floor((floor - 1) / 10);
}

/** Combined difficulty pressure for a floor. Every 10 floors pressure strictly increases. */
export function pressure(diff: Difficulty, floor: number): PressureProfile {
  const b = DIFF_BASE[diff];
  const k = bracketOf(floor);
  return {
    bracket: k,
    // playtest: floors 150-199 were near-impossible; gentler slopes (still rising every 10 floors)
    perception: b.perception * (1 + 0.03 * k),
    damage: b.damage * (1 + 0.04 * k),
    loot: clamp(b.loot * (1 - 0.025 * k), 0.35, 2),
    hazard: b.hazard * (1 + 0.06 * k),
    aggression: b.aggression * (1 + 0.04 * k),
    density: b.density * (1 + 0.05 * k),
    accuracy: b.accuracy * (1 + 0.015 * k),
  };
}

/** Fraction of ambient light removed on a floor: 0 below floor 20, rising each floor, capped at 50%. */
export function darknessOf(floor: number): number {
  if (floor < DARKNESS_START_FLOOR) return 0;
  return clamp((floor - DARKNESS_START_FLOOR + 1) * DARKNESS_PER_FLOOR, 0, DARKNESS_CAP);
}

export interface BracketInfo { name: string; desc: string }
export function bracketInfo(floor: number): BracketInfo {
  if (floor < 0) return { name: 'Sandbox', desc: 'Asset showcase. No AI.' };
  if (floor <= 0) return { name: 'Police Cordon', desc: 'Safe zone. Check your gear, then breach.' };
  if (floor >= 200) return { name: 'Mainframe Crown', desc: 'Upload the virus. Hold for sixty seconds.' };
  if (floor <= 10) return { name: 'Entry Levels', desc: 'Conventional loyalist resistance.' };
  if (floor <= 20) return { name: 'Surveillance Belt', desc: 'Denser patrols, more cameras.' };
  if (floor <= 50) return { name: 'Dimming Floors', desc: 'Power failing. Hazards spreading.' };
  if (floor <= 100) return { name: 'Cyborg Quarter', desc: 'Networked hunters. Routes collapsing.' };
  if (floor <= 150) return { name: 'Scarcity Zone', desc: 'Supplies scarce. Elite threats.' };
  return { name: 'Blackout Spire', desc: 'Near-total darkness. Relentless AI.' };
}
