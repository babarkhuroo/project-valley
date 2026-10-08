import * as THREE from 'three';

/** Global uniforms shared by every animated shader (updated once per frame). */
export const sharedUniforms = {
  uTime: { value: 0 },
  /** Light tint for unlit shaders (water, smoke) — white by day, blue at night (DayCycle). */
  uDayTint: { value: new THREE.Color('#ffffff') },
};

/**
 * Patches a material so instanced foliage sways in the wind. Vertices higher above
 * the mesh origin move more; each instance gets its own phase from its position.
 */
export function applyWind(material: THREE.Material, strength = 1, pivotHeight = 0.5): THREE.Material {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float h = max(0.0, position.y - ${pivotHeight.toFixed(2)});
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
          #else
            vec3 ip = vec3(modelMatrix[3].x, 0.0, modelMatrix[3].z);
          #endif
          float ph = ip.x * 0.37 + ip.z * 0.29;
          float gust = 0.6 + 0.4 * sin(uTime * 0.35 + ip.x * 0.05);
          transformed.x += sin(uTime * 1.4 + ph) * 0.045 * h * ${strength.toFixed(2)} * gust;
          transformed.z += cos(uTime * 1.13 + ph * 1.3) * 0.03 * h * ${strength.toFixed(2)} * gust;
        }`,
      );
  };
  material.customProgramCacheKey = () => `wind-${strength}-${pivotHeight}`;
  return material;
}
