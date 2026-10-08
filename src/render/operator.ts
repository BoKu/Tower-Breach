import * as THREE from 'three';
import { Builder, merge, cloneRig } from './models';
import { currentHoliday } from '../config/holiday';
import { DEFAULT_LOOK, SKIN_TONES, type Camo, type PlayerLook } from '../config/look';

/**
 * Special-forces operator: articulated rig (hips → spine → chest → neck/head, two-segment arms and legs),
 * smooth capsule limbs and rounded kit, weapons held with two-bone IK on the grip and handguard, and a
 * distance-driven gait with upper/lower body split (legs follow movement, torso follows the aim).
 */
export type GunKind = 'rifle' | 'pistol' | 'shotgun' | 'smg' | 'lmg' | 'sniper';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0);
const clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
const gearMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.12 });
const gunMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.65 });
const emitMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

const COL = {
  uniform: 0x4b513d, uniform2: 0x3a3f30, plate: 0x6e6048, pouch: 0x5c5040, strap: 0x2b2a24, black: 0x141516, glove: 0x1b1b1c,
  skin: 0xb88c6a, helmet: 0x5e5848, boot: 0x2a2620, knee: 0x222320, metal: 0x2a2c2f, dark: 0x17181a, poly: 0x222324,
};

/** Christmas: Santa-suit police and elf enemies */
const XM = { red: 0xc41e24, red2: 0x9a161c, fur: 0xf4f1ea, gold: 0xe0b040 };
/** Easter: police in bunny costumes and dentist enemies (pastels, clinic white, nitrile-blue gloves) */
const EA = { suit: [0xf6f4f0, 0xf4c4d4, 0xd4c6ee, 0xbce8d4], white: 0xf6f4f0, pink: 0xf0a0b4, mask: 0xa6cce4, latex: 0x8eb0e6, chrome: 0xd8dde2 };

/** Two tall bunny ears (pink insides) on top of a hood, head-group space. */
function bunnyEars(hb: Builder, color: number, top: number, size = 1) {
  for (const sx of [-1, 1]) {
    const L = 0.085 * size, x = sx * 0.05, y = top + L - 0.01, rz = -sx * 0.22;
    hb.geo(new THREE.SphereGeometry(0.03, 10, 8), color, x, y, 0, 0, 0, rz, 'solid', 0.85, L / 0.03, 0.4)
      .geo(new THREE.SphereGeometry(0.02, 8, 6), EA.pink, x - sx * 0.002, y - 0.005, 0.01, 0, 0, rz, 'solid', 0.85, (L * 0.85) / 0.02, 0.3);
  }
}

/** Tapered cylinder (radius rb at the base, rt at the tip) pointing along `dir`, centred on its midpoint. */
function taper(rb: number, rt: number, len: number, dir: THREE.Vector3, seg = 10) {
  const g = new THREE.CylinderGeometry(rt, rb, len, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.clone().normalize()));
  return g;
}
/** `taper` placed by its base point; returns the tip point. */
function spike(b: Builder, color: number, base: THREE.Vector3, dir: THREE.Vector3, len: number, rb: number, rt = 0.004, seg = 10) {
  const d = dir.clone().normalize();
  const mid = base.clone().addScaledVector(d, len / 2);
  b.geo(taper(rb, rt, len, d, seg), color, mid.x, mid.y, mid.z);
  return base.clone().addScaledVector(d, len);
}

/** Floppy pointed hat (Santa / elf), head-group space: crown, trim band, cone leaning back, drooping tip with a pom-pom or bell. */
function pointyHat(hb: Builder, cone: number, band: number, tip: number, len: number, lean: number) {
  hb.geo(new THREE.SphereGeometry(0.108, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), cone, 0, 0.115, -0.006, 0, 0, 0, 'solid', 0.97, 0.85, 1.04)
    .geo(new THREE.CylinderGeometry(0.11, 0.11, 0.042, 16), band, 0, 0.122, -0.006, 0, 0, 0, 'solid', 0.97, 1, 1.04);
  const t1 = spike(hb, cone, V(0, 0.16, -0.014), V(0, Math.cos(lean), -Math.sin(lean)), len, 0.088, 0.03, 12);
  const t2 = spike(hb, cone, t1, V(0, -0.4, -1), len * 0.42, 0.03, 0.012, 8);
  hb.geo(new THREE.SphereGeometry(0.036, 10, 8), tip, t2.x, t2.y, t2.z);
}

/**
 * Player camo: uniform cloth goes to the builder's 'glass' bucket (operator rigs never use glass) and is merged into the
 * same mesh as the gear with a `camo` vertex attribute (0 = gear, 1 + part seed = cloth), so camo costs no extra draw
 * calls. The pattern is 3D value noise in the mesh's own (object) space, so it sticks to each limb as it moves.
 */
const camo = (b: Builder, on: boolean, f: () => void) => { const n = b.p.solid.length; f(); if (on) b.p.glass.push(...b.p.solid.splice(n)); };
const CAMO_PAT: Record<Camo, number> = { solid: 0, woodland: 1, desert: 2, urban: 3, tiger: 4 };
/** Pattern colours as [hue shift, saturation ×, lightness ×] off the uniform's base colour (index 0 = the base). */
const CAMO_COLS: Record<Camo, [number, number, number][]> = {
  solid: [[0, 1, 1]],
  woodland: [[0, 1, 1], [22, 1.15, 1.45], [-12, 0.9, 0.6], [0, 0.5, 0.35]],
  desert: [[0, 1, 1], [8, 0.9, 1.35], [-10, 1.1, 0.7]],
  urban: [[0, 0.25, 1], [0, 0.2, 1.5], [0, 0.2, 0.62], [0, 0.15, 0.38]],
  tiger: [[0, 1, 1], [18, 1, 1.3], [0, 0.6, 0.36]],
};
/** A colour off the look's uniform base (HSL in sRGB, like the armory's CSS swatches). */
export function uniformColor(lk: PlayerLook, dh = 0, sm = 1, lm = 1) {
  return new THREE.Color().setHSL((((lk.h + dh) % 360) + 360) % 360 / 360, Math.min(1, lk.s * sm), Math.min(0.92, lk.l * lm), THREE.SRGBColorSpace);
}
const CAMO_GLSL = `
uniform int uCamoPat; uniform float uCamoAmt; uniform vec3 uCamoC[4]; uniform float uCamoLum;
varying float vCamo; varying vec3 vCamoP;
float camoH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float camoN(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(camoH(i), camoH(i + vec3(1, 0, 0)), f.x), mix(camoH(i + vec3(0, 1, 0)), camoH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(camoH(i + vec3(0, 0, 1)), camoH(i + vec3(1, 0, 1)), f.x), mix(camoH(i + vec3(0, 1, 1)), camoH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 camoCol(vec3 p) {
  vec3 c = uCamoC[0];
  if (uCamoPat == 1) { // woodland: layered organic blobs
    if (camoN(p * 6.0) * 0.7 + camoN(p * 14.0) * 0.3 > 0.55) c = uCamoC[1];
    if (camoN(p * 7.0 + 17.0) * 0.7 + camoN(p * 16.0 + 3.0) * 0.3 > 0.6) c = uCamoC[2];
    if (camoN(p * 10.0 + 41.0) > 0.72) c = uCamoC[3];
  } else if (uCamoPat == 2) { // desert digital: blobs on a coarse pixel grid (~6 cm pixels, still readable in game)
    vec3 q = floor(p * 16.0) / 16.0;
    if (camoN(q * 6.0) * 0.7 + camoN(q * 13.0) * 0.3 > 0.5) c = uCamoC[1];
    if (camoN(q * 7.0 + 23.0) > 0.6) c = uCamoC[2];
  } else if (uCamoPat == 3) { // urban: angular grey blocks with dark splotches
    float a = camoH(floor(p * vec3(8.0, 5.0, 8.0) + camoN(p * 4.0) * 1.6));
    if (a > 0.62) c = uCamoC[1]; else if (a < 0.28) c = uCamoC[2];
    if (camoN(p * 7.0 + 9.0) > 0.72) c = uCamoC[3];
  } else if (uCamoPat == 4) { // tiger stripe: broken horizontal bands
    if (camoN(p * vec3(6.0, 2.5, 6.0) + 5.0) > 0.56) c = uCamoC[1];
    if (sin(p.y * 38.0 + camoN(p * vec3(3.0, 1.0, 3.0)) * 8.0 + camoN(p * 10.0) * 2.0) > 0.5 && camoN(p * vec3(4.0, 1.0, 4.0) + 11.0) > 0.3) c = uCamoC[2];
  }
  return c;
}`;
/** The pattern on a material (chains any earlier onBeforeCompile, e.g. the cutaway; its own program cache key). */
function withCamo<T extends THREE.Material>(m: T, u: Record<string, THREE.IUniform>): T {
  const prev = m.onBeforeCompile.bind(m), prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float camo; varying float vCamo; varying vec3 vCamoP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCamo = camo; vCamoP = position + vec3(camo * 1.73);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + CAMO_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vCamo > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, camoCol(vCamoP) * (dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) / uCamoLum), uCamoAmt);`);
  };
  m.customProgramCacheKey = () => prevKey() + '|camo';
  return m;
}
/** One look's cloth and gear materials (shared by every rig with that look; each look's rigs get their own). */
function camoMats(lk: PlayerLook) {
  const cols = CAMO_COLS[lk.camo], base = uniformColor(lk);
  const u = {
    uCamoPat: { value: CAMO_PAT[lk.camo] }, uCamoAmt: { value: lk.camo === 'solid' ? 0 : lk.contrast * 0.75 }, // capped: stays readable on dark floors
    uCamoC: { value: [0, 1, 2, 3].map((i) => { const [dh, sm, lm] = cols[i] ?? cols[0]; return uniformColor(lk, dh, sm, lm); }) },
    uCamoLum: { value: Math.max(1e-3, base.r * 0.2126 + base.g * 0.7152 + base.b * 0.0722) },
  };
  return { cloth: withCamo(clothMat.clone(), u), gear: withCamo(gearMat.clone(), u) };
}

function meshes(b: Builder, mat: THREE.Material, seed = 0): THREE.Group {
  const g = new THREE.Group();
  const tag = (l: THREE.BufferGeometry[], v: number) => l.map((x) => x.setAttribute('camo', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count).fill(v), 1)));
  const s = merge([...tag(b.p.solid, 0), ...tag(b.p.glass, 1 + seed)]);
  if (s) { const m = new THREE.Mesh(s, mat); m.castShadow = true; m.receiveShadow = true; g.add(m); }
  const e = merge(b.p.emit);
  if (e) g.add(new THREE.Mesh(e, emitMat));
  return g;
}

// ------------------------------------------------------------------ weapons
export interface GunModel { g: THREE.Group; grip: THREE.Vector3; fore: THREE.Vector3; muzzle: THREE.Vector3 }

/** Detailed weapon, +z forward, origin at the rear of the receiver (stock extends to -z). */
const guns = new Map<string, GunModel>();
/** A gun model; each kind is built once and copied after that (shared geometry; the anchor points are read-only). */
export function buildGun(kind: GunKind, torch: boolean, suppressed = false): GunModel {
  const key = kind + torch + suppressed;
  let p = guns.get(key);
  if (!p) guns.set(key, (p = makeGun(kind, torch, suppressed)));
  return { ...p, g: p.g.clone() };
}

function makeGun(kind: GunKind, torch: boolean, suppressed = false): GunModel {
  const m = makeGunBase(kind, torch);
  if (!suppressed) return m;
  // suppressor mod: a can screwed onto the muzzle (the muzzle flash point moves to its end)
  const len = kind === 'pistol' ? 0.13 : 0.17, mz = m.muzzle;
  const b = new Builder();
  b.geo(new THREE.CylinderGeometry(0.019, 0.019, len, 14), COL.black, mz.x, mz.y, mz.z + len / 2 - 0.01, Math.PI / 2);
  const g = m.g.clone(); g.add(meshes(b, gunMat));
  return { ...m, g, muzzle: V(mz.x, mz.y, mz.z + len) };
}

function makeGunBase(kind: GunKind, torch: boolean): GunModel {
  const b = new Builder();
  const C = COL;
  let fore = V(0, -0.04, 0.34), muzzle = V(0, 0.01, 0.62);
  const grip = V(0, -0.075, 0.05);
  const pistolGrip = () => b.rbox(0.035, 0.1, 0.045, 0.008, 0, -0.06, 0.04, C.poly, 0.28);
  const optic = (z: number, len = 0.1) => { b.rbox(0.04, 0.035, len, 0.008, 0, 0.065, z, C.dark); b.geo(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 12), 0x30c0ff, 0, 0.068, z + len / 2 + 0.002, Math.PI / 2, 0, 0, 'emit'); };
  const torchAt = (z: number, y: number) => { if (!torch) return; b.geo(new THREE.CylinderGeometry(0.017, 0.017, 0.09, 10), C.dark, 0.035, y, z, Math.PI / 2); b.geo(new THREE.CylinderGeometry(0.015, 0.015, 0.01, 10), 0xfff4d8, 0.035, y, z + 0.047, Math.PI / 2, 0, 0, 'emit'); };
  switch (kind) {
    case 'rifle':
      b.rbox(0.045, 0.07, 0.22, 0.012, 0, -0.005, -0.12, C.poly); // stock
      b.rbox(0.03, 0.05, 0.06, 0.01, 0, -0.035, -0.22, C.black); // butt pad
      b.rbox(0.055, 0.085, 0.26, 0.012, 0, 0, 0.1, C.metal); // receiver
      b.rbox(0.058, 0.07, 0.24, 0.015, 0, 0, 0.34, C.poly); // handguard
      b.geo(new THREE.CylinderGeometry(0.011, 0.011, 0.16, 8), C.dark, 0, 0.008, 0.54, Math.PI / 2);
      b.rbox(0.03, 0.12, 0.05, 0.008, 0, -0.1, 0.14, C.dark, -0.2); // magazine
      pistolGrip(); optic(0.08); torchAt(0.4, -0.02);
      muzzle = V(0, 0.008, 0.63);
      break;
    case 'smg':
      b.rbox(0.035, 0.05, 0.16, 0.01, 0, -0.005, -0.08, C.poly);
      b.rbox(0.05, 0.08, 0.22, 0.012, 0, 0, 0.09, C.metal);
      b.geo(new THREE.CylinderGeometry(0.013, 0.013, 0.12, 8), C.dark, 0, 0.005, 0.26, Math.PI / 2);
      b.rbox(0.028, 0.14, 0.04, 0.008, 0, -0.1, 0.06, C.dark);
      pistolGrip(); optic(0.06, 0.07); torchAt(0.2, -0.02);
      fore = V(0, -0.04, 0.2); muzzle = V(0, 0.005, 0.33);
      break;
    case 'shotgun':
      b.rbox(0.045, 0.075, 0.24, 0.014, 0, -0.01, -0.12, C.poly);
      b.rbox(0.055, 0.08, 0.2, 0.012, 0, 0, 0.08, C.metal);
      b.geo(new THREE.CylinderGeometry(0.016, 0.016, 0.52, 10), C.dark, 0, 0.02, 0.42, Math.PI / 2);
      b.geo(new THREE.CylinderGeometry(0.018, 0.018, 0.44, 10), C.metal, 0, -0.018, 0.38, Math.PI / 2);
      b.rbox(0.055, 0.05, 0.13, 0.014, 0, -0.02, 0.36, C.poly); // pump
      pistolGrip(); torchAt(0.46, -0.03);
      fore = V(0, -0.05, 0.36); muzzle = V(0, 0.02, 0.68);
      break;
    case 'sniper':
      b.rbox(0.05, 0.09, 0.26, 0.014, 0, -0.01, -0.13, 0x3a3a2c);
      b.rbox(0.055, 0.08, 0.3, 0.012, 0, 0, 0.12, C.metal);
      b.geo(new THREE.CylinderGeometry(0.012, 0.014, 0.6, 10), C.dark, 0, 0.01, 0.56, Math.PI / 2);
      b.geo(new THREE.CylinderGeometry(0.024, 0.024, 0.26, 12), C.dark, 0, 0.085, 0.12, Math.PI / 2); // scope
      b.geo(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 12), 0x30c0ff, 0, 0.085, 0.255, Math.PI / 2, 0, 0, 'emit');
      b.rbox(0.03, 0.08, 0.05, 0.008, 0, -0.08, 0.14, C.dark);
      pistolGrip(); torchAt(0.4, -0.03);
      fore = V(0, -0.045, 0.34); muzzle = V(0, 0.01, 0.86);
      break;
    case 'lmg':
      b.rbox(0.05, 0.08, 0.22, 0.014, 0, -0.01, -0.11, C.poly);
      b.rbox(0.075, 0.1, 0.32, 0.014, 0, 0.005, 0.13, C.metal);
      b.rbox(0.09, 0.1, 0.1, 0.01, 0.01, -0.1, 0.12, 0x3a3a2a); // ammo box
      b.geo(new THREE.CylinderGeometry(0.017, 0.017, 0.42, 10), C.dark, 0, 0.01, 0.5, Math.PI / 2);
      b.rbox(0.03, 0.03, 0.14, 0.008, 0, 0.075, 0.12, C.dark); // carry handle
      pistolGrip(); torchAt(0.4, -0.03);
      fore = V(0, -0.05, 0.36); muzzle = V(0, 0.01, 0.72);
      break;
    case 'pistol':
      b.rbox(0.032, 0.036, 0.19, 0.008, 0, 0.02, 0.06, C.dark); // slide
      b.rbox(0.03, 0.03, 0.15, 0.008, 0, -0.006, 0.05, C.poly); // frame
      b.rbox(0.032, 0.11, 0.05, 0.01, 0, -0.06, -0.01, C.poly, 0.22);
      torchAt(0.1, -0.03);
      fore = V(0.0, -0.065, 0.0); muzzle = V(0, 0.02, 0.16);
      return { g: meshes(b, gunMat), grip: V(0, -0.06, -0.005), fore, muzzle };
  }
  return { g: meshes(b, gunMat), grip, fore, muzzle };
}

// ------------------------------------------------------------------ the rig
export interface RigInput {
  dt: number; t: number;
  x: number; y: number; z: number; facing: number;
  crouch: boolean; aiming: boolean; sprinting: boolean; firingRecently: boolean;
  life: 'alive' | 'down' | 'out' | 'dead';
  gun: GunKind | null; // null = knife
  aimPitch: number; // radians, + = down
  reload: number; // 0..1 progress, -1 when not reloading
  hurt: boolean;
  /** free-hand arm behaviour for unarmed NPCs (police): natural swing or a held pose */
  pose?: 'swing' | 'fold' | 'talk' | 'brief' | 'lean' | 'apose';
  /** thumbing the shoulder radio */
  radio?: boolean;
  /** visual ground height under the feet (stair flights) */
  ground?: number;
  /** explicit velocity (world units/s) instead of position deltas: animate in place (sandbox) */
  vel?: { vx: number; vy: number };
}

export type Outfit = 'operator' | 'police' | 'loyalist' | 'loyalistElite' | 'cyborg' | 'cyborgElite';
/** player: the operator's chosen appearance (operator outfit only; cosmetic, holiday themes never touch it) */
export interface RigOpts { outfit?: Outfit; skin?: number; look?: OfficerLook; zombie?: boolean; player?: PlayerLook }

/** The player operator's fixed kit: two-tone coyote / ranger green with webbing and metal hardware (enemies keep theirs). */
const KIT = { plate: 0x7a6748, plate2: 0x6a5a3e, pouch: 0x4c5438, flap: 0x3e4530, web: 0x2e3026, metal: 0x8e9196, helmet: 0x565b40, glove: 0x2a2824, boot: 0x5a4a36, knee: 0x3a3e30 };

/** Individual police look (street NPCs + portraits). Every field is optional; defaults are the standard issue. */
export interface OfficerLook {
  skin?: number;
  hat?: 'cap' | 'chief' | 'bare' | 'beanie' | 'helmet';
  hair?: 'short' | 'buzz' | 'bald' | 'long' | 'bun' | 'curly' | 'ponytail';
  hairColor?: number;
  facial?: 'none' | 'moustache' | 'beard' | 'goatee' | 'stubble' | 'mutton';
  facialColor?: number;
  eyes?: 'none' | 'glasses' | 'shades' | 'aviators';
  extra?: 'none' | 'earpiece' | 'scar' | 'headset' | 'bandage' | 'earring';
}

/** Police head from a look, in head-group space (head sphere r ≈ 0.1 centred at y 0.06, face towards +z). bunny = the Easter costume's hood colour. */
function policeHead(hb: Builder, skin: number, lk: OfficerLook, santa = false, bunny?: number) {
  // Christmas: every hat becomes a Santa hat (a beanie-like fit over the hair); Easter: a bunny hood hides hat and hair
  const hat = santa ? 'beanie' : lk.hat ?? 'cap', hair = bunny !== undefined ? 'bald' : lk.hair ?? 'short', hc = lk.hairColor ?? 0x2a2018, fc = lk.facialColor ?? hc;
  const S = (r: number, c: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => hb.geo(new THREE.SphereGeometry(r, 12, 9), c, x, y, z, 0, 0, 0, 'solid', sx, sy, sz);
  // hair (the part a cap leaves showing, or the full style bare-headed)
  if (hair !== 'bald') {
    const cover = hat === 'bare' || hat === 'beanie' ? 0.52 : 0.45;
    hb.geo(new THREE.SphereGeometry(0.108, 14, 10, 0, Math.PI * 2, 0, Math.PI * cover), hc, 0, 0.065, -0.006, 0, 0, 0, 'solid', 0.94, hair === 'buzz' ? 0.98 : 1.03, 1.04);
    if (hair === 'curly' && hat === 'bare') for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; S(0.032, hc, Math.cos(a) * 0.075, 0.13 + (i % 2) * 0.02, Math.sin(a) * 0.075 - 0.01); }
    if (hair === 'long') hb.rbox(0.19, 0.16, 0.06, 0.03, 0, 0.02, -0.07, hc);
    if (hair === 'bun') S(0.045, hc, 0, hat === 'bare' ? 0.15 : 0.1, -0.1);
    if (hair === 'ponytail') { S(0.035, hc, 0, 0.1, -0.1); hb.geo(new THREE.CapsuleGeometry(0.025, 0.12, 4, 8), hc, 0, 0.02, -0.12, 0.35); }
    for (const sx of [-1, 1]) hb.rbox(0.012, 0.05, 0.03, 0.006, sx * 0.093, 0.06, 0.02, hc); // sideburns
  }
  // face
  hb.geo(new THREE.SphereGeometry(0.012, 6, 5), 0x1a1410, -0.035, 0.075, 0.094).geo(new THREE.SphereGeometry(0.012, 6, 5), 0x1a1410, 0.035, 0.075, 0.094); // eyes
  hb.rbox(0.025, 0.035, 0.03, 0.01, 0, 0.05, 0.1, skin); // nose
  hb.rbox(0.05, 0.008, 0.01, 0.004, 0, 0.018, 0.097, 0x6a3a30); // mouth
  for (const sx of [-1, 1]) hb.rbox(0.03, 0.008, 0.01, 0.003, sx * 0.035, 0.1, 0.098, hair === 'bald' ? 0x3a2a20 : hc); // brows
  const facial0 = lk.facial ?? 'none';
  const xbeard = santa && facial0 !== 'none' && facial0 !== 'stubble';
  const facial = xbeard ? 'none' : facial0;
  if (facial === 'moustache' || facial === 'mutton') hb.rbox(0.065, 0.016, 0.018, 0.007, 0, 0.032, 0.103, fc);
  if (facial === 'mutton') for (const sx of [-1, 1]) hb.rbox(0.025, 0.06, 0.03, 0.01, sx * 0.08, 0.02, 0.055, fc);
  if (facial === 'goatee') hb.rbox(0.04, 0.035, 0.025, 0.01, 0, -0.005, 0.09, fc).rbox(0.05, 0.012, 0.015, 0.005, 0, 0.032, 0.102, fc);
  if (facial === 'beard') hb.geo(new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.35), fc, 0, 0.055, 0.012, 0, 0, 0, 'solid', 0.94, 1.1, 1.06).rbox(0.065, 0.016, 0.018, 0.007, 0, 0.032, 0.104, fc);
  if (xbeard) {
    // the whiskered ones grow a white Santa beard: wraps the jaw, fluffy puffs at the chin, curled moustache
    const W = XM.fur;
    hb.geo(new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48), W, 0, 0.062, 0.018, 0, 0, 0, 'solid', 0.98, 1.3, 1.12);
    S(0.055, W, 0, -0.045, 0.07); S(0.042, W, -0.045, -0.02, 0.066); S(0.042, W, 0.045, -0.02, 0.066); S(0.038, W, 0, -0.1, 0.045);
    S(0.026, W, -0.026, 0.033, 0.1, 1.4, 0.7, 0.8); S(0.026, W, 0.026, 0.033, 0.1, 1.4, 0.7, 0.8);
  } else if (facial === 'stubble') hb.geo(new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, Math.PI * 0.6, Math.PI * 0.3), new THREE.Color(skin).lerp(new THREE.Color(fc), 0.4).getHex(), 0, 0.056, 0.012, 0, 0, 0, 'solid', 0.92, 1.06, 1.03);
  // eyewear
  const eyes = lk.eyes ?? 'none';
  if (eyes !== 'none') {
    const lens = eyes === 'glasses' ? 0x9ac0cc : 0x0c0e12, frame = eyes === 'aviators' ? 0xc8a050 : 0x141516;
    for (const sx of [-1, 1]) {
      hb.rbox(eyes === 'aviators' ? 0.042 : 0.036, eyes === 'aviators' ? 0.032 : 0.026, 0.006, 0.008, sx * 0.037, 0.076, 0.104, frame);
      hb.rbox(eyes === 'aviators' ? 0.036 : 0.03, eyes === 'aviators' ? 0.026 : 0.02, 0.004, 0.006, sx * 0.037, 0.076, 0.108, lens);
      hb.box(0.004, 0.004, 0.09, sx * 0.09, 0.08, 0.06, frame);
    }
    hb.box(0.02, 0.004, 0.004, 0, 0.08, 0.106, frame);
  }
  // hats
  if (santa) pointyHat(hb, XM.red, XM.fur, XM.fur, 0.2, 0.75);
  else if (bunny !== undefined) {
    // costume hood framing the face (open at the front), tall ears on top: the Chief's are the biggest
    hb.geo(new THREE.SphereGeometry(0.124, 16, 12, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.82), bunny, 0, 0.065, -0.008)
      .geo(new THREE.SphereGeometry(0.124, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.3), bunny, 0, 0.065, -0.008)
      .geo(new THREE.TorusGeometry(0.1, 0.016, 6, 18, Math.PI * 1.25), EA.white, 0, 0.06, 0.07, 0, 0, -Math.PI * 0.125); // fluffy trim round the face
    bunnyEars(hb, bunny, 0.18, hat === 'chief' ? 2.1 : 1.5);
  } else if (hat === 'cap' || hat === 'chief') {
    hb.geo(new THREE.CylinderGeometry(0.12, 0.105, 0.075, 18), 0x121a30, 0, 0.16, 0) // crown
      .geo(new THREE.CylinderGeometry(0.105, 0.105, 0.03, 18), hat === 'chief' ? 0xd9b040 : 0x141516, 0, 0.125, 0) // band (gold for the Chief)
      .rbox(0.17, 0.012, 0.08, 0.005, 0, 0.115, 0.1, 0x141516, 0.15) // visor
      .rbox(0.035, 0.04, 0.01, 0.004, 0, 0.16, 0.115, 0xd9c070); // badge
    if (hat === 'chief') hb.rbox(0.15, 0.01, 0.012, 0.004, 0, 0.123, 0.137, 0xe8c050, 0.15); // gold braid on the visor
  } else if (hat === 'beanie') {
    hb.geo(new THREE.SphereGeometry(0.114, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), 0x1c2238, 0, 0.08, -0.004, 0, 0, 0, 'solid', 0.97, 1.02, 1.04).geo(new THREE.CylinderGeometry(0.11, 0.11, 0.035, 18), 0x151a2c, 0, 0.09, -0.003);
  } else if (hat === 'helmet') {
    hb.geo(new THREE.SphereGeometry(0.13, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), 0x1a2238, 0, 0.08, 0, 0, 0, 0, 'solid', 1, 0.92, 1.08).rbox(0.2, 0.022, 0.24, 0.01, 0, 0.078, 0, 0x0e1220)
      .rbox(0.18, 0.02, 0.05, 0.008, 0, 0.17, 0.09, 0x2a3a5a, -0.9); // visor, flipped up onto the brim
  }
  // extras
  const extra = lk.extra ?? 'none';
  if (extra === 'earpiece') hb.geo(new THREE.SphereGeometry(0.014, 6, 5), 0x141516, 0.1, 0.06, 0.02).box(0.004, 0.08, 0.004, 0.1, 0.0, 0.0, 0x141516);
  if (extra === 'headset') hb.geo(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), 0x141516, 0.108, 0.06, 0, 0, 0, Math.PI / 2).rbox(0.07, 0.008, 0.008, 0.003, 0.08, 0.02, 0.07, 0x141516, 0, -0.6);
  if (extra === 'scar') hb.box(0.006, 0.05, 0.004, 0.05, 0.07, 0.1, 0xb06a60, 'solid', 0, 0, 0.35);
  if (extra === 'bandage') hb.rbox(0.035, 0.022, 0.006, 0.004, -0.055, 0.1, 0.09, 0xf0ece0, 0, 0.4);
  if (extra === 'earring') hb.geo(new THREE.TorusGeometry(0.01, 0.003, 4, 10), 0xd9b040, -0.1, 0.03, 0.02, 0, Math.PI / 2);
}

const L_UP = 0.3, L_FORE = 0.29, L_THIGH = 0.45, L_SHIN = 0.45;

/** Combat knife along +z (grip centred on the origin): clip-point blade, dark coating with a honed edge, crossguard, ridged grip, pommel. */
function combatKnife(): Builder {
  const b = new Builder();
  // blade outline (length along u, height along v), extruded thin, then turned so its length runs along +z
  const sh = new THREE.Shape();
  sh.moveTo(0, -0.015);
  sh.lineTo(0.11, -0.016);
  sh.quadraticCurveTo(0.165, -0.012, 0.175, 0.004); // belly up to the tip
  sh.lineTo(0.13, 0.009); // clip point back to the spine
  sh.lineTo(0, 0.012);
  sh.lineTo(0, -0.015);
  const blade = new THREE.ExtrudeGeometry(sh, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0015, bevelSegments: 1 });
  blade.rotateY(-Math.PI / 2);
  blade.translate(0.0015, 0, 0.058);
  b.geo(blade, 0x2c3035, 0, 0, 0);
  b.box(0.0045, 0.004, 0.13, 0, -0.0135, 0.115, 0xc9d0d6); // honed edge
  b.box(0.012, 0.052, 0.012, 0, -0.002, 0.054, 0x3a3d42); // crossguard
  b.geo(new THREE.CylinderGeometry(0.0125, 0.0115, 0.1, 12), 0x18191b, 0, 0, 0, Math.PI / 2, 0, 0, 'solid', 0.8, 1, 1); // grip
  for (const z of [-0.025, 0, 0.025]) b.geo(new THREE.CylinderGeometry(0.0135, 0.0135, 0.006, 12), 0x26282b, 0, 0, z, Math.PI / 2, 0, 0, 'solid', 0.8, 1, 1); // finger ridges
  b.rbox(0.02, 0.026, 0.014, 0.005, 0, 0, -0.055, 0x3a3d42); // pommel
  return b;
}

export class OperatorRig {
  root = new THREE.Group();
  private model = new THREE.Group();
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private chest = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private arm = { L: { up: new THREE.Group(), fore: new THREE.Group(), hand: new THREE.Group(), sh: V(-0.2, 0.33, 0.01) }, R: { up: new THREE.Group(), fore: new THREE.Group(), hand: new THREE.Group(), sh: V(0.2, 0.33, 0.01) } };
  private leg = { L: { thigh: new THREE.Group(), shin: new THREE.Group(), foot: new THREE.Group() }, R: { thigh: new THREE.Group(), shin: new THREE.Group(), foot: new THREE.Group() } };
  private gunHolder = new THREE.Group();
  private gun: GunModel | null = null;
  private gunKind: GunKind | null | undefined = undefined;
  private knife: THREE.Group;
  /** player's right hand: open (holding guns) or a fist (holding the knife) */
  private hands: { open: THREE.Object3D; fist: THREE.Object3D } | null = null;
  private strobe: THREE.Mesh;
  // animation state
  private phase = 0;
  private lastX = NaN; private lastY = NaN;
  private vel = V(0, 0, 0);
  private hipYaw = 0;
  private crouchK = 0; private airK = 0; private aimK = 0; private sprintK = 0;
  private kick = 0; private throwT = 0; private slashT = 0; private downK = 0;
  torchOn = false;

  readonly outfit: Outfit;
  /** Halloween undead loyalist/cyborg: rotting skin, torn clothes, no gun, arms-out shamble and claw swipes */
  readonly zombie: boolean;
  private static protos = new Map<string, OperatorRig>();
  /** A rig with this look: built from primitives once per look (and holiday), copied after that. */
  static make(teamColor: number, opts: RigOpts = {}): OperatorRig {
    const key = JSON.stringify([teamColor, opts, currentHoliday()]);
    let p = OperatorRig.protos.get(key);
    if (!p) OperatorRig.protos.set(key, (p = new OperatorRig(teamColor, opts)));
    const r = cloneRig(p);
    r.strobe.material = (p.strobe.material as THREE.Material).clone(); // pulses per rig
    return r;
  }

  constructor(private teamColor: number, opts: RigOpts = {}) {
    const outfit = (this.outfit = opts.outfit ?? 'operator');
    const op = outfit === 'operator', lk = opts.player ?? DEFAULT_LOOK;
    const cop = outfit === 'police';
    const loy = outfit === 'loyalist' || outfit === 'loyalistElite';
    const cyb = outfit === 'cyborg' || outfit === 'cyborgElite';
    const elite = outfit.endsWith('Elite');
    const zom = (this.zombie = !!opts.zombie && (loy || cyb));
    // per-outfit palette over the operator's
    const P = { ...COL };
    if (loy) Object.assign(P, elite
      ? { uniform: 0x26272b, uniform2: 0x1c1d20, plate: 0x1b1c1f, pouch: 0x232428, strap: 0x111214, helmet: 0x1a1b1e, knee: 0x151618 }
      : { uniform: 0x4f5864, uniform2: 0x3c434d, plate: 0x30353c, pouch: 0x3b414a, strap: 0x1e2126, helmet: 0x2b303a, knee: 0x22252a });
    if (cyb) Object.assign(P, { uniform: 0x25272b, uniform2: 0x1b1c1f, plate: elite ? 0x4a1016 : 0x3b4046, pouch: 0x2c2f34, strap: 0x151619, helmet: 0x2a2d31, glove: 0x7d858c, boot: 0x1a1a1c, knee: 0x6d757c });
    // the player operator: uniform from the chosen look, own camo materials (one pair per look), fixed refreshed kit
    const M = op ? camoMats(lk) : { cloth: clothMat, gear: gearMat };
    if (op) Object.assign(P, { uniform: uniformColor(lk).getHex(THREE.SRGBColorSpace), uniform2: uniformColor(lk, 0, 1, 0.82).getHex(THREE.SRGBColorSpace), plate: KIT.plate, pouch: KIT.pouch, strap: KIT.web, helmet: KIT.helmet, glove: KIT.glove, boot: KIT.boot, knee: KIT.knee });
    let skin = opts.player ? SKIN_TONES[lk.skin] : opts.look?.skin ?? opts.skin ?? P.skin;
    if (zom) {
      // grave-dirt rags over the outfit's colours; grey-green rot keeps a hint of the living skin tone
      skin = new THREE.Color(skin).lerp(new THREE.Color(0x72866a), 0.8).getHex();
      Object.assign(P, cyb ? { uniform: 0x2e2c28, uniform2: 0x221f1c, boot: 0x1e1c1a } : { uniform: elite ? 0x2c2a28 : 0x4a5058, uniform2: elite ? 0x1e1d1c : 0x34353a, boot: 0x2a241c });
      P.glove = skin; // bare clawed hands
    }
    const BLOOD = 0x4e0c0a, ROT = 0x3e4a30;
    // Christmas: street police wear Santa suits; loyalists and cyborgs are Santa's (still armed) elves
    const xmas = currentHoliday() === 'xmas';
    const santa = cop && xmas, elf = (loy || cyb) && !zom && xmas;
    // Easter: police wear bunny ears; loyalists and cyborgs are (still armed) dentists
    const easter = currentHoliday() === 'easter';
    const bunny = cop && easter, dentist = (loy || cyb) && !zom && easter;
    // dentist palette: white coats over pale-blue scrubs (cyborgs: mint scrubs), seniors in navy coats with a gold badge
    const D = elite
      ? { coat: 0x1e2a4c, coat2: 0x151e38, scrub: cyb ? 0x8ed2c0 : 0x9cc6e6, badge: XM.gold }
      : cyb ? { coat: 0x8ed2c0, coat2: 0x72b8a6, scrub: 0x8ed2c0, badge: EA.white } : { coat: 0xeef1f3, coat2: 0xd2d9df, scrub: 0x9cc6e6, badge: 0xd8e8f4 };
    const scrubs = dentist && cyb && !elite; // the cyborg junior works in scrubs, no coat
    if (dentist) Object.assign(P, { uniform: D.coat, uniform2: D.coat2, glove: EA.latex, boot: 0xe6e9ec });
    const DGLOW = 0x40d8ff; // cyborg dentists' implants glow clinical cyan
    // bunny onesie colour per officer (white, pink, lavender, mint), a shade darker for seams
    const SUIT = EA.suit[((opts.look?.skin ?? skin) >> 3) % EA.suit.length], SUIT2 = new THREE.Color(SUIT).multiplyScalar(0.88).getHex();
    const chief = opts.look?.hat === 'chief';
    const NAVY = santa ? XM.red : bunny ? SUIT : 0x1f3668, NAVY2 = santa ? XM.red2 : bunny ? SUIT2 : 0x15264a, TROUSER = santa ? XM.red : bunny ? SUIT : 0x161e36;
    // elf palette: green tunics with red stockings; elites in red with gold trim and green stockings
    const E = elite
      ? { coat: XM.red, coat2: XM.red2, trim: XM.gold, stripe: 0x1e7a34, shoe: 0x1e6a2e, glove: 0x5a1010, hat: XM.red, band: XM.gold }
      : { coat: cyb ? 0x1c7034 : 0x2a9a40, coat2: cyb ? 0x145428 : 0x1f7a32, trim: XM.fur, stripe: XM.red, shoe: XM.red2, glove: 0x1e4a22, hat: cyb ? 0x1c7034 : 0x2a9a40, band: XM.red };
    const GLOW = elite ? 0xffc030 : 0x40ff70; // cyborg elves' implants glow festive green (gold for elites)
    const bell = elite || ((skin >> 4) & 1) === 1; // some elves have a bell on the hat tip, the rest a pom-pom
    this.root.add(this.model);
    this.model.scale.setScalar((outfit === 'cyborgElite' ? 1.28 : outfit === 'cyborg' ? 1.23 : 1.2) * (elf ? 0.9 : 1)); // heroic scale: reads clearly from the isometric camera (collision radius unchanged); elves a little shorter
    this.model.add(this.hips);
    this.hips.position.y = L_THIGH + L_SHIN + 0.07;
    // pelvis + belt
    const pb = new Builder();
    if (santa) {
      // Santa coat skirt over the hips with a white fur hem, wide black belt, big gold buckle
      pb.rbox(0.36, 0.22, 0.24, 0.07, 0, -0.01, 0, XM.red)
        .rbox(0.39, 0.055, 0.27, 0.025, 0, -0.11, 0, XM.fur)
        .rbox(0.39, 0.07, 0.27, 0.02, 0, 0.08, 0, P.black)
        .rbox(0.09, 0.08, 0.02, 0.012, 0, 0.08, 0.14, XM.gold).rbox(0.05, 0.035, 0.02, 0.008, 0, 0.08, 0.144, P.black);
    } else if (elf) {
      // tunic skirt with a jagged hem of points, belt and buckle
      pb.rbox(0.36, 0.22, 0.24, 0.07, 0, -0.01, 0, E.coat)
        .rbox(0.37, 0.06, 0.25, 0.02, 0, 0.08, 0, 0x2a1a10)
        .rbox(0.07, 0.06, 0.02, 0.01, 0, 0.08, 0.135, XM.gold);
      if (elite) pb.rbox(0.37, 0.025, 0.25, 0.01, 0, -0.1, 0, E.trim);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; spike(pb, i % 2 ? E.coat : E.coat2, V(Math.sin(a) * 0.16, -0.1, Math.cos(a) * 0.11), V(Math.sin(a) * 0.3, -1, Math.cos(a) * 0.3), 0.1, 0.045, 0.004, 4); }
    } else if (dentist) {
      // scrub trousers with a drawstring, the coat's skirt hanging over them (shorter tunic hem in scrubs)
      pb.rbox(0.33, 0.2, 0.21, 0.07, 0, 0, 0, D.scrub).rbox(0.02, 0.07, 0.01, 0.004, 0.02, 0.06, 0.112, EA.white);
      if (scrubs) pb.rbox(0.36, 0.1, 0.24, 0.04, 0, 0.06, 0, D.coat);
      else pb.rbox(0.37, 0.3, 0.25, 0.06, 0, -0.04, -0.005, D.coat).rbox(0.02, 0.3, 0.012, 0.004, 0, -0.04, 0.125, D.coat2); // coat tails, front opening
    } else if (cop) {
      pb.rbox(0.33, 0.2, 0.21, 0.07, 0, 0, 0, TROUSER)
        .rbox(0.37, 0.055, 0.24, 0.02, 0, 0.08, 0, P.black) // duty belt
        .rbox(0.05, 0.12, 0.07, 0.015, 0.19, 0.02, 0.0, P.black).rbox(0.03, 0.05, 0.08, 0.01, 0.19, 0.1, 0.02, P.dark) // holstered sidearm
        .rbox(0.05, 0.06, 0.04, 0.012, 0.13, 0.07, 0.12, P.black) // cuff pouch
        .rbox(0.04, 0.07, 0.04, 0.012, -0.17, 0.06, 0.08, P.black) // spray
        .rbox(0.03, 0.03, 0.01, 0.005, -0.02, 0.085, 0.125, 0xc9b060); // buckle
      if (bunny) pb.geo(new THREE.SphereGeometry(0.06, 10, 8), EA.white, 0, -0.02, -0.13); // pom-pom tail
    } else if (op) {
      camo(pb, true, () => pb.rbox(0.34, 0.2, 0.22, 0.07, 0, 0.0, 0, P.uniform2));
      pb.rbox(0.38, 0.06, 0.25, 0.02, 0, 0.08, 0, KIT.web) // belt
        .rbox(0.06, 0.045, 0.02, 0.008, 0, 0.08, 0.13, KIT.metal).rbox(0.03, 0.02, 0.022, 0.005, 0, 0.08, 0.132, KIT.web) // buckle
        .rbox(0.07, 0.1, 0.05, 0.015, 0.2, 0.02, 0.02, KIT.pouch).rbox(0.075, 0.03, 0.056, 0.01, 0.2, 0.07, 0.02, KIT.flap) // hip pouch + flap
        .rbox(0.15, 0.09, 0.05, 0.02, 0, 0.02, -0.13, KIT.pouch).rbox(0.155, 0.025, 0.055, 0.008, 0, 0.065, -0.13, KIT.flap) // dump pouch
        .rbox(0.06, 0.12, 0.04, 0.015, -0.2, 0.0, 0.04, P.black); // drop holster
    } else {
      pb.rbox(0.34, 0.2, 0.22, 0.07, 0, 0.0, 0, P.uniform2)
        .rbox(0.38, 0.06, 0.25, 0.02, 0, 0.08, 0, P.strap)
        .rbox(0.07, 0.1, 0.05, 0.015, 0.2, 0.02, 0.02, P.pouch);
      if (zom) pb.rbox(0.12, 0.1, 0.02, 0.02, 0.06, -0.02, 0.112, BLOOD); // blood-soaked trousers
      else pb.rbox(0.06, 0.12, 0.04, 0.015, -0.2, 0.0, 0.04, P.black); // drop holster
    }
    this.hips.add(meshes(pb, M.cloth));
    this.hips.add(this.spine);
    this.spine.position.y = 0.08;
    this.spine.add(this.chest);
    this.chest.position.y = 0.12;
    const cb = new Builder();
    if (santa) {
      // red Santa coat: fur placket and collar, the badge pinned on, shoulder radio kept
      cb.limb(0.145, 0.64, 0, 0.44, 0, XM.red, 0, 0, 1.25, 0.78)
        .rbox(0.065, 0.42, 0.03, 0.014, 0, 0.21, 0.106, XM.fur)
        .rbox(0.22, 0.075, 0.18, 0.035, 0, 0.45, 0, XM.fur)
        .rbox(0.06, 0.07, 0.012, 0.006, -0.1, 0.3, 0.098, 0xd9c070) // badge
        .rbox(0.045, 0.065, 0.035, 0.01, -0.13, 0.4, 0.1, P.black) // shoulder mic
        .geo(new THREE.CylinderGeometry(0.004, 0.004, 0.08), P.black, -0.13, 0.46, 0.1);
    } else if (elf) {
      // tunic with a pointed collar and gold buttons
      cb.limb(0.145, 0.64, 0, 0.44, 0, E.coat, 0, 0, 1.25, 0.8).rbox(0.07, 0.36, 0.02, 0.01, 0, 0.22, 0.108, E.coat2);
      for (let i = 0; i < 3; i++) cb.geo(new THREE.SphereGeometry(0.017, 8, 6), XM.gold, 0, 0.32 - i * 0.1, 0.12);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; spike(cb, i % 2 ? E.trim : E.coat2, V(Math.sin(a) * 0.08, 0.45, Math.cos(a) * 0.065), V(Math.sin(a), -0.7, Math.cos(a)), 0.11, 0.04, 0.004, 4); }
      if (elite) cb.rbox(0.3, 0.022, 0.012, 0.005, 0, 0.06, 0.112, E.trim);
      if (cyb) {
        // spinal implant and a festive glowing core
        cb.rbox(0.08, 0.36, 0.06, 0.02, 0, 0.26, -0.13, 0x8a9096);
        for (const x of [-0.08, 0.08]) cb.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 6), 0x111214, x, 0.3, -0.12, 0.2, 0, 0);
        cb.rbox(0.05, 0.05, 0.015, 0.01, 0.08, 0.3, 0.11, GLOW, 0, 0, 0.4, 'emit');
      }
    } else if (dentist) {
      // clinic coat (or scrub top): lapels, name badge, breast pocket with pens; cyborgs keep the spine implant and core
      cb.limb(0.145, 0.64, 0, 0.44, 0, D.coat, 0, 0, 1.25, 0.8)
        .rbox(0.07, 0.08, 0.012, 0.006, -0.1, 0.24, 0.115, D.coat2) // breast pocket
        .rbox(0.07, 0.022, 0.012, 0.004, 0.1, 0.33, 0.118, D.badge); // name badge
      for (const [x, c] of [[-0.115, 0x2050c0], [-0.095, 0xc02020]] as [number, number][]) cb.geo(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 6), c, x, 0.29, 0.118);
      if (scrubs) cb.rbox(0.08, 0.014, 0.012, 0.004, -0.032, 0.42, 0.108, D.coat2, 0, 0, -0.6).rbox(0.08, 0.014, 0.012, 0.004, 0.032, 0.42, 0.108, D.coat2, 0, 0, 0.6); // V-neck
      else for (const sx of [-1, 1]) cb.rbox(0.07, 0.24, 0.014, 0.006, sx * 0.05, 0.33, 0.112, D.coat2, 0, 0, sx * 0.25); // lapels
      if (cyb) {
        cb.rbox(0.08, 0.36, 0.06, 0.02, 0, 0.26, -0.13, 0x8a9096);
        cb.rbox(0.05, 0.05, 0.015, 0.01, 0.07, 0.18, 0.11, DGLOW, 0, 0, 0, 'emit');
        // a giant toothbrush slung across the back: handle, bristle head
        cb.geo(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 8), 0x40a0e0, 0, 0.26, -0.17, 0, 0, 0.7).rbox(0.07, 0.11, 0.035, 0.01, -0.2, 0.5, -0.17, 0x40a0e0, 0, 0, 0.7)
          .rbox(0.06, 0.12, 0.05, 0.01, -0.21, 0.51, -0.2, EA.white, 0, 0, 0.7);
      }
    } else if (bunny) {
      // bunny onesie: white tummy patch, zip, badge (gold for the Chief) and shoulder radio kept on
      cb.limb(0.15, 0.64, 0, 0.44, 0, SUIT, 0, 0, 1.25, 0.8)
        .geo(new THREE.SphereGeometry(0.1, 12, 10), SUIT === EA.white ? 0xf8dce4 : EA.white, 0, 0.2, 0.06, 0, 0, 0, 'solid', 1.2, 1.5, 0.75) // tummy patch
        .rbox(0.012, 0.36, 0.01, 0.004, 0, 0.27, 0.118, SUIT2) // zip
        .rbox(0.07, 0.08, 0.012, 0.006, -0.1, 0.34, 0.112, chief ? XM.gold : 0xd9c070) // badge
        .rbox(0.045, 0.065, 0.035, 0.01, -0.13, 0.42, 0.1, P.black) // shoulder mic
        .geo(new THREE.CylinderGeometry(0.004, 0.004, 0.08), P.black, -0.13, 0.48, 0.1);
    } else if (cop) {
      // uniform shirt, slim duty vest, badge, name bar, epaulettes, shoulder radio
      cb.limb(0.145, 0.64, 0, 0.44, 0, NAVY, 0, 0, 1.25, 0.78)
        .rbox(0.36, 0.3, 0.07, 0.03, 0, 0.24, 0.085, NAVY2).rbox(0.34, 0.28, 0.06, 0.03, 0, 0.25, -0.085, NAVY2)
        .rbox(0.07, 0.08, 0.012, 0.006, -0.1, 0.32, 0.125, 0xd9c070) // badge
        .rbox(0.08, 0.02, 0.01, 0.004, 0.1, 0.33, 0.125, 0xd8d8d8) // name bar
        .rbox(0.11, 0.025, 0.1, 0.008, 0.2, 0.43, 0, NAVY2).rbox(0.11, 0.025, 0.1, 0.008, -0.2, 0.43, 0, NAVY2) // epaulettes
        .rbox(0.045, 0.065, 0.035, 0.01, -0.13, 0.4, 0.12, P.black) // shoulder mic
        .geo(new THREE.CylinderGeometry(0.004, 0.004, 0.08), P.black, -0.13, 0.46, 0.12)
        .rbox(0.02, 0.2, 0.012, 0.005, 0, 0.3, 0.125, 0x10182e); // tie/placket
    } else if (zom) {
      // torn shirt: rotting skin through the rips, blood down the front, rags hanging off the hem
      cb.limb(0.15, 0.64, 0, 0.44, 0, P.uniform, 0, 0, 1.28, 0.8)
        .rbox(0.12, 0.1, 0.02, 0.03, 0.07, 0.3, 0.115, skin, 0, 0, 0.4).rbox(0.09, 0.07, 0.02, 0.02, -0.12, 0.1, 0.11, skin, 0, 0, -0.3)
        .rbox(0.07, 0.04, 0.012, 0.01, 0.07, 0.3, 0.126, ROT, 0, 0, 0.4) // wound
        .rbox(0.1, 0.2, 0.012, 0.02, -0.04, 0.24, 0.123, BLOOD, 0, 0, 0.15).rbox(0.05, 0.12, 0.012, 0.015, 0.1, 0.05, 0.12, BLOOD)
        .rbox(0.07, 0.1, 0.02, 0.01, -0.13, -0.03, 0.09, P.uniform, 0.25, 0, 0.3).rbox(0.06, 0.09, 0.02, 0.01, 0.1, -0.04, -0.09, P.uniform, -0.25, 0, -0.2) // rags;
      if (cyb) {
        // flesh peeled off the implants: bare metal ribs, cables and a cracked core
        for (let i = 0; i < 3; i++) cb.rbox(0.15, 0.022, 0.03, 0.01, -0.09, 0.32 - i * 0.065, 0.1, 0x8a9096, 0, 0, -0.12);
        cb.rbox(0.08, 0.36, 0.06, 0.02, 0, 0.26, -0.13, 0x5d646b);
        for (const x of [-0.08, 0.08]) cb.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 6), 0x111214, x, 0.3, -0.12, 0.2, 0, 0);
        cb.rbox(0.05, 0.05, 0.015, 0.01, 0.04, 0.3, 0.13, 0xff2020, 0, 0, 0.5, 'emit');
      }
    } else if (op) {
      camo(cb, true, () => cb.limb(0.15, 0.64, 0, 0.44, 0, P.uniform, 0, 0, 1.28, 0.8)); // shirt
      // shaped plate carrier: front bag with a tapered top, back plate, cummerbund wrapping the sides
      cb.rbox(0.38, 0.3, 0.1, 0.035, 0, 0.22, 0.1, KIT.plate).rbox(0.3, 0.07, 0.09, 0.03, 0, 0.39, 0.095, KIT.plate)
        .rbox(0.36, 0.3, 0.08, 0.03, 0, 0.24, -0.1, KIT.plate).rbox(0.29, 0.07, 0.07, 0.03, 0, 0.4, -0.095, KIT.plate)
        .rbox(0.42, 0.25, 0.25, 0.045, 0, 0.06, 0, KIT.plate2); // cummerbund, down to the belt
      for (const sx of [-1, 1]) {
        cb.rbox(0.09, 0.05, 0.22, 0.02, sx * 0.17, 0.4, 0, KIT.plate) // shoulder straps
          .rbox(0.03, 0.022, 0.012, 0.004, sx * 0.16, 0.37, 0.15, KIT.metal) // strap buckles
          .rbox(0.012, 0.045, 0.03, 0.004, sx * 0.212, 0.13, 0.07, KIT.metal); // cummerbund buckles
      }
      for (const y of [0.32, 0.27]) cb.rbox(0.36, 0.012, 0.01, 0.004, 0, y, 0.152, KIT.web); // MOLLE webbing rows
      for (const x of [-0.12, 0, 0.12]) // mag pouches: flap, snap
        cb.rbox(0.075, 0.1, 0.05, 0.015, x, 0.15, 0.17, KIT.pouch).rbox(0.08, 0.035, 0.056, 0.012, x, 0.195, 0.172, KIT.flap).rbox(0.018, 0.022, 0.008, 0.003, x, 0.185, 0.2, KIT.metal);
      cb.rbox(0.07, 0.07, 0.045, 0.012, -0.12, 0.31, 0.17, KIT.pouch).rbox(0.075, 0.025, 0.05, 0.008, -0.12, 0.35, 0.172, KIT.flap) // radio pouch
        .rbox(0.03, 0.12, 0.03, 0.01, -0.13, 0.38, 0.15, P.black) // radio antenna base
        .rbox(0.09, 0.08, 0.025, 0.01, 0.09, 0.3, 0.165, KIT.flap); // admin panel
      // assault pack: top flap, compression straps with buckles, front pocket
      cb.rbox(0.26, 0.24, 0.09, 0.04, 0, 0.22, -0.175, KIT.pouch).rbox(0.27, 0.06, 0.1, 0.03, 0, 0.33, -0.178, KIT.flap).rbox(0.12, 0.12, 0.04, 0.015, 0, 0.18, -0.226, KIT.plate2);
      for (const sx of [-1, 1]) cb.rbox(0.02, 0.24, 0.012, 0.004, sx * 0.085, 0.21, -0.222, KIT.web).rbox(0.032, 0.02, 0.012, 0.004, sx * 0.085, 0.27, -0.23, KIT.metal);
      // team identity: shoulder IR patches
      cb.rbox(0.07, 0.05, 0.012, 0.005, -0.2, 0.29, 0.13, teamColor, 0, 0.5, 0, 'emit');
      cb.rbox(0.07, 0.05, 0.012, 0.005, 0.2, 0.29, 0.13, teamColor, 0, -0.5, 0, 'emit');
    } else {
      cb.limb(0.15, 0.64, 0, 0.44, 0, P.uniform, 0, 0, 1.28, 0.8)
        .rbox(0.4, 0.34, 0.1, 0.03, 0, 0.24, 0.1, P.plate)
        .rbox(0.38, 0.32, 0.08, 0.03, 0, 0.25, -0.1, P.plate)
        .rbox(0.1, 0.06, 0.2, 0.02, 0.19, 0.36, 0, P.plate).rbox(0.1, 0.06, 0.2, 0.02, -0.19, 0.36, 0, P.plate) // shoulder straps
        .rbox(0.36, 0.05, 0.22, 0.02, 0, 0.1, 0, P.strap) // cummerbund
        .rbox(0.075, 0.11, 0.05, 0.015, -0.12, 0.16, 0.17, P.pouch).rbox(0.075, 0.11, 0.05, 0.015, 0, 0.16, 0.17, P.pouch).rbox(0.075, 0.11, 0.05, 0.015, 0.12, 0.16, 0.17, P.pouch)
        .rbox(0.07, 0.06, 0.04, 0.012, -0.11, 0.3, 0.16, P.pouch) // radio/admin
        .rbox(0.04, 0.12, 0.03, 0.01, -0.12, 0.36, 0.14, P.black) // radio antenna base;
      if (loy) cb.rbox(0.2, 0.2, 0.08, 0.03, 0, 0.2, -0.16, P.pouch); // small daypack
      if (cyb) {
        // spinal implant, cable bundles and a glowing chest core
        cb.rbox(0.08, 0.36, 0.06, 0.02, 0, 0.26, -0.16, 0x5d646b);
        for (const x of [-0.08, 0.08]) cb.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 6), 0x111214, x, 0.3, -0.14, 0.2, 0, 0);
        cb.rbox(0.06, 0.06, 0.015, 0.01, 0, 0.3, 0.152, 0xff2020, 0, 0, 0, 'emit');
        if (elite) cb.rbox(0.3, 0.02, 0.015, 0.005, 0, 0.4, 0.152, 0xff2020, 0, 0, 0, 'emit');
      }
    }
    this.chest.add(meshes(cb, M.gear, 1));
    // head
    this.chest.add(this.neck);
    this.neck.position.set(0, 0.455, 0.01); // head low on the shoulders: a long bare neck read as a stalk under the chunky heads and helmets
    this.neck.add(this.head);
    this.head.position.y = 0.1;
    const hb = new Builder()
      .limb(0.064, 0.2, 0, 0.02, 0, skin) // neck: reaches into the collar so head and torso read as one
      .geo(new THREE.SphereGeometry(0.105, 16, 12), skin, 0, 0.06, 0.01, 0, 0, 0, 'solid', 0.9, 1.05, 1);
    if (cop) {
      policeHead(hb, skin, opts.look ?? {}, santa, bunny ? SUIT : undefined);
    } else if (dentist) {
      // surgical mask with ear loops, a head mirror on a band, scrub cap or hair; seniors wear loupes; cyborgs a cyber eye
      const cap = cyb || ((skin >> 4) & 1) === 1;
      hb.geo(new THREE.SphereGeometry(0.108, 14, 10, 0, Math.PI * 2, Math.PI * 0.56, Math.PI * 0.3), EA.mask, 0, 0.06, 0.012, 0, 0, 0, 'solid', 0.94, 1.05, 1.03)
        .rbox(0.06, 0.006, 0.01, 0.003, 0, 0.036, 0.108, 0x86b0cc).rbox(0.06, 0.006, 0.01, 0.003, 0, 0.015, 0.106, 0x86b0cc); // pleats
      for (const sx of [-1, 1]) hb.rbox(0.004, 0.035, 0.03, 0.002, sx * 0.098, 0.06, 0.02, EA.white); // ear loops
      hb.geo(new THREE.SphereGeometry(cap ? 0.114 : 0.108, 14, 10, 0, Math.PI * 2, 0, Math.PI * (cap ? 0.42 : 0.5)), cap ? (elite ? 0x1e2a4c : cyb ? 0x8ed2c0 : 0x9cc6e6) : 0x2a2018, 0, 0.065, -0.006, 0, 0, 0, 'solid', 0.94, 1.03, 1.04);
      for (const sx of [-1, 1]) hb.rbox(0.03, 0.008, 0.01, 0.003, sx * 0.035, 0.1, 0.098, 0x2a2018); // brows
      hb.geo(new THREE.TorusGeometry(0.112, 0.008, 4, 18), 0x1a1c20, 0, 0.12, -0.006, Math.PI / 2 - 0.15) // headband
        .geo(new THREE.CylinderGeometry(0.046, 0.046, 0.008, 18), EA.chrome, 0, 0.165, 0.1, 1.0) // the round head mirror, tipped up
        .geo(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 8), 0x1a1c20, 0, 0.154, 0.094, 1.0);
      if (cyb) hb.rbox(0.05, 0.06, 0.03, 0.012, -0.06, 0.07, 0.07, 0x8a9096, 0, 0.5).geo(new THREE.SphereGeometry(0.016, 8, 6), DGLOW, -0.035, 0.075, 0.097, 0, 0, 0, 'emit');
      else hb.geo(new THREE.SphereGeometry(0.012, 6, 5), 0x1a1410, -0.035, 0.075, 0.094);
      hb.geo(new THREE.SphereGeometry(0.012, 6, 5), 0x1a1410, 0.035, 0.075, 0.094);
      // loupes: little magnifier barrels on a frame (seniors both eyes, cyborgs the human eye)
      for (const sx of elite ? [-1, 1] : cyb ? [1] : []) hb.geo(new THREE.CylinderGeometry(0.016, 0.014, 0.035, 10), 0x22252a, sx * 0.036, 0.075, 0.118, Math.PI / 2).geo(new THREE.CylinderGeometry(0.013, 0.013, 0.004, 10), 0x9ad0f0, sx * 0.036, 0.075, 0.137, Math.PI / 2);
      if (elite || cyb) hb.box(0.1, 0.006, 0.006, 0, 0.088, 0.105, 0x22252a).box(0.004, 0.004, 0.09, 0.09, 0.088, 0.06, 0x22252a).box(0.004, 0.004, 0.09, -0.09, 0.088, 0.06, 0x22252a);
    } else if (elf) {
      // rosy cheeks, a grin, pointy ears and a tall floppy hat; cyborg elves keep a cheek plate, a metal ear and a glowing eye
      hb.geo(new THREE.SphereGeometry(0.012, 6, 5), 0x1a1410, 0.035, 0.075, 0.094).rbox(0.025, 0.035, 0.03, 0.01, 0, 0.05, 0.1, skin)
        .rbox(0.05, 0.01, 0.01, 0.005, 0, 0.02, 0.097, 0x6a2a24)
        .geo(new THREE.SphereGeometry(0.018, 6, 5), 0xd86a5a, -0.055, 0.04, 0.083).geo(new THREE.SphereGeometry(0.018, 6, 5), 0xd86a5a, 0.055, 0.04, 0.083)
        .geo(new THREE.SphereGeometry(0.06, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), 0x8a5a2a, 0, 0.1, -0.06, -0.6, 0, 0, 'solid', 1.5, 0.8, 1); // fringe at the back
      for (const sx of [-1, 1]) spike(hb, cyb && sx < 0 ? 0x8a9096 : skin, V(sx * 0.085, 0.07, -0.005), V(sx, 0.55, -0.25), 0.1, 0.028, 0.004, 6);
      if (cyb) hb.rbox(0.05, 0.07, 0.03, 0.012, -0.06, 0.06, 0.07, 0x8a9096, 0, 0.5).geo(new THREE.SphereGeometry(0.016, 8, 6), GLOW, -0.035, 0.075, 0.097, 0, 0, 0, 'emit');
      else hb.geo(new THREE.SphereGeometry(0.012, 6, 5), 0x1a1410, -0.035, 0.075, 0.094);
      pointyHat(hb, E.hat, E.band, bell ? XM.gold : XM.fur, 0.3, 0.3);
    } else if (zom) {
      // sunken dark sockets with a faint dead glow, slack bloody mouth, scalp torn off one side
      for (const sx of [-1, 1]) hb.geo(new THREE.SphereGeometry(0.024, 8, 6), 0x0e0808, sx * 0.036, 0.074, 0.084);
      hb.rbox(0.13, 0.016, 0.03, 0.008, 0, 0.098, 0.088, ROT) // heavy brow
        .rbox(0.055, 0.03, 0.02, 0.01, 0, 0.012, 0.094, 0x1a0606) // gaping mouth
        .rbox(0.05, 0.03, 0.01, 0.006, 0.01, -0.012, 0.096, BLOOD) // blood down the chin
        .geo(new THREE.SphereGeometry(0.11, 12, 8, 0.6, Math.PI * 1.45, 0, Math.PI * 0.45), cyb ? 0x5d646b : 0x1c1a14, 0, 0.066, -0.004, 0, 0, 0, 'solid', 0.94, 1.02, 1.04) // hair / skull plate, a wedge missing
        .geo(new THREE.SphereGeometry(0.04, 8, 6), ROT, 0.06, 0.13, 0.03, 0, 0, 0, 'solid', 1, 0.5, 1); // the bare patch
      if (cyb) {
        hb.rbox(0.12, 0.05, 0.05, 0.015, 0, 0.0, 0.07, 0x6d757c, 0, 0, 0.12) // jaw plate, knocked askew
          .geo(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 12), 0x3a3e44, -0.11, 0.05, 0, 0, 0, Math.PI / 2)
          .geo(new THREE.SphereGeometry(0.016, 8, 6), 0xff2020, -0.036, 0.074, 0.095, 0, 0, 0, 'emit') // one surviving cyber eye
          .geo(new THREE.SphereGeometry(0.007, 6, 4), 0x606830, 0.036, 0.074, 0.103, 0, 0, 0, 'emit');
      } else for (const sx of [-1, 1]) hb.geo(new THREE.SphereGeometry(0.007, 6, 4), 0x78803a, sx * 0.036, 0.074, 0.103, 0, 0, 0, 'emit');
    } else if (loy) {
      if (elite) {
        hb.geo(new THREE.SphereGeometry(0.11, 16, 12), 0x121314, 0, 0.065, 0.005, 0, 0, 0, 'solid', 0.93, 1.07, 1.03) // balaclava
          .rbox(0.15, 0.04, 0.03, 0.012, 0, 0.075, 0.095, 0x0a0c0e) // goggles
          .geo(new THREE.BoxGeometry(0.12, 0.012, 0.012), 0xff3020, 0, 0.075, 0.108, 0, 0, 0, 'emit');
      } else {
        hb.geo(new THREE.SphereGeometry(0.108, 14, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), 0x3a3f46, 0, 0.06, 0.01, 0, 0, 0, 'solid', 0.93, 1.05, 1.02) // face scarf
          .geo(new THREE.SphereGeometry(0.112, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), 0x2b303a, 0, 0.075, 0, 0, 0, 0, 'solid', 1, 0.8, 1.05) // patrol cap
          .rbox(0.16, 0.012, 0.09, 0.005, 0, 0.095, 0.1, 0x2b303a, 0.2) // bill
          .geo(new THREE.SphereGeometry(0.012, 6, 5), 0x1a1410, -0.035, 0.08, 0.094).geo(new THREE.SphereGeometry(0.012, 6, 5), 0x1a1410, 0.035, 0.08, 0.094);
      }
    } else if (cyb) {
      hb.geo(new THREE.SphereGeometry(0.114, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), 0x5d646b, 0, 0.07, -0.006, 0, 0, 0, 'solid', 0.96, 1, 1.05) // skull plate
        .rbox(0.2, 0.045, 0.07, 0.015, 0, 0.075, 0.07, 0x101113) // visor housing
        .rbox(0.12, 0.05, 0.05, 0.015, 0, 0.0, 0.07, 0x6d757c) // jaw plate
        .geo(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 12), 0x3a3e44, 0.11, 0.05, 0, 0, 0, Math.PI / 2) // audio receptor
        .geo(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 12), 0x3a3e44, -0.11, 0.05, 0, 0, 0, Math.PI / 2);
      hb.geo(new THREE.BoxGeometry(0.17, 0.018, 0.012), 0xff1a1a, 0, 0.078, 0.106, 0, 0, 0, 'emit'); // red visor slit
    } else {
      // the player operator: an open, gender-neutral face (soft rounded jaw, simple eyes, thin brows, no stubble)
      const lip = new THREE.Color(skin).lerp(new THREE.Color(0x8a4a42), 0.35).getHex();
      hb.geo(new THREE.SphereGeometry(0.07, 12, 9), skin, 0, 0.018, 0.034, 0, 0, 0, 'solid', 1.05, 0.78, 1) // cheeks and chin, rounded
        .rbox(0.022, 0.03, 0.024, 0.009, 0, 0.05, 0.108, skin) // nose
        .rbox(0.036, 0.008, 0.01, 0.003, 0, 0.022, 0.106, lip); // mouth
      for (const sx of [-1, 1]) hb.geo(new THREE.SphereGeometry(0.013, 8, 6), 0x1a1410, sx * 0.034, 0.073, 0.097).rbox(0.028, 0.006, 0.01, 0.002, sx * 0.035, 0.094, 0.102, 0x2a2018); // eyes, brows
      // helmet with a ranger-green cover, rim band, side rails, chin strap, ear pro, NVG mount (flipped up)
      hb.geo(new THREE.SphereGeometry(0.135, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), KIT.helmet, 0, 0.1, -0.005, 0, 0, 0, 'solid', 1, 0.92, 1.08)
        .rbox(0.21, 0.022, 0.25, 0.01, 0, 0.102, -0.005, KIT.web) // rim band
        .geo(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 14), P.dark, 0.115, 0.05, 0, 0, 0, Math.PI / 2) // ear pro
        .geo(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 14), P.dark, -0.115, 0.05, 0, 0, 0, Math.PI / 2)
        .rbox(0.05, 0.04, 0.04, 0.01, 0, 0.17, 0.12, P.metal) // NVG shroud
        .rbox(0.1, 0.035, 0.05, 0.012, 0, 0.15, 0.155, P.dark, 0.5) // flipped-up NVG
        .rbox(0.07, 0.012, 0.012, 0.004, 0, 0.215, 0.07, KIT.web, -0.6); // cover's top strap
      for (const sx of [-1, 1]) {
        hb.rbox(0.012, 0.03, 0.12, 0.005, sx * 0.13, 0.115, -0.01, KIT.web); // side rails
        spike(hb, KIT.web, V(sx * 0.096, 0.02, 0.012), V(-sx * 0.066, -0.065, 0.058), 0.1, 0.006, 0.006, 6); // chin strap
      }
      hb.rbox(0.05, 0.016, 0.03, 0.007, 0, -0.045, 0.072, KIT.web); // chin cup
      if (lk.balaclava) {
        // black knit balaclava over head and neck: only an eye band of skin shows (the helmet sits on top)
        const KNIT = 0x16181b;
        hb.limb(0.07, 0.2, 0, 0.02, 0, KNIT) // neck
          .geo(new THREE.SphereGeometry(0.112, 16, 12), KNIT, 0, 0.06, 0.012, 0, 0, 0, 'solid', 0.92, 1.06, 1.02) // head
          .geo(new THREE.SphereGeometry(0.074, 12, 9), KNIT, 0, 0.018, 0.04, 0, 0, 0, 'solid', 1.07, 0.8, 1.02) // jaw
          .rbox(0.104, 0.04, 0.02, 0.014, 0, 0.074, 0.112, skin); // eye opening, just proud of the knit
        for (const sx of [-1, 1]) hb.geo(new THREE.SphereGeometry(0.013, 8, 6), 0x1a1410, sx * 0.032, 0.074, 0.123); // eyes
      }
      hb.geo(new THREE.BoxGeometry(0.07, 0.012, 0.012), 0x60d8ff, 0, 0.142, 0.184, 0.5, 0, 0, 'emit'); // NVG lens glint
    }
    this.head.add(meshes(hb, M.gear));
    const st = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: teamColor, toneMapped: false }));
    st.position.set(0, 0.22, -0.08); // on the helmet's crown
    st.visible = outfit === 'operator';
    this.head.add(st);
    this.strobe = st;
    // arms
    const sleeve = cop ? NAVY : elf ? E.coat : P.uniform, sleeve2 = cop ? NAVY2 : elf ? E.coat2 : P.uniform2, hand = cop ? skin : elf ? E.glove : P.glove;
    for (const side of ['L', 'R'] as const) {
      const a = this.arm[side], sgn = side === 'L' ? -1 : 1;
      a.up.position.copy(a.sh);
      this.chest.add(a.up);
      const metal = cyb && side === 'R';
      // limb segments run pivot to pivot with their rounded ends centred on the joints, so bent elbows and knees
      // stay closed ball joints instead of opening a gap
      const ur = metal ? 0.052 : 0.058;
      const ub = new Builder();
      camo(ub, op, () => ub.limb(ur, L_UP + 2 * ur, 0, ur, 0, metal ? 0x8a9096 : sleeve).rbox(0.12, 0.08, 0.12, 0.035, sgn * 0.01, 0.0, 0, metal ? 0x5d646b : sleeve2));
      if (op) ub.rbox(0.07, 0.07, 0.012, 0.01, sgn * 0.058, -0.09, 0, KIT.flap, 0, sgn * Math.PI / 2); // velcro sleeve patch
      if (loy && side === 'L' && !dentist) ub.rbox(0.13, 0.05, 0.13, 0.02, 0, -0.1, 0, 0xb81414); // loyalist armband
      if (metal && elf) ub.rbox(0.115, 0.04, 0.115, 0.015, 0, -0.1, 0, XM.red).rbox(0.115, 0.04, 0.115, 0.015, 0, -0.22, 0, XM.red); // candy-cane stripes
      a.up.add(meshes(ub, metal ? gunMat : M.cloth, side === 'L' ? 2 : 3));
      a.fore.position.y = -L_UP;
      a.up.add(a.fore);
      const fb = new Builder();
      camo(fb, op, () => fb.limb(0.05, L_FORE + 0.05, 0, 0.05, 0, metal ? 0x8a9096 : zom ? skin : sleeve));
      fb.limb(0.047, 0.1, 0, -L_FORE + 0.1, 0, cop ? sleeve2 : P.glove);
      if ((santa || elf || bunny) && !metal) fb.limb(0.06, 0.08, 0, -L_FORE + 0.12, 0, santa || bunny ? XM.fur : E.trim); // fur / trim cuff
      if (metal && elf) fb.rbox(0.105, 0.035, 0.105, 0.012, 0, -0.08, 0, XM.red);      if (zom && !metal) fb.rbox(0.12, 0.06, 0.12, 0.02, 0, -0.02, 0, sleeve, 0.2, 0, sgn * 0.2).rbox(0.04, 0.08, 0.012, 0.01, 0, -0.16, 0.048, BLOOD); // ragged sleeve end, gash
      if (cyb && side === 'R') fb.geo(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 8), elf ? GLOW : dentist ? DGLOW : 0xff2020, 0, -0.12, 0.045, Math.PI / 2, 0, 0, 'emit');
      if (dentist && !metal) fb.limb(0.056, 0.05, 0, -L_FORE + 0.15, 0, D.coat2); // coat cuff above the glove
      if (cop && side === 'L') fb.rbox(0.05, 0.02, 0.06, 0.008, 0, -L_FORE + 0.08, 0.03, 0x111111); // watch
      a.fore.add(meshes(fb, cyb && side === 'R' ? gunMat : M.cloth, side === 'L' ? 4 : 5));
      a.hand.position.y = -L_FORE;
      a.fore.add(a.hand);
      // the player wears fingerless gloves (their skin tone shows)
      // player: a fingerless-glove hand with four slightly curled fingers and a thumb (reads as a hand in the preview)
      const hb2 = op ? new Builder().rbox(0.068, 0.062, 0.042, 0.018, 0, -0.03, 0.005, hand) : new Builder().rbox(0.065, 0.09, 0.05, 0.02, 0, -0.04, 0.005, hand);
      if (op) {
        // fingers and thumb start inside the glove so they stay attached
        [-0.024, -0.008, 0.008, 0.024].forEach((fx, i) => hb2.limb(0.0085, i === 0 || i === 3 ? 0.066 : 0.074, fx, -0.042, 0.008, skin, -0.3)); // fingers
        hb2.limb(0.009, 0.056, -sgn * 0.024, -0.02, 0.012, skin, -0.5, -sgn * 0.7); // thumb
      }
      if (dentist && metal) { hb2.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 8), 0x3a3e44, 0.02, -0.095, 0.02); spike(hb2, EA.chrome, V(0.02, -0.11, 0.02), DOWN, 0.06, 0.007, 0.002, 6); } // drill-tipped finger
      if (zom) for (const fx of [-0.022, 0, 0.022]) hb2.limb(0.009, 0.07, fx, -0.08, 0.02, metal ? 0x8a9096 : 0x2a2618, 0.5); // claws
      const open = meshes(hb2, M.cloth);
      a.hand.add(open);
      if (op && side === 'R') {
        // knife hand: a closed fist around the grip (swapped in while the knife is out)
        const fb = new Builder().rbox(0.068, 0.062, 0.042, 0.018, 0, -0.03, 0.005, hand);
        [-0.024, -0.008, 0.008, 0.024].forEach((fx) => fb.limb(0.0095, 0.05, fx, -0.052, 0.0, skin, -1.75)); // fingers curled forward over the grip
        fb.limb(0.0095, 0.045, -sgn * 0.03, -0.035, 0.02, skin, -0.9, -sgn * 0.35); // thumb wrapped over the fingers
        const fist = meshes(fb, M.cloth);
        fist.visible = false;
        a.hand.add(fist);
        this.hands = { open, fist };
      }
    }
    // legs
    for (const side of ['L', 'R'] as const) {
      const l = this.leg[side], sgn = side === 'L' ? -1 : 1;
      l.thigh.position.set(sgn * 0.1, -0.03, 0);
      this.hips.add(l.thigh);
      // elves: striped stockings (white with coloured rings)
      const stripes = (b: Builder, r: number, len: number) => { for (let y = -0.07; y > -len + 0.04; y -= 0.09) b.geo(new THREE.CylinderGeometry(r, r, 0.045, 10), E.stripe, 0, y, 0, 0, 0, 0, 'solid', 1, 1, 1.05); };
      const tb = new Builder();
      camo(tb, op, () => tb.limb(0.085, L_THIGH + 0.17, 0, 0.085, 0, cop ? TROUSER : elf ? XM.fur : dentist ? D.scrub : P.uniform, 0, 0, 1, 1.05));
      if (elf) stripes(tb, 0.088, L_THIGH);
      else if (dentist) { if (!scrubs) tb.rbox(0.2, 0.16, 0.2, 0.05, -sgn * 0.02, -0.06, -0.01, D.coat); } // coat tails over the thighs
      else if (zom) { if (side === 'R') tb.rbox(0.1, 0.14, 0.02, 0.02, 0, -0.2, 0.078, BLOOD); }
      else if (op) tb.rbox(0.07, 0.12, 0.05, 0.015, sgn * 0.075, -0.18, 0.01, KIT.pouch).rbox(0.075, 0.035, 0.055, 0.01, sgn * 0.075, -0.125, 0.01, KIT.flap).rbox(0.19, 0.022, 0.19, 0.008, 0, -0.2, 0, KIT.web).rbox(0.022, 0.03, 0.012, 0.004, sgn * 0.02, -0.2, 0.095, KIT.metal); // thigh pouch, flap, leg strap, buckle
      else if (!cop) tb.rbox(0.07, 0.12, 0.05, 0.015, sgn * 0.075, -0.18, 0.01, P.pouch);
      l.thigh.add(meshes(tb, M.cloth, side === 'L' ? 6 : 7));
      l.shin.position.y = -L_THIGH;
      l.thigh.add(l.shin);
      const sb = new Builder();
      camo(sb, op, () => sb.limb(0.068, L_SHIN + 0.068, 0, 0.068, 0, cop ? TROUSER : elf ? XM.fur : dentist ? D.scrub : P.uniform));
      if (bunny) sb.geo(new THREE.SphereGeometry(0.09, 10, 8), EA.white, 0, -L_SHIN + 0.1, 0, 0, 0, 0, 'solid', 1, 0.7, 1); // fluffy ankle cuff
      else if (santa) sb.rbox(0.15, 0.17, 0.16, 0.045, 0, -L_SHIN + 0.07, 0, 0x0e0e10).rbox(0.165, 0.045, 0.175, 0.02, 0, -L_SHIN + 0.16, 0, XM.fur); // tall black boot, fur top
      else if (elf) stripes(sb, 0.071, L_SHIN);
      else if (dentist) { /* plain scrub trousers */ }
      else if (zom) { if (side === 'L') sb.rbox(0.1, 0.18, 0.03, 0.02, 0, -0.26, 0.055, skin); } // trouser leg torn away
      else if (op) sb.rbox(0.11, 0.11, 0.06, 0.03, 0, -0.03, 0.06, P.knee).rbox(0.15, 0.018, 0.15, 0.007, 0, -0.06, 0, KIT.web); // knee pad + strap
      else if (!cop) sb.rbox(0.11, 0.11, 0.06, 0.03, 0, -0.03, 0.06, P.knee);
      l.shin.add(meshes(sb, M.cloth, side === 'L' ? 8 : 9));
      l.foot.position.y = -L_SHIN;
      l.shin.add(l.foot);
      const ftb = new Builder();
      if (elf) {
        // pointy shoe, the toe curling up into a little ball (gold bell on the belled elves)
        ftb.rbox(0.1, 0.08, 0.2, 0.035, 0, -0.04, 0.03, E.shoe).rbox(0.105, 0.02, 0.21, 0.008, 0, -0.078, 0.03, 0x2a1a10);
        const t1 = spike(ftb, E.shoe, V(0, -0.05, 0.11), V(0, 0.15, 1), 0.12, 0.042, 0.02, 8);
        const t2 = spike(ftb, E.shoe, t1, V(0, 1, -0.2), 0.06, 0.02, 0.008, 6);
        ftb.geo(new THREE.SphereGeometry(0.016, 8, 6), bell ? XM.gold : E.trim, t2.x, t2.y, t2.z);
      } else if (bunny) {
        // big round bunny-paw slippers with pink toe pads
        ftb.geo(new THREE.SphereGeometry(0.08, 12, 8), EA.white, 0, -0.04, 0.06, 0, 0, 0, 'solid', 0.85, 0.6, 1.5);
        for (const tx of [-0.03, 0, 0.03]) ftb.geo(new THREE.SphereGeometry(0.016, 6, 5), EA.pink, tx, -0.03, 0.172);
      } else ftb.rbox(0.11, 0.09, 0.26, 0.035, 0, -0.035, 0.05, cop ? 0x0e0e10 : P.boot).rbox(0.115, 0.022, 0.27, 0.01, 0, -0.078, 0.05, P.black);
      l.foot.add(meshes(ftb, M.gear));
    }
    this.chest.add(this.gunHolder);
    this.knife = meshes(combatKnife(), gunMat);
    // forward grip: the handle runs across the fist, the blade comes out of the thumb side
    this.knife.rotation.set(0, -Math.PI / 2, 0);
    this.knife.position.set(0.006, -0.066, 0.03);
    this.knife.visible = false;
    this.arm.R.hand.add(this.knife);
  }

  private gunSup = false;
  setGun(kind: GunKind | null, suppressed = false) {
    if (kind === this.gunKind && suppressed === this.gunSup) return;
    this.gunKind = kind; this.gunSup = suppressed;
    if (this.gun) this.gunHolder.remove(this.gun.g);
    this.gun = kind ? buildGun(kind, true, suppressed) : null;
    if (this.gun) this.gunHolder.add(this.gun.g);
    this.knife.visible = !kind && this.outfit === 'operator';
    if (this.hands) { this.hands.fist.visible = this.knife.visible; this.hands.open.visible = !this.knife.visible; }
  }

  private firedT = 0;
  onShot() { this.kick = 1; this.firedT = 0.9; }
  onThrow() { this.throwT = 0.45; }
  onMelee() { this.slashT = 0.3; }

  /** Two-bone IK in chest space: place the hand of `side` at `target` with the elbow bending toward `pole`. */
  private ik(side: 'L' | 'R', target: THREE.Vector3, pole: THREE.Vector3) {
    const a = this.arm[side];
    const S = a.sh;
    const d = target.clone().sub(S);
    const dist = THREE.MathUtils.clamp(d.length(), 0.08, (L_UP + L_FORE) * 0.995);
    const dir = d.normalize();
    const cosA = THREE.MathUtils.clamp((L_UP * L_UP + dist * dist - L_FORE * L_FORE) / (2 * L_UP * dist), -1, 1);
    const ang = Math.acos(cosA);
    const pv = pole.clone().sub(S);
    const perp = pv.sub(dir.clone().multiplyScalar(pv.dot(dir))).normalize();
    const upperVec = dir.clone().multiplyScalar(Math.cos(ang)).add(perp.multiplyScalar(Math.sin(ang))).normalize();
    a.up.quaternion.setFromUnitVectors(DOWN, upperVec);
    const elbow = S.clone().add(upperVec.clone().multiplyScalar(L_UP));
    const T = S.clone().add(dir.multiplyScalar(dist));
    const fvec = T.sub(elbow).normalize();
    const qf = new THREE.Quaternion().setFromUnitVectors(DOWN, fvec);
    a.fore.quaternion.copy(a.up.quaternion.clone().invert().multiply(qf));
  }

  /** Unarmed arm behaviour: walking swing, or a held pose (guarding, talking, briefing, leaning), radio call. */
  private freeArms(r: RigInput, ph: number, moveK: number, breathe: number) {
    const poleR = V(0.4, -0.2, -0.55), poleL = V(-0.4, -0.2, -0.55);
    let R = V(0.22, -0.22 + breathe, 0.04 + Math.sin(ph) * 0.2 * moveK);
    let Lh = V(-0.22, -0.22 + breathe, 0.04 - Math.sin(ph) * 0.2 * moveK);
    const t = r.t;
    const pose = moveK > 0.4 ? 'swing' : r.pose ?? 'swing';
    if (pose === 'fold') { R = V(-0.08, 0.18 + breathe, 0.2); Lh = V(0.08, 0.2 + breathe, 0.19); }
    else if (pose === 'talk') { R = V(0.16, 0.08 + Math.max(0, Math.sin(t * 2.3)) * 0.12, 0.28 + Math.sin(t * 1.3) * 0.05); Lh = V(-0.2, -0.18, 0.08); }
    else if (pose === 'brief') { R = V(0.14, -0.05, 0.42 + Math.sin(t * 0.9) * 0.04); Lh = V(-0.14, -0.06, 0.4); this.spine.rotation.x += 0.35; }
    else if (pose === 'lean') { R = V(0.2, -0.02, -0.02); Lh = V(-0.22, -0.2, 0.08); this.spine.rotation.z += 0.1; }
    if (r.radio) Lh = V(-0.13, 0.38, 0.16); // thumb the shoulder mic
    this.ik('R', R, poleR);
    this.ik('L', Lh, poleL);
  }

  update(r: RigInput) {
    this.arm.R.hand.rotation.set(0, 0, 0); // only the knife guard twists the wrist
    const dt = Math.max(1e-4, r.dt), k = (rate: number) => 1 - Math.exp(-dt * rate);
    this.root.position.set(r.x, 0, r.y);
    this.root.rotation.y = -r.facing + Math.PI / 2;
    // velocity from position deltas (works for local, remote and replicated players alike)
    if (Number.isNaN(this.lastX)) { this.lastX = r.x; this.lastY = r.y; }
    const vx = r.vel ? r.vel.vx : (r.x - this.lastX) / dt, vy = r.vel ? r.vel.vy : (r.y - this.lastY) / dt;
    this.lastX = r.x; this.lastY = r.y;
    if (Math.hypot(vx, vy) < 12) { this.vel.x += (vx - this.vel.x) * k(10); this.vel.z += (vy - this.vel.z) * k(10); }
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const fwd = this.vel.x * Math.cos(r.facing) + this.vel.z * Math.sin(r.facing);
    const side = this.vel.x * Math.sin(r.facing) - this.vel.z * Math.cos(r.facing);
    // blend weights
    this.crouchK += ((r.crouch ? 1 : 0) - this.crouchK) * k(9);
    this.airK += ((r.z > 0.03 ? 1 : 0) - this.airK) * k(12);
    this.firedT = Math.max(0, this.firedT - dt);
    this.aimK += ((r.aiming || r.firingRecently || this.firedT > 0 ? 1 : 0) - this.aimK) * k(12);
    this.sprintK += ((r.sprinting ? 1 : 0) - this.sprintK) * k(7);
    this.downK += ((r.life === 'down' || r.life === 'dead' ? 1 : 0) - this.downK) * k(r.life === 'dead' ? 7 : 5);
    this.kick *= Math.exp(-dt * 14);
    this.throwT = Math.max(0, this.throwT - dt);
    this.slashT = Math.max(0, this.slashT - dt);
    this.root.visible = r.life !== 'out';
    this.root.position.y = r.z + (r.ground ?? 0);
    // ---- lower body: legs face the movement direction, torso keeps the aim
    const moveK = THREE.MathUtils.clamp(speed / 1.2, 0, 1);
    let rel = Math.atan2(side, fwd), dirSign = 1;
    if (Math.abs(rel) > 1.95) { rel = rel > 0 ? rel - Math.PI : rel + Math.PI; dirSign = -1; } // backpedal
    const yawTarget = moveK > 0.2 ? THREE.MathUtils.clamp(rel, -1.15, 1.15) : 0;
    this.hipYaw += (yawTarget - this.hipYaw) * k(8);
    this.hips.rotation.y = this.hipYaw;
    this.spine.rotation.y = -this.hipYaw;
    const runK = THREE.MathUtils.clamp((speed - 3.2) / 2.2, 0, 1);
    const stride = THREE.MathUtils.lerp(1.25, 1.9, runK) * (1 - 0.35 * this.crouchK);
    // zombies lurch: the gait surges and stalls through each stride
    this.phase += ((speed * dt * dirSign * Math.PI * 2) / stride) * (this.zombie ? 1 + 0.6 * Math.sin(this.phase) : 1);
    const ph = this.phase;
    const A = THREE.MathUtils.lerp(0.4, 0.78, runK) * moveK * (1 - 0.45 * this.crouchK);
    const K = THREE.MathUtils.lerp(0.55, 1.15, runK) * moveK;
    const c = this.crouchK, air = this.airK;
    for (const [s, off] of [['L', 0], ['R', Math.PI]] as const) {
      const l = this.leg[s];
      const p = ph + off;
      const drag = this.zombie && s === 'R'; // stiff dragging leg
      const swing = -Math.sin(p) * A * (drag ? 0.6 : 1); // forward = negative x
      const knee = (Math.max(0, Math.sin(p + 1.25)) * K + 0.08 * moveK) * (drag ? 0.3 : 1);
      const thigh = swing - 1.05 * c - 0.75 * air + (s === 'L' ? -0.15 : 0.1) * c;
      const shin = knee + 1.75 * c + 1.3 * air;
      l.thigh.rotation.set(thigh, drag ? 0.35 : 0, (s === 'L' ? -1 : 1) * (this.zombie ? 0.08 : 0.03));
      l.shin.rotation.x = shin;
      l.foot.rotation.x = -(thigh + shin) * 0.75 + 0.05;
    }
    const bob = (Math.abs(Math.cos(ph)) - 0.5) * THREE.MathUtils.lerp(0.035, 0.07, runK) * moveK;
    this.hips.position.y = L_THIGH + L_SHIN + 0.07 - 0.36 * c - 0.1 * air + bob;
    this.hips.rotation.z = Math.sin(ph) * (this.zombie ? 0.14 : 0.05) * moveK;
    this.hips.position.z = -0.08 * c;
    // ---- upper body
    const breathe = Math.sin(r.t * 1.7) * 0.012;
    const lean = 0.05 * moveK + 0.28 * this.sprintK + 0.3 * c + r.aimPitch * 0.25 * (1 - this.sprintK);
    this.spine.rotation.x = lean + breathe - this.kick * 0.04;
    this.spine.rotation.z = -Math.sin(ph) * 0.03 * moveK;
    this.chest.rotation.y = Math.sin(ph) * 0.06 * moveK * (1 - this.aimK);
    this.head.rotation.x = -lean * 0.6 + r.aimPitch * 0.5;
    this.head.rotation.y = -this.chest.rotation.y;
    if (this.zombie) {
      // hunched, swaying from the shoulders, head lolling to one side
      this.spine.rotation.x += 0.22;
      this.spine.rotation.z = -Math.sin(ph) * 0.12 * moveK + Math.sin(r.t * 0.9) * 0.04;
      this.head.rotation.z = 0.3 + Math.sin(r.t * 1.3) * 0.08;
      this.head.rotation.x -= 0.1;
    } else this.head.rotation.z = 0;
    // ---- weapon pose in chest space (aim / ready / low / sprint carry), blended
    const pistol = this.gunKind === 'pistol';
    const poses = pistol
      ? { aim: [0.02, 0.3, 0.45, 0, 0], ready: [0.04, 0.18, 0.38, 0.45, 0], low: [0.05, 0.1, 0.32, 0.9, 0], sprint: [0.12, 0.05, 0.25, 1.1, 0] }
      : { aim: [0.1, 0.3, 0.22, 0, 0], ready: [0.11, 0.25, 0.22, 0.28, -0.08], low: [0.1, 0.16, 0.2, 0.55, -0.3], sprint: [0.02, 0.12, 0.2, 0.7, -0.95] };
    const calm = 1 - this.aimK;
    const w = { aim: this.aimK * (1 - this.sprintK), ready: calm * (1 - moveK) * (1 - this.sprintK), low: calm * moveK * (1 - this.sprintK), sprint: this.sprintK };
    const P = [0, 0, 0, 0, 0];
    for (const key of ['aim', 'ready', 'low', 'sprint'] as const) for (let i = 0; i < 5; i++) P[i] += (poses[key] as number[])[i] * w[key];
    let [gx, gy, gz, pitch, yaw] = P;
    pitch += r.aimPitch * (1 - this.sprintK) - this.kick * 0.13 - lean * 0.9;
    gz -= this.kick * 0.05;
    let roll = 0;
    // reload: tilt the weapon, support hand goes to the mag well, down to a pouch and back
    let reloadHand: THREE.Vector3 | null = null;
    if (r.reload >= 0 && this.gun) {
      const q = r.reload;
      const tilt = Math.sin(Math.min(1, q * 1.3) * Math.PI);
      roll = 0.55 * tilt; pitch += 0.25 * tilt; gy -= 0.04 * tilt;
      const well = this.gun.grip.clone().add(V(0, -0.06, 0.08));
      const pouch = V(-0.05, 0.12, 0.2);
      const t2 = q < 0.25 ? q / 0.25 : q < 0.55 ? 1 - (q - 0.25) / 0.3 : q < 0.85 ? (q - 0.55) / 0.3 : 1 - (q - 0.85) / 0.15;
      reloadHand = q < 0.85 ? well.lerp(pouch, q > 0.25 && q < 0.85 ? 1 - Math.abs(t2 - 0.5) * 2 : 0) : null;
    }
    this.gunHolder.position.set(gx, gy, gz);
    this.gunHolder.rotation.set(pitch, yaw, roll, 'YXZ');
    this.gunHolder.updateMatrix();
    // ---- hands
    const poleR = V(0.55, -0.35, -0.25), poleL = V(-0.55, -0.4, 0.05);
    if (r.pose === 'apose') {
      this.knife.visible = false;
      // character preview: arms hang straight, angled ~40 degrees out from the body
      for (const [sd, sx] of [['L', -1], ['R', 1]] as const) {
        this.arm[sd].up.quaternion.setFromUnitVectors(DOWN, V(sx * Math.sin(0.7), -Math.cos(0.7), 0.04).normalize());
        this.arm[sd].fore.quaternion.setFromEuler(new THREE.Euler(-0.12, 0, 0));
      }
    } else if (this.gun) {
      const gripT = this.gun.grip.clone().applyMatrix4(this.gunHolder.matrix);
      let foreT = this.gun.fore.clone().applyMatrix4(this.gunHolder.matrix);
      if (reloadHand) foreT = reloadHand.clone().applyMatrix4(this.gunHolder.matrix);
      if (this.throwT > 0) {
        // support hand leaves the gun to lob the grenade
        const q = 1 - this.throwT / 0.45;
        foreT = q < 0.45 ? V(-0.15, 0.55, -0.1) : V(-0.05, 0.4, 0.55);
      }
      this.ik('R', gripT, poleR);
      this.ik('L', foreT, poleL);
    } else if (this.zombie) {
      // arms dangle when idle, reach out in front when moving or hunting; melee = a two-handed claw swipe
      const reach = Math.max(moveK, this.aimK), wob = (sx: number) => Math.sin(r.t * 2.1 + sx) * 0.03;
      const hand = (sx: number, ph2: number) => V(sx * 0.2, -0.24 + breathe, 0.06).lerp(V(sx * 0.16, 0.3 + wob(sx) + Math.sin(ph2) * 0.03 * moveK, 0.5), reach);
      let R = hand(1, ph), Lh = hand(-1, ph + Math.PI);
      if (this.slashT > 0) {
        const q = 1 - this.slashT / 0.3, sw = Math.sin(q * Math.PI);
        R = V(0.3 - q * 0.45, 0.48 - q * 0.42, 0.25 + sw * 0.35); // overhead rake, right then left
        const q2 = Math.max(0, q - 0.3) / 0.7;
        Lh = V(-0.3 + q2 * 0.4, 0.45 - q2 * 0.4, 0.3 + Math.sin(q2 * Math.PI) * 0.3);
        this.spine.rotation.x += sw * 0.3;
      }
      this.ik('R', R, V(0.5, -0.3, -0.3));
      this.ik('L', Lh, V(-0.5, -0.3, -0.3));
    } else if (this.outfit === 'police') {
      this.freeArms(r, ph, moveK, breathe);
    } else {
      // knife: guard stance, slash on melee
      const q = this.slashT > 0 ? 1 - this.slashT / 0.3 : -1;
      // fighting guard: knife hand forward and low, the other hand up and open to parry
      const right = q >= 0 ? V(0.28 - q * 0.45, 0.32 - q * 0.08, 0.12 + Math.sin(q * Math.PI) * 0.42) : V(0.2, 0.06 + breathe, 0.36);
      this.ik('R', right, poleR);
      this.arm.R.hand.rotation.set(0, Math.PI / 2, 0.75); // wrist turned thumb-up so the blade rises forward out of the fist
      this.ik('L', this.throwT > 0 ? V(-0.1, 0.45, 0.5) : V(-0.1, 0.34 + breathe, 0.28), poleL);
    }
    if (this.slashT > 0 && this.gun) {
      // rifle-butt / knife jab with the gun up: quick forward lunge of the torso
      this.spine.rotation.x += Math.sin((1 - this.slashT / 0.3) * Math.PI) * 0.25;
    }
    // ---- downed: lie on the back, limbs slack
    if (this.downK > 0.01) {
      const d = this.downK;
      this.hips.rotation.x = -1.45 * d;
      this.hips.position.y = THREE.MathUtils.lerp(this.hips.position.y, 0.2, d);
      this.spine.rotation.x *= 1 - d;
      for (const s of ['L', 'R'] as const) { this.leg[s].thigh.rotation.x *= 1 - d; this.leg[s].shin.rotation.x = THREE.MathUtils.lerp(this.leg[s].shin.rotation.x, 0.25, d); }
      this.gunHolder.visible = d < 0.5;
    } else { this.hips.rotation.x = 0; this.gunHolder.visible = true; }
    if (r.hurt) this.chest.rotation.z = Math.sin(r.t * 45) * 0.05; else this.chest.rotation.z = 0;
    // IR strobe pulses
    (this.strobe.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(r.t * 5) > 0.7 ? 0xffffff : this.teamColor);
  }
}
