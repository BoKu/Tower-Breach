import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { SSRPass } from './ssr';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FloorView, prefetchKit, type ViewCtx } from './floorView';
import { BuildingPlan } from '../gen/building';
import { buildGun, OperatorRig } from './operator';
import { Pigeon, Rat } from './critters';
import { armoryArt } from './armoryArt';
import { generateFloor, FW, FH, type FloorLayout } from '../gen/floor';
import { enemyRig } from './entities';
import { FINAL_FLOOR, type Difficulty } from '../config/difficulty';
import { Entities } from './entities';
import { FX } from './fx';
import { cutUniforms } from './cutaway';
import { beamMaterial } from './beam';
import { Ambient, AmbientSound, ambientWarmTasks } from './ambient';
import { Roaches } from './roaches';
import { Showcase } from './sandbox';
import { screenAim, AimTarget, aimRay, BodyTarget } from './aim';
import { enemyExtent } from '../sim/combat';
import { ENEMY_STATS } from '../sim/stats';
import { stairElevation } from '../sim/stairs';
import { lightLevel, lightOut } from '../sim/lights';
import { dist, clamp } from '../core/math';
import { weapon } from '../config/weapons';
import type { ViewSource } from './view';
import { currentHoliday } from '../config/holiday';
import { Snowfall } from './christmas';
import { Petals } from './easter';
import { perfBegin, perfTime, perfWatchGL, perfIdle } from '../core/perf';
import type { SimEvent, PlayerState } from '../sim/state';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export const QUALITY: Record<Quality, { ratio: number; lights: number; bloom: boolean; shadows: boolean; aa: boolean }> = {
  low: { ratio: 0.75, lights: 4, bloom: false, shadows: false, aa: false },
  medium: { ratio: 1, lights: 6, bloom: true, shadows: false, aa: false },
  high: { ratio: 1.5, lights: 8, bloom: true, shadows: true, aa: true },
  ultra: { ratio: 2, lights: 10, bloom: true, shadows: true, aa: true },
};

const CAM_OFFSET = new THREE.Vector3(12, 22, 12);

export class GameRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private floorView: FloorView | null = null;
  private ambient: Ambient | null = null;
  private roaches: Roaches | null = null;
  private showcase: Showcase | null = null;
  /** sandbox exhibits animate (remembered across visits) */
  showcaseAnim = true;
  setShowcaseAnim(on: boolean) { this.showcaseAnim = on; this.showcase?.setPaused(!on); }
  private floorKey = '';
  entities = new Entities();
  fx = new FX();
  private pool: THREE.PointLight[] = [];
  private flashLights: THREE.PointLight[] = [];
  private torches: { spot: THREE.SpotLight; beam: THREE.Mesh }[] = [];
  private hemi = new THREE.HemisphereLight(0x8a96a8, 0x1a1a1c, 0.5);
  private moon = new THREE.DirectionalLight(0x6070a8, 0);
  private presence = new THREE.PointLight(0xc8d0ff, 0.6, 4, 1.5);
  private camTarget = new THREE.Vector3(32, 0, 40);
  /** Christmas street snowfall (built on first use) */
  private snowfall: Snowfall | null = null;
  /** Easter street petals (built on first use) */
  private petals: Petals | null = null;
  zoom = 1;
  /** virtual ceiling-lamp height; strength is scaled to keep floor illuminance equal to a 2.3 m lamp (decay 1.6) */
  lampY = 3.4;
  private aimMark: THREE.Mesh;
  private laser: THREE.Mesh;
  quality: Quality;
  reflections: 'off' | 'mirrors' | 'raytraced' = 'mirrors';
  /** mouse snap radius in px at 1080p (0 = exact aim) */
  mouseAssistPx = 40;
  private reflectors: Reflector[] = [];
  private raycaster = new THREE.Raycaster();

  constructor(private canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    const q = QUALITY[quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.aa, powerPreference: 'high-performance' });
    perfWatchGL(this.renderer.getContext(), () => this.renderer.info.programs ?? []);
    this.renderer.setClearColor(0x030405);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 200);
    this.scene.fog = new THREE.FogExp2(0x040506, 0.012);
    this.scene.add(this.hemi, this.moon, this.moon.target, this.presence, this.entities.group, this.fx.group);
    for (let i = 0; i < 10; i++) { const l = new THREE.PointLight(0xffffff, 0, 8, 1.6); this.pool.push(l); this.scene.add(l); }
    for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xffc070, 0, 8, 2); this.flashLights.push(l); this.scene.add(l); }
    for (let i = 0; i < 5; i++) {
      const spot = new THREE.SpotLight(0xfff2dc, 0, 16, 0.42, 0.45, 1.2);
      this.scene.add(spot, spot.target);
      const bg = new THREE.ConeGeometry(Math.tan(0.4) * 9, 9, 18, 1, true);
      bg.translate(0, -4.5, 0); bg.rotateX(-Math.PI / 2);
      const beam = new THREE.Mesh(bg, beamMaterial(0xfff2d0, 0.12));
      beam.renderOrder = 6;
      this.scene.add(beam);
      this.torches.push({ spot, beam });
    }
    // 3D aim indicator: diamond on the aimed surface + laser from the muzzle while aiming
    this.aimMark = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.11, 4), new THREE.MeshBasicMaterial({ color: 0x5fe3ff, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false }));
    this.aimMark.renderOrder = 20;
    const lg = new THREE.CylinderGeometry(0.008, 0.008, 1, 6); lg.translate(0, 0.5, 0); lg.rotateX(Math.PI / 2);
    this.laser = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: 0x3dffb0, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.aimMark, this.laser);
    this.applyQuality();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality) { this.quality = q; this.applyQuality(); this.resize(); }
  setReflections(m: 'off' | 'mirrors' | 'raytraced') { this.reflections = m; this.applyQuality(); this.resize(); }

  private applyQuality() {
    const q = QUALITY[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.ratio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.torches[0].spot.castShadow = q.shadows;
    this.torches[0].spot.shadow.mapSize.set(1024, 1024);
    this.torches[0].spot.shadow.bias = -0.002;
    const sc = this.moon.shadow.camera as THREE.OrthographicCamera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 120;
    this.moon.shadow.mapSize.set(2048, 2048);
    this.moon.shadow.bias = -0.0008;
    this.pool.forEach((l, i) => (l.visible = i < q.lights));
    const rt = this.reflections === 'raytraced';
    this.composer?.dispose();
    if (q.bloom || rt) {
      // the ray-traced pass reads scene depth, so the composer's buffers carry a depth texture
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const target = new THREE.WebGLRenderTarget(size.x, size.y, rt ? { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(size.x, size.y) } : { type: THREE.HalfFloatType });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      if (rt) this.composer.addPass(new SSRPass(this.camera));
      this.bloom = q.bloom ? new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.45, 1.0) : null;
      if (this.bloom) this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    } else { this.composer = null; this.bloom = null; }
    // force shader recompile for shadow toggles
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true)); });
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.bloom?.setSize(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Mouse (NDC) -> world aim point: the enemy / camera / breaker panel under the cursor if any,
   * otherwise the floor point under the cursor.
   */
  groundPoint(ndcX: number, ndcY: number, view?: ViewSource, localId?: number): { x: number; y: number; h: number } {
    const focus = view && localId !== undefined ? this.focusPlayer(view, localId) : undefined;
    if (!view || !focus) {
      const r = screenAim(this.camera, ndcX, ndcY, [], this.canvas.clientWidth || window.innerWidth, this.canvas.clientHeight || window.innerHeight);
      return Number.isNaN(r.x) ? { x: this.camTarget.x, y: this.camTarget.z, h: NaN } : r;
    }
    const fs = view.floorState(focus.floor);
    const bodies: BodyTarget[] = [];
    const snaps: AimTarget[] = [];
    for (const e of fs.enemies) {
      if (e.state === 'dead' || !this.entities.isVisible(e.id)) continue;
      const g = stairElevation(fs.L, e.x, e.y), [lo, hi] = enemyExtent(e);
      bodies.push({ x: e.x, y: e.y, r: ENEMY_STATS[e.type].radius + 0.05, bottom: g + lo, top: g + hi });
      snaps.push({ x: e.x, y: e.y, h: g + hi, aimH: g + (lo + hi) * 0.6 });
    }
    for (const c of fs.cameras) if (c.alive) { bodies.push({ x: c.x, y: c.y, r: 0.3, bottom: 2.05, top: 2.75 }); snaps.push({ x: c.x, y: c.y, h: 2.4, aimH: 2.4 }); }
    for (const pn of fs.panels) if (!pn.dead) { bodies.push({ x: pn.x, y: pn.y, r: 0.6, bottom: 0.2, top: 1.8 }); snaps.push({ x: pn.x, y: pn.y, h: 1.6, aimH: 1.1 }); }
    const cut = { px: focus.x, py: focus.y, dx: cutUniforms.uCamDir.value.x, dy: cutUniforms.uCamDir.value.y };
    const hit = aimRay(this.camera, ndcX, ndcY, fs.L, bodies, cut);
    // small or distant targets: a near miss on screen still counts as aiming at them
    const vh = this.canvas.clientHeight || window.innerHeight;
    const snap = screenAim(this.camera, ndcX, ndcY, snaps, this.canvas.clientWidth || window.innerWidth, vh, this.mouseAssistPx * (vh / 1080));
    const onBody = !!hit && bodies.some((b) => Math.hypot(b.x - hit.x, b.y - hit.y) < b.r + 0.05);
    if (snap.snapped && !onBody) return snap;
    // ceiling lights are the last resort, so a lamp never steals aim from an enemy standing under it
    if (!onBody) {
      const lamps: BodyTarget[] = [];
      fs.L.lights.forEach((l, i) => { if ((l.kind === 'ceiling' || l.kind === 'emergency') && !fs.lights[i]?.broken && !fs.lights[i]?.cut) lamps.push({ x: l.x, y: l.y, r: 0.45, bottom: 2.4, top: 2.6 }); });
      const lh = lamps.length ? aimRay(this.camera, ndcX, ndcY, fs.L, lamps, cut) : null;
      if (lh && lamps.some((b) => Math.hypot(b.x - lh.x, b.y - lh.y) < b.r + 0.05)) return lh;
    }
    return hit ?? { x: this.camTarget.x, y: this.camTarget.z, h: NaN };
  }

  worldToScreen(x: number, y: number, z: number): { x: number; y: number; on: boolean } {
    const v = new THREE.Vector3(x, z, y).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * this.canvas.clientHeight, on: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 };
  }

  /** Returns the player the camera follows (local, or a living teammate when spectating). */
  focusPlayer(view: ViewSource, localId: number): PlayerState | undefined {
    const me = view.players.find((p) => p.id === localId);
    if (me && me.life !== 'out') return me;
    return view.players.find((p) => p.life === 'alive') ?? me;
  }

  update(view: ViewSource, localId: number, dt: number, events: SimEvent[]) {
    const focus = this.focusPlayer(view, localId);
    if (!focus) return;
    const key = `${view.cfg.seed}:${focus.floor}`;
    const switched = key !== this.floorKey;
    const retired: FloorView[] = [];
    if (switched) perfBegin(this.floorKey ? `${this.floorKey.split(':')[1]} -> ${focus.floor}` : `load -> ${focus.floor} (page ${Math.round(performance.now())} ms)`);
    const fs = switched ? perfTime('floorState', () => view.floorState(focus.floor)) : view.floorState(focus.floor);
    if (switched) {
      if (this.floorView) this.scene.remove(this.floorView.group);
      this.floorView = perfTime('view', () => this.viewFor(ctxOf(view), key, fs.L, retired, true));
      this.floorView.warmed = true; // drawn for real from now on
      this.scene.add(this.floorView.group);
      perfTime('ambient + roaches', () => {
        // street life is kept for the run (walking back out to the cordon rebuilds nothing)
        if (this.ambient) { this.scene.remove(this.ambient.group); this.park(this.ambient, this.ambientKey); this.ambient = null; }
        if (fs.L.ambient.length) {
          const akey = `${key}:${view.cfg.mode === 'single'}`;
          this.ambient = this.parkedKey === akey ? this.unpark() : new Ambient(fs.L, view.cfg.mode === 'single');
          this.ambientKey = akey;
          this.scene.add(this.ambient.group);
        }
        if (this.roaches) this.scene.remove(this.roaches.group); // rigs share module-level geometry: nothing to dispose
        this.roaches = new Roaches(fs.L);
        this.scene.add(this.roaches.group);
      });
      if (this.showcase) { this.scene.remove(this.showcase.group); this.showcase.dispose(); this.showcase = null; }
      if (fs.L.theme === 'sandbox') { this.showcase = new Showcase(fs.L); this.scene.add(this.showcase.group); this.showcase.update(0); this.showcase.setPaused(!this.showcaseAnim); }
      this.floorKey = key;
      this.fx.clear();
      this.entities.reset();
      this.camTarget.set(focus.x, 0, focus.y);
      this.ahead.reset(view, focus.floor);
    }
    for (const ev of events) this.fx.onEvent(ev, focus.floor, localId);
    this.floorView!.update(fs, view.t, dt);
    perfTime(switched ? 'entities (1st)' : '', () => this.entities.update(view, localId, fs, dt, events));
    {
      const people = view.players.filter((p) => p.floor === fs.floor && p.life === 'alive' && p.connected).map((p) => ({ x: p.x, y: p.y }));
      const bangs: { x: number; y: number }[] = [];
      for (const ev of events) if ((ev.e === 'shot' || ev.e === 'explode') && ev.f === fs.floor) bangs.push({ x: ev.x, y: ev.y });
      this.ambient?.update(view.t, dt, people, bangs, fs.npcHold, fs.npcTalk);
      this.roaches!.update(view.t, dt, { x: this.camTarget.x, y: this.camTarget.z }, people, bangs);
    }
    this.showcase?.update(dt);
    // live mirrors: a small pool of Reflectors follows the nearest mirror planes (each one re-renders the scene)
    const pool = this.reflections === 'off' ? 0 : this.reflections === 'raytraced' ? 4 : 2;
    const near = this.floorView!.mirrors.map((m) => ({ m, d: (m.pos.x - focus.x) ** 2 + (m.pos.z - focus.y) ** 2 })).filter((o) => o.d < 144).sort((a, b) => a.d - b.d).slice(0, pool);
    while (this.reflectors.length < near.length) {
      const r = new Reflector(new THREE.PlaneGeometry(1, 1), { textureWidth: 512, textureHeight: 512, clipBias: 0.003, color: 0xf4f7fa });
      this.scene.add(r);
      this.reflectors.push(r);
    }
    this.reflectors.forEach((r, i) => {
      const o = near[i];
      r.visible = !!o;
      if (o) { r.position.copy(o.m.pos).addScaledVector(o.m.normal, 0.003); r.quaternion.copy(o.m.quat); r.scale.set(o.m.w, o.m.h, 1); }
    });
    this.fx.ambient(fs, this.floorView!.fireSpots, dt);
    this.fx.update(dt);
    // ---- camera
    const wi = focus.sel === 'knife' ? null : focus.weapons[focus.sel];
    const look = focus.aiming && wi ? weapon(wi.id).lookAhead : 1.8;
    const ax = focus.aimX - focus.x, ay = focus.aimY - focus.y;
    const al = Math.hypot(ax, ay) || 1;
    const la = Math.min(al * 0.35, look);
    const tx = focus.x + (ax / al) * la, ty = focus.y + (ay / al) * la;
    const k = 1 - Math.exp(-dt * 6);
    this.camTarget.x += (tx - this.camTarget.x) * k;
    this.camTarget.z += (ty - this.camTarget.z) * k;
    const off = CAM_OFFSET.clone().multiplyScalar(this.zoom * (focus.aiming && wi && weapon(wi.id).lookAhead > 6 ? 1.15 : 1));
    const sh = this.fx.shake;
    this.camera.position.set(this.camTarget.x + off.x + (Math.random() - 0.5) * sh, off.y + (Math.random() - 0.5) * sh, this.camTarget.z + off.z + (Math.random() - 0.5) * sh);
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z);
    cutUniforms.uPlayer.value.set(focus.x, 0, focus.y);
    cutUniforms.uCamDir.value.set(off.x, off.z).normalize();
    // ---- ambient light: darkness progression (floor 20+ dims up to 50%)
    const dark = fs.L.darkness;
    const fog = this.scene.fog as THREE.FogExp2;
    const night = fs.floor === 0 && currentHoliday() === 'halloween';
    const snowy = fs.floor === 0 && currentHoliday() === 'xmas';
    if (snowy && !this.snowfall) { this.snowfall = new Snowfall(); this.scene.add(this.snowfall.points); }
    if (this.snowfall) {
      this.snowfall.points.visible = snowy;
      if (snowy) this.snowfall.update(dt, this.camTarget, this.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)));
    }
    const spring = fs.floor === 0 && currentHoliday() === 'easter';
    if (spring && !this.petals) { this.petals = new Petals(); this.scene.add(this.petals.points); }
    if (this.petals) {
      this.petals.points.visible = spring;
      if (spring) this.petals.update(dt, this.camTarget, this.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)));
    }
    if (spring) {
      // Easter street: bright, warm spring sunshine under a clear pale sky
      this.hemi.color.setHex(0xe4eefc); this.hemi.groundColor.setHex(0x6a5038);
      this.hemi.intensity = 1.8;
      this.moon.color.setHex(0xfff0d6);
      this.moon.intensity = 2.4;
      this.moon.position.set(focus.x + 18, 40, focus.y + 26); this.moon.target.position.set(focus.x, 0, focus.y);
      this.moon.castShadow = QUALITY[this.quality].shadows;
      this.renderer.setClearColor(0xb8d6ee);
      fog.color.setHex(0xb8d6ee); fog.density = 0.005;
      if (this.bloom) this.bloom.threshold = 0.97;
    } else if (snowy) {
      // Christmas street: soft, cold overcast winter daylight over the snow
      this.hemi.color.setHex(0xd8e2ee); this.hemi.groundColor.setHex(0x8a929e);
      this.hemi.intensity = 1.5;
      this.moon.color.setHex(0xe6ecf8);
      this.moon.intensity = 1.5;
      this.moon.position.set(focus.x + 18, 40, focus.y + 26); this.moon.target.position.set(focus.x, 0, focus.y);
      this.moon.castShadow = QUALITY[this.quality].shadows;
      this.renderer.setClearColor(0xb4c0cc);
      fog.color.setHex(0xb4c0cc); fog.density = 0.009;
      if (this.bloom) this.bloom.threshold = 0.97;
    } else if (night) {
      // Halloween street: cold moonlit night; streetlights, strobes and jack-o'-lanterns carry the scene
      this.hemi.color.setHex(0x40507a); this.hemi.groundColor.setHex(0x0c0c12);
      this.hemi.intensity = 0.95;
      this.moon.color.setHex(0xa8bcff);
      this.moon.intensity = 1.4;
      this.moon.position.set(focus.x - 22, 40, focus.y + 14); this.moon.target.position.set(focus.x, 0, focus.y);
      this.moon.castShadow = QUALITY[this.quality].shadows;
      this.renderer.setClearColor(0x070a14);
      fog.color.setHex(0x0a0e1a); fog.density = 0.012;
      if (this.bloom) this.bloom.threshold = 1.0;
    } else if (fs.floor <= 0) {
      // street level (and the dev sandbox): overcast daylight at the police cordon (the safe zone)
      this.hemi.color.setHex(0xd6e2f0); this.hemi.groundColor.setHex(0x5a564e);
      this.hemi.intensity = 2.1;
      this.moon.color.setHex(0xfff1dc);
      this.moon.intensity = 2.6;
      this.moon.position.set(focus.x + 18, 40, focus.y + 26); this.moon.target.position.set(focus.x, 0, focus.y);
      this.moon.castShadow = QUALITY[this.quality].shadows;
      this.renderer.setClearColor(0x9aabb8);
      fog.color.setHex(0x9aabb8); fog.density = 0.006;
      if (this.bloom) this.bloom.threshold = 0.97; // daylight: only true emitters glow
    } else {
      this.hemi.color.setHex(0x8a96a8); this.hemi.groundColor.setHex(0x1a1a1c);
      this.hemi.intensity = 0.75 * (1 - dark) + 0.02;
      this.moon.intensity = 0;
      this.moon.castShadow = false;
      this.renderer.setClearColor(0x030405);
      fog.color.setHex(0x040506); fog.density = 0.01 + dark * 0.03;
      if (this.bloom) this.bloom.threshold = 1.0; // lamp-lit white surfaces (tables, sinks) must not glow; emitters (>1) still do
    }
    this.presence.position.set(focus.x, 1.6, focus.y);
    this.presence.intensity = focus.life === 'alive' ? 0.5 : 0.2;
    // ---- lamp light pool: nearest/brightest lamps get real lights
    const L = fs.L;
    const cand: { i: number; s: number; lv: number }[] = [];
    for (let i = 0; i < L.lights.length; i++) {
      const l = L.lights[i];
      if (l.kind === 'street' && !night) continue; // floodlight towers only shine at night
      const d = dist(l.x, l.y, this.camTarget.x, this.camTarget.z);
      if (d > 24) continue;
      const lv = lightLevel(l, lightOut(fs.lights[i], l), view.t);
      if (lv < 0.04) continue;
      cand.push({ i, s: (l.intensity * lv) / (1 + (d * d) / 80), lv });
    }
    cand.sort((a, b) => b.s - a.s);
    const n = QUALITY[this.quality].lights;
    for (let k2 = 0; k2 < n; k2++) {
      const pl = this.pool[k2];
      const c = cand[k2];
      if (!c) { pl.intensity = 0; continue; }
      const l = L.lights[c.i];
      pl.color.setHex(l.color);
      // ceiling lamps: the light sits above the fixture (virtual 3.4 m, strength raised to keep floor brightness
      // the same) so table tops and tall props directly underneath aren't blown out by a source 1.5 m away
      const lamp = l.kind === 'ceiling' || l.kind === 'emergency';
      pl.position.set(l.x, l.kind === 'fire' ? 0.9 : l.kind === 'street' ? 4.6 : l.kind === 'police' ? (l.z ?? 1.5) + 0.35 : this.lampY, l.y);
      pl.distance = l.range * 1.35 + (lamp ? 1.5 : 0);
      pl.intensity = c.lv * l.intensity * (l.kind === 'street' ? 30 : l.kind === 'police' ? (fs.floor === 0 ? 4 : 12) : 11 * Math.pow(this.lampY / 2.3, 1.6));
    }
    // ---- muzzle / explosion flashes
    const fl = this.fx.flashes.slice(-2);
    this.flashLights.forEach((l, i) => {
      const f = fl[i];
      if (!f) { l.intensity = 0; return; }
      l.position.set(f.x, f.z, f.y);
      l.color.setHex(f.color);
      l.distance = f.range;
      l.intensity = f.intensity * (1 - f.t / f.dur);
    });
    // ---- torches (gun lights) for everyone on this floor
    const lit = view.players.filter((p) => p.floor === focus.floor && p.life === 'alive' && p.connected && p.torchOn);
    lit.sort((a, b) => (a.id === localId ? -1 : b.id === localId ? 1 : 0));
    this.torches.forEach((tch, i) => {
      const p = lit[i];
      if (!p) { tch.spot.intensity = 0; tch.beam.visible = false; return; }
      const mod = p.mods.torchmod;
      const bat = p.battery < 0.15 ? 0.45 + Math.sin(view.t * 30 + p.id) * 0.25 : 1;
      const cx = Math.cos(p.facing), cy = Math.sin(p.facing);
      tch.spot.position.set(p.x + cx * 0.5, 1.3 + p.z, p.y + cy * 0.5);
      tch.spot.target.position.set(p.x + cx * 8, 0.3, p.y + cy * 8);
      tch.spot.angle = mod ? 0.52 : 0.42;
      tch.spot.distance = mod ? 20 : 16;
      tch.spot.intensity = (mod ? 95 : 70) * bat;
      tch.beam.visible = true;
      tch.beam.position.copy(tch.spot.position);
      tch.beam.lookAt(tch.spot.target.position);
      (tch.beam.material as any).uniforms.uOpacity.value = (0.05 + 0.12 * dark) * bat;
    });
    // ---- 3D aim indicator for the local player (mouse aim only)
    const me = view.players.find((p) => p.id === localId);
    const showAim = !!me && me.life === 'alive' && me.floor === focus.floor && Number.isFinite(me.aimZ);
    this.aimMark.visible = showAim;
    this.laser.visible = showAim && !!me && me.aiming && me.sel !== 'knife';
    if (showAim && me) {
      const hz = me.aimZ;
      this.aimMark.position.set(me.aimX, hz + 0.02, me.aimY);
      this.aimMark.quaternion.copy(this.camera.quaternion); // face the camera so it reads on walls and floors alike
      (this.aimMark.material as THREE.MeshBasicMaterial).color.setHex(fs.enemies.some((e) => e.state !== 'dead' && Math.hypot(e.x - me.aimX, e.y - me.aimY) < 0.5) ? 0xff5a5a : 0x5fe3ff);
      if (this.laser.visible) {
        const g = stairElevation(fs.L, me.x, me.y);
        const from = new THREE.Vector3(me.x + Math.cos(me.facing) * 0.5, (me.crouch ? 0.9 : 1.25) + me.z + g, me.y + Math.sin(me.facing) * 0.5);
        const to = new THREE.Vector3(me.aimX, hz, me.aimY);
        this.laser.position.copy(from);
        this.laser.lookAt(to);
        this.laser.scale.set(1, 1, from.distanceTo(to));
      }
    }
    perfTime(switched ? 'render (1st, shaders)' : '', () => { if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera); });
    // retired views are disposed only after the new floor has rendered: their materials keep the shader programs
    // alive (three releases a program with its last material, and the new floor would have to relink it)
    for (const v of retired) v.dispose();
    this.ahead.step(view, focus);
  }

  /**
   * Built floor views by `${seed}:${floor}`: the current floor, the last few visited (stairs back down are instant)
   * and the ones built ahead of time (see Ahead). A view is reused only for the very same layout object and while its
   * baked-in stair/lift dressing is current.
   */
  readonly views = new Map<string, FloorView>();
  private static VIEWS = 5;
  private ahead = new Ahead(this);
  /** street Ambient parked while inside the tower (or built ahead in the menus), by `${seed}:${floor}:${solo}` */
  private ambientKey = '';
  private parkedAmbient: Ambient | null = null;
  private parkedKey = '';
  private park(a: Ambient, key: string) { if (this.parkedAmbient !== a) this.parkedAmbient?.dispose(); this.parkedAmbient = a; this.parkedKey = key; }
  private unpark() { const a = this.parkedAmbient!; this.parkedAmbient = null; this.parkedKey = ''; return a; }
  /** Menus: build a street's single-player life ahead and draw it once off-screen (its rigs go up to the GPU). */
  prepareStreet(key: string, L: FloorLayout) {
    const akey = `${key}:true`;
    if (this.parkedKey !== akey) this.park(new Ambient(L, true), akey);
    this.drawOffscreen(this.parkedAmbient!.group, true);
  }

  viewFor(ctx: ViewCtx, key: string, L: FloorLayout, retired: FloorView[], entering = false): FloorView {
    let v = this.views.get(key);
    this.views.delete(key);
    if (v) v.ctx = ctx;
    if (v && (v.L !== L || v.stale())) { retired.push(v); v = undefined; }
    v ??= new FloorView(L, ctx);
    this.views.set(key, v); // most recently used last
    const seed = key.split(':')[0];
    // evict the least recently used; the street view stays for the run (it is the most expensive to build). Views of
    // other towers go once a game shows this one (menus warm several: a new run's and the saved run's)
    for (const [k, o] of this.views) {
      const other = entering && k.split(':')[0] !== seed;
      if (o === v || o === this.floorView || (!other && (this.views.size <= GameRenderer.VIEWS || k.endsWith(':0')))) continue;
      this.views.delete(k);
      retired.push(o);
    }
    return v;
  }
  /** Menus: start the warm-up (see Ahead.warmup); idle() runs it a task per frame while no game is on. */
  warmup(runs: { seed: number; difficulty: Difficulty; floors: number[] }[]) { this.ahead.warmup(runs); }
  idle() { this.ahead.step(); }
  /** Warm a floor view's shader programs off-screen, lit as it will be (only the street casts sun shadows). */
  warmShaders(v: FloorView): Promise<unknown> { return this.compileFor(v.group, v.L.floor <= 0); }
  /** Compile `o`'s programs off-screen, lit as on the street (sun shadows) or inside the tower. */
  compileFor(o: THREE.Object3D, street: boolean): Promise<unknown> {
    const sun = this.moon.castShadow;
    this.moon.castShadow = street && QUALITY[this.quality].shadows;
    // the scene renders into the composer's buffers (linear, no tone mapping), which changes the programs
    this.renderer.setRenderTarget(this.composer?.writeBuffer ?? null);
    const done = this.renderer.compileAsync(o, this.camera, this.scene).catch(() => { /* context lost: the frame compiles it */ });
    this.renderer.setRenderTarget(null);
    this.moon.castShadow = sun;
    return done;
  }
  private warmCam = new THREE.OrthographicCamera(-FW / 2 - 2, FW / 2 + 2, FH / 2 + 2, -FH / 2 - 2, 1, 80);
  private warmRT: THREE.WebGLRenderTarget | null = null;
  /**
   * Draw part of a built-ahead view (top-level children from `from`, a few per call) off-screen: its geometry goes up
   * to the GPU and the programs compile() can't reach (shadow passes) get linked before the floor is entered.
   * Returns where to continue, or -1 when done.
   */
  prerender(key: string, from: number): number {
    const v = this.views.get(key);
    if (!v || v === this.floorView) return -1;
    const kids = v.group.children, to = Math.min(kids.length, from + (v.L.floor === 0 ? 3 : 8)); // street props are heavy
    const vis = kids.map((c) => c.visible);
    kids.forEach((c, i) => (c.visible = vis[i] && i >= from && i < to));
    this.drawOffscreen(v.group, v.L.floor <= 0);
    kids.forEach((c, i) => (c.visible = vis[i]));
    if (to < kids.length) return to;
    v.warmed = true;
    return -1;
  }
  /** Menus only: run the composer once over an empty scene (the canvas just clears) to link the post-processing. */
  warmPost() {
    if (!this.composer) return;
    const hidden = this.scene.children.filter((c) => c.visible);
    for (const c of hidden) c.visible = false;
    this.composer.render();
    for (const c of hidden) c.visible = true;
  }
  /**
   * Render `o` alone (scene lights kept, everything else hidden) into a tiny target, the whole floor from above, lit
   * as on the street or inside. Only with the composer: without it the real frame renders straight to the canvas,
   * with other programs, so there is nothing to warm this way.
   */
  drawOffscreen(o: THREE.Object3D, street: boolean) {
    if (!this.composer) return;
    this.warmRT ??= new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType });
    this.warmCam.position.set(FW / 2, 40, FH / 2);
    this.warmCam.lookAt(FW / 2, 0, FH / 2);
    const hidden = this.scene.children.filter((c) => c.visible && !(c as THREE.Light).isLight);
    for (const c of hidden) c.visible = false;
    const sun = this.moon.castShadow, parent = o.parent, spot = this.torches[0].spot;
    // aim the sun and the shadow-casting torch at the floor so the shadow passes draw (and link) it too
    const keep = [this.moon.position, this.moon.target.position, spot.position, spot.target.position].map((p) => p.clone());
    this.moon.position.set(FW / 2 + 18, 40, FH / 2 + 26); this.moon.target.position.set(FW / 2, 0, FH / 2);
    spot.position.set(FW / 2, 3, FH / 2); spot.target.position.set(FW / 2 + 8, 0.3, FH / 2);
    this.moon.castShadow = street && QUALITY[this.quality].shadows;
    this.scene.add(o);
    this.renderer.setRenderTarget(this.warmRT);
    this.renderer.render(this.scene, this.warmCam);
    this.renderer.setRenderTarget(null);
    this.scene.remove(o);
    parent?.add(o);
    this.moon.castShadow = sun;
    [this.moon.position, this.moon.target.position, spot.position, spot.target.position].forEach((p, i) => p.copy(keep[i]));
    for (const c of hidden) c.visible = true;
  }

  drainAmbientSounds(): AmbientSound[] { return this.ambient ? this.ambient.drainSounds() : []; }

  setZoom(z: number) { this.zoom = clamp(z, 0.3, 1.4); } // 0.3 = closest (was 0.7)
}

/**
 * Idle-time work ahead of a floor change, one small task per frame: generate the floors right above and below (or a
 * riding lift's destination), build their new prop kits and enemy rig looks, then their whole views with shaders
 * warmed. Entering one of those is then a lookup.
 */
class Ahead {
  private tasks: (() => void)[] = [];
  private wait = 0;
  private ride = NaN;
  constructor(private r: GameRenderer) {}

  reset(view: ViewSource, floor: number) {
    this.ride = NaN;
    this.wait = 30; // let the new floor settle first
    // stairs reach the floors either side; a lift ride (2.4 s) builds its destination while the doors are shut
    this.tasks = floor < 0 ? [] : this.floors(view.plan, ctxOf(view), view.cfg.seed, [floor + 1, floor - 1], [floor + 1, floor - 1]);
  }

  /**
   * Before any game (menus): build every enemy look, gun and street character, and the views of the floors a run
   * would start on (`runs`: the next new run's street and first floor, the saved run's floor) with shaders compiled,
   * so a run starts without building or compiling. Another difficulty or a co-op game builds its own views (the
   * shader programs carry over); a view whose stair dressing went out of date is rebuilt on entry.
   */
  warmup(runs: { seed: number; difficulty: Difficulty; floors: number[] }[]) {
    const hal = currentHoliday() === 'halloween';
    this.tasks = [];
    // most valuable first, in case the player starts quickly: post-processing (one composer pass over the hidden
    // scene links its programs), the HUD's weapon art (its own little renderer, made on first use), the street's
    // characters, then the runs' floors
    this.tasks.push(task('warm post', () => this.r.warmPost()));
    this.tasks.push(task('warm weapon art', () => armoryArt('p9', true)));
    this.tasks.push(task('warm street', () => { for (const t of ambientWarmTasks(generateFloor(new BuildingPlan(runs[0].seed, 'normal'), 0)).reverse()) this.tasks.unshift(task('warm street look', t)); }));
    for (const { seed, difficulty, floors } of runs) {
      const plan = new BuildingPlan(seed, difficulty), ctx: ViewCtx = { flight: (f, i) => plan.up(f, i), elevatorWorking: (f, j) => plan.elevator(f, j).working };
      this.tasks.push(...this.floors(plan, ctx, seed, floors, floors, true));
    }
    for (const type of ['loyalist', 'cyborg'] as const) for (const elite of [false, true]) for (let id = 0; id < 4; id++) this.tasks.push(task('warm enemy', () => enemyRig({ id, type, elite, weapon: hal ? 'bite' : 'p9' })));
    for (const type of ['dog', 'dogcyborg', 'drone', 'warden'] as const) for (const weapon of ['bite', 'p9']) this.tasks.push(task('warm beast', () => enemyRig({ id: 0, type, elite: false, weapon })));
    for (const k of ['rifle', 'pistol', 'shotgun', 'smg', 'lmg', 'sniper'] as const) this.tasks.push(task('warm gun', () => buildGun(k, true)));
    // characters, gear and effects: every enemy look and one of everything else, compiled lit both ways, then drawn
    // once off-screen so their geometry is on the GPU too (laid out on a grid inside the camera's view)
    const cast = new THREE.Group();
    this.tasks.push(task('warm cast', () => {
      const add = (o: THREE.Object3D) => { const n = cast.children.length; o.position.set(4 + (n % 12) * 4, 0, 4 + Math.floor(n / 12) * 4); cast.add(o); };
      for (const type of ['loyalist', 'cyborg'] as const) for (const elite of [false, true]) for (let id = 0; id < 4; id++) add(enemyRig({ id, type, elite, weapon: hal ? 'bite' : 'p9' }).op!.root);
      for (const type of ['dog', 'dogcyborg', 'drone', 'warden'] as const) for (const weapon of ['bite', 'p9']) add(enemyRig({ id: 0, type, elite: false, weapon }).beast!.root);
      for (const outfit of ['operator', 'police'] as const) { const r = OperatorRig.make(0xf0f0f0, { outfit }); r.setGun('rifle'); add(r.root); }
      add(Pigeon.make(0).root); add(new Rat().root);
      const mirror = new Reflector(new THREE.PlaneGeometry(1, 1), { textureWidth: 512, textureHeight: 512, clipBias: 0.003, color: 0xf4f7fa }); // live mirrors
      add(mirror);
      const tasks = this.tasks;
      void Promise.all([true, false].flatMap((street) => [this.r.compileFor(cast, street), this.r.compileFor(this.r.scene, street)])).then(() => {
        if (this.tasks !== tasks) return;
        tasks.unshift(task('warm cast draw', () => this.r.drawOffscreen(cast, true)), task('warm cast draw', () => { this.r.drawOffscreen(cast, false); mirror.dispose(); }));
      });
    }));
  }

  /** `menus`: also build the street's life ahead (single player) */
  private floors(plan: BuildingPlan, ctx: ViewCtx, seed: number, floors: number[], full: number[], menus = false): (() => void)[] {
    const tasks: (() => void)[] = [];
    for (const f of floors) {
      if (f < 0 || f > FINAL_FLOOR) continue;
      let L: FloorLayout;
      tasks.push(task(`generate ${f}`, () => { L = generateFloor(plan, f); }));
      const kits = task(`kits ${f}`, () => { if (prefetchKit(L)) this.tasks.unshift(kits); });
      tasks.push(kits);
      // one enemy per task (a new look is a 5-15 ms build); ids and weapons as Sim.floorState makes them
      tasks.push(task(`enemy looks ${f}`, () => this.tasks.unshift(...L.spawns.map((s, i) => task(`enemy look ${f}`, () => enemyRig({ id: f * 10000 + i, type: s.type, elite: s.elite, weapon: currentHoliday() === 'halloween' && s.type !== 'dog' && s.type !== 'dogcyborg' ? 'bite' : s.weapon }))))));
      if (f === 0 && menus) tasks.push(task(`street life ${seed}`, () => this.r.prepareStreet(`${seed}:0`, L)));
      if (full.includes(f)) tasks.push(task(`view ${seed}:${f}`, () => {
        const key = `${seed}:${f}`;
        const pre = (from: number) => task(`prerender ${key} ${from}`, () => { const next = this.r.prerender(key, from); if (next >= 0) this.tasks.unshift(pre(next)); });
        const built = this.r.views.get(key);
        if (built) { if (!built.warmed) this.tasks.unshift(pre(0)); return; }
        const out: FloorView[] = [];
        const tasks = this.tasks;
        void this.r.warmShaders(this.r.viewFor(ctx, key, L, out)).then(() => { if (this.tasks === tasks) tasks.unshift(pre(0)); });
        for (const o of out) o.dispose(); // never the one on screen
      }));
    }
    return tasks;
  }

  step(view?: ViewSource, focus?: PlayerState) {
    // riding a lift: its destination jumps the queue
    if (view && focus?.ride && focus.ride.to !== this.ride) { this.ride = focus.ride.to; this.wait = 0; this.tasks = this.floors(view.plan, ctxOf(view), view.cfg.seed, [focus.ride.to], [focus.ride.to]); }
    if (this.wait > 0) { this.wait--; return; }
    const t = this.tasks.shift();
    if (t) perfIdle(t);
  }
}

/** a labelled task (?perf=1 names slow ones) */
const task = (label: string, fn: () => void) => Object.assign(fn, { label });
const ctxOf = (view: ViewSource): ViewCtx => ({ flight: (f, i) => view.flightCondition(f, i), elevatorWorking: (f, j) => view.plan.elevator(f, j).working });
