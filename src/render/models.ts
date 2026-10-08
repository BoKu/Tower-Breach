import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { screenQuad } from './screens';
import { currentHoliday } from '../config/holiday';
import { halloweenProp, halloweenDecor } from './halloween';
import { christmasProp, christmasDecor } from './christmas';
import { easterProp, easterDecor } from './easter';

/** Stylised-realistic original models built from primitives. Vertex-coloured so props merge into few draw calls. */
export type Bucket = 'solid' | 'emit' | 'glass' | 'screen' | 'mirror';
/** screen = animated monitor quads (see screens.ts); mirror = reflective planes (PlaneGeometry, pose read back by FloorView) */
export interface Parts { solid: THREE.BufferGeometry[]; emit: THREE.BufferGeometry[]; glass: THREE.BufferGeometry[]; screen: THREE.BufferGeometry[]; mirror: THREE.BufferGeometry[] }
export const newParts = (): Parts => ({ solid: [], emit: [], glass: [], screen: [], mirror: [] });
const BUCKETS: Bucket[] = ['solid', 'emit', 'glass', 'screen', 'mirror'];

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

export function colorize(g: THREE.BufferGeometry, color: number | THREE.Color, jitter = 0): THREE.BufferGeometry {
  const c = new THREE.Color(color as any);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = jitter ? 1 + (Math.sin(i * 12.9898) * 0.5) * jitter : 1;
    arr[i * 3] = c.r * j; arr[i * 3 + 1] = c.g * j; arr[i * 3 + 2] = c.b * j;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function xf(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  tmpE.set(rx, ry, rz);
  tmpQ.setFromEuler(tmpE);
  tmpM.compose(new THREE.Vector3(x, y, z), tmpQ, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(tmpM);
  return g;
}

function strip(g: THREE.BufferGeometry) {
  // normalise attribute set for merging
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') ng.deleteAttribute(k);
  return ng;
}

export class Builder {
  p = newParts();
  /** Any geometry, coloured and placed. */
  geo(g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, bucket: Bucket = 'solid', sx = 1, sy = 1, sz = 1) {
    g.scale(sx, sy, sz);
    this.p[bucket].push(strip(xf(colorize(g, color, 0.03), x, y, z, rx, ry, rz)));
    return this;
  }
  /** Rounded box (radius r). */
  rbox(w: number, h: number, d: number, r: number, x: number, y: number, z: number, color: number, rx = 0, ry = 0, rz = 0, bucket: Bucket = 'solid') {
    return this.geo(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)), color, x, y, z, rx, ry, rz, bucket);
  }
  /** Capsule whose top sits at (x,y,z) and hangs `len` downward (limb segment from its pivot). */
  limb(r: number, len: number, x: number, y: number, z: number, color: number, rx = 0, rz = 0, sx = 1, sz = 1) {
    const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, 10);
    g.translate(0, -len / 2, 0);
    return this.geo(g, color, x, y, z, rx, 0, rz, 'solid', sx, 1, sz);
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, bucket: Bucket = 'solid', ry = 0, rx = 0, rz = 0) {
    this.p[bucket].push(strip(xf(colorize(new THREE.BoxGeometry(w, h, d), color, 0.04), x, y, z, rx, ry, rz)));
    return this;
  }
  cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, color: number, bucket: Bucket = 'solid', seg = 10, rx = 0, rz = 0) {
    this.p[bucket].push(strip(xf(colorize(new THREE.CylinderGeometry(rt, rb, h, seg), color, 0.03), x, y, z, rx, 0, rz)));
    return this;
  }
  sphere(r: number, x: number, y: number, z: number, color: number, bucket: Bucket = 'solid', sy = 1) {
    const g = new THREE.SphereGeometry(r, 10, 8);
    g.scale(1, sy, 1);
    this.p[bucket].push(strip(xf(colorize(g, color, 0.03), x, y, z)));
    return this;
  }
  /** Reflective mirror plane facing +z. */
  mirror(w: number, h: number, x: number, y: number, z: number, ry = 0) {
    this.p.mirror.push(xf(new THREE.PlaneGeometry(w, h), x, y, z, 0, ry, 0));
    return this;
  }
  /** Animated screen quad facing +z (style -1 = random content). */
  screen(w: number, h: number, x: number, y: number, z: number, rx = 0, ry = 0, style = -1) {
    this.p.screen.push(xf(screenQuad(w, h, style), x, y, z, rx, ry, 0));
    return this;
  }
  cone(r: number, h: number, x: number, y: number, z: number, color: number, bucket: Bucket = 'solid', rx = 0) {
    this.p[bucket].push(strip(xf(colorize(new THREE.ConeGeometry(r, h, 8), color), x, y, z, rx)));
    return this;
  }
}

export function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!list.length) return null;
  return mergeGeometries(list, false);
}

/**
 * A copy of a built rig (OperatorRig, DogRig, ...) that shares its geometry and materials: the scene graph is cloned
 * and every field pointing into it (bones, groups, meshes; also inside plain objects and arrays) is re-pointed at the
 * copy; vectors are copied. Building a rig from primitives takes 5-15 ms, a copy well under one. The caller clones
 * any material it changes per instance.
 */
export function cloneRig<T extends { root: THREE.Object3D }>(proto: T): T {
  const root = proto.root.clone();
  const map = new Map<THREE.Object3D, THREE.Object3D>();
  const a: THREE.Object3D[] = [];
  proto.root.traverse((o) => a.push(o));
  let i = 0;
  root.traverse((o) => map.set(a[i++], o));
  const remap = (v: any): any => {
    if (v instanceof THREE.Object3D) return map.get(v) ?? v;
    if (v instanceof THREE.Vector3 || v instanceof THREE.Vector2 || v instanceof THREE.Euler || v instanceof THREE.Quaternion) return v.clone();
    if (Array.isArray(v)) return v.map(remap);
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x)]));
    return v;
  };
  const r = Object.create(Object.getPrototypeOf(proto));
  for (const [k, v] of Object.entries(proto)) r[k] = remap(v);
  return r;
}

/** Rotate a Parts set about Y and translate into world space. */
export function place(parts: Parts, x: number, z: number, ry: number, into: Parts) {
  tmpE.set(0, ry, 0);
  tmpQ.setFromEuler(tmpE);
  tmpM.compose(new THREE.Vector3(x, 0, z), tmpQ, new THREE.Vector3(1, 1, 1));
  for (const k of BUCKETS) for (const g of parts[k]) into[k].push(g.clone().applyMatrix4(tmpM));
}

// ------------------------------------------------------------------------------------------ props
const C = {
  deskTop: 0x6b5a48, deskLeg: 0x2a2a2c, grey: 0x5b5f64, dark: 0x25272a, black: 0x121314, metal: 0x7d858c, steel: 0x9aa3aa,
  fabric: 0x3c4a5a, fabric2: 0x5a3c3c, plant: 0x2f5a2a, pot: 0x3a3430, white: 0xd8d8d0, cream: 0xc9c1ad, red: 0xaa2222,
  wood: 0x5a4030, green: 0x3a6a3a, yellow: 0xc9a21a, rust: 0x6a3a1a, concrete: 0x6a6a66, blue: 0x2a4a7a,
};

const P = {
  oak: 0x9a7652, edge: 0x3a2c20, walnut: 0x5a3a26, frame: 0x2b2d30, panel: 0x3d4146, ped: 0x3a3d42, pedFace: 0x44484e, alu: 0xaab1b7,
  black: 0x141516, chrome: 0xc8ced4, seat: 0x23252a, mesh: 0x2e3238, steel: 0x6f757b, steelFace: 0x7c828a, steelDark: 0x2a2d31,
  sofa: 0x4a5566, sofa2: 0x56627a, fabric: 0x5f6874, leather: 0x2a1c16, book: [0x7a2020, 0x204a6a, 0x5a5a20, 0x2e2e33, 0x6a4a20, 0x3a5a3a, 0xc8b89a],
};

/** Props are authored facing +z (rot 0 = south). w,h are footprint tiles (x,z). */
export function buildProp(kind: string, w: number, h: number): Parts {
  const b = new Builder();
  const W = w - 0.1, D = h - 0.1;
  const hol = currentHoliday();
  if (hol === 'halloween' && halloweenProp(b, kind, W, D, w, h)) return b.p;
  if (hol === 'xmas' && christmasProp(b, kind, W, D, w, h)) return b.p;
  if (hol === 'easter' && easterProp(b, kind, W, D, w, h)) return b.p;
  if (kind.startsWith('pipes.')) { const [svc, seed] = kind.slice(6).split('#'); pipeRun(b, svc, Number(seed) || 0, Math.max(w, h, 1)); if (h > w) rotY(b, Math.PI / 2); return b.p; }
  switch (kind) {
    case 'desk': {
      const T = 0.75;
      b.rbox(W, 0.035, D * 0.92, 0.012, 0, T, 0, P.oak); // laminate top
      b.rbox(W + 0.005, 0.012, D * 0.92 + 0.005, 0.004, 0, T - 0.018, 0, P.edge); // edge band
      for (const sx of [-1, 1]) {
        const x = sx * (W / 2 - 0.12);
        b.rbox(0.06, T - 0.05, 0.06, 0.012, x, (T - 0.05) / 2, 0, P.frame); // T-leg
        b.rbox(0.07, 0.03, D * 0.84, 0.012, x, 0.015, 0, P.frame); // foot
        b.rbox(0.05, 0.035, D * 0.8, 0.01, x, T - 0.04, 0, P.frame); // top rail
      }
      b.rbox(W - 0.24, 0.05, 0.05, 0.01, 0, 0.62, -0.26, P.frame); // cross beam
      b.rbox(W - 0.26, 0.3, 0.012, 0.004, 0, 0.5, -D * 0.43, P.panel); // modesty panel
      // drawer pedestal
      const px = W / 2 - 0.34;
      b.rbox(0.42, 0.56, 0.52, 0.02, px, 0.31, 0.02, P.ped);
      for (let k = 0; k < 3; k++) { const y = 0.14 + k * 0.17; b.rbox(0.4, 0.16, 0.012, 0.006, px, y, 0.285, P.pedFace); b.rbox(0.14, 0.018, 0.02, 0.006, px, y + 0.05, 0.295, P.alu); }
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) b.sphere(0.02, px + cx * 0.17, 0.02, 0.02 + cz * 0.2, P.black);
      // on the desk: keyboard, mouse, papers, mug, lamp
      b.rbox(0.44, 0.02, 0.14, 0.006, -0.05, T + 0.028, 0.16, P.black).rbox(0.4, 0.004, 0.11, 0.002, -0.05, T + 0.04, 0.16, 0x2a2c30);
      b.rbox(0.06, 0.022, 0.1, 0.02, 0.28, T + 0.03, 0.17, P.black);
      b.rbox(0.21, 0.004, 0.3, 0.001, -0.62, T + 0.021, 0.08, 0xeeeeea, 0, 0.25).rbox(0.21, 0.004, 0.3, 0.001, -0.6, T + 0.026, 0.1, 0xf6f6f0, 0, -0.1);
      b.cyl(0.04, 0.036, 0.1, 0.55, T + 0.07, 0.12, 0xe8e2d6, 'solid', 14).cyl(0.034, 0.034, 0.005, 0.55, T + 0.117, 0.12, 0x3a2416, 'solid', 12);
      b.cyl(0.07, 0.08, 0.02, -W / 2 + 0.2, T + 0.03, -0.25, P.frame, 'solid', 14).rbox(0.02, 0.36, 0.02, 0.006, -W / 2 + 0.2, T + 0.2, -0.25, P.frame, 0, 0.3)
        .rbox(0.02, 0.28, 0.02, 0.006, -W / 2 + 0.2, T + 0.44, -0.12, P.frame, 0, -0.9).cone(0.07, 0.1, -W / 2 + 0.2, T + 0.5, 0.0, P.frame, 'solid', 0.4);
      b.sphere(0.04, -W / 2 + 0.2, T + 0.46, 0.02, 0xfff0c8, 'emit', 0.5);
      break;
    }
    case 'chair': {
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; b.rbox(0.3, 0.035, 0.05, 0.015, Math.cos(a) * 0.15, 0.06, Math.sin(a) * 0.15, P.black, 0, -a); b.sphere(0.028, Math.cos(a) * 0.3, 0.03, Math.sin(a) * 0.3, P.black); }
      b.cyl(0.025, 0.025, 0.3, 0, 0.23, 0, P.chrome, 'solid', 10).cyl(0.04, 0.04, 0.08, 0, 0.34, 0, P.black, 'solid', 10);
      b.rbox(0.5, 0.08, 0.48, 0.035, 0, 0.44, 0.02, P.seat);
      b.rbox(0.07, 0.04, 0.26, 0.015, 0, 0.42, -0.2, P.black, -0.4); // back support
      b.rbox(0.46, 0.52, 0.05, 0.035, 0, 0.78, -0.24, P.mesh, -0.1); // mesh back
      b.rbox(0.48, 0.54, 0.02, 0.01, 0, 0.78, -0.265, P.black, -0.1); // back frame
      b.rbox(0.36, 0.1, 0.05, 0.03, 0, 0.62, -0.215, P.seat, -0.1); // lumbar
      b.rbox(0.26, 0.12, 0.05, 0.03, 0, 1.12, -0.28, P.mesh, -0.1); // headrest
      for (const sx of [-1, 1]) { b.rbox(0.03, 0.2, 0.03, 0.01, sx * 0.25, 0.56, -0.02, P.black); b.rbox(0.065, 0.025, 0.22, 0.012, sx * 0.25, 0.67, 0.0, P.black); }
      break;
    }
    case 'boardtable': boardTable(b, W, D); break;
    case 'pokertable': pokerTable(b, W, D); break;
    case 'pokerchair': clubChair(b); break;
    case 'pokerrug': pokerRug(b, W, D); break;
    case 'barcart': barCart(b); break;
    case 'tvwall': tvWall(b); break;
    case 'credenza': credenza(b, W); break;
    case 'monitor': {
      b.rbox(0.22, 0.014, 0.16, 0.006, 0, 0.765, -0.2, P.frame).rbox(0.04, 0.3, 0.03, 0.01, 0, 0.91, -0.245, P.frame);
      b.rbox(0.64, 0.38, 0.025, 0.012, 0, 1.06, -0.22, P.black);
      b.screen(0.6, 0.34, 0, 1.065, -0.2045);
      b.box(0.02, 0.01, 0.004, 0.27, 0.885, -0.206, 0x30ff70, 'emit'); // power LED
      break;
    }
    case 'cabinet': {
      b.rbox(W * 0.84, 1.33, 0.6, 0.015, 0, 0.665, -0.05, P.steel);
      b.rbox(W * 0.86, 0.02, 0.62, 0.008, 0, 1.335, -0.05, P.steelDark);
      for (let i = 0; i < 4; i++) {
        const y = 0.2 + i * 0.32;
        b.rbox(W * 0.8, 0.29, 0.018, 0.006, 0, y, 0.255, P.steelFace);
        b.rbox(0.2, 0.035, 0.022, 0.008, 0, y + 0.07, 0.265, P.steelDark);
        b.rbox(0.09, 0.04, 0.012, 0.003, 0, y + 0.12, 0.264, 0xf0f0ea);
      }
      break;
    }
    case 'plant': snakePlant(b); break;
    case 'palm': palmPlant(b); break;
    case 'fern': fernPlant(b); break;
    case 'cactus': cactusPlant(b); break;
    case 'ficus': ficusPlant(b); break;
    case 'planter': case 'planter_grass': case 'planter_topiary': case 'planter_flowers': case 'planter_bamboo':
      planter(b, kind, W, D);
      break;
    case 'pillar':
      b.rbox(W * 0.74, 2.62, D * 0.74, 0.03, 0, 1.31, 0, 0x8e8b84);
      b.rbox(W * 0.8, 0.12, D * 0.8, 0.01, 0, 0.06, 0, 0x2a2826);
      b.rbox(W * 0.8, 0.1, D * 0.8, 0.02, 0, 2.55, 0, 0x7d7a74);
      b.rbox(0.2, 0.08, 0.012, 0.004, 0, 2.1, D * 0.371, 0x1a8a3a, 0, 0, 0, 'emit'); // exit sign
      b.cyl(0.055, 0.055, 0.38, W * 0.2, 0.62, D * 0.4, 0xb01a1a, 'solid', 12).cone(0.02, 0.06, W * 0.2, 0.84, D * 0.4, P.black); // extinguisher
      break;
    case 'reception': receptionDesk(b, W); break;
    case 'couch': case 'couch_leather': case 'couch_modular': case 'couch_bench': case 'couch_armchair': couch(b, kind, W); break;
    case 'cubicle': {
      const Hh = 1.22;
      b.rbox(W, Hh, 0.06, 0.02, 0, Hh / 2, 0, P.fabric).rbox(0.06, Hh, D, 0.02, 0, Hh / 2, 0, P.fabric);
      b.rbox(W + 0.01, 0.025, 0.075, 0.008, 0, Hh + 0.01, 0, P.alu).rbox(0.075, 0.025, D + 0.01, 0.008, 0, Hh + 0.01, 0, P.alu);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const cx = (sx * W) / 4, cz = (sz * D) / 4;
        b.rbox(W / 2 - 0.12, 0.03, D / 2 - 0.12, 0.01, cx, 0.74, cz, P.oak);
        b.rbox(0.04, 0.72, 0.04, 0.01, cx + sx * (W / 4 - 0.1), 0.36, cz + sz * (D / 4 - 0.1), P.frame);
        // monitor facing away from the partition
        const mz = cz - sz * (D / 4 - 0.14);
        b.rbox(0.5, 0.3, 0.02, 0.01, cx, 0.98, mz, P.black).box(0.46, 0.26, 0.004, cx, 0.98, mz + sz * 0.012, 0x1b4466, 'emit').rbox(0.03, 0.2, 0.03, 0.01, cx, 0.84, mz - sz * 0.01, P.frame);
        b.rbox(0.36, 0.018, 0.12, 0.005, cx, 0.765, mz + sz * 0.2, P.black);
        b.rbox(0.18, 0.12, 0.004, 0.002, cx + sx * 0.25, 1.0, sz * 0.035, 0xf2f0e6); // pinned note
        // task chair
        const chx = cx + sx * 0.05, chz = cz + sz * 0.28;
        b.cyl(0.02, 0.02, 0.3, chx, 0.2, chz, P.chrome, 'solid', 8).rbox(0.4, 0.07, 0.4, 0.03, chx, 0.43, chz, P.seat).rbox(0.38, 0.4, 0.04, 0.03, chx, 0.72, chz + sz * 0.2, P.mesh, sz * 0.1);
        for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; b.rbox(0.24, 0.03, 0.04, 0.01, chx + Math.cos(a) * 0.12, 0.05, chz + Math.sin(a) * 0.12, P.black, 0, -a); }
      }
      break;
    }
    case 'table': {
      b.rbox(W, 0.035, D * 0.82, 0.03, 0, 0.74, 0, 0xcfcac0);
      for (const sx of [-1, 1]) { b.rbox(0.05, 0.7, 0.05, 0.01, sx * (W / 2 - 0.2), 0.36, 0, P.frame); b.rbox(0.06, 0.03, D * 0.7, 0.01, sx * (W / 2 - 0.2), 0.015, 0, P.frame); }
      b.cyl(0.04, 0.036, 0.1, 0.2, 0.81, 0.1, 0xb82020, 'solid', 12).cyl(0.13, 0.08, 0.06, -0.3, 0.79, -0.05, 0xd8d0c0, 'solid', 16);
      b.sphere(0.04, -0.33, 0.83, -0.04, 0xd84a20).sphere(0.04, -0.27, 0.83, -0.07, 0x7ab030).sphere(0.04, -0.3, 0.83, 0.0, 0xe8c030);
      b.rbox(0.3, 0.012, 0.22, 0.006, 0.45, 0.764, 0.05, 0x2a2c30).rbox(0.3, 0.2, 0.01, 0.006, 0.45, 0.86, -0.06, 0x2a2c30, -0.25); b.screen(0.27, 0.17, 0.45, 0.86, -0.052, -0.25); // laptop
      break;
    }
    case 'medcab':
      b.box(0.6, 0.55, 0.16, 0, 1.3, -0.4, 0xe0e0e0).box(0.08, 0.3, 0.02, 0, 1.3, -0.31, C.red).box(0.3, 0.08, 0.02, 0, 1.3, -0.31, C.red);
      b.box(0.5, 0.8, 0.4, 0, 0.4, -0.25, 0xd0d4d6).box(0.3, 0.05, 0.02, 0, 0.6, -0.04, 0x209040);
      break;
    case 'stall': stall(b); break;
    case 'toilet': toilet(b, 0, -0.08); break;
    case 'shower': shower(b); break;
    case 'urinal': urinal(b); break;
    case 'sink': vanity(b, W); break;
    case 'kitchensink': kitchenCounter(b, W, true); break;
    case 'counter': kitchenCounter(b, W, false); break;
    case 'fridge': fridge(b); break;
    case 'rack': {
      const L = Math.max(w, h) - 0.1;
      const vert = h > w;
      const bw = vert ? 0.9 : L, bd = vert ? L : 0.9;
      b.box(bw, 2.1, bd, 0, 1.05, 0, 0x16181b);
      for (let i = 0; i < 9; i++) {
        const y = 0.3 + i * 0.2;
        for (let k = -2; k <= 2; k++) {
          const off = (k * L) / 5.5;
          const col = (i * 7 + k * 3) % 5 === 0 ? 0xff4030 : (i + k) % 3 ? 0x30ff70 : 0x40a0ff;
          if (vert) { b.box(0.02, 0.03, 0.04, 0.46, y, off, col, 'emit'); b.box(0.02, 0.03, 0.04, -0.46, y, off + 0.1, col, 'emit'); }
          else { b.box(0.04, 0.03, 0.02, off, y, 0.46, col, 'emit'); b.box(0.04, 0.03, 0.02, off + 0.1, y, -0.46, col, 'emit'); }
        }
      }
      break;
    }
    case 'toolbox': toolChest(b); break;
    case 'secdesk': {
      b.rbox(W, 0.86, D * 0.66, 0.03, 0, 0.43, 0.05, 0x2a2e33);
      b.rbox(W + 0.04, 0.04, D * 0.8, 0.015, 0, 0.88, 0.05, 0x1a1c1f);
      b.rbox(W * 0.7, 0.05, 0.22, 0.015, 0, 0.93, 0.18, 0x22252a, -0.35); // control console
      for (let i = 0; i < 14; i++) b.box(0.03, 0.012, 0.03, -W * 0.3 + i * (W * 0.6 / 13), 0.96, 0.18, [0x30ff70, 0xff3030, 0x3aa0ff, 0xffc030][i % 4], 'emit', 0, -0.35);
      b.rbox(0.46, 0.02, 0.15, 0.005, 0.1, 0.905, -0.05, P.black).rbox(0.16, 0.1, 0.12, 0.03, -W / 2 + 0.3, 0.94, -0.05, P.black); // keyboard, radio base
      break;
    }
    case 'monitors':
      b.rbox(2.1, 0.06, 0.2, 0.02, 0, 1.0, -0.26, P.frame).rbox(0.08, 0.95, 0.08, 0.02, 0, 0.5, -0.26, P.frame);
      for (let i = -1; i <= 1; i++) for (let j = 0; j < 2; j++) {
        const y = 1.22 + j * 0.42;
        b.rbox(0.64, 0.4, 0.05, 0.012, i * 0.67, y, -0.22, P.black);
        b.screen(0.6, 0.36, i * 0.67, y, -0.1935, 0, 0, i === 0 && j === 1 ? 2 : 4); // CCTV feeds, radar in the middle
      }
      break;
    case 'locker':
      b.rbox(W * 0.86, 1.92, D * 0.6, 0.015, 0, 0.96, -0.15, 0x46525c);
      b.rbox(W * 0.8, 1.84, 0.02, 0.008, 0, 0.96, 0.155, 0x52606b);
      for (let i = 0; i < 4; i++) b.box(W * 0.5, 0.02, 0.01, 0, 1.62 - i * 0.05, 0.168, 0x1a1e22);
      for (let i = 0; i < 4; i++) b.box(W * 0.5, 0.02, 0.01, 0, 0.35 - i * 0.05, 0.168, 0x1a1e22);
      b.rbox(0.04, 0.14, 0.04, 0.01, W * 0.28, 1.0, 0.18, P.chrome).rbox(0.1, 0.05, 0.005, 0.002, 0, 1.78, 0.168, 0xe8e8e0);
      break;
    case 'shelf': {
      for (const sx of [-1, 1]) for (const sz of [-0.25, 0.1]) b.rbox(0.04, 2.0, 0.04, 0.008, sx * (W * 0.44), 1.0, sz, 0x3a5a8a);
      for (let i = 0; i < 4; i++) {
        const y = 0.12 + i * 0.58;
        b.rbox(W * 0.9, 0.03, 0.42, 0.006, 0, y, -0.075, 0x8a9096);
        for (let k = 0; k < 3; k++) {
          const hgt = 0.22 + ((i * 3 + k) % 3) * 0.08;
          b.rbox(0.26, hgt, 0.32, 0.01, -0.3 + k * 0.3, y + 0.015 + hgt / 2, -0.07, (i + k) % 3 ? 0xa47c52 : 0x4a6a8a);
          if ((i + k) % 3) b.box(0.26, 0.01, 0.04, -0.3 + k * 0.3, y + 0.02 + hgt, -0.07, 0xc8a878); // box tape
        }
      }
      break;
    }
    case 'crate':
      b.rbox(0.82, 0.62, 0.82, 0.015, 0, 0.33, 0, 0x6a5a3a);
      for (const y of [0.05, 0.62]) for (const [w2, d2] of [[0.86, 0.06], [0.06, 0.86]]) { b.box(w2, 0.06, d2, 0, y, (d2 < 0.1 ? 0.41 : 0), 0x4a3e28); b.box(w2, 0.06, d2, d2 < 0.1 ? 0 : 0.41, y, d2 < 0.1 ? -0.41 : 0, 0x4a3e28); }
      for (const sx of [-0.41, 0.41]) for (const sz of [-0.41, 0.41]) b.box(0.06, 0.64, 0.06, sx, 0.33, sz, 0x4a3e28);
      b.box(0.36, 0.14, 0.004, 0, 0.36, 0.414, 0xd8c890).box(0.03, 0.03, 0.2, 0.42, 0.45, 0, 0x8a7a5a).box(0.03, 0.03, 0.2, -0.42, 0.45, 0, 0x8a7a5a); // stencil label, rope handles
      break;
    case 'generator': generator(b, W, D); break;
    case 'boiler': boiler(b); break;
    case 'pipes': pipeRun(b, 'water.steam.fire', 0, Math.max(w, 1)); break;
    case 'execdesk': {
      b.rbox(W, 0.05, D * 0.92, 0.015, 0, 0.77, 0, P.walnut);
      for (const sx of [-1, 1]) {
        b.rbox(0.5, 0.74, D * 0.86, 0.02, sx * (W / 2 - 0.27), 0.37, 0, 0x4a2f1e);
        for (let k = 0; k < 3; k++) b.rbox(0.44, 0.2, 0.012, 0.006, sx * (W / 2 - 0.27), 0.15 + k * 0.22, D * 0.43, 0x5a3a26).rbox(0.12, 0.015, 0.02, 0.006, sx * (W / 2 - 0.27), 0.2 + k * 0.22, D * 0.44, 0xc8a050);
      }
      b.rbox(W - 1.0, 0.5, 0.02, 0.01, 0, 0.5, -D * 0.4, 0x4a2f1e); // modesty panel (visitor side)
      b.rbox(0.7, 0.006, 0.45, 0.004, 0, 0.796, 0.05, 0x1a1210); // leather pad
      b.rbox(0.34, 0.012, 0.24, 0.006, 0.05, 0.805, 0.08, 0x2a2c30).rbox(0.34, 0.22, 0.01, 0.006, 0.05, 0.92, -0.04, 0x2a2c30, -0.2); b.screen(0.31, 0.19, 0.05, 0.92, -0.032, -0.2);
      b.cyl(0.06, 0.07, 0.02, -W / 2 + 0.3, 0.8, -0.2, 0xc8a050, 'solid', 14).cyl(0.012, 0.012, 0.4, -W / 2 + 0.3, 1.0, -0.2, 0xc8a050).cone(0.12, 0.16, -W / 2 + 0.3, 1.24, -0.2, 0x1f3a2a);
      b.rbox(0.22, 0.05, 0.05, 0.01, 0.5, 0.82, -0.3, 0xc8a050, 0.4); // nameplate, facing visitors
      // high-back leather chair on the sitter's side (+z, facing the drawers and laptop), back away from the desk
      b.rbox(0.56, 0.12, 0.54, 0.05, 0, 0.47, 0.78, P.leather).rbox(0.56, 0.78, 0.12, 0.06, 0, 0.92, 1.04, P.leather, 0.12);
      for (const sx of [-1, 1]) b.rbox(0.08, 0.22, 0.46, 0.03, sx * 0.3, 0.6, 0.78, P.leather);
      b.cyl(0.03, 0.03, 0.34, 0, 0.24, 0.78, P.chrome, 'solid', 10);
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; b.rbox(0.3, 0.035, 0.05, 0.015, Math.cos(a) * 0.15, 0.05, 0.78 + Math.sin(a) * 0.15, P.chrome, 0, -a); }
      break;
    }
    case 'safe':
      b.rbox(0.72, 0.84, 0.62, 0.03, 0, 0.42, -0.1, 0x2a2e30).rbox(0.66, 0.78, 0.03, 0.02, 0, 0.42, 0.215, 0x353a3d);
      b.cyl(0.08, 0.08, 0.04, 0.08, 0.5, 0.24, P.chrome, 'solid', 20, Math.PI / 2).cyl(0.03, 0.03, 0.05, 0.08, 0.5, 0.25, P.black, 'solid', 12, Math.PI / 2);
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; b.rbox(0.012, 0.12, 0.012, 0.004, -0.18 + Math.cos(a) * 0.05, 0.42 + Math.sin(a) * 0.05, 0.25, P.chrome, 0, 0, a); }
      for (const y of [0.2, 0.64]) b.cyl(0.02, 0.02, 0.12, -0.33, y, 0.22, P.chrome, 'solid', 8);
      b.box(0.08, 0.04, 0.01, 0.2, 0.66, 0.232, 0x30ff60, 'emit');
      break;
    case 'bookshelf': {
      const Hs = 2.0;
      for (const sx of [-1, 1]) b.rbox(0.04, Hs, 0.36, 0.008, sx * (W * 0.45), Hs / 2, -0.28, P.walnut);
      b.rbox(W * 0.94, 0.04, 0.38, 0.008, 0, Hs, -0.28, P.walnut).rbox(W * 0.9, Hs, 0.02, 0.004, 0, Hs / 2, -0.45, 0x3a2618);
      for (let i = 0; i < 5; i++) {
        const y = 0.05 + i * 0.39;
        b.rbox(W * 0.9, 0.03, 0.34, 0.006, 0, y, -0.28, P.walnut);
        let x = -W * 0.42;
        let k = 0;
        while (x < W * 0.38) {
          const seed = i * 13 + k * 7;
          const bw = 0.03 + (seed % 4) * 0.012, bh = 0.2 + (seed % 5) * 0.03;
          if (seed % 11 === 3) { // horizontal stack
            for (let q = 0; q < 3; q++) b.rbox(0.22, 0.035, 0.24, 0.004, x + 0.11, y + 0.035 + q * 0.037, -0.27, P.book[(seed + q) % 7]);
            x += 0.24;
          } else {
            b.rbox(bw, bh, 0.24, 0.004, x + bw / 2, y + 0.015 + bh / 2, -0.27, P.book[seed % 7], 0, 0, seed % 9 === 0 ? 0.25 : 0);
            x += bw + 0.004;
          }
          k++;
        }
      }
      b.sphere(0.06, W * 0.25, 1.65, -0.26, 0xc8a050); // ornament
      break;
    }
    case 'panel': // LED bezels only: the live status LEDs are FloorView meshes driven by the breaker state
      b.box(0.7, 1.6, 0.25, 0, 1.0, -0.35, 0x6a7078).box(0.12, 0.07, 0.01, -0.2, 1.5, -0.222, 0x141414).box(0.12, 0.07, 0.01, 0, 1.5, -0.222, 0x141414).box(0.5, 0.05, 0.02, 0, 1.2, -0.22, C.yellow);
      break;
    case 'heater':
      b.cyl(0.3, 0.3, 1.5, 0, 0.75, -0.1, 0xb0b0a8, 'solid', 12);
      break;
    case 'barricade': barricade(b, W); break;
    case 'terminal':
      b.box(0.7, 1.0, 0.5, 0, 0.5, 0, 0x202428).box(0.65, 0.4, 0.05, 0, 1.2, -0.05, C.black, 'solid', 0, -0.4); b.screen(0.58, 0.34, 0, 1.2, -0.013, -0.4, 0, 0);
      b.box(0.12, 0.08, 0.02, 0.2, 0.85, 0.26, 0x30ffa0, 'emit');
      break;
    case 'mainframe': mainframe(b); break;
    case 'car': {
      const vert = h > w;
      const Lc = Math.max(w, h) - 0.2, Wc = 1.7;
      const bw = vert ? Wc : Lc, bd = vert ? Lc : Wc;
      b.box(bw, 0.7, bd, 0, 0.55, 0, 0x2a2a2a).box(vert ? Wc * 0.9 : Lc * 0.55, 0.5, vert ? Lc * 0.55 : Wc * 0.9, 0, 1.1, 0, 0x1e2226);
      b.box(vert ? Wc * 0.86 : Lc * 0.5, 0.4, vert ? Lc * 0.5 : Wc * 0.86, 0, 1.12, 0, 0x2a3440, 'glass');
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.33, 0.33, 0.25, (sx * bw) / 2.6, 0.33, (sz * bd) / 2.6, C.black, 'solid', 10, vert ? 0 : Math.PI / 2, vert ? Math.PI / 2 : 0);
      b.box(0.6, 0.05, 0.6, 0, 0.9, 0, 0x151515);
      break;
    }
    case 'swatvan': {
      const vert = h > w;
      const Lc = Math.max(w, h) - 0.2, Wc = 1.9;
      const bw = vert ? Wc : Lc, bd = vert ? Lc : Wc;
      const f = (k: number) => (vert ? [0, (k * Lc) / 2] : [(k * Lc) / 2, 0]);
      b.box(bw, 1.9, bd, 0, 1.25, 0, 0x1c2438);
      b.box(vert ? Wc * 1.01 : Lc * 0.99, 0.22, vert ? Lc * 0.99 : Wc * 1.01, 0, 1.2, 0, 0xd8d8d8); // white stripe
      const [fx, fz] = f(0.42);
      b.box(vert ? Wc * 0.9 : 0.05, 0.55, vert ? 0.05 : Wc * 0.9, fx + (vert ? 0 : 0.03), 1.75, fz + (vert ? 0.03 : 0), 0x2a3a50, 'glass');
      b.box(vert ? 1.2 : 0.3, 0.12, vert ? 0.3 : 1.2, fx * 0.7, 2.27, fz * 0.7, 0x111111);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.4, 0.4, 0.3, (sx * bw) / 2.4, 0.4, (sz * bd) / 2.8, C.black, 'solid', 10, vert ? 0 : Math.PI / 2, vert ? Math.PI / 2 : 0);
      break;
    }
    case 'policecar': {
      const vert = h > w;
      const Lc = Math.max(w, h) - 0.3, Wc = 1.7;
      const bw = vert ? Wc : Lc, bd = vert ? Lc : Wc;
      b.box(bw, 0.65, bd, 0, 0.55, 0, 0xe8e8e8).box(vert ? Wc * 1.01 : Lc * 0.5, 0.66, vert ? Lc * 0.5 : Wc * 1.01, 0, 0.55, 0, 0x151515);
      b.box(vert ? Wc * 0.88 : Lc * 0.5, 0.45, vert ? Lc * 0.5 : Wc * 0.88, 0, 1.1, 0, 0x2a3440, 'glass');
      b.box(vert ? Wc * 0.9 : Lc * 0.52, 0.06, vert ? Lc * 0.52 : Wc * 0.9, 0, 1.35, 0, 0xe8e8e8);
      b.box(vert ? 1.1 : 0.26, 0.06, vert ? 0.26 : 1.1, 0, 1.39, 0, 0x111111); // light-bar housing
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.32, 0.32, 0.24, (sx * bw) / 2.6, 0.32, (sz * bd) / 2.6, C.black, 'solid', 10, vert ? 0 : Math.PI / 2, vert ? Math.PI / 2 : 0);
      break;
    }
    case 'tape':
    case 'tapeline': {
      const vert = h > w;
      const Ln = Math.max(w, h);
      for (const k of [-0.5, 0.5]) {
        const px = vert ? 0 : k * (Ln - 0.1), pz = vert ? k * (Ln - 0.1) : 0;
        b.cyl(0.04, 0.05, 1.0, px, 0.5, pz, 0x222222).box(0.12, 0.08, 0.12, px, 1.0, pz, C.yellow);
      }
      b.box(vert ? 0.02 : Ln, 0.07, vert ? Ln : 0.02, 0, 0.9, 0, 0xffd21a, 'emit');
      b.box(vert ? 0.021 : Ln * 0.98, 0.02, vert ? Ln * 0.98 : 0.021, 0, 0.9, 0, 0x111111);
      break;
    }
    case 'sawhorse':
      b.box(W, 0.22, 0.08, 0, 0.9, 0, 0xf0f0f0);
      for (let i = 0; i < 4; i++) b.box(W / 8, 0.22, 0.085, -W / 2 + W / 8 + (i * W) / 4, 0.9, 0, 0xd02020);
      for (const sx of [-1, 1]) { b.box(0.06, 0.95, 0.06, (sx * W) / 2.3, 0.45, 0.15, 0x888888, 'solid', 0, 0.3); b.box(0.06, 0.95, 0.06, (sx * W) / 2.3, 0.45, -0.15, 0x888888, 'solid', 0, -0.3); }
      break;
    case 'cone':
      b.cone(0.16, 0.55, 0, 0.3, 0, 0xff6a10).cyl(0.1, 0.12, 0.08, 0, 0.3, 0, 0xf0f0f0).box(0.36, 0.04, 0.36, 0, 0.02, 0, 0x222222);
      break;
    case 'tent':
      b.box(W, 1.9, D, 0, 0.95, 0, 0x2a3a5a).box(W * 0.3, 1.6, 0.02, 0, 0.8, D / 2 + 0.01, 0x111820);
      b.cone(Math.hypot(W, D) / 2, 0.9, 0, 2.35, 0, 0x22304a);
      b.box(W * 0.6, 0.3, 0.02, 0, 1.6, D / 2 + 0.02, 0xd8d8d8);
      break;
    case 'floodlight':
      b.cyl(0.07, 0.1, 4.2, 0, 2.1, 0, 0x3a3a3a).box(1.2, 0.5, 0.15, 0, 4.3, 0, 0x2a2a2a).box(1.1, 0.4, 0.02, 0, 4.3, 0.08, 0xeeeedd, 'emit');
      b.box(0.8, 0.3, 0.6, 0, 0.15, 0, 0x5a5a2a);
      break;
    case 'barrier':
      b.box(W, 0.8, 0.5, 0, 0.4, 0, 0x8a8a84).box(W, 0.15, 0.52, 0, 0.6, 0, 0xaa2020);
      break;
    case 'booth':
      b.box(W * 0.9, 2.3, D * 0.9, 0, 1.15, 0, 0x2e3438).box(W * 0.92, 0.8, D * 0.92, 0, 1.5, 0, 0x5a7a8a, 'glass').box(W, 0.1, D, 0, 2.35, 0, 0x1a1a1a);
      break;
    case 'barrel': drum(b); break;
    case 'streetlight':
      b.cyl(0.08, 0.1, 5, 0, 2.5, 0, 0x2a2a2a).box(1.0, 0.1, 0.2, 0.45, 5, 0, 0x2a2a2a).box(0.4, 0.06, 0.18, 0.8, 4.94, 0, 0xdde6ff, 'emit');
      break;
    case 'sandbags': sandbags(b, W); break;
    case 'vending': vending(b); break;
    default:
      b.box(W * 0.8, 0.7, D * 0.8, 0, 0.35, 0, C.grey);
  }
  if (hol === 'halloween') halloweenDecor(b, kind, W, D, w, h);
  if (hol === 'xmas') christmasDecor(b, kind, W, D, w, h);
  if (hol === 'easter') easterDecor(b, kind, W, D, w, h);
  return b.p;
}

// ------------------------------------------------------------------------------------------ detailed props
const hash01 = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Turned pot / vessel from a (radius, height) profile. */
function lathe(b: Builder, profile: [number, number][], color: number, seg = 22, y = 0, x = 0, z = 0) {
  b.geo(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg), color, x, y, z);
}
/** Thin cylinder from a to c. */
function rod(b: Builder, a: THREE.Vector3, c: THREE.Vector3, r: number, color: number, seg = 6) {
  const d = c.clone().sub(a), len = d.length();
  if (len < 1e-4) return;
  const g = new THREE.CylinderGeometry(r * 0.85, r, len, seg);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  b.geo(g, color, a.x, a.y, a.z);
}
/** Flat elliptical leaf with its base at (x,y,z), pointing along yaw (0 = +z) and pitched up by `pitch`. */
function leaf(b: Builder, len: number, wid: number, x: number, y: number, z: number, yaw: number, pitch: number, color: number) {
  const g = new THREE.SphereGeometry(0.5, 6, 4);
  g.translate(0, 0, 0.5);
  g.scale(wid, 0.014, len);
  g.rotateX(-pitch);
  g.rotateY(yaw);
  b.geo(g, color, x, y, z);
}
const dirOf = (yaw: number, pitch: number) => new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
/** Arching frond: a drooping stem with paired leaflets. */
function frond(b: Builder, o: THREE.Vector3, yaw: number, pitch0: number, droop: number, length: number, n: number, leafLen: number, leafW: number, colors: number[], stem: number, spread = 1.15) {
  let p = o.clone();
  for (let i = 0; i < n; i++) {
    const k = i / n, pitch = pitch0 - droop * k;
    const q = p.clone().add(dirOf(yaw, pitch).multiplyScalar(length / n));
    rod(b, p, q, 0.008 * (1 - 0.5 * k) + 0.003, stem, 4);
    const ll = leafLen * (1 - 0.55 * k * k);
    for (const side of [-1, 1]) leaf(b, ll, leafW, q.x, q.y, q.z, yaw + side * spread, pitch - 0.35, colors[(i + (side > 0 ? 1 : 0)) % colors.length]);
    p = q;
  }
  leaf(b, leafLen * 0.5, leafW, p.x, p.y, p.z, yaw, pitch0 - droop - 0.2, colors[0]);
}
const SOIL = 0x2b1f14;

/**
 * Pipe services and their colour code (game-ready simplification):
 * green water/cooling, blue compressed air/ventilation, red fire protection, yellow gas/volatile chemicals,
 * brown diesel/oil, gray steam/high-pressure heating, purple graywater, black sewage/drainage.
 */
export const PIPE_SERVICES: Record<string, { color: number; r: number; label: string }> = {
  water: { color: 0x2f8a46, r: 0.055, label: 'cooling water' },
  air: { color: 0x2a64b8, r: 0.045, label: 'compressed air' },
  fire: { color: 0xc0201c, r: 0.07, label: 'fire sprinkler' },
  gas: { color: 0xe0b41c, r: 0.04, label: 'gas' },
  fuel: { color: 0x6a4424, r: 0.045, label: 'diesel' },
  steam: { color: 0x8c9096, r: 0.06, label: 'steam' },
  graywater: { color: 0x6f3a9a, r: 0.065, label: 'graywater' },
  sewage: { color: 0x1c1d1f, r: 0.09, label: 'sewage' },
};

/** Rotate everything built so far about Y (pipe runs laid north-south). */
function rotY(b: Builder, a: number) {
  const m = new THREE.Matrix4().makeRotationY(a);
  for (const k of BUCKETS) for (const g of b.p[k]) g.applyMatrix4(m);
}

/**
 * Wall-mounted pipe bank running along x (length len), mounted on the -z wall face (local z = -0.3).
 * `services` is a dot list, top pipe first. Deterministic details from `seed`: flanges, clamps, ID bands with flow
 * arrows, and now and then a stop valve (hand-wheel), a ball valve (lever), a drain tap or a pressure gauge.
 */
function pipeRun(b: Builder, services: string, seed: number, len: number) {
  const list = services.split('.').filter((k) => PIPE_SERVICES[k]);
  const X = Math.PI / 2, half = len / 2;
  const steel = 0x8a9096, bolt = 0x4a4e54, white = 0xe8e6de;
  const zc = -0.14; // pipe centre line, clear of the wall
  // shared wall rail brackets
  for (let x = -half + 0.35; x <= half - 0.2; x += 1.2) {
    const rh = 0.1 + list.length * 0.17;
    b.box(0.05, rh, 0.03, x, 2.54 - rh / 2, -0.285, 0x3a3e44);
  }
  list.forEach((svc, i) => {
    const S = PIPE_SERVICES[svc];
    const y = 2.48 - i * 0.17 - S.r; // high on the wall so banks clear door heads
    const R = S.r;
    const body = svc === 'steam' ? 0xb8bcc0 : S.color; // steam: lagged in gray jacket
    b.cyl(R, R, len, 0, y, zc, body, 'solid', 12, 0, X);
    if (svc === 'steam') for (let x = -half + 0.2; x < half; x += 0.45) b.cyl(R + 0.006, R + 0.006, 0.02, x, y, zc, 0x6f7378, 'solid', 12, 0, X); // jacket straps
    // clamps to the rail
    for (let x = -half + 0.35; x <= half - 0.2; x += 1.2) {
      b.geo(new THREE.TorusGeometry(R + 0.008, 0.008, 5, 14), steel, x, y, zc, 0, X);
      b.box(0.02, 0.02, 0.15, x, y, zc - 0.075 - R / 2, steel);
    }
    // flanged joints with bolt heads
    for (let x = -half + 0.95; x < half - 0.1; x += 1.9) {
      b.cyl(R + 0.022, R + 0.022, 0.045, x, y, zc, svc === 'sewage' ? 0x2a2b2e : steel, 'solid', 14, 0, X);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b.box(0.05, 0.012, 0.012, x, y + Math.sin(a) * (R + 0.012), zc + Math.cos(a) * (R + 0.012), bolt); }
    }
    // ID band + flow arrow every ~2 m (white band so the service colour reads in the dark)
    for (let x = -half + 0.6; x < half - 0.3; x += 2.1) {
      b.cyl(R + 0.003, R + 0.003, 0.14, x, y, zc, white, 'solid', 12, 0, X);
      b.cyl(R + 0.004, R + 0.004, 0.08, x, y, zc, S.color, 'solid', 12, 0, X);
      const dir = hash01(seed * 13 + i) > 0.5 ? 1 : -1;
      b.geo(new THREE.ConeGeometry(0.025, 0.07, 3), white, x + dir * 0.13, y, zc + R + 0.004, 0, 0, -dir * X, 'solid', 1, 1, 0.3);
    }
    // fittings along the run
    const n = len < 2 ? 1 : Math.floor(len / 2.5) + 1;
    for (let k = 0; k < n; k++) {
      const h = hash01(seed * 7 + i * 31 + k * 3);
      if (h < 0.45) continue;
      const x = -half + (k + 0.5) * (len / n) + (hash01(seed + i + k * 11) - 0.5) * 0.4;
      const kind = svc === 'gas' || svc === 'air' || svc === 'fuel' ? 'lever' : svc === 'steam' && h > 0.8 ? 'gauge' : svc === 'water' && h > 0.82 ? 'tap' : 'wheel';
      if (kind === 'wheel') {
        // gate / stop valve: body, bonnet, stem and hand-wheel on top
        b.geo(new THREE.SphereGeometry(R + 0.035, 10, 8), 0x3c4046, x, y, zc, 0, 0, 0, 'solid', 1.3, 1, 1);
        b.cyl(R + 0.03, R + 0.03, 0.05, x - R - 0.03, y, zc, steel, 'solid', 12, 0, X).cyl(R + 0.03, R + 0.03, 0.05, x + R + 0.03, y, zc, steel, 'solid', 12, 0, X);
        b.cyl(0.03, 0.035, 0.08, x, y + R + 0.07, zc, 0x3c4046, 'solid', 8);
        b.cyl(0.008, 0.008, 0.08, x, y + R + 0.14, zc, steel, 'solid', 6);
        const wheel = svc === 'fire' ? 0xd02020 : 0xb02a1e;
        b.geo(new THREE.TorusGeometry(0.06, 0.009, 5, 16), wheel, x, y + R + 0.18, zc, X);
        for (let sp = 0; sp < 3; sp++) b.box(0.12, 0.008, 0.008, x, y + R + 0.18, zc, wheel, 'solid', (sp / 3) * Math.PI);
      } else if (kind === 'lever') {
        // quarter-turn ball valve with a lever handle
        b.rbox(0.09, R * 2 + 0.03, R * 2 + 0.03, 0.01, x, y, zc, 0x9a8a40);
        b.cyl(0.01, 0.01, 0.04, x, y + R + 0.03, zc, steel, 'solid', 6);
        b.rbox(0.16, 0.012, 0.025, 0.005, x + 0.07, y + R + 0.055, zc, svc === 'gas' ? 0xe0b41c : 0xc0201c);
      } else if (kind === 'tap') {
        // drain tap: tee down, spout and cross-head handle
        b.cyl(0.018, 0.018, 0.12, x, y - R - 0.06, zc, steel, 'solid', 8);
        b.cyl(0.012, 0.012, 0.07, x, y - R - 0.12, zc + 0.03, steel, 'solid', 8, X * 0.8);
        b.box(0.07, 0.01, 0.01, x, y - R - 0.1, zc, 0xc0201c).box(0.01, 0.01, 0.07, x, y - R - 0.1, zc, 0xc0201c);
      } else {
        // pressure gauge on a short riser
        b.cyl(0.01, 0.01, 0.07, x, y + R + 0.035, zc, steel, 'solid', 6);
        b.cyl(0.045, 0.045, 0.025, x, y + R + 0.11, zc + 0.01, 0x2a2c30, 'solid', 16, X);
        b.cyl(0.038, 0.038, 0.004, x, y + R + 0.11, zc + 0.024, white, 'solid', 16, X);
        b.box(0.004, 0.03, 0.002, x + 0.006, y + R + 0.12, zc + 0.027, 0xc0201c, 'solid', 0, 0, -0.6);
      }
    }
    // the biggest drains drop to the floor at one end with an elbow
    if ((svc === 'sewage' || svc === 'graywater') && hash01(seed + i * 5) > 0.35) {
      const ex = (hash01(seed + i) > 0.5 ? 1 : -1) * (half - 0.25);
      b.geo(new THREE.SphereGeometry(R + 0.012, 10, 8), body, ex, y, zc);
      b.cyl(R, R, y, ex, y / 2, zc, body, 'solid', 12);
      b.cyl(R + 0.02, R + 0.03, 0.06, ex, 0.03, zc, 0x2a2b2e, 'solid', 12);
    }
  });
}

/** Planter boxes (kinds listed in gen PLANTER_KINDS): 1x1 or longer troughs (w along x). */
function planter(b: Builder, kind: string, W: number, D: number) {
  const pw = Math.min(W * 0.92, 2.6), pd = Math.min(D * 0.92, 0.9);
  const across = (n: number, f: (x: number, z: number, i: number) => void) => {
    const nx = Math.max(1, Math.round(pw / 0.32) * n), nz = Math.max(1, Math.round(pd / 0.32) * n);
    let i = 0;
    for (let a = 0; a < nx; a++) for (let c = 0; c < nz; c++, i++) f(-pw / 2 + (a + 0.5 + (hash01(i * 3.7) - 0.5) * 0.6) * (pw / nx), -pd / 2 + (c + 0.5 + (hash01(i * 5.3) - 0.5) * 0.6) * (pd / nz), i);
  };
  const soil = (y: number, c = SOIL) => b.rbox(pw - 0.08, 0.02, pd - 0.08, 0.005, 0, y, 0, c);
  switch (kind) {
    case 'planter': {
      // charcoal fibre-stone trough with a lip: mixed shrubs and trailing ivy over the rim
      const H = 0.5;
      b.rbox(pw, H, pd, 0.03, 0, H / 2, 0, 0x3a3b3e).rbox(pw + 0.04, 0.04, pd + 0.04, 0.015, 0, H, 0, 0x2a2b2e).rbox(pw - 0.1, 0.03, pd + 0.005, 0.005, 0, 0.03, 0, 0x1e1f21);
      soil(H - 0.01);
      across(1, (x, z, i) => {
        const r = 0.13 + hash01(i) * 0.06, y = H + 0.1 + hash01(i + 9) * 0.12;
        b.geo(new THREE.IcosahedronGeometry(r, 1), [0x2f5a2a, 0x3a6a30, 0x274d24][i % 3], x, y, z);
        for (let k = 0; k < 6; k++) { const yaw = hash01(i * 11 + k) * 6.283, el = hash01(i * 13 + k) * 1.2 - 0.2, d = dirOf(yaw, el).multiplyScalar(r * 0.8); leaf(b, 0.1, 0.05, x + d.x, y + d.y, z + d.z, yaw, el * 0.5, [0x3b6e2e, 0x4a7f36][k % 2]); }
      });
      for (let k = 0; k < 6; k++) { // ivy trailing over the front and back lips
        const sx = -pw / 2 + (k + 0.5) * (pw / 6), sz = (k % 2 ? 1 : -1) * (pd / 2 + 0.01);
        for (let m = 0; m < 4; m++) leaf(b, 0.07, 0.05, sx + (hash01(k * 7 + m) - 0.5) * 0.1, H - m * 0.09, sz, sz > 0 ? 0 : Math.PI, -1.2, 0x356b2d);
      }
      break;
    }
    case 'planter_grass': {
      // weathered corten steel box with ornamental grass tufts swaying outward
      const H = 0.55;
      b.rbox(pw, H, pd, 0.008, 0, H / 2, 0, 0x8a4a22).rbox(pw + 0.02, 0.02, pd + 0.02, 0.004, 0, H, 0, 0x6a3a1a);
      for (let k = 0; k < 5; k++) b.box(0.01, H * (0.3 + hash01(k) * 0.5), 0.006, -pw / 2 + (k + 0.5) * (pw / 5), H * 0.55, pd / 2 + 0.002, 0x5a2e12); // rust streaks
      soil(H - 0.01, 0x6a6258);
      across(1, (x, z, i) => {
        for (let k = 0; k < 11; k++) {
          const a = k * 2.39996 + i, lean = 0.12 + (k % 4) * 0.1, hgt = 0.45 + hash01(i * 17 + k) * 0.4;
          b.geo(new THREE.ConeGeometry(0.012, hgt, 3), [0x8a9a4a, 0x6f8a3a, 0xa8a860][k % 3], x + Math.cos(a) * 0.02, H + hgt / 2 - 0.02, z + Math.sin(a) * 0.02, Math.sin(a) * lean, a, -Math.cos(a) * lean);
        }
        b.geo(new THREE.ConeGeometry(0.02, 0.14, 5), 0xd8c89a, x, H + 0.75, z, 0.2 * Math.sin(i), 0, 0.2 * Math.cos(i)); // seed plume
      });
      break;
    }
    case 'planter_topiary': {
      // pale limestone planter with clipped boxwood balls on bark mulch
      const H = 0.42;
      b.rbox(pw, H, pd, 0.02, 0, H / 2, 0, 0xcfc8b8).rbox(pw + 0.06, 0.05, pd + 0.06, 0.02, 0, H, 0, 0xdcd6c8).rbox(pw + 0.02, 0.05, pd + 0.02, 0.01, 0, 0.025, 0, 0xb8b0a0);
      soil(H - 0.01, 0x5a3a24);
      const n = Math.max(1, Math.round(pw / 0.5));
      for (let k = 0; k < n; k++) {
        const x = -pw / 2 + (k + 0.5) * (pw / n), r = Math.min(0.28, pd * 0.36) * (k % 2 ? 0.8 : 1);
        b.geo(new THREE.IcosahedronGeometry(r, 2), 0x2d5a26, x, H + r * 0.9, 0);
        for (let m = 0; m < 14; m++) { const yaw = hash01(k * 29 + m) * 6.283, el = hash01(k * 31 + m) * 1.6 - 0.4, d = dirOf(yaw, el).multiplyScalar(r * 0.95); b.sphere(0.035, x + d.x, H + r * 0.9 + d.y, d.z, [0x3a6e30, 0x2a5424][m % 2], 'solid', 0.8); }
      }
      break;
    }
    case 'planter_flowers': {
      // slatted cedar box: low foliage with clusters of flowers
      const H = 0.45;
      for (let k = 0; k < 4; k++) b.rbox(pw, 0.1, pd, 0.008, 0, 0.06 + k * 0.105, 0, k % 2 ? 0x9a6a3e : 0xa8764a);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rbox(0.05, H + 0.02, 0.05, 0.008, sx * (pw / 2 - 0.02), (H + 0.02) / 2, sz * (pd / 2 - 0.02), 0x6a4628);
      soil(H - 0.01);
      const petals = [0xd8283a, 0xf0c020, 0x8a3ad0, 0xf4f0ea, 0xf06aa0];
      across(2, (x, z, i) => {
        b.geo(new THREE.IcosahedronGeometry(0.07, 0), [0x3a6a30, 0x2f5a2a][i % 2], x, H + 0.05, z);
        const c = petals[Math.floor(hash01(i * 7.1) * petals.length)], y = H + 0.12 + hash01(i) * 0.1;
        rod(b, new THREE.Vector3(x, H, z), new THREE.Vector3(x, y, z), 0.006, 0x3a6a30, 4);
        for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + i; leaf(b, 0.045, 0.03, x, y, z, a, 0.35, c); }
        b.sphere(0.014, x, y + 0.01, z, 0xf2d040);
      });
      break;
    }
    case 'planter_bamboo': {
      // glossy black square planter, pebbles, segmented bamboo canes with leaf sprays
      const H = 0.6;
      b.rbox(pw, H, pd, 0.02, 0, H / 2, 0, 0x121316).rbox(pw + 0.02, 0.02, pd + 0.02, 0.006, 0, H, 0, 0x2a2c30);
      soil(H - 0.01, 0x9a968e);
      across(1, (x, z, i) => b.sphere(0.03, x, H + 0.005, z, [0xb8b4aa, 0x7a766e][i % 2], 'solid', 0.5));
      const canes = Math.max(4, Math.round(pw * 6));
      for (let k = 0; k < canes; k++) {
        const x = -pw / 2 + 0.08 + hash01(k * 3.1) * (pw - 0.16), z = -pd / 2 + 0.08 + hash01(k * 4.7) * (pd - 0.16);
        const top = 1.5 + hash01(k * 9.3) * 0.55, lx = (hash01(k) - 0.5) * 0.12, lz = (hash01(k + 2) - 0.5) * 0.12;
        rod(b, new THREE.Vector3(x, H, z), new THREE.Vector3(x + lx, top, z + lz), 0.018, 0x8a9a3a, 8);
        for (let y = H + 0.28; y < top; y += 0.3) { const f = (y - H) / (top - H); b.cyl(0.021, 0.021, 0.018, x + lx * f, y, z + lz * f, 0x6a7a2a, 'solid', 8); }
        for (let m = 0; m < 7; m++) { const f = 0.6 + m * 0.06, yaw = hash01(k * 17 + m) * 6.283; leaf(b, 0.2, 0.035, x + lx * f, H + (top - H) * f, z + lz * f, yaw, -0.25 - hash01(m + k) * 0.35, [0x4a8a34, 0x5d9c40, 0x3a7a2a][m % 3]); }
      }
      break;
    }
  }
}

// ------------------------------------------------------------------ fortifications
function barricade(b: Builder, W: number) {
  // welded steel riot barricade: A-frame legs, overlapping armour plates, hazard rail and razor wire
  const L = W * 0.98, dark = 0x26292d, plate = 0x585d63, seam = 0x3a3e43;
  for (const x of [-(L / 2 - 0.15), 0, L / 2 - 0.15]) {
    b.rbox(0.06, 1.02, 0.06, 0.01, x, 0.5, 0.18, dark, -0.35).rbox(0.06, 1.02, 0.06, 0.01, x, 0.5, -0.18, dark, 0.35);
    b.rbox(0.07, 0.05, 0.7, 0.01, x, 0.03, 0, dark);
  }
  for (let k = 0; k < 3; k++) {
    const y = 0.22 + k * 0.28, z = 0.07 - k * 0.035;
    b.rbox(L - 0.06, 0.3, 0.035, 0.008, 0, y, z, [plate, 0x62676d, 0x51565c][k], -0.12);
    b.box(L - 0.1, 0.012, 0.004, 0, y - 0.1, z + 0.022, seam, 'solid', 0, -0.12);
    for (let i = 0; i < 6; i++) b.cyl(0.012, 0.012, 0.012, -L / 2 + 0.12 + i * ((L - 0.24) / 5), y + 0.1, z + 0.02, 0x8a9096, 'solid', 6, Math.PI / 2 - 0.12);
  }
  // hazard rail: black bar with slanted yellow stripes
  b.rbox(L, 0.09, 0.1, 0.01, 0, 0.98, 0, 0x151515);
  for (let x = -L / 2 + 0.07; x < L / 2 - 0.04; x += 0.15) b.box(0.05, 0.1, 0.004, x, 0.98, 0.052, 0xe6b81c, 'solid', 0, 0, 0.6).box(0.05, 0.1, 0.004, x, 0.98, -0.052, 0xe6b81c, 'solid', 0, 0, -0.6);
  // concertina wire coil
  for (let x = -L / 2 + 0.06; x < L / 2 - 0.04; x += 0.07) b.geo(new THREE.TorusGeometry(0.12, 0.005, 3, 14), 0xa0a8ae, x, 1.14, 0, 0.25 * Math.sin(x * 9), Math.PI / 2 + 0.35);
  b.box(0.2, 0.14, 0.006, L / 4, 0.62, 0.075, 0xe6b81c, 'solid', 0, -0.12).box(0.14, 0.02, 0.008, L / 4, 0.64, 0.078, 0x151515, 'solid', 0, -0.12); // warning placard
}

function sandbags(b: Builder, W: number) {
  // hessian sandbags laid in stretcher bond, two deep at the base, tied ears at the ends
  const L = W * 0.96, cols = [0x7a6a48, 0x6f6040, 0x857452, 0x6a5c3e, 0x74664a], bagL = 0.5;
  let seed = 1;
  const rnd = () => hash01(seed++ * 1.37);
  for (let k = 0; k < 5; k++) {
    const y = 0.085 + k * 0.155, rows = k < 3 ? [-0.14, 0.14] : [0];
    for (const z of rows) {
      const off = k % 2 ? bagL / 2 : 0, n = Math.floor((L - off) / bagL);
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + off + bagL / 2 + i * bagL, ry = (rnd() - 0.5) * 0.12;
        b.rbox(bagL - 0.03, 0.16, 0.29, 0.075, x, y, z, cols[Math.floor(rnd() * cols.length)], (rnd() - 0.5) * 0.06, ry, (rnd() - 0.5) * 0.05);
        b.geo(new THREE.SphereGeometry(0.035, 6, 4), 0x5e5238, x + (bagL / 2 - 0.02) * Math.cos(ry), y + 0.02, z - (bagL / 2 - 0.02) * Math.sin(ry), 0, 0, 0, 'solid', 1.4, 0.7, 1);
      }
    }
  }
}

// ------------------------------------------------------------------ plant room
function generator(b: Builder, W: number, D: number) {
  // diesel genset on a skid: fuel-tank base, louvred enclosure, control panel, radiator end, exhaust stack
  const yel = 0xc99a1e, dark = 0x1c1e21, steel = 0x6f757b;
  const L = W * 0.9, Dp = D * 0.72;
  for (const z of [-Dp / 2, Dp / 2]) b.rbox(L + 0.1, 0.12, 0.12, 0.01, 0, 0.06, z, dark);
  b.rbox(L, 0.26, Dp + 0.1, 0.02, 0, 0.25, 0, 0x2a2d31);
  b.cyl(0.05, 0.05, 0.05, -L / 2 + 0.2, 0.4, Dp / 2 + 0.02, 0xc0201c, 'solid', 10, Math.PI / 2); // fuel cap
  b.rbox(L - 0.06, 1.12, Dp, 0.03, 0, 0.94, 0, yel);
  b.rbox(L - 0.02, 0.05, Dp + 0.04, 0.015, 0, 1.52, 0, 0xa8801a);
  for (const sz of [-1, 1]) for (let i = 0; i < 9; i++) b.box(0.03, 0.6, 0.012, -L / 2 + 0.3 + i * 0.1, 0.94, sz * (Dp / 2 + 0.006), 0x6a5212, 'solid', 0, sz * 0.5); // louvres
  // radiator end
  b.box(0.012, 0.8, Dp - 0.2, -L / 2 + 0.02, 0.95, 0, dark);
  for (let i = 0; i < 12; i++) b.box(0.02, 0.78, 0.012, -L / 2 + 0.015, 0.95, -Dp / 2 + 0.16 + i * ((Dp - 0.32) / 11), 0x3a3e43);
  // control panel on the front, with a live readout
  const px = L / 2 - 0.42, pz = Dp / 2 + 0.012;
  b.rbox(0.52, 0.5, 0.03, 0.01, px, 1.05, pz, dark);
  b.screen(0.22, 0.12, px - 0.1, 1.18, pz + 0.017, 0, 0, 3);
  for (let i = 0; i < 3; i++) { b.cyl(0.04, 0.04, 0.012, px + 0.12, 1.2 - i * 0.12, pz + 0.02, 0xe8e6de, 'solid', 14, Math.PI / 2); b.box(0.004, 0.03, 0.002, px + 0.12, 1.21 - i * 0.12, pz + 0.027, 0xc0201c, 'solid', 0, 0, 0.8 - i * 0.5); }
  b.cyl(0.035, 0.035, 0.03, px - 0.16, 0.9, pz + 0.025, 0xd01818, 'solid', 12, Math.PI / 2); // e-stop
  b.box(0.025, 0.025, 0.008, px - 0.06, 0.92, pz + 0.018, 0x30ff70, 'emit').box(0.025, 0.025, 0.008, px, 0.92, pz + 0.018, 0xffb020, 'emit');
  for (let i = 0; i < 2; i++) b.rbox(0.03, 0.12, 0.03, 0.01, -0.2 + i * 0.5, 0.95, pz + 0.01, 0xc8ccd0); // door handles
  b.box(0.16, 0.1, 0.004, -0.45, 1.25, pz + 0.004, 0xf0f0ea).box(0.1, 0.03, 0.005, -0.45, 1.26, pz + 0.006, 0xc0201c); // warning label
  // exhaust stack and muffler
  b.cyl(0.14, 0.14, 0.55, L / 2 - 0.4, 1.7, -0.15, 0x3a3e43, 'solid', 14, 0, Math.PI / 2);
  b.cyl(0.06, 0.06, 0.7, L / 2 - 0.12, 1.95, -0.15, 0x3a3e43, 'solid', 10);
  b.box(0.16, 0.012, 0.14, L / 2 - 0.12, 2.32, -0.15, 0x2a2d31, 'solid', 0, 0, 0.35);
  for (const [x, z] of [[-L / 2 + 0.1, -Dp / 2 + 0.1], [L / 2 - 0.1, Dp / 2 - 0.1]]) b.geo(new THREE.TorusGeometry(0.04, 0.012, 5, 12), steel, x, 1.58, z); // lifting eyes
  // power cables out the side down to the floor
  for (let i = 0; i < 3; i++) rod(b, new THREE.Vector3(L / 2 - 0.03, 0.6 - i * 0.08, -0.2 + i * 0.1), new THREE.Vector3(L / 2 + 0.25, 0.02, -0.3 + i * 0.12), 0.022, [0x151515, 0x1a1a40, 0x401a1a][i]);
}

function boiler(b: Builder) {
  // vertical fire-tube boiler: banded shell, domed top, burner with flame port, gauges, flue and pipework up to the ceiling
  const shell = 0x7a2418, band = 0x55595e, steel = 0x8a9096, dark = 0x1f2124;
  for (const [x, z] of [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]]) b.rbox(0.06, 0.16, 0.06, 0.01, x, 0.08, z, dark);
  b.cyl(0.37, 0.37, 0.06, 0, 0.18, 0, dark, 'solid', 24);
  b.cyl(0.35, 0.35, 1.5, 0, 0.95, 0, shell, 'solid', 28);
  for (const y of [0.3, 0.75, 1.2, 1.65]) b.cyl(0.358, 0.358, 0.04, 0, y, 0, band, 'solid', 28);
  b.geo(new THREE.SphereGeometry(0.35, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), shell, 0, 1.7, 0, 0, 0, 0, 'solid', 1, 0.4, 1);
  // burner housing and flame port
  b.rbox(0.34, 0.3, 0.2, 0.02, 0, 0.42, 0.36, dark);
  b.cyl(0.06, 0.06, 0.012, 0, 0.45, 0.465, 0xff6020, 'emit', 16, Math.PI / 2);
  b.geo(new THREE.TorusGeometry(0.065, 0.012, 5, 16), steel, 0, 0.45, 0.466);
  b.rbox(0.12, 0.08, 0.1, 0.01, 0.2, 0.35, 0.4, 0x2a3a5a); // blower motor
  // gauges and brass nameplate
  for (const x of [-0.1, 0.1]) { b.cyl(0.055, 0.055, 0.03, x, 1.35, 0.36, dark, 'solid', 16, Math.PI / 2); b.cyl(0.045, 0.045, 0.004, x, 1.35, 0.377, 0xe8e6de, 'solid', 16, Math.PI / 2); b.box(0.004, 0.035, 0.002, x, 1.36, 0.38, 0xc0201c, 'solid', 0, 0, x * 8); }
  b.box(0.2, 0.08, 0.006, 0, 1.0, 0.352, 0xb8943a);
  // flue and pipework to the ceiling, with valves
  b.cyl(0.08, 0.08, 0.9, 0, 2.15, -0.05, 0x3a3e43, 'solid', 12);
  const pipes: [number, number][] = [[-0.2, PIPE_SERVICES.steam.color], [0.2, PIPE_SERVICES.water.color]];
  for (const [x, c] of pipes) {
    b.cyl(0.035, 0.035, 0.8, x, 2.2, 0.08, c, 'solid', 10);
    b.cyl(0.05, 0.05, 0.06, x, 2.0, 0.08, 0x3c4046, 'solid', 10);
    b.geo(new THREE.TorusGeometry(0.05, 0.008, 5, 14), 0xc0201c, x, 2.0, 0.15);
  }
  b.cyl(0.02, 0.02, 0.12, 0.18, 1.86, -0.15, steel, 'solid', 8).rbox(0.12, 0.012, 0.02, 0.004, 0.22, 1.93, -0.15, 0xc0201c); // safety valve
  b.cyl(0.015, 0.015, 0.1, -0.3, 0.3, 0.2, steel, 'solid', 8, 0, Math.PI / 2); // blowdown tap
}

// ------------------------------------------------------------------ seating
function couch(b: Builder, kind: string, W: number) {
  const Wc = W * 0.98;
  switch (kind) {
    case 'couch': {
      // modern fabric sofa: plinth, split seat and back cushions, tapered legs, throw pillows
      const fab = 0x4d5a6e, fab2 = 0x5a6882, n = Wc > 1.4 ? 3 : 2, ci = (Wc - 0.3) / n;
      b.rbox(Wc, 0.18, 0.82, 0.04, 0, 0.21, 0, fab);
      for (let i = 0; i < n; i++) {
        const x = -Wc / 2 + 0.15 + ci * (i + 0.5);
        b.rbox(ci - 0.02, 0.14, 0.62, 0.05, x, 0.37, 0.07, fab2);
        b.rbox(ci - 0.02, 0.42, 0.18, 0.07, x, 0.62, -0.28, fab2, -0.14);
      }
      b.rbox(Wc, 0.5, 0.12, 0.04, 0, 0.55, -0.36, fab);
      for (const sx of [-1, 1]) b.rbox(0.15, 0.5, 0.82, 0.06, sx * (Wc / 2 - 0.075), 0.37, 0, fab);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.022, 0.014, 0.12, sx * (Wc / 2 - 0.09), 0.06, sz * 0.33, P.walnut, 'solid', 8);
      b.rbox(0.3, 0.28, 0.1, 0.05, Wc / 2 - 0.32, 0.6, -0.14, 0xc8964a, -0.3, 0.3, 0.1).rbox(0.28, 0.26, 0.1, 0.05, -Wc / 2 + 0.3, 0.6, -0.15, 0xe0dcd0, -0.3, -0.25, -0.1);
      break;
    }
    case 'couch_leather': {
      // chesterfield: rolled arms, deep button-tufted back, bun feet
      const lea = 0x5a2e1a, lea2 = 0x6a3820, btn = 0x2e160c;
      b.rbox(Wc, 0.26, 0.8, 0.04, 0, 0.24, 0, lea);
      b.rbox(Wc - 0.3, 0.12, 0.62, 0.04, 0, 0.42, 0.06, lea2);
      b.rbox(Wc, 0.42, 0.18, 0.05, 0, 0.58, -0.31, lea);
      for (let r = 0; r < 2; r++) for (let x = -Wc / 2 + 0.22; x < Wc / 2 - 0.15; x += 0.13) b.sphere(0.012, x + (r % 2) * 0.065, 0.52 + r * 0.12, -0.215, btn);
      for (const sx of [-1, 1]) {
        b.rbox(0.16, 0.42, 0.8, 0.04, sx * (Wc / 2 - 0.08), 0.4, 0, lea);
        b.cyl(0.11, 0.11, 0.8, sx * (Wc / 2 - 0.08), 0.62, 0, lea2, 'solid', 16, Math.PI / 2);
        for (let z = -0.3; z <= 0.31; z += 0.15) b.sphere(0.011, sx * (Wc / 2 - 0.005), 0.5, z, btn);
      }
      b.cyl(0.11, 0.11, Wc, 0, 0.8, -0.32, lea2, 'solid', 16, 0, Math.PI / 2);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.sphere(0.045, sx * (Wc / 2 - 0.1), 0.045, sz * 0.32, 0x2a1810, 'solid', 0.9);
      break;
    }
    case 'couch_modular': {
      // low boxy modular sofa on a recessed plinth, with bolster pillows
      const g1 = 0x7a8088, g2 = 0x8a9098;
      b.rbox(Wc - 0.06, 0.06, 0.74, 0.01, 0, 0.03, 0, 0x1a1a1c);
      b.rbox(Wc, 0.26, 0.88, 0.03, 0, 0.19, 0, g1);
      const n = Math.max(1, Math.round((Wc - 0.1) / 0.7)), ci = (Wc - 0.1) / n;
      for (let i = 0; i < n; i++) b.rbox(ci - 0.02, 0.14, 0.7, 0.04, -Wc / 2 + 0.05 + ci * (i + 0.5), 0.39, 0.08, g2);
      b.rbox(Wc, 0.36, 0.2, 0.03, 0, 0.5, -0.34, g1);
      b.cyl(0.08, 0.08, 0.5, -Wc / 2 + 0.3, 0.52, -0.16, 0x3a4a5a, 'solid', 14, 0, Math.PI / 2).cyl(0.08, 0.08, 0.45, Wc / 2 - 0.3, 0.52, -0.16, 0xc8b89a, 'solid', 14, 0, Math.PI / 2);
      break;
    }
    case 'couch_bench': {
      // airport / waiting-room beam seating: steel beam on T-legs, moulded seats, chrome armrests
      const seat = 0x1f7a80, steel = 0x9aa2a8, n = Math.max(1, Math.round(Wc / 0.55)), sw = Wc / n;
      b.rbox(Wc, 0.06, 0.08, 0.01, 0, 0.38, -0.05, steel);
      for (const x of [-Wc / 2 + 0.15, Wc / 2 - 0.15]) { b.rbox(0.06, 0.36, 0.06, 0.01, x, 0.2, -0.05, steel); b.rbox(0.07, 0.03, 0.55, 0.01, x, 0.015, -0.05, steel); }
      for (let i = 0; i < n; i++) {
        const x = -Wc / 2 + sw * (i + 0.5);
        b.rbox(sw - 0.08, 0.05, 0.46, 0.03, x, 0.45, 0.03, seat, 0.06);
        b.rbox(sw - 0.08, 0.46, 0.05, 0.03, x, 0.72, -0.24, seat, -0.18);
      }
      for (let i = 0; i <= n; i++) { const x = -Wc / 2 + 0.02 + i * ((Wc - 0.04) / n); b.rbox(0.035, 0.03, 0.4, 0.012, x, 0.62, 0.0, steel); b.rbox(0.03, 0.18, 0.03, 0.01, x, 0.53, 0.14, steel); }
      break;
    }
    case 'couch_armchair': {
      // club armchair (a pair on long footprints, with a side table between)
      const tan = 0x8a5a36, tan2 = 0x9a6a42;
      const chair = (cx: number, cw: number) => {
        b.rbox(cw, 0.24, 0.8, 0.05, cx, 0.24, 0, tan);
        b.rbox(cw - 0.3, 0.14, 0.6, 0.05, cx, 0.42, 0.07, tan2);
        b.rbox(cw, 0.5, 0.2, 0.07, cx, 0.6, -0.3, tan, -0.08);
        for (const sx of [-1, 1]) b.rbox(0.17, 0.44, 0.8, 0.08, cx + sx * (cw / 2 - 0.085), 0.4, 0, tan);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.02, 0.016, 0.08, cx + sx * (cw / 2 - 0.08), 0.04, sz * 0.33, 0x2a1810, 'solid', 8);
      };
      if (Wc > 1.4) {
        chair(-Wc / 2 + 0.42, 0.8); chair(Wc / 2 - 0.42, 0.8);
        b.cyl(0.18, 0.18, 0.03, 0, 0.52, 0, P.walnut, 'solid', 18).cyl(0.02, 0.02, 0.5, 0, 0.26, 0, P.frame, 'solid', 8).cyl(0.14, 0.16, 0.02, 0, 0.01, 0, P.frame, 'solid', 16);
        b.cyl(0.04, 0.035, 0.1, 0.05, 0.585, 0.03, 0xe8e4dc, 'solid', 12);
      } else chair(0, Wc);
      break;
    }
  }
}

// ------------------------------------------------------------------ washrooms & kitchens
const PORC = 0xf2f2ee, CHROME = 0xc8ced4;
/** toilet facing +z, cistern against the wall at -z */
function toilet(b: Builder, x: number, z: number) {
  lathe(b, [[0, 0], [0.11, 0], [0.12, 0.02], [0.1, 0.1], [0.12, 0.25], [0.18, 0.36], [0.19, 0.39], [0.16, 0.395]], PORC, 20, 0, x, z + 0.04);
  b.geo(new THREE.TorusGeometry(0.15, 0.022, 6, 22), 0xfafaf6, x, 0.405, z + 0.04, Math.PI / 2, 0, 0, 'solid', 1, 1.25, 1);
  b.cyl(0.13, 0.13, 0.01, x, 0.39, z + 0.04, 0x9ab8c8, 'solid', 18); // water
  b.rbox(0.36, 0.04, 0.34, 0.02, x, 0.6, z - 0.16, 0xfafaf6, -1.35); // lid up
  b.rbox(0.4, 0.36, 0.16, 0.03, x, 0.58, z - 0.3, PORC); // cistern
  b.rbox(0.42, 0.03, 0.18, 0.01, x, 0.775, z - 0.3, 0xfafaf6);
  b.cyl(0.025, 0.025, 0.012, x, 0.795, z - 0.3, CHROME, 'solid', 12);
}
function stall(b: Builder) {
  // toilet cubicle: laminate side partitions, door ajar on chrome hinges, top rail, pedestal feet
  const lam = 0x5f7078, rail = 0xa8b0b6;
  for (const sx of [-1, 1]) { b.rbox(0.03, 1.85, 0.86, 0.008, sx * 0.44, 1.07, 0, lam); b.cyl(0.02, 0.02, 0.15, sx * 0.44, 0.075, 0.38, rail, 'solid', 8); }
  const hx = -0.42, dw = 0.78, open = 0.75;
  b.rbox(dw, 1.7, 0.03, 0.008, hx + Math.cos(open) * dw / 2, 1.0, 0.44 + Math.sin(open) * dw / 2, lam, 0, -open);
  b.box(0.03, 0.03, 0.006, hx + Math.cos(open) * (dw - 0.06), 1.0, 0.44 + Math.sin(open) * (dw - 0.06) + 0.02, 0x30c050, 'solid', -open);
  b.rbox(0.9, 0.035, 0.035, 0.008, 0, 1.99, 0.44, rail);
  toilet(b, 0, -0.1);
  b.cyl(0.06, 0.06, 0.1, 0.34, 0.8, -0.3, 0xe8e8e4, 'solid', 14, 0, Math.PI / 2).cyl(0.07, 0.07, 0.02, 0.4, 0.8, -0.3, CHROME, 'solid', 14, 0, Math.PI / 2); // paper roll
}
function shower(b: Builder) {
  // corner shower: tray, tiled back and side walls, glass screens in chrome frames, rain head and mixer
  b.rbox(0.86, 0.07, 0.86, 0.02, 0, 0.035, 0, PORC);
  b.cyl(0.04, 0.04, 0.005, 0.2, 0.072, 0.2, CHROME, 'solid', 14);
  for (const [w, x, z, ry] of [[0.86, 0, -0.43, 0], [0.86, -0.43, 0, Math.PI / 2]] as [number, number, number, number][]) {
    b.box(w, 2.1, 0.02, x, 1.12, z, 0xd8e4e6, 'solid', ry);
    for (let r = 1; r < 14; r++) b.box(w, 0.006, 0.004, x + (ry ? 0.012 : 0), 0.07 + r * 0.15, z + (ry ? 0 : 0.012), 0xa8b4b8, 'solid', ry);
    for (let c = 1; c < 6; c++) { const o = -w / 2 + c * (w / 6); b.box(0.006, 2.1, 0.004, x + (ry ? 0.012 : o), 1.12, z + (ry ? o : 0.012), 0xa8b4b8, 'solid', ry); }
  }
  b.box(0.84, 1.9, 0.01, 0.0, 1.02, 0.43, 0x9ac0cc, 'glass').box(0.01, 1.9, 0.84, 0.43, 1.02, 0.0, 0x9ac0cc, 'glass');
  for (const [x, z] of [[0.43, 0.43], [-0.43, 0.43], [0.43, -0.43]]) b.box(0.025, 1.95, 0.025, x, 1.04, z, CHROME);
  b.box(0.86, 0.025, 0.025, 0, 1.98, 0.43, CHROME).box(0.025, 0.025, 0.86, 0.43, 1.98, 0, CHROME);
  rod(b, new THREE.Vector3(0, 1.95, -0.41), new THREE.Vector3(0, 2.08, -0.2), 0.012, CHROME);
  b.cyl(0.11, 0.11, 0.015, 0, 2.07, -0.18, CHROME, 'solid', 20);
  b.cyl(0.05, 0.05, 0.02, 0, 1.15, -0.41, CHROME, 'solid', 16, Math.PI / 2).rbox(0.1, 0.018, 0.02, 0.006, 0.04, 1.15, -0.39, CHROME);
}
function urinal(b: Builder) {
  // wall-hung urinal with flush valve and a stainless privacy divider
  b.rbox(0.38, 0.62, 0.32, 0.12, 0, 0.85, -0.3, PORC);
  b.rbox(0.28, 0.42, 0.2, 0.09, 0, 0.8, -0.2, 0xe4e4de);
  b.cyl(0.03, 0.03, 0.005, 0, 0.62, -0.18, 0xb8c0c4, 'solid', 12);
  b.cyl(0.018, 0.018, 0.3, 0, 1.3, -0.4, CHROME, 'solid', 8).rbox(0.07, 0.1, 0.07, 0.02, 0, 1.2, -0.39, CHROME).rbox(0.02, 0.1, 0.02, 0.006, 0.05, 1.22, -0.37, CHROME, 0, 0, 0.9);
  b.rbox(0.03, 0.8, 0.46, 0.008, 0.44, 1.05, -0.2, 0xa8b0b6);
}
function vanity(b: Builder, W: number) {
  // washroom vanity: stone top with sunk basins, mixer taps, cabinet, mirror and soap dispenser
  const Wv = W * 0.92, n = Math.max(1, Math.round(Wv / 0.8)), sp = Wv / n;
  b.rbox(Wv, 0.72, 0.5, 0.01, 0, 0.44, -0.2, 0x5a5e64);
  b.rbox(Wv + 0.02, 0.05, 0.54, 0.01, 0, 0.83, -0.19, 0xd8d4cc);
  for (let i = 0; i < n; i++) {
    const x = -Wv / 2 + sp * (i + 0.5);
    b.geo(new THREE.SphereGeometry(0.18, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), PORC, x, 0.95, -0.15, 0, 0, 0, 'solid', 1.2, 0.5, 0.9); // vessel basin
    b.cyl(0.02, 0.02, 0.005, x, 0.866, -0.15, CHROME, 'solid', 10);
    rod(b, new THREE.Vector3(x, 0.855, -0.38), new THREE.Vector3(x, 1.03, -0.36), 0.013, CHROME);
    rod(b, new THREE.Vector3(x, 1.03, -0.36), new THREE.Vector3(x, 1.0, -0.25), 0.012, CHROME);
    b.rbox(0.07, 0.015, 0.02, 0.005, x, 0.96, -0.38, CHROME);
    b.box(0.5, 0.012, 0.01, x, 0.5, 0.055, 0x3a3e44);
  }
  b.mirror(Wv - 0.04, 0.7, 0, 1.5, -0.44).rbox(Wv, 0.74, 0.02, 0.006, 0, 1.5, -0.452, 0x2a2c30);
  b.rbox(0.07, 0.16, 0.06, 0.02, Wv / 2 - 0.06, 1.05, -0.42, 0xe8e8e4).box(0.02, 0.03, 0.04, Wv / 2 - 0.06, 0.97, -0.39, 0x3a3e44);
}
function kitchenCounter(b: Builder, W: number, sink: boolean) {
  // base cabinet with laminate worktop and splashback; sink variant adds a steel basin, mixer and drying rack
  const Wc = W * 0.98, carc = 0xe8e4dc, door = 0xd8d2c6, top = 0x3a3c40;
  b.rbox(Wc, 0.08, 0.56, 0.01, 0, 0.04, -0.18, 0x1c1d20);
  b.rbox(Wc, 0.78, 0.58, 0.01, 0, 0.47, -0.19, carc);
  const n = Math.max(1, Math.round(Wc / 0.45));
  for (let i = 0; i < n; i++) { const x = -Wc / 2 + (i + 0.5) * (Wc / n); b.rbox(Wc / n - 0.02, 0.6, 0.02, 0.006, x, 0.42, 0.105, door); b.rbox(0.1, 0.015, 0.02, 0.006, x, 0.66, 0.12, CHROME); }
  b.rbox(Wc + 0.02, 0.1, 0.02, 0.006, 0, 0.8, 0.1, door);
  b.rbox(Wc + 0.02, 0.04, 0.64, 0.008, 0, 0.88, -0.17, top);
  b.box(Wc, 0.5, 0.02, 0, 1.15, -0.47, 0xd8dcd8);
  for (let c = 1; c < 8; c++) b.box(0.004, 0.5, 0.004, -Wc / 2 + c * (Wc / 8), 1.15, -0.458, 0xb0b4b0);
  if (sink) {
    b.box(0.46, 0.004, 0.38, -0.05, 0.902, -0.17, 0xb8c0c6).box(0.4, 0.003, 0.32, -0.05, 0.905, -0.17, 0x4a5056).cyl(0.025, 0.025, 0.002, -0.05, 0.907, -0.17, 0x8a9096, 'solid', 10);
    rod(b, new THREE.Vector3(-0.05, 0.9, -0.4), new THREE.Vector3(-0.05, 1.22, -0.38), 0.014, CHROME);
    rod(b, new THREE.Vector3(-0.05, 1.22, -0.38), new THREE.Vector3(-0.05, 1.14, -0.2), 0.012, CHROME);
    b.rbox(0.02, 0.015, 0.08, 0.005, 0.02, 0.95, -0.38, CHROME);
    b.rbox(0.26, 0.012, 0.3, 0.004, 0.3, 0.905, -0.17, 0xa8b0b6);
    for (let i = 0; i < 4; i++) b.cyl(0.1, 0.1, 0.012, 0.3, 0.98, -0.28 + i * 0.07, [0xf0f0ea, 0x3a6a9a, 0xf0f0ea, 0xd84a20][i], 'solid', 16, Math.PI / 2 - 0.2);
    b.cyl(0.03, 0.03, 0.16, -0.35, 0.98, -0.35, 0x40a060, 'solid', 10); // dish soap
  } else {
    const T = 0.9, ss = 0xb8bec4;
    // filter coffee machine: water tower, brew head, drip plate and a glass carafe half full
    const cx = -Wc / 2 + 0.28;
    b.rbox(0.24, 0.03, 0.26, 0.01, cx, T + 0.015, -0.3, 0x1a1c20).rbox(0.24, 0.4, 0.12, 0.02, cx, T + 0.2, -0.38, 0x1a1c20);
    b.rbox(0.25, 0.09, 0.24, 0.02, cx, T + 0.38, -0.31, 0x1a1c20).rbox(0.2, 0.05, 0.004, 0.002, cx, T + 0.38, -0.188, ss);
    b.cyl(0.07, 0.065, 0.16, cx, T + 0.11, -0.25, 0xc8dce4, 'glass', 16).cyl(0.062, 0.06, 0.07, cx, T + 0.07, -0.25, 0x3a1e10, 'solid', 14);
    b.cyl(0.072, 0.072, 0.02, cx, T + 0.2, -0.25, 0x1a1c20, 'solid', 16).rbox(0.02, 0.1, 0.03, 0.008, cx + 0.085, T + 0.12, -0.25, 0x1a1c20);
    b.box(0.02, 0.012, 0.004, cx + 0.08, T + 0.04, -0.168, 0xff3020, 'emit'); // hotplate light
    // electric kettle on its base
    const kx = cx + 0.33;
    b.cyl(0.09, 0.09, 0.02, kx, T + 0.01, -0.3, 0x1a1c20, 'solid', 16).cyl(0.07, 0.085, 0.2, kx, T + 0.12, -0.3, ss, 'solid', 16);
    b.cyl(0.05, 0.07, 0.03, kx, T + 0.235, -0.3, 0x1a1c20, 'solid', 14).sphere(0.015, kx, T + 0.255, -0.3, 0x1a1c20);
    b.rbox(0.025, 0.16, 0.035, 0.01, kx - 0.11, T + 0.13, -0.3, 0x1a1c20).rbox(0.04, 0.02, 0.03, 0.008, kx - 0.09, T + 0.2, -0.3, 0x1a1c20).rbox(0.04, 0.02, 0.03, 0.008, kx - 0.09, T + 0.06, -0.3, 0x1a1c20);
    rod(b, new THREE.Vector3(kx + 0.06, T + 0.12, -0.3), new THREE.Vector3(kx + 0.12, T + 0.19, -0.3), 0.016, ss, 8); // spout
    // two-slice toaster with bread popping up
    const tx = kx + 0.3;
    b.rbox(0.26, 0.17, 0.16, 0.04, tx, T + 0.085, -0.28, 0xb8302a).rbox(0.27, 0.02, 0.17, 0.01, tx, T + 0.01, -0.28, 0x1a1c20);
    for (const dz of [-0.035, 0.035]) { b.box(0.2, 0.004, 0.026, tx, T + 0.171, -0.28 + dz, 0x111111); b.rbox(0.13, 0.11, 0.016, 0.02, tx, T + 0.19, -0.28 + dz, 0xd09a58); }
    b.rbox(0.03, 0.025, 0.03, 0.006, tx + 0.15, T + 0.12, -0.28, 0x1a1c20); // lever
    // microwave at the far end
    const mx = Wc / 2 - 0.22;
    b.rbox(0.38, 0.24, 0.3, 0.02, mx, T + 0.12, -0.3, 0x2a2c30).box(0.25, 0.17, 0.004, mx - 0.04, T + 0.12, -0.148, 0x101418, 'glass');
    b.box(0.07, 0.03, 0.004, mx + 0.14, T + 0.18, -0.148, 0x40ff80, 'emit').box(0.02, 0.17, 0.02, mx + 0.1, T + 0.12, -0.145, CHROME);
  }
}
function fridge(b: Builder) {
  // tall two-door fridge-freezer with recessed handles, water dispenser and a few magnets
  const body = 0xc8ccd0, face = 0xd8dce0;
  b.rbox(0.82, 1.9, 0.68, 0.03, 0, 0.97, -0.13, body);
  b.rbox(0.78, 0.62, 0.03, 0.01, 0, 1.58, 0.225, face).rbox(0.78, 1.16, 0.03, 0.01, 0, 0.66, 0.225, face);
  b.box(0.78, 0.01, 0.01, 0, 1.265, 0.24, 0x5a5e62);
  for (const [y, h] of [[1.45, 0.3], [0.9, 0.5]]) b.rbox(0.025, h, 0.04, 0.01, -0.33, y, 0.26, CHROME);
  b.rbox(0.16, 0.24, 0.02, 0.01, 0.2, 1.05, 0.245, 0x2a2c30).box(0.1, 0.04, 0.005, 0.2, 1.13, 0.256, 0x40c8ff, 'emit');
  for (const [x, y, c] of [[0.1, 1.7, 0xd02020], [0.25, 1.62, 0x2060d0], [-0.1, 0.5, 0xe0c020]] as [number, number, number][]) b.rbox(0.05, 0.05, 0.012, 0.01, x, y, 0.245, c);
  b.rbox(0.14, 0.18, 0.004, 0.002, 0.05, 0.62, 0.242, 0xf2f0e6); // note
  b.box(0.7, 0.05, 0.02, 0, 0.04, 0.2, 0x2a2c30); // kick grille
}

// ------------------------------------------------------------------ lobby & workshop
/** Annular sector about (0, cz) from angle t0 to t1 (0 = +z), extruded from y0 up by h. */
function arcBand(b: Builder, rIn: number, rOut: number, t0: number, t1: number, cz: number, y0: number, h: number, color: number, bucket: Bucket = 'solid', seg = 28) {
  const s = new THREE.Shape(), pt = (r: number, t: number) => new THREE.Vector2(r * Math.sin(t), -(cz + r * Math.cos(t))); // shape v = -z after rotateX
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= seg; i++) pts.push(pt(rOut, t0 + ((t1 - t0) * i) / seg));
  for (let i = seg; i >= 0; i--) pts.push(pt(rIn, t0 + ((t1 - t0) * i) / seg));
  s.setFromPoints(pts);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  b.geo(g, color, 0, y0, 0, 0, 0, 0, bucket);
}
/** Glyph strokes on a 0..1 cell (O is drawn as a ring). */
const GLYPHS: Record<string, number[][]> = {
  A: [[0, 0, 0.5, 1], [0.5, 1, 1, 0], [0.25, 0.42, 0.75, 0.42]], X: [[0, 0, 1, 1], [0, 1, 1, 0]], I: [[0.5, 0, 0.5, 1]],
  M: [[0, 0, 0, 1], [0, 1, 0.5, 0.45], [0.5, 0.45, 1, 1], [1, 1, 1, 0]],
};
/**
 * Grand lobby reception: crescent front (shallow arc bulging toward the doors at +z) in dark timber with warm oak fins,
 * a backlit AXIOM logo panel, brushed-metal reveal, veined marble transaction ledge and a glowing recessed plinth.
 * Behind: stone work surface on pedestals, two monitors, keyboards, a desk phone; an orchid and sign-in tablet on the ledge.
 */
function receptionDesk(b: Builder, W: number) {
  const hw = W / 2, sag = 0.36, R = (hw * hw + sag * sag) / (2 * sag), cz = 0.5 - R, th = Math.asin(hw / R);
  const marble = 0xe9e5dd, vein = 0xa8a298, timber = 0x3a2618, oak = 0x9a6a40;
  arcBand(b, R - 0.4, R - 0.08, -th * 0.98, th * 0.98, cz, 0, 0.1, 0x18181a); // recessed plinth
  arcBand(b, R - 0.085, R - 0.065, -th * 0.97, th * 0.97, cz, 0.08, 0.014, 0xffe6bc, 'emit'); // LED plinth strip
  arcBand(b, R - 0.42, R - 0.02, -th, th, cz, 0.1, 0.9, timber); // body
  arcBand(b, R - 0.42, R - 0.008, -th, th, cz, 0.995, 0.03, P.alu); // brushed-metal reveal
  arcBand(b, R - 0.36, R + 0.03, -th - 0.004, th + 0.004, cz, 1.025, 0.05, marble); // transaction ledge
  for (let k = 0; k < 5; k++) { const t = -th + hash01(k) * th * 1.6, r = R - 0.3 + hash01(k + 9) * 0.28; arcBand(b, r, r + 0.006, t, t + 0.06 + hash01(k + 3) * 0.12, cz, 1.0755, 0.001, vein, 'solid', 6); }
  // oak fins along the arc, leaving the middle for the logo
  for (let t = -th + 0.012; t < th; t += 0.13 / R) {
    const x = (R - 0.01) * Math.sin(t);
    if (Math.abs(x) < 0.68) continue;
    b.box(0.05, 0.86, 0.025, x, 0.55, cz + (R - 0.01) * Math.cos(t), oak, 'solid', t);
  }
  // backlit logo: black stone panel with a glowing halo and illuminated letters
  b.box(1.26, 0.5, 0.01, 0, 0.58, 0.49, 0xffe2b0, 'emit').rbox(1.2, 0.44, 0.03, 0.008, 0, 0.58, 0.5, 0x161618);
  const lw = 0.15, lh = 0.2, gap = 0.055, lz = 0.518, glow = 0xfff0d8;
  const cw = (ch: string) => (ch === 'I' ? 0.02 : lw);
  let x0 = -([...'AXIOM'].reduce((s, ch) => s + cw(ch), 0) + 4 * gap) / 2;
  for (const ch of 'AXIOM') {
    const y0 = 0.58 - lh / 2, w = cw(ch);
    if (ch === 'O') b.geo(new THREE.TorusGeometry(lw / 2 - 0.012, 0.012, 6, 20), glow, x0 + lw / 2, 0.58, lz, 0, 0, 0, 'emit', 1, lh / lw, 1);
    else for (const [ax, ay, bx, by] of GLYPHS[ch]) {
      const dx = (bx - ax) * w, dy = (by - ay) * lh;
      b.box(Math.hypot(dx, dy) + 0.022, 0.022, 0.012, x0 + ((ax + bx) / 2) * w, y0 + ((ay + by) / 2) * lh, lz, glow, 'emit', 0, 0, Math.atan2(dy, dx));
    }
    x0 += w + gap;
  }
  // staff side: stone work surface on timber pedestals
  b.rbox(W - 0.4, 0.035, 0.5, 0.01, 0, 0.74, -0.24, marble);
  for (const sx of [-1, 1]) b.rbox(0.44, 0.72, 0.44, 0.01, sx * 1.25, 0.36, -0.26, timber).rbox(0.12, 0.015, 0.02, 0.005, sx * 1.25, 0.6, -0.49, P.alu);
  for (const x of [-0.65, 0.55]) {
    b.rbox(0.18, 0.012, 0.14, 0.004, x, 0.764, -0.12, P.frame).rbox(0.04, 0.2, 0.03, 0.01, x, 0.86, -0.12, P.frame);
    b.rbox(0.54, 0.32, 0.02, 0.008, x, 1.0, -0.14, P.black); b.screen(0.5, 0.28, x, 1.0, -0.151, 0, Math.PI);
    b.rbox(0.38, 0.015, 0.12, 0.004, x, 0.765, -0.36, P.black);
  }
  b.rbox(0.2, 0.05, 0.17, 0.02, 0.0, 0.78, -0.3, P.black).rbox(0.2, 0.03, 0.05, 0.014, -0.01, 0.815, -0.25, 0x202226); // desk phone + handset
  b.box(0.07, 0.004, 0.035, 0.04, 0.806, -0.35, 0x7ac8ff, 'emit');
  // orchid in a white pot, and a sign-in tablet, on the ledge
  const ledgeZ = (x: number) => cz + Math.sqrt((R - 0.17) ** 2 - x * x), T = 1.075;
  const ox = -hw + 0.45, oz = ledgeZ(ox);
  lathe(b, [[0, 0], [0.05, 0], [0.065, 0.1], [0.07, 0.13], [0.06, 0.13]], 0xf2f0ea, 16, T, ox, oz);
  b.cyl(0.058, 0.058, 0.01, ox, T + 0.125, oz, SOIL, 'solid', 12);
  for (const a of [0.3, 2.4, 4.4]) leaf(b, 0.14, 0.06, ox, T + 0.13, oz, a, 0.2, 0x2f6a2a);
  for (const [yaw, n] of [[0.6, 5], [3.4, 4]] as [number, number][]) {
    const top = new THREE.Vector3(ox + Math.sin(yaw) * 0.04, T + 0.42, oz + Math.cos(yaw) * 0.04);
    rod(b, new THREE.Vector3(ox, T + 0.13, oz), top, 0.004, 0x4a6a30, 4);
    for (let i = 0; i < n; i++) {
      const k = i + 1, p = top.clone().add(new THREE.Vector3(Math.sin(yaw) * 0.035 * k, -0.018 * k * k * 0.5, Math.cos(yaw) * 0.035 * k));
      b.sphere(0.024, p.x, p.y, p.z, 0xf6f0f4, 'solid', 0.6).sphere(0.008, p.x, p.y + 0.008, p.z, 0xc0287a);
    }
  }
  const tx = hw - 0.5, tz = ledgeZ(tx) - 0.02;
  b.rbox(0.08, 0.012, 0.08, 0.004, tx, T + 0.006, tz, P.alu).rbox(0.02, 0.1, 0.02, 0.006, tx, T + 0.05, tz - 0.01, P.alu);
  b.rbox(0.2, 0.14, 0.012, 0.006, tx, T + 0.12, tz + 0.005, P.black, -0.5); b.screen(0.18, 0.12, tx, T + 0.123, tz + 0.012, -0.5);
}
/** Mechanic's rolling tool cabinet with a portable top chest; back against the wall (-z), drawers to +z. */
function toolChest(b: Builder) {
  const red = 0xb01e1a, face = 0xc4261f, trim = 0x8a9096, z0 = -0.17, fz = z0 + 0.23;
  // casters
  for (const sx of [-1, 1]) for (const cz of [z0 - 0.18, z0 + 0.18]) {
    b.rbox(0.05, 0.05, 0.05, 0.01, sx * 0.3, 0.085, cz, P.steelDark).cyl(0.042, 0.042, 0.028, sx * 0.3, 0.045, cz, P.black, 'solid', 12, 0, Math.PI / 2);
  }
  // rolling cabinet: steel base frame, red body, corner trims, stainless worktop
  b.rbox(0.72, 0.04, 0.48, 0.008, 0, 0.12, z0, P.steelDark).rbox(0.7, 0.72, 0.46, 0.015, 0, 0.5, z0, red);
  for (const sx of [-1, 1]) b.rbox(0.022, 0.72, 0.022, 0.006, sx * 0.345, 0.5, fz, trim);
  b.rbox(0.74, 0.025, 0.5, 0.006, 0, 0.872, z0, trim);
  // drawer bank, shallow on top, deep at the bottom, full-width chrome pulls
  let y = 0.855;
  for (const h of [0.07, 0.07, 0.09, 0.09, 0.13, 0.2]) {
    y -= h + 0.006;
    b.rbox(0.64, h, 0.016, 0.004, 0, y + h / 2, fz + 0.008, face).rbox(0.5, 0.016, 0.022, 0.007, 0, y + h - 0.018, fz + 0.022, P.chrome);
  }
  // side push handle
  for (const cz of [z0 - 0.15, z0 + 0.15]) b.rbox(0.06, 0.025, 0.025, 0.008, 0.375, 0.76, cz, P.chrome);
  b.cyl(0.014, 0.014, 0.36, 0.405, 0.76, z0, P.chrome, 'solid', 8, Math.PI / 2);
  // portable top chest: two drawers, lid with seam, chrome latches and a carry handle
  const tz = z0 - 0.04, ty = 0.885, tf = tz + 0.18;
  b.rbox(0.66, 0.2, 0.36, 0.012, 0, ty + 0.1, tz, red);
  for (const k of [0, 1]) b.rbox(0.6, 0.075, 0.014, 0.004, 0, ty + 0.05 + k * 0.09, tf + 0.006, face).rbox(0.4, 0.014, 0.02, 0.006, 0, ty + 0.07 + k * 0.09, tf + 0.018, P.chrome);
  b.box(0.67, 0.008, 0.37, 0, ty + 0.203, tz, P.black); // lid seam
  b.rbox(0.68, 0.09, 0.38, 0.02, 0, ty + 0.25, tz, red);
  for (const sx of [-1, 1]) b.rbox(0.045, 0.055, 0.014, 0.004, sx * 0.24, ty + 0.205, tf + 0.012, P.chrome);
  for (const sx of [-1, 1]) b.rbox(0.03, 0.045, 0.03, 0.008, sx * 0.13, ty + 0.315, tz, P.black);
  b.rbox(0.32, 0.03, 0.045, 0.012, 0, ty + 0.345, tz, P.black);
  // tools left out on the worktop: combination spanner and a screwdriver
  const wy = 0.888, wz = fz + 0.02;
  b.rbox(0.18, 0.008, 0.022, 0.003, -0.15, wy, wz, P.chrome).geo(new THREE.TorusGeometry(0.022, 0.008, 6, 14), P.chrome, -0.255, wy, wz, Math.PI / 2);
  b.rbox(0.03, 0.008, 0.012, 0.002, -0.04, wy, wz - 0.018, P.chrome).rbox(0.03, 0.008, 0.012, 0.002, -0.04, wy, wz + 0.018, P.chrome);
  b.cyl(0.017, 0.017, 0.1, 0.13, wy + 0.01, wz, 0xe0b020, 'solid', 8, 0, Math.PI / 2).cyl(0.005, 0.005, 0.11, 0.235, wy + 0.01, wz, P.chrome, 'solid', 6, 0, Math.PI / 2);
}

// ------------------------------------------------------------------ boardroom
/** Long boardroom table (runs along the longer footprint axis) set for a meeting. */
// ------------------------------------------------------------------ easter egg: floor 8's poker room
const POKER_H = 0.78;
/** cards and chips are drawn ~1.5x life size, like the characters, so they read from the game camera */
export const CARD_W = 0.13, CARD_H = 0.18;
/** The winner's royal flush, in table space (x across, z toward the winner's seat; card faces drawn by FloorView). */
export function royalFlushCards(W: number, D: number): { x: number; y: number; z: number; ry: number }[] {
  const z = D / 2 - 0.4;
  return [-2, -1, 0, 1, 2].map((i) => ({ x: i * 0.155, y: POKER_H + 0.034 + Math.abs(i) * 0.0004, z: z - Math.abs(i) * 0.012, ry: -i * 0.06 }));
}
function pokerTable(b: Builder, W: number, D: number) {
  const rx = W / 2 - 0.1, rz = D / 2 - 0.1, H = POKER_H;
  const oval = (k: number, h: number, y: number, c: number, seg = 48) => b.geo(new THREE.CylinderGeometry(1, 1, h, seg), c, 0, y, 0, 0, 0, 0, 'solid', rx * k, 1, rz * k);
  // turned walnut pedestal on a wide oval foot
  oval(0.34, 0.05, 0.025, 0x1c120a);
  b.cyl(0.16, 0.24, H - 0.12, 0, (H - 0.12) / 2 + 0.05, 0, 0x3a2414, 'solid', 18);
  b.cyl(0.22, 0.16, 0.06, 0, H - 0.1, 0, 0x2a1a0e, 'solid', 18);
  // walnut apron, then the felt bed, then a padded black-leather rail with a brass bead
  oval(1.0, 0.09, H - 0.03, 0x5a3822);
  oval(0.9, 0.03, H + 0.015, 0x1d6b3a);
  oval(0.62, 0.002, H + 0.031, 0x237a44); // the lighter playing oval (betting line)
  b.geo(new THREE.TorusGeometry(1, 0.055, 10, 64), 0x17110e, 0, H + 0.04, 0, Math.PI / 2, 0, 0, 'solid', rx * 0.95, rz * 0.95, 1);
  b.geo(new THREE.TorusGeometry(1, 0.008, 6, 64), 0xc9a24a, 0, H + 0.005, 0, Math.PI / 2, 0, 0, 'solid', rx * 0.995, rz * 0.995, 1);
  // the winner's royal flush (white blanks; faces are textured planes) and EVERY chip, in front of the south seat
  for (const c of royalFlushCards(W, D)) b.box(CARD_W, 0.003, CARD_H, c.x, c.y - 0.002, c.z, 0xf4f1e8, 'solid', c.ry);
  const chipCols = [0xc8202a, 0x1f4fb0, 0x111214, 0x1f8a3a, 0xece6d6, 0x6a2a8a];
  const stack = (x: number, z: number, n: number, col: number) => {
    for (let i = 0; i < n; i++) b.cyl(0.032, 0.032, 0.0066, x, H + 0.034 + i * 0.0068, z, i % 2 ? col : 0xf0ece0, 'solid', 16);
    b.cyl(0.0325, 0.0325, n * 0.0068 - 0.0018, x, H + 0.034 + (n * 0.0068) / 2 - 0.003, z, col, 'solid', 16);
  };
  const cz = D / 2 - 0.68;
  let k = 0;
  for (let row = 0; row < 3; row++) for (let i = -4; i <= 4; i++) {
    if ((i + row) % 2 && row === 2) continue;
    stack(i * 0.07 + (row % 2) * 0.035, cz - row * 0.068, 6 + ((i * 7 + row * 3 + 12) % 9), chipCols[(k++) % chipCols.length]);
  }
  // a toppled pot spilling across the felt
  for (let i = 0; i < 14; i++) { const a = i * 2.39, r = 0.05 + (i % 5) * 0.03; b.cyl(0.032, 0.032, 0.0066, Math.cos(a) * r * 1.4, H + 0.034, -0.05 + Math.sin(a) * r * 0.6, chipCols[i % chipCols.length], 'solid', 14, 0.12 * Math.sin(i), 0.12 * Math.cos(i)); }
  // the two losers: folded hands, face down, pushed in; no chips left
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.75), z = -(D / 2 - 0.38);
    b.box(CARD_W, 0.003, CARD_H, x, H + 0.033, z, 0x8a1a22, 'solid', sx * 0.4);
    b.box(CARD_W, 0.003, CARD_H, x + sx * 0.02, H + 0.036, z + 0.015, 0x8a1a22, 'solid', sx * 0.15);
  }
  // deck, dealer button, ashtray with a cigar, and two whisky tumblers
  b.box(0.088, 0.025, 0.124, 0.32, H + 0.045, -0.15, 0x8a1a22, 'solid', 0.2);
  b.cyl(0.03, 0.03, 0.008, -0.34, H + 0.036, -0.1, 0xf4f1e8, 'solid', 16);
  b.cyl(0.06, 0.05, 0.025, W / 2 - 0.5, H + 0.045, 0.25, 0x3a3d42, 'solid', 14);
  b.cyl(0.009, 0.009, 0.13, W / 2 - 0.5, H + 0.06, 0.25, 0x5a3218, 'solid', 8, 0, Math.PI / 2 - 0.15);
  b.sphere(0.008, W / 2 - 0.435, H + 0.07, 0.25, 0xff5020, 'emit');
  for (const [x, z] of [[-(W / 2 - 0.55), -0.15], [W / 2 - 0.62, -0.32], [0.55, D / 2 - 0.42]]) {
    b.cyl(0.036, 0.032, 0.085, x, H + 0.075, z, 0xd6e8f0, 'glass', 14);
    b.cyl(0.03, 0.028, 0.03, x, H + 0.05, z, 0xb06a1a, 'solid', 14);
  }
}
/** Deep oxblood leather club chair (faces +z before rotation, like the office chair). */
function clubChair(b: Builder) {
  const L = 0x5a1a16, D = 0x3a0f0c, brass = 0xc9a24a;
  b.rbox(0.7, 0.22, 0.66, 0.06, 0, 0.2, 0.02, D);
  b.rbox(0.56, 0.12, 0.56, 0.05, 0, 0.36, -0.02, L);
  b.rbox(0.7, 0.5, 0.18, 0.07, 0, 0.55, -0.28, L, 0.12);
  for (const sx of [-1, 1]) {
    b.rbox(0.13, 0.36, 0.64, 0.06, sx * 0.3, 0.42, 0.02, L);
    for (let i = 0; i < 6; i++) b.sphere(0.008, sx * 0.365, 0.52, -0.25 + i * 0.1, brass);
  }
  for (const [x, z] of [[-0.29, -0.27], [0.29, -0.27], [-0.29, 0.29], [0.29, 0.29]]) b.cyl(0.025, 0.02, 0.09, x, 0.045, z, 0x1c120a, 'solid', 8);
}
/** Burgundy rug with a gold border under the table. */
function pokerRug(b: Builder, W: number, D: number) {
  b.box(W - 0.4, 0.008, D - 0.4, 0, 0.004, 0, 0xc9a24a);
  b.box(W - 0.55, 0.01, D - 0.55, 0, 0.006, 0, 0x5a1424);
  b.box(W - 1.0, 0.012, D - 1.0, 0, 0.007, 0, 0x6e1a2c);
}
/** Brass drinks trolley: two glass shelves, bottles, a decanter and tumblers. */
function barCart(b: Builder) {
  const brass = 0xc9a24a;
  for (const [x, z] of [[-0.32, -0.18], [0.32, -0.18], [-0.32, 0.18], [0.32, 0.18]]) b.cyl(0.012, 0.012, 0.82, x, 0.46, z, brass, 'solid', 8);
  for (const [x, z] of [[-0.32, -0.18], [0.32, -0.18], [-0.32, 0.18], [0.32, 0.18]]) b.cyl(0.04, 0.04, 0.03, x, 0.04, z, 0x1a1a1a, 'solid', 10, Math.PI / 2);
  for (const y of [0.32, 0.72]) { b.box(0.66, 0.012, 0.38, 0, y, 0, 0x9ac8d8, 'glass'); b.box(0.68, 0.02, 0.4, 0, y - 0.016, 0, brass); }
  const bottle = (x: number, z: number, col: number, y0: number) => lathe(b, [[0, 0], [0.04, 0], [0.042, 0.02], [0.04, 0.2], [0.018, 0.26], [0.014, 0.31], [0.016, 0.33], [0, 0.33]], col, 14, y0, x, z);
  bottle(-0.2, 0.05, 0x3a1a08, 0.73); bottle(-0.08, -0.06, 0x1c3a1c, 0.73); bottle(0.04, 0.06, 0x8a6a2a, 0.73);
  lathe(b, [[0, 0], [0.06, 0], [0.075, 0.06], [0.06, 0.15], [0.02, 0.2], [0.03, 0.24], [0, 0.26]], 0xd8ecf4, 16, 0.73, 0.2, 0);
  for (const [x, z] of [[-0.18, 0.05], [-0.04, 0.08], [0.1, -0.05]]) b.cyl(0.035, 0.03, 0.08, x, 0.37, z, 0xd8ecf4, 'glass', 12);
}

function boardTable(b: Builder, W: number, D: number) {
  const along = W >= D;
  const L = Math.max(W, D) - 0.15, Wd = Math.min(W, D) - 0.3, H = 0.78;
  const X = (u: number, v: number): [number, number] => (along ? [u, v] : [v, u]); // table space (u along, v across) to local x,z
  const bx = (w: number, h: number, d: number, u: number, y: number, v: number, c: number, r = 0.01) => { const [x, z] = X(u, v); b.rbox(along ? w : d, h, along ? d : w, r, x, y, z, c); };
  // thick walnut slab with a darker edge band and a leather runner down the middle
  bx(L, 0.07, Wd, 0, H - 0.035, 0, 0x5a3822, 0.03);
  bx(L + 0.02, 0.03, Wd + 0.02, 0, H - 0.075, 0, 0x2e1c10, 0.012);
  bx(L - 0.6, 0.004, Wd * 0.38, 0, H + 0.002, 0, 0x1c1614);
  // three chunky pedestals on wide feet, joined by a spine beam (visible under the slab)
  const peds = L > 5 ? [-(L / 2 - 1.0), 0, L / 2 - 1.0] : [-(L / 2 - 0.8), L / 2 - 0.8];
  for (const u of peds) { bx(0.7, H - 0.12, Wd * 0.45, u, (H - 0.12) / 2 + 0.03, 0, 0x2a2d31, 0.03); bx(1.0, 0.05, Wd * 0.62, u, 0.025, 0, 0x16181b, 0.02); bx(0.72, 0.02, Wd * 0.47, u, H - 0.1, 0, 0x8a9096); }
  bx(L - 1.6, 0.12, 0.14, 0, H - 0.2, 0, 0x2a2d31);
  // centre: power/data hatches and a conference phone
  for (const u of [-L / 4, L / 4]) bx(0.34, 0.012, 0.14, u, H + 0.006, 0, 0x2a2d31);
  { const [x, z] = X(0.9, 0); b.cyl(0.17, 0.2, 0.04, x, H + 0.02, z, 0x1a1c20, 'solid', 3); b.cyl(0.035, 0.035, 0.006, x, H + 0.043, z, 0x30ff70, 'emit', 10); }
  // water jug and glasses on a tray
  { const [x, z] = X(-0.8, 0);
    b.rbox(0.46, 0.014, 0.3, 0.01, x, H + 0.007, z, 0x8a9096);
    lathe(b, [[0, 0], [0.065, 0], [0.075, 0.04], [0.072, 0.22], [0.05, 0.26], [0.054, 0.29], [0.045, 0.29]], 0xb8d8e8, 16, H + 0.014, x - 0.1, z);
    b.cyl(0.066, 0.066, 0.15, x - 0.1, H + 0.09, z, 0x5a9ac8, 'glass', 14);
    for (const [dx, dz] of [[0.08, -0.08], [0.16, 0.03], [0.07, 0.09]]) b.cyl(0.036, 0.03, 0.11, x + dx, H + 0.069, z + dz, 0xcfe6f2, 'glass', 10);
  }
  // places down both sides, 1 m apart: laptop or a stack of papers + pen, a glass of water, a notepad
  const seats = Math.max(1, Math.floor(L - 1));
  for (let k = 0; k < seats; k++) {
    const u = -L / 2 + 1 + k * ((L - 2) / Math.max(1, seats - 1));
    for (const side of [-1, 1]) {
      const v = side * (Wd / 2 - 0.26), h = hash01(k * 7 + side * 3 + 11);
      if (h < 0.5) {
        const [x, z] = X(u, v);
        b.rbox(along ? 0.38 : 0.27, 0.016, along ? 0.27 : 0.38, 0.006, x, H + 0.008, z, 0x2a2c30); // laptop base
        const ry = along ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        const [lx, lz] = X(u, v - side * 0.13);
        b.rbox(along ? 0.38 : 0.012, 0.25, along ? 0.012 : 0.38, 0.006, lx, H + 0.13, lz, 0x2a2c30);
        b.screen(0.35, 0.21, lx + (along ? 0 : side * 0.009), H + 0.13, lz + (along ? side * 0.009 : 0), 0, ry + Math.PI);
      } else {
        for (let q = 0; q < 4; q++) bx(0.23, 0.003, 0.31, u + (hash01(k + q) - 0.5) * 0.08, H + 0.003 + q * 0.003, v, [0xf4f2ea, 0xeae7dc, 0xf8f6f0, 0xe8e2d0][q]);
        bx(0.15, 0.01, 0.01, u + 0.17, H + 0.016, v + side * 0.06, 0x1a3a8a);
      }
      const [gx, gz] = X(u + 0.32, v - side * 0.06);
      if (h > 0.2) b.cyl(0.036, 0.03, 0.11, gx, H + 0.055, gz, 0xcfe6f2, 'glass', 10);
      const [nx, nz] = X(u - 0.32, v);
      if (h > 0.65) b.rbox(along ? 0.15 : 0.2, 0.012, along ? 0.2 : 0.15, 0.004, nx, H + 0.006, nz, 0xf2d86a); // notepad
    }
  }
}

/** Wall-mounted presentation TV with soundbar (back against the wall at -z). */
function tvWall(b: Builder) {
  b.rbox(1.72, 0.99, 0.05, 0.01, 0, 1.6, -0.42, 0x111214);
  b.screen(1.64, 0.92, 0, 1.6, -0.393, 0, 0, 5);
  b.box(0.06, 0.02, 0.006, 0.76, 1.12, -0.393, 0x30ff70, 'emit');
  b.rbox(1.1, 0.07, 0.08, 0.02, 0, 1.03, -0.41, 0x1a1b1e); // soundbar
  b.rbox(0.3, 0.3, 0.02, 0.005, 0, 1.6, -0.455, 0x2a2d31); // mount
}

/** Low sideboard with a coffee service. */
function credenza(b: Builder, W: number) {
  const Wc = W * 0.95;
  b.rbox(Wc, 0.7, 0.45, 0.015, 0, 0.37, -0.25, 0x3a2618);
  for (let i = 0; i < 3; i++) b.rbox(Wc / 3 - 0.02, 0.56, 0.01, 0.004, -Wc / 3 + i * (Wc / 3), 0.36, -0.022, 0x4a3020).rbox(0.1, 0.012, 0.015, 0.004, -Wc / 3 + i * (Wc / 3), 0.55, -0.012, 0xc8a050);
  b.rbox(Wc + 0.02, 0.03, 0.47, 0.008, 0, 0.735, -0.25, 0x2a1a10);
  // coffee thermos, cups on saucers, a bowl of fruit
  lathe(b, [[0, 0], [0.07, 0], [0.075, 0.02], [0.07, 0.26], [0.045, 0.3], [0.04, 0.33]], 0x8a9096, 16, 0.75, -0.25, -0.28);
  b.rbox(0.05, 0.02, 0.03, 0.008, -0.2, 1.05, -0.28, 0x1a1c1f);
  for (let i = 0; i < 3; i++) { b.cyl(0.05, 0.05, 0.008, -0.02 + i * 0.12, 0.754, -0.2, 0xf2f2ee, 'solid', 14); b.cyl(0.032, 0.026, 0.06, -0.02 + i * 0.12, 0.788, -0.2, 0xf2f2ee, 'solid', 12); }
  b.cyl(0.13, 0.08, 0.06, 0.3, 0.78, -0.3, 0xd8d0c0, 'solid', 16);
  b.sphere(0.04, 0.27, 0.82, -0.3, 0xd84a20).sphere(0.04, 0.33, 0.82, -0.32, 0x7ab030).sphere(0.04, 0.3, 0.82, -0.26, 0xe8c030);
}

function snakePlant(b: Builder) {
  // glossy ceramic cylinder pot with a foot and rolled rim
  lathe(b, [[0, 0], [0.14, 0], [0.15, 0.03], [0.17, 0.05], [0.185, 0.36], [0.2, 0.39], [0.2, 0.42], [0.18, 0.42]], 0xe8e4dc);
  b.cyl(0.18, 0.18, 0.02, 0, 0.4, 0, SOIL, 'solid', 18);
  // upright sword blades, dark banded green with a gold edge (edge = slightly wider blade behind)
  for (let i = 0; i < 12; i++) {
    const a = i * 2.39996, r = 0.025 + (i % 4) * 0.03, hgt = 0.5 + hash01(i) * 0.4, lean = 0.08 + (i % 3) * 0.06;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    b.geo(new THREE.ConeGeometry(0.05, hgt, 6), 0xb7b04a, x, 0.41 + hgt / 2, z, Math.sin(a) * lean, a, -Math.cos(a) * lean, 'solid', 1, 1, 0.18);
    b.geo(new THREE.ConeGeometry(0.046, hgt * 1.01, 6), i % 2 ? 0x2c5a2a : 0x35682e, x, 0.415 + hgt / 2, z, Math.sin(a) * lean, a, -Math.cos(a) * lean, 'solid', 1, 1, 0.26);
  }
}

function palmPlant(b: Builder) {
  lathe(b, [[0, 0], [0.17, 0], [0.19, 0.04], [0.23, 0.48], [0.245, 0.5], [0.23, 0.52]], 0x3a3d42);
  b.cyl(0.22, 0.22, 0.02, 0, 0.5, 0, SOIL, 'solid', 18);
  // three canes, each crowned with arching fronds
  const canes: [number, number, number][] = [[0.3, 0.75, 0], [2.4, 0.95, 0.12], [4.3, 0.62, 0.2]];
  canes.forEach(([a, hgt, lean], ci) => {
    const base = new THREE.Vector3(Math.cos(a) * 0.05, 0.5, Math.sin(a) * 0.05);
    const top = base.clone().add(new THREE.Vector3(Math.cos(a) * lean, hgt, Math.sin(a) * lean));
    rod(b, base, top, 0.022, 0x6f7a3a, 7);
    for (let r = 0; r < 4; r++) b.cyl(0.024, 0.024, 0.012, base.x + (top.x - base.x) * (r + 1) / 5, base.y + (top.y - base.y) * (r + 1) / 5, base.z + (top.z - base.z) * (r + 1) / 5, 0x4d5528, 'solid', 7);
    for (let f = 0; f < 4; f++) frond(b, top, a + ci + f * 1.57, 0.95, 1.5, 0.75, 7, 0.3, 0.032, [0x3f7a34, 0x4d8a3c, 0x356b2d], 0x6f7a3a);
  });
}

function fernPlant(b: Builder) {
  // wooden plant stand
  b.rbox(0.46, 0.04, 0.46, 0.01, 0, 0.56, 0, 0x6a4a2e);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rbox(0.04, 0.56, 0.04, 0.008, sx * 0.19, 0.28, sz * 0.19, 0x5a3e26);
  b.rbox(0.42, 0.025, 0.42, 0.006, 0, 0.14, 0, 0x5a3e26);
  lathe(b, [[0, 0], [0.12, 0], [0.13, 0.02], [0.19, 0.2], [0.2, 0.22], [0.19, 0.23]], 0xb85a34, 20, 0.58);
  b.cyl(0.185, 0.185, 0.02, 0, 0.8, 0, SOIL, 'solid', 18);
  // Boston fern: dense fronds arching up then spilling over the rim
  for (let i = 0; i < 16; i++) {
    const a = i * 2.39996, up = 0.7 + hash01(i + 3) * 0.5;
    frond(b, new THREE.Vector3(Math.cos(a) * 0.04, 0.81, Math.sin(a) * 0.04), a, up, 2.3 + up, 0.5 + hash01(i) * 0.15, 7, 0.085, 0.026, [0x4f8f38, 0x5d9c40, 0x46822f], 0x3c6a28, 1.35);
  }
}

function cactusPlant(b: Builder) {
  // terracotta pot with gravel top dressing
  lathe(b, [[0, 0], [0.15, 0], [0.19, 0.28], [0.22, 0.29], [0.22, 0.34], [0.2, 0.34]], 0xb9643a);
  b.cyl(0.2, 0.2, 0.02, 0, 0.33, 0, 0x8a8478, 'solid', 18);
  for (let i = 0; i < 14; i++) { const a = i * 2.4, r = 0.06 + (i % 3) * 0.045; b.sphere(0.018, Math.cos(a) * r, 0.345, Math.sin(a) * r, [0xa39d90, 0x77716a, 0xc2bcb0][i % 3], 'solid', 0.6); }
  const green = 0x3f6e3a, rib = 0x2f5a2c;
  const column = (x: number, y: number, z: number, r: number, h: number) => {
    b.geo(new THREE.CapsuleGeometry(r, h, 4, 10), green, x, y + h / 2 + r, z);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; b.geo(new THREE.CapsuleGeometry(r * 0.22, h, 2, 5), rib, x + Math.cos(a) * r * 0.85, y + h / 2 + r, z + Math.sin(a) * r * 0.85); }
  };
  column(0, 0.3, 0, 0.1, 0.95);
  // two arms: out, then up
  for (const [side, y0, up] of [[1, 0.72, 0.32], [-1, 0.95, 0.24]] as [number, number, number][]) {
    b.geo(new THREE.CapsuleGeometry(0.06, 0.14, 4, 8), green, side * 0.15, y0, 0, 0, 0, Math.PI / 2);
    column(side * 0.24, y0 - 0.02, 0, 0.065, up);
  }
  // flower on the crown
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; leaf(b, 0.05, 0.035, 0, 1.44, 0, a, 0.5, 0xe0507a); }
  b.sphere(0.018, 0, 1.46, 0, 0xf2d040);
}

function ficusPlant(b: Builder) {
  // woven basket
  b.cyl(0.24, 0.2, 0.38, 0, 0.19, 0, 0xa98a5a, 'solid', 20);
  for (let i = 0; i < 4; i++) b.cyl(0.242 - i * 0.008, 0.242 - i * 0.008, 0.02, 0, 0.06 + i * 0.1, 0, 0x7d6440, 'solid', 20);
  b.cyl(0.25, 0.25, 0.03, 0, 0.38, 0, 0x8a6e46, 'solid', 20);
  b.cyl(0.22, 0.22, 0.02, 0, 0.375, 0, SOIL, 'solid', 18);
  // braided trunk: three stems spiralling up
  const trunk = 0x6b5a44;
  for (let s = 0; s < 3; s++) {
    let prev = new THREE.Vector3(Math.cos(s * 2.09) * 0.03, 0.38, Math.sin(s * 2.09) * 0.03);
    for (let k = 1; k <= 8; k++) {
      const a = s * 2.09 + k * 0.8, y = 0.38 + k * 0.1;
      const q = new THREE.Vector3(Math.cos(a) * 0.03, y, Math.sin(a) * 0.03);
      rod(b, prev, q, 0.018, trunk);
      prev = q;
    }
  }
  // branches and a rounded canopy of glossy leaf clusters
  const clusters: [number, number, number, number][] = [[0, 1.45, 0, 0.26], [0.22, 1.28, 0.1, 0.2], [-0.2, 1.3, -0.08, 0.21], [0.05, 1.25, -0.24, 0.19], [-0.08, 1.24, 0.23, 0.19], [0.15, 1.58, -0.1, 0.16], [-0.14, 1.55, 0.1, 0.15]];
  clusters.forEach(([x, y, z, r], i) => {
    rod(b, new THREE.Vector3(0, 1.1, 0), new THREE.Vector3(x * 0.8, y - 0.1, z * 0.8), 0.012, trunk, 5);
    const g = new THREE.IcosahedronGeometry(r * 0.8, 1);
    b.geo(g, [0x2a5424, 0x305e28, 0x264c20][i % 3], x, y, z);
    for (let k = 0; k < 9; k++) {
      const u = hash01(i * 17 + k), v = hash01(i * 31 + k + 5);
      const yaw = u * Math.PI * 2, el = (v - 0.3) * 1.6;
      const d = dirOf(yaw, el).multiplyScalar(r * 0.72);
      leaf(b, 0.11, 0.055, x + d.x, y + d.y, z + d.z, yaw, el * 0.6 - 0.2, [0x3b6e2e, 0x2f5f27, 0x457a33][k % 3]);
    }
  });
}

function drum(b: Builder) {
  // 200 L steel drum: rolled hoops, chimes, lid with bungs, hazard label
  const blue = 0x1f4f86, dark = 0x173a62, steel = 0x7d858c;
  b.cyl(0.285, 0.285, 0.86, 0, 0.44, 0, blue, 'solid', 24);
  const ring = (y: number, r: number, t: number, c: number) => b.geo(new THREE.TorusGeometry(r, t, 6, 28), c, 0, y, 0, Math.PI / 2);
  ring(0.02, 0.28, 0.018, dark); ring(0.87, 0.28, 0.018, dark);
  ring(0.3, 0.29, 0.013, dark); ring(0.6, 0.29, 0.013, dark);
  b.cyl(0.27, 0.27, 0.012, 0, 0.866, 0, 0x234f80, 'solid', 24);
  b.cyl(0.035, 0.035, 0.022, 0.16, 0.878, 0, steel, 'solid', 10).cyl(0.022, 0.022, 0.018, -0.17, 0.876, 0.06, steel, 'solid', 8);
  // label + hazard diamond on the front
  b.box(0.2, 0.18, 0.006, 0, 0.45, 0.284, 0xe8e4d8);
  b.box(0.09, 0.09, 0.008, 0, 0.47, 0.287, 0xf0b820, 'solid', 0, 0, Math.PI / 4);
  b.box(0.03, 0.04, 0.01, 0, 0.47, 0.289, 0x151515);
  b.box(0.16, 0.012, 0.008, 0, 0.395, 0.286, 0x333333);
  // rust run-offs and scuffs
  for (const [a, h] of [[0.9, 0.2], [2.2, 0.14], [4.1, 0.25]] as [number, number][]) b.box(0.02, h, 0.006, Math.sin(a) * 0.286, 0.84 - h / 2, Math.cos(a) * 0.286, 0x6a3a1a, 'solid', a);
}

function vending(b: Builder) {
  // faces +z; front plane at z = 0.35. Buckets: solid body, glass window, emissive lights (darkened when broken)
  const red = 0x8e1822, black = 0x141518, panel = 0x1f2227, steel = 0x9aa2a8;
  // hollow cabinet: back block, side walls, top and bottom around an open product bay
  b.rbox(0.9, 1.86, 0.46, 0.025, 0, 0.99, -0.22, red);
  for (const sx of [-1, 1]) b.rbox(0.05, 1.86, 0.8, 0.012, sx * 0.425, 0.99, -0.05, red);
  b.rbox(0.9, 0.2, 0.8, 0.02, 0, 1.82, -0.05, red);
  b.rbox(0.9, 0.36, 0.8, 0.02, 0, 0.24, -0.05, red);
  b.box(0.22, 1.36, 0.36, 0.31, 1.02, 0.17, red); // payment column block
  b.box(0.86, 0.08, 0.74, 0, 0.04, -0.05, black);
  for (const sx of [-1, 1]) { b.box(0.006, 1.7, 0.12, sx * 0.452, 1.0, 0.18, 0xe8e0d0); b.box(0.006, 1.7, 0.04, sx * 0.452, 1.0, 0.07, 0xd8a020); }
  // lit header
  b.rbox(0.86, 0.24, 0.05, 0.01, 0, 1.78, 0.345, black);
  b.box(0.8, 0.18, 0.01, 0, 1.78, 0.372, 0xff3a4c, 'emit');
  b.box(0.5, 0.05, 0.012, -0.1, 1.78, 0.376, 0xfff0f0, 'emit');
  // product window
  const wx = -0.1;
  for (const [x, y, w, h] of [[wx, 1.68, 0.62, 0.04], [wx, 0.36, 0.62, 0.04], [wx - 0.3, 1.02, 0.03, 1.34], [wx + 0.3, 1.02, 0.03, 1.34]]) b.rbox(w, h, 0.04, 0.008, x, y, 0.345, black); // window frame
  b.box(0.56, 1.26, 0.01, wx, 1.02, 0.02, 0x9fb4c4, 'emit'); // back-lit interior
  b.box(0.56, 1.28, 0.01, wx, 1.02, 0.365, 0x7a9aaa, 'glass');
  const COLS = [0xd02020, 0x2060d0, 0xe0c020, 0x20a040, 0xf07a20, 0x8a2ad0, 0xf0f0f0];
  for (let row = 0; row < 5; row++) {
    const y = 0.47 + row * 0.25;
    b.box(0.56, 0.012, 0.3, wx, y, 0.19, steel);
    b.box(0.56, 0.02, 0.006, wx, y + 0.005, 0.342, 0xe8e8e0); // price rail
    for (let k = 0; k < 4; k++) {
      const x = wx - 0.21 + k * 0.14, c = COLS[(row * 3 + k) % COLS.length];
      b.geo(new THREE.TorusGeometry(0.045, 0.004, 4, 10), steel, x, y + 0.05, 0.3); // spiral coil front
      for (const z of [0.12, 0.24]) {
        const t = (row + k) % 4;
        if (t === 0) b.cyl(0.033, 0.033, 0.12, x, y + 0.07, z, c, 'solid', 10);
        else if (t === 1) { b.cyl(0.028, 0.028, 0.13, x, y + 0.075, z, c, 'solid', 10); b.cyl(0.012, 0.02, 0.04, x, y + 0.16, z, c, 'solid', 8); b.cyl(0.013, 0.013, 0.014, x, y + 0.185, z, 0xf0f0f0, 'solid', 8); }
        else if (t === 2) b.rbox(0.1, 0.15, 0.035, 0.012, x, y + 0.085, z, c);
        else b.rbox(0.11, 0.045, 0.03, 0.006, x, y + 0.03, z, c);
      }
    }
  }
  // payment column
  const px = 0.31;
  b.rbox(0.2, 1.34, 0.03, 0.01, px, 1.02, 0.345, panel);
  b.box(0.14, 0.06, 0.01, px, 1.52, 0.364, 0x40ff90, 'emit');
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) b.rbox(0.035, 0.03, 0.012, 0.004, px - 0.045 + c * 0.045, 1.38 - r * 0.042, 0.364, 0xc8ccd0);
  b.box(0.1, 0.012, 0.012, px, 1.17, 0.365, black); // coin slot
  b.rbox(0.11, 0.07, 0.025, 0.006, px, 1.06, 0.368, 0x2b2e33); // card reader
  b.box(0.018, 0.018, 0.008, px + 0.035, 1.06, 0.382, 0x30ff60, 'emit');
  b.box(0.12, 0.02, 0.012, px, 0.95, 0.365, black); // note acceptor
  b.rbox(0.1, 0.08, 0.02, 0.01, px, 0.72, 0.36, 0x2b2e33); // change cup
  // pickup bin
  b.box(0.62, 0.2, 0.02, wx, 0.25, 0.35, black);
  b.box(0.58, 0.16, 0.012, wx, 0.25, 0.362, 0x2a2d31, 'solid', 0, -0.12);
  b.box(0.2, 0.02, 0.01, wx, 0.31, 0.37, steel);
}

function mainframe(b: Builder) {
  const W = 3.9, metal = 0x1a1d22, dark = 0x0e1014, cap = 0x2a2e35, cyan = 0x28c0ff;
  // stepped plinth with light trim
  b.rbox(W, 0.25, W, 0.04, 0, 0.125, 0, 0x15171b);
  b.rbox(3.5, 0.1, 3.5, 0.02, 0, 0.3, 0, 0x1d2026);
  for (const [x, z, w, d] of [[0, 1.93, 3.8, 0.03], [0, -1.93, 3.8, 0.03], [1.93, 0, 0.03, 3.8], [-1.93, 0, 0.03, 3.8]]) b.box(w, 0.03, d, x, 0.24, z, cyan, 'emit');
  // corner coolant pipes with glowing bands
  for (const [x, z] of [[1.7, 1.7], [-1.7, 1.7], [1.7, -1.7], [-1.7, -1.7]]) {
    b.cyl(0.075, 0.075, 2.7, x, 1.6, z, 0x3a4048, 'solid', 12);
    for (let k = 0; k < 4; k++) b.cyl(0.08, 0.08, 0.04, x, 0.8 + k * 0.55, z, 0x3aa0ff, 'emit', 12);
    b.cyl(0.11, 0.11, 0.08, x, 2.95, z, cap, 'solid', 12);
  }
  // eight server racks in a ring, facing out
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8, ry = Math.PI / 2 - a;
    const cx = Math.cos(a) * 1.5, cz = Math.sin(a) * 1.5;
    const at = (lx: number, lz: number): [number, number] => [cx + lx * Math.cos(ry) + lz * Math.sin(ry), cz - lx * Math.sin(ry) + lz * Math.cos(ry)];
    b.rbox(0.62, 2.6, 0.62, 0.02, cx, 1.65, cz, metal, 0, ry);
    let [x, z] = at(0, 0.315);
    b.box(0.52, 2.4, 0.01, x, 1.65, z, dark, 'solid', ry);
    for (let r = 0; r < 7; r++) for (let c = 0; c < 4; c++) {
      [x, z] = at(-0.18 + c * 0.12, 0.322);
      const hsh = hash01(i * 97 + r * 7 + c);
      b.box(0.05, 0.02, 0.006, x, 0.75 + r * 0.3, z, hsh < 0.5 ? 0x30ff70 : hsh < 0.8 ? 0x2a9cff : 0xffb020, 'emit', ry);
    }
    for (let r = 0; r < 7; r++) { [x, z] = at(0, 0.321); b.box(0.46, 0.012, 0.004, x, 0.64 + r * 0.3, z, 0x2a2e34, 'solid', ry); }
    [x, z] = at(0.29, 0.3);
    b.box(0.03, 2.3, 0.02, x, 1.65, z, 0xff2030, 'emit', ry);
    // cable from rack top sagging into the core cap
    const top = new THREE.Vector3(Math.cos(a) * 1.25, 2.95, Math.sin(a) * 1.25);
    const mid = new THREE.Vector3(Math.cos(a) * 1.0, 3.05, Math.sin(a) * 1.0);
    const end = new THREE.Vector3(Math.cos(a) * 0.72, 3.3, Math.sin(a) * 0.72);
    rod(b, top, mid, 0.035, 0x121316); rod(b, mid, end, 0.035, 0x121316);
  }
  // crown ring tying the racks together
  b.geo(new THREE.TorusGeometry(1.5, 0.07, 8, 40), cap, 0, 2.97, 0, Math.PI / 2);
  b.geo(new THREE.TorusGeometry(1.5, 0.02, 6, 40), 0x2080ff, 0, 3.05, 0, Math.PI / 2, 0, 0, 'emit');
  // central core: glass drum around a glowing column with energy rings
  b.cyl(1.0, 1.05, 0.35, 0, 0.52, 0, cap, 'solid', 24);
  b.cyl(0.28, 0.28, 2.5, 0, 1.95, 0, cyan, 'emit', 16);
  for (let k = 0; k < 5; k++) b.geo(new THREE.TorusGeometry(0.52, 0.025, 6, 28), 0x60d8ff, 0, 1.05 + k * 0.45, 0, Math.PI / 2, 0, 0, 'emit');
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b.box(0.05, 2.5, 0.05, Math.cos(a) * 0.86, 1.95, Math.sin(a) * 0.86, cap); }
  b.cyl(0.88, 0.88, 2.5, 0, 1.95, 0, 0x6ab8e0, 'glass', 28);
  b.cyl(0.8, 1.0, 0.35, 0, 3.37, 0, cap, 'solid', 24);
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; b.box(0.03, 0.22, 0.42, Math.cos(a) * 0.55, 3.66, Math.sin(a) * 0.55, 0x3a3f46, 'solid', -a + Math.PI / 2); }
  b.cyl(0.3, 0.3, 0.06, 0, 3.58, 0, 0x3aa0ff, 'emit', 16);
}

// ------------------------------------------------------------------------------------------ weapons
export function gunKindOf(category: string): 'rifle' | 'pistol' | 'shotgun' | 'smg' | 'lmg' | 'sniper' {
  switch (category) {
    case 'pistol': case 'heavy_pistol': return 'pistol';
    case 'smg': return 'smg';
    case 'shotgun': return 'shotgun';
    case 'sniper': return 'sniper';
    case 'machine_gun': return 'lmg';
    default: return 'rifle';
  }
}
