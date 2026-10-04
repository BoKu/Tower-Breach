import * as THREE from 'three';
import { Builder, merge } from './models';
import { FloorLayout, RoomType, isWalkableTile, idx, FW, FH, T_DOOR } from '../gen/floor';
import { lineOfSight } from '../sim/nav';
import { Rng, hash } from '../core/rng';

/**
 * Cosmetic cockroaches that dart along the base of the walls (tower floors only). Which rooms are infested is a
 * pure function of the layout so co-op clients agree; the darting itself is local (like the street pigeons/rats).
 * Roaches wall-follow on the tile grid 0.08 m off the wall: inside corners turn in place, outside corners (wall
 * ends, door frames) are wrapped on a short arc, and door gaps are sometimes darted straight across.
 * Cheap: only roaches near the camera target think, and at most MAX_RIGS share a small pool of 5-draw-call rigs.
 */
type Pt = { x: number; y: number };
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
const OFF = 0.42; // line 0.08 m off the wall plane
const MAX_RIGS = 6, SHOW_R = 12, THINK_R = 15;
// how much each room type attracts roaches (missing = none)
const DIRT: Partial<Record<RoomType, number>> = {
  kitchen: 4, bathroom: 3.5, storage: 3, maintenance: 3, utility: 2.5, corridor: 2, server: 0.6, open: 0.8, office: 0.8, security: 0.8, boardroom: 0.4, executive: 0.3,
};

// ------------------------------------------------------------------ rig
const shellMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.26, metalness: 0.2 });
let GEO: { body: THREE.BufferGeometry; legsA: THREE.BufferGeometry; legsB: THREE.BufferGeometry; ant: THREE.BufferGeometry } | null = null;

/** Thin 3-sided cylinder from a to b (model space). */
function seg(b: Builder, a: number[], c: number[], r: number, color: number) {
  const va = new THREE.Vector3(...a), vc = new THREE.Vector3(...c), dir = vc.clone().sub(va);
  const g = new THREE.CylinderGeometry(r * 0.8, r, dir.length(), 3, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  b.geo(g, color, (va.x + vc.x) / 2, (va.y + vc.y) / 2, (va.z + vc.z) / 2);
}

function geometry() {
  if (GEO) return GEO;
  const ell = () => new THREE.SphereGeometry(1, 10, 6);
  const body = new Builder()
    .geo(ell(), 0x4a2410, 0, 0.009, -0.01, 0, 0, 0, 'solid', 0.017, 0.008, 0.03) // wing covers over the abdomen
    .geo(ell(), 0x6a4222, 0, 0.011, 0.019, 0, 0, 0, 'solid', 0.015, 0.006, 0.011) // pronotum shield
    .geo(ell(), 0x2a160a, 0, 0.012, 0.022, 0, 0, 0, 'solid', 0.008, 0.004, 0.007) // its dark centre mark
    .geo(ell(), 0x24140a, 0, 0.007, 0.032, 0, 0, 0, 'solid', 0.007, 0.006, 0.007) // head
    .box(0.0012, 0.001, 0.05, 0, 0.0168, -0.012, 0x1e0e06); // wing seam
  seg(body, [-0.004, 0.006, -0.038], [-0.008, 0.008, -0.048], 0.001, 0x3a1e0c); // cerci
  seg(body, [0.004, 0.006, -0.038], [0.008, 0.008, -0.048], 0.001, 0x3a1e0c);
  // legs: hip -> knee (up and out) -> foot on the floor; tripods A (L1 R2 L3) and B (R1 L2 R3) move together
  const legs = [new Builder(), new Builder()];
  const LEGS: [number, number, number, number][] = [[0.018, 0.026, 0.042, 0.8], [0.006, 0.033, 0.006, 0.9], [-0.006, 0.031, -0.044, 1.1]]; // hipZ, footX, footZ, thickness
  LEGS.forEach(([hz, fx, fz, k], i) => {
    for (const s of [-1, 1]) {
      const b = legs[(i + (s < 0 ? 0 : 1)) % 2];
      const hip = [s * 0.007, 0.006, hz], foot = [s * fx, 0, fz];
      const knee = [s * (0.007 + (fx - 0.007) * 0.55), 0.014, hz + (fz - hz) * 0.45];
      seg(b, hip, knee, 0.0016 * k, 0x3a1e0c);
      seg(b, knee, foot, 0.0011 * k, 0x2e180a);
    }
  });
  // one antenna (left); the right one mirrors it via scale.x = -1
  const ab = new Builder();
  const pts = [[0, 0, 0], [0.008, 0.006, 0.02], [0.018, 0.008, 0.045], [0.026, 0.004, 0.07]];
  for (let i = 0; i < 3; i++) seg(ab, pts[i], pts[i + 1], 0.0008, 0x3a2010);
  GEO = { body: merge(body.p.solid)!, legsA: merge(legs[0].p.solid)!, legsB: merge(legs[1].p.solid)!, ant: merge(ab.p.solid)! };
  return GEO;
}

class RoachRig {
  root = new THREE.Group();
  private legsA: THREE.Mesh;
  private legsB: THREE.Mesh;
  private ant: THREE.Group[] = [];
  private gait = 0;
  private flick = 0;

  constructor() {
    const g = geometry();
    this.root.scale.setScalar(2.4); // a big ~12 cm roach: readable from the isometric camera
    this.root.add(new THREE.Mesh(g.body, shellMat));
    this.legsA = new THREE.Mesh(g.legsA, shellMat);
    this.legsB = new THREE.Mesh(g.legsB, shellMat);
    this.root.add(this.legsA, this.legsB);
    for (const s of [1, -1]) {
      const a = new THREE.Group();
      a.position.set(s * 0.003, 0.009, 0.037);
      a.scale.x = s;
      a.add(new THREE.Mesh(g.ant, shellMat));
      this.root.add(a);
      this.ant.push(a);
    }
  }

  /** speed m/s (0 = still: antennae twitch and sweep). */
  update(t: number, dt: number, speed: number, seed: number) {
    // fast tripod gait: one tripod swings forward (lifted) while the other pushes back; capped so it reads as a blur, not aliasing
    this.gait += Math.min(speed * 70, 75) * dt;
    const s = speed > 0.05 ? Math.sin(this.gait) : 0, lift = speed > 0.05 ? 0.002 : 0;
    this.legsA.position.set(0, Math.max(0, s) * lift, s * 0.006);
    this.legsB.position.set(0, Math.max(0, -s) * lift, -s * 0.006);
    this.root.children[0].rotation.y = s * 0.04; // body wiggle
    // antennae: swept back when running; when still, slow sweeps plus the odd quick flick
    this.flick = Math.max(0, this.flick - dt * 6);
    if (speed < 0.05 && Math.random() < dt * 1.5) this.flick = 1;
    this.ant.forEach((a, i) => {
      const ph = t * (2.3 + i * 0.7) + seed * 9 + i * 2;
      a.rotation.y = speed > 0.05 ? 0.25 + Math.sin(ph * 3) * 0.05 : Math.sin(ph) * 0.35 + Math.sin(ph * 4.7) * 0.08 + this.flick * (i ? -0.4 : 0.4);
      a.rotation.x = speed > 0.05 ? 0.15 : -0.2 + Math.sin(ph * 1.3) * 0.25;
    });
  }
}

// ------------------------------------------------------------------ behaviour
interface Roach {
  spawns: number[][]; // [tx, ty, wallDir] edges in its room
  tx: number; ty: number; d: number; w: number; // tile, run direction, wall side
  x: number; y: number; face: number; pts: Pt[];
  state: 'hidden' | 'still' | 'run'; timer: number; budget: number; speed: number; panic: boolean;
  rig: RoachRig | null; visT: number; vis: boolean; seed: number;
}

export class Roaches {
  group = new THREE.Group();
  private roaches: Roach[] = [];
  private free: RoachRig[] = [];
  private rigs = 0;
  private ok: Uint8Array;
  private rng = new Rng(0x70ac);

  constructor(private L: FloorLayout) {
    this.ok = new Uint8Array(FW * FH);
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const r = L.rooms[L.roomAt[idx(x, y)]];
      this.ok[idx(x, y)] = isWalkableTile(L, x, y) && !(r && (r.type === 'stair' || r.type === 'elevator')) ? 1 : 0;
    }
    // deterministic infestation: higher, darker floors more likely and with more rooms; dirty rooms preferred
    const rng = new Rng(hash(L.seed, L.floor, 0xc0c4));
    if (L.floor < 1 || L.theme === 'sandbox' || !rng.chance(Math.min(0.75, 0.2 + L.floor * 0.015 + L.darkness * 0.4))) return;
    const cands = L.rooms.map((room) => {
      const spawns: number[][] = [];
      for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) {
        if (L.roomAt[idx(x, y)] !== room.id || !this.walk(x, y)) continue;
        for (let w = 2; w < 4; w++) if (!this.walk(x + DX[w], y + DY[w])) spawns.push([x, y, w]); // west/north walls only (see advance)
      }
      return { wt: DIRT[room.type] ?? 0, spawns };
    }).filter((c) => c.wt > 0 && c.spawns.length >= 4);
    let rooms = Math.min(cands.length, 1 + rng.int(0, 1 + Math.floor(L.floor / 8)), 5);
    while (rooms-- > 0) {
      const c = cands.splice(rng.weighted(cands.map((c, i) => [i, c.wt] as const)), 1)[0];
      for (let n = rng.int(1, 3); n > 0; n--) {
        this.roaches.push({ spawns: c.spawns, tx: 0, ty: 0, d: 0, w: 0, x: 0, y: 0, face: 0, pts: [], state: 'hidden', timer: rng.range(1, 10), budget: 0, speed: 0, panic: false, rig: null, visT: 0, vis: false, seed: rng.next() });
      }
    }
  }

  private walk(x: number, y: number) { return x >= 0 && y >= 0 && x < FW && y < FH && this.ok[idx(x, y)] === 1; }
  private at(r: Roach, s: number): Pt { return { x: r.tx + 0.5 + DX[r.d] * s + DX[r.w] * OFF, y: r.ty + 0.5 + DY[r.d] * s + DY[r.w] * OFF }; }
  /** Queue the end of the current tile's wall segment (stop short at an inside corner). */
  private pushEnd(r: Roach) { r.pts.push(this.at(r, this.walk(r.tx + DX[r.d], r.ty + DY[r.d]) ? 0.5 : OFF)); }

  /** At the end of a segment: decide how the wall continues (invariant: own tile walkable, tile on side w is not). */
  private advance(r: Roach) {
    const was = [r.tx, r.ty, r.d, r.w], n = r.pts.length;
    const ax = r.tx + DX[r.d], ay = r.ty + DY[r.d];
    if (!this.walk(ax, ay)) { const d = r.d; r.d = (r.w + 2) % 4; r.w = d; } // inside corner: turn away from the wall
    else if (!this.walk(ax + DX[r.w], ay + DY[r.w])) { r.tx = ax; r.ty = ay; } // wall continues
    else {
      // the wall ends (door frame / outside corner): sometimes dart straight over a 1-2 tile gap to where it resumes
      if (this.rng.chance(0.4)) for (let k = 1; k <= 2; k++) {
        const bx = ax + DX[r.d] * k, by = ay + DY[r.d] * k;
        if (!this.walk(bx, by)) break;
        if (!this.walk(bx + DX[r.w], by + DY[r.w])) { r.tx = bx; r.ty = by; this.pushEnd(r); return; }
      }
      // wrap round the corner on a short arc
      const cx = r.tx + 0.5 + (DX[r.d] + DX[r.w]) * 0.5, cy = r.ty + 0.5 + (DY[r.d] + DY[r.w]) * 0.5;
      r.pts.push({ x: cx + (DX[r.d] - DX[r.w]) * 0.057, y: cy + (DY[r.d] - DY[r.w]) * 0.057 }, { x: cx + DX[r.d] * 0.08, y: cy + DY[r.d] * 0.08 });
      r.tx = ax + DX[r.w]; r.ty = ay + DY[r.w];
      const d = r.d; r.d = r.w; r.w = (d + 2) % 4;
    }
    if (r.w === 0 || r.w === 1) {
      // the camera sits at +x/+y, so a roach on the room side of an east/south wall is hidden behind it (or its
      // 0.4 m cutaway stub): turn back, or stop short in the corner instead of creeping out of sight
      r.pts.length = n; [r.tx, r.ty, r.d, r.w] = was;
      if (!this.rng.chance(0.5)) { r.budget = 0; return; }
      r.d = (r.d + 2) % 4;
    }
    this.pushEnd(r);
  }

  private hide(r: Roach, t: number) { r.state = 'hidden'; r.timer = t; r.pts = []; r.panic = false; }
  private run(r: Roach, budget: number, speed: number) { r.state = 'run'; r.budget = budget; r.speed = speed; if (!r.pts.length) this.pushEnd(r); }

  /** cam: camera target (sim x/y). people: living players on this floor. bangs: gunfire/explosions this frame. */
  update(t: number, dt: number, cam: Pt, people: Pt[], bangs: Pt[]) {
    for (const r of this.roaches) {
      const camD = Math.hypot(r.x - cam.x, r.y - cam.y);
      if (r.state !== 'hidden' && camD < THINK_R || r.state === 'hidden' && Math.hypot(r.spawns[0][0] - cam.x, r.spawns[0][1] - cam.y) < THINK_R) this.think(r, dt, people, bangs);
      // rig pool: the nearest few visible roaches borrow a rig
      const want = r.state !== 'hidden' && camD < SHOW_R;
      if (!want && r.rig) { r.rig.root.visible = false; this.free.push(r.rig); r.rig = null; }
      if (want && !r.rig) {
        if (!this.free.length && this.rigs < MAX_RIGS) { const g = new RoachRig(); this.group.add(g.root); this.free.push(g); this.rigs++; }
        r.rig = this.free.pop() ?? null;
        r.visT = 0;
      }
      if (!r.rig) continue;
      // like enemies: only drawn when a player could see it (walls already occlude, but not the dark rooms beyond)
      r.visT -= dt;
      if (r.visT <= 0) { r.visT = 0.25; r.vis = !people.length || people.some((p) => Math.hypot(p.x - r.x, p.y - r.y) < 2.6 || lineOfSight(this.L, p.x, p.y, r.x, r.y)); }
      r.rig.root.visible = r.vis;
      r.rig.update(t, dt, r.state === 'run' ? r.speed : 0, r.seed);
      r.rig.root.position.set(r.x, 0, r.y);
      r.rig.root.rotation.y = -r.face + Math.PI / 2;
    }
  }

  private think(r: Roach, dt: number, people: Pt[], bangs: Pt[]) {
    const rng = this.rng;
    if (r.state === 'hidden') {
      r.timer -= dt;
      if (bangs.some((b) => Math.hypot(b.x - r.spawns[0][0], b.y - r.spawns[0][1]) < 16)) r.timer = Math.max(r.timer, 8); // nobody comes out during a firefight
      if (r.timer > 0) return;
      const [tx, ty, w] = rng.pick(r.spawns);
      const p = { x: tx + 0.5, y: ty + 0.5 };
      if (people.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 3.5)) { r.timer = 2; return; }
      // dart out of a gap along the wall
      r.tx = tx; r.ty = ty; r.w = w; r.d = (w + (rng.chance(0.5) ? 1 : 3)) % 4;
      Object.assign(r, this.at(r, rng.range(-0.35, 0.35)));
      r.face = Math.atan2(DY[r.d], DX[r.d]); r.pts = [];
      this.run(r, rng.range(1, 4), rng.range(0.9, 1.4));
      return;
    }
    // threats: a player close by, or gunfire/explosions in earshot -> panic dash away, then vanish
    let threat: Pt | null = null;
    for (const p of people) if (Math.hypot(p.x - r.x, p.y - r.y) < 2.2) threat = p;
    for (const b of bangs) if (Math.hypot(b.x - r.x, b.y - r.y) < 12) threat = b;
    if (threat && !r.panic) {
      r.panic = true;
      if (DX[r.d] * (threat.x - r.x) + DY[r.d] * (threat.y - r.y) > 0) { r.d = (r.d + 2) % 4; r.pts = []; }
      this.run(r, rng.range(2, 4), rng.range(1.9, 2.4));
    }
    if (r.state === 'still') {
      r.timer -= dt;
      if (r.timer > 0) return;
      if (r.budget > 0) { this.run(r, r.budget, r.speed); return; } // resume after a freeze
      // vanish (more likely by a doorway or furniture), or set off again
      let gap = false;
      for (let k = 0; k < 4; k++) { const nx = r.tx + DX[k], ny = r.ty + DY[k]; if (nx >= 0 && ny >= 0 && nx < FW && ny < FH && (this.L.tiles[idx(nx, ny)] === T_DOOR || this.L.solid[idx(nx, ny)])) gap = true; }
      if (rng.chance(gap ? 0.6 : 0.3)) this.hide(r, rng.range(6, 20));
      else this.run(r, rng.range(0.8, 4), rng.range(0.9, 1.4));
      return;
    }
    // run: follow the queued wall points
    let step = r.speed * dt;
    for (let guard = 0; step > 0 && r.budget > 0 && guard < 12; guard++) { // guard: a walled-in 1-tile pocket only turns in place
      if (!r.pts.length) { this.advance(r); if (!r.pts.length) break; }
      const q = r.pts[0], dx = q.x - r.x, dy = q.y - r.y, d = Math.hypot(dx, dy);
      if (d > 1e-4) {
        const mv = Math.min(d, step, r.budget);
        r.x += (dx / d) * mv; r.y += (dy / d) * mv;
        step -= mv; r.budget -= mv;
        const want = Math.atan2(dy, dx);
        r.face += Math.atan2(Math.sin(want - r.face), Math.cos(want - r.face)) * Math.min(1, dt * 30);
      }
      if (Math.hypot(q.x - r.x, q.y - r.y) < 1e-3) r.pts.shift();
    }
    if (r.budget <= 0) {
      if (r.panic) this.hide(r, rng.range(10, 25));
      else { r.state = 'still'; r.timer = rng.range(0.6, 2.5); }
    } else if (!r.panic && rng.chance(dt * 0.7)) { r.state = 'still'; r.timer = rng.range(0.15, 0.6); } // stop-start darting
  }
}
