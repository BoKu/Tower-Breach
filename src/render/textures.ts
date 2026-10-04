import * as THREE from 'three';
import { Rng } from '../core/rng';

/** All textures are generated procedurally at startup (original assets, no external files). */
const cache = new Map<string, THREE.Texture>();

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function noise(ctx: CanvasRenderingContext2D, size: number, rng: Rng, amount: number, dark = true) {
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng.next() - 0.5) * amount;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n * (dark ? 1 : 0.8)));
  }
  ctx.putImageData(img, 0, 0);
}

function stains(ctx: CanvasRenderingContext2D, size: number, rng: Rng, n: number, color: string, maxR: number) {
  for (let i = 0; i < n; i++) {
    const x = rng.next() * size, y = rng.next() * size, r = rng.range(maxR * 0.2, maxR);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function make(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, rng: Rng, s: number) => void, repeat = 1): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(size);
  draw(ctx, new Rng(key.length * 7919 + key.charCodeAt(0)), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

export const tex = {
  carpet: () => make('carpet', 128, (ctx, rng, s) => {
    ctx.fillStyle = '#4a4e57'; ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 8) for (let x = 0; x < s; x += 8) { ctx.fillStyle = (x + y) % 16 ? '#474b54' : '#50545d'; ctx.fillRect(x, y, 8, 8); }
    noise(ctx, s, rng, 26);
    stains(ctx, s, rng, 3, 'rgba(20,15,10,0.35)', 30);
  }),
  tile: () => make('tile', 128, (ctx, rng, s) => {
    ctx.fillStyle = '#9aa0a3'; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#5c6264'; ctx.lineWidth = 2;
    for (let i = 0; i <= s; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke(); }
    noise(ctx, s, rng, 18);
    stains(ctx, s, rng, 4, 'rgba(60,50,20,0.3)', 26);
  }),
  concrete: () => make('concrete', 128, (ctx, rng, s) => {
    ctx.fillStyle = '#7a7b79'; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, rng, 40);
    stains(ctx, s, rng, 6, 'rgba(25,25,22,0.35)', 34);
    ctx.strokeStyle = 'rgba(30,30,30,0.5)'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); let x = rng.next() * s, y = rng.next() * s; ctx.moveTo(x, y); for (let k = 0; k < 6; k++) { x += rng.range(-14, 14); y += rng.range(-14, 14); ctx.lineTo(x, y); } ctx.stroke(); }
  }),
  metal: () => make('metal', 128, (ctx, rng, s) => {
    ctx.fillStyle = '#4a5055'; ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) for (let x = 0; x < s; x += 16) {
      ctx.fillStyle = '#5d646a';
      ctx.save(); ctx.translate(x + 8, y + 8); ctx.rotate(((x + y) / 16) % 2 ? 0.7 : -0.7); ctx.fillRect(-5, -1.5, 10, 3); ctx.restore();
    }
    noise(ctx, s, rng, 20);
    stains(ctx, s, rng, 3, 'rgba(70,40,15,0.35)', 24);
  }),
  asphalt: () => make('asphalt', 128, (ctx, rng, s) => {
    ctx.fillStyle = '#56585c'; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, rng, 30);
    stains(ctx, s, rng, 2, 'rgba(20,20,20,0.18)', 60);
    // faint aggregate speckle instead of repeating dark blotches
    for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(${rng.chance(0.5) ? '255,255,255' : '0,0,0'},0.08)`; ctx.fillRect(rng.next() * s, rng.next() * s, 1.5, 1.5); }
  }),
  wall: () => make('wall', 128, (ctx, rng, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#8d8a82'); g.addColorStop(0.75, '#77746d'); g.addColorStop(1, '#3f3d39');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, rng, 18);
    stains(ctx, s, rng, 5, 'rgba(40,35,25,0.35)', 40);
    // skirting board
    ctx.fillStyle = '#2d2b28'; ctx.fillRect(0, s - 10, s, 10);
  }),
  facade: () => make('facade', 128, (ctx, rng, s) => {
    ctx.fillStyle = '#1b1e22'; ctx.fillRect(0, 0, s, s);
    for (let y = 4; y < s; y += 16) for (let x = 4; x < s; x += 12) {
      const lit = rng.chance(0.12);
      ctx.fillStyle = lit ? (rng.chance(0.5) ? '#6e5a2a' : '#35506a') : '#0c0e11';
      ctx.fillRect(x, y, 7, 10);
    }
    noise(ctx, s, rng, 10);
  }),
  wood: () => make('wood', 64, (ctx, rng, s) => {
    ctx.fillStyle = '#4a3322'; ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) { ctx.fillStyle = `rgba(${30 + rng.int(0, 30)},${20 + rng.int(0, 15)},10,0.35)`; ctx.fillRect(0, y, s, 1); }
    noise(ctx, s, rng, 16);
  }),
  screen: () => make('screen', 64, (ctx, rng, s) => {
    ctx.fillStyle = '#061018'; ctx.fillRect(0, 0, s, s);
    for (let y = 6; y < s; y += 6) { ctx.fillStyle = `rgba(80,200,255,${rng.range(0.2, 0.7)})`; ctx.fillRect(4, y, rng.range(10, s - 8), 2); }
  }),
  blood: () => make('blood', 64, (ctx, rng, s) => {
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 9; i++) {
      const x = s / 2 + rng.range(-16, 16), y = s / 2 + rng.range(-16, 16), r = rng.range(4, 14);
      ctx.fillStyle = 'rgba(70,6,6,0.8)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill();
    }
  }),
  scorch: () => make('scorch', 64, (ctx, _rng, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.6, 'rgba(10,8,6,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }),
  soft: () => make('soft', 64, (ctx, _rng, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }),
  hazard: () => make('hazard', 64, (ctx, _rng, s) => {
    ctx.fillStyle = '#c9a21a'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#151515';
    for (let i = -s; i < s * 2; i += 16) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 8, 0); ctx.lineTo(i + 8 - s, s); ctx.lineTo(i - s, s); ctx.fill(); }
  }),
  boarded: () => make('boarded', 64, (ctx, rng, s) => {
    ctx.fillStyle = '#0d0d0d'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 4; i++) { ctx.save(); ctx.translate(s / 2, 8 + i * 15); ctx.rotate(rng.range(-0.25, 0.25)); ctx.fillStyle = '#3d2c1e'; ctx.fillRect(-s / 2 - 4, -5, s + 8, 10); ctx.restore(); }
    noise(ctx, s, rng, 12);
  }),
};
