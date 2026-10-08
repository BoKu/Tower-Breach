import type { PlayerState, FloorState } from '../sim/state';
import type { StairCondition, BuildingPlan } from '../gen/building';

/** What the presentation layer needs. Implemented by Sim (local/host) and by the network client mirror. */
export interface ViewSource {
  t: number;
  players: PlayerState[];
  floorState(f: number): FloorState;
  flightCondition(f: number, i: number): StairCondition;
  plan: BuildingPlan;
  objective: { uploadStarted: boolean; uploadT: number; done: boolean };
  stats: { startT: number; endT: number };
  cfg: { mode: 'single' | 'coop'; difficulty: string; seed: number };
}

/** Relative colour identity: you are white; teammates get blue/green/yellow/purple by join order. */
export const TEAM_COLORS = [0x3d8bff, 0x3ddc6a, 0xffd23d, 0xb05cff];
export const TEAM_CSS = ['#3d8bff', '#3ddc6a', '#ffd23d', '#b05cff'];
export const SELF_COLOR = 0xf0f0f0;
export function teamColorIndex(players: PlayerState[], localId: number, pid: number): number {
  const others = players.filter((p) => p.id !== localId).sort((a, b) => a.slot - b.slot);
  return others.findIndex((p) => p.id === pid);
}
