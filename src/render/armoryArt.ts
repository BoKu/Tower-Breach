import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { buildGun, GunKind } from './operator';
import { gunKindOf } from './models';
import { weapon } from '../config/weapons';

/**
 * Wireframe line art for the armory: each weapon/gear item is modelled in 3D, rendered offscreen with hidden-line
 * removal (depth-only fill, visible edges drawn in signal cyan) and cached as a transparent PNG data URL.
 */
const W = 320, H = 150;
let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, string>();

const rb = (w: number, h: number, d: number, r = 0.01) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));
const cyl = (rt: number, rb2: number, h: number, seg = 16) => new THREE.CylinderGeometry(rt, rb2, h, seg);
const partMat = new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.5, metalness: 0.45 });
// coloured parts for gear shown as real models (sandbox pedestals); the armory line art ignores colour (normals only)
const tints = new Map<number, THREE.MeshStandardMaterial>();
const tint = (c: number) => tints.get(c) ?? (tints.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.15 })), tints.get(c)!);
function part(g: THREE.Group, geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, color?: number) {
  const m = new THREE.Mesh(geo, color === undefined ? partMat : tint(color)); // default MeshBasicMaterial renders unlit white outside the armory
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}

// ------------------------------------------------------------------ per-weapon detail on top of the base models
/** suppressed: with the bought suppressor fitted (pistols and SMGs; HUD pictures follow the player's mods) */
export function weaponModel(id: string, suppressed = false): THREE.Object3D {
  const w = weapon(id);
  const kind = gunKindOf(w.category) as GunKind;
  if (id === 'r357') return revolver();
  const g = new THREE.Group();
  g.add(buildGun(kind, false, suppressed).g);
  const X = Math.PI / 2;
  switch (id) {
    case 'sr4s': part(g, cyl(0.022, 0.022, 0.2), 0, 0.008, 0.72, X); break; // integral suppressor
    case 'aro': part(g, cyl(0.022, 0.022, 0.16), 0, 0.09, 0.1, X); part(g, rb(0.03, 0.05, 0.04), 0, 0.055, 0.1); break; // magnified optic
    case 'fb25': part(g, rb(0.035, 0.04, 0.12), 0, 0.075, 0.28); break; // carry-handle sight
    case 'pdw50': part(g, rb(0.05, 0.03, 0.28, 0.01), 0, 0.055, 0.1); break; // top-fed magazine
    case 'vx45': part(g, rb(0.04, 0.09, 0.08), 0, -0.07, 0.2); break; // linear recoil housing
    case 'mag12': part(g, rb(0.05, 0.1, 0.08), 0, -0.1, 0.15); break; // box magazine
    case 'a12': part(g, rb(0.03, 0.12, 0.05), 0, -0.1, 0.12); break;
    case 'vg338': part(g, cyl(0.012, 0.014, 0.16), 0, 0.01, 0.94, X); bipod(g, 0.62); break;
    case 'dmr20': bipod(g, 0.55); break;
    case 'scout8': part(g, rb(0.02, 0.04, 0.04), 0, -0.04, 0.02); break;
    case 'lmg249': bipod(g, 0.62); break;
    case 'gp762': bipod(g, 0.6); part(g, rb(0.06, 0.02, 0.36), 0, 0.05, 0.13); break;
    case 'ap18': part(g, rb(0.028, 0.1, 0.04), 0, -0.13, -0.01, 0.22); break; // extended mag
    case 'fs7': part(g, rb(0.03, 0.03, 0.06), 0, 0.02, 0.17); break;
    case 'hc50': part(g, rb(0.036, 0.042, 0.23), 0, 0.022, 0.08); break;
  }
  return g;
}
function bipod(g: THREE.Group, z: number) {
  for (const s of [-1, 1]) part(g, cyl(0.006, 0.006, 0.2, 6), s * 0.03, -0.1, z, 0.5, 0, s * 0.35);
}
function revolver(): THREE.Group {
  const g = new THREE.Group();
  const X = Math.PI / 2;
  part(g, cyl(0.013, 0.013, 0.16, 12), 0, 0.03, 0.14, X); // barrel
  part(g, rb(0.022, 0.018, 0.16), 0, 0.048, 0.14); // top strap / rib
  part(g, cyl(0.03, 0.03, 0.05, 6), 0, 0.02, 0.03, X); // cylinder
  part(g, rb(0.03, 0.05, 0.07), 0, 0.02, -0.02);
  part(g, rb(0.032, 0.1, 0.045, 0.012), 0, -0.05, -0.05, 0.3); // grip
  part(g, new THREE.TorusGeometry(0.018, 0.004, 6, 16, Math.PI), 0, -0.01, 0.02, 0, X, 0); // trigger guard
  return g;
}

// ------------------------------------------------------------------ gear
export function gearModel(id: string): THREE.Object3D {
  const g = new THREE.Group();
  const X = Math.PI / 2;
  // palette: coyote/ranger-green kit, olive-drab ordnance, bright safety colours where real kit has them
  const COY = 0x8a7350, COY2 = 0x6e5c40, RG = 0x4a5a3a, OD = 0x4b5a32, STEEL = 0x9a9ea3, METAL = 0x6d7176, BLK = 0x1c1e20, GRY = 0x55595e;
  switch (id) {
    case 'vest': case 'vesthelm': {
      part(g, rb(0.34, 0.4, 0.08, 0.04), 0, 0, 0, 0, 0, 0, COY); // front plate carrier
      for (const x of [-0.11, 0, 0.11]) part(g, rb(0.09, 0.12, 0.05, 0.015), x, -0.1, 0.06, 0, 0, 0, RG); // mag pouches
      part(g, rb(0.1, 0.07, 0.05, 0.015), -0.1, 0.08, 0.055, 0, 0, 0, RG);
      for (const x of [-0.14, 0.14]) part(g, rb(0.07, 0.12, 0.06, 0.02), x, 0.24, -0.02, 0, 0, 0, COY2); // shoulder straps
      part(g, rb(0.42, 0.07, 0.1, 0.02), 0, -0.19, -0.02, 0, 0, 0, COY2); // cummerbund
      if (id === 'vesthelm') {
        const h = part(g, new THREE.SphereGeometry(0.16, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), 0.38, 0.05, 0, 0, 0, 0, 0x5a6248);
        h.scale.set(1, 0.9, 1.1);
        part(g, rb(0.06, 0.05, 0.05), 0.38, 0.16, 0.14, 0, 0, 0, BLK); // NVG shroud
        for (const s of [-1, 1]) part(g, rb(0.2, 0.02, 0.01), 0.38, 0.02, s * 0.12, 0, 0, 0, METAL); // rails
      }
      g.rotation.y = -0.35;
      break;
    }
    case 'frag':
      part(g, new THREE.SphereGeometry(0.06, 14, 10), 0, 0, 0, 0, 0, 0, OD);
      part(g, cyl(0.022, 0.022, 0.04, 10), 0, 0.07, 0, 0, 0, 0, METAL);
      part(g, rb(0.016, 0.1, 0.012, 0.004), 0.03, 0.03, 0, 0, 0, -0.35, STEEL); // spoon
      part(g, new THREE.TorusGeometry(0.018, 0.003, 6, 14), -0.03, 0.085, 0, X, 0, 0, 0xc8ccd0); // pin ring
      break;
    case 'flash':
      part(g, cyl(0.035, 0.035, 0.13, 16), 0, 0, 0, 0, 0, 0, 0x5d6268);
      for (const y of [-0.04, 0, 0.04]) for (let a = 0; a < 6.28; a += 1.05) part(g, cyl(0.007, 0.007, 0.004, 6), Math.cos(a) * 0.035, y, Math.sin(a) * 0.035, 0, 0, X, BLK);
      part(g, cyl(0.02, 0.02, 0.03, 10), 0, 0.08, 0, 0, 0, 0, METAL); part(g, rb(0.014, 0.11, 0.01, 0.004), 0.03, 0.03, 0, 0, 0, -0.2, STEEL);
      part(g, cyl(0.036, 0.036, 0.012, 16), 0, -0.05, 0, 0, 0, 0, 0xe8e2c8); // pale marking band
      break;
    case 'smoke':
      part(g, cyl(0.04, 0.04, 0.15, 18), 0, 0, 0, 0, 0, 0, 0x8a8f94);
      for (let a = 0; a < 6.28; a += 1.26) part(g, cyl(0.008, 0.008, 0.004, 6), Math.cos(a) * 0.04, 0.065, Math.sin(a) * 0.04, 0, 0, X, BLK);
      part(g, cyl(0.022, 0.022, 0.03, 10), 0, 0.09, 0, 0, 0, 0, METAL); part(g, rb(0.014, 0.12, 0.01, 0.004), 0.035, 0.03, 0, 0, 0, -0.2, STEEL);
      part(g, cyl(0.042, 0.042, 0.03, 18), 0, 0.035, 0, 0, 0, 0, 0x3a8a4a); // green smoke-colour band
      break;
    case 'incendiary':
      part(g, cyl(0.038, 0.038, 0.14, 16), 0, 0, 0, 0, 0, 0, 0x5a1e14);
      part(g, cyl(0.041, 0.041, 0.03, 16), 0, -0.03, 0, 0, 0, 0, 0xd2481e); // red-orange hazard band
      part(g, cyl(0.022, 0.022, 0.03, 10), 0, 0.085, 0, 0, 0, 0, METAL); part(g, rb(0.014, 0.11, 0.01, 0.004), 0.034, 0.03, 0, 0, 0, -0.2, STEEL);
      break;
    case 'decoy':
      part(g, cyl(0.03, 0.03, 0.12, 14), 0, 0, 0, 0, 0, 0, 0xd0a52a);
      part(g, cyl(0.036, 0.03, 0.03, 14), 0, -0.07, 0, 0, 0, 0, BLK);
      part(g, cyl(0.004, 0.004, 0.08, 6), 0.01, 0.1, 0, 0, 0, 0, BLK); // antenna
      part(g, new THREE.SphereGeometry(0.008, 8, 6), 0.01, 0.14, 0, 0, 0, 0, 0xff3030); // tip LED
      break;
    case 'medkit':
      part(g, rb(0.3, 0.2, 0.1, 0.03), 0, 0, 0, 0, 0, 0, 0xc8232c);
      part(g, rb(0.14, 0.03, 0.03, 0.01), 0, 0.12, 0, 0, 0, 0, BLK); // handle
      part(g, rb(0.08, 0.025, 0.004), 0, 0, 0.052, 0, 0, 0, 0xf4f4f0); part(g, rb(0.025, 0.08, 0.004), 0, 0, 0.052, 0, 0, 0, 0xf4f4f0); // cross
      part(g, rb(0.3, 0.012, 0.102, 0.004), 0, 0.03, 0, 0, 0, 0, 0x8a1a20); // lid seam
      g.rotation.y = -0.4;
      break;
    case 'battery':
      part(g, rb(0.08, 0.2, 0.05, 0.012), 0, 0, 0, 0, 0, 0, BLK);
      part(g, rb(0.03, 0.02, 0.03, 0.006), 0, 0.11, 0, 0, 0, 0, 0xb07a2a); // terminal
      part(g, rb(0.082, 0.04, 0.052, 0.008), 0, -0.03, 0, 0, 0, 0, 0xe0b020); // label band
      g.rotation.y = -0.5;
      break;
    case 'plate':
      part(g, rb(0.25, 0.32, 0.03, 0.05), 0, 0, 0, 0, 0, 0, GRY);
      part(g, rb(0.2, 0.26, 0.01, 0.04), 0, 0, 0.02, 0, 0, 0, 0x3a3d41);
      g.rotation.set(0.1, -0.5, 0);
      break;
    case 'bypass':
      part(g, rb(0.32, 0.12, 0.2, 0.02), 0, 0, 0, 0, 0, 0, 0xd06a1a); // tool case
      part(g, rb(0.12, 0.03, 0.03, 0.01), 0, 0.075, 0, 0, 0, 0, BLK);
      part(g, rb(0.12, 0.02, 0.07, 0.008), -0.05, 0.075, 0.12, 0, 0, 0, 0xe8b020); // multimeter
      for (const s of [-1, 1]) part(g, cyl(0.004, 0.004, 0.22, 6), 0.06 + s * 0.02, 0.07, 0.16, 0.4, 0, s * 1.1, s < 0 ? 0xc02020 : BLK); // probe wires
      g.rotation.y = -0.4;
      break;
    case 'torchmod':
      part(g, cyl(0.03, 0.022, 0.05, 16), 0, 0, 0.1, X, 0, 0, 0x2a2c2f);
      part(g, cyl(0.022, 0.022, 0.16, 14), 0, 0, 0, X, 0, 0, BLK);
      part(g, rb(0.03, 0.03, 0.06, 0.006), 0, -0.03, 0.02, 0, 0, 0, METAL); // rail mount
      part(g, new THREE.TorusGeometry(0.028, 0.003, 6, 18), 0, 0, 0.126, 0, 0, 0, 0xc0c4c8);
      part(g, cyl(0.026, 0.026, 0.004, 16), 0, 0, 0.125, X, 0, 0, 0xd8ecff); // lens
      break;
    case 'suppressor':
      part(g, cyl(0.03, 0.03, 0.2, 20), 0, 0, 0, X, 0, 0, 0x1d1f22); // can
      for (const z of [-0.1, 0.1]) part(g, cyl(0.032, 0.032, 0.012, 20), 0, 0, z, X, 0, 0, 0x2c2f33); // end caps
      part(g, cyl(0.012, 0.012, 0.03, 12), 0, 0, -0.12, X, 0, 0, METAL); // threaded mount
      part(g, rb(0.004, 0.012, 0.12, 0.002), 0, 0.03, 0, 0, 0, 0, 0x4a4e52); // index flat
      g.rotation.y = -0.6;
      break;
    case 'pouch':
      part(g, rb(0.14, 0.18, 0.07, 0.025), 0, 0, 0, 0, 0, 0, RG);
      part(g, rb(0.145, 0.05, 0.075, 0.015), 0, 0.075, 0.003, 0, 0, 0, OD); // flap
      for (const x of [-0.035, 0.035]) part(g, rb(0.02, 0.18, 0.005, 0.004), x, 0, 0.038, 0, 0, 0, COY2); // webbing
      g.rotation.y = -0.45;
      break;
  }
  return g;
}

let rt: THREE.WebGLRenderTarget | null = null;
let post: { scene: THREE.Scene; cam: THREE.OrthographicCamera; mat: THREE.ShaderMaterial } | null = null;
const normalMat = new THREE.MeshNormalMaterial();

/** Screen-space line art: Sobel over normals + depth gives silhouettes and creases for any shape. */
function draw(obj: THREE.Object3D, side: boolean): string {
  const PR = 2, BW = W * PR, BH = H * PR;
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(BW, BH, false);
    rt = new THREE.WebGLRenderTarget(BW, BH, { depthTexture: new THREE.DepthTexture(BW, BH), samples: 0 });
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { tN: { value: rt.texture }, tD: { value: rt.depthTexture }, px: { value: new THREE.Vector2(1 / BW, 1 / BH) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tN; uniform sampler2D tD; uniform vec2 px; varying vec2 vUv;
        vec3 n(vec2 o){ return texture2D(tN, vUv + o * px).rgb; }
        float d(vec2 o){ return texture2D(tD, vUv + o * px).r; }
        void main(){
          float en = 0.0, ed = 0.0;
          vec3 c = n(vec2(0.0)); float cd = d(vec2(0.0));
          for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
            vec2 o = vec2(float(i), float(j)) * 1.2;
            en = max(en, length(n(o) - c));
            ed = max(ed, abs(d(o) - cd));
          }
          float edge = max(smoothstep(0.25, 0.55, en), smoothstep(0.002, 0.008, ed));
          float body = cd < 0.9999 ? 0.07 : 0.0;
          gl_FragColor = vec4(vec3(0.37, 0.89, 1.0), max(edge, body));
        }`,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    post = { scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mat };
  }
  const scene = new THREE.Scene();
  scene.add(obj);
  obj.updateMatrixWorld(true);
  obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = normalMat; });
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  // weapons: side profile from -x (muzzle to the right); gear: gentle 3/4 view from the front
  if (side) cam.position.set(c.x - 3, c.y + 0.35, c.z + 0.35);
  else cam.position.set(c.x + 0.6, c.y + 0.8, c.z + 3);
  cam.lookAt(c);
  cam.updateMatrixWorld();
  const pts: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(new THREE.Vector3(x, y, z).applyMatrix4(cam.matrixWorldInverse));
  const bx = Math.max(...pts.map((p) => Math.abs(p.x))), by = Math.max(...pts.map((p) => Math.abs(p.y)));
  const aspect = W / H;
  const half = Math.max(by, bx / aspect) * 1.12;
  cam.left = -half * aspect; cam.right = half * aspect; cam.top = half; cam.bottom = -half;
  // tighten the depth range to the object so depth edges have precision
  const zs = pts.map((p) => -p.z);
  cam.near = Math.max(0.01, Math.min(...zs) - 0.05); cam.far = Math.max(...zs) + 0.05;
  cam.updateProjectionMatrix();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(post!.scene, post!.cam);
  return renderer.domElement.toDataURL('image/png');
}

/** Data URL of the wireframe drawing for an armory weapon or gear id (null if WebGL is unavailable). */
export function armoryArt(id: string, isWeapon: boolean, suppressed = false): string | null {
  const key = (isWeapon ? 'w:' : 'g:') + id + (suppressed ? ':sup' : '');
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const url = draw(isWeapon ? weaponModel(id, suppressed) : gearModel(id), isWeapon);
    cache.set(key, url);
    return url;
  } catch {
    return null;
  }
}
