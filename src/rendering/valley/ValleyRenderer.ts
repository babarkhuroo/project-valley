import * as THREE from 'three';
import { DISTRICTS, VALLEY_BUILDING_ORDER, VALLEY_BUILDINGS, type ValleyBuildingId } from '../../config/valley';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { Game } from '../../game/Game';
import { villagerPosition } from '../../sim/villagerAI';
import type { ValleySnapshot } from '../../valley/types';
import { deliveredFraction } from '../../valley/valleySim';
import { ICONS } from '../../ui/icons';
import { AmbientLife } from '../AmbientLife';
import { createBridges } from '../BridgeView';
import { CameraController } from '../CameraController';
import { ChunkGrid } from '../culling/ChunkGrid';
import { InputController, type PickResult } from '../InputController';
import { NatureView } from '../NatureView';
import { Particles } from '../Particles';
import { SelectionView } from '../SelectionView';
import { SmokeSystem } from '../SmokeSystem';
import { TerrainView } from '../TerrainView';
import { VillagersView } from '../VillagersView';
import { createWater } from '../WaterView';
import { sharedUniforms } from '../wind';
import { WorldOverlay } from '../WorldOverlay';
import { ValleyBuildingsView } from './ValleyBuildingsView';
import { ValleyFolk } from './ValleyFolk';
import { ShipView } from './ShipView';
import { createValleyScene, type ValleyScene } from './valleyWorld';

const SKY = new THREE.Color('#d3e9ee');

export interface ValleyInteraction {
  onHover(id: ValleyBuildingId | null): void;
  onSelect(id: ValleyBuildingId | null): void;
  onCancel(): void;
}

let sceneCache: ValleyScene | null = null;

/**
 * Renders the shared Valley: terrain, river and bay, scenery, the communal buildings
 * at their current stage, and neighbours going about their errands. It keeps ticking
 * the player's village (time doesn't stop while visiting) but draws none of it.
 */
export class ValleyRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly cameraCtl: CameraController;
  selected: ValleyBuildingId | null = null;
  hovered: ValleyBuildingId | null = null;
  onFrame: ((realTime: number) => void) | null = null;

  private readonly valley: ValleyScene;
  private readonly chunks: ChunkGrid;
  private readonly nature: NatureView;
  private readonly buildings: ValleyBuildingsView;
  private readonly folk: ValleyFolk;
  private readonly folkView: VillagersView;
  private readonly particles = new Particles();
  private readonly ship = new ShipView();
  private readonly smoke = new SmokeSystem();
  private readonly ambient: AmbientLife;
  private readonly selection: SelectionView;
  private readonly overlay: WorldOverlay;
  private readonly input: InputController;
  private readonly sun: THREE.DirectionalLight;
  private readonly raycaster = new THREE.Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private snapshot: ValleySnapshot | null = null;
  /** The local player's member id (their own figure isn't drawn — their villagers are). */
  me = '';
  private frameHandle = 0;
  private lastFrame = 0;
  private realTime = 0;

  constructor(
    private readonly container: HTMLElement,
    overlayRoot: HTMLElement,
    private readonly game: Game,
    private readonly audio: AudioEngine,
    handler: ValleyInteraction,
  ) {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(SKY);
    this.renderer.domElement.className = 'world-canvas';
    container.appendChild(this.renderer.domElement);
    this.scene.background = SKY;
    this.scene.fog = new THREE.Fog(SKY, 80, 180);

    // Terrain and scenery are static: build them once per session.
    sceneCache ??= createValleyScene();
    this.valley = sceneCache;
    const { world } = this.valley;
    const map = world.map;
    const plaza = DISTRICTS.plaza;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 520);
    this.cameraCtl = new CameraController(
      this.camera,
      { minX: 4, maxX: map.width - 4, minZ: 4, maxZ: map.height - 4 },
      new THREE.Vector3(plaza.x, 0, plaza.z - 4),
      (x, z) => world.terrain.heightAt(x, z),
      { min: 9, max: 96 },
    );
    this.cameraCtl.focusOn(new THREE.Vector3(plaza.x, 0, plaza.z - 4), 46);
    this.cameraCtl.distance = 46;

    this.scene.add(new THREE.HemisphereLight('#fff7e6', '#6e8a5a', 1.35));
    this.sun = new THREE.DirectionalLight('#fff0d8', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target, new THREE.AmbientLight('#ffe9cf', 0.25));

    const terrainView = new TerrainView(world.terrain, world.grid);
    this.scene.add(terrainView.mesh, createWater(world.terrain));
    const bridges = createBridges(world.terrain);
    if (bridges) this.scene.add(bridges);
    this.chunks = new ChunkGrid(-map.margin, -map.margin, map.width + map.margin, map.height + map.margin, 16);
    this.nature = new NatureView(world.terrain, world.grid, this.chunks, this.valley.scenery);
    this.nature.refreshDecor();
    this.scene.add(this.nature.group);

    this.buildings = new ValleyBuildingsView(world.terrain, this.smoke);
    this.buildings.onRestored = (_id, at) => {
      this.particles.emit('confetti', at, 60, 2);
      this.particles.emit('dust', at.clone().setY(at.y - 3), 20, 3);
      this.audio.play('complete');
    };
    this.scene.add(this.buildings.group, this.smoke.mesh, this.ship.group);

    this.folk = new ValleyFolk(world, this.valley.scenery);
    this.folkView = new VillagersView(world.terrain);
    this.folkView.onImpact = (e) => {
      if (e.anim === 'build') this.particles.emit('dust', e.position.clone().setY(e.position.y + 0.3), 1, 0.3);
    };
    this.scene.add(this.folkView.group, this.particles.group);
    this.ambient = new AmbientLife(world.terrain, map);
    this.scene.add(this.ambient.group);
    this.selection = new SelectionView(world.terrain);
    this.scene.add(this.selection.group);

    this.overlay = new WorldOverlay(overlayRoot, this.camera);
    this.input = new InputController(this.renderer.domElement, this.cameraCtl, { pick: (ndc) => this.pick(ndc), groundAt: (ndc) => this.groundAt(ndc) }, {
      onHover: (t) => {
        const id = t?.kind === 'building' ? VALLEY_BUILDING_ORDER[t.id] : null;
        this.renderer.domElement.style.cursor = id ? 'pointer' : '';
        handler.onHover(id);
      },
      onClick: (result: PickResult) => {
        const id = result.target?.kind === 'building' ? VALLEY_BUILDING_ORDER[result.target.id] : null;
        if (id) this.audio.play('click');
        handler.onSelect(id);
      },
      onGroundMove: () => undefined,
      onCancel: () => handler.onCancel(),
      onRotate: () => undefined,
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  setSnapshot(snapshot: ValleySnapshot | null): void {
    if (snapshot === this.snapshot) return;
    this.snapshot = snapshot;
    this.buildings.sync(snapshot);
    this.folk.syncMembers(snapshot?.members ?? [], this.me);
  }

  start(): void {
    this.buildings.sync(this.snapshot);
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      this.frameHandle = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    this.input.dispose();
    this.resizeObserver.disconnect();
    this.buildings.dispose();
    this.smoke.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  focusOn(id: ValleyBuildingId, distance = 26): void {
    const def = VALLEY_BUILDINGS[id];
    const at = def.view ?? def;
    this.cameraCtl.focusOn(new THREE.Vector3(at.x, this.buildings.groundY(id), at.z), distance);
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 52 : 38;
    this.camera.updateProjectionMatrix();
    this.overlay.resize();
  }

  private groundAt(ndc: THREE.Vector2): THREE.Vector3 | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const terrain = this.valley.world.terrain;
    for (let t = 1; t < 520; t += 0.8) {
      const x = origin.x + direction.x * t;
      const z = origin.z + direction.z * t;
      if (origin.y + direction.y * t <= terrain.groundHeightAt(x, z)) return new THREE.Vector3(x, terrain.groundHeightAt(x, z), z);
    }
    return null;
  }

  private pick(ndc: THREE.Vector2): PickResult {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.buildings.hitboxes, ...this.ship.pickables], false);
    const id = hits.length > 0 ? this.buildings.idFor(hits[0].object) : null;
    return { target: id ? { kind: 'building', id: VALLEY_BUILDING_ORDER.indexOf(id) } : null, ground: this.groundAt(ndc) };
  }

  private frame(now: number): void {
    const realDt = Math.max(0, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const dt = Math.min(realDt, 0.1);
    this.realTime += dt;
    // The village keeps living while its people visit.
    this.game.tick(realDt);
    sharedUniforms.uTime.value = this.realTime;
    this.input.update(dt);
    this.cameraCtl.update(dt);

    const fog = this.scene.fog as THREE.Fog;
    fog.near = this.cameraCtl.distance * 1.4 + 26;
    fog.far = this.cameraCtl.distance * 2.8 + 100;
    this.chunks.maxDistance = fog.far + 6;
    this.chunks.update(this.camera);
    const eye = this.camera.position;
    const lod = this.chunks.settings.lod;
    this.nature.update(this.valley.scenery, this.realTime);
    this.nature.sync();
    this.buildings.update(dt, this.realTime);
    this.ship.update(dt, this.realTime, this.game.state.trade.ship);
    const snap = this.snapshot;
    this.folk.update(this.realTime, ValleyFolk.openProjects((id) => snap?.buildings[id]?.status));
    this.folk.syncTrainees(this.game.state.villagers, this.game.state.player.villageName);
    this.folkView.update(this.valley.scenery, dt, this.realTime, 1, eye, lod);
    this.ambient.update(this.realTime);
    this.particles.update(dt);

    const sel = this.selected;
    const posOf = (id: ValleyBuildingId) => {
      const def = VALLEY_BUILDINGS[id];
      return new THREE.Vector3(def.x, this.buildings.groundY(id), def.z);
    };
    this.selection.setSelected(sel ? posOf(sel) : null, sel ? VALLEY_BUILDINGS[sel].radius + 0.6 : 1, this.realTime);
    const hov = this.hovered && this.hovered !== sel ? this.hovered : null;
    this.selection.setHover(hov ? posOf(hov) : null, hov ? VALLEY_BUILDINGS[hov].radius + 0.6 : 1);
    this.updateOverlay();

    const target = this.cameraCtl.target;
    const span = THREE.MathUtils.clamp(this.cameraCtl.distance * 0.95, 18, 64);
    const cam = this.sun.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 1;
    cam.far = 180;
    cam.updateProjectionMatrix();
    const texel = (span * 2) / this.sun.shadow.mapSize.x;
    const sx = Math.round(target.x / texel) * texel;
    const sz = Math.round(target.z / texel) * texel;
    this.sun.position.set(sx - 26, 46, sz + 20);
    this.sun.target.position.set(sx, 0, sz);
    this.sun.target.updateMatrixWorld();

    this.audio.setListener(target, this.cameraCtl.distance);
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.(this.realTime);
  }

  private updateOverlay(): void {
    const o = this.overlay;
    o.beginFrame();
    const far = this.cameraCtl.distance > 34;
    const tmp = new THREE.Vector3();
    for (const id of VALLEY_BUILDING_ORDER) {
      const b = this.snapshot?.buildings[id];
      if (!b) continue;
      const def = VALLEY_BUILDINGS[id];
      this.buildings.topOf(id, tmp);
      tmp.y += 0.8;
      let body: string;
      if (b.status === 'collecting') body = `<div class="wo-bar"><i style="width:${Math.round(deliveredFraction(b) * 100)}%"></i></div>`;
      else if (b.status === 'building') body = `<span class="wo-sub">${ICONS.build}Building…</span>`;
      else if (b.status === 'locked') body = `<span class="wo-sub">${ICONS.lock}Opens later</span>`;
      else body = '';
      const level = b.level > 0 ? `<span class="wo-lvl">${b.level}</span>` : '';
      const active = this.selected === id || this.hovered === id;
      o.badge(`vb-${id}`, tmp, `<span class="wo-title">${level}${def.name}</span>${body}`, `wo-valley${active ? ' is-active' : ''}${far && !active ? ' is-compact' : ''}`);
    }
    if (far) {
      for (const d of Object.values(DISTRICTS)) {
        tmp.set(d.x, this.valley.world.terrain.heightAt(d.x, d.z) + 1.5, d.z);
        o.badge(`d-${d.id}`, tmp, d.name, 'wo-district');
      }
    } else if (this.cameraCtl.distance < 24) {
      for (const v of this.valley.scenery.villagers) {
        const p = villagerPosition(v, this.valley.scenery.time);
        tmp.set(p.x, this.valley.world.terrain.groundHeightAt(p.x, p.z) + 1.5, p.z);
        o.badge(`f-${v.id}`, tmp, `<span class="wo-name">${this.folk.labelFor(v)}</span>`, 'wo-villager');
      }
    }
    o.endFrame();
  }
}
