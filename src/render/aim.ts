import * as THREE from 'three';

export interface AimTarget { x: number; y: number; h: number; aimH?: number }

const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const rc = new THREE.Raycaster();
const v = new THREE.Vector3();

/**
 * Convert a cursor position to a world aim point (sim x,y).
 * - If the cursor is over a target's body on screen (within `snapPx`), aim at that target, so
 *   pointing at an enemy's torso shoots the enemy rather than the floor behind it.
 * - Otherwise aim at the floor point under the cursor (not a raised plane: a raised plane puts
 *   near-feet cursor positions between the player and the camera, i.e. behind the player).
 */
export function screenAim(camera: THREE.Camera, ndcX: number, ndcY: number, targets: AimTarget[], viewW: number, viewH: number, snapPx = 26): { x: number; y: number; h: number; snapped: boolean } {
  const mx = (ndcX * 0.5 + 0.5) * viewW, my = (-ndcY * 0.5 + 0.5) * viewH;
  let best: AimTarget | null = null, bd = snapPx;
  for (const t of targets) {
    // test the body from feet to top so tall and short targets both snap
    for (const hh of [t.h * 0.35, t.h * 0.7, t.h]) {
      v.set(t.x, hh, t.y).project(camera);
      if (v.z > 1) continue;
      const d = Math.hypot((v.x * 0.5 + 0.5) * viewW - mx, (-v.y * 0.5 + 0.5) * viewH - my);
      if (d < bd) { bd = d; best = t; }
    }
  }
  if (best) return { x: best.x, y: best.y, h: best.aimH ?? best.h * 0.6, snapped: true };
  rc.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const p = new THREE.Vector3();
  if (!rc.ray.intersectPlane(floor, p)) return { x: NaN, y: NaN, h: 0, snapped: false };
  return { x: p.x, y: p.z, h: 0, snapped: false };
}

// ------------------------------------------------------------------ true 3D aim against the level
import { FloorLayout, idx, T_WALL, T_WINDOW, S_LOW, S_TALL, FW, FH } from '../gen/floor';
import { stairElevation } from '../sim/stairs';

export interface BodyTarget { x: number; y: number; r: number; bottom: number; top: number }
export interface CutInfo { px: number; py: number; dx: number; dy: number }

function inCut(c: CutInfo | null, x: number, z: number): boolean {
  if (!c) return false;
  const rx = x - c.px, rz = z - c.py;
  const along = rx * c.dx + rz * c.dy;
  const perp = Math.hypot(rx - along * c.dx, rz - along * c.dy);
  return along > -0.6 && along < 11 && perp < 2.6 + along * 0.28;
}

/** Height of the solid surface at a world point (what a bullet would strike), honouring the wall cutaway. */
export function surfaceHeight(L: FloorLayout, x: number, z: number, cut: CutInfo | null): number {
  const tx = Math.floor(x), ty = Math.floor(z);
  if (tx < 0 || ty < 0 || tx >= FW || ty >= FH) return 0;
  const ground = stairElevation(L, x, z);
  const t = L.tiles[idx(tx, ty)];
  let h = ground;
  if (t === T_WALL || t === T_WINDOW) {
    h = L.floor === 0 ? (ty <= 11 ? 7.5 : 1.3) : 2.6;
    if (inCut(cut, x, z)) h = 0.4;
  } else {
    const s = L.solid[idx(tx, ty)];
    if (s === S_TALL) h = Math.max(ground, inCut(cut, x, z) ? 0.95 : 1.9);
    else if (s === S_LOW) h = Math.max(ground, 0.85);
  }
  return h;
}

/**
 * Cast the cursor ray into the level: returns the first thing it meets - an enemy body, a wall face, a desk top,
 * a stair tread or the floor - with its height. `snap` is a screen-space fallback for small, distant targets.
 */
export function aimRay(camera: THREE.Camera, ndcX: number, ndcY: number, L: FloorLayout, bodies: BodyTarget[], cut: CutInfo | null): { x: number; y: number; h: number } | null {
  rc.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const o = rc.ray.origin, d = rc.ray.direction;
  if (d.y >= -1e-4) return null;
  // bodies: ray vs vertical capsule-ish cylinder
  let best = Infinity, bh = 0;
  for (const b of bodies) {
    const ox = o.x - b.x, oz = o.z - b.y;
    const A = d.x * d.x + d.z * d.z, B = 2 * (ox * d.x + oz * d.z), C = ox * ox + oz * oz - b.r * b.r;
    const disc = B * B - 4 * A * C;
    if (disc < 0 || A < 1e-9) continue;
    const s = Math.sqrt(disc);
    for (const t of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) {
      const y = o.y + d.y * t;
      if (t > 0 && y >= b.bottom && y <= b.top && t < best) { best = t; bh = y; break; }
    }
  }
  // terrain: march from just above the tallest geometry down to the bottom of the stair pits
  const top = L.floor === 0 ? 8 : 2.8;
  let t = Math.max(0, (o.y - top) / -d.y);
  const tEnd = (o.y + 2.9) / -d.y;
  const step = 0.05;
  let prev = t;
  for (; t <= tEnd && t < best; t += step) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (y <= surfaceHeight(L, x, z, cut)) {
      // refine between the previous sample and this one
      let lo = prev, hi = t;
      for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; const mx = o.x + d.x * m, my = o.y + d.y * m, mz = o.z + d.z * m; if (my <= surfaceHeight(L, mx, mz, cut)) hi = m; else lo = m; }
      const hx = o.x + d.x * hi, hy = o.y + d.y * hi, hz = o.z + d.z * hi;
      return { x: hx, y: hz, h: Math.max(0, hy) };
    }
    prev = t;
  }
  if (best < Infinity) return { x: o.x + d.x * best, y: o.z + d.z * best, h: bh };
  const tf = o.y / -d.y;
  return { x: o.x + d.x * tf, y: o.z + d.z * tf, h: 0 };
}
