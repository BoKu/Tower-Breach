import * as THREE from 'three';
import { applyCutaway } from './cutaway';
import { royalFlushCards, CARD_W, CARD_H } from './models';
import { dartSpot } from './posterSpots';
import type { FloorLayout, Prop } from '../gen/floor';

/**
 * Easter eggs drawn in code: the royal flush on floor 8's poker table, and floor 4's dartboard (three darts in the
 * treble 20) with its high-score board. Returns what to dispose with the floor.
 */
const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')!] as const; };
const tex = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

function cardFace(rank: string): HTMLCanvasElement {
  const [c, g] = canvas(256, 356);
  g.fillStyle = '#f7f4ea'; g.beginPath(); g.roundRect(4, 4, 248, 348, 18); g.fill();
  g.strokeStyle = '#c9c2ae'; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#111';
  const corner = (flip: boolean) => {
    g.save(); if (flip) { g.translate(256, 356); g.rotate(Math.PI); }
    g.font = 'bold 58px Georgia, serif'; g.textAlign = 'center'; g.fillText(rank, 40, 66);
    g.font = '44px serif'; g.fillText('♠', 40, 110); g.restore();
  };
  corner(false); corner(true);
  if (rank === 'A') { g.font = '170px serif'; g.textAlign = 'center'; g.fillText('♠', 128, 236); }
  else if (rank === '10') {
    g.font = '50px serif'; g.textAlign = 'center';
    for (const [x, y] of [[88, 90], [168, 90], [128, 132], [88, 170], [168, 170], [88, 230], [168, 230], [128, 270], [88, 300], [168, 300]]) g.fillText('♠', x, y);
  } else { // court card: a framed panel with the letter and a gold crown
    g.strokeStyle = '#a8862a'; g.lineWidth = 4; g.strokeRect(70, 70, 116, 216);
    g.fillStyle = '#1e3a8a'; g.fillRect(74, 74, 108, 208);
    g.fillStyle = '#d4af37'; g.font = 'bold 96px Georgia, serif'; g.textAlign = 'center'; g.fillText(rank, 128, 210);
    g.beginPath(); g.moveTo(96, 120); g.lineTo(106, 96); g.lineTo(117, 116); g.lineTo(128, 90); g.lineTo(139, 116); g.lineTo(150, 96); g.lineTo(160, 120); g.closePath(); g.fill();
  }
  return c;
}

/** The winner's face-up royal flush on the poker table prop. */
export function buildCardFaces(p: Prop, group: THREE.Group): { dispose(): void } {
  const out: { dispose(): void }[] = [];
  const geo = new THREE.PlaneGeometry(CARD_W - 0.002, CARD_H - 0.002);
  out.push(geo);
  royalFlushCards(p.w, p.h).forEach((c, i) => {
    const t = tex(cardFace(['10', 'J', 'Q', 'K', 'A'][i]));
    const m = applyCutaway(new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }), 0.95); // same cut height as table props
    out.push(t, m);
    const mesh = new THREE.Mesh(geo, m);
    mesh.rotation.set(-Math.PI / 2, 0, c.ry);
    mesh.position.set(p.x + c.x, c.y + 0.0005, p.y + c.z);
    group.add(mesh);
  });
  return { dispose: () => out.forEach((o) => o.dispose()) };
}

const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
function dartboardFace(): HTMLCanvasElement {
  const S = 1024, [c, g] = canvas(S, S), C = S / 2, k = (S / 2 - 6) / 225; // mm -> px, board edge 225 mm
  g.fillStyle = '#121212'; g.beginPath(); g.arc(C, C, 225 * k, 0, Math.PI * 2); g.fill();
  const ring = (r0: number, r1: number, odd: string, even: string) => ORDER.forEach((_, i) => {
    const a0 = (-90 - 9 + i * 18) * Math.PI / 180, a1 = a0 + Math.PI / 10;
    g.fillStyle = i % 2 ? odd : even;
    g.beginPath(); g.arc(C, C, r1 * k, a0, a1); g.arc(C, C, r0 * k, a1, a0, true); g.closePath(); g.fill();
  });
  ring(107, 162, '#e9dcc0', '#151515'); // outer singles (20 is black)
  ring(99, 107, '#1f8a3a', '#c8202a'); // trebles (20 is red)
  ring(15.9, 99, '#e9dcc0', '#151515');
  ring(162, 170, '#1f8a3a', '#c8202a'); // doubles
  g.fillStyle = '#1f8a3a'; g.beginPath(); g.arc(C, C, 15.9 * k, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c8202a'; g.beginPath(); g.arc(C, C, 6.35 * k, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#b8bcc2'; g.lineWidth = 2.2; // the wire spider
  for (const r of [6.35, 15.9, 99, 107, 162, 170]) { g.beginPath(); g.arc(C, C, r * k, 0, Math.PI * 2); g.stroke(); }
  ORDER.forEach((_, i) => { const a = (-90 - 9 + i * 18) * Math.PI / 180; g.beginPath(); g.moveTo(C + Math.cos(a) * 15.9 * k, C + Math.sin(a) * 15.9 * k); g.lineTo(C + Math.cos(a) * 170 * k, C + Math.sin(a) * 170 * k); g.stroke(); });
  g.fillStyle = '#f2f2f2'; g.font = `bold ${Math.round(24 * k)}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  ORDER.forEach((n, i) => { const a = (-90 + i * 18) * Math.PI / 180; g.fillText(String(n), C + Math.cos(a) * 196 * k, C + Math.sin(a) * 196 * k); });
  return c;
}

function scoreBoard(): HTMLCanvasElement {
  const [c, g] = canvas(512, 640);
  g.fillStyle = '#1d2b22'; g.fillRect(0, 0, 512, 640);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`; g.fillRect(Math.random() * 512, Math.random() * 640, 2, 2); } // chalk dust
  g.fillStyle = '#f4f1e2'; g.textAlign = 'center';
  g.font = 'bold 58px "Chalkboard SE", "Comic Sans MS", "Segoe Print", cursive'; g.fillText('HIGH SCORES', 256, 92);
  g.strokeStyle = 'rgba(244,241,226,0.75)'; g.lineWidth = 4; g.beginPath(); g.moveTo(70, 118); g.lineTo(442, 118); g.stroke();
  // a little dart sketch under the title
  g.lineWidth = 3; g.beginPath(); g.moveTo(190, 146); g.lineTo(322, 146); g.stroke();
  g.beginPath(); g.moveTo(322, 146); g.lineTo(306, 136); g.moveTo(322, 146); g.lineTo(306, 156); g.stroke();
  g.beginPath(); g.moveTo(190, 146); g.lineTo(176, 132); g.moveTo(190, 146); g.lineTo(176, 160); g.stroke();
  const rows: [string, string, string][] = [['1', 'ROB', '180'], ['2', 'WAQAR', '140'], ['3', 'SHREY', '100']];
  rows.forEach(([r, n, s], i) => {
    const y = 250 + i * 118;
    g.font = 'bold 54px "Chalkboard SE", "Comic Sans MS", "Segoe Print", cursive';
    g.textAlign = 'left'; g.fillStyle = i === 0 ? '#ffd76a' : '#f4f1e2'; g.fillText(`${r}.`, 34, y); g.fillText(n, 96, y, 220);
    const end = 96 + Math.min(220, g.measureText(n).width) + 10;
    g.fillText(s, 330, y); // close to the name so the camera's slant can't pair it with the wrong row
    g.globalAlpha = 0.5; for (let dx = end; dx < 320; dx += 14) g.fillRect(dx, y - 8, 5, 5); g.globalAlpha = 1;
  });
  g.font = '30px "Chalkboard SE", "Comic Sans MS", cursive'; g.fillStyle = 'rgba(244,241,226,0.7)'; g.textAlign = 'center';
  g.fillText('ONE HUNDRED AND EIGHTY!', 256, 600);
  return c;
}

/** Floor 4: the dartboard with three darts in the treble 20, and the high-score board beside it. */
export function buildDartboard(L: FloorLayout, group: THREE.Group): { dispose(): void } {
  const out: { dispose(): void }[] = [];
  const s = dartSpot(L);
  if (!s) return { dispose() {} };
  const z = s.ty + 1, x = s.tx + 0.5, y = 1.73, R = 0.3; // regulation height; board shown a little larger than life
  const wood = applyCutaway(new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.7 }));
  const cab = new THREE.BoxGeometry(0.8, 0.8, 0.05); out.push(wood, cab);
  const back = new THREE.Mesh(cab, wood); back.position.set(x, y, z + 0.026); group.add(back);
  const t1 = tex(dartboardFace()), m1 = applyCutaway(new THREE.MeshStandardMaterial({ map: t1, roughness: 0.85 }));
  const disc = new THREE.CylinderGeometry(R, R, 0.04, 48); out.push(t1, m1, disc);
  // the face texture goes on the cylinder cap facing the room
  const face = new THREE.Mesh(new THREE.CircleGeometry(R, 64), m1); out.push(face.geometry);
  face.position.set(x, y, z + 0.093); group.add(face);
  const rim = new THREE.Mesh(disc, applyCutaway(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }))); out.push(rim.material as THREE.Material);
  rim.rotation.x = Math.PI / 2; rim.position.set(x, y, z + 0.072); group.add(rim);
  // three darts in the treble 20 (top of the board), angled up and out a little
  const tR = R * (103 / 225), steel = applyCutaway(new THREE.MeshStandardMaterial({ color: 0xc9ced4, metalness: 0.8, roughness: 0.3 }));
  const shaft = applyCutaway(new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5 }));
  const flight = applyCutaway(new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.6, side: THREE.DoubleSide }));
  // darts drawn ~1.8x life size so they read from the game camera
  const gBar = new THREE.CylinderGeometry(0.014, 0.011, 0.09, 10), gShaft = new THREE.CylinderGeometry(0.007, 0.007, 0.07, 8), gFlight = new THREE.PlaneGeometry(0.065, 0.055);
  out.push(steel, shaft, flight, gBar, gShaft, gFlight);
  for (const da of [-0.11, 0.0, 0.1]) {
    const a = Math.PI / 2 + da, d = new THREE.Group();
    const bar = new THREE.Mesh(gBar, steel); bar.position.y = 0.06; d.add(bar);
    const sh = new THREE.Mesh(gShaft, shaft); sh.position.y = 0.14; d.add(sh);
    for (const r of [0, Math.PI / 2]) { const f = new THREE.Mesh(gFlight, flight); f.position.y = 0.19; f.rotation.y = r; d.add(f); }
    d.rotation.x = Math.PI / 2 - 0.25 - da * 0.5; d.rotation.z = -da * 0.6; // out of the board, tilted like a real throw
    d.position.set(x + Math.cos(a) * tR, y + Math.sin(a) * tR, z + 0.095);
    group.add(d);
  }
  // the high-score chalkboard, framed, one tile to the right
  const t2 = tex(scoreBoard()), m2 = applyCutaway(new THREE.MeshStandardMaterial({ map: t2, roughness: 0.95 }));
  const fr = new THREE.BoxGeometry(0.72, 0.88, 0.04), bd = new THREE.PlaneGeometry(0.62, 0.78); out.push(t2, m2, fr, bd);
  const frame = new THREE.Mesh(fr, wood); frame.position.set(x + 1.02, 1.62, z + 0.021); group.add(frame);
  const board = new THREE.Mesh(bd, m2); board.position.set(x + 1.02, 1.62, z + 0.042); group.add(board);
  return { dispose: () => out.forEach((o) => o.dispose()) };
}
