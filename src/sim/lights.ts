import type { LightSpec, FloorLayout } from '../gen/floor';
import type { LightState, PanelState } from './state';

/** Is a light dark from sim state (popped bulb, breaker off, or panel shot out)? Falls back to the layout. */
export const lightOut = (s: LightState | undefined, l: LightSpec) => (s ? s.broken || !!s.off || !!s.cut : l.broken);

/** Breaker panels from the layout's 'panel' props. Each one feeds its own room and every room next to it. */
export function makePanels(L: FloorLayout): PanelState[] {
  return L.props.filter((p) => p.kind === 'panel' && p.room >= 0).map((p) => ({ id: p.id, x: p.x, y: p.y, rooms: roomAndNeighbours(L, p.room), dead: false, off: false }));
}

/** A room plus the rooms touching it through a door or one wall tile. */
function roomAndNeighbours(L: FloorLayout, room: number): number[] {
  const out = new Set<number>([room]);
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
    if (L.roomAt[y * L.w + x] !== room) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= L.w || ny >= L.h) continue;
      const r = L.roomAt[ny * L.w + nx];
      if (r >= 0) out.add(r);
    }
  }
  return [...out];
}

/** Indices of the panel's lights (indoor fixtures only; fires and street lights aren't on the breaker). */
export function panelLights(L: FloorLayout, pn: PanelState): number[] {
  const out: number[] = [];
  L.lights.forEach((l, i) => { if ((l.kind === 'ceiling' || l.kind === 'emergency') && pn.rooms.includes(l.room)) out.push(i); });
  return out;
}

const h01 = (a: number, b: number) => {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Deterministic light output multiplier (0..1) at time t. Shared by the simulation (stealth
 * exposure) and the renderer so what the player sees matches what enemies see.
 */
export function lightLevel(l: LightSpec, broken: boolean, t: number): number {
  if (broken) return 0;
  if (l.kind === 'fire') return 0.75 + 0.25 * Math.sin(t * 13 + l.id) * Math.sin(t * 7.3 + l.id * 2.1);
  if (l.kind === 'police') return policeStrobe(t, l.phase ?? 0, l.color === 0xff2020);
  if (l.kind === 'emergency') return 0.55 + 0.45 * Math.max(0, Math.sin(t * 2.2 + l.id));
  if (!l.flicker) return 1;
  const phase = (t * 0.23 + l.id * 0.137) % 1;
  if (phase < 0.2 * l.flicker) {
    const s = Math.floor(t * 14 + l.id * 7.1);
    return h01(s, l.id) > 0.45 ? 1 : 0.05;
  }
  return 1;
}

/**
 * Police light-bar pattern: red side then blue side, each giving a quick double flash, ~1.4 cycles/s.
 * `phase` (0..1) de-synchronises vehicles; both halves of one bar share it.
 */
export function policeStrobe(t: number, phase: number, red: boolean): number {
  const c = (((t * 1.4 + phase) % 1) + 1) % 1;
  const half = red ? c : (c + 0.5) % 1;
  if (half >= 0.5) return 0.03;
  const u = half / 0.5;
  return u < 0.16 || (u > 0.3 && u < 0.46) ? 1 : 0.03;
}
