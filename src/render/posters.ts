import * as THREE from 'three';
import { applyCutaway } from './cutaway';
import { posterSpots } from './posterSpots';
import { RefCache } from '../core/refcache';
import type { FloorLayout } from '../gen/floor';

/**
 * Wall posters from public/posters/ (moddable: drop any .jpg in; the list is posters/index.json, written at build
 * time and, in the desktop app, read live from the folder). Images are fitted inside 512 x 512, transparency shows
 * black, and each poster on a floor is picked at random.
 */
let list: Promise<string[]> | null = null;
/** textures are shared between floors and freed when no built floor uses them (~1.4 MB of GPU memory each) */
const textures = new RefCache<string, THREE.Texture>(loadPoster, (t) => t.dispose());

function posterList(): Promise<string[]> {
  return (list ??= fetch(`${import.meta.env.BASE_URL}posters/index.json`)
    .then((r) => (r.ok ? r.json() : []))
    .then((a: unknown) => (Array.isArray(a) ? a.filter((n): n is string => typeof n === 'string' && /\.jpe?g$/i.test(n) && !n.includes('/')) : []))
    .catch(() => []));
}

function loadPoster(name: string): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => { // fit inside 512 x 512 on black (covers transparency and any aspect ratio)
    const k = Math.min(512 / img.naturalWidth, 512 / img.naturalHeight, 1);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
    g.drawImage(img, (512 - w) / 2, (512 - h) / 2, w, h);
    t.needsUpdate = true;
  };
  img.src = `${import.meta.env.BASE_URL}posters/${encodeURIComponent(name)}`;
  return t;
}

const frameGeo = new THREE.BoxGeometry(0.86, 0.86, 0.03);
frameGeo.userData.shared = true; // FloorView.dispose leaves shared geometry alone
const frameMat = applyCutaway(new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 }));
const posterGeo = new THREE.PlaneGeometry(0.78, 0.78);
posterGeo.userData.shared = true;

/** Posters for a floor, hung at eye height on camera-facing walls. Textures fill in as they load. Returns the disposer. */
export function buildPosters(L: FloorLayout, group: THREE.Group, seed = Math.random() * 1e9): { dispose(): void } {
  const spots = posterSpots(L, Math.floor(seed));
  const mats: THREE.Material[] = [], used: string[] = [];
  let disposed = false;
  const handle = { dispose() { disposed = true; mats.forEach((m) => m.dispose()); used.forEach((n) => textures.release(n)); mats.length = used.length = 0; } };
  if (!spots.length) return handle;
  void posterList().then((names) => {
    if (!names.length || disposed) return; // the floor was left before the list arrived
    for (const s of spots) {
      const name = names[Math.floor(Math.random() * names.length)];
      used.push(name);
      const mat = applyCutaway(new THREE.MeshStandardMaterial({ map: textures.take(name), roughness: 0.75 }));
      mats.push(mat);
      const frame = new THREE.Mesh(frameGeo, frameMat), pic = new THREE.Mesh(posterGeo, mat);
      frame.position.set(s.tx + 0.5, 1.55, s.ty + 1 + 0.015);
      pic.position.set(s.tx + 0.5, 1.55, s.ty + 1 + 0.032);
      group.add(frame, pic);
    }
  });
  return handle;
}
