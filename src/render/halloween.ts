import * as THREE from 'three';
import type { Builder, Bucket } from './models';

/**
 * Halloween models (currentHoliday() === 'halloween'). Kinds never change: halloweenProp() rebuilds a kind outright
 * (planters and pot plants become graves, zombie hands, pumpkin patches, chalk outlines and skulls; cones become candy
 * corn), halloweenDecor() dresses the normal model (jack-o'-lanterns, candles, sweets, cobwebs, bats, googly eyes).
 * Street kinds (policecar, swatvan, tent, floodlight) are dressed in street.ts's frames. Colours and helpers are local:
 * models.ts imports this file, so nothing is imported back at runtime. The shared helpers (at, rod, text...) are
 * exported for christmas.ts.
 */
const BUCKETS: Bucket[] = ['solid', 'emit', 'glass', 'screen', 'mirror'];
const H = {
  orange: 0xd8641a, orange2: 0xc0521a, stalk: 0x4a5424, glow: 0xffa526, bone: 0xe4dac0, tooth: 0xf2ead4, socket: 0x1a1410,
  flesh: 0x7b8a62, flesh2: 0x56643f, sleeve: 0x2e3440, soil: 0x241a12, dirt: 0x3e2c1c, grass: 0x34422a, stone: 0x8a8c86, stone2: 0x666862,
  moss: 0x4c5c34, chalk: 0xf0f0ea, bat: 0x1c171e, web: 0xe2e2da, wax: 0xeee4c8, flame: 0xffc040, purple: 0x6a2a9a, black: 0x1a1a1c,
  slime: 0x7aff3a, straw: 0xb89a50, engrave: 0x2c2c2a,
};
const CANDY = [0xd02a2a, 0x7a2aa8, 0xf2c21a, 0x2a9a4a, 0xf07a10, 0xf4f0e6];
export const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Build `fn` at the local origin, then scale by s, tilt (rz, then rx), turn by ry and move to (x, y, z). Nests. */
export function at(b: Builder, x: number, y: number, z: number, ry: number, s: number, fn: () => void, rx = 0, rz = 0) {
  const n = BUCKETS.map((k) => b.p[k].length);
  fn();
  const m = new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), v3(s, s, s));
  BUCKETS.forEach((k, i) => { for (let j = n[i]; j < b.p[k].length; j++) b.p[k][j].applyMatrix4(m); });
}
/** Thin tapered cylinder from a to c. */
export function rod(b: Builder, a: THREE.Vector3, c: THREE.Vector3, r: number, color: number, seg = 6) {
  const d = c.clone().sub(a), len = d.length();
  if (len < 1e-4) return;
  const g = new THREE.CylinderGeometry(r * 0.85, r, len, seg);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), d.normalize()));
  b.geo(g, color, a.x, a.y, a.z);
}
/** Thin flat strip from (x0,y0) to (x1,y1) in the xy plane (webs, lettering). */
export function strip(b: Builder, x0: number, y0: number, x1: number, y1: number, t: number, color: number, bucket: Bucket = 'solid', d = 0.006) {
  b.box(Math.hypot(x1 - x0, y1 - y0) + t, t, d, (x0 + x1) / 2, (y0 + y1) / 2, 0, color, bucket, 0, 0, Math.atan2(y1 - y0, x1 - x0));
}
/** Half-ellipsoid mound on y (radii rx, ry, rz). */
export const dome = (b: Builder, color: number, x: number, y: number, z: number, rx: number, ry: number, rz: number) =>
  b.geo(new THREE.SphereGeometry(1, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2), color, x, y, z, 0, 0, 0, 'solid', rx, ry, rz);
/** Flat elliptical leaf with its base at (x,y,z), pointing along yaw and pitched up by `pitch`. */
export function leaf(b: Builder, len: number, wid: number, x: number, y: number, z: number, yaw: number, pitch: number, color: number) {
  const g = new THREE.SphereGeometry(0.5, 6, 4);
  g.translate(0, 0, 0.5);
  g.scale(wid, 0.014, len);
  g.rotateX(-pitch);
  g.rotateY(yaw);
  b.geo(g, color, x, y, z);
}
/** Grass blades scattered over an ellipse (radii rx, rz) at height y. */
function tufts(b: Builder, n: number, rx: number, rz: number, y: number, seed: number) {
  for (let i = 0; i < n; i++) {
    const a = hash(seed + i) * 6.283, r = 0.55 + 0.45 * hash(seed + i * 3);
    b.geo(new THREE.ConeGeometry(0.014, 0.1, 3), [0x4a5a2a, 0x5e6a34, 0x3a4824][i % 3], Math.cos(a) * rx * r, y + 0.045, Math.sin(a) * rz * r, Math.sin(a) * 0.3, a, -Math.cos(a) * 0.3);
  }
}
/** Loose clods of earth over an ellipse at height y. */
function clods(b: Builder, n: number, rx: number, rz: number, y: number, seed: number, x0 = 0) {
  for (let i = 0; i < n; i++) {
    const a = hash(seed + i * 7) * 6.283, r = hash(seed + i * 5);
    b.geo(new THREE.IcosahedronGeometry(0.022 + hash(i + seed) * 0.02, 0), i % 2 ? H.dirt : H.soil, x0 + Math.cos(a) * rx * r, y, Math.sin(a) * rz * r, a, a * 2, 0);
  }
}

// ------------------------------------------------------------------ characters of the season
const EYE_L: [number, number][] = [[-0.5, 0.06], [-0.18, 0.06], [-0.34, 0.36]];
const FACE: [number, number][][] = [
  EYE_L, EYE_L.map(([x, y]) => [-x, y] as [number, number]), [[-0.08, -0.1], [0.08, -0.1], [0, 0.04]],
  [[-0.56, -0.14], [-0.32, -0.3], [-0.22, -0.19], [-0.12, -0.32], [0.1, -0.32], [0.2, -0.19], [0.3, -0.3], [0.56, -0.14], [0.4, -0.42], [0.18, -0.52], [0.1, -0.4], [0.02, -0.54], [-0.2, -0.53], [-0.42, -0.42]], // jagged grin
];
/** Ribbed pumpkin standing on y (radius r); carved = a jack-o'-lantern whose face (toward +z after ry) glows. */
function pumpkin(b: Builder, x: number, y: number, z: number, r: number, ry = 0, carved = true) {
  const lobes = r > 0.12 ? 8 : 6, seg = r > 0.12 ? 8 : 6;
  at(b, x, y, z, ry, r, () => {
    b.geo(new THREE.SphereGeometry(0.7, seg, 6), H.orange2, 0, 0.78, 0);
    for (let k = 0; k < lobes; k++) {
      const a = (k / lobes) * Math.PI * 2;
      b.geo(new THREE.SphereGeometry(1, seg, 6), k % 2 ? H.orange : 0xe0701e, Math.sin(a) * 0.45, 0.78, Math.cos(a) * 0.45, 0, a, 0, 'solid', lobes === 8 ? 0.45 : 0.55, 0.78, 0.58);
    }
    b.cyl(0.07, 0.11, 0.34, 0.04, 1.58, 0, H.stalk, 'solid', 6, 0, -0.3);
    // carved features: flat cut-outs extruded inward and wrapped onto the shell, lit from within
    if (carved) for (const f of FACE) {
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(f.map(([u, v]) => new THREE.Vector2(u, v))), { depth: 0.35, bevelEnabled: false });
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) { const u = p.getX(i), v = p.getY(i); p.setZ(i, p.getZ(i) - 0.35 + 1.04 * Math.sqrt(Math.max(0.1, 1 - u * u - (v / 0.78) ** 2))); }
      b.geo(g, H.glow, 0, 0.78, 0, 0, 0, 0, 'emit');
    }
  });
}
/** Bone-white skull facing +z, jaw resting on y (about 2 units tall before scaling by s). */
function skull(b: Builder, x: number, y: number, z: number, s: number, ry = 0, rx = 0, rz = 0) {
  const yc = 0.95;
  at(b, x, y, z, ry, s, () => {
    b.geo(new THREE.SphereGeometry(1, 12, 9), H.bone, 0, yc + 0.15, 0, 0, 0, 0, 'solid', 0.88, 0.88, 1); // cranium
    b.rbox(0.95, 0.55, 0.6, 0.18, 0, yc - 0.45, 0.48, H.bone); // cheeks and upper jaw
    for (const sx of [-1, 1]) b.geo(new THREE.SphereGeometry(1, 8, 6), H.socket, sx * 0.33, yc - 0.02, 0.84, 0, 0, 0, 'solid', 0.22, 0.21, 0.12); // eye sockets
    b.geo(new THREE.ConeGeometry(0.1, 0.2, 3), H.socket, 0, yc - 0.32, 0.76, -Math.PI / 2); // nose cavity
    b.box(0.6, 0.05, 0.05, 0, yc - 0.66, 0.78, H.socket);
    for (let i = 0; i < 5; i++) b.box(0.1, 0.12, 0.05, -0.24 + i * 0.12, yc - 0.6, 0.79, H.tooth); // teeth
    b.rbox(0.8, 0.22, 0.5, 0.08, 0, yc - 0.8, 0.45, H.bone); // mandible
  }, rx, rz);
}
/** Loose long bone lying along local x. */
function boneBit(b: Builder, x: number, y: number, z: number, len: number, ry: number) {
  at(b, x, y, z, ry, 1, () => {
    b.cyl(0.012, 0.012, len, 0, 0, 0, H.bone, 'solid', 6, 0, Math.PI / 2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.sphere(0.018, sx * len / 2, 0, sz * 0.012, H.bone);
  });
}
/**
 * Forearm and clawed hand reaching up along +y from the origin (about 0.5 m before scaling), fingers curling toward +z.
 * Zombie: grey-green rotting skin and a torn sleeve at the ground line. bone: a thinner skeleton hand, no sleeve.
 */
function hand(b: Builder, x: number, y: number, z: number, s: number, ry: number, lean: number, bone = false, rz = 0) {
  const skin = bone ? H.bone : H.flesh, tip = bone ? H.tooth : H.flesh2, t = bone ? 0.6 : 1;
  at(b, x, y, z, ry, s, () => {
    rod(b, v3(0, -0.12, 0), v3(0, 0.3, 0.01), 0.034 * t, skin, 7);
    b.rbox(0.085, 0.1, 0.034 * t, 0.012 * t, 0, 0.355, 0.012, skin, 0.15);
    for (let i = 0; i < 4; i++) {
      const fx = -0.03 + i * 0.02, l = i === 1 || i === 2 ? 1 : 0.82;
      const p0 = v3(fx, 0.4, 0.02), p1 = p0.clone().add(v3(fx * 0.5, 0.05 * l, 0.012)), p2 = p1.clone().add(v3(0, 0.022 * l, 0.034 * l));
      rod(b, p0, p1, 0.011 * t, skin, 5); rod(b, p1, p2, 0.009 * t, tip, 5);
    }
    rod(b, v3(0.04, 0.33, 0.015), v3(0.072, 0.375, 0.035), 0.011 * t, skin, 5); rod(b, v3(0.072, 0.375, 0.035), v3(0.078, 0.405, 0.064), 0.009 * t, tip, 5); // thumb
    if (!bone) {
      b.sphere(0.022, 0.022, 0.22, 0.026, H.flesh2, 'solid', 1.6); // rot
      b.cyl(0.052, 0.048, 0.14, 0, 0.05, 0, H.sleeve, 'solid', 8);
      for (let k = 0; k < 4; k++) { const a = k * 1.7; b.geo(new THREE.ConeGeometry(0.022, 0.07, 3), H.sleeve, Math.sin(a) * 0.046, 0.15, Math.cos(a) * 0.046, 0, a, 0.25); } // torn cuff
    }
  }, lean, rz);
}
const WING: [number, number][] = [[0.04, 0.06], [0.16, 0.16], [0.32, 0.2], [0.48, 0.13], [0.4, 0.07], [0.34, -0.02], [0.26, 0.04], [0.19, -0.04], [0.12, 0.02], [0.04, -0.05]];
/** Bat facing +z with scalloped wings in the xy plane (~1 unit across before scaling); fold sweeps them back. flat = wall decal. */
function bat(b: Builder, x: number, y: number, z: number, s: number, ry = 0, fold = 0, rz = 0, color = H.bat, flat = false) {
  at(b, x, y, z, ry, s, () => {
    const fz = flat ? 0.15 : 1;
    b.geo(new THREE.SphereGeometry(0.08, 8, 6), color, 0, 0, 0, 0, 0, 0, 'solid', 0.8, 1.3, 0.8 * fz);
    b.geo(new THREE.SphereGeometry(0.06, 8, 6), color, 0, 0.13, 0.01 * fz, 0, 0, 0, 'solid', 1, 1, fz);
    for (const sx of [-1, 1]) {
      b.geo(new THREE.ConeGeometry(0.025, 0.07, 4), color, sx * 0.035, 0.2, 0, 0, 0, -sx * 0.3, 'solid', 1, 1, fz);
      if (!flat) b.sphere(0.012, sx * 0.022, 0.14, 0.055, 0xff3020, 'emit');
      b.geo(new THREE.ShapeGeometry(new THREE.Shape(WING.map(([u, v]) => new THREE.Vector2(sx * u, v)))), color, 0, 0, 0, 0, sx * fold, 0);
    }
  }, 0, rz);
}
/** Corner cobweb in the xy plane, anchored at the origin and spreading along +x (dir 1) or -x (dir -1) and down. */
function web(b: Builder, x: number, y: number, z: number, s: number, ry = 0, dir = 1) {
  at(b, x, y, z, ry, s, () => {
    const n = 5, ang = (i: number) => (dir > 0 ? 0 : Math.PI) - dir * (i / (n - 1)) * (Math.PI / 2);
    const pt = (i: number, r: number) => [Math.cos(ang(i)) * r, Math.sin(ang(i)) * r];
    for (let i = 0; i < n; i++) strip(b, 0, 0, pt(i, 1)[0], pt(i, 1)[1], 0.014, H.web, 'solid', 0.004);
    for (const r of [0.32, 0.6, 0.88]) for (let i = 0; i < n - 1; i++) { const [x0, y0] = pt(i, r), [x1, y1] = pt(i + 1, r); strip(b, x0, y0, x1 * 0.93, y1 * 0.93, 0.011, H.web, 'solid', 0.004); } // sagging spirals
  });
}
/** Black spider hanging `drop` below (x, y, z) on a thread. */
function spider(b: Builder, x: number, y: number, z: number, s: number, drop: number) {
  b.box(0.003, drop, 0.003, x, y - drop / 2, z, H.web);
  at(b, x, y - drop, z, 0.4, s, () => {
    b.geo(new THREE.SphereGeometry(0.05, 8, 6), H.black, 0, -0.02, -0.04, 0, 0, 0, 'solid', 1, 0.85, 1.2);
    b.sphere(0.03, 0, -0.02, 0.03, H.black);
    for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) {
      const knee = v3(sx * 0.07, 0.02, 0.05 - k * 0.032), foot = v3(sx * 0.11, -0.06, 0.07 - k * 0.048);
      rod(b, v3(sx * 0.02, -0.02, 0.03 - k * 0.012), knee, 0.006, H.black, 4); rod(b, knee, foot, 0.005, H.black, 4);
    }
  });
}
/** Dripping candle with a lit flame. */
function candle(b: Builder, x: number, y: number, z: number, h = 0.12, r = 0.022) {
  b.cyl(r, r, h, x, y + h / 2, z, H.wax, 'solid', 8);
  b.sphere(r * 0.45, x + r * 0.8, y + h * 0.75, z, H.wax, 'solid', 2);
  b.cyl(0.002, 0.002, r, x, y + h + r * 0.4, z, H.black, 'solid', 4);
  b.geo(new THREE.ConeGeometry(r * 0.5, r * 1.8, 6), H.flame, x, y + h + r * 1.2, z, 0, 0, 0, 'emit');
}
/** Pumpkin-orange bowl heaped with wrapped sweets. */
function candyBowl(b: Builder, x: number, y: number, z: number, r = 0.1) {
  b.cyl(r, r * 0.6, r * 0.6, x, y + r * 0.3, z, H.orange, 'solid', 12);
  b.cyl(r * 0.92, r * 0.92, 0.004, x, y + r * 0.58, z, 0x2a1a10, 'solid', 12);
  for (let k = 0; k < 7; k++) {
    const a = k * 2.4, d = r * 0.62 * Math.sqrt((k + 0.5) / 7);
    b.rbox(r * 0.34, r * 0.18, r * 0.2, r * 0.06, x + Math.cos(a) * d, y + r * 0.66 - d * 0.3, z + Math.sin(a) * d, CANDY[k % CANDY.length], 0, a);
  }
}
/** Pointy witch's hat with a purple band and a gold buckle. */
function witchHat(b: Builder, x: number, y: number, z: number, s: number, ry = 0) {
  at(b, x, y, z, ry, s, () => {
    b.cyl(0.2, 0.2, 0.014, 0, 0.007, 0, H.black, 'solid', 16);
    b.cyl(0.045, 0.1, 0.2, 0, 0.16, 0, H.black, 'solid', 12);
    b.cyl(0.1, 0.105, 0.045, 0, 0.04, 0, H.purple, 'solid', 12);
    b.box(0.045, 0.04, 0.01, 0, 0.04, 0.104, 0xd8b030);
    b.geo(new THREE.ConeGeometry(0.045, 0.16, 8), H.black, 0.052, 0.32, 0, 0, 0, -0.7); // bent tip
  });
}
/** Black cauldron on stubby legs, glowing green brew heaped with sweets (r = bowl radius). */
function cauldron(b: Builder, x: number, y: number, z: number, r: number) {
  at(b, x, y, z, 0, r, () => {
    b.geo(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.7), 0x232326, 0, 1.05, 0);
    b.geo(new THREE.TorusGeometry(0.81, 0.08, 6, 20), 0x2e2e32, 0, 1.64, 0, Math.PI / 2);
    b.cyl(0.78, 0.78, 0.02, 0, 1.5, 0, 0x58e030, 'emit', 16);
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; b.cyl(0.08, 0.06, 0.3, Math.cos(a) * 0.55, 0.15, Math.sin(a) * 0.55, 0x232326, 'solid', 6); }
    for (let k = 0; k < 6; k++) { const a = k * 2.4, d = 0.45 * Math.sqrt((k + 0.5) / 6); b.rbox(0.3, 0.16, 0.18, 0.05, Math.cos(a) * d, 1.6 + (0.45 - d) * 0.4, Math.sin(a) * d, CANDY[k], 0, a); }
  });
}
/** Stick-on googly eye facing +z (radius r); look turns the pupil. */
function googly(b: Builder, x: number, y: number, z: number, r: number, look = 0) {
  at(b, x, y, z, 0, r, () => {
    b.cyl(1, 1, 0.25, 0, 0, 0.125, 0xf6f6f2, 'solid', 16, Math.PI / 2);
    b.cyl(0.5, 0.5, 0.1, Math.cos(look) * 0.4, Math.sin(look) * 0.4, 0.29, 0x101010, 'solid', 12, Math.PI / 2);
  });
}
/** Friendly bedsheet ghost (about 0.55 tall before scaling) facing +z. */
function ghost(b: Builder, x: number, y: number, z: number, s: number) {
  at(b, x, y, z, 0, s, () => {
    b.geo(new THREE.LatheGeometry([[0.2, 0], [0.17, 0.12], [0.16, 0.3], [0.15, 0.42], [0.1, 0.52], [0, 0.55]].map(([u, v]) => new THREE.Vector2(u, v)), 14), 0xeef0f4, 0, 0, 0);
    for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; b.sphere(0.045, Math.sin(a) * 0.185, 0.01, Math.cos(a) * 0.185, 0xeef0f4, 'solid', 0.7); } // wavy hem
    for (const sx of [-1, 1]) b.geo(new THREE.SphereGeometry(0.032, 8, 6), H.black, sx * 0.055, 0.4, 0.148, 0, 0, 0, 'solid', 1, 1.3, 0.4);
    b.geo(new THREE.SphereGeometry(0.028, 8, 6), H.black, 0, 0.31, 0.158, 0, 0, 0, 'solid', 1, 1.4, 0.4); // "oooo"
  });
}

/** Stroke lettering on a 0..1 cell. */
const FONT: Record<string, number[][]> = {
  A: [[0, 0, 0.5, 1], [0.5, 1, 1, 0], [0.25, 0.42, 0.75, 0.42]], C: [[1, 1, 0, 1], [0, 1, 0, 0], [0, 0, 1, 0]], M: [[0, 0, 0, 1], [0, 1, 0.5, 0.45], [0.5, 0.45, 1, 1], [1, 1, 1, 0]],
  S: [[1, 1, 0, 1], [0, 1, 0, 0.5], [0, 0.5, 1, 0.5], [1, 0.5, 1, 0], [1, 0, 0, 0]], E: [[0, 0, 0, 1], [0, 1, 1, 1], [0, 0.5, 0.75, 0.5], [0, 0, 1, 0]],
  H: [[0, 0, 0, 1], [1, 0, 1, 1], [0, 0.5, 1, 0.5]], I: [[0.5, 0, 0.5, 1]], K: [[0, 0, 0, 1], [0, 0.4, 1, 1], [0.3, 0.6, 1, 0]],
  L: [[0, 1, 0, 0], [0, 0, 1, 0]], N: [[0, 0, 0, 1], [0, 1, 1, 0], [1, 0, 1, 1]], O: [[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 0], [1, 0, 0, 0]],
  P: [[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 0.5], [1, 0.5, 0, 0.5]], R: [[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 0.5], [1, 0.5, 0, 0.5], [0.35, 0.5, 1, 0]],
  T: [[0, 1, 1, 1], [0.5, 1, 0.5, 0]], U: [[0, 1, 0, 0], [0, 0, 1, 0], [1, 0, 1, 1]], W: [[0, 1, 0.25, 0], [0.25, 0, 0.5, 0.6], [0.5, 0.6, 0.75, 0], [0.75, 0, 1, 1]],
  Y: [[0, 1, 0.5, 0.5], [1, 1, 0.5, 0.5], [0.5, 0.5, 0.5, 0]],
};
/** Text centred on the origin in the xy plane, facing +z (cap height h). */
export function text(b: Builder, str: string, h: number, color: number, bucket: Bucket = 'solid') {
  const cw = (ch: string) => (ch === 'I' ? h * 0.1 : h * 0.62), gap = h * 0.28, adv = (ch: string) => (ch === ' ' ? h * 0.5 : cw(ch) + gap);
  let x = -([...str].reduce((s, ch) => s + adv(ch), 0) - gap) / 2;
  for (const ch of str) {
    const w = cw(ch);
    for (const [ax, ay, bx, by] of FONT[ch] ?? []) strip(b, x + ax * w, ay * h - h / 2, x + bx * w, by * h - h / 2, h * 0.13, color, bucket, 0.008);
    x += adv(ch);
  }
}
/** Hand-painted two-plank "KEEP OUT" board, centred at the origin; post = stake length below it. */
function sign(b: Builder, x: number, y: number, z: number, ry: number, post = 0, rx = 0) {
  at(b, x, y, z, ry, 1, () => {
    if (post) b.box(0.05, post, 0.04, 0, -post / 2, -0.035, 0x4a3420);
    b.box(0.7, 0.12, 0.025, 0, 0.065, 0, 0x5e4228, 'solid', 0, 0, -0.03).box(0.7, 0.12, 0.025, 0.01, -0.065, 0, 0x6a4a2c, 'solid', 0, 0, 0.03);
    at(b, 0, 0, 0.016, 0, 1, () => text(b, 'KEEP OUT', 0.09, 0xf08a1a), 0, -0.02);
  }, rx, 0.05);
}
/** Sagging string of orange / purple / black pennants along x from -len/2 to len/2, hanging from y = 0. */
function bunting(b: Builder, len: number, sag = 0.08) {
  const n = Math.max(3, Math.round(len / 0.17)), pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) { const u = -1 + (2 * i) / n; pts.push(v3((u * len) / 2, -sag * (1 - u * u), 0)); }
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[i + 1];
    strip(b, a.x, a.y, c.x, c.y, 0.006, 0x2a2a2a, 'solid', 0.006);
    b.geo(new THREE.CircleGeometry(0.07, 3), [0xf07a10, H.purple, H.black][i % 3], (a.x + c.x) / 2, (a.y + c.y) / 2 - 0.035, 0, 0, 0, -Math.PI / 2);
  }
}
/** Weathered headstone on a plinth facing +z: round-topped with an engraved RIP, or a stone cross. */
function headstone(b: Builder, x: number, y: number, z: number, hgt: number, cross: boolean, ry: number, lean: number) {
  at(b, x, y, z, ry, 1, () => {
    const t = 0.08;
    b.box(cross ? 0.26 : 0.44, 0.08, 0.16, 0, 0.04, 0, H.stone2);
    if (cross) {
      b.box(0.09, hgt, t, 0, hgt / 2 + 0.06, 0, H.stone).box(0.34, 0.09, t, 0, hgt * 0.72 + 0.06, 0, H.stone);
      b.box(0.095, 0.12, t + 0.006, 0, 0.16, 0, H.moss);
    } else {
      const w = 0.34, body = hgt - w / 2;
      b.box(w, body, t, 0, body / 2 + 0.06, 0, H.stone);
      b.cyl(w / 2, w / 2, t, 0, body + 0.06, 0, H.stone, 'solid', 16, Math.PI / 2);
      at(b, 0, body - 0.01, t / 2 + 0.001, 0, 1, () => text(b, 'RIP', 0.1, H.engrave));
      b.box(w * 0.6, 0.012, 0.006, 0, body - 0.1, t / 2 + 0.002, H.engrave);
      b.box(w * 0.4, 0.08, t + 0.006, -w * 0.24, 0.12, 0, H.moss);
      b.box(0.05, 0.04, t + 0.004, w * 0.36, body + 0.16, 0, H.stone2, 'solid', 0, 0, 0.5); // chipped edge
    }
  }, -0.05, lean);
}

// ------------------------------------------------------------------ replaced models
/** Police chalk outline (x across, y along the body, head toward +y), in metres. */
const BODY: [number, number][] = [
  [0.06, 0.6], [0.18, 0.55], [0.36, 0.74], [0.42, 0.84], [0.48, 0.77], [0.26, 0.47], [0.18, 0.3], [0.17, 0.05], [0.32, -0.36], [0.38, -0.8], [0.26, -0.82],
  [0.21, -0.4], [0.04, -0.06], [-0.08, -0.42], [-0.1, -0.82], [-0.22, -0.82], [-0.2, -0.38], [-0.17, 0.05], [-0.18, 0.28], [-0.34, 0.12], [-0.42, 0.16],
  [-0.36, 0.27], [-0.2, 0.52], [-0.06, 0.6],
];

/** Halloween replacement for a kind. True = built here (the normal model is skipped). */
export function halloweenProp(b: Builder, kind: string, W: number, D: number, _w: number, _h: number): boolean {
  const pw = Math.min(W * 0.92, 2.6), pd = Math.min(D * 0.92, 0.9); // planter box size, as models.ts planter()
  switch (kind) {
    case 'planter': {
      // grave plot: weathered stone kerb round a grassy mound, a row of headstones (round-topped and crosses), fresh dirt
      b.rbox(pw, 0.12, pd, 0.02, 0, 0.06, 0, H.stone2);
      dome(b, H.grass, 0, 0.1, 0, pw * 0.47, 0.14, pd * 0.44);
      const n = Math.max(1, Math.round(pw / 0.6));
      for (let k = 0; k < n; k++) {
        const x = -pw / 2 + (k + 0.5) * (pw / n);
        dome(b, H.dirt, x, 0.12, pd * 0.08, Math.min(0.2, pw / n / 2.4), 0.1, pd * 0.26);
        headstone(b, x, 0.1, -pd * 0.24, 0.5 + hash(k) * 0.2, n > 1 && k % 2 === 1, (hash(k + 3) - 0.5) * 0.3, (hash(k + 7) - 0.5) * 0.16);
      }
      tufts(b, 6 + n * 4, pw * 0.44, pd * 0.4, 0.12, 3);
      break;
    }
    case 'planter_grass': {
      // corten box of churned soil with rotting hands clawing up out of it (and one more only just breaking the surface)
      const Hh = 0.4, n = Math.max(1, Math.floor(pw / 0.55));
      b.rbox(pw, Hh, pd, 0.008, 0, Hh / 2, 0, 0x8a4a22).rbox(pw + 0.02, 0.02, pd + 0.02, 0.004, 0, Hh, 0, 0x6a3a1a);
      for (let k = 0; k < 4; k++) b.box(0.01, Hh * (0.3 + hash(k) * 0.5), 0.006, -pw / 2 + (k + 0.5) * (pw / 4), Hh * 0.55, pd / 2 + 0.002, 0x5a2e12); // rust streaks
      b.rbox(pw - 0.04, 0.02, pd - 0.04, 0.005, 0, Hh - 0.005, 0, H.soil);
      dome(b, H.dirt, 0, Hh, 0, pw * 0.42, 0.08, pd * 0.36);
      clods(b, 6 + n * 4, pw * 0.42, pd * 0.4, Hh + 0.04, 11);
      for (let k = 0; k < n; k++) hand(b, -pw / 2 + (k + 0.5) * (pw / n) + (hash(k) - 0.5) * 0.1, Hh + 0.02, (hash(k + 5) - 0.5) * pd * 0.3 - 0.05, 1.35 + hash(k + 2) * 0.2, (hash(k + 9) - 0.5) * 1.2, 0.15 + hash(k + 4) * 0.3);
      hand(b, pw / 2 - 0.16, Hh - 0.33, pd / 2 - 0.16, 1, -0.7, 0.3); // fingertips
      break;
    }
    case 'planter_topiary': {
      // rough timber trough bedded with straw: a pumpkin patch of jack-o'-lanterns, a few uncarved, vines and leaves
      const Hh = 0.26, n = Math.max(1, Math.floor(pw / 0.5));
      for (let k = 0; k < 3; k++) b.rbox(pw, 0.085, pd, 0.008, 0, 0.045 + k * 0.088, 0, k % 2 ? 0x6a4a2c : 0x5a3e24);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rbox(0.05, Hh + 0.04, 0.05, 0.008, sx * (pw / 2 - 0.02), (Hh + 0.04) / 2, sz * (pd / 2 - 0.02), 0x4a321e);
      b.rbox(pw - 0.04, 0.02, pd - 0.04, 0.005, 0, Hh, 0, H.straw);
      for (let k = 0; k < n; k++) {
        const x = -pw / 2 + (k + 0.5) * (pw / n), r = Math.min(0.25, pd * 0.3) * (k % 2 ? 0.82 : 1);
        pumpkin(b, x, Hh, -0.03 + (k % 2) * 0.05, r, (hash(k) - 0.5) * 0.6);
        for (let m = 0; m < 3; m++) leaf(b, 0.16, 0.13, x + (hash(k * 5 + m) - 0.5) * r * 2, Hh + 0.012, -pd * 0.3 + hash(k + m) * 0.08, hash(k * 3 + m) * 6.283, 0.1, [0x3a5a2a, 0x4a6a30][m % 2]);
        b.geo(new THREE.TorusGeometry(0.04, 0.005, 4, 12, 4.6), H.stalk, x + r * 0.2, Hh + r * 1.62, 0.02, 0, 0, 0.4); // curly tendril
      }
      const small = n > 1 ? Array.from({ length: n - 1 }, (_, k) => -pw / 2 + (k + 1) * (pw / n)) : [pw * 0.3];
      small.forEach((x, k) => pumpkin(b, x, Hh, pd * 0.28, 0.09, hash(k + 1) * 6.283, false));
      break;
    }
    case 'planter_flowers': {
      // dark soil bed in a low concrete kerb with a police chalk outline on it, a yellow evidence marker and dead leaves
      const Hh = 0.14, y = Hh + 0.012;
      b.rbox(pw, Hh, pd, 0.015, 0, Hh / 2, 0, 0x5e5e5a);
      b.rbox(pw - 0.08, 0.02, pd - 0.08, 0.005, 0, Hh, 0, 0x1c1610);
      const s = Math.min((pw - 0.16) / 1.75, (pd - 0.12) / 0.95), P = ([u, v]: [number, number]) => [v * s, -u * s]; // body along x, head to +x
      for (let i = 0; i < BODY.length - 1; i++) {
        const [x0, z0] = P(BODY[i]), [x1, z1] = P(BODY[i + 1]);
        b.box(Math.hypot(x1 - x0, z1 - z0) + 0.02, 0.004, 0.022, (x0 + x1) / 2, y, (z0 + z1) / 2, H.chalk, 'solid', Math.atan2(-(z1 - z0), x1 - x0));
      }
      b.geo(new THREE.TorusGeometry(0.11 * s, 0.011, 3, 20), H.chalk, 0.72 * s, y, 0, Math.PI / 2);
      const mx = -pw / 2 + 0.13, mz = pd / 2 - 0.13; // evidence marker no. 1
      b.box(0.1, 0.08, 0.004, mx, Hh + 0.035, mz + 0.016, 0xf2c21a, 'solid', 0, -0.45).box(0.1, 0.08, 0.004, mx, Hh + 0.035, mz - 0.016, 0xf2c21a, 'solid', 0, 0.45);
      b.box(0.012, 0.045, 0.004, mx, Hh + 0.037, mz + 0.02, 0x111111, 'solid', 0, -0.45);
      for (let k = 0; k < 7; k++) leaf(b, 0.06, 0.04, (hash(k) - 0.5) * (pw - 0.2), y, (hash(k + 4) - 0.5) * (pd - 0.2), hash(k + 8) * 6.283, 0, [0x6a4a2a, 0x8a5a24, 0x5a3a1e][k % 3]);
      break;
    }
    case 'planter_bamboo': {
      // glossy black planter heaped with skulls on dark soil, a few loose bones
      const Hh = 0.4, sw = 0.19, nb = Math.max(2, Math.min(5, Math.floor((pw - 0.1) / sw)));
      b.rbox(pw, Hh, pd, 0.02, 0, Hh / 2, 0, 0x121316).rbox(pw + 0.02, 0.02, pd + 0.02, 0.006, 0, Hh, 0, 0x2a2c30);
      b.rbox(pw - 0.04, 0.02, pd - 0.04, 0.005, 0, Hh - 0.005, 0, H.soil);
      let id = 0;
      for (let row = 0; row < 3; row++) {
        const n = row === 2 ? 1 : nb - row, span = row === 2 ? 0 : (pw - 0.3) * (n - 1) / Math.max(1, nb - 1);
        for (let i = 0; i < n; i++, id++) {
          const x = n > 1 ? -span / 2 + (i * span) / (n - 1) : 0;
          skull(b, x + (hash(id) - 0.5) * 0.04, Hh + row * 0.15, 0.04 - row * 0.06, 0.09, (hash(id + 3) - 0.5) * 0.9, (hash(id + 5) - 0.5) * 0.3, (hash(id + 7) - 0.5) * 0.3);
        }
      }
      for (let k = 0; k < 3; k++) boneBit(b, (hash(k + 20) - 0.5) * (pw - 0.3), Hh + 0.012, pd / 2 - 0.12 - k * 0.05, 0.18, hash(k + 30) * 3);
      break;
    }
    case 'plant': {
      // one big jack-o'-lantern and a little uncarved pumpkin on a bed of straw
      b.cyl(0.38, 0.4, 0.03, 0, 0.015, 0, H.straw, 'solid', 12);
      pumpkin(b, -0.05, 0.03, -0.05, 0.27);
      pumpkin(b, 0.26, 0.03, 0.25, 0.1, -0.5, false);
      break;
    }
    case 'palm': {
      // dark urn of dead earth, a gnarled leafless tree twisting up, a bat perched on the top
      b.cyl(0.2, 0.15, 0.42, 0, 0.21, 0, 0x2a2a2e, 'solid', 14).cyl(0.22, 0.22, 0.04, 0, 0.42, 0, 0x1e1e22, 'solid', 14).cyl(0.19, 0.19, 0.02, 0, 0.42, 0, H.soil, 'solid', 14);
      const bark = 0x3a2e24, trunk: THREE.Vector3[] = [];
      for (let k = 0; k <= 6; k++) trunk.push(v3(Math.sin(k * 1.3) * 0.05 * (k / 6), 0.42 + k * 0.2, Math.cos(k * 1.1) * 0.04 * (k / 6)));
      for (let k = 0; k < 6; k++) rod(b, trunk[k], trunk[k + 1], 0.05 - k * 0.006, bark, 7);
      for (const [k, yaw] of [[2, 0.6], [3, 2.8], [4, 4.6], [5, 1.6]] as [number, number][]) {
        const d = (a: number, l: number, up: number) => v3(Math.sin(a) * l, up, Math.cos(a) * l);
        const p0 = trunk[k], p1 = p0.clone().add(d(yaw, 0.2, 0.12)), p2 = p1.clone().add(d(yaw + 0.6, 0.17, 0.1));
        rod(b, p0, p1, 0.02, bark, 5); rod(b, p1, p2, 0.013, bark, 5);
        rod(b, p1, p1.clone().add(d(yaw - 0.8, 0.12, 0.06)), 0.009, bark, 4);
        rod(b, p2, p2.clone().add(d(yaw + 1.2, 0.08, 0.06)), 0.006, bark, 4);
      }
      bat(b, trunk[6].x, trunk[6].y + 0.06, trunk[6].z, 0.6, 0, 0.7);
      break;
    }
    case 'fern': {
      // one zombie hand clawing up out of a fresh mound, another's fingertips just breaking through
      dome(b, H.dirt, 0, 0, 0, 0.38, 0.16, 0.36);
      clods(b, 9, 0.4, 0.38, 0.03, 5);
      tufts(b, 8, 0.42, 0.4, 0, 17);
      hand(b, -0.04, 0.06, -0.06, 1.6, 0.2, 0.3);
      hand(b, 0.2, -0.36, 0.18, 1.1, -0.8, 0.3);
      break;
    }
    case 'cactus': {
      // a single grave: grassy mound, fresh dirt and a round-topped RIP headstone
      dome(b, H.grass, 0, 0, 0, 0.4, 0.1, 0.4);
      dome(b, H.dirt, 0, 0.02, 0.1, 0.17, 0.08, 0.25);
      headstone(b, 0, 0.02, -0.2, 0.72, false, 0.1, 0.06);
      tufts(b, 10, 0.4, 0.4, 0.02, 9);
      break;
    }
    case 'ficus': {
      // woven basket of skulls, a dripping candle on top of the pile
      b.cyl(0.24, 0.2, 0.34, 0, 0.17, 0, 0xa98a5a, 'solid', 16);
      for (let i = 0; i < 3; i++) b.cyl(0.242 - i * 0.01, 0.242 - i * 0.01, 0.02, 0, 0.06 + i * 0.1, 0, 0x7d6440, 'solid', 16);
      b.cyl(0.25, 0.25, 0.03, 0, 0.34, 0, 0x8a6e46, 'solid', 16).cyl(0.22, 0.22, 0.02, 0, 0.335, 0, H.soil, 'solid', 14);
      for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.4; skull(b, Math.sin(a) * 0.1, 0.33, Math.cos(a) * 0.1, 0.085, a, 0, (hash(k) - 0.5) * 0.3); }
      skull(b, 0, 0.47, 0.02, 0.09, 0.15);
      candle(b, 0.01, 0.645, 0.01, 0.1);
      break;
    }
    case 'cone': {
      // traffic cone in candy-corn stripes: yellow base, orange middle, white tip
      b.rbox(0.38, 0.035, 0.38, 0.03, 0, 0.018, 0, 0x151515);
      const r = (y: number) => 0.14 - ((y - 0.1) * 0.09) / 0.58;
      const band = (pts: [number, number][], c: number) => b.geo(new THREE.LatheGeometry(pts.map(([u, v]) => new THREE.Vector2(u, v)), 16), c, 0, 0, 0);
      band([[0.155, 0.035], [0.14, 0.1], [r(0.3), 0.3]], 0xf2c21a);
      band([[r(0.3), 0.3], [r(0.52), 0.52]], 0xf07a10);
      band([[r(0.52), 0.52], [0.05, 0.68], [0.03, 0.72], [0, 0.725]], 0xf6f2e6);
      break;
    }
    default: return false;
  }
  return true;
}

// ------------------------------------------------------------------ dressing on top of the normal model
/** Halloween dressing added to the normal model of a kind (no-op for kinds that keep their look). */
export function halloweenDecor(b: Builder, kind: string, W: number, D: number, w: number, h: number): void {
  switch (kind) {
    case 'desk': pumpkin(b, 0.25, 0.768, -0.22, 0.1, -0.3); candyBowl(b, -0.25, 0.768, -0.2, 0.09); break;
    case 'execdesk': witchHat(b, W / 2 - 0.4, 0.795, -0.12, 1, 0.5); pumpkin(b, -0.62, 0.795, 0.08, 0.11, 0.2); candle(b, 0.56, 0.795, 0.12); candle(b, 0.63, 0.795, 0.05, 0.09); break;
    case 'secdesk': pumpkin(b, W / 2 - 0.35, 0.9, -0.1, 0.1); pumpkin(b, -W / 2 + 0.62, 0.9, -0.12, 0.07, 0.4); candyBowl(b, -0.42, 0.9, -0.1, 0.08); break;
    case 'table': pumpkin(b, -0.72, 0.757, 0.12, 0.1, 0.3); candle(b, 0, 0.757, -0.16); candle(b, 0.07, 0.757, -0.1, 0.09); break;
    case 'boardtable': {
      // jack-o'-lanterns at both ends of the runner, a skull and a cluster of candles in the middle
      const along = W >= D, L = Math.max(W, D) - 0.15, X = (u: number, v: number): [number, number] => (along ? [u, v] : [v, u]), T = 0.784;
      for (const u of [-(L / 2 - 0.45), L / 2 - 0.45]) { const [x, z] = X(u, 0); pumpkin(b, x, T, z, 0.13); }
      for (const [du, dv, hh] of [[0, 0, 0.16], [0.07, 0.05, 0.12], [-0.06, 0.05, 0.1]]) { const [x, z] = X(du, dv); candle(b, x, T, z, hh); }
      { const [x, z] = X(0.32, 0); skull(b, x, T, z, 0.07, 0.3); }
      break;
    }
    case 'cubicle': {
      // a little pumpkin on every desk, a cobweb in the partition corner, a bat on the top rail
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const cx = (sx * W) / 4, cz = (sz * D) / 4, mz = cz - sz * (D / 4 - 0.14);
        pumpkin(b, cx - sx * 0.28, 0.755, mz + sz * 0.12, 0.065, sz > 0 ? 0 : Math.PI);
      }
      web(b, 0.04, 1.22, 0.04, 0.42, -Math.PI / 4, 1);
      bat(b, -W / 2 + 0.25, 1.28, 0, 0.45, 0.3, 0.9);
      break;
    }
    case 'counter': pumpkin(b, 0.3, 0.9, -0.12, 0.09); at(b, 0, 1.38, -0.452, 0, 1, () => bunting(b, W * 0.9, 0.06)); break;
    case 'sink': {
      const Wv = W * 0.92, n = Math.max(1, Math.round(Wv / 0.8));
      pumpkin(b, n > 1 ? 0 : -Wv / 2 + 0.12, 0.855, -0.06, 0.07);
      web(b, -Wv / 2 + 0.03, 1.84, -0.428, 0.28, 0, 1);
      break;
    }
    case 'reception': {
      // jack-o'-lanterns along the ledge, a cauldron of sweets in the middle, a glowing HAPPY HALLOWEEN banner behind
      const hw = W / 2, sag = 0.36, R = (hw * hw + sag * sag) / (2 * sag), cz = 0.5 - R, T = 1.075;
      const ledgeZ = (x: number) => cz + Math.sqrt((R - 0.17) ** 2 - x * x);
      for (const [x, r] of [[-0.95, 0.09], [-0.5, 0.11], [0.5, 0.11], [0.95, 0.09]]) pumpkin(b, x, T, ledgeZ(x), r, Math.atan2(x, ledgeZ(x) - cz));
      cauldron(b, 0, T, ledgeZ(0), 0.11);
      for (const sx of [-1, 1]) b.cyl(0.015, 0.015, 1.3, sx * 1.5, 1.41, -0.44, H.black, 'solid', 6);
      b.rbox(3.1, 0.34, 0.025, 0.01, 0, 1.92, -0.44, 0x2a1438);
      at(b, 0, 1.92, -0.425, 0, 1, () => text(b, 'HAPPY HALLOWEEN', 0.17, 0xff8a1a, 'emit'));
      at(b, 0, 1.7, -0.43, 0, 1, () => bunting(b, 2.96, 0.1));
      break;
    }
    case 'cabinet': pumpkin(b, -W * 0.2, 1.345, -0.05, 0.11); web(b, W * 0.42, 1.345, 0.27, 0.3, 0, -1); spider(b, 0.12, 1.33, 0.29, 0.5, 0.35); break;
    case 'locker': web(b, -W * 0.4, 1.9, 0.17, 0.3, 0, 1); hand(b, 0.15, 1.12, 0.14, 0.8, 0, 0, true, -Math.PI / 2); break; // skeleton hand out of the door
    case 'shelf': web(b, -W * 0.44 + 0.02, 1.98, 0.1, 0.36, 0, 1); web(b, W * 0.44 - 0.02, 1.845, 0.1, 0.26, 0, -1); spider(b, 0.1, 1.84, 0.13, 0.45, 0.3); break;
    case 'credenza': pumpkin(b, 0.1, 0.75, -0.38, 0.06); bat(b, -0.24, 1.2, -0.47, 0.3, 0, 0, 0.3); bat(b, 0.16, 1.4, -0.47, 0.24, 0, 0, -0.2); break;
    case 'tvwall': web(b, -0.86, 2.095, -0.39, 0.32, 0, 1); bat(b, 1.05, 1.95, -0.44, 0.35, 0, 0, 0.3); bat(b, -1.08, 1.4, -0.44, 0.3, 0, 0, -0.25); bat(b, 0.98, 1.3, -0.44, 0.25, 0, 0, 0.4); break;
    case 'crate': pumpkin(b, -0.08, 0.65, -0.05, 0.2, 0.25); pumpkin(b, 0.26, 0.65, 0.24, 0.08, -0.6, false); break;
    case 'barrel': {
      // toxic green slime welling over the lid and running down the sides (clear of the label)
      b.cyl(0.25, 0.25, 0.012, 0, 0.876, 0, H.slime, 'emit', 18);
      for (const a of [1.2, 2.5, 3.7, 4.9]) {
        const len = 0.12 + hash(a) * 0.28, x = Math.sin(a) * 0.29, z = Math.cos(a) * 0.29;
        b.box(0.04, len, 0.012, x, 0.87 - len / 2, z, H.slime, 'emit', a).sphere(0.024, x, 0.87 - len, z, H.slime, 'emit');
      }
      break;
    }
    case 'sandbags': sign(b, W * 0.22, 1.23, 0, -0.15, 0.55); pumpkin(b, -W * 0.28, 0.78, 0, 0.13); break;
    case 'barricade': sign(b, -W * 0.2, 0.62, 0.115, 0, 0, -0.12); pumpkin(b, W * 0.22, 0, 0.3, 0.12); break;
    case 'safe': googly(b, -0.17, 0.68, 0.232, 0.06, 0.6); googly(b, -0.02, 0.68, 0.232, 0.06, 2.2); web(b, -0.355, 0.84, 0.235, 0.22, 0, 1); break;
    case 'terminal': witchHat(b, 0, 1.385, -0.13, 0.8, 0.3); hand(b, -0.18, 1.025, 0.04, 0.7, 0.1, Math.PI / 2, true); break; // bony hand over the edge
    case 'fridge': {
      // the fridge monster: googly eyes on the freezer door and fangs along the door seam
      googly(b, -0.13, 1.52, 0.242, 0.085, 0.3); googly(b, 0.11, 1.52, 0.242, 0.085, 2.5);
      for (let i = 0; i < 6; i++) b.geo(new THREE.ConeGeometry(0.025, 0.07, 4), 0xf4f4ee, -0.3 + i * 0.12, 1.225, 0.25, Math.PI);
      break;
    }
    case 'vending': pumpkin(b, -0.2, 1.92, -0.1, 0.15); web(b, -0.445, 1.9, 0.38, 0.3, 0, 1); spider(b, 0.2, 1.66, 0.4, 0.4, 0.35); break;
    case 'toilet': ghost(b, 0, 0.37, -0.04, 0.75); break; // friendly ghost rising out of the bowl
    case 'shower': web(b, -0.41, 2.15, -0.41, 0.36, -Math.PI / 4, 1); bat(b, 0, 2.02, -0.18, 0.4, 0, 1.2, Math.PI); break;
    case 'booth': pumpkin(b, -0.4, 2.4, 0.3, 0.16); pumpkin(b, 0.35, 2.4, 0.35, 0.1, 0.3); bat(b, 0.3, 2.45, -0.3, 0.5, 0.4, 0.8); break;
    case 'car': pumpkin(b, 0, 1.35, 0, 0.22, h > w ? 0 : Math.PI / 2); break;
    // street kinds, in street.ts's frames: vehicles built along +x (width on z), tent W x D, floodlight
    case 'policecar':
      pumpkin(b, 0.28, 1.385, 0, 0.15, Math.PI / 2);
      for (const s of [-1, 1]) bat(b, -1.45, 0.66, s * 0.925, 0.4, s > 0 ? 0 : Math.PI, 0, 0.15, 0xff7a1a, true); // orange bat decals on the rear quarters
      break;
    case 'swatvan':
      pumpkin(b, -1.35, 2.33, 0, 0.2, Math.PI / 2);
      for (const s of [-1, 1]) bat(b, -1.4, 1.75, s * 0.988, 0.45, s > 0 ? 0 : Math.PI, 0, -0.15, 0xff7a1a, true);
      break;
    case 'tent': {
      // pennant bunting under the valance on three sides, jack-o'-lanterns by the front legs, sweets on the briefing table
      at(b, 0, 1.93, D / 2 + 0.01, 0, 1, () => bunting(b, W - 0.1, 0.1));
      for (const sx of [-1, 1]) at(b, sx * (W / 2 + 0.01), 1.93, 0, sx * Math.PI / 2, 1, () => bunting(b, D - 0.1, 0.08));
      for (const sx of [-1, 1]) pumpkin(b, sx * (W / 2 - 0.4), 0, D / 2 - 0.25, 0.16, sx * 0.3);
      candyBowl(b, -0.05, 0.76, -D / 2 + 0.72, 0.1);
      break;
    }
    case 'floodlight':
      for (const x of [-0.4, 0.4]) b.box(0.29, 0.21, 0.006, x, 4.437, 0.137, 0xff7a10, 'emit', 0, 0.5); // orange gels
      pumpkin(b, 0.3, 0.6, 0.12, 0.13);
      break;
  }
}
