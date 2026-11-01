import type { RoomId } from './types';

/**
 * Office layout on a tile grid (1 unit = 1 tile, roughly 1 m). Pure data shared by the 3D scene
 * (geometry, A* grid) and the reducer (booth/lounge capacity). Coordinates: x to the east,
 * z to the south; the camera looks from the south-east, so north (z=0) and west (x=0) are back walls.
 *
 *   ┌ Manager cabin ┬─────────── Sales floor ───────────┬ Calling room ┐
 *   │               │  [cluster]   ( Lead Hub )  [cluster] │  booths     │
 *   ├ Lounge ───────┤  [cluster]                [cluster] │  (glass)    │
 *   └───────────────┴────────────── entrance ────────────┴─────────────┘
 */

export interface Spot {
  x: number;
  z: number;
  /** Heading in radians: forward = (sin, cos), 0 = facing +z (south). */
  facing: number;
  seated: boolean;
}

export interface DeskSlot extends Spot {
  /** Desk top centre (where delivered parcels land). */
  deskX: number;
  deskZ: number;
  cluster: number;
}

export type FurnitureKind =
  | 'desk'
  | 'deskLeg'
  | 'divider'
  | 'boothDesk'
  | 'boothPanel'
  | 'sofa'
  | 'sofaBack'
  | 'table'
  | 'shelf'
  | 'counter'
  | 'appliance'
  | 'cabinDesk'
  | 'rug';

export interface Furniture {
  kind: FurnitureKind;
  /** Centre on the floor plane. */
  x: number;
  z: number;
  /** Size along x, z and y. */
  w: number;
  d: number;
  h: number;
  /** Bottom height. */
  y: number;
  /** Blocks walking. */
  block: boolean;
}

export interface RoomRect {
  id: RoomId;
  label: string;
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface WallSeg {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  h: number;
  kind: 'solid' | 'glass' | 'low';
}

export interface WalkGrid {
  cols: number;
  rows: number;
  cell: number;
  walkable: Uint8Array;
}

export interface Monitor {
  x: number;
  z: number;
  /** Direction the screen faces (towards the seat). */
  facing: number;
  y: number;
}

export interface Lamp {
  x: number;
  z: number;
  /** Base height (desk divider or floor). */
  y: number;
  scale: number;
}

export interface FloorLayout {
  deskCount: number;
  width: number;
  depth: number;
  rooms: RoomRect[];
  desks: DeskSlot[];
  booths: Spot[];
  lounge: Spot[];
  cabinSeat: Spot;
  /** Extra chairs without an owner (cabin visitors). */
  spareChairs: Spot[];
  hub: { x: number; z: number; r: number };
  entrance: { x: number; z: number };
  walls: WallSeg[];
  furniture: Furniture[];
  monitors: Monitor[];
  plants: { x: number; z: number; s: number }[];
  lamps: Lamp[];
  /** Warm point lights for the evening look (max 6, fixed count so shaders never recompile). */
  lights: { x: number; y: number; z: number }[];
  grid: WalkGrid;
}

export const MAX_DESKS = 256;
export const GRID_CELL = 0.5;

const LEFT_W = 8;
const RIGHT_W = 7;
const PITCH_X = 5;
const PITCH_Z = 4.5;
/** Cluster footprint (2x2 desks facing each other): x 0.45..3.55, z 0.4..3.3 from its origin. */
const CL_X1 = 3.55;
const CL_Z0 = 0.4;
const CL_Z1 = 3.3;

function widthFor(h: number) {
  return Math.ceil(LEFT_W + 0.6 + PITCH_X * (h - 1) + CL_X1 + 3.5 + 3.05 + PITCH_X * (h - 1) + CL_X1 + 1.6) + RIGHT_W;
}

function depthFor(rows: number) {
  return Math.max(16, Math.ceil((rows - 1) * PITCH_Z + (CL_Z1 - CL_Z0) + 8));
}

const cache = new Map<number, FloorLayout>();

/** Memoised layout for a desk count (deterministic). */
export function getLayout(deskCount: number): FloorLayout {
  const key = Math.min(MAX_DESKS, Math.max(1, Math.floor(deskCount)));
  let layout = cache.get(key);
  if (!layout) {
    layout = buildLayout(key);
    cache.set(key, layout);
  }
  return layout;
}

export function buildLayout(deskCount: number): FloorLayout {
  const desksWanted = Math.min(MAX_DESKS, Math.max(1, deskCount));
  const clusterCount = Math.max(4, Math.ceil(desksWanted / 4));
  const half = Math.ceil(clusterCount / 2);

  // Pick rows x columns per half so the office is about 1.7:1.
  let rows = 1;
  let cols = half;
  let best = Number.POSITIVE_INFINITY;
  for (let r = 1; r <= half; r++) {
    const c = Math.ceil(half / r);
    const score = Math.abs(widthFor(c) / depthFor(r) - 1.7) + (c * r - half) * 0.04;
    if (score < best) {
      best = score;
      rows = r;
      cols = c;
    }
  }

  const W = widthFor(cols);
  const D = depthFor(rows);
  const zc = Math.round(D * 0.44);

  const leftOrigin = (c: number) => LEFT_W + 0.6 + c * PITCH_X;
  const leftBlockEnd = leftOrigin(cols - 1) + CL_X1;
  const hubX = leftBlockEnd + 3.5;
  const rightOrigin = (c: number) => hubX + 3.05 + c * PITCH_X;
  const callingX0 = W - RIGHT_W;
  const blockD = (rows - 1) * PITCH_Z + (CL_Z1 - CL_Z0);
  const z0 = D / 2 - blockD / 2 - CL_Z0;

  const furniture: Furniture[] = [];
  const monitors: Monitor[] = [];
  const lamps: Lamp[] = [];
  const plants: { x: number; z: number; s: number }[] = [];
  const desks: DeskSlot[] = [];

  // Cluster order: inner columns (next to the hub) first, then outwards; rows top to bottom.
  const clusterOrigins: { x: number; z: number }[] = [];
  for (let k = 0; k < cols; k++) {
    for (let r = 0; r < rows; r++) {
      clusterOrigins.push({ x: leftOrigin(cols - 1 - k), z: z0 + r * PITCH_Z });
      clusterOrigins.push({ x: rightOrigin(k), z: z0 + r * PITCH_Z });
    }
  }

  clusterOrigins.forEach((o, ci) => {
    for (const [dx, south] of [
      [1.2, false],
      [2.8, false],
      [1.2, true],
      [2.8, true],
    ] as const) {
      const deskZ = o.z + (south ? 2.2 : 1.5);
      desks.push({
        x: o.x + dx,
        z: o.z + (south ? 2.95 : 0.75),
        facing: south ? Math.PI : 0,
        seated: true,
        deskX: o.x + dx,
        deskZ,
        cluster: ci,
      });
      furniture.push({ kind: 'desk', x: o.x + dx, z: deskZ, w: 1.5, d: 0.7, h: 0.05, y: 0.57, block: true });
      furniture.push({ kind: 'deskLeg', x: o.x + dx - 0.7, z: deskZ, w: 0.05, d: 0.62, h: 0.57, y: 0, block: false });
      furniture.push({ kind: 'deskLeg', x: o.x + dx + 0.7, z: deskZ, w: 0.05, d: 0.62, h: 0.57, y: 0, block: false });
      monitors.push({ x: o.x + dx, z: o.z + (south ? 1.98 : 1.72), facing: south ? 0 : Math.PI, y: 0.62 });
    }
    furniture.push({ kind: 'divider', x: o.x + 2, z: o.z + 1.85, w: 3.2, d: 0.04, h: 0.3, y: 0.62, block: false });
    lamps.push({ x: o.x + 3.45, z: o.z + 1.85, y: 0.62, scale: 1 });
  });

  // Plants along the north wall between cluster columns and beside the entrance.
  for (let x = LEFT_W + 3.1; x < callingX0 - 1; x += PITCH_X) {
    if (Math.abs(x - hubX) > 2.5) plants.push({ x, z: 0.8, s: 1 });
  }
  plants.push({ x: hubX - 2.2, z: D - 0.8, s: 1.1 }, { x: hubX + 2.2, z: D - 0.8, s: 1.1 });

  // Calling room booths: two columns facing east.
  const booths: Spot[] = [];
  const boothRows: number[] = [];
  for (let z = 1.3; z <= D - 1.3; z += 1.7) boothRows.push(z);
  for (const z of boothRows) {
    for (const [seatX, deskX] of [
      [W - 1.45, W - 0.65],
      [W - 4.6, W - 3.8],
    ] as const) {
      booths.push({ x: seatX, z, facing: Math.PI / 2, seated: true });
      furniture.push({ kind: 'boothDesk', x: deskX, z, w: 0.6, d: 1.2, h: 0.62, y: 0, block: true });
      monitors.push({ x: deskX + 0.15, z, facing: -Math.PI / 2, y: 0.62 });
    }
  }
  for (const deskX of [W - 0.65, W - 3.8]) {
    for (let k = 0; k <= boothRows.length; k++) {
      const z = (boothRows[0] ?? 1.3) - 0.85 + k * 1.7;
      if (z < 0.3 || z > D - 0.3) continue;
      furniture.push({ kind: 'boothPanel', x: deskX - 0.25, z, w: 1.3, d: 0.04, h: 1.0, y: 0, block: false });
    }
  }
  plants.push({ x: callingX0 + 0.8, z: 0.8, s: 1 }, { x: callingX0 + 0.8, z: D - 0.8, s: 1 });

  // Lounge (left, south part): long sofa on the west wall, tables, armchairs, coffee counter.
  const lounge: Spot[] = [];
  const sofaZ0 = zc + 1.5;
  const sofaZ1 = D - 1.2;
  const seatCount = Math.max(3, Math.floor((sofaZ1 - sofaZ0) / 0.8));
  const sofaLen = seatCount * 0.8;
  for (let i = 0; i < seatCount; i++) lounge.push({ x: 0.95, z: sofaZ0 + 0.4 + i * 0.8, facing: Math.PI / 2, seated: true });
  furniture.push({ kind: 'sofa', x: 0.95, z: sofaZ0 + sofaLen / 2, w: 0.85, d: sofaLen + 0.2, h: 0.36, y: 0, block: true });
  furniture.push({ kind: 'sofaBack', x: 0.45, z: sofaZ0 + sofaLen / 2, w: 0.24, d: sofaLen + 0.2, h: 0.78, y: 0, block: true });
  furniture.push({ kind: 'rug', x: 2.5, z: sofaZ0 + sofaLen / 2, w: 3.6, d: sofaLen + 0.6, h: 0.012, y: 0, block: false });
  const tableCount = Math.max(1, Math.floor(seatCount / 3));
  for (let t = 0; t < tableCount; t++) {
    const z = sofaZ0 + (sofaLen / tableCount) * (t + 0.5);
    furniture.push({ kind: 'table', x: 2.35, z, w: 0.8, d: 1.3, h: 0.34, y: 0, block: true });
  }
  const armCount = Math.max(1, Math.floor(sofaLen / 1.6));
  for (let a = 0; a < armCount; a++) {
    const z = sofaZ0 + (sofaLen / armCount) * (a + 0.5);
    lounge.push({ x: 3.75, z, facing: -Math.PI / 2, seated: true });
    furniture.push({ kind: 'sofa', x: 3.75, z, w: 0.7, d: 0.75, h: 0.36, y: 0, block: true });
    furniture.push({ kind: 'sofaBack', x: 4.2, z, w: 0.2, d: 0.75, h: 0.72, y: 0, block: true });
  }
  furniture.push({ kind: 'counter', x: 6.3, z: zc + 0.45, w: 2.6, d: 0.6, h: 0.9, y: 0, block: true });
  furniture.push({ kind: 'appliance', x: 5.6, z: zc + 0.42, w: 0.4, d: 0.36, h: 0.42, y: 0.9, block: false });
  furniture.push({ kind: 'appliance', x: 7.1, z: zc + 0.42, w: 0.5, d: 0.4, h: 0.2, y: 0.9, block: false });
  plants.push({ x: 7.3, z: D - 0.8, s: 1.2 }, { x: 0.75, z: zc + 0.75, s: 0.9 });
  lamps.push({ x: 6.9, z: zc + 2.6, y: 0, scale: 2.6 });

  // Manager cabin (left, north part).
  const cabinDeskZ = zc / 2 + 0.25;
  const cabinSeat: Spot = { x: 4.2, z: cabinDeskZ - 0.85, facing: 0, seated: true };
  furniture.push({ kind: 'cabinDesk', x: 4.2, z: cabinDeskZ, w: 2.0, d: 0.9, h: 0.66, y: 0, block: true });
  monitors.push({ x: 4.2, z: cabinDeskZ + 0.18, facing: Math.PI, y: 0.66 });
  furniture.push({ kind: 'shelf', x: 0.35, z: zc / 2, w: 0.45, d: Math.max(2, zc - 2.6), h: 1.25, y: 0, block: true });
  const spareChairs: Spot[] = [
    { x: 3.6, z: cabinDeskZ + 0.95, facing: Math.PI, seated: true },
    { x: 4.8, z: cabinDeskZ + 0.95, facing: Math.PI, seated: true },
  ];
  plants.push({ x: 7.25, z: 0.75, s: 1.1 }, { x: 0.8, z: zc - 0.8, s: 0.9 });
  lamps.push({ x: 5.0, z: cabinDeskZ + 0.15, y: 0.66, scale: 1 });

  const hub = { x: hubX, z: D / 2, r: 2.2 };
  const entrance = { x: hubX, z: D - 0.6 };
  furniture.push({ kind: 'rug', x: hubX, z: D - 0.55, w: 2.0, d: 0.9, h: 0.012, y: 0, block: false });

  // Walls (gaps are doorways).
  const walls: WallSeg[] = [];
  const addWall = (x1: number, z1: number, x2: number, z2: number, h: number, kind: WallSeg['kind'], gaps: [number, number][] = []) => {
    const horizontal = z1 === z2;
    const a0 = horizontal ? x1 : z1;
    const a1 = horizontal ? x2 : z2;
    let cursor = a0;
    for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
      if (g0 > cursor) walls.push(horizontal ? { x1: cursor, z1, x2: g0, z2, h, kind } : { x1, z1: cursor, x2, z2: g0, h, kind });
      cursor = Math.max(cursor, g1);
    }
    if (cursor < a1) walls.push(horizontal ? { x1: cursor, z1, x2: a1, z2, h, kind } : { x1, z1: cursor, x2, z2: a1, h, kind });
  };
  addWall(0, 0, W, 0, 1.0, 'solid');
  addWall(0, 0, 0, D, 1.0, 'solid');
  addWall(0, D, W, D, 0.22, 'low', [[hubX - 1.1, hubX + 1.1]]);
  addWall(W, 0, W, D, 0.22, 'low');
  addWall(LEFT_W, 0, LEFT_W, D, 0.8, 'solid', [
    [zc - 2.4, zc - 1.0],
    [zc + 1.2, D - 1.2],
  ]);
  addWall(0, zc, LEFT_W, zc, 0.8, 'solid');
  addWall(callingX0, 0, callingX0, D, 1.15, 'glass', [[D / 2 - 1, D / 2 + 1]]);

  const rooms: RoomRect[] = [
    { id: 'cabin', label: 'Manager cabin', x: 0, z: 0, w: LEFT_W, d: zc },
    { id: 'lounge', label: 'Lounge', x: 0, z: zc, w: LEFT_W, d: D - zc },
    { id: 'sales', label: 'Sales floor', x: LEFT_W, z: 0, w: callingX0 - LEFT_W, d: D },
    { id: 'calling', label: 'Calling room', x: callingX0, z: 0, w: RIGHT_W, d: D },
    { id: 'hub', label: 'Lead Hub', x: hubX - hub.r, z: hub.z - hub.r, w: hub.r * 2, d: hub.r * 2 },
  ];

  // Up to 6 warm lights: 4 spread over the desk clusters, the lounge lamp and the cabin.
  const clusterLamps = lamps.slice(0, clusterOrigins.length);
  const lights: { x: number; y: number; z: number }[] = [];
  const pickCount = Math.min(4, clusterLamps.length);
  for (let i = 0; i < pickCount; i++) {
    const lamp = clusterLamps[Math.round((i * (clusterLamps.length - 1)) / Math.max(1, pickCount - 1))];
    if (lamp) lights.push({ x: lamp.x - 1.4, y: 1.6, z: lamp.z });
  }
  lights.push({ x: 6.9, y: 1.7, z: zc + 2.6 }, { x: 5.0, y: 1.3, z: cabinDeskZ + 0.1 });

  const grid = buildGrid(W, D, walls, furniture, plants, hub);

  return {
    deskCount: desks.length,
    width: W,
    depth: D,
    rooms,
    desks,
    booths,
    lounge,
    cabinSeat,
    spareChairs,
    hub,
    entrance,
    walls,
    furniture,
    monitors,
    plants,
    lamps,
    lights,
    grid,
  };
}

function buildGrid(
  W: number,
  D: number,
  walls: WallSeg[],
  furniture: Furniture[],
  plants: { x: number; z: number; s: number }[],
  hub: { x: number; z: number },
): WalkGrid {
  const cell = GRID_CELL;
  const cols = Math.ceil(W / cell);
  const rows = Math.ceil(D / cell);
  const walkable = new Uint8Array(cols * rows).fill(1);
  const block = (x0: number, z0: number, x1: number, z1: number) => {
    const i0 = Math.max(0, Math.floor(x0 / cell));
    const i1 = Math.min(cols - 1, Math.floor(x1 / cell));
    const j0 = Math.max(0, Math.floor(z0 / cell));
    const j1 = Math.min(rows - 1, Math.floor(z1 / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * cell;
        const cz = (j + 0.5) * cell;
        if (cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1) walkable[j * cols + i] = 0;
      }
    }
  };
  const pad = 0.2;
  for (const w of walls) {
    block(Math.min(w.x1, w.x2) - 0.3, Math.min(w.z1, w.z2) - 0.3, Math.max(w.x1, w.x2) + 0.3, Math.max(w.z1, w.z2) + 0.3);
  }
  for (const f of furniture) {
    if (f.block) block(f.x - f.w / 2 - pad, f.z - f.d / 2 - pad, f.x + f.w / 2 + pad, f.z + f.d / 2 + pad);
  }
  for (const p of plants) block(p.x - 0.4, p.z - 0.4, p.x + 0.4, p.z + 0.4);
  block(hub.x - 0.7, hub.z - 0.7, hub.x + 0.7, hub.z + 0.7);
  return { cols, rows, cell, walkable };
}
