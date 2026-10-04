import * as THREE from 'three';

/** Soft volumetric-looking light cone: bright at the source, fading with length and at the silhouette edges. */
export function beamMaterial(color: number, opacity: number): THREE.ShaderMaterial & { uniforms: { uColor: { value: THREE.Color }; uOpacity: { value: number } } } {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ float along = pow(clamp(vUv.y, 0.0, 1.0), 1.6); float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
        gl_FragColor = vec4(uColor, uOpacity * along * edge); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }) as any;
}
