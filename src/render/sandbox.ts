import * as THREE from 'three';
import { OperatorRig, GunKind, Outfit, RigInput, OfficerLook } from './operator';
import { lookFor } from '../config/npcs';
import { DogRig, DroneRig, WardenRig, BeastInput } from './beasts';
import { Pigeon, Rat } from './critters';
import { weaponModel, gearModel } from './armoryArt';
import { WEAPONS } from '../config/weapons';
import { currentHoliday } from '../config/holiday';
import type { FloorLayout } from '../gen/floor';

/**
 * Developer sandbox showcase (?dev=1&floor=sandbox). Purely cosmetic: every character, animal, weapon and gear
 * model laid out on a labelled grid, each exhibit locked in one pose / animation loop. Props, stairs and the
 * environment pieces are real layout content rendered by FloorView; this adds everything that normally needs AI.
 */

const FW_EAST = 60;
const SOUTH = Math.PI / 2; // facing the camera
type Exhibit = (t: number, dt: number) => void;

function label(text: string, w = 1.5, sub = false): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const g = c.getContext('2d')!;
  g.fillStyle = sub ? 'rgba(10,14,20,0.6)' : 'rgba(255,40,90,0.85)';
  g.fillRect(0, 0, 256, 48);
  g.fillStyle = sub ? '#9ff3ff' : '#ffffff';
  g.font = `${sub ? 600 : 700} ${sub ? 24 : 28}px "Chakra Petch", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.toUpperCase(), 128, 25, 244);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 48 / 256), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 3;
  return m;
}

/** periodic trigger: true once every `period` seconds */
const every = (t: number, dt: number, period: number) => Math.floor(t / period) !== Math.floor((t - dt) / period);

interface Pose { name: string; set: (r: RigInput, t: number, dt: number, rig: OperatorRig) => void }
const move = (speed: number, rel = 0) => (r: RigInput) => { const a = r.facing + rel; r.vel = { vx: Math.cos(a) * speed, vy: Math.sin(a) * speed }; };
const FULL_POSES: Pose[] = [
  { name: 'idle', set: () => {} },
  { name: 'walk', set: move(1.5) },
  { name: 'run', set: move(3.6) },
  { name: 'sprint', set: (r) => { move(5.6)(r); r.sprinting = true; } },
  { name: 'strafe L', set: move(2.4, -Math.PI / 2) },
  { name: 'strafe R', set: move(2.4, Math.PI / 2) },
  { name: 'backpedal', set: move(1.8, Math.PI) },
  { name: 'crouch', set: (r) => { r.crouch = true; } },
  { name: 'crouch walk', set: (r) => { r.crouch = true; move(1.2)(r); } },
  { name: 'aim', set: (r) => { r.aiming = true; } },
  { name: 'aim up', set: (r) => { r.aiming = true; r.aimPitch = -0.45; } },
  { name: 'aim down', set: (r) => { r.aiming = true; r.aimPitch = 0.5; } },
  { name: 'fire', set: (r, t, dt, rig) => { r.aiming = true; r.firingRecently = true; if (every(t, dt, 0.18)) rig.onShot(); } },
  { name: 'walk + fire', set: (r, t, dt, rig) => { move(1.4)(r); r.aiming = true; r.firingRecently = true; if (every(t, dt, 0.22)) rig.onShot(); } },
  { name: 'reload', set: (r, t) => { const q = (t % 3) / 2.4; r.reload = q < 1 ? q : -1; } },
  { name: 'throw', set: (_r, t, dt, rig) => { if (every(t, dt, 1.6)) rig.onThrow(); } },
  { name: 'jump', set: (r, t) => { r.z = Math.max(0, Math.sin(t * 3.2)) * 0.55; } },
  { name: 'hurt', set: (r) => { r.hurt = true; } },
  { name: 'down', set: (r) => { r.life = 'down'; } },
  { name: 'dead', set: (r) => { r.life = 'dead'; } },
  { name: 'turntable', set: (r, t) => { r.facing = t * 0.7; } },
];
const KNIFE_POSES: Pose[] = [
  { name: 'knife idle', set: (r) => { r.gun = null; } },
  { name: 'knife slash', set: (r, t, dt, rig) => { r.gun = null; if (every(t, dt, 0.9)) rig.onMelee(); } },
  { name: 'knife run', set: (r) => { r.gun = null; move(3.8)(r); } },
];
const POLICE_POSES: Pose[] = [
  { name: 'idle', set: (r) => { r.pose = 'swing'; } },
  { name: 'walk', set: (r) => { r.pose = 'swing'; move(1.3)(r); } },
  { name: 'run', set: move(3.4) },
  { name: 'arms folded', set: (r) => { r.pose = 'fold'; } },
  { name: 'talking', set: (r) => { r.pose = 'talk'; } },
  { name: 'briefing', set: (r) => { r.pose = 'brief'; } },
  { name: 'leaning', set: (r) => { r.pose = 'lean'; } },
  { name: 'radio', set: (r) => { r.radio = true; } },
  { name: 'walk + radio', set: (r) => { r.radio = true; move(1.2)(r); } },
  { name: 'crouch', set: (r) => { r.crouch = true; } },
  { name: 'dead', set: (r) => { r.life = 'dead'; } },
  { name: 'turntable', set: (r, t) => { r.facing = t * 0.7; } },
];
const ENEMY_POSES = FULL_POSES.filter((p) => ['idle', 'walk', 'run', 'sprint', 'strafe L', 'backpedal', 'crouch', 'aim', 'fire', 'reload', 'hurt', 'dead', 'turntable'].includes(p.name));

// xmas / easter: the row title on Christmas (Santa-suit police, armed elves) and Easter (bunny-eared police, armed dentists)
const OUTFITS: { outfit: Outfit; name: string; xmas?: string; easter?: string; color: number; gun: GunKind | null; poses: Pose[] }[] = [
  { outfit: 'operator', name: 'Operator', color: 0x39d0ff, gun: 'rifle', poses: [...FULL_POSES, ...KNIFE_POSES] },
  { outfit: 'police', name: 'Police', xmas: 'Police (Santa)', easter: 'Police (Easter)', color: 0x3d8bff, gun: null, poses: POLICE_POSES },
  { outfit: 'loyalist', name: 'Loyalist', xmas: 'Elf loyalist', easter: 'Dentist', color: 0xff4040, gun: 'smg', poses: ENEMY_POSES },
  { outfit: 'loyalistElite', name: 'Loyalist elite', xmas: 'Elf loyalist elite', easter: 'Senior dentist', color: 0xff4040, gun: 'shotgun', poses: ENEMY_POSES },
  { outfit: 'cyborg', name: 'Cyborg', xmas: 'Elf cyborg', easter: 'Cyborg dentist', color: 0xff4040, gun: 'rifle', poses: ENEMY_POSES },
  { outfit: 'cyborgElite', name: 'Cyborg elite', xmas: 'Elf cyborg elite', easter: 'Senior cyborg dentist', color: 0xff4040, gun: 'lmg', poses: ENEMY_POSES },
];
// Halloween undead: unarmed, arms-out shamble and claw swipes
const ZOMBIE_POSES: Pose[] = [
  { name: 'idle', set: () => {} },
  { name: 'shamble', set: move(1.4) },
  { name: 'lurch (run)', set: move(3.2) },
  { name: 'alert', set: (r) => { r.aiming = true; } },
  { name: 'claw', set: (r, t, dt, rig) => { r.aiming = true; if (every(t, dt, 0.8)) rig.onMelee(); } },
  { name: 'walk + claw', set: (r, t, dt, rig) => { move(1.2)(r); r.aiming = true; if (every(t, dt, 0.8)) rig.onMelee(); } },
  { name: 'hurt', set: (r) => { r.hurt = true; r.aiming = true; } },
  { name: 'dead', set: (r) => { r.life = 'dead'; } },
  { name: 'turntable', set: (r, t) => { r.facing = t * 0.7; move(1.2)(r); } },
];
const ZOMBIES: { outfit: Outfit; name: string }[] = [
  { outfit: 'loyalist', name: 'Zombie loyalist' }, { outfit: 'cyborg', name: 'Zombie cyborg' },
];
const GUNS: GunKind[] = ['pistol', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper'];

export class Showcase {
  group = new THREE.Group();
  private exhibits: Exhibit[] = [];
  private t = 0;

  constructor(L: FloorLayout) {
    const X0 = 8.5, X1 = 55.5, DX = 1.6;
    // ---- characters: one row per outfit, one exhibit per pose (rows wrap)
    let y = 2.6;
    let x = X0 + 2.8;
    const wrap = (step: number, rowH = 2.1) => { if (x > X1) { x = X0 + 2.8; y += rowH; } const at = x; x += step; return at; };
    const row = (title: string, gap = 2.1) => { y += gap; x = X0 + 2.8; this.heading(title, X0 - 0.2, y + 0.3); };
    y -= 2.1;
    const xmas = currentHoliday() === 'xmas', easter = currentHoliday() === 'easter';
    for (const o of OUTFITS) {
      row(xmas ? o.xmas ?? o.name : easter ? o.easter ?? o.name : o.name);
      for (const pose of o.poses) this.character(o.outfit, o.color, o.gun, pose, wrap(DX), y);
      // Christmas / Easter: a few street-cast looks too (Santa beards on the whiskered ones; the Chief's big bunny ears)
      if ((xmas || easter) && o.outfit === 'police') for (const [name, npc] of [['chief', -1], ['beard', 0], ['no beard', 3], ['glasses', 4]] as [string, number][]) this.character('police', o.color, null, { name, set: (r) => { r.pose = 'fold'; } }, wrap(DX), y, false, lookFor(npc));
    }
    if (currentHoliday() === 'halloween') for (const z of ZOMBIES) {
      row(z.name);
      for (const pose of ZOMBIE_POSES) this.character(z.outfit, 0xff4040, null, pose, wrap(DX), y, true);
    }
    // operator with every weapon type, aiming and at the ready (holiday sandboxes skip weapons)
    if (!currentHoliday()) {
      row('Weapons held');
      for (const g of GUNS) {
        this.character('operator', 0x39d0ff, g, { name: g, set: (r) => { r.aiming = true; } }, wrap(DX), y);
        this.character('operator', 0x39d0ff, g, { name: g + ' ready', set: () => {} }, wrap(DX), y);
      }
      this.character('operator', 0x39d0ff, 'rifle', { name: 'torch on', set: (r, _t, _dt, rig) => { rig.torchOn = true; r.aiming = true; } }, wrap(DX), y);
    }
    // ---- dogs
    row(xmas ? 'Snowmen' : easter ? 'Chocolate bunnies' : 'Dogs', 2.3);
    const DOG: [string, Partial<BeastInput> & { bite?: boolean; speed?: number; spin?: boolean }][] = [
      ['idle', {}], ['walk', { speed: 1.2 }], ['trot', { speed: 2.8 }], ['gallop', { speed: 5 }], ['alert', { alert: true, state: 'alert' }],
      ['bite', { alert: true, state: 'alert', bite: true }], ['sleep', { state: 'sleep' }], ['dead', { state: 'dead' }], ['turntable', { spin: true, speed: 1.2 }],
    ];
    for (const cyber of [false, true])
      for (const [name, o] of DOG) {
        const bx = wrap(2.0), by = y;
        const d = new DogRig(cyber);
        this.add(d.root);
        this.tag(`${cyber ? 'cyber ' : ''}${name}`, bx, by + 0.75);
        this.exhibits.push((t, dt) => {
          const f = o.spin ? t * 0.7 : SOUTH;
          if (o.bite && every(t, dt, 1.1)) d.onBite();
          d.update({ dt, t, x: bx, y: by, facing: f, state: o.state ?? 'idle', ground: 0, alert: !!o.alert, vel: { vx: Math.cos(f) * (o.speed ?? 0), vy: Math.sin(f) * (o.speed ?? 0) } });
        });
      }
    // ---- drones, warden, critters (Halloween: bats and an ogre, whose attack is a melee nip / club smash)
    const spooky = currentHoliday() === 'halloween';
    row(spooky ? 'Bats, ogre, critters' : 'Drones, warden, critters', 2.3);
    const DRONE: [string, { vx?: number; vy?: number; fire?: boolean; dead?: boolean; spin?: boolean }][] = [
      ['hover', {}], ['forward', { vy: 2 }], ['bank', { vx: 2 }], [spooky ? 'nip' : 'firing', { fire: true }], ['dead', { dead: true }], ['turntable', { spin: true }],
    ];
    for (const [name, o] of DRONE) {
      const bx = wrap(DX), by = y;
      const d = new DroneRig();
      this.add(d.root);
      this.tag((spooky ? 'bat ' : 'drone ') + name, bx, by + 0.75);
      this.exhibits.push((t, dt) => {
        if (o.fire && every(t, dt, spooky ? 0.9 : 0.2)) { if (spooky) d.onBite(); else d.onShot(); }
        d.update({ dt, t, x: bx, y: by, facing: o.spin ? t * 0.7 : SOUTH, state: o.dead ? 'dead' : 'alert', ground: 0, alert: true, vel: { vx: o.vx ?? 0, vy: o.vy ?? 0 } });
      });
    }
    const WARDEN: [string, { v?: number; alert?: boolean; fire?: boolean; dead?: boolean; spin?: boolean }][] = [
      ['idle', {}], ['walk', { v: 1.0 }], ['alert', { alert: true }], [spooky ? 'smash' : 'firing', { alert: true, fire: true }], ['dead', { dead: true }], ['turntable', { spin: true, alert: true }],
    ];
    for (const [name, o] of WARDEN) {
      const bx = wrap(2.4) + 0.4, by = y;
      const w = new WardenRig();
      this.add(w.root);
      this.tag((spooky ? 'ogre ' : 'warden ') + name, bx, by + 1.2);
      this.exhibits.push((t, dt) => {
        const f = o.spin ? t * 0.5 : SOUTH;
        if (o.fire && every(t, dt, spooky ? 1.8 : 0.11)) { if (spooky) w.onBite(); else w.onShot(); }
        w.update({ dt, t, x: bx, y: by, facing: f, state: o.dead ? 'dead' : o.alert ? 'alert' : 'idle', ground: 0, alert: !!o.alert, vel: { vx: Math.cos(f) * (o.v ?? 0), vy: Math.sin(f) * (o.v ?? 0) } });
      });
    }
    const BIRD: [string, (p: Pigeon, t: number, dt: number) => void][] = [
      ['pigeon walk', (p, t, dt) => p.ground(t, dt, 0.5, 'walk')],
      ['pigeon peck', (p, t, dt) => p.ground(t, dt, 0, 'peck')],
      ['pigeon look', (p, t, dt) => p.ground(t, dt, 0, 'look')],
      ['pigeon flap', (p, t) => p.air(t, 1, -0.35, 0)],
      ['pigeon glide', (p, t) => p.air(t, 0.25, 0.05, 0)],
      ['pigeon landing', (p, t) => p.air(t, 0.8, -0.6, 1)],
    ];
    BIRD.forEach(([name0, fn], i) => {
      const name = xmas ? name0.replace('pigeon', 'dove') : easter ? name0.replace('pigeon', 'chick') : name0;
      const bx = wrap(1.3), by = y;
      const p = new Pigeon(i);
      this.add(p.root);
      p.root.position.set(bx, name.includes('flap') || name.includes('glide') ? 0.8 : 0, by);
      p.root.scale.setScalar(2);
      this.tag(name, bx, by + 0.6, 1.2);
      this.exhibits.push((t, dt) => fn(p, t, dt));
    });
    for (const [name, spd, sniff, rear] of [['rat run', 1.5, false, 0], ['rat sniff', 0, true, 0], ['rat rear', 0, false, 1]] as [string, number, boolean, number][]) {
      const bx = wrap(1.3), by = y;
      const r = new Rat();
      this.add(r.root);
      r.root.position.set(bx, 0, by);
      r.root.scale.setScalar(2);
      this.tag(xmas || easter ? name.replace('rat', xmas ? 'rabbit' : 'bunny').replace('run', 'hop').replace('rear', 'sit up') : name, bx, by + 0.6, 1.2);
      this.exhibits.push((t, dt) => r.update(t, dt, spd, sniff, rear));
    }
    // ---- weapon and gear models, on slowly turning pedestals
    row('Armory models', 2.1);
    const items: [string, THREE.Object3D][] = [
      ...(currentHoliday() ? [] : WEAPONS.filter((w) => w.price > 0)).map((w) => [w.id, weaponModel(w.id)] as [string, THREE.Object3D]),
      ...['vest', 'vesthelm', 'plate', 'frag', 'flash', 'smoke', 'incendiary', 'decoy', 'medkit', 'battery', 'bypass', 'torchmod', 'pouch'].map((id) => [id, gearModel(id)] as [string, THREE.Object3D]),
    ];
    for (const [id, m] of items) {
      const bx = wrap(1.3, 1.8), by = y;
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.35, 20), new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.6, metalness: 0.3 }));
      ped.position.set(bx, 0.175, by);
      this.add(ped);
      const spin = new THREE.Group();
      spin.position.set(bx, 0.75, by);
      m.scale.setScalar(2.4);
      spin.add(m);
      this.add(spin);
      this.tag(id, bx, by + 0.65, 1.1);
      this.exhibits.push((t) => { spin.rotation.y = t * 0.6; });
    }
    this.bottom = y;
    // ---- labels for the real layout content: props (with orientation) and the environment strip
    const ROT = ['S', 'W', 'N', 'E'];
    for (const q of L.props) if (q.kind.startsWith('pipes.')) this.tag('pipes: ' + q.kind.slice(6).split('#')[0].split('.').join(' / '), q.x, q.y + 0.1, Math.min(2.4, Math.max(q.w, 1.6)));
    else this.tag(q.w === q.h && q.kind !== 'mainframe' && q.kind !== 'cubicle' && q.kind !== 'generator' && q.kind !== 'booth' ? `${q.kind} ${ROT[q.rot] ?? ''}` : q.w < q.h ? q.kind + ' (N-S)' : q.kind, q.x, q.y + q.h / 2 + 0.18, Math.min(1.4, Math.max(0.9, q.w)));
    const CAM = ['cctv static', 'cctv sweeping', 'cctv alarm'];
    L.cameras.forEach((c, i) => this.tag(CAM[i] ?? 'cctv', c.x, c.y + 0.9));
    for (const tr of L.traps) this.tag(tr.kind === 'mine' ? 'proximity mine' : 'tripwire', (tr.x + (tr.kind === 'tripwire' ? tr.x2 : tr.x)) / 2, tr.y + 0.7);
    for (const hz of L.hazards) this.tag(hz.kind === 'fire' ? 'fire hazard' : 'shock hazard', hz.x, hz.y + 1.3);
    L.vendings.forEach((v, i) => this.tag(i ? 'vending (broken)' : 'vending', v.x + 1.2, v.y));
    const LIGHT: Record<string, string> = { emergency: 'emergency light', police: 'police strobe', fire: '' };
    const seen = new Set<string>();
    for (const l of L.lights) {
      const n = l.broken ? 'broken light' : l.flicker && l.kind === 'ceiling' ? 'flickering light' : LIGHT[l.kind];
      if (n && l.x < 7 && !seen.has(n + l.y)) { seen.add(n + l.y); this.tag(n, 4.5, l.y + 0.8); }
    }
    this.tag('stairs: up clear / down damaged', 3.5, 8.6, 2.2);
    this.tag('up fire / down clear', FW_EAST, 8.6, 2.0);
    this.tag('up debris / down collapsed', FW_EAST, 38.9, 2.2);
  }
  /** last row's y, so tests / layout can check the showcase stays north of the prop rows */
  bottom = 0;

  private add(o: THREE.Object3D) { this.group.add(o); }
  private heading(text: string, x: number, y: number) {
    const m = label(text, 2.6);
    m.position.set(x + 1.3, 0.02, y);
    this.add(m);
  }
  private tag(text: string, x: number, y: number, w = 1.4) {
    const m = label(text, w, true);
    m.position.set(x, 0.02, y);
    this.add(m);
  }

  private character(outfit: Outfit, color: number, gun: GunKind | null, pose: Pose, x: number, y: number, zombie = false, look?: OfficerLook) {
    const rig = new OperatorRig(color, { outfit, zombie, look });
    rig.setGun(gun);
    this.add(rig.root);
    this.tag(pose.name, x, y + 0.75);
    this.exhibits.push((t, dt) => {
      const r: RigInput = {
        dt, t, x, y, z: 0, facing: SOUTH, crouch: false, aiming: false, sprinting: false, firingRecently: false,
        life: 'alive', gun, aimPitch: 0, reload: -1, hurt: false, vel: { vx: 0, vy: 0 },
      };
      pose.set(r, t, dt, rig);
      rig.setGun(r.gun);
      rig.update(r);
    });
  }

  /** Frozen: no exhibit updates and no per-frame matrix recomputes for the whole showcase (saves CPU/FPS). */
  paused = false;
  setPaused(on: boolean) {
    if (on === this.paused) return;
    this.paused = on;
    this.group.updateMatrixWorld(true); // freeze in the current pose
    this.group.traverse((o) => { o.matrixAutoUpdate = !on; });
  }

  update(dt: number) {
    if (this.paused) return;
    this.t += dt;
    for (const e of this.exhibits) e(this.t, dt);
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial | undefined;
      if (mat && mat.map) mat.map.dispose();
    });
  }
}
