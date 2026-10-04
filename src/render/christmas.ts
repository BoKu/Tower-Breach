import * as THREE from 'three';
import type { Builder } from './models';
import { at, rod, strip, text, dome, leaf, hash, v3 } from './halloween';

/**
 * Christmas models (currentHoliday() === 'xmas'). Kinds never change: christmasProp() rebuilds a kind outright
 * (vehicles become sleighs, planters and pot plants become decorated firs, poinsettias, presents and a snowman, cones
 * get candy-cane stripes), christmasDecor() dresses the normal model (presents, cocoa, candy canes, garlands, tinsel,
 * fairy lights, stockings, wreaths, santa hats), christmasSnow() caps outdoor props on the street.
 * Also the street snowfall (makeSnowfall). Shared geometry helpers come from halloween.ts.
 */
const X = {
  red: 0xb01c22, red2: 0x8a1218, gold: 0xd8a830, gold2: 0xa87c1c, fir: 0x1f4a28, fir2: 0x2a5c32, snow: 0xd6dee8,
  trunk: 0x4a3220, white: 0xf4f2ee, cocoa: 0x4a2a18, black: 0x16171a, velvet: 0x5a0e16, sack: 0x8a6a44, holly: 0x1e5a2a,
  wire: 0x1a2a1a, coal: 0x1a1a1c, carrot: 0xe8701a, star: 0xffd84a,
};
const BAUBLE = [0xc8202a, 0xd8a830, 0x2a5ad0, 0xe8e8f0, 0x9a2ab0];
const BULB = [0xff3030, 0x30ff60, 0x3a8aff, 0xffd030, 0xff60d0];
const WRAP: [number, number][] = [[0xc8202a, 0xf2d060], [0x1f6a3a, 0xe8e8e8], [0x2a4ab0, 0xe8c040], [0xe8e4dc, 0xc8202a], [0xd8a830, 0x8a1218]];

// ------------------------------------------------------------------ pieces of the season
/** Five-point star facing +z (two crossed so it reads from any side), lit. */
function star(b: Builder, x: number, y: number, z: number, s: number) {
  const sh = new THREE.Shape();
  for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? 0.42 : 1; if (k) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  for (const ry of [0, Math.PI / 2]) { const g = new THREE.ExtrudeGeometry(sh, { depth: 0.2, bevelEnabled: false }); g.translate(0, 0, -0.1); b.geo(g, X.star, x, y, z, 0, ry, 0, 'emit', s, s, s); }
}
/** Fir standing on y, about h tall: three tiers, optionally snow on each tier, baubles, a spiral of fairy lights and a star. */
function tree(b: Builder, x: number, y: number, z: number, h: number, deco = true, snowy = false) {
  at(b, x, y, z, hash(x * 7 + z) * 6.283, h, () => {
    b.cyl(0.05, 0.06, 0.16, 0, 0.08, 0, X.trunk, 'solid', 6);
    const tiers = [[0.36, 0.42, 0.12], [0.29, 0.36, 0.38], [0.2, 0.3, 0.62]];
    tiers.forEach(([r, th, y0], i) => {
      b.geo(new THREE.ConeGeometry(r, th, 9), i % 2 ? X.fir2 : X.fir, 0, y0 + th / 2, 0);
      if (snowy) b.geo(new THREE.ConeGeometry(r * 0.47, th * 0.45, 9), X.snow, 0, y0 + th - th * 0.225 + 0.006, 0); // snow on the upper boughs
      if (deco) for (let k = 0; k < 5; k++) { const a = k * 1.257 + i; b.geo(new THREE.IcosahedronGeometry(0.035, 1), BAUBLE[(k + i) % BAUBLE.length], Math.cos(a) * r * 0.82, y0 + th * 0.2, Math.sin(a) * r * 0.82); }
    });
    if (deco) {
      for (let k = 0; k < 18; k++) { // fairy lights spiralling up
        const u = k / 18, yy = 0.16 + u * 0.72, a = u * Math.PI * 7, r = (0.36 * (1 - (yy - 0.12) / 0.8)) + 0.02;
        b.geo(new THREE.IcosahedronGeometry(0.018, 0), BULB[k % BULB.length], Math.cos(a) * r, yy, Math.sin(a) * r, 0, 0, 0, 'emit');
      }
      star(b, 0, 0.98, 0, 0.07);
    }
  });
}
/** Ribbon bow standing upright, facing +z (about s across). */
function bow(b: Builder, x: number, y: number, z: number, s: number, color: number, ry = 0) {
  at(b, x, y, z, ry, s, () => {
    for (const sx of [-1, 1]) b.geo(new THREE.TorusGeometry(0.25, 0.1, 4, 10), color, sx * 0.25, 0.22, 0, 0, 0, sx * 0.5);
    b.sphere(0.12, 0, 0.1, 0, color);
  });
}
/** Wrapped present standing on y: box, ribbon cross and bow (k picks the paper). */
function present(b: Builder, x: number, y: number, z: number, w: number, h: number, d: number, k: number, ry = 0) {
  const [c, r] = WRAP[k % WRAP.length], t = Math.min(w, d) * 0.16;
  at(b, x, y, z, ry, 1, () => {
    b.box(w, h, d, 0, h / 2, 0, c);
    b.box(w + 0.006, h + 0.006, t, 0, h / 2, 0, r).box(t, h + 0.006, d + 0.006, 0, h / 2, 0, r);
    bow(b, 0, h, 0, Math.min(w, d) * 0.55, r);
  });
}
/** A little heap of presents around (x, z) on y. */
function presents(b: Builder, x: number, y: number, z: number, s: number, n = 3, seed = 0) {
  for (let i = 0; i < n; i++) {
    const a = i * 2.3 + seed, d = i ? s * 0.55 : 0, w = s * (0.5 + hash(i + seed) * 0.3), h = s * (0.35 + hash(i + seed + 5) * 0.35);
    present(b, x + Math.cos(a) * d, y, z + Math.sin(a) * d, w, h, w * (0.8 + hash(i + 2) * 0.3), i + seed, a);
  }
}
/** String of coloured fairy lights along x from -len/2 to len/2, hanging from y = 0. */
function lights(b: Builder, len: number, sag = 0.06) {
  const n = Math.max(3, Math.round(len / 0.13)), pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) { const u = -1 + (2 * i) / n; pts.push(v3((u * len) / 2, -sag * (1 - u * u), 0)); }
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[i + 1];
    strip(b, a.x, a.y, c.x, c.y, 0.006, X.wire, 'solid', 0.006);
    b.geo(new THREE.IcosahedronGeometry(0.017, 0), BULB[i % BULB.length], (a.x + c.x) / 2, (a.y + c.y) / 2 - 0.018, 0, 0, 0, 0, 'emit', 1, 1.3, 1);
  }
}
/** Bushy fir garland along x from -len/2 to len/2, hanging from y = 0, with baubles. */
function garland(b: Builder, len: number, sag = 0.1, r = 0.05) {
  const n = Math.max(4, Math.round(len / (r * 1.2)));
  for (let i = 0; i <= n; i++) {
    const u = -1 + (2 * i) / n, x = (u * len) / 2, y = -sag * (1 - u * u);
    b.geo(new THREE.IcosahedronGeometry(r, 0), i % 2 ? X.fir : X.fir2, x, y, 0, i, i * 2, 0);
    if (i % 5 === 2) b.geo(new THREE.IcosahedronGeometry(r * 0.55, 1), BAUBLE[(i / 5) % BAUBLE.length | 0], x, y - r * 0.9, r * 0.5);
  }
}
/** Tinsel strand along x (shiny gold or silver), hanging from y = 0. */
function tinsel(b: Builder, len: number, sag: number, color = X.gold) {
  const n = Math.max(3, Math.round(len / 0.06));
  for (let i = 0; i <= n; i++) { const u = -1 + (2 * i) / n; b.geo(new THREE.OctahedronGeometry(0.03, 0), color, (u * len) / 2, -sag * (1 - u * u), 0, i, i * 1.7, 0); }
}
/** Holly wreath facing +z (radius r) with berries and a red bow at the bottom. */
function wreath(b: Builder, x: number, y: number, z: number, r: number, ry = 0) {
  at(b, x, y, z, ry, r, () => {
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; b.geo(new THREE.IcosahedronGeometry(0.34, 0), k % 2 ? X.fir : X.holly, Math.cos(a), Math.sin(a), 0, k, k * 2, 0, 'solid', 1, 1, 0.55); }
    for (let k = 0; k < 5; k++) { const a = 0.4 + k * 1.1; b.sphere(0.09, Math.cos(a) * 0.95, Math.sin(a) * 0.95, 0.2, 0xd01818); }
    bow(b, 0, -1.15, 0.22, 0.9, X.red);
  });
}
/** Santa hat sitting on y: white fur brim, floppy red crown, pompom. */
function santaHat(b: Builder, x: number, y: number, z: number, s: number, ry = 0) {
  at(b, x, y, z, ry, s, () => {
    b.geo(new THREE.TorusGeometry(0.1, 0.035, 6, 14), X.white, 0, 0.03, 0, Math.PI / 2);
    b.geo(new THREE.ConeGeometry(0.095, 0.26, 12), X.red, 0.03, 0.17, 0, 0, 0, -0.35);
    b.sphere(0.035, 0.08, 0.29, 0, X.white);
  });
}
/** Christmas stocking hanging from (x, y, z), facing +z, toe to +x. */
function stocking(b: Builder, x: number, y: number, z: number, s: number, color: number, ry = 0) {
  at(b, x, y, z, ry, s, () => {
    b.rbox(0.09, 0.15, 0.035, 0.015, 0, -0.12, 0, color).rbox(0.14, 0.07, 0.035, 0.03, 0.025, -0.215, 0, color);
    b.rbox(0.11, 0.05, 0.045, 0.015, 0, -0.03, 0, X.white).rbox(0.04, 0.05, 0.04, 0.015, 0.075, -0.215, 0, X.white); // cuff, toe
  });
}
/** Red-and-white candy cane standing on y (hook toward -x), or lying flat on y. */
function cane(b: Builder, x: number, y: number, z: number, s: number, ry = 0, lying = false) {
  at(b, x, y + (lying ? 0.012 * s : 0), z, ry, s, () => {
    for (let k = 0; k < 6; k++) b.cyl(0.012, 0.012, 0.05, 0, 0.025 + k * 0.05, 0, k % 2 ? X.white : 0xd01818, 'solid', 8);
    b.geo(new THREE.TorusGeometry(0.04, 0.012, 6, 10, Math.PI), 0xd01818, -0.04, 0.3, 0);
    b.cyl(0.012, 0.012, 0.04, -0.08, 0.28, 0, X.white, 'solid', 8);
  }, lying ? -Math.PI / 2 : 0, lying ? -Math.PI / 2 : 0);
}
/** Mug of cocoa with marshmallows. */
function mug(b: Builder, x: number, y: number, z: number, color = X.red) {
  b.cyl(0.04, 0.036, 0.09, x, y + 0.045, z, color, 'solid', 12).cyl(0.035, 0.035, 0.004, x, y + 0.083, z, X.cocoa, 'solid', 12);
  b.geo(new THREE.TorusGeometry(0.022, 0.007, 4, 8), color, x + 0.042, y + 0.045, z);
  for (let k = 0; k < 3; k++) b.box(0.014, 0.012, 0.014, x - 0.012 + k * 0.012, y + 0.088, z + (k % 2) * 0.01, X.white, 'solid', k);
}
/** Poinsettia: green leaves under a star of red bracts, yellow centre. */
function poinsettia(b: Builder, x: number, y: number, z: number, s: number) {
  at(b, x, y, z, hash(x + z) * 3, s, () => {
    for (let k = 0; k < 6; k++) leaf(b, 0.16, 0.09, 0, 0.02, 0, k * 1.047 + 0.5, 0.25, 0x2a5a2a);
    for (let k = 0; k < 7; k++) leaf(b, 0.13, 0.07, 0, 0.05, 0, k * 0.898, 0.4, k % 2 ? 0xc8141c : 0xb0101a);
    for (let k = 0; k < 4; k++) b.sphere(0.012, Math.cos(k * 1.57) * 0.015, 0.065, Math.sin(k * 1.57) * 0.015, 0xe8c020);
  });
}
/** Plant pot (radius r, height h) with a snowy-white top or soil. */
function pot(b: Builder, r: number, h: number, color: number, top = 0x2a1e14) {
  b.cyl(r, r * 0.78, h, 0, h / 2, 0, color, 'solid', 14).cyl(r * 1.06, r * 1.06, 0.035, 0, h, 0, color, 'solid', 14).cyl(r * 0.94, r * 0.94, 0.01, 0, h + 0.012, 0, top, 'solid', 14);
}
/** Snowman (about 0.65 tall before scaling) facing +z: coal eyes and buttons, carrot nose, stick arms, red scarf, black top hat. */
export function snowman(b: Builder, x: number, y: number, z: number, s: number, ry = 0) {
  at(b, x, y, z, ry, s, () => {
    b.sphere(0.15, 0, 0.13, 0, X.snow).sphere(0.11, 0, 0.33, 0, X.snow).sphere(0.08, 0, 0.48, 0, X.snow);
    for (const sx of [-1, 1]) b.sphere(0.011, sx * 0.028, 0.5, 0.072, X.coal);
    for (let k = 0; k < 3; k++) b.sphere(0.013, 0, 0.26 + k * 0.06, 0.103 - Math.abs(k - 1) * 0.008, X.coal);
    b.geo(new THREE.ConeGeometry(0.014, 0.08, 6), X.carrot, 0, 0.48, 0.11, Math.PI / 2);
    b.geo(new THREE.TorusGeometry(0.075, 0.022, 5, 12), X.red, 0, 0.41, 0, Math.PI / 2).box(0.04, 0.12, 0.02, 0.05, 0.36, 0.07, X.red, 'solid', 0.3);
    for (const sx of [-1, 1]) { // stick arms with a twig fork
      rod(b, v3(sx * 0.09, 0.34, 0), v3(sx * 0.24, 0.44, 0.02), 0.008, X.trunk, 4);
      rod(b, v3(sx * 0.2, 0.415, 0.015), v3(sx * 0.215, 0.48, 0.02), 0.005, X.trunk, 4);
    }
    b.cyl(0.08, 0.08, 0.012, 0, 0.555, 0, X.black, 'solid', 12).cyl(0.05, 0.05, 0.1, 0, 0.6, 0, X.black, 'solid', 12);
  });
}
/** Snow cushion lying on y (w x d), with a couple of soft drifts. */
function snowCap(b: Builder, w: number, d: number, x: number, y: number, z: number, ry = 0) {
  b.rbox(w, 0.05, d, Math.min(0.024, w / 2, d / 2), x, y + 0.015, z, X.snow, 0, ry);
  if (w > 0.4) for (const k of [-0.25, 0.2]) { const c = Math.cos(ry), sn = Math.sin(ry); dome(b, X.snow, x + k * w * c, y + 0.03, z - k * w * sn, w * 0.18, 0.035, Math.min(d, w) * 0.4); }
}

// ------------------------------------------------------------------ sleighs
/**
 * Santa-style sleigh along +x (front), L long and Wd wide: curled gold runners, a swan-necked body, a velvet bench and
 * a sack of presents on the rear deck. policecar: red with POLICE lettering and a light-bar arch over the middle (the
 * strobing lenses are FloorView meshes at roof height); swatvan: big black-and-gold armoured sleigh with a covered cab.
 */
function sleigh(b: Builder, L: number, Wd: number, kind: string) {
  const swat = kind === 'swatvan', police = kind === 'policecar';
  const body = swat ? X.black : X.red, trim = X.gold, zr = Wd / 2 - 0.14, x0 = -L / 2 + 0.15, x1 = L / 2 - 0.62;
  for (const s of [-1, 1]) {
    const z = s * zr;
    rod(b, v3(x0, 0.05, z), v3(x1, 0.05, z), 0.035, trim);
    b.geo(new THREE.TorusGeometry(0.28, 0.035, 5, 14, Math.PI * 1.3), trim, x1, 0.33, z, 0, 0, -Math.PI / 2); // front curl
    b.sphere(0.045, x1 - 0.226, 0.495, z, trim);
    b.geo(new THREE.TorusGeometry(0.08, 0.03, 4, 8, Math.PI), trim, x0, 0.13, z, 0, 0, Math.PI / 2); // rear curl
    for (const x of [-L / 2 + 0.4, -0.15, x1 - 0.35]) rod(b, v3(x, 0.05, z), v3(x + 0.08, 0.38, z * 0.92), 0.022, trim, 5);
  }
  // swan-necked body extruded across the width
  const sh = new THREE.Shape(), F = L / 2;
  sh.moveTo(-F + 0.1, 0.36); sh.lineTo(F - 0.75, 0.36);
  sh.quadraticCurveTo(F - 0.08, 0.36, F - 0.12, 0.86); sh.quadraticCurveTo(F - 0.14, 1.14, F - 0.4, 1.1); sh.quadraticCurveTo(F - 0.56, 1.02, F - 0.64, 0.84);
  sh.lineTo(-F + 0.3, 0.84); sh.quadraticCurveTo(-F + 0.04, 0.84, -F - 0.03, 1.04); sh.quadraticCurveTo(-F - 0.06, 0.6, -F + 0.1, 0.36);
  const dep = Wd - 0.16, g = new THREE.ExtrudeGeometry(sh, { depth: dep, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -dep / 2);
  b.geo(g, body, 0, 0, 0);
  const sz = Wd / 2 - 0.045; // side faces
  for (const s of [-1, 1]) {
    b.box(L - 0.95, 0.04, 0.03, (-F + 0.3 + F - 0.64) / 2, 0.845, s * sz, trim).box(L - 0.75, 0.035, 0.03, -0.3, 0.38, s * sz, trim); // gold rails
    b.geo(new THREE.TorusGeometry(0.13, 0.018, 4, 14, Math.PI * 1.6), trim, F - 0.42, 0.72, s * (sz + 0.01), 0, 0, 0.6); // scroll on the dash
    b.geo(new THREE.TorusGeometry(0.07, 0.015, 4, 12, Math.PI * 1.6), trim, -F + 0.28, 0.62, s * (sz + 0.01), 0, 0, 2.4);
  }
  // bench seat and backrest
  b.rbox(0.5, 0.12, Wd - 0.34, 0.04, 0.2, 0.9, 0, swat ? 0x2a2a2e : X.velvet);
  b.rbox(0.12, 0.55, Wd - 0.3, 0.04, -0.12, 1.1, 0, body, 0, 0, 0.12).rbox(0.16, 0.05, Wd - 0.24, 0.02, -0.15, 1.38, 0, trim);
  // sack of presents on the rear deck
  const sx = -F + 0.68, sackW = Math.min(0.5, Wd * 0.3);
  b.geo(new THREE.SphereGeometry(1, 12, 8), swat ? 0x6a5434 : X.sack, sx, 1.08, 0, 0, 0.3, 0, 'solid', 0.4, 0.36, sackW);
  b.cyl(0.07, 0.11, 0.14, sx + 0.04, 1.44, 0, X.sack, 'solid', 8).cyl(0.075, 0.075, 0.03, sx + 0.04, 1.42, 0, X.gold2, 'solid', 8);
  present(b, sx + 0.12, 1.45, 0.08, 0.2, 0.18, 0.18, 0, 0.4); present(b, sx - 0.05, 1.42, -0.12, 0.16, 0.22, 0.16, 2, -0.3);
  present(b, -F + 0.28, 0.84, Wd / 2 - 0.3, 0.24, 0.2, 0.22, 1, 0.2); present(b, -F + 0.3, 0.84, -Wd / 2 + 0.3, 0.2, 0.26, 0.2, 3, -0.4);
  if (police) {
    // light-bar arch over the middle of the sleigh, and POLICE on both flanks
    for (const s of [-1, 1]) rod(b, v3(0, 0.84, s * (Wd / 2 - 0.08)), v3(0, 1.37, s * (Wd / 2 - 0.08)), 0.025, trim);
    b.box(0.06, 0.04, Wd - 0.12, 0, 1.36, 0, trim).rbox(0.3, 0.08, 1.2, 0.03, 0, 1.42, 0, X.black);
    for (const s of [-1, 1]) at(b, -0.2, 0.6, s * (sz + 0.02), s > 0 ? 0 : Math.PI, 1, () => { text(b, 'POLICE', 0.17, X.white); b.box(0.98, 0.025, 0.008, 0, -0.13, 0, trim); });
  }
  if (swat) {
    // armoured cab: gold posts, black roof slab with a light bar, riveted side shields with vision slits
    for (const px of [-0.55, 0.75]) for (const s of [-1, 1]) rod(b, v3(px, 0.84, s * (Wd / 2 - 0.08)), v3(px, 2.24, s * (Wd / 2 - 0.08)), 0.035, trim, 8);
    b.rbox(1.6, 0.08, Wd - 0.04, 0.02, 0.1, 2.26, 0, X.black).rbox(1.66, 0.03, Wd + 0.02, 0.01, 0.1, 2.22, 0, trim);
    b.rbox(0.3, 0.08, 1.25, 0.03, 0, 2.33, 0, 0x0c0c0d);
    for (const s of [-1, 1]) {
      b.rbox(1.24, 0.5, 0.04, 0.01, 0.1, 1.12, s * (Wd / 2 - 0.06), 0x24262a);
      b.box(0.8, 0.04, 0.01, 0.1, 1.24, s * (Wd / 2 - 0.035), 0x0a0a0a);
      for (let k = 0; k < 6; k++) b.sphere(0.012, -0.42 + k * 0.2, 0.92, s * (Wd / 2 - 0.035), trim);
      at(b, -1.0, 0.6, s * (sz + 0.02), s > 0 ? 0 : Math.PI, 1, () => text(b, 'SWAT', 0.22, trim));
    }
    snowCap(b, 1.4, Wd - 0.3, 0.1, 2.3, 0.0); // the cab roof has been out in the weather
  }
}

// ------------------------------------------------------------------ replaced models
/** Christmas replacement for a kind. True = built here (the normal model is skipped). */
export function christmasProp(b: Builder, kind: string, W: number, D: number, _w: number, _h: number): boolean {
  const pw = Math.min(W * 0.92, 2.6), pd = Math.min(D * 0.92, 0.9); // planter box size, as models.ts planter()
  switch (kind) {
    case 'car': case 'policecar': case 'swatvan': {
      const vert = D > W;
      at(b, 0, 0, 0, vert ? Math.PI / 2 : 0, 1, () => sleigh(b, Math.max(W, D) - 0.1, Math.min(W, D) - 0.05, kind));
      break;
    }
    case 'planter': {
      // charcoal trough under snow: a row of little snow-dusted firs strung with lights
      const Hh = 0.5, n = Math.max(1, Math.round(pw / 0.55));
      b.rbox(pw, Hh, pd, 0.03, 0, Hh / 2, 0, 0x3a3b3e).rbox(pw + 0.04, 0.04, pd + 0.04, 0.015, 0, Hh, 0, 0x2a2b2e);
      snowCap(b, pw - 0.04, pd - 0.04, 0, Hh, 0);
      for (let k = 0; k < n; k++) tree(b, -pw / 2 + (k + 0.5) * (pw / n), Hh + 0.03, 0, 0.62 + hash(k) * 0.16, k % 2 === 0, true);
      break;
    }
    case 'planter_grass': {
      // corten box of poinsettias
      const Hh = 0.4, n = Math.max(1, Math.floor(pw / 0.36));
      b.rbox(pw, Hh, pd, 0.008, 0, Hh / 2, 0, 0x8a4a22).rbox(pw + 0.02, 0.02, pd + 0.02, 0.004, 0, Hh, 0, 0x6a3a1a);
      b.rbox(pw - 0.04, 0.02, pd - 0.04, 0.005, 0, Hh - 0.005, 0, 0x2a1e14);
      for (let k = 0; k < n; k++) for (const z of [-pd * 0.2, pd * 0.2]) poinsettia(b, -pw / 2 + (k + 0.5) * (pw / n) + (z > 0 ? 0.08 : -0.04), Hh, z, 1.2 + hash(k + z) * 0.3);
      break;
    }
    case 'planter_topiary': {
      // timber trough heaped with wrapped presents, a tinsel swag along the front
      const Hh = 0.26;
      for (let k = 0; k < 3; k++) b.rbox(pw, 0.085, pd, 0.008, 0, 0.045 + k * 0.088, 0, k % 2 ? 0x6a4a2c : 0x5a3e24);
      b.rbox(pw - 0.04, 0.02, pd - 0.04, 0.005, 0, Hh, 0, 0xb89a50);
      const n = Math.max(2, Math.round(pw / 0.32));
      for (let k = 0; k < n; k++) {
        const x = -pw / 2 + (k + 0.5) * (pw / n), s = 0.22 + hash(k) * 0.1;
        present(b, x, Hh, (hash(k + 3) - 0.5) * pd * 0.3, s, s * (0.7 + hash(k + 1) * 0.6), s * 0.9, k, (hash(k + 4) - 0.5) * 0.6);
      }
      for (let k = 0; k < n - 1; k++) present(b, -pw / 2 + (k + 1) * (pw / n), Hh + 0.24, 0, 0.16, 0.14, 0.16, k + 2, k);
      at(b, 0, Hh + 0.02, pd / 2 + 0.01, 0, 1, () => tinsel(b, pw - 0.06, 0.08));
      break;
    }
    case 'planter_flowers': {
      // low concrete kerb round a bed of snow: a snowman with candy canes stuck in the drifts
      const Hh = 0.14;
      b.rbox(pw, Hh, pd, 0.015, 0, Hh / 2, 0, 0x5e5e5a);
      snowCap(b, pw - 0.06, pd - 0.06, 0, Hh, 0);
      dome(b, X.snow, -pw * 0.25, Hh + 0.04, 0, pw * 0.2, 0.06, pd * 0.35);
      snowman(b, pw > 1.2 ? -pw * 0.18 : 0, Hh + 0.04, 0, Math.min(1.3, pd * 1.6), 0.2);
      for (let k = 0; k < 3; k++) cane(b, pw * 0.12 + k * Math.min(0.22, pw * 0.12), Hh + 0.02, (k % 2 ? -1 : 1) * pd * 0.18, 1.2, k * 1.1);
      break;
    }
    case 'planter_bamboo': {
      // glossy black planter of snow with giant candy canes standing in it, a string of lights along the front
      const Hh = 0.4, n = Math.max(2, Math.min(6, Math.floor(pw / 0.24)));
      b.rbox(pw, Hh, pd, 0.02, 0, Hh / 2, 0, 0x121316).rbox(pw + 0.02, 0.02, pd + 0.02, 0.006, 0, Hh, 0, 0x2a2c30);
      snowCap(b, pw - 0.04, pd - 0.04, 0, Hh, 0);
      for (let k = 0; k < n; k++) cane(b, -pw / 2 + (k + 0.5) * (pw / n), Hh + 0.02, (hash(k) - 0.5) * pd * 0.3, 2.4 + hash(k + 2) * 0.8, k % 2 ? Math.PI : 0);
      at(b, 0, Hh + 0.01, pd / 2 + 0.012, 0, 1, () => lights(b, pw - 0.04, 0.05));
      break;
    }
    case 'plant': {
      // small decorated tree in a red pot, presents at its foot
      at(b, -0.05, 0, -0.05, 0, 1, () => pot(b, 0.17, 0.26, X.red, X.snow));
      tree(b, -0.05, 0.27, -0.05, 0.85);
      present(b, 0.26, 0, 0.22, 0.2, 0.16, 0.18, 0, 0.4); present(b, 0.28, 0, -0.12, 0.14, 0.2, 0.14, 2, -0.2);
      break;
    }
    case 'palm': {
      // tall decorated Christmas tree in a gold pot, a pile of presents underneath
      at(b, 0, 0, 0, 0, 1, () => pot(b, 0.2, 0.36, X.gold2));
      tree(b, 0, 0.37, 0, 1.6);
      presents(b, 0.18, 0, 0.26, 0.3, 3, 1);
      break;
    }
    case 'fern': {
      // potted poinsettia with a gold ribbon round the pot
      at(b, 0, 0, 0, 0, 1, () => pot(b, 0.17, 0.28, X.white));
      b.cyl(0.165, 0.16, 0.05, 0, 0.17, 0, X.gold, 'solid', 14);
      poinsettia(b, 0, 0.29, 0, 2);
      bow(b, 0, 0.13, 0.17, 0.1, X.gold);
      break;
    }
    case 'cactus': {
      // snow-dusted fir in a terracotta pot, no decorations
      at(b, 0, 0, 0, 0, 1, () => pot(b, 0.18, 0.3, 0xb05a32, X.snow));
      tree(b, 0, 0.31, 0, 1.05, false, true);
      break;
    }
    case 'ficus': {
      // woven basket with a holly bush, berries and a red bow
      b.cyl(0.24, 0.2, 0.34, 0, 0.17, 0, 0xa98a5a, 'solid', 16);
      for (let i = 0; i < 3; i++) b.cyl(0.242 - i * 0.01, 0.242 - i * 0.01, 0.02, 0, 0.06 + i * 0.1, 0, 0x7d6440, 'solid', 16);
      for (let k = 0; k < 14; k++) { const a = k * 2.4, r = 0.2 * Math.sqrt((k + 0.5) / 14); b.geo(new THREE.IcosahedronGeometry(0.11, 0), k % 2 ? X.holly : X.fir2, Math.cos(a) * r, 0.42 + (0.2 - r) * 1.1, Math.sin(a) * r, k, k * 2, 0); }
      for (let k = 0; k < 9; k++) { const a = k * 2.1, r = 0.08 + hash(k) * 0.14; b.sphere(0.022, Math.cos(a) * r, 0.5 + (0.22 - r) * 1.1 + 0.06, Math.sin(a) * r, 0xd01818); }
      bow(b, 0, 0.2, 0.245, 0.14, X.red);
      break;
    }
    case 'cone': {
      // traffic cone in candy-cane stripes with a little snow on its tip
      b.rbox(0.38, 0.035, 0.38, 0.03, 0, 0.018, 0, 0x151515);
      const r = (y: number) => 0.14 - ((y - 0.1) * 0.09) / 0.58;
      const band = (pts: [number, number][], c: number) => b.geo(new THREE.LatheGeometry(pts.map(([u, v]) => new THREE.Vector2(u, v)), 16), c, 0, 0, 0);
      const ys = [0.1, 0.22, 0.34, 0.46, 0.58, 0.68];
      band([[0.155, 0.035], [0.14, 0.1]], 0xd01818);
      for (let k = 0; k < ys.length - 1; k++) band([[r(ys[k]), ys[k]], [r(ys[k + 1]), ys[k + 1]]], k % 2 ? 0xd01818 : X.white);
      band([[r(0.68), 0.68], [0.03, 0.72], [0, 0.725]], X.white);
      dome(b, X.snow, 0, 0.7, 0, 0.05, 0.05, 0.05);
      break;
    }
    default: return false;
  }
  return true;
}

// ------------------------------------------------------------------ dressing on top of the normal model
/** Christmas dressing added to the normal model of a kind (no-op for kinds that keep their look). */
export function christmasDecor(b: Builder, kind: string, W: number, D: number, _w: number, _h: number): void {
  switch (kind) {
    case 'desk': mug(b, 0.3, 0.768, -0.2); present(b, -0.28, 0.768, -0.22, 0.16, 0.12, 0.14, 0, 0.3); cane(b, 0.05, 0.768, -0.3, 0.8, 0.4, true); break;
    case 'execdesk': santaHat(b, -W / 2 + 0.3, 1.27, -0.2, 0.9, 0.5); mug(b, 0.56, 0.795, 0.12, X.white); present(b, -0.62, 0.795, 0.08, 0.18, 0.14, 0.16, 4, 0.2); cane(b, 0.75, 0.795, -0.1, 0.8, -0.3, true); break;
    case 'secdesk': tree(b, W / 2 - 0.35, 0.9, -0.1, 0.42); mug(b, -W / 2 + 0.62, 0.9, -0.12); present(b, -0.42, 0.9, -0.1, 0.14, 0.12, 0.14, 1, 0.5); break;
    case 'table': mug(b, -0.72, 0.757, 0.12); mug(b, -0.58, 0.757, 0.22, X.white); present(b, 0, 0.757, -0.16, 0.18, 0.13, 0.16, 2, 0.2); cane(b, 0.12, 0.757, 0.15, 0.8, 1.2, true); break;
    case 'boardtable': {
      // little trees at both ends of the runner, presents and cocoa in the middle
      const along = W >= D, L = Math.max(W, D) - 0.15, P = (u: number, v: number): [number, number] => (along ? [u, v] : [v, u]), T = 0.784;
      for (const u of [-(L / 2 - 0.45), L / 2 - 0.45]) { const [x, z] = P(u, 0); tree(b, x, T, z, 0.5); }
      { const [x, z] = P(0, 0); presents(b, x, T, z, 0.22, 3, 2); }
      for (const [du, dv] of [[0.6, 0.25], [-0.7, -0.2]]) { const [x, z] = P(du, dv); mug(b, x, T, z, du > 0 ? X.red : X.white); }
      break;
    }
    case 'cubicle': {
      // a small present on every desk, fairy lights along both partition rails
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const cx = (sx * W) / 4, cz = (sz * D) / 4, mz = cz - sz * (D / 4 - 0.14);
        present(b, cx - sx * 0.28, 0.755, mz + sz * 0.12, 0.12, 0.1, 0.12, sx + sz + 2, sx);
      }
      at(b, 0, 1.23, 0.04, 0, 1, () => lights(b, W - 0.1, 0.05));
      at(b, 0.04, 1.23, 0, Math.PI / 2, 1, () => lights(b, D - 0.1, 0.05));
      break;
    }
    case 'counter': mug(b, 0.3, 0.9, -0.12); cane(b, 0.45, 0.9, -0.05, 0.8, 0.5, true); at(b, 0, 1.38, -0.44, 0, 1, () => garland(b, W * 0.9, 0.06, 0.04)); break;
    case 'sink': { const Wv = W * 0.92; at(b, 0, 1.86, -0.42, 0, 1, () => garland(b, Wv * 0.9, 0.05, 0.035)); break; }
    case 'reception': {
      // presents and little trees along the ledge, a MERRY CHRISTMAS banner with a garland swag behind
      const hw = W / 2, sag = 0.36, R = (hw * hw + sag * sag) / (2 * sag), cz = 0.5 - R, T = 1.075;
      const ledgeZ = (x: number) => cz + Math.sqrt((R - 0.17) ** 2 - x * x);
      for (const x of [-0.95, 0.95]) tree(b, x, T, ledgeZ(x), 0.42);
      for (const [x, k] of [[-0.5, 0], [0.5, 2], [0, 4]]) present(b, x, T, ledgeZ(x), 0.18, 0.15, 0.16, k, x);
      for (const sx of [-1, 1]) b.cyl(0.015, 0.015, 1.3, sx * 1.5, 1.41, -0.44, X.gold2, 'solid', 6);
      b.rbox(3.1, 0.34, 0.025, 0.01, 0, 1.92, -0.44, X.red2);
      at(b, 0, 1.92, -0.425, 0, 1, () => text(b, 'MERRY CHRISTMAS', 0.17, 0xffe08a, 'emit'));
      at(b, 0, 1.74, -0.41, 0, 1, () => garland(b, 2.96, 0.12, 0.045));
      break;
    }
    case 'cabinet':
      tree(b, -W * 0.2, 1.345, -0.05, 0.42);
      at(b, 0, 1.33, 0.27, 0, 1, () => lights(b, W * 0.8, 0.04));
      stocking(b, W * 0.18, 1.18, 0.275, 1, X.red); present(b, W * 0.22, 1.345, -0.1, 0.16, 0.12, 0.16, 1, 0.3);
      break;
    case 'locker': at(b, 0, 1.9, 0.18, 0, 1, () => tinsel(b, W * 0.8, 0.05)); stocking(b, -0.08, 1.55, 0.175, 1, X.red); stocking(b, 0.14, 1.5, 0.175, 0.9, 0x1f6a3a); break;
    case 'shelf': for (const y of [1.86, 1.28]) at(b, 0, y, 0.15, 0, 1, () => lights(b, W * 0.86, 0.06)); at(b, 0, 0.7, 0.15, 0, 1, () => tinsel(b, W * 0.86, 0.06, 0xc8ccd4)); break;
    case 'credenza': present(b, 0.22, 0.75, -0.3, 0.16, 0.14, 0.14, 0, 0.4); at(b, 0, 1.32, -0.46, 0, 1, () => garland(b, W * 0.85, 0.08, 0.04)); stocking(b, -0.3, 1.22, -0.45, 0.9, X.red); stocking(b, 0.3, 1.22, -0.45, 0.9, 0x1f6a3a); break;
    case 'tvwall': at(b, 0, 2.13, -0.4, 0, 1, () => garland(b, 1.8, 0.06, 0.045)); at(b, 0, 1.08, -0.38, 0, 1, () => lights(b, 1.7, 0.03)); break;
    case 'crate': {
      // wrapped like a present: red paper, gold ribbon and a bow
      b.box(0.9, 0.68, 0.9, 0, 0.34, 0, X.red);
      b.box(0.92, 0.69, 0.12, 0, 0.345, 0, X.gold).box(0.12, 0.69, 0.92, 0, 0.345, 0, X.gold);
      bow(b, 0, 0.68, 0, 0.32, X.gold);
      break;
    }
    case 'barrel': b.cyl(0.293, 0.293, 0.1, 0, 0.73, 0, X.red, 'solid', 24); bow(b, 0, 0.71, 0.29, 0.18, X.red); bow(b, 0, 0.876, 0, 0.22, X.gold, 0.6); break;
    case 'sandbags': wreath(b, W * 0.22, 0.5, 0.25, 0.13); santaHat(b, -W * 0.28, 0.77, 0, 1.2, 0.4); break;
    case 'barricade': at(b, 0, 0.93, 0.06, 0, 1, () => lights(b, W * 0.9, 0.05)); wreath(b, -W * 0.2, 0.62, 0.1, 0.12); break;
    case 'safe': santaHat(b, -0.05, 0.84, -0.1, 1.4, 0.4); bow(b, 0.2, 0.3, 0.24, 0.16, X.gold); break;
    case 'terminal': santaHat(b, 0, 1.385, -0.13, 1.1, 0.3); break;
    case 'fridge': wreath(b, 0, 1.56, 0.25, 0.12); break;
    case 'vending': santaHat(b, -0.2, 1.92, -0.1, 1.7, 0.4); wreath(b, 0.31, 1.32, 0.37, 0.08); break;
    case 'toilet': tree(b, 0, 0.79, -0.38, 0.28); break;
    case 'shower': at(b, 0, 2.14, -0.41, 0, 1, () => lights(b, 0.84, 0.06)); at(b, -0.41, 2.14, 0, Math.PI / 2, 1, () => lights(b, 0.84, 0.06)); break;
    case 'booth': {
      for (const s of [-1, 1]) { at(b, 0, 2.3, s * (D / 2 + 0.01), 0, 1, () => lights(b, W - 0.1, 0.06)); at(b, s * (W / 2 + 0.01), 2.3, 0, Math.PI / 2, 1, () => lights(b, D - 0.1, 0.06)); }
      tree(b, -0.35, 2.4, 0.3, 0.6); present(b, 0.35, 2.4, 0.3, 0.2, 0.16, 0.18, 0, 0.3);
      break;
    }
    // street kinds, in street.ts's frames: tent W x D, floodlight, jersey barrier and sawhorse along x
    case 'tent': {
      // fairy lights under the valance on three sides, snow on the roof, a tree by the front leg, presents on the table
      const H = 2.2, r = Math.hypot(W, D) / 2, cap = new THREE.ConeGeometry(r * 0.6, 0.7 * 0.6, 4, 1);
      cap.rotateY(Math.PI / 4); cap.scale((W / Math.hypot(W, D)) * Math.SQRT2, 1, (D / Math.hypot(W, D)) * Math.SQRT2);
      b.geo(cap, X.snow, 0, H + 0.7 + 0.03 - 0.7 * 0.6 / 2, 0);
      at(b, 0, 1.93, D / 2 + 0.01, 0, 1, () => lights(b, W - 0.1, 0.1));
      for (const sx of [-1, 1]) at(b, sx * (W / 2 + 0.01), 1.93, 0, Math.PI / 2, 1, () => lights(b, D - 0.1, 0.08));
      tree(b, W / 2 - 0.35, 0, D / 2 - 0.3, 1.1);
      present(b, -0.05, 0.76, -D / 2 + 0.72, 0.18, 0.14, 0.16, 0, 0.3); mug(b, 0.15, 0.76, -D / 2 + 0.75);
      break;
    }
    case 'floodlight':
      star(b, 0, 4.95, 0, 0.2);
      wreath(b, 0, 0.36, 0.37, 0.14);
      snowCap(b, 0.96, 0.66, 0, 0.6, 0); snowCap(b, 1.16, 0.1, 0, 4.63, 0);
      break;
    case 'barrier': { const len = Math.max(W, D) + 0.02; snowCap(b, len - 0.12, 0.17, 0, 0.8, 0); break; }
    case 'sawhorse': { const len = Math.max(W, D); snowCap(b, len - 0.65, 0.07, -0.2, 1.0, 0); break; }
  }
}

/** Snow lying on outdoor props on the street (floor 0) that use the prop Builder models. */
export function christmasSnow(b: Builder, kind: string, W: number, D: number): void {
  switch (kind) {
    case 'crate': snowCap(b, 0.86, 0.86, 0, 0.68, 0); break;
    case 'table': snowCap(b, W - 0.06, D * 0.78, 0, 0.745, 0); break;
    case 'sandbags': snowCap(b, W * 0.9, 0.28, 0, 0.775, 0); for (const s of [-1, 1]) snowCap(b, W * 0.9, 0.12, 0, 0.475, s * 0.22); break;
  }
}

// ------------------------------------------------------------------ snowfall
/**
 * Light snowfall: one Points cloud in a box around the camera target. Flakes fall and drift with the wind in the
 * vertex shader and wrap in all three axes, so nothing is updated on the CPU but two uniforms.
 */
export class Snowfall {
  points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  private t = 0;
  constructor(n = 3500, box = 46, height = 13) {
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = Math.random() * box; pos[i * 3 + 1] = Math.random() * height; pos[i * 3 + 2] = Math.random() * box; seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uScale: { value: 800 }, uBox: { value: new THREE.Vector2(box, height) } },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCenter; uniform float uScale; uniform vec2 uBox;
        attribute float aSeed;
        varying float vA;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - uTime * (0.7 + aSeed * 0.5), uBox.y);
          p.x += uTime * 0.45 + sin(uTime * 0.8 + aSeed * 40.0) * 0.35; // wind from the west, a little flutter
          p.z += cos(uTime * 0.6 + aSeed * 23.0) * 0.3;
          p.xz = uCenter.xz - uBox.x * 0.5 + mod(p.xz - (uCenter.xz - uBox.x * 0.5), uBox.x);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = min(uScale * (0.045 + aSeed * 0.04) / -mv.z, uScale * 0.005); // near flakes stay small
          vA = 0.55 + aSeed * 0.4;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vec3(0.93, 0.95, 1.0), vA * (1.0 - smoothstep(0.15, 0.5, d)));
        }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }
  /** pxPerUnit: drawing-buffer height / (2 tan(fov / 2)), so flakes keep their world size. */
  update(dt: number, center: THREE.Vector3, pxPerUnit: number) {
    this.t += dt;
    this.mat.uniforms.uTime.value = this.t;
    this.mat.uniforms.uCenter.value.copy(center);
    this.mat.uniforms.uScale.value = pxPerUnit;
  }
  dispose() { this.points.geometry.dispose(); this.mat.dispose(); }
}
