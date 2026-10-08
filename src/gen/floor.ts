import { Rng, hash } from '../core/rng';
import { pressure, darknessOf, FINAL_FLOOR, Difficulty, SANDBOX_FLOOR } from '../config/difficulty';
import type { BuildingPlan } from './building';
import { STAIR_COUNT, ELEVATOR_COUNT } from './building';
import { containerLoot, vendingLoot, ContainerKind } from './loot';
import { currentHoliday } from '../config/holiday';
import type { EnemyType, LootItem } from '../sim/types';

export const FW = 64;
export const FH = 48;
export const T_VOID = 0, T_FLOOR = 1, T_WALL = 2, T_DOOR = 3, T_WINDOW = 4;
export const S_NONE = 0, S_LOW = 1, S_TALL = 2;
/** a shut door leaf (enemies open it) and a locked one (needs the floor's master key): both block walking and sight */
export const S_DOOR = 3, S_LOCKED = 4;

export type RoomType =
  | 'corridor' | 'open' | 'office' | 'kitchen' | 'bathroom' | 'server' | 'security' | 'storage'
  | 'maintenance' | 'executive' | 'boardroom' | 'lobby' | 'utility' | 'stair' | 'elevator' | 'mainframe' | 'street' | 'plaza'
  /** easter egg: floor 8's private card room */
  | 'poker';
export type Surface = 'carpet' | 'tile' | 'concrete' | 'metal' | 'asphalt';

export interface Room { id: number; type: RoomType; x: number; y: number; w: number; h: number; surface: Surface; main: boolean }
export interface Prop { id: number; kind: string; x: number; y: number; w: number; h: number; rot: number; solid: number; room: number }
export interface LightSpec { id: number; x: number; y: number; color: number; intensity: number; range: number; flicker: number; broken: boolean; room: number; kind: 'ceiling' | 'fire' | 'street' | 'emergency' | 'police'; z?: number; phase?: number }
export interface ContainerSpec { id: number; kind: ContainerKind; x: number; y: number; items: LootItem[]; room: number }
/** drops = the stock, sold one unit at a time for `price` coins (prying the machine open spills what is left) */
export interface VendingSpec { id: number; x: number; y: number; rot: number; drops: LootItem[]; price: number }
export type DoorMode = 'open' | 'closed' | 'locked';
/** A swinging door in a 1-2 tile doorway between two rooms. vertical = the wall runs north-south. */
export interface DoorSpec { id: number; tiles: number[]; vertical: boolean; x: number; y: number; init: DoorMode }
export interface CameraSpec { id: number; x: number; y: number; angle: number; sweep: number; speed: number; phase: number; range: number; fov: number }
export interface TrapSpec { id: number; kind: 'tripwire' | 'mine'; x: number; y: number; x2: number; y2: number }
/** A computer that can be hacked (Uplink-style minigame). x,y = the computer; standing reach is 1.6 m. */
export interface HackSpec { id: number; kind: 'security' | 'lights'; x: number; y: number; propKind: string }
export interface HazardSpec { id: number; kind: 'fire' | 'shock'; x: number; y: number; r: number }
export interface SpawnSpec { type: EnemyType; x: number; y: number; squad: number; behavior: 'patrol' | 'guard' | 'wander' | 'sleep'; route: { x: number; y: number }[]; elite: boolean; weapon: string }
export interface StairSpec { index: number; x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; doorX: number; doorY: number; upX: number; upY: number; downX: number; downY: number }
export interface ElevatorSpec { index: number; x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; doorX: number; doorY: number }
/** Purely cosmetic street life (no gameplay effect). Positions are deterministic so every co-op client agrees. */
export type AmbientSpec =
  /** npc: index into the street cast (config/npcs.ts); -1 = the command-tent officer (reserved role) */
  | { kind: 'officer'; mode: 'guard' | 'talk' | 'patrol' | 'lean' | 'brief'; x: number; y: number; x2: number; y2: number; facing: number; seed: number; npc: number }
  | { kind: 'pigeons'; x: number; y: number; n: number; seed: number }
  | { kind: 'rat'; x: number; y: number; x2: number; y2: number; seed: number }
  /** a squad-mate operator chatting in a huddle (single player only: stands in for co-op teammates) */
  | { kind: 'squad'; slot: number; x: number; y: number; facing: number; cx: number; cy: number; seed: number };
export interface Portal { x: number; y: number; target: number; label: string; arriveTag: string }

export interface FloorLayout {
  floor: number;
  seed: number;
  w: number;
  h: number;
  theme: string;
  darkness: number;
  tiles: Uint8Array;
  roomAt: Int16Array;
  solid: Uint8Array;
  boarded: Uint8Array;
  rooms: Room[];
  props: Prop[];
  lights: LightSpec[];
  containers: ContainerSpec[];
  vendings: VendingSpec[];
  cameras: CameraSpec[];
  traps: TrapSpec[];
  hazards: HazardSpec[];
  spawns: SpawnSpec[];
  stairs: StairSpec[];
  elevators: ElevatorSpec[];
  portals: Portal[];
  mainframe: { x: number; y: number; termX: number; termY: number; spawnPoints: { x: number; y: number }[] } | null;
  ambient: AmbientSpec[];
  /** hackable computers: security (CCTV, mines, tripwires off) and lighting (flicker fixed, full brightness) */
  hacks: HackSpec[];
  /** real doors (floors 1..FINAL_FLOOR-1); their live state is FloorState.doors (same order) */
  doors: DoorSpec[];
  /** arrival anchors keyed by tag: 'stair0'..'stair2', 'elev0','elev1', 'entrance', 'street', 'start' */
  anchors: Record<string, { x: number; y: number }>;
}

export const idx = (x: number, y: number) => y * FW + x;

/**
 * Tiles of a stairwell flight plus its top landing: up = the two west columns (rising northward), down = the two
 * east columns (the pit). The south row (y1) is the shared flat bottom landing by the door and is never part of a flight.
 */
export function flightTiles(s: StairSpec, dir: 1 | -1): [number, number][] {
  const out: [number, number][] = [];
  const cols = dir > 0 ? [s.x0, s.x0 + 1] : [s.x1 - 1, s.x1];
  for (let y = s.y0; y < s.y1; y++) for (const x of cols) out.push([x, y]);
  return out;
}
/** Blocked flights (debris, collapse) are physically impassable; clearing debris reopens them. */
export function setFlightBlocked(L: FloorLayout, s: StairSpec, dir: 1 | -1, blocked: boolean) {
  for (const [x, y] of flightTiles(s, dir)) L.solid[idx(x, y)] = blocked ? S_TALL : S_NONE;
}
/** Write a door's state into the collision/sight grid. */
export function setDoorSolid(L: FloorLayout, d: DoorSpec, st: DoorMode) {
  for (const i of d.tiles) L.solid[i] = st === 'open' ? S_NONE : st === 'closed' ? S_DOOR : S_LOCKED;
}
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < FW && y < FH;

/**
 * Does the wall a door sits in run north-south? Windows and neighbouring door tiles (double doors) count as wall;
 * if both axes look like wall (or neither), the open (floor) side decides.
 */
export function doorRunsNS(L: FloorLayout, x: number, y: number): boolean {
  const t = (dx: number, dy: number) => (inBounds(x + dx, y + dy) ? L.tiles[idx(x + dx, y + dy)] : T_WALL);
  const wallish = (v: number) => v === T_WALL || v === T_WINDOW || v === T_DOOR;
  const nsLine = wallish(t(0, -1)) && wallish(t(0, 1)), ewLine = wallish(t(-1, 0)) && wallish(t(1, 0));
  if (nsLine !== ewLine) return nsLine;
  return t(-1, 0) === T_FLOOR || t(1, 0) === T_FLOOR;
}

export function isWalkableTile(L: FloorLayout, tx: number, ty: number, allowLow = false): boolean {
  if (!inBounds(tx, ty)) return false;
  const t = L.tiles[idx(tx, ty)];
  if (t !== T_FLOOR && t !== T_DOOR) return false;
  const s = L.solid[idx(tx, ty)];
  return s === S_NONE || (allowLow && s === S_LOW);
}
export function blocksSight(L: FloorLayout, tx: number, ty: number): boolean {
  if (!inBounds(tx, ty)) return true;
  const t = L.tiles[idx(tx, ty)];
  if (t === T_WALL || t === T_WINDOW || t === T_VOID) return true;
  return L.solid[idx(tx, ty)] >= S_TALL; // tall props and shut doors
}

const SURFACE: Record<RoomType, Surface> = {
  corridor: 'carpet', open: 'carpet', office: 'carpet', kitchen: 'tile', bathroom: 'tile', server: 'metal', security: 'concrete',
  storage: 'concrete', maintenance: 'metal', executive: 'carpet', boardroom: 'carpet', lobby: 'tile', utility: 'concrete', stair: 'concrete',
  elevator: 'metal', mainframe: 'metal', street: 'asphalt', plaza: 'concrete', poker: 'carpet',
};

const LIGHT_COLOR: Partial<Record<RoomType, number>> = {
  office: 0xffe6c4, open: 0xfff0d8, corridor: 0xf4ead8, kitchen: 0xe6f2ff, bathroom: 0xe0f0ff, server: 0x8fc4ff,
  security: 0xffa090, storage: 0xffe0b0, maintenance: 0xffb060, executive: 0xffd49a, boardroom: 0xfff0dc, lobby: 0xfff2dc, utility: 0xffd8a0,
  stair: 0xd8e8d0, elevator: 0xf0f0ff, mainframe: 0x70b0ff,
};

interface Rect { x0: number; y0: number; x1: number; y1: number }

/** Rect stamps of fixed vertical features (identical on every interior floor). */
/** Every door opens onto the bottom landing (south row): the flights always rise / descend northward from it. */
export const STAIR_RECTS: (Rect & { door: [number, number] })[] = [
  { x0: 1, y0: 1, x1: 5, y1: 6, door: [3, 7] }, // NW
  { x0: FW - 6, y0: FH - 7, x1: FW - 2, y1: FH - 2, door: [FW - 7, FH - 2] }, // SE (south side is the outer wall: door west)
  { x0: FW - 6, y0: 1, x1: FW - 2, y1: 6, door: [FW - 4, 7] }, // NE
];
export const ELEV_RECTS: (Rect & { door: [number, number] })[] = [
  { x0: 27, y0: 19, x1: 29, y1: 21, door: [28, 22] },
  { x0: 34, y0: 19, x1: 36, y1: 21, door: [35, 22] },
];
const SPINE: Rect = { x0: 1, y0: 23, x1: FW - 2, y1: 25 };
/** Floor 1 reception foyer: full depth of the south block, centred on the street doors (x 31-32), open to the spine. */
export const FOYER: Rect = { x0: 22, y0: 27, x1: 41, y1: FH - 2 };
/** Reception desk in the foyer: 4 tiles wide, centred on the doors, front facing the entrance (+y). */
export const FOYER_DESK = { x: 30, y: 35, w: 4 };

class Builder {
  L: FloorLayout;
  rng: Rng;
  fixedWall: Uint8Array; // walls that must not be carved by connectivity repair
  reserved: Uint8Array; // tiles kept free of props (door approaches, feature interiors)
  nextId = 1;
  lootMult: number;
  constructor(L: FloorLayout, rng: Rng, lootMult: number) {
    this.L = L;
    this.rng = rng;
    this.fixedWall = new Uint8Array(FW * FH);
    this.reserved = new Uint8Array(FW * FH);
    this.lootMult = lootMult;
  }
  id() { return this.nextId++; }
  room(type: RoomType, r: Rect, main = false): Room {
    const room: Room = { id: this.L.rooms.length, type, x: r.x0, y: r.y0, w: r.x1 - r.x0 + 1, h: r.y1 - r.y0 + 1, surface: SURFACE[type], main };
    this.L.rooms.push(room);
    return room;
  }
  carve(r: Rect, roomId: number, tile = T_FLOOR) {
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        this.L.tiles[idx(x, y)] = tile;
        this.L.roomAt[idx(x, y)] = roomId;
      }
  }
  /** Stamp a walled feature room (stairwell/elevator) with a single door. */
  stampFeature(type: RoomType, r: Rect & { door: [number, number] }): Room {
    const room = this.room(type, r, false);
    for (let y = r.y0 - 1; y <= r.y1 + 1; y++)
      for (let x = r.x0 - 1; x <= r.x1 + 1; x++) {
        if (!inBounds(x, y)) continue;
        const inside = x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
        if (inside) {
          this.L.tiles[idx(x, y)] = T_FLOOR;
          this.L.roomAt[idx(x, y)] = room.id;
          this.reserved[idx(x, y)] = 1;
        } else {
          this.L.tiles[idx(x, y)] = T_WALL;
          this.L.roomAt[idx(x, y)] = -1;
          this.fixedWall[idx(x, y)] = 1;
        }
      }
    const [dx, dy] = r.door;
    this.L.tiles[idx(dx, dy)] = T_DOOR;
    this.fixedWall[idx(dx, dy)] = 0;
    this.reserveAround(dx, dy, 1);
    return room;
  }
  reserveAround(x: number, y: number, r: number) {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (inBounds(x + i, y + j)) this.reserved[idx(x + i, y + j)] = 1;
  }
  walkable(x: number, y: number) {
    return isWalkableTile(this.L, x, y);
  }
  /** BFS over walkable tiles; returns visited mask and count. Hot path (every solid prop placement): typed stack, no allocs. */
  private stack = new Int32Array(FW * FH);
  flood(sx: number, sy: number): { seen: Uint8Array; count: number } {
    const seen = new Uint8Array(FW * FH), st = this.stack;
    const tiles = this.L.tiles, solid = this.L.solid;
    const ok = (n: number) => { const t = tiles[n]; return (t === T_FLOOR || t === T_DOOR) && solid[n] === S_NONE; };
    let sp = 0, count = 0;
    const s0 = idx(sx, sy);
    seen[s0] = 1; st[sp++] = s0;
    while (sp) {
      const c = st[--sp];
      count++;
      const x = c % FW;
      if (x < FW - 1 && !seen[c + 1] && ok(c + 1)) { seen[c + 1] = 1; st[sp++] = c + 1; }
      if (x > 0 && !seen[c - 1] && ok(c - 1)) { seen[c - 1] = 1; st[sp++] = c - 1; }
      if (c + FW < FW * FH && !seen[c + FW] && ok(c + FW)) { seen[c + FW] = 1; st[sp++] = c + FW; }
      if (c - FW >= 0 && !seen[c - FW] && ok(c - FW)) { seen[c - FW] = 1; st[sp++] = c - FW; }
    }
    return { seen, count };
  }
  walkableCount(): number {
    let n = 0;
    for (let i = 0; i < FW * FH; i++) { const t = this.L.tiles[i]; if ((t === T_FLOOR || t === T_DOOR) && this.L.solid[i] === S_NONE) n++; }
    return n;
  }
  /**
   * Connectivity repair: every floor tile must be reachable from (sx,sy). Unreached pockets get
   * a doorway carved along the cheapest path through non-fixed walls.
   */
  connect(sx: number, sy: number) {
    for (let guard = 0; guard < 200; guard++) {
      const { seen } = this.flood(sx, sy);
      let target = -1;
      for (let i = 0; i < FW * FH; i++) {
        const t = this.L.tiles[i];
        if ((t === T_FLOOR || t === T_DOOR) && !seen[i] && this.L.solid[i] === S_NONE) { target = i; break; }
      }
      if (target < 0) return;
      // Dijkstra from target to any seen tile, walls cost more.
      const cost = new Float32Array(FW * FH).fill(Infinity);
      const prev = new Int32Array(FW * FH).fill(-1);
      const open: number[] = [target];
      cost[target] = 0;
      let hit = -1;
      while (open.length) {
        // small grid: linear min extraction is fine
        let bi = 0;
        for (let i = 1; i < open.length; i++) if (cost[open[i]] < cost[open[bi]]) bi = i;
        const c = open.splice(bi, 1)[0];
        if (seen[c]) { hit = c; break; }
        const x = c % FW, y = (c / FW) | 0;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + ox, ny = y + oy;
          if (nx < 1 || ny < 1 || nx > FW - 2 || ny > FH - 2) continue;
          const n = idx(nx, ny);
          if (this.fixedWall[n]) continue;
          const t = this.L.tiles[n];
          const step = t === T_WALL ? 6 : this.L.solid[n] ? 4 : 1;
          const nc = cost[c] + step;
          if (nc < cost[n]) {
            if (cost[n] === Infinity) open.push(n);
            cost[n] = nc;
            prev[n] = c;
          }
        }
      }
      if (hit < 0) {
        // unreachable pocket (fully sealed by fixed walls) - fill it in
        const x = target % FW, y = (target / FW) | 0;
        this.L.tiles[target] = T_WALL;
        this.L.roomAt[idx(x, y)] = -1;
        continue;
      }
      for (let c = hit; c >= 0; c = prev[c]) {
        if (this.L.tiles[c] === T_WALL) this.L.tiles[c] = T_DOOR;
        if (this.L.solid[c]) this.removePropAt(c);
      }
    }
  }
  removePropAt(i: number) {
    const x = i % FW, y = (i / FW) | 0;
    const p = this.L.props.find((p) => x >= Math.floor(p.x - p.w / 2) && x < Math.floor(p.x - p.w / 2) + p.w && y >= Math.floor(p.y - p.h / 2) && y < Math.floor(p.y - p.h / 2) + p.h && p.solid);
    if (!p) { this.L.solid[i] = 0; return; }
    this.L.props.splice(this.L.props.indexOf(p), 1);
    const x0 = Math.round(p.x - p.w / 2), y0 = Math.round(p.y - p.h / 2);
    for (let yy = y0; yy < y0 + p.h; yy++) for (let xx = x0; xx < x0 + p.w; xx++) this.L.solid[idx(xx, yy)] = 0;
    this.L.containers = this.L.containers.filter((c) => !(Math.abs(c.x - p.x) < 0.01 && Math.abs(c.y - p.y) < 0.01));
    this.L.vendings = this.L.vendings.filter((c) => !(Math.abs(c.x - p.x) < 0.01 && Math.abs(c.y - p.y) < 0.01));
  }
  /**
   * Place a prop with footprint w x h at tile (tx,ty) top-left. Fails if the area is not free floor
   * in the given room, overlaps reserved tiles, or would disconnect any walkable tile.
   */
  place(kind: string, tx: number, ty: number, w: number, h: number, solid: number, room: number, rot = 0, check = true): Prop | null {
    for (let y = ty; y < ty + h; y++)
      for (let x = tx; x < tx + w; x++) {
        if (!inBounds(x, y)) return null;
        const i = idx(x, y);
        if (this.L.tiles[i] !== T_FLOOR || this.L.solid[i] || this.reserved[i]) return null;
        if (room >= 0 && this.L.roomAt[i] !== room) return null;
      }
    if (solid) for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) this.L.solid[idx(x, y)] = solid;
    if (solid && check) {
      // must not split the walkable graph
      const total = this.walkableCount();
      let start = -1;
      for (let i = 0; i < FW * FH && start < 0; i++) if (this.walkable(i % FW, (i / FW) | 0)) start = i;
      const ok = start >= 0 && this.flood(start % FW, (start / FW) | 0).count === total;
      if (!ok) {
        for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) this.L.solid[idx(x, y)] = 0;
        return null;
      }
    }
    const p: Prop = { id: this.id(), kind, x: tx + w / 2, y: ty + h / 2, w, h, rot, solid, room };
    this.L.props.push(p);
    return p;
  }
  /** Decorative non-blocking prop. */
  deco(kind: string, x: number, y: number, rot: number, room: number, w = 1, h = 1) {
    this.L.props.push({ id: this.id(), kind, x, y, w, h, rot, solid: 0, room });
  }
  container(kind: ContainerKind, p: Prop) {
    const items = containerLoot(kind, new Rng(hash(this.L.seed, p.id, 0xc0)), this.lootMult);
    this.L.containers.push({ id: p.id, kind, x: p.x, y: p.y, items, room: p.room });
  }
  /** Wall-hugging tiles of a room with the direction the wall is in. */
  wallSpots(room: Room): { x: number; y: number; rot: number }[] {
    const out: { x: number; y: number; rot: number }[] = [];
    for (let y = room.y; y < room.y + room.h; y++)
      for (let x = room.x; x < room.x + room.w; x++) {
        if (this.L.roomAt[idx(x, y)] !== room.id || this.L.tiles[idx(x, y)] !== T_FLOOR) continue;
        const w = (xx: number, yy: number) => inBounds(xx, yy) && (this.L.tiles[idx(xx, yy)] === T_WALL || this.L.tiles[idx(xx, yy)] === T_WINDOW);
        // rot: direction the prop faces (away from wall). 0=+y(south) 1=-x(west) 2=-y(north) 3=+x(east)
        if (w(x, y - 1)) out.push({ x, y, rot: 0 });
        else if (w(x, y + 1)) out.push({ x, y, rot: 2 });
        else if (w(x - 1, y)) out.push({ x, y, rot: 3 });
        else if (w(x + 1, y)) out.push({ x, y, rot: 1 });
      }
    return out;
  }
}

function makeLayout(floor: number, seed: number, darkness: number): FloorLayout {
  return {
    floor, seed, w: FW, h: FH, theme: 'office', darkness,
    tiles: new Uint8Array(FW * FH).fill(T_WALL),
    roomAt: new Int16Array(FW * FH).fill(-1),
    solid: new Uint8Array(FW * FH),
    boarded: new Uint8Array(FW * FH),
    rooms: [], props: [], lights: [], containers: [], vendings: [], cameras: [], traps: [], hazards: [], spawns: [], hacks: [], doors: [],
    stairs: [], elevators: [], portals: [], mainframe: null, ambient: [], anchors: {},
  };
}

// ---------------------------------------------------------------------------------------------
// Room typing
type Theme = 'office' | 'server' | 'executive' | 'maintenance' | 'security' | 'mixed';
const THEME_WEIGHTS: Record<Theme, [RoomType, number][]> = {
  office: [['office', 6], ['kitchen', 2], ['bathroom', 2], ['storage', 1.5], ['security', 1], ['server', 1], ['utility', 1], ['executive', 0.5], ['boardroom', 1.2]],
  server: [['server', 6], ['utility', 2], ['maintenance', 2], ['security', 1.5], ['storage', 1.5], ['bathroom', 1], ['kitchen', 1], ['office', 1]],
  executive: [['executive', 5], ['office', 3], ['boardroom', 2.5], ['kitchen', 2], ['bathroom', 2], ['security', 1.5], ['storage', 1]],
  maintenance: [['maintenance', 5], ['storage', 3], ['utility', 3], ['bathroom', 1], ['kitchen', 1], ['security', 1]],
  security: [['security', 5], ['storage', 2], ['office', 2], ['bathroom', 1.5], ['kitchen', 1.5], ['server', 1]],
  mixed: [['office', 3], ['kitchen', 2], ['bathroom', 2], ['storage', 2], ['security', 2], ['server', 2], ['maintenance', 2], ['utility', 1], ['executive', 1], ['boardroom', 0.8]],
};
function pickTheme(rng: Rng, floor: number): Theme {
  const hi = floor / FINAL_FLOOR;
  return rng.weighted<Theme>([
    ['office', 5 - 2 * hi], ['server', 1.5 + hi * 2], ['executive', 0.4 + hi * 3], ['maintenance', 1.5], ['security', 1 + hi], ['mixed', 2.5],
  ]);
}

// ---------------------------------------------------------------------------------------------
// Standard floor layout: spine corridor + BSP rooms north/south.
function bsp(B: Builder, r: Rect, depth: number, side: 'north' | 'south', leaves: Rect[], corridors: Rect[]) {
  const rng = B.rng;
  const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
  // cross corridors off the spine
  if (depth === 0 && w > 20 && rng.chance(0.85)) {
    const avoid = (c: number) => side === 'north' && c >= 24 && c <= 39; // elevator lobby
    let c = -1;
    for (let tries = 0; tries < 12; tries++) {
      const cand = rng.int(r.x0 + 7, r.x1 - 8);
      if (!avoid(cand) && !avoid(cand + 1)) { c = cand; break; }
    }
    if (c > 0) {
      const cor: Rect = { x0: c, y0: r.y0, x1: c + 1, y1: r.y1 };
      corridors.push(cor);
      bsp(B, { x0: r.x0, y0: r.y0, x1: c - 2, y1: r.y1 }, 1, side, leaves, corridors);
      bsp(B, { x0: c + 3, y0: r.y0, x1: r.x1, y1: r.y1 }, 1, side, leaves, corridors);
      return;
    }
  }
  const minS = 4;
  const canX = w >= minS * 2 + 1, canY = h >= minS * 2 + 1;
  const small = w <= 12 && h <= 10;
  if ((!canX && !canY) || (small && (w * h < 50 || rng.chance(0.4)))) {
    leaves.push(r);
    return;
  }
  const splitX = canX && (!canY || w > h * 1.2 || (w >= h && rng.chance(0.6)));
  if (splitX) {
    const c = rng.int(r.x0 + minS, r.x1 - minS);
    bsp(B, { x0: r.x0, y0: r.y0, x1: c - 1, y1: r.y1 }, depth + 1, side, leaves, corridors);
    bsp(B, { x0: c + 1, y0: r.y0, x1: r.x1, y1: r.y1 }, depth + 1, side, leaves, corridors);
  } else {
    const c = rng.int(r.y0 + minS, r.y1 - minS);
    bsp(B, { x0: r.x0, y0: r.y0, x1: r.x1, y1: c - 1 }, depth + 1, side, leaves, corridors);
    bsp(B, { x0: r.x0, y0: c + 1, x1: r.x1, y1: r.y1 }, depth + 1, side, leaves, corridors);
  }
}

function genInterior(B: Builder, plan: BuildingPlan, floor: number) {
  const L = B.L, rng = B.rng;
  const theme = pickTheme(rng, floor);
  L.theme = floor === 1 ? 'lobby' : floor === FINAL_FLOOR ? 'mainframe' : theme;
  const spine = B.room('corridor', SPINE, true);
  B.carve(SPINE, spine.id);
  const leaves: Rect[] = [];
  const cors: Rect[] = [];
  bsp(B, { x0: 1, y0: 1, x1: FW - 2, y1: 21 }, 0, 'north', leaves, cors);
  if (floor === 1) { // fixed foyer behind the entrance, rooms either side
    bsp(B, { x0: 1, y0: 27, x1: FOYER.x0 - 2, y1: FH - 2 }, 0, 'south', leaves, cors);
    bsp(B, { x0: FOYER.x1 + 2, y0: 27, x1: FW - 2, y1: FH - 2 }, 0, 'south', leaves, cors);
  } else bsp(B, { x0: 1, y0: 27, x1: FW - 2, y1: FH - 2 }, 0, 'south', leaves, cors);
  for (const c of cors) {
    const room = B.room('corridor', c, true);
    B.carve(c, room.id);
    // open into the spine
    const wy = c.y1 === 21 ? 22 : 26;
    B.carve({ x0: c.x0, y0: wy, x1: c.x1, y1: wy }, room.id);
  }
  // choose open-plan main spaces among big leaves
  // a seeded Fisher-Yates, never sort() with a random comparator: engines sort differently (V8 vs Bun's JSC), so the
  // dedicated server and the players' games would generate different floors from the same seed
  const big = rng.shuffle(leaves.filter((r) => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) >= 70));
  const openCount = floor === 1 ? 2 : rng.int(0, 2);
  const openSet = new Set(big.slice(0, openCount));
  const weights = THEME_WEIGHTS[theme];
  let needKitchen = true, needBath = true, haveBoard = false;
  for (const r of leaves) {
    const area = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    let type: RoomType;
    if (openSet.has(r)) type = 'open';
    else if (needBath && area <= 50 && rng.chance(0.5)) { type = 'bathroom'; needBath = false; }
    else if (needKitchen && area >= 20 && area <= 80 && rng.chance(0.5)) { type = 'kitchen'; needKitchen = false; }
    else {
      const rw = r.x1 - r.x0 + 1, rh = r.y1 - r.y0 + 1;
      type = rng.weighted(weights.filter(([t]) => !(t === 'bathroom' && area > 60) && !(t === 'executive' && area < 30) && !(t === 'server' && area < 24) && !(t === 'boardroom' && (haveBoard || Math.max(rw, rh) < 7 || Math.min(rw, rh) < 5 || area > 110))));
    }
    if (type === 'kitchen') needKitchen = false;
    if (type === 'boardroom') haveBoard = true; // one per floor
    if (type === 'bathroom') needBath = false;
    const room = B.room(type, r, type === 'open' || type === 'lobby');
    B.carve(r, room.id);
  }
  // easter egg: floor 8 always has a private poker room (the roomiest enclosed office-type room)
  if (floor === 8) {
    const ok = (r: Room) => ['office', 'executive', 'boardroom', 'storage', 'security', 'utility', 'maintenance', 'server'].includes(r.type) && Math.min(r.w, r.h) >= 5 && Math.max(r.w, r.h) >= 6;
    const pick = L.rooms.filter(ok).sort((a, b) => b.w * b.h - a.w * a.h || a.id - b.id)[0];
    if (pick) { pick.type = 'poker'; pick.surface = SURFACE.poker; }
  }
  if (floor === 1) {
    const foyer = B.room('lobby', FOYER, true);
    B.carve(FOYER, foyer.id);
    B.carve({ x0: 29, y0: 26, x1: 34, y1: 26 }, foyer.id); // wide opening onto the spine, in line with the lifts
  }
  // floor 200: the mainframe hall replaces the middle of the south block
  if (floor === FINAL_FLOOR) {
    const hall: Rect = { x0: 14, y0: 28, x1: 49, y1: 44 };
    for (let y = hall.y0 - 1; y <= hall.y1 + 1; y++) for (let x = hall.x0 - 1; x <= hall.x1 + 1; x++) { L.tiles[idx(x, y)] = T_WALL; L.roomAt[idx(x, y)] = -1; }
    const room = B.room('mainframe', hall, true);
    B.carve(hall, room.id);
    // wide doorways into the hall
    for (const [dx, dy] of [[31, 27], [32, 27], [13, 36], [50, 36], [20, 27], [43, 27]] as [number, number][]) {
      L.tiles[idx(dx, dy)] = T_DOOR;
      L.tiles[idx(dx, 26)] = T_FLOOR;
      if (dy === 27) { L.tiles[idx(dx, 26)] = T_DOOR; }
    }
    L.tiles[idx(12, 36)] = T_FLOOR; L.tiles[idx(51, 36)] = T_FLOOR;
    const cx = 32, cy = 36;
    L.mainframe = {
      x: cx, y: cy, termX: cx, termY: cy + 4.2,
      spawnPoints: [{ x: 31.5, y: 24.5 }, { x: 12.5, y: 36.5 }, { x: 51.5, y: 36.5 }, { x: 20.5, y: 24.5 }, { x: 43.5, y: 24.5 }, { x: 5.5, y: 24.5 }, { x: 58.5, y: 24.5 }],
    };
  }
  // fixed vertical features
  STAIR_RECTS.forEach((r, i) => stampStair(B, r, i));
  ELEV_RECTS.forEach((r, j) => {
    B.stampFeature('elevator', r);
    const e: ElevatorSpec = { index: j, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, cx: (r.x0 + r.x1 + 1) / 2, cy: (r.y0 + r.y1 + 1) / 2, doorX: r.door[0] + 0.5, doorY: r.door[1] + 0.5 };
    L.elevators.push(e);
    L.anchors['elev' + j] = { x: e.cx, y: e.cy };
  });
  // Floor 1 main entrance to the street
  if (floor === 1) {
    for (const x of [31, 32]) { L.tiles[idx(x, FH - 1)] = T_DOOR; B.fixedWall[idx(x, FH - 1)] = 0; }
    B.reserveAround(31, FH - 2, 1); B.reserveAround(32, FH - 2, 1);
    L.portals.push({ x: 32, y: FH - 1.2, target: 0, label: 'Exit to street', arriveTag: 'entrance' });
    L.anchors.entrance = { x: 32, y: FH - 3 };
    // make sure the tiles inside the entrance are floor
    for (const x of [31, 32]) for (let y = FH - 3; y <= FH - 2; y++) if (L.tiles[idx(x, y)] === T_WALL) { L.tiles[idx(x, y)] = T_FLOOR; L.roomAt[idx(x, y)] = L.roomAt[idx(x, FH - 4)]; }
  }
  // doors from rooms to neighbours
  addDoors(B);
  B.connect(32, 24);
  // exterior glazing; higher floors are increasingly boarded
  const boardP = Math.min(0.95, Math.max(0, (floor - 12) / 120));
  for (let x = 0; x < FW; x++)
    for (let y = 0; y < FH; y++) {
      if (!(x === 0 || y === 0 || x === FW - 1 || y === FH - 1)) continue;
      if (L.tiles[idx(x, y)] !== T_WALL) continue;
      const nx = x === 0 ? 1 : x === FW - 1 ? FW - 2 : x, ny = y === 0 ? 1 : y === FH - 1 ? FH - 2 : y;
      const inner = L.tiles[idx(nx, ny)];
      if ((inner === T_FLOOR || inner === T_DOOR) && (x + y) % 5 !== 0) {
        L.tiles[idx(x, y)] = T_WINDOW;
        if (rng.chance(boardP)) L.boarded[idx(x, y)] = 1;
      }
    }
}

/**
 * Stairwell (5 x 6): a flat bottom landing along the south row (the door opens onto it), the up flight on the two
 * west columns and the down pit on the two east columns, each ending in a 2-tile top landing at the north wall.
 * The middle column beside the flights is a solid parapet, so a flight can only be entered from its foot.
 */
function stampStair(B: Builder, r: Rect & { door: [number, number] }, i: number) {
  const L = B.L;
  B.stampFeature('stair', r);
  for (let y = r.y0; y < r.y1; y++) L.solid[idx(r.x0 + 2, y)] = S_TALL;
  const s: StairSpec = {
    index: i, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, cx: (r.x0 + r.x1 + 1) / 2, cy: (r.y0 + r.y1 + 1) / 2,
    doorX: r.door[0] + 0.5, doorY: r.door[1] + 0.5,
    // prompts sit at the foot of each flight (reachable from the landing even when the steps are choked)
    upX: r.x0 + 1.0, upY: r.y1 - 0.5, downX: r.x1, downY: r.y1 - 0.5,
  };
  L.stairs.push(s);
  L.anchors['stair' + i] = { x: s.cx, y: r.y1 + 0.5 }; // arrive on the bottom landing
}

function addDoors(B: Builder) {
  const L = B.L, rng = B.rng;
  for (const room of L.rooms) {
    if (room.type === 'corridor' || room.type === 'stair' || room.type === 'elevator') continue;
    const cands: { x: number; y: number; score: number; other: number }[] = [];
    const tryWall = (wx: number, wy: number, ox: number, oy: number) => {
      if (!inBounds(wx + ox, wy + oy) || wx + ox <= 0 || wy + oy <= 0 || wx + ox >= FW - 1 || wy + oy >= FH - 1) return;
      if (L.tiles[idx(wx, wy)] !== T_WALL || B.fixedWall[idx(wx, wy)]) return;
      const o = idx(wx + ox, wy + oy);
      if (L.tiles[o] !== T_FLOOR) return;
      const other = L.roomAt[o];
      if (other < 0 || other === room.id) return;
      const ot = L.rooms[other];
      if (ot.type === 'stair' || ot.type === 'elevator') return;
      // straight wall segment only (perpendicular neighbours are walls)
      const px = oy !== 0 ? 1 : 0, py = ox !== 0 ? 1 : 0;
      const a = L.tiles[idx(wx + px, wy + py)], b = L.tiles[idx(wx - px, wy - py)];
      if (a !== T_WALL || b !== T_WALL) return;
      cands.push({ x: wx, y: wy, other, score: (ot.main ? 10 : 1) + rng.next() * 3 });
    };
    for (let x = room.x; x < room.x + room.w; x++) {
      tryWall(x, room.y - 1, 0, -1);
      tryWall(x, room.y + room.h, 0, 1);
    }
    for (let y = room.y; y < room.y + room.h; y++) {
      tryWall(room.x - 1, y, -1, 0);
      tryWall(room.x + room.w, y, 1, 0);
    }
    if (room.main) {
      // open plans are porous
      cands.sort((a, b) => b.score - a.score);
      for (const c of cands.slice(0, 4)) { L.tiles[idx(c.x, c.y)] = T_DOOR; B.reserveAround(c.x, c.y, 1); }
      continue;
    }
    cands.sort((a, b) => b.score - a.score);
    const n = room.w * room.h > 60 ? 2 : 1;
    const used = new Set<number>();
    let placed = 0;
    for (const c of cands) {
      if (placed >= n) break;
      if (used.has(c.other) && placed > 0) continue;
      L.tiles[idx(c.x, c.y)] = T_DOOR;
      B.reserveAround(c.x, c.y, 1);
      used.add(c.other);
      placed++;
    }
    // occasional interconnect to a neighbouring side room -> alternate routes
    const extra = cands.find((c) => !used.has(c.other) && !L.rooms[c.other].main);
    if (extra && rng.chance(0.3)) { L.tiles[idx(extra.x, extra.y)] = T_DOOR; B.reserveAround(extra.x, extra.y, 1); }
  }
}

// ---------------------------------------------------------------------------------------------
// Furnishing modules
/** Wall pipe bank along the north wall: services top-down, colour coded by the renderer (see PIPE_SERVICES). */
function pipeBank(B: Builder, room: Room, pool: string[], min: number, max: number) {
  const svc = B.rng.shuffle(pool.slice()).slice(0, B.rng.int(min, max));
  B.deco(`pipes.${svc.join('.')}#${B.rng.int(0, 9999)}`, room.x + room.w / 2, room.y + 0.3, 0, room.id, room.w, 1);
}

/** couch looks (models.ts couch()) */
export const COUCH_KINDS = ['couch', 'couch_leather', 'couch_modular', 'couch_bench', 'couch_armchair'];
/** planter box looks (models.ts planter()) */
export const PLANTER_KINDS = ['planter', 'planter_grass', 'planter_topiary', 'planter_flowers', 'planter_bamboo'];
export const PLANT_KINDS = ['plant', 'palm', 'fern', 'cactus', 'ficus'];
const plantKind = (rng: Rng) => PLANT_KINDS[rng.int(0, PLANT_KINDS.length - 1)];

function furnish(B: Builder, floor: number) {
  const L = B.L, rng = B.rng;
  for (const room of L.rooms) {
    const inner = { x0: room.x, y0: room.y, x1: room.x + room.w - 1, y1: room.y + room.h - 1 };
    const spots = () => rng.shuffle(B.wallSpots(room));
    switch (room.type) {
      case 'office': {
        // desk rows with aisles
        for (let y = inner.y0 + 1; y <= inner.y1 - 1; y += 3)
          for (let x = inner.x0 + 1; x <= inner.x1 - 2; x += 4) {
            const p = B.place('desk', x, y, 2, 1, 1, room.id, 0);
            if (p) { B.deco('chair', p.x, p.y + 0.9, 2, room.id); if (rng.chance(0.3)) B.container('desk', p); if (rng.chance(0.5)) B.deco('monitor', p.x, p.y, 0, room.id); }
          }
        let n = 0;
        for (const s of spots()) { if (n >= 2) break; if (B.place('cabinet', s.x, s.y, 1, 1, 2, room.id, s.rot)) n++; }
        for (const s of spots().slice(0, 1)) { const p = B.place(plantKind(rng), s.x, s.y, 1, 1, 1, room.id); if (p) break; }
        break;
      }
      case 'open':
      case 'lobby': {
        const lobby = room.type === 'lobby';
        if (lobby) {
          // reception desk facing the street doors, two rows of pillars flanking the walk from the door to the desk
          B.place('reception', FOYER_DESK.x, FOYER_DESK.y, FOYER_DESK.w, 1, 1, room.id);
          for (let y = inner.y0 + 3; y <= inner.y1 - 3; y += 6) for (const x of [inner.x0 + 3, inner.x1 - 3]) B.place('pillar', x, y, 1, 1, 2, room.id);
          for (let i = 0; i < 4; i++) { const s = spots()[0]; if (s) B.place(rng.chance(0.5) ? PLANTER_KINDS[rng.int(0, PLANTER_KINDS.length - 1)] : COUCH_KINDS[rng.int(0, COUCH_KINDS.length - 1)], s.x, s.y, 1, 1, 1, room.id, s.rot); }
          for (let i = 0; i < 3; i++) { const s = spots()[0]; if (s) B.place(plantKind(rng), s.x, s.y, 1, 1, 1, room.id); }
          for (const s of spots().slice(0, 2)) if (B.place('couch_bench', s.x, s.y, 1, 1, 1, room.id, s.rot)) break; // waiting-area seating
        } else {
          for (let y = inner.y0 + 2; y <= inner.y1 - 2; y += 6) for (let x = inner.x0 + 2; x <= inner.x1 - 2; x += 7) B.place('pillar', x, y, 1, 1, 2, room.id); // pillars grid
          // cubicle clusters (low cover)
          for (let y = inner.y0 + 1; y <= inner.y1 - 2; y += 4)
            for (let x = inner.x0 + 1; x <= inner.x1 - 3; x += 5) {
              if (rng.chance(0.2)) continue;
              const p = B.place('cubicle', x, y, 2, 2, 1, room.id);
              if (p && rng.chance(0.25)) B.container('desk', p);
            }
        }
        if (!lobby && rng.chance(0.45)) for (const s of spots().slice(0, 1)) B.place(COUCH_KINDS[rng.int(0, COUCH_KINDS.length - 1)], s.x, s.y, 1, 1, 1, room.id, s.rot); // breakout seating
        if (!lobby) for (const s of spots().slice(0, rng.int(1, 3))) B.place(PLANTER_KINDS[rng.int(0, PLANTER_KINDS.length - 1)], s.x, s.y, 1, 1, 1, room.id, s.rot);
        const vs = spots()[0];
        if (vs && rng.chance(0.6)) addVending(B, vs, room.id, floor);
        break;
      }
      case 'kitchen': {
        if (rng.chance(0.5)) pipeBank(B, room, ['gas', 'water'], 1, 2);
        let n = 0;
        for (const s of spots()) {
          if (n > 4) break;
          const kind = n === 0 ? 'fridge' : n === 1 ? 'vending' : n === 2 ? 'kitchensink' : 'counter';
          if (kind === 'vending') { if (addVending(B, s, room.id, floor)) n++; continue; }
          const p = B.place(kind, s.x, s.y, 1, 1, kind === 'fridge' ? 2 : 1, room.id, s.rot);
          if (p) { n++; if (kind === 'fridge') B.container('fridge', p); }
        }
        const cx = Math.floor((inner.x0 + inner.x1) / 2), cy = Math.floor((inner.y0 + inner.y1) / 2);
        const t = B.place('table', cx - 1, cy, 2, 1, 1, room.id);
        if (t) { B.deco('chair', t.x - 0.5, t.y - 0.9, 0, room.id); B.deco('chair', t.x + 0.5, t.y + 0.9, 2, room.id); }
        const mc = spots()[0];
        if (mc) { const p = B.place('medcab', mc.x, mc.y, 1, 1, 1, room.id, mc.rot); if (p) B.container('medcab', p); }
        break;
      }
      case 'bathroom': {
        if (true) pipeBank(B, room, ['water', 'graywater', 'sewage'], 2, 3);
        // toilets (cubicles, or a bare toilet in a tiny washroom), sinks, sometimes a shower and a urinal row
        const tiny = room.w * room.h <= 9;
        const fit: [string, number][] = [[tiny ? 'toilet' : 'stall', 2], [tiny ? '' : 'stall', 2], ['sink', 1], [rng.chance(0.5) ? 'sink' : '', 1], [rng.chance(0.55) ? 'shower' : '', 2]];
        if (!tiny && rng.chance(0.5)) fit.push(['urinal', 1], ['urinal', 1], [rng.chance(0.5) ? 'urinal' : '', 1]);
        fit.push(['medcab', 1]);
        for (const [kind, solid] of fit) {
          if (!kind) continue;
          for (const s of spots()) { const p = B.place(kind, s.x, s.y, 1, 1, solid, room.id, s.rot); if (p) { if (kind === 'medcab') B.container('medcab', p); break; } }
        }
        break;
      }
      case 'server': {
        const vertical = room.h > room.w;
        if (vertical) {
          for (let x = inner.x0 + 1; x <= inner.x1 - 1; x += 3) for (let y = inner.y0 + 1; y <= inner.y1 - 3; y += 4) B.place('rack', x, y, 1, 3, 2, room.id, 1);
        } else {
          for (let y = inner.y0 + 1; y <= inner.y1 - 1; y += 3) for (let x = inner.x0 + 1; x <= inner.x1 - 3; x += 4) B.place('rack', x, y, 3, 1, 2, room.id, 0);
        }
        const s = spots()[0];
        if (s) { const p = B.place('toolbox', s.x, s.y, 1, 1, 1, room.id, s.rot); if (p) B.container('toolbox', p); }
        break;
      }
      case 'security': {
        const cx = Math.floor((inner.x0 + inner.x1) / 2) - 1, cy = Math.floor((inner.y0 + inner.y1) / 2);
        const d = B.place('secdesk', cx, cy, 3, 1, 1, room.id);
        if (d) B.deco('monitors', d.x, d.y, 0, room.id);
        let n = 0;
        for (const s of spots()) { if (n >= 3) break; const p = B.place('locker', s.x, s.y, 1, 1, 2, room.id, s.rot); if (p) { n++; B.container('locker', p); } }
        break;
      }
      case 'storage': {
        let n = 0;
        for (const s of spots()) { if (n >= 5) break; if (B.place('shelf', s.x, s.y, 1, 1, 2, room.id, s.rot)) n++; }
        if (rng.chance(0.5)) for (const s of spots().slice(0, 1)) B.place('barrel', s.x, s.y, 1, 1, 1, room.id, s.rot);
        for (let i = 0; i < 3; i++) {
          const x = rng.int(inner.x0 + 1, Math.max(inner.x0 + 1, inner.x1 - 1)), y = rng.int(inner.y0 + 1, Math.max(inner.y0 + 1, inner.y1 - 1));
          const p = B.place('crate', x, y, 1, 1, 1, room.id);
          if (p) B.container('crate', p);
        }
        break;
      }
      case 'maintenance': {
        const cx = Math.floor((inner.x0 + inner.x1) / 2) - 1, cy = Math.floor((inner.y0 + inner.y1) / 2) - 1;
        B.place('generator', cx, cy, 2, 2, 2, room.id);
        for (const s of spots().slice(0, rng.int(1, 2))) B.place('barrel', s.x, s.y, 1, 1, 1, room.id, s.rot);
        let n = 0;
        for (const s of spots()) { if (n >= 3) break; const k = n === 0 ? 'toolbox' : 'boiler'; const p = B.place(k, s.x, s.y, 1, 1, k === 'boiler' ? 2 : 1, room.id, s.rot); if (p) { n++; if (k === 'toolbox') B.container('toolbox', p); } }
        pipeBank(B, room, ['steam', 'water', 'fuel', 'air', 'fire', 'sewage'], 2, 3);
        break;
      }
      case 'poker': {
        // green-felt oval for three: the winner (south seat, facing the camera) behind a royal flush and every chip
        // centre of the room if free, else the nearest spot that leaves room for the chairs (1 tile all round)
        const cx = room.x + Math.floor((room.w - 3) / 2), cy = room.y + Math.floor((room.h - 2) / 2);
        const at: [number, number][] = [];
        for (let y = room.y + 2; y <= room.y + room.h - 4; y++) for (let x = room.x + 1; x <= room.x + room.w - 4; x++) at.push([x, y]);
        at.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
        let t: Prop | null = null;
        for (const [x, y] of at) if ((t = B.place('pokertable', x, y, 3, 2, 1, room.id))) break;
        if (t) {
          B.deco('pokerchair', t.x, t.y + 1.45, 2, room.id);
          B.deco('pokerchair', t.x - 1.05, t.y - 1.3, 0, room.id);
          B.deco('pokerchair', t.x + 1.05, t.y - 1.3, 0, room.id);
          B.deco('pokerrug', t.x, t.y, 0, room.id, 5, 4);
        }
        const s = spots();
        if (s[0]) B.place('barcart', s[0].x, s[0].y, 1, 1, 1, room.id, s[0].rot);
        if (s[1]) B.place(plantKind(rng), s[1].x, s[1].y, 1, 1, 1, room.id);
        if (s[2]) B.place('credenza', s[2].x, s[2].y, 1, 1, 1, room.id, s[2].rot);
        break;
      }
      case 'boardroom': {
        // long table on the room's long axis, chairs down both sides and at the ends, TV on an end wall
        const along = room.w >= room.h;
        const len = Math.min(8, (along ? room.w : room.h) - 3), wid = (along ? room.h : room.w) >= 7 ? 3 : 2;
        const tw = along ? len : wid, th = along ? wid : len;
        const tx = room.x + Math.floor((room.w - tw) / 2), ty = room.y + Math.floor((room.h - th) / 2);
        const t = B.place('boardtable', tx, ty, tw, th, 1, room.id);
        if (t) {
          for (let k = 0; k < len - 1; k++) {
            const u = -len / 2 + 1 + k;
            const off = wid / 2 + 0.4;
            if (along) { B.deco('chair', t.x + u, t.y - off, 0, room.id); B.deco('chair', t.x + u, t.y + off, 2, room.id); }
            else { B.deco('chair', t.x - off, t.y + u, 3, room.id); B.deco('chair', t.x + off, t.y + u, 1, room.id); }
          }
          // head of the table, then the TV on the wall at the far end
          if (along) B.deco('chair', t.x - len / 2 - 0.55, t.y, 3, room.id); else B.deco('chair', t.x, t.y - len / 2 - 0.55, 0, room.id);
          const end = along ? { x: room.x + room.w - 1, y: Math.floor(t.y), rot: 1 } : { x: Math.floor(t.x), y: room.y + room.h - 1, rot: 2 };
          B.deco('tvwall', end.x + 0.5, end.y + 0.5, end.rot, room.id);
        }
        for (const s of spots().slice(0, 1)) B.place('credenza', s.x, s.y, 1, 1, 1, room.id, s.rot);
        for (const s of spots().slice(0, 1)) B.place(plantKind(rng), s.x, s.y, 1, 1, 1, room.id);
        break;
      }
      case 'executive': {
        const cx = Math.floor((inner.x0 + inner.x1) / 2) - 1, cy = Math.floor((inner.y0 + inner.y1) / 2);
        B.place('execdesk', cx, cy, 3, 1, 1, room.id);
        for (const s of spots().slice(0, 1)) B.place(plantKind(rng), s.x, s.y, 1, 1, 1, room.id);
        for (const s of spots().slice(0, 1)) B.place(rng.chance(0.5) ? 'couch_leather' : 'couch_armchair', s.x, s.y, 1, 1, 1, room.id, s.rot);
        let n = 0;
        for (const s of spots()) {
          if (n >= 4) break;
          const k = n === 0 ? 'safe' : n === 1 ? ['couch', 'couch_leather', 'couch_modular'][rng.int(0, 2)] : 'bookshelf';
          const p = B.place(k, s.x, s.y, 1, 1, k === 'bookshelf' ? 2 : 1, room.id, s.rot);
          if (p) { n++; if (k === 'safe' && rng.chance(0.7)) B.container('safe', p); }
        }
        break;
      }
      case 'utility': {
        if (true) pipeBank(B, room, ['fire', 'water', 'gas', 'air'], 2, 3);
        let n = 0;
        for (const s of spots()) { if (n >= 3) break; const k = n === 0 ? 'panel' : n === 1 ? 'heater' : 'crate'; const p = B.place(k, s.x, s.y, 1, 1, k === 'crate' ? 1 : 2, room.id, s.rot); if (p) { n++; if (k === 'crate') B.container('crate', p); } }
        for (const s of spots().slice(0, rng.int(0, 2))) B.place('barrel', s.x, s.y, 1, 1, 1, room.id, s.rot);
        break;
      }
      case 'corridor': {
        if (room.w > 6 && rng.chance(0.5)) {
          // corridor vending/planters against the wall
          const s = spots()[0];
          if (s && rng.chance(0.5)) addVending(B, s, room.id, floor);
        }
        break;
      }
      case 'mainframe': {
        const m = L.mainframe!;
        B.place('mainframe', m.x - 2, m.y - 2, 4, 4, 2, room.id, 0, false);
        B.place('terminal', Math.floor(m.termX), Math.floor(m.termY), 1, 1, 1, room.id, 0, false);
        // cover pillars and barricades for the defence
        for (const [x, y] of [[20, 31], [43, 31], [20, 41], [43, 41], [26, 34], [37, 34], [26, 39], [37, 39]]) B.place(rng.chance(0.5) ? 'barricade' : 'pillar', x, y, 2, 1, rng.chance(0.5) ? 1 : 2, room.id);
        for (const [x, y] of [[16, 30], [47, 30], [16, 42], [47, 42]]) { const p = B.place('crate', x, y, 1, 1, 1, room.id); if (p) B.container('crate', p); }
        break;
      }
      default:
        break;
    }
  }
}

function addVending(B: Builder, s: { x: number; y: number; rot: number }, room: number, floor: number): boolean {
  const p = B.place('vending', s.x, s.y, 1, 1, 2, room, s.rot);
  if (!p) return false;
  B.L.vendings.push({ id: p.id, x: p.x, y: p.y, rot: s.rot, drops: vendingLoot(new Rng(hash(B.L.seed, p.id, 0x7e)), B.lootMult), price: new Rng(hash(B.L.seed, p.id, 0x7f)).int(2, 5) });
  return true;
}

// ---------------------------------------------------------------------------------------------
function addLights(B: Builder, floor: number) {
  const L = B.L, rng = B.rng;
  const broken = Math.min(0.7, 0.04 + 0.0035 * floor);
  const flick = Math.min(0.8, 0.14 + 0.003 * floor);
  for (const room of L.rooms) {
    if (room.type === 'street' || room.type === 'plaza') continue;
    const color = LIGHT_COLOR[room.type] ?? 0xffffff;
    const pts: [number, number][] = [];
    if (room.type === 'corridor') {
      const long = room.w > room.h;
      const len = long ? room.w : room.h;
      for (let t = 3; t < len; t += 8) pts.push(long ? [room.x + t, room.y + room.h / 2] : [room.x + room.w / 2, room.y + t]);
    } else {
      const nx = Math.max(1, Math.round(room.w / 7)), ny = Math.max(1, Math.round(room.h / 7));
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts.push([room.x + (room.w * (i + 0.5)) / nx, room.y + (room.h * (j + 0.5)) / ny]);
    }
    for (const [x, y] of pts) {
      const isEmergency = room.type !== 'mainframe' && floor > 60 && rng.chance(Math.min(0.5, (floor - 60) / 250));
      L.lights.push({
        id: B.id(), x, y, room: room.id, kind: isEmergency ? 'emergency' : 'ceiling',
        color: isEmergency ? 0xff3322 : color,
        intensity: isEmergency ? 0.8 : room.type === 'stair' || room.type === 'elevator' ? 0.9 : 1.2,
        range: room.type === 'corridor' ? 7 : Math.max(6, Math.min(10, Math.max(room.w, room.h) * 0.8)),
        flicker: rng.chance(flick) ? rng.range(0.3, 1) : 0,
        broken: room.type !== 'mainframe' && rng.chance(broken),
      });
    }
  }
}

function wallMounts(B: Builder, roomFilter: (r: Room) => boolean): { x: number; y: number; angle: number }[] {
  const L = B.L;
  const out: { x: number; y: number; angle: number }[] = [];
  for (const room of L.rooms) {
    if (!roomFilter(room)) continue;
    for (const s of B.wallSpots(room)) {
      if (B.reserved[idx(s.x, s.y)]) continue;
      // mount on the wall, facing into the room
      const ang = [Math.PI / 2, Math.PI, -Math.PI / 2, 0][s.rot];
      const ox = [0, 0.45, 0, -0.45][s.rot], oy = [-0.45, 0, 0.45, 0][s.rot];
      out.push({ x: s.x + 0.5 + ox, y: s.y + 0.5 + oy, angle: ang });
    }
  }
  return out;
}

function addHazardsAndCameras(B: Builder, floor: number, diff: Difficulty) {
  const L = B.L, rng = B.rng;
  const p = pressure(diff, floor);
  const anchors = Object.values(L.anchors);
  const farFromAnchors = (x: number, y: number, d: number) => anchors.every((a) => Math.hypot(a.x - x, a.y - y) > d);
  // CCTV
  const camCount = Math.min(10, Math.round((1.2 + p.bracket * 0.35) * p.hazard));
  const mounts = rng.shuffle(wallMounts(B, (r) => r.type !== 'stair' && r.type !== 'elevator' && r.type !== 'bathroom'));
  for (const m of mounts) {
    if (L.cameras.length >= camCount) break;
    if (!farFromAnchors(m.x, m.y, 6)) continue;
    if (L.cameras.some((c) => Math.hypot(c.x - m.x, c.y - m.y) < 9)) continue;
    const sweeping = rng.chance(0.45 + p.bracket * 0.01);
    L.cameras.push({ id: B.id(), x: m.x, y: m.y, angle: m.angle, sweep: sweeping ? rng.range(0.5, 1.05) : 0, speed: rng.range(0.35, 0.7), phase: rng.range(0, 6.28), range: rng.range(8.5, 12), fov: 0.26 });
  }
  if (floor < 1) return;
  // booby traps
  if (floor >= 3) {
    const trapCount = Math.min(9, Math.round((0.6 + p.bracket * 0.35) * p.hazard));
    const doors: { x: number; y: number; vertical: boolean }[] = [];
    for (let y = 1; y < FH - 1; y++)
      for (let x = 1; x < FW - 1; x++) {
        if (L.tiles[idx(x, y)] !== T_DOOR) continue;
        const vertical = L.tiles[idx(x, y - 1)] === T_WALL && L.tiles[idx(x, y + 1)] === T_WALL; // wall runs N-S; passage E-W
        const horizontal = L.tiles[idx(x - 1, y)] === T_WALL && L.tiles[idx(x + 1, y)] === T_WALL;
        if ((vertical || horizontal) && farFromAnchors(x, y, 5)) doors.push({ x, y, vertical });
      }
    rng.shuffle(doors);
    let t = 0;
    for (const d of doors) {
      if (t >= Math.ceil(trapCount * 0.6)) break;
      if (L.traps.some((q) => Math.hypot(q.x - d.x, q.y - d.y) < 4)) continue;
      if (d.vertical) L.traps.push({ id: B.id(), kind: 'tripwire', x: d.x + 0.5, y: d.y + 0.02, x2: d.x + 0.5, y2: d.y + 0.98 });
      else L.traps.push({ id: B.id(), kind: 'tripwire', x: d.x + 0.02, y: d.y + 0.5, x2: d.x + 0.98, y2: d.y + 0.5 });
      t++;
    }
    for (let i = 0; i < trapCount - t; i++) {
      for (let k = 0; k < 20; k++) {
        const x = rng.int(2, FW - 3), y = rng.int(2, FH - 3);
        if (!isWalkableTile(L, x, y) || B.reserved[idx(x, y)] || !farFromAnchors(x, y, 6)) continue;
        L.traps.push({ id: B.id(), kind: 'mine', x: x + 0.5, y: y + 0.5, x2: 0, y2: 0 });
        break;
      }
    }
  }
  // environmental hazards (burning debris, live wires)
  if (floor >= 12) {
    const hz = Math.min(7, Math.round((floor / 40) * p.hazard));
    for (let i = 0; i < hz; i++) {
      for (let k = 0; k < 20; k++) {
        const x = rng.int(2, FW - 3), y = rng.int(2, FH - 3);
        if (!isWalkableTile(L, x, y) || B.reserved[idx(x, y)] || !farFromAnchors(x, y, 5)) continue;
        const kind = rng.chance(0.55) ? 'fire' : 'shock';
        L.hazards.push({ id: B.id(), kind, x: x + 0.5, y: y + 0.5, r: kind === 'fire' ? 0.9 : 1.1 });
        if (kind === 'fire') L.lights.push({ id: B.id(), x: x + 0.5, y: y + 0.5, color: 0xff7a2a, intensity: 1.3, range: 6, flicker: 1, broken: false, room: L.roomAt[idx(x, y)], kind: 'fire' });
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
const ENEMY_COST: Record<EnemyType, number> = { loyalist: 1, dog: 0.8, cyborg: 1.6, dogcyborg: 1.3, drone: 1.2, warden: 4 };
const LOYALIST_GUNS = ['p9', 'm18', 'k45', 'mpx9', 'br12', 'sr4', 'fb25', 'mag12', 'ap18'];
const CYBORG_GUNS = ['sr4', 'aro', 'pdw50', 'a12', 'dmr20', 'lmg249', 'vx45', 'hc50'];

function enemyMix(floor: number): [EnemyType, number][] {
  const mix: [EnemyType, number][] = [['loyalist', Math.max(1.5, 8 - floor / 18)]];
  if (floor >= 3) mix.push(['dog', 2.2]);
  if (floor >= 6) mix.push(['drone', 1 + floor / 60]);
  if (floor >= 11) mix.push(['cyborg', 1.5 + floor / 22]);
  if (floor >= 21) mix.push(['dogcyborg', 1 + floor / 45]);
  if (floor >= 41) mix.push(['warden', 0.4 + floor / 110]);
  return mix;
}

function addSpawns(B: Builder, floor: number, diff: Difficulty) {
  const L = B.L, rng = B.rng;
  const p = pressure(diff, floor);
  const anchors = Object.values(L.anchors);
  const freeTile = (room: Room | null, minAnchor = 9): { x: number; y: number } | null => {
    for (let k = 0; k < 40; k++) {
      let x: number, y: number;
      if (room) { x = rng.int(room.x, room.x + room.w - 1); y = rng.int(room.y, room.y + room.h - 1); }
      else { x = rng.int(1, FW - 2); y = rng.int(1, FH - 2); }
      if (!isWalkableTile(L, x, y)) continue;
      const rt = L.rooms[L.roomAt[idx(x, y)]]?.type;
      if (rt === 'stair' || rt === 'elevator' || rt === 'mainframe') continue;
      if (anchors.some((a) => Math.hypot(a.x - x, a.y - y) < minAnchor)) continue;
      return { x: x + 0.5, y: y + 0.5 };
    }
    return null;
  };
  let budget = floor === 0 ? 4 * p.density : Math.min(30, (3.5 + p.bracket * 1.25 + (floor % 10) * 0.12) * p.density);
  if (floor === FINAL_FLOOR) budget *= 0.5;
  const mix = floor === 0 ? ([['loyalist', 5], ['dog', 1]] as [EnemyType, number][]) : enemyMix(floor);
  const rooms = L.rooms.filter((r) => !['stair', 'elevator', 'mainframe'].includes(r.type));
  let squad = 0;
  let guard = 0;
  while (budget > 0.5 && guard++ < 60 && L.spawns.length < 28) {
    const type = rng.weighted(mix);
    const size = type === 'warden' ? 1 : type === 'dog' || type === 'dogcyborg' ? rng.int(1, 3) : type === 'drone' ? rng.int(1, 2) : rng.int(1, 3);
    const room = rng.pick(rooms);
    const base = freeTile(room.w * room.h > 8 ? room : null);
    if (!base) continue;
    squad++;
    const behavior: SpawnSpec['behavior'] =
      type === 'drone' || type === 'warden' ? 'patrol'
      : type === 'dog' || type === 'dogcyborg' ? (rng.chance(0.4) ? 'sleep' : 'wander')
      : rng.weighted([['patrol', 3], ['guard', 2], ['wander', 1]]);
    const route: { x: number; y: number }[] = [base];
    if (behavior === 'patrol') for (let i = 0; i < rng.int(2, 3); i++) { const q = freeTile(rng.pick(rooms), 4); if (q) route.push(q); }
    for (let i = 0; i < size && budget > 0; i++) {
      const ox = rng.range(-1.2, 1.2), oy = rng.range(-1.2, 1.2);
      let x = base.x + ox, y = base.y + oy;
      if (!isWalkableTile(L, Math.floor(x), Math.floor(y))) { x = base.x; y = base.y; }
      const elite = floor > 100 && (type === 'cyborg' || type === 'loyalist') && rng.chance(Math.min(0.6, (floor - 100) / 150));
      const gunPool = type === 'cyborg' ? CYBORG_GUNS : LOYALIST_GUNS;
      const wpn = type === 'loyalist' || type === 'cyborg' ? rng.pick(floor < 8 && type === 'loyalist' ? ['p9', 'm18', 'k45', 'mpx9'] : gunPool) : type === 'drone' ? 'drone_gun' : type === 'warden' ? 'warden_mg' : 'bite';
      L.spawns.push({ type, x, y, squad, behavior, route, elite, weapon: wpn });
      budget -= ENEMY_COST[type];
    }
  }
}

// ---------------------------------------------------------------------------------------------
/**
 * Street level: a police-cordoned staging area in daylight. It is a safe zone: no hostiles, CCTV,
 * traps or hazards. SWAT vans, patrol cars with light bars, a command tent, crime-scene tape and
 * sawhorses funnel the squad toward the tower entrance.
 */
function genStreet(B: Builder) {
  const L = B.L, rng = B.rng;
  L.theme = 'street';
  const plaza = B.room('plaza', { x0: 1, y0: 12, x1: FW - 2, y1: 19 }, true);
  B.carve({ x0: 1, y0: 12, x1: FW - 2, y1: 19 }, plaza.id);
  const street = B.room('street', { x0: 1, y0: 20, x1: FW - 2, y1: FH - 2 }, true);
  B.carve({ x0: 1, y0: 20, x1: FW - 2, y1: FH - 2 }, street.id);
  // tower facade occupies y 0..11 (walls); entrance doors
  for (const x of [31, 32]) { L.tiles[idx(x, 11)] = T_DOOR; B.fixedWall[idx(x, 11)] = 0; }
  B.reserveAround(31, 12, 1); B.reserveAround(32, 12, 1);
  L.portals.push({ x: 32, y: 11.6, target: 1, label: 'Breach the tower', arriveTag: 'entrance' });
  L.anchors.street = { x: 32, y: 13.5 };
  L.anchors.start = { x: 32, y: FH - 4 };
  L.anchors.entrance = { x: 32, y: 13.4 }; // walking out of the tower lands you just outside its doors
  B.reserveAround(32, FH - 4, 2);
  // keep a clear approach lane from the start to the entrance
  for (let y = 12; y < FH - 2; y++) for (let x = 29; x <= 34; x++) B.reserved[idx(x, y)] = 1;
  // inner cordon across the plaza: crime-scene tape with a sawhorse-flanked gap at the entrance lane
  for (let x = 2; x + 3 <= 28; x += 3) B.place('tape', x, 18, 3, 1, 1, -1);
  for (let x = 35; x + 3 <= FW - 2; x += 3) B.place('tape', x, 18, 3, 1, 1, -1);
  B.place('sawhorse', 27, 18, 2, 1, 1, -1);
  B.place('sawhorse', 35, 17, 2, 1, 1, -1);
  // outer tape along the street edges
  for (let y = 21; y + 3 <= FH - 3; y += 3) { B.deco('tapeline', 1.6, y + 1.5, 1, -1, 1, 3); B.deco('tapeline', FW - 1.6, y + 1.5, 1, -1, 1, 3); }
  // jersey barriers in front of the facade
  for (const x of [8, 15, 22, 40, 47, 54]) B.place('barrier', x, 13, 3, 1, 1, -1);
  // SWAT vans and patrol cars staged in the street
  const vehicles: [string, number, number, boolean][] = [
    ['swatvan', 6, 23, true], ['swatvan', 11, 24, true], ['swatvan', 47, 23, true], ['swatvan', 52, 25, true],
    ['policecar', 19, 30, false], ['policecar', 39, 29, false], ['policecar', 7, 35, false], ['policecar', 50, 36, false],
  ];
  for (const [kind, x, y, vert] of vehicles) {
    const p = B.place(kind, x + rng.int(-1, 1), y + rng.int(-1, 1), vert ? 2 : 4, vert ? 4 : 2, 1, -1, vert ? 1 : 0);
    if (!p) continue;
    // roof light bar: red on one side, blue on the other, strobing out of step with the other vehicles
    const roof = kind === 'swatvan' ? 2.36 : 1.44;
    const phase = rng.next();
    const ox = vert ? 0.3 : 0, oy = vert ? 0 : 0.3; // the bar runs across the vehicle's width
    L.lights.push({ id: B.id(), x: p.x - ox, y: p.y - oy, z: roof, phase, color: 0xff2020, intensity: 1.0, range: 7, flicker: 0, broken: false, room: street.id, kind: 'police' });
    L.lights.push({ id: B.id(), x: p.x + ox, y: p.y + oy, z: roof, phase, color: 0x2050ff, intensity: 1.0, range: 7, flicker: 0, broken: false, room: street.id, kind: 'police' });
  }
  // command post: tent, briefing table, supply crate
  B.place('tent', 38, 39, 4, 3, 2, -1);
  B.place('table', 43, 40, 2, 1, 1, -1);
  const sc = B.place('crate', 36, 42, 1, 1, 1, -1);
  if (sc) L.containers.push({ id: sc.id, kind: 'crate', x: sc.x, y: sc.y, room: -1, items: [{ k: 'ammo', ammo: 'pistol', n: 24 }, { k: 'item', item: 'battery', n: 1 }] });
  for (const [x, y] of [[4, 44], [59, 44], [25, 22], [40, 22]]) {
    const f = B.place('floodlight', x, y, 1, 1, 2, -1);
    // the tower lamp; the renderer only lights it at night (Halloween) so the daytime street keeps its look
    if (f) L.lights.push({ id: B.id(), x: f.x, y: f.y, color: 0xffd8a8, intensity: 1.6, range: 13, flicker: 0, broken: false, room: street.id, kind: 'street' });
  }
  // traffic cones along the approach lane
  for (let y = 22; y < FH - 6; y += 3) { B.deco('cone', 28.6, y + 0.5, 0, -1); B.deco('cone', 35.4, y + 0.5, 0, -1); }
  for (let i = 0; i < 8; i++) B.deco('cone', rng.range(4, FW - 4), rng.range(21, FH - 4), 0, -1);
  B.connect(32, FH - 4);
  addStreetLife(B);
}

/**
 * Where a street officer is at time t (pure, shared by the renderer and the sim's talk prompts so both agree).
 * Patrols walk their line out and back with a pause; others turn in place.
 */
export function officerPose(s: Extract<AmbientSpec, { kind: 'officer' }>, t: number): { x: number; y: number; face: number; moving: boolean } {
  const tt = t + s.seed * 100;
  if (s.mode === 'patrol') {
    const len = Math.hypot(s.x2 - s.x, s.y2 - s.y), speed = 1.25, pause = 3;
    const leg = len / speed + pause;
    let u = tt % (2 * leg);
    const out = u < leg;
    if (!out) u -= leg;
    const k = Math.min(1, u / (len / speed));
    const f = out ? k : 1 - k;
    const dir = Math.atan2(s.y2 - s.y, s.x2 - s.x) + (out ? 0 : Math.PI);
    return { x: s.x + (s.x2 - s.x) * f, y: s.y + (s.y2 - s.y) * f, face: k < 1 ? dir : dir + Math.sin(tt * 0.8) * 0.6, moving: k < 1 };
  }
  const face = s.mode === 'guard' ? s.facing + Math.sin(tt * 0.23) * 0.5 + Math.sin(tt * 0.07) * 0.3
    : s.mode === 'lean' || s.mode === 'brief' ? s.facing + Math.sin(tt * 0.15) * 0.25 : s.facing;
  return { x: s.x, y: s.y, face, moving: false };
}

/** Uniformed officers holding the cordon, plus pigeons and rats, for atmosphere only. */
function addStreetLife(B: Builder) {
  const L = B.L, rng = B.rng;
  const open = (x: number, y: number) => isWalkableTile(L, Math.floor(x), Math.floor(y));
  const clearLine = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.3);
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n, y = y0 + ((y1 - y0) * k) / n;
      for (const [dx, dy] of [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]) if (!open(x + dx, y + dy)) return false;
    }
    return true;
  };
  const officer = (mode: 'guard' | 'talk' | 'patrol' | 'lean' | 'brief', x: number, y: number, facing: number, x2 = x, y2 = y) => {
    if (!open(x, y) || (mode === 'patrol' && !clearLine(x, y, x2, y2))) return false;
    L.ambient.push({ kind: 'officer', mode, x, y, x2, y2, facing, seed: rng.next(), npc: L.ambient.filter((a) => a.kind === 'officer').length });
    return true;
  };
  // two officers holding the cordon gap, facing the street
  officer('guard', 28.5, 19.6, Math.PI / 2);
  officer('guard', 35.5, 19.6, Math.PI / 2);
  // a pair chatting near the command tent, and one briefing at the table
  officer('talk', 36.4, 37.4, -0.35);
  officer('talk', 37.6, 36.9, Math.PI - 0.35);
  officer('brief', 44, 41.6, -Math.PI / 2);
  // front of the tower: door guards, a chat by the barriers, a briefing huddle and a plaza patrol
  officer('guard', 29.4, 13.3, Math.PI / 2);
  officer('guard', 34.6, 13.3, Math.PI / 2);
  officer('talk', 19.3, 15.4, 0.2);
  officer('talk', 20.6, 15.7, Math.PI + 0.2);
  officer('brief', 44.5, 15.2, Math.PI / 2 + 0.4);
  officer('talk', 43.5, 16.4, -0.9);
  officer('talk', 45.6, 16.5, Math.PI + 0.7);
  officer('lean', 9.5, 14.5, -Math.PI / 2);
  officer('guard', 52.5, 15.8, Math.PI / 2 - 0.3);
  for (const [x0, x1] of [[3, 26], [38, 60]]) if (!officer('patrol', x0 + 0.5, 16.8, 0, x1 + 0.5, 16.8)) officer('patrol', x0 + 0.5, 15.8, 0, x1 + 0.5, 15.8);
  // four operators huddled by the start point: stand-ins for co-op squad-mates (hidden in multiplayer)
  for (const [cx, cy] of [[24.5, 41.5], [24.5, 38.5], [40.5, 44.5], [25.5, 44.5]]) {
    const pts = [0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2 + 0.4; return { x: cx + Math.cos(a) * 0.95, y: cy + Math.sin(a) * 0.95 }; });
    if (!pts.every((q) => open(q.x, q.y)) || !open(cx, cy)) continue;
    pts.forEach((q, i) => L.ambient.push({ kind: 'squad', slot: i, x: q.x, y: q.y, facing: Math.atan2(cy - q.y, cx - q.x), cx, cy, seed: rng.next() }));
    break;
  }
  // officers walking the tape line (try a few lanes until one is clear)
  for (const [x0, x1] of [[5, 24], [40, 59]]) {
    for (const y of [20.5, 21.5, 26.5, 43.5]) if (officer('patrol', x0 + 0.5, y, 0, x1 + 0.5, y)) break;
  }
  // one leaning on a SWAT van
  const van = L.props.find((p) => p.kind === 'swatvan');
  if (van) for (const [dx, dy] of [[1.6, 0], [-1.6, 0], [0, 2.6], [0, -2.6]]) if (officer('lean', van.x + dx, van.y + dy, Math.atan2(-dy, -dx) + Math.PI)) break;
  // cast: every officer gets a story character, except the one briefing at the command-tent table (own role)
  const table = L.props.find((p) => p.kind === 'table');
  let cast = 0;
  for (const a of L.ambient) if (a.kind === 'officer') a.npc = a.mode === 'brief' && table && Math.hypot(a.x - table.x, a.y - table.y) < 3 ? -1 : cast++;
  // pigeons pecking in open ground
  for (let i = 0, made = 0; i < 40 && made < 4; i++) {
    const x = rng.range(4, FW - 4), y = rng.range(14, FH - 4);
    if (x > 28 && x < 36) continue; // not in the approach lane
    let ok = true;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!open(x + dx, y + dy)) ok = false;
    if (!ok) continue;
    L.ambient.push({ kind: 'pigeons', x, y, n: rng.int(3, 6), seed: rng.next() });
    made++;
  }
  // rats scurrying along the fence line and the facade
  const runs: [number, number, number, number][] = [[3, FH - 2.5, 20, FH - 2.5], [44, FH - 2.5, 60, FH - 2.5], [2.5, 16, 2.5, 30], [FW - 2.5, 14, FW - 2.5, 28]];
  for (const [x0, y0, x1, y1] of runs) if (clearLine(x0, y0, x1, y1)) L.ambient.push({ kind: 'rat', x: x0, y: y0, x2: x1, y2: y1, seed: rng.next() });
}

/**
 * Developer sandbox: an empty, brightly lit hall. The renderer lays every model out on a grid over it; the west
 * strip holds the live environment pieces (CCTV states, traps, hazards, vending, every light type) and the three
 * stairwells show the stair conditions. No enemies, no AI.
 */
/** Kinds that keep their default model on holidays, so the holiday sandboxes leave them out. */
const HOLIDAY_SANDBOX_SKIP = new Set(['pipes', 'bookshelf', 'kitchensink', 'sawhorse', 'barrier', 'tape', 'streetlight', 'toolbox', 'couch', 'couch_leather', 'couch_modular', 'couch_bench', 'couch_armchair', 'heater', 'pillar', 'panel', 'medcab', 'stall', 'urinal', 'generator', 'boiler', 'rack', 'chair', 'monitor', 'monitors', 'mainframe']);

function genSandbox(B: Builder) {
  const L = B.L;
  const holiday = currentHoliday() !== null; // holiday sandboxes: no CCTV, traps or pipes, only the themed props
  L.theme = 'sandbox';
  L.darkness = 0;
  const hall = B.room('lobby', { x0: 1, y0: 1, x1: FW - 2, y1: FH - 2 }, true);
  B.carve({ x0: 1, y0: 1, x1: FW - 2, y1: FH - 2 }, hall.id);
  STAIR_RECTS.forEach((r, i) => stampStair(B, r, i));
  // holiday sandboxes add showcase rows (zombies), so their prop rows start further south; keep in step with
  // Showcase in render/sandbox.ts (its `bottom` must stay north of PROP_Y0)
  const PROP_Y0 = holiday ? 27 : 24;
  L.anchors.start = { x: 32, y: PROP_Y0 - 0.8 }; // aisle between the showcase rows (north) and the prop rows (south)
  // lit by the renderer's daylight (floor <= 0), not ceiling lamps: lamp point lights blow out tall tops (car roofs)
  // environment strip (x 2..6)
  const X = 4.5;
  if (!holiday) {
    L.cameras.push({ id: B.id(), x: X, y: 11, angle: 0, sweep: 0, speed: 0, phase: 0, range: 5, fov: 0.26 }); // static
    L.cameras.push({ id: B.id(), x: X, y: 14, angle: 0, sweep: 0.9, speed: 0.5, phase: 0, range: 5, fov: 0.26 }); // sweeping
    L.cameras.push({ id: B.id(), x: X, y: 17, angle: 0, sweep: 0, speed: 0, phase: 0, range: 5, fov: 0.26 }); // alarm (set by the sim)
    L.traps.push({ id: B.id(), kind: 'mine', x: X, y: 20, x2: 0, y2: 0 });
    L.traps.push({ id: B.id(), kind: 'tripwire', x: X - 0.6, y: 22.5, x2: X + 0.6, y2: 22.5 });
  }
  L.hazards.push({ id: B.id(), kind: 'fire', x: X, y: 25, r: 0.9 });
  L.lights.push({ id: B.id(), x: X, y: 25, color: 0xff7a2a, intensity: 1.3, range: 6, flicker: 1, broken: false, room: hall.id, kind: 'fire' });
  L.hazards.push({ id: B.id(), kind: 'shock', x: X, y: 28, r: 1.1 });
  for (const [y, rot] of [[31, 0], [34, 0]] as [number, number][]) {
    const p = B.place('vending', Math.floor(X), y, 1, 1, 2, -1, rot);
    if (p) B.L.vendings.push({ id: p.id, x: p.x, y: p.y, rot, drops: [], price: 2 });
  }
  L.lights.push({ id: B.id(), x: X, y: 37, color: 0xff3322, intensity: 0.8, range: 6, flicker: 0, broken: false, room: hall.id, kind: 'emergency' });
  L.lights.push({ id: B.id(), x: X - 0.3, y: 40, z: 1.5, phase: 0.2, color: 0xff2020, intensity: 1, range: 6, flicker: 0, broken: false, room: hall.id, kind: 'police' });
  L.lights.push({ id: B.id(), x: X + 0.3, y: 40, z: 1.5, phase: 0.2, color: 0x2050ff, intensity: 1, range: 6, flicker: 0, broken: false, room: hall.id, kind: 'police' });
  L.lights.push({ id: B.id(), x: X, y: 43, color: 0xffe6c4, intensity: 1.2, range: 6, flicker: 1, broken: false, room: hall.id, kind: 'ceiling' });
  L.lights.push({ id: B.id(), x: X, y: 45.5, color: 0xffe6c4, intensity: 1.2, range: 6, flicker: 0, broken: true, room: hall.id, kind: 'ceiling' });
  // hackable computers to try the minigame (both kinds)
  for (const [kind, hx] of [['security', 2.5], ['lights', 6.5]] as ['security' | 'lights', number][]) {
    const t = B.place('terminal', Math.floor(hx), 9, 1, 1, 1, -1, 0, false);
    if (t) L.hacks.push({ id: B.id(), kind, x: t.x, y: t.y, propKind: 'terminal' });
  }
  // every prop model, packed in rows (x 8..62, y 26..46); 1x1 kinds in all four orientations, vehicles both ways
  const PROPS: [string, number, number][] = [
    ['desk', 2, 1], ['execdesk', 3, 1], ['secdesk', 3, 1], ['reception', 4, 1], ['table', 2, 1], ['cubicle', 2, 2], ['couch', 2, 1], ['counter', 2, 1],
    ['generator', 2, 2], ['boiler', 2, 1], ['rack', 3, 1], ['rack', 1, 3], ['bookshelf', 2, 1], ['monitors', 2, 1], ['couch_leather', 2, 1], ['couch_modular', 2, 1], ['couch_bench', 2, 1], ['couch_armchair', 2, 1], ['kitchensink', 2, 1], ['sink', 2, 1], ['planter', 2, 1], ['planter_grass', 2, 1], ['planter_topiary', 2, 1], ['planter_flowers', 2, 1], ['planter_bamboo', 2, 1], ['sandbags', 2, 1], ['barricade', 2, 1],
    ['booth', 2, 2], ['car', 4, 2], ['mainframe', 4, 4], ['boardtable', 7, 3],
    ['policecar', 4, 2], ['policecar', 2, 4], ['swatvan', 5, 2], ['swatvan', 2, 5], ['tent', 4, 3], ['barrier', 3, 1], ['barrier', 1, 3], ['sawhorse', 2, 1], ['sawhorse', 1, 2], ['tape', 3, 1], ['tape', 1, 3],
  ];
  for (const k of ['chair', 'monitor', 'cabinet', 'plant', 'pillar', 'medcab', 'stall', 'sink', 'toolbox', 'locker', 'shelf', 'crate', 'safe', 'panel', 'heater', 'terminal', 'barrel', 'streetlight', 'fridge', 'cone', 'floodlight', 'palm', 'fern', 'cactus', 'ficus', 'planter', 'planter_grass', 'planter_topiary', 'planter_flowers', 'planter_bamboo', 'toilet', 'shower', 'urinal', 'kitchensink', 'couch', 'couch_leather', 'couch_modular', 'couch_bench', 'couch_armchair', 'tvwall', 'credenza'])
    for (let r = 0; r < 4; r++) PROPS.push([k + ':' + r, 1, 1]);
  // pipe services on the north wall, high up like the real banks: one run per colour, then mixed banks
  let wx = 7;
  if (!holiday) for (const [svc, len] of [...['water', 'air', 'fire', 'gas', 'fuel', 'steam', 'graywater', 'sewage'].map((k) => [k, 3] as [string, number]), ['steam.water.sewage', 5], ['fire.gas.air', 5]] as [string, number][]) {
    B.deco(`pipes.${svc}#${wx}`, wx + len / 2, 1.3, 0, hall.id, len, 1);
    wx += len + 1;
  }
  let px = 8, py = PROP_Y0, rowH = 1;
  for (const [key, w, h] of PROPS) {
    if (holiday && HOLIDAY_SANDBOX_SKIP.has(key.split(':')[0])) continue;
    const right = py + Math.max(h, rowH) > FH - 9 ? FW - 8 : FW - 2; // keep clear of the SE stairwell
    if (px + w > right) { px = 8; py += rowH + 1; rowH = 1; }
    if (py + h > FH - 1) break; // ponytail: silently drops overflow; widen the zone if the catalogue grows
    const [kind, rot] = key.split(':');
    const solid = kind === 'tape' || kind === 'cone' || kind === 'chair' || kind.startsWith('pipes') || PLANT_KINDS.includes(kind) ? S_NONE : S_LOW;
    B.place(kind, px, py, w, h, solid, -1, Number(rot ?? 0), false);
    px += w + (rot !== undefined && rot !== '3' ? 0 : 1); rowH = Math.max(rowH, h); // orientation sets sit shoulder to shoulder
  }
}

// ---------------------------------------------------------------------------------------------
const cache = new Map<string, FloorLayout>();

/** Deterministically generate a floor. Same (seed, difficulty, floor) always yields the same layout. */
export function generateFloor(plan: BuildingPlan, floor: number): FloorLayout {
  const key = `${plan.seed}:${plan.difficulty}:${floor}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; } // most recently used last
  const seed = hash(plan.seed, floor, 0xf100);
  const rng = new Rng(seed);
  const L = makeLayout(floor, seed, darknessOf(floor));
  const p = pressure(plan.difficulty, floor);
  const B = new Builder(L, rng, p.loot);
  if (floor === SANDBOX_FLOOR) {
    genSandbox(B);
  } else if (floor === 0) {
    genStreet(B);
  } else {
    genInterior(B, plan, floor);
    furnish(B, floor);
    addLights(B, floor);
  }
  if (floor === SANDBOX_FLOOR) {
    const pass = (c: string) => c === 'clear' || c === 'damaged' || c === 'fire';
    for (const s of L.stairs) { setFlightBlocked(L, s, 1, !pass(plan.up(floor, s.index))); setFlightBlocked(L, s, -1, !pass(plan.down(floor, s.index))); }
  } else if (floor > 0) {
    // the street is a safe zone: no hostiles, cameras, traps or hazards
    addHazardsAndCameras(B, floor, plan.difficulty);
    addSpawns(B, floor, plan.difficulty);
    addHackTerminals(B, floor);
    if (floor < FINAL_FLOOR) addRealDoors(B, floor);
    // debris / collapsed flights physically block the steps
    const pass = (c: string) => c === 'clear' || c === 'damaged' || c === 'fire';
    for (const s of L.stairs) {
      setFlightBlocked(L, s, 1, floor >= FINAL_FLOOR || !pass(plan.up(floor, s.index)));
      setFlightBlocked(L, s, -1, floor <= 1 || !pass(plan.down(floor, s.index)));
    }
  }
  if (cache.size > 24) cache.delete(cache.keys().next().value!); // the renderer generates the floors within reach ahead of time
  cache.set(key, L);
  return L;
}

/** Chance per floor (floors 1..HACK_MAX_FLOOR) of a hackable security / lighting computer. */
export const HACK_MAX_FLOOR = 190;
export const HACK_CHANCE = { security: 0.45, lights: 0.45 };
const HACK_HOSTS = ['desk', 'cubicle', 'secdesk', 'execdesk', 'terminal', 'monitors'];
function addHackTerminals(B: Builder, floor: number) {
  const L = B.L, rng = new Rng(hash(L.seed, 0x4ac));
  if (floor < 1 || floor > HACK_MAX_FLOOR) return;
  const loot = new Set(L.containers.map((c) => c.id)); // keep hack prompts off lootable desks
  const hosts = rng.shuffle(L.props.filter((q) => HACK_HOSTS.includes(q.kind) && !loot.has(q.id)));
  const hasSecurity = L.cameras.length + L.traps.length > 0;
  const hasBadLights = L.darkness > 0 || L.lights.some((l) => l.flicker > 0 || l.broken || l.kind === 'emergency');
  for (const kind of ['security', 'lights'] as const) {
    if (!(kind === 'security' ? hasSecurity : hasBadLights) || !rng.chance(HACK_CHANCE[kind])) continue;
    const host = hosts.find((q) => !L.hacks.some((h) => Math.hypot(h.x - q.x, h.y - q.y) < 6));
    if (host) L.hacks.push({ id: B.id(), kind, x: host.x, y: host.y, propKind: host.kind });
  }
}

/** Share of eligible doorways that get a door leaf. */
const DOOR_SHARE = 0.3;
/** Doorway tiles that never get a door leaf: stairwell and lift doors (the street entrance is on the outer wall). */
const FEATURE_DOORS = new Set([...STAIR_RECTS, ...ELEV_RECTS].map((r) => idx(r.door[0], r.door[1])));

/**
 * Real doors: some (DOOR_SHARE) of the 1-2 tile doorways in straight walls between two ordinary rooms get a door, seeded open / closed /
 * locked, and the floor gets one master key (the safe, else a desk). Locked doors never cut the arrivals off from the
 * stairs, lifts, hack terminals, the key or the street exit, nor an enemy from its patrol route: rooms behind them are optional.
 */
function addRealDoors(B: Builder, floor: number) {
  const L = B.L, rng = new Rng(hash(L.seed, 0xd00));
  const T = (x: number, y: number) => L.tiles[idx(x, y)];
  const wallish = (v: number) => v === T_WALL || v === T_WINDOW;
  const done = new Uint8Array(FW * FH);
  const sides: number[][] = []; // per door: the floor tiles either side
  for (let y = 1; y < FH - 1; y++)
    for (let x = 1; x < FW - 1; x++) {
      const i = idx(x, y);
      if (T(x, y) !== T_DOOR || done[i] || FEATURE_DOORS.has(i)) continue;
      const ns = doorRunsNS(L, x, y), ax = ns ? 0 : 1, ay = ns ? 1 : 0; // (ax,ay) = along the wall
      const tiles: number[] = [];
      let k = 0;
      for (; T(x + ax * k, y + ay * k) === T_DOOR; k++) { const j = idx(x + ax * k, y + ay * k); done[j] = 1; tiles.push(j); }
      if (tiles.length > 2 || !wallish(T(x - ax, y - ay)) || !wallish(T(x + ax * k, y + ay * k))) continue;
      const side: number[] = [], rooms = new Set<number>();
      for (const t of tiles) for (const n of ns ? [t - 1, t + 1] : [t - FW, t + FW]) { side.push(n); rooms.add(L.tiles[n] === T_FLOOR ? L.roomAt[n] : -1); }
      if (rooms.size !== 2 || rooms.has(-1) || [...rooms].some((r) => ['stair', 'elevator', 'street'].includes(L.rooms[r].type))) continue;
      if (!rng.chance(DOOR_SHARE)) continue; // only some doorways get a door: a door on every opening is a maze of leaves
      let init = rng.weighted<DoorMode>([['open', 45], ['closed', 35], ['locked', 20]]);
      if (L.spawns.some((s) => tiles.includes(idx(Math.floor(s.x), Math.floor(s.y))))) init = 'open'; // nobody starts inside a door leaf
      const cx = tiles.reduce((a, t) => a + (t % FW), 0) / tiles.length + 0.5, cy = tiles.reduce((a, t) => a + ((t / FW) | 0), 0) / tiles.length + 0.5;
      L.doors.push({ id: B.id(), tiles, vertical: ns, x: cx, y: cy, init });
      sides.push(side);
    }
  if (!L.doors.length) return;
  // connected walkable areas (label per tile, -1 = blocked): one labelling answers every reachability question below
  const comps = () => {
    const lab = new Int16Array(FW * FH).fill(-1);
    for (let i = 0, n = 0; i < FW * FH; i++) {
      if (lab[i] >= 0 || !B.walkable(i % FW, (i / FW) | 0)) continue;
      const { seen } = B.flood(i % FW, (i / FW) | 0);
      for (let j = 0; j < FW * FH; j++) if (seen[j]) lab[j] = n;
      n++;
    }
    return lab;
  };
  const tileOf = (p: { x: number; y: number }) => idx(Math.floor(p.x), Math.floor(p.y));
  const reached = (lab: Int16Array, c: number, p: { x: number; y: number }) => {
    if (c < 0) return false;
    for (let ty = Math.floor(p.y) - 2; ty <= Math.floor(p.y) + 2; ty++)
      for (let tx = Math.floor(p.x) - 2; tx <= Math.floor(p.x) + 2; tx++) if (inBounds(tx, ty) && lab[idx(tx, ty)] === c && Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) < 1.6) return true; // interaction reach
    return false;
  };
  const start = L.anchors.stair0 ?? Object.values(L.anchors)[0];
  const open = comps(), home = open[tileOf(start)];
  // the master key: the safe if the floor has one, else a desk drawer (a plain desk gets a drawer if none is lootable)
  const pool = (k?: string) => L.containers.filter((c) => (!k || c.kind === k) && reached(open, home, c)); // never a boxed-in one
  if (!pool('safe').length && !pool('desk').length) {
    const hacked = new Set(L.hacks.map((h) => `${h.x},${h.y}`));
    const desks = L.props.filter((q) => (q.kind === 'desk' || q.kind === 'cubicle') && !hacked.has(`${q.x},${q.y}`) && !L.containers.some((c) => c.id === q.id) && reached(open, home, q));
    if (desks.length) B.container('desk', rng.pick(desks));
  }
  const hosts = pool('safe').length ? pool('safe') : pool('desk').length ? pool('desk') : pool();
  const kc = hosts.length ? rng.pick(hosts) : null;
  kc?.items.push({ k: 'key', f: floor });
  // demote locked doors (one on the frontier of what is reachable) until everything required is reachable without the key
  const need = [...Object.values(L.anchors), ...L.stairs.map((s) => ({ x: s.doorX, y: s.doorY })), ...L.elevators.map((e) => ({ x: e.doorX, y: e.doorY })), ...L.hacks, ...(kc ? [kc] : []), ...L.portals];
  const groups = [{ from: start, need }, ...L.spawns.map((s) => ({ from: s, need: s.route }))]
    .map((g) => ({ src: tileOf(g.from), need: g.need.filter((p) => reached(open, open[tileOf(g.from)], p)) })); // only what all-open doors reach
  if (!kc) for (const d of L.doors) if (d.init === 'locked') d.init = 'closed';
  for (;;) {
    const locked = L.doors.filter((d) => d.init === 'locked');
    if (!locked.length) break;
    for (const d of locked) setDoorSolid(L, d, 'locked');
    const lab = comps();
    for (const d of locked) setDoorSolid(L, d, 'open'); // the layout keeps every door open: FloorState applies the live state
    const bad = groups.find((g) => !g.need.every((p) => reached(lab, lab[g.src], p)));
    if (!bad) break;
    const c = lab[bad.src];
    (locked.find((d) => { const s = sides[L.doors.indexOf(d)]; return s.some((n) => lab[n] === c) && s.some((n) => lab[n] !== c); }) ?? locked[0]).init = 'closed';
  }
}

export function clearFloorCache() {
  cache.clear();
}

/** Find up to n free walkable points near an anchor (for placing arriving players). */
export function pointsNear(L: FloorLayout, ax: number, ay: number, n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const cx = Math.floor(ax), cy = Math.floor(ay);
  for (let r = 0; r < 6 && out.length < n; r++)
    for (let dy = -r; dy <= r && out.length < n; dy++)
      for (let dx = -r; dx <= r && out.length < n; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isWalkableTile(L, cx + dx, cy + dy)) out.push({ x: cx + dx + 0.5, y: cy + dy + 0.5 });
      }
  while (out.length < n) out.push({ x: ax, y: ay });
  return out;
}

export { STAIR_COUNT, ELEVATOR_COUNT };
