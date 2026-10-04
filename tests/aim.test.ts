import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { screenAim } from '../src/render/aim';

// Same camera rig as the game: 35° FOV, offset (12, 22, 12) from the target.
function isoCamera(px: number, py: number) {
  const c = new THREE.PerspectiveCamera(35, 16 / 9, 0.5, 200);
  c.position.set(px + 12, 22, py + 12);
  c.lookAt(px, 0, py);
  c.updateMatrixWorld();
  c.updateProjectionMatrix();
  return c;
}
const ndcOf = (cam: THREE.Camera, x: number, h: number, y: number) => { const v = new THREE.Vector3(x, h, y).project(cam); return { x: v.x, y: v.y }; };
const bearing = (ax: number, ay: number, bx: number, by: number) => Math.atan2(by - ay, bx - ax);
const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe('mouse aiming', () => {
  const P = { x: 20, y: 20 };
  const cam = isoCamera(P.x, P.y);
  it('cursor on the floor right in front of the feet aims at that floor spot, in every direction', () => {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const tx = P.x + Math.cos(a) * 0.8, ty = P.y + Math.sin(a) * 0.8; // 0.8 m from the feet
      const n = ndcOf(cam, tx, 0, ty);
      const r = screenAim(cam, n.x, n.y, [], 1600, 900);
      expect(Math.hypot(r.x - tx, r.y - ty)).toBeLessThan(0.02);
      expect(angDiff(bearing(P.x, P.y, r.x, r.y), a)).toBeLessThan(0.03);
    }
  });
  it('regression: the old chest-height plane skewed or collapsed near-feet aims', () => {
    const oldAim = (tx: number, ty: number) => {
      const n = ndcOf(cam, tx, 0, ty);
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2(n.x, n.y), cam);
      const o = new THREE.Vector3();
      rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.9), o);
      return { x: o.x, y: o.z, n };
    };
    // up-screen, in front of the feet: old aim collapsed onto the player (< 0.2 m => facing never updated)
    const up = oldAim(P.x - 0.6, P.y - 0.6);
    expect(Math.hypot(up.x - P.x, up.y - P.y)).toBeLessThan(0.2);
    // screen-right of the feet: old aim bearing was badly skewed
    const side = oldAim(P.x + 0.6, P.y - 0.6);
    expect(angDiff(bearing(P.x, P.y, side.x, side.y), bearing(P.x, P.y, P.x + 0.6, P.y - 0.6))).toBeGreaterThan(0.5);
    // new aim: exact in both cases
    for (const [tx, ty, o] of [[P.x - 0.6, P.y - 0.6, up], [P.x + 0.6, P.y - 0.6, side]] as const) {
      const r = screenAim(cam, o.n.x, o.n.y, [], 1600, 900);
      expect(Math.hypot(r.x - tx, r.y - ty)).toBeLessThan(0.02);
    }
  });
  it('cursor over an enemy torso snaps to the enemy; nearby floor does not', () => {
    const E = { x: 26, y: 17, h: 1.7 };
    const torso = ndcOf(cam, E.x, 1.2, E.y);
    const r = screenAim(cam, torso.x, torso.y, [E], 1600, 900);
    expect(r.snapped).toBe(true);
    expect(r.x).toBe(E.x); expect(r.y).toBe(E.y);
    const far = ndcOf(cam, E.x + 3, 0, E.y + 3);
    expect(screenAim(cam, far.x, far.y, [E], 1600, 900).snapped).toBe(false);
  });
  it('light mouse assist: a near miss 30 px off the body snaps at the 40 px setting, not with assist off', () => {
    const E = { x: 26, y: 17, h: 1.7 };
    const t = ndcOf(cam, E.x, 1.2, E.y);
    const off = { x: t.x + (30 / 1600) * 2, y: t.y }; // 30 px to the right on a 1600 px wide view
    expect(screenAim(cam, off.x, off.y, [E], 1600, 900, 40).snapped).toBe(true);
    expect(screenAim(cam, off.x, off.y, [E], 1600, 900, 0).snapped).toBe(false);
    // exact aim with assist off still hits nothing extra: it resolves to the floor under the cursor
    expect(Number.isFinite(screenAim(cam, off.x, off.y, [E], 1600, 900, 0).x)).toBe(true);
  });
});

import { aimRay, surfaceHeight } from '../src/render/aim';
import { arena } from './helpers';
import { idx as tidx, T_WALL as TW, S_LOW as SL } from '../src/gen/floor';

describe('3D aim ray', () => {
  const P = { x: 20, y: 20 };
  const cam = isoCamera(P.x, P.y);
  it('cursor on a wall aims at that point on the wall face, not the floor behind it', () => {
    const L = arena();
    for (let y = 1; y < 47; y++) L.tiles[tidx(16, y)] = TW; // wall 4 m "up-screen-left"
    const target = new THREE.Vector3(16.99, 1.5, 21); // on the wall's east face at 1.5 m
    const n = target.clone().project(cam);
    const r = aimRay(cam, n.x, n.y, L, [], null)!;
    expect(r.h).toBeGreaterThan(1.3);
    expect(r.h).toBeLessThan(1.7);
    expect(Math.abs(r.x - 17)).toBeLessThan(0.1);
  });
  it('cursor on a desk hits the desk top; on an enemy it hits the body at that height', () => {
    const L = arena();
    L.solid[tidx(23, 18)] = SL;
    const d = new THREE.Vector3(23.5, 0.85, 18.5).project(cam);
    expect(aimRay(cam, d.x, d.y, L, [], null)!.h).toBeCloseTo(0.85, 1);
    const e = new THREE.Vector3(26, 1.0, 17).project(cam);
    const hit = aimRay(cam, e.x, e.y, L, [{ x: 26, y: 17, r: 0.4, bottom: 0, top: 1.85 }], null)!;
    expect(hit.h).toBeGreaterThan(0.6);
    expect(Math.hypot(hit.x - 26, hit.y - 17)).toBeLessThan(0.45);
  });
  it('open floor still aims at the floor exactly', () => {
    const L = arena();
    const f = new THREE.Vector3(22, 0, 23).project(cam);
    const r = aimRay(cam, f.x, f.y, L, [], null)!;
    expect(r.h).toBeLessThan(0.01);
    expect(Math.hypot(r.x - 22, r.y - 23)).toBeLessThan(0.05);
    expect(surfaceHeight(L, 22, 23, null)).toBe(0);
  });
});
