import * as THREE from 'three';
import { BUILDINGS } from '../config/buildings';
import { RESOURCES } from '../config/resources';
import { SKILLS } from '../config/skills';
import type { Game } from '../game/Game';
import type { AudioEngine } from '../audio/AudioEngine';
import type { SimEvent } from '../sim/events';
import { capacity } from '../sim/economy';
import { siteWork } from '../sim/levels';
import { buildingCenter } from '../sim/grid';
import { constructionFraction, villagerTask } from '../sim/selectors';
import { findBuilding, findNode, findVillager, villagerPosition } from '../sim/villagerAI';
import { ICONS } from '../ui/icons';
import { AmbientLife } from './AmbientLife';
import { BuildingsView } from './BuildingsView';
import { createBridges } from './BridgeView';
import { ChunkGrid, type CullingSettings } from './culling/ChunkGrid';
import { OcclusionQueries } from './culling/OcclusionQueries';
import { CameraController } from './CameraController';
import { DayCycle } from './DayCycle';
import { Fireflies } from './Fireflies';
import { InputController, type InteractionHandler, type PickResult, type PickTarget } from './InputController';
import { NatureView } from './NatureView';
import { Particles } from './Particles';
import { SelectionView, type GhostSpec } from './SelectionView';
import { SmokeSystem } from './SmokeSystem';
import { TerrainView } from './TerrainView';
import { VillagersView } from './VillagersView';
import { createWater } from './WaterView';
import { sharedUniforms } from './wind';
import { WorldOverlay } from './WorldOverlay';

export type { PickTarget } from './InputController';

/** What the UI wants the world to show. Written by the UI, read every frame. */
export interface ViewState {
  selection: PickTarget | null;
  hover: PickTarget | null;
  ghost: GhostSpec | null;
  movingBuildingId: number | null;
  showGrid: boolean;
  tutorialTarget: PickTarget | null;
  showNames: boolean;
}

const SKY = new THREE.Color('#cfe7ea');

/**
 * Owns the WebGL context and every world view. Each frame it advances the game clock,
 * then renders the current state. Rendering never mutates simulation state.
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly cameraCtl: CameraController;
  readonly view: ViewState = {
    selection: null,
    hover: null,
    ghost: null,
    movingBuildingId: null,
    showGrid: false,
    tutorialTarget: null,
    showNames: false,
  };
  /** Called after every frame (UI hooks use it for throttled refreshes). */
  onFrame: ((realTime: number) => void) | null = null;
  /** Called when a burst of time passed at once (tab was hidden). */
  onCatchUp: ((events: SimEvent[], before: Record<string, number>, seconds: number) => void) | null = null;
  private lastResources: Record<string, number> = {};
  private lastRealDt = 0;

  /** Time-of-day look (sky, light, lamps). Purely visual. */
  readonly dayCycle: DayCycle;
  /** Spatial partition driving frustum culling, LOD and occlusion for instanced layers. */
  readonly chunks: ChunkGrid;
  private readonly occlusion: OcclusionQueries;
  private lastInfo = { calls: 0, triangles: 0 };
  private readonly terrainView: TerrainView;
  private readonly nature: NatureView;
  private readonly buildings: BuildingsView;
  private readonly villagers: VillagersView;
  private readonly particles = new Particles();
  private readonly smoke = new SmokeSystem();
  private readonly ambient: AmbientLife;
  private readonly fireflies: Fireflies;
  private readonly selection: SelectionView;
  private readonly overlay: WorldOverlay;
  private readonly input: InputController;
  private readonly sun: THREE.DirectionalLight;
  private readonly raycaster = new THREE.Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private frameHandle = 0;
  private lastFrame = 0;
  private realTime = 0;
  private lastLayout = '';
  private unsubscribe: () => void;

  constructor(
    private readonly container: HTMLElement,
    overlayRoot: HTMLElement,
    private readonly game: Game,
    private readonly audio: AudioEngine,
    handler: InteractionHandler,
  ) {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(SKY);
    this.renderer.domElement.className = 'world-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene.background = SKY;
    this.scene.fog = new THREE.Fog(SKY, 60, 140);

    const { world } = game;
    const map = world.map;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 400);
    this.cameraCtl = new CameraController(this.camera, { minX: 2, maxX: map.width - 2, minZ: 2, maxZ: map.height - 2 }, new THREE.Vector3(map.clearing.x, 0, map.clearing.z + 2), (x, z) =>
      world.terrain.heightAt(x, z),
    );

    const hemi = new THREE.HemisphereLight('#fff7e6', '#6e8a5a', 1.35);
    this.scene.add(hemi);
    const fill = new THREE.AmbientLight('#ffe9cf', 0.25);
    this.sun = new THREE.DirectionalLight('#fff0d8', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target, fill);
    this.dayCycle = new DayCycle(this.scene, this.renderer, this.sun, hemi, fill);

    this.terrainView = new TerrainView(world.terrain, world.grid);
    this.scene.add(this.terrainView.mesh, this.terrainView.gridOverlay);
    this.scene.add(createWater(world.terrain));
    const bridges = createBridges(world.terrain);
    if (bridges) this.scene.add(bridges);
    this.chunks = new ChunkGrid(-map.margin, -map.margin, map.width + map.margin, map.height + map.margin, 12);
    this.nature = new NatureView(world.terrain, world.grid, this.chunks, game.state);
    this.scene.add(this.nature.group);
    this.occlusion = new OcclusionQueries(this.renderer.getContext() as WebGL2RenderingContext, this.chunks);
    this.occlusion.build();
    this.scene.add(this.occlusion.group);
    this.buildings = new BuildingsView(world.terrain, this.particles, this.smoke);
    this.scene.add(this.buildings.group, this.smoke.mesh);
    this.villagers = new VillagersView(world.terrain);
    this.villagers.onImpact = (e) => {
      if (e.anim === 'chop') {
        this.particles.emit('chips', e.position, 4, 0.2);
        if (Math.random() < 0.35) this.particles.emit('leaves', e.position.clone().setY(e.position.y + 1.4), 2, 0.8);
        if (e.nodeId !== null) this.nature.shake(e.nodeId, this.realTime);
        this.audio.playAt('chop', e.position);
      } else if (e.anim === 'craft') {
        this.particles.emit('chips', e.position.clone().setY(e.position.y + 0.45), 3, 0.15);
        this.audio.playAt('saw', e.position);
      } else if (e.anim === 'mine') {
        this.particles.emit('rubble', e.position, 5, 0.2);
        this.particles.emit('sparkle', e.position.clone().setY(e.position.y + 0.2), 1, 0.1);
        if (e.nodeId !== null) this.nature.shake(e.nodeId, this.realTime);
        this.audio.playAt('pick', e.position);
      } else if (e.anim === 'dig') {
        this.particles.emit('clods', e.position, 4, 0.2);
        this.audio.playAt('dig', e.position);
      } else if (e.anim === 'build') {
        this.particles.emit('dust', e.position.clone().setY(e.position.y + 0.3), 1, 0.3);
        this.audio.playAt('hammer', e.position);
      }
    };
    this.scene.add(this.villagers.group);
    this.scene.add(this.particles.group);
    this.ambient = new AmbientLife(world.terrain, map);
    this.scene.add(this.ambient.group);
    this.fireflies = new Fireflies(world.terrain, map);
    this.scene.add(this.fireflies.mesh);
    this.selection = new SelectionView(world.terrain);
    this.scene.add(this.selection.group);

    this.overlay = new WorldOverlay(overlayRoot, this.camera);
    this.input = new InputController(this.renderer.domElement, this.cameraCtl, { pick: (ndc) => this.pick(ndc), groundAt: (ndc) => this.groundAt(ndc) }, handler);

    this.unsubscribe = game.subscribe((events, info) => this.onEvents(events, info.catchUp));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.nature.refreshDecor();
  }

  start(): void {
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      this.frameHandle = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    this.unsubscribe();
    this.input.dispose();
    this.resizeObserver.disconnect();
    this.smoke.dispose();
    this.occlusion.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait phones get a wider view so the village still fits.
    this.camera.fov = w < h ? 52 : 38;
    this.camera.updateProjectionMatrix();
    this.overlay.resize();
  }

  // -------------------------------------------------------------------------
  // Picking
  // -------------------------------------------------------------------------

  groundAt(ndc: THREE.Vector2): THREE.Vector3 | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const terrain = this.game.world.terrain;
    let prev = 0;
    for (let t = 1; t < 400; t += 0.6) {
      const x = origin.x + direction.x * t;
      const y = origin.y + direction.y * t;
      const z = origin.z + direction.z * t;
      if (y <= terrain.groundHeightAt(x, z)) {
        let lo = prev;
        let hi = t;
        for (let i = 0; i < 10; i++) {
          const mid = (lo + hi) / 2;
          const my = origin.y + direction.y * mid;
          if (my <= terrain.groundHeightAt(origin.x + direction.x * mid, origin.z + direction.z * mid)) hi = mid;
          else lo = mid;
        }
        return new THREE.Vector3(origin.x + direction.x * hi, origin.y + direction.y * hi, origin.z + direction.z * hi);
      }
      prev = t;
    }
    return null;
  }

  pick(ndc: THREE.Vector2): PickResult {
    this.raycaster.setFromCamera(ndc, this.camera);
    const ground = this.groundAt(ndc);
    const villagerHits = this.raycaster.intersectObjects(this.villagers.hitboxes, false);
    if (villagerHits.length > 0) {
      const id = this.villagers.villagerIdFor(villagerHits[0].object);
      if (id !== null) return { target: { kind: 'villager', id }, ground };
    }
    const hits = this.raycaster.intersectObjects([...this.buildings.hitboxes, ...this.nature.pickables], false);
    for (const h of hits) {
      const bid = this.buildings.buildingIdFor(h.object);
      if (bid !== null) return { target: { kind: 'building', id: bid }, ground };
      const nid = this.nature.pickNode(h.object, h.instanceId);
      if (nid !== null) {
        const node = findNode(this.game.state, nid);
        if (node && (node.amount > 0 || node.regrowAt !== null)) return { target: { kind: 'node', id: nid }, ground };
      }
    }
    return { target: null, ground };
  }

  /** World position of an entity (ground level). */
  positionOf(target: PickTarget): THREE.Vector3 | null {
    const state = this.game.state;
    switch (target.kind) {
      case 'villager': {
        const v = findVillager(state, target.id);
        if (!v) return null;
        const p = villagerPosition(v, state.time);
        return new THREE.Vector3(p.x, this.game.world.terrain.groundHeightAt(p.x, p.z), p.z);
      }
      case 'building': {
        const b = findBuilding(state, target.id);
        if (!b) return null;
        const c = buildingCenter(b);
        return new THREE.Vector3(c.x, this.buildings.groundYFor(b), c.z);
      }
      case 'node': {
        const n = findNode(state, target.id);
        return n ? new THREE.Vector3(n.x, this.game.world.terrain.heightAt(n.x, n.z), n.z) : null;
      }
    }
  }

  private radiusOf(target: PickTarget): number {
    if (target.kind === 'villager') return 0.55;
    if (target.kind === 'node') return 0.85;
    const b = findBuilding(this.game.state, target.id);
    return b ? SelectionView.radiusForBuilding(b.defId) : 1;
  }

  focusOn(target: PickTarget | THREE.Vector3, distance?: number): void {
    const p = target instanceof THREE.Vector3 ? target : this.positionOf(target);
    if (p) this.cameraCtl.focusOn(p, distance);
  }

  /** Screen position (CSS px) of a world point, or null when off-screen. */
  screenOf(p: THREE.Vector3): { x: number; y: number } | null {
    const v = p.clone().project(this.camera);
    if (v.z > 1) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  }

  // -------------------------------------------------------------------------
  // Events → effects
  // -------------------------------------------------------------------------

  private onEvents(events: SimEvent[], catchUp: boolean): void {
    if (catchUp) {
      this.onCatchUp?.(events, this.lastResources, this.lastRealDt);
      return;
    }
    const state = this.game.state;
    for (const e of events) {
      switch (e.type) {
        case 'deposit': {
          const p = this.positionOf({ kind: 'building', id: e.buildingId });
          if (p) {
            p.y += 1.6;
            this.overlay.float(p, `<span class="ico">${ICONS[e.resource]}</span>+${Math.round(e.amount)}`, `wo-float res-${e.resource}`);
            this.particles.emit('dust', p.clone().setY(p.y - 1.4), 2, 0.5);
            this.audio.playAt('deposit', p);
          }
          break;
        }
        case 'produced': {
          const p = this.positionOf({ kind: 'building', id: e.buildingId });
          if (p) {
            p.y += 2.2;
            this.overlay.float(p, `<span class="ico">${ICONS[e.resource]}</span>+${e.amount}`, `wo-float res-${e.resource}`);
            if (e.resource === 'stew') this.audio.playAt('bubble', p);
          }
          break;
        }
        case 'constructionStarted': {
          const p = this.positionOf({ kind: 'building', id: e.buildingId });
          if (p) {
            this.particles.emit('dust', p.clone().setY(p.y + 0.2), 10, 1.4);
            this.audio.play('place');
          }
          break;
        }
        case 'upgradeStarted': {
          const p = this.positionOf({ kind: 'building', id: e.buildingId });
          if (p) this.particles.emit('dust', p.clone().setY(p.y + 0.3), 10, 1.6);
          this.audio.play('place');
          break;
        }
        case 'constructionComplete':
        case 'upgradeComplete': {
          const p = this.positionOf({ kind: 'building', id: e.buildingId });
          if (p && BUILDINGS[e.defId].category !== 'decor') {
            this.particles.emit('confetti', p.clone().setY(p.y + BUILDINGS[e.defId].height), 40, 1);
            this.particles.emit('dust', p.clone().setY(p.y + 0.2), 14, 2);
            this.audio.play('complete');
            const near = state.villagers.filter((v) => {
              const vp = villagerPosition(v, state.time);
              return Math.hypot(vp.x - p.x, vp.z - p.z) < 6;
            });
            this.villagers.celebrate(near.map((v) => v.id), this.realTime);
          }
          break;
        }
        case 'researchComplete': {
          const academy = state.buildings.find((b) => b.defId === 'academy');
          if (academy) {
            const p = this.positionOf({ kind: 'building', id: academy.id })!;
            this.particles.emit('knowledge', p.clone().setY(p.y + 4), 30, 1.5);
          }
          this.audio.play('research');
          break;
        }
        case 'levelUp':
          this.villagers.celebrate('all', this.realTime, 3);
          this.audio.play('levelUp');
          break;
        case 'nodeDepleted': {
          const n = findNode(state, e.nodeId);
          if (n && n.kind === 'tree') {
            const p = new THREE.Vector3(n.x, this.game.world.terrain.heightAt(n.x, n.z) + 1.5, n.z);
            this.particles.emit('leaves', p, 16, 1.4);
            this.particles.emit('dust', p.clone().setY(p.y - 1.4), 6, 1);
            this.audio.playAt('treeFall', p);
          }
          break;
        }
        case 'villagerJoined': {
          const p = this.positionOf({ kind: 'villager', id: e.villagerId });
          if (p) this.particles.emit('sparkle', p.setY(p.y + 1), 20, 0.8);
          this.audio.play('newcomer');
          break;
        }
        case 'skillUp': {
          const p = this.positionOf({ kind: 'villager', id: e.villagerId });
          if (p) {
            p.y += 1.5;
            this.particles.emit('sparkle', p, 12, 0.5);
            this.overlay.float(p, `${SKILLS[e.skill].name} ${e.level}!`, 'wo-float wo-skill', 2.2);
          }
          this.audio.play('skillUp');
          break;
        }
        default:
          break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  private frame(now: number): void {
    const realDt = Math.max(0, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const dt = Math.min(realDt, 0.1);
    this.realTime += dt;
    this.lastRealDt = realDt;
    this.game.tick(realDt);
    const state = this.game.state;
    sharedUniforms.uTime.value = this.realTime;

    this.input.update(dt);
    this.cameraCtl.update(dt);

    const layout = state.buildings.map((b) => `${b.id}:${b.cellX}:${b.cellZ}:${b.rotation}:${b.status}:${b.level}:${b.upgrade ? 1 : 0}`).join('|');
    if (layout !== this.lastLayout) {
      this.lastLayout = layout;
      this.buildings.sync(state);
      this.nature.refreshDecor();
      this.terrainView.refreshGrid();
    }
    // Fog bounds how far anything can be seen, so it also bounds culling.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = this.cameraCtl.distance * 1.3 + 18;
    fog.far = this.cameraCtl.distance * 2.6 + 70;
    this.chunks.maxDistance = fog.far + 6;
    this.chunks.update(this.camera);
    this.occlusion.update();

    const eye = this.camera.position;
    const lod = this.chunks.settings.lod;
    this.buildings.setHidden(this.view.movingBuildingId);
    this.buildings.update(state, dt, this.realTime, eye, lod);
    this.nature.update(state, this.realTime);
    this.nature.sync();
    this.villagers.update(state, dt, this.realTime, this.game.speed, eye, lod);
    this.ambient.update(this.realTime, this.dayCycle.night);
    this.fireflies.update(this.realTime, this.dayCycle.night);
    this.particles.update(dt);

    // Selection, hover and placement ghost.
    const sel = this.view.selection;
    this.selection.setSelected(sel ? this.positionOf(sel) : null, sel ? this.radiusOf(sel) : 1, this.realTime);
    const hov = this.view.hover && !(sel && this.view.hover.kind === sel.kind && this.view.hover.id === sel.id) ? this.view.hover : null;
    this.selection.setHover(hov ? this.positionOf(hov) : null, hov ? this.radiusOf(hov) : 1);
    const ghost = this.view.ghost;
    this.selection.setGhost(ghost, ghost ? this.buildings.groundYFor(ghost) : 0);
    this.terrainView.gridOverlay.visible = this.view.showGrid;

    this.updateOverlay();

    // Keep the shadow frustum tight around what the camera sees.
    const target = this.cameraCtl.target;
    const span = THREE.MathUtils.clamp(this.cameraCtl.distance * 0.95, 16, 48);
    const cam = this.sun.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 1;
    cam.far = 140;
    cam.updateProjectionMatrix();
    const texel = (span * 2) / this.sun.shadow.mapSize.x;
    const sx = Math.round(target.x / texel) * texel;
    const sz = Math.round(target.z / texel) * texel;
    this.dayCycle.update(target);
    const light = this.dayCycle.lightOffset();
    this.sun.position.set(sx + light.x, light.y, sz + light.z);
    this.sun.target.position.set(sx, 0, sz);
    this.sun.target.updateMatrixWorld();

    this.audio.setListener(target, this.cameraCtl.distance);
    this.renderer.render(this.scene, this.camera);
    this.lastInfo.calls = this.renderer.info.render.calls;
    this.lastInfo.triangles = this.renderer.info.render.triangles;
    this.lastResources = { ...state.resources };
    this.onFrame?.(this.realTime);
  }

  /** Culling switches (dev panel). */
  get culling(): CullingSettings {
    return this.chunks.settings;
  }

  /** Rendering counters from the last frame (includes the shadow pass). */
  renderStats(): { calls: number; triangles: number; natureTriangles: number; chunks: number; inView: number; occluded: number; visible: number } {
    return { ...this.lastInfo, natureTriangles: Math.round(this.nature.triangles()), ...this.chunks.stats };
  }

  private updateOverlay(): void {
    const state = this.game.state;
    const o = this.overlay;
    o.beginFrame();
    const tmp = new THREE.Vector3();
    const zoomedIn = this.cameraCtl.distance < 20;
    for (const v of state.villagers) {
      if (v.activity === 'away') continue;
      const p = villagerPosition(v, state.time);
      tmp.set(p.x, this.game.world.terrain.groundHeightAt(p.x, p.z) + 1.45, p.z);
      const task = villagerTask(state, v);
      const selected = this.view.selection?.kind === 'villager' && this.view.selection.id === v.id;
      const hovered = this.view.hover?.kind === 'villager' && this.view.hover.id === v.id;
      let icon: keyof typeof ICONS | null = null;
      let cls = '';
      if (task.idle && v.activity !== 'walking') {
        icon = 'idle';
        cls = 'is-idle';
      } else if (v.activity === 'blocked') {
        icon = v.blockedReason === 'storageFull' ? 'full' : 'blocked';
        cls = 'is-warn';
      } else if (task.warning) {
        icon = 'hungry';
        cls = 'is-warn';
      }
      const name = selected || hovered || this.view.showNames || (zoomedIn && icon !== null) ? `<span class="wo-name">${v.name}</span>` : '';
      if (icon || name) o.badge(`v${v.id}`, tmp, `${icon ? `<span class="wo-ico">${ICONS[icon]}</span>` : ''}${name}`, `wo-villager ${cls}`);
    }
    for (const b of state.buildings) {
      if (siteWork(b)) {
        const p = this.positionOf({ kind: 'building', id: b.id })!;
        const f = constructionFraction(state, b);
        // New sites: float just above what's built so far. Upgrades: above the standing building.
        p.y += b.upgrade ? BUILDINGS[b.defId].height + 0.6 : 1.3 + Math.max(0, f - 0.1) * BUILDINGS[b.defId].height;
        const builders = state.villagers.some((v) => v.job?.kind === 'construct' && v.job.buildingId === b.id);
        o.badge(
          `b${b.id}`,
          p,
          `<div class="wo-bar"><i style="width:${Math.round(f * 100)}%"></i></div>${builders ? '' : `<span class="wo-need">${ICONS.build}Needs a builder</span>`}`,
          'wo-site',
        );
      } else {
        const storage = BUILDINGS[b.defId].storage;
        if (storage) {
          for (const r of Object.keys(storage) as (keyof typeof RESOURCES)[]) {
            if (r === 'stew' || r === 'knowledge') continue;
            const cap = capacity(state, r);
            if (cap > 0 && state.resources[r] >= cap) {
              const p = this.positionOf({ kind: 'building', id: b.id })!;
              p.y += BUILDINGS[b.defId].height + 0.5;
              o.badge(`full${b.id}`, p, `<span class="wo-ico">${ICONS.full}</span><span class="wo-name">Full</span>`, 'wo-villager is-warn');
            }
          }
        }
      }
    }
    const tt = this.view.tutorialTarget;
    if (tt) {
      const p = this.positionOf(tt);
      if (p) {
        p.y += tt.kind === 'building' ? 3.2 : tt.kind === 'node' ? 3 : 1.8;
        o.badge('tutorial', p, '<div class="wo-arrow"></div>', 'wo-tutorial');
      }
    }
    o.endFrame();
  }
}
