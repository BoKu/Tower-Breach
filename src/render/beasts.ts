import * as THREE from 'three';
import { Builder, merge } from './models';
import { currentHoliday } from '../config/holiday';

/**
 * Articulated attack dogs / cyber-hounds (walk, trot and gallop gaits, bite lunge, sleep and death poses) and
 * quadcopter patrol drones (spinning rotors, banking flight, independent gun turret, crash on death).
 * Halloween dresses drones as giant bats and the warden as a club-wielding ogre (both melee only).
 * Christmas turns dogs into hopping snowmen and gives drones antlers and a red nose, the warden a Santa hat and tinsel.
 * Easter turns dogs into hopping chocolate bunnies (cyber: a gold-foil-wrapped one with a glowing eye) and gives
 * drones and the warden pastel bunny ears (the warden a big bow too).
 */
const furMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02 });
const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.8 });
const emitMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
/** bat wing membrane: thin, so both faces render */
const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });

function part(b: Builder, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const s = merge(b.p.solid);
  if (s) { const m = new THREE.Mesh(s, mat); m.castShadow = true; g.add(m); }
  const e = merge(b.p.emit);
  if (e) g.add(new THREE.Mesh(e, emitMat));
  return g;
}
const ell = (r: number) => new THREE.SphereGeometry(r, 14, 10);
const chocMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.05 }); // glossy chocolate

/** Easter: two upright pastel bunny ears (pink insides) on a part's top, `s` = size. */
function bunnyEars(b: Builder, color: number, x: number, y: number, z: number, s: number) {
  for (const sx of [-1, 1]) {
    b.geo(ell(0.05 * s), color, x + sx * 0.07 * s, y + 0.14 * s, z, -0.15, 0, -sx * 0.2, 'solid', 0.8, 3, 0.4)
      .geo(ell(0.034 * s), 0xf0a0b4, x + sx * 0.07 * s, y + 0.13 * s, z + 0.012 * s, -0.15, 0, -sx * 0.2, 'solid', 0.8, 3, 0.3);
  }
}

export interface BeastInput { dt: number; t: number; x: number; y: number; facing: number; state: string; ground: number; alert: boolean; targetX?: number; targetY?: number; vel?: { vx: number; vy: number } }

// ------------------------------------------------------------------ dog
export class DogRig {
  root = new THREE.Group();
  private body = new THREE.Group();
  private haunch = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private jaw = new THREE.Group();
  private tail: THREE.Group[] = [];
  private legs: { hip: THREE.Group; knee: THREE.Group; paw: THREE.Group; front: boolean; side: number }[] = [];
  private eye!: THREE.Object3D;
  private phase = 0; private lastX = NaN; private lastY = NaN; private speed = 0;
  private biteT = 0; private deadK = 0; private sleepK = 0;
  private snowman = false; // an upright hopper (Christmas snowman, Easter bunny): updateSnowman drives it

  constructor(private cyber: boolean) {
    if (currentHoliday() === 'halloween') { this.buildSkeleton(); return; }
    if (currentHoliday() === 'xmas') { this.buildSnowman(); return; }
    if (currentHoliday() === 'easter') { this.buildBunny(); return; }
    const back = cyber ? 0x2a2826 : 0x1f1813, tan = cyber ? 0x4a4642 : 0x8a5a30, metal = 0x7d858c, dark = 0x1a1a1c;
    this.root.add(this.body);
    this.body.position.y = 0.58;
    const tb = new Builder()
      .geo(ell(0.16), back, 0, 0.02, 0.14, 0, 0, 0, 'solid', 1, 1.15, 1.45) // chest
      .geo(ell(0.13), back, 0, 0.03, -0.08, 0, 0, 0, 'solid', 0.95, 0.9, 1.5) // loin
      .geo(ell(0.12), tan, 0, -0.07, 0.16, 0, 0, 0, 'solid', 0.9, 0.9, 1.3); // brisket
    if (cyber) {
      tb.rbox(0.26, 0.05, 0.48, 0.02, 0, 0.17, 0.02, metal).rbox(0.2, 0.04, 0.12, 0.015, 0, 0.18, -0.24, metal); // dorsal armour
      for (const x of [-0.05, 0.05]) tb.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.44, 6), dark, x, 0.2, 0.0, Math.PI / 2);
      tb.rbox(0.04, 0.04, 0.02, 0.01, 0, 0.21, 0.2, 0xff2020, 0, 0, 0, 'emit'); // spinal node light
    }
    this.body.add(part(tb, furMat));
    this.haunch.position.set(0, 0.02, -0.22);
    this.body.add(this.haunch);
    this.haunch.add(part(new Builder().geo(ell(0.14), back, 0, 0, -0.05, 0, 0, 0, 'solid', 1, 1.05, 1.2), furMat));
    // neck & head
    this.neck.position.set(0, 0.1, 0.34);
    this.body.add(this.neck);
    this.neck.add(part(new Builder().geo(ell(0.09), back, 0, 0.06, 0.04, -0.7, 0, 0, 'solid', 1, 1.6, 1).geo(new THREE.TorusGeometry(0.085, 0.015, 6, 16), cyber ? metal : 0xa02020, 0, 0.02, 0.02, Math.PI / 2 - 0.5), furMat));
    this.head.position.set(0, 0.16, 0.1);
    this.neck.add(this.head);
    const hb = new Builder()
      .geo(ell(0.085), back, 0, 0.02, 0, 0, 0, 0, 'solid', 0.95, 0.9, 1.05) // skull
      .geo(new THREE.CylinderGeometry(0.035, 0.055, 0.16, 12), tan, 0, -0.01, 0.12, Math.PI / 2) // muzzle
      .geo(ell(0.022), 0x0a0a0a, 0, 0.0, 0.2) // nose
      .geo(new THREE.ConeGeometry(0.035, 0.12, 6), back, -0.05, 0.1, -0.02, -0.2, 0, -0.25) // ears
      .geo(new THREE.ConeGeometry(0.035, 0.12, 6), back, 0.05, 0.1, -0.02, -0.2, 0, 0.25);
    if (cyber) hb.rbox(0.13, 0.05, 0.11, 0.02, 0, 0.07, 0.02, metal).rbox(0.02, 0.04, 0.06, 0.008, -0.07, 0.02, 0.0, metal);
    this.head.add(part(hb, furMat));
    const eb = new Builder();
    if (cyber) eb.box(0.13, 0.018, 0.02, 0, 0.035, 0.07, 0xff1a1a, 'emit');
    else eb.geo(ell(0.013), 0xd89020, -0.035, 0.035, 0.065, 0, 0, 0, 'emit').geo(ell(0.013), 0xd89020, 0.035, 0.035, 0.065, 0, 0, 0, 'emit');
    this.eye = part(eb, furMat);
    this.head.add(this.eye);
    this.jaw.position.set(0, -0.04, 0.05);
    this.head.add(this.jaw);
    this.jaw.add(part(new Builder().rbox(0.07, 0.025, 0.14, 0.012, 0, 0, 0.07, tan).rbox(0.06, 0.01, 0.1, 0.004, 0, 0.012, 0.08, 0xe8e0d0), furMat));
    // legs: hip -> knee -> paw
    const legDefs: [number, number, boolean][] = [[-0.08, 0.2, true], [0.08, 0.2, true], [-0.09, -0.26, false], [0.09, -0.26, false]];
    legDefs.forEach(([x, z, front], i) => {
      const hip = new THREE.Group(), knee = new THREE.Group(), paw = new THREE.Group();
      hip.position.set(x, -0.05, z);
      this.body.add(hip);
      const metalLeg = cyber && i === 1;
      const up = front ? 0.24 : 0.22, low = front ? 0.24 : 0.26;
      hip.add(part(new Builder().limb(front ? 0.042 : 0.055, up, 0, 0.02, 0, metalLeg ? metal : back), metalLeg ? metalMat : furMat));
      knee.position.y = -up;
      hip.add(knee);
      knee.add(part(new Builder().limb(0.03, low, 0, 0, 0, metalLeg ? metal : tan), metalLeg ? metalMat : furMat));
      paw.position.y = -low;
      knee.add(paw);
      paw.add(part(new Builder().rbox(0.06, 0.035, 0.08, 0.015, 0, -0.01, 0.02, metalLeg ? dark : 0x2a2018), furMat));
      this.legs.push({ hip, knee, paw, front, side: x < 0 ? -1 : 1 });
    });
    // tail: chained segments
    let parent: THREE.Object3D = this.haunch;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.06 : 0, i === 0 ? -0.14 : -0.07);
      const g = new THREE.CapsuleGeometry(0.022 - i * 0.003, 0.05, 2, 6); g.rotateX(Math.PI / 2); g.translate(0, 0, -0.035);
      seg.add(part(new Builder().geo(g, cyber && i > 1 ? metal : back, 0, 0, 0), cyber && i > 1 ? metalMat : furMat));
      parent.add(seg);
      this.tail.push(seg);
      parent = seg;
    }
    this.root.scale.setScalar(cyber ? 1.15 : 1.05);
  }

  /** Halloween: the same joints dressed as a bare skeleton (cyber: bolted plates, one glowing eye). */
  private buildSkeleton() {
    const cyber = this.cyber, bone = 0xe2d8c0, bone2 = 0xc8bca2, hole = 0x120c0a, metal = 0x7d858c, dark = 0x1a1a1c;
    const nub = (r: number) => new THREE.SphereGeometry(r, 7, 5);
    this.root.add(this.body);
    this.body.position.y = 0.58;
    // spine along the back, ribcage hoops hanging off it, a sternum bar underneath
    const tb = new Builder();
    for (let i = 0; i < 9; i++) tb.geo(nub(0.026), bone, 0, 0.12 - Math.abs(i - 5) * 0.004, 0.3 - i * 0.065, 0, 0, 0, 'solid', 1, 1.3, 1);
    for (let i = 0; i < 6; i++) {
      const r = 0.13 - Math.abs(i - 1.5) * 0.012, gap = 0.5;
      const rib = new THREE.TorusGeometry(r, 0.011, 4, 12, Math.PI * 2 - gap);
      tb.geo(rib, i % 2 ? bone2 : bone, 0, 0.12 - r, 0.28 - i * 0.055, 0, 0, Math.PI / 2 + gap / 2); // gap at the top, where the spine runs
    }
    tb.rbox(0.03, 0.02, 0.26, 0.01, 0, -0.17, 0.16, bone2, 0.12); // sternum
    if (cyber) {
      tb.rbox(0.2, 0.035, 0.3, 0.015, 0, 0.16, 0.08, metal).rbox(0.14, 0.03, 0.12, 0.012, 0, 0.16, -0.22, metal); // bolted dorsal plates
      tb.geo(new THREE.CylinderGeometry(0.01, 0.01, 0.44, 6), dark, 0.04, 0.08, 0.0, Math.PI / 2); // cable through the ribs
      tb.rbox(0.05, 0.05, 0.05, 0.01, 0, 0.0, 0.12, 0xff2020, 0, 0, 0, 'emit'); // core glowing inside the cage
    }
    this.body.add(part(tb, furMat));
    // pelvis
    this.haunch.position.set(0, 0.02, -0.22);
    this.body.add(this.haunch);
    this.haunch.add(part(new Builder().rbox(0.15, 0.035, 0.12, 0.015, 0, 0.0, -0.04, bone, 0.4).geo(nub(0.035), bone2, -0.09, -0.06, -0.02).geo(nub(0.035), bone2, 0.09, -0.06, -0.02), furMat));
    // neck vertebrae & skull
    this.neck.position.set(0, 0.1, 0.34);
    this.body.add(this.neck);
    const nb = new Builder();
    for (let i = 0; i < 3; i++) nb.geo(nub(0.026), bone, 0, 0.02 + i * 0.05, i * 0.03);
    nb.geo(new THREE.TorusGeometry(0.06, 0.012, 6, 14), cyber ? metal : 0xa02020, 0, 0.04, 0.02, Math.PI / 2 - 0.5); // the collar stayed on
    this.neck.add(part(nb, furMat));
    this.head.position.set(0, 0.16, 0.1);
    this.neck.add(this.head);
    const hb = new Builder()
      .geo(ell(0.075), bone, 0, 0.03, -0.01, 0, 0, 0, 'solid', 0.95, 0.85, 1.1) // cranium
      .geo(new THREE.CylinderGeometry(0.03, 0.05, 0.16, 8), bone, 0, 0.0, 0.12, Math.PI / 2) // snout
      .geo(nub(0.016), hole, 0, 0.012, 0.2) // nasal hole
      .geo(nub(0.021), hole, -0.033, 0.04, 0.056).geo(nub(0.021), hole, 0.033, 0.04, 0.056) // eye sockets
      .rbox(0.1, 0.012, 0.012, 0.004, 0, -0.03, 0.14, 0xf0ead8); // upper teeth
    if (cyber) hb.rbox(0.12, 0.04, 0.1, 0.015, -0.02, 0.08, 0.0, metal).geo(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10), dark, 0.035, 0.04, 0.06, Math.PI / 2);
    this.head.add(part(hb, furMat));
    const eb = new Builder();
    if (cyber) eb.geo(ell(0.016), 0xff1a1a, 0.035, 0.04, 0.066, 0, 0, 0, 'emit'); // one red lens in a socket
    else eb.geo(ell(0.009), 0x80ff60, -0.033, 0.04, 0.07, 0, 0, 0, 'emit').geo(ell(0.009), 0x80ff60, 0.033, 0.04, 0.07, 0, 0, 0, 'emit'); // ghost-green pinpoints
    this.eye = part(eb, furMat);
    this.head.add(this.eye);
    this.jaw.position.set(0, -0.04, 0.05);
    this.head.add(this.jaw);
    this.jaw.add(part(new Builder().rbox(0.06, 0.02, 0.15, 0.01, 0, 0, 0.07, bone2).rbox(0.05, 0.012, 0.1, 0.004, 0, 0.014, 0.085, 0xf0ead8), furMat));
    // bony legs with knobbly joints
    const legDefs: [number, number, boolean][] = [[-0.08, 0.2, true], [0.08, 0.2, true], [-0.09, -0.26, false], [0.09, -0.26, false]];
    legDefs.forEach(([x, z, front], i) => {
      const hip = new THREE.Group(), knee = new THREE.Group(), paw = new THREE.Group();
      hip.position.set(x, -0.05, z);
      this.body.add(hip);
      const metalLeg = cyber && i === 1;
      const up = front ? 0.24 : 0.22, low = front ? 0.24 : 0.26, c = metalLeg ? metal : bone;
      hip.add(part(new Builder().geo(nub(0.03), c, 0, 0, 0).limb(0.018, up, 0, 0, 0, c), metalLeg ? metalMat : furMat));
      knee.position.y = -up;
      hip.add(knee);
      knee.add(part(new Builder().geo(nub(0.024), c, 0, 0, 0).limb(0.014, low, 0, 0, 0, c), metalLeg ? metalMat : furMat));
      paw.position.y = -low;
      knee.add(paw);
      const pb = new Builder();
      for (const tx of [-0.018, 0, 0.018]) pb.rbox(0.012, 0.012, 0.07, 0.005, tx, -0.01, 0.03, metalLeg ? dark : bone2); // toe bones
      paw.add(part(pb, furMat));
      this.legs.push({ hip, knee, paw, front, side: x < 0 ? -1 : 1 });
    });
    // tail vertebrae
    let parent: THREE.Object3D = this.haunch;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.04 : 0, i === 0 ? -0.12 : -0.07);
      seg.add(part(new Builder().geo(nub(0.02 - i * 0.003), bone, 0, 0, -0.02).geo(nub(0.016 - i * 0.003), bone2, 0, 0, -0.05), furMat));
      parent.add(seg);
      this.tail.push(seg);
      parent = seg;
    }
    this.root.scale.setScalar(cyber ? 1.15 : 1.05);
  }

  /**
   * Christmas: a snowman on the same groups (base and belly on the body, head on the neck, front hips = stick arms,
   * tail = scarf ends; the hind legs stay empty). Cyber: top hat, red LED eye, blinking LED buttons, one metal arm.
   */
  private buildSnowman() {
    const cyber = this.cyber, snow = 0xf2f5fa, snow2 = 0xdfe6ef, coal = 0x16161a, stick = 0x5a3c22, metal = 0x7d858c;
    const scarf = cyber ? 0x1e7a34 : 0xc41e24, scarf2 = cyber ? 0xc41e24 : 0xf2efe6;
    this.snowman = true;
    this.root.add(this.body);
    this.body.position.y = 0.58;
    // base ball resting on the ground (body origin is 0.58 up), belly ball, coal buttons
    const tb = new Builder()
      .geo(ell(0.25), snow, 0, -0.33, 0, 0, 0, 0, 'solid', 1, 0.92, 1)
      .geo(ell(0.18), snow2, 0, 0.0, 0.0, 0, 0, 0, 'solid', 1, 0.95, 1);
    const bb = new Builder();
    for (let i = 0; i < 3; i++) {
      const y = 0.07 - i * 0.075, z = Math.sqrt(0.18 * 0.18 - y * y) - 0.004;
      if (cyber) bb.geo(ell(0.02), [0xff2020, 0x30ff60, 0x40a0ff][i], 0, y, z, 0, 0, 0, 'emit'); else tb.geo(ell(0.02), coal, 0, y, z);
    }
    this.body.add(part(tb, furMat));
    if (cyber) this.body.add(part(bb, furMat));
    this.body.add(this.haunch); // unused by the snowman, kept so update() can drive it
    // neck = the scarf; head sits on it
    this.neck.position.set(0, 0.16, 0);
    this.body.add(this.neck);
    this.neck.add(part(new Builder().geo(new THREE.TorusGeometry(0.11, 0.035, 6, 16), scarf, 0, 0.0, 0, Math.PI / 2).rbox(0.06, 0.02, 0.03, 0.008, 0.04, 0.0, 0.135, scarf2), furMat));
    this.head.position.set(0, 0.12, 0);
    this.neck.add(this.head);
    const hb = new Builder()
      .geo(ell(0.13), snow, 0, 0, 0)
      .geo(new THREE.ConeGeometry(0.025, 0.15, 8), 0xf07a1c, 0, 0.0, 0.2, Math.PI / 2); // carrot nose
    if (cyber) {
      // top hat with a red band, metal plate over one eye
      hb.geo(new THREE.CylinderGeometry(0.15, 0.15, 0.015, 16), coal, 0, 0.1, 0).geo(new THREE.CylinderGeometry(0.09, 0.095, 0.17, 16), coal, 0, 0.19, 0, -0.12)
        .geo(new THREE.CylinderGeometry(0.097, 0.097, 0.035, 16), 0xc41e24, 0, 0.125, 0.005, -0.12)
        .rbox(0.07, 0.06, 0.03, 0.012, -0.045, 0.035, 0.11, metal);
    } else {
      // knitted bobble hat in the scarf colours
      hb.geo(new THREE.SphereGeometry(0.125, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), scarf, 0, 0.04, 0).geo(new THREE.CylinderGeometry(0.128, 0.128, 0.04, 16), scarf2, 0, 0.045, 0)
        .geo(ell(0.04), scarf2, 0, 0.17, 0);
    }
    this.head.add(part(hb, furMat));
    const eb = new Builder();
    if (cyber) eb.geo(ell(0.02), 0xff1a1a, -0.045, 0.035, 0.13, 0, 0, 0, 'emit').geo(ell(0.016), coal, 0.045, 0.035, 0.115);
    else eb.geo(ell(0.017), coal, -0.045, 0.035, 0.115).geo(ell(0.017), coal, 0.045, 0.035, 0.115);
    this.eye = part(eb, furMat);
    this.head.add(this.eye);
    // coal smile on the jaw (drops open on a headbutt)
    this.jaw.position.set(0, -0.04, 0.06);
    this.head.add(this.jaw);
    const jb = new Builder();
    for (let i = 0; i < 5; i++) { const a = (i - 2) * 0.35; jb.geo(ell(0.011), coal, Math.sin(a) * 0.065, -0.012 + Math.abs(i - 2) * 0.008, Math.cos(a) * 0.045); }
    this.jaw.add(part(jb, furMat));
    // stick arms on the front "hips" (twig fingers at the end); the hind legs are empty joints
    const legDefs: [number, number, boolean][] = [[-0.16, 0.0, true], [0.16, 0.0, true], [-0.09, -0.26, false], [0.09, -0.26, false]];
    legDefs.forEach(([x, z, front], i) => {
      const hip = new THREE.Group(), knee = new THREE.Group(), paw = new THREE.Group();
      hip.position.set(x, front ? 0.04 : -0.05, z);
      this.body.add(hip);
      hip.add(knee); knee.add(paw);
      if (front) {
        const sx = Math.sign(x), metalArm = cyber && i === 1, c = metalArm ? metal : stick;
        const ab = new Builder().geo(new THREE.CylinderGeometry(0.009, 0.014, 0.36, 5), c, sx * 0.16, 0.08, 0, 0, 0, -sx * 1.1);
        for (const [dy, dz] of [[0.06, 0.03], [0.02, -0.04]]) ab.geo(new THREE.CylinderGeometry(0.005, 0.007, 0.08, 4), c, sx * 0.33, 0.17 + dy, dz, dz * 6, 0, -sx * 0.5);
        hip.add(part(ab, metalArm ? metalMat : furMat));
      }
      this.legs.push({ hip, knee, paw, front, side: x < 0 ? -1 : 1 });
    });
    // tail = the two scarf ends hanging down the back
    for (let i = 0; i < 2; i++) {
      const seg = new THREE.Group();
      seg.position.set(i ? 0.035 : -0.03, 0.15, -0.12);
      seg.add(part(new Builder().rbox(0.05, 0.16, 0.018, 0.008, 0, -0.08, 0, scarf).box(0.05, 0.015, 0.02, 0, -0.06, 0, scarf2).box(0.05, 0.015, 0.02, 0, -0.12, 0, scarf2), furMat));
      this.body.add(seg);
      this.tail.push(seg);
    }
    this.root.scale.setScalar(cyber ? 1.15 : 1.05);
  }

  /**
   * Easter: a big chocolate bunny sitting up on the snowman's joints (haunches and belly on the body, head on the neck,
   * front hips = paws, tail = the ears so they flop back on each hop; hind legs empty). A pastel ribbon bow at the neck,
   * icing eyes, buck teeth on the jaw (a nibbling headbutt). Cyber: wrapped in gold foil, one ear bitten off, a red eye.
   */
  private buildBunny() {
    const cyber = this.cyber, choc = cyber ? 0xd8a838 : 0x6a3e20, choc2 = cyber ? 0xb88a28 : 0x54301a, cream = 0xf2e6cc, metal = 0x7d858c;
    const ribbon = cyber ? 0xc41e4a : 0xf4b6c8, mat = cyber ? metalMat : chocMat;
    this.snowman = true;
    this.root.add(this.body);
    this.body.position.y = 0.58;
    // haunches on the ground, a round belly (white-chocolate tummy), big flat hind feet poking out in front
    const tb = new Builder()
      .geo(ell(0.24), choc, 0, -0.33, -0.03, 0, 0, 0, 'solid', 1, 0.95, 1.05)
      .geo(ell(0.18), choc, 0, -0.02, 0.0, 0, 0, 0, 'solid', 0.95, 1.05, 0.95)
      .geo(ell(0.12), cyber ? 0xf0f0f4 : cream, 0, -0.06, 0.08, 0, 0, 0, 'solid', 1, 1.3, 0.7);
    for (const sx of [-1, 1]) tb.geo(ell(0.07), choc2, sx * 0.12, -0.53, 0.15, 0, 0, 0, 'solid', 0.8, 0.45, 1.6);
    tb.geo(ell(0.06), cyber ? 0xf0f0f4 : cream, 0, -0.3, -0.27); // cotton tail
    if (cyber) for (const y of [-0.42, -0.2]) tb.geo(new THREE.TorusGeometry(0.2, 0.012, 4, 20), 0xc41e4a, 0, y, -0.02, Math.PI / 2); // foil stripes
    this.body.add(part(tb, mat));
    if (cyber) this.body.add(part(new Builder().rbox(0.05, 0.05, 0.015, 0.01, 0.07, 0.04, 0.165, 0xff2020, 0, 0, 0, 'emit'), furMat)); // core through a foil tear
    this.body.add(this.haunch); // unused, kept so update() can drive it
    // neck = the ribbon with a bow in front
    this.neck.position.set(0, 0.16, 0);
    this.body.add(this.neck);
    this.neck.add(part(new Builder().geo(new THREE.TorusGeometry(0.1, 0.022, 6, 16), ribbon, 0, 0, 0, Math.PI / 2)
      .geo(ell(0.04), ribbon, -0.045, 0.0, 0.11, 0, 0, 0.5, 'solid', 1.3, 0.8, 0.5).geo(ell(0.04), ribbon, 0.045, 0.0, 0.11, 0, 0, -0.5, 'solid', 1.3, 0.8, 0.5)
      .geo(ell(0.02), ribbon, 0, 0, 0.12), furMat));
    this.head.position.set(0, 0.12, 0.01);
    this.neck.add(this.head);
    const hb = new Builder()
      .geo(ell(0.13), choc, 0, 0, 0, 0, 0, 0, 'solid', 1, 0.95, 1)
      .geo(ell(0.045), cyber ? 0xf0f0f4 : cream, -0.035, -0.04, 0.1).geo(ell(0.045), cyber ? 0xf0f0f4 : cream, 0.035, -0.04, 0.1); // cheek puffs
    this.head.add(part(hb, mat));
    this.head.add(part(new Builder().geo(ell(0.022), 0xf08aa0, 0, -0.01, 0.13, 0, 0, 0, 'solid', 1.2, 0.8, 0.8), furMat)); // pink nose
    // ears: tall with pink icing inside; the cyber bunny's left one is a bitten-off stub
    for (const sx of [-1, 1]) {
      const e = new THREE.Group();
      e.position.set(sx * 0.06, 0.09, -0.02);
      const splay = new THREE.Group(); // update() swings the ear group itself; the outward splay rides inside it
      splay.rotation.z = -sx * 0.18;
      e.add(splay);
      const stub = cyber && sx < 0, L = stub ? 0.06 : 0.17;
      const eb = new Builder().geo(ell(0.05), choc, 0, L, 0, 0, 0, 0, 'solid', 0.8, L / 0.05, 0.45);
      if (!stub) eb.geo(ell(0.032), cyber ? 0xc41e4a : 0xf4a6b8, 0, L, 0.017, 0, 0, 0, 'solid', 0.8, L / 0.04, 0.3);
      else eb.geo(ell(0.04), 0x5a3218, 0, L * 1.9, 0, 0, 0, 0, 'solid', 1, 0.3, 0.9); // the bite shows the chocolate under the foil
      splay.add(part(eb, mat));
      this.head.add(e);
      this.tail.push(e);
    }
    const eb = new Builder();
    if (cyber) eb.geo(ell(0.024), 0xff1a1a, -0.045, 0.03, 0.105, 0, 0, 0, 'emit').rbox(0.07, 0.06, 0.03, 0.012, -0.045, 0.03, 0.095, metal);
    else eb.geo(ell(0.026), 0xfaf6ee, -0.045, 0.03, 0.105).geo(ell(0.012), 0x1a0e08, -0.045, 0.034, 0.128);
    eb.geo(ell(0.026), 0xfaf6ee, 0.045, 0.03, 0.105).geo(ell(0.012), 0x1a0e08, 0.045, 0.034, 0.128); // white icing eyes, dark pupils
    this.eye = part(eb, furMat);
    this.head.add(this.eye);
    // jaw: chin with two buck teeth (drops open on the nibble)
    this.jaw.position.set(0, -0.06, 0.08);
    this.head.add(this.jaw);
    this.jaw.add(part(new Builder().geo(ell(0.04), cyber ? 0xf0f0f4 : cream, 0, -0.012, 0.02, 0, 0, 0, 'solid', 1.1, 0.7, 0.9).rbox(0.022, 0.03, 0.01, 0.004, -0.012, 0.01, 0.055, 0xfaf8f2).rbox(0.022, 0.03, 0.01, 0.004, 0.012, 0.01, 0.055, 0xfaf8f2), furMat));
    // front paws on the front "hips"; the hind legs are empty joints
    const legDefs: [number, number, boolean][] = [[-0.11, 0.12, true], [0.11, 0.12, true], [-0.09, -0.26, false], [0.09, -0.26, false]];
    legDefs.forEach(([x, z, front], i) => {
      const hip = new THREE.Group(), knee = new THREE.Group(), paw = new THREE.Group();
      hip.position.set(x, front ? 0.06 : -0.05, z);
      this.body.add(hip);
      hip.add(knee); knee.add(paw);
      if (front) {
        const metalArm = cyber && i === 1;
        hip.add(part(new Builder().limb(0.04, 0.16, 0, 0, 0.02, metalArm ? metal : choc, -0.6).geo(ell(0.045), metalArm ? metal : choc2, 0, -0.13, 0.11), metalArm ? metalMat : mat));
      }
      this.legs.push({ hip, knee, paw, front, side: x < 0 ? -1 : 1 });
    });
    this.root.scale.setScalar(cyber ? 1.15 : 1.05);
  }

  onBite() { this.biteT = 0.28; }

  update(r: BeastInput) {
    const dt = Math.max(1e-4, r.dt), k = (v: number) => 1 - Math.exp(-dt * v);
    if (Number.isNaN(this.lastX)) { this.lastX = r.x; this.lastY = r.y; }
    const sp = r.vel ? Math.hypot(r.vel.vx, r.vel.vy) : Math.hypot(r.x - this.lastX, r.y - this.lastY) / dt;
    this.lastX = r.x; this.lastY = r.y;
    if (sp < 20) this.speed += (sp - this.speed) * k(8);
    this.root.position.set(r.x, r.ground, r.y);
    this.root.rotation.y = -r.facing + Math.PI / 2;
    const dead = r.state === 'dead', sleep = r.state === 'sleep';
    this.deadK += ((dead ? 1 : 0) - this.deadK) * k(6);
    this.sleepK += ((sleep ? 1 : 0) - this.sleepK) * k(3);
    this.biteT = Math.max(0, this.biteT - dt);
    const s = this.speed, gallop = Math.min(1, Math.max(0, (s - 3.2) / 1.5)), move = Math.min(1, s / 0.6);
    const stride = 0.9 + gallop * 0.8;
    this.phase += (s * dt * Math.PI * 2) / stride;
    const ph = this.phase;
    if (this.snowman) { this.updateSnowman(r, ph, move); return; }
    // gait: walk/trot pairs diagonals; gallop pairs front/back with a lead offset
    const offs = [0, Math.PI, Math.PI, 0].map((o, i) => o * (1 - gallop) + [0, 0.35, Math.PI, Math.PI + 0.35][i] * gallop);
    const A = (0.45 + 0.35 * gallop) * move;
    this.legs.forEach((l, i) => {
      const p = ph + offs[i];
      const sw = Math.sin(p) * A;
      const lift = Math.max(0, Math.sin(p + 1.4)) * (0.6 + gallop * 0.4) * move;
      if (l.front) { l.hip.rotation.x = -sw; l.knee.rotation.x = -lift * 0.9; l.paw.rotation.x = lift * 0.6; }
      else { l.hip.rotation.x = -sw + 0.25; l.knee.rotation.x = -0.45 + lift * 0.8; l.paw.rotation.x = 0.2 - lift * 0.3; }
    });
    // body: bob, gallop spine flex, alert crouch
    const bob = Math.abs(Math.sin(ph)) * (0.02 + gallop * 0.04) * move;
    this.body.position.y = 0.58 + bob - (r.alert && s < 0.5 ? 0.05 : 0);
    this.body.rotation.x = Math.sin(ph * 2) * 0.06 * gallop + (r.alert && s < 0.5 ? 0.08 : 0);
    this.haunch.rotation.x = -Math.sin(ph) * 0.12 * gallop;
    // head: carried low and forward when hunting, sniffing/looking when idle, bite lunge
    const bite = this.biteT > 0 ? Math.sin((1 - this.biteT / 0.28) * Math.PI) : 0;
    this.neck.rotation.x = (r.alert ? 0.35 : 0.05) + bite * 0.35 - Math.sin(ph * 2) * 0.05 * move;
    this.head.rotation.y = r.alert || move > 0.5 ? 0 : Math.sin(r.t * 0.7) * 0.5;
    this.head.rotation.x = r.alert ? -0.2 : Math.sin(r.t * 1.3) * 0.05;
    this.jaw.rotation.x = bite * 0.7 + (r.alert && s < 1 ? 0.12 + Math.sin(r.t * 9) * 0.04 : 0.02); // snarl / bite
    this.body.position.z = bite * 0.18;
    // tail: wags when relaxed, stiff and high when alert, streams out at speed
    this.tail.forEach((sg, i) => {
      sg.rotation.y = r.alert ? Math.sin(r.t * 3 - i) * 0.05 : Math.sin(r.t * 7 - i * 0.8) * 0.35 * (1 - move);
      sg.rotation.x = i === 0 ? (r.alert ? -0.5 : 0.35 - move * 0.6) : 0.12 - move * 0.1;
    });
    // sleep: lie down with head on paws
    if (this.sleepK > 0.01) {
      const q = this.sleepK;
      this.body.position.y -= 0.36 * q;
      this.legs.forEach((l) => { l.hip.rotation.x = THREE.MathUtils.lerp(l.hip.rotation.x, l.front ? -1.4 : 1.2, q); l.knee.rotation.x = THREE.MathUtils.lerp(l.knee.rotation.x, l.front ? 0.2 : -2.2, q); });
      this.neck.rotation.x = THREE.MathUtils.lerp(this.neck.rotation.x, 0.9, q);
    }
    // death: fall onto the side, legs stiff
    if (this.deadK > 0.01) {
      const q = this.deadK;
      this.root.rotation.z = (Math.PI / 2) * q * 0.95;
      this.body.position.y = THREE.MathUtils.lerp(this.body.position.y, 0.2, q);
      this.legs.forEach((l) => { l.hip.rotation.x *= 1 - q; l.knee.rotation.x *= 1 - q; });
      this.eye.visible = q < 0.5;
    } else { this.root.rotation.z = 0; this.eye.visible = true; }
  }

  /** snowman: hops along with a waddle, stick arms swinging; the bite is a lunging headbutt; topples over when dead */
  private updateSnowman(r: BeastInput, ph: number, move: number) {
    const bite = this.biteT > 0 ? Math.sin((1 - this.biteT / 0.28) * Math.PI) : 0;
    const hop = Math.abs(Math.sin(ph)) * 0.09 * move, rest = r.alert && move < 0.5 ? 1 : 0;
    const q = this.sleepK, D = this.deadK;
    // sleep: slumps (squashed a little, head drooping)
    this.body.scale.set(1, 1 - 0.12 * q, 1);
    this.body.position.set(0, 0.58 + hop - 0.06 * q, bite * 0.22);
    this.body.rotation.set(bite * 0.35 + rest * 0.06, 0, Math.sin(ph) * 0.1 * move);
    this.neck.rotation.x = bite * 0.5 + rest * 0.12 + 0.4 * q;
    this.head.rotation.y = r.alert || move > 0.5 ? 0 : Math.sin(r.t * 0.7) * 0.5 * (1 - q);
    this.head.rotation.x = 0;
    this.jaw.rotation.x = bite * 0.5;
    // arms: swing against the hop, raised when alert, thrown forward on the headbutt
    this.legs.forEach((l) => { if (l.front) { l.hip.rotation.x = l.side * Math.sin(ph) * 0.5 * move - rest * 0.5 - bite * 0.9; l.hip.rotation.z = l.side * (0.25 * rest + 0.2 * D); } });
    this.tail.forEach((sg, i) => { sg.rotation.x = -0.15 - move * 0.5; sg.rotation.z = Math.sin(r.t * 6 - i * 1.2) * 0.12 * (0.3 + move); });
    // death: topples onto its side (lifted so the balls don't sink into the floor)
    this.root.rotation.z = (Math.PI / 2) * D * 0.9;
    this.root.position.y = r.ground + 0.24 * D;
    this.eye.visible = D < 0.5;
  }
}

// ------------------------------------------------------------------ drone
export class DroneRig {
  root = new THREE.Group();
  private frame = new THREE.Group();
  private rotors: THREE.Group[] = [];
  private blur: THREE.Mesh[] = [];
  private turret = new THREE.Group();
  private barrel = new THREE.Group();
  private eye!: THREE.Object3D;
  private lastX = NaN; private lastY = NaN;
  private vx = 0; private vy = 0; private deadK = 0; private fall = 0; private kick = 0; private spin = 0;
  private wings: { arm: THREE.Group; tip: THREE.Group; side: number }[] = [];
  private flap = 0; private biteT = 0;

  /** bat: Halloween giant bat instead of the quadcopter (entities pass `weapon === 'bite'` so co-op clients agree) */
  constructor(readonly bat = currentHoliday() === 'halloween') {
    if (bat) { this.eye = this.buildBat(); return; }
    const shell = 0x2e3237, dark = 0x16181b, metal = 0x6d747a;
    this.root.add(this.frame);
    const fb = new Builder()
      .rbox(0.34, 0.1, 0.46, 0.05, 0, 0, 0, shell) // fuselage
      .rbox(0.26, 0.06, 0.32, 0.04, 0, 0.07, -0.02, 0x3a3f45) // top shell
      .rbox(0.2, 0.05, 0.12, 0.02, 0, 0.05, -0.2, dark) // battery pack
      .rbox(0.1, 0.02, 0.04, 0.008, 0, 0.1, 0.1, dark); // antenna base
    fb.geo(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 4), dark, 0.05, 0.16, -0.12, 0.3);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2, cx = Math.cos(a) * 0.36, cz = Math.sin(a) * 0.36;
      fb.rbox(0.36, 0.03, 0.05, 0.012, cx / 2, 0.01, cz / 2, metal, 0, -a); // arm
      fb.geo(new THREE.CylinderGeometry(0.045, 0.05, 0.07, 14), dark, cx, 0.04, cz); // motor pod
      fb.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), dark, cx, -0.07, cz); // landing leg
    }
    for (const s of [-1, 1]) fb.rbox(0.03, 0.02, 0.5, 0.01, s * 0.2, -0.15, 0, dark); // skids
    fb.box(0.2, 0.015, 0.01, 0, 0.0, 0.232, 0xe0f0ff, 'emit').box(0.2, 0.015, 0.01, 0, 0.0, -0.232, 0xff2020, 'emit'); // nav strips
    this.frame.add(part(fb, metalMat));
    // camera eye gimbal
    const eg = new Builder().geo(ell(0.06), dark, 0, -0.06, 0.17).geo(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 14), 0xff1a1a, 0, -0.06, 0.225, Math.PI / 2, 0, 0, 'emit');
    this.eye = part(eg, metalMat);
    this.frame.add(this.eye);
    // rotors (two-blade props + translucent blur discs)
    const blurMat = new THREE.MeshBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const r = new THREE.Group();
      r.position.set(Math.cos(a) * 0.36, 0.085, Math.sin(a) * 0.36);
      r.add(part(new Builder().rbox(0.3, 0.006, 0.035, 0.004, 0, 0, 0, 0x1b1d20).geo(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 8), metal, 0, 0.005, 0), metalMat));
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), blurMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.002;
      r.add(disc);
      this.frame.add(r);
      this.rotors.push(r);
      this.blur.push(disc);
    }
    // underslung gun turret
    this.turret.position.set(0, -0.1, 0.05);
    this.frame.add(this.turret);
    this.turret.add(part(new Builder().geo(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), dark, 0, 0, 0), metalMat));
    this.barrel.position.set(0, -0.035, 0);
    this.turret.add(this.barrel);
    this.barrel.add(part(new Builder().rbox(0.06, 0.05, 0.14, 0.012, 0, 0, 0.04, shell).geo(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8), dark, 0, 0, 0.19, Math.PI / 2), metalMat));
    if (currentHoliday() === 'xmas') {
      // reindeer drone: branching antlers on the top shell and a glowing red nose
      const ab = new Builder(), brown = 0x6a4a2c;
      const tine = (x: number, y: number, z: number, rx: number, rz: number, len: number) => ab.geo(new THREE.CylinderGeometry(0.009, 0.014, len, 5), brown, x, y, z, rx, 0, rz);
      for (const sx of [-1, 1]) {
        tine(sx * 0.1, 0.2, 0.02, -0.2, -sx * 0.45, 0.2);
        tine(sx * 0.15, 0.32, -0.01, -0.5, -sx * 0.2, 0.12);
        tine(sx * 0.12, 0.27, 0.05, 0.6, sx * 0.3, 0.09);
        tine(sx * 0.2, 0.3, 0.0, 0, -sx * 1.0, 0.1);
      }
      ab.geo(ell(0.04), 0xff2020, 0, 0.0, 0.26, 0, 0, 0, 'emit');
      this.frame.add(part(ab, furMat));
    }
    if (currentHoliday() === 'easter') {
      // Easter: pastel bunny ears on the top shell and a fluffy white tail on the battery pack
      const eb = new Builder();
      bunnyEars(eb, 0xc8b4ec, 0, 0.1, 0.02, 1);
      eb.geo(ell(0.05), 0xf6f4f0, 0, 0.06, -0.27);
      this.frame.add(part(eb, furMat));
    }
    this.root.scale.setScalar(1.35);
  }

  /** Halloween: a furry giant bat with leathery finger-boned wings, pointed ears, fangs and red eyes. Returns the eyes. */
  private buildBat(): THREE.Object3D {
    const fur = 0x2a1d16, fur2 = 0x3c2b20, hide = 0x3a2320, bone = 0x1a110d, fang = 0xeee6d4;
    this.root.add(this.frame);
    const bb = new Builder()
      .geo(ell(0.13), fur, 0, 0, 0, 0, 0, 0, 'solid', 0.95, 0.85, 1.35) // body
      .geo(ell(0.1), fur2, 0, 0.01, 0.12, 0, 0, 0, 'solid', 1.15, 1, 0.8) // shaggy neck ruff
      .geo(ell(0.09), fur, 0, 0.04, 0.2, 0, 0, 0, 'solid', 1, 0.95, 1) // head
      .geo(ell(0.05), fur2, 0, 0.015, 0.275, 0, 0, 0, 'solid', 1.1, 0.8, 1.1) // snout
      .geo(ell(0.018), 0x0a0605, 0, 0.03, 0.325, 0, 0, 0, 'solid', 1.4, 0.8, 1) // nose leaf
      .geo(new THREE.ConeGeometry(0.012, 0.05, 5), fang, -0.022, -0.035, 0.3, Math.PI) // fangs
      .geo(new THREE.ConeGeometry(0.012, 0.05, 5), fang, 0.022, -0.035, 0.3, Math.PI);
    for (const sx of [-1, 1]) {
      bb.geo(new THREE.ConeGeometry(0.05, 0.17, 6), fur, sx * 0.055, 0.15, 0.17, -0.15, 0, -sx * 0.35); // ears
      bb.geo(new THREE.ConeGeometry(0.03, 0.12, 5), 0x5a2e2a, sx * 0.058, 0.14, 0.185, -0.15, 0, -sx * 0.35); // pink inner ear
      bb.limb(0.016, 0.12, sx * 0.05, -0.07, -0.12, bone, 0.7); // hind legs trailing
    }
    this.frame.add(part(bb, furMat));
    const eyes = part(new Builder().geo(ell(0.02), 0xff2010, -0.04, 0.07, 0.27, 0, 0, 0, 'emit').geo(ell(0.02), 0xff2010, 0.04, 0.07, 0.27, 0, 0, 0, 'emit'), furMat);
    this.frame.add(eyes);
    // wings: arm (shoulder->wrist) and hand (wrist->fingertips); shape y runs backwards, laid flat in XZ
    const membrane = (pts: number[][], s: number) => {
      const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * s, y)));
      const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2);
      return g;
    };
    const boneTo = (b: Builder, x: number, z: number, r: number) => { const L = Math.hypot(x, z); b.geo(new THREE.CylinderGeometry(r * 0.6, r, L, 5), bone, x / 2, 0.006, z / 2, 0, Math.atan2(-z, x), -Math.PI / 2); };
    for (const s of [-1, 1]) {
      const arm = new THREE.Group(), tip = new THREE.Group();
      arm.position.set(s * 0.09, 0.05, 0.06);
      const ab = new Builder().geo(membrane([[0, -0.05], [0.36, -0.03], [0.36, 0.06], [0.27, 0.2], [0.13, 0.17], [0, 0.26]], s), hide, 0, 0, 0);
      boneTo(ab, s * 0.36, 0.0, 0.022);
      arm.add(part(ab, skinMat));
      tip.position.set(s * 0.36, 0, 0);
      const tb = new Builder().geo(membrane([[0, -0.03], [0.5, -0.06], [0.37, 0.07], [0.46, 0.19], [0.3, 0.19], [0.31, 0.33], [0.17, 0.22], [0.11, 0.32], [0, 0.1]], s), hide, 0, 0, 0);
      for (const [fx, fz] of [[0.5, 0.06], [0.46, -0.19], [0.31, -0.33], [0.11, -0.32]]) boneTo(tb, s * fx, fz, 0.012); // finger bones
      tb.geo(new THREE.ConeGeometry(0.012, 0.06, 5), fang, 0, 0.01, 0.04, Math.PI / 2); // thumb claw
      tip.add(part(tb, skinMat));
      arm.add(tip);
      this.frame.add(arm);
      this.wings.push({ arm, tip, side: s });
    }
    this.root.scale.setScalar(1.35);
    return eyes;
  }

  onBite() { this.biteT = 0.35; }

  onShot() { this.kick = 1; }

  update(r: BeastInput) {
    const dt = Math.max(1e-4, r.dt), k = (v: number) => 1 - Math.exp(-dt * v);
    if (Number.isNaN(this.lastX)) { this.lastX = r.x; this.lastY = r.y; }
    const vx = r.vel ? r.vel.vx : (r.x - this.lastX) / dt, vy = r.vel ? r.vel.vy : (r.y - this.lastY) / dt;
    this.lastX = r.x; this.lastY = r.y;
    if (Math.hypot(vx, vy) < 20) { this.vx += (vx - this.vx) * k(4); this.vy += (vy - this.vy) * k(4); }
    const dead = r.state === 'dead';
    this.deadK += ((dead ? 1 : 0) - this.deadK) * k(8);
    if (this.bat) { this.updateBat(r, dt, dead); return; }
    this.kick *= Math.exp(-dt * 16);
    this.root.position.set(r.x, 0, r.y);
    this.root.rotation.y = -r.facing + Math.PI / 2;
    // hover height with bob; crash when destroyed
    if (dead) this.fall = Math.min(1, this.fall + dt * 1.6); else this.fall = 0;
    const hover = 1.38 + Math.sin(r.t * 2.1) * 0.05 + Math.sin(r.t * 3.7) * 0.02;
    this.frame.position.y = THREE.MathUtils.lerp(hover + r.ground, 0.12 + r.ground, this.fall * this.fall);
    // bank into the direction of travel (local frame)
    const c = Math.cos(r.facing), s = Math.sin(r.facing);
    const fwd = this.vx * c + this.vy * s, side = -this.vx * s + this.vy * c;
    this.frame.rotation.x = THREE.MathUtils.clamp(fwd * 0.12, -0.35, 0.35) + (dead ? 0.6 * this.fall : 0);
    this.frame.rotation.z = THREE.MathUtils.clamp(-side * 0.12, -0.35, 0.35) + (dead ? 0.9 * this.fall : 0);
    if (dead) { this.spin += dt * 6 * (1 - this.fall); this.frame.rotation.y = this.spin; }
    // rotors: fast spin shown as a blur disc; they spin down on death
    const rpm = dead ? Math.max(0, 1 - this.fall * 1.5) : 1;
    this.rotors.forEach((ro, i) => { ro.rotation.y += (i % 2 ? -1 : 1) * dt * 55 * rpm; });
    for (const b of this.blur) (b.material as THREE.MeshBasicMaterial).opacity = 0.18 * rpm;
    // turret tracks the target independently of the body; recoil on each shot
    if (r.targetX !== undefined && r.targetY !== undefined && !dead) {
      const aim = Math.atan2(r.targetY - r.y, r.targetX - r.x) - r.facing;
      this.turret.rotation.y += (-aim - this.turret.rotation.y) * k(10);
      this.barrel.rotation.x = 0.25;
    } else this.turret.rotation.y *= 1 - k(3);
    this.barrel.position.z = -this.kick * 0.04;
    this.eye.visible = !dead;
  }

  /** bat flight: same hover height and banking as the drone; wingbeats speed up when moving or attacking, dive-nip on a bite */
  private updateBat(r: BeastInput, dt: number, dead: boolean) {
    this.root.position.set(r.x, 0, r.y);
    this.root.rotation.y = -r.facing + Math.PI / 2;
    if (dead) this.fall = Math.min(1, this.fall + dt * 2); else this.fall = 0;
    this.biteT = Math.max(0, this.biteT - dt);
    const bite = this.biteT > 0 ? Math.sin((1 - this.biteT / 0.35) * Math.PI) : 0;
    const busy = Math.max(Math.min(1, Math.hypot(this.vx, this.vy) / 1.2), r.alert ? 0.6 : 0, bite);
    // wingbeat: ~2.5 Hz glide-flap hovering, ~6 Hz flat out; the body lifts on each downstroke
    this.flap += dt * Math.PI * 2 * (2.5 + 3.5 * busy) * (1 - this.fall);
    const beat = Math.sin(this.flap), A = 0.45 + 0.45 * busy;
    const hover = 1.38 + Math.sin(r.t * 2.1) * 0.05 - Math.cos(this.flap) * 0.04 * A;
    this.frame.position.y = THREE.MathUtils.lerp(hover + r.ground, 0.1 + r.ground, this.fall * this.fall) - bite * 0.5;
    this.frame.position.z = bite * 0.4;
    const c = Math.cos(r.facing), s = Math.sin(r.facing);
    const fwd = this.vx * c + this.vy * s, side = -this.vx * s + this.vy * c;
    this.frame.rotation.x = THREE.MathUtils.clamp(fwd * 0.12, -0.35, 0.35) + bite * 0.6 - 0.25 * this.fall;
    this.frame.rotation.z = THREE.MathUtils.clamp(-side * 0.12, -0.35, 0.35) + 0.3 * this.fall;
    // wings: the hand lags the arm and sweeps back on the upstroke; swept high in the dive, spread flat when downed
    for (const w of this.wings) {
      const up = THREE.MathUtils.lerp(THREE.MathUtils.lerp(beat * A + 0.1, 1.1, bite), -0.08, this.fall);
      w.arm.rotation.z = w.side * up;
      w.tip.rotation.z = w.side * THREE.MathUtils.lerp(Math.sin(this.flap - 0.7) * A * 0.7, 0, this.fall);
      w.tip.rotation.y = w.side * Math.max(0, Math.cos(this.flap)) * 0.35 * (1 - this.fall);
    }
    this.eye.visible = !dead;
  }
}

// ------------------------------------------------------------------ warden
/** painted armour plate: less metallic than the drone shell so it reads under flat lighting */
const wardenMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
/**
 * The Warden: a 2.5 m bipedal security mech. Reverse-jointed hydraulic legs with a heavy stomping gait, armoured
 * torso with a sensor head, a rotary cannon on the right arm (barrels spin up when firing) and a missile pod on the
 * left. It collapses onto its knees when destroyed.
 */
export class WardenRig {
  root = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private legs: { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group; side: number }[] = [];
  private cannonArm = new THREE.Group();
  private podArm = new THREE.Group();
  private barrels = new THREE.Group();
  private eye!: THREE.Object3D;
  private phase = 0; private lastX = NaN; private lastY = NaN; private speed = 0;
  private spinV = 0; private kick = 0; private deadK = 0; private aimK = 0;
  private elbows: THREE.Group[] = []; private smashT = 0;

  /** ogre: Halloween club-wielding ogre instead of the mech (entities pass `weapon === 'bite'`) */
  constructor(readonly ogre = currentHoliday() === 'halloween') {
    if (ogre) { this.eye = this.buildOgre(); return; }
    const armor = 0x5a6258, armor2 = 0x3e443d, dark = 0x17191b, steel = 0x6f757b, hazard = 0xd8a820, piston = 0xb8c0c6;
    const HIP_Y = 1.36;
    this.root.add(this.hips);
    this.hips.position.y = HIP_Y;
    // pelvis
    this.hips.add(part(new Builder().rbox(0.62, 0.26, 0.46, 0.06, 0, 0, 0, armor2).geo(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 14), dark, 0, 0, 0, 0, 0, Math.PI / 2), wardenMat));
    // legs: thigh forward-down, shin back-down, three-toed foot
    for (const side of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(side * 0.42, 0, 0);
      const tb = new Builder()
        .rbox(0.22, 0.72, 0.26, 0.05, 0, -0.34, 0, armor)
        .rbox(0.24, 0.3, 0.28, 0.04, 0, -0.12, 0.02, armor2)
        .box(0.03, 0.2, 0.2, side * 0.125, -0.3, 0, hazard)
        .geo(new THREE.CylinderGeometry(0.13, 0.13, 0.26, 16), dark, 0, 0, 0, 0, 0, Math.PI / 2);
      hip.add(part(tb, wardenMat));
      const knee = new THREE.Group(); knee.position.set(0, -0.7, 0);
      const sb = new Builder()
        .geo(new THREE.CylinderGeometry(0.11, 0.11, 0.28, 16), dark, 0, 0, 0, 0, 0, Math.PI / 2)
        .rbox(0.18, 0.76, 0.2, 0.04, 0, -0.38, -0.02, armor)
        .rbox(0.2, 0.2, 0.22, 0.03, 0, -0.08, 0.04, armor2)
        .geo(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 10), piston, 0, -0.38, 0.13) // hydraulic ram
        .geo(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 10), steel, 0, -0.2, 0.13);
      knee.add(part(sb, wardenMat));
      const ankle = new THREE.Group(); ankle.position.set(0, -0.76, 0);
      const fb = new Builder().geo(new THREE.CylinderGeometry(0.08, 0.08, 0.22, 12), dark, 0, 0, 0, 0, 0, Math.PI / 2).rbox(0.3, 0.1, 0.22, 0.03, 0, -0.1, -0.05, armor2);
      for (const a of [-0.45, 0, 0.45]) fb.rbox(0.09, 0.08, 0.34, 0.025, Math.sin(a) * 0.12, -0.12, 0.14 + Math.cos(a) * 0.06, dark, 0, a);
      fb.rbox(0.08, 0.07, 0.2, 0.02, 0, -0.12, -0.2, dark); // heel spur
      ankle.add(part(fb, wardenMat));
      knee.add(ankle); hip.add(knee); this.hips.add(hip);
      this.legs.push({ hip, knee, ankle, side });
    }
    // torso
    this.torso.position.y = 0.16;
    this.hips.add(this.torso);
    const cb = new Builder()
      .rbox(1.05, 0.78, 0.78, 0.1, 0, 0.42, 0, armor)
      .rbox(0.86, 0.5, 0.12, 0.05, 0, 0.5, 0.4, armor2) // chest plate
      .rbox(0.9, 0.62, 0.36, 0.06, 0, 0.46, -0.5, armor2) // power pack
      .rbox(0.2, 0.16, 0.8, 0.03, 0, 0.84, 0, dark); // spine ridge
    for (let i = 0; i < 4; i++) cb.box(0.5, 0.025, 0.02, 0, 0.36 + i * 0.07, 0.466, 0x3a0a0a); // chest vents
    for (let i = 0; i < 4; i++) cb.box(0.5, 0.012, 0.02, 0, 0.37 + i * 0.07, 0.478, 0xff3020, 'emit');
    for (const sx of [-1, 1]) {
      cb.box(0.03, 0.4, 0.5, sx * 0.53, 0.45, 0.05, hazard);
      for (let k = 0; k < 4; k++) cb.box(0.032, 0.06, 0.5, sx * 0.535, 0.3 + k * 0.1, 0.05, dark, 'solid', 0, 0.6);
      cb.geo(new THREE.CylinderGeometry(0.07, 0.08, 0.36, 12), dark, sx * 0.28, 0.9, -0.55); // exhaust stacks
      cb.geo(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12), 0xff6a20, sx * 0.28, 1.085, -0.55, 0, 0, 0, 'emit');
      cb.rbox(0.36, 0.2, 0.5, 0.06, sx * 0.62, 0.78, 0, armor2, 0, 0, sx * -0.25); // shoulder pauldrons
    }
    cb.box(0.2, 0.12, 0.01, -0.25, 0.62, 0.465, 0xe8e6de).box(0.12, 0.04, 0.012, -0.25, 0.63, 0.47, 0xc0201c); // unit marking
    this.torso.add(part(cb, wardenMat));
    // sensor head
    this.head.position.set(0, 0.86, 0.26);
    this.torso.add(this.head);
    this.head.add(part(new Builder().rbox(0.42, 0.24, 0.36, 0.06, 0, 0.1, 0, armor2).rbox(0.36, 0.08, 0.06, 0.02, 0, 0.12, 0.18, dark).geo(new THREE.CylinderGeometry(0.008, 0.008, 0.34, 4), dark, 0.14, 0.35, -0.1), wardenMat));
    this.eye = part(new Builder().box(0.32, 0.035, 0.012, 0, 0.12, 0.214, 0xff2020, 'emit').geo(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 14), 0xff4030, 0.1, 0.12, 0.215, Math.PI / 2, 0, 0, 'emit'), wardenMat);
    this.head.add(this.eye);
    // right arm: rotary cannon
    this.cannonArm.position.set(0.78, 0.66, 0.05);
    this.torso.add(this.cannonArm);
    this.cannonArm.add(part(new Builder()
      .geo(new THREE.SphereGeometry(0.16, 14, 10), dark, 0, 0, 0)
      .rbox(0.26, 0.26, 0.7, 0.05, 0, -0.1, 0.25, armor)
      .rbox(0.28, 0.12, 0.3, 0.03, 0, 0.1, 0.1, armor2)
      .rbox(0.12, 0.2, 0.22, 0.03, -0.18, -0.02, -0.05, dark) // ammo drum
      .geo(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 16), steel, 0, -0.1, 0.62, Math.PI / 2), wardenMat));
    this.barrels.position.set(0, -0.1, 0.66);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; this.barrels.add(part(new Builder().geo(new THREE.CylinderGeometry(0.025, 0.025, 0.62, 8), dark, Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0.31, Math.PI / 2), wardenMat)); }
    this.barrels.add(part(new Builder().geo(new THREE.CylinderGeometry(0.11, 0.11, 0.04, 16), steel, 0, 0, 0.5, Math.PI / 2).geo(new THREE.CylinderGeometry(0.11, 0.11, 0.04, 16), steel, 0, 0, 0.1, Math.PI / 2), wardenMat));
    this.cannonArm.add(this.barrels);
    // left arm: missile pod
    this.podArm.position.set(-0.78, 0.7, 0.05);
    this.torso.add(this.podArm);
    const pb = new Builder().geo(new THREE.SphereGeometry(0.15, 14, 10), dark, 0, 0, 0).rbox(0.34, 0.32, 0.5, 0.05, -0.05, -0.04, 0.2, armor).box(0.36, 0.04, 0.52, -0.05, 0.14, 0.2, hazard);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) pb.geo(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 12), 0x0c0d0e, -0.14 + c * 0.09, -0.09 + r * 0.1, 0.455, Math.PI / 2);
    pb.box(0.06, 0.06, 0.02, 0.1, 0.05, 0.456, 0xfff2c0, 'emit'); // searchlight
    this.podArm.add(part(pb, wardenMat));
    if (currentHoliday() === 'xmas') {
      // Santa hat on the sensor head (fur band, cone leaning back, drooping tip, pom-pom) and tinsel across the chest
      const red = 0xc41e24, fur = 0xf4f1ea;
      const hat = new Builder().rbox(0.48, 0.08, 0.42, 0.04, 0, 0.25, -0.01, fur)
        .geo(new THREE.CylinderGeometry(0.05, 0.2, 0.36, 14), red, 0, 0.42, -0.07, -0.35)
        .geo(new THREE.CylinderGeometry(0.02, 0.05, 0.16, 10), red, 0, 0.563, -0.21, -1.9)
        .geo(ell(0.06), fur, 0, 0.537, -0.29);
      this.head.add(part(hat, furMat));
      const tb = new Builder();
      for (let i = 0; i <= 16; i++) {
        const u = i / 16, x = -0.5 + u, y = 0.78 - Math.sin(u * Math.PI) * 0.16;
        tb.geo(new THREE.SphereGeometry(0.03, 6, 4), [0xe0b040, 0x1e8a3a, 0xc41e24, 0xd8dce4][i % 4], x, y, 0.45 + Math.sin(u * Math.PI) * 0.02);
      }
      this.torso.add(part(tb, metalMat));
    }
    if (currentHoliday() === 'easter') {
      // Easter: huge pastel bunny ears on the sensor head and a big pink bow on the chest plate
      const eb = new Builder();
      bunnyEars(eb, 0xa8d4f0, 0, 0.22, -0.02, 2.4);
      this.head.add(part(eb, furMat));
      const bow = 0xf4b6c8;
      this.torso.add(part(new Builder().geo(ell(0.1), bow, -0.12, 0.74, 0.47, 0, 0, 0.5, 'solid', 1.4, 0.8, 0.4).geo(ell(0.1), bow, 0.12, 0.74, 0.47, 0, 0, -0.5, 'solid', 1.4, 0.8, 0.4)
        .geo(ell(0.05), bow, 0, 0.74, 0.5).rbox(0.06, 0.2, 0.02, 0.01, -0.06, 0.6, 0.47, bow, 0, 0, -0.3).rbox(0.06, 0.2, 0.02, 0.01, 0.06, 0.6, 0.47, bow, 0, 0, 0.3), furMat));
    }
  }

  /** Halloween: a hulking green-grey ogre, big belly, tusked underbite, loincloth and bracers, spiked club in the right fist. Returns the eyes. */
  private buildOgre(): THREE.Object3D {
    const skin = 0x6c7a58, skin2 = 0x5a6648, belly = 0x7e8a66, cloth = 0x5a3e24, leather = 0x3e2a18, iron = 0x6a6660, ivory = 0xe6dcc0, wood = 0x5a3c22;
    const HIP_Y = 1.0;
    this.root.add(this.hips);
    this.hips.position.y = HIP_Y;
    // pelvis, belt and a ragged loincloth (front and back flaps, torn strips)
    const pb = new Builder()
      .geo(ell(0.32), skin2, 0, 0, 0, 0, 0, 0, 'solid', 1.35, 0.8, 1.05)
      .geo(new THREE.CylinderGeometry(0.45, 0.44, 0.12, 16), leather, 0, 0.1, 0.02)
      .rbox(0.12, 0.1, 0.04, 0.02, 0, 0.1, 0.47, iron);
    for (const z of [1, -1]) {
      pb.rbox(0.38, 0.36, 0.04, 0.015, 0, -0.16, z * 0.38, cloth, z * 0.12);
      for (const x of [-0.12, 0, 0.12]) pb.box(0.1, 0.14 + Math.abs(x) * 0.6, 0.03, x + 0.02, -0.38, z * 0.41, cloth, 'solid', x * 2, z * 0.12);
    }
    this.hips.add(part(pb, furMat));
    // stumpy legs: thick thigh, shin, broad flat foot
    for (const side of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(side * 0.27, -0.06, 0);
      hip.add(part(new Builder().limb(0.17, 0.5, 0, 0.04, 0, skin), furMat));
      const knee = new THREE.Group(); knee.position.set(0, -0.46, 0);
      knee.add(part(new Builder().limb(0.14, 0.46, 0, 0.02, 0, skin2).geo(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 10), leather, 0, -0.32, 0), furMat));
      const ankle = new THREE.Group(); ankle.position.set(0, -0.44, 0);
      const fb = new Builder().rbox(0.26, 0.12, 0.38, 0.05, 0, -0.04, 0.08, skin2);
      for (const x of [-0.08, 0, 0.08]) fb.geo(ell(0.045), skin, x, -0.05, 0.27);
      ankle.add(part(fb, furMat));
      knee.add(ankle); hip.add(knee); this.hips.add(hip);
      this.legs.push({ hip, knee, ankle, side });
    }
    // torso: big belly, broad chest, hunched back
    this.torso.position.y = 0.1;
    this.hips.add(this.torso);
    this.torso.add(part(new Builder()
      .geo(ell(0.5), belly, 0, 0.3, 0.08, 0, 0, 0, 'solid', 1.05, 0.95, 0.92)
      .geo(ell(0.48), skin, 0, 0.74, -0.03, 0, 0, 0, 'solid', 1.28, 0.8, 0.85)
      .geo(ell(0.34), skin2, 0, 0.92, -0.2)
      .geo(ell(0.03), 0x3a4030, 0, 0.26, 0.54) // navel
      .geo(ell(0.21), skin, -0.56, 0.86, 0).geo(ell(0.21), skin, 0.56, 0.86, 0), furMat)); // shoulders
    // small head sunk forward between the shoulders: heavy brow, underbite jaw with tusks, tiny glinting eyes
    this.head.position.set(0, 1.07, 0.28);
    this.torso.add(this.head);
    const hb = new Builder()
      .geo(ell(0.17), skin, 0, 0.04, 0, 0, 0, 0, 'solid', 1, 0.95, 1.05)
      .rbox(0.28, 0.06, 0.1, 0.03, 0, 0.09, 0.13, skin2) // brow ridge
      .geo(ell(0.045), skin2, 0, 0.02, 0.18, 0, 0, 0, 'solid', 1.3, 0.9, 1) // flat nose
      .rbox(0.3, 0.12, 0.22, 0.05, 0, -0.08, 0.08, skin2) // jutting jaw
      .geo(new THREE.ConeGeometry(0.026, 0.11, 6), ivory, -0.085, 0.0, 0.18, 0, 0, 0.12) // tusks
      .geo(new THREE.ConeGeometry(0.026, 0.11, 6), ivory, 0.085, 0.0, 0.18, 0, 0, -0.12)
      .geo(new THREE.ConeGeometry(0.05, 0.13, 6), skin2, -0.18, 0.06, -0.01, 0, 0, Math.PI / 2 - 0.3) // ears
      .geo(new THREE.ConeGeometry(0.05, 0.13, 6), skin2, 0.18, 0.06, -0.01, 0, 0, -Math.PI / 2 + 0.3)
      .geo(new THREE.ConeGeometry(0.04, 0.12, 6), 0x1e1a14, 0, 0.22, -0.04, -0.3); // topknot
    this.head.add(part(hb, furMat));
    const eyes = part(new Builder().geo(ell(0.02), 0xffb030, -0.06, 0.05, 0.155, 0, 0, 0, 'emit').geo(ell(0.02), 0xffb030, 0.06, 0.05, 0.155, 0, 0, 0, 'emit'), furMat);
    this.head.add(eyes);
    // arms: upper arm -> elbow -> forearm with leather bracer -> fist; the right fist grips the club
    for (const [arm, sx] of [[this.cannonArm, 1], [this.podArm, -1]] as [THREE.Group, number][]) {
      arm.position.set(sx * 0.64, 0.84, 0.02);
      this.torso.add(arm);
      arm.add(part(new Builder().limb(0.14, 0.5, 0, 0.04, 0, skin), furMat));
      const elbow = new THREE.Group(); elbow.position.y = -0.44;
      arm.add(elbow);
      const fb = new Builder().limb(0.125, 0.46, 0, 0.02, 0, skin).geo(new THREE.CylinderGeometry(0.14, 0.15, 0.2, 10), leather, 0, -0.24, 0).geo(ell(0.12), skin2, 0, -0.46, 0.02);
      for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2; fb.geo(ell(0.022), iron, Math.cos(a) * 0.15, -0.24, Math.sin(a) * 0.15); } // bracer studs
      elbow.add(part(fb, furMat));
      this.elbows.push(elbow);
      if (sx > 0) {
        // spiked club: grip in the fist, heavy head running on along the forearm (tilted a little forward)
        const club = new THREE.Group(); club.position.set(0, -0.46, 0.02); club.rotation.x = -0.35;
        const cb = new Builder().geo(new THREE.CylinderGeometry(0.05, 0.14, 1.05, 10), wood, 0, -0.38, 0).geo(ell(0.14), wood, 0, -0.9, 0, 0, 0, 0, 'solid', 1, 0.6, 1);
        for (let k = 0; k < 9; k++) { const a = k * 2.4, y = -0.55 - (k % 3) * 0.14; cb.geo(new THREE.ConeGeometry(0.035, 0.15, 5), iron, Math.cos(a) * 0.16, y, -Math.sin(a) * 0.15, 0, a, -Math.PI / 2); }
        club.add(part(cb, furMat));
        elbow.add(club);
      }
    }
    return eyes;
  }

  onShot() { this.kick = 1; this.spinV = Math.max(this.spinV, 26); }
  /** ogre club smash (wind-up, slam, recover) */
  onBite() { this.smashT = 1; }

  update(r: BeastInput) {
    const dt = Math.max(1e-4, r.dt), k = (v: number) => 1 - Math.exp(-dt * v);
    if (Number.isNaN(this.lastX)) { this.lastX = r.x; this.lastY = r.y; }
    const sp = r.vel ? Math.hypot(r.vel.vx, r.vel.vy) : Math.hypot(r.x - this.lastX, r.y - this.lastY) / dt;
    this.lastX = r.x; this.lastY = r.y;
    if (sp < 20) this.speed += (sp - this.speed) * k(6);
    this.root.position.set(r.x, r.ground, r.y);
    this.root.rotation.y = -r.facing + Math.PI / 2;
    const dead = r.state === 'dead';
    this.deadK += ((dead ? 1 : 0) - this.deadK) * k(3);
    this.aimK += ((r.alert && !dead ? 1 : 0) - this.aimK) * k(4);
    if (this.ogre) { this.updateOgre(r, dt); return; }
    this.kick *= Math.exp(-dt * 12);
    this.spinV *= Math.exp(-dt * 1.5);
    this.barrels.rotation.z += this.spinV * dt;
    // heavy gait: long stride, footfall dip, torso sway
    const move = Math.min(1, this.speed / 0.5) * (1 - this.deadK);
    this.phase += (this.speed * dt * Math.PI * 2) / 1.9;
    const ph = this.phase;
    for (const l of this.legs) {
      const p = ph + (l.side < 0 ? 0 : Math.PI);
      const hip = -0.5 + Math.sin(p) * 0.32 * move - 0.55 * this.deadK;
      const knee = 1.05 + Math.max(0, Math.sin(p + 1.6)) * 0.55 * move + 1.0 * this.deadK;
      l.hip.rotation.x = hip;
      l.knee.rotation.x = knee;
      l.ankle.rotation.x = -(hip + knee);
    }
    const bob = (Math.abs(Math.cos(ph)) - 1) * 0.07 * move;
    this.hips.position.y = 1.36 + bob - 0.62 * this.deadK;
    this.hips.rotation.z = Math.sin(ph) * 0.035 * move;
    this.torso.rotation.x = 0.06 * move + 0.55 * this.deadK - this.kick * 0.03;
    this.torso.rotation.y = Math.sin(r.t * 0.6) * 0.08 * (1 - this.aimK) * (1 - this.deadK);
    this.head.rotation.y = Math.sin(r.t * 0.9) * 0.3 * (1 - this.aimK);
    // arms: lowered on patrol, levelled when alert; recoil kick on the cannon
    this.cannonArm.rotation.x = 0.5 * (1 - this.aimK) - 0.06 * this.aimK + this.kick * -0.12 + 0.6 * this.deadK;
    this.podArm.rotation.x = 0.45 * (1 - this.aimK) - 0.1 * this.aimK + 0.7 * this.deadK;
    this.cannonArm.position.z = 0.05 - this.kick * 0.05;
    this.eye.visible = !dead || this.deadK < 0.3;
  }

  /** ogre: stumpy stomping stride with a rolling sway, club carried low and raised when hunting, overhead smash on a hit */
  private updateOgre(r: BeastInput, dt: number) {
    const D = this.deadK, move = Math.min(1, this.speed / 0.5) * (1 - D);
    this.phase += (this.speed * dt * Math.PI * 2) / 1.5;
    const ph = this.phase;
    for (const l of this.legs) {
      const p = ph + (l.side < 0 ? 0 : Math.PI);
      const hip = -Math.sin(p) * 0.4 * move - 0.08 - 1.3 * D;
      const knee = 0.14 + Math.max(0, Math.cos(p)) * 0.75 * move + 1.6 * D;
      l.hip.rotation.x = hip;
      l.knee.rotation.x = knee;
      l.ankle.rotation.x = -(hip + knee) * (1 - D);
    }
    const breathe = Math.sin(r.t * 1.6) * 0.012;
    this.hips.position.y = 1.0 + (Math.abs(Math.cos(ph)) - 1) * 0.09 * move - 0.5 * D;
    this.hips.rotation.z = Math.sin(ph) * 0.09 * move;
    this.torso.position.y = 0.1 + breathe;
    this.torso.rotation.z = -Math.sin(ph) * 0.05 * move;
    this.torso.rotation.y = Math.sin(ph) * 0.12 * move + Math.sin(r.t * 0.5) * 0.06 * (1 - move) * (1 - D);
    // smash: wind up overhead (0-0.25), slam down (to 0.4), hold, recover by 1
    this.smashT = Math.max(0, this.smashT - dt / 0.95);
    const u = 1 - this.smashT, ss = THREE.MathUtils.smoothstep;
    const wind = this.smashT > 0 ? ss(u, 0, 0.25) * (1 - ss(u, 0.25, 0.4)) : 0;
    const slam = this.smashT > 0 ? ss(u, 0.25, 0.4) * (1 - ss(u, 0.6, 1)) : 0;
    this.torso.rotation.x = 0.12 + 0.12 * this.aimK - 0.18 * wind + 0.35 * slam + 0.8 * D;
    this.head.rotation.y = Math.sin(r.t * 0.8) * 0.35 * (1 - this.aimK) * (1 - D);
    this.head.rotation.x = -0.1 * this.aimK - 0.3 * D;
    // club arm: low carry, raised when hunting, overhead in the wind-up, forward-down in the slam
    const [clubElbow, freeElbow] = this.elbows;
    const carry = -0.25 - 0.4 * this.aimK + Math.sin(ph) * 0.15 * move;
    this.cannonArm.rotation.x = carry * (1 - wind - slam) - 3.0 * wind - 0.8 * slam + 0.4 * D;
    this.cannonArm.rotation.z = 0.2;
    clubElbow.rotation.x = -0.55 * (1 - wind - slam) - 0.3 * wind - 0.1 * slam;
    // free arm swings against the stride and dangles when dead
    this.podArm.rotation.x = Math.sin(ph) * 0.4 * move - 0.15 * this.aimK - 0.3 * slam + 0.3 * D;
    this.podArm.rotation.z = -0.2;
    freeElbow.rotation.x = -0.35 - 0.3 * this.aimK;
    this.eye.visible = r.state !== 'dead' || D < 0.3;
  }
}
