import * as THREE from 'three';
import { Builder, merge, cloneRig } from './models';
import { currentHoliday } from '../config/holiday';

/**
 * Articulated street animals: pigeons (head-bob walk, two-joint wings) and rats (scurry gait, segmented tail).
 * Halloween: crows and black rats. Christmas: white doves and grey rabbits. Easter: fluffy yellow chicks and white or
 * light-brown baby bunnies with pastel ribbons (same rigs and behaviour).
 */
const furMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
const sheenMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.45 }); // iridescent neck
const eyeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.2 });
const glowEyeMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }); // Halloween crows

function mesh(b: Builder, mat: THREE.Material = furMat): THREE.Group {
  const g = new THREE.Group();
  const m = merge(b.p.solid);
  if (m) { const x = new THREE.Mesh(m, mat); x.castShadow = true; g.add(x); }
  return g;
}
const ell = (r: number) => new THREE.SphereGeometry(r, 14, 10);

// ------------------------------------------------------------------ pigeon
export class Pigeon {
  root = new THREE.Group();
  private body = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private wing = { L: { sh: new THREE.Group(), tip: new THREE.Group() }, R: { sh: new THREE.Group(), tip: new THREE.Group() } };
  private tail = new THREE.Group();
  private leg = { L: new THREE.Group(), R: new THREE.Group() };
  private step = 0;
  private folded = new THREE.Group();
  private flight = new THREE.Group();

  private static protos = new Map<string, Pigeon>();
  /** Built once per plumage (and holiday), copied after that. */
  static make(variant: number): Pigeon {
    const key = `${variant % 4}:${currentHoliday()}`;
    let p = Pigeon.protos.get(key);
    if (!p) Pigeon.protos.set(key, (p = new Pigeon(variant)));
    return cloneRig(p);
  }

  constructor(variant: number) {
    // Halloween: same bird, dressed as a crow (glossy black, heavier black beak, glowing red eyes, a size up)
    const crow = currentHoliday() === 'halloween';
    // Christmas: a slimmer pure-white dove (pale grey wingtips, small dark eyes and beak, pinkish-orange feet)
    const dove = currentHoliday() === 'xmas';
    // Easter: a round fluffy yellow chick (big head, a head tuft, tiny orange beak and feet, stubby wings)
    const chick = currentHoliday() === 'easter';
    const grey = chick ? [0xf6d44a, 0xf8dc5c, 0xf2cc3c, 0xfae070][variant % 4] : crow ? [0x18191d, 0x1c1d22, 0x141518, 0x202126][variant % 4] : dove ? [0xe6e7e6, 0xe2e3e5, 0xeaeae8, 0xdfe0e3][variant % 4] : [0x7b8089, 0x8c9098, 0x676b74, 0x9a8f86][variant % 4];
    const dark = chick ? 0xe8b830 : crow ? 0x0b0b0e : dove ? 0xc4c8ce : 0x3b3e45;
    const white = dove ? 0xeeeeec : chick ? 0xfff0a0 : 0;

    // crows are a size up; scaled inside root because the street and sandbox set root.scale themselves
    const size = new THREE.Group();
    if (crow) size.scale.setScalar(1.35);
    if (dove) size.scale.set(0.85, 0.95, 1.05);
    if (chick) size.scale.setScalar(0.9);
    this.root.add(size);
    size.add(this.body);
    this.body.position.y = 0.11;
    const bb = new Builder()
      .geo(ell(0.075), grey, 0, 0, 0, 0, 0, 0, 'solid', chick ? 1.05 : 1, chick ? 1 : 0.85, chick ? 1.1 : 1.5)
      .geo(ell(0.06), crow ? 0x222329 : dove || chick ? white : 0xa4a8b0, 0, -0.022, 0.03, 0, 0, 0, 'solid', 1, 0.8, 1.2); // pale breast
    this.body.add(mesh(bb));
    // neck with iridescent green/purple sheen
    this.neck.position.set(0, 0.045, 0.075);
    this.body.add(this.neck);
    const nb = new Builder()
      .geo(ell(0.042), chick ? grey : crow ? 0x1a1f2c : dove ? white : 0x3f7f62, 0, 0.02, 0, 0.2, 0, 0, 'solid', 1, 1.35, 1)
      .geo(ell(0.043), chick ? grey : crow ? 0x1e1a28 : dove ? white : 0x6a4a8e, 0, 0.005, -0.004, 0.2, 0, 0, 'solid', 1.02, 0.9, 1);
    this.neck.add(mesh(nb, dove || chick ? furMat : sheenMat));
    this.head.position.set(0, 0.06, 0.018);
    this.neck.add(this.head);
    const hb = new Builder().geo(ell(chick ? 0.05 : 0.036), chick ? grey : crow ? 0x16171b : dove ? white : 0x5c616b, 0, 0, 0, 0, 0, 0, 'solid', 0.95, 1, chick ? 1 : 1.12);
    if (chick) {
      hb.geo(new THREE.ConeGeometry(0.01, 0.022, 8), 0xf08a1c, 0, -0.006, 0.058, Math.PI / 2); // tiny orange beak
      for (const a of [-0.4, 0, 0.4]) hb.geo(ell(0.012), grey, Math.sin(a) * 0.012, 0.05, -0.006, 0, 0, a, 'solid', 0.5, 1.6, 0.5); // fluffy tuft
    } else if (dove) hb.geo(new THREE.ConeGeometry(0.009, 0.03, 8), 0x4a3c3c, 0, -0.006, 0.046, Math.PI / 2).geo(ell(0.007), 0xe8d8d0, 0, 0.003, 0.035); // small dark beak, pale cere
    else if (crow) hb.geo(new THREE.ConeGeometry(0.015, 0.05, 8), 0x0c0c0e, 0, -0.004, 0.054, Math.PI / 2); // heavy crow beak
    else hb.geo(new THREE.ConeGeometry(0.011, 0.034, 8), 0x8a7870, 0, -0.006, 0.047, Math.PI / 2).geo(ell(0.009), 0xe8e4dc, 0, 0.004, 0.036); // beak, cere
    this.head.add(mesh(hb));
    const eye = crow ? 0xff1a10 : dove || chick ? 0x0c0c0e : 0xff8a20, er = crow ? 0.0095 : dove ? 0.007 : 0.0085;
    const ex = chick ? 0.032 : 0.026, ez = chick ? 0.038 : 0.016;
    const eb = new Builder().geo(ell(er), eye, -ex, 0.008, ez).geo(ell(er), eye, ex, 0.008, ez);
    this.head.add(mesh(eb, crow ? glowEyeMat : eyeMat));
    // folded wings: shaped panels hugging the flanks, dark wing bars, primaries crossing over the tail
    const fb = new Builder();
    for (const s of [-1, 1]) {
      fb.geo(ell(0.06), grey, s * 0.052, 0.022, -0.02, 0.12, s * 0.12, 0, 'solid', 0.32, 0.62, 1.55)
        .geo(ell(0.02), dark, s * 0.07, 0.022, -0.005, 0.1, s * 0.12, 0, 'solid', 0.4, 0.5, 1.6)
        .geo(ell(0.02), dark, s * 0.068, 0.02, -0.045, 0.1, s * 0.12, 0, 'solid', 0.4, 0.5, 1.6)
        .geo(ell(0.04), dark, s * 0.03, 0.03, -0.11, 0.2, -s * 0.18, 0, 'solid', 0.3, 0.3, 1.6);
    }
    this.folded.add(mesh(fb));
    this.body.add(this.folded, this.flight);
    // two-joint flight wings with dark bars
    for (const side of ['L', 'R'] as const) {
      const w = this.wing[side], s = side === 'L' ? -1 : 1;
      w.sh.position.set(s * 0.05, 0.025, 0.015);
      this.flight.add(w.sh);
      const ib = new Builder().rbox(0.12, 0.014, 0.13, 0.006, s * 0.06, 0, -0.02, grey)
        .rbox(0.1, 0.016, 0.018, 0.004, s * 0.06, 0.001, -0.035, dark).rbox(0.1, 0.016, 0.018, 0.004, s * 0.06, 0.001, -0.065, dark);
      w.sh.add(mesh(ib));
      w.tip.position.set(s * 0.12, 0, -0.01);
      w.sh.add(w.tip);
      w.tip.add(mesh(new Builder().rbox(0.13, 0.01, 0.095, 0.005, s * 0.065, 0, -0.03, dark)));
    }
    this.tail.position.set(0, 0.012, -0.1);
    this.body.add(this.tail);
    if (chick) this.tail.scale.set(0.8, 2, 0.35); // a short fluffy stub
    this.tail.add(mesh(new Builder().rbox(0.07, 0.01, 0.1, 0.005, 0, 0, -0.045, grey).rbox(0.072, 0.011, 0.022, 0.004, 0, 0.001, -0.085, dove ? dark : 0x2c2e33)));
    for (const side of ['L', 'R'] as const) {
      const l = this.leg[side];
      l.position.set((side === 'L' ? -1 : 1) * 0.024, -0.05, 0.012);
      this.body.add(l);
      const legC = chick ? 0xf08a1c : crow ? 0x1a1a1c : dove ? 0xe88a6a : 0xc86a6a;
      const lb = new Builder().geo(new THREE.CylinderGeometry(0.0045, 0.0045, 0.06, 5), legC, 0, -0.03, 0);
      for (const a of [-0.45, 0, 0.45]) lb.rbox(0.006, 0.004, 0.028, 0.002, Math.sin(a) * 0.012, -0.06, Math.cos(a) * 0.012, legC, 0, a);
      l.add(mesh(lb));
    }
    this.fold(1);
  }

  /** 1: wings folded on the flanks; 0: flight wings spread. */
  private fold(k: number) {
    this.folded.visible = k > 0.5;
    this.flight.visible = k <= 0.5;
  }

  /** Ground behaviour. speed m/s; mode peck/look/walk. */
  ground(t: number, dt: number, speed: number, mode: 'walk' | 'peck' | 'look') {
    this.fold(1);
    this.step += speed * dt * 24;
    const st = this.step;
    // pigeon head-bob: the head thrusts forward then holds still while the body catches up
    const saw = (st / (Math.PI * 2)) % 1;
    const thrust = saw < 0.35 ? saw / 0.35 : 1 - (saw - 0.35) / 0.65 * 0.0;
    this.neck.position.z = 0.075 + (speed > 0.05 ? (saw < 0.35 ? thrust * 0.03 : 0.03 - ((saw - 0.35) / 0.65) * 0.03) : 0);
    this.leg.L.rotation.x = speed > 0.05 ? Math.sin(st) * 0.6 : 0;
    this.leg.R.rotation.x = speed > 0.05 ? -Math.sin(st) * 0.6 : 0;
    this.body.rotation.z = speed > 0.05 ? Math.sin(st) * 0.08 : 0;
    this.body.position.y = 0.11;
    this.tail.rotation.x = 0.15 + Math.sin(t * 3) * 0.03;
    if (mode === 'peck') {
      const p = Math.max(0, Math.sin(t * 7));
      this.body.rotation.x = 0.35 + p * 0.25;
      this.neck.rotation.x = 0.6 + p * 0.5;
      this.head.rotation.y = 0;
    } else {
      this.body.rotation.x = 0.05;
      this.neck.rotation.x = -0.1;
      this.head.rotation.y = mode === 'look' ? Math.sin(t * 1.6) * 0.9 : 0;
    }
  }

  /** In the air: flap (0..1 effort), pitch in radians (nose up negative). */
  air(t: number, flap: number, pitch: number, legsDown: number) {
    this.fold(0);
    const a = Math.sin(t * 28);
    for (const [side, s] of [['L', -1], ['R', 1]] as const) {
      const w = this.wing[side];
      w.sh.rotation.set(0, 0, s * (0.15 + a * 0.95 * flap + (1 - flap) * 0.1));
      w.tip.rotation.set(0, 0, s * (Math.sin(t * 28 - 0.7) * 0.65 * flap));
    }
    this.body.rotation.x = pitch;
    this.body.rotation.z = 0;
    this.neck.rotation.x = -0.25;
    this.neck.position.z = 0.075;
    this.tail.rotation.x = -0.1 + (1 - flap) * 0.3; // fan out to brake
    this.leg.L.rotation.x = this.leg.R.rotation.x = 1.3 * (1 - legsDown);
    this.body.position.y = 0.11;
  }
}

// ------------------------------------------------------------------ rat
export class Rat {
  root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private nose!: THREE.Object3D;
  private legs: THREE.Group[] = [];
  private tail: THREE.Group[] = [];
  private gait = 0;
  private rabbit = false;
  private static count = 0; // varies the rabbits' coats in creation order (deterministic per floor)

  constructor() {
    if (currentHoliday() === 'xmas' || currentHoliday() === 'easter') { this.buildRabbit(Rat.count++, currentHoliday() === 'easter'); return; }
    const hal = currentHoliday() === 'halloween'; // Halloween: black fur, glowing red eyes, long front teeth
    const fur = hal ? 0x141414 : 0x4d423a, fur2 = hal ? 0x0b0b0b : 0x3a312b, pink = 0xc99a90;
    this.root.add(this.body);
    this.body.position.y = 0.06;
    const bb = new Builder()
      .geo(ell(0.06), fur, 0, 0, 0.01, 0, 0, 0, 'solid', 0.95, 0.78, 1.55)
      .geo(ell(0.055), fur2, 0, 0.005, -0.055, 0, 0, 0, 'solid', 1.05, 0.95, 1) // haunches
      .geo(ell(0.04), hal ? 0x222222 : 0x6a5c52, 0, -0.03, 0.03, 0, 0, 0, 'solid', 0.9, 0.5, 1.3); // belly
    this.body.add(mesh(bb));
    this.head.position.set(0, 0.018, 0.09);
    this.body.add(this.head);
    const hb = new Builder()
      .geo(ell(0.036), fur, 0, 0, 0, 0, 0, 0, 'solid', 0.95, 0.9, 1.1)
      .geo(new THREE.ConeGeometry(0.026, 0.07, 10), fur, 0, -0.004, 0.045, Math.PI / 2)
      .geo(new THREE.CylinderGeometry(0.02, 0.02, 0.005, 12), 0x8a6a64, -0.024, 0.03, -0.008, 0.2, 0, 0.9) // ears
      .geo(new THREE.CylinderGeometry(0.02, 0.02, 0.005, 12), 0x8a6a64, 0.024, 0.03, -0.008, 0.2, 0, -0.9);
    for (const s of [-1, 1]) for (const k of [-1, 0, 1]) hb.geo(new THREE.CylinderGeometry(0.0008, 0.0008, 0.07, 3), 0xd8d0c8, s * 0.03, -0.004 + k * 0.004, 0.06, 0, s * (0.3 + k * 0.15), Math.PI / 2);
    this.head.add(mesh(hb));
    const eye = hal ? 0xff1a10 : 0x050505, er = hal ? 0.0085 : 0.007;
    this.head.add(mesh(new Builder().geo(ell(er), eye, -0.017, 0.013, 0.022).geo(ell(er), eye, 0.017, 0.013, 0.022), hal ? glowEyeMat : eyeMat));
    // long yellowed incisors hanging from under the snout tip, with a shorter lower pair
    if (hal) this.head.add(mesh(new Builder()
      .rbox(0.008, 0.045, 0.005, 0.002, -0.0045, -0.036, 0.073, 0xf0e2b0, 0.15).rbox(0.008, 0.045, 0.005, 0.002, 0.0045, -0.036, 0.073, 0xf0e2b0, 0.15)
      .rbox(0.004, 0.014, 0.003, 0.001, -0.003, -0.022, 0.062, 0xe8d8a8, -0.3).rbox(0.004, 0.014, 0.003, 0.001, 0.003, -0.022, 0.062, 0xe8d8a8, -0.3)));
    this.nose = mesh(new Builder().geo(ell(0.008), 0xe08a8a, 0, 0, 0));
    this.nose.position.set(0, -0.004, 0.082);
    this.head.add(this.nose);
    for (const [x, z] of [[-0.035, 0.05], [0.035, 0.05], [-0.04, -0.05], [0.04, -0.05]]) {
      const l = new THREE.Group();
      l.position.set(x, -0.02, z);
      l.add(mesh(new Builder().limb(0.011, 0.045, 0, 0, 0, fur2).rbox(0.016, 0.006, 0.022, 0.003, 0, -0.045, 0.006, pink)));
      this.body.add(l);
      this.legs.push(l);
    }
    // segmented tail (each segment parented to the previous for sinuous motion)
    let parent: THREE.Object3D = this.body;
    let z = -0.1;
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? -0.005 : 0, z);
      const r = 0.009 * (1 - i * 0.13);
      const g = new THREE.CapsuleGeometry(r, 0.03, 2, 6);
      g.rotateX(Math.PI / 2); g.translate(0, 0, -0.02);
      seg.add(mesh(new Builder().geo(g, pink, 0, 0, 0)));
      parent.add(seg);
      this.tail.push(seg);
      parent = seg;
      z = -0.04;
    }
  }

  /**
   * Christmas: a cute grey rabbit on the same joints (round body, big hind legs, long upright ears with pink insides,
   * big dark eyes, pink twitchy nose, white cotton tail); scaled up inside root since the street and sandbox set
   * root.scale themselves. legs[2..3] are the hind legs, tail[0..1] the two ears (so update() can twitch them).
   * Easter: a smaller baby bunny, white or light brown, both ears up and a pastel ribbon bow round the neck.
   */
  private buildRabbit(variant: number, easter = false) {
    this.rabbit = true;
    const [fur, light] = (easter
      ? [[0xf4f2ee, 0xffffff], [0xc8a27a, 0xf0e2cc], [0xece6dc, 0xfffaf2], [0xb88e66, 0xeedcc4]] as const
      : [[0x8e9096, 0xd4d4d6], [0x9c9a98, 0xdcd8d4], [0x7c7f86, 0xc8cacc], [0xa6a8ac, 0xe2e2e4]] as const)[variant % 4];
    const pink = 0xe8a8b0, white = 0xf6f6f4, size = new THREE.Group();
    size.scale.setScalar(easter ? 1.25 : 1.45);
    this.root.add(size);
    size.add(this.body);
    this.body.position.y = 0.06;
    const bb = new Builder()
      .geo(ell(0.06), fur, 0, 0.008, -0.01, 0, 0, 0, 'solid', 0.95, 0.9, 1.2) // round body
      .geo(ell(0.04), light, 0, -0.016, 0.03, 0, 0, 0, 'solid', 0.85, 0.75, 1) // pale belly
      .geo(ell(0.026), white, 0, 0.03, -0.085); // cotton tail
    for (const sx of [-1, 1]) bb.geo(ell(0.034), fur, sx * 0.04, -0.008, -0.035, 0, 0, 0, 'solid', 0.6, 0.95, 1.3); // haunches
    this.body.add(mesh(bb));
    this.head.position.set(0, 0.05, 0.065);
    this.body.add(this.head);
    if (easter) { // pastel ribbon round the neck, bow at the front
      const rc = [0xf4b6c8, 0xa8d4f0, 0xa8e6c8, 0xc8b4ec][variant % 4];
      this.body.add(mesh(new Builder().geo(new THREE.TorusGeometry(0.03, 0.009, 5, 14), rc, 0, 0.035, 0.05, Math.PI / 2 - 0.5)
        .geo(ell(0.016), rc, -0.017, 0.024, 0.08, 0, 0, 0.5, 'solid', 1.4, 0.8, 0.5).geo(ell(0.016), rc, 0.017, 0.024, 0.08, 0, 0, -0.5, 'solid', 1.4, 0.8, 0.5)));
    }
    const hb = new Builder()
      .geo(ell(0.038), fur, 0, 0, 0, 0, 0, 0, 'solid', 1, 0.95, 1.05)
      .geo(ell(0.022), light, 0, -0.016, 0.026, 0, 0, 0, 'solid', 1.15, 0.8, 0.9); // pale muzzle and chin
    for (const sx of [-1, 1]) hb.geo(ell(0.012), light, sx * 0.011, -0.011, 0.034); // whisker pads
    for (const sx of [-1, 1]) for (const k of [-1, 1]) hb.geo(new THREE.CylinderGeometry(0.0006, 0.0006, 0.05, 3), 0xf0f0f0, sx * 0.03, -0.01 + k * 0.003, 0.03, 0, sx * (0.3 + k * 0.12), Math.PI / 2);
    this.head.add(mesh(hb));
    this.head.add(mesh(new Builder().geo(ell(0.0115), 0x060606, -0.027, 0.01, 0.022).geo(ell(0.0115), 0x060606, 0.027, 0.01, 0.022)
      .geo(ell(0.003), 0xffffff, -0.029, 0.016, 0.032).geo(ell(0.003), 0xffffff, 0.031, 0.016, 0.032), eyeMat)); // big dark eyes with a glint
    this.nose = mesh(new Builder().geo(ell(0.006), pink, 0, 0, 0, 0, 0, 0, 'solid', 1.3, 0.8, 0.8), eyeMat);
    this.nose.position.set(0, -0.004, 0.047);
    this.head.add(this.nose);
    // long ears: grey backs, pale pink insides; the right one flops over a little
    for (const sx of [-1, 1]) {
      const e = new THREE.Group();
      e.position.set(sx * 0.016, 0.03, -0.01);
      e.rotation.set(-0.15, 0, -sx * (sx > 0 && !easter ? 0.7 : 0.18));
      e.userData.rz = e.rotation.z;
      e.add(mesh(new Builder().geo(ell(0.016), fur, 0, 0.045, 0, 0, 0, 0, 'solid', 0.75, 3, 0.4).geo(ell(0.012), pink, 0, 0.045, 0.004, 0, 0, 0, 'solid', 0.7, 3, 0.25)));
      this.head.add(e);
      this.tail.push(e);
    }
    // short front paws, big hind legs with long white-tipped feet flat on the ground
    for (const [x, z, hind] of [[-0.022, 0.04, 0], [0.022, 0.04, 0], [-0.04, -0.035, 1], [0.04, -0.035, 1]]) {
      const l = new THREE.Group();
      l.position.set(x, -0.02, z);
      l.add(mesh(hind
        ? new Builder().geo(ell(0.016), fur, 0, -0.018, 0, 0, 0, 0, 'solid', 1, 1.3, 1).geo(ell(0.012), light, 0, -0.039, 0.02, 0, 0, 0, 'solid', 0.9, 0.5, 2.6)
        : new Builder().limb(0.009, 0.04, 0, 0, 0, fur).geo(ell(0.01), light, 0, -0.038, 0.005, 0, 0, 0, 'solid', 1, 0.6, 1.3)));
      this.body.add(l);
      this.legs.push(l);
    }
  }

  /** speed m/s; sniff = paused & twitching; rear = standing on hind legs (the rabbit sits up, ears high). */
  update(t: number, dt: number, speed: number, sniff: boolean, rear: number) {
    if (this.rabbit) { this.hop(t, dt, speed, sniff, rear); return; }
    this.gait += speed * dt * 38;
    const g = this.gait, run = Math.min(1, speed / 2);
    // diagonal-pair gait
    this.legs[0].rotation.x = Math.sin(g) * 0.8 * run;
    this.legs[3].rotation.x = Math.sin(g) * 0.8 * run;
    this.legs[1].rotation.x = -Math.sin(g) * 0.8 * run;
    this.legs[2].rotation.x = -Math.sin(g) * 0.8 * run;
    // spine undulation while scurrying, rearing up when curious
    this.body.rotation.x = Math.sin(g * 2) * 0.1 * run - rear * 0.9;
    this.body.position.y = 0.06 + Math.abs(Math.sin(g)) * 0.012 * run + rear * 0.05;
    if (rear > 0.1) { this.legs[0].rotation.x = this.legs[1].rotation.x = -1.2 * rear; }
    this.head.rotation.x = sniff ? Math.sin(t * 9) * 0.15 - 0.1 : -0.05 + rear * 0.6;
    this.head.rotation.y = sniff ? Math.sin(t * 2.3) * 0.5 : 0;
    this.nose.scale.setScalar(sniff ? 1 + Math.max(0, Math.sin(t * 22)) * 0.35 : 1);
    this.tail.forEach((s, i) => {
      s.rotation.y = Math.sin(t * (run > 0.2 ? 12 : 2.5) - i * 0.8) * (run > 0.2 ? 0.28 : 0.18);
      s.rotation.x = i === 0 ? -0.15 + rear * 0.7 : 0.06;
    });
  }

  /** Rabbit: hop gait (hind legs push off together, front paws reach to land), nose twitch, ear flicks, sitting up. */
  private hop(t: number, dt: number, speed: number, sniff: boolean, rear: number) {
    this.gait += speed * dt * 22;
    const run = Math.min(1, speed / 2), ph = Math.sin(this.gait), air = Math.max(0, ph) * run;
    this.legs[0].rotation.x = this.legs[1].rotation.x = -ph * 0.7 * run - rear * 1.1; // front paws tuck up when sitting
    this.legs[2].rotation.x = this.legs[3].rotation.x = ph * 0.9 * run + rear * 0.9; // hind feet stay flat as the body tips up
    this.body.rotation.x = -ph * 0.25 * run - rear * 0.9;
    this.body.position.y = 0.06 + air * 0.05 + rear * 0.04;
    this.head.rotation.x = sniff ? Math.sin(t * 9) * 0.1 - 0.15 : -0.05 + rear * 0.75;
    this.head.rotation.y = sniff ? Math.sin(t * 2.3) * 0.5 : 0;
    // the nose never quite stops; it twitches hard when sniffing
    this.nose.scale.setScalar(1 + Math.max(0, Math.sin(t * (sniff ? 30 : 12))) * (sniff ? 0.45 : 0.12));
    this.tail.forEach((e, i) => { // ears: swept back mid-hop, pricked up when sitting, quick flicks while sniffing
      const flick = sniff && Math.sin(t * 1.7 + i * 2) > 0.7 ? Math.sin(t * 40) * 0.25 : 0;
      e.rotation.x = -0.15 - run * 0.6 + rear * 0.2;
      e.rotation.z = e.userData.rz * (1 - rear * 0.5) + flick;
    });
  }
}
