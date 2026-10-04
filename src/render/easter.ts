import * as THREE from 'three';
import type { Builder } from './models';
import { at, rod, strip, text, dome, leaf, hash, v3 } from './halloween';
import { bow, mug } from './christmas';

/**
 * Easter models (currentHoliday() === 'easter'). Kinds never change: easterProp() rebuilds a kind outright (vehicles
 * become giant woven baskets, planters and pot plants become tulip beds, daffodils, egg trees, carrot patches and a
 * chicks' nest, cones become carrots), easterDecor() dresses the normal model (baskets, chocolate eggs and bunnies,
 * pastel bunting, egg garlands, bunny ears), easterTreat() is the street's scattered eggs, carrots, chicks and grass.
 * Also the street's drifting petals (Petals). Shared geometry helpers come from halloween.ts and christmas.ts.
 */
const E = {
  dark: 0x3e2212, milk: 0x7a4a28, white: 0xf2e8d2, foil: 0xd8b048, red: 0xc82a3a, wicker: 0xd0a868, wicker2: 0xb08848,
  stake: 0x8a6430, grass: 0x5c9a34, grass2: 0x467f2a, grass3: 0x7cb44a, stem: 0x4a8a34, soil: 0x3a2a1c, carrot: 0xf07a1a,
  carrot2: 0xd0601a, chick: 0xffd83a, chick2: 0xf4c428, beak: 0xf08a1a, eye: 0x16171a, ear: 0xf6f2f6, pink: 0xf6a8c0,
  twig: 0x6a4a2c, string: 0xe8e0d0,
};
const PASTEL = [0xf08ab0, 0x84bef0, 0xa6dc7c, 0xffe070, 0xbe96e8, 0xffaa78, 0x6cd4c0];
const TULIP = [0xf05a7a, 0xffd23a, 0xf4f0ec, 0xb07ad8, 0xff8a3a, 0xf6a8c4];
const FOIL = [0xd8b048, 0xc0c4cc, 0xd04a70, 0x3a7ad0, 0x4ab070];

// ------------------------------------------------------------------ pieces of the season
/** Painted egg, unit height 2 centred on the origin (k picks colours and pattern: bands, a zigzag pair or dots). */
function eggShape(b: Builder, k: number) {
  const c = PASTEL[k % 7], c2 = PASTEL[(k + 3) % 7], c3 = PASTEL[(k + 5) % 7];
  b.geo(new THREE.SphereGeometry(1, 12, 9), c, 0, 0, 0, 0, 0, 0, 'solid', 0.76, 1, 0.76);
  const ring = (y: number, col: number, t: number) => b.geo(new THREE.TorusGeometry(0.76 * Math.sqrt(1 - y * y) + 0.004, t, 4, 16), col, 0, y, 0, Math.PI / 2);
  if (k % 3 === 0) { ring(-0.32, c2, 0.07); ring(0.32, c2, 0.07); }
  else if (k % 3 === 1) { ring(0, c2, 0.1); ring(0.5, c3, 0.05); ring(-0.5, c3, 0.05); }
  else for (let i = 0; i < 6; i++) { const a = i * 1.047, y = i % 2 ? 0.25 : -0.2, r = 0.76 * Math.sqrt(1 - y * y); b.sphere(0.12, Math.cos(a) * r, y, Math.sin(a) * r, 0xfafaf4, 'solid', 0.6); }
}
/** Painted egg s high-radius (2s tall) resting on y; lie tilts it over (0 upright, ~1.5 on its side). */
export function egg(b: Builder, x: number, y: number, z: number, s: number, k: number, ry = 0, lie = 0) {
  at(b, x, y + s * (0.76 + 0.24 * Math.abs(Math.cos(lie))), z, ry, s, () => eggShape(b, k), 0, lie);
}
/** Foil-wrapped chocolate egg lying on y (about 2s long). */
function chocEgg(b: Builder, x: number, y: number, z: number, s: number, k: number, ry = 0) {
  b.geo(new THREE.SphereGeometry(s, 10, 7), FOIL[k % FOIL.length], x, y + s * 0.74, z, 0, ry, Math.PI / 2, 'solid', 0.74, 1, 0.74);
}
/** Sitting chocolate bunny facing +z (about 1.2 tall before scaling); foil = gold wrapper with a red ribbon and bell. */
export function chocBunny(b: Builder, x: number, y: number, z: number, s: number, ry = 0, foil = false, col = E.milk) {
  const c = foil ? E.foil : col;
  at(b, x, y, z, ry, s, () => {
    b.geo(new THREE.SphereGeometry(0.3, 12, 9), c, 0, 0.31, -0.02, 0, 0, 0, 'solid', 1, 1.1, 0.95); // body
    for (const sx of [-1, 1]) {
      b.geo(new THREE.SphereGeometry(0.1, 8, 6), c, sx * 0.13, 0.06, 0.2, 0, 0, 0, 'solid', 0.9, 0.6, 1.4); // feet
      b.geo(new THREE.SphereGeometry(0.07, 8, 6), c, sx * 0.088, 1.0, 0, 0, 0, -sx * 0.18, 'solid', 0.9, 3.2, 0.5); // ears
      b.sphere(0.022, sx * 0.075, 0.79, 0.2, foil ? 0x3a2414 : E.white); // eyes (piped icing on chocolate)
    }
    b.sphere(0.19, 0, 0.72, 0.04, c).geo(new THREE.SphereGeometry(0.09, 8, 6), c, 0, 0.67, 0.18, 0, 0, 0, 'solid', 1, 0.8, 0.8); // head, muzzle
    b.sphere(0.08, 0, 0.22, -0.3, c); // tail
    if (foil) { b.geo(new THREE.TorusGeometry(0.15, 0.025, 4, 14), E.red, 0, 0.53, 0.02, Math.PI / 2); b.sphere(0.035, 0, 0.49, 0.17, 0xf0d060); }
  });
}
/** Fluffy yellow chick facing +z (about 0.3 tall before scaling). */
export function chick(b: Builder, x: number, y: number, z: number, s: number, ry = 0) {
  at(b, x, y, z, ry, s, () => {
    b.geo(new THREE.SphereGeometry(0.1, 10, 8), E.chick, 0, 0.1, 0, 0, 0, 0, 'solid', 1, 0.92, 1.08);
    b.sphere(0.068, 0, 0.215, 0.045, E.chick);
    b.geo(new THREE.ConeGeometry(0.018, 0.045, 6), E.beak, 0, 0.21, 0.12, Math.PI / 2);
    b.geo(new THREE.ConeGeometry(0.012, 0.045, 4), E.chick, 0, 0.29, 0.04, -0.3); // tuft
    for (const sx of [-1, 1]) {
      b.sphere(0.011, sx * 0.032, 0.235, 0.1, E.eye);
      b.geo(new THREE.SphereGeometry(0.05, 6, 5), E.chick2, sx * 0.09, 0.11, -0.01, 0, 0, sx * 0.4, 'solid', 0.45, 0.8, 1.1); // wings
      b.box(0.03, 0.008, 0.05, sx * 0.04, 0.004, 0.06, E.beak);
    }
  });
}
/** Carrot lying on y along +x (about 0.3 long before scaling), or planted: just its crown and leaves showing. */
export function carrot(b: Builder, x: number, y: number, z: number, s: number, ry = 0, planted = false) {
  at(b, x, y + (planted ? 0 : 0.035 * s), z, ry, s, () => {
    if (planted) b.cyl(0.035, 0.035, 0.03, 0, 0.01, 0, E.carrot, 'solid', 8);
    else {
      b.geo(new THREE.ConeGeometry(0.035, 0.26, 8), E.carrot, 0, -0.13, 0, Math.PI);
      for (const y0 of [-0.06, -0.13]) b.geo(new THREE.TorusGeometry(0.035 * (1 + y0 / 0.26), 0.004, 3, 10), E.carrot2, 0, y0, 0, Math.PI / 2);
    }
    for (let k = 0; k < 4; k++) leaf(b, 0.15, 0.035, 0, 0.01, 0, k * 1.57 + 0.4, 1.05, k % 2 ? E.stem : E.grass2);
  }, 0, planted ? 0 : Math.PI / 2);
}
/** Grass blades over a little ellipse (radii rx, rz) on y. */
function tufts(b: Builder, x: number, y: number, z: number, n: number, rx: number, rz: number, seed: number, h = 0.12) {
  for (let i = 0; i < n; i++) {
    const a = hash(seed + i) * 6.283, r = Math.sqrt(hash(seed + i * 3));
    b.geo(new THREE.ConeGeometry(0.014, h * (0.7 + hash(seed + i * 7) * 0.6), 3), [E.grass, E.grass2, E.grass3][i % 3], x + Math.cos(a) * rx * r, y + h * 0.4, z + Math.sin(a) * rz * r, Math.sin(a) * 0.35, a, -Math.cos(a) * 0.35);
  }
}
/** Tulip standing on y, h tall, cup of colour c. */
function tulip(b: Builder, x: number, y: number, z: number, h: number, c: number, seed: number) {
  const tx = x + (hash(seed) - 0.5) * h * 0.25, tz = z + (hash(seed + 1) - 0.5) * h * 0.25;
  rod(b, v3(x, y, z), v3(tx, y + h, tz), 0.008, E.stem, 4);
  b.geo(new THREE.SphereGeometry(0.042, 8, 5, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.68), c, tx, y + h + 0.042, tz, 0, seed, 0, 'solid', 1, 1.35, 1);
  for (const k of [0, 1]) leaf(b, h * 0.5, 0.045, x, y, z, seed + k * 3.1, 1.2, E.grass2);
}
/** Daffodil standing on y, h tall: pale petals round an orange-yellow trumpet. */
function daffodil(b: Builder, x: number, y: number, z: number, h: number, seed: number) {
  rod(b, v3(x, y, z), v3(x, y + h, z), 0.007, E.stem, 4);
  for (let k = 0; k < 6; k++) leaf(b, 0.05, 0.03, x, y + h, z, k * 1.047 + seed, 0.25, 0xfff2a0);
  b.cyl(0.02, 0.014, 0.04, x, y + h + 0.02, z, 0xf8b820, 'solid', 8);
  leaf(b, h * 0.6, 0.03, x, y, z, seed, 1.25, E.stem);
}
/** A low clump of little white daisies on y. */
function daisies(b: Builder, x: number, y: number, z: number, n: number, r: number, seed: number) {
  for (let i = 0; i < n; i++) {
    const a = hash(seed + i) * 6.283, d = r * Math.sqrt(hash(seed + i * 5)), px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, py = y + 0.04 + hash(i + seed) * 0.03;
    for (let k = 0; k < 5; k++) leaf(b, 0.025, 0.014, px, py, pz, k * 1.257 + i, 0.15, 0xfafaf4);
    b.sphere(0.008, px, py + 0.004, pz, 0xf8d020);
  }
  tufts(b, x, y, z, n * 2, r, r, seed + 9, 0.08);
}
/** Bare twiggy branches standing on y, h tall, with pussy-willow buds and painted eggs hanging off the tips. */
function eggTree(b: Builder, x: number, y: number, z: number, h: number, seed = 0) {
  const top = v3(x, y + h * 0.45, z);
  rod(b, v3(x, y, z), top, 0.022 * h, E.twig, 5);
  for (let k = 0; k < 7; k++) {
    const a = k * 0.898 + seed, r = h * (0.18 + hash(k + seed) * 0.16), tip = v3(x + Math.cos(a) * r, y + h * (0.62 + hash(k * 3 + seed) * 0.38), z + Math.sin(a) * r);
    rod(b, top, tip, 0.008 * h, E.twig, 4);
    for (let j = 1; j <= 2; j++) b.sphere(0.012 * h, top.x + (tip.x - top.x) * j / 3, top.y + (tip.y - top.y) * j / 3, top.z + (tip.z - top.z) * j / 3, 0xe8e4dc, 'solid', 1.4);
    const s = 0.04 * h, hang = 0.05 * h;
    b.box(0.004, hang, 0.004, tip.x, tip.y - hang / 2, tip.z, E.string);
    egg(b, tip.x, tip.y - hang - 2 * s, tip.z, s, k + seed, a);
  }
}
/** Pastel pennants along x from -len/2 to len/2, hanging from y = 0. */
export function bunting(b: Builder, len: number, sag = 0.08) {
  const n = Math.max(3, Math.round(len / 0.17)), pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) { const u = -1 + (2 * i) / n; pts.push(v3((u * len) / 2, -sag * (1 - u * u), 0)); }
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[i + 1];
    strip(b, a.x, a.y, c.x, c.y, 0.006, E.string, 'solid', 0.006);
    b.geo(new THREE.CircleGeometry(0.07, 3), PASTEL[i % PASTEL.length], (a.x + c.x) / 2, (a.y + c.y) / 2 - 0.035, 0, 0, 0, -Math.PI / 2);
  }
}
/** String of little painted eggs along x from -len/2 to len/2, hanging from y = 0. */
function eggGarland(b: Builder, len: number, sag = 0.06) {
  const n = Math.max(3, Math.round(len / 0.16)), pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) { const u = -1 + (2 * i) / n; pts.push(v3((u * len) / 2, -sag * (1 - u * u), 0)); }
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[i + 1];
    strip(b, a.x, a.y, c.x, c.y, 0.005, E.string, 'solid', 0.005);
    egg(b, (a.x + c.x) / 2, (a.y + c.y) / 2 - 0.075, 0, 0.032, i, i);
  }
}
/** Bunny-ear headband standing on y (ends on the surface), facing +z. */
function bunnyEars(b: Builder, x: number, y: number, z: number, s: number, ry = 0) {
  at(b, x, y, z, ry, s, () => {
    b.geo(new THREE.TorusGeometry(0.11, 0.012, 4, 14, Math.PI), E.ear, 0, 0, 0);
    for (const sx of [-1, 1]) {
      b.geo(new THREE.SphereGeometry(0.05, 8, 6), E.ear, sx * 0.088, 0.24, 0, 0, 0, -sx * 0.22, 'solid', 1, 3, 0.4);
      b.geo(new THREE.SphereGeometry(0.032, 8, 6), E.pink, sx * 0.088, 0.235, 0.017, 0, 0, -sx * 0.22, 'solid', 1, 2.8, 0.3);
    }
  });
}
/** Little woven basket on y (radius r) of shredded grass and painted eggs, with a handle. */
function basket(b: Builder, x: number, y: number, z: number, r: number, k = 0) {
  at(b, x, y, z, hash(x * 3 + z) * 3, r, () => {
    b.cyl(1, 0.8, 0.8, 0, 0.4, 0, E.wicker, 'solid', 14);
    for (let i = 0; i < 3; i++) { const yy = 0.14 + i * 0.26; b.geo(new THREE.TorusGeometry(0.8 + 0.2 * (yy / 0.8) + 0.01, 0.05, 3, 14), i % 2 ? E.stake : E.wicker2, 0, yy, 0, Math.PI / 2); }
    dome(b, E.grass, 0, 0.76, 0, 0.95, 0.22, 0.95);
    for (let i = 0; i < 3; i++) egg(b, Math.cos(i * 2.1) * 0.42, 0.8, Math.sin(i * 2.1) * 0.42, 0.3, k + i, i, 0.5);
    b.geo(new THREE.TorusGeometry(0.92, 0.06, 4, 14, Math.PI), E.wicker2, 0, 0.8, 0);
  });
}
/** Twig nest on y (radius r) with eggs and chicks. */
function nest(b: Builder, x: number, y: number, z: number, r: number) {
  at(b, x, y, z, 0, r, () => {
    for (let i = 0; i < 3; i++) b.geo(new THREE.TorusGeometry(0.8 - i * 0.05, 0.22, 5, 16), i % 2 ? E.twig : 0x8a6a40, 0, 0.18 + i * 0.07, 0, Math.PI / 2, 0, i * 0.4);
    dome(b, 0x5a4024, 0, 0.12, 0, 0.75, 0.12, 0.75);
    egg(b, 0.3, 0.2, -0.2, 0.2, 2, 0.4, 1.3); egg(b, -0.1, 0.2, 0.35, 0.2, 4, 1.2, 1.4);
    chick(b, -0.25, 0.18, -0.1, 1.6, 0.4); chick(b, 0.2, 0.18, 0.2, 1.4, -0.3);
  });
}
/** Plant pot (radius r, height h) with a soil or grass top. */
function pot(b: Builder, r: number, h: number, color: number, top = E.soil) {
  b.cyl(r, r * 0.78, h, 0, h / 2, 0, color, 'solid', 14).cyl(r * 1.06, r * 1.06, 0.035, 0, h, 0, color, 'solid', 14).cyl(r * 0.94, r * 0.94, 0.01, 0, h + 0.012, 0, top, 'solid', 14);
}
/** Tube through the given points. */
function tube(b: Builder, pts: THREE.Vector3[], r: number, color: number, closed: boolean, seg: number) {
  b.geo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), seg, r, 4, closed), color, 0, 0, 0);
}

// ------------------------------------------------------------------ baskets
/**
 * Giant woven Easter basket along +x, L long and Wd wide: an elliptical wicker tub (rows woven over and under the
 * stakes, one row a ribbon), a braided rim, a handle arch across the middle, shredded grass heaped with painted eggs and
 * a chocolate bunny. policecar: POLICE tag and a light bar on the handle top (the strobing lenses are FloorView meshes
 * at roof height); swatvan: bigger, dark-stained, SWAT tag and a taller handle.
 */
function giantBasket(b: Builder, L: number, Wd: number, kind: string) {
  const swat = kind === 'swatvan', police = kind === 'policecar';
  const a = L / 2 - 0.06, c = Wd / 2 - 0.06, H = swat ? 1.15 : 0.8;
  const [w1, w2, stake] = swat ? [0x6a4a2a, 0x523820, 0x2e2010] : [E.wicker, E.wicker2, E.stake];
  const ribbon = swat ? 0x23345a : police ? 0x8ec4f0 : 0xf4a0c0;
  const f = (y: number) => 0.84 + 0.16 * (y / H); // the tub flares toward the rim
  const ell = (t: number, y: number, d = 0) => v3(Math.cos(t) * (a * f(y) + d), y, Math.sin(t) * (c * f(y) + d));
  const NS = 32; // stakes; rows weave over and under them
  b.geo(new THREE.CylinderGeometry(1, 0.84, 1, 32), stake, 0, H / 2, 0, 0, 0, 0, 'solid', a * 0.97, H, c * 0.97); // core, dark between the rows
  for (let j = 0; j < NS; j++) { const t = (j / NS) * Math.PI * 2; rod(b, ell(t, 0.02, 0.01), ell(t, H + 0.02, 0.01), 0.022, stake, 4); }
  const rows = Math.round(H / 0.1), mid = rows >> 1;
  for (let i = 0; i < rows; i++) {
    const y = 0.07 + (i * (H - 0.12)) / (rows - 1), pts: THREE.Vector3[] = [];
    for (let k = 0; k < 96; k++) { const t = (k / 96) * Math.PI * 2; pts.push(ell(t, y, 0.03 + 0.018 * Math.sin(t * (NS / 2) + i * Math.PI))); }
    tube(b, pts, i === mid ? 0.04 : 0.048, i === mid ? ribbon : i % 2 ? w2 : w1, true, 160);
  }
  for (const ph of [0, Math.PI]) { // braided rim
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < 96; k++) { const t = (k / 96) * Math.PI * 2, q = t * 24 + ph; pts.push(ell(t, H + 0.03 + 0.03 * Math.sin(q), 0.03 + 0.03 * Math.cos(q))); }
    tube(b, pts, 0.042, ph ? w2 : w1, true, 192);
  }
  // shredded grass heaped in the top, painted eggs and a chocolate bunny in it
  const gx = a * f(H) * 0.96, gz = c * f(H) * 0.96, gh = swat ? 0.26 : 0.22, gy = H - 0.04;
  const top = (u: number, v: number) => gy + gh * Math.sqrt(Math.max(0, 1 - u * u - v * v));
  dome(b, E.grass, 0, gy, 0, gx, gh, gz);
  for (let i = 0; i < 110; i++) {
    const u = hash(i) * 2 - 1, v = hash(i + 50) * 2 - 1;
    if (u * u + v * v > 0.92) continue;
    b.box(0.014, 0.01, 0.22, u * gx, top(u, v), v * gz, [E.grass, E.grass2, E.grass3, 0xf6c8d8, 0xfff0a0][i % 5], 'solid', hash(i + 7) * 3.14, (hash(i + 9) - 0.5) * 0.8, (hash(i + 11) - 0.5) * 0.8);
  }
  const bu = -0.55;
  for (let k = 0; k < (swat ? 16 : 12); k++) {
    const u = (-0.9 + 1.8 * hash(k * 3 + 1)) * 0.85, v = (hash(k * 5 + 2) * 2 - 1) * 0.6;
    if (Math.abs(u - bu) < 0.25 && Math.abs(v) < 0.4) continue; // the bunny's spot
    const s = (swat ? 0.19 : 0.16) * (0.85 + 0.3 * hash(k));
    egg(b, u * gx, top(u, v) - s * 0.5, v * gz, s, k, hash(k + 4) * 6, 0.3 + hash(k + 6) * 1.1);
  }
  chocBunny(b, bu * gx, top(bu, 0) - 0.1, 0, swat ? 0.95 : 0.75, 0.5, kind === 'car', swat ? E.dark : E.milk);
  // handle arch across the middle (light bar on top for the police), bows where it meets the rim
  const apex = swat ? 2.28 : police ? 1.38 : 1.55, R = c * 0.9, cy = apex - R, arc: THREE.Vector3[] = [];
  for (let k = 0; k <= 24; k++) { const th = (Math.PI * k) / 24; arc.push(v3(0, cy + R * Math.sin(th), R * Math.cos(th))); }
  tube(b, arc, 0.07, w1, false, 48);
  const wrap: THREE.Vector3[] = [];
  for (let k = 0; k <= 160; k++) { const th = (Math.PI * k) / 160, ph = th * 28, n = v3(0, Math.sin(th), Math.cos(th)); wrap.push(v3(0.07 * Math.cos(ph), cy + R * Math.sin(th), R * Math.cos(th)).addScaledVector(n, 0.07 * Math.sin(ph))); }
  tube(b, wrap, 0.02, ribbon, false, 320);
  if (cy > H - 0.15) for (const s of [-1, 1]) rod(b, v3(0, H - 0.15, s * R), v3(0, cy + 0.01, s * R), 0.055, w1, 8);
  for (const s of [-1, 1]) bow(b, 0, Math.max(H, cy) + 0.06, s * (R + 0.06), 0.38, ribbon, s > 0 ? 0 : Math.PI);
  if (!police && !swat) bow(b, 0, apex - 0.02, 0, 0.42, ribbon, Math.PI / 2);
  if (police) b.rbox(0.3, 0.08, 0.95, 0.03, 0, apex + 0.04, 0, 0x16171a);
  if (swat) b.rbox(0.34, 0.09, 1.0, 0.03, 0, apex + 0.05, 0, 0x0c0c0d);
  if (police || swat) for (const s of [-1, 1]) {
    // gift tag on both long sides
    const y = H * 0.42;
    at(b, 0, y, s * (c * f(y) + 0.085), s > 0 ? 0 : Math.PI, 1, () => {
      b.rbox(swat ? 0.95 : 1.15, swat ? 0.32 : 0.27, 0.03, 0.03, 0, 0, -0.015, swat ? 0x16171a : 0xf6f4ee);
      at(b, 0, 0, 0.006, 0, 1, () => text(b, swat ? 'SWAT' : 'POLICE', swat ? 0.2 : 0.15, swat ? 0xd8a830 : 0x10244a));
    });
  }
}

// ------------------------------------------------------------------ replaced models
/** Easter replacement for a kind. True = built here (the normal model is skipped). */
export function easterProp(b: Builder, kind: string, W: number, D: number, _w: number, _h: number): boolean {
  const pw = Math.min(W * 0.92, 2.6), pd = Math.min(D * 0.92, 0.9); // planter box size, as models.ts planter()
  switch (kind) {
    case 'car': case 'policecar': case 'swatvan': {
      const vert = D > W;
      at(b, 0, 0, 0, vert ? Math.PI / 2 : 0, 1, () => giantBasket(b, Math.max(W, D) - 0.1, Math.min(W, D) - 0.05, kind));
      break;
    }
    case 'planter': {
      // charcoal trough of fresh grass and tulips in two staggered rows
      const Hh = 0.5, n = Math.max(2, Math.round(pw / 0.16));
      b.rbox(pw, Hh, pd, 0.03, 0, Hh / 2, 0, 0x3a3b3e).rbox(pw + 0.04, 0.04, pd + 0.04, 0.015, 0, Hh, 0, 0x2a2b2e);
      b.rbox(pw - 0.04, 0.03, pd - 0.04, 0.01, 0, Hh, 0, E.grass2);
      tufts(b, 0, Hh, 0, Math.round(pw * 30), pw / 2 - 0.04, pd / 2 - 0.04, 3);
      for (let k = 0; k < n; k++) for (const r of [-1, 1]) tulip(b, -pw / 2 + (k + (r > 0 ? 0.25 : 0.75)) * (pw / n), Hh, r * pd * 0.18, 0.32 + hash(k + r) * 0.12, TULIP[(k * 2 + (r > 0 ? 1 : 0)) % TULIP.length], k * 2 + r);
      break;
    }
    case 'planter_grass': {
      // corten box of daffodils and daisies, a couple of eggs hidden in the grass
      const Hh = 0.4, n = Math.max(1, Math.floor(pw / 0.2));
      b.rbox(pw, Hh, pd, 0.008, 0, Hh / 2, 0, 0x8a4a22).rbox(pw + 0.02, 0.02, pd + 0.02, 0.004, 0, Hh, 0, 0x6a3a1a);
      b.rbox(pw - 0.04, 0.02, pd - 0.04, 0.005, 0, Hh - 0.005, 0, E.grass2);
      for (let k = 0; k < n; k++) daffodil(b, -pw / 2 + (k + 0.5) * (pw / n), Hh, (hash(k) - 0.5) * pd * 0.5, 0.3 + hash(k + 2) * 0.1, k);
      daisies(b, -pw * 0.2, Hh, pd * 0.15, 6, Math.min(0.2, pw * 0.15), 4); daisies(b, pw * 0.25, Hh, -pd * 0.12, 5, Math.min(0.18, pw * 0.12), 8);
      egg(b, pw * 0.1, Hh - 0.01, pd * 0.2, 0.05, 1, 0.3, 1.3); egg(b, -pw * 0.35, Hh - 0.01, -pd * 0.2, 0.045, 3, 1, 1.1);
      break;
    }
    case 'planter_topiary': {
      // timber trough of shredded grass heaped with painted eggs, pastel bunting along the front
      const Hh = 0.26;
      for (let k = 0; k < 3; k++) b.rbox(pw, 0.085, pd, 0.008, 0, 0.045 + k * 0.088, 0, k % 2 ? 0x6a4a2c : 0x5a3e24);
      b.rbox(pw - 0.04, 0.02, pd - 0.04, 0.005, 0, Hh, 0, E.grass);
      tufts(b, 0, Hh, 0, Math.round(pw * 24), pw / 2 - 0.05, pd / 2 - 0.05, 7, 0.08);
      const n = Math.max(3, Math.round(pw / 0.14));
      for (let k = 0; k < n; k++) egg(b, -pw / 2 + (k + 0.5) * (pw / n), Hh, (hash(k + 3) - 0.5) * pd * 0.5, 0.06 + hash(k) * 0.02, k, hash(k + 4) * 6, hash(k + 5) * 1.4);
      at(b, 0, Hh + 0.02, pd / 2 + 0.01, 0, 1, () => bunting(b, pw - 0.06, 0.06));
      break;
    }
    case 'planter_flowers': {
      // low concrete kerb round a carrot patch: rows of carrot tops, one pulled and lying on the soil, a chick
      const Hh = 0.14;
      b.rbox(pw, Hh, pd, 0.015, 0, Hh / 2, 0, 0x5e5e5a);
      b.rbox(pw - 0.06, 0.02, pd - 0.06, 0.008, 0, Hh, 0, E.soil);
      const n = Math.max(2, Math.round(pw / 0.2));
      for (let k = 0; k < n; k++) for (const z of [-pd * 0.22, pd * 0.22]) if (!(k === 1 && z > 0)) carrot(b, -pw / 2 + (k + 0.5) * (pw / n), Hh + 0.01, z, 1.1, k + z, true);
      carrot(b, -pw / 2 + 1.5 * (pw / n), Hh + 0.012, pd * 0.12, 1.3, 0.5);
      chick(b, pw * 0.3, Hh + 0.01, 0, 1.1, -0.4);
      break;
    }
    case 'planter_bamboo': {
      // glossy black planter of grass with egg trees growing in it
      const Hh = 0.4, n = Math.max(1, Math.min(4, Math.floor(pw / 0.6)));
      b.rbox(pw, Hh, pd, 0.02, 0, Hh / 2, 0, 0x121316).rbox(pw + 0.02, 0.02, pd + 0.02, 0.006, 0, Hh, 0, 0x2a2c30);
      b.rbox(pw - 0.04, 0.02, pd - 0.04, 0.005, 0, Hh, 0, E.grass2);
      tufts(b, 0, Hh, 0, Math.round(pw * 24), pw / 2 - 0.04, pd / 2 - 0.04, 11);
      for (let k = 0; k < n; k++) eggTree(b, -pw / 2 + (k + 0.5) * (pw / n), Hh, 0, 1.1 + hash(k + 2) * 0.3, k * 2);
      break;
    }
    case 'plant': {
      // small egg tree in a pastel pot, a basket of eggs at its foot
      at(b, -0.05, 0, -0.05, 0, 1, () => pot(b, 0.17, 0.26, PASTEL[0], E.grass2));
      eggTree(b, -0.05, 0.27, -0.05, 0.8, 1);
      basket(b, 0.27, 0, 0.22, 0.11, 2);
      break;
    }
    case 'palm': {
      // tall egg tree in a pastel pot, eggs and a chick in the grass round it
      at(b, 0, 0, 0, 0, 1, () => pot(b, 0.2, 0.36, PASTEL[1], E.grass2));
      eggTree(b, 0, 0.37, 0, 1.6, 3);
      egg(b, 0.24, 0, 0.22, 0.07, 1, 0.4, 1.3); egg(b, 0.32, 0, 0.0, 0.06, 5, 1.1, 1.2); chick(b, 0.12, 0, 0.3, 0.9, 0.5);
      break;
    }
    case 'fern': {
      // potted tulips with a pastel ribbon round the pot
      at(b, 0, 0, 0, 0, 1, () => pot(b, 0.17, 0.28, 0xf4f0ea));
      b.cyl(0.165, 0.16, 0.05, 0, 0.17, 0, PASTEL[4], 'solid', 14);
      for (let k = 0; k < 7; k++) { const a = k * 2.4, r = k ? 0.09 : 0; tulip(b, Math.cos(a) * r, 0.29, Math.sin(a) * r, 0.3 + hash(k) * 0.1, TULIP[k % TULIP.length], k + 5); }
      bow(b, 0, 0.13, 0.17, 0.1, PASTEL[4]);
      break;
    }
    case 'cactus': {
      // daffodils in a terracotta pot
      at(b, 0, 0, 0, 0, 1, () => pot(b, 0.18, 0.3, 0xb05a32));
      for (let k = 0; k < 6; k++) { const a = k * 2.4, r = k ? 0.1 : 0; daffodil(b, Math.cos(a) * r, 0.31, Math.sin(a) * r, 0.34 + hash(k) * 0.12, k); }
      tufts(b, 0, 0.31, 0, 14, 0.14, 0.14, 2, 0.1);
      break;
    }
    case 'ficus': {
      // woven basket with a nest of chicks and eggs in it
      b.cyl(0.24, 0.2, 0.34, 0, 0.17, 0, E.wicker, 'solid', 16);
      for (let i = 0; i < 3; i++) b.cyl(0.242 - i * 0.01, 0.242 - i * 0.01, 0.02, 0, 0.06 + i * 0.1, 0, E.wicker2, 'solid', 16);
      dome(b, E.grass, 0, 0.33, 0, 0.23, 0.06, 0.23);
      nest(b, 0, 0.36, 0, 0.24);
      bow(b, 0, 0.2, 0.245, 0.14, PASTEL[0]);
      break;
    }
    case 'cone': {
      // traffic cone grown into a carrot: ridged orange root, one white reflective band, leafy top
      b.rbox(0.38, 0.035, 0.38, 0.03, 0, 0.018, 0, 0x151515);
      const r = (y: number) => 0.15 - ((y - 0.04) * 0.12) / 0.64;
      b.geo(new THREE.LatheGeometry([[0.155, 0.035], [0.15, 0.06], [r(0.36) + 0.01, 0.36], [r(0.6), 0.6], [0.02, 0.68], [0, 0.69]].map(([u, v]) => new THREE.Vector2(u, v)), 14), E.carrot, 0, 0, 0);
      for (const y of [0.16, 0.27, 0.48, 0.57]) b.geo(new THREE.TorusGeometry(r(y) + 0.008, 0.006, 3, 14), E.carrot2, 0, y, 0, Math.PI / 2, 0, (hash(y) - 0.5) * 0.15);
      b.geo(new THREE.CylinderGeometry(r(0.42) + 0.006, r(0.36) + 0.006, 0.06, 14, 1, true), 0xf4f4ee, 0, 0.39, 0);
      for (let k = 0; k < 5; k++) leaf(b, 0.2, 0.05, 0, 0.66, 0, k * 1.257, 1.15, k % 2 ? E.stem : E.grass2);
      break;
    }
    default: return false;
  }
  return true;
}

// ------------------------------------------------------------------ dressing on top of the normal model
/** Easter dressing added to the normal model of a kind (no-op for kinds that keep their look). */
export function easterDecor(b: Builder, kind: string, W: number, D: number, _w: number, _h: number): void {
  switch (kind) {
    case 'desk': mug(b, 0.3, 0.768, -0.2, PASTEL[1]); basket(b, -0.28, 0.768, -0.22, 0.09, 0); chocEgg(b, 0.05, 0.768, -0.3, 0.03, 0, 0.4); chocEgg(b, 0.12, 0.768, -0.26, 0.026, 2, -0.3); break;
    case 'execdesk': chocBunny(b, -0.62, 0.795, 0.02, 0.17, 0.3, true); mug(b, 0.56, 0.795, 0.12, PASTEL[0]); chocEgg(b, 0.75, 0.795, -0.1, 0.03, 3, 0.2); chocEgg(b, 0.68, 0.795, -0.16, 0.026, 1); break;
    case 'secdesk': basket(b, W / 2 - 0.35, 0.9, -0.1, 0.1, 3); mug(b, -W / 2 + 0.62, 0.9, -0.12, PASTEL[2]); chocBunny(b, -0.42, 0.9, -0.1, 0.13, 0.4); break;
    case 'table': mug(b, -0.72, 0.757, 0.12, PASTEL[3]); mug(b, -0.58, 0.757, 0.22, PASTEL[1]); basket(b, 0, 0.757, -0.16, 0.1, 1); chocEgg(b, 0.14, 0.757, 0.15, 0.03, 4, 1.2); chocEgg(b, 0.22, 0.757, 0.1, 0.028, 0); break;
    case 'boardtable': {
      // chocolate bunnies at both ends of the runner, a basket of eggs in the middle, mugs
      const along = W >= D, L = Math.max(W, D) - 0.15, P = (u: number, v: number): [number, number] => (along ? [u, v] : [v, u]), T = 0.784;
      for (const u of [-(L / 2 - 0.45), L / 2 - 0.45]) { const [x, z] = P(u, 0); chocBunny(b, x, T, z, 0.2, u > 0 ? -0.6 : 0.6, u > 0); }
      { const [x, z] = P(0, 0); basket(b, x, T, z, 0.14, 2); }
      for (const [du, dv] of [[0.6, 0.25], [-0.7, -0.2]]) { const [x, z] = P(du, dv); mug(b, x, T, z, du > 0 ? PASTEL[0] : PASTEL[2]); }
      break;
    }
    case 'cubicle': {
      // a foil egg on every desk, egg garlands along both partition rails
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const cx = (sx * W) / 4, cz = (sz * D) / 4, mz = cz - sz * (D / 4 - 0.14);
        chocEgg(b, cx - sx * 0.28, 0.755, mz + sz * 0.12, 0.035, sx + sz + 2, sx);
      }
      at(b, 0, 1.23, 0.04, 0, 1, () => eggGarland(b, W - 0.1, 0.05));
      at(b, 0.04, 1.23, 0, Math.PI / 2, 1, () => eggGarland(b, D - 0.1, 0.05));
      break;
    }
    case 'counter': mug(b, 0.3, 0.9, -0.12, PASTEL[5]); chocBunny(b, 0.5, 0.9, -0.1, 0.14, -0.3); at(b, 0, 1.38, -0.44, 0, 1, () => eggGarland(b, W * 0.9, 0.06)); break;
    case 'sink': { const Wv = W * 0.92; at(b, 0, 1.86, -0.42, 0, 1, () => eggGarland(b, Wv * 0.9, 0.05)); break; }
    case 'reception': {
      // chicks and a basket of eggs along the ledge, a HAPPY EASTER banner with pastel bunting below
      const hw = W / 2, sag = 0.36, R = (hw * hw + sag * sag) / (2 * sag), cz = 0.5 - R, T = 1.075;
      const ledgeZ = (x: number) => cz + Math.sqrt((R - 0.17) ** 2 - x * x);
      for (const x of [-0.95, 0.95]) chick(b, x, T, ledgeZ(x), 0.8, -x * 0.3);
      basket(b, 0, T, ledgeZ(0), 0.15, 1);
      for (const x of [-0.5, 0.5]) chocBunny(b, x, T, ledgeZ(x), 0.16, -x * 0.5, x > 0);
      for (const sx of [-1, 1]) b.cyl(0.015, 0.015, 1.3, sx * 1.5, 1.41, -0.44, 0xe8e0d0, 'solid', 6);
      b.rbox(3.1, 0.34, 0.025, 0.01, 0, 1.92, -0.44, 0x9a6ad0);
      at(b, 0, 1.92, -0.425, 0, 1, () => text(b, 'HAPPY EASTER', 0.17, 0xfff0a0, 'emit'));
      at(b, 0, 1.74, -0.41, 0, 1, () => bunting(b, 2.96, 0.12));
      break;
    }
    case 'cabinet':
      eggTree(b, -W * 0.2, 1.345, -0.05, 0.42, 2);
      at(b, 0, 1.33, 0.27, 0, 1, () => eggGarland(b, W * 0.8, 0.04));
      bunnyEars(b, W * 0.22, 1.345, -0.08, 0.9, 0.3);
      break;
    case 'locker': at(b, 0, 1.9, 0.18, 0, 1, () => bunting(b, W * 0.8, 0.05)); bunnyEars(b, 0, 1.92, -0.15, 1.2); break;
    case 'shelf': for (const y of [1.86, 1.28]) at(b, 0, y, 0.15, 0, 1, () => eggGarland(b, W * 0.86, 0.06)); at(b, 0, 0.7, 0.15, 0, 1, () => bunting(b, W * 0.86, 0.06)); break;
    case 'credenza': basket(b, 0.22, 0.75, -0.3, 0.1, 4); chocBunny(b, -0.3, 0.75, -0.3, 0.15, 0.3, true); at(b, 0, 1.32, -0.46, 0, 1, () => bunting(b, W * 0.85, 0.08)); break;
    case 'tvwall': at(b, 0, 2.13, -0.4, 0, 1, () => bunting(b, 1.8, 0.06)); at(b, 0, 1.08, -0.38, 0, 1, () => eggGarland(b, 1.7, 0.03)); break;
    case 'crate': {
      // wrapped in pastel paper with a ribbon cross and a bow
      b.box(0.9, 0.68, 0.9, 0, 0.34, 0, PASTEL[0]);
      b.box(0.92, 0.69, 0.12, 0, 0.345, 0, PASTEL[6]).box(0.12, 0.69, 0.92, 0, 0.345, 0, PASTEL[6]);
      bow(b, 0, 0.68, 0, 0.32, PASTEL[6]);
      break;
    }
    case 'barrel': b.cyl(0.293, 0.293, 0.1, 0, 0.73, 0, PASTEL[3], 'solid', 24); bow(b, 0, 0.71, 0.29, 0.18, PASTEL[4]); egg(b, 0, 0.876, 0, 0.13, 1, 0.5); break;
    case 'sandbags': carrot(b, W * 0.18, 0.775, 0.02, 1.6, 0.3); chick(b, -W * 0.28, 0.77, 0, 1.0, 0.4); break;
    case 'barricade': at(b, 0, 0.93, 0.06, 0, 1, () => bunting(b, W * 0.9, 0.05)); break;
    case 'safe': bunnyEars(b, -0.05, 0.84, -0.1, 1.3, 0.2); bow(b, 0.2, 0.3, 0.24, 0.16, PASTEL[0]); break;
    case 'terminal': bunnyEars(b, 0, 1.36, -0.13, 1.1); break;
    case 'fridge': bunnyEars(b, 0, 1.92, -0.13, 1.6); break;
    case 'vending': bunnyEars(b, -0.05, 1.92, -0.1, 2.0); break;
    case 'toilet': chick(b, 0, 0.79, -0.38, 0.7); break;
    case 'shower': chick(b, -0.3, 0.07, -0.3, 0.6, 0.7); at(b, 0, 2.14, -0.41, 0, 1, () => bunting(b, 0.84, 0.06)); break;
    case 'booth': {
      for (const s of [-1, 1]) { at(b, 0, 2.3, s * (D / 2 + 0.01), 0, 1, () => bunting(b, W - 0.1, 0.06)); at(b, s * (W / 2 + 0.01), 2.3, 0, Math.PI / 2, 1, () => bunting(b, D - 0.1, 0.06)); }
      chick(b, -0.35, 2.4, 0.3, 1.2); basket(b, 0.35, 2.4, 0.3, 0.12, 3);
      break;
    }
    // street kinds, in street.ts's frames: tent W x D, floodlight, jersey barrier and sawhorse along x
    case 'tent': {
      // pastel bunting under the valance on three sides, a basket by the front leg, a bunny and a mug on the table
      at(b, 0, 1.93, D / 2 + 0.01, 0, 1, () => bunting(b, W - 0.1, 0.1));
      for (const sx of [-1, 1]) at(b, sx * (W / 2 + 0.01), 1.93, 0, sx * Math.PI / 2, 1, () => bunting(b, D - 0.1, 0.08));
      basket(b, W / 2 - 0.35, 0, D / 2 - 0.3, 0.2, 2);
      chocBunny(b, -0.05, 0.76, -D / 2 + 0.72, 0.16, 0.3, true); mug(b, 0.15, 0.76, -D / 2 + 0.75, PASTEL[1]);
      break;
    }
    case 'floodlight': egg(b, 0, 4.64, 0, 0.2, 1); bow(b, 0, 0.42, 0.37, 0.28, PASTEL[0]); break;
    case 'barrier': chick(b, -0.5, 0.8, 0, 0.9, 0.3); egg(b, 0.35, 0.8, 0, 0.055, 4, 0.2, 1.45); break;
    case 'sawhorse': bow(b, 0, 0.98, 0.07, 0.2, PASTEL[0]); break;
  }
}

// ------------------------------------------------------------------ the street
/** One cosmetic spot on the street around (x, z): a clutch of eggs, a pair of carrots, a chick with an egg, or a tuft of grass and daisies with an egg in it. */
export function easterTreat(b: Builder, x: number, z: number, k: number, seed: number) {
  const r = (i: number) => hash(seed * 13 + i);
  switch (k % 4) {
    case 0: for (let i = 0; i < 2 + (seed % 3); i++) egg(b, x + (r(i) - 0.5) * 0.7, 0, z + (r(i + 9) - 0.5) * 0.7, 0.1 + r(i + 3) * 0.04, seed + i, r(i + 5) * 6, r(i + 7) > 0.4 ? 1.45 : 0); break;
    case 1: carrot(b, x, 0, z, 2.2, r(1) * 6); carrot(b, x + 0.25, 0, z + 0.2, 2, r(2) * 6); break;
    case 2: chick(b, x, 0, z, 1.6, r(1) * 6); egg(b, x + 0.3, 0, z - 0.1, 0.09, seed, r(2) * 6, 1.45); break;
    default: tufts(b, x, 0, z, 26, 0.35, 0.3, seed, 0.18); daisies(b, x + 0.1, 0, z - 0.05, 5, 0.25, seed + 3); egg(b, x - 0.12, 0, z + 0.08, 0.08, seed, r(3) * 6, 1.4);
  }
}

// ------------------------------------------------------------------ petals
/**
 * A few pastel petals drifting down over the street: one Points cloud in a box around the camera target, moved in the
 * vertex shader like the Christmas snowfall (wraps in all three axes; only two uniforms change per frame).
 */
export class Petals {
  points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  private t = 0;
  constructor(n = 500, box = 40, height = 10) {
    const pos = new Float32Array(n * 3), seed = new Float32Array(n), col = new Float32Array(n * 3), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.random() * box; pos[i * 3 + 1] = Math.random() * height; pos[i * 3 + 2] = Math.random() * box; seed[i] = Math.random();
      c.setHex(PASTEL[i % PASTEL.length]); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uScale: { value: 800 }, uBox: { value: new THREE.Vector2(box, height) } },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCenter; uniform float uScale; uniform vec2 uBox;
        attribute float aSeed; attribute vec3 aCol;
        varying vec3 vCol; varying float vSpin;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - uTime * (0.35 + aSeed * 0.25), uBox.y);
          p.x += uTime * 0.3 + sin(uTime * 0.9 + aSeed * 40.0) * 0.6; // a light breeze, petals see-saw as they fall
          p.z += cos(uTime * 0.7 + aSeed * 23.0) * 0.5;
          p.xz = uCenter.xz - uBox.x * 0.5 + mod(p.xz - (uCenter.xz - uBox.x * 0.5), uBox.x);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = min(uScale * (0.09 + aSeed * 0.05) / -mv.z, uScale * 0.008);
          vCol = aCol; vSpin = uTime * (1.0 + aSeed * 2.0) + aSeed * 6.28;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol; varying float vSpin;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float c = cos(vSpin), s = sin(vSpin);
          q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
          q.y *= 2.0 + sin(vSpin * 1.3); // tumbling: the oval flattens and widens
          if (length(q) > 0.5) discard;
          gl_FragColor = vec4(vCol, 0.9);
        }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }
  /** pxPerUnit: drawing-buffer height / (2 tan(fov / 2)), so petals keep their world size. */
  update(dt: number, center: THREE.Vector3, pxPerUnit: number) {
    this.t += dt;
    this.mat.uniforms.uTime.value = this.t;
    this.mat.uniforms.uCenter.value.copy(center);
    this.mat.uniforms.uScale.value = pxPerUnit;
  }
  dispose() { this.points.geometry.dispose(); this.mat.dispose(); }
}
