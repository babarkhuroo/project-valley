import type { BuildingId } from './buildings';

export type Point = [number, number];

export interface Polyline {
  points: Point[];
  /** Full width in tiles. */
  width: number;
}

export interface ForestZone {
  polygon: Point[];
  /** Approximate trees per tile of area (after spacing rules). */
  density: number;
  /** 0..1 share of conifers in this zone. */
  pineRatio: number;
}

export interface VillageMapDef {
  id: string;
  width: number;
  height: number;
  seed: number;
  /** Decorative terrain beyond the playable square, in tiles. */
  margin: number;
  lake: { x: number; z: number; r: number }[];
  creek: Polyline;
  hills: { x: number; z: number; r: number; h: number }[];
  paths: Polyline[];
  bridges: Polyline[];
  forests: ForestZone[];
  /** Hand-placed trees near the clearing so the first minutes feel close and quick. */
  loneTrees: Point[];
  clayDeposits: Point[];
  /** Quarriable rock outcrops (stone nodes) in the hills. */
  stoneDeposits: Point[];
  /** Decorative boulders: x, z, scale. */
  boulders: [number, number, number][];
  /** Flower-rich meadows (decorative density hint). */
  meadows: Point[][];
  /** Fertile soil: Grain Fields centred here yield more. */
  farmland: Point[][];
  /** Area kept free of generated trees and clutter. */
  clearing: { x: number; z: number; r: number };
  startBuildings: { building: BuildingId; cellX: number; cellZ: number; rotation: 0 | 1 | 2 | 3 }[];
  /** Where newcomers walk in from. */
  entrance: Point;
}

/**
 * Thistledown — the hand-authored starting village. A sheltered clearing with forest
 * to the north-west, a clay-banked creek to the east curling into a lake in the
 * south-west, rocky hills to the north-east and open meadow south of the creek.
 */
export const VILLAGE_MAP: VillageMapDef = {
  id: 'thistledown',
  width: 64,
  height: 64,
  seed: 20240917,
  margin: 26,
  lake: [
    { x: 9, z: 52, r: 7 },
    { x: 5, z: 46, r: 5 },
    { x: 14, z: 57.5, r: 5.5 },
    { x: 3, z: 57, r: 6 },
    { x: 9, z: 63, r: 5 },
  ],
  creek: {
    width: 2.3,
    points: [
      [63, -4], [59, 6], [54, 16], [50.5, 26], [48, 36], [44.5, 43.5], [38, 48.5], [30, 50], [22, 50.5], [14, 51],
    ],
  },
  hills: [
    { x: 55, z: 11, r: 11, h: 3.4 },
    { x: 46, z: 5, r: 7, h: 1.8 },
    { x: 30, z: 6, r: 8, h: 1.3 },
    { x: 13, z: 37, r: 6, h: 1.0 },
    { x: 60, z: 30, r: 7, h: 1.6 },
  ],
  paths: [
    { width: 1.5, points: [[32.5, 66], [32.5, 55], [32.3, 46], [32.5, 37]] },
    { width: 1.5, points: [[25.5, 34.5], [32.5, 34.5], [39.5, 34.5]] },
    { width: 1.3, points: [[25.5, 34.5], [22.5, 31.5], [19, 28.5], [14.5, 25]] },
    { width: 1.3, points: [[39.5, 34.5], [42.5, 36.2], [45.3, 37.8]] },
    { width: 1.2, points: [[32.5, 28.2], [33, 22], [35.5, 16], [39.5, 11]] },
  ],
  bridges: [
    { width: 1.5, points: [[32.4, 47], [32.4, 53.2]] },
    { width: 1.3, points: [[45.3, 37.8], [50.6, 37.8]] },
  ],
  forests: [
    {
      polygon: [[1, 1], [28, 1], [27, 8], [22, 14], [19, 21], [14, 27], [6, 31], [1, 32]],
      density: 0.5,
      pineRatio: 0.3,
    },
    { polygon: [[28, 1], [44, 1], [42, 6], [34, 9], [28, 8]], density: 0.3, pineRatio: 0.85 },
    { polygon: [[45, 50], [55, 46], [63, 49], [63, 63], [47, 63], [43, 57]], density: 0.4, pineRatio: 0.2 },
    { polygon: [[53, 20], [63, 17], [63, 42], [55, 44], [52, 31]], density: 0.33, pineRatio: 0.55 },
    { polygon: [[1, 35], [8, 35], [9, 40], [1, 41]], density: 0.3, pineRatio: 0.4 },
  ],
  loneTrees: [
    [20.5, 25.5], [18.6, 29.4], [21.6, 22.2], [17.4, 26.6], [22.8, 19.6], [25.2, 21.6], [18.2, 33.4],
    [27.8, 23.4], [16.2, 31.2], [23.6, 17.2], [38.2, 25.4], [40.6, 28.8], [42.4, 24.6], [24.4, 42.4],
    [27.6, 44.2], [38.6, 42.2], [21.4, 39.4], [36.4, 21.2], [44.2, 29.4],
  ],
  clayDeposits: [
    [45.6, 31.4], [46.2, 34.6], [44.0, 38.6], [42.2, 42.0], [40.4, 44.0], [36.0, 46.6], [51.8, 33.8], [52.4, 40.8], [47.8, 43.4],
  ],
  stoneDeposits: [
    [45, 9], [48, 15], [51.5, 13], [49, 6.5], [43, 12], [47.5, 19], [41.5, 15.5],
  ],
  boulders: [
    [50, 10, 1.3], [55, 14, 1.7], [58.5, 9, 1.1], [52, 17.5, 0.9], [47, 12, 1.0], [60.5, 18.5, 1.4],
    [53, 5, 1.2], [40.5, 20.5, 0.7], [11, 38, 0.8], [61, 27, 1.1],
  ],
  meadows: [
    [[18, 53], [44, 52], [46, 63], [18, 63]],
    [[35, 37], [44, 38], [42, 46], [34, 45]],
  ],
  farmland: [[[18, 52.5], [44, 51.5], [46, 63], [18, 63]]],
  clearing: { x: 31, z: 32, r: 9.5 },
  startBuildings: [
    { building: 'cookhouse', cellX: 31, cellZ: 29, rotation: 0 },
    { building: 'lodge', cellX: 26, cellZ: 31, rotation: 0 },
    { building: 'timberYard', cellX: 22, cellZ: 26, rotation: 0 },
  ],
  entrance: [32.5, 63.4],
};
