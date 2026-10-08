import * as THREE from 'three';
import { tex } from './textures';
import type { SimEvent, FloorState } from '../sim/state';
import { shotStart } from './muzzle';
import { currentHoliday } from '../config/holiday';

const MAX_P = 3000;

class ParticleSystem {
  geo = new THREE.BufferGeometry();
  pos = new Float32Array(MAX_P * 3);
  col = new Float32Array(MAX_P * 4);
  size = new Float32Array(MAX_P);
  vel = new Float32Array(MAX_P * 3);
  life = new Float32Array(MAX_P);
  maxLife = new Float32Array(MAX_P);
  grow = new Float32Array(MAX_P);
  grav = new Float32Array(MAX_P);
  base = new Float32Array(MAX_P * 4);
  next = 0;
  points: THREE.Points;
  constructor(additive: boolean) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex.soft() }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, r: number, g: number, b: number, a: number, grow = 0, grav = 0) {
    const i = this.next;
    this.next = (this.next + 1) % MAX_P;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.grow[i] = grow; this.grav[i] = grav;
    this.base.set([r, g, b, a], i * 4);
  }
  update(dt: number) {
    for (let i = 0; i < MAX_P; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.3; this.vel[i * 3] *= 0.6; this.vel[i * 3 + 2] *= 0.6; }
      this.size[i] += this.grow[i] * dt;
      this.col[i * 4] = this.base[i * 4]; this.col[i * 4 + 1] = this.base[i * 4 + 1]; this.col[i * 4 + 2] = this.base[i * 4 + 2];
      this.col[i * 4 + 3] = this.base[i * 4 + 3] * Math.min(1, k * 2);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }
  clear() { this.life.fill(0); }
}

const MAX_TRACERS = 96;
const MAX_DECALS = 160;

export interface Flash { x: number; y: number; z: number; color: number; intensity: number; t: number; dur: number; range: number }

export class FX {
  group = new THREE.Group();
  add = new ParticleSystem(true);
  norm = new ParticleSystem(false);
  private tracerGeo = new THREE.BufferGeometry();
  private tracerPos = new Float32Array(MAX_TRACERS * 6);
  private tracerCol = new Float32Array(MAX_TRACERS * 6);
  private tracerLife = new Float32Array(MAX_TRACERS);
  private tracerNext = 0;
  private decals: THREE.Mesh[] = [];
  private decalNext = 0;
  flashes: Flash[] = [];
  shake = 0;
  private emitAcc = 0;
  private shadows: { s: THREE.Sprite; vx: number; vy: number; t: number }[] = [];
  private shadowTex: THREE.Texture | null = null;

  constructor() {
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    this.tracerGeo.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3));
    const tl = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    tl.frustumCulled = false;
    this.group.add(this.add.points, this.norm.points, tl);
    const bloodMat = new THREE.MeshBasicMaterial({ map: tex.blood(), transparent: true, depthWrite: false, color: 0x993333 });
    const scorchMat = new THREE.MeshBasicMaterial({ map: tex.scorch(), transparent: true, depthWrite: false });
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_DECALS; i++) {
      const m = new THREE.Mesh(g, i % 2 ? bloodMat : scorchMat);
      m.visible = false;
      m.renderOrder = 1;
      this.decals.push(m);
      this.group.add(m);
    }
  }

  clear() {
    this.add.clear(); this.norm.clear();
    this.tracerLife.fill(0);
    for (const d of this.decals) d.visible = false;
    this.flashes = [];
  }

  private decal(x: number, y: number, blood: boolean, size: number) {
    // pick next decal of the right material parity
    for (let k = 0; k < 2; k++) {
      const i = this.decalNext;
      this.decalNext = (this.decalNext + 1) % MAX_DECALS;
      if ((i % 2 === 1) === blood) {
        const d = this.decals[i];
        d.visible = true;
        d.position.set(x, 0.012 + (i % 7) * 0.0008, y);
        d.scale.setScalar(size);
        d.rotation.y = i * 1.7;
        return;
      }
    }
  }

  tracer(x: number, y: number, z: number, x2: number, y2: number, z2: number, color: THREE.Color) {
    const i = this.tracerNext;
    this.tracerNext = (this.tracerNext + 1) % MAX_TRACERS;
    this.tracerPos.set([x, z, y, x2, z2, y2], i * 6);
    this.tracerCol.set([color.r, color.g, color.b, color.r * 0.3, color.g * 0.3, color.b * 0.3], i * 6);
    this.tracerLife[i] = 0.07;
  }

  sparks(x: number, y: number, z: number, n: number, r = 1, g = 0.75, b = 0.35, speed = 3) {
    for (let i = 0; i < n; i++) this.add.emit(x, z, y, (Math.random() - 0.5) * speed, Math.random() * speed * 0.8, (Math.random() - 0.5) * speed, 0.2 + Math.random() * 0.3, 0.08, r, g, b, 1, -0.1, 9);
  }

  /** muzzle: the shooter's gun muzzle on its 3D model (Entities.muzzleOf), so trails leave the gun */
  onEvent(ev: SimEvent, localFloor: number, localId: number, muzzle?: (src: 'p' | 'e', id: number) => { x: number; y: number; z: number } | null) {
    if ('f' in ev && ev.f !== localFloor) return;
    const spooky = currentHoliday() === 'halloween'; // drones are bats and wardens ogres: they bleed instead of sparking
    if (spooky && ev.e === 'shot' && ev.hit === 'metal') ev = { ...ev, hit: 'flesh' };
    switch (ev.e) {
      case 'shot': {
        const col = ev.src === 'e' ? new THREE.Color(1, 0.35, 0.25) : new THREE.Color(1, 0.85, 0.5);
        const s0 = shotStart(ev, muzzle?.(ev.src, ev.id) ?? null);
        const z1 = ev.z2 ?? (ev.hit === 'none' ? 1.25 : 1.0);
        this.tracer(s0.x, s0.y, s0.z, ev.x2, ev.y2, z1, col);
        this.add.emit(s0.x, s0.z, s0.y, 0, 0.3, 0, 0.06, 0.55, 1, 0.8, 0.4, 1);
        this.flashes.push({ x: s0.x, y: s0.y, z: s0.z + 0.05, color: 0xffc070, intensity: 6, t: 0, dur: 0.06, range: 7 });
        if (ev.hit === 'wall' || ev.hit === 'glass') { this.sparks(ev.x2, ev.y2, z1, 4); this.norm.emit(ev.x2, z1, ev.y2, 0, 0.4, 0, 0.6, 0.25, 0.5, 0.48, 0.45, 0.5, 0.6); }
        if (ev.hit === 'floor') { this.sparks(ev.x2, ev.y2, 0.03, 5, 1, 0.8, 0.45, 2.5); for (let i = 0; i < 3; i++) this.norm.emit(ev.x2, 0.05, ev.y2, (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6, 0.7, 0.2, 0.45, 0.43, 0.4, 0.55, 0.5); if (Math.random() < 0.5) this.decal(ev.x2, ev.y2, false, 0.22); }
        if (ev.hit === 'metal') this.sparks(ev.x2, ev.y2, z1, 8, 1, 0.9, 0.6, 4);
        if (ev.hit === 'flesh') { for (let i = 0; i < 6; i++) this.norm.emit(ev.x2, z1, ev.y2, (Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.4, 0.12, 0.45, 0.02, 0.02, 0.9, 0, 9); if (Math.random() < 0.35) this.decal(ev.x2 + (Math.random() - 0.5), ev.y2 + (Math.random() - 0.5), true, 0.6 + Math.random() * 0.5); }
        if (ev.src === 'p' && ev.id === localId) this.shake = Math.max(this.shake, 0.05);
        break;
      }
      case 'hitE':
        if (ev.metal && !spooky) this.sparks(ev.x, ev.y, 1.2, 5, 1, 0.9, 0.6, 3);
        break;
      case 'die':
        if (spooky && ev.t === 'warden') { this.decal(ev.x, ev.y, true, 2.2); for (let i = 0; i < 16; i++) this.norm.emit(ev.x + (Math.random() - 0.5) * 1.6, 0.2, ev.y + (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.5, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 1.5, 1.4, 0.6, 0.4, 0.37, 0.32, 0.5, 1); this.shake = Math.max(this.shake, 0.25); break; } // ogre topples: dust and a thud
        if (spooky && ev.t === 'drone') { this.decal(ev.x, ev.y, true, 0.9); for (let i = 0; i < 8; i++) this.norm.emit(ev.x, 1.6, ev.y, (Math.random() - 0.5) * 1.2, Math.random() * 0.6, (Math.random() - 0.5) * 1.2, 1.2, 0.07, 0.12, 0.08, 0.06, 0.9, 0, 2); break; } // bat: tufts of fur flutter down
        this.decal(ev.x, ev.y, !(ev.t === 'drone' || ev.t === 'warden'), 1.4); // machines scorch, they don't bleed
        if (ev.t === 'drone' || ev.t === 'warden') { this.sparks(ev.x, ev.y, 1.2, 30, 1, 0.8, 0.4, 5); for (let i = 0; i < 10; i++) this.norm.emit(ev.x, 1, ev.y, (Math.random() - 0.5), 1 + Math.random(), (Math.random() - 0.5), 1.8, 0.5, 0.1, 0.1, 0.1, 0.6, 0.8); }
        break;
      case 'explode': {
        if (ev.kind === 'frag' || ev.kind === 'trap') {
          this.flashes.push({ x: ev.x, y: ev.y, z: 1.2, color: 0xffa040, intensity: 40, t: 0, dur: 0.35, range: 14 });
          for (let i = 0; i < 60; i++) this.add.emit(ev.x, 0.5, ev.y, (Math.random() - 0.5) * 9, Math.random() * 6, (Math.random() - 0.5) * 9, 0.3 + Math.random() * 0.4, 0.4, 1, 0.6 + Math.random() * 0.3, 0.2, 1, 0.6, 5);
          for (let i = 0; i < 26; i++) this.norm.emit(ev.x + (Math.random() - 0.5), 0.6, ev.y + (Math.random() - 0.5), (Math.random() - 0.5) * 2, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * 2, 2.5 + Math.random() * 1.5, 1.2, 0.12, 0.11, 0.1, 0.8, 1.2);
          this.decal(ev.x, ev.y, false, 3.2);
          this.shake = Math.max(this.shake, 0.5);
        } else if (ev.kind === 'spark') {
          this.flashes.push({ x: ev.x, y: ev.y, z: 1.2, color: 0x9ad8ff, intensity: 20, t: 0, dur: 0.18, range: 7 });
          for (let i = 0; i < 30; i++) this.add.emit(ev.x, 1.2, ev.y, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 0.25 + Math.random() * 0.3, 0.05, 1, 0.85, 0.5, 1, 0.8, 9);
        } else if (ev.kind === 'flash') {
          this.flashes.push({ x: ev.x, y: ev.y, z: 1, color: 0xffffff, intensity: 80, t: 0, dur: 0.25, range: 18 });
          this.shake = Math.max(this.shake, 0.15);
        } else if (ev.kind === 'smoke') {
          for (let i = 0; i < 20; i++) this.norm.emit(ev.x, 0.4, ev.y, (Math.random() - 0.5) * 3, Math.random(), (Math.random() - 0.5) * 3, 3, 1.5, 0.55, 0.57, 0.55, 0.7, 1);
        } else if (ev.kind === 'fire') {
          this.flashes.push({ x: ev.x, y: ev.y, z: 0.6, color: 0xff7020, intensity: 18, t: 0, dur: 0.4, range: 10 });
          this.decal(ev.x, ev.y, false, 4);
        }
        break;
      }
      case 'vend':
        for (let i = 0; i < 26; i++) this.add.emit(ev.x, 1.2, ev.y, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 0.5, 0.06, 0.7, 0.85, 1, 1, 0, 9);
        break;
      case 'melee':
        if (ev.hit) for (let i = 0; i < 5; i++) this.norm.emit(ev.x, 1.1, ev.y, (Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2, 0.35, 0.1, 0.5, 0.03, 0.03, 0.9, 0, 9);
        break;
      case 'scare':
        if (ev.k === 'shadow') this.spawnShadow(ev.x, ev.y);
        if (ev.k === 'lightburst') { this.sparks(ev.x, ev.y, 2.5, 40, 1, 0.9, 0.7, 4); this.flashes.push({ x: ev.x, y: ev.y, z: 2.4, color: 0xffffff, intensity: 30, t: 0, dur: 0.12, range: 10 }); }
        break;
      case 'elev':
        if (ev.k === 'dead') this.sparks(ev.x + 1.3, ev.y + 1.4, 1.35, 16, 0.6, 0.8, 1, 3);
        break;
      case 'hurt':
        if (ev.pid === localId) this.shake = Math.max(this.shake, 0.18);
        break;
      case 'trap':
        if (ev.k === 'disarm') this.sparks(0, 0, 0, 0);
        break;
    }
  }

  /** Continuous emitters: fire zones, smoke clouds, hazards, burning stairs. */
  ambient(fs: FloorState, spots: { x: number; y: number; r: number; kind: string }[], dt: number) {
    this.emitAcc += dt;
    if (this.emitAcc < 1 / 30) return;
    const k = this.emitAcc;
    this.emitAcc = 0;
    const fire = (x: number, y: number, r: number, rate: number) => {
      const n = Math.ceil(rate * k * 30);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28, d = Math.random() * r;
        this.add.emit(x + Math.cos(a) * d, 0.15, y + Math.sin(a) * d, (Math.random() - 0.5) * 0.3, 1.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.3, 0.45 + Math.random() * 0.4, 0.5, 1, 0.45 + Math.random() * 0.25, 0.12, 0.9, -0.5, -0.5);
        if (Math.random() < 0.25) this.norm.emit(x + Math.cos(a) * d, 1.2, y + Math.sin(a) * d, 0, 0.8, 0, 2, 0.6, 0.08, 0.07, 0.06, 0.5, 0.6);
      }
    };
    for (const z of fs.zones) {
      if (z.kind === 'fire') fire(z.x, z.y, z.r, 2.5);
      else if (z.kind === 'smoke' && Math.random() < 0.8) {
        const a = Math.random() * 6.28, d = Math.random() * z.r;
        this.norm.emit(z.x + Math.cos(a) * d, 0.3 + Math.random() * 1.8, z.y + Math.sin(a) * d, (Math.random() - 0.5) * 0.2, 0.05, (Math.random() - 0.5) * 0.2, 3.5, 2.2, 0.5, 0.52, 0.5, Math.min(0.85, z.t / 3), 0.2);
      }
    }
    for (const h of fs.hazards) {
      if (h.kind === 'fire') fire(h.x, h.y, h.r, 0.8);
      else if (Math.random() < 0.25) this.sparks(h.x + (Math.random() - 0.5), h.y + (Math.random() - 0.5), 0.1, 5, 0.5, 0.75, 1, 3);
    }
    for (const s of spots) if (s.kind === 'stairfire') fire(s.x, s.y, s.r, 1.2);
    for (const l of fs.L.lights) if (l.kind === 'fire' && Math.random() < 0.6) fire(l.x, l.y, 0.25, 0.4);
  }

  /** Fleeting humanoid silhouette crossing the edge of vision (restrained jump-scare). */
  private spawnShadow(x: number, y: number) {
    if (!this.shadowTex) {
      const c = document.createElement('canvas'); c.width = 64; c.height = 128;
      const g = c.getContext('2d')!;
      g.fillStyle = 'rgba(0,0,0,0.92)';
      g.beginPath(); g.ellipse(32, 20, 11, 13, 0, 0, 6.28); g.fill();
      g.beginPath(); g.moveTo(14, 38); g.lineTo(50, 38); g.lineTo(56, 90); g.lineTo(44, 128); g.lineTo(20, 128); g.lineTo(8, 90); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,30,20,0.9)'; g.fillRect(24, 18, 5, 2); g.fillRect(36, 18, 5, 2);
      this.shadowTex = new THREE.CanvasTexture(c);
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0 }));
    s.scale.set(0.9, 1.9, 1);
    s.position.set(x, 0.95, y);
    const a = Math.random() * 6.28;
    this.group.add(s);
    this.shadows.push({ s, vx: Math.cos(a) * 7, vy: Math.sin(a) * 7, t: 0 });
  }

  update(dt: number) {
    for (const sh of this.shadows) {
      sh.t += dt;
      sh.s.position.x += sh.vx * dt; sh.s.position.z += sh.vy * dt;
      (sh.s.material as THREE.SpriteMaterial).opacity = Math.sin(Math.min(1, sh.t / 0.7) * Math.PI) * 0.85;
      if (sh.t > 0.7) { this.group.remove(sh.s); sh.s.material.dispose(); }
    }
    this.shadows = this.shadows.filter((sh) => sh.t <= 0.7);
    this.add.update(dt);
    this.norm.update(dt);
    for (let i = 0; i < MAX_TRACERS; i++) {
      if (this.tracerLife[i] > 0) {
        this.tracerLife[i] -= dt;
        if (this.tracerLife[i] <= 0) for (let k = 0; k < 6; k++) this.tracerCol[i * 6 + k] = 0;
      }
    }
    (this.tracerGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.tracerGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    for (const f of this.flashes) f.t += dt;
    this.flashes = this.flashes.filter((f) => f.t < f.dur);
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }
}
