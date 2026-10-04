import * as THREE from 'three';
import { buildPortraitScene, studioEnvironment } from './portraitHead';
import { lookFor, portraitFile } from '../config/npcs';

/**
 * Officer portraits for the dialogue panel. Shipped as PNGs in public/portraits/ (moddable); this module can also
 * render them live from each officer's look (config/npcs.ts) with the high-detail portrait head (portraitHead.ts).
 * Live renders are supersampled (1024 → 512) and cached as PNG data URLs.
 */
const OUT = 512, SS = 2;
let renderer: THREE.WebGLRenderer | null = null;
let env: THREE.Texture | null = null;
const cache = new Map<number, string>();

const seedOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) / 4294967296;

/** Data URL portrait for street officer `npc` (-1 = Chief Hollis); null if WebGL is unavailable. */
export function officerPortrait(npc: number): string | null {
  const hit = cache.get(npc);
  if (hit) return hit;
  try {
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(OUT * SS, OUT * SS, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      env = studioEnvironment(renderer);
    }
    const { scene, camera, dispose } = buildPortraitScene(lookFor(npc), seedOf(portraitFile(npc)), npc < 0);
    scene.environment = env;
    scene.environmentIntensity = 0.45;
    renderer.render(scene, camera);
    // downsample for clean edges and fine hair
    const out = document.createElement('canvas'); out.width = out.height = OUT;
    const g = out.getContext('2d')!;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(renderer.domElement, 0, 0, OUT, OUT);
    const url = out.toDataURL('image/png');
    dispose();
    cache.set(npc, url);
    return url;
  } catch {
    return null;
  }
}

/**
 * The portrait image for an officer: the PNG in public/portraits/ (modders can replace these files), falling
 * back to a live render if the file is missing or fails to load.
 */
export function portraitImg(npc: number): HTMLImageElement {
  const img = new Image();
  img.alt = '';
  img.onerror = () => { img.onerror = null; const live = officerPortrait(npc); if (live) img.src = live; };
  img.src = `${import.meta.env.BASE_URL}portraits/${portraitFile(npc)}`;
  return img;
}
