import * as THREE from 'three';
import { Builder, merge } from './models';
import { currentHoliday } from '../config/holiday';

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

function meshes(b: Builder, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const s = merge(b.p.solid);
  if (s) { const m = new THREE.Mesh(s, mat); m.castShadow = true; m.receiveShadow = true; g.add(m); }
  const e = merge(b.p.emit);
  if (e) g.add(new THREE.Mesh(e, emitMat));
  return g;
}

// ------------------------------------------------------------------ weapons
export interface GunModel { g: THREE.Group; grip: THREE.Vector3; fore: THREE.Vector3; muzzle: THREE.Vector3 }

/** Detailed weapon, +z forward, origin at the rear of the receiver (stock extends to -z). */
export function buildGun(kind: GunKind, torch: boolean): GunModel {
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
  pose?: 'swing' | 'fold' | 'talk' | 'brief' | 'lean';
  /** thumbing the shoulder radio */
  radio?: boolean;
  /** visual ground height under the feet (stair flights) */
  ground?: number;
  /** explicit velocity (world units/s) instead of position deltas: animate in place (sandbox) */
  vel?: { vx: number; vy: number };
}

export type Outfit = 'operator' | 'police' | 'loyalist' | 'loyalistElite' | 'cyborg' | 'cyborgElite';

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

/** Police head from a look, in head-group space (head sphere r ≈ 0.1 centred at y 0.06, face towards +z). */
function policeHead(hb: Builder, skin: number, lk: OfficerLook, santa = false) {
  // Christmas: every hat becomes a Santa hat (a beanie-like fit over the hair)
  const hat = santa ? 'beanie' : lk.hat ?? 'cap', hair = lk.hair ?? 'short', hc = lk.hairColor ?? 0x2a2018, fc = lk.facialColor ?? hc;
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
  else if (hat === 'cap' || hat === 'chief') {
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
  constructor(private teamColor: number, opts: { outfit?: Outfit; skin?: number; look?: OfficerLook; zombie?: boolean } = {}) {
    const outfit = (this.outfit = opts.outfit ?? 'operator');
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
    let skin = opts.look?.skin ?? opts.skin ?? P.skin;
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
    const NAVY = santa ? XM.red : 0x1f3668, NAVY2 = santa ? XM.red2 : 0x15264a, TROUSER = santa ? XM.red : 0x161e36;
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
    } else if (cop) {
      pb.rbox(0.33, 0.2, 0.21, 0.07, 0, 0, 0, TROUSER)
        .rbox(0.37, 0.055, 0.24, 0.02, 0, 0.08, 0, P.black) // duty belt
        .rbox(0.05, 0.12, 0.07, 0.015, 0.19, 0.02, 0.0, P.black).rbox(0.03, 0.05, 0.08, 0.01, 0.19, 0.1, 0.02, P.dark) // holstered sidearm
        .rbox(0.05, 0.06, 0.04, 0.012, 0.13, 0.07, 0.12, P.black) // cuff pouch
        .rbox(0.04, 0.07, 0.04, 0.012, -0.17, 0.06, 0.08, P.black) // spray
        .rbox(0.03, 0.03, 0.01, 0.005, -0.02, 0.085, 0.125, 0xc9b060); // buckle
    } else {
      pb.rbox(0.34, 0.2, 0.22, 0.07, 0, 0.0, 0, P.uniform2)
        .rbox(0.38, 0.06, 0.25, 0.02, 0, 0.08, 0, P.strap)
        .rbox(0.07, 0.1, 0.05, 0.015, 0.2, 0.02, 0.02, P.pouch);
      if (zom) pb.rbox(0.12, 0.1, 0.02, 0.02, 0.06, -0.02, 0.112, BLOOD); // blood-soaked trousers
      else pb.rbox(0.06, 0.12, 0.04, 0.015, -0.2, 0.0, 0.04, P.black); // drop holster
    }
    this.hips.add(meshes(pb, clothMat));
    this.hips.add(this.spine);
    this.spine.position.y = 0.08;
    this.spine.add(this.chest);
    this.chest.position.y = 0.12;
    const cb = new Builder();
    if (santa) {
      // red Santa coat: fur placket and collar, the badge pinned on, shoulder radio kept
      cb.limb(0.145, 0.48, 0, 0.44, 0, XM.red, 0, 0, 1.25, 0.78)
        .rbox(0.065, 0.42, 0.03, 0.014, 0, 0.21, 0.106, XM.fur)
        .rbox(0.22, 0.075, 0.18, 0.035, 0, 0.45, 0, XM.fur)
        .rbox(0.06, 0.07, 0.012, 0.006, -0.1, 0.3, 0.098, 0xd9c070) // badge
        .rbox(0.045, 0.065, 0.035, 0.01, -0.13, 0.4, 0.1, P.black) // shoulder mic
        .geo(new THREE.CylinderGeometry(0.004, 0.004, 0.08), P.black, -0.13, 0.46, 0.1);
    } else if (elf) {
      // tunic with a pointed collar and gold buttons
      cb.limb(0.145, 0.48, 0, 0.44, 0, E.coat, 0, 0, 1.25, 0.8).rbox(0.07, 0.36, 0.02, 0.01, 0, 0.22, 0.108, E.coat2);
      for (let i = 0; i < 3; i++) cb.geo(new THREE.SphereGeometry(0.017, 8, 6), XM.gold, 0, 0.32 - i * 0.1, 0.12);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; spike(cb, i % 2 ? E.trim : E.coat2, V(Math.sin(a) * 0.08, 0.45, Math.cos(a) * 0.065), V(Math.sin(a), -0.7, Math.cos(a)), 0.11, 0.04, 0.004, 4); }
      if (elite) cb.rbox(0.3, 0.022, 0.012, 0.005, 0, 0.06, 0.112, E.trim);
      if (cyb) {
        // spinal implant and a festive glowing core
        cb.rbox(0.08, 0.36, 0.06, 0.02, 0, 0.26, -0.13, 0x8a9096);
        for (const x of [-0.08, 0.08]) cb.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 6), 0x111214, x, 0.3, -0.12, 0.2, 0, 0);
        cb.rbox(0.05, 0.05, 0.015, 0.01, 0.08, 0.3, 0.11, GLOW, 0, 0, 0.4, 'emit');
      }
    } else if (cop) {
      // uniform shirt, slim duty vest, badge, name bar, epaulettes, shoulder radio
      cb.limb(0.145, 0.48, 0, 0.44, 0, NAVY, 0, 0, 1.25, 0.78)
        .rbox(0.36, 0.3, 0.07, 0.03, 0, 0.24, 0.085, NAVY2).rbox(0.34, 0.28, 0.06, 0.03, 0, 0.25, -0.085, NAVY2)
        .rbox(0.07, 0.08, 0.012, 0.006, -0.1, 0.32, 0.125, 0xd9c070) // badge
        .rbox(0.08, 0.02, 0.01, 0.004, 0.1, 0.33, 0.125, 0xd8d8d8) // name bar
        .rbox(0.11, 0.025, 0.1, 0.008, 0.2, 0.43, 0, NAVY2).rbox(0.11, 0.025, 0.1, 0.008, -0.2, 0.43, 0, NAVY2) // epaulettes
        .rbox(0.045, 0.065, 0.035, 0.01, -0.13, 0.4, 0.12, P.black) // shoulder mic
        .geo(new THREE.CylinderGeometry(0.004, 0.004, 0.08), P.black, -0.13, 0.46, 0.12)
        .rbox(0.15, 0.06, 0.13, 0.03, 0, 0.47, 0, NAVY) // collar
        .rbox(0.02, 0.2, 0.012, 0.005, 0, 0.3, 0.125, 0x10182e); // tie/placket
    } else if (zom) {
      // torn shirt: rotting skin through the rips, blood down the front, rags hanging off the hem
      cb.limb(0.15, 0.48, 0, 0.44, 0, P.uniform, 0, 0, 1.28, 0.8)
        .rbox(0.12, 0.1, 0.02, 0.03, 0.07, 0.3, 0.115, skin, 0, 0, 0.4).rbox(0.09, 0.07, 0.02, 0.02, -0.12, 0.1, 0.11, skin, 0, 0, -0.3)
        .rbox(0.07, 0.04, 0.012, 0.01, 0.07, 0.3, 0.126, ROT, 0, 0, 0.4) // wound
        .rbox(0.1, 0.2, 0.012, 0.02, -0.04, 0.24, 0.123, BLOOD, 0, 0, 0.15).rbox(0.05, 0.12, 0.012, 0.015, 0.1, 0.05, 0.12, BLOOD)
        .rbox(0.07, 0.1, 0.02, 0.01, -0.13, -0.03, 0.09, P.uniform, 0.25, 0, 0.3).rbox(0.06, 0.09, 0.02, 0.01, 0.1, -0.04, -0.09, P.uniform, -0.25, 0, -0.2) // rags
        .rbox(0.16, 0.06, 0.14, 0.03, 0, 0.47, 0, P.uniform2); // collar
      if (cyb) {
        // flesh peeled off the implants: bare metal ribs, cables and a cracked core
        for (let i = 0; i < 3; i++) cb.rbox(0.15, 0.022, 0.03, 0.01, -0.09, 0.32 - i * 0.065, 0.1, 0x8a9096, 0, 0, -0.12);
        cb.rbox(0.08, 0.36, 0.06, 0.02, 0, 0.26, -0.13, 0x5d646b);
        for (const x of [-0.08, 0.08]) cb.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 6), 0x111214, x, 0.3, -0.12, 0.2, 0, 0);
        cb.rbox(0.05, 0.05, 0.015, 0.01, 0.04, 0.3, 0.13, 0xff2020, 0, 0, 0.5, 'emit');
      }
    } else {
      cb.limb(0.15, 0.48, 0, 0.44, 0, P.uniform, 0, 0, 1.28, 0.8)
        .rbox(0.4, 0.34, 0.1, 0.03, 0, 0.24, 0.1, P.plate)
        .rbox(0.38, 0.32, 0.08, 0.03, 0, 0.25, -0.1, P.plate)
        .rbox(0.1, 0.06, 0.2, 0.02, 0.19, 0.36, 0, P.plate).rbox(0.1, 0.06, 0.2, 0.02, -0.19, 0.36, 0, P.plate) // shoulder straps
        .rbox(0.36, 0.05, 0.22, 0.02, 0, 0.1, 0, P.strap) // cummerbund
        .rbox(0.075, 0.11, 0.05, 0.015, -0.12, 0.16, 0.17, P.pouch).rbox(0.075, 0.11, 0.05, 0.015, 0, 0.16, 0.17, P.pouch).rbox(0.075, 0.11, 0.05, 0.015, 0.12, 0.16, 0.17, P.pouch)
        .rbox(0.07, 0.06, 0.04, 0.012, -0.11, 0.3, 0.16, P.pouch) // radio/admin
        .rbox(0.04, 0.12, 0.03, 0.01, -0.12, 0.36, 0.14, P.black) // radio antenna base
        .rbox(0.16, 0.06, 0.14, 0.03, 0, 0.47, 0, P.uniform2); // collar
      if (outfit === 'operator') cb.rbox(0.26, 0.24, 0.09, 0.04, 0, 0.22, -0.175, P.pouch).rbox(0.1, 0.16, 0.04, 0.015, 0, 0.2, -0.225, P.uniform2); // assault pack
      if (loy) cb.rbox(0.2, 0.2, 0.08, 0.03, 0, 0.2, -0.16, P.pouch); // small daypack
      if (cyb) {
        // spinal implant, cable bundles and a glowing chest core
        cb.rbox(0.08, 0.36, 0.06, 0.02, 0, 0.26, -0.16, 0x5d646b);
        for (const x of [-0.08, 0.08]) cb.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 6), 0x111214, x, 0.3, -0.14, 0.2, 0, 0);
        cb.rbox(0.06, 0.06, 0.015, 0.01, 0, 0.3, 0.152, 0xff2020, 0, 0, 0, 'emit');
        if (elite) cb.rbox(0.3, 0.02, 0.015, 0.005, 0, 0.4, 0.152, 0xff2020, 0, 0, 0, 'emit');
      }
      if (outfit === 'operator') { // team identity: shoulder IR patches
        cb.rbox(0.07, 0.05, 0.012, 0.005, -0.2, 0.29, 0.13, teamColor, 0, 0.5, 0, 'emit');
        cb.rbox(0.07, 0.05, 0.012, 0.005, 0.2, 0.29, 0.13, teamColor, 0, -0.5, 0, 'emit');
      }
    }
    this.chest.add(meshes(cb, gearMat));
    // head
    this.chest.add(this.neck);
    this.neck.position.set(0, 0.5, 0.01);
    this.neck.add(this.head);
    this.head.position.y = 0.1;
    const hb = new Builder()
      .limb(0.05, 0.12, 0, 0.02, 0, skin)
      .geo(new THREE.SphereGeometry(0.105, 16, 12), skin, 0, 0.06, 0.01, 0, 0, 0, 'solid', 0.9, 1.05, 1);
    if (cop) {
      policeHead(hb, skin, opts.look ?? {}, santa);
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
      hb.geo(new THREE.SphereGeometry(0.107, 14, 10, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.5), P.black, 0, 0.06, 0.012, 0, 0, 0, 'solid', 0.92, 1.05, 1.02) // face mask (lower half)
        .geo(new THREE.SphereGeometry(0.135, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), P.helmet, 0, 0.08, 0, 0, 0, 0, 'solid', 1, 0.92, 1.08) // helmet shell
        .rbox(0.2, 0.025, 0.24, 0.01, 0, 0.075, 0, P.strap) // helmet rim band
        .geo(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 14), P.dark, 0.115, 0.05, 0, 0, 0, Math.PI / 2) // ear pro
        .geo(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 14), P.dark, -0.115, 0.05, 0, 0, 0, Math.PI / 2)
        .rbox(0.05, 0.04, 0.04, 0.01, 0, 0.14, 0.12, P.metal) // NVG shroud
        .rbox(0.1, 0.035, 0.05, 0.012, 0, 0.12, 0.155, P.dark, 0.5) // flipped-up NVG
        .rbox(0.16, 0.035, 0.02, 0.01, 0, 0.075, 0.1, 0x10161a); // goggles
      hb.geo(new THREE.BoxGeometry(0.13, 0.012, 0.012), 0x60d8ff, 0, 0.075, 0.113, 0, 0, 0, 'emit'); // goggle lens glint
    }
    this.head.add(meshes(hb, gearMat));
    const st = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: teamColor, toneMapped: false }));
    st.position.set(0, 0.2, -0.08);
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
      const ub = new Builder().limb(metal ? 0.052 : 0.058, L_UP, 0, 0.02, 0, metal ? 0x8a9096 : sleeve).rbox(0.12, 0.08, 0.12, 0.035, sgn * 0.01, 0.0, 0, metal ? 0x5d646b : sleeve2);
      if (loy && side === 'L') ub.rbox(0.13, 0.05, 0.13, 0.02, 0, -0.1, 0, 0xb81414); // loyalist armband
      if (metal && elf) ub.rbox(0.115, 0.04, 0.115, 0.015, 0, -0.1, 0, XM.red).rbox(0.115, 0.04, 0.115, 0.015, 0, -0.22, 0, XM.red); // candy-cane stripes
      a.up.add(meshes(ub, metal ? gunMat : clothMat));
      a.fore.position.y = -L_UP;
      a.up.add(a.fore);
      const fb = new Builder().limb(0.05, L_FORE, 0, 0, 0, metal ? 0x8a9096 : zom ? skin : sleeve).limb(0.047, 0.1, 0, -L_FORE + 0.1, 0, cop ? sleeve2 : P.glove);
      if ((santa || elf) && !metal) fb.limb(0.06, 0.08, 0, -L_FORE + 0.12, 0, santa ? XM.fur : E.trim); // fur / trim cuff
      if (metal && elf) fb.rbox(0.105, 0.035, 0.105, 0.012, 0, -0.08, 0, XM.red);      if (zom && !metal) fb.rbox(0.12, 0.06, 0.12, 0.02, 0, -0.02, 0, sleeve, 0.2, 0, sgn * 0.2).rbox(0.04, 0.08, 0.012, 0.01, 0, -0.16, 0.048, BLOOD); // ragged sleeve end, gash
      if (cyb && side === 'R') fb.geo(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 8), elf ? GLOW : 0xff2020, 0, -0.12, 0.045, Math.PI / 2, 0, 0, 'emit');
      if (cop && side === 'L') fb.rbox(0.05, 0.02, 0.06, 0.008, 0, -L_FORE + 0.08, 0.03, 0x111111); // watch
      a.fore.add(meshes(fb, cyb && side === 'R' ? gunMat : clothMat));
      a.hand.position.y = -L_FORE;
      a.fore.add(a.hand);
      const hb2 = new Builder().rbox(0.065, 0.09, 0.05, 0.02, 0, -0.04, 0.005, hand);
      if (zom) for (const fx of [-0.022, 0, 0.022]) hb2.limb(0.009, 0.07, fx, -0.08, 0.02, metal ? 0x8a9096 : 0x2a2618, 0.5); // claws
      a.hand.add(meshes(hb2, clothMat));
    }
    // legs
    for (const side of ['L', 'R'] as const) {
      const l = this.leg[side], sgn = side === 'L' ? -1 : 1;
      l.thigh.position.set(sgn * 0.1, -0.03, 0);
      this.hips.add(l.thigh);
      // elves: striped stockings (white with coloured rings)
      const stripes = (b: Builder, r: number, len: number) => { for (let y = -0.07; y > -len + 0.04; y -= 0.09) b.geo(new THREE.CylinderGeometry(r, r, 0.045, 10), E.stripe, 0, y, 0, 0, 0, 0, 'solid', 1, 1, 1.05); };
      const tb = new Builder().limb(0.085, L_THIGH, 0, 0.02, 0, cop ? TROUSER : elf ? XM.fur : P.uniform, 0, 0, 1, 1.05);
      if (elf) stripes(tb, 0.088, L_THIGH);
      else if (zom) { if (side === 'R') tb.rbox(0.1, 0.14, 0.02, 0.02, 0, -0.2, 0.078, BLOOD); }
      else if (!cop) tb.rbox(0.07, 0.12, 0.05, 0.015, sgn * 0.075, -0.18, 0.01, P.pouch);
      l.thigh.add(meshes(tb, clothMat));
      l.shin.position.y = -L_THIGH;
      l.thigh.add(l.shin);
      const sb = new Builder().limb(0.068, L_SHIN, 0, 0, 0, cop ? TROUSER : elf ? XM.fur : P.uniform);
      if (santa) sb.rbox(0.15, 0.17, 0.16, 0.045, 0, -L_SHIN + 0.07, 0, 0x0e0e10).rbox(0.165, 0.045, 0.175, 0.02, 0, -L_SHIN + 0.16, 0, XM.fur); // tall black boot, fur top
      else if (elf) stripes(sb, 0.071, L_SHIN);
      else if (zom) { if (side === 'L') sb.rbox(0.1, 0.18, 0.03, 0.02, 0, -0.26, 0.055, skin); } // trouser leg torn away
      else if (!cop) sb.rbox(0.11, 0.11, 0.06, 0.03, 0, -0.03, 0.06, P.knee);
      l.shin.add(meshes(sb, clothMat));
      l.foot.position.y = -L_SHIN;
      l.shin.add(l.foot);
      const ftb = new Builder();
      if (elf) {
        // pointy shoe, the toe curling up into a little ball (gold bell on the belled elves)
        ftb.rbox(0.1, 0.08, 0.2, 0.035, 0, -0.04, 0.03, E.shoe).rbox(0.105, 0.02, 0.21, 0.008, 0, -0.078, 0.03, 0x2a1a10);
        const t1 = spike(ftb, E.shoe, V(0, -0.05, 0.11), V(0, 0.15, 1), 0.12, 0.042, 0.02, 8);
        const t2 = spike(ftb, E.shoe, t1, V(0, 1, -0.2), 0.06, 0.02, 0.008, 6);
        ftb.geo(new THREE.SphereGeometry(0.016, 8, 6), bell ? XM.gold : E.trim, t2.x, t2.y, t2.z);
      } else ftb.rbox(0.11, 0.09, 0.26, 0.035, 0, -0.035, 0.05, cop ? 0x0e0e10 : P.boot).rbox(0.115, 0.022, 0.27, 0.01, 0, -0.078, 0.05, P.black);
      l.foot.add(meshes(ftb, gearMat));
    }
    this.chest.add(this.gunHolder);
    const kb = new Builder().rbox(0.025, 0.03, 0.1, 0.008, 0, 0, 0, P.black).geo(new THREE.BoxGeometry(0.006, 0.03, 0.16), 0xb8c0c8, 0, 0.005, 0.12);
    this.knife = meshes(kb, gunMat);
    this.knife.rotation.x = 0.4;
    this.knife.position.set(0, -0.08, 0.03);
    this.knife.visible = false;
    this.arm.R.hand.add(this.knife);
  }

  setGun(kind: GunKind | null) {
    if (kind === this.gunKind) return;
    this.gunKind = kind;
    if (this.gun) this.gunHolder.remove(this.gun.g);
    this.gun = kind ? buildGun(kind, true) : null;
    if (this.gun) this.gunHolder.add(this.gun.g);
    this.knife.visible = !kind && this.outfit === 'operator';
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
    if (this.gun) {
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
      const right = q >= 0 ? V(0.28 - q * 0.45, 0.32 - q * 0.08, 0.12 + Math.sin(q * Math.PI) * 0.42) : V(0.16, 0.12 + breathe, 0.3);
      this.ik('R', right, poleR);
      this.ik('L', this.throwT > 0 ? V(-0.1, 0.45, 0.5) : V(-0.14, 0.16, 0.3), poleL);
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
