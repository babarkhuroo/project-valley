import * as THREE from 'three';

/**
 * The finishing pass over the 3D view: a soft bloom that makes lamps, windows and
 * embers glow (mostly after dark), a gentle "miniature" tilt-shift that blurs the top
 * and bottom of the screen like a photo of a model village, and a light colour grade
 * with a vignette. Tone mapping and sRGB output move here from the renderer, since
 * the scene is drawn into a linear HDR target first.
 *
 *   scene ─▶ HDR target (MSAA) ─┬─▶ ½ res copy ─▶ blur ─────────────┐
 *                               └─▶ ¼ res bright pass ─▶ blur ×2 ───┤
 *                                                     composite ◀───┘ ─▶ screen
 *
 * `level`: 'full' (everything), 'light' (bloom and grade, no tilt-shift blur), or
 * 'off' (the scene is drawn straight to the screen, as before).
 */
export type EffectsLevel = 'full' | 'light' | 'off';

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** 4-tap box downsample, optionally keeping only what's brighter than a soft threshold. */
const DOWNSAMPLE_FS = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  if (uThreshold > 0.0) {
    float l = max(c.r, max(c.g, c.b));
    float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    c *= max(soft, l - uThreshold) / max(l, 1e-4);
  }
  gl_FragColor = vec4(c, 1.0);
}`;

/** Separable 9-tap Gaussian. */
const BLUR_FS = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += texture2D(tSrc, vUv + uStep * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv - uStep * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv + uStep * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tSrc, vUv - uStep * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMPOSITE_FS = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBlur;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uTilt;
uniform float uBand;
uniform float uSaturation;
uniform float uWarmth;
uniform float uVignette;
varying vec2 vUv;
void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  if (uTilt > 0.0) {
    // Sharp in a band across the middle, softening towards the top and bottom.
    float d = abs(vUv.y - 0.5) * 2.0;
    float k = smoothstep(uBand, uBand + 0.5, d) * uTilt;
    col = mix(col, texture2D(tBlur, vUv).rgb, k);
  }
  col += texture2D(tBloom, vUv).rgb * uBloom;
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, uSaturation);
  col *= vec3(1.0 + uWarmth, 1.0, 1.0 - uWarmth);
  gl_FragColor = vec4(max(col, 0.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  float r = length(vUv - 0.5) * 1.4142;
  gl_FragColor.rgb *= 1.0 - uVignette * smoothstep(0.55, 1.05, r);
}`;

function target(samples = 0): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthBuffer: samples > 0 });
}

export class PostFX {
  level: EffectsLevel = 'full';
  /** 0..1: how strong the tilt-shift blur is (the renderer raises it as the camera pulls back). */
  tilt = 0.5;
  /** Player preference: the miniature blur can be turned off on its own. */
  miniature = true;
  /** 0 by day … 1 at night: bloom grows after dark, when lamps are the brightest things around. */
  night = 0;
  /** 0..1 cloud cover: the grade turns greyer and cooler under rain. */
  overcast = 0;

  private readonly scene = target(4);
  private readonly halfA = target();
  private readonly halfB = target();
  private readonly quarterA = target();
  private readonly quarterB = target();
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly down: THREE.ShaderMaterial;
  private readonly blur: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private readonly black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private readonly size = new THREE.Vector2();

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.black.needsUpdate = true;
    const material = (fs: string, uniforms: Record<string, THREE.IUniform>, toneMapped = false) =>
      new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, toneMapped });
    this.down = material(DOWNSAMPLE_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0 }, uKnee: { value: 0.3 } });
    this.blur = material(BLUR_FS, { tSrc: { value: null }, uStep: { value: new THREE.Vector2() } });
    this.composite = material(
      COMPOSITE_FS,
      {
        tScene: { value: null },
        tBlur: { value: this.black },
        tBloom: { value: this.black },
        uBloom: { value: 0 },
        uTilt: { value: 0 },
        uBand: { value: 0.32 },
        uSaturation: { value: 1.06 },
        uWarmth: { value: 0.015 },
        uVignette: { value: 0.22 },
      },
      true,
    );
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.composite);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Call whenever the canvas size or pixel ratio changes. */
  resize(): void {
    this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x);
    const h = Math.max(1, this.size.y);
    this.scene.setSize(w, h);
    this.halfA.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.halfB.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.quarterA.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
    this.quarterB.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
  }

  private pass(material: THREE.ShaderMaterial, out: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(out);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  private downsample(src: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget, threshold: number): void {
    this.down.uniforms.tSrc.value = src.texture;
    this.down.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
    this.down.uniforms.uThreshold.value = threshold;
    this.pass(this.down, out);
  }

  /** Blurs `a` in place (through `b`), `spread` texels per tap step. */
  private gaussian(a: THREE.WebGLRenderTarget, b: THREE.WebGLRenderTarget, spread: number): void {
    this.blur.uniforms.tSrc.value = a.texture;
    this.blur.uniforms.uStep.value.set(spread / a.width, 0);
    this.pass(this.blur, b);
    this.blur.uniforms.tSrc.value = b.texture;
    this.blur.uniforms.uStep.value.set(0, spread / a.height);
    this.pass(this.blur, a);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;
    if (this.level === 'off') {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    if (this.scene.width <= 1) this.resize();
    r.setRenderTarget(this.scene);
    r.render(scene, camera);

    const u = this.composite.uniforms;
    const tilt = this.level === 'full' && this.miniature ? this.tilt : 0;
    if (tilt > 0.01) {
      this.downsample(this.scene, this.halfA, 0);
      this.gaussian(this.halfA, this.halfB, 1.6);
      this.gaussian(this.halfA, this.halfB, 2.6);
      u.tBlur.value = this.halfA.texture;
    } else {
      u.tBlur.value = this.black;
    }
    // Bloom: only the brightest things by day, every lit window and lantern at night.
    const threshold = 1.25 - this.night * 0.7;
    this.downsample(this.scene, this.quarterA, threshold);
    this.gaussian(this.quarterA, this.quarterB, 1.4);
    if (this.level === 'full') this.gaussian(this.quarterA, this.quarterB, 2.8);
    u.tBloom.value = this.quarterA.texture;
    u.uBloom.value = 0.4 + this.night * 1.2;
    u.tScene.value = this.scene.texture;
    u.uTilt.value = tilt;
    u.uSaturation.value = 1.06 - this.overcast * 0.22;
    u.uWarmth.value = 0.015 - this.overcast * 0.035;
    this.pass(this.composite, null);
  }

  dispose(): void {
    for (const t of [this.scene, this.halfA, this.halfB, this.quarterA, this.quarterB]) t.dispose();
    for (const m of [this.down, this.blur, this.composite]) m.dispose();
    this.quad.geometry.dispose();
    this.black.dispose();
  }
}
