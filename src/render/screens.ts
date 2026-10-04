import * as THREE from 'three';
import { applyCutaway } from './cutaway';

/**
 * Animated monitor screens. Screen quads live in their own Parts bucket and carry two attributes:
 * aSUv (0..1 across the screen) and aScr = (style, seed, aspect). One shared material draws procedural content per
 * style, so every screen on a floor is still a single draw call. Styles: 0 scrolling code, 1 oscilloscope,
 * 2 radar sweep, 3 equaliser bars, 4 CCTV feed; 5 presentation slides (boardroom TVs, explicit only).
 */
export const SCREEN_STYLES = 5;
export const screenUniforms = { uScrTime: { value: 0 } };

const FRAG = /* glsl */ `
  vec2 u = vSUv; float st = vScr.x; float sd = vScr.y; float asp = vScr.z; float tt = uScrTime + sd * 17.0;
  vec3 col = vec3(0.0);
  if (st < 0.5) {
    float yy = u.y * 16.0 + tt * 1.6;
    float row = floor(yy), fy = fract(yy);
    float len = 0.25 + 0.7 * scrHash(row + sd * 13.0);
    float cells = 46.0 * asp / 1.6;
    float cx = floor(u.x * cells);
    float indent = floor(scrHash(row + 3.0 + sd) * 3.0) * 2.0 / cells;
    float on = step(cx / cells, len) * step(0.3, scrHash(row * 57.0 + cx + sd)) * step(0.18, fy) * step(fy, 0.82) * step(indent, u.x);
    vec3 c = mix(vec3(0.2, 1.0, 0.6), vec3(0.3, 0.8, 1.0), scrHash(row * 3.1 + sd));
    if (scrHash(row * 7.7 + sd) > 0.85) c = vec3(1.0, 0.35, 0.6);
    col = c * on * 0.9 + vec3(0.02, 0.06, 0.05);
    col += vec3(0.6, 1.0, 0.8) * step(0.93, u.y) * step(u.x, 0.05) * step(0.5, fract(tt * 1.5));
  } else if (st < 1.5) {
    vec2 g = abs(fract(u * vec2(10.0 * asp, 8.0)) - 0.5);
    float grid = step(0.46, max(g.x, g.y)) * 0.12;
    float w = 0.5 + 0.22 * sin(u.x * 14.0 + tt * 3.0) * sin(u.x * 3.3 - tt * 1.3);
    float w2 = 0.5 + 0.18 * sin(u.x * 23.0 - tt * 4.1 + 1.0);
    float l1 = smoothstep(0.035, 0.0, abs(u.y - w));
    float l2 = smoothstep(0.025, 0.0, abs(u.y - w2));
    col = vec3(0.05, 0.9, 1.0) * (grid + l1) + vec3(1.0, 0.2, 0.7) * l2 * 0.8 + vec3(0.01, 0.03, 0.05);
  } else if (st < 2.5) {
    vec2 p = (u - 0.5) * vec2(asp, 1.0) * 2.0;
    float r = length(p), a = atan(p.y, p.x);
    float sweep = mod(tt * 1.4, 6.2831853);
    float da = mod(sweep - a + 6.2831853, 6.2831853);
    float inside = step(r, 0.95);
    float trail = exp(-da * 2.5) * inside;
    float rings = step(0.965, fract(r * 4.0)) * inside * 0.35;
    float crs = (step(abs(p.x), 0.008) + step(abs(p.y), 0.008)) * inside * 0.3;
    float blips = 0.0;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      vec2 bp = vec2(scrHash(fi + sd * 7.0), scrHash(fi * 3.3 + sd)) * 1.3 - 0.65;
      float bd = mod(sweep - atan(bp.y, bp.x) + 6.2831853, 6.2831853);
      blips += smoothstep(0.07, 0.0, length(p - bp)) * exp(-bd * 0.8);
    }
    col = vec3(0.2, 1.0, 0.4) * (trail * 0.7 + rings + crs) + vec3(1.0, 0.9, 0.3) * blips + vec3(0.0, 0.05, 0.02);
  } else if (st < 3.5) {
    float bi = floor(u.x * 14.0), fx = fract(u.x * 14.0);
    float hgt = 0.12 + 0.72 * (0.5 + 0.5 * sin(tt * (1.5 + scrHash(bi + sd) * 2.5) + bi * 1.7)) * (0.55 + 0.45 * scrHash(bi * 2.0 + sd));
    float on = step(0.15, fx) * step(fx, 0.85) * step(u.y, hgt) * step(0.35, fract(u.y * 30.0));
    col = mix(vec3(0.1, 0.9, 1.0), vec3(1.0, 0.25, 0.55), u.y / 0.9) * on + vec3(0.02, 0.02, 0.05);
    col += vec3(1.0, 0.8, 0.2) * step(0.93, u.y) * step(u.x, 0.35 + 0.1 * sin(tt)) * 0.8;
  } else if (st > 4.5) {
    // presentation slide: title bar, animated bar chart and a line of growth, slide number ticking over
    vec2 p = u;
    float slide = floor(tt / 7.0);
    col = vec3(0.92, 0.94, 0.97) * 0.9;
    col = mix(col, vec3(0.1, 0.32, 0.62), step(0.84, p.y));
    col += vec3(0.9) * step(0.87, p.y) * step(p.y, 0.93) * step(0.06, p.x) * step(p.x, 0.25 + 0.3 * scrHash(slide + sd)) * 0.9;
    float bi = floor((p.x - 0.08) / 0.1);
    float inChart = step(0.08, p.x) * step(p.x, 0.58) * step(0.12, p.y) * step(p.y, 0.74);
    float hgt = 0.12 + (0.2 + 0.4 * scrHash(bi + slide * 7.0 + sd)) * min(1.0, fract(tt / 7.0) * 3.0);
    float bar = inChart * step(0.02, fract((p.x - 0.08) / 0.1)) * step(fract((p.x - 0.08) / 0.1), 0.72) * step(p.y, hgt);
    col = mix(col, mix(vec3(0.15, 0.45, 0.85), vec3(0.95, 0.45, 0.2), step(3.5, bi)), bar);
    col = mix(col, vec3(0.2, 0.2, 0.25), inChart * step(abs(p.y - 0.12), 0.004));
    float lx = (p.x - 0.64) / 0.3, ly = 0.2 + lx * 0.45 + 0.05 * sin(lx * 9.0 + slide);
    col = mix(col, vec3(0.1, 0.65, 0.35), step(0.0, lx) * step(lx, 1.0) * smoothstep(0.012, 0.0, abs(p.y - ly)) );
    col = mix(col, vec3(0.55), step(0.64, p.x) * step(p.x, 0.94) * step(0.12, p.y) * step(p.y, 0.74) * (1.0 - step(0.004, abs(p.x - 0.64))));
    col = mix(col, vec3(0.45), step(0.02, p.y) * step(p.y, 0.06) * step(0.9, p.x) * step(p.x, 0.96));
  } else {
    vec2 p = u;
    float scene = smoothstep(0.55, 0.0, p.y) * 0.35 + step(0.55, p.y) * 0.18;
    scene += step(abs(p.x - 0.3), 0.08) * step(p.y, 0.45) * step(0.2, p.y) * 0.22;
    scene += step(abs(p.x - 0.72), 0.05) * step(p.y, 0.62) * step(0.3, p.y) * 0.15;
    scene += step(length((p - vec2(fract(tt * 0.05 + sd) * 1.3 - 0.15, 0.33)) * vec2(1.0, 0.45)), 0.05) * 0.5;
    float noise = scrHash(floor(p.x * 160.0) + floor(p.y * 90.0) * 173.0 + floor(tt * 24.0) * 7.0) * 0.18;
    float roll = smoothstep(0.08, 0.0, abs(fract(p.y - tt * 0.25) - 0.5)) * 0.12;
    col = vec3(0.55, 0.75, 0.62) * (scene + noise + roll);
    col += vec3(1.0, 0.1, 0.1) * step(length((p - vec2(0.08, 0.86)) * vec2(asp, 1.0)), 0.04) * step(0.5, fract(tt * 0.8));
    col += vec3(0.8) * step(0.83, p.y) * step(p.y, 0.9) * step(0.62, p.x) * step(p.x, 0.95) * step(0.35, scrHash(floor(p.x * 40.0) + floor(tt)));
  }
  col *= 0.85 + 0.15 * sin(u.y * 180.0);
  vec2 vv = u - 0.5;
  col *= 1.0 - dot(vv, vv) * 1.1;
  col *= 0.94 + 0.06 * sin(tt * 37.0);
  diffuseColor.rgb = col * 1.25;
`;

export function makeScreenMaterial(keepHeight = 0.95): THREE.MeshBasicMaterial {
  const m = applyCutaway(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), keepHeight);
  const cut = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    cut(sh, r);
    sh.uniforms.uScrTime = screenUniforms.uScrTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aSUv;\nattribute vec3 aScr;\nvarying vec2 vSUv;\nvarying vec3 vScr;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSUv = aSUv; vScr = aScr;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSUv;\nvarying vec3 vScr;\nuniform float uScrTime;\nfloat scrHash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }')
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG);
  };
  m.customProgramCacheKey = () => 'screen' + keepHeight;
  return m;
}

let counter = 0;
/** Screen quad facing +z, w x h, with its content style (-1 = pick one) and a unique seed. */
export function screenQuad(w: number, h: number, style = -1): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h).toNonIndexed();
  const n = g.attributes.position.count;
  const uv = g.attributes.uv.array as Float32Array;
  const scr = new Float32Array(n * 3);
  const id = counter++;
  const s = style >= 0 ? style : Math.floor((Math.sin(id * 91.7) * 0.5 + 0.5) * SCREEN_STYLES) % SCREEN_STYLES;
  const seed = (id * 0.6180339) % 1;
  for (let i = 0; i < n; i++) { scr[i * 3] = s; scr[i * 3 + 1] = seed; scr[i * 3 + 2] = w / h; }
  g.setAttribute('aSUv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('aScr', new THREE.BufferAttribute(scr, 3));
  g.deleteAttribute('uv');
  return g;
}
