import { makeScreenMaterial, screenUniforms, reseedScreen } from './screens';
import * as THREE from 'three';
import { FloorLayout, CameraSpec, TrapSpec, VendingSpec, DoorSpec, FW, FH, idx, T_WALL, T_WINDOW, T_DOOR, T_FLOOR, Surface, doorRunsNS } from '../gen/floor';
import type { StairCondition } from '../gen/building';
import { tex } from './textures';
import { applyCutaway } from './cutaway';
import { beamMaterial } from './beam';
import { STREET_KINDS, buildStreetProp, buildRoad, streetTex, buildFacade } from './street';
import { buildProp, newParts, place, merge, Parts, Builder } from './models';
import { christmasSnow } from './christmas';
import { currentHoliday } from '../config/holiday';
import { raycastWalls } from '../sim/nav';
import type { FloorState } from '../sim/state';
import { lightLevel, lightOut, lightSize } from '../sim/lights';
import { buildPosters } from './posters';
import { buildCardFaces, buildDartboard } from './eastereggs';
import { perfTime } from '../core/perf';

export const WALL_H = 2.6;
const ROT_Y = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

const propSolidMat = applyCutaway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide }), 0.95);
/** Stair flights stand up to a storey tall: the cutaway only trims what rises above the top landing (its rails). */
const stairMat = applyCutaway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide }), WALL_H + 0.1);
const emitMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.4, 1.4), vertexColors: true, toneMapped: false }); // >1: lit parts reach the bloom threshold
const screenMat = makeScreenMaterial(0.95);
const mirrorMat = applyCutaway(new THREE.MeshStandardMaterial({ color: 0x9aa4ac, metalness: 0.85, roughness: 0.14 }), 0.95);
const glassMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.6, depthWrite: false });

/** soft radial falloff for floor light pools (shared by every floor) */
let poolMap: THREE.Texture | null = null;
function poolTex(): THREE.Texture {
  if (poolMap) return poolMap;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, '#999'); gr.addColorStop(0.7, '#2a2a2a'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (poolMap = new THREE.CanvasTexture(c));
}

/**
 * Built models, shared by every floor: one merged geometry per material bucket for each prop (kind, footprint,
 * dressing), window and door frame. A floor draws each as one InstancedMesh, so changing floor only builds what it
 * hasn't seen yet and uploads little else (rebuilding ~300 props from primitives took seconds). Screens and mirrors stay
 * per-prop (each screen has its own content seed; mirrors are posed individually). Kit geometry is flagged `shared`
 * so FloorView never disposes it.
 */
interface Kit { solid: THREE.BufferGeometry | null; emit: THREE.BufferGeometry | null; glass: THREE.BufferGeometry | null; screen: THREE.BufferGeometry[]; mirror: THREE.BufferGeometry[]; verts: number }
const kits = new Map<string, Kit>();
let kitVerts = 0;
/** ponytail: whole-kit LRU by vertex count; one-off pipe runs are the bulk. Raise if long runs keep rebuilding kinds. */
const KIT_VERT_BUDGET = 4_000_000;
const live = new Set<FloorView>();
function kitOf(key: string, make: () => Parts): Kit {
  let k = kits.get(key);
  if (k) { kits.delete(key); kits.set(key, k); return k; } // most recently used last
  const parts = make();
  const shared = (g: THREE.BufferGeometry | null) => { if (g) { g.userData.shared = true; g.userData.kit = key; } return g; }; // kit = name, for profiling
  k = { solid: shared(merge(parts.solid)), emit: shared(merge(parts.emit)), glass: shared(merge(parts.glass)), screen: parts.screen, mirror: parts.mirror, verts: 0 };
  k.verts = (k.solid?.attributes.position.count ?? 0) + (k.emit?.attributes.position.count ?? 0) + (k.glass?.attributes.position.count ?? 0);
  kits.set(key, k);
  kitVerts += k.verts;
  return k;
}
const propKey = (kind: string, w: number, h: number, snowy: boolean) => `${kind}|${w}|${h}|${snowy ? 's' : ''}|${currentHoliday() ?? ''}`;
const snowyOf = (L: FloorLayout) => L.floor === 0 && currentHoliday() === 'xmas';
function propKit(kind: string, w: number, h: number, snowy = false): Kit {
  return kitOf(propKey(kind, w, h, snowy), () => {
    const parts = buildProp(kind, w, h);
    if (snowy) christmasSnow(Object.assign(new Builder(), { p: parts }), kind, w - 0.1, h - 0.1); // outdoor props under snow
    return parts;
  });
}
/** Drop the least recently used kits over budget (never one a live floor view uses). */
function trimKits() {
  if (kitVerts <= KIT_VERT_BUDGET) return;
  const keep = new Set<string>([propKey('vending', 1, 1, false)]);
  for (const v of live) for (const k of v.kitKeys) keep.add(k);
  for (const [key, k] of kits) {
    if (kitVerts <= KIT_VERT_BUDGET) break;
    if (keep.has(key)) continue;
    k.solid?.dispose(); k.emit?.dispose(); k.glass?.dispose();
    kits.delete(key);
    kitVerts -= k.verts;
  }
}
/** Props a floor draws from kits (street furniture on the street and in the sandbox has its own builder). */
const isKitProp = (L: FloorLayout, p: FloorLayout['props'][number]) => p.kind !== 'vending' && !((L.floor === 0 || L.theme === 'sandbox') && STREET_KINDS.has(p.kind));
/**
 * Build the prop kits a floor will need, one per call (idle-time prefetch before the floor is entered).
 * Returns false once there is nothing left to build.
 */
export function prefetchKit(L: FloorLayout): boolean {
  const snowy = snowyOf(L);
  const p = L.props.find((q) => isKitProp(L, q) && !kits.has(propKey(q.kind, q.w, q.h, snowy)));
  if (!p) return false;
  propKit(p.kind, p.w, p.h, snowy);
  return true;
}

export interface ViewCtx {
  flight: (f: number, i: number) => StairCondition;
  elevatorWorking: (f: number, j: number) => boolean;
}

interface CamVis { head: THREE.Object3D; beam: THREE.Mesh; beamMat: ReturnType<typeof beamMaterial>; led: THREE.Mesh; dead: boolean }

export class FloorView {
  group = new THREE.Group();
  L: FloorLayout;
  fixtures: THREE.InstancedMesh | null = null;
  /** per-light fixture gain (dim-coloured lamps get more so every lit fixture blooms) and its floor light pool */
  private fixGain: number[] = [];
  private pools: THREE.InstancedMesh | null = null;
  private poolGain: number[] = [];
  private spinners: THREE.Object3D[] = [];
  private cams = new Map<number, CamVis>();
  private traps = new Map<number, THREE.Object3D>();
  private vends = new Map<number, { g: THREE.Group; broken: boolean }>();
  private stairDeco: { index: number; up: THREE.Group | null; cond: StairCondition }[] = [];
  private elevPanels: { mesh: THREE.Mesh; working: boolean; interior: THREE.Mesh }[] = [];
  /** breaker panel status LEDs by panel id: red = lights off, green = on, both dark once shot */
  private panelLeds = new Map<number, { red: THREE.MeshBasicMaterial; green: THREE.MeshBasicMaterial }>();
  private mainframeRing: THREE.Mesh | null = null;
  private fixColor = new THREE.Color();
  private disposables: { dispose(): void }[] = [];
  fireSpots: { x: number; y: number; r: number; kind: 'fire' | 'shock' | 'stairfire' }[] = [];
  private lenses: { mesh: THREE.Mesh; li: number; base: THREE.Color }[] = [];

  /** stair-pit and lift dressing is baked in at build time: a view built ahead of time is stale if they changed */
  private builtSig: string;
  private sig() { const f = this.L.floor; return this.L.stairs.map((s) => (f > 1 ? this.ctx.flight(f - 1, s.index) : '')).join() + this.L.elevators.map((e) => this.ctx.elevatorWorking(f, e.index)).join(); }
  stale() { return this.sig() !== this.builtSig; }

  /** live stair/lift state; a view built ahead of time gets the game's own when it is entered (GameRenderer.viewFor) */
  constructor(L: FloorLayout, public ctx: ViewCtx) {
    this.L = L;
    live.add(this);
    this.builtSig = this.sig();
    perfTime('view: floor', () => this.buildFloor());
    perfTime('view: walls', () => this.buildWalls());
    perfTime('view: props', () => this.buildProps());
    this.buildHackMarkers();
    perfTime('view: stairs', () => this.buildStairs());
    perfTime('view: elevators', () => this.buildElevators());
    this.buildFixtures();
    this.track(buildPosters(L, this.group)); // public/posters, random per floor
    this.track(buildDartboard(L, this.group)); // easter egg: floor 4
    if (L.floor === 0) perfTime('view: street', () => this.buildStreetBackdrop());
    this.buildLightBars();
    // CCTV, traps and vending machines (state-driven in update) are made now too, so a view built ahead of time has
    // them on the GPU and their shaders compiled before the floor is entered
    for (const c of L.cameras) this.makeCam(c);
    for (const t of L.traps) this.makeTrap(t);
    for (const v of L.vendings) this.makeVend(v);
    for (const d of L.doors) this.makeDoor(d);
    trimKits();
  }

  private track<T extends { dispose(): void }>(x: T): T { this.disposables.push(x); return x; }

  private buildFloor() {
    const L = this.L;
    const bySurf = new Map<Surface, { pos: number[]; uv: number[]; col: number[] }>();
    const street = this.L.floor === 0, snow = street && currentHoliday() === 'xmas'; // Christmas: the street is snowed over (one big texture)
    const choc = street && currentHoliday() === 'easter', whole = snow || choc; // Easter: molten chocolate and chocolate slabs (one big texture)
    for (let y = 0; y < FH; y++)
      for (let x = 0; x < FW; x++) {
        const t = L.tiles[idx(x, y)];
        if (t !== T_FLOOR && t !== T_DOOR) continue;
        if (L.stairs.some((s) => x >= s.x1 - 1 && x <= s.x1 && y >= s.y0 && y < s.y1)) continue; // stairwell pit (south row = landing)
        const room = L.rooms[L.roomAt[idx(x, y)]];
        const surf: Surface = room?.surface ?? 'concrete';
        let s = bySurf.get(surf);
        if (!s) bySurf.set(surf, (s = { pos: [], uv: [], col: [] }));
        const q = [[x, y], [x, y + 1], [x + 1, y + 1], [x, y], [x + 1, y + 1], [x + 1, y]];
        const shade = 0.82 + ((room?.id ?? 0) % 5) * 0.045;
        const uvs = L.floor === 0 ? (room?.type === 'plaza' ? 0.25 : 0.125) : 0.5; // street textures cover 4 m / 8 m
        for (const [qx, qy] of q) { s.pos.push(qx, 0, qy); if (whole) s.uv.push(qx / FW, 1 - qy / FH); else s.uv.push(qx * uvs, qy * uvs); s.col.push(L.floor === 0 ? 1 : shade, L.floor === 0 ? 1 : shade, L.floor === 0 ? 1 : shade); }
      }
    const maps: Record<Surface, THREE.Texture> = { carpet: tex.carpet(), tile: tex.tile(), concrete: snow ? streetTex.snowStreet() : choc ? streetTex.chocStreet() : street ? streetTex.pavers() : tex.concrete(), metal: tex.metal(), asphalt: snow ? streetTex.snowStreet() : choc ? streetTex.chocStreet() : street ? streetTex.asphalt() : tex.asphalt() };
    // the snow / chocolate map spans the whole street (world uv), so the fine bump grain gets its own 2 m repeat
    const snowBump = whole ? this.track(Object.assign(streetTex.asphaltBump().clone(), { repeat: new THREE.Vector2(FW / 2, FH / 2), needsUpdate: true })) : null;
    for (const [surf, s] of bySurf) {
      const g = this.track(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(s.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(s.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(s.col, 3));
      g.computeVertexNormals();
      // normals point down for CCW order in xz; flip to up
      const n = g.attributes.normal as THREE.BufferAttribute;
      for (let i = 0; i < n.count; i++) n.setY(i, 1);
      const m = this.track(new THREE.MeshStandardMaterial({ map: maps[surf], vertexColors: true, roughness: surf === 'metal' ? 0.5 : surf === 'tile' ? 0.35 : 0.9, metalness: surf === "metal" ? 0.5 : 0.05 }));
      if (street) { m.bumpMap = snowBump ?? streetTex.asphaltBump(); m.bumpScale = snow ? 0.4 : choc ? 0.2 : surf === 'asphalt' ? 1.4 : 0.6; m.roughness = choc ? (surf === 'asphalt' ? 0.38 : 0.5) : surf === 'asphalt' ? 0.88 : 0.8; }
      const mesh = new THREE.Mesh(g, m);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    // exterior void under the building
    const underMat = this.L.floor === 0
      ? this.track(new THREE.MeshStandardMaterial({ map: (() => { const t = (snow ? streetTex.snow() : choc ? streetTex.chocolate() : streetTex.asphalt()).clone(); t.repeat.set(25, 25); t.needsUpdate = true; return t; })(), roughness: choc ? 0.45 : 0.9 }))
      : this.track(new THREE.MeshBasicMaterial({ color: 0x020203 }));
    const under = new THREE.Mesh(this.track(new THREE.PlaneGeometry(200, 200)), underMat);
    under.rotation.x = -Math.PI / 2;
    under.position.set(FW / 2, this.L.floor === 0 ? -0.02 : -40, FH / 2);
    this.group.add(under);
  }

  private buildWalls() {
    const L = this.L;
    const walls: [number, number][] = [], windows: [number, number, boolean][] = [], facade: [number, number][] = [];
    for (let y = 0; y < FH; y++)
      for (let x = 0; x < FW; x++) {
        const t = L.tiles[idx(x, y)];
        if (t === T_WALL) {
          // skip fully enclosed wall tiles (no neighbour floor): saves instances
          let exposed = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= FW || ny >= FH) continue;
            const nt = L.tiles[idx(nx, ny)];
            if (nt === T_FLOOR || nt === T_DOOR) exposed = true;
          }
          if (L.floor === 0 && y <= 11) { if (exposed || y === 11) facade.push([x, y]); continue; }
          if (exposed) walls.push([x, y]);
        } else if (t === T_WINDOW) windows.push([x, y, !!L.boarded[idx(x, y)]]);
      }
    const wallTex = tex.wall();
    const snow = L.floor === 0 && currentHoliday() === 'xmas'; // Christmas: the street's border walls are snowed over
    const choc = L.floor === 0 && currentHoliday() === 'easter'; // Easter: chocolate-coated
    const side = this.track(applyCutaway(new THREE.MeshStandardMaterial({ map: wallTex, roughness: choc ? 0.5 : 0.9, color: snow ? 0xb8c0ca : choc ? 0x8a5a3a : L.floor === 0 ? 0x6a6a70 : 0xffffff })));
    const top = this.track(applyCutaway(new THREE.MeshStandardMaterial({ color: snow ? 0xe8eef4 : choc ? 0x4a2a16 : 0x151517, roughness: choc ? 0.4 : 1 })));
    const h = L.floor === 0 ? 1.3 : WALL_H;
    const geo = this.track(new THREE.BoxGeometry(1, h, 1));
    geo.translate(0, h / 2, 0);
    const inst = new THREE.InstancedMesh(geo, [side, side, top, top, side, side], Math.max(1, walls.length));
    const m = new THREE.Matrix4();
    walls.forEach(([x, y], i) => { m.makeTranslation(x + 0.5, 0, y + 0.5); inst.setMatrixAt(i, m); });
    inst.count = walls.length;
    inst.castShadow = true; inst.receiveShadow = true;
    this.group.add(inst);
    // caps at the cut height so cut-away walls read as solid stubs
    const capGeo = this.track(new THREE.PlaneGeometry(1, 1));
    capGeo.rotateX(-Math.PI / 2);
    const caps = new THREE.InstancedMesh(capGeo, this.track(new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 1 })), Math.max(1, walls.length));
    walls.forEach(([x, y], i) => { m.makeTranslation(x + 0.5, 0.41, y + 0.5); caps.setMatrixAt(i, m); });
    caps.count = walls.length;
    this.group.add(caps);
    if (facade.length) { const f = buildFacade(applyCutaway); this.group.add(f); f.traverse((c) => { if (c.userData.spin) this.spinners.push(c); }); }
    // windows: sill + glass/boards + lintel
    for (const [x, y, boarded] of windows) {
      const vertical = x === 0 || x === FW - 1;
      this.placeKit(`win|${vertical}|${boarded}`, kitOf(`win|${vertical}|${boarded}`, () => {
        const b = new Builder();
        const w = 1, d = 0.25;
        const bw = vertical ? d : w, bd = vertical ? w : d;
        b.box(bw, 0.9, bd, 0, 0.45, 0, 0x55534e).box(bw, 0.35, bd, 0, WALL_H - 0.175, 0, 0x55534e);
        if (boarded) b.box(bw * 1.1, 1.35, bd * 1.1, 0, 1.575, 0, 0x3d2c1e);
        else b.box(vertical ? 0.06 : 0.96, 1.35, vertical ? 0.96 : 0.06, 0, 1.575, 0, 0x2a3a50, 'glass');
        return b.p;
      }), x + 0.5, y + 0.5, 0);
    }
    // door frames
    for (let y = 1; y < FH - 1; y++)
      for (let x = 1; x < FW - 1; x++) {
        if (L.tiles[idx(x, y)] !== T_DOOR) continue;
        // the frame follows the wall line: windows and neighbouring door tiles (double doors) count as wall
        const t = (dx: number, dy: number) => L.tiles[idx(x + dx, y + dy)];
        const ns = doorRunsNS(L, x, y);
        // no post in the middle of a double door
        const postA = ns ? t(0, -1) !== T_DOOR : t(-1, 0) !== T_DOOR, postB = ns ? t(0, 1) !== T_DOOR : t(1, 0) !== T_DOOR;
        const key = `door|${ns}|${postA}|${postB}`;
        this.placeKit(key, kitOf(key, () => {
          const b = new Builder();
          const c = 0x2a2826;
          if (ns) {
            b.box(0.3, 0.12, 1, 0, WALL_H - 0.3, 0, c);
            if (postA) b.box(0.32, 2.2, 0.08, 0, 1.1, -0.46, c);
            if (postB) b.box(0.32, 2.2, 0.08, 0, 1.1, 0.46, c);
          } else {
            b.box(1, 0.12, 0.3, 0, WALL_H - 0.3, 0, c);
            if (postA) b.box(0.08, 2.2, 0.32, -0.46, 1.1, 0, c);
            if (postB) b.box(0.08, 2.2, 0.32, 0.46, 1.1, 0, c);
          }
          return b.p;
        }), x + 0.5, y + 0.5, 0);
      }
    this.flushKits();
  }

  addParts(p: Parts) {
    const s = merge(p.solid), e = merge(p.emit), g = merge(p.glass), sc = merge(p.screen);
    if (s) { const m = new THREE.Mesh(this.track(s), propSolidMat); m.castShadow = true; m.receiveShadow = true; this.group.add(m); }
    if (e) this.group.add(new THREE.Mesh(this.track(e), emitMat));
    if (g) { const m = new THREE.Mesh(this.track(g), glassMat); m.renderOrder = 2; this.group.add(m); }
    if (sc) this.group.add(new THREE.Mesh(this.track(sc), screenMat));
    for (const mg of p.mirror) this.addMirror(mg);
  }

  // ---- hackable computers: floating holo icon + floor ring, recoloured by state
  private hackMarks = new Map<number, { g: THREE.Group; icon: THREE.Sprite; ring: THREE.Mesh; state: string; kind: string }>();
  private static iconTex = new Map<string, THREE.Texture>();
  private static hackIcon(kind: string, state: string): THREE.Texture {
    const key = kind + state;
    const hit = FloorView.iconTex.get(key);
    if (hit) return hit;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const col = state === 'done' ? '#1fe07a' : state === 'locked' ? '#ff3b4e' : kind === 'security' ? '#ff4fd0' : '#ffc23a';
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 7; g.shadowColor = col; g.shadowBlur = 14;
    g.beginPath(); g.moveTo(64, 8); g.lineTo(116, 38); g.lineTo(116, 90); g.lineTo(64, 120); g.lineTo(12, 90); g.lineTo(12, 38); g.closePath(); g.stroke(); // hex frame
    g.lineWidth = 8;
    if (state === 'done') { g.beginPath(); g.moveTo(38, 66); g.lineTo(56, 84); g.lineTo(92, 44); g.stroke(); }
    else if (state === 'locked') { g.beginPath(); g.moveTo(42, 42); g.lineTo(86, 86); g.moveTo(86, 42); g.lineTo(42, 86); g.stroke(); }
    else if (kind === 'security') { // padlock
      g.beginPath(); g.arc(64, 56, 16, Math.PI, 0); g.stroke();
      g.fillRect(40, 56, 48, 34); g.fillStyle = '#10020c'; g.fillRect(61, 66, 6, 14);
    } else { // bulb
      g.beginPath(); g.arc(64, 54, 20, Math.PI * 0.8, Math.PI * 2.2); g.lineTo(74, 84); g.lineTo(54, 84); g.closePath(); g.stroke();
      g.fillRect(54, 90, 20, 6); g.fillRect(56, 99, 16, 5);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    FloorView.iconTex.set(key, t);
    return t;
  }
  private buildHackMarkers() {
    for (const hs of this.L.hacks) {
      const g = new THREE.Group();
      g.position.set(hs.x, 0, hs.y);
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: FloorView.hackIcon(hs.kind, 'ready'), transparent: true, depthWrite: false, toneMapped: false }));
      icon.scale.setScalar(0.55);
      icon.position.y = 1.75;
      icon.renderOrder = 7;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.8, 40), new THREE.MeshBasicMaterial({ color: hs.kind === 'security' ? 0xff4fd0 : 0xffc23a, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      g.add(icon, ring);
      this.group.add(g);
      this.hackMarks.set(hs.id, { g, icon, ring, state: 'ready', kind: hs.kind });
    }
  }
  private updateHackMarkers(fs: FloorState, t: number) {
    for (const hs of fs.hacks) {
      const m = this.hackMarks.get(hs.id);
      if (!m) continue;
      if (m.state !== hs.state) {
        m.state = hs.state;
        (m.icon.material as THREE.SpriteMaterial).map = FloorView.hackIcon(m.kind, hs.state);
        (m.ring.material as THREE.MeshBasicMaterial).color.setHex(hs.state === 'done' ? 0x1fe07a : hs.state === 'locked' ? 0xff3b4e : m.kind === 'security' ? 0xff4fd0 : 0xffc23a);
      }
      const live = hs.state === 'ready';
      m.icon.position.y = 1.75 + (live ? Math.sin(t * 2.2 + hs.id) * 0.06 : 0);
      (m.icon.material as THREE.SpriteMaterial).opacity = live ? 0.75 + 0.25 * Math.sin(t * 4 + hs.id) : 0.5;
      (m.ring.material as THREE.MeshBasicMaterial).opacity = live ? 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(t * 3 + hs.id)) : 0.2;
    }
  }

  /** Mirror planes: a polished fallback surface, plus a pose the renderer uses to place a live Reflector. */
  mirrors: { pos: THREE.Vector3; quat: THREE.Quaternion; normal: THREE.Vector3; w: number; h: number }[] = [];
  private addMirror(g: THREE.BufferGeometry) {
    const a = g.attributes.position, v = (i: number) => new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i));
    const p0 = v(0), p1 = v(1), p2 = v(2); // PlaneGeometry order: top-left, top-right, bottom-left
    const xa = p1.clone().sub(p0), ya = p0.clone().sub(p2);
    const w = xa.length(), h = ya.length();
    const normal = new THREE.Vector3().crossVectors(xa, ya).normalize();
    const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xa.normalize(), ya.normalize(), normal));
    this.mirrors.push({ pos: p1.clone().add(p2).multiplyScalar(0.5), quat, normal, w, h });
    this.group.add(new THREE.Mesh(this.track(g), mirrorMat));
  }

  private makePanelLeds(id: number, x: number, y: number, rot: number) {
    const g = new THREE.Group();
    g.position.set(x, 0, y);
    g.rotation.y = rot;
    const led = (lx: number) => {
      const mat = this.track(new THREE.MeshBasicMaterial({ color: 0x111111, toneMapped: false }));
      const m = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.1, 0.05, 0.01)), mat);
      m.position.set(lx, 1.5, -0.214);
      g.add(m);
      return mat;
    };
    this.panelLeds.set(id, { red: led(-0.2), green: led(0) });
    this.group.add(g);
  }

  /** Kit instances placed so far this build (key -> kit + transforms); flushKits() turns them into InstancedMeshes. */
  private placed = new Map<string, { k: Kit; at: THREE.Matrix4[] }>();
  kitKeys: string[] = [];
  /** drawn once off-screen ahead of time (GameRenderer.prerender): on the GPU, programs linked */
  warmed = false;
  private placeKit(key: string, k: Kit, x: number, z: number, ry: number) {
    let e = this.placed.get(key);
    if (!e) this.placed.set(key, (e = { k, at: [] }));
    e.at.push(new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z));
  }
  private flushKits() {
    for (const [key, { k, at }] of this.placed) {
      this.kitKeys.push(key);
      const inst = (g: THREE.BufferGeometry | null, mat: THREE.Material) => {
        if (!g) return null;
        const m = new THREE.InstancedMesh(g, mat, at.length);
        at.forEach((x, i) => m.setMatrixAt(i, x));
        this.group.add(m);
        return m;
      };
      const s = inst(k.solid, propSolidMat);
      if (s) { s.castShadow = true; s.receiveShadow = true; }
      inst(k.emit, emitMat);
      const g = inst(k.glass, glassMat);
      if (g) g.renderOrder = 2;
    }
    this.placed.clear();
  }

  private buildProps() {
    const all = newParts(), snowy = snowyOf(this.L);
    for (const p of this.L.props) {
      if (p.kind === 'vending') continue;
      if (!isKitProp(this.L, p)) { const o = buildStreetProp(p); if (o) { this.group.add(o); o.traverse((c) => { if (c.userData.spin) this.spinners.push(c); }); continue; } }
      const ry = p.w === p.h ? ROT_Y[p.rot] ?? 0 : 0, k = propKit(p.kind, p.w, p.h, snowy);
      this.placeKit(propKey(p.kind, p.w, p.h, snowy), k, p.x, p.y, ry);
      if (k.screen.length || k.mirror.length) {
        const own = newParts();
        place({ ...newParts(), screen: k.screen, mirror: k.mirror }, p.x, p.y, ry, own);
        for (const g of own.screen) all.screen.push(reseedScreen(g));
        all.mirror.push(...own.mirror);
      }
      if (p.kind === 'panel') this.makePanelLeds(p.id, p.x, p.y, ROT_Y[p.rot] ?? 0);
      if (p.kind === 'pokertable') this.track(buildCardFaces(p, this.group)); // easter egg: the royal flush
    }
    this.flushKits();
    this.addParts(all);
    if (this.L.mainframe) {
      const ring = new THREE.Mesh(this.track(new THREE.TorusGeometry(2.2, 0.06, 8, 48)), new THREE.MeshBasicMaterial({ color: 0x3090ff, toneMapped: false }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(this.L.mainframe.x, 3.6, this.L.mainframe.y);
      this.mainframeRing = ring;
      this.group.add(ring);
    }
  }

  private buildStairs() {
    const L = this.L;
    for (const s of L.stairs) {
      const g = new THREE.Group();
      const b = new Builder();
      // layout (see stampStair): bottom landing = south row; flights run north over FL tiles to a 1-tile top landing
      const FL = s.y1 - s.y0 - 1, N = 12, RISE = 2.6, run = FL / N, foot = s.y1, mid = s.y0 + 1 + FL / 2;
      const concrete = 0x8b8a84, nosing = 0xd8b020, rail = 0x9aa2a8, stringer = 0x5e5f5c, parapet = 0x77766f;
      const slope = Math.atan2(RISE, FL), hyp = Math.hypot(RISE, FL);
      // ---- up flight: two tiles wide on the west side, rising northward to its top landing
      const ux0 = s.x0, ux1 = s.x0 + 2, ucx = (ux0 + ux1) / 2;
      for (let i = 0; i < N; i++) {
        const top = (i + 1) * (RISE / N), zc = foot - (i + 0.5) * run;
        b.box(1.96, top, run + 0.01, ucx, top / 2, zc, i % 2 ? concrete : 0x86857f);
        b.box(1.96, 0.025, 0.06, ucx, top + 0.012, zc + run / 2 - 0.03, nosing); // anti-slip nosing
      }
      b.box(1.96, RISE, 1, ucx, RISE / 2, s.y0 + 0.5, 0x908f88); // top landing
      b.box(1.96, 0.025, 0.08, ucx, RISE + 0.012, s.y0 + 0.96, nosing);
      b.box(0.08, 0.34, hyp, ux1 - 0.04, RISE / 2 + 0.05, mid, stringer, 'solid', 0, slope); // open-side stringer
      // wall handrail (west) and guard rail (open east side) follow the pitch, then run level along the landing
      for (const [sx, h] of [[ux0 + 0.06, 0.9], [ux1 - 0.05, 0.95], [ux1 - 0.05, 0.5]]) {
        b.cyl(0.025, 0.025, hyp, sx, RISE / 2 + h, mid, rail, 'solid', 8, slope - Math.PI / 2);
        b.cyl(0.025, 0.025, 1, sx, RISE + h, s.y0 + 0.5, rail, 'solid', 8, Math.PI / 2);
      }
      for (let k = 0; k <= 4; k++) { const zz = foot - (k / 4) * FL, hh = (k / 4) * RISE; b.cyl(0.02, 0.02, 0.95, ux1 - 0.05, hh + 0.475, zz, rail, 'solid', 6); }
      b.cyl(0.02, 0.02, 0.95, ux1 - 0.05, RISE + 0.475, s.y0 + 0.05, rail, 'solid', 6);
      // ---- central parapet between the flights (solid in the sim): low concrete wall, capped, newel at the landing
      b.box(0.8, 1.0, FL + 1, s.x0 + 2.5, 0.5, s.y0 + (FL + 1) / 2, parapet);
      b.box(0.92, 0.06, FL + 1.04, s.x0 + 2.5, 1.03, s.y0 + (FL + 1) / 2, 0x5a5954);
      b.box(0.92, 0.12, 0.12, s.x0 + 2.5, 0.9, foot - 0.06, nosing); // hazard band on the newel end
      // ---- down flight: an open pit on the east side, descending northward to a landing one storey down
      const dx0 = s.x1 - 1, dx1 = s.x1 + 1, dcx = (dx0 + dx1) / 2, DEPTH = RISE + 0.2;
      for (let i = 0; i < N; i++) {
        const top = -(i + 1) * (RISE / N), zc = foot - (i + 0.5) * run;
        b.box(1.96, DEPTH + top, run + 0.01, dcx, (top - DEPTH) / 2, zc, i % 2 ? concrete : 0x86857f);
        b.box(1.96, 0.025, 0.06, dcx, top + 0.012, zc + run / 2 - 0.03, nosing);
      }
      b.box(1.96, DEPTH - RISE, 1, dcx, -(DEPTH + RISE) / 2, s.y0 + 0.5, 0x908f88); // bottom-of-pit landing
      b.box(1.96, 0.025, 0.08, dcx, 0.012, foot + 0.04, nosing); // edge of the drop, on the bottom landing
      b.box(0.12, DEPTH, FL + 1, dx0 - 0.06, -DEPTH / 2, s.y0 + (FL + 1) / 2, 0x4a4a46); // pit side walls
      b.box(0.12, DEPTH, FL + 1, dx1 + 0.06, -DEPTH / 2, s.y0 + (FL + 1) / 2, 0x4a4a46);
      b.box(2.2, DEPTH, 0.12, dcx, -DEPTH / 2, s.y0 - 0.06, 0x4a4a46); // pit end wall
      b.cyl(0.025, 0.025, hyp, dx1 - 0.06, -RISE / 2 + 0.9, mid, rail, 'solid', 8, Math.PI / 2 - slope); // wall rail going down
      b.cyl(0.025, 0.025, 1, dx1 - 0.06, -RISE + 0.9, s.y0 + 0.5, rail, 'solid', 8, Math.PI / 2);
      // never cut by the wall cutaway below the landing height: a player on the steps must not float over a hole
      const sm = merge(b.p.solid);
      if (sm) { const m = new THREE.Mesh(this.track(sm), stairMat); m.castShadow = true; m.receiveShadow = true; g.add(m); }
      // signage over the door, facing out of the stairwell
      const ox = s.doorX < s.x0 ? -1 : s.doorX > s.x1 + 1 ? 1 : 0, oz = ox ? 0 : s.doorY > s.cy ? 1 : -1;
      const sign = this.textSign(`STAIR ${'ABC'[s.index]} · ${L.floor}`, '#c9a21a');
      sign.position.set(s.doorX + ox * 0.52, 2.3, s.doorY + oz * 0.52);
      sign.rotation.y = Math.atan2(ox, oz);
      g.add(sign);
      this.group.add(g);
      const up = new THREE.Group();
      this.group.add(up);
      this.stairDeco.push({ index: s.index, up, cond: 'clear' });
      this.refreshStair(this.stairDeco[this.stairDeco.length - 1], true);
      // down flight condition overlay (static; cannot change)
      const dcond = L.floor > 1 ? this.ctx.flight(L.floor - 1, s.index) : 'collapsed';
      if (dcond !== 'clear') {
        const db = new Builder();
        if (dcond === 'debris' || dcond === 'collapsed') db.box(1.9, 2.6, FL + 1, s.x1, -1.3, s.y0 + (FL + 1) / 2, 0x3a3834); // pit choked with rubble
        this.rubble(db, s.x1, mid, dcond, 0.02, -1);
        this.addParts(db.p);
        if (dcond === 'fire') this.fireSpots.push({ x: s.x1 - 0.3, y: mid, r: 0.8, kind: 'stairfire' });
      }
    }
  }

  /** Condition dressing for a flight centred on (x, z); `dir` = 1 for the up flight, -1 for the down pit. */
  private rubble(b: Builder, x: number, z: number, cond: StairCondition, base: number, dir: 1 | -1 = 1) {
    const seed = x * 13 + z * 7;
    const r = (i: number) => { const s = Math.sin(seed + i * 91.7) * 43758.5; return s - Math.floor(s); };
    if (cond === 'debris' || cond === 'collapsed') {
      const n = cond === 'collapsed' ? 14 : 10;
      for (let i = 0; i < n; i++) b.box(0.3 + r(i) * 0.6, 0.2 + r(i + 1) * 0.5, 0.3 + r(i + 2) * 0.6, x + (r(i + 3) - 0.5) * 1.6, base + 0.15 + r(i + 4) * (cond === 'collapsed' ? 0.3 : 1.1), z + (r(i + 5) - 0.5) * 2.5, [0x5a5854, 0x4a4844, 0x6a6660, 0x3a3834][i % 4], 'solid', r(i + 6) * 3, r(i + 7), r(i + 8));
      if (cond === 'collapsed') b.box(1.7, 0.02, 2.4, x, base + 0.01, z, 0x000000);
      for (let i = 0; i < 3; i++) b.box(0.08, 0.08, 1.6, x + (r(i + 20) - 0.5), base + 0.5 + r(i + 21) * 0.6, z + (r(i + 22) - 0.5), 0x7a3a1a, 'solid', r(i + 23) * 3, r(i + 24), 0.5);
    } else if (cond === 'damaged') {
      // usable but worn: cracked treads, a chipped step, caution tape on the rail (no rubble in the way)
      // flight geometry as in buildStairs: 12 treads over 4 m, foot 2 m south of the centre
      for (let i = 1; i < 12; i += 2) b.box(0.9 * r(i) + 0.3, 0.012, 0.03, x + (r(i + 1) - 0.5), dir * (i + 1) * (2.6 / 12) + 0.008, z + 2 - (i + 0.5) / 3, 0x2a2926, 'solid', r(i + 2) * 3);
      b.box(0.45, 0.06, 0.28, x + 0.55, dir * 1.3 + 0.03, z, 0x5e5d58, 'solid', 0.3, 0.1, 0.15);
      b.box(0.02, 0.08, 1.2, x - 0.84 * dir, dir * 1.56 + 0.9, z - 0.4, 0xd8b020, 'solid', 0, 0.75 * dir);
    } else if (cond === 'fire') {
      for (let i = 0; i < 5; i++) b.box(0.4, 0.15, 0.4, x + (r(i) - 0.5) * 1.2, base + 0.2 + r(i + 1) * 0.8, z + (r(i + 2) - 0.5) * 2, 0x1a120c);
    }
  }

  private refreshStair(d: { index: number; up: THREE.Group | null; cond: StairCondition }, force = false) {
    const L = this.L;
    const s = L.stairs[d.index];
    const cond = L.floor >= 200 ? 'collapsed' : this.ctx.flight(L.floor, d.index);
    if (!force && cond === d.cond) return;
    d.cond = cond;
    const up = d.up!;
    for (const c of [...up.children]) { up.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    if (cond !== 'clear') {
      const b = new Builder();
      this.rubble(b, s.x0 + 1, (s.y0 + s.y1 + 1) / 2, cond, 0.4);
      const sm = merge(b.p.solid);
      if (sm) up.add(new THREE.Mesh(sm, propSolidMat));
    }
    this.fireSpots = this.fireSpots.filter((f) => !(f.kind === 'stairfire' && Math.abs(f.x - (s.x0 + 1)) < 0.01));
    if (cond === 'fire') this.fireSpots.push({ x: s.x0 + 1, y: (s.y0 + s.y1 + 1) / 2, r: 0.9, kind: 'stairfire' });
  }

  private buildElevators() {
    const L = this.L;
    for (const e of L.elevators) {
      const working = this.ctx.elevatorWorking(L.floor, e.index);
      const b = new Builder();
      // car interior walls & doors
      b.box(3, 0.05, 3, e.cx, 0.02, e.cy, working ? 0x6a6e74 : 0x2a2a2c);
      const dz = e.doorY;
      if (working) { b.box(0.7, 2.3, 0.08, e.doorX - 1.05, 1.15, dz, 0x8a9096).box(0.7, 2.3, 0.08, e.doorX + 1.05, 1.15, dz, 0x8a9096); }
      else { b.box(0.8, 2.3, 0.08, e.doorX - 0.62, 1.15, dz, 0x5a5e62, 'solid', 0.1).box(0.8, 2.3, 0.08, e.doorX + 0.62, 1.15, dz, 0x5a5e62, 'solid', -0.08); }
      b.box(3.2, 0.3, 0.3, e.doorX, 2.45, dz, 0x2a2a2a);
      this.addParts(b.p);
      // call panel light: green = powered, red blink = dead
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, 0.04), new THREE.MeshBasicMaterial({ color: working ? 0x30ff60 : 0xff2020, toneMapped: false }));
      panel.position.set(e.doorX + 1.35, 1.35, dz + 0.55);
      this.group.add(panel);
      const interior = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.5), new THREE.MeshBasicMaterial({ color: working ? 0xfff0d0 : 0x100808, toneMapped: false }));
      interior.rotation.x = Math.PI / 2;
      interior.position.set(e.cx, 2.55, e.cy);
      this.group.add(interior);
      this.elevPanels.push({ mesh: panel, working, interior });
      const sign = this.textSign(working ? `LIFT ${e.index + 1} · ONLINE` : `LIFT ${e.index + 1} · NO POWER`, working ? '#40ff80' : '#ff4040');
      sign.position.set(e.doorX, 2.2, dz + 0.52);
      this.group.add(sign);
    }
  }

  private textSign(text: string, color: string): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 48;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#101214'; ctx.fillRect(0, 0, 256, 48);
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.strokeRect(3, 3, 250, 42);
    ctx.fillStyle = color; ctx.font = 'bold 24px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 25);
    const t = this.track(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1.6, 0.3)), this.track(new THREE.MeshBasicMaterial({ map: t, toneMapped: false })));
    return m;
  }

  private buildFixtures() {
    const L = this.L;
    const n = L.lights.length;
    if (!n) return;
    const geo = this.track(new THREE.BoxGeometry(0.9, 0.05, 0.35));
    const mat = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    const inst = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    L.lights.forEach((l, i) => {
      const y = l.kind === 'ceiling' || l.kind === 'emergency' ? 2.5 : -5;
      m.makeTranslation(l.x, y, l.y);
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, c.set(l.color));
      this.fixGain[i] = Math.max(1.5, 1.8 / Math.max(0.05, c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722)); // luminance 1.8 when fully lit
    });
    this.fixtures = inst;
    this.group.add(inst);
    // cheap light pools: a soft additive disc on the floor under every lamp, so lamps beyond the PointLight budget
    // still tint their surroundings. Indoor pools are clipped to the lamp's room (no bleeding through walls)
    // ponytail: flat disc at y 0, ignores props/stairs; a light-index buffer if it must wrap geometry
    const night = L.floor === 0 && currentHoliday() === 'halloween';
    const pg = this.track(new THREE.PlaneGeometry(2, 2)); pg.rotateX(-Math.PI / 2);
    const pools = new THREE.InstancedMesh(pg, this.track(new THREE.MeshBasicMaterial({ map: poolTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })), n);
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    L.lights.forEach((l, i) => {
      const size = lightSize(l), r = 1 + 2 * size, room = L.rooms[l.room];
      const on = l.kind !== 'police' && (l.kind !== 'street' || night);
      const indoor = (l.kind === 'ceiling' || l.kind === 'emergency') && room;
      const rx = indoor ? Math.min(r, l.x - room.x + 0.2, room.x + room.w - l.x + 0.2) : r, rz = indoor ? Math.min(r, l.y - room.y + 0.2, room.y + room.h - l.y + 0.2) : r;
      pools.setMatrixAt(i, m.compose(pos.set(l.x, 0.02, l.y), q, sc.set(on ? rx : 0, 1, on ? rz : 0)));
      pools.setColorAt(i, c.setRGB(0, 0, 0));
      this.poolGain[i] = 0.16 * (0.6 + 0.4 * Math.min(size, 2));
    });
    pools.frustumCulled = false; // instances span the floor
    pools.renderOrder = 1;
    this.pools = pools;
    this.group.add(pools);
  }

  /** Police light-bar lenses: real meshes that strobe in sync with their point lights. */
  private buildLightBars() {
    const geo = this.track(new THREE.BoxGeometry(0.28, 0.1, 0.28));
    this.L.lights.forEach((l, i) => {
      if (l.kind !== 'police') return;
      const mat = this.track(new THREE.MeshBasicMaterial({ color: l.color, toneMapped: false }));
      const m = new THREE.Mesh(geo, mat);
      m.position.set(l.x, (l.z ?? 1.44) + 0.02, l.y);
      this.group.add(m);
      this.lenses.push({ mesh: m, li: i, base: new THREE.Color(l.color) });
    });
  }

  private buildStreetBackdrop() {
    this.group.add(buildRoad(this.L));
    // chain-link fence and low concrete barriers around the street; the asphalt ground plane continues beyond
    const b = new Builder();
    for (let x = 0; x < FW; x += 2) b.box(2, 1.4, 0.05, x + 1, 0.7, FH - 0.5, 0x3a3e40);
    for (let y = 12; y < FH; y += 2) { b.box(0.05, 1.4, 2, 0.5, 0.7, y + 1, 0x3a3e40); b.box(0.05, 1.4, 2, FW - 0.5, 0.7, y + 1, 0x3a3e40); }
    this.addParts(b.p);
  }

  // ----------------------------------------------------------------------------- dynamic
  update(fs: FloorState, t: number, dt: number) {
    screenUniforms.uScrTime.value = t;
    this.updateHackMarkers(fs, t);
    for (const s of this.spinners) {
      // rotating beacons: slow turn, glow swells as the reflector comes round
      s.rotation.y += s.userData.spin * dt;
      const k = 0.5 + 0.5 * Math.sin(s.rotation.y);
      for (const m of (s.userData.pulse ?? []) as { m: THREE.Material; lo: number; hi: number; key: string }[]) (m.m as any)[m.key] = m.lo + (m.hi - m.lo) * k * k;
    }
    const L = fs.L; // (a hacked lighting grid swaps in a repaired layout copy)
    // fixtures follow the shared flicker function
    if (this.fixtures) {
      L.lights.forEach((l, i) => {
        const lv = lightLevel(l, lightOut(fs.lights[i], l), t);
        this.fixColor.set(l.color).multiplyScalar(0.1 + lv * this.fixGain[i]); // >1 so lamps still bloom above the 1.0 threshold
        this.fixtures!.setColorAt(i, this.fixColor);
        this.pools!.setColorAt(i, this.fixColor.set(l.color).multiplyScalar(lv * this.poolGain[i]));
      });
      this.fixtures.instanceColor!.needsUpdate = true;
      this.pools!.instanceColor!.needsUpdate = true;
    }
    for (const ln of this.lenses) {
      const lv = lightLevel(L.lights[ln.li], false, t);
      (ln.mesh.material as THREE.MeshBasicMaterial).color.copy(ln.base).multiplyScalar(lv > 0.5 ? 2.2 : 0.12);
    }
    for (const d of this.stairDeco) this.refreshStair(d);
    for (const p of this.elevPanels) {
      if (!p.working) (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(t * 6) > 0 ? 0xff2020 : 0x300404);
    }
    if (this.mainframeRing) {
      this.mainframeRing.rotation.z += dt * 0.6;
      this.mainframeRing.position.y = 3.6 + Math.sin(t * 1.5) * 0.15;
    }
    for (const pn of fs.panels) {
      const leds = this.panelLeds.get(pn.id);
      if (!leds) continue;
      leds.red.color.setHex(!pn.dead && pn.off ? 0xff3020 : 0x111111);
      leds.green.color.setHex(!pn.dead && !pn.off ? 0x30ff30 : 0x111111);
    }
    // CCTV
    for (const c of fs.cameras) {
      let v = this.cams.get(c.id);
      if (!v) v = this.makeCam(c);
      if (!c.alive) {
        if (!v.dead) { v.dead = true; v.beam.visible = false; v.head.rotation.z = 0.6; (v.led.material as THREE.MeshBasicMaterial).color.setHex(0x111111); }
        continue;
      }
      v.head.rotation.y = -c.angle + Math.PI / 2;
      const hit = raycastWalls(L, c.x, c.y, c.x + Math.cos(c.angle) * c.range, c.y + Math.sin(c.angle) * c.range);
      let len = hit < 0 ? c.range : Math.max(0.5, hit);
      // smoke swallows the beam (the sim already blocks camera vision through smoke)
      const dx = Math.cos(c.angle), dy = Math.sin(c.angle);
      for (const z of fs.zones) {
        if (z.kind !== 'smoke') continue;
        const r = z.r * Math.min(1, z.t / 1.5 + 0.2);
        const t0 = (z.x - c.x) * dx + (z.y - c.y) * dy;
        const perp = Math.hypot(c.x + dx * t0 - z.x, c.y + dy * t0 - z.y);
        if (perp < r && t0 > 0) len = Math.max(0.5, Math.min(len, t0 - Math.sqrt(r * r - perp * perp)));
      }
      v.beam.scale.set(1, 1, len / c.range);
      v.beam.position.set(c.x, 2.3, c.y);
      v.beam.lookAt(c.x + Math.cos(c.angle) * len, 0.1, c.y + Math.sin(c.angle) * len);
      const alarm = c.alarmT > 0;
      v.beamMat.uniforms.uColor.value.setHex(alarm ? 0xff1010 : c.detect > 0.05 ? 0xff7a10 : 0xffb030);
      v.beamMat.uniforms.uOpacity.value = alarm ? 0.6 + Math.sin(t * 20) * 0.15 : 0.3 + c.detect * 0.35;
      (v.led.material as THREE.MeshBasicMaterial).color.setHex(alarm || Math.sin(t * 4) > 0.3 ? 0xff2020 : 0x400808);
    }
    // traps
    for (const tr of fs.traps) {
      let o = this.traps.get(tr.id);
      if (!o) o = this.makeTrap(tr);
      const spent = (tr as any).spent || (!tr.armed && tr.fuse <= 0);
      o.visible = tr.revealed && !spent;
      if (o.visible && tr.kind === 'mine') {
        const led = o.children[1] as THREE.Mesh;
        (led.material as THREE.MeshBasicMaterial).color.setHex(!tr.armed || Math.sin(t * 8) > 0.6 ? 0xff2020 : 0x300000);
      }
    }
    // doors swing toward their state in ~0.25 s; LED: red locked, green shut, dark open
    this.L.doors.forEach((d, i) => {
      const o = this.doorVis[i], st = fs.doors[i]?.state ?? d.init;
      if (!o) return;
      o.open = Math.max(0, Math.min(1, o.open + (st === 'open' ? 4 : -4) * dt));
      for (const p of o.pivots) p.g.rotation.y = p.base + p.swing * o.open * 1.66;
      o.led.color.setHex(st === 'locked' ? 0xff2020 : st === 'closed' ? 0x20e040 : 0x111111);
    });
    // vending machines
    for (const v of fs.vendings) {
      const o = this.vends.get(v.id) ?? this.makeVend(v);
      if (v.broken && !o.broken) {
        o.broken = true;
        o.g.children[2].visible = false;
        ((o.g.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(0x222222);
        o.g.rotation.z = 0.08;
      }
    }
  }

  private makeVend(v: VendingSpec) {
    const g = new THREE.Group();
    const k = propKit('vending', 1, 1);
    g.add(new THREE.Mesh(k.solid!, propSolidMat), new THREE.Mesh(k.emit!, emitMat.clone()), new THREE.Mesh(k.glass!, glassMat));
    g.position.set(v.x, 0, v.y);
    g.rotation.y = ROT_Y[v.rot] ?? 0;
    this.group.add(g);
    const o = { g, broken: false };
    this.vends.set(v.id, o);
    return o;
  }

  /** door leaves (same order as L.doors): hinge pivots with their closed angle and swing, the status LED, openness 0..1 */
  private doorVis: { pivots: { g: THREE.Group; base: number; swing: number }[]; led: THREE.MeshBasicMaterial; open: number }[] = [];
  private static leafGeo: THREE.BufferGeometry | null = null;
  private makeDoor(d: DoorSpec) {
    const L = this.L;
    // a 0.9 m leaf along its local +x from the hinge, handle at the far end
    const geo = (FloorView.leafGeo ??= (() => { const g = merge(new Builder().box(0.9, 2.15, 0.05, 0.45, 1.075, 0, 0x6e5a46).box(0.05, 0.04, 0.14, 0.8, 1.0, 0, 0xb8b8b0).p.solid)!; g.userData.shared = true; return g; })());
    const led = this.track(new THREE.MeshBasicMaterial({ color: 0x111111, toneMapped: false }));
    // swing into the room, not the corridor
    const t0 = d.tiles[0], step = d.vertical ? 1 : FW;
    const pos = L.rooms[L.roomAt[t0 + step]]?.type === 'corridor' ? -1 : 1;
    const px = d.vertical ? pos : 0, pz = d.vertical ? 0 : pos;
    const vis = { pivots: [] as { g: THREE.Group; base: number; swing: number }[], led, open: d.init === 'open' ? 1 : 0 };
    d.tiles.forEach((t, k) => {
      const tx = t % FW, ty = (t / FW) | 0;
      const a = k === 0 ? 1 : -1; // double doors hinge on their outer posts
      const dx = d.vertical ? 0 : a, dz = d.vertical ? a : 0; // closed leaf direction (world x,z)
      const g = new THREE.Group();
      g.position.set(d.vertical ? tx + 0.5 : tx + 0.5 - a * 0.46, 0, d.vertical ? ty + 0.5 - a * 0.46 : ty + 0.5);
      const base = Math.atan2(-dz, dx); // rotation.y that points local +x along (dx,dz)
      const swing = dz * px - dx * pz > 0 ? 1 : -1; // +y rotation turns (dx,dz) into (dz,-dx)
      const m = new THREE.Mesh(geo, propSolidMat);
      m.castShadow = true;
      g.add(m);
      if (k === 0) { const l = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.05, 0.05, 0.07)), led); l.position.set(0.8, 1.2, 0); g.add(l); }
      this.group.add(g);
      vis.pivots.push({ g, base, swing });
    });
    this.doorVis.push(vis);
  }

  private makeCam(c: CameraSpec): CamVis {
    const mount = new THREE.Group();
    const b = new Builder().box(0.18, 0.18, 0.12, 0, 0, 0, 0x2a2c2e);
    mount.add(new THREE.Mesh(merge(b.p.solid)!, propSolidMat));
    mount.position.set(c.x, 2.4, c.y);
    const head = new THREE.Group();
    const hb = new Builder().box(0.14, 0.14, 0.34, 0, 0, 0.17, 0xd0d0cc).cyl(0.05, 0.05, 0.04, 0, 0, 0.35, 0x111111, 'solid', 8, Math.PI / 2);
    head.add(new THREE.Mesh(merge(hb.p.solid)!, propSolidMat));
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }));
    led.position.set(0.05, 0.08, 0.2);
    head.add(led);
    head.position.y = -0.12;
    mount.add(head);
    this.group.add(mount);
    const r = Math.tan(c.fov) * c.range;
    const cg = new THREE.ConeGeometry(r, c.range, 20, 1, true);
    cg.translate(0, -c.range / 2, 0);
    cg.rotateX(-Math.PI / 2);
    const beamMat = beamMaterial(0xffb030, 0.3);
    const beam = new THREE.Mesh(cg, beamMat);
    // central laser line
    const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, c.range, 4).translate(0, -c.range / 2, 0).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3010, toneMapped: false, transparent: true, opacity: 0.8 }));
    beam.add(laser);
    beam.renderOrder = 3;
    this.group.add(beam);
    const v: CamVis = { head, beam, beamMat, led, dead: false };
    this.cams.set(c.id, v);
    return v;
  }

  private makeTrap(tr: TrapSpec): THREE.Object3D {
    const g = new THREE.Group();
    if (tr.kind === 'tripwire') {
      const len = Math.hypot(tr.x2 - tr.x, tr.y2 - tr.y);
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, len, 4), new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false }));
      wire.rotation.z = Math.PI / 2;
      const hold = new THREE.Group();
      hold.add(wire);
      hold.position.set((tr.x + tr.x2) / 2, 0.18, (tr.y + tr.y2) / 2);
      hold.rotation.y = -Math.atan2(tr.y2 - tr.y, tr.x2 - tr.x);
      g.add(hold);
      const charge = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.12), new THREE.MeshStandardMaterial({ color: 0x3a4a2a }));
      charge.position.set(tr.x, 0.12, tr.y);
      g.add(charge);
    } else {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.07, 12), new THREE.MeshStandardMaterial({ color: 0x2a2e26, roughness: 0.6, metalness: 0.5 }));
      disc.position.set(tr.x, 0.035, tr.y);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }));
      led.position.set(tr.x, 0.09, tr.y);
      g.add(disc, led);
    }
    g.visible = false;
    this.group.add(g);
    this.traps.set(tr.id, g);
    return g;
  }

  dispose() {
    live.delete(this);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); // its instance buffers
    });
    for (const d of this.disposables) d.dispose();
  }
}
