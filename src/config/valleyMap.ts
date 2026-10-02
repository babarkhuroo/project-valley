import type { VillageMapDef } from './villageMap';

/**
 * The Hearthlands — the shared Valley. Twice the width of a village: the Silverrun
 * river comes down from the northern hills and empties into Saltreach bay in the
 * south-west; Hearth Plaza sits in the middle with Guild Row to its north-east, Lantern
 * Hill to the north-west, Millrace by the river, the market and fields to the south-east
 * and the Far Reach hidden behind the eastern woods. Uses the same map format as a
 * village, so terrain, water, bridges and scenery come from the same pipeline.
 */
export const VALLEY_MAP: VillageMapDef = {
  id: 'hearthlands',
  width: 128,
  height: 128,
  seed: 77031,
  margin: 30,
  lake: [
    { x: 18, z: 116, r: 12 },
    { x: 31, z: 124, r: 9 },
    { x: 6, z: 104, r: 8 },
    { x: 110, z: 88, r: 3.2 },
  ],
  creek: {
    width: 4.6,
    points: [
      [40, -12], [41, 6], [38, 20], [38, 34], [35, 48], [33, 62], [31, 76], [29, 90], [24, 103], [19, 112],
    ],
  },
  hills: [
    { x: 50, z: 29, r: 11, h: 1.5 },
    { x: 100, z: 12, r: 16, h: 3.4 },
    { x: 118, z: 28, r: 12, h: 2.6 },
    { x: 8, z: 24, r: 14, h: 2.2 },
    { x: 124, z: 70, r: 14, h: 2.4 },
    { x: 82, z: 6, r: 10, h: 1.8 },
    { x: 64, z: 10, r: 9, h: 1.2 },
  ],
  paths: [
    // South road in from the other villages, up to the plaza.
    { width: 1.9, points: [[70, 131], [70, 112], [67, 92], [64.5, 74], [64, 67]] },
    // The plaza itself: a broad paved square before the hall.
    { width: 4.5, points: [[58, 69], [70, 69]] },
    // Guild Row, continuing to the quarry terraces.
    { width: 1.7, points: [[70, 67], [86, 66], [86, 44], [94, 32], [99, 22]] },
    // West road over the river to the Old Wood.
    { width: 1.6, points: [[57, 69], [46, 66.5], [38, 64.5], [28, 62.6], [20, 54], [15, 44]] },
    // Up Lantern Hill.
    { width: 1.4, points: [[57, 68], [54, 56], [51, 40]] },
    // Market Green and the fields.
    { width: 1.6, points: [[70, 72], [80, 84], [92, 94], [103, 104]] },
    // Millrace and down to the harbour.
    { width: 1.6, points: [[58, 72], [47, 80], [40, 86], [36, 96], [33, 105.5]] },
    // East road to where the Far Reach is fenced off.
    { width: 1.4, points: [[86, 64.5], [100, 64.5], [109, 64.5]] },
  ],
  bridges: [{ width: 2.2, points: [[38.6, 64.4], [27.6, 62.6]] }],
  forests: [
    { polygon: [[0, 4], [30, 2], [32, 22], [30, 46], [26, 56], [14, 60], [0, 58]], density: 0.3, pineRatio: 0.45 },
    { polygon: [[46, 0], [76, 0], [74, 8], [60, 14], [48, 12]], density: 0.22, pineRatio: 0.6 },
    { polygon: [[104, 36], [128, 34], [128, 98], [114, 98], [106, 78], [112, 68], [104, 54]], density: 0.3, pineRatio: 0.3 },
    { polygon: [[42, 108], [54, 106], [57, 122], [44, 124]], density: 0.16, pineRatio: 0.2 },
    { polygon: [[0, 66], [22, 68], [20, 88], [0, 92]], density: 0.22, pineRatio: 0.35 },
  ],
  loneTrees: [
    [60, 82], [74, 98], [90, 74], [52, 60], [74, 52], [97, 42], [70, 42], [57, 96], [85, 102], [77, 60], [93, 72], [62, 56],
    [47, 74], [44, 92], [79, 76], [100, 70],
  ],
  clayDeposits: [],
  stoneDeposits: [],
  boulders: [
    [96, 24, 1.4], [104, 26, 1.1], [108, 16, 1.6], [92, 16, 1.2], [112, 22, 1.0], [22, 64, 1.0], [10, 70, 1.3], [43, 46, 0.8],
    [36, 100, 0.9], [88, 30, 1.0],
  ],
  meadows: [
    [[86, 94], [124, 94], [124, 124], [84, 124]],
    [[64, 34], [84, 32], [82, 44], [66, 44]],
    [[48, 84], [62, 80], [64, 96], [50, 100]],
  ],
  clearing: { x: 64, z: 64, r: 15 },
  startBuildings: [],
  entrance: [70, 127],
};
