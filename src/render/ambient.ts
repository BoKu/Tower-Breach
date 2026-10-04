import * as THREE from 'three';
import type { AmbientSpec, FloorLayout } from '../gen/floor';
import { officerPose } from '../gen/floor';
import { isWalkableTile } from '../gen/floor';
import { OperatorRig, GunKind } from './operator';
import { lookFor } from '../config/npcs';
import { TEAM_COLORS } from './view';
import { Pigeon, Rat } from './critters';
import { Rng } from '../core/rng';

export type AmbientSound = { k: 'coo' | 'flutter' | 'squeak' | 'radio'; x: number; y: number };
type Pt = { x: number; y: number };

interface Squadmate { rig: OperatorRig; spec: Extract<AmbientSpec, { kind: 'squad' }>; gun: boolean }
interface Officer { gun: GunKind | null; rig: OperatorRig; spec: Extract<AmbientSpec, { kind: 'officer' }>; radioT: number; talkT: number }
interface Bird {
  p: Pigeon; home: Pt; x: number; y: number; z: number; face: number;
  state: 'ground' | 'fly' | 'gone' | 'land'; mode: 'walk' | 'peck' | 'look'; modeT: number; tx: number; ty: number;
  t: number; vx: number; vy: number; cooT: number;
}
interface RatS { r: Rat; a: Pt; b: Pt; x: number; y: number; face: number; toB: boolean; pause: number; rear: number; rearT: number; squeakT: number }

const SKINS = [0xc49a78, 0x8a5a3c, 0xe0b898, 0x6a4430, 0xb88a64, 0xd8a888];

const squadRig = (s: Extract<AmbientSpec, { kind: 'squad' }>) => OperatorRig.make(TEAM_COLORS[s.slot % TEAM_COLORS.length], { skin: SKINS[(s.slot * 2 + 1) % SKINS.length] });
const officerRig = (s: Extract<AmbientSpec, { kind: 'officer' }>) => OperatorRig.make(0x3d8bff, { outfit: 'police', look: lookFor(s.npc) });
/** One task per character look on this street (rigs and pigeons are built once per look, then copied): warm-up work. */
export function ambientWarmTasks(L: FloorLayout): (() => void)[] {
  return L.ambient.map((s) => () => { if (s.kind === 'squad') squadRig(s); else if (s.kind === 'officer') officerRig(s); else if (s.kind === 'pigeons') for (let i = 0; i < 4; i++) Pigeon.make(i); });
}

/**
 * Cosmetic street life. Officers follow deterministic, time-based routines so every co-op client sees the
 * same thing. Pigeons and rats react locally to nearby players and gunfire. None of it touches the simulation.
 */
export class Ambient {
  group = new THREE.Group();
  sounds: AmbientSound[] = [];
  private officers: Officer[] = [];
  private squad: Squadmate[] = [];
  private birds: Bird[] = [];
  private rats: RatS[] = [];
  private rng = new Rng(7);

  /** solo: single player; the stand-in squad-mates only appear when there are no real teammates */
  constructor(private L: FloorLayout, solo = true) {
    for (const s of L.ambient) {
      if (s.kind === 'squad') {
        if (!solo) continue;
        const rig = squadRig(s);
        const gun = s.slot % 2 === 0; // two keep their rifles up, two have them slung and talk with their hands
        rig.setGun(gun ? (s.slot === 2 ? 'smg' : 'rifle') : null);
        this.group.add(rig.root);
        this.squad.push({ rig, spec: s, gun });
      } else if (s.kind === 'officer') {
        const rig = officerRig(s);
        // door and cordon guards carry long guns; some patrols and the odd talker too
        const armed = s.mode === 'guard' || (s.mode === 'patrol' && s.seed < 0.65) || (s.mode === 'talk' && s.seed < 0.25);
        const gun: GunKind | null = armed ? (s.seed < 0.12 ? 'shotgun' : s.seed > 0.9 ? 'smg' : 'rifle') : null;
        rig.setGun(gun);
        this.group.add(rig.root);
        this.officers.push({ gun, rig, spec: s, radioT: 4 + s.seed * 20, talkT: 0 });
      } else if (s.kind === 'pigeons') {
        const r = new Rng(Math.floor(s.seed * 1e9));
        for (let i = 0; i < s.n; i++) {
          const p = Pigeon.make(i + Math.floor(s.seed * 10));
          p.root.scale.setScalar(1.7); // readable from the isometric camera
          const x = s.x + r.range(-0.9, 0.9), y = s.y + r.range(-0.9, 0.9);
          this.group.add(p.root);
          this.birds.push({ p, home: { x, y }, x, y, z: 0, face: r.range(0, 6.28), state: 'ground', mode: 'peck', modeT: r.range(0.5, 3), tx: x, ty: y, t: 0, vx: 0, vy: 0, cooT: r.range(3, 15) });
        }
      } else {
        const r = new Rat();
        r.root.scale.setScalar(1.6);
        this.group.add(r.root);
        this.rats.push({ r, a: { x: s.x, y: s.y }, b: { x: s.x2, y: s.y2 }, x: s.x, y: s.y, face: 0, toB: true, pause: s.seed * 4, rear: 0, rearT: 0, squeakT: 3 + s.seed * 8 });
      }
    }
  }

  /** `people`: positions of living players on this floor. `bangs`: gunfire/explosion positions this frame. */
  /** hold: paused seconds per officer npc (conversation); talking: npcs in conversation right now */
  update(t: number, dt: number, people: Pt[], bangs: Pt[], hold: Record<number, number> = {}, talking: number[] = []) {
    const nearest = (x: number, y: number) => people.reduce((m, p) => Math.min(m, Math.hypot(p.x - x, p.y - y)), 99);
    const loudNear = (x: number, y: number, r: number) => bangs.some((b) => Math.hypot(b.x - x, b.y - y) < r);
    // ---- officers: position/facing are pure functions of time; the rig animates gait and arms
    for (const o of this.officers) {
      const s = o.spec;
      const tt = t + s.seed * 100;
      const talkingNow = talking.includes(s.npc);
      const pose = officerPose(s, t - (hold[s.npc] ?? 0));
      let { x, y, face } = pose;
      // stationary (or paused mid-patrol for a chat) officers turn to face an operator who walks up to them
      if (!pose.moving || talkingNow) {
        let best: Pt | null = null, bd = 2.4;
        for (const p of people) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
        if (best) face = Math.atan2(best.y - y, best.x - x);
      }
      o.radioT -= dt;
      o.talkT = Math.max(0, o.talkT - dt);
      if (o.radioT <= 0) { o.radioT = 14 + ((s.seed * 997 + t) % 20); o.talkT = 1.6; this.sounds.push({ k: 'radio', x, y }); }
      o.rig.update({
        dt, t: tt, x, y, z: 0, facing: face, crouch: false, aiming: false, sprinting: false, firingRecently: false,
        life: 'alive', gun: o.gun, aimPitch: o.gun ? 0.1 : 0, reload: -1, hurt: false,
        // Chief Hollis (npc -1) stands upright overseeing the cordon, never stooped over the laptop
        pose: talkingNow ? 'talk' : s.npc < 0 ? 'fold' : s.mode === 'guard' ? 'fold' : s.mode === 'talk' ? 'talk' : s.mode === 'brief' ? 'brief' : s.mode === 'lean' ? 'lean' : 'swing',
        radio: o.talkT > 0,
      });
    }
    // ---- squad huddle: one speaker at a time (rotating); the others turn to listen, shift weight, nod
    const speaker = Math.floor((t + 3) / 5.5) % 4;
    for (const m of this.squad) {
      const s = m.spec, tt = t + s.seed * 50;
      const sp = this.squad.find((o) => o.spec.slot === speaker) ?? m;
      const talking = m === sp;
      const look = talking ? s.facing + Math.sin(tt * 0.7) * 0.5 : Math.atan2(sp.spec.y - s.y, sp.spec.x - s.x);
      const face = s.facing + (((look - s.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.7;
      m.rig.update({
        dt, t: tt, x: s.x, y: s.y, z: 0, facing: face, crouch: false, aiming: false, sprinting: false, firingRecently: false,
        life: 'alive', gun: m.gun ? (s.slot === 2 ? 'smg' : 'rifle') : null, aimPitch: talking ? -0.05 : 0.08 + Math.sin(tt * 1.3) * 0.05, reload: -1, hurt: false,
        pose: m.gun ? undefined : talking ? 'talk' : s.slot === 1 ? 'fold' : 'swing',
        radio: !talking && !m.gun && s.slot === 3 && Math.sin(tt * 0.3) > 0.85,
        vel: { vx: 0, vy: 0 },
      });
    }
    // ---- pigeons: wander and peck with the head-bob walk; scatter from people and gunfire; drift back later
    for (const b of this.birds) {
      b.t += dt;
      const near = nearest(b.x, b.y);
      if ((b.state === 'ground' || b.state === 'land') && (near < 3.2 || loudNear(b.x, b.y, 18))) {
        b.state = 'fly'; b.t = 0;
        let ax = b.x, ay = b.y;
        for (const p of people) if (Math.hypot(p.x - b.x, p.y - b.y) < 6) { ax = p.x; ay = p.y; }
        const away = ax === b.x && ay === b.y ? this.rng.range(0, 6.28) : Math.atan2(b.y - ay, b.x - ax) + this.rng.range(-0.6, 0.6);
        const sp = this.rng.range(4, 6);
        b.vx = Math.cos(away) * sp; b.vy = Math.sin(away) * sp;
        b.face = away;
        this.sounds.push({ k: 'flutter', x: b.x, y: b.y });
      }
      if (b.state === 'ground') {
        b.modeT -= dt;
        if (b.modeT <= 0) {
          const r = this.rng.next();
          if (r < 0.45) {
            // walk to a nearby spot
            for (let k = 0; k < 6; k++) {
              const a = this.rng.range(0, 6.28), d = this.rng.range(0.3, 1.1);
              const nx = b.home.x + Math.cos(a) * d, ny = b.home.y + Math.sin(a) * d;
              if (isWalkableTile(this.L, Math.floor(nx), Math.floor(ny))) { b.tx = nx; b.ty = ny; break; }
            }
            b.mode = 'walk'; b.modeT = 4;
          } else { b.mode = r < 0.8 ? 'peck' : 'look'; b.modeT = this.rng.range(1.2, 3.5); }
        }
        let speed = 0;
        if (b.mode === 'walk') {
          const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy);
          if (d < 0.05) { b.mode = 'peck'; b.modeT = this.rng.range(1, 3); }
          else {
            speed = 0.35;
            const st = Math.min(d, speed * dt);
            b.x += (dx / d) * st; b.y += (dy / d) * st;
            const want = Math.atan2(dy, dx);
            b.face += Math.atan2(Math.sin(want - b.face), Math.cos(want - b.face)) * Math.min(1, dt * 6);
          }
        }
        b.z = 0;
        b.p.ground(t + b.home.x, dt, speed, b.mode);
        b.cooT -= dt;
        if (b.cooT <= 0) { b.cooT = this.rng.range(8, 25); this.sounds.push({ k: 'coo', x: b.x, y: b.y }); }
      } else if (b.state === 'fly') {
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += dt * 2.8;
        b.p.air(t + b.home.y, 1, -0.35 + Math.min(0.3, b.t * 0.25), 0);
        if (b.t > 2.6) { b.state = 'gone'; b.t = 0; }
      } else if (b.state === 'gone') {
        if (b.t > 18 && nearest(b.home.x, b.home.y) > 9) { b.state = 'land'; b.t = 0; b.x = b.home.x - 4; b.y = b.home.y - 3; b.z = 3; }
      } else {
        // glide in, flare and settle
        const k = Math.min(1, b.t / 1.8);
        b.x = b.home.x - 4 * (1 - k); b.y = b.home.y - 3 * (1 - k); b.z = 3 * (1 - k) * (1 - k * 0.3);
        b.face = Math.atan2(3, 4);
        b.p.air(t, k > 0.7 ? 0.8 : 0.25, k > 0.7 ? -0.6 : 0.05, k > 0.6 ? 1 : 0);
        if (k >= 1) { b.state = 'ground'; b.mode = 'look'; b.modeT = 1.5; b.z = 0; }
      }
      b.p.root.visible = b.state !== 'gone';
      b.p.root.position.set(b.x, b.z, b.y);
      b.p.root.rotation.y = -b.face + Math.PI / 2;
    }
    // ---- rats: dash along walls with pauses, sniff, sometimes rear up; bolt away from people
    for (const r of this.rats) {
      const near = nearest(r.x, r.y);
      const scared = near < 2.8 || loudNear(r.x, r.y, 10);
      if (scared && r.pause > 0) {
        r.pause = 0; r.rear = 0;
        const p = people.reduce((m, q) => (Math.hypot(q.x - r.x, q.y - r.y) < Math.hypot(m.x - r.x, m.y - r.y) ? q : m), people[0] ?? { x: r.x, y: r.y });
        r.toB = Math.hypot(r.b.x - p.x, r.b.y - p.y) > Math.hypot(r.a.x - p.x, r.a.y - p.y);
        r.squeakT -= 2;
      }
      r.squeakT -= dt;
      if (r.squeakT <= 0 && near < 12) { r.squeakT = this.rng.range(6, 16); this.sounds.push({ k: 'squeak', x: r.x, y: r.y }); }
      let speed = 0;
      if (r.pause > 0) {
        r.pause -= dt;
        r.rearT -= dt;
        if (r.rearT <= 0) { r.rearT = this.rng.range(1.5, 4); r.rear = this.rng.chance(0.3) ? 1 : 0; }
      } else {
        r.rear = 0;
        const tgt = r.toB ? r.b : r.a;
        const dx = tgt.x - r.x, dy = tgt.y - r.y, d = Math.hypot(dx, dy);
        const sp = scared ? 5 : 2.2;
        if (d < 0.1) { r.toB = !r.toB; r.pause = this.rng.range(1, 5); }
        else {
          const step = Math.min(d, sp * dt);
          r.x += (dx / d) * step; r.y += (dy / d) * step;
          r.face = Math.atan2(dy, dx);
          speed = sp;
          if (!scared && this.rng.chance(dt * 0.35)) r.pause = this.rng.range(0.4, 1.5); // stop-start dashes
        }
      }
      (r as any).rearK = ((r as any).rearK ?? 0) + (r.rear - ((r as any).rearK ?? 0)) * Math.min(1, dt * 6);
      r.r.update(t + r.a.x, dt, speed, r.pause > 0, (r as any).rearK);
      r.r.root.position.set(r.x, 0, r.y);
      r.r.root.rotation.y = -r.face + Math.PI / 2;
    }
  }

  drainSounds(): AmbientSound[] { const s = this.sounds; this.sounds = []; return s; }

  dispose() {
    // officer, squad-mate and pigeon rigs share their looks' geometry (OperatorRig.make, Pigeon.make): rats only
    for (const r of this.rats) r.r.root.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
  }
}
