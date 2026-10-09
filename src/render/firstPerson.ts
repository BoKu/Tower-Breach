import { raycastWalls } from '../sim/nav';
import { WALL_H } from './floorView';
import type { FloorLayout } from '../gen/floor';

/**
 * First-person view (beta, Settings > Gameplay; P or F5 in a run): pure helpers for aiming and moving from the player's eyes.
 * yaw: 0 = east (+x), PI/2 = south (+y), as the sim's facing. pitch: up positive.
 */
const REACH = 40;

/**
 * Where the centre of the screen points: the first enemy on the line of sight, else the wall ahead, at eye-line height.
 * fixtures (cameras, ceiling lamps): hit when the eye line passes through their height band; the aim goes to their centre,
 * because shots leave the muzzle (lower than the eye) and a point on the wall behind would pass under them.
 */
export function fpAim(L: FloorLayout, enemies: { x: number; y: number }[], x: number, y: number, eye: number, yaw: number, pitch: number,
  fixtures: { x: number; y: number; lo: number; hi: number }[] = []): { x: number; y: number; h: number } {
  const dx = Math.cos(yaw), dy = Math.sin(yaw);
  const wall = raycastWalls(L, x, y, x + dx * REACH, y + dy * REACH);
  let d = wall < 0 ? REACH : Math.max(0.3, wall - 0.05);
  let onBody = false;
  for (const e of enemies) {
    const ex = e.x - x, ey = e.y - y, t = ex * dx + ey * dy;
    if (t <= 0.3 || t >= d) continue;
    if (Math.abs(ex * dy - ey * dx) < 0.45) { d = t; onBody = true; }
  }
  const slope = Math.tan(Math.max(-1.3, Math.min(1.3, pitch)));
  let fix: { lo: number; hi: number } | null = null;
  for (const f of fixtures) {
    const fx = f.x - x, fy = f.y - y, t = fx * dx + fy * dy, at = eye + slope * t;
    if (t <= 0.3 || t >= d || Math.abs(fx * dy - fy * dx) > 0.35 || at < f.lo - 0.25 || at > f.hi + 0.25) continue;
    d = t; fix = f; onBody = false;
  }
  if (fix) return { x: x + dx * d, y: y + dy * d, h: (fix.lo + fix.hi) / 2 };
  let h = eye + slope * d;
  if (h < 0) { d = eye / -slope; h = 0; } // looking down: the floor in front of you
  if (onBody) h = Math.max(0.6, Math.min(1.6, h));
  return { x: x + dx * d, y: y + dy * d, h: Math.min(WALL_H, h) };
}

/** Movement input (strafe right, forward) turned into a world direction for the sim. */
export function fpMove(strafe: number, fwd: number, yaw: number): { x: number; y: number } {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: c * fwd - s * strafe, y: s * fwd + c * strafe };
}
