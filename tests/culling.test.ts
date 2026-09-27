import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ChunkGrid } from '../src/rendering/culling/ChunkGrid';
import { InstanceField } from '../src/rendering/culling/InstanceField';

function setup() {
  const grid = new ChunkGrid(0, 0, 96, 96, 12);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const field = new InstanceField(grid, new THREE.MeshBasicMaterial(), [
    { geometry: geo, maxDistance: 25, castShadow: true },
    { geometry: geo, maxDistance: 70, castShadow: false },
  ]);
  const near: number[] = [];
  const far: number[] = [];
  for (let i = 0; i < 5; i++) near.push(field.add(new THREE.Matrix4().makeTranslation(4 + i, 0, 4)));
  for (let i = 0; i < 3; i++) far.push(field.add(new THREE.Matrix4().makeTranslation(90 + i * 0.5, 0, 90)));
  field.finalize();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);
  const look = (x: number, y: number, z: number, tx: number, tz: number) => {
    camera.position.set(x, y, z);
    camera.lookAt(tx, 0, tz);
    camera.updateMatrixWorld();
    grid.update(camera);
    field.sync();
  };
  return { grid, field, near, far, look };
}

describe('chunk culling', () => {
  it('packs only chunks inside the frustum', () => {
    const { field, look } = setup();
    look(6, 12, 16, 6, 4);
    expect(field.meshes[0].count).toBe(5);
    expect(field.meshes[1].count).toBe(0);
  });

  it('switches LOD with distance and hides beyond the last level', () => {
    const { field, grid, look } = setup();
    look(6, 30, 50, 6, 4);
    expect(field.meshes[0].count).toBe(0);
    expect(field.meshes[1].count).toBe(5);
    grid.settings.lod = false;
    field.sync();
    expect(field.meshes[0].count).toBe(5);
    grid.settings.lod = true;
    look(6, 80, 120, 6, 4);
    expect(field.meshes[0].count + field.meshes[1].count).toBe(0);
  });

  it('drops occluded chunks and inactive instances', () => {
    const { field, grid, near, look } = setup();
    look(6, 12, 16, 6, 4);
    field.setActive(near[1], false);
    field.sync();
    expect(field.meshes[0].count).toBe(4);
    const chunk = grid.chunkAt(4, 4);
    grid.occluded[chunk] = 1;
    field.sync();
    expect(field.meshes[0].count).toBe(0);
    grid.settings.occlusion = false;
    field.sync();
    expect(field.meshes[0].count).toBe(4);
  });

  it('maps packed instances back to their source for picking', () => {
    const { field, near, look } = setup();
    look(6, 12, 16, 6, 4);
    field.setActive(near[0], false);
    field.sync();
    const sources = Array.from({ length: field.meshes[0].count }, (_, i) => field.sourceFor(field.meshes[0], i));
    expect(sources.sort()).toEqual(near.slice(1).sort());
    const m = field.getMatrix(near[3], new THREE.Matrix4());
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(7);
  });
});
