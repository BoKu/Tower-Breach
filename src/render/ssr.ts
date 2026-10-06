import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Screen-space ray-traced floor reflections. For every floor pixel the view ray is reflected about the floor normal
 * and marched through the depth buffer; on a hit the scene colour there is blended back in (fresnel + distance +
 * screen-edge fade). Needs the read buffer to carry a depth texture (see GameRenderer).
 * ponytail: floor plane only (y ~ 0); walls and desk tops don't reflect. Add a normal buffer if they must.
 */
const shader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.DepthTexture | null },
    uProj: { value: new THREE.Matrix4() },
    uInvProj: { value: new THREE.Matrix4() },
    uView: { value: new THREE.Matrix4() },
    uInvView: { value: new THREE.Matrix4() },
    uStrength: { value: 0.28 },
    /** surface gloss: 1 = polished indoor tile, lower for the street's asphalt (set by the renderer per floor) */
    uGloss: { value: 1 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform sampler2D tDepth;
    uniform mat4 uProj, uInvProj, uView, uInvView; uniform float uStrength, uGloss;
    varying vec2 vUv;
    vec3 viewPos(vec2 uv, float d) { vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float d = texture2D(tDepth, vUv).r;
      gl_FragColor = col;
      if (d >= 0.9999) return;
      vec3 vp = viewPos(vUv, d);
      vec3 wp = (uInvView * vec4(vp, 1.0)).xyz;
      if (abs(wp.y) > 0.035) return; // floor plane only
      vec3 cam = (uInvView * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vec3 V = normalize(wp - cam);
      vec3 R = reflect(V, vec3(0.0, 1.0, 0.0));
      float t = 0.08, hitT = -1.0, prev = -1.0; vec2 hitUv = vec2(0.0);
      for (int i = 0; i < 40; i++) {
        vec3 p = wp + R * t;
        vec4 c = uProj * uView * vec4(p, 1.0);
        vec2 uv = c.xy / c.w * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        float rayZ = -(uView * vec4(p, 1.0)).z;
        float sceneZ = -viewPos(uv, texture2D(tDepth, uv).r).z;
        float diff = rayZ - sceneZ;
        // a hit must cross the surface this step (in front of it the step before) within a thin window, so a thin
        // object is found once instead of once per later step that lands behind it
        if (prev < 0.0 && diff > 0.0 && diff < 0.12 + t * 0.03) {
          // refine between the last two steps
          float a = t / 1.12, b = t;
          for (int j = 0; j < 5; j++) {
            float m = 0.5 * (a + b);
            vec3 q = wp + R * m; vec4 cq = uProj * uView * vec4(q, 1.0); vec2 uq = cq.xy / cq.w * 0.5 + 0.5;
            float dq = -(uView * vec4(q, 1.0)).z + viewPos(uq, texture2D(tDepth, uq).r).z;
            if (dq > 0.0) b = m; else a = m;
          }
          vec3 q = wp + R * b; vec4 cq = uProj * uView * vec4(q, 1.0);
          hitUv = cq.xy / cq.w * 0.5 + 0.5;
          if (abs(-(uView * vec4(q, 1.0)).z + viewPos(hitUv, texture2D(tDepth, hitUv).r).z) < 0.06) hitT = b; // refined onto a real surface
          break;
        }
        prev = diff;
        t *= 1.12;
      }
      if (hitT < 0.0) return;
      vec3 refl = texture2D(tDiffuse, hitUv).rgb;
      vec2 e = min(hitUv, 1.0 - hitUv);
      float edge = clamp(min(e.x, e.y) * 8.0, 0.0, 1.0);
      float fres = 0.06 + 0.6 * pow(1.0 - max(dot(-V, vec3(0.0, 1.0, 0.0)), 0.0), 4.0);
      float k = uStrength * uGloss * fres * edge * exp(-hitT * 0.4);
      gl_FragColor = vec4(col.rgb + refl * k, col.a);
    }`,
};

export class SSRPass extends Pass {
  private quad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;
  set gloss(v: number) { this.mat.uniforms.uGloss.value = v; }
  constructor(private camera: THREE.PerspectiveCamera) {
    super();
    this.mat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(shader.uniforms), vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader, depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.mat);
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const u = this.mat.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.uProj.value.copy(this.camera.projectionMatrix);
    u.uInvProj.value.copy(this.camera.projectionMatrixInverse);
    u.uView.value.copy(this.camera.matrixWorldInverse);
    u.uInvView.value.copy(this.camera.matrixWorld);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.mat.dispose(); this.quad.dispose(); }
}
