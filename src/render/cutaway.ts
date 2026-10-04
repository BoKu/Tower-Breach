import * as THREE from 'three';

/** Shared uniforms: walls/tall props between the camera and the local player are cut down so the player stays readable. */
export const cutUniforms = {
  uPlayer: { value: new THREE.Vector3() },
  uCamDir: { value: new THREE.Vector2(-0.707, -0.707) },
  uCutOn: { value: 1 },
};

export function applyCutaway<T extends THREE.Material>(m: T, keepHeight = 0.4): T {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPlayer = cutUniforms.uPlayer;
    shader.uniforms.uCamDir = cutUniforms.uCamDir;
    shader.uniforms.uCutOn = cutUniforms.uCutOn;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 cutWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cutWp = instanceMatrix * cutWp;
        #endif
        vCutWorld = (modelMatrix * cutWp).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;\nuniform vec3 uPlayer;\nuniform vec2 uCamDir;\nuniform float uCutOn;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (uCutOn > 0.5 && vCutWorld.y > ${keepHeight.toFixed(2)}) {
          vec2 rel = vCutWorld.xz - uPlayer.xz;
          float along = dot(rel, uCamDir);
          float perp = length(rel - along * uCamDir);
          if (along > -0.6 && along < 11.0 && perp < 2.6 + along * 0.28) discard;
        }`);
  };
  m.customProgramCacheKey = () => 'cutaway' + keepHeight;
  return m;
}
