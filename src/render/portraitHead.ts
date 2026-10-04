import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { OfficerLook } from './operator';

/**
 * High-detail portrait head, used only for the dialogue portraits (never in game): a sculpted face mesh with
 * per-person proportions, painted skin (tone variation, cheeks, lips, brows, stubble shadow) with pore and wrinkle
 * bump, wet eyes with coloured irises and lids, shell-textured hair and facial hair, ears, neck and a police
 * uniform with cap. Units: head radius ≈ 1.
 */

// ------------------------------------------------------------------ helpers
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const sstep = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function rngOf(seed: number) { let s = (Math.floor(seed * 2654435761) >>> 0) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function hash2(x: number, y: number) { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return mix(mix(hash2(ix, iy), hash2(ix + 1, iy), u), mix(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), u), v);
}
const fbm = (x: number, y: number) => vnoise(x, y) * 0.5 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.2;
const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/** Per-person face proportions (deterministic from a seed). */
interface Face { width: number; jaw: number; chin: number; nose: number; noseW: number; lips: number; brow: number; cheek: number; age: number; eyeColor: number; browArch: number }
function faceFor(seed: number, look: OfficerLook): Face {
  const r = rngOf(seed);
  const hcR = look.hairColor !== undefined ? (look.hairColor >> 16) & 255 : 0, hcB = look.hairColor !== undefined ? look.hairColor & 255 : 0;
  const grey = hcR > 140 && Math.abs(hcR - hcB) < 20 || (look.facialColor !== undefined && ((look.facialColor >> 16) & 255) > 140 && Math.abs(((look.facialColor >> 16) & 255) - (look.facialColor & 255)) < 20);
  const eyes = [0x3a2414, 0x4a2e18, 0x5a3a1e, 0x2e4a6a, 0x4a6a3a, 0x6a5a3a, 0x2a1a10];
  return {
    width: 0.72 + r() * 0.07, jaw: 0.75 + r() * 0.2, chin: 0.85 + r() * 0.3, nose: 0.85 + r() * 0.35, noseW: 0.85 + r() * 0.35,
    lips: 0.8 + r() * 0.45, brow: 0.8 + r() * 0.5, cheek: 0.8 + r() * 0.5, age: grey ? 0.75 + r() * 0.25 : r() * 0.45,
    eyeColor: eyes[Math.floor(r() * eyes.length)], browArch: r(),
  };
}

// ------------------------------------------------------------------ face sculpt (shared by mesh + textures)
/** Gaussian bump in face space (unit-sphere x, y), only on the front of the head. */
const G = (x: number, y: number, z: number, cx: number, cy: number, sx: number, sy: number) => Math.exp(-(((x - cx) ** 2) / (sx * sx) + ((y - cy) ** 2) / (sy * sy))) * sstep(0.05, 0.45, z);

/** Radial offset of the head surface in direction (x, y, z) (unit vector). */
function sculpt(x: number, y: number, z: number, f: Face): number {
  let d = 0;
  for (const s of [-1, 1]) {
    d -= 0.15 * G(x, y, z, s * 0.36, 0.12, 0.15, 0.1); // eye sockets
    d += 0.075 * f.brow * G(x, y, z, s * 0.33, 0.27, 0.22, 0.07); // brow ridge
    d += 0.09 * f.cheek * G(x, y, z, s * 0.52, -0.08, 0.17, 0.13); // cheekbones
    d -= 0.05 * G(x, y, z, s * 0.46, -0.36, 0.16, 0.14); // cheek hollow
    d += 0.08 * f.noseW * G(x, y, z, s * 0.1 * f.noseW, -0.3, 0.06, 0.045); // nostril wings
    d -= 0.035 * G(x, y, z, s * 0.22, -0.4, 0.035, 0.12); // nasolabial fold
    d -= 0.04 * G(x, y, z, s * 0.2, -0.47, 0.04, 0.04); // mouth corners
  }
  // nose: a bridge rising from between the eyes to a rounded tip, nostrils tucked under it
  const ridge = Math.exp(-((x * x) / (0.055 * f.noseW) ** 2)) * sstep(0.2, -0.22, y) * sstep(-0.36, -0.24, y) * sstep(0.05, 0.45, z);
  d += 0.3 * f.nose * ridge;
  d += 0.16 * f.nose * G(x, y, z, 0, -0.26, 0.075 * f.noseW, 0.065);
  d -= 0.07 * G(x, y, z, 0, -0.335, 0.05 * f.noseW, 0.025);
  d -= 0.025 * G(x, y, z, 0, -0.38, 0.022, 0.04); // philtrum
  // lips and mouth line
  d += 0.045 * f.lips * G(x, y, z, 0, -0.43, 0.17, 0.035);
  d += 0.055 * f.lips * G(x, y, z, 0, -0.515, 0.15, 0.04);
  d -= 0.04 * G(x, y, z, 0, -0.47, 0.18, 0.01);
  d -= 0.05 * G(x, y, z, 0, -0.6, 0.11, 0.035); // under-lip
  // chin and forehead
  d += 0.09 * f.chin * G(x, y, z, 0, -0.76, 0.24, 0.1);
  d += 0.04 * G(x, y, z, 0, 0.55, 0.45, 0.25);
  return d;
}

/** Overall skull shape: taller than wide, tapering jaw, flattened sides and back of the neck. */
function skull(v: THREE.Vector3, f: Face) {
  const { x, y, z } = v;
  let sx = f.width, sz = 0.92;
  const sy = 1.0;
  if (y < -0.2) { const t = sstep(-0.2, -1, y); sx *= mix(1, 0.72 + 0.22 * f.jaw, t); sz *= mix(1, 0.85, t * (z < 0 ? 1 : 0.3)); }
  if (y > 0.4) sx *= mix(1, 0.92, sstep(0.4, 1, y));
  const r = 1 + sculpt(x, y, z, f) + (z < 0 ? 0.05 * sstep(-0.2, -0.8, z) * sstep(-0.3, 0.4, y) : 0);
  const zf = z > 0 ? z - 0.16 * z * z * z * sstep(-0.9, -0.2, y) * sstep(0.8, 0.3, y) : z; // flatter face plane
  return new THREE.Vector3(x * sx * r, y * sy * r, zf * sz * r);
}

/** A point on the sculpted head surface in unit-sphere direction (x, y, z), and its outward normal. */
function surface(f: Face, x: number, y: number, z: number) {
  const d = new THREE.Vector3(x, y, z).normalize();
  const p = skull(d, f);
  const e = 0.01, a = skull(new THREE.Vector3(d.x + e, d.y, d.z).normalize(), f), b = skull(new THREE.Vector3(d.x, d.y + e, d.z).normalize(), f);
  const n = new THREE.Vector3().crossVectors(a.sub(p), b.sub(p)).normalize();
  if (n.dot(d) < 0) n.negate();
  return { p, n };
}

// ------------------------------------------------------------------ textures (painted in sphere UV space)
const TW = 1024, TH = 512;
/** three's SphereGeometry: x = -cos(φ)sin(θ), y = cos(θ), z = sin(φ)sin(θ), φ = u·2π, θ = (1 - v)·π */
function dirOfUV(u: number, v: number) { const phi = u * Math.PI * 2, th = (1 - v) * Math.PI; return [-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th)]; }

/** Hairline: is direction (x, y, z) inside the scalp region? (soft 0..1) */
function scalpMask(x: number, y: number, z: number) {
  const front = 0.5 - 0.25 * x * x;
  const h = mix(-0.55, front, sstep(-0.35, 0.55, z));
  const sideburn = Math.abs(x) > 0.55 && y > -0.1 + 0.25 * sstep(0.3, 0.7, z) && y < 0.3 && z > -0.2 && z < 0.55 ? 1 : 0;
  return Math.max(sstep(h - 0.04, h + 0.04, y), sideburn);
}
function facialMask(kind: string, x: number, y: number, z: number) {
  const front = sstep(0.0, 0.3, z);
  const stache = Math.exp(-((x * x) / 0.04 + ((y + 0.38) ** 2) / 0.003)) * front;
  const lips = Math.exp(-((x * x) / 0.02 + ((y + 0.48) ** 2) / 0.006));
  const chin = Math.exp(-((x * x) / 0.02 + ((y + 0.7) ** 2) / 0.03)) * front;
  const jaw = sstep(-0.3, -0.48, y) * sstep(-0.98, -0.72, y) * sstep(-0.35, 0.0, z) * (1 - Math.exp(-((x * x) / 0.01 + ((y + 0.36) ** 2) / 0.004)));
  const sideburn = Math.abs(x) > 0.62 ? sstep(0.25, -0.1, y) * sstep(-0.8, -0.4, y) * sstep(-0.3, 0.2, z) : 0;
  switch (kind) {
    case 'moustache': return stache;
    case 'goatee': return Math.max(stache, chin * 1.2) * (1 - lips);
    case 'beard': case 'stubble': return Math.max(jaw, stache, chin) * (1 - lips * 0.9);
    case 'mutton': return Math.max(stache, sideburn, jaw * sstep(0.12, 0.3, Math.abs(x))) * (1 - lips);
    default: return 0;
  }
}

function canvasTex(draw: (img: ImageData) => void, srgb = true) {
  const c = document.createElement('canvas'); c.width = TW; c.height = TH;
  const g = c.getContext('2d')!;
  const img = g.createImageData(TW, TH);
  draw(img);
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function skinTextures(look: OfficerLook, f: Face) {
  const [sr, sg, sb] = rgb(look.skin ?? 0xc49a78);
  const [hr, hg, hb] = rgb(look.hairColor ?? 0x2a2018);
  const [fr, fg, fb] = rgb(look.facialColor ?? look.hairColor ?? 0x2a2018);
  const facial = look.facial ?? 'none';
  const dark = (sr + sg + sb) / 765 < 0.45;
  const map = canvasTex((img) => {
    const d = img.data;
    for (let py = 0; py < TH; py++) for (let px = 0; px < TW; px++) {
      const u = px / TW, v = 1 - py / TH, [x, y, z] = dirOfUV(u, v);
      let r = sr, g = sg, b = sb;
      const n = fbm(px / 18, py / 18) - 0.5, fine = hash2(px, py) - 0.5;
      r += n * 18 + fine * 6; g += n * 14 + fine * 5; b += n * 12 + fine * 5;
      // warm blush on cheeks and nose; darker under the eyes
      let blush = G(x, y, z, 0, -0.27, 0.08, 0.06) * 0.6;
      for (const s of [-1, 1]) blush += G(x, y, z, s * 0.42, -0.18, 0.2, 0.15) * 0.5;
      r += blush * (dark ? 6 : 16); g -= blush * 4; b -= blush * 3;
      let shade = 0;
      for (const s of [-1, 1]) shade += G(x, y, z, s * 0.33, 0.02, 0.13, 0.045) * 0.6;
      r -= shade * 26; g -= shade * 26; b -= shade * 18;
      // lips
      const lip = Math.max(G(x, y, z, 0, -0.43, 0.14, 0.03), G(x, y, z, 0, -0.51, 0.12, 0.035));
      r = mix(r, dark ? sr * 0.8 : sr * 0.85 + 22, lip * 0.55); g = mix(g, sg * 0.66, lip * 0.55); b = mix(b, sb * 0.68, lip * 0.55);
      // eyebrows: arched strokes with hair-like streaks
      for (const s of [-1, 1]) {
        const bx = (x - s * 0.31) / 0.17, arch = 0.285 + 0.035 * (1 - bx * bx) * (0.6 + f.browArch * 0.6);
        const m = Math.exp(-(bx * bx) * 1.6) * Math.exp(-((y - arch) ** 2) / (0.0009 * f.brow)) * sstep(0.1, 0.4, z);
        const streak = 0.55 + 0.45 * Math.sin(px * 1.7 + py * 0.6 + hash2(px >> 1, py) * 2);
        const bm = clamp01(m * 1.6) * streak;
        r = mix(r, hr * 0.8, bm); g = mix(g, hg * 0.8, bm); b = mix(b, hb * 0.8, bm);
      }
      // stubble / beard shadow, and the scalp under short hair
      const fm = facialMask(facial === 'none' ? 'stubble' : facial, x, y, z) * (facial === 'none' ? 0.1 : facial === 'stubble' ? 0.55 : 0.4);
      const dots = hash2(px * 3.1, py * 2.7) > 0.5 ? 1 : 0.55;
      r = mix(r, fr * 0.9, fm * dots); g = mix(g, fg * 0.9, fm * dots); b = mix(b, fb * 0.9, fm * dots);
      if (look.hair !== 'bald') { const sm = scalpMask(x, y, z) * 0.85; r = mix(r, hr, sm); g = mix(g, hg, sm); b = mix(b, hb, sm); }
      const i = (py * TW + px) * 4;
      d[i] = Math.max(0, Math.min(255, r)); d[i + 1] = Math.max(0, Math.min(255, g)); d[i + 2] = Math.max(0, Math.min(255, b)); d[i + 3] = 255;
    }
  });
  const bump = canvasTex((img) => {
    const d = img.data;
    for (let py = 0; py < TH; py++) for (let px = 0; px < TW; px++) {
      const u = px / TW, v = 1 - py / TH, [x, y, z] = dirOfUV(u, v);
      let h = 0.5 + (hash2(px * 1.3, py * 1.9) - 0.5) * 0.25 + (vnoise(px / 3, py / 3) - 0.5) * 0.2; // pores
      const a = f.age;
      if (a > 0.15) { // forehead lines, crow's feet, nasolabial and under-eye creases
        h -= a * 0.35 * Math.max(0, Math.sin(y * 70)) ** 6 * G(x, y, z, 0, 0.5, 0.35, 0.12);
        for (const s of [-1, 1]) {
          h -= a * 0.4 * Math.max(0, Math.sin(Math.atan2(y - 0.1, x - s * 0.55) * 14)) ** 8 * G(x, y, z, s * 0.6, 0.1, 0.08, 0.08);
          h -= a * 0.3 * G(x, y, z, s * 0.2, -0.38, 0.025, 0.1);
          h -= a * 0.25 * Math.max(0, Math.sin(y * 90)) ** 4 * G(x, y, z, s * 0.33, -0.02, 0.1, 0.04);
        }
      }
      const lip = Math.max(G(x, y, z, 0, -0.43, 0.14, 0.03), G(x, y, z, 0, -0.51, 0.12, 0.035));
      h += lip * Math.sin(x * 160) * 0.06; // lip creases
      const i = (py * TW + px) * 4, c = Math.max(0, Math.min(255, h * 255));
      d[i] = d[i + 1] = d[i + 2] = c; d[i + 3] = 255;
    }
  }, false);
  return { map, bump };
}

/** Strand-height map for shell hair: 0 = no hair, up to 1 = full length (alpha-tested per shell). */
function strandMap(mask: (x: number, y: number, z: number) => number, density: number, clump: number) {
  return canvasTex((img) => {
    const d = img.data;
    for (let py = 0; py < TH; py++) for (let px = 0; px < TW; px++) {
      const u = px / TW, v = 1 - py / TH, [x, y, z] = dirOfUV(u, v);
      const m = mask(x, y, z);
      let h = 0;
      if (m > 0.01 && hash2(px, py) < density) {
        const cl = clump ? vnoise(px / clump, py / clump) : 1;
        h = m * (0.35 + 0.65 * hash2(px * 0.7, py * 1.3)) * (0.5 + 0.5 * cl);
      }
      const i = (py * TW + px) * 4, c = Math.max(0, Math.min(255, h * 255));
      d[i] = d[i + 1] = d[i + 2] = c; d[i + 3] = 255;
    }
  }, false);
}

/** Eyeball texture: sclera with faint veins around a fibrous iris (sphere UV, iris centred at u = 0.25 → +z). */
function eyeTexture(color: number) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  const [r, gg, b] = rgb(color);
  g.fillStyle = '#ebe5df'; g.fillRect(0, 0, 512, 256);
  const cx = 128, cy = 128; // u = 0.25, v = 0.5 → the +z pole of the eyeball
  g.strokeStyle = 'rgba(190,70,70,0.22)'; g.lineWidth = 0.8;
  for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * 110, cy + Math.sin(a) * 110); g.quadraticCurveTo(cx + Math.cos(a + 0.2) * 80, cy + Math.sin(a + 0.2) * 80, cx + Math.cos(a) * 48, cy + Math.sin(a) * 48); g.stroke(); }
  const R = 34;
  const grd = g.createRadialGradient(cx, cy, 5, cx, cy, R);
  grd.addColorStop(0, `rgb(${r * 0.55},${gg * 0.55},${b * 0.55})`); grd.addColorStop(0.45, `rgb(${r},${gg},${b})`); grd.addColorStop(0.88, `rgb(${r * 0.7},${gg * 0.7},${b * 0.7})`); grd.addColorStop(1, 'rgb(18,14,12)');
  g.fillStyle = grd; g.beginPath(); g.ellipse(cx, cy, R, R, 0, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 140; i++) { const a = (i / 140) * Math.PI * 2 + hash2(i, 3), l = 12 + hash2(i, 7) * 22; g.strokeStyle = `rgba(${Math.min(255, r + 70)},${Math.min(255, gg + 60)},${Math.min(255, b + 50)},${0.15 + hash2(i, 9) * 0.25})`; g.beginPath(); g.moveTo(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10); g.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); g.stroke(); }
  g.fillStyle = '#050405'; g.beginPath(); g.arc(cx, cy, 10, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ------------------------------------------------------------------ meshes
function headGeometry(f: Face, segW = 160, segH = 120) {
  const g = new THREE.SphereGeometry(1, segW, segH);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); const o = skull(v, f); p.setXYZ(i, o.x, o.y, o.z); }
  g.computeVertexNormals();
  return g;
}
/** Shell copies of the head pushed out along normals; each shell alpha-tests the strand map at its height. */
function shells(base: THREE.BufferGeometry, n: number, len: number, strands: THREE.Texture, color: number, rough = 0.55) {
  const grp = new THREE.Group();
  for (let k = 0; k < n; k++) {
    const g = base.clone();
    const p = g.attributes.position, nrm = g.attributes.normal, off = ((k + 1) / n) * len;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + nrm.getX(i) * off, p.getY(i) + nrm.getY(i) * off, p.getZ(i) + nrm.getZ(i) * off);
    const c = new THREE.Color(color).multiplyScalar(0.55 + 0.45 * ((k + 1) / n)); // darker toward the roots
    grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0, alphaMap: strands, alphaTest: (k + 0.5) / n, side: THREE.DoubleSide })));
  }
  return grp;
}

function eye(f: Face, side: number, skinMat: THREE.Material) {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 48, 32), new THREE.MeshPhysicalMaterial({ map: eyeTexture(f.eyeColor), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.04 }));
  g.add(ball);
  // lids: partial shells of skin over the top and bottom of the eyeball
  const up = new THREE.Mesh(new THREE.SphereGeometry(0.128, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.42), skinMat);
  up.rotation.x = 0.08 + f.age * 0.12;
  const lo = new THREE.Mesh(new THREE.SphereGeometry(0.126, 32, 12, 0, Math.PI * 2, Math.PI * 0.68, Math.PI * 0.32), skinMat);
  lo.rotation.x = -0.32;
  const lash = new THREE.Mesh(new THREE.TorusGeometry(0.104, 0.007, 6, 24, Math.PI * 0.75), new THREE.MeshStandardMaterial({ color: 0x120c0a, roughness: 0.6 }));
  lash.rotation.set(-0.5, 0, Math.PI * 0.125); lash.position.set(0, 0.012, 0.03);
  g.add(up, lo, lash);
  const { p, n } = surface(f, side * 0.36, 0.12, 0.92);
  g.position.copy(p).addScaledVector(n, -0.06);
  return g;
}

function ear(side: number, skinMat: THREE.Material, f: Face) {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.04, 12, 28), skinMat); rim.scale.set(0.75, 1.15, 0.6);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), skinMat); bowl.scale.set(0.6, 1.0, 0.25);
  const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), skinMat); lobe.position.set(0, -0.15, 0.01);
  g.add(rim, bowl, lobe);
  g.rotation.y = side * (Math.PI / 2 - 0.3);
  const { p } = surface(f, side, 0.02, -0.08);
  g.position.copy(p).add(new THREE.Vector3(side * 0.02, 0, 0));
  return g;
}

function uniform(chief: boolean) {
  const shirt = 0x223058, navy = 0x1a2440;
  const cloth = (c: number, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const metal = (c: number) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.7, roughness: 0.45, envMapIntensity: 0.5 });
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.62), cloth(shirt));
  torso.scale.set(2.2, 1.0, 1.05); torso.position.set(0, -2.42, -0.15);
  g.add(torso);
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.05), cloth(shirt, 0.8)); // collar flap
    c.position.set(s * 0.26, -1.45, 0.34); c.rotation.set(0.35, s * -0.5, s * 0.55);
    const ep = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.28), cloth(navy, 0.7)); // epaulette
    ep.position.set(s * 1.35, -1.55, -0.1); ep.rotation.z = s * -0.32;
    const btn = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), metal(0xc8a050)); btn.position.set(s * 1.1, -1.47, -0.05);
    g.add(c, ep, btn);
    if (chief) for (let k = 0; k < 3; k++) { const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), metal(0xe8c050)); st.position.set(s * (1.26 + k * 0.12), -1.52 - k * 0.04, 0.02); g.add(st); }
  }
  const tie = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.7, 4), cloth(0x0c1020, 0.6));
  tie.rotation.set(Math.PI, Math.PI / 4, 0); tie.scale.set(1, 1, 0.35); tie.position.set(0, -1.86, 0.62);
  const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 6), metal(chief ? 0xc8a040 : 0x8a9096));
  badge.rotation.x = Math.PI / 2 - 0.25; badge.position.set(-0.78, -1.98, 0.88);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.02), new THREE.MeshStandardMaterial({ color: 0x6a6450, metalness: 0.5, roughness: 0.5, envMapIntensity: 0.5 }));
  bar.position.set(0.78, -1.98, 0.9); bar.rotation.x = -0.25;
  const radio = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.12), new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5 }));
  radio.position.set(1.05, -1.66, 0.5); radio.rotation.z = -0.3;
  g.add(tie, badge, bar, radio);
  return g;
}

function hat(kind: string, f: Face) {
  const g = new THREE.Group();
  const navy = new THREE.MeshStandardMaterial({ color: 0x151d36, roughness: 0.82 });
  const black = new THREE.MeshPhysicalMaterial({ color: 0x07080b, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xe0b848, metalness: 0.95, roughness: 0.25 });
  // the head's horizontal half-extents at brow level set the fit
  const yB = 0.55, side = surface(f, 1, yB, 0).p, front = surface(f, 0, yB, 1).p, back = surface(f, 0, yB, -1).p;
  const rx = side.x * 1.06, rz = (front.z - back.z) / 2 * 1.06, cz = (front.z + back.z) / 2, y0 = side.y;
  if (kind === 'cap' || kind === 'chief') {
    // crown flares out above a straight band, like a real peaked cap
    const crown = new THREE.Mesh(new THREE.LatheGeometry([[0.0, 0.84], [0.95, 0.82], [1.24, 0.74], [1.26, 0.66], [1.12, 0.48], [1.0, 0.24], [1.0, 0.0]].map(([x, y]) => new THREE.Vector2(x, y)), 64), navy);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.005, 1.005, 0.2, 64, 1, true), kind === 'chief' ? gold : black);
    band.position.y = 0.1;
    const peak = new THREE.Shape(); peak.absellipse(0, 0, 0.95, 0.55, Math.PI, 0, true, 0);
    const visor = new THREE.Mesh(new THREE.ExtrudeGeometry(peak, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 32 }), black);
    visor.rotation.x = Math.PI / 2 + 0.22; visor.position.set(0, 0.02, 0.62);
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 6), gold);
    badge.rotation.x = Math.PI / 2 - 0.15; badge.position.set(0, 0.4, 1.1);
    const cap = new THREE.Group(); cap.add(crown, band, visor, badge);
    if (kind === 'chief') { const braid = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.035, 8, 48, Math.PI), gold); braid.rotation.x = Math.PI / 2; braid.position.y = -0.0; cap.add(braid); }
    cap.scale.set(rx, 1, rz); cap.position.set(0, y0 - 0.06, cz);
    g.add(cap);
  } else if (kind === 'beanie') {
    const knit = new THREE.MeshStandardMaterial({ color: 0x1c2238, roughness: 0.95 });
    const top = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.5), knit); top.scale.set(rx * 1.1, 1.0, rz * 1.1); top.position.set(0, y0 - 0.2, cz);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.32, 64, 1, true), knit); cuff.scale.set(rx * 1.08, 1, rz * 1.08); cuff.position.set(0, y0 - 0.12, cz);
    g.add(top, cuff);
    for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2, rib = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.31, 0.02), knit); rib.position.set(Math.sin(a) * rx * 1.09, y0 - 0.12, cz + Math.cos(a) * rz * 1.09); rib.rotation.y = a; g.add(rib); }
  } else if (kind === 'helmet') {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshPhysicalMaterial({ color: 0x1a2238, roughness: 0.4, clearcoat: 0.6 }));
    shell.scale.set(rx * 1.2, 1.0, rz * 1.18); shell.position.set(0, y0 - 0.3, cz);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 64), new THREE.MeshStandardMaterial({ color: 0x0c0e14, roughness: 0.6 })); rim.rotation.x = Math.PI / 2; rim.scale.set(rx * 1.2, rz * 1.18, 1); rim.position.set(0, y0 - 0.15, cz);
    g.add(shell, rim);
  }
  return g;
}

function glasses(kind: string, f: Face) {
  const g = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: kind === 'aviators' ? 0xc8a050 : 0x141516, metalness: kind === 'aviators' ? 0.9 : 0.2, roughness: 0.3 });
  const lens = new THREE.MeshPhysicalMaterial({ color: kind === 'glasses' ? 0xe8f2f8 : 0x0a0c10, roughness: 0.05, transparent: true, opacity: kind === 'glasses' ? 0.18 : 0.88, clearcoat: 1 });
  const [sw, sh] = kind === 'aviators' ? [0.14, 0.12] : [0.13, 0.09];
  const nose = surface(f, 0, 0.1, 1).p;
  const zf = nose.z + 0.04;
  for (const s of [-1, 1]) {
    const e = surface(f, s * 0.36, 0.12, 0.92).p, side = surface(f, s * 0.97, 0.12, 0.2).p;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 8, 40), frame); ring.scale.set(sw, sh, 0.12); ring.position.set(e.x, e.y, zf);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(1, 40), lens); glass.scale.set(sw, sh, 1); glass.position.set(e.x, e.y, zf + 0.004);
    const hinge = new THREE.Vector3(e.x + s * sw, e.y + 0.01, zf);
    const end = new THREE.Vector3(side.x + s * 0.03, side.y, side.z - 0.1);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.026, hinge.distanceTo(end)), frame);
    arm.position.copy(hinge).add(end).multiplyScalar(0.5); arm.lookAt(end);
    g.add(ring, glass, arm);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.022, 0.022), frame); bridge.position.set(0, surface(f, 0, 0.14, 1).p.y + 0.02, zf + 0.01);
  g.add(bridge);
  return g;
}

// ------------------------------------------------------------------ scene
export function buildPortraitScene(look: OfficerLook, seed: number, chief = false): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; dispose: () => void } {
  const f = faceFor(seed, look);
  const skin = look.skin ?? 0xc49a78;
  const scene = new THREE.Scene();
  const head = new THREE.Group();
  const geo = headGeometry(f);
  const { map, bump } = skinTextures(look, f);
  const sheen = new THREE.Color(0xffd8c8);
  const skinMat = new THREE.MeshPhysicalMaterial({ map, bumpMap: bump, bumpScale: 1.2, roughness: 0.62, sheen: 0.35, sheenRoughness: 0.7, sheenColor: sheen, clearcoat: 0.04, clearcoatRoughness: 0.6 });
  const flat = new THREE.MeshPhysicalMaterial({ color: skin, roughness: 0.55, sheen: 0.4, sheenColor: sheen });
  head.add(new THREE.Mesh(geo, skinMat));
  for (const s of [-1, 1]) head.add(eye(f, s, flat), ear(s, flat, f));
  // hair
  const hatKind = look.hat ?? 'cap', hair = look.hair ?? 'short', hc = look.hairColor ?? 0x2a2018;
  const hairMat = new THREE.MeshStandardMaterial({ color: hc, roughness: 0.6 });
  if (hair !== 'bald') {
    const len = hair === 'buzz' ? 0.025 : hair === 'curly' ? 0.14 : 0.06;
    const strands = strandMap(scalpMask, hair === 'curly' ? 0.85 : 0.7, hair === 'curly' ? 6 : 0);
    head.add(shells(geo, hair === 'buzz' ? 4 : 10, len, strands, hc));
    if (hair === 'long') {
      // curtain of hair falling from the scalp past the jaw: open at the front, strand-streaked
      const streak = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d')!; for (let x = 0; x < 256; x++) { const v = 0.6 + 0.4 * hash2(x, 1); g.fillStyle = `rgb(${v * 255},${v * 255},${v * 255})`; g.fillRect(x, 0, 1, 64); } const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1); return t; })();
      const curtainMat = new THREE.MeshStandardMaterial({ color: hc, roughness: 0.55, bumpMap: streak, bumpScale: 2, side: THREE.DoubleSide });
      const curtain = new THREE.Mesh(new THREE.CylinderGeometry(f.width * 1.06, f.width * 1.2, 1.5, 64, 4, true, Math.PI * 0.3, Math.PI * 1.4), curtainMat);
      curtain.scale.z = 1.05; curtain.position.set(0, -0.35, -0.06);
      head.add(curtain);
    }
    if (hair === 'bun') { const bun = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 16), hairMat); bun.position.set(0, hatKind === 'bare' ? 0.8 : 0.35, -0.9); head.add(bun); }
    if (hair === 'ponytail') { const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.9, 6, 12), hairMat); tail.position.set(0, -0.35, -1.0); tail.rotation.x = 0.25; head.add(tail); }
  }
  // facial hair
  const facial = look.facial ?? 'none';
  if (facial !== 'none') {
    const strands = strandMap((x, y, z) => facialMask(facial, x, y, z), facial === 'stubble' ? 0.4 : 0.5, facial === 'beard' ? 4 : 0);
    head.add(shells(geo, facial === 'stubble' ? 3 : 8, facial === 'stubble' ? 0.012 : facial === 'beard' ? 0.07 : 0.04, strands, look.facialColor ?? hc, 0.7));
  }
  if (hatKind !== 'bare') head.add(hat(hatKind, f));
  if (look.eyes && look.eyes !== 'none') head.add(glasses(look.eyes, f));
  // extras
  const ex = look.extra ?? 'none';
  const plastic = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.4 });
  if (ex === 'earpiece' || ex === 'headset') { const ep = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), plastic); ep.position.set(f.width * 1.02, 0, 0); const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.9), plastic); wire.position.set(f.width * 0.98, -0.45, -0.05); head.add(ep, wire); }
  if (ex === 'headset') { const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.75), plastic); mic.rotation.set(0, -0.6, 1.15); mic.position.set(0.45, -0.25, 0.55); head.add(mic); }
  if (ex === 'scar') { const sc = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.32, 4, 8), new THREE.MeshStandardMaterial({ color: 0xc0807a, roughness: 0.4 })); sc.position.set(0.42, 0.18, 0.86); sc.rotation.z = 0.5; head.add(sc); }
  if (ex === 'bandage') { const bd = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.02), new THREE.MeshStandardMaterial({ color: 0xece4d4, roughness: 0.9 })); bd.position.set(-0.32, 0.5, 0.9); bd.rotation.set(-0.4, -0.3, 0.3); head.add(bd); }
  if (ex === 'earring') { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 8, 20), new THREE.MeshStandardMaterial({ color: 0xe0b848, metalness: 0.95, roughness: 0.2 })); ring.position.set(-f.width * 1.0, -0.2, 0.02); ring.rotation.y = Math.PI / 2; head.add(ring); }
  head.rotation.y = -0.22; // slight three-quarter turn
  scene.add(head);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.52, 1.0, 40), flat);
  neck.position.set(0, -1.0, -0.2);
  scene.add(neck, uniform(chief));
  // backdrop: mottled photo paper (blue-grey; warm gold for the Chief)
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const bgc = c.getContext('2d')!;
  const grd = bgc.createRadialGradient(110, 90, 10, 128, 128, 200); grd.addColorStop(0, chief ? '#6a5a3a' : '#4a6488'); grd.addColorStop(1, chief ? '#1e180c' : '#121a2a');
  bgc.fillStyle = grd; bgc.fillRect(0, 0, 256, 256);
  const im = bgc.getImageData(0, 0, 256, 256);
  for (let i = 0; i < im.data.length; i += 4) { const n = (fbm(((i / 4) % 256) / 30, Math.floor(i / 1024) / 30) - 0.5) * 30; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; }
  bgc.putImageData(im, 0, 0);
  const bgTex = new THREE.CanvasTexture(c); bgTex.colorSpace = THREE.SRGBColorSpace;
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({ map: bgTex, toneMapped: false }));
  bg.position.set(0, -0.5, -5);
  scene.add(bg);
  // studio: soft key from camera-left, warm fill, cool rims
  const key = new THREE.DirectionalLight(0xfff2e6, 2.8); key.position.set(-4.5, 3.5, 4); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 }); key.shadow.bias = -0.0004; key.shadow.radius = 4;
  const fill = new THREE.DirectionalLight(0xffe0c8, 0.45); fill.position.set(4, 0.2, 3);
  const rim = new THREE.DirectionalLight(0x9cc4ff, 2.6); rim.position.set(2.5, 3, -4);
  const rim2 = new THREE.DirectionalLight(0x9cc4ff, 1.2); rim2.position.set(-3, 1, -3);
  scene.add(key, fill, rim, rim2, new THREE.HemisphereLight(0xc8d8ff, 0x302820, 0.4));
  scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m !== bg) { m.castShadow = true; m.receiveShadow = true; } });
  const camera = new THREE.PerspectiveCamera(17, 1, 0.5, 60);
  camera.position.set(0.7, 0.2, 13.5);
  camera.lookAt(0, -0.45, 0);
  const dispose = () => scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); const mat = m.material as THREE.MeshStandardMaterial; mat.map?.dispose(); mat.bumpMap?.dispose(); mat.alphaMap?.dispose(); mat.dispose(); } });
  return { scene, camera, dispose };
}

/** Environment for physically based reflections (eyes, cap visor, badges). */
export function studioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  return env;
}
