import type { FloorTemplate, SeatKind, TemplateId, TemplateRoom } from './template';

/**
 * Runtime layout derived from a floor template (SPEC 12.1 item 4). Pure data shared by the 3D scene
 * (characters, parcels, camera) and the reducer (booth and lounge capacity). Coordinates are metres:
 * x = east, z = south; headings in radians, forward = (sin, cos), 0 = facing +z.
 */

export interface Spot {
  id: string;
  x: number;
  z: number;
  facing: number;
  seated: boolean;
  /** Walking graph node this spot connects to. */
  approach: string;
  /** Heading while on a phone call (chair swivels), radians. */
  callFacing: number | null;
}

export type HomeKind = SeatKind | 'standing' | 'overflow';

/** A person's own place: desk, hot desk, reception, cabin, or a standing/overflow spot. */
export interface HomeSlot extends Spot {
  kind: HomeKind;
  /** Work surface centre (parcels land here); the spot itself when there is none. */
  deskX: number;
  deskZ: number;
  deskY: number;
  /** Screen anchor (office GLB node `screen:<id>`), null when the place has no monitor. */
  screen: string | null;
}

export interface GraphNode {
  id: string;
  x: number;
  z: number;
  /** Indices of neighbours and edge lengths. */
  next: number[];
  cost: number[];
}

export interface Obstacle {
  kind: 'rect' | 'circle';
  x: number;
  z: number;
  /** rect: half sizes and rotation; circle: radius in hw. */
  hw: number;
  hd: number;
  cos: number;
  sin: number;
}

export interface FloorLayout {
  template: FloorTemplate;
  id: TemplateId;
  minX: number;
  minZ: number;
  width: number;
  depth: number;
  footprint: [number, number][];
  rooms: TemplateRoom[];
  homes: HomeSlot[];
  /** Number of homes that come from template seats (the rest are standing/overflow spots). */
  seatHomes: number;
  booths: Spot[];
  lounge: Spot[];
  hub: { x: number; z: number; r: number; approach: string };
  entrance: { x: number; z: number; approach: string; insideX: number; insideZ: number };
  cabinSeat: Spot | null;
  graph: GraphNode[];
  nodeIndex: Map<string, number>;
  obstacles: Obstacle[];
  /** Wall segments that block walking (door gaps removed). */
  walls: [number, number, number, number][];
  /** Warm light pools for the evening look (max 6). */
  lights: { x: number; y: number; z: number }[];
  wallHeights: { back: number; front: number };
}

const RAD = Math.PI / 180;
/** Order in which home seats are handed out after the cabin and reception rules. */
const HOME_ORDER: SeatKind[] = ['desk', 'hot_desk', 'reception', 'cabin'];

const cache = new Map<string, FloorLayout>();

/** Memoised layout for a template and head count (deterministic). */
export function getLayout(template: FloorTemplate, people: number): FloorLayout {
  const key = `${template.id}:${template.seats.length}:${Math.max(0, Math.floor(people))}`;
  let layout = cache.get(key);
  if (!layout) {
    layout = buildLayout(template, people);
    cache.set(key, layout);
  }
  return layout;
}

export function buildLayout(t: FloorTemplate, people: number): FloorLayout {
  const workY = (kind: SeatKind) => (kind === 'reception' ? 0.77 : kind === 'cabin' ? 0.8 : 0.78);
  const spot = (s: { id: string; pos: [number, number]; facing: number; sit: boolean; approach: string; callFacing?: number }): Spot => ({
    id: s.id,
    x: s.pos[0],
    z: s.pos[1],
    facing: s.facing * RAD,
    seated: s.sit,
    approach: s.approach,
    callFacing: s.callFacing === undefined ? null : s.callFacing * RAD,
  });

  const homes: HomeSlot[] = [];
  for (const kind of HOME_ORDER) {
    for (const s of t.seats) {
      if (s.kind !== kind) continue;
      const work = s.work ?? s.pos;
      homes.push({ ...spot(s), kind, deskX: work[0], deskZ: work[1], deskY: workY(kind), screen: s.screen ?? null });
    }
  }
  const seatHomes = homes.length;
  for (const s of t.standing) homes.push({ ...spot(s), kind: 'standing', deskX: s.pos[0], deskZ: s.pos[1], deskY: 1.05, screen: null });

  const obstacles: Obstacle[] = t.obstacles.map((o) =>
    o.kind === 'circle'
      ? { kind: 'circle', x: o.pos[0], z: o.pos[1], hw: o.r, hd: o.r, cos: 1, sin: 0 }
      : { kind: 'rect', x: o.pos[0], z: o.pos[1], hw: o.size[0] / 2, hd: o.size[1] / 2, cos: Math.cos(-o.facing * RAD), sin: Math.sin(-o.facing * RAD) },
  );
  const walls = wallSolids(t);

  const nodeIndex = new Map<string, number>();
  const graph: GraphNode[] = t.graph.nodes.map((n, i) => {
    nodeIndex.set(n.id, i);
    return { id: n.id, x: n.pos[0], z: n.pos[1], next: [], cost: [] };
  });
  for (const [a, b] of t.graph.edges) {
    const i = nodeIndex.get(a);
    const j = nodeIndex.get(b);
    if (i === undefined || j === undefined) continue;
    const na = graph[i]!;
    const nb = graph[j]!;
    const d = Math.hypot(na.x - nb.x, na.z - nb.z);
    na.next.push(j);
    na.cost.push(d);
    nb.next.push(i);
    nb.cost.push(d);
  }

  // Overflow: extra people stand on free floor near graph nodes, facing the hub.
  const [minX, minZ] = t.bounds.min;
  const [maxX, maxZ] = t.bounds.max;
  const need = Math.max(0, people - homes.length);
  if (need > 0) {
    const [hx, hz] = t.hub.pos;
    const taken = homes.map((h) => [h.x, h.z] as const);
    const cands: { x: number; z: number; d: number; node: GraphNode }[] = [];
    for (let z = minZ + 0.8; z < maxZ - 0.6; z += 0.75) {
      for (let x = minX + 0.8; x < maxX - 0.6; x += 0.75) {
        if (!insidePolygon(x, z, t.footprint)) continue;
        if (obstacles.some((o) => obstacleDistance(o, x, z) < 0.45)) continue;
        if (walls.some(([ax, az, bx, bz]) => pointSegment(x, z, ax, az, bx, bz) < 0.5)) continue;
        if (Math.hypot(x - hx, z - hz) < t.hub.platformRadius + 0.4) continue;
        let node: GraphNode | null = null;
        let best = Infinity;
        for (const n of graph) {
          const d = Math.hypot(n.x - x, n.z - z);
          if (d < best) {
            best = d;
            node = n;
          }
        }
        if (node) cands.push({ x, z, d: Math.hypot(x - hx, z - hz), node });
      }
    }
    cands.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
    let k = 0;
    for (const c of cands) {
      if (k >= need) break;
      if (taken.some(([x, z]) => Math.hypot(x - c.x, z - c.z) < 0.6)) continue;
      taken.push([c.x, c.z]);
      const facing = Math.atan2(hx - c.x, hz - c.z);
      homes.push({ id: `overflow-${k}`, x: c.x, z: c.z, facing, seated: false, approach: c.node.id, callFacing: null, kind: 'overflow', deskX: c.x, deskZ: c.z, deskY: 1.05, screen: null });
      k++;
    }
    // Still short (very large teams on a small template): stack on the last spots.
    for (; k < need; k++) {
      const base = homes[seatHomes + (k % Math.max(1, homes.length - seatHomes))] ?? homes[0]!;
      const ang = (k * 2.399) % (Math.PI * 2);
      homes.push({ ...base, id: `overflow-${k}`, x: base.x + Math.cos(ang) * 0.35, z: base.z + Math.sin(ang) * 0.35, kind: 'overflow', seated: false, screen: null });
    }
  }

  const booths = t.seats.filter((s) => s.kind === 'booth').map(spot);
  const lounge = t.seats.filter((s) => s.kind === 'lounge').map(spot);
  const cabin = t.seats.find((s) => s.kind === 'cabin');
  const lights = t.lamps.slice(0, 6).map((l) => ({ x: l.pos[0], y: l.pos[1], z: l.pos[2] }));

  return {
    template: t,
    id: t.id,
    minX,
    minZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    footprint: t.footprint,
    rooms: t.rooms,
    homes,
    seatHomes,
    booths,
    lounge,
    hub: { x: t.hub.pos[0], z: t.hub.pos[1], r: t.hub.platformRadius, approach: t.hub.approach },
    entrance: { x: t.entrance.outside[0], z: t.entrance.outside[1], approach: t.entrance.approach, insideX: t.entrance.inside[0], insideZ: t.entrance.inside[1] },
    cabinSeat: cabin ? spot(cabin) : null,
    graph,
    nodeIndex,
    obstacles,
    walls,
    lights,
    wallHeights: t.wallHeights,
  };
}

function wallSolids(t: FloorTemplate): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const w of t.walls) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const ux = (w.b[0] - w.a[0]) / len;
    const uz = (w.b[1] - w.a[1]) / len;
    let cursor = 0;
    const doors = w.openings.filter((o) => o.kind !== 'window').sort((p, q) => p.from - q.from);
    for (const o of [...doors, { from: len, to: len }]) {
      if (o.from > cursor) out.push([w.a[0] + ux * cursor, w.a[1] + uz * cursor, w.a[0] + ux * o.from, w.a[1] + uz * o.from]);
      cursor = Math.max(cursor, o.to);
    }
  }
  return out;
}

export function obstacleDistance(o: Obstacle, x: number, z: number): number {
  const dx = x - o.x;
  const dz = z - o.z;
  if (o.kind === 'circle') return Math.max(0, Math.hypot(dx, dz) - o.hw);
  const lx = dx * o.cos - dz * o.sin;
  const lz = dx * o.sin + dz * o.cos;
  return Math.hypot(Math.max(0, Math.abs(lx) - o.hw), Math.max(0, Math.abs(lz) - o.hd));
}

export function pointSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2)) : 0;
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}

export function insidePolygon(x: number, z: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
