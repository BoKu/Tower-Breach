import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import type { FloorLayout, Prop } from '../gen/floor';
import { FW, FH, T_FLOOR } from '../gen/floor';
import { Builder, merge, type Parts } from './models';
import { currentHoliday } from '../config/holiday';
import { halloweenProp, halloweenDecor } from './halloween';
import { christmasProp, christmasDecor, snowman } from './christmas';
import { easterProp, easterDecor, easterTreat, egg as easterEgg, bunting as easterBunting } from './easter';
import { at } from './halloween';

/**
 * Realistic street dressing for the police cordon (floor 0): procedurally modelled patrol cars, an armoured
 * SWAT truck, traffic cones, police sawhorses, jersey barriers, a command canopy, crime-scene tape, and a road
 * surface with markings, kerbs, manholes, drains and puddles. Everything is generated here: no asset files.
 */

// ------------------------------------------------------------------ canvas textures
const texCache = new Map<string, THREE.CanvasTexture>();
function canvasTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, rng: Rng) => void, srgb = true): THREE.CanvasTexture {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, new Rng(key.length * 131 + key.charCodeAt(0)));
  t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

function speckle(g: CanvasRenderingContext2D, rng: Rng, w: number, h: number, n: number, light: string, dark: string, size = 2) {
  for (let i = 0; i < n; i++) { g.fillStyle = rng.chance(0.5) ? light : dark; const s = rng.range(0.6, size); g.fillRect(rng.next() * w, rng.next() * h, s, s); }
}

/**
 * Christmas: snow ground, w x h px with `cells` noise cells across (wraps at the edges so it tiles): smooth value-noise
 * drifts shading from blue-grey hollows to bright crests, fine grain and a few sparkles. No lines, no grid.
 */
function snowBase(g: CanvasRenderingContext2D, rng: Rng, w: number, h: number, cells: number) {
  const field = valueNoise(rng, w, h, cells);
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.min(1, Math.max(0, (field[i] - 0.25) * 2)), n = (rng.next() - 0.5) * 6; // hollow (0) .. crest (1)
    img.data[i * 4] = 200 + v * 46 + n; img.data[i * 4 + 1] = 210 + v * 39 + n; img.data[i * 4 + 2] = 226 + v * 27 + n; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  speckle(g, rng, w, h, (w * h) / 300, 'rgba(255,255,255,0.7)', 'rgba(150,165,190,0.12)', 1.4);
}

/** Three octaves of smooth value noise, w x h px with `cells` cells across (wraps at the edges so it tiles), about 0..1. */
function valueNoise(rng: Rng, w: number, h: number, cells: number): Float32Array {
  const field = new Float32Array(w * h);
  for (const [n, amp] of [[cells, 0.55], [cells * 3, 0.28], [cells * 9, 0.17]]) {
    const nx = n, ny = Math.max(1, Math.round((n * h) / w)), lat = Array.from({ length: nx * ny }, () => rng.next());
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * ny, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty), r0 = y0 * nx, r1 = ((y0 + 1) % ny) * nx;
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * nx, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % nx;
        const a = lat[r0 + x0], b = lat[r0 + x1], c = lat[r1 + x0], d = lat[r1 + x1];
        field[y * w + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
  }
  return field;
}

/** A meandering trail of alternating boot prints (P px/m) from x, y heading a, wandering by `wander` per step. */
function bootTrail(g: CanvasRenderingContext2D, rng: Rng, P: number, x: number, y: number, a: number, steps: number, wander: number) {
  for (let k = 0; k < steps; k++) {
    a += rng.range(-wander, wander);
    x += Math.cos(a) * 0.38; y += Math.sin(a) * 0.38;
    const s = k % 2 ? 1 : -1, px = (x - Math.sin(a) * s * 0.11) * P, py = (y + Math.cos(a) * s * 0.11) * P, r = a + rng.range(-0.2, 0.2);
    g.fillStyle = 'rgba(120,138,168,0.32)'; // shadowed rim of the pressed snow
    g.beginPath(); g.ellipse(px + 0.8, py + 0.8, 0.15 * P, 0.06 * P, r, 0, 6.28); g.fill();
    g.fillStyle = 'rgba(176,190,210,0.5)'; // packed floor of the print
    g.beginPath(); g.ellipse(px, py, 0.13 * P, 0.05 * P, r, 0, 6.28); g.fill();
  }
}

/**
 * Easter: molten milk chocolate, w x h px: shade from a noise field (milk .. caramel) with glossy ripples along its
 * contours, so the flow curls about with no lines or grid. `cells` as valueNoise (tiles when it wraps).
 */
function chocBase(g: CanvasRenderingContext2D, rng: Rng, w: number, h: number, cells: number) {
  const body = valueNoise(rng, w, h, cells); // one field: a second for the ripples doubled the build time
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.min(1, Math.max(0, (body[i] - 0.25) * 2)), r = Math.sin(body[i] * 30), n = (rng.next() - 0.5) * 5;
    const gloss = Math.max(0, r) ** 12 * 0.28, sh = 1 - 0.1 * Math.max(0, -r) ** 2, m = 0.3 + 0.55 * v; // ripple crest / trough, dark .. milk
    img.data[i * 4] = (104 + 70 * m) * sh + gloss * 120 + n; img.data[i * 4 + 1] = (62 + 44 * m) * sh + gloss * 96 + n; img.data[i * 4 + 2] = (34 + 26 * m) * sh + gloss * 74 + n; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

const SPRINKLE = ['#f6a8c4', '#fff0a0', '#a8d4f4', '#c4eca4', '#ffffff', '#ffb070', '#d4b4f0', '#f05a7a'];
/** A scatter of sugar sprinkles (P px/m) round world x, y within r metres. */
function sprinkles(g: CanvasRenderingContext2D, rng: Rng, P: number, x: number, y: number, r: number, n: number) {
  for (let i = 0; i < n; i++) {
    const a = rng.next() * 6.283, d = r * Math.sqrt(rng.next());
    g.save(); g.translate((x + Math.cos(a) * d) * P, (y + Math.sin(a) * d) * P); g.rotate(rng.next() * 6.283);
    g.fillStyle = SPRINKLE[rng.int(0, SPRINKLE.length - 1)]; g.fillRect(-0.065 * P, -0.02 * P, 0.13 * P, 0.04 * P);
    g.restore();
  }
}

/**
 * A meandering trail of bunny hops (P px/m) from x, y heading a, wandering by `wander` per hop: each hop leaves the two
 * small front prints one behind the other and the long hind prints side by side ahead of them, pressed into the
 * chocolate (dark floor, glossy rim on the far side).
 */
function bunnyTrail(g: CanvasRenderingContext2D, rng: Rng, P: number, x: number, y: number, a: number, hops: number, wander: number) {
  const print = (px: number, py: number, rx: number, ry: number, r: number) => {
    g.fillStyle = 'rgba(226,170,120,0.3)'; g.beginPath(); g.ellipse((px - 0.015) * P, (py - 0.015) * P, rx * P * 1.12, ry * P * 1.2, r, 0, 6.28); g.fill();
    g.fillStyle = 'rgba(24,10,4,0.62)'; g.beginPath(); g.ellipse(px * P, py * P, rx * P, ry * P, r, 0, 6.28); g.fill();
  };
  for (let k = 0; k < hops; k++) {
    a += rng.range(-wander, wander);
    const d = rng.range(0.7, 1.1); x += Math.cos(a) * d; y += Math.sin(a) * d;
    const ca = Math.cos(a), sa = Math.sin(a), pt = (f: number, l: number): [number, number] => [x + ca * f - sa * l, y + sa * f + ca * l];
    for (const [f, l] of [[-0.3, 0.025], [-0.17, -0.03]]) { const [px, py] = pt(f, l); print(px, py, 0.04, 0.035, a); }
    for (const s of [-1, 1]) { const [px, py] = pt(0.07, s * 0.08); print(px, py, 0.11, 0.045, a + s * 0.08); }
  }
}

/**
 * Easter: the sidewalk (world y y0..y1, P px/m) laid with chocolate-bar slabs in staggered rows of uneven length and
 * depth, each scored into 1-3 x 1-2 bevelled segments; mostly plain, some dark, a few white; a few melted corners.
 */
function chocSlabs(g: CanvasRenderingContext2D, rng: Rng, P: number, y0: number, y1: number, w: number) {
  const tones: [number, number, number][] = [[80, 46, 26], [54, 30, 16], [228, 208, 176]]; // darker than the road so the two read apart
  const rgb = (c: [number, number, number], k: number, a = 1) => `rgba(${c[0] * k | 0},${c[1] * k | 0},${c[2] * k | 0},${a})`;
  for (let y = y0; y < y1 - 0.05;) {
    const rh = Math.min(y1 - y, rng.range(0.9, 1.5));
    for (let x = -rng.range(0, 1.6); x < w;) {
      const bw = rng.range(1.1, 2.4), nx = Math.max(1, Math.round(bw / rng.range(0.55, 0.8))), ny = rh > 1.1 ? 2 : 1;
      const t = tones[rng.chance(0.2) ? 1 : rng.chance(0.07) ? 2 : 0], j = rng.range(0.9, 1.08), c: [number, number, number] = [t[0] * j, t[1] * j, t[2] * j];
      g.fillStyle = rgb(c, 0.42); g.fillRect(x * P, y * P, bw * P, rh * P); // the groove between bars
      for (let i = 0; i < nx; i++) for (let k = 0; k < ny; k++) {
        const sx = x + (i * bw) / nx + 0.035, sy = y + (k * rh) / ny + 0.035, sw = bw / nx - 0.07, sh = rh / ny - 0.07;
        g.fillStyle = rgb(c, 1.3); g.fillRect(sx * P, sy * P, sw * P, sh * P); // lit bevel (top / left)
        g.fillStyle = rgb(c, 0.72); g.fillRect((sx + 0.05) * P, (sy + 0.05) * P, (sw - 0.05) * P, (sh - 0.05) * P); // shaded bevel
        const gr = g.createLinearGradient(sx * P, sy * P, (sx + sw) * P, (sy + sh) * P);
        gr.addColorStop(0, rgb(c, 1.12)); gr.addColorStop(1, rgb(c, 0.94));
        g.fillStyle = gr; g.fillRect((sx + 0.09) * P, (sy + 0.09) * P, (sw - 0.18) * P, (sh - 0.18) * P); // flat top, a little glossy
      }
      if (rng.chance(0.14)) { // a corner gone soft and run
        const cx = x + (rng.chance(0.5) ? 0.1 : bw - 0.1), cy = y + (rng.chance(0.5) ? 0.1 : rh - 0.1), r = rng.range(0.25, 0.5);
        const gr = g.createRadialGradient(cx * P, cy * P, 0, cx * P, cy * P, r * P);
        gr.addColorStop(0, rgb(c, 1.05)); gr.addColorStop(0.7, rgb(c, 0.95, 0.9)); gr.addColorStop(1, rgb(c, 0.9, 0));
        g.fillStyle = gr; g.beginPath(); g.ellipse(cx * P, cy * P, r * P, r * 0.8 * P, rng.next() * 3, 0, 6.28); g.fill();
      }
      x += bw;
    }
    y += rh;
  }
}

/** Easter: a soft-edged glossy puddle of colour `c` at world x, y (P px/m), radius r. */
function chocPuddle(g: CanvasRenderingContext2D, rng: Rng, P: number, x: number, y: number, r: number, c: string) {
  g.fillStyle = c; g.beginPath();
  for (let k = 0; k <= 12; k++) { const a = (k / 12) * 6.283, q = r * rng.range(0.7, 1.15); if (k) g.lineTo((x + Math.cos(a) * q) * P, (y + Math.sin(a) * q * 0.7) * P); else g.moveTo((x + q) * P, y * P); }
  g.fill();
  g.fillStyle = 'rgba(255,250,240,0.35)'; g.beginPath(); g.ellipse((x - r * 0.25) * P, (y - r * 0.15) * P, r * 0.35 * P, r * 0.1 * P, -0.3, 0, 6.28); g.fill(); // highlight
}

export const streetTex = {
  /** 8 m of asphalt: aggregate, patch repairs, cracks, oil stains. */
  asphalt: () => canvasTex('st-asphalt', 512, 512, (g, rng) => {
    g.fillStyle = '#4b4d51'; g.fillRect(0, 0, 512, 512);
    const img = g.getImageData(0, 0, 512, 512);
    for (let i = 0; i < img.data.length; i += 4) { const n = (rng.next() - 0.5) * 34; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 1.05; }
    g.putImageData(img, 0, 0);
    speckle(g, rng, 512, 512, 9000, 'rgba(210,210,205,0.18)', 'rgba(10,10,10,0.25)', 2.2);
    { // one subtle, irregular patch repair (soft edges so the 8 m tile doesn't read as a grid)
      const x = rng.range(60, 380), y = rng.range(60, 380), w = rng.range(50, 90), h = rng.range(30, 60);
      g.fillStyle = 'rgba(30,31,33,0.22)';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + rng.range(-6, 6)); g.lineTo(x + w + rng.range(-8, 8), y + h); g.lineTo(x + rng.range(-8, 8), y + h + rng.range(-6, 6)); g.closePath(); g.fill();
    }
    // tyre-polished darker streaks
    for (let i = 0; i < 4; i++) { const y = rng.range(0, 512); g.fillStyle = 'rgba(20,20,22,0.08)'; g.fillRect(0, y, 512, rng.range(20, 40)); }
    g.strokeStyle = 'rgba(12,12,12,0.55)'; g.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) { // cracks
      let x = rng.next() * 512, y = rng.next() * 512;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 10; k++) { x += rng.range(-18, 18); y += rng.range(-18, 18); g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 5; i++) { // oil stains
      const x = rng.next() * 512, y = rng.next() * 512, r = rng.range(8, 26);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(8,8,10,0.45)'); gr.addColorStop(1, 'rgba(8,8,10,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }),
  asphaltBump: () => canvasTex('st-asphalt-bump', 256, 256, (g, rng) => {
    const img = g.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) { const v = 110 + rng.next() * 110; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, false),
  /** 4 m of concrete sidewalk pavers. */
  pavers: () => canvasTex('st-pavers', 512, 512, (g, rng) => {
    g.fillStyle = '#8f8d87'; g.fillRect(0, 0, 512, 512);
    const tile = 64;
    for (let y = 0; y < 512; y += tile) for (let x = 0; x < 512; x += tile) {
      const v = rng.range(-12, 12);
      g.fillStyle = `rgb(${142 + v},${140 + v},${134 + v})`;
      g.fillRect(x + 1, y + 1, tile - 2, tile - 2);
      if (rng.chance(0.15)) { g.fillStyle = 'rgba(40,38,34,0.18)'; g.fillRect(x + rng.range(4, 30), y + rng.range(4, 30), rng.range(8, 28), rng.range(8, 28)); }
    }
    g.strokeStyle = 'rgba(55,54,50,0.8)'; g.lineWidth = 2;
    for (let i = 0; i <= 512; i += tile) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
    speckle(g, rng, 512, 512, 5000, 'rgba(255,255,250,0.1)', 'rgba(0,0,0,0.12)', 1.6);
    for (let i = 0; i < 6; i++) { const x = rng.next() * 512, y = rng.next() * 512; g.fillStyle = 'rgba(30,30,28,0.35)'; g.beginPath(); g.arc(x, y, rng.range(2, 5), 0, 6.28); g.fill(); } // gum spots
  }),
  /** Christmas: 8 m of plain, undisturbed snow (tiles seamlessly): the ground beyond the street. */
  snow: () => canvasTex('st-snow', 512, 512, (g, rng) => snowBase(g, rng, 512, 512, 2)),
  /**
   * Christmas: the whole 64 x 48 m street in one 32 px/m texture (no tiling; uv = world x/FW, y/FH): soft uneven snow
   * with blue-grey drift shadows, a trodden track up the approach lane and around the cordon gap and the entrance,
   * and meandering, crossing trails of boot prints.
   */
  snowStreet: () => {
    const P = 32, t = canvasTex('st-snow-street', FW * P, FH * P, (g, rng) => {
      snowBase(g, rng, FW * P, FH * P, 9);
      const smudge = (x: number, y: number, r: number, a: number) => { // soft trodden-grey blob at world x, y
        const gr = g.createRadialGradient(x * P, y * P, 0, x * P, y * P, r * P);
        gr.addColorStop(0, `rgba(150,162,180,${a})`); gr.addColorStop(1, 'rgba(150,162,180,0)');
        g.fillStyle = gr; g.fillRect((x - r) * P, (y - r) * P, r * 2 * P, r * 2 * P);
      };
      for (let y = 12; y < FH - 2; y += 0.6) smudge(32 + rng.range(-1.2, 1.2), y, rng.range(1.2, 2.2), 0.07); // approach lane
      for (const [x, y, r] of [[32, 12.8, 3], [32, 18.5, 2.6], [32, FH - 4, 2.4], [40, 40, 3.2]]) for (let k = 0; k < 6; k++) smudge(x + rng.range(-1, 1), y + rng.range(-0.8, 0.8), r * rng.range(0.6, 1), 0.08);
      // boot-print trails: up and down the lane, then wandering all over, some looping back across others
      for (let k = 0; k < 10; k++) bootTrail(g, rng, P, 32 + rng.range(-2, 2), k % 2 ? 13 : FH - 4, k % 2 ? Math.PI / 2 : -Math.PI / 2, 70, 0.06);
      for (let k = 0; k < 34; k++) bootTrail(g, rng, P, rng.range(3, FW - 3), rng.range(13, FH - 3), rng.next() * Math.PI * 2, rng.int(12, 50), 0.2);
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  },
  /** Easter: 8 m of molten chocolate (tiles seamlessly): the ground beyond the street. */
  chocolate: () => canvasTex('st-choc', 512, 512, (g, rng) => chocBase(g, rng, 512, 512, 2)),
  /**
   * Easter: the whole 64 x 48 m street in one 32 px/m texture (no tiling; uv = world x/FW, y/FH): the road is molten
   * chocolate with glossy ripples, drips running off the kerb and white-chocolate swirls and puddles; the sidewalk is
   * laid with chocolate-bar slabs; sprinkles here and there and meandering trails of bunny prints over everything.
   */
  chocStreet: () => {
    const P = 32, t = canvasTex('st-choc-street', FW * P, FH * P, (g, rng) => {
      chocBase(g, rng, FW * P, FH * P, 9);
      chocSlabs(g, rng, P, 11.5, 20.2, FW);
      for (let x = 1 + rng.range(0, 1); x < FW - 1; x += rng.range(0.4, 1.6)) { // drips off the kerb onto the road
        const len = rng.range(0.15, 0.9), wd = rng.range(0.1, 0.28);
        g.fillStyle = 'rgb(64,36,20)'; g.beginPath(); g.moveTo((x - wd / 2) * P, 20.45 * P); g.lineTo((x - wd / 2) * P, (20.5 + len) * P);
        g.arc(x * P, (20.5 + len) * P, (wd / 2) * P, Math.PI, 0, true); g.lineTo((x + wd / 2) * P, 20.45 * P); g.fill();
        g.fillStyle = 'rgba(230,180,130,0.4)'; g.fillRect((x - wd * 0.2) * P, 20.55 * P, wd * 0.12 * P, len * 0.8 * P);
      }
      g.fillStyle = 'rgb(64,36,20)'; g.fillRect(0, 20.4 * P, FW * P, 0.12 * P);
      for (let k = 0; k < 7; k++) chocPuddle(g, rng, P, rng.range(4, FW - 4), rng.range(23, FH - 4), rng.range(0.5, 1.2), 'rgb(236,222,196)'); // white chocolate
      for (let k = 0; k < 9; k++) { // white-chocolate swirls piped over the road
        const cx = rng.range(4, FW - 4), cy = rng.range(22.5, FH - 4), R = rng.range(0.5, 1.3), a0 = rng.next() * 6.28;
        for (const [st, wdt, off] of [['rgba(30,14,6,0.35)', 0.12, 0.03], ['rgb(238,226,204)', 0.09, 0]] as const) {
          g.strokeStyle = st; g.lineWidth = wdt * P; g.lineCap = 'round'; g.beginPath();
          for (let i = 0; i <= 60; i++) { const u = i / 60, a = a0 + u * Math.PI * 5, r = R * u; const px = (cx + off + Math.cos(a) * r) * P, py = (cy + off + Math.sin(a) * r * 0.8) * P; if (i) g.lineTo(px, py); else g.moveTo(px, py); }
          g.stroke();
        }
      }
      for (let k = 0; k < 4; k++) chocPuddle(g, rng, P, rng.range(3, FW - 3), rng.range(13, 19), rng.range(0.4, 0.8), 'rgb(150,96,56)'); // melted onto the slabs
      for (let k = 0; k < 40; k++) sprinkles(g, rng, P, rng.range(2, FW - 2), rng.range(12.5, FH - 2), rng.range(0.3, 0.9), rng.int(8, 24));
      sprinkles(g, rng, P, FW / 2, (12 + FH) / 2, 40, 500);
      for (let k = 0; k < 30; k++) bunnyTrail(g, rng, P, rng.range(3, FW - 3), rng.range(13, FH - 3), rng.next() * Math.PI * 2, rng.int(8, 30), 0.35);
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  },
  paint: () => canvasTex('st-paint', 256, 64, (g, rng) => {
    g.clearRect(0, 0, 256, 64);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 64);
    const img = g.getImageData(0, 0, 256, 64);
    for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] = rng.chance(0.18) ? rng.range(0, 120) : 235; // worn paint
    g.putImageData(img, 0, 0);
  }),
  policeDoor: () => canvasTex('st-police-door', 512, 128, (g) => {
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = '#10244a'; g.font = 'bold 78px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('POLICE', 256, 60);
    g.fillStyle = '#c8a232'; g.fillRect(40, 104, 432, 8);
  }),
  roofNumber: () => canvasTex('st-roof-no', 256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#111'; g.font = 'bold 150px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('17', 128, 136);
  }),
  swatSide: () => canvasTex('st-swat', 512, 128, (g) => {
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = '#e8e8e8'; g.font = 'bold 64px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('POLICE  SWAT', 256, 64);
  }),
  plate: () => canvasTex('st-plate', 128, 64, (g) => {
    g.fillStyle = '#f0f0e8'; g.fillRect(0, 0, 128, 64);
    g.strokeStyle = '#223'; g.lineWidth = 4; g.strokeRect(2, 2, 124, 60);
    g.fillStyle = '#1a2a5a'; g.font = 'bold 30px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('PD 4471', 64, 36);
  }),
  sawhorse: () => canvasTex('st-sawhorse', 512, 64, (g) => {
    g.fillStyle = '#1f4fb0'; g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#ffffff'; g.font = 'bold 34px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('POLICE LINE  DO NOT CROSS', 256, 34);
    g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.strokeRect(4, 4, 504, 56);
  }),
  tape: () => canvasTex('st-tape', 512, 64, (g) => {
    g.fillStyle = '#f5cf12'; g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#111'; g.font = 'bold 30px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('POLICE LINE  DO NOT CROSS  ', 256, 34);
    g.fillRect(0, 2, 512, 4); g.fillRect(0, 58, 512, 4);
  }),
  valance: () => canvasTex('st-valance', 1024, 96, (g) => {
    g.fillStyle = '#152a55'; g.fillRect(0, 0, 1024, 96);
    g.fillStyle = '#ffffff'; g.font = 'bold 52px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('POLICE  COMMAND  POST', 512, 50);
  }),
  manhole: () => canvasTex('st-manhole', 128, 128, (g) => {
    g.fillStyle = '#2a2b2d'; g.beginPath(); g.arc(64, 64, 62, 0, 6.28); g.fill();
    g.strokeStyle = '#3d3e41'; g.lineWidth = 3;
    for (let r = 12; r < 60; r += 10) { g.beginPath(); g.arc(64, 64, r, 0, 6.28); g.stroke(); }
    for (let a = 0; a < 6.28; a += 0.52) { g.beginPath(); g.moveTo(64 + Math.cos(a) * 12, 64 + Math.sin(a) * 12); g.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60); g.stroke(); }
    g.fillStyle = '#4a4b4e'; g.font = 'bold 14px Arial'; g.textAlign = 'center'; g.fillText('SEWER', 64, 68);
  }),
  grate: () => canvasTex('st-grate', 128, 64, (g) => {
    g.fillStyle = '#1c1d1f'; g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#050505'; for (let x = 8; x < 124; x += 10) g.fillRect(x, 6, 5, 52);
  }),
};

// ------------------------------------------------------------------ materials
const M = {
  blackPaint: new THREE.MeshPhysicalMaterial({ color: 0x0d0e10, roughness: 0.3, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08 }),
  whitePaint: new THREE.MeshPhysicalMaterial({ color: 0xf0f0ec, roughness: 0.3, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 }),
  navyPaint: new THREE.MeshPhysicalMaterial({ color: 0x141c2c, roughness: 0.55, metalness: 0.4, clearcoat: 0.4, clearcoatRoughness: 0.3 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0b1116, roughness: 0.05, metalness: 0.85, clearcoat: 1 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x121213, roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.28, metalness: 1 }),
  blackTrim: new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.6, metalness: 0.2 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.15, metalness: 1 }),
  headlight: new THREE.MeshStandardMaterial({ color: 0xf4f6ff, emissive: 0xdde6ff, emissiveIntensity: 0.6, roughness: 0.1 }),
  taillight: new THREE.MeshStandardMaterial({ color: 0x8a0a0a, emissive: 0xff1a1a, emissiveIntensity: 0.35, roughness: 0.2 }),
  orangePlastic: new THREE.MeshStandardMaterial({ color: 0xff5a0a, roughness: 0.45, metalness: 0 }),
  reflect: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.2, metalness: 0.2, emissive: 0x333333 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.95 }),
  aluminium: new THREE.MeshStandardMaterial({ color: 0xbfc4c8, roughness: 0.35, metalness: 0.9 }),
  canvasNavy: new THREE.MeshStandardMaterial({ color: 0x152a55, roughness: 0.85, side: THREE.DoubleSide }),
  sand: new THREE.MeshStandardMaterial({ color: 0x5a5a3a, roughness: 0.95 }),
  table: new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.6 }),
  screen: new THREE.MeshBasicMaterial({ color: 0x5fc8ff, toneMapped: false }),
  amber: new THREE.MeshBasicMaterial({ color: 0xffa21a, toneMapped: false }),
};
const decal = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.4, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

function shadowed<T extends THREE.Object3D>(o: T): T { o.traverse((c) => { if ((c as THREE.Mesh).isMesh && !c.userData.noShadow) { c.castShadow = true; c.receiveShadow = true; } }); return o; }
const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));
function add(g: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}

/** Side-profile extrusion across the vehicle width (profile in x = length, y = height). */
function profile(points: [number, number][], width: number, bevel = 0.05): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) sh.lineTo(x, y);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: width - 2 * bevel, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -(width - 2 * bevel) / 2);
  g.computeVertexNormals();
  return g;
}

function wheel(g: THREE.Object3D, x: number, z: number, r: number, w: number) {
  const tyre = new THREE.CylinderGeometry(r, r, w, 22);
  tyre.rotateX(Math.PI / 2);
  add(g, tyre, M.rubber, x, r, z);
  const rim = new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.012, 16);
  rim.rotateX(Math.PI / 2);
  add(g, rim, M.rim, x, r, z);
  const hub = new THREE.CylinderGeometry(r * 0.18, r * 0.18, w + 0.02, 10);
  hub.rotateX(Math.PI / 2);
  add(g, hub, M.blackTrim, x, r, z);
}

// ------------------------------------------------------------------ vehicles (built along +x, width along z)
export function buildPoliceCar(): THREE.Group {
  const g = new THREE.Group();
  const L = 3.9, W = 1.82;
  // lower body, black-and-white livery painted per vertex (white doors + roof, black front/rear)
  const body = profile([[-L / 2, 0.3], [-L / 2, 0.72], [-L / 2 + 0.2, 0.9], [-L / 2 + 0.75, 0.95], [0.95, 0.97], [L / 2 - 0.2, 0.86], [L / 2, 0.66], [L / 2, 0.3]], W);
  add(g, body, M.blackPaint, 0, 0, 0);
  // white door panels (classic black-and-white livery) with door seams and handles
  for (const s of [-1, 1]) {
    add(g, rbox(1.82, 0.5, 0.012, 0.004), M.whitePaint, -0.06, 0.69, s * (W / 2 + 0.001));
    for (const x of [-0.97, -0.06, 0.84]) add(g, new THREE.BoxGeometry(0.012, 0.52, 0.004), M.blackTrim, x, 0.69, s * (W / 2 + 0.008));
    for (const x of [-0.25, 0.62]) add(g, rbox(0.14, 0.035, 0.02, 0.008), M.chrome, x, 0.85, s * (W / 2 + 0.012));
  }
  // glass cabin + painted roof + pillars
  add(g, profile([[-L / 2 + 0.78, 0.95], [-0.58, 1.34], [0.42, 1.34], [0.93, 0.97]], W - 0.18, 0.04), M.glass, 0, 0, 0);
  const roof = rbox(1.02, 0.05, W - 0.2, 0.02);
  add(g, roof, M.whitePaint, -0.08, 1.36, 0);
  for (const x of [-0.08]) for (const z of [-(W - 0.18) / 2, (W - 0.18) / 2]) add(g, new THREE.BoxGeometry(0.1, 0.38, 0.02), M.blackTrim, x, 1.15, z);
  // roof number (reads from the overhead camera) and door decals
  const rn = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), decal(streetTex.roofNumber()));
  rn.rotation.set(-Math.PI / 2, 0, Math.PI / 2); rn.position.set(-0.08, 1.392, 0); g.add(rn);
  for (const s of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.31), decal(streetTex.policeDoor()));
    d.position.set(-0.05, 0.66, s * (W / 2 + 0.014)); d.rotation.y = s > 0 ? 0 : Math.PI; g.add(d);
  }
  // light bar housing (the strobing lenses are separate meshes driven by the floor view)
  add(g, rbox(0.3, 0.08, 1.2, 0.03), M.blackTrim, -0.1, 1.42, 0);
  // bumpers, push bar, lights, mirrors, plates
  add(g, rbox(0.12, 0.2, W - 0.1, 0.04), M.blackTrim, L / 2 - 0.02, 0.42, 0);
  add(g, rbox(0.12, 0.2, W - 0.1, 0.04), M.blackTrim, -L / 2 + 0.02, 0.44, 0);
  for (const z of [-0.45, 0.45]) add(g, new THREE.BoxGeometry(0.06, 0.45, 0.07), M.blackTrim, L / 2 + 0.1, 0.55, z);
  add(g, new THREE.BoxGeometry(0.06, 0.07, 1.0), M.blackTrim, L / 2 + 0.1, 0.75, 0);
  for (const z of [-0.62, 0.62]) { add(g, rbox(0.06, 0.1, 0.32, 0.03), M.headlight, L / 2 - 0.02, 0.72, z); add(g, rbox(0.06, 0.1, 0.3, 0.03), M.taillight, -L / 2 + 0.01, 0.76, z); }
  for (const s of [-1, 1]) add(g, rbox(0.14, 0.09, 0.08, 0.02), M.blackPaint, 0.82, 1.03, s * (W / 2 + 0.05));
  const plate = new THREE.MeshStandardMaterial({ map: streetTex.plate(), roughness: 0.4 });
  add(g, new THREE.PlaneGeometry(0.3, 0.15), plate, L / 2 + 0.04, 0.45, 0, 0, Math.PI / 2, 0);
  add(g, new THREE.PlaneGeometry(0.3, 0.15), plate, -L / 2 - 0.04, 0.5, 0, 0, -Math.PI / 2, 0);
  // wheels and arches
  for (const x of [-1.25, 1.2]) for (const s of [-1, 1]) { wheel(g, x, s * (W / 2 - 0.12), 0.34, 0.24); add(g, new THREE.TorusGeometry(0.4, 0.035, 6, 16, Math.PI), M.blackTrim, x, 0.34, s * (W / 2 - 0.01)); }
  return shadowed(g);
}

export function buildSwatTruck(): THREE.Group {
  const g = new THREE.Group();
  const L = 3.95, W = 1.95;
  const body = profile([[-L / 2, 0.45], [-L / 2, 2.28], [L / 2 - 1.05, 2.28], [L / 2 - 0.62, 1.42], [L / 2 - 0.05, 1.3], [L / 2, 0.55], [L / 2 - 0.1, 0.45]], W, 0.06);
  add(g, body, M.navyPaint, 0, 0, 0);
  // armoured glass: windshield + small side windows, gun ports
  add(g, profile([[L / 2 - 1.02, 2.15], [L / 2 - 0.66, 1.48], [L / 2 - 0.7, 1.46], [L / 2 - 1.06, 2.13]], W - 0.3, 0.02), M.glass, 0, 0, 0);
  for (const s of [-1, 1]) {
    add(g, new THREE.BoxGeometry(0.55, 0.32, 0.02), M.glass, 0.95, 1.85, s * (W / 2 + 0.005));
    add(g, new THREE.BoxGeometry(0.42, 0.28, 0.02), M.glass, -0.2, 1.85, s * (W / 2 + 0.005));
    for (const x of [-1.1, 0.3]) add(g, new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10).rotateX(Math.PI / 2), M.blackTrim, x, 1.5, s * (W / 2 + 0.012));
    const d = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.5), decal(streetTex.swatSide()));
    d.position.set(-0.45, 1.05, s * (W / 2 + 0.008)); d.rotation.y = s > 0 ? 0 : Math.PI; g.add(d);
    // door seams and handles
    add(g, new THREE.BoxGeometry(0.015, 1.5, 0.01), M.blackTrim, 0.55, 1.35, s * (W / 2 + 0.006));
    add(g, rbox(0.14, 0.04, 0.03, 0.01), M.chrome, 0.35, 1.3, s * (W / 2 + 0.02));
    // running board
    add(g, new THREE.BoxGeometry(1.6, 0.05, 0.22), M.blackTrim, 0.2, 0.55, s * (W / 2 + 0.06));
  }
  // roof: hatch, turret ring, antennas, light bar housing
  add(g, rbox(0.7, 0.08, 0.7, 0.04), M.blackTrim, -0.6, 2.32, 0);
  add(g, new THREE.TorusGeometry(0.3, 0.04, 6, 20).rotateX(Math.PI / 2), M.blackTrim, -0.6, 2.38, 0);
  for (const z of [-0.7, 0.7]) add(g, new THREE.CylinderGeometry(0.008, 0.008, 0.9), M.blackTrim, -1.6, 2.72, z);
  add(g, rbox(0.3, 0.08, 1.25, 0.03), M.blackTrim, 0, 2.33, 0);
  // ram bumper, winch, grille, lights, spare wheel
  add(g, rbox(0.22, 0.32, W + 0.08, 0.05), M.blackTrim, L / 2 + 0.05, 0.62, 0);
  for (const z of [-0.5, 0, 0.5]) add(g, new THREE.BoxGeometry(0.1, 0.5, 0.08), M.blackTrim, L / 2 + 0.14, 0.9, z);
  for (const z of [-0.7, 0.7]) add(g, rbox(0.05, 0.12, 0.22, 0.03), M.headlight, L / 2 - 0.03, 1.15, z);
  for (const z of [-0.75, 0.75]) add(g, rbox(0.04, 0.16, 0.14, 0.03), M.taillight, -L / 2 - 0.01, 0.95, z);
  const spare = new THREE.Group(); // rear-door spare wheel
  wheel(spare, 0, 0, 0.4, 0.26);
  spare.rotation.y = Math.PI / 2;
  spare.position.set(-L / 2 - 0.14, 0.75, 0);
  g.add(spare);
  for (const x of [-1.25, 1.2]) for (const s of [-1, 1]) wheel(g, x, s * (W / 2 - 0.1), 0.48, 0.34);
  return shadowed(g);
}

// ------------------------------------------------------------------ small props
export function buildCone(seed: number): THREE.Group {
  const g = new THREE.Group();
  add(g, rbox(0.38, 0.035, 0.38, 0.03), M.blackTrim, 0, 0.018, 0);
  const pts = [[0.155, 0.035], [0.14, 0.1], [0.05, 0.68], [0.03, 0.72], [0, 0.725]].map(([x, y]) => new THREE.Vector2(x, y));
  add(g, new THREE.LatheGeometry(pts, 24), M.orangePlastic, 0, 0, 0);
  const band = (y0: number, y1: number) => {
    const r0 = 0.155 - (y0 - 0.035) * 0.165 + 0.004, r1 = 0.155 - (y1 - 0.035) * 0.165 + 0.004;
    add(g, new THREE.LatheGeometry([new THREE.Vector2(r0, y0), new THREE.Vector2(r1, y1)], 24), M.reflect, 0, 0, 0);
  };
  band(0.34, 0.44); band(0.5, 0.56);
  const r = new Rng(seed);
  g.rotation.set(r.range(-0.03, 0.03), r.range(0, 6.28), r.range(-0.03, 0.03));
  return shadowed(g);
}

/**
 * Old-school rotating beacon: a clear coloured dome over a spinning parabolic reflector that throws a sweeping beam.
 * The spinning part is tagged `userData.spin` (rad/s); FloorView turns it every frame.
 */
export function buildBeacon(color: number): THREE.Group {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.075, 0.085, 0.07, 16), M.blackTrim, 0, 0.035, 0);
  const rotor = new THREE.Group();
  rotor.position.y = 0.11;
  rotor.userData.spin = 1.7 + Math.random() * 0.5; // ~0.3 rev/s: a slow sweep that reads as a pulsing glow
  rotor.rotation.y = Math.random() * Math.PI * 2;
  const hot = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 1 });
  add(rotor, new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), new THREE.MeshBasicMaterial({ color: 0xfff2c0, toneMapped: false }), 0, 0, 0); // bulb
  add(rotor, new THREE.SphereGeometry(0.05, 14, 10, -Math.PI / 2, Math.PI), hot, -0.012, 0, 0, 0, 0, Math.PI / 2); // reflector
  add(rotor, new THREE.BoxGeometry(0.01, 0.07, 0.07), M.blackTrim, -0.03, 0, 0);
  // soft, wide beam: additive cone with its apex at the lamp
  const beam = new THREE.ConeGeometry(0.42, 0.95, 24, 1, true);
  beam.translate(0, -0.475, 0);
  beam.rotateZ(Math.PI / 2);
  const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const bm = new THREE.Mesh(beam, beamMat);
  bm.position.x = 0.02;
  bm.userData.noShadow = true;
  rotor.add(bm);
  g.add(rotor);
  // clear coloured dome over the rotor; its glow swells as the reflector comes round
  const domeMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, transparent: true, opacity: 0.5, roughness: 0.15, depthWrite: false, side: THREE.DoubleSide });
  add(g, new THREE.SphereGeometry(0.075, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), domeMat, 0, 0.13, 0).userData.noShadow = true;
  add(g, new THREE.CylinderGeometry(0.075, 0.075, 0.06, 16, 1, true), domeMat, 0, 0.1, 0).userData.noShadow = true;
  rotor.userData.pulse = [
    { m: beamMat, key: 'opacity', lo: 0.03, hi: 0.2 },
    { m: domeMat, key: 'emissiveIntensity', lo: 0.3, hi: 2.2 },
    { m: hot, key: 'opacity', lo: 0.55, hi: 1 },
  ];
  return g;
}

/** NYPD-style blue wooden sawhorse with folding metal legs and an amber warning lamp. */
export function buildSawhorse(len: number): THREE.Group {
  const g = new THREE.Group();
  const board = new THREE.MeshStandardMaterial({ map: streetTex.sawhorse(), roughness: 0.7 });
  const edge = new THREE.MeshStandardMaterial({ color: 0x1f4fb0, roughness: 0.7 });
  add(g, new THREE.BoxGeometry(len, 0.22, 0.04), [edge, edge, edge, edge, board, board] as any, 0, 0.9, 0);
  for (const s of [-1, 1]) {
    const x = s * (len / 2 - 0.2);
    // A-frame: legs meet under the board and splay out to the feet (tilt inward at the top)
    for (const k of [-1, 1]) {
      add(g, new THREE.BoxGeometry(0.05, 1.0, 0.05), edge, x, 0.48, k * 0.18, -k * 0.36, 0, 0);
      add(g, new THREE.BoxGeometry(0.07, 0.025, 0.09), M.blackTrim, x, 0.012, k * 0.36); // rubber foot
    }
    add(g, new THREE.BoxGeometry(0.05, 0.05, 0.5), M.aluminium, x, 0.3, 0); // spreader brace
    add(g, new THREE.BoxGeometry(0.09, 0.1, 0.12), M.aluminium, x, 0.83, 0); // folding hinge bracket
  }
  const lamp = buildBeacon(0xffa21a);
  lamp.position.set(len / 2 - 0.25, 1.01, 0);
  g.add(lamp);
  return shadowed(g);
}

/** Precast concrete jersey barrier with its stepped safety profile, lifting slots and scuffs. */
export function buildJersey(len: number): THREE.Group {
  const g = new THREE.Group();
  const sh = new THREE.Shape();
  sh.moveTo(-0.3, 0); sh.lineTo(0.3, 0); sh.lineTo(0.3, 0.08); sh.lineTo(0.2, 0.33); sh.lineTo(0.08, 0.81); sh.lineTo(-0.08, 0.81); sh.lineTo(-0.2, 0.33); sh.lineTo(-0.3, 0.08); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: len - 0.06, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
  geo.translate(0, 0, -(len - 0.06) / 2);
  geo.rotateY(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ map: canvasTex('st-concrete', 256, 128, (c, rng) => {
    c.fillStyle = '#a9a59c'; c.fillRect(0, 0, 256, 128);
    speckle(c, rng, 256, 128, 3000, 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.15)', 1.8);
    for (let i = 0; i < 5; i++) { c.fillStyle = 'rgba(60,55,45,0.2)'; c.fillRect(rng.next() * 256, 80 + rng.next() * 48, rng.range(10, 50), rng.range(4, 20)); }
  }), roughness: 0.95 });
  add(g, geo, mat, 0, 0, 0);
  for (const x of [-len / 4, len / 4]) add(g, new THREE.BoxGeometry(0.22, 0.08, 0.62), M.blackTrim, x, 0.06, 0); // forklift slots
  return shadowed(g);
}

/** Pop-up command canopy with printed valance, back wall, sandbag weights and a briefing table inside. */
export function buildTent(w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const H = 2.2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    add(g, new THREE.BoxGeometry(0.05, H, 0.05), M.aluminium, sx * (w / 2 - 0.05), H / 2, sz * (d / 2 - 0.05));
    add(g, rbox(0.3, 0.12, 0.2, 0.05), M.sand, sx * (w / 2 - 0.05), 0.06, sz * (d / 2 - 0.05));
  }
  // truss under the roof
  for (const sz of [-1, 1]) add(g, new THREE.BoxGeometry(w - 0.1, 0.04, 0.04), M.aluminium, 0, H - 0.05, sz * (d / 2 - 0.05));
  for (const sx of [-1, 1]) add(g, new THREE.BoxGeometry(0.04, 0.04, d - 0.1), M.aluminium, sx * (w / 2 - 0.05), H - 0.05, 0);
  const roof = new THREE.ConeGeometry(Math.hypot(w, d) / 2, 0.7, 4, 1, true);
  roof.rotateY(Math.PI / 4);
  roof.scale(w / Math.hypot(w, d) * Math.SQRT2, 1, d / Math.hypot(w, d) * Math.SQRT2);
  add(g, roof, M.canvasNavy, 0, H + 0.35, 0);
  const val = new THREE.MeshStandardMaterial({ map: streetTex.valance(), roughness: 0.8, side: THREE.DoubleSide });
  for (const [x, z, ry, len] of [[0, d / 2, 0, w], [0, -d / 2, Math.PI, w], [w / 2, 0, Math.PI / 2, d], [-w / 2, 0, -Math.PI / 2, d]] as [number, number, number, number][]) {
    add(g, new THREE.PlaneGeometry(len, 0.26), val, x, H - 0.13, z, 0, ry, 0);
  }
  add(g, new THREE.PlaneGeometry(w - 0.1, H - 0.3), M.canvasNavy, 0, (H - 0.3) / 2, -d / 2 + 0.03); // back wall
  // folding table with laptops and a radio base station
  add(g, new THREE.BoxGeometry(1.6, 0.04, 0.7), M.table, 0, 0.74, -d / 2 + 0.6);
  for (const x of [-0.7, 0.7]) add(g, new THREE.BoxGeometry(0.04, 0.72, 0.6), M.aluminium, x, 0.36, -d / 2 + 0.6);
  for (const x of [-0.4, 0.3]) {
    add(g, new THREE.BoxGeometry(0.34, 0.02, 0.24), M.blackTrim, x, 0.77, -d / 2 + 0.62);
    add(g, new THREE.BoxGeometry(0.34, 0.22, 0.015), M.blackTrim, x, 0.88, -d / 2 + 0.5, -0.2);
    add(g, new THREE.PlaneGeometry(0.3, 0.18), M.screen, x, 0.88, -d / 2 + 0.51, -0.2);
  }
  add(g, rbox(0.3, 0.12, 0.2, 0.02), M.blackTrim, 0.65, 0.82, -d / 2 + 0.66);
  return shadowed(g);
}

/** Crime-scene tape sagging between weighted stanchions. `vertical`: runs along z. */
export function buildTape(len: number, vertical: boolean): THREE.Group {
  const g = new THREE.Group();
  const posts = [-len / 2 + 0.05, len / 2 - 0.05];
  for (const p of posts) {
    const x = vertical ? 0 : p, z = vertical ? p : 0;
    add(g, new THREE.CylinderGeometry(0.02, 0.02, 0.95, 10), M.chrome, x, 0.5, z);
    add(g, new THREE.CylinderGeometry(0.16, 0.18, 0.04, 16), M.blackTrim, x, 0.02, z);
    add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.05, 10), M.blackTrim, x, 0.98, z);
  }
  const seg = 16;
  const ribbon = new THREE.PlaneGeometry(len - 0.1, 0.075, seg, 1);
  const p = ribbon.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const u = p.getX(i) / ((len - 0.1) / 2); p.setY(i, p.getY(i) - 0.07 * (1 - u * u)); }
  ribbon.computeVertexNormals();
  const tm = streetTex.tape().clone();
  tm.repeat.set((len - 0.1) / 1.6, 1); tm.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ map: tm, roughness: 0.5, side: THREE.DoubleSide });
  const m = add(g, ribbon, mat, 0, 0.93, 0);
  if (vertical) m.rotation.y = Math.PI / 2;
  return shadowed(g);
}

export function buildFloodlight(): THREE.Group {
  const g = new THREE.Group();
  add(g, rbox(1.0, 0.5, 0.7, 0.06), new THREE.MeshStandardMaterial({ color: 0xc9a21a, roughness: 0.6 }), 0, 0.35, 0); // trailer / generator
  add(g, new THREE.CylinderGeometry(0.05, 0.07, 4.2, 10), M.aluminium, 0, 2.6, 0);
  add(g, new THREE.BoxGeometry(1.2, 0.08, 0.08), M.blackTrim, 0, 4.6, 0);
  const night = currentHoliday() === 'halloween'; // the street is night-time on Halloween: lamps blaze and throw beams
  const face = new THREE.MeshBasicMaterial({ color: 0xfff6e0, toneMapped: false });
  if (night) face.color.setRGB(3, 2.7, 2.2); // over the bloom threshold
  for (const x of [-0.4, 0.4]) { add(g, rbox(0.34, 0.26, 0.14, 0.03), M.blackTrim, x, 4.45, 0.05, 0.5); add(g, new THREE.PlaneGeometry(0.28, 0.2), face, x, 4.44, 0.13, 0.5); }
  if (night) {
    const beam = new THREE.ConeGeometry(1.9, 4.6, 24, 1, true);
    beam.translate(0, -2.3, 0); // apex at the lamp, opening downward
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    for (const x of [-0.4, 0.4]) add(g, beam, beamMat, x, 4.42, 0.15, 0.55).userData.noShadow = true; // tilted out the way the heads face
  }
  return shadowed(g);
}

// ------------------------------------------------------------------ road dressing
/** Lane markings, crosswalk at the approach lane, kerb, manholes, storm drains and puddles. */
export function buildRoad(L: FloorLayout): THREE.Group {
  const g = new THREE.Group();
  const paint = (color: number) => new THREE.MeshStandardMaterial({ color, map: streetTex.paint(), transparent: true, roughness: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const snow = currentHoliday() === 'xmas'; // Christmas: markings buried under the snow, kerb snowed over, puddles frozen, snowmen
  const choc = currentHoliday() === 'easter'; // Easter: markings piped in icing, a chocolate kerb, white-chocolate puddles, eggs and chicks about
  const white = paint(choc ? 0xfff4e6 : 0xf0f0ea), yellow = paint(choc ? 0xf6a8c4 : 0xf2c318);
  const strip = (x: number, y: number, w: number, d: number, m: THREE.Material) => { if (snow) return; const s = add(g, new THREE.PlaneGeometry(w, d), m, x, 0.012, y, -Math.PI / 2); s.renderOrder = 1; };
  const x0 = 1, x1 = FW - 1;
  // road runs east-west between the kerb (y=20) and the fence
  const yc = 33;
  for (const dy of [-0.09, 0.09]) strip((x0 + x1) / 2, yc + dy, x1 - x0, 0.1, yellow); // double yellow
  for (const yl of [26.5, 39.5]) for (let x = x0 + 1; x < x1 - 2; x += 6) if (x < 28 || x > 36) strip(x + 1.5, yl, 3, 0.12, white); // dashed lanes
  strip((x0 + x1) / 2, 20.7, x1 - x0, 0.12, white); // edge line
  strip((x0 + x1) / 2, FH - 2.2, x1 - x0, 0.12, white);
  for (let x = 28.4; x < 35.8; x += 0.9) strip(x, 23, 0.5, 3.4, white); // zebra crossing on the approach lane
  strip(26.8, 23, 0.3, 3.4, white); strip(37.2, 23, 0.3, 3.4, white); // stop lines
  // kerb and gutter along the sidewalk edge
  const kerb = choc ? new THREE.MeshStandardMaterial({ color: 0x3e2414, roughness: 0.4 }) : new THREE.MeshStandardMaterial({ color: 0x9d9a92, roughness: 0.9 });
  add(g, new THREE.BoxGeometry(x1 - x0, 0.14, 0.3), kerb, (x0 + x1) / 2, 0.07, 20.05);
  add(g, new THREE.PlaneGeometry(x1 - x0, 0.35), new THREE.MeshStandardMaterial({ color: snow ? 0x8a9098 : choc ? 0x46281a : 0x3a3b3d, roughness: choc ? 0.35 : 0.8 }), (x0 + x1) / 2, 0.006, 20.4, -Math.PI / 2);
  if (snow) { // snow banked along the kerb top and ploughed against it
    const drift = new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.95 });
    add(g, rbox(x1 - x0, 0.06, 0.34, 0.03), drift, (x0 + x1) / 2, 0.15, 20.05);
    const bank = new THREE.CylinderGeometry(0.22, 0.22, x1 - x0, 8, 1, false, 0, Math.PI); bank.rotateZ(Math.PI / 2); bank.scale(1, 0.5, 1);
    add(g, bank, drift, (x0 + x1) / 2, 0, 20.22);
  }
  if (snow) g.add(streetSnowmen(L));
  if (choc) g.add(streetEaster(L));
  const rng = new Rng(L.seed);
  const grate = new THREE.MeshStandardMaterial({ map: streetTex.grate(), roughness: 0.6, metalness: 0.6 });
  for (let x = 6; x < x1 - 4; x += 14) add(g, new THREE.PlaneGeometry(0.9, 0.35), grate, x, 0.009, 20.4, -Math.PI / 2);
  const mh = new THREE.MeshStandardMaterial({ map: streetTex.manhole(), transparent: true, roughness: 0.5, metalness: 0.7 });
  for (const [x, y] of [[14, 30], [45, 36], [52, 27]]) add(g, new THREE.CircleGeometry(0.45, 24), mh, x, 0.01, y, -Math.PI / 2);
  // puddles: glossy, reflect the sky and the strobes
  const puddle = choc
    ? new THREE.MeshStandardMaterial({ color: 0xece0c8, roughness: 0.2, metalness: 0.05, transparent: true, opacity: 0.92, depthWrite: false }) // white chocolate
    : snow
    ? new THREE.MeshStandardMaterial({ color: 0xa8bccc, roughness: 0.08, metalness: 0.4, transparent: true, opacity: 0.7, depthWrite: false }) // ice
    : new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.04, metalness: 0.65, transparent: true, opacity: 0.75, depthWrite: false });
  for (let i = 0; i < 6; i++) {
    const shape = new THREE.Shape();
    const n = 9, r0 = rng.range(0.4, 1.1);
    for (let k = 0; k <= n; k++) { const a = (k / n) * Math.PI * 2, r = r0 * rng.range(0.7, 1.2); if (k === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r * 0.6); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.6); }
    const pm = add(g, new THREE.ShapeGeometry(shape), puddle, rng.range(4, x1 - 4), 0.011, rng.range(22, FH - 4), -Math.PI / 2);
    pm.renderOrder = 2;
  }
  return g;
}

/**
 * Christmas: two cosmetic snowmen (~1.3 m, no collision) on open snow: the first two candidate spots that are walkable
 * and clear of props, the approach lane, the start point, and every street officer, squad-mate and critter's spot or path.
 */
function streetSnowmen(L: FloorLayout): THREE.Group {
  const clear = openGround(L), b = new Builder();
  const spots = ([[4, 16.2], [60, 16.2], [58.5, 41.5], [5.5, 30], [14, 42], [59, 30], [23, 15.4], [45, 31]] as const).filter(([x, y]) => clear(x, y)).slice(0, 2);
  spots.forEach(([x, y], i) => snowman(b, x, 0, y, 2, i ? -0.5 : 0.6)); // turned a little toward the street centre
  return partsGroup(b.p);
}

/**
 * Easter: cosmetic clutches of painted eggs, carrots, chicks and grass tufts (no collision) on open street, wherever
 * openGround allows (off the kerb), one merged mesh.
 */
function streetEaster(L: FloorLayout): THREE.Group {
  const clear = openGround(L), rng = new Rng(L.seed ^ 0xea57e5), b = new Builder();
  for (let n = 0, tries = 0; n < 30 && tries < 600; tries++) {
    const x = rng.range(2.5, FW - 2.5), y = rng.range(12.8, FH - 2.8);
    if (Math.abs(y - 20.1) > 0.6 && clear(x, y)) easterTreat(b, x, y, n, n++ * 7 + 3);
  }
  return partsGroup(b.p);
}

/** Open street at x, y: walkable and clear of props, the approach lane, the start point, and every street officer, squad-mate and critter's spot or path. */
function openGround(L: FloorLayout) {
  const segDist = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay, k = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot(x - ax - dx * k, y - ay - dy * k);
  };
  const clear = (x: number, y: number) => (x < 26 || x > 38) && Math.hypot(x - L.anchors.start.x, y - L.anchors.start.y) > 4
    && L.tiles[Math.floor(y) * FW + Math.floor(x)] === T_FLOOR
    && L.props.every((p) => Math.abs(x - p.x) > p.w / 2 + 1.2 || Math.abs(y - p.y) > p.h / 2 + 1.2)
    && L.ambient.every((a) => ('x2' in a ? segDist(x, y, a.x, a.y, a.x2, a.y2) : Math.hypot(x - a.x, y - a.y)) > 2);
  return clear;
}

/** Street props that get the detailed models (placed at the prop centre, oriented by footprint). */
export const STREET_KINDS = new Set(['policecar', 'swatvan', 'cone', 'sawhorse', 'barrier', 'tent', 'tape', 'tapeline', 'floodlight']);

/** Holiday dressing built with the prop Builder (vertex colours), as one group in the street model's local frame. */
const holSolid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
const holEmit = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
function partsGroup(parts: Parts, shared = false): THREE.Group {
  const g = new THREE.Group(), s = merge(parts.solid), e = merge(parts.emit);
  if (s) { s.userData.shared = shared; g.add(new THREE.Mesh(s, holSolid)); }
  if (e) { e.userData.shared = shared; g.add(new THREE.Mesh(e, holEmit)); }
  return shadowed(g);
}

/** Holiday builds of street kinds, by holiday, kind and footprint: built once, then copies sharing the geometry (`shared`, so FloorView never disposes it). */
const HOLIDAY_STREET = { halloween: [halloweenProp, halloweenDecor], xmas: [christmasProp, christmasDecor], easter: [easterProp, easterDecor] } as const;
const holBuilt = new Map<string, { replaced: boolean; g: THREE.Group }>();
function holidayStreet(p: Prop) {
  const hol = currentHoliday();
  if (!hol) return null;
  const key = `${hol}|${p.kind}|${p.w}|${p.h}`;
  let c = holBuilt.get(key);
  if (!c) {
    const b = new Builder(), [prop, decor] = HOLIDAY_STREET[hol];
    const replaced = prop(b, p.kind, p.w - 0.1, p.h - 0.1, p.w, p.h);
    if (!replaced) decor(b, p.kind, p.w - 0.1, p.h - 0.1, p.w, p.h);
    holBuilt.set(key, (c = { replaced, g: partsGroup(b.p, true) }));
  }
  return { replaced: c.replaced, g: c.g.clone() };
}

export function buildStreetProp(p: Prop): THREE.Object3D | null {
  const vert = p.h > p.w;
  let o: THREE.Object3D;
  // holidays replace (Halloween: cone; Christmas: cone and the vehicles, as sleighs; Easter: cone and the vehicles,
  // as baskets) or dress the model
  const hol = holidayStreet(p), replaced = !!hol?.replaced;
  if (replaced) { o = hol!.g; if (p.id % 2 && (p.kind === 'policecar' || p.kind === 'swatvan')) o.rotation.y = Math.PI; } // sleighs face either way
  else switch (p.kind) {
    case 'policecar': o = buildPoliceCar(); if (vert) o.rotation.y = -Math.PI / 2; if (p.id % 2) o.rotation.y += Math.PI; break;
    case 'swatvan': o = buildSwatTruck(); if (vert) o.rotation.y = -Math.PI / 2; if (p.id % 2) o.rotation.y += Math.PI; break;
    case 'cone': o = buildCone(p.id); break;
    case 'sawhorse': o = buildSawhorse(Math.max(p.w, p.h) - 0.1); if (vert) o.rotation.y = Math.PI / 2; break;
    case 'barrier': o = buildJersey(Math.max(p.w, p.h) - 0.08); if (vert) o.rotation.y = Math.PI / 2; break;
    case 'tent': o = buildTent(p.w - 0.1, p.h - 0.1); break;
    case 'tape': case 'tapeline': o = buildTape(Math.max(p.w, p.h), vert); break;
    case 'floodlight': o = buildFloodlight(); o.rotation.y = (p.id % 4) * (Math.PI / 2); break;
    default: return null;
  }
  if (hol && !replaced) o.add(hol.g);
  o.position.set(p.x, 0, p.y);
  return o;
}

export { mergeGeometries };

// ------------------------------------------------------------------ the tower facade (street level)
const facadeTex = {
  /** 8 m × 14 m of curtain wall: four 3.5 m storeys, 1.6 m glass modules, spandrels, random lit offices. */
  curtain: (emissive: boolean) => canvasTex(emissive ? 'st-cw-e' : 'st-cw', 512, 896, (g, rng) => {
    const PX = 64, floorH = 3.5 * PX, spand = 0.85 * PX, mod = 1.6 * PX;
    g.fillStyle = emissive ? '#000' : '#16242e'; g.fillRect(0, 0, 512, 896);
    const r2 = new Rng(99); // same panel layout for colour and emissive maps
    for (let f = 0; f < 4; f++) {
      const y0 = f * floorH;
      for (let m = 0; m < 5; m++) {
        const x0 = m * mod;
        const roll = r2.next();
        const lit = roll < 0.1 ? 'warm' : roll < 0.15 ? 'cool' : roll < 0.17 ? 'red' : '';
        const blinds = r2.chance(0.25);
        if (!emissive) {
          const gr = g.createLinearGradient(0, y0 + spand, 0, y0 + floorH);
          gr.addColorStop(0, '#5e7f94'); gr.addColorStop(0.5, '#2c4656'); gr.addColorStop(1, '#1b2c37'); // sky reflection
          g.fillStyle = gr; g.fillRect(x0 + 3, y0 + spand, mod - 6, floorH - spand);
          if (blinds) { g.fillStyle = 'rgba(200,205,200,0.35)'; for (let y = y0 + spand + 6; y < y0 + spand + (floorH - spand) * r2.range(0.3, 0.8); y += 5) g.fillRect(x0 + 3, y, mod - 6, 2); }
          if (lit) { g.fillStyle = lit === 'warm' ? 'rgba(255,214,150,0.55)' : lit === 'cool' ? 'rgba(170,220,255,0.5)' : 'rgba(255,40,40,0.6)'; g.fillRect(x0 + 3, y0 + spand, mod - 6, floorH - spand); }
          // diagonal reflection streak
          g.fillStyle = 'rgba(255,255,255,0.06)';
          g.beginPath(); g.moveTo(x0 + 10, y0 + floorH); g.lineTo(x0 + 40, y0 + spand); g.lineTo(x0 + 60, y0 + spand); g.lineTo(x0 + 30, y0 + floorH); g.fill();
        } else if (lit) {
          g.fillStyle = lit === 'warm' ? '#b08a50' : lit === 'cool' ? '#4a7fa8' : '#c01010';
          g.fillRect(x0 + 3, y0 + spand, mod - 6, floorH - spand);
        }
        if (!emissive) { g.fillStyle = '#9aa4aa'; g.fillRect(x0, y0, 3, floorH); } // mullion
      }
      if (!emissive) {
        g.fillStyle = '#2a3238'; g.fillRect(0, y0, 512, spand); // spandrel
        g.fillStyle = '#8c969c'; g.fillRect(0, y0, 512, 3); g.fillRect(0, y0 + spand - 3, 512, 3); // transoms
      }
    }
    if (!emissive) speckle(g, rng, 512, 896, 1500, 'rgba(255,255,255,0.03)', 'rgba(0,0,0,0.05)', 2);
  }),
  stone: () => canvasTex('st-stone', 512, 256, (g, rng) => {
    g.fillStyle = '#b3aea4'; g.fillRect(0, 0, 512, 256);
    for (let y = 0; y < 256; y += 64) for (let x = (y / 64) % 2 ? -64 : 0; x < 512; x += 128) {
      const v = rng.range(-10, 10);
      g.fillStyle = `rgb(${178 + v},${173 + v},${163 + v})`; g.fillRect(x + 2, y + 2, 124, 60);
    }
    speckle(g, rng, 512, 256, 7000, 'rgba(255,255,255,0.14)', 'rgba(40,36,30,0.18)', 1.6);
    g.fillStyle = 'rgba(60,55,48,0.25)'; for (let i = 0; i < 6; i++) g.fillRect(rng.next() * 512, 200 + rng.next() * 56, rng.range(20, 80), rng.range(4, 30)); // grime near the ground
  }),
  lobby: (emissive: boolean) => canvasTex(emissive ? 'st-lobby-e' : 'st-lobby', 256, 256, (g) => {
    if (emissive) {
      g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
      const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#3a2c18'); gr.addColorStop(0.2, '#a68a58'); gr.addColorStop(1, '#2a2014');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#fff2d8'; g.fillRect(0, 18, 256, 6); // ceiling light strip inside
    } else {
      const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#39505e'); gr.addColorStop(1, '#141c22');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.moveTo(40, 256); g.lineTo(120, 0); g.lineTo(160, 0); g.lineTo(80, 256); g.fill();
    }
  }),
  /**
   * 90s-style green piece "DGC": hand-cut angular letters (no font) with spikes, a block 3D shadow, black and white
   * outlines, a two-tone fill split by a zigzag, sharp shines and sparkles, and an arrow breaking out of the C.
   */
  graffiti: () => canvasTex('st-graffiti', 1024, 512, (g) => {
    const P = (pts: number[]) => { const q = new Path2D(); q.moveTo(pts[0], pts[1]); for (let k = 2; k < pts.length; k += 2) q.lineTo(pts[k], pts[k + 1]); q.closePath(); return q; };
    const tag = new Path2D();
    // D (with counter), spike off the top left
    tag.addPath(P([60, 78, 150, 110, 275, 104, 368, 186, 352, 336, 296, 396, 84, 390, 106, 250, 78, 200]));
    tag.addPath(P([165, 176, 250, 172, 296, 216, 286, 310, 250, 330, 165, 330]));
    // G with a hooked bar
    tag.addPath(P([392, 150, 452, 104, 648, 96, 622, 176, 474, 182, 458, 314, 562, 320, 566, 282, 520, 282, 532, 234, 662, 228, 634, 404, 430, 396, 380, 330]));
    // C whose bottom stroke turns into an arrow
    tag.addPath(P([684, 160, 738, 104, 912, 94, 884, 176, 758, 182, 748, 306, 872, 312, 880, 280, 984, 350, 864, 424, 868, 392, 716, 396, 672, 330]));
    g.translate(18, 8); g.transform(1, -0.06, -0.12, 1, 40, 30); g.scale(0.92, 0.92);
    g.lineJoin = 'miter'; g.miterLimit = 6;
    // block 3D shadow, stepped down-right
    for (let k = 16; k > 0; k--) { g.save(); g.translate(k * 1.1, k * 1.3); g.fillStyle = k > 13 ? '#000' : '#05301a'; g.fill(tag, 'evenodd'); g.restore(); }
    g.strokeStyle = '#000'; g.lineWidth = 26; g.stroke(tag);
    g.strokeStyle = '#f2fff0'; g.lineWidth = 11; g.stroke(tag);
    // two-tone fill: lime top, deep green bottom, split by a zigzag
    g.save(); g.clip(tag, 'evenodd');
    const top = g.createLinearGradient(0, 90, 0, 260); top.addColorStop(0, '#d8ff4a'); top.addColorStop(1, '#3ee83a');
    g.fillStyle = top; g.fillRect(0, 0, 1100, 520);
    g.fillStyle = '#0d9a35'; g.beginPath(); g.moveTo(0, 520);
    for (let x = 0; x <= 1100; x += 44) g.lineTo(x, x % 88 ? 255 : 290);
    g.lineTo(1100, 520); g.fill();
    g.fillStyle = 'rgba(0,40,10,0.55)'; for (let x = -40; x < 1100; x += 66) { g.beginPath(); g.moveTo(x, 520); g.lineTo(x + 10, 520); g.lineTo(x + 60, 330); g.lineTo(x + 54, 330); g.fill(); } // hatching
    g.fillStyle = 'rgba(255,255,255,0.9)'; // sharp shines
    for (const [x, y] of [[120, 120], [470, 118], [760, 116], [210, 345]]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 46, y - 6); g.lineTo(x + 8, y + 26); g.fill(); }
    g.restore();
    // four-point sparkles
    g.fillStyle = '#ffffff';
    for (const [x, y, r] of [[56, 74, 26], [650, 92, 20], [990, 350, 18], [372, 420, 14]]) { g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.2, y - r * 0.2); g.lineTo(x + r, y); g.lineTo(x + r * 0.2, y + r * 0.2); g.lineTo(x, y + r); g.lineTo(x - r * 0.2, y + r * 0.2); g.lineTo(x - r, y); g.lineTo(x - r * 0.2, y - r * 0.2); g.fill(); }
  }),
  sign: () => canvasTex('st-sign', 1024, 160, (g) => {
    g.fillStyle = '#0a0d10'; g.fillRect(0, 0, 1024, 160);
    g.fillStyle = '#f2f4f5'; g.font = 'bold 96px Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('AXIOM  TOWER', 170, 84);
    const eye = g.createRadialGradient(90, 80, 4, 90, 80, 56); eye.addColorStop(0, '#ffffff'); eye.addColorStop(0.2, '#ff3030'); eye.addColorStop(1, 'rgba(120,0,0,0)');
    g.fillStyle = eye; g.beginPath(); g.arc(90, 80, 56, 0, 6.28); g.fill();
    g.strokeStyle = '#ff3030'; g.lineWidth = 5; g.beginPath(); g.arc(90, 80, 44, 0, 6.28); g.stroke();
  }),
};

/**
 * Street facade of the AI's tower: stone-clad podium with a two-storey lobby storefront, entrance portal with a steel
 * and glass canopy and a revolving door, illuminated sign, and a setback glass curtain-wall shaft rising out of view.
 * Occupies the facade band y 0..11 of floor 0 (sim collision is unchanged). Front face at z = 12; door tiles x 31..33.
 */
export function buildFacade(applyCut: <T extends THREE.Material>(m: T, keep?: number) => T): THREE.Group {
  const g = new THREE.Group();
  const PODIUM = 7.5, FRONT = 11.92;
  const stoneMap = facadeTex.stone(); stoneMap.repeat.set(1, 1);
  const stone = applyCut(new THREE.MeshStandardMaterial({ map: stoneMap, roughness: 0.85 }), 1.2);
  const darkStone = applyCut(new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.7, metalness: 0.1 }), 1.2);
  const steel = applyCut(new THREE.MeshStandardMaterial({ color: 0x5b6268, roughness: 0.35, metalness: 0.85 }), 1.2);
  const tile = (t: THREE.Texture, rx: number, ry: number) => { const c = t.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; return c; };
  // podium mass
  const podFront = applyCut(new THREE.MeshStandardMaterial({ map: tile(stoneMap, 64 / 8, PODIUM / 4), roughness: 0.85 }), 1.2);
  // split around the entrance recess (x 29.5..34.5, up to y 5, back to z RZ) so the doors and lobby show through
  const RX0 = 29.5, RX1 = 34.5, RH = 5, RZ = FRONT - 2.5;
  for (const [x0, x1] of [[0, RX0], [RX1, 64]]) add(g, new THREE.BoxGeometry(x1 - x0, PODIUM, FRONT - 0.3), [stone, stone, darkStone, darkStone, podFront, stone] as any, (x0 + x1) / 2, PODIUM / 2, (FRONT - 0.3) / 2);
  add(g, new THREE.BoxGeometry(RX1 - RX0, PODIUM - RH, FRONT - 0.3), [stone, stone, darkStone, darkStone, stone, stone] as any, 32, (PODIUM + RH) / 2, (FRONT - 0.3) / 2);
  // lobby storefront between pilasters, with lit interior
  const lobby = applyCut(new THREE.MeshStandardMaterial({ map: facadeTex.lobby(false), emissive: 0xffffff, emissiveMap: facadeTex.lobby(true), emissiveIntensity: 0.85, roughness: 0.08, metalness: 0.6 }), 1.2);
  const plinth = applyCut(new THREE.MeshStandardMaterial({ color: 0x2c2c2e, roughness: 0.6 }), 1.2);
  for (let x = 0; x < 64; x += 6) {
    const bay0 = x + 0.55, bay1 = x + 5.45;
    const mid = (bay0 + bay1) / 2, w = bay1 - bay0;
    if (bay1 > 28.5 && bay0 < 35.5) continue; // entrance portal bay
    add(g, new THREE.PlaneGeometry(w, 5.6), lobby, mid, 0.55 + 2.8, FRONT - 0.18);
    for (let k = 0; k <= 3; k++) add(g, new THREE.BoxGeometry(0.06, 5.6, 0.1), steel, bay0 + (w * k) / 3, 3.35, FRONT - 0.12); // mullions
    add(g, new THREE.BoxGeometry(w, 0.08, 0.12), steel, mid, 4.3, FRONT - 0.12); // transom
    add(g, new THREE.BoxGeometry(w + 0.2, 0.55, 0.3), plinth, mid, 0.275, FRONT - 0.05); // plinth
  }
  for (let x = 0; x <= 64; x += 6) if (x < 28 || x > 36) add(g, new THREE.BoxGeometry(1.1, PODIUM, 0.5), stone, x, PODIUM / 2, FRONT); // pilasters
  // cornice / canopy band
  add(g, new THREE.BoxGeometry(64.4, 0.5, 0.9), stone, 32, PODIUM - 0.25, FRONT + 0.1);
  add(g, new THREE.BoxGeometry(64.4, 0.12, 1.0), darkStone, 32, PODIUM + 0.05, FRONT + 0.1);
  // graffiti tag on the blank stone wall left of the entrance (x 24.55..28.2, podium face at z = FRONT - 0.3)
  const tag = applyCut(new THREE.MeshStandardMaterial({ map: facadeTex.graffiti(), transparent: true, alphaTest: 0.02, roughness: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 1.2);
  add(g, new THREE.PlaneGeometry(3.4, 1.7), tag, 26.4, 1.75, FRONT - 0.29);
  // ---- entrance portal
  add(g, new THREE.BoxGeometry(1.4, PODIUM - 0.5, 0.8), stone, 28.9, (PODIUM - 0.5) / 2, FRONT + 0.1);
  add(g, new THREE.BoxGeometry(1.4, PODIUM - 0.5, 0.8), stone, 35.1, (PODIUM - 0.5) / 2, FRONT + 0.1);
  // pseudo lobby behind the glass: lit back wall and sides, warm ceiling panel, polished floor
  add(g, new THREE.PlaneGeometry(RX1 - RX0, RH), lobby, 32, RH / 2, RZ);
  for (const [x, ry] of [[RX0, Math.PI / 2], [RX1, -Math.PI / 2]]) add(g, new THREE.PlaneGeometry(FRONT - 0.3 - RZ, RH), lobby, x, RH / 2, (RZ + FRONT - 0.3) / 2, 0, ry);
  add(g, new THREE.PlaneGeometry(RX1 - RX0, FRONT - 0.3 - RZ), new THREE.MeshBasicMaterial({ color: 0xfff0d8, toneMapped: false }), 32, RH - 0.01, (RZ + FRONT - 0.3) / 2, Math.PI / 2);
  add(g, new THREE.PlaneGeometry(RX1 - RX0, FRONT - 0.3 - RZ), applyCut(new THREE.MeshStandardMaterial({ color: 0x5a524a, roughness: 0.2, metalness: 0.2 }), 1.2), 32, 0.01, (RZ + FRONT - 0.3) / 2, -Math.PI / 2);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 0.88), new THREE.MeshBasicMaterial({ map: facadeTex.sign(), toneMapped: false }));
  sign.position.set(32, 6.3, FRONT + 0.52); g.add(sign);
  // glass doors either side of the revolving door
  const doorGlass = applyCut(new THREE.MeshPhysicalMaterial({ color: 0x0f1a20, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.55 }), 1.2);
  for (const x of [30.1, 33.9]) { add(g, new THREE.BoxGeometry(1.1, 2.7, 0.05), doorGlass, x, 1.35, FRONT - 0.35); add(g, new THREE.BoxGeometry(0.04, 0.6, 0.04), steel, x + (x < 32 ? 0.45 : -0.45), 1.2, FRONT - 0.3); }
  add(g, new THREE.BoxGeometry(5, 2.2, 0.04), doorGlass, 32, 3.9, FRONT - 0.38); // transom glass above the doors
  // revolving door: drum, canopy disc and four glass wings
  const drum = new THREE.CylinderGeometry(1.0, 1.0, 2.7, 24, 1, true, Math.PI * 0.15, Math.PI * 0.7);
  add(g, drum, doorGlass, 32, 1.35, FRONT - 0.35, 0, Math.PI, 0);
  add(g, new THREE.CylinderGeometry(1.05, 1.05, 0.2, 24), steel, 32, 2.8, FRONT - 0.35);
  const wings = new THREE.Group(); wings.position.set(32, 1.35, FRONT - 0.35); wings.rotation.y = 0.4; wings.userData.spin = 0.25; // turns slowly (FloorView spinners)
  for (let k = 0; k < 4; k++) { const w = add(wings, new THREE.BoxGeometry(0.95, 2.5, 0.03), doorGlass, 0, 0, 0); w.geometry.translate(0.48, 0, 0); w.rotation.y = (k * Math.PI) / 2; }
  add(wings, new THREE.CylinderGeometry(0.05, 0.05, 2.7, 8), steel, 0, 0, 0);
  g.add(wings);
  // steel-and-glass entrance canopy on two columns
  const canopyGlass = applyCut(new THREE.MeshPhysicalMaterial({ color: 0x9ec8dc, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.35 }), 1.2);
  add(g, new THREE.BoxGeometry(6.4, 0.06, 2.8), canopyGlass, 32, 4.4, FRONT + 1.4);
  for (const x of [28.9, 35.1]) add(g, new THREE.BoxGeometry(0.12, 0.2, 2.9), steel, x, 4.3, FRONT + 1.4);
  for (const z of [FRONT + 0.1, FRONT + 2.75]) add(g, new THREE.BoxGeometry(6.5, 0.2, 0.12), steel, 32, 4.3, z);
  for (const x of [29.3, 34.7]) add(g, new THREE.CylinderGeometry(0.08, 0.08, 4.3, 12), steel, x, 2.15, FRONT + 2.6);
  // ---- tower shaft: setback glass curtain wall with vertical fins, rising out of shot
  const SHAFT_H = 70, SX0 = 3, SX1 = 61, SZ = 10.4;
  const cw = tile(facadeTex.curtain(false), (SX1 - SX0) / 8, SHAFT_H / 14);
  const cwe = tile(facadeTex.curtain(true), (SX1 - SX0) / 8, SHAFT_H / 14);
  const glassWall = applyCut(new THREE.MeshStandardMaterial({ map: cw, emissive: 0xffffff, emissiveMap: cwe, emissiveIntensity: 0.9, roughness: 0.18, metalness: 0.55 }), 2);
  const shaft = add(g, new THREE.BoxGeometry(SX1 - SX0, SHAFT_H, SZ - 0.5), [glassWall, glassWall, darkStone, darkStone, glassWall, glassWall] as any, (SX0 + SX1) / 2, PODIUM + SHAFT_H / 2, (SZ - 0.5) / 2 + 0.5);
  void shaft;
  const fins = applyCut(new THREE.MeshStandardMaterial({ color: 0x8c969c, roughness: 0.4, metalness: 0.8 }), 2);
  const finGeo = new THREE.BoxGeometry(0.12, SHAFT_H, 0.45);
  const finCount = Math.floor((SX1 - SX0) / 3.2) + 1;
  const finInst = new THREE.InstancedMesh(finGeo, fins, finCount);
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < finCount; i++) { mtx.makeTranslation(SX0 + i * 3.2, PODIUM + SHAFT_H / 2, SZ + 0.2); finInst.setMatrixAt(i, mtx); }
  g.add(finInst);
  // podium roof: membrane, parapet, rooftop plant
  add(g, new THREE.PlaneGeometry(64, FRONT - SZ + 0.2), darkStone, 32, PODIUM + 0.12, (SZ + FRONT) / 2, -Math.PI / 2);
  for (const x of [8, 20, 44, 56]) add(g, rbox(2.2, 1.1, 0.9, 0.05), steel, x, PODIUM + 0.65, SZ + 0.6);
  if (currentHoliday() === 'xmas') {
    // snow on the ledges: cornice, podium roof and its plant, entrance canopy, plinths
    const snow = applyCut(new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.95 }), 1.2);
    add(g, rbox(64.3, 0.08, 0.96, 0.03), snow, 32, PODIUM + 0.15, FRONT + 0.1);
    add(g, new THREE.PlaneGeometry(64, FRONT - SZ + 0.2), snow, 32, PODIUM + 0.13, (SZ + FRONT) / 2, -Math.PI / 2);
    for (const x of [8, 20, 44, 56]) add(g, rbox(2.16, 0.07, 0.86, 0.03), snow, x, PODIUM + 1.22, SZ + 0.6);
    add(g, rbox(6.36, 0.07, 2.76, 0.03), snow, 32, 4.46, FRONT + 1.4);
    for (let x = 0; x < 64; x += 6) { const bay0 = x + 0.55, bay1 = x + 5.45; if (!(bay1 > 28.5 && bay0 < 35.5)) add(g, rbox(bay1 - bay0 + 0.18, 0.05, 0.28, 0.02), snow, (bay0 + bay1) / 2, 0.57, FRONT - 0.05); }
  }
  if (currentHoliday() === 'easter') {
    // chocolate poured over the cornice and running down its face, pastel bunting along the bays, eggs on the canopy
    const b = new Builder(), rng = new Rng(7);
    b.rbox(64.3, 0.07, 0.96, 0.03, 32, PODIUM + 0.14, FRONT + 0.1, 0x5a3420);
    for (let x = 0.3; x < 64; x += rng.range(0.35, 1.3)) {
      const len = x > 28.5 && x < 35.5 ? rng.range(0.08, 0.18) : rng.range(0.15, 0.6); // short over the sign
      b.geo(new THREE.CapsuleGeometry(0.05, len, 3, 6), 0x5a3420, x, PODIUM + 0.05 - len / 2, FRONT + 0.57, 0, 0, 0, 'solid', 1, 1, 0.6);
    }
    for (let x = 0; x < 64; x += 6) {
      const bay0 = x + 0.55, bay1 = x + 5.45;
      if (!(bay1 > 28.5 && bay0 < 35.5)) at(b, (bay0 + bay1) / 2, 6.0, FRONT + 0.02, 0, 2, () => easterBunting(b, (bay1 - bay0) / 2 - 0.1, 0.12));
    }
    for (const [x, k] of [[30.2, 0], [32, 4], [33.8, 1]] as const) easterEgg(b, x, 4.43, FRONT + 1.4, 0.32, k, x);
    const choc = applyCut(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, side: THREE.DoubleSide }), 1.2);
    g.add(new THREE.Mesh(merge(b.p.solid)!, choc));
  }
  return shadowed(g);
}
