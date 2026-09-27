import * as THREE from 'three';
import type { BuildingId } from '../config/buildings';
import type { Appearance } from '../config/villagers';
import { createBuildingModel } from './models/buildingModels';
import { createVillagerRig } from './models/villagerModel';

/**
 * Renders small 3D thumbnails (villager portraits, building icons) with an offscreen
 * renderer so the UI uses the same original art as the world. Results are cached as
 * data URLs.
 */
class ThumbnailRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  private readonly cache = new Map<string, string>();
  private failed = false;

  private ensure(): THREE.WebGLRenderer | null {
    if (this.renderer || this.failed) return this.renderer;
    try {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setPixelRatio(1);
      r.setSize(160, 160, false);
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.NeutralToneMapping;
      r.setClearColor(0x000000, 0);
      this.renderer = r;
      this.scene.add(new THREE.HemisphereLight('#fff7e6', '#8a7a5a', 1.8));
      const key = new THREE.DirectionalLight('#ffffff', 2.2);
      key.position.set(2, 4, 3);
      this.scene.add(key);
    } catch {
      this.failed = true;
    }
    return this.renderer;
  }

  private shoot(obj: THREE.Object3D, eye: THREE.Vector3, look: THREE.Vector3, fov: number): string {
    const r = this.ensure();
    if (!r) return '';
    this.scene.add(obj);
    this.camera.fov = fov;
    this.camera.position.copy(eye);
    this.camera.lookAt(look);
    this.camera.updateProjectionMatrix();
    r.render(this.scene, this.camera);
    const url = r.domElement.toDataURL('image/png');
    this.scene.remove(obj);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    return url;
  }

  portrait(a: Appearance): string {
    const key = `v:${JSON.stringify(a)}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const rig = createVillagerRig(a);
    rig.hitbox.visible = false;
    rig.head.rotation.y = -0.25;
    rig.armL.rotation.z = 0.2;
    rig.armR.rotation.z = -0.2;
    const url = this.shoot(rig.root, new THREE.Vector3(0.38, 0.86, 1.25), new THREE.Vector3(0, 0.66, 0), 26);
    this.cache.set(key, url);
    return url;
  }

  building(id: BuildingId): string {
    const key = `b:${id}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const model = createBuildingModel(id, 1);
    const box = new THREE.Box3().setFromObject(model.root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z);
    const eye = center.clone().add(new THREE.Vector3(r * 1.25, r * 0.95, r * 1.7));
    const url = this.shoot(model.root, eye, center, 30);
    this.cache.set(key, url);
    return url;
  }
}

export const thumbnails = new ThumbnailRenderer();
