import * as THREE from 'three';
import { OperatorRig } from './operator';
import type { PlayerLook } from '../config/look';

const POST_FRAG = `
uniform sampler2D tex; uniform float t; uniform vec2 res; varying vec2 vUv;
void main() {
  vec4 s = texture2D(tex, vUv);
  vec2 g = abs(fract(vUv * res / 22.0) - 0.5);
  float grid = smoothstep(0.46, 0.5, max(g.x, g.y));
  vec3 col = mix(vec3(0.004, 0.03, 0.04) + vec3(0.02, 0.16, 0.2) * grid * 0.35, s.rgb, s.a);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, l * vec3(0.45, 1.3, 1.45), 0.18); // phosphor cast (the colours stay readable)
  col *= 0.9 + 0.1 * sin(vUv.y * res.y * 1.5708); // scanlines
  col *= 0.97 + 0.03 * sin(t * 61.0) * sin(t * 7.3); // faint flicker
  col += (fract(sin(dot(floor(vUv * res) + floor(t * 24.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.05; // film grain
  vec2 d = vUv - 0.5;
  col *= 1.0 - dot(d, d) * 1.1; // vignette
  col += vec3(0.0, 0.035, 0.045) * (1.0 - length(d) * 1.6); // screen glow
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * Armory Appearance tab: the operator with the current look in an A-pose, turning slowly, on a retro phosphor screen
 * (scanlines, grid, vignette, flicker). Own small renderer; it draws only while its canvas is on the page and frees
 * itself once the canvas leaves it (tab switched, armory closed).
 */
/** One GL context for every preview: reopening the Appearance tab reuses it instead of creating another. */
let shared: THREE.WebGLRenderer | null = null;
let owner: LookPreview | null = null;

export class LookPreview {
  readonly canvas: HTMLCanvasElement;
  private r: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  private rt: THREE.WebGLRenderTarget;
  private post: { scene: THREE.Scene; cam: THREE.OrthographicCamera; mat: THREE.ShaderMaterial };
  private rig: OperatorRig | null = null;
  private key = '';
  private raf = 0;
  private t0 = performance.now();
  private last = 0;

  constructor(look: PlayerLook, w = 340, h = 440) {
    this.r = shared ??= new THREE.WebGLRenderer({ antialias: false, alpha: false });
    owner = this;
    this.r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.r.setSize(w, h, false);
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.r.domElement;
    this.canvas.className = 'lk-screen';
    const pr = this.r.getPixelRatio();
    this.rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { samples: 4 });
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    this.cam.position.set(0, 1.35, 4.6); this.cam.lookAt(0, 1.17, 0);
    const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(2, 4, 4);
    const rim = new THREE.DirectionalLight(0x35d8ff, 2.2); rim.position.set(-3, 2, -3);
    this.scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x2a3036, 1.7), key, rim);
    const mat = new THREE.ShaderMaterial({ uniforms: { tex: { value: this.rt.texture }, t: { value: 0 }, res: { value: new THREE.Vector2(w * pr, h * pr) } }, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: POST_FRAG, depthTest: false });
    const ps = new THREE.Scene();
    ps.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    this.post = { scene: ps, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mat };
    this.setLook(look);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Live update: a new look swaps in that look's (cached) rig. */
  setLook(look: PlayerLook) {
    const k = JSON.stringify(look);
    if (k === this.key) return;
    this.key = k;
    if (this.rig) this.scene.remove(this.rig.root);
    this.rig = OperatorRig.make(0x35d8ff, { player: look });
    this.scene.add(this.rig.root);
  }

  private frame = (now: number) => {
    if (owner !== this || !this.canvas.isConnected) { this.dispose(); return; }
    this.raf = requestAnimationFrame(this.frame);
    const t = (now - this.t0) / 1000, dt = Math.min(0.1, t - this.last);
    this.last = t;
    this.rig!.update({ dt, t, x: 0, y: 0, z: 0, facing: Math.PI / 2 - t * 0.5, crouch: false, aiming: false, sprinting: false, firingRecently: false, life: 'alive', gun: null, aimPitch: 0, reload: -1, hurt: false, pose: 'apose', vel: { vx: 0, vy: 0 } });
    this.r.setRenderTarget(this.rt);
    this.r.setClearColor(0x000000, 0);
    this.r.clear();
    this.r.render(this.scene, this.cam);
    this.r.setRenderTarget(null);
    this.post.mat.uniforms.t.value = t;
    this.r.render(this.post.scene, this.post.cam);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    // the rig's geometry and materials are shared with the game (OperatorRig cache), and the renderer with the next
    // preview: only this preview's own targets go
    this.rt.dispose(); this.post.mat.dispose();
    if (owner === this) owner = null;
  }
}
