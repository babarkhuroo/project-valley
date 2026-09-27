import * as THREE from 'three';
import { BUILDINGS, type BuildingId } from '../config/buildings';
import { buildingCenter, rotatedSize } from '../sim/grid';
import type { Rotation } from '../sim/types';
import type { Terrain } from '../world/terrain';
import { createBuildingModel } from './models/buildingModels';

export interface GhostSpec {
  defId: BuildingId;
  cellX: number;
  cellZ: number;
  rotation: Rotation;
  valid: boolean;
}

const ringGeo = new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);

function ringMaterial(color: string, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
}

/** Selection/hover rings on the ground and the translucent placement ghost. */
export class SelectionView {
  readonly group = new THREE.Group();
  private readonly selectRing: THREE.Mesh;
  private readonly hoverRing: THREE.Mesh;
  private readonly ghostRoot = new THREE.Group();
  private ghostKey = '';
  private readonly tiles: THREE.Mesh;
  private readonly okMat = new THREE.MeshLambertMaterial({ color: '#8ee07a', transparent: true, opacity: 0.55, emissive: '#2f6b1f', emissiveIntensity: 0.4 });
  private readonly badMat = new THREE.MeshLambertMaterial({ color: '#f07a6a', transparent: true, opacity: 0.55, emissive: '#7a1f12', emissiveIntensity: 0.4 });
  private readonly tileOk = new THREE.MeshBasicMaterial({ color: '#b6f59e', transparent: true, opacity: 0.45, depthWrite: false });
  private readonly tileBad = new THREE.MeshBasicMaterial({ color: '#ff8f80', transparent: true, opacity: 0.45, depthWrite: false });

  constructor(private readonly terrain: Terrain) {
    this.selectRing = new THREE.Mesh(ringGeo, ringMaterial('#fff4c2', 0.95));
    this.hoverRing = new THREE.Mesh(ringGeo, ringMaterial('#ffffff', 0.55));
    this.selectRing.renderOrder = 3;
    this.hoverRing.renderOrder = 3;
    this.selectRing.visible = false;
    this.hoverRing.visible = false;
    this.tiles = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.tileOk);
    this.tiles.renderOrder = 3;
    this.ghostRoot.add(this.tiles);
    this.ghostRoot.visible = false;
    this.group.add(this.selectRing, this.hoverRing, this.ghostRoot);
  }

  private placeRing(ring: THREE.Mesh, at: THREE.Vector3 | null, radius: number): void {
    if (!at) {
      ring.visible = false;
      return;
    }
    ring.visible = true;
    ring.position.set(at.x, this.terrain.groundHeightAt(at.x, at.z) + 0.06, at.z);
    ring.scale.setScalar(radius);
  }

  setSelected(at: THREE.Vector3 | null, radius: number, realTime: number): void {
    this.placeRing(this.selectRing, at, radius * (1 + Math.sin(realTime * 4) * 0.04));
  }

  setHover(at: THREE.Vector3 | null, radius: number): void {
    this.placeRing(this.hoverRing, at, radius);
  }

  setGhost(spec: GhostSpec | null, groundY: number): void {
    if (!spec) {
      this.ghostRoot.visible = false;
      return;
    }
    const key = `${spec.defId}:${spec.valid}`;
    if (key !== this.ghostKey) {
      for (const child of [...this.ghostRoot.children]) if (child !== this.tiles) this.ghostRoot.remove(child);
      const model = createBuildingModel(spec.defId, 0);
      const material = spec.valid ? this.okMat : this.badMat;
      model.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = material;
          m.castShadow = false;
        }
      });
      model.root.name = 'ghost-model';
      this.ghostRoot.add(model.root);
      this.tiles.material = spec.valid ? this.tileOk : this.tileBad;
      this.ghostKey = key;
    }
    const c = buildingCenter(spec);
    const { w, d } = rotatedSize(spec.defId, spec.rotation);
    this.ghostRoot.visible = true;
    this.ghostRoot.position.set(c.x, groundY, c.z);
    const model = this.ghostRoot.getObjectByName('ghost-model');
    if (model) model.rotation.y = (spec.rotation * Math.PI) / 2;
    this.tiles.scale.set(w, 1, d);
    this.tiles.position.y = 0.07;
  }

  static radiusForBuilding(defId: BuildingId): number {
    const { w, d } = BUILDINGS[defId].footprint;
    return Math.max(w, d) * 0.78;
  }
}
