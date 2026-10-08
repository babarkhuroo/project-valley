import * as THREE from 'three';
import { WATER_LEVEL, type Terrain } from '../world/terrain';
import { sharedUniforms } from './wind';

/**
 * Stylised water: a single plane whose shader reads a baked depth map to blend
 * shallow turquoise into deep blue, with a lapping foam line at the shore.
 */
export function createWater(terrain: Terrain): THREE.Mesh {
  const { map } = terrain;
  const res = 256;
  const sizeX = map.width + map.margin * 2;
  const sizeZ = map.height + map.margin * 2;
  const data = new Uint8Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const x = -map.margin + ((i + 0.5) / res) * sizeX;
      const z = -map.margin + ((j + 0.5) / res) * sizeZ;
      const depth = WATER_LEVEL - terrain.heightAt(x, z);
      data[j * res + i] = Math.max(0, Math.min(255, Math.round((depth / 2) * 255)));
    }
  }
  const depthTex = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.UnsignedByteType);
  depthTex.magFilter = THREE.LinearFilter;
  depthTex.minFilter = THREE.LinearFilter;
  depthTex.needsUpdate = true;

  const geo = new THREE.PlaneGeometry(sizeX, sizeZ, 1, 1);
  geo.rotateX(-Math.PI / 2);
  // PlaneGeometry UVs run +v towards -z after rotation; flip so v follows +z like the depth map.
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  geo.translate(map.width / 2, WATER_LEVEL, map.height / 2);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uDepth: { value: depthTex },
        uShallow: { value: new THREE.Color('#7fd6d0') },
        uDeep: { value: new THREE.Color('#3f8fc4') },
        uFoam: { value: new THREE.Color('#f4fbf6') },
        uDayTint: { value: new THREE.Color('#ffffff') },
      },
    ]),
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform sampler2D uDepth;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uFoam;
      uniform vec3 uDayTint;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        float depth = texture2D(uDepth, vUv).r * 2.0;
        if (depth <= 0.001) discard;
        float t = smoothstep(0.0, 1.2, depth);
        vec3 col = mix(uShallow, uDeep, t);
        float w = sin(vWorld.x * 1.7 + uTime * 1.1) * sin(vWorld.z * 1.3 - uTime * 0.8)
                + 0.6 * sin((vWorld.x + vWorld.z) * 2.6 + uTime * 1.6);
        col += smoothstep(1.0, 1.5, w) * 0.1;
        float edge = 0.07 + 0.035 * sin(uTime * 1.4 + vWorld.x * 2.1 + vWorld.z * 1.7);
        float foam = 1.0 - smoothstep(edge, edge + 0.07, depth);
        col = mix(col, uFoam, foam * 0.9);
        float alpha = max(mix(0.62, 0.9, t), foam * 0.95);
        gl_FragColor = vec4(col * uDayTint, alpha);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  material.uniforms.uTime = sharedUniforms.uTime;
  material.uniforms.uDayTint = sharedUniforms.uDayTint;
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 1;
  mesh.name = 'water';
  return mesh;
}
