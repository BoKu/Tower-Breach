import { Sim } from '../src/sim/sim';
import type { Loadout, FloorState, PlayerState, Enemy } from '../src/sim/state';
import { makeEnemy } from '../src/sim/state';
import { enemyStatsFor } from '../src/sim/stats';
import { weapon } from '../src/config/weapons';
import { FW, FH, idx, T_FLOOR, T_WALL, FloorLayout } from '../src/gen/floor';
import type { EnemyType } from '../src/sim/types';

export const LOADOUT: Loadout = {
  primary: 'sr4', secondary: 'p9', armor: 'vesthelm', grenades: { frag: 1, flash: 1 }, items: { medkit: 2, battery: 1 },
  mods: { bypass: false, torchmod: false, pouch: false },
};

/** Empty walled arena with optional low cover row. */
export function arena(floor = 5, darkness = 0): FloorLayout {
  const tiles = new Uint8Array(FW * FH).fill(T_WALL);
  const roomAt = new Int16Array(FW * FH).fill(-1);
  for (let y = 1; y < FH - 1; y++) for (let x = 1; x < FW - 1; x++) { tiles[idx(x, y)] = T_FLOOR; roomAt[idx(x, y)] = 0; }
  return {
    floor, seed: 1, w: FW, h: FH, theme: 'test', darkness, tiles, roomAt, solid: new Uint8Array(FW * FH), boarded: new Uint8Array(FW * FH),
    rooms: [{ id: 0, type: 'office', x: 1, y: 1, w: FW - 2, h: FH - 2, surface: 'carpet', main: true }],
    props: [], lights: [], containers: [], vendings: [], cameras: [], traps: [], hazards: [], spawns: [], stairs: [], elevators: [], portals: [], mainframe: null, ambient: [], hacks: [],
    anchors: { stair0: { x: 10, y: 10 }, start: { x: 10, y: 10 } },
  };
}

export function setup(mode: 'single' | 'coop' = 'single', players = 1, floor = 5, darkness = 0) {
  const sim = new Sim({ seed: 42, difficulty: 'normal', mode });
  const ps: PlayerState[] = [];
  for (let i = 0; i < players; i++) ps.push(sim.addPlayer(i + 1, 'P' + (i + 1), JSON.parse(JSON.stringify(LOADOUT))));
  const fs = sim.floorState(floor);
  fs.L = arena(floor, darkness);
  fs.enemies = []; fs.cameras = []; fs.traps = []; fs.containers = []; fs.vendings = []; fs.hazards = []; fs.lights = []; fs.panels = [];
  fs.scareT = 1e9;
  for (const p of ps) { p.floor = floor; p.x = 10; p.y = 10 + p.slot; }
  return { sim, fs, ps, p: ps[0] };
}

export function addEnemy(sim: Sim, fs: FloorState, type: EnemyType, x: number, y: number, facing = 0, weaponId?: string): Enemy {
  const e = makeEnemy(fs.enemies.length + 1 + fs.floor * 10000, { type, x, y, squad: 1, behavior: 'guard', route: [{ x, y }], elite: false, weapon: weaponId ?? (type === 'drone' ? 'drone_gun' : type === 'warden' ? 'warden_mg' : type.startsWith('dog') ? 'bite' : 'sr4') }, fs.floor, enemyStatsFor);
  e.facing = facing; e.homeFacing = facing;
  e.mag = weapon(e.weapon).mag;
  fs.enemies.push(e);
  return e;
}

export function run(sim: Sim, seconds: number, each?: () => void) {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) { each?.(); sim.tick(dt); }
}
